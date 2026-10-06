// Cria (ou atualiza) um administrador da plataforma no Supabase LOCAL (zela-acesso-local).
// A senha vem SOMENTE por variavel de ambiente (nunca em arquivo, argumento ou log):
//   PLATFORM_EMAIL=seu@email PLATFORM_PASSWORD='...' [PLATFORM_ROLE=platform_owner] node scripts/create-platform-admin.mjs
// Recusa qualquer API que nao seja a local do Zela Acesso.
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const LOCAL_API = 'http://127.0.0.1:55321';
const email = process.env.PLATFORM_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_PASSWORD;
const role = process.env.PLATFORM_ROLE ?? 'platform_owner';

if (!email || !password) {
  console.error('Defina PLATFORM_EMAIL e PLATFORM_PASSWORD (variaveis de ambiente).');
  process.exit(2);
}
if (!['platform_owner', 'platform_support'].includes(role)) {
  console.error('PLATFORM_ROLE deve ser platform_owner ou platform_support.');
  process.exit(2);
}
if (password.length < 12) {
  console.error('Use uma senha de pelo menos 12 caracteres.');
  process.exit(2);
}

const st = spawnSync('supabase', ['status', '-o', 'env'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const env = Object.fromEntries(
  (st.stdout ?? '')
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
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = list?.users.find((u) => u.email === email);
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) throw error;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Plataforma' },
  });
  if (error) throw error;
  user = data.user;
}
const { error } = await admin.from('platform_admins').upsert({ user_id: user.id, role });
if (error) throw error;
console.log(`OK: ${email} agora e ${role} no Supabase local.`);
