-- Fase 4A: identidade do Edge Agent (enrollment, autenticacao, heartbeat, rotacao, revogacao, RLS cross-tenant).
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
  ('00000000-0000-0000-0000-0000000000a2', 'a-installer@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-security@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'installer'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'security_manager'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');

-- ---------------------------------------------------------------- criacao (admin)
select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars
  select 'agent1', agent_id::text from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Portaria') ;
select ok((select v from tests.vars where k = 'agent1') is not null, 'owner cria agente');
reset role;

-- guarda token (a funcao devolve uma vez); recria via nova chamada para capturar o token
select tests.login('00000000-0000-0000-0000-0000000000a2');
insert into tests.vars
  select 'tok2', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Garagem');
select ok((select v from tests.vars where k = 'tok2') like 'zea\_%', 'installer cria agente; token tem prefixo');
select throws_ok($$select * from public.revoke_edge_agent((select v::uuid from tests.vars where k='agent1'), 'motivo valido')$$,
  '42501', null, 'installer nao revoga');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Viewer')$$,
  'P0002', null, 'viewer nao enxerga a unidade para criar (nao vaza existencia)');
select is((select count(*)::int from public.edge_agents), 0, 'viewer nao le agentes');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Seguranca')$$,
  '42501', null, 'security_manager le mas nao cria');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.edge_agents), 0, 'tenant B nao ve agentes do A');
select throws_ok($$select * from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Invasor')$$,
  'P0002', null, 'tenant B nao cria agente em unidade do A');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.edge_agents), 2, 'owner A ve 2 agentes');
select throws_ok($$select enrollment_token_hash from public.edge_agents$$, '42501', null,
  'hash do token nao e legivel pela API');
select throws_ok($$select secret_hash from public.edge_agents$$, '42501', null, 'hash do segredo nao e legivel pela API');
select throws_ok($$update public.edge_agents set status = 'active'$$, '42501', null, 'sem UPDATE direto');
reset role;

-- ---------------------------------------------------------------- enrollment (service_role)
set local role service_role;
select throws_ok($$select * from public.edge_enroll('zea_invalido', 'host', '1.0.0')$$, '28000', null, 'token invalido');
insert into tests.vars
  select 'secret2', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tok2'), 'GARAGEM-PC', '0.1.0');
select ok((select v from tests.vars where k = 'secret2') like 'zes\_%', 'enrollment devolve segredo do agente');
select throws_ok($$select * from public.edge_enroll((select v from tests.vars where k = 'tok2'), 'GARAGEM-PC', '0.1.0')$$,
  '28000', null, 'token e de uso unico');
reset role;

select is((select status::text from public.edge_agents where name = 'Garagem'), 'active', 'agente ativo apos enrollment');
select is((select enrollment_token_hash from public.edge_agents where name = 'Garagem'), null, 'token apagado apos uso');
select isnt((select secret_hash from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2'),
  'segredo nao e guardado em texto puro');
select is((select count(*)::int from public.audit_log where action = 'edge_agent.enroll' and actor_type = 'device'), 1,
  'enrollment auditado como device');
select is((select count(*)::int from public.audit_log where metadata::text like '%' || (select v from tests.vars where k='secret2') || '%'
  or metadata::text like '%zea\_%'), 0, 'audit_log sem token/segredo');

-- token expirado
select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars select 'tok3', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000a', 'Expira');
reset role;
update public.edge_agents set enrollment_expires_at = now() - interval '1 minute' where name = 'Expira';
set local role service_role;
select throws_ok($$select * from public.edge_enroll((select v from tests.vars where k = 'tok3'), 'h', '1')$$, '28000', null,
  'token expirado nao enrola');
reset role;

-- ---------------------------------------------------------------- autenticacao e heartbeat
set local role service_role;
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2'))), 1,
  'autentica com segredo correto');
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), 'zes_errado')), 0, 'segredo errado nao autentica');
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), null)), 0, 'segredo nulo nao autentica');
select is((select clock_drift_seconds from public.edge_heartbeat(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2'),
  '0.2.0', now() - interval '90 seconds', 7)) between -92 and -88, true, 'heartbeat calcula deriva de relogio');
select is((select count(*)::int from public.edge_heartbeat(
  (select id from public.edge_agents where name = 'Garagem'), 'zes_errado', '0.2.0', now(), 0)), 0,
  'heartbeat com segredo errado nao retorna nada');
reset role;
select is((select agent_version from public.edge_agents where name = 'Garagem'), '0.2.0', 'heartbeat atualiza versao');
select is((select last_queue_depth from public.edge_agents where name = 'Garagem'), 7, 'heartbeat registra fila');

-- ---------------------------------------------------------------- rotacao
set local role service_role;
insert into tests.vars
  select 'secret2b', public.edge_rotate_secret((select id from public.edge_agents where name = 'Garagem'),
                                                (select v from tests.vars where k = 'secret2'));
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2'))), 0,
  'segredo antigo invalido apos rotacao');
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2b'))), 1,
  'segredo novo autentica');
select throws_ok($$select public.edge_rotate_secret((select id from public.edge_agents where name = 'Garagem'), 'zes_errado')$$,
  '28000', null, 'rotacao exige segredo atual');
reset role;

-- ---------------------------------------------------------------- revogacao
select tests.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.revoke_edge_agent((select id from public.edge_agents where name = 'Garagem'), 'abc')$$,
  '22023', null, 'justificativa obrigatoria');
select lives_ok($$select * from public.revoke_edge_agent((select id from public.edge_agents where name = 'Garagem'), 'equipamento furtado')$$,
  'security_manager revoga');
reset role;
set local role service_role;
select is((select count(*)::int from public.edge_authenticate(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2b'))), 0,
  'agente revogado nao autentica');
select is((select count(*)::int from public.edge_heartbeat(
  (select id from public.edge_agents where name = 'Garagem'), (select v from tests.vars where k = 'secret2b'), '1', now(), 0)), 0,
  'agente revogado nao envia heartbeat');
reset role;
select is((select status::text from public.edge_agents where name = 'Garagem'), 'revoked', 'status revogado');
select is((select count(*)::int from public.audit_log where action = 'edge_agent.revoke' and reason = 'equipamento furtado'), 1,
  'revogacao auditada com motivo');

-- ---------------------------------------------------------------- privilegios das funcoes do agente
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.edge_authenticate(gen_random_uuid(), 'x')$$, '42501', null, 'authenticated nao chama edge_authenticate');
select throws_ok($$select * from public.edge_enroll('x', 'h', 'v')$$, '42501', null, 'authenticated nao chama edge_enroll');
select throws_ok($$select * from public.edge_heartbeat(gen_random_uuid(), 'x', 'v', now(), 0)$$, '42501', null, 'authenticated nao chama heartbeat');
reset role;

select * from finish();
rollback;
