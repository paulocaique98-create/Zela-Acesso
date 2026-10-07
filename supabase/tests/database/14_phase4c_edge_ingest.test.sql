-- Fase 4C: entrega de eventos do Edge Agent (identidade vem do agente, referencias de outro tenant/site descartadas,
-- idempotencia, validacao, agente revogado). Dados sinteticos; tudo e revertido.
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

-- permissao e autenticacao
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'), '[]')$$,
  '42501', null, 'usuario autenticado nao chama a entrega');
reset role;
set local role service_role;
select is(public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), 'zes_errado', '[]'::jsonb), null, 'segredo errado = null');
select throws_ok($$select public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'), '{}')$$,
  '22023', null, 'corpo que nao e array e recusado');

-- entrega: identidade vem do agente, nao do payload
insert into tests.vars select 'r1', public.edge_ingest_events(
  (select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(tests.ev('edge:evento-0001'), tests.ev('edge:evento-0001')))::text;
reset role;
select is((select (v::jsonb)->'results'->0->>'status' from tests.vars where k='r1'), 'recorded', '1o evento gravado');
select is((select (v::jsonb)->'results'->1->>'status' from tests.vars where k='r1'), 'duplicate', 'repeticao no lote = duplicate');
select is((select count(*)::int from public.access_events where idempotency_key = 'edge:evento-0001'), 1, 'um unico evento gravado');
select is((select tenant_id from public.access_events where idempotency_key = 'edge:evento-0001'),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'tenant do agente (payload com tenant B ignorado)');
select is((select site_id from public.access_events where idempotency_key = 'edge:evento-0001'),
  '20000000-0000-0000-0000-00000000000a'::uuid, 'site do agente');
select is((select source from public.access_events where idempotency_key = 'edge:evento-0001'), 'EDGE_AGENT', 'source forcada para EDGE_AGENT');
select is((select evidence->>'agentId' from public.access_events where idempotency_key = 'edge:evento-0001'),
  (select v from tests.vars where k = 'idA'), 'agentId na evidencia');

-- reenvio apos timeout: duplicate, sem novo evento
set local role service_role;
insert into tests.vars select 'r2', public.edge_ingest_events(
  (select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(tests.ev('edge:evento-0001')))::text;
reset role;
select is((select (v::jsonb)->'results'->0->>'status' from tests.vars where k='r2'), 'duplicate', 'reenvio = duplicate');
select is((select count(*)::int from public.access_events where idempotency_key = 'edge:evento-0001'), 1, 'continua um evento');

-- referencias de outro site/tenant sao descartadas
set local role service_role;
insert into tests.vars select 'r3', public.edge_ingest_events(
  (select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(tests.ev('edge:evento-0002', jsonb_build_object(
    'p_access_point', '40000000-0000-0000-0000-0000000000a2', 'p_zone', '30000000-0000-0000-0000-00000000000b',
    'p_person', '90000000-0000-0000-0000-0000000000b1'))))::text;
reset role;
select is((select (v::jsonb)->'results'->0->>'status' from tests.vars where k='r3'), 'recorded', 'evento com referencias estranhas e gravado');
select is((select access_point_id from public.access_events where idempotency_key = 'edge:evento-0002'), null, 'ponto de outro site descartado');
select is((select zone_id from public.access_events where idempotency_key = 'edge:evento-0002'), null, 'zona de outro tenant descartada');
select is((select person_id from public.access_events where idempotency_key = 'edge:evento-0002'), null, 'pessoa de outro tenant descartada');

-- validacao: rejeitados nao derrubam o lote
set local role service_role;
insert into tests.vars select 'r4', public.edge_ingest_events(
  (select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(
    tests.ev('edge:evento-0003', jsonb_build_object('p_occurred_at', (now() + interval '1 day')::text)),
    tests.ev('edge:evento-0004', jsonb_build_object('p_event_type', 'correction')),
    tests.ev('edge:evento-0005', jsonb_build_object('p_decision', 'TALVEZ')),
    tests.ev('x'),
    tests.ev('edge:evento-0006', jsonb_build_object('p_evidence', jsonb_build_object('pin', '1234'))),
    tests.ev('edge:evento-0007')))::text;
reset role;
select is((select (v::jsonb)->'results'->0->>'status' from tests.vars where k='r4'), 'rejected', 'futuro rejeitado');
select is((select (v::jsonb)->'results'->1->>'status' from tests.vars where k='r4'), 'rejected', 'tipo correction rejeitado');
select is((select (v::jsonb)->'results'->2->>'status' from tests.vars where k='r4'), 'rejected', 'decisao invalida rejeitada');
select is((select (v::jsonb)->'results'->3->>'status' from tests.vars where k='r4'), 'rejected', 'chave curta rejeitada');
select is((select (v::jsonb)->'results'->4->>'status' from tests.vars where k='r4'), 'rejected', 'evidencia com pin rejeitada');
select is((select (v::jsonb)->'results'->5->>'status' from tests.vars where k='r4'), 'recorded', 'evento valido do mesmo lote gravado');
select is((select count(*)::int from public.access_events
  where idempotency_key in ('edge:evento-0003', 'edge:evento-0004', 'edge:evento-0005', 'edge:evento-0006')), 0, 'nenhum rejeitado gravado');

-- lote grande demais
set local role service_role;
select throws_ok($$select public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select jsonb_agg(tests.ev('edge:lote-' || lpad(g::text, 5, '0'))) from generate_series(1, 101) g))$$, '22023', null, 'lote > 100 recusado');

-- cadeia continua integra
select is((select ok from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), true, 'cadeia integra apos a entrega');
reset role;

-- revogado nao entrega
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.revoke_edge_agent((select v::uuid from tests.vars where k='idA'), 'teste de revogacao');
reset role;
set local role service_role;
select is(public.edge_ingest_events((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  jsonb_build_array(tests.ev('edge:evento-0008'))), null, 'agente revogado nao entrega');
reset role;
select is((select count(*)::int from public.access_events where idempotency_key = 'edge:evento-0008'), 0, 'nada gravado apos revogacao');

select * from finish();
rollback;
