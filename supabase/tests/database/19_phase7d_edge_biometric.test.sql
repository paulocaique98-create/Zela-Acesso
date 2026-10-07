-- Fase 7D: snapshot do Edge com politica/perfis biometricos e fila de eliminacao; confirmacao so pelo agente do tenant.
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
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v1');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
insert into tests.vars select 'tokB', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000b', 'Agente B');
select public.set_biometric_settings('10000000-0000-0000-0000-00000000000b', true,
  'consent', 365, 'v1', 'dpo@beta.test', 'ripd-1', current_date, current_date + 300);
select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000b',
  '40000000-0000-0000-0000-0000000000b1', 'mock', 'tpl-ref-beta1', 'in_person', true, true, 'v1');
reset role;

set local role service_role;
insert into tests.vars select 'secA', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokA'), 'host-a', '0.1.0');
insert into tests.vars select 'secB', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokB'), 'host-b', '0.1.0');
reset role;
insert into tests.vars select 'idA', id::text from public.edge_agents where name = 'Agente A';
insert into tests.vars select 'idB', id::text from public.edge_agents where name = 'Agente B';
insert into tests.vars select 'profA', id::text from public.biometric_profiles where tenant_id = '10000000-0000-0000-0000-00000000000a';

set local role service_role;
insert into tests.vars select 'snapA', (public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'),
  (select v from tests.vars where k='secA'))->'snapshot')::text;
reset role;

-- ------------------------------------------------------------ conteudo do snapshot
select is((select (v::jsonb)#>>'{biometric,settings,enabled}' from tests.vars where k='snapA'), 'true', 'politica biometrica no snapshot');
select is((select (v::jsonb)#>>'{biometric,settings,legalBasis}' from tests.vars where k='snapA'), 'consent', 'base legal no snapshot');
select is((select jsonb_array_length((v::jsonb)#>'{biometric,profiles}') from tests.vars where k='snapA'), 1, 'um perfil ativo do tenant');
select is((select (v::jsonb)#>>'{biometric,profiles,0,templateRef}' from tests.vars where k='snapA'), 'tpl-ref-0001', 'referencia opaca (nunca gabarito) para o provedor');
select is((select jsonb_array_length((v::jsonb)->'credentials') from tests.vars where k='snapA'), 1, 'credencial biometrica no snapshot');
select is((select (v::jsonb)#>>'{credentials,0,type}' from tests.vars where k='snapA'), 'biometric', 'tipo biometric');
select ok((select v not like '%tpl-ref-beta1%' and v not like '%dpo@beta.test%' from tests.vars where k='snapA'),
  'nada do tenant Beta no snapshot do Alfa');
select is((select jsonb_array_length((v::jsonb)#>'{biometric,pendingErasure}') from tests.vars where k='snapA'), 0, 'sem eliminacao pendente');

-- ------------------------------------------------------------ revogacao -> fila de eliminacao
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.revoke_biometric('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a1');
reset role;
set local role service_role;
insert into tests.vars select 'snapA2', (public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'),
  (select v from tests.vars where k='secA'))->'snapshot')::text;
reset role;
select is((select jsonb_array_length((v::jsonb)#>'{biometric,profiles}') from tests.vars where k='snapA2'), 0, 'perfil revogado sai dos ativos');
select is((select (v::jsonb)#>>'{biometric,pendingErasure,0,templateRef}' from tests.vars where k='snapA2'), 'tpl-ref-0001', 'referencia entra na fila de eliminacao');
select is((select (v::jsonb)#>>'{biometric,pendingErasure,0,profileId}' from tests.vars where k='snapA2'), (select v from tests.vars where k='profA'), 'fila aponta o perfil');

-- ------------------------------------------------------------ confirmacao de eliminacao pelo agente
set local role service_role;
select is(public.edge_confirm_biometric_erasure((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'),
  (select v::uuid from tests.vars where k='profA')), false, 'agente de outro tenant nao confirma');
select is(public.edge_confirm_biometric_erasure((select v::uuid from tests.vars where k='idA'), 'segredo-errado',
  (select v::uuid from tests.vars where k='profA')), false, 'segredo errado nao confirma');
select is((select status::text from public.biometric_profiles where id = (select v::uuid from tests.vars where k='profA')), 'revoked', 'perfil segue aguardando');
select is(public.edge_confirm_biometric_erasure((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='profA')), true, 'agente do tenant confirma a eliminacao');
select is((select status::text from public.biometric_profiles where id = (select v::uuid from tests.vars where k='profA')), 'erased', 'perfil eliminado');
select is((select template_ref from public.biometric_profiles where id = (select v::uuid from tests.vars where k='profA')), null, 'referencia apagada');
select is(public.edge_confirm_biometric_erasure((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='profA')), false, 'segunda confirmacao nao repete');
reset role;
set local role authenticated;
select throws_ok($$select public.edge_confirm_biometric_erasure(gen_random_uuid(), 'x', gen_random_uuid())$$, '42501',
  null, 'navegador nao executa a confirmacao');
reset role;

select * from finish();
rollback;
