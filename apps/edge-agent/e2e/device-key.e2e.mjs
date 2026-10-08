// E2E da Fase 8A (D-022): enrollment com chave do dispositivo, prova de posse, comando v2 com kid e daemon sem chave
// HMAC. Só contra o Supabase LOCAL do Zela Acesso. Dados sintéticos em organização `e2e-edge-*`, apagada ao final.
//   node apps/edge-agent/e2e/device-key.e2e.mjs
// Pré-requisito: `ZELA_EDGE_RUNTIME=1 pnpm db:start` e COMMAND_SIGNING_JWK em supabase/.env (gen-signing).
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createMockHardware } from '@zela/device-drivers';
import { createHttpTransport, openStore, runOnce } from '../src/index.js';
import { generateKeyPair, kidOf } from '../src/keys.js';
import { enrollAgent } from '../src/transport.js';
import { createKeyring } from '../src/trust.js';

const DB = 'supabase_db_zela-acesso-local';
const GATEWAY = process.env.EDGE_GATEWAY_URL ?? 'http://127.0.0.1:55321/functions/v1/edge-gateway';

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = new RegExp(`^${name}='?(.*?)'?$`, 'm').exec(readFileSync('supabase/.env', 'utf8'));
    return m?.[1] ?? '';
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
insert into public.tenants (id, name, slug) values ('${T.tenant}', 'E2E 8A', '${slug}');
insert into public.memberships (tenant_id, user_id, role) values ('${T.tenant}', '${T.user}', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values ('${T.site}', '${T.tenant}', 'Sede', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values ('${T.zone}', '${T.tenant}', '${T.site}', 'Recepcao');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values ('${T.point}', '${T.tenant}', '${T.site}', '${T.zone}', 'Porta');
${asOwner}
select 'OUT|' || enrollment_token from public.create_edge_agent('${T.site}', 'Agente 8A');
commit;
`);
  const line = out.split('\n').find((l) => l.startsWith('OUT|'));
  assert.ok(line, 'setup não devolveu o token');
  return line.trim().split('|')[1];
}

const UUID_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requestUnlock = (reason) =>
  psql(`begin;
${asOwner}
select public.request_device_command('${T.point}', 'unlock', 3000, '${reason}');
commit;`)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => UUID_LINE.test(l));
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
  const jwk = JSON.parse(envValue('COMMAND_SIGNING_JWK') || 'null');
  assert.ok(
    jwk?.x,
    'COMMAND_SIGNING_JWK ausente (supabase/.env; node scripts/command-key.mjs gen-signing)',
  );
  const cloudPub = Buffer.from(jwk.x, 'base64url').toString('hex');
  const cloudKid = kidOf(cloudPub);
  await waitForGateway();

  // --- enrollment pelo gateway, com chave do dispositivo
  const token = setup();
  const device = generateKeyPair();
  const enrolled = await enrollAgent({
    baseUrl: GATEWAY,
    token,
    devicePublicKey: device.publicKey,
    hostname: 'e2e-host',
    version: 'e2e',
  });
  const { agentId, agentSecret: secret } = enrolled;
  check('enrollment pelo gateway devolve credencial do agente', () => {
    assert.match(agentId, UUID_LINE);
    assert.match(secret, /^zes_[0-9a-f]{64}$/);
  });
  const reuse = await enrollAgent({
    baseUrl: GATEWAY,
    token,
    devicePublicKey: generateKeyPair().publicKey,
    hostname: 'x',
    version: 'x',
  }).then(
    () => 'aceito',
    () => 'recusado',
  );
  check('token de enrollment é de uso único (segundo uso recusado)', () =>
    assert.equal(reuse, 'recusado'),
  );
  check('nuvem guardou a chave pública (não a privada)', () =>
    assert.equal(
      psql(`select device_public_key from public.edge_agents where id = '${agentId}';`).trim(),
      device.publicKey,
    ),
  );

  // --- prova de posse
  const good = createHttpTransport({
    baseUrl: GATEWAY,
    agentId,
    secret,
    deviceKey: device.privateKey,
  });
  const hb = (t) =>
    t.heartbeat({ version: 'e2e', agentTime: new Date().toISOString(), queueDepth: 0 });
  const okHb = await hb(good);
  check('heartbeat com chave do dispositivo = 200', () => assert.ok(okHb?.serverTime));
  const stolen = await hb(createHttpTransport({ baseUrl: GATEWAY, agentId, secret }));
  check('segredo roubado SEM a chave do dispositivo = 401', () => assert.equal(stolen, null));
  const other = await hb(
    createHttpTransport({
      baseUrl: GATEWAY,
      agentId,
      secret,
      deviceKey: generateKeyPair().privateKey,
    }),
  );
  check('segredo + outra chave de dispositivo = 401', () => assert.equal(other, null));
  const skewed = await hb(
    createHttpTransport({
      baseUrl: GATEWAY,
      agentId,
      secret,
      deviceKey: device.privateKey,
      nowMs: () => Date.now() - 10 * 60_000,
    }),
  );
  check('assinatura com relógio fora da janela (±120 s) = 401', () => assert.equal(skewed, null));

  // --- chaves de comando pelo canal autenticado
  const keys = await good.commandKeys();
  check('gateway publica kid + chave pública (nunca a privada)', () => {
    assert.deepEqual(keys.keys, [{ kid: cloudKid, publicKey: cloudPub }]);
    assert.equal(JSON.stringify(keys).includes(jwk.d), false);
  });

  // --- comando v2 ponta a ponta
  const store = openStore();
  const driver = createMockHardware({ points: [T.point], now: new Date(), env: 'test' });
  const round = (seed) =>
    runOnce({
      store,
      transport: good,
      now: new Date(),
      version: 'e2e',
      last: {},
      commands: {
        driver,
        key: [],
        keyring: createKeyring({ store, transport: good, seed }),
        agentId,
      },
    });

  const cmd1 = requestUnlock('abertura v2 com ancora de chave publica');
  const r1 = await round({ [cloudKid]: cloudPub });
  check('agente com âncora (kid:pública) verifica o v2 e abre, sem chave HMAC', () => {
    assert.equal(r1.results.commands.results[0].status, 'executed');
    assert.equal(driver.getStatus(T.point).locked, false);
  });
  check('nuvem registra executed/OK', () => assert.equal(cmdStatus(cmd1), 'executed|OK'));

  await driver.lock(T.point);
  const cmd2 = requestUnlock('agente com ancora errada');
  const wrong = generateKeyPair();
  const r2 = await round({ [kidOf(wrong.publicKey)]: wrong.publicKey });
  check('agente com âncora de OUTRA chave rejeita (BAD_SIGNATURE) e a porta segue trancada', () => {
    assert.equal(r2.results.commands.results[0].code, 'BAD_SIGNATURE');
    assert.equal(driver.getStatus(T.point).locked, true);
  });
  check('nuvem registra rejected/BAD_SIGNATURE', () =>
    assert.equal(cmdStatus(cmd2), 'rejected|BAD_SIGNATURE'),
  );

  // --- daemon real: só chaves públicas + chave do dispositivo
  const cmd3 = requestUnlock('daemon: v2 sem HMAC');
  const dbPath = join(tmpdir(), `zela-e2e-8a-${agentId}.sqlite`);
  const child = spawn('node', ['apps/edge-agent/src/main.js'], {
    env: {
      PATH: process.env.PATH,
      EDGE_GATEWAY_URL: GATEWAY,
      EDGE_AGENT_ID: agentId,
      EDGE_AGENT_SECRET: secret,
      EDGE_DEVICE_KEY: device.privateKey,
      EDGE_DB_PATH: dbPath,
      EDGE_DRIVER: 'mock',
      EDGE_MOCK_POINTS: T.point,
      EDGE_COMMAND_PUBKEYS: `${cloudKid}:${cloudPub}`,
      EDGE_TICK_MS: '500',
    },
    stdio: 'ignore',
  });
  try {
    const until = Date.now() + 30_000;
    while (Date.now() < until && cmdStatus(cmd3) !== 'executed|OK')
      await new Promise((r) => setTimeout(r, 1000));
    check('daemon (main.js) com EDGE_DEVICE_KEY + EDGE_COMMAND_PUBKEYS executa e reporta', () =>
      assert.equal(cmdStatus(cmd3), 'executed|OK'),
    );
  } finally {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
    for (const ext of ['', '-wal', '-shm']) rmSync(`${dbPath}${ext}`, { force: true });
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
