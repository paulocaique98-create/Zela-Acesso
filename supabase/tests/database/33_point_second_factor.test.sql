-- Segundo fator por ponto: coluna com padrao 'none', so valores validos, auditoria (so old/new), snapshot leva o campo e
-- o ponto de outro tenant nao e alterado. Dados sinteticos; tudo e revertido.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
update public.tenants set features_enabled = features_enabled || '{"biometrics":true}'::jsonb
 where id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Sao_Paulo');
insert into public.people (id, tenant_id, full_name, kind) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa A', 'employee'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa B', 'employee');

select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tokA', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'consent', 365, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 300);
select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'sface-edge', 'face:aaaaaaaa-0001', 'in_person', true, true, 'v1');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
insert into tests.vars select 'tokB', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000b', 'Agente B');
select public.set_biometric_settings('10000000-0000-0000-0000-00000000000b', true,
  'consent', 365, 'v1', 'dpo@beta.test', 'ripd-1', current_date, current_date + 300);
select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000b',
  '40000000-0000-0000-0000-0000000000b1', 'sface-edge', 'face:bbbbbbbb-0001', 'in_person', true, true, 'v1');
reset role;

set local role service_role;
insert into tests.vars select 'secA', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokA'), 'host-a', '0.1.0');
insert into tests.vars select 'secB', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokB'), 'host-b', '0.1.0');
reset role;
insert into tests.vars select 'idA', id::text from public.edge_agents where name = 'Agente A';
insert into tests.vars select 'idB', id::text from public.edge_agents where name = 'Agente B';
insert into tests.vars select 'profA', id::text from public.biometric_profiles where tenant_id = '10000000-0000-0000-0000-00000000000a';
insert into tests.vars select 'profB', id::text from public.biometric_profiles where tenant_id = '10000000-0000-0000-0000-00000000000b';

reset role;
insert into public.zones (id, tenant_id, site_id, name) values
  ('41000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Portaria A'),
  ('41000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Portaria B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values
  ('51000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '41000000-0000-0000-0000-0000000000a1', 'Porta A'),
  ('51000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '41000000-0000-0000-0000-0000000000b1', 'Porta B');

select is((select second_factor from public.access_points where id = '51000000-0000-0000-0000-0000000000a1'), 'none',
  'padrao e none (comportamento anterior)');

select tests.login('00000000-0000-0000-0000-0000000000a1');
update public.access_points set second_factor = 'pin' where id = '51000000-0000-0000-0000-0000000000a1';
select is((select second_factor from public.access_points where id = '51000000-0000-0000-0000-0000000000a1'), 'pin',
  'dono da organizacao liga o segundo fator no proprio ponto');
select throws_ok($$update public.access_points set second_factor = 'card' where id = '51000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'valor fora de none/pin e recusado');
update public.access_points set second_factor = 'pin' where id = '51000000-0000-0000-0000-0000000000b1';
reset role;
select is((select second_factor from public.access_points where id = '51000000-0000-0000-0000-0000000000b1'), 'none',
  'ponto de outro tenant nao e alterado (RLS)');

select is((select count(*)::int from public.audit_log where action = 'access_points.second_factor'), 1, 'mudanca auditada uma vez');
select is((select metadata ->> 'old' || '>' || (metadata ->> 'new') from public.audit_log where action = 'access_points.second_factor'),
  'none>pin', 'audit guarda so old/new');

set local role service_role;
select is((public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))
  -> 'snapshot' -> 'accessPoints' -> 0 ->> 'secondFactor'), 'pin', 'snapshot leva secondFactor do ponto');
select is(jsonb_array_length(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))
  -> 'snapshot' -> 'accessPoints'), 1, 'snapshot so tem pontos do proprio sitio/tenant');
reset role;

select * from finish();
rollback;
