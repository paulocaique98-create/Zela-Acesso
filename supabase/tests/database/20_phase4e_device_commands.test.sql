-- Fase 4E: pedido de comando de dispositivo (RBAC por site, auditoria), entrega ao agente e resultado. Dados sinteticos.
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
  ('00000000-0000-0000-0000-0000000000a3', 'a-sec@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'security_manager'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Sao_Paulo');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Recepcao'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Recepcao B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Porta A'),
  ('50000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '30000000-0000-0000-0000-00000000000b', 'Porta B');

select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tokA', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Agente A');
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

-- ------------------------------------------------------------ permissoes
select tests.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 3000, 'visita no portao')$$,
  'P0002', null, 'recepcao nao emite comando de dispositivo');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 3000, 'visita no portao')$$,
  'P0002', null, 'outro tenant nao emite no ponto alheio');
reset role;

-- ------------------------------------------------------------ pedido valido
select tests.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'lock', null, 'trancar remoto')$$,
  '22023', null, 'lock remoto nao existe nesta fase');
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 3000, 'x')$$,
  '22023', null, 'motivo obrigatorio');
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 999999, 'motivo valido')$$,
  '22023', null, 'duracao limitada');
insert into tests.vars select 'cmd1', public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 3000, 'visita no portao')::text;
select throws_ok($$select public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', 3000, 'repetido')$$,
  '22023', null, 'um pedido em aberto por ponto');
select is((select count(*)::int from public.device_commands), 1, 'gerente de seguranca ve o proprio tenant');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.device_commands), 0, 'recepcao nao le a fila de comandos');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.device_commands), 0, 'Beta nao ve comandos do Alfa');
reset role;
select is((select count(*)::int from public.audit_log where action = 'device_commands.request'
  and resource_id = (select v from tests.vars where k = 'cmd1')), 1, 'pedido auditado');
select is((select agent_id::text from public.device_commands), (select v from tests.vars where k = 'idA'), 'vai ao agente do site');

-- escrita direta e proibida
select tests.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$update public.device_commands set status = 'executed'$$, '42501', null, 'cliente nao altera comando');
select throws_ok($$delete from public.device_commands$$, '42501', null, 'cliente nao apaga comando');
reset role;

-- ------------------------------------------------------------ entrega ao agente
set local role service_role;
select is(public.edge_claim_commands((select v::uuid from tests.vars where k='idA'), 'segredo-errado'), null, 'segredo errado = null');
select is(jsonb_array_length(public.edge_claim_commands((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'))), 0,
  'agente de outro tenant nao recebe o comando');
insert into tests.vars select 'claim', public.edge_claim_commands((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))::text;
select is(jsonb_array_length((select v::jsonb from tests.vars where k='claim')), 1, 'agente recebe o pedido');
select is((select v::jsonb#>>'{0,action}' from tests.vars where k='claim'), 'unlock', 'acao');
select is((select v::jsonb#>>'{0,pointId}' from tests.vars where k='claim'), '50000000-0000-0000-0000-00000000000a', 'ponto');
select ok((select (v::jsonb#>>'{0,expiresAt}')::timestamptz - (v::jsonb#>>'{0,issuedAt}')::timestamptz <= interval '60 seconds'
  from tests.vars where k='claim'), 'validade <= 60 s (limite do verificador)');
select is(jsonb_array_length(public.edge_claim_commands((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))), 0,
  'entregue uma vez so');
reset role;

-- ------------------------------------------------------------ resultado
set local role service_role;
select is(public.edge_report_command_result((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'),
  (select v::uuid from tests.vars where k='cmd1'), 'executed', 'OK'), false, 'outro agente nao reporta');
select throws_ok(format($$select public.edge_report_command_result(%L, %L, %L, 'executed', 'ok minusculo')$$,
  (select v from tests.vars where k='idA'), (select v from tests.vars where k='secA'), (select v from tests.vars where k='cmd1')),
  '22023', null, 'codigo malformado');
select is(public.edge_report_command_result((select v::uuid from tests.vars where k='idA'), 'segredo-errado',
  (select v::uuid from tests.vars where k='cmd1'), 'executed', 'OK'), false, 'segredo errado nao reporta');
select is(public.edge_report_command_result((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='cmd1'), 'executed', 'OK'), true, 'agente reporta o resultado');
select is(public.edge_report_command_result((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='cmd1'), 'failed', 'DRIVER_ERROR'), false, 'resultado nao se reescreve');
reset role;
select is((select status from public.device_commands), 'executed', 'comando executado');
select is((select count(*)::int from public.audit_log where action = 'device_commands.result'), 1, 'resultado auditado');

-- ------------------------------------------------------------ expiracao
set local role service_role;
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
insert into tests.vars select 'cmd2', public.request_device_command('50000000-0000-0000-0000-00000000000a', 'unlock', null, 'segundo pedido')::text;
reset role;
update public.device_commands set requested_at = now() - interval '5 minutes' where id = (select v::uuid from tests.vars where k = 'cmd2');
set local role service_role;
select is(jsonb_array_length(public.edge_claim_commands((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))), 0,
  'pedido parado nao e entregue');
reset role;
select is((select status from public.device_commands where id = (select v::uuid from tests.vars where k = 'cmd2')), 'expired', 'pedido parado expira');

select * from finish();
rollback;
