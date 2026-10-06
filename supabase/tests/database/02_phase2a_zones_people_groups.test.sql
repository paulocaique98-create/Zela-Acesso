-- Fase 2A: zonas, pessoas, grupos. RLS, isolamento cross-tenant, escopo por site, auditoria sem dado pessoal.
-- Dados 100% sinteticos. Tudo roda em transacao e e revertido no final.
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

-- ---------------------------------------------------------------- fixtures (como postgres)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-security@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'a-scoped@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a9', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000aa', 'a-installer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@example.test');

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
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a6', 'security_manager',
     array['20000000-0000-0000-0000-0000000000a1']::uuid[]),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'auditor', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a9', 'hr_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'installer', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);

insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Recepcao'),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Deposito'),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Beta Lobby');

insert into public.people (id, tenant_id, full_name, external_ref) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Um', 'MAT-1'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Dois', null),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa Beta Um', 'MAT-1');

insert into public.access_groups (id, tenant_id, name) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Grupo Alfa'),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Grupo Beta');

-- ---------------------------------------------------------------- anon e sem membership: nada
set local role anon;
select throws_ok($$select id from public.zones$$, '42501', null, 'anon nao le zones');
select throws_ok($$select id from public.people$$, '42501', null, 'anon nao le people');
select throws_ok($$select id from public.access_groups$$, '42501', null, 'anon nao le grupos');
select throws_ok($$select group_id from public.access_group_members$$, '42501', null, 'anon nao le membros');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.zones), 0, 'sem membership: nenhuma zona');
select is((select count(*)::int from public.people), 0, 'sem membership: nenhuma pessoa');
select is((select count(*)::int from public.access_groups), 0, 'sem membership: nenhum grupo');
reset role;

-- ---------------------------------------------------------------- isolamento cross-tenant (owner B)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.zones), 1, 'owner B ve so zonas do B');
select is((select count(*)::int from public.people), 1, 'owner B ve so pessoas do B');
select is((select count(*)::int from public.access_groups), 1, 'owner B ve so grupos do B');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Invasao')$$,
  '42501', null, 'owner B nao cria zona no A');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a1', 'Cruzada')$$,
  '23503', null, 'FK composta: zona do B nao aponta para site do A');
select throws_ok(
  $$insert into public.people (tenant_id, full_name) values ('10000000-0000-0000-0000-00000000000a', 'Invasor')$$,
  '42501', null, 'owner B nao cria pessoa no A');
select throws_ok(
  $$insert into public.access_group_members (tenant_id, group_id, person_id)
    values ('10000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1',
            '40000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'FK composta: pessoa do A nao entra em grupo do B');
select throws_ok(
  $$insert into public.access_group_members (tenant_id, group_id, person_id)
    values ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'owner B nao gerencia membros do grupo do A');
with u as (update public.people set full_name = 'Hackeado'
  where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera pessoas do A');
with d as (delete from public.zones where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga zonas do A');
with d as (delete from public.access_groups where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga grupos do A');
reset role;
select is((select count(*)::int from public.people where full_name = 'Hackeado'), 0, 'nenhuma pessoa do A alterada');
select is((select count(*)::int from public.zones where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2, 'zonas do A intactas');

-- mesmo external_ref em tenants distintos e permitido; duplicado no mesmo tenant nao
select lives_ok(
  $$insert into public.people (tenant_id, full_name, external_ref)
    values ('10000000-0000-0000-0000-00000000000b', 'Outro Beta', 'MAT-2')$$,
  'external_ref novo no B ok (MAT-1 existe tambem no A)');
select throws_ok(
  $$insert into public.people (tenant_id, full_name, external_ref)
    values ('10000000-0000-0000-0000-00000000000a', 'Duplicada', 'MAT-1')$$,
  '23505', null, 'external_ref unico por tenant');

-- ---------------------------------------------------------------- matriz de papeis (tenant A)
-- viewer: so zonas
select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.zones), 2, 'viewer le zonas');
select is((select count(*)::int from public.people), 0, 'viewer nao le pessoas');
select is((select count(*)::int from public.access_groups), 0, 'viewer nao le grupos');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'X')$$,
  '42501', null, 'viewer nao cria zona');
reset role;

-- receptionist: le zonas/grupos, cria/edita pessoas, nao apaga, nao gerencia grupos
select tests.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.people), 2, 'receptionist le pessoas');
select lives_ok(
  $$insert into public.people (tenant_id, full_name) values ('10000000-0000-0000-0000-00000000000a', 'Cadastro Recepcao')$$,
  'receptionist cria pessoa');
select lives_ok(
  $$update public.people set status = 'inactive' where id = '40000000-0000-0000-0000-0000000000a2'$$,
  'receptionist edita pessoa');
with d as (delete from public.people where id = '40000000-0000-0000-0000-0000000000a2' returning 1)
select is((select count(*)::int from d), 0, 'receptionist nao apaga pessoa');
select throws_ok(
  $$insert into public.access_groups (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'G')$$,
  '42501', null, 'receptionist nao cria grupo');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'X')$$,
  '42501', null, 'receptionist nao cria zona');
reset role;

-- hr_manager: apaga pessoa; nao cria zona
select tests.login('00000000-0000-0000-0000-0000000000a9');
with d as (delete from public.people where full_name = 'Cadastro Recepcao' returning 1)
select is((select count(*)::int from d), 1, 'hr_manager apaga pessoa');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'X')$$,
  '42501', null, 'hr_manager nao cria zona');
reset role;

-- auditor: so leitura
select tests.login('00000000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from public.people), 2, 'auditor le pessoas');
select is((select count(*)::int from public.access_groups), 1, 'auditor le grupos');
select throws_ok(
  $$insert into public.people (tenant_id, full_name) values ('10000000-0000-0000-0000-00000000000a', 'Aud')$$,
  '42501', null, 'auditor nao cria pessoa');
with u as (update public.zones set name = 'Z' where id = '30000000-0000-0000-0000-0000000000a1' returning 1)
select is((select count(*)::int from u), 0, 'auditor nao altera zona');
reset role;

-- installer: zonas sim, pessoas nao, sem delete
select tests.login('00000000-0000-0000-0000-0000000000aa');
select lives_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Doca')$$,
  'installer cria zona');
select is((select count(*)::int from public.people), 0, 'installer nao le pessoas');
with d as (delete from public.zones where name = 'Doca' returning 1)
select is((select count(*)::int from d), 0, 'installer nao apaga zona');
reset role;

-- security_manager com escopo restrito ao site a1: zonas so do site; pessoas/grupos (nivel tenant) negados
select tests.login('00000000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from public.zones), 1, 'escopo por site: ve so a zona do site a1');
select lives_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Sala 1')$$,
  'escopo por site: cria zona no site permitido');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Sala 2')$$,
  '42501', null, 'escopo por site: nao cria zona em outro site');
select is((select count(*)::int from public.people), 0, 'escopo por site: nao le pessoas (nivel tenant)');
reset role;

-- security_manager tenant-inteiro: grupos e membros
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$insert into public.access_group_members (tenant_id, group_id, person_id)
    values ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1')$$,
  'security_manager adiciona membro ao grupo');
select throws_ok(
  $$insert into public.access_group_members (tenant_id, group_id, person_id)
    values ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1')$$,
  '23505', null, 'membro duplicado rejeitado');
with d as (delete from public.access_groups where id = '50000000-0000-0000-0000-0000000000a1' returning 1)
select is((select count(*)::int from d), 0, 'security_manager nao apaga grupo');
reset role;

-- ---------------------------------------------------------------- privilegios por coluna
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$update public.zones set site_id = '20000000-0000-0000-0000-0000000000a2'
    where id = '30000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner nao move zona entre sites');
select throws_ok(
  $$update public.zones set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where id = '30000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner nao move zona entre tenants');
select throws_ok(
  $$update public.people set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where id = '40000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner nao move pessoa entre tenants');
select throws_ok(
  $$update public.access_groups set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where id = '50000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner nao move grupo entre tenants');
select throws_ok(
  $$update public.access_group_members set person_id = '40000000-0000-0000-0000-0000000000a2'$$,
  '42501', null, 'membro de grupo nao e atualizavel');
select lives_ok(
  $$update public.people set kind = 'contractor', age_category = 'minor'
    where id = '40000000-0000-0000-0000-0000000000a1'$$,
  'owner edita pessoa');
select throws_ok(
  $$insert into public.people (tenant_id, full_name, kind)
    values ('10000000-0000-0000-0000-00000000000a', 'X', 'visitor')$$,
  '22P02', null, 'enum de tipo rejeita valor invalido');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Recepcao')$$,
  '23505', null, 'nome de zona unico por site');
reset role;

-- ---------------------------------------------------------------- auditoria
select is((select count(*)::int from public.audit_log
  where resource_type = 'people' and action = 'people.insert'
    and tenant_id = '10000000-0000-0000-0000-00000000000a'), 3,
  'auditoria registra criacao de pessoas (3 inserts no A: 2 fixtures + recepcao)');
select is((select count(*)::int from public.audit_log
  where resource_type = 'people' and metadata::text like '%Pessoa Alfa%'), 0,
  'audit_log nao contem nome de pessoa');
select is((select count(*)::int from public.audit_log
  where resource_type = 'people' and metadata::text like '%MAT-1%'), 0,
  'audit_log nao contem external_ref');
select is((select count(*)::int from public.audit_log
  where action = 'access_group_members.insert'
    and tenant_id = '10000000-0000-0000-0000-00000000000a'), 1, 'auditoria registra membro adicionado ao grupo');
select is((select count(*)::int from public.audit_log
  where action = 'zones.insert' and metadata ? 'site_id'
    and tenant_id = '10000000-0000-0000-0000-00000000000a'), 4,
  'auditoria registra criacao de zonas do A (2 fixtures + Doca + Sala 1)');

select * from finish();
rollback;
