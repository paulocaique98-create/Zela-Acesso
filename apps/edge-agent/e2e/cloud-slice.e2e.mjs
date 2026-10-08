// E2E do vertical slice com a nuvem (Fase 4): agente real -> edge-gateway (Edge Function) -> RPCs edge_* -> access_events.
// Só contra o Supabase LOCAL do Zela Acesso (recusa outro alvo). Dados sintéticos em organização `e2e-edge-*`,
// apagada ao final (a organização de teste é removida mesmo se uma verificação falhar).
//   node apps/edge-agent/e2e/cloud-slice.e2e.mjs
// Pré-requisito: `supabase start` do zela-acesso-local com o edge-runtime ativo (função `edge-gateway` servida).
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createMockHardware } from '@zela/device-drivers';
import {
  createHttpTransport,
  drainQueue,
  handleAccessAttempt,
  openStore,
  sendHeartbeat,
  syncSnapshot,
} from '../src/index.js';

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
  sched: id(),
  pol: id(),
  ana: id(),
  user: id(),
};
const slug = `e2e-edge-${T.tenant.slice(0, 8)}`;
const pinHash = bcrypt.hashSync(PIN, 4);
const cardHash = createHash('sha256').update(`${T.tenant}:${CARD.toUpperCase()}`).digest('hex');
// 0=domingo; mesma convenção do snapshot (segunda=1). No fuso da UNIDADE (America/Manaus), não no da máquina:
// entre 00:00 e 01:00 em Brasília os dias divergem.
const weekday = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'America/Manaus' }),
).getDay();

function setup() {
  const out = psql(`
begin;
insert into auth.users (id, email) values ('${T.user}', '${slug}@example.test');
insert into public.tenants (id, name, slug) values ('${T.tenant}', 'E2E Edge', '${slug}');
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
insert into public.credentials (tenant_id, person_id, type, status, secret_hash) values ('${T.tenant}', '${T.ana}', 'pin', 'active', '${pinHash}');
insert into public.credentials (tenant_id, person_id, type, status, identifier_hash) values ('${T.tenant}', '${T.ana}', 'card', 'active', '${cardHash}');
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

// O edge-runtime pode demorar a servir a função logo após o `supabase start` (CI): 401 = a função já responde.
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

  const driver = createMockHardware({ points: [T.point], now: now(), env: 'test' });
  const go = (credential) =>
    handleAccessAttempt({
      store,
      driver,
      accessPointId: T.point,
      credential,
      now: now(),
      offline: false,
      newId: randomUUID,
    });

  const allow = await go({ type: 'card', number: CARD });
  check('cartão válido = ALLOW e porta destravada', () => {
    assert.equal(allow.decision.decision, 'ALLOW');
    assert.equal(allow.actuation.ok, true);
  });
  const deny = await go({ type: 'pin', personId: T.ana, pin: '000000' });
  check('PIN errado = não abre', () => {
    assert.notEqual(deny.decision.decision, 'ALLOW');
    assert.equal(deny.actuation.attempted, false);
  });
  // Falha real de atuação: o driver cai, a decisão continua ALLOW e a nuvem recebe o resultado DOOR_NOT_OPENED.
  driver.setOnline(T.point, false);
  const fail = await go({ type: 'card', number: CARD });
  check('driver offline: ALLOW, mas atuação falha e é reportada', () => {
    assert.equal(fail.decision.decision, 'ALLOW');
    assert.deepEqual(
      { ok: fail.actuation.ok, code: fail.actuation.code, reported: fail.actuation.reported },
      { ok: false, code: 'DEVICE_OFFLINE', reported: true },
    );
  });
  check('5 eventos na fila (3 decisões + 2 resultados físicos)', () =>
    assert.equal(store.queueDepth(), 5),
  );

  const sent = await drainQueue({ store, transport, now: now() });
  check('fila drenada para a nuvem', () => {
    assert.equal(sent.status, 'drained');
    assert.equal(sent.sent, 5);
  });
  check('fila vazia após o envio', () => assert.equal(store.queueDepth(), 0));

  const rows = psql(
    `select event_type || '|' || coalesce(decision,'') || '|' || coalesce(physical_outcome,'') || '|' || source || '|' || coalesce(correlation_id::text,'') from public.access_events where tenant_id = '${T.tenant}' order by seq;`,
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  check('eventos gravados no tenant/site do agente', () => {
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.split('|')[3] === 'EDGE_AGENT'));
    assert.ok(rows.some((r) => r.startsWith('access_decision|ALLOW|')));
  });
  check('resultados físicos gravados e ligados às decisões pela correlação', () => {
    const f = rows.map((r) => r.split('|'));
    const outs = f.filter((x) => x[0] === 'physical_outcome');
    assert.deepEqual(outs.map((x) => x[2]).sort(), ['DOOR_NOT_OPENED', 'DOOR_OPENED']);
    const decisionCorrs = new Set(f.filter((x) => x[0] === 'access_decision').map((x) => x[4]));
    assert.ok(outs.every((x) => decisionCorrs.has(x[4])));
  });

  const dupe = await transport
    .sendEvents([{ p_tenant: T.tenant, p_site: T.site, ...pickAnyQueued(store, allow) }])
    .catch(() => null);
  check('reenvio idempotente (duplicate, sem novo evento)', () => {
    assert.equal(dupe?.results?.[0]?.status, 'duplicate');
    const n = psql(
      `select count(*) from public.access_events where tenant_id = '${T.tenant}';`,
    ).trim();
    assert.equal(n, '5');
  });

  const bad = createHttpTransport({ baseUrl: GATEWAY, agentId, secret: `zes_${'0'.repeat(64)}` });
  check('segredo errado = 401 (null)', () => {});
  const badRes = await bad.heartbeat({
    version: 'x',
    agentTime: now().toISOString(),
    queueDepth: 0,
  });
  results[results.length - 1] =
    badRes === null
      ? ['PASS', 'segredo errado = 401 (null)']
      : ['FAIL', 'segredo errado não foi recusado'];

  psql(`begin;
select set_config('request.jwt.claims', json_build_object('sub', '${T.user}', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.revoke_edge_agent('${agentId}', 'e2e teste de revogacao');
commit;`);
  const rev = await syncSnapshot({ store, transport, now: now() });
  check('agente revogado = revoked e cache apagado', () => assert.equal(rev.status, 'revoked'));
} catch (e) {
  failed = true;
  results.push(['FAIL', `exceção: ${e.message}`]);
} finally {
  const purged = purge();
  results.push([purged ? 'PASS' : 'FAIL', 'organização de teste apagada']);
}

for (const [s, n] of results)
  process.stdout.write(`${s}  ${n}
`);
if (failed || results.some(([s]) => s === 'FAIL')) process.exit(1);

// Reconstrói o payload do evento ALLOW já enviado (a fila o marcou como enviado): reaproveita a mesma chave.
function pickAnyQueued(_store, _allow) {
  const row = psql(
    `select idempotency_key from public.access_events where tenant_id = '${T.tenant}' and decision = 'ALLOW' order by seq limit 1;`,
  ).trim();
  return {
    p_event_type: 'access_decision',
    p_occurred_at: new Date().toISOString(),
    p_decision: 'ALLOW',
    p_reason_code: 'POLICY_ALLOW',
    p_person: null,
    p_credential: null,
    p_access_point: null,
    p_zone: null,
    p_policy: null,
    p_physical_outcome: null,
    p_source: 'EDGE_AGENT',
    p_correlation: null,
    p_evidence: {},
    p_idempotency_key: row,
  };
}
