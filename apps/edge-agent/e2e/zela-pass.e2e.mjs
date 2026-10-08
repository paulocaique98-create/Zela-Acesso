// E2E do Zela Pass (D-027): leitor -> Edge SEM driver de porta -> edge-gateway -> banco (access_events), pelos 3 transportes
// (HTTPS, WebSocket, TCP/IP). Só contra o Supabase LOCAL do Zela Acesso. Dados sintéticos em organização `e2e-edge-*`, apagada ao final.
//   node apps/edge-agent/e2e/zela-pass.e2e.mjs
// Pré-requisito: `ZELA_EDGE_RUNTIME=1 pnpm db:start`.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createHttpTransport, openStore, runOnce } from '../src/index.js';
import { createReaderHttpServer } from '../src/reader-http-server.js';
import { createReaderService } from '../src/reader-service.js';
import { createReaderTcpServer } from '../src/reader-tcp-server.js';
import { createTestReader } from '../src/reader-test-client.js';

const DB = 'supabase_db_zela-acesso-local';
const GATEWAY = process.env.EDGE_GATEWAY_URL ?? 'http://127.0.0.1:55321/functions/v1/edge-gateway';
const PIN = '482913';
const CARD = 'ab12cd34';

function psql(sql) {
  const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (!(ps.stdout ?? '').split('\n').includes(DB))
    throw new Error(`RECUSADO: ${DB} não está em execução`);
  const r = spawnSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psql falhou: ${(r.stderr ?? '').slice(0, 500)}`);
  return r.stdout;
}

const id = () => randomUUID();
const T = {
  tenant: id(),
  site: id(),
  zone: id(),
  point: id(),
  group: id(),
  pol: id(),
  ana: id(),
  user: id(),
};
const slug = `e2e-edge-${T.tenant.slice(0, 8)}`;
const asOwner = `select set_config('request.jwt.claims', json_build_object('sub', '${T.user}', 'role', 'authenticated')::text, true);
set local role authenticated;`;

function setup() {
  const out = psql(`
begin;
insert into auth.users (id, email) values ('${T.user}', '${slug}@example.test');
insert into public.tenants (id, name, slug) values ('${T.tenant}', 'E2E Zela Pass', '${slug}');
insert into public.memberships (tenant_id, user_id, role) values ('${T.tenant}', '${T.user}', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values ('${T.site}', '${T.tenant}', 'Sede', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values ('${T.zone}', '${T.tenant}', '${T.site}', 'Hall');
insert into public.access_points (id, tenant_id, site_id, zone_id, name, direction, offline_behavior, actuation)
  values ('${T.point}', '${T.tenant}', '${T.site}', '${T.zone}', 'Registro portaria', 'bidirectional', 'degraded_deny', 'none');
insert into public.access_groups (id, tenant_id, name) values ('${T.group}', '${T.tenant}', 'Equipe');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id, effect, schedule_id, status)
  values ('${T.pol}', '${T.tenant}', '${T.site}', 'Equipe no hall', '${T.group}', '${T.zone}', 'allow', null, 'active');
insert into public.people (id, tenant_id, full_name, status, external_ref) values ('${T.ana}', '${T.tenant}', 'Ana E2E', 'active', 'M-309');
insert into public.access_group_members (tenant_id, group_id, person_id) values ('${T.tenant}', '${T.group}', '${T.ana}');
${asOwner}
select 'PIN|' || ((public.issue_credential('${T.tenant}', '${T.ana}', 'pin', '${PIN}'))->>'id');
select 'CARD|' || ((public.issue_credential('${T.tenant}', '${T.ana}', 'card', '${CARD}'))->>'id');
select 'TOKEN|' || ((public.issue_credential('${T.tenant}', '${T.ana}', 'mobile_token', null, null, now() + interval '30 days'))->>'token');
select 'READER|' || n || '|' || reader_id || '|' || enrollment_code
  from (select 'http' as n, * from public.create_access_reader('${T.point}', 'Tablet HTTPS')
        union all select 'ws', * from public.create_access_reader('${T.point}', 'Tablet WS')
        union all select 'tcp', * from public.create_access_reader('${T.point}', 'Tablet TCP')
        union all select 'daemon', * from public.create_access_reader('${T.point}', 'Tablet daemon')) r;
select enrollment_token as tok from public.create_edge_agent('${T.site}', 'Agente E2E') \\gset
reset role;
set local role service_role;
select agent_secret as sec from public.edge_enroll(:'tok', 'e2e-host', '0.1.0') \\gset
reset role;
select 'AGENT|' || (select id from public.edge_agents where tenant_id = '${T.tenant}') || '|' || :'sec';
commit;
`);
  const lines = out.split(/\r?\n/).map((l) => l.trim());
  const pick = (p) => lines.filter((l) => l.startsWith(`${p}|`)).map((l) => l.split('|').slice(1));
  const [agentId, secret] = pick('AGENT')[0];
  return {
    agentId,
    secret,
    token: pick('TOKEN')[0][0],
    readers: Object.fromEntries(pick('READER').map(([n, rid, code]) => [n, { rid, code }])),
  };
}

const rows = (sql) =>
  psql(sql)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name} — ${e.message.split('\n')[0]}`]);
  }
};

async function waitForGateway(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(GATEWAY, { method: 'POST' });
      if (res.status === 401) return;
    } catch {
      /* ainda subindo */
    }
    if (Date.now() > until) throw new Error('edge-gateway não respondeu (edge-runtime ligado?)');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---- clientes dos 3 transportes: cada um devolve (envelope) -> resposta
function httpClient(base) {
  return async (env) => {
    const r = await fetch(`${base}/reader/v1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(env),
    });
    return { status: r.status, ...(await r.json()) };
  };
}
async function wsClient(base) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/reader/v1/ws`);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error('ws'));
  });
  const q = [];
  ws.onmessage = (m) => q.shift()?.(JSON.parse(m.data));
  return {
    send: (env) =>
      new Promise((ok) => {
        q.push(ok);
        ws.send(JSON.stringify(env));
      }),
    close: () => ws.close(),
  };
}
async function tcpClient(port) {
  const sock = createConnection({ host: '127.0.0.1', port });
  await new Promise((ok, fail) => {
    sock.once('connect', ok);
    sock.once('error', fail);
  });
  const q = [];
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      q.shift()?.(JSON.parse(line));
    }
  });
  return {
    send: (env) =>
      new Promise((ok) => {
        q.push(ok);
        sock.write(`${JSON.stringify(env)}\n`);
      }),
    close: () => sock.destroy(),
  };
}

let failed = false;
let http;
let tcp;
let wsc;
let tcpc;
try {
  await waitForGateway();
  const S = setup();
  const transport = createHttpTransport({ baseUrl: GATEWAY, agentId: S.agentId, secret: S.secret });
  const store = openStore(); // sem driver de porta: o Edge só tem o serviço do leitor
  const last = {};
  const tick = () => runOnce({ store, transport, now: new Date(), version: 'e2e', last: {} });
  void last;

  const first = await tick();
  check('Edge sincronizou o snapshot com leitores e ponto register_only', () => {
    assert.ok(['updated', 'unchanged'].includes(first.results.sync?.status), 'sync');
    const snap = JSON.parse(store.loadSnapshotRow().body);
    assert.equal(snap.readers.length, 4);
    assert.equal(snap.accessPoints[0].actuation, 'none');
    assert.ok(snap.people.some((p) => p.refHash));
    assert.ok(!JSON.stringify(snap).includes('M-309'), 'matrícula em claro no snapshot');
    for (const r of snap.readers) assert.ok(r.enrollmentTokenHash && r.status === 'pending');
  });

  const service = createReaderService({ store, driver: null, isOffline: () => false });
  http = createReaderHttpServer({ service, bind: '127.0.0.1', port: 0 });
  tcp = createReaderTcpServer({ service, bind: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(await http.listen()).port}`;
  const tcpPort = (await tcp.listen()).port;
  wsc = await wsClient(base);
  tcpc = await tcpClient(tcpPort);
  const clients = { http: httpClient(base).bind(null), ws: wsc.send, tcp: tcpc.send };
  const readers = {};
  for (const n of ['http', 'ws', 'tcp']) {
    const t = createTestReader();
    const e = await clients[n](t.enroll(S.readers[n].code, `Tablet ${n}`));
    t.state.readerId = e.readerId;
    readers[n] = { t, enrolled: e };
  }
  check('os 3 leitores ativam pelo respectivo transporte e recebem o modo register_only', () => {
    for (const n of ['http', 'ws', 'tcp']) {
      assert.equal(readers[n].enrolled.ok, true, `${n}: ${JSON.stringify(readers[n].enrolled)}`);
      assert.equal(readers[n].enrolled.readerId, S.readers[n].rid);
      assert.equal(readers[n].enrolled.mode, 'register_only');
    }
  });

  const out = {};
  out.qr = await clients.http(readers.http.t.attempt({ method: 'qr', value: S.token }));
  out.barcode = await clients.ws(readers.ws.t.attempt({ method: 'barcode', value: CARD }));
  out.pin = await clients.tcp(
    readers.tcp.t.attempt({ method: 'pin', identifier: 'M-309', pin: PIN }),
  );
  out.badPin = await clients.tcp(
    readers.tcp.t.attempt({ method: 'pin', identifier: 'M-309', pin: '111222' }),
  );
  out.badQr = await clients.http(
    readers.http.t.attempt({ method: 'qr', value: 'token-que-nao-existe-123' }),
  );
  check('QR (HTTPS), código de barras (WS) e senha (TCP) registram a marcação', () => {
    for (const k of ['qr', 'barcode', 'pin'])
      assert.equal(out[k].outcome, 'REGISTERED', `${k}: ${JSON.stringify(out[k])}`);
  });
  check('credencial inválida não registra como aceita (resposta sem motivo detalhado)', () => {
    assert.equal(out.badPin.outcome, 'INVALID_CREDENTIAL');
    assert.equal(out.badQr.outcome, 'INVALID_CREDENTIAL');
    assert.ok(!JSON.stringify(out.badPin).includes('reasonCode'));
  });

  const drained = await tick();
  check('fila drenada para a nuvem e leitores reportados', () => {
    assert.notEqual(
      drained.results.drain?.status,
      'offline',
      JSON.stringify(drained.results.drain),
    );
    assert.equal(store.queueDepth(), 0);
    assert.equal(store.unreportedReaders().length, 0);
  });

  const ev = rows(
    `select event_type || '|' || coalesce(decision,'') || '|' || coalesce(reason_code,'') || '|' || source || '|' || coalesce(physical_outcome,'') || '|' || coalesce(evidence->'reader'->>'method','') || '|' || coalesce(evidence->'reader'->>'mode','') || '|' || coalesce(person_id::text,'') from public.access_events where tenant_id = '${T.tenant}' order by seq;`,
  );
  check('nuvem tem 3 marcações ALLOW (uma por método) e 2 DENY, todas do EDGE_AGENT', () => {
    const allow = ev.filter((l) => l.split('|')[1] === 'ALLOW');
    assert.equal(allow.length, 3, ev.join('\n'));
    assert.deepEqual(allow.map((l) => l.split('|')[5]).sort(), ['barcode', 'pin', 'qr']);
    for (const l of allow) {
      const f = l.split('|');
      assert.equal(f[0], 'access_decision');
      assert.equal(f[3], 'EDGE_AGENT');
      assert.equal(f[6], 'register_only');
      assert.equal(f[7], T.ana);
    }
    assert.equal(ev.filter((l) => l.split('|')[1] === 'DENY').length, 2);
  });
  check('SEM driver de porta: nenhum resultado físico nem comando de dispositivo', () => {
    assert.equal(ev.filter((l) => l.split('|')[0] === 'physical_outcome').length, 0);
    assert.equal(
      rows(`select count(*) from public.device_commands where tenant_id = '${T.tenant}';`)[0],
      '0',
    );
  });
  check('nenhum segredo lido (PIN, token, cartão) foi parar na evidência', () => {
    const txt = rows(
      `select evidence::text from public.access_events where tenant_id = '${T.tenant}';`,
    ).join('\n');
    for (const s of [PIN, S.token, CARD, CARD.toUpperCase(), '111222'])
      assert.ok(!txt.includes(s), `vazou ${s.slice(0, 3)}…`);
  });
  check(
    'painel: os 3 leitores ativados estão ATIVOS com chave pública e sem hash de código (o 4º segue pendente)',
    () => {
      const r = rows(
        `select status || '|' || (device_public_key ~ '^[0-9a-f]{64}$')::text || '|' || (enrollment_token_hash is null)::text from public.access_readers where tenant_id = '${T.tenant}';`,
      );
      assert.equal(r.length, 4 - 1, r.join(','));
      for (const l of r.filter((x) => !x.startsWith('pending')))
        assert.equal(l, 'active|true|true');
    },
  );

  // ---- revogação na nuvem -> Edge recusa após o próximo snapshot
  psql(`begin;
${asOwner}
select public.revoke_access_reader('${S.readers.ws.rid}', 'tablet perdido no E2E');
commit;`);
  await tick();
  const revoked = await clients.ws(readers.ws.t.attempt({ method: 'qr', value: S.token }));
  const stillOk = await clients.http(readers.http.t.attempt({ method: 'qr', value: S.token }));
  check('leitor revogado na nuvem é recusado (REVOKED); os demais seguem', () => {
    assert.equal(revoked.code, 'REVOKED');
    assert.equal(stillOk.outcome, 'REGISTERED');
  });

  // ---- replay de uma mensagem já usada
  const env = readers.http.t.attempt({ method: 'qr', value: S.token });
  await clients.http(env);
  const replay = await clients.http(env);
  check('replay do mesmo envelope é recusado', () => assert.equal(replay.code, 'REPLAY'));

  // ---- daemon real (main.js): config -> servidores -> serviço -> fila -> nuvem
  const freePort = () =>
    new Promise((ok) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        srv.close(() => ok(p));
      });
    });
  const dbFile = join(tmpdir(), `zela-pass-e2e-${randomUUID()}.sqlite`);
  const httpPort = await freePort();
  const daemonTcp = await freePort();
  const child = spawn(process.execPath, ['apps/edge-agent/src/main.js'], {
    env: {
      ...process.env,
      EDGE_GATEWAY_URL: GATEWAY,
      EDGE_AGENT_ID: S.agentId,
      EDGE_AGENT_SECRET: S.secret,
      EDGE_DB_PATH: dbFile,
      EDGE_TICK_MS: '500',
      EDGE_READER_BIND: '127.0.0.1',
      EDGE_READER_PORT: String(httpPort),
      EDGE_READER_TCP_PORT: String(daemonTcp),
      EDGE_READER_WEB_DIR: resolve('apps/reader/dist'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let daemonLog = '';
  child.stderr.on('data', (d) => (daemonLog += d));
  try {
    const dbase = `http://127.0.0.1:${httpPort}`;
    const dhttp = httpClient(dbase);
    for (let i = 0; i < 60 && !daemonLog.includes('leitores:'); i++) await sleep(250);
    check('daemon sobe com os servidores do leitor (HTTP + TCP)', () =>
      assert.ok(daemonLog.includes('leitores:'), daemonLog.slice(0, 300)),
    );
    const page = await fetch(`${dbase}/`);
    check('daemon entrega o PWA com CSP', () => {
      assert.equal(page.status, 200);
      assert.ok(page.headers.get('content-security-policy')?.includes("default-src 'self'"));
    });
    const garbage = await fetch(`${dbase}/reader/v1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"x":1}',
    });
    check('mensagem inválida recebe 400 MALFORMED', () => assert.equal(garbage.status, 400));

    const dr = createTestReader();
    let enrolled;
    for (let i = 0; i < 80; i++) {
      enrolled = await dhttp(dr.enroll(S.readers.daemon.code, 'Tablet daemon'));
      if (enrolled.code !== 'NO_SNAPSHOT') break;
      await sleep(250); // o daemon ainda sincroniza o primeiro snapshot
    }
    check('o daemon ativa o leitor depois de sincronizar o snapshot', () =>
      assert.equal(enrolled.ok, true, JSON.stringify(enrolled)),
    );
    dr.state.readerId = enrolled.readerId;
    const marked = await dhttp(dr.attempt({ method: 'qr', value: S.token }));
    check('o daemon registra a marcação', () =>
      assert.equal(marked.outcome, 'REGISTERED', JSON.stringify(marked)),
    );
    let delivered = false;
    let active = false;
    for (let i = 0; i < 60 && !(delivered && active); i++) {
      await sleep(1000);
      delivered =
        rows(
          `select count(*) from public.access_events where tenant_id = '${T.tenant}' and evidence->'reader'->>'readerId' = '${S.readers.daemon.rid}';`,
        )[0] === '1';
      active =
        rows(
          `select status from public.access_readers where id = '${S.readers.daemon.rid}';`,
        )[0] === 'active';
    }
    check('o daemon entrega a evidência à nuvem e reporta o leitor como ativo', () => {
      assert.ok(delivered, 'evento não chegou');
      assert.ok(active, 'leitor continua pendente na nuvem');
    });
    check('o log do daemon não contém segredo', () => {
      for (const x of [S.token, PIN, CARD, S.readers.daemon.code])
        assert.ok(!daemonLog.includes(x), 'segredo no log');
    });
  } finally {
    const exited = new Promise((ok) => child.once('exit', ok));
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* arquivo temporário: o SO limpa depois */
      }
    }
  }
} catch (e) {
  failed = true;
  results.push(['FAIL', `execução — ${e.stack?.split('\n').slice(0, 3).join(' | ')}`]);
} finally {
  wsc?.close();
  tcpc?.close();
  await http?.close();
  await tcp?.close();
  const r = spawnSync('node', ['scripts/purge-tenants-dev.mjs', '--e2e', '--apply'], {
    encoding: 'utf8',
  });
  results.push([r.status === 0 ? 'PASS' : 'FAIL', 'organização de teste apagada']);
}

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
if (failed || results.some(([s]) => s === 'FAIL')) process.exit(1);
