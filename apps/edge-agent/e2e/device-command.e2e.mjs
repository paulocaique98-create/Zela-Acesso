// E2E do comando remoto de abertura (4E): operador pede -> edge-gateway (Edge Function) assina -> agente real verifica,
// aciona o HAL (Mock) e reporta -> `executed` + auditoria. Só contra o Supabase LOCAL do Zela Acesso (recusa outro alvo).
// Dados sintéticos em organização `e2e-edge-*`, apagada ao final (mesmo se uma verificação falhar).
//   node apps/edge-agent/e2e/device-command.e2e.mjs
// Pré-requisito: `supabase start` com edge-runtime e COMMAND_MASTER_KEY (env ou supabase/.env, ignorado pelo git).
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createMockHardware } from '@zela/device-drivers';
import { deriveCommandKey } from '../../../supabase/functions/edge-gateway/handler.js';
import { createHttpTransport, openStore, runOnce } from '../src/index.js';

const DB = 'supabase_db_zela-acesso-local';
const GATEWAY = process.env.EDGE_GATEWAY_URL ?? 'http://127.0.0.1:55321/functions/v1/edge-gateway';

function masterKey() {
  if (process.env.COMMAND_MASTER_KEY) return process.env.COMMAND_MASTER_KEY;
  try {
    return /^COMMAND_MASTER_KEY=(\S+)/m.exec(readFileSync('supabase/.env', 'utf8'))?.[1] ?? '';
  } catch {
    return '';
  }
}

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
const T = { tenant: id(), site: id(), zone: id(), point: id(), user: id() };
const slug = `e2e-edge-${T.tenant.slice(0, 8)}`;
const asOwner = `select set_config('request.jwt.claims', json_build_object('sub', '${T.user}', 'role', 'authenticated')::text, true);
set local role authenticated;`;

function setup() {
  const out = psql(`
begin;
insert into auth.users (id, email) values ('${T.user}', '${slug}@example.test');
insert into public.tenants (id, name, slug) values ('${T.tenant}', 'E2E Cmd', '${slug}');
insert into public.memberships (tenant_id, user_id, role) values ('${T.tenant}', '${T.user}', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values ('${T.site}', '${T.tenant}', 'Sede', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values ('${T.zone}', '${T.tenant}', '${T.site}', 'Recepcao');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values ('${T.point}', '${T.tenant}', '${T.site}', '${T.zone}', 'Porta');
${asOwner}
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

const UUID_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requestCommand = (action, reason) =>
  psql(`begin;
${asOwner}
select public.request_device_command('${T.point}', '${action}', ${action === 'lock' ? 'null' : '3000'}, '${reason}');
commit;`)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => UUID_LINE.test(l));
const requestUnlock = (reason) => requestCommand('unlock', reason);
const cmdStatus = (cmd) =>
  psql(
    `select status || '|' || coalesce(result_code, '') from public.device_commands where id = '${cmd}';`,
  ).trim();

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

// 401 = a função já responde (o edge-runtime pode demorar logo após o `supabase start`).
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
  const master = masterKey();
  assert.match(master, /^[0-9a-f]{64}$/, 'COMMAND_MASTER_KEY ausente (env ou supabase/.env)');
  await waitForGateway();
  const { agentId, secret } = setup();
  const transport = createHttpTransport({ baseUrl: GATEWAY, agentId, secret });
  const store = openStore();
  const driver = createMockHardware({ points: [T.point], now: new Date(), env: 'test' });
  const key = await deriveCommandKey(master, agentId);
  const round = (k = key) =>
    runOnce({
      store,
      transport,
      now: new Date(),
      version: 'e2e',
      last: {},
      commands: { driver, key: k, agentId },
    });

  const cmd1 = requestUnlock('visita autorizada no portao');
  check('pedido registrado como pending', () => assert.equal(cmdStatus(cmd1), 'pending|'));
  const r1 = await round();
  check('agente recebe, verifica a assinatura do gateway e abre', () => {
    assert.equal(r1.results.commands.results.length, 1);
    assert.equal(r1.results.commands.results[0].status, 'executed');
    assert.equal(r1.results.commands.results[0].reported, true);
    assert.equal(driver.getStatus(T.point).locked, false);
  });
  check('nuvem registra executed/OK', () => assert.equal(cmdStatus(cmd1), 'executed|OK'));
  check('pedido e resultado auditados', () =>
    assert.equal(
      psql(
        `select count(*) from public.audit_log where tenant_id = '${T.tenant}' and action in ('device_commands.request','device_commands.result');`,
      ).trim(),
      '2',
    ),
  );
  const r2 = await round();
  check('nada novo a executar (entregue uma vez)', () =>
    assert.equal(r2.results.commands.results.length, 0),
  );

  // lock remoto (fechamento da 4E): assinado, entregue uma vez, trava e reporta
  assert.equal(driver.getStatus(T.point).locked, false);
  const cmdLock = requestCommand('lock', 'reafirmar trava');
  await round();
  check('lock remoto: agente trava o ponto e a nuvem registra executed/OK', () => {
    assert.equal(driver.getStatus(T.point).locked, true);
    assert.equal(cmdStatus(cmdLock), 'executed|OK');
  });

  // Chave errada no agente (ex.: agente reconfigurado com a chave de outro): rejeita e a nuvem fica sabendo.
  await driver.lock(T.point);
  const cmd2 = requestUnlock('segundo pedido');
  const r3 = await round(await deriveCommandKey(master, id()));
  check('chave de comando errada: rejeitado e porta segue trancada', () => {
    assert.equal(r3.results.commands.results[0].code, 'BAD_SIGNATURE');
    assert.equal(driver.getStatus(T.point).locked, true);
  });
  check('nuvem registra rejected/BAD_SIGNATURE', () =>
    assert.equal(cmdStatus(cmd2), 'rejected|BAD_SIGNATURE'),
  );

  // Rotação da mestra: o agente aceita a chave nova E a anterior (o gateway ainda assina com a anterior).
  await driver.lock(T.point);
  const newMasterKey = await deriveCommandKey('f'.repeat(64), agentId);
  const cmd3 = requestUnlock('rotacao: gateway ainda na mestra antiga');
  const r4 = await round([newMasterKey, key]);
  check('rotação: agente com [nova, anterior] aceita a assinatura da mestra anterior', () => {
    assert.equal(r4.results.commands.results[0].status, 'executed');
    assert.equal(driver.getStatus(T.point).locked, false);
  });
  check('rotação: nuvem registra executed/OK', () => assert.equal(cmdStatus(cmd3), 'executed|OK'));
  await driver.lock(T.point);
  const cmd4 = requestUnlock('rotacao: agente so com a chave nova');
  const r5 = await round([newMasterKey]);
  check('rotação: agente só com a nova rejeita a assinatura da mestra anterior', () => {
    assert.equal(r5.results.commands.results[0].code, 'BAD_SIGNATURE');
    assert.equal(driver.getStatus(T.point).locked, true);
  });
  check('rotação: nuvem registra rejected/BAD_SIGNATURE', () =>
    assert.equal(cmdStatus(cmd4), 'rejected|BAD_SIGNATURE'),
  );

  // Daemon real (main.js) com configuração só por ambiente: abre via Mock e reporta.
  const cmd5 = requestUnlock('daemon: abertura remota');
  const child = spawn('node', ['apps/edge-agent/src/main.js'], {
    env: {
      PATH: process.env.PATH,
      EDGE_GATEWAY_URL: GATEWAY,
      EDGE_AGENT_ID: agentId,
      EDGE_AGENT_SECRET: secret,
      EDGE_DB_PATH: join(tmpdir(), `zela-e2e-${agentId}.sqlite`),
      EDGE_DRIVER: 'mock',
      EDGE_MOCK_POINTS: T.point,
      EDGE_COMMAND_KEY: key,
      EDGE_COMMAND_KEY_PREVIOUS: newMasterKey,
      EDGE_TICK_MS: '500',
    },
    stdio: 'ignore',
  });
  try {
    const until = Date.now() + 30_000;
    while (Date.now() < until && cmdStatus(cmd5) !== 'executed|OK')
      await new Promise((r) => setTimeout(r, 1000));
    check('daemon (main.js) executa o comando e reporta executed/OK', () =>
      assert.equal(cmdStatus(cmd5), 'executed|OK'),
    );
  } finally {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
    for (const ext of ['', '-wal', '-shm'])
      rmSync(join(tmpdir(), `zela-e2e-${agentId}.sqlite${ext}`), { force: true });
  }
} catch (e) {
  failed = true;
  results.push(['FAIL', `exceção: ${e.message}`]);
} finally {
  const purged = purge();
  results.push([purged ? 'PASS' : 'FAIL', 'organização de teste apagada']);
}

for (const [s, n] of results) process.stdout.write(`${s}  ${n}\n`);
if (failed || results.some(([s]) => s === 'FAIL')) process.exit(1);
