-- Fase 5C: visitas com check-in no snapshot do Edge (so do sitio do agente, sem dados pessoais) e expiracao.
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
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Filial A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Recepcao'),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Zona da filial'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Recepcao B');
insert into public.people (id, tenant_id, full_name, kind) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Anfitriao Alfa', 'employee'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Anfitriao Beta', 'employee');

-- Agente A (Sede A) e convites: Sede A (com check-in e pendente) e Filial A (com check-in; nao pode vazar).
select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tokA', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
insert into tests.vars select 'vIn', (public.create_visit('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Maria Visitante', now() - interval '1 minute', now() + interval '4 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]))::text;
insert into tests.vars select 'vPend', (public.create_visit('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Convidado Pendente', now() - interval '1 minute', now() + interval '4 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]))::text;
insert into tests.vars select 'vFil', (public.create_visit('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
  '40000000-0000-0000-0000-00000000000a', 'Visitante Filial', now() - interval '1 minute', now() + interval '4 hours',
  array['30000000-0000-0000-0000-0000000000a2']::uuid[]))::text;
select public.check_in_visit('10000000-0000-0000-0000-00000000000a', (v::jsonb ->> 'id')::uuid, null, 'v1')
  from tests.vars where k = 'vIn';
select public.check_in_visit('10000000-0000-0000-0000-00000000000a', (v::jsonb ->> 'id')::uuid, null, 'v1')
  from tests.vars where k = 'vFil';
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
insert into tests.vars select 'tokB', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000b', 'Agente B');
reset role;
set local role service_role;
insert into tests.vars select 'secA', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokA'), 'host-a', '0.1.0');
insert into tests.vars select 'secB', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokB'), 'host-b', '0.1.0');
reset role;
insert into tests.vars select 'idA', id::text from public.edge_agents where name = 'Agente A';
insert into tests.vars select 'idB', id::text from public.edge_agents where name = 'Agente B';

set local role service_role;
insert into tests.vars select 'snapA', public.edge_pull_snapshot((select v::uuid from tests.vars where k = 'idA'), (select v from tests.vars where k = 'secA'))::text;
insert into tests.vars select 'snapB', public.edge_pull_snapshot((select v::uuid from tests.vars where k = 'idB'), (select v from tests.vars where k = 'secB'))::text;
reset role;

select is(jsonb_array_length((select v::jsonb -> 'snapshot' -> 'visits' from tests.vars where k = 'snapA')), 1,
  'agente da Sede recebe so a visita com check-in do proprio sitio');
select is((select v::jsonb -> 'snapshot' -> 'visits' -> 0 -> 'zoneIds' ->> 0 from tests.vars where k = 'snapA'),
  '30000000-0000-0000-0000-00000000000a', 'visita leva a zona liberada');
select is((select v::jsonb -> 'snapshot' -> 'visits' -> 0 ->> 'personId' from tests.vars where k = 'snapA'),
  (select person_id::text from public.visits where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'vIn')),
  'visita aponta para a pessoa visitante');
select is((select (v::jsonb -> 'snapshot' -> 'visits' -> 0) ?| array['visitorName','visitor_name','company','vehiclePlate','documentHint','token','tokenHash'] from tests.vars where k = 'snapA'),
  false, 'visita no snapshot sem nome, empresa, placa, documento nem token');
select is((select v from tests.vars where k = 'snapA') like '%Maria Visitante%', false, 'nome do visitante nao vaza no snapshot');
select is(jsonb_array_length((select v::jsonb -> 'snapshot' -> 'visits' from tests.vars where k = 'snapB')), 0,
  'agente de outro tenant nao recebe visitas');
select is((select count(*)::int from jsonb_array_elements((select v::jsonb -> 'snapshot' -> 'credentials' from tests.vars where k = 'snapA')) c
            where c ->> 'type' = 'mobile_token'), 2, 'credenciais de visitante (so hash; tenant inteiro, como as demais) seguem no snapshot');

-- vencida: sai do snapshot antes do job; o job fecha o acesso
update public.visits set valid_from = now() - interval '3 hours', valid_until = now() - interval '1 minute'
  where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'vIn');
set local role service_role;
select is((public.edge_pull_snapshot((select v::uuid from tests.vars where k = 'idA'), (select v from tests.vars where k = 'secA'))
           -> 'snapshot' -> 'visits'), '[]'::jsonb, 'visita vencida sai do snapshot mesmo antes do job');
select is(public.expire_due_visits() >= 1, true, 'job expira a visita vencida');
reset role;
select is((select status::text from public.visits where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'vIn')),
  'expired', 'visita marcada expirada');
select is((select status::text from public.credentials where id = (select credential_id from public.visits
            where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'vIn'))), 'revoked', 'credencial do visitante revogada');

select * from finish();
rollback;
