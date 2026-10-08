// E2E do terminal Standalone (D-025) com a nuvem: roster calculado do snapshot real, decisão local do terminal ligada à pessoa
// e alarme de porta (door.forced) -> fila -> edge-gateway -> access_events + alerta `door_forced`. O terminal é SIMULADO
// (notificações do Monitor injetadas no driver Control iD); nenhum equipamento real. Só contra o Supabase LOCAL.
//   node apps/edge-agent/e2e/device-alarm.e2e.mjs
// Pré-requisito: `supabase start` do zela-acesso-local com o edge-runtime ativo (função `edge-gateway` servida).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createControlIdDriver } from '@zela/device-drivers';
import {
  createHttpTransport,
  drainQueue,
  openStore,
  sendHeartbeat,
  syncSnapshot,
} from '../src/index.js';
import { recordDeviceDecisions } from '../src/device-events.js';
import { syncRosters } from '../src/roster.js';

const DB = 'supabase_db_zela-acesso-local';
const GATEWAY = process.env.EDGE_GATEWAY_URL ?? 'http://127.0.0.1:55321/functions/v1/edge-gateway';
const PREFIX = '/api/notifications/segredo-e2e';

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
  sched: id(),
  pol: id(),
  ana: id(),
  user: id(),
};
const slug = `e2e-edge-${T.tenant.slice(0, 8)}`;
// Fuso da UNIDADE (America/Manaus), não o da máquina; 0 = domingo, igual ao snapshot.
const weekday = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'America/Manaus' }),
).getDay();

function setup() {
  const out = psql(`
begin;
insert into auth.users (id, email) values ('${T.user}', '${slug}@example.test');
insert into public.tenants (id, name, slug) values ('${T.tenant}', 'E2E Alarme', '${slug}');
insert into public.memberships (tenant_id, user_id, role) values ('${T.tenant}', '${T.user}', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values ('${T.site}', '${T.tenant}', 'Sede', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values ('${T.zone}', '${T.tenant}', '${T.site}', 'Hall');
insert into public.access_points (id, tenant_id, site_id, zone_id, name, direction, offline_behavior)
  values ('${T.point}', '${T.tenant}', '${T.site}', '${T.zone}', 'Porta 1', 'entry', 'degraded_deny');
insert into public.access_groups (id, tenant_id, name) values ('${T.group}', '${T.tenant}', 'Equipe');
insert into public.access_schedules (id, tenant_id, name) values ('${T.sched}', '${T.tenant}', 'Sempre');
insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
  values ('${T.tenant}', '${T.sched}', ${weekday}, '00:00', '23:59:59');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id, effect, schedule_id, status)
  values ('${T.pol}', '${T.tenant}', '${T.site}', 'Equipe no hall', '${T.group}', '${T.zone}', 'allow', '${T.sched}', 'active');
insert into public.people (id, tenant_id, full_name, status) values ('${T.ana}', '${T.tenant}', 'Ana E2E', 'active');
insert into public.access_group_members (tenant_id, group_id, person_id) values ('${T.tenant}', '${T.group}', '${T.ana}');
select set_config('request.jwt.claims', json_build_object('sub', '${T.user}', 'role', 'authenticated')::text, true);
set local role authenticated;
select enrollment_token as tok from public.create_edge_agent('${T.site}', 'Agente E2E') \\gset
reset role;
set local role service_role;
select agent_secret as sec from public.edge_enroll(:'tok', 'e2e-host', '0.1.0') \\gset
reset role;
select 'OUT|' || (select id from public.edge_agents where tenant_id = '${T.tenant}') || '|' || :'sec';
commit;
`);
  const line = out.split('\n').find((l) => l.startsWith('OUT|'));
  assert.ok(line, 'setup não devolveu o agente');
  const [, agentId, secret] = line.trim().split('|');
  return { agentId, secret };
}

function purge() {
  const r = spawnSync('node', ['scripts/purge-tenants-dev.mjs', '--e2e', '--apply'], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

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

// Terminal simulado com banco em memória: o suficiente para o syncRoster do driver.
function fakeTerminal() {
  const db = { users: [], access_rules: [], portal_access_rules: [], user_access_rules: [] };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = JSON.parse(init.body);
    const ok = (o) => new Response(JSON.stringify(o));
    if (u.pathname === '/login.fcgi') return ok({ session: 's' });
    if (u.pathname === '/load_objects.fcgi') return ok({ [body.object]: db[body.object] });
    if (u.pathname === '/create_objects.fcgi') {
      db[body.object].push(...body.values);
      return ok({});
    }
    if (u.pathname === '/destroy_objects.fcgi') {
      db.users = db.users.filter((x) => !body.where.users.id.includes(x.id));
      return ok({});
    }
    return ok({});
  };
  return { db, fetchImpl };
}

let failed = false;
try {
  await waitForGateway();
  const { agentId, secret } = setup();
  const transport = createHttpTransport({ baseUrl: GATEWAY, agentId, secret });
  const store = openStore();
  const now = () => new Date();

  const hb = await sendHeartbeat({ store, transport, now: now(), version: 'e2e' });
  check('heartbeat ok', () => assert.equal(hb.status, 'ok'));
  const sync = await syncSnapshot({ store, transport, now: now() });
  check('snapshot atualizado da nuvem', () => assert.equal(sync.status, 'updated'));

  const term = fakeTerminal();
  const driver = createControlIdDriver({
    points: {
      [T.point]: {
        baseUrl: 'http://10.0.0.5',
        login: 'op',
        password: 'x',
        model: 'door',
        deviceId: 478435,
        doorSensor: true,
      },
    },
    env: 'test',
    fetchImpl: term.fetchImpl,
    monitorPathPrefix: PREFIX,
    forcedGraceMs: 1_000,
  });
  recordDeviceDecisions({ store, driver });

  const r = await syncRosters({ store, driver, pointIds: [T.point], now: now() });
  check('roster do snapshot real: a pessoa do grupo vai ao terminal', () => {
    assert.equal(r.status, 'done');
    assert.deepEqual(r.points[T.point], {
      ok: true,
      code: 'OK',
      created: 1,
      removed: 0,
      conflicts: 0,
    });
    assert.equal(term.db.users.length, 1);
    assert.equal(term.db.users[0].registration, 'zela:100000');
  });

  const dao = (userId, event = 7) =>
    driver.handleNotification(`${PREFIX}/dao`, {
      device_id: 478435,
      object_changes: [
        {
          object: 'access_logs',
          type: 'inserted',
          values: {
            id: String(Math.floor(Math.random() * 1e6)),
            event: String(event),
            user_id: String(userId),
            portal_id: '1',
            time: '1',
          },
        },
      ],
    });
  dao(100000); // usuário sincronizado
  dao(7); // usuário cadastrado à mão no terminal

  // As concessões acima valem só dentro da tolerância (1 s aqui): espera passar para a abertura não contar como autorizada.
  await new Promise((res) => setTimeout(res, 1_200));
  // Porta aberta sem autorização -> door.forced depois da tolerância
  driver.handleNotification(`${PREFIX}/door`, { door: { id: 1, open: true }, device_id: 478435 });
  await new Promise((res) => setTimeout(res, 1_200));
  driver.tick(new Date());

  check('3 eventos na fila (2 decisões do terminal + 1 alarme)', () =>
    assert.equal(store.queueDepth(), 3),
  );
  const sent = await drainQueue({ store, transport, now: now() });
  check('fila drenada para a nuvem', () => {
    assert.equal(sent.status, 'drained');
    assert.equal(sent.sent, 3);
  });

  const rows = psql(
    `select event_type || '|' || coalesce(reason_code,'') || '|' || coalesce(physical_outcome,'') || '|' || coalesce(person_id::text,'') || '|' || coalesce(access_point_id::text,'') from public.access_events where tenant_id = '${T.tenant}' order by seq;`,
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|'));
  check(
    'decisão do usuário sincronizado grava a PESSOA; a do usuário manual fica sem pessoa',
    () => {
      const dec = rows.filter((x) => x[0] === 'access_decision');
      assert.equal(dec.length, 2);
      assert.ok(dec.every((x) => x[1] === 'DEVICE_LOCAL_ALLOW'));
      assert.deepEqual(dec.map((x) => x[3]).sort(), ['', T.ana].sort());
    },
  );
  check('alarme gravado como physical_outcome DOOR_FORCED no ponto', () => {
    const a = rows.filter((x) => x[0] === 'physical_outcome');
    assert.equal(a.length, 1);
    assert.equal(a[0][2], 'DOOR_FORCED');
    assert.equal(a[0][4], T.point);
  });
  check('alerta crítico door_forced aberto na nuvem', () => {
    const al = psql(
      `select kind || '|' || severity || '|' || status from public.alerts where tenant_id = '${T.tenant}' and access_point_id = '${T.point}';`,
    ).trim();
    assert.equal(al, 'door_forced|critical|open');
  });
} catch (e) {
  failed = true;
  results.push(['FAIL', `exceção: ${e.message}`]);
} finally {
  const purged = purge();
  results.push([purged ? 'PASS' : 'FAIL', 'organização de teste apagada']);
}

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
if (failed || results.some(([s]) => s === 'FAIL')) process.exit(1);
