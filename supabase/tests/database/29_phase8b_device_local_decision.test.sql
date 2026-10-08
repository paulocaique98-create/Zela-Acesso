-- Fase 8B (D-024): decisao local do terminal (Control iD Standalone) entra como evidencia do dispositivo, com codigos
-- proprios, pela mesma entrega do Edge. Dados sinteticos; tudo e revertido.
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
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Filial A', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Sao_Paulo');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Hall'),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Hall filial'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Hall B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name, direction, offline_behavior) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Porta 1', 'entry', 'degraded_allow'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   '30000000-0000-0000-0000-0000000000a2', 'Porta filial', 'entry', 'degraded_deny');
insert into public.people (id, tenant_id, full_name, status) values
  ('90000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Ana', 'active'),
  ('90000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Beto', 'active');

select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tokA', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
reset role;
set local role service_role;
insert into tests.vars select 'secA', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokA'), 'host-a', '0.1.0');
reset role;
insert into tests.vars select 'idA', id::text from public.edge_agents where name = 'Agente A';

-- evento sintetico como o agente o monta; o payload declara (de proposito) o tenant/site ERRADOS (B)
create function tests.ev(p_key text, p_overrides jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'p_tenant', '10000000-0000-0000-0000-00000000000b', 'p_site', '20000000-0000-0000-0000-00000000000b',
    'p_event_type', 'access_decision', 'p_occurred_at', (now() - interval '1 hour')::text,
    'p_decision', 'DEGRADED_ALLOW', 'p_reason_code', 'OFFLINE_POLICY_ALLOW',
    'p_person', '90000000-0000-0000-0000-0000000000a1', 'p_credential', null,
    'p_access_point', '40000000-0000-0000-0000-00000000000a', 'p_zone', '30000000-0000-0000-0000-00000000000a',
    'p_policy', null, 'p_physical_outcome', null, 'p_source', 'ENGINE', 'p_correlation', null,
    'p_evidence', jsonb_build_object('offline', true, 'steps', '[]'::jsonb), 'p_idempotency_key', p_key) || p_overrides
$$;
grant execute on function tests.ev(text, jsonb) to service_role;

-- decisao local do terminal: codigos proprios, identidade do agente, evidencia sem segredo
create function tests.dev(p_key text, p_allowed boolean, p_overrides jsonb default '{}') returns jsonb language sql as $$
  select tests.ev(p_key, jsonb_build_object(
    'p_decision', case when p_allowed then 'ALLOW' else 'DENY' end,
    'p_reason_code', case when p_allowed then 'DEVICE_LOCAL_ALLOW' else 'DEVICE_LOCAL_DENY' end,
    'p_person', null, 'p_zone', null,
    'p_evidence', jsonb_build_object('deviceLocal', true,
      'device', jsonb_build_object('kind', 'controlid', 'event', '7', 'userId', '42', 'logId', '519', 'deviceTime', 1532977090),
      'steps', '[]'::jsonb)) || p_overrides)
$$;
grant execute on function tests.dev(text, boolean, jsonb) to service_role;

set local role service_role;
insert into tests.vars select 'r1', public.edge_ingest_events(
  (select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(
    tests.dev('edge:dev:0001', true),
    tests.dev('edge:dev:0002', false),
    tests.dev('edge:dev:0001', true),
    tests.dev('edge:dev:0003', true, jsonb_build_object('p_reason_code', 'DEVICE_LOCAL_TALVEZ')),
    tests.dev('edge:dev:0004', true, jsonb_build_object('p_evidence', jsonb_build_object('deviceLocal', true, 'pin', '1234')))))::text;
reset role;
select is((select (v::jsonb)->'results'->0->>'status' from tests.vars where k='r1'), 'recorded', 'concessao local gravada');
select is((select (v::jsonb)->'results'->1->>'status' from tests.vars where k='r1'), 'recorded', 'negacao local gravada');
select is((select (v::jsonb)->'results'->2->>'status' from tests.vars where k='r1'), 'duplicate', 'repeticao = duplicate');
select is((select (v::jsonb)->'results'->3->>'status' from tests.vars where k='r1'), 'rejected', 'codigo de motivo desconhecido continua rejeitado');
select is((select (v::jsonb)->'results'->4->>'status' from tests.vars where k='r1'), 'rejected', 'evidencia com pin rejeitada');
select is((select reason_code from public.access_events where idempotency_key = 'edge:dev:0001'), 'DEVICE_LOCAL_ALLOW', 'motivo DEVICE_LOCAL_ALLOW');
select is((select decision from public.access_events where idempotency_key = 'edge:dev:0001'), 'ALLOW', 'decisao ALLOW');
select is((select reason_code from public.access_events where idempotency_key = 'edge:dev:0002'), 'DEVICE_LOCAL_DENY', 'motivo DEVICE_LOCAL_DENY');
select is((select decision from public.access_events where idempotency_key = 'edge:dev:0002'), 'DENY', 'decisao DENY');
select is((select tenant_id from public.access_events where idempotency_key = 'edge:dev:0001'),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'tenant do agente (payload com tenant B ignorado)');
select is((select source from public.access_events where idempotency_key = 'edge:dev:0001'), 'EDGE_AGENT', 'source EDGE_AGENT');
select is((select evidence->'device'->>'kind' from public.access_events where idempotency_key = 'edge:dev:0001'), 'controlid', 'evidencia do dispositivo guardada');
select is((select (evidence->>'deviceLocal')::boolean from public.access_events where idempotency_key = 'edge:dev:0001'), true, 'marcada como decisao local');
select is((select count(*)::int from public.access_events where idempotency_key in ('edge:dev:0003', 'edge:dev:0004')), 0, 'rejeitados nao gravados');

-- o CHECK so ganhou os dois codigos: os antigos seguem validos e um inventado segue invalido
set local role service_role;
select lives_ok($$select public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(tests.ev('edge:evento-0099')))$$, 'codigo antigo (OFFLINE_POLICY_ALLOW) segue aceito');
reset role;
select is((select reason_code from public.access_events where idempotency_key = 'edge:evento-0099'), 'OFFLINE_POLICY_ALLOW', 'codigo antigo gravado');

-- cadeia continua integra com os novos eventos
set local role service_role;
select is((select ok from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), true, 'cadeia integra');
reset role;

select * from finish();
rollback;
