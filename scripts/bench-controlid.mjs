// Roteiro de bancada Control iD (Fase 8). Roda NA LAN, contra UM terminal de teste. Nunca em terminal de produção.
//   BENCH_PASSWORD=... node scripts/bench-controlid.mjs --url http://192.168.0.129 --login op --model door [passos]
// Passos (cada um é opt-in; sem nenhum, só LEITURA):
//   (padrão)   login, estado da porta (doors_state x door_state), load_objects (só chaves e contagens), config atual do monitor
//   --roster   cria 1 usuário Zela de teste (id 999999), confere regra/portal/usuário, remove e confere de novo
//   --unlock   manda abrir a porta uma vez (o relé liga de verdade: avise quem estiver perto)
//   --monitor <host> [--port 8000] [--secs 90]   aponta o Monitor do terminal para este PC e imprime os eventos recebidos
//              (tipo, event, portal e user_id; NUNCA cartão/PIN/gabarito). Durante a janela: passe um cartão, abra pelo botão,
//              abra a porta à força (com --door-sensor) e feche.
//   --door-sensor   liga a inferência de door.forced no driver durante o --monitor
// A senha vem só de BENCH_PASSWORD (nunca por argumento). A saída é um JSON sem segredos para colar no relatório.
// O terminal fica com monitor apontando para --monitor; restaure depois (set_configuration) ou rode o Edge de novo.

import { createControlIdDriver } from '../packages/device-drivers/src/index.js';
import { createMonitorServer } from '../apps/edge-agent/src/monitor-server.js';
import { randomBytes } from 'node:crypto';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(`--${k}`);
const baseUrl = opt('url');
const login = opt('login');
const model = opt('model', 'door');
const password = process.env.BENCH_PASSWORD;
if (!baseUrl || !login || !password) {
  console.error(
    'Uso: BENCH_PASSWORD=... node scripts/bench-controlid.mjs --url http://IP --login USUARIO --model door|sec_box|catra',
  );
  process.exit(1);
}
if (login === 'admin' && password === 'admin')
  console.error('AVISO: credencial de fábrica; troque antes de qualquer uso fora da bancada.');

const report = { when: new Date().toISOString(), model, steps: {} };
const origin = new URL(baseUrl).origin;
let session = null;

async function post(path, body, withSession = true) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8_000);
  try {
    const url = `${origin}/${path}.fcgi${withSession && session ? `?session=${encodeURIComponent(session)}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* não JSON */
    }
    return { status: res.status, json, bytes: text.length };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'TIMEOUT' : 'OFFLINE' };
  } finally {
    clearTimeout(t);
  }
}

// Só a forma: chaves e tipos, nunca valores (podem ser dados pessoais).
const shape = (v, depth = 0) => {
  if (Array.isArray(v))
    return { array: v.length, item: v.length && depth < 2 ? shape(v[0], depth + 1) : undefined };
  if (v && typeof v === 'object')
    return depth >= 3
      ? 'object'
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  return v === null ? 'null' : typeof v;
};
const brief = (r) => (r.error ? { error: r.error } : { status: r.status, shape: shape(r.json) });

// 1. login
const lg = await post('login', { login, password }, false);
report.steps.login = lg.error
  ? { error: lg.error }
  : { status: lg.status, hasSession: typeof lg.json?.session === 'string' };
if (typeof lg.json?.session !== 'string') {
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}
session = lg.json.session;

// 2. sessão inválida: qual status o terminal devolve? (hipótese do driver: 401/403)
const bad = await (async () => {
  const keep = session;
  session = 'sessao-invalida-bancada';
  const r = await post('doors_state', {});
  session = keep;
  return r;
})();
report.steps.invalidSession = { status: bad.status ?? bad.error };

// 3. estado da porta: qual endpoint existe? (hipótese: doors_state x door_state)
report.steps.doorsState = brief(await post('doors_state', {}));
report.steps.doorState = brief(await post('door_state', {}));

// 4. objetos: só forma e contagem
for (const object of [
  'users',
  'access_rules',
  'portal_access_rules',
  'user_access_rules',
  'portals',
  'access_logs',
]) {
  const r = await post('load_objects', { object });
  report.steps[`load_${object}`] = r.error
    ? { error: r.error }
    : {
        status: r.status,
        topLevelKeys: r.json && typeof r.json === 'object' ? Object.keys(r.json) : null,
        count: Array.isArray(r.json?.[object]) ? r.json[object].length : null,
        shape: shape(r.json),
      };
}

// 5. configuração atual do monitor (para restaurar depois)
const cfg = await post('get_configuration', { monitor: ['hostname', 'port', 'path'] });
report.steps.monitorConfig = brief(cfg);

const point = {
  baseUrl: origin,
  login,
  password,
  model,
  deviceId: opt('device-id'),
  doorSensor: has('door-sensor'),
};
if (model === 'sec_box') point.secBoxId = opt('sec-box-id');
if (model === 'door' && opt('door-number')) point.doorNumber = Number(opt('door-number'));
if (opt('portal-id')) point.portalId = Number(opt('portal-id'));
if (point.deviceId == null) delete point.deviceId;
const driver = createControlIdDriver({ points: { bench: point }, env: 'bench' });

// 6. roster
if (has('roster')) {
  const out = {};
  out.sync = await driver.syncRoster('bench', [{ deviceUserId: 999999, name: 'Zela bancada' }]);
  const u = await post('load_objects', { object: 'users' });
  out.userPresent = (u.json?.users ?? []).some(
    (x) => Number(x.id) === 999999 && x.registration === 'zela:999999',
  );
  const rl = await post('load_objects', { object: 'access_rules' });
  out.rulePresent = (rl.json?.access_rules ?? []).some((x) => Number(x.id) === 900001);
  const pl = await post('load_objects', { object: 'portal_access_rules' });
  out.portalLinks = (pl.json?.portal_access_rules ?? []).filter(
    (x) => Number(x.access_rule_id) === 900001,
  ).length;
  out.cleanup = await driver.syncRoster('bench', []);
  const u2 = await post('load_objects', { object: 'users' });
  out.userRemoved = !(u2.json?.users ?? []).some((x) => Number(x.id) === 999999);
  out.note =
    'a regra 900001 e o vínculo ao portal ficam no terminal (idempotentes); apague à mão se quiser';
  report.steps.roster = out;
}

// 7. abrir
if (has('unlock')) {
  const r = await driver.unlock('bench');
  await new Promise((res) => setTimeout(res, 1_500));
  report.steps.unlock = { result: r, doorAfter: brief(await post('doors_state', {})) };
}

// 8. monitor ao vivo
const host = opt('monitor');
if (host) {
  const port = Number(opt('port', '8000'));
  const secs = Number(opt('secs', '90'));
  const secret = randomBytes(24).toString('base64url');
  const live = createControlIdDriver({
    points: { bench: { ...point, deviceId: point.deviceId ?? opt('device-id') } },
    env: 'bench',
    monitorPathPrefix: `/api/notifications/${secret}`,
    forcedGraceMs: 8_000,
  });
  const seen = [];
  live.onEvent((e) =>
    seen.push({
      type: e.type,
      at: e.at,
      data: e.data && {
        controlIdEvent: e.data.controlIdEvent,
        portalId: e.data.portalId,
        deviceUserId: e.data.deviceUserId,
      },
    }),
  );
  const srv = createMonitorServer({ driver: live, bind: '0.0.0.0', port });
  await srv.listen();
  report.steps.monitorSetup = await live.configureMonitor('bench', { hostname: host, port });
  console.error(
    `Monitor ativo por ${secs}s em ${host}:${port}. Passe cartão, use o botão, force a porta, feche.`,
  );
  const tick = setInterval(() => live.tick(new Date()), 1_000);
  await new Promise((res) => setTimeout(res, secs * 1_000));
  clearInterval(tick);
  await srv.close();
  report.steps.monitorEvents = seen;
  report.steps.monitorNote =
    'confira se a ordem door x access_logs e os códigos de event (7=concedido, 11=botão, 12=web) batem com o que você fez';
}

console.log(JSON.stringify(report, null, 2));
