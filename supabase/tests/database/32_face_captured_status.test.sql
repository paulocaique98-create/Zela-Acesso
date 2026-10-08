-- Facial: o Edge relata o rosto capturado (so o fato); so o agente do MESMO tenant, perfil ativo e facial, uma vez.
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

set local role service_role;
select is(public.edge_report_face_captured((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'),
  (select v::uuid from tests.vars where k='profA')), false, 'agente de outro tenant nao registra captura');
select is(public.edge_report_face_captured((select v::uuid from tests.vars where k='idA'), 'segredo-errado',
  (select v::uuid from tests.vars where k='profA')), false, 'segredo errado = false generico');
select is(public.edge_report_face_captured((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='profA')), true, 'agente do tenant registra a captura');
select is(public.edge_report_face_captured((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='profA')), false, 'segunda vez = false (idempotente, sem novo audit)');
reset role;

select isnt((select captured_at from public.biometric_profiles where id = (select v::uuid from tests.vars where k='profA')), null,
  'captured_at gravado');
select is((select captured_at from public.biometric_profiles where id = (select v::uuid from tests.vars where k='profB')), null,
  'perfil de outro tenant intacto');
select is((select count(*)::int from public.audit_log where action = 'biometric_profile.face_captured'), 1, 'um unico audit');
select is((select (metadata::text ~* 'face:|descriptor|vetor') from public.audit_log where action = 'biometric_profile.face_captured'),
  false, 'audit sem referencia/vetor');

set local role service_role;
select is((public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))
  -> 'snapshot' -> 'biometric' -> 'profiles' -> 0 ->> 'capturedAt') is not null, true, 'snapshot leva capturedAt');
reset role;

select * from finish();
rollback;
