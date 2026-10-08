-- Zela Pass (D-027): leitores (access_readers), ponto register_only (actuation), snapshot com readers/refHash.
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
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Manaus');
insert into public.zones (id, tenant_id, site_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Hall'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Hall B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name, type, actuation) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Porta A', 'door', 'driver'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Registro A', 'virtual', 'none'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '30000000-0000-0000-0000-00000000000b', 'Porta B', 'door', 'driver');
insert into public.people (id, tenant_id, full_name, status, external_ref) values
  ('90000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa A', 'active', ' m-309 '),
  ('90000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Sem ref', 'active', null);
insert into public.access_groups (id, tenant_id, name) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Todos');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id, effect, schedule_id, status) values
  ('80000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Ativa', '50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-00000000000a', 'allow', null, 'active');
insert into public.access_group_members (tenant_id, group_id, person_id) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000a2');

-- ------------------------------------------------------------ ponto register_only
select is((select actuation from public.access_points where id = '40000000-0000-0000-0000-00000000000a'), 'driver',
  'ponto existente segue com atuacao (padrao seguro de compatibilidade)');
select throws_ok($$update public.access_points set actuation = 'x' where id = '40000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'actuation so aceita driver ou none');

select tests.login('00000000-0000-0000-0000-0000000000a1');
update public.access_points set actuation = 'none' where id = '40000000-0000-0000-0000-00000000000a';
reset role;
select is((select count(*)::int from public.audit_log where action = 'access_points.actuation'
           and metadata->>'old' = 'driver' and metadata->>'new' = 'none'), 1, 'mudanca de atuacao e auditada');
select tests.login('00000000-0000-0000-0000-0000000000a3');
update public.access_points set actuation = 'driver' where id = '40000000-0000-0000-0000-00000000000a';
reset role;
select is((select actuation from public.access_points where id = '40000000-0000-0000-0000-00000000000a'), 'none',
  'viewer nao altera a atuacao (RLS)');
select tests.login('00000000-0000-0000-0000-0000000000a1');
update public.access_points set actuation = 'driver' where id = '40000000-0000-0000-0000-00000000000a';
reset role;

-- ------------------------------------------------------------ criar leitor
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- installer cria
insert into tests.vars select 'code', enrollment_code from public.create_access_reader('40000000-0000-0000-0000-0000000000a2', 'Tablet portaria');
insert into tests.vars select 'rid', reader_id::text from public.create_access_reader('40000000-0000-0000-0000-00000000000a', 'Tablet 2');
select is((select count(*)::int from public.access_readers), 2, 'installer lista os leitores do proprio tenant');
select throws_ok($$select public.revoke_access_reader((select v::uuid from tests.vars where k='rid'), 'motivo valido')$$,
  '42501', null, 'installer nao revoga');
reset role;

select matches((select v from tests.vars where k = 'code'), '^zrd_[0-9a-f]{64}$', 'codigo de ativacao tem alta entropia e formato fixo');
select is((select count(*)::int from public.access_readers
           where enrollment_token_hash = (select v from tests.vars where k = 'code')), 0, 'o codigo em claro nao e guardado');
select is((select count(*)::int from public.audit_log where metadata::text like '%zrd_%'
           or metadata::text like '%' || (select enrollment_token_hash from public.access_readers limit 1) || '%'), 0,
  'auditoria sem codigo nem hash');

select tests.login('00000000-0000-0000-0000-0000000000a3'); -- viewer
select throws_ok($$select public.create_access_reader('40000000-0000-0000-0000-00000000000a', 'Tablet X')$$,
  'P0002', null, 'viewer nem enxerga o ponto (sem reader:read)');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1'); -- outro tenant
select throws_ok($$select public.create_access_reader('40000000-0000-0000-0000-00000000000a', 'Invasor')$$,
  'P0002', null, 'cross-tenant: nao cria leitor em ponto alheio');
select is((select count(*)::int from public.access_readers), 0, 'cross-tenant: nao lista leitores alheios');
select throws_ok($$select public.revoke_access_reader((select v::uuid from tests.vars where k='rid'), 'tentativa alheia')$$,
  'P0002', null, 'cross-tenant: nao revoga leitor alheio');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select enrollment_token_hash from public.access_readers$$, '42501', null,
  'hash do codigo nao e legivel pela API de tabela');
select throws_ok($$insert into public.access_readers (tenant_id, site_id, access_point_id, name, enrollment_token_hash, enrollment_expires_at)
  values ('10000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000a','40000000-0000-0000-0000-00000000000a','Direto','x', now())$$,
  '42501', null, 'sem INSERT direto: so por RPC');
select throws_ok($$select public.create_access_reader('40000000-0000-0000-0000-00000000000a', 'x')$$, '22023', null, 'nome curto recusado');
reset role;

-- ------------------------------------------------------------ snapshot + ativacao pelo Edge
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

select is((select jsonb_array_length((v::jsonb)->'snapshot'->'readers') from tests.vars where k = 'snap'), 2,
  'snapshot lista os 2 leitores pendentes do site');
select is((select (p->>'enrollmentTokenHash') is not null from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'readers') p
           where k = 'snap' and p->>'id' = (select v from tests.vars where k = 'rid')), true,
  'pendente leva o hash (nao o codigo) para o Edge conferir offline');
select is((select count(*)::int from tests.vars where k = 'snap' and v like '%' || (select v from tests.vars where k = 'code') || '%'), 0,
  'o codigo em claro nunca vai no snapshot');
select is((select p->>'actuation' from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'accessPoints') p
           where k = 'snap' and p->>'id' = '40000000-0000-0000-0000-0000000000a2'), 'none', 'snapshot leva a atuacao do ponto');
select is((select p->>'refHash' from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'people') p
           where k = 'snap' and p->>'id' = '90000000-0000-0000-0000-0000000000a1'),
  encode(extensions.digest('10000000-0000-0000-0000-00000000000a:M-309', 'sha256'), 'hex'),
  'refHash = sha256(tenant:MATRICULA normalizada)');
select is((select p->>'refHash' from tests.vars, jsonb_array_elements((v::jsonb)->'snapshot'->'people') p
           where k = 'snap' and p->>'id' = '90000000-0000-0000-0000-0000000000a2'), null, 'sem matricula, sem refHash');
select is((select count(*)::int from tests.vars where k = 'snap' and v like '%m-309%' or v like '%M-309%'), 0,
  'matricula em claro nao vai no snapshot');

-- ativacao reportada pelo Edge
set local role service_role;
select is(public.edge_report_reader_enrolled((select v::uuid from tests.vars where k='idA'), 'segredo-errado',
  (select v::uuid from tests.vars where k='rid'), repeat('a', 64), 'Tablet'), false, 'agente invalido nao ativa');
select is(public.edge_report_reader_enrolled((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='rid'), 'curta', 'Tablet'), false, 'chave publica invalida nao ativa');
select is(public.edge_report_reader_enrolled((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='rid'), repeat('a', 64), 'Tablet'), true, 'agente valido ativa o leitor pendente');
select is(public.edge_report_reader_enrolled((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select v::uuid from tests.vars where k='rid'), repeat('b', 64), 'Outro'), false, 'segunda ativacao nao troca a chave');
reset role;
select is((select status::text from public.access_readers where id = (select v::uuid from tests.vars where k='rid')), 'active', 'leitor ativo');
select is((select enrollment_token_hash from public.access_readers where id = (select v::uuid from tests.vars where k='rid')), null,
  'ativo nao guarda mais o hash do codigo');

-- agente de outro tenant nao ativa leitor alheio
select tests.login('00000000-0000-0000-0000-0000000000b1');
insert into tests.vars select 'tokB', enrollment_token from public.create_edge_agent('20000000-0000-0000-0000-00000000000b', 'Agente B');
reset role;
set local role service_role;
insert into tests.vars select 'secB', agent_secret from public.edge_enroll((select v from tests.vars where k = 'tokB'), 'host-b', '0.1.0');
reset role;
insert into tests.vars select 'idB', id::text from public.edge_agents where name = 'Agente B';
set local role service_role;
select is(public.edge_report_reader_enrolled((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'),
  (select id from public.access_readers where name = 'Tablet portaria'), repeat('c', 64), 'x'), false,
  'agente de outro tenant nao ativa leitor alheio');
reset role;

-- revogacao
select tests.login('00000000-0000-0000-0000-0000000000a4'); -- security_manager revoga
select throws_ok($$select public.revoke_access_reader((select v::uuid from tests.vars where k='rid'), 'abc')$$, '22023', null, 'justificativa obrigatoria');
select lives_ok($$select public.revoke_access_reader((select v::uuid from tests.vars where k='rid'), 'tablet perdido')$$, 'security_manager revoga');
select throws_ok($$select public.revoke_access_reader((select v::uuid from tests.vars where k='rid'), 'tablet perdido')$$, '22023', null, 'revogar duas vezes e recusado');
reset role;
select is((select status::text from public.access_readers where id = (select v::uuid from tests.vars where k='rid')), 'revoked', 'leitor revogado');
set local role service_role;
insert into tests.vars select 'snap2', public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))::text;
reset role;
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'readers') from tests.vars where k = 'snap2'), 1,
  'revogado sai do snapshot (o Edge passa a recusar)');

select * from finish();
rollback;
