// Liga a política biométrica da organização de EXEMPLO "Condomínio Alfa (exemplo)" no banco LOCAL de desenvolvimento.
// Usa o próprio RPC do produto (set_biometric_settings) como o proprietário de exemplo, sem atalho no banco.
// Todos os valores são fictícios e marcados como exemplo: NÃO são base legal, aviso, encarregado nem RIPD reais.
// Uma organização real preenche a política no painel (Biometria > Configurar política); ver docs/27-FACE-DESENHO-OPERACAO.md §6.
// Idempotente. Recusa qualquer URL que não seja o Supabase local do Zela Acesso (127.0.0.1:55321).
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const LOCAL_API = 'http://127.0.0.1:55321';
const DEV_PASSWORD = 'Zela-Dev-Local-1234'; // sintética, só existe no banco local descartável (ver seed-dev.mjs)

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
if (env.API_URL !== LOCAL_API || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
  console.error(
    `RECUSADO: API_URL=${env.API_URL ?? 'indefinida'} (esperado ${LOCAL_API}). Suba o Supabase do Zela Acesso.`,
  );
  process.exit(1);
}

const admin = createClient(LOCAL_API, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: tenant, error: te } = await admin
  .from('tenants')
  .select('id, name')
  .eq('name', 'Condomínio Alfa (exemplo)')
  .maybeSingle();
if (te || !tenant) {
  console.error('Organização de exemplo não encontrada: rode `pnpm db:seed` antes.');
  process.exit(1);
}

const owner = createClient(LOCAL_API, env.ANON_KEY, { auth: { persistSession: false } });
const { error: le } = await owner.auth.signInWithPassword({
  email: 'alfa.dono@example.test',
  password: DEV_PASSWORD,
});
if (le) {
  console.error('Não foi possível entrar como o proprietário de exemplo:', le.message);
  process.exit(1);
}

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const { error } = await owner.rpc('set_biometric_settings', {
  p_tenant: tenant.id,
  p_enabled: true,
  p_legal_basis: 'consent',
  p_retention_days: 365,
  p_notice_version: 'aviso-exemplo-v1',
  p_dpo_contact: 'encarregado.exemplo@example.test',
  p_ripd_version: 'ripd-exemplo-v1',
  p_ripd_reviewed_at: day(0),
  p_ripd_next_review_at: day(364),
  p_threshold: 0.85,
  p_require_liveness: true,
});
if (error) {
  console.error('Falha ao configurar a política:', error.message);
  process.exit(1);
}
console.error(
  `Política biométrica de EXEMPLO ligada em "${tenant.name}" (consentimento, 365 dias, limiar 0,85, liveness exigida).`,
);
