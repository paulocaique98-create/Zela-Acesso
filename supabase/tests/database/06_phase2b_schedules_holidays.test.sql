-- Fase 2B (conclusao): janelas de acesso, feriados, fuso. RLS, isolamento cross-tenant, FK composta,
-- constraints, limites, matriz de papeis e auditoria. Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function tests.login(uuid) to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-security@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000aa', 'a-installer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');

insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');

insert into public.memberships (tenant_id, user_id, role, scope_site_ids) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'security_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'receptionist', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'viewer', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'auditor', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'installer', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);

insert into public.holiday_calendars (id, tenant_id, name) values
  ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Nacional Alfa'),
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Nacional Beta');
insert into public.holidays (tenant_id, calendar_id, holiday_date, name) values
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-0000000000a1', '2026-12-25', 'Natal');
insert into public.access_schedules (id, tenant_id, name, holiday_calendar_id) values
  ('70000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Financeiro',
   '60000000-0000-0000-0000-0000000000a1'),
  ('70000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Beta Geral', null);
insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time) values
  ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 1, '07:30', '18:30');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select id from public.access_schedules$$, '42501', null, 'anon nao le janelas');
select throws_ok($$select id from public.holiday_calendars$$, '42501', null, 'anon nao le calendarios');
reset role;

-- ---------------------------------------------------------------- isolamento (owner B)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.access_schedules), 1, 'owner B ve so janelas do B');
select is((select count(*)::int from public.access_schedule_windows), 0, 'owner B nao ve janelas do A');
select is((select count(*)::int from public.holidays), 0, 'owner B nao ve feriados do A');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Invasao')$$,
  '42501', null, 'owner B nao cria janela no A');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name, holiday_calendar_id)
    values ('10000000-0000-0000-0000-00000000000b', 'Cruzada', '60000000-0000-0000-0000-0000000000a1')$$,
  '23503', null, 'FK composta: janela do B nao usa calendario do A');
select throws_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-0000000000a1', 2, '08:00', '09:00')$$,
  '23503', null, 'FK composta: janela do B nao entra em regra do A');
select throws_ok(
  $$insert into public.holidays (tenant_id, calendar_id, holiday_date, name)
    values ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-0000000000a1', '2026-01-01', 'X')$$,
  '42501', null, 'owner B nao cria feriado no A');
with u as (update public.access_schedules set name = 'Hack' where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera janelas do A');
with d as (delete from public.access_schedule_windows where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga janelas do A');
with d as (delete from public.holiday_calendars where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga calendarios do A');
reset role;
select is((select count(*)::int from public.access_schedule_windows where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  1, 'janelas do A intactas');

-- ---------------------------------------------------------------- owner A: CRUD e constraints
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$insert into public.access_schedules (tenant_id, name, valid_from, valid_until)
    values ('10000000-0000-0000-0000-00000000000a', 'Terceirizados', '2026-10-01', '2026-12-31')$$,
  'owner cria regra com vigencia');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Financeiro')$$,
  '23505', null, 'nome unico por tenant');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name, valid_from, valid_until)
    values ('10000000-0000-0000-0000-00000000000a', 'Vigencia ruim', '2026-12-31', '2026-01-01')$$,
  '23514', null, 'fim antes do inicio recusado');
select lives_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 2, '07:30', '18:30')$$,
  'owner cria janela');
select throws_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 3, '18:00', '08:00')$$,
  '23514', null, 'inicio >= fim recusado (nao atravessa meia-noite)');
select throws_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 8, '08:00', '09:00')$$,
  '23514', null, 'dia da semana fora de 1..7 recusado');
select throws_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 2, '07:30', '12:00')$$,
  '23505', null, 'janela duplicada (mesmo dia e inicio) recusada');
select throws_ok(
  $$insert into public.holidays (tenant_id, calendar_id, holiday_date, name)
    values ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-0000000000a1', '2026-12-25', 'Natal de novo')$$,
  '23505', null, 'feriado duplicado na mesma data recusado');
select lives_ok(
  $$insert into public.holidays (tenant_id, calendar_id, holiday_date, name)
    values ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-0000000000a1', '2027-01-01', 'Ano Novo')$$,
  'owner cria feriado');
select throws_ok($$update public.access_schedules set tenant_id = '10000000-0000-0000-0000-00000000000b'$$,
  '42501', null, 'tenant_id nao editavel');
select throws_ok($$update public.holidays set holiday_date = '2026-01-02'$$, '42501', null, 'data de feriado nao editavel (apaga e recria)');
select throws_ok(
  $$delete from public.holiday_calendars where id = '60000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'calendario em uso por uma regra nao e apagado');
-- fuso
select lives_ok($$update public.tenants set timezone = 'America/Manaus' where slug = 'alfa'$$, 'owner altera fuso da organizacao');
select throws_ok($$update public.tenants set timezone = 'Marte/Olimpo' where slug = 'alfa'$$, 'P0001', null, 'fuso invalido recusado');
reset role;
select is((select timezone from public.tenants where slug = 'alfa'), 'America/Manaus', 'fuso gravado');
select throws_ok(
  $$insert into public.sites (tenant_id, name, timezone) values ('10000000-0000-0000-0000-00000000000a', 'S', 'Marte/Olimpo')$$,
  'P0001', null, 'fuso invalido recusado tambem no local');

-- limites de volume (como postgres, para montar o cenario)
insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
  select '10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 4,
         (g || ' minutes')::interval::time, ((g + 1) || ' minutes')::interval::time
  from generate_series(0, 97) g;
select throws_ok(
  $$insert into public.access_schedule_windows (tenant_id, schedule_id, weekday, start_time, end_time)
    values ('10000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-0000000000a1', 5, '08:00', '09:00')$$,
  'P0001', null, 'limite de 100 janelas por regra');

-- ---------------------------------------------------------------- matriz de papeis (tenant A)
select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.access_schedules), 0, 'viewer nao le janelas');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a7');
select ok((select count(*)::int from public.access_schedules) > 0, 'auditor le janelas');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'X')$$,
  '42501', null, 'auditor nao cria');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000aa');
select ok((select count(*)::int from public.access_schedules) > 0, 'installer le janelas');
select throws_ok(
  $$insert into public.access_schedules (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'X')$$,
  '42501', null, 'installer nao cria');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4');
select ok((select count(*)::int from public.holiday_calendars) > 0, 'recepcao le calendarios');
select throws_ok(
  $$insert into public.holiday_calendars (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'X')$$,
  '42501', null, 'recepcao nao cria calendario');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$insert into public.holiday_calendars (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Estadual')$$,
  'security_manager cria calendario');
with d as (delete from public.access_schedules where name = 'Terceirizados' returning 1)
select is((select count(*)::int from d), 0, 'security_manager nao apaga regra (so owner/admin)');
reset role;

-- ---------------------------------------------------------------- auditoria e cascata
select ok((select count(*)::int from public.audit_log where action = 'access_schedules.insert'
  and tenant_id = '10000000-0000-0000-0000-00000000000a') >= 1, 'criacao de regra auditada');
select ok((select count(*)::int from public.audit_log where action = 'access_schedule_windows.insert'
  and tenant_id = '10000000-0000-0000-0000-00000000000a') >= 1, 'janela auditada');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$delete from public.access_schedules where id = '70000000-0000-0000-0000-0000000000a1'$$, 'owner apaga regra');
select is((select count(*)::int from public.access_schedule_windows where schedule_id = '70000000-0000-0000-0000-0000000000a1'),
  0, 'janelas da regra apagada somem');
select lives_ok($$delete from public.holiday_calendars where id = '60000000-0000-0000-0000-0000000000a1'$$, 'calendario livre pode ser apagado');
select is((select count(*)::int from public.holidays where calendar_id = '60000000-0000-0000-0000-0000000000a1'),
  0, 'feriados do calendario apagado somem');
reset role;

select * from finish();
rollback;
