-- Fase 5A: visitantes (convite, check-in/out, expiracao, escopo por zona, RLS cross-tenant, auditoria).
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
  ('00000000-0000-0000-0000-0000000000a4', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'hr_manager'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'auditor'),
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

-- ---------------------------------------------------------------- criar convite
select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into tests.vars
select 'visit1', (public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Maria Visitante',
  now() - interval '1 minute', now() + interval '4 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[],
  'Empresa X', '1234', 'abc-1d23', 1, 'Reuniao'))::text;
select is((select (v::jsonb ->> 'token') ~ '^[0-9a-f]{64}$' from tests.vars where k = 'visit1'),
  true, 'convite devolve token de 256 bits');
select is((select status::text from public.visits
            where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'visit1')),
  'invited', 'convite nasce invited');
select is((select vehicle_plate from public.visits limit 1), 'ABC1D23', 'placa normalizada');
select is((select count(*)::int from public.visit_zones), 1, 'zona associada');

select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Fulano', now(), now() + interval '1 hour',
  array['30000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  'Alguma zona não pertence a este local.', 'zona de outro local recusada');
select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Fulano', now(), now() + interval '1 hour',
  array['30000000-0000-0000-0000-00000000000b']::uuid[]) $$,
  'Alguma zona não pertence a este local.', 'zona de outro tenant recusada');
select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000b', 'Fulano', now(), now() + interval '1 hour',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]) $$,
  'Anfitrião não encontrado ou inativo.', 'anfitriao de outro tenant recusado');
select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Fulano', now(), now() + interval '8 days',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]) $$,
  'Período da visita inválido (fim no futuro, no máximo 7 dias).', 'validade acima de 7 dias recusada');
select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Fulano', now(), now() + interval '1 hour',
  array[]::uuid[]) $$,
  'Informe de 1 a 50 zonas permitidas.', 'sem zonas recusado');

-- segredo e escrita direta
select throws_ok($$ select token_hash from public.visits $$, '42501', null, 'token_hash ilegivel');
select throws_ok($$ select * from public.visits $$, '42501', null, 'select * ilegivel (coluna de segredo)');
select throws_ok($$ update public.visits set status = 'checked_in' $$, '42501', null, 'sem update direto');
select throws_ok($$ delete from public.visits $$, '42501', null, 'sem delete direto');
select throws_ok($$ insert into public.visits (tenant_id) values ('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'sem insert direto');

-- ---------------------------------------------------------------- papeis
select tests.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.visits), 0, 'viewer nao ve visitas');
select throws_ok($$ select public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Fulano', now(), now() + interval '1 hour',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]) $$,
  '42501', null, 'viewer nao cria convite');

select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.visits), 1, 'auditor le visitas');
select throws_ok($$ select public.cancel_visit('10000000-0000-0000-0000-00000000000a',
  (select id from public.visits limit 1)) $$, '42501', null, 'auditor nao cancela');

select tests.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.visits), 1, 'RH le visitas');
select throws_ok($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a',
  (select id from public.visits limit 1), null, 'v1') $$,
  'Convite inválido, expirado ou fora do horário.', 'RH nao faz check-in');

-- ---------------------------------------------------------------- cross-tenant
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.visits), 0, 'Beta nao ve visitas do Alfa');
select is((select count(*)::int from public.visit_zones), 0, 'Beta nao ve zonas de visita do Alfa');
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000b', null, %L, 'v1') $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1')),
  'Convite inválido, expirado ou fora do horário.', 'token do Alfa nao funciona no Beta');
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, %L, 'v1') $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1')),
  'Convite inválido, expirado ou fora do horário.', 'Beta nao faz check-in no tenant do Alfa');

-- ---------------------------------------------------------------- check-in
select tests.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, 'tokenerrado', 'v1') $$,
  'Convite inválido, expirado ou fora do horário.', 'token errado: falha generica');
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, %L, null) $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1')),
  'Registre a ciência do aviso de privacidade.', 'exige aviso de privacidade');
insert into tests.vars
select 'in1', (public.check_in_visit('10000000-0000-0000-0000-00000000000a', null,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1'), 'v1'))::text;
select is((select status::text from public.visits limit 1), 'checked_in', 'check-in por token');
select isnt((select v::jsonb ->> 'token' from tests.vars where k = 'in1'),
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1'),
  'credencial tem segredo diferente do convite');
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, %L, 'v1') $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit1')),
  'Convite inválido, expirado ou fora do horário.', 'convite nao reutilizavel');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select kind::text from public.people
            where id = (select person_id from public.visits limit 1)), 'visitor', 'pessoa visitor criada');
select is((select type::text || ':' || (expires_at = (select valid_until from public.visits limit 1))::text
             from public.credentials
            where id = (select credential_id from public.visits limit 1)),
  'mobile_token:true', 'credencial expira com a visita');

-- ---------------------------------------------------------------- check-out
select tests.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.check_out_visit('10000000-0000-0000-0000-00000000000a',
  (select id from public.visits limit 1)) $$, 'check-out');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select status::text from public.visits limit 1), 'checked_out', 'visita encerrada');
select is((select status::text from public.credentials
            where id = (select credential_id from public.visits limit 1)), 'revoked', 'credencial revogada no check-out');
select is((select status::text from public.people
            where id = (select person_id from public.visits limit 1)), 'inactive', 'pessoa visitante inativada');
select throws_ok($$ select public.check_out_visit('10000000-0000-0000-0000-00000000000a',
  (select id from public.visits limit 1)) $$,
  'A visita não está em andamento.', 'check-out repetido recusado');

-- ---------------------------------------------------------------- cancelar / antes do horario
insert into tests.vars
select 'visit2', (public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Joao Futuro',
  now() + interval '2 hours', now() + interval '3 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]))::text;
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, %L, 'v1') $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit2')),
  'Convite inválido, expirado ou fora do horário.', 'check-in antes do horario recusado');
select lives_ok(format($$ select public.cancel_visit('10000000-0000-0000-0000-00000000000a', %L) $$,
  (select v::jsonb ->> 'id' from tests.vars where k = 'visit2')::uuid), 'cancelar convite');
select throws_ok(format($$ select public.cancel_visit('10000000-0000-0000-0000-00000000000a', %L) $$,
  (select v::jsonb ->> 'id' from tests.vars where k = 'visit2')::uuid),
  'Só convites ainda não utilizados podem ser cancelados.', 'cancelamento so de convite pendente');
select throws_ok(format($$ select public.check_in_visit('10000000-0000-0000-0000-00000000000a', null, %L, 'v1') $$,
  (select v::jsonb ->> 'token' from tests.vars where k = 'visit2')),
  'Convite inválido, expirado ou fora do horário.', 'convite cancelado nao faz check-in');

-- ---------------------------------------------------------------- expiracao
insert into tests.vars
select 'visit3', (public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Ana Em Andamento', now() - interval '1 minute', now() + interval '2 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]))::text;
insert into tests.vars
select 'visit4', (public.create_visit(
  '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'Pedro Pendente', now() - interval '1 minute', now() + interval '2 hours',
  array['30000000-0000-0000-0000-00000000000a']::uuid[]))::text;
select public.check_in_visit('10000000-0000-0000-0000-00000000000a',
  (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'visit3'), null, 'v1');
select throws_ok($$ select public.expire_due_visits() $$, '42501', null, 'usuario nao executa a expiracao');

reset role;
update public.visits set valid_from = now() - interval '3 hours', valid_until = now() - interval '1 hour'
 where id in (select (v::jsonb ->> 'id')::uuid from tests.vars where k in ('visit3', 'visit4'));
set local role service_role;
select is(public.expire_due_visits(), 2, 'expiracao em lote');
reset role;
select is((select status::text from public.visits
            where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'visit3')),
  'expired', 'visita em andamento expira');
select is((select status::text from public.credentials
            where id = (select credential_id from public.visits
                         where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'visit3'))),
  'revoked', 'expiracao revoga a credencial');
select is((select status::text from public.visits
            where id = (select (v::jsonb ->> 'id')::uuid from tests.vars where k = 'visit4')),
  'expired', 'convite nao usado expira');
select is(public.expire_due_visits(), 0, 'expiracao idempotente');

-- ---------------------------------------------------------------- auditoria sem dado pessoal
select is((select count(*)::int from public.audit_log
            where resource_type = 'visits' and tenant_id = '10000000-0000-0000-0000-00000000000a'
              and (metadata::text ilike '%Maria%' or metadata::text ilike '%ABC1D23%'
                   or metadata::text ilike '%1234%' or metadata::text ilike '%Empresa X%'
                   or metadata::text ilike '%token%')),
  0, 'auditoria de visita sem nome, placa, documento, empresa ou token');
select ok((select count(*) from public.audit_log where resource_type = 'visits' and action = 'visits.update') > 0,
  'mudancas de estado auditadas');

select * from finish();
rollback;
