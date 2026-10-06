-- Fase 2D: politicas de acesso (grupo -> zona/ponto). RLS, cross-tenant, FK composta, escopo por local,
-- constraints, RESTRICT, matriz de papeis, privilegios por coluna e auditoria. Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function tests.login(uuid) to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-security@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a8', 'a-security-filial@example.test'),
  ('00000000-0000-0000-0000-0000000000aa', 'a-installer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');

insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');

insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Alfa Sede'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Alfa Filial'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Beta Sede');

insert into public.memberships (tenant_id, user_id, role, scope_site_ids) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'security_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'receptionist', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'viewer', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a6', 'hr_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'auditor', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a8', 'security_manager',
   array['20000000-0000-0000-0000-0000000000a2']::uuid[]),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'installer', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);

insert into public.zones (id, tenant_id, site_id, name) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Portaria'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Recepção Filial'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Portaria Beta');
insert into public.access_schedules (id, tenant_id, name) values
  ('70000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Comercial Alfa'),
  ('70000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Comercial Beta');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
   '40000000-0000-0000-0000-0000000000a1', 'Porta principal'),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   '40000000-0000-0000-0000-0000000000a2', 'Porta filial'),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
   '40000000-0000-0000-0000-0000000000b1', 'Porta Beta');
insert into public.access_groups (id, tenant_id, name) values
  ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Funcionários'),
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Funcionários Beta');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id) values
  ('80000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
   'Func na portaria', '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1'),
  ('80000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
   'Func Beta', '60000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, access_point_id, effect) values
  ('80000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   'Bloqueio filial', '60000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a2', 'deny');

-- ---------------------------------------------------------------- padroes e constraints
select is((select effect::text || require_challenge::text || status::text from public.access_policies
  where id = '80000000-0000-0000-0000-0000000000a1'), 'allowfalseactive', 'padrao: allow, sem desafio, ativa');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Sem alvo',
            '60000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'exige alvo (zona ou ponto)');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id, access_point_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Dois alvos',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
            '50000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'nao aceita zona e ponto juntos');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id, effect, require_challenge)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Negar com desafio',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'deny', true)$$,
  '23514', null, 'negar nao pode exigir desafio');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Func na portaria',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$$,
  '23505', null, 'nome unico por local');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Zona de outro local',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a2')$$,
  '23503', null, 'FK composta: zona de outro local do mesmo tenant');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, access_point_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Ponto de outro local',
            '60000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a2')$$,
  '23503', null, 'FK composta: ponto de outro local do mesmo tenant');
select throws_ok($$delete from public.access_groups where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'grupo com politica nao e apagado (RESTRICT)');
select throws_ok($$delete from public.zones where id = '40000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'zona com politica nao e apagada (RESTRICT)');
select throws_ok($$delete from public.access_points where id = '50000000-0000-0000-0000-0000000000a2'$$,
  '23503', null, 'ponto com politica nao e apagado (RESTRICT)');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select id from public.access_policies$$, '42501', null, 'anon nao le politicas');
reset role;

-- ---------------------------------------------------------------- isolamento (owner B)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.access_policies), 1, 'owner B ve so politicas do B');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Invasao',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'owner B nao cria politica no A');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Grupo cruzado',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1')$$,
  '23503', null, 'FK composta: politica do B nao usa grupo do A');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Zona cruzada',
            '60000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'FK composta: politica do B nao usa zona do A');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id, schedule_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Janela cruzada',
            '60000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1',
            '70000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'FK composta: politica do B nao usa janela do A');
with u as (update public.access_policies set name = 'Hack' where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera politicas do A');
with d as (delete from public.access_policies where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga politicas do A');
reset role;
select is((select count(*)::int from public.access_policies where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2,
  'politicas do A intactas');

-- ---------------------------------------------------------------- matriz de papeis
select tests.login('00000000-0000-0000-0000-0000000000a3');  -- gestor: le/cria/edita, nao apaga
select is((select count(*)::int from public.access_policies), 2, 'gestor le politicas');
select lives_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id, require_challenge)
    values ('10000000-0000-0000-0000-00000000000a',
            '20000000-0000-0000-0000-0000000000a1', 'Visitantes com desafio',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', true)$$,
  'gestor cria politica');
select lives_ok($$update public.access_policies set status = 'inactive' where name = 'Visitantes com desafio'$$,
  'gestor edita politica');
with d as (delete from public.access_policies where name = 'Visitantes com desafio' returning 1)
select is((select count(*)::int from d), 0, 'gestor nao apaga politica');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a7');  -- auditor: so le
select is((select count(*)::int from public.access_policies), 3, 'auditor le politicas');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Auditor cria',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'auditor nao cria politica');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4');  -- recepcao
select is((select count(*)::int from public.access_policies), 0, 'recepcao nao ve politicas');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000aa');  -- instalador
select is((select count(*)::int from public.access_policies), 0, 'instalador nao ve politicas');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a5');  -- visualizador
select is((select count(*)::int from public.access_policies), 0, 'visualizador nao ve politicas');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a6');  -- RH
select is((select count(*)::int from public.access_policies), 0, 'RH nao ve politicas');
reset role;

-- ---------------------------------------------------------------- escopo por local
select tests.login('00000000-0000-0000-0000-0000000000a8');  -- gestor so da Filial
select is((select count(*)::int from public.access_policies), 1, 'gestor da filial ve so politicas da filial');
select throws_ok(
  $$insert into public.access_policies (tenant_id, site_id, name, group_id, zone_id)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Fora do escopo',
            '60000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'gestor da filial nao cria politica na sede');
reset role;

-- ---------------------------------------------------------------- owner: privilegios por coluna e exclusao
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$update public.access_policies set site_id = '20000000-0000-0000-0000-0000000000a2'
  where id = '80000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'site_id nao e atualizavel');
select throws_ok($$update public.access_policies set tenant_id = '10000000-0000-0000-0000-00000000000b'
  where id = '80000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'tenant_id nao e atualizavel');
select lives_ok($$delete from public.access_policies where name = 'Visitantes com desafio'$$,
  'owner apaga politica');
reset role;

-- ---------------------------------------------------------------- auditoria
select cmp_ok((select count(*)::int from public.audit_log
  where tenant_id = '10000000-0000-0000-0000-00000000000a' and resource_type = 'access_policies'), '>=', 3,
  'politicas geram auditoria');
select is((select count(*)::int from public.audit_log
  where tenant_id = '10000000-0000-0000-0000-00000000000a' and resource_type = 'access_policies'
  and metadata ? 'description'), 0, 'auditoria nao carrega a descricao');

select * from finish();
rollback;
