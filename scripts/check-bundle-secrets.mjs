// Falha se o bundle de producao contiver qualquer indicio de chave privilegiada ou segredo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DISTS = ['web', 'reader'].map((app) => join(process.cwd(), 'apps', app, 'dist'));
const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'chave sb_secret_'],
  [/service_role/, 'referencia a service_role'],
  [/SERVICE_ROLE_KEY/, 'nome de variavel SERVICE_ROLE_KEY'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada PEM'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/, 'JWT com role service_role'],
];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let files = [];
for (const dist of DISTS) {
  try {
    files = files.concat(walk(dist));
  } catch {
    console.error(`dist nao encontrado em ${dist}. Rode "pnpm build" antes.`);
    process.exit(2);
  }
}

const hits = [];
for (const f of files.filter((x) => /\.(js|css|html|map|json)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${label}`);
}
if (hits.length) {
  console.error('SEGREDO POSSIVEL NO BUNDLE:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`Bundle limpo: ${files.length} arquivos verificados, nenhum padrao de segredo.`);
