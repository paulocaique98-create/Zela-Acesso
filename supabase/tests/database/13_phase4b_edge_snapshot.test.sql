-- Fase 4B: snapshot de cache do Edge Agent (escopo por sitio/tenant, so hashes, revogados fora, hash estavel, auth).
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
insert into public.sites (id, tenant_id, name, timezone) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A', 'America/Manaus'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Filial A', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B', 'America/Sao_Paulo');

-- Sitio A: zona, ponto, grupo, janela, politica. Sitio A2 (mesmo tenant): zona/ponto/politica que NAO podem vazar.
insert into public.zones (id, tenant_id, site_id, name, antipassback_mode, antipassback_reset_minutes) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Hall', 'soft', 60),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'Hall filial', 'off', null),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Hall B', 'off', null);
insert into public.access_points (id, tenant_id, site_id, zone_id, name, direction, offline_behavior) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', 'Porta 1', 'entry', 'degraded_allow'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   '30000000-0000-0000-0000-0000000000a2', 'Porta filial', 'bidirectional', 'degraded_deny');
insert into public.access_groups (id, tenant_id, name) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Equipe'),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Outra equipe'),
  ('50000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Equipe B');
insert into public.holiday_calendars (id, tenant_id, name) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Nacional');
insert into public.holidays (tenant_id, calendar_id, holiday_date, name) values
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '2026-12-25', 'Natal');
insert into public.access_schedules (id, tenant_id, name, holiday_calendar_id) values
  ('70000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Comercial', '60000000-0000-0000-0000-00000000000a'),
  ('70000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'So da filial', null);
insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time) values
  ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', 1, '08:00', '18:00');
insert into public.access_policies (id, tenant_id, site_id, name, group_id, zone_id, effect, schedule_id, status) values
  ('80000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Equipe no hall', '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'allow',
   '70000000-0000-0000-0000-00000000000a', 'active'),
  ('80000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Inativa', '50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'allow', null, 'inactive'),
  ('80000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2',
   'Politica da filial', '50000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a2', 'allow',
   '70000000-0000-0000-0000-0000000000a2', 'active');
-- Pessoas: ana (membro + PIN ativo + cartao), bob (cartao revogado so), cris (grupo da filial), beto (tenant B).
insert into public.people (id, tenant_id, full_name, status) values
  ('90000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Ana Segredo', 'active'),
  ('90000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Bob Revogado', 'active'),
  ('90000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'Cris Filial', 'active'),
  ('90000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Beto Outro', 'active');
insert into public.access_group_members (tenant_id, group_id, person_id) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000a2', '90000000-0000-0000-0000-0000000000a3'),
  ('10000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', '90000000-0000-0000-0000-0000000000b1');
insert into public.credentials (id, tenant_id, person_id, type, status, secret_hash, identifier_hash, expires_at, revoked_at) values
  ('a0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a1',
   'pin', 'active', '$2a$10$hashdepinsintetico', null, null, null),
  ('a0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a1',
   'card', 'suspended', null, 'cardhashsintetico', null, null),
  ('a0000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a2',
   'card', 'revoked', null, 'cardrevogado', null, now()),
  ('a0000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a3',
   'pin', 'active', '$2a$10$outrohash', null, null, null),
  ('a0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '90000000-0000-0000-0000-0000000000b1',
   'pin', 'active', '$2a$10$hashtenantb', null, null, null);

-- agentes: A no sitio A, B no sitio B
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

-- ---------------------------------------------------------------- permissoes da funcao
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))$$,
  '42501', null, 'usuario autenticado nao chama o snapshot');
reset role;

-- ---------------------------------------------------------------- autenticacao
set local role service_role;
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), 'zes_errado'), null, 'segredo errado = null');
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), null), null, 'segredo nulo = null');
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secB')), null,
  'segredo de outro agente nao serve');
insert into tests.vars select 'snapA', public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))::text;
insert into tests.vars select 'snapB', public.edge_pull_snapshot((select v::uuid from tests.vars where k='idB'), (select v from tests.vars where k='secB'))::text;
reset role;

-- ---------------------------------------------------------------- escopo do agente A
select is((select (v::jsonb)->'snapshot'->>'siteId' from tests.vars where k='snapA'), '20000000-0000-0000-0000-00000000000a', 'snapshot do sitio do agente');
select is((select (v::jsonb)->'snapshot'->>'timezone' from tests.vars where k='snapA'), 'America/Manaus', 'fuso do sitio');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'zones') from tests.vars where k='snapA'), 1, 'so a zona do sitio (sem filial/outro tenant)');
select is((select (v::jsonb)->'snapshot'->'zones'->0->>'antipassbackMode' from tests.vars where k='snapA'), 'soft', 'modo anti-passback na zona');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'accessPoints') from tests.vars where k='snapA'), 1, 'so o ponto do sitio');
select is((select (v::jsonb)->'snapshot'->'accessPoints'->0->>'offlineBehavior' from tests.vars where k='snapA'), 'degraded_allow', 'comportamento offline do ponto');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'policies') from tests.vars where k='snapA'), 1, 'so politica ativa do sitio');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'schedules') from tests.vars where k='snapA'), 1, 'so janela usada por politica do sitio');
select is((select (v::jsonb)->'snapshot'->'schedules'->0->'windows'->0->>'start' from tests.vars where k='snapA'), '08:00:00', 'janela com horario');
select is((select (v::jsonb)->'snapshot'->'schedules'->0->'holidayDates'->>0 from tests.vars where k='snapA'), '2026-12-25', 'feriados da janela');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'groupMembers') from tests.vars where k='snapA'), 1, 'so membros de grupos das politicas do sitio');

-- credenciais: tenant inteiro (A), sem revogadas, sem outro tenant, so hash
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'credentials') from tests.vars where k='snapA'), 3,
  'credenciais nao revogadas do tenant A (pin, cartao suspenso, pin da filial)');
select is((select count(*)::int from tests.vars where k='snapA' and v like '%cardrevogado%'), 0, 'credencial revogada nao sai');
select is((select count(*)::int from tests.vars where k='snapA' and v like '%hashtenantb%'), 0, 'credencial do tenant B nao vaza');
select is((select count(*)::int from tests.vars where k='snapA' and (v like '%Ana Segredo%' or v like '%Bob%' or v like '%Cris%')), 0,
  'snapshot nao leva nome de pessoa');
select is((select count(*)::int from tests.vars where k='snapA' and (v like '%Beto%' or v like '%Hall B%' or v like '%Politica da filial%')),
  0, 'nada do tenant B nem da filial');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'people') from tests.vars where k='snapA'), 2,
  'pessoas com credencial viva (Bob so tem revogada)');

-- ---------------------------------------------------------------- tenant B isolado
select is((select (v::jsonb)->'snapshot'->>'tenantId' from tests.vars where k='snapB'), '10000000-0000-0000-0000-00000000000b', 'B recebe so o tenant B');
select is((select count(*)::int from tests.vars where k='snapB' and v like '%hashdepinsintetico%'), 0, 'B nao recebe credencial de A');
select is((select jsonb_array_length((v::jsonb)->'snapshot'->'credentials') from tests.vars where k='snapB'), 1, 'B recebe 1 credencial');

-- ---------------------------------------------------------------- hash estavel e "unchanged"
set local role service_role;
select is(((select v::jsonb from tests.vars where k='snapA')->>'unchanged'), 'false', 'primeiro pull traz o snapshot');
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select (v::jsonb)->>'hash' from tests.vars where k='snapA'))->>'unchanged', 'true', 'mesmo hash = unchanged');
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select (v::jsonb)->>'hash' from tests.vars where k='snapA')) ? 'snapshot', false, 'unchanged nao reenvia o corpo');
reset role;

-- revogacao propaga: revogar a credencial muda o hash e some do snapshot
update public.credentials set status = 'revoked', revoked_at = now() where id = 'a0000000-0000-0000-0000-0000000000a1';
set local role service_role;
select isnt(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'),
  (select (v::jsonb)->>'hash' from tests.vars where k='snapA'))->>'unchanged', 'true', 'mudanca de dado muda o hash');
select is((public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA'))
  ->'snapshot'->'credentials')::text like '%hashdepinsintetico%', false, 'credencial revogada sai do snapshot');
reset role;

select isnt((select last_snapshot_at from public.edge_agents where name = 'Agente A'), null, 'registra ultimo snapshot');

-- agente revogado nao recebe
select tests.login('00000000-0000-0000-0000-0000000000a1');
select * from public.revoke_edge_agent((select v::uuid from tests.vars where k='idA'), 'teste de revogacao');
reset role;
set local role service_role;
select is(public.edge_pull_snapshot((select v::uuid from tests.vars where k='idA'), (select v from tests.vars where k='secA')), null,
  'agente revogado nao recebe snapshot');
reset role;

select * from finish();
rollback;
