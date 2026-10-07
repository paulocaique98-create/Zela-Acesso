-- Fase 6A: alertas (porta forcada/aberta, agente offline), incidentes, ocupacao e isolamento entre tenants.
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
  ('00000000-0000-0000-0000-0000000000a2', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Recepcao'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Recepcao B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Porta A');
insert into public.people (id, tenant_id, full_name, kind) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Pessoa A', 'employee'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Pessoa A2', 'employee');

-- agente ativo do tenant A, silencioso ha 10 min (criado e matriculado como em 12_phase4a)
select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'agent', agent_id::text from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
reset role;
update public.edge_agents set status = 'active', enrollment_token_hash = null, enrollment_expires_at = null,
  secret_hash = 'seg-hash-teste', last_seen_at = now() - interval '10 minutes'
 where id = (select v::uuid from tests.vars where k = 'agent');

-- ------------------------------------------------------------ porta forcada / aberta (servidor grava o evento)
set local role service_role;
select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'physical_outcome', now(), null, null, null, null, '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  null, 'DOOR_FORCED', 'EDGE_AGENT', null, '{}'::jsonb, 'forced-evt-0001');
select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'physical_outcome', now(), null, null, null, null, '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  null, 'DOOR_FORCED', 'EDGE_AGENT', null, '{}'::jsonb, 'forced-evt-0002');
select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'physical_outcome', now(), null, null, null, null, '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  null, 'DOOR_HELD_OPEN', 'EDGE_AGENT', null, '{}'::jsonb, 'held-evt-0001');
select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'physical_outcome', now(), null, null, null, null, '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  null, 'DOOR_OPENED', 'EDGE_AGENT', null, '{}'::jsonb, 'opened-evt-0001');
select public.scan_offline_agents(180);
reset role;

select is((select count(*)::int from public.alerts where kind = 'door_forced'), 1, 'porta forcada: 1 alerta (deduplicado)');
select is((select occurrences from public.alerts where kind = 'door_forced'), 2, 'recorrencia incrementa occurrences');
select is((select severity from public.alerts where kind = 'door_forced'), 'critical', 'porta forcada = critical');
select is((select count(*)::int from public.alerts where kind = 'door_held_open'), 1, 'porta aberta: 1 alerta');
select is((select count(*)::int from public.alerts), 3, 'DOOR_OPENED normal nao gera alerta');
select is((select count(*)::int from public.alerts where kind = 'device_offline'), 1, 'agente offline: 1 alerta');

-- ------------------------------------------------------------ varredura exige service_role e limiar valido
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.scan_offline_agents(180)$$, '42501', null, 'authenticated nao executa a varredura');
reset role;
set local role service_role;
select throws_ok($$select public.scan_offline_agents(5)$$, '22023', null, 'limiar invalido recusado');
reset role;

-- ------------------------------------------------------------ RLS: leitura por permissao e tenant
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.alerts), 3, 'owner A ve os alertas de A');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.alerts), 3, 'recepcionista le alertas');
select throws_ok($$select public.acknowledge_alert((select id from public.alerts where kind = 'door_forced'))$$,
  'P0002', null, 'recepcionista nao reconhece (alert:manage)');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.alerts), 0, 'viewer nao le alertas');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.alerts), 0, 'tenant B nao ve alertas de A');
select throws_ok($$select public.resolve_alert((select id from public.alerts where kind = 'door_forced'))$$,
  'P0002', null, 'tenant B nao resolve alerta de A');
reset role;

-- ------------------------------------------------------------ reconhecer, resolver, incidente
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.acknowledge_alert((select id from public.alerts where kind = 'door_forced'));
select is((select status from public.alerts where kind = 'door_forced'), 'acknowledged', 'alerta reconhecido');
select throws_ok($$select public.acknowledge_alert((select id from public.alerts where kind = 'door_forced'))$$,
  '22023', null, 'nao reconhece duas vezes');
insert into tests.vars select 'inc', public.create_incident('20000000-0000-0000-0000-00000000000a', 'Arrombamento na Porta A',
  'Porta forcada fora do horario', 'critical', array[(select id from public.alerts where kind = 'door_forced')])::text;
select is((select count(*)::int from public.alerts where incident_id = (select v::uuid from tests.vars where k = 'inc')), 1,
  'alerta vinculado ao incidente');
select throws_ok($$select public.create_incident('20000000-0000-0000-0000-00000000000a', 'Titulo', null, 'urgente')$$,
  '22023', null, 'severidade invalida recusada');
select public.resolve_alert((select id from public.alerts where kind = 'door_forced'), 'Porta reparada');
select is((select status from public.alerts where kind = 'door_forced'), 'resolved', 'alerta resolvido');
select public.update_incident_status((select v::uuid from tests.vars where k = 'inc'), 'closed', 'Encerrado');
select is((select status from public.incidents), 'closed', 'incidente encerrado');
select throws_ok($$select public.update_incident_status((select v::uuid from tests.vars where k = 'inc'), 'investigating')$$,
  '22023', null, 'incidente encerrado nao reabre');
select is((select count(*)::int from public.audit_log where action in ('alerts.acknowledge', 'alerts.resolve', 'incidents.create', 'incidents.closed')),
  4, 'acoes auditadas');
select throws_ok($$update public.alerts set status = 'open'$$, '42501', null, 'sem escrita direta em alerts');
reset role;

-- nova forcada depois de resolvida abre alerta novo
set local role service_role;
select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'physical_outcome', now(), null, null, null, null, '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  null, 'DOOR_FORCED', 'EDGE_AGENT', null, '{}'::jsonb, 'forced-evt-0003');
reset role;
select is((select count(*)::int from public.alerts where kind = 'door_forced' and status = 'open'), 1, 'nova ocorrencia reabre alerta novo');

-- ------------------------------------------------------------ agente volta: alerta offline se resolve sozinho
update public.edge_agents set last_seen_at = now() where id = (select v::uuid from tests.vars where k = 'agent');
set local role service_role;
select public.scan_offline_agents(180);
reset role;
select is((select status from public.alerts where kind = 'device_offline'), 'resolved', 'offline resolve sozinho ao voltar');

-- ------------------------------------------------------------ ocupacao
insert into public.presence_states (tenant_id, site_id, zone_id, person_id, state, since) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-00000000000a', 'present', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-0000000000a2', 'absent', now());
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select present_count from public.zone_occupancy where zone_id = '30000000-0000-0000-0000-00000000000a'), 1,
  'ocupacao conta so presentes');
select is((select count(*)::int from public.zone_occupancy), 1, 'owner A so ve zonas de A');
reset role;

select * from finish();
rollback;
