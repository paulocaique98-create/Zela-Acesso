// Seed 100% sintetico para desenvolvimento local. Idempotente.
// Usa a API de admin do Supabase LOCAL (zela-acesso-local). Recusa qualquer URL que nao seja 127.0.0.1:55321.
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const LOCAL_API = 'http://127.0.0.1:55321';
export const DEV_PASSWORD = 'Zela-Dev-Local-1234'; // sintetica, so existe no banco local descartavel

const st = spawnSync('supabase', ['status', '-o', 'env'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const env = Object.fromEntries(
  st.stdout
    .split('\n')
    .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
if (env.API_URL !== LOCAL_API || !env.SERVICE_ROLE_KEY) {
  console.error(
    `RECUSADO: API_URL=${env.API_URL ?? 'indefinida'} (esperado ${LOCAL_API}). Suba o Supabase do Zela Acesso.`,
  );
  process.exit(1);
}

const admin = createClient(LOCAL_API, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const USERS = [
  ['plataforma.dono@example.test', 'Plataforma Dono'],
  ['plataforma.suporte@example.test', 'Plataforma Suporte'],
  ['alfa.dono@example.test', 'Ana Alfa (Proprietária)'],
  ['alfa.admin@example.test', 'Bruno Alfa (Admin)'],
  ['alfa.seguranca@example.test', 'Carla Alfa (Segurança)'],
  ['alfa.recepcao@example.test', 'Davi Alfa (Recepção)'],
  ['alfa.visualizador@example.test', 'Elisa Alfa (Visualizadora)'],
  ['alfa.sede@example.test', 'Fabio Alfa (Somente Sede)'],
  ['beta.dono@example.test', 'Gabi Beta (Proprietária)'],
];

async function ensureUser(email, displayName) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list?.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  return data.user.id;
}

const ids = {};
for (const [email, name] of USERS) ids[email] = await ensureUser(email, name);

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

await admin.from('platform_admins').upsert([
  { user_id: ids['plataforma.dono@example.test'], role: 'platform_owner' },
  { user_id: ids['plataforma.suporte@example.test'], role: 'platform_support' },
]);

async function ensureTenant(slug, name, ownerEmail) {
  const existing = must(
    await admin.from('tenants').select('id').eq('slug', slug).maybeSingle(),
    'tenant',
  );
  if (existing) return existing.id;
  const t = must(
    await admin.from('tenants').insert({ slug, name }).select('id').single(),
    'insert tenant',
  );
  must(
    await admin
      .from('memberships')
      .insert({ tenant_id: t.id, user_id: ids[ownerEmail], role: 'organization_owner' }),
    'owner',
  );
  return t.id;
}

const alfa = await ensureTenant(
  'alfa-exemplo',
  'Condomínio Alfa (exemplo)',
  'alfa.dono@example.test',
);
const beta = await ensureTenant('beta-exemplo', 'Empresa Beta (exemplo)', 'beta.dono@example.test');

async function ensureSite(tenantId, name) {
  const found = must(
    await admin.from('sites').select('id').eq('tenant_id', tenantId).eq('name', name).maybeSingle(),
    'site',
  );
  if (found) return found.id;
  return must(
    await admin.from('sites').insert({ tenant_id: tenantId, name }).select('id').single(),
    'insert site',
  ).id;
}
const alfaSede = await ensureSite(alfa, 'Alfa - Sede');
await ensureSite(alfa, 'Alfa - Garagem');
await ensureSite(beta, 'Beta - Matriz');

async function ensureMember(tenantId, email, role, scope = null) {
  const found = must(
    await admin
      .from('memberships')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', ids[email])
      .maybeSingle(),
    'membership',
  );
  if (found) return;
  must(
    await admin
      .from('memberships')
      .insert({ tenant_id: tenantId, user_id: ids[email], role, scope_site_ids: scope }),
    'insert membership',
  );
}
await ensureMember(alfa, 'alfa.admin@example.test', 'organization_admin');
await ensureMember(alfa, 'alfa.seguranca@example.test', 'security_manager');
await ensureMember(alfa, 'alfa.recepcao@example.test', 'receptionist');
await ensureMember(alfa, 'alfa.visualizador@example.test', 'viewer');
await ensureMember(alfa, 'alfa.sede@example.test', 'viewer', [alfaSede]);

console.log(
  `Seed concluido: 2 tenants, ${USERS.length} usuarios sinteticos. Senha dev (local): ${DEV_PASSWORD}`,
);
