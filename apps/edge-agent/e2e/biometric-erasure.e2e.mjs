// E2E da eliminação biométrica (7D): cadastrar -> revogar -> snapshot -> Edge apaga no provedor -> confirmação via
// edge-gateway -> perfil `erased`. Agente real (runOnce) -> edge-gateway (Edge Function) -> RPCs edge_*.
// Só contra o Supabase LOCAL do Zela Acesso (recusa outro alvo). Dados sintéticos em organização `e2e-edge-*`,
// apagada ao final (mesmo se uma verificação falhar).
//   node apps/edge-agent/e2e/biometric-erasure.e2e.mjs
// Pré-requisito: `supabase start` do zela-acesso-local com o edge-runtime ativo (função `edge-gateway` servida).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createMockBiometricProvider } from '@zela/biometrics';
import { createHttpTransport, openStore, runOnce } from '../src/index.js';

const DB = 'supabase_db_zela-acesso-local';
const GATEWAY = process.env.EDGE_GATEWAY_URL ?? 'http://127.0.0.1:55321/functions/v1/edge-gateway';
const TEMPLATE_REF = 'mock:e2e-0001';

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
const T = { tenant: id(), site: id(), ana: id(), user: id() };
const slug = `e2e-edge-${T.tenant.slice(0, 8)}`;
const asOwner = `select set_config('request.jwt.claims', json_build_object('sub', '${T.user}', 'role', 'authenticated')::text, true);
set local role authenticated;`;

function setup() {
  const out = psql(`
begin;
insert into auth.users (id, email) values ('${T.user}', '${slug}@example.test');
insert into public.tenants (id, name, slug, features_enabled)
  values ('${T.tenant}', 'E2E Bio', '${slug}', '{"biometrics":true}'::jsonb);
insert into public.memberships (tenant_id, user_id, role) values ('${T.tenant}', '${T.user}', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values ('${T.site}', '${T.tenant}', 'Sede', 'America/Manaus');
insert into public.people (id, tenant_id, full_name, status) values ('${T.ana}', '${T.tenant}', 'Ana E2E', 'active');
${asOwner}
select enrollment_token as tok from public.create_edge_agent('${T.site}', 'Agente E2E') \\gset
select public.set_biometric_settings('${T.tenant}', true, 'consent', 365, 'v1', 'dpo@e2e.test', 'ripd-1', current_date, current_date + 300);
select public.enroll_biometric_profile('${T.tenant}', '${T.ana}', 'mock', '${TEMPLATE_REF}', 'in_person', true, true, 'v1');
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

const profileRow = () =>
  psql(
    `select status || '|' || coalesce(template_ref, '') || '|' || (erasure_confirmed_at is not null)::text from public.biometric_profiles where tenant_id = '${T.tenant}' and person_id = '${T.ana}';`,
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
  await waitForGateway();
  const { agentId, secret } = setup();
  const transport = createHttpTransport({ baseUrl: GATEWAY, agentId, secret });
  const store = openStore();
  const provider = createMockBiometricProvider({ env: 'test' });
  const T0 = Date.now();
  const round = (offsetMs, biometricProvider = provider, t = transport) =>
    runOnce({
      store,
      transport: t,
      now: new Date(T0 + offsetMs),
      version: 'e2e',
      last: {},
      biometricProvider,
    });

  check('perfil cadastrado ativo, com referência', () =>
    assert.equal(profileRow(), `active|${TEMPLATE_REF}|false`),
  );

  const r1 = await round(0);
  check('sync traz o perfil ativo; nada a apagar', () => {
    assert.equal(r1.results.sync.status, 'updated');
    assert.deepEqual(r1.results.biometricErasure.erased, []);
    assert.deepEqual(provider.erased, []);
  });

  psql(`begin;
${asOwner}
select public.revoke_biometric('${T.tenant}', '${T.ana}');
commit;`);
  check('revogado: aguarda a eliminação pelo Edge', () =>
    assert.equal(profileRow(), `revoked|${TEMPLATE_REF}|false`),
  );

  // Provedor ausente: o perfil não pode ser dado como apagado.
  const r2 = await round(6 * 60_000, null);
  check('sem provedor: nada confirmado, perfil segue revoked', () => {
    assert.equal(r2.results.biometricErasure.failed.length, 1);
    assert.deepEqual(r2.results.biometricErasure.confirmed, []);
    assert.equal(profileRow(), `revoked|${TEMPLATE_REF}|false`);
  });

  // Rede caiu depois do snapshot: provedor apaga, confirmação falha, perfil continua na fila.
  const down = {
    ...transport,
    confirmBiometricErasure: async () => {
      throw new Error('ECONNREFUSED');
    },
  };
  const r3 = await round(12 * 60_000, provider, down);
  check('rede cai na confirmação: perfil segue revoked e na fila', () => {
    assert.equal(r3.results.biometricErasure.confirmed.length, 0);
    assert.equal(r3.results.biometricErasure.failed.length, 1);
    assert.equal(profileRow(), `revoked|${TEMPLATE_REF}|false`);
  });

  const r4 = await round(18 * 60_000);
  check('nova rodada: Edge apaga no provedor e a nuvem confirma', () => {
    assert.equal(r4.results.biometricErasure.confirmed.length, 1);
    assert.equal(r4.results.biometricErasure.failed.length, 0);
    assert.ok(provider.erased.includes(TEMPLATE_REF));
  });
  check('perfil erased, referência apagada, confirmação registrada', () =>
    assert.equal(profileRow(), 'erased||true'),
  );
  check('auditoria biometric.erased gravada uma vez', () =>
    assert.equal(
      psql(
        `select count(*) from public.audit_log where tenant_id = '${T.tenant}' and action = 'biometric.erased';`,
      ).trim(),
      '1',
    ),
  );

  const r5 = await round(24 * 60_000);
  check('depois do apagamento a fila fica vazia', () => {
    assert.equal(r5.results.sync.status, 'updated');
    assert.deepEqual(r5.results.biometricErasure.erased, []);
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
