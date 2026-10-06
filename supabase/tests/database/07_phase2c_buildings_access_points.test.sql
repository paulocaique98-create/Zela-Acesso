-- Fase 2C: predios, andares (opcionais) e pontos de acesso. RLS, isolamento cross-tenant, FK composta
-- (tenant/local/predio/andar), escopo por local, constraints, matriz de papeis, privilegios por coluna e auditoria.
-- Dados sinteticos; tudo e revertido.
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

insert into public.buildings (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Bloco A'),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Bloco Filial'),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'Bloco Beta');
insert into public.floors (id, tenant_id, site_id, building_id, name, level) values
  ('31000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
   '30000000-0000-0000-0000-0000000000a1', 'Térreo', 0),
  ('31000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
   '30000000-0000-0000-0000-0000000000b1', 'Térreo', 0);
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

-- ---------------------------------------------------------------- padroes seguros
select is((select emergency_behavior::text from public.access_points where id = '50000000-0000-0000-0000-0000000000a1'),
  'fail_safe', 'padrao de emergencia: fail_safe');
select is((select offline_behavior::text from public.access_points where id = '50000000-0000-0000-0000-0000000000a1'),
  'degraded_deny', 'padrao offline: degraded_deny');
select is((select door_open_timeout_seconds from public.access_points where id = '50000000-0000-0000-0000-0000000000a1'),
  30, 'timeout de porta aberta padrao 30 s');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select id from public.access_points$$, '42501', null, 'anon nao le pontos');
select throws_ok($$select id from public.buildings$$, '42501', null, 'anon nao le predios');
select throws_ok($$select id from public.floors$$, '42501', null, 'anon nao le andares');
reset role;

-- ---------------------------------------------------------------- isolamento (owner B)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.access_points), 1, 'owner B ve so pontos do B');
select is((select count(*)::int from public.buildings), 1, 'owner B ve so predios do B');
select is((select count(*)::int from public.floors), 1, 'owner B ve so andares do B');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Invasao')$$,
  '42501', null, 'owner B nao cria ponto no A');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
            '40000000-0000-0000-0000-0000000000a1', 'Zona cruzada')$$,
  '23503', null, 'FK composta: ponto do B nao usa zona do A');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, schedule_id)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
            '40000000-0000-0000-0000-0000000000b1', 'Janela cruzada', '70000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'FK composta: ponto do B nao usa janela do A');
select throws_ok(
  $$insert into public.buildings (tenant_id, site_id, name)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a1', 'Cruzado')$$,
  '23503', null, 'owner B nao cria predio em local do A (FK composta)');
select throws_ok(
  $$insert into public.floors (tenant_id, site_id, building_id, name)
    values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
            '30000000-0000-0000-0000-0000000000a1', 'Andar cruzado')$$,
  '23503', null, 'FK composta: andar do B nao entra em predio do A');
with u as (update public.access_points set name = 'Hack' where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera pontos do A');
with d as (delete from public.access_points where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga pontos do A');
with d as (delete from public.buildings where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga predios do A');
reset role;
select is((select count(*)::int from public.access_points where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  2, 'pontos do A intactos');

-- ---------------------------------------------------------------- owner A: hierarquia opcional
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$insert into public.zones (tenant_id, site_id, name) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Zona sem predio')$$,
  'zona continua valida sem predio nem andar');
select lives_ok(
  $$insert into public.zones (tenant_id, site_id, name, building_id, floor_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Zona no terreo',
     '30000000-0000-0000-0000-0000000000a1', '31000000-0000-0000-0000-0000000000a1')$$,
  'zona com predio e andar');
select lives_ok(
  $$insert into public.zones (tenant_id, site_id, name, building_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Zona so predio',
     '30000000-0000-0000-0000-0000000000a1')$$,
  'zona so com predio');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name, floor_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Andar sem predio',
     '31000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'andar exige predio');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name, building_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Predio de outro local',
     '30000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'zona nao usa predio de outro local do mesmo tenant');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name, building_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Predio do Beta',
     '30000000-0000-0000-0000-0000000000b1')$$,
  '23503', null, 'zona nao usa predio de outro tenant');
select throws_ok(
  $$insert into public.zones (tenant_id, site_id, name, building_id, floor_id) values
    ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Andar de outro predio',
     '30000000-0000-0000-0000-0000000000a2', '31000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'andar precisa pertencer ao predio informado');
select lives_ok(
  $$update public.zones set building_id = '30000000-0000-0000-0000-0000000000a1'
    where id = '40000000-0000-0000-0000-0000000000a1'$$,
  'owner associa zona existente a um predio');
select lives_ok(
  $$insert into public.floors (tenant_id, site_id, building_id, name, level)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '30000000-0000-0000-0000-0000000000a1', 'Subsolo', -1)$$,
  'owner cria andar (nivel negativo)');
select throws_ok(
  $$insert into public.floors (tenant_id, site_id, building_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '30000000-0000-0000-0000-0000000000a1', 'Subsolo')$$,
  '23505', null, 'nome de andar unico por predio');
select throws_ok(
  $$insert into public.floors (tenant_id, site_id, building_id, name, level)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '30000000-0000-0000-0000-0000000000a1', 'Torre', 500)$$,
  '23514', null, 'nivel fora da faixa recusado');
select throws_ok(
  $$insert into public.floors (tenant_id, site_id, building_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
            '30000000-0000-0000-0000-0000000000a1', 'Local trocado')$$,
  '23503', null, 'andar nao declara local diferente do predio');
select throws_ok(
  $$delete from public.buildings where id = '30000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'predio com andares/zonas nao pode ser apagado');
select throws_ok(
  $$update public.buildings set site_id = '20000000-0000-0000-0000-0000000000a2'
    where id = '30000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'predio nao muda de local (privilegio por coluna)');
select throws_ok(
  $$update public.floors set building_id = '30000000-0000-0000-0000-0000000000a2'
    where id = '31000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'andar nao muda de predio (privilegio por coluna)');

-- ---------------------------------------------------------------- owner A: pontos de acesso
select lives_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, type, direction, schedule_id,
      emergency_behavior, offline_behavior, door_open_timeout_seconds, controller_ref, entry_reader_ref)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Catraca 1', 'turnstile', 'entry',
            '70000000-0000-0000-0000-0000000000a1', 'fail_secure', 'degraded_allow', 15, 'CTRL-01', 'LEITOR-E1')$$,
  'owner cria ponto completo');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Catraca 1')$$,
  '23505', null, 'nome de ponto unico por local');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a2', 'Zona de outro local')$$,
  '23503', null, 'ponto nao usa zona de outro local (mesmo tenant)');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, door_open_timeout_seconds)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Timeout zero', 0)$$,
  '23514', null, 'timeout < 1 recusado');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, door_open_timeout_seconds)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Timeout enorme', 99999)$$,
  '23514', null, 'timeout > 3600 recusado');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, emergency_behavior)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Emergencia ruim', 'open_always')$$,
  '22P02', null, 'comportamento de emergencia invalido recusado');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name, controller_ref)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Rotulo longo', repeat('x', 81))$$,
  '23514', null, 'rotulo de hardware limitado a 80 caracteres');
select throws_ok(
  $$update public.access_points set site_id = '20000000-0000-0000-0000-0000000000a2'
    where id = '50000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'ponto nao muda de local (privilegio por coluna)');
select throws_ok(
  $$update public.access_points set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where id = '50000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'ponto nao muda de tenant (privilegio por coluna)');
select throws_ok(
  $$update public.access_points set zone_id = '40000000-0000-0000-0000-0000000000a2'
    where id = '50000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'ponto nao muda para zona de outro local');
select lives_ok(
  $$update public.access_points set status = 'inactive', emergency_behavior = 'fail_secure'
    where id = '50000000-0000-0000-0000-0000000000a1'$$,
  'owner inativa ponto e altera emergencia');
select throws_ok(
  $$delete from public.zones where id = '40000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'zona com ponto de acesso nao pode ser apagada');
select throws_ok(
  $$delete from public.access_schedules where id = '70000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'janela usada por ponto nao pode ser apagada');
reset role;

-- ---------------------------------------------------------------- matriz de papeis
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Criado pelo gestor')$$,
  'gestor de seguranca cria ponto');
select lives_ok(
  $$update public.access_points set name = 'Gestor editou' where name = 'Criado pelo gestor'$$,
  'gestor de seguranca edita ponto');
with d as (delete from public.access_points where name = 'Gestor editou' returning 1)
select is((select count(*)::int from d), 0, 'gestor de seguranca nao apaga ponto');
select lives_ok($$insert into public.buildings (tenant_id, site_id, name)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'Predio do gestor')$$,
  'gestor cria predio');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000aa');
select lives_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Criado pelo instalador')$$,
  'instalador cria ponto');
with d as (delete from public.access_points where name = 'Criado pelo instalador' returning 1)
select is((select count(*)::int from d), 0, 'instalador nao apaga ponto');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4');
select cmp_ok((select count(*)::int from public.access_points), '>=', 1, 'recepcao le pontos');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Recepcao nao cria')$$,
  '42501', null, 'recepcao nao cria ponto');
with u as (update public.access_points set name = 'Hack' returning 1)
select is((select count(*)::int from u), 0, 'recepcao nao edita ponto');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a7');
select cmp_ok((select count(*)::int from public.access_points), '>=', 1, 'auditor le pontos');
with u as (update public.access_points set name = 'Hack' returning 1)
select is((select count(*)::int from u), 0, 'auditor nao edita ponto');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.access_points), 0, 'visualizador nao le pontos');
select cmp_ok((select count(*)::int from public.buildings), '>=', 1, 'visualizador le predios (zone:read)');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from public.access_points), 0, 'RH nao le pontos');
reset role;

-- ---------------------------------------------------------------- escopo por local
select tests.login('00000000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from public.access_points), 1, 'gestor da Filial ve so pontos da Filial');
select is((select count(*)::int from public.buildings), 1, 'gestor da Filial ve so predios da Filial');
select throws_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1',
            '40000000-0000-0000-0000-0000000000a1', 'Fora do escopo')$$,
  '42501', null, 'gestor da Filial nao cria ponto na Sede');
select lives_ok(
  $$insert into public.access_points (tenant_id, site_id, zone_id, name)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
            '40000000-0000-0000-0000-0000000000a2', 'Dentro do escopo')$$,
  'gestor da Filial cria ponto na Filial');
with u as (update public.access_points set name = 'Hack' where site_id = '20000000-0000-0000-0000-0000000000a1' returning 1)
select is((select count(*)::int from u), 0, 'gestor da Filial nao edita ponto da Sede');
reset role;

-- ---------------------------------------------------------------- auditoria
select cmp_ok((select count(*)::int from public.audit_log where resource_type = 'access_points'
  and action = 'access_points.insert' and tenant_id = '10000000-0000-0000-0000-00000000000a'), '>=', 1,
  'criacao de ponto auditada');
select cmp_ok((select count(*)::int from public.audit_log where resource_type = 'access_points'
  and action = 'access_points.update' and metadata ->> 'old_status' = 'active'
  and metadata ->> 'status' = 'inactive'), '>=', 1, 'inativacao de ponto auditada com estado anterior');
select cmp_ok((select count(*)::int from public.audit_log where resource_type = 'buildings'
  and action = 'buildings.insert' and tenant_id = '10000000-0000-0000-0000-00000000000a'), '>=', 1,
  'criacao de predio auditada');
select cmp_ok((select count(*)::int from public.audit_log where resource_type = 'floors'
  and action = 'floors.insert'), '>=', 1, 'criacao de andar auditada');
select is((select count(*)::int from public.audit_log where resource_type = 'access_points'
  and (metadata ? 'controller_ref' or metadata ? 'entry_reader_ref')), 0,
  'auditoria nao carrega rotulos de hardware');

select * from finish();
rollback;
