// Compara a matriz RBAC do dominio (TS) com public.role_permissions do banco local.
// Le somente do container do Zela Acesso. Falha (exit 1) se houver divergencia.
import { spawnSync } from 'node:child_process';
import { ROLE_PERMISSIONS } from '../packages/domain/src/rbac.js';

const CONTAINER = 'supabase_db_zela-acesso-local';

const r = spawnSync(
  'docker',
  [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-t',
    '-A',
    '-c',
    "select role || '|' || permission from public.role_permissions order by 1",
  ],
  { encoding: 'utf8' },
);
if (r.status !== 0) {
  console.error(`Nao foi possivel consultar ${CONTAINER}: ${r.stderr || r.error}`);
  process.exit(2);
}

const db = new Set(
  r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
);
const ts = new Set(
  Object.entries(ROLE_PERMISSIONS).flatMap(([role, perms]) => perms.map((p) => `${role}|${p}`)),
);

const onlyDb = [...db].filter((x) => !ts.has(x));
const onlyTs = [...ts].filter((x) => !db.has(x));
if (onlyDb.length || onlyTs.length) {
  console.error('DRIFT RBAC detectado');
  if (onlyDb.length) console.error('  so no banco:', onlyDb.join(', '));
  if (onlyTs.length) console.error('  so no dominio:', onlyTs.join(', '));
  process.exit(1);
}
console.log(`RBAC sem drift: ${db.size} permissoes identicas (banco x dominio).`);
