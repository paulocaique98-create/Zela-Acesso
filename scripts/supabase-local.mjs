// Wrapper seguro para o Supabase local do Zela Acesso.
// Recusa operar se o project_id nao for "zela-acesso-local" e nunca usa --linked.
// Protege o Zela Escola (Projeto_Zela): nunca executa stop/reset sem confirmar o alvo.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = 'zela-acesso-local';
const cmd = process.argv[2];
const allowed = new Set(['start', 'status', 'reset', 'test', 'stop']);

if (!allowed.has(cmd)) {
  console.error(`Uso: node scripts/supabase-local.mjs <${[...allowed].join('|')}>`);
  process.exit(2);
}

const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (projectId !== EXPECTED) {
  console.error(`RECUSADO: project_id="${projectId}" (esperado "${EXPECTED}").`);
  process.exit(1);
}

const args = {
  start: ['start', '-x', 'imgproxy,edge-runtime'],
  status: ['status'],
  reset: ['db', 'reset', '--local'],
  test: ['test', 'db', '--local'],
  stop: ['stop', '--project-id', EXPECTED],
}[cmd];

// Confirma que o alvo local e o do Zela Acesso antes de qualquer comando que altera estado.
if (cmd === 'reset' || cmd === 'stop') {
  const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  const names = (ps.stdout ?? '').split('\n').filter(Boolean);
  if (!names.some((n) => n.endsWith(`_${EXPECTED}`))) {
    console.error(`RECUSADO: nenhum container *_${EXPECTED} em execucao. Nada a fazer.`);
    process.exit(1);
  }
  console.log(`Alvo confirmado: containers *_${EXPECTED}. Zela Escola nao sera tocado.`);
}

const r = spawnSync('supabase', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
