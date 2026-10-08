// Backup e prova de restauracao do banco LOCAL do Zela Acesso (backlog de seguranca #3).
// Uso: node scripts/db-backup.mjs backup [arquivo]   -> pg_dump (formato custom) em backups/
//      node scripts/db-backup.mjs verify [arquivo]   -> restaura num banco descartavel e confere
// So opera no container *_zela-acesso-local; nunca toca o Zela Escola nem o banco `postgres`
// (a restauracao vai para o banco temporario `restore_check`, apagado no fim).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'zela-acesso-local';
const DB_CONTAINER = `supabase_db_${PROJECT}`;
const SCRATCH = 'restore_check';
const dir = join(root, 'backups');
const [cmd, fileArg] = process.argv.slice(2);

const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
if (/^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1] !== PROJECT) {
  console.error('RECUSADO: project_id diferente de zela-acesso-local.');
  process.exit(1);
}

const run = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });
const psql = (db, sql) =>
  run([
    'exec',
    DB_CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    db,
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    sql,
  ]);

const names = (run(['ps', '--format', '{{.Names}}']).stdout ?? '').split('\n');
if (!names.includes(DB_CONTAINER)) {
  console.error(`RECUSADO: container ${DB_CONTAINER} nao esta em execucao (supabase start).`);
  process.exit(1);
}

function latest() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.dump'));
  files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  if (!files.length) throw new Error('nenhum backup em backups/');
  return join(dir, files[0]);
}

// Contagens que precisam bater entre origem e restauracao.
const TABLES = [
  'public.tenants',
  'public.people',
  'public.access_events',
  'public.audit_log',
  'auth.users',
];
const countSql = TABLES.map((t) => `select '${t}', count(*) from ${t}`).join(' union all ');
// verify_access_chain exige papel service_role (lido de request.jwt.claims).
const chainSql = `select set_config('request.jwt.claims','{"role":"service_role"}',true);
  select t.id, (v).ok, (v).checked from (select id, public.verify_access_chain(id) as v from public.tenants) t`;

function backup() {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `zela-acesso-${stamp}.dump`);
  const inside = '/tmp/zela-backup.dump';
  const d = run([
    'exec',
    DB_CONTAINER,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-Fc',
    '--schema=public',
    '--schema=auth',
    '--schema=app_private',
    '-f',
    inside,
  ]);
  if (d.status !== 0) throw new Error(`pg_dump falhou: ${d.stderr}`);
  const cp = run(['cp', `${DB_CONTAINER}:${inside}`, file]);
  run(['exec', DB_CONTAINER, 'rm', '-f', inside]);
  if (cp.status !== 0) throw new Error(`docker cp falhou: ${cp.stderr}`);
  console.log(`Backup gerado: ${file} (${statSync(file).size} bytes)`);
  console.log(
    'Contem dados pessoais e hashes: guardar cifrado e fora do repositorio (backups/ ignorado).',
  );
  return file;
}

function verify() {
  const file = fileArg ? join(root, fileArg) : latest();
  const inside = '/tmp/zela-restore.dump';
  const cp = run(['cp', file, `${DB_CONTAINER}:${inside}`]);
  if (cp.status !== 0) throw new Error(`docker cp falhou: ${cp.stderr}`);
  try {
    psql('postgres', `drop database if exists ${SCRATCH}`);
    const c = psql('postgres', `create database ${SCRATCH} template template0`);
    if (c.status !== 0) throw new Error(c.stderr);
    // Roles/extensoes do Supabase nao existem no banco novo: sem owner/privilegios e com stub dos roles.
    psql(
      SCRATCH,
      `do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
         if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
       end loop; end $$`,
    );
    psql(
      SCRATCH,
      'create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;',
    );
    psql(SCRATCH, 'drop schema public cascade');
    const r = run([
      'exec',
      DB_CONTAINER,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      SCRATCH,
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      inside,
    ]);
    if (r.status !== 0) throw new Error(`pg_restore falhou: ${r.stderr.slice(0, 800)}`);

    const a = psql('postgres', countSql).stdout.trim().split('\n').sort();
    const b = psql(SCRATCH, countSql).stdout.trim().split('\n').sort();
    const sameCounts = JSON.stringify(a) === JSON.stringify(b);
    console.log('Contagens origem :', a.join(' | '));
    console.log('Contagens restore:', b.join(' | '));

    const chain = psql(SCRATCH, chainSql);
    if (chain.status !== 0) throw new Error(`verify_access_chain falhou: ${chain.stderr}`);
    const rows = chain.stdout
      .trim()
      .split('\n')
      .filter((l) => l.includes('|'));
    const broken = rows.filter((l) => l.split('|')[1] !== 't');
    console.log(
      `Cadeias de evidencia verificadas: ${rows.length} organizacao(oes), ${broken.length} quebrada(s).`,
    );

    if (!sameCounts || broken.length) {
      console.error('FALHA: restauracao nao confere com a origem.');
      process.exitCode = 1;
    } else {
      console.log('OK: restauracao confere (contagens iguais e cadeias de evidencia integras).');
    }
  } finally {
    psql('postgres', `drop database if exists ${SCRATCH}`);
    run(['exec', DB_CONTAINER, 'rm', '-f', inside]);
  }
}

try {
  if (cmd === 'backup') backup();
  else if (cmd === 'verify') verify();
  else {
    console.error('Uso: node scripts/db-backup.mjs <backup|verify> [arquivo]');
    process.exit(2);
  }
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
