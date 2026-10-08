-- Fase 8B (D-025): o snapshot inclui pessoas de grupo com politica ATIVA do sitio mesmo sem credencial na nuvem
-- (terminal Standalone usa credencial cadastrada no terminal). Fora: politica inativa, politica de outro sitio, sem grupo.
-- Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function tests.login(uuid) to authenticated, anon;
create table tests.vars (k text primary key, v text);
grant all on tests.vars to authenticated, service_role;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Filial A', 'America/Manaus'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Hall'),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Hall filial'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Hall B');
insert into public.access_groups (id, tenant_id, name) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Ativo'),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Inativo'),
  ('50000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'Filial'),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Grupo beta');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id, effect, schedule_id, status) values
  ('80000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Ativa', '50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-00000000000a', 'allow', null, 'active'),
  ('80000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Inativa', '50000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-00000000000a', 'allow', null, 'inactive'),
  ('80000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   'Filial', '50000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-0000000000a2', 'allow', null, 'active'),
  ('80000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   'Politica beta', '50000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-00000000000b', 'allow', null, 'active');
insert into public.people (id, tenant_id, full_name, status) values
  ('90000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa Grupo Ativo', 'active'),
  ('90000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Pessoa Grupo Inativo', 'active'),
  ('90000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'Pessoa Filial', 'active'),
  ('90000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'Pessoa Sem Grupo', 'active'),
  ('90000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'Pessoa Inativa', 'inactive'),
  ('90000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa B', 'active');
insert into public.access_group_members (tenant_id, group_id, person_id) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000a5'),
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a2', '90000000-0000-0000-0000-0000000000a2'),
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a3', '90000000-0000-0000-0000-0000000000a3'),
  ('10000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-0000000000b1');

select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tokA', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
reset role;
set local role service_role;
insert into tests.vars select 'secA', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokA'), 'host-a', '0.1.0');
reset role;
insert into tests.vars select 'idA', id::text from public.edge_agents where name = 'Agente A';
set local role service_role;
insert into tests.vars select 'snap', public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))::text;
reset role;

select is((select jsonb_agg(p->>'id' order by p->>'id')::text
           from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'people') p where k = 'snap'),
  '["90000000-0000-0000-0000-0000000000a1", "90000000-0000-0000-0000-0000000000a5"]',
  'so quem esta em grupo de politica ATIVA do sitio entra, mesmo sem credencial (a inativa entra com o status)');
select is((select p->>'status' from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'people') p
           where k = 'snap' and p->>'id' = '90000000-0000-0000-0000-0000000000a5'), 'inactive',
  'status da pessoa vai no snapshot para o roster poder excluir');
select is((select count(*)::int from tests.vars where k='snap' and (v like '%Pessoa%' or v like '%Grupo%')), 0,
  'snapshot continua sem nome de pessoa');
select is((select count(*)::int from tests.vars where k='snap' and v like '%90000000-0000-0000-0000-0000000000b1%'), 0,
  'pessoa de outro tenant nao vaza');

select * from finish();
rollback;
