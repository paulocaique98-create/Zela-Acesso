// Escreve apps/web/.env.local (gitignored) com APENAS valores publicos do Supabase local do Zela Acesso.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_API = 'http://127.0.0.1:55321';
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
if (env.API_URL !== LOCAL_API || !env.PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  console.error('RECUSADO: Supabase do Zela Acesso nao esta em execucao em ' + LOCAL_API);
  process.exit(1);
}
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', '.env.local');
writeFileSync(
  target,
  `VITE_SUPABASE_URL=${LOCAL_API}\nVITE_SUPABASE_PUBLISHABLE_KEY=${env.PUBLISHABLE_KEY}\n`,
);
console.log('apps/web/.env.local atualizado (somente chave publica).');
