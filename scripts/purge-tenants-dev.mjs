// Apaga organizacoes (e tudo que depende delas) do Supabase LOCAL do Zela Acesso. So desenvolvimento.
//   node scripts/purge-tenants-dev.mjs --keep ZA122 [--keep ZA130] [--apply]   (apaga todas, exceto as listadas)
//   node scripts/purge-tenants-dev.mjs --e2e [--apply]                           (apaga so as de teste: slug e2e-*)
// Sem --apply so mostra o que seria apagado (dry-run). Recusa se o alvo nao for *_zela-acesso-local.
// audit_log e append-only e as FKs sao RESTRICT; por isso o delete roda com session_replication_role=replica,
// numa transacao, e SO neste banco descartavel. Usuarios apagados: os que so pertenciam as organizacoes apagadas
// (platform_admins e o usuario fixo responsavel.teste, usado pelos testes E2E, sao preservados).
import { spawnSync } from 'node:child_process';

const EXPECTED = 'zela-acesso-local';
const DB = `supabase_db_${EXPECTED}`;
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const e2e = argv.includes('--e2e');
const keep = argv.flatMap((a, i) => (a === '--keep' ? [argv[i + 1]] : []));
if (!e2e && (!keep.length || keep.some((c) => !/^ZA\d{3,}$/.test(c ?? '')))) {
  console.error('Uso: --keep ZA122 [--keep ...] [--apply]  ou  --e2e [--apply]');
  process.exit(1);
}

const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
if (!(ps.stdout ?? '').split('\n').includes(DB)) {
  console.error(`RECUSADO: container ${DB} nao esta em execucao.`);
  process.exit(1);
}

const keepList = keep.map((c) => `'${c}'`).join(',');
const target = e2e ? `slug like 'e2e-%'` : `org_code not in (${keepList})`;
const sql = `
begin;
set local session_replication_role = replica;
create temp table _del_t on commit drop as select id from public.tenants where ${target};
create temp table _del_u on commit drop as
  select u.id, u.email from auth.users u
  where u.id not in (select user_id from public.platform_admins)
    and u.email <> 'responsavel.teste@example.test'
    and exists (select 1 from public.memberships m where m.user_id = u.id and m.tenant_id in (select id from _del_t))
    and not exists (select 1 from public.memberships m where m.user_id = u.id and m.tenant_id not in (select id from _del_t));
select 'organizacoes a apagar' as item, count(*) from _del_t
union all select 'usuarios a apagar', count(*) from _del_u;
-- edge_rate_hits nao tem tenant_id (liga ao agente); com replica role o ON DELETE CASCADE nao dispara.
delete from public.edge_rate_hits where agent_id in (select id from public.edge_agents where tenant_id in (select id from _del_t));
do $$
declare r record; n bigint;
begin
  for r in select c.table_name from information_schema.columns c
           join information_schema.tables t using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenants'
             and t.table_type = 'BASE TABLE' order by 1 loop
    execute format('delete from public.%I where tenant_id in (select id from _del_t)', r.table_name);
    get diagnostics n = row_count;
    raise notice '% : % linhas', r.table_name, n;
  end loop;
  delete from public.tenants where id in (select id from _del_t);
  -- Gatilhos de volta: os ON DELETE CASCADE de auth.users (identidades, sessoes, perfil, flags) precisam disparar.
  set local session_replication_role = origin;
  delete from auth.users where id in (select id from _del_u);
end $$;
select 'organizacoes restantes' as item, count(*) from public.tenants;
${apply ? 'commit;' : 'rollback;'}
`;

const r = spawnSync(
  'docker',
  ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);
console.log(apply ? 'APLICADO.' : 'DRY-RUN (nada foi apagado). Use --apply para confirmar.');
process.exit(r.status ?? 1);
