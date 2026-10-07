-- Fase 3D: anti-passback (modo na zona, presenca server-side, ordem de eventos, reset auditado, RLS cross-tenant).
-- Dados sinteticos; tudo e revertido.
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
  ('00000000-0000-0000-0000-0000000000a2', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'auditor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');
insert into public.zones (id, tenant_id, site_id, name, antipassback_mode, antipassback_reset_minutes) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'Garagem', 'hard', 60),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'Garagem B', 'soft', null);
insert into public.people (id, tenant_id, full_name) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Pessoa A'),
  ('40000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'Pessoa A2'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Pessoa B');
insert into public.access_points (id, tenant_id, site_id, zone_id, name, direction) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Cancela entrada', 'entry');

-- contexto do motor (service_role)
set local role service_role;
select is((select state from public.get_antipassback_context('10000000-0000-0000-0000-00000000000a',
  '50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a')), 'unknown', 'sem linha => unknown');
select is((select mode::text || '/' || direction::text || '/' || reset_minutes from public.get_antipassback_context('10000000-0000-0000-0000-00000000000a',
  '50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a')), 'hard/entry/60', 'modo, sentido e reset vem da zona/ponto');
select is_empty($$select 1 from public.get_antipassback_context('10000000-0000-0000-0000-00000000000b',
  '50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b')$$, 'ponto de outro tenant nao resolve');

-- gravacao e ordem
select is(public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'present', '2026-10-07 12:00:00+00'), true, 'grava presenca');
select is((select state from public.get_antipassback_context('10000000-0000-0000-0000-00000000000a',
  '50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a')), 'present', 'contexto reflete presenca');
select is(public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'absent', '2026-10-07 11:00:00+00'), false, 'evento mais antigo nao regride o estado');
select is((select state from public.presence_states where person_id = '40000000-0000-0000-0000-00000000000a'), 'present', 'estado permanece');
select is(public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'absent', '2026-10-07 13:00:00+00'), true, 'evento mais novo atualiza');
select throws_ok($$select public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'unknown', now())$$, '22023', null, 'unknown nao e gravavel pelo motor');
select throws_ok($$select public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000b',
  '40000000-0000-0000-0000-00000000000a', 'present', now())$$, 'P0002', null, 'zona de outro tenant rejeitada');
select throws_ok($$select public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000b', 'present', now())$$, '23503', null, 'pessoa de outro tenant rejeitada (FK composta)');
select lives_ok($$select public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000c', 'present', '2026-10-07 12:00:00+00')$$, 'segunda pessoa');
reset role;

-- usuarios comuns nao executam as funcoes do motor
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.commit_presence('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'present', now())$$, '42501', null, 'owner nao grava presenca direto');
select throws_ok($$select * from public.get_antipassback_context('10000000-0000-0000-0000-00000000000a',
  '50000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a')$$, '42501', null, 'owner nao chama o contexto do motor');
select throws_ok($$insert into public.presence_states (tenant_id, site_id, zone_id, person_id, state, since)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-00000000000a', 'absent', now())$$, '42501', null, 'sem INSERT direto');
select is((select count(*)::int from public.presence_states), 2, 'owner le a presenca do proprio tenant');
select lives_ok($$update public.zones set antipassback_mode = 'soft' where id = '30000000-0000-0000-0000-00000000000a'$$, 'owner altera o modo da zona');
select throws_ok($$update public.zones set antipassback_mode = 'x' where id = '30000000-0000-0000-0000-00000000000a'$$, '22P02', null, 'modo invalido rejeitado');
select throws_ok($$update public.zones set antipassback_reset_minutes = 0 where id = '30000000-0000-0000-0000-00000000000a'$$, '23514', null, 'reset fora da faixa rejeitado');
reset role;

-- reset administrativo
select tests.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.presence_states), 0, 'viewer nao ve presenca');
select throws_ok($$select public.reset_presence('30000000-0000-0000-0000-00000000000a', null, 'tentativa indevida')$$, 'P0002', null, 'viewer nao enxerga a zona');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.presence_states), 2, 'auditor le a presenca');
select throws_ok($$select public.reset_presence('30000000-0000-0000-0000-00000000000a', null, 'auditor tentando')$$, '42501', null, 'auditor nao redefine');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.presence_states), 0, 'outro tenant nao ve a presenca');
select throws_ok($$select public.reset_presence('30000000-0000-0000-0000-00000000000a', null, 'cross-tenant tentando')$$, 'P0002', null, 'cross-tenant nao redefine');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.reset_presence('30000000-0000-0000-0000-00000000000a', null, 'abc')$$, '22023', null, 'justificativa curta rejeitada');
select is(public.reset_presence('30000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'cartao perdido na saida'), 1, 'reset de uma pessoa');
select is((select state from public.presence_states where person_id = '40000000-0000-0000-0000-00000000000a'), 'unknown', 'pessoa voltou a unknown');
select is((select state from public.presence_states where person_id = '40000000-0000-0000-0000-00000000000c'), 'present', 'outra pessoa intacta');
select is(public.reset_presence('30000000-0000-0000-0000-00000000000a', null, 'reset geral da zona'), 1, 'reset da zona (so o que nao era unknown)');
reset role;

select is((select count(*)::int from public.audit_log where action = 'presence.reset' and tenant_id = '10000000-0000-0000-0000-00000000000a'), 2, 'resets auditados');
select is((select reason from public.audit_log where action = 'presence.reset' order by created_at limit 1), 'cartao perdido na saida', 'auditoria guarda a justificativa');

-- apagar zona/pessoa leva o estado derivado junto
delete from public.people where id = '40000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.presence_states where person_id = '40000000-0000-0000-0000-00000000000c'), 0, 'estado removido com a pessoa');

select * from finish();
rollback;
