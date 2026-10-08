-- Fase 9B (fechamento): codigos de recuperacao do MFA, auditoria de fator removido e flag da plataforma.
-- Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;
create function tests.login(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
end $$;
grant execute on function tests.login(uuid, text) to authenticated, anon;
create table tests.codes (codes text[]);
grant all on tests.codes to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a-other@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'support@example.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'f1', 'totp', 'verified', now(), now()),
  ('20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', 'f2', 'totp', 'verified', now(), now());
insert into public.platform_admins (user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'platform_owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform_support');

-- ------------------------------------------------------------ gerar codigos
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select throws_ok($$select public.generate_mfa_recovery_codes()$$, '42501', null, 'gerar exige aal2');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into tests.codes select public.generate_mfa_recovery_codes();
select is((select cardinality(codes) from tests.codes), 8, 'gera 8 codigos');
select ok((select bool_and(c ~ '^[A-HJ-NP-Z2-9]{10}$') from tests.codes, unnest(codes) c), 'formato sem ambiguidade');
select is(public.mfa_recovery_codes_remaining(), 8, 'restam 8');
select throws_ok($$select code_hash from public.mfa_recovery_codes$$, '42501', null, 'cliente nao le a tabela de codigos');
reset role;
select ok(not exists (select 1 from public.mfa_recovery_codes mc, tests.codes t where mc.code_hash = any (t.codes)),
  'codigos nao ficam em texto puro');
select is((select count(*) from public.audit_log where action = 'auth.mfa_recovery_generated' and created_at >= now()), 1::bigint, 'geracao auditada');
select is((select count(*) from public.audit_log where metadata::text ~ (select codes[1] from tests.codes)), 0::bigint,
  'audit_log nao guarda o codigo');

-- regerar invalida os anteriores
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
create temp table old_codes as select codes from tests.codes;
delete from tests.codes;
insert into tests.codes select public.generate_mfa_recovery_codes();
select is(public.mfa_recovery_codes_remaining(), 8, 'regerar mantem 8');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select is(public.use_mfa_recovery_code((select codes[1] from old_codes)), false, 'codigo antigo invalido apos regerar');

-- ------------------------------------------------------------ usar codigo
select tests.login('00000000-0000-0000-0000-0000000000a2', 'aal1');
select is(public.use_mfa_recovery_code((select codes[1] from tests.codes)), false, 'codigo de outro usuario nao serve');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select is(public.use_mfa_recovery_code('AAAAAAAAAA'), false, 'codigo errado recusado');
select is(public.use_mfa_recovery_code((select codes[1] from tests.codes)), true, 'codigo certo aceito (aceita minusculas/hifen)');
reset role;
select is((select count(*) from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'fatores do usuario removidos');
select is((select count(*) from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint,
  'fator de outro usuario intacto');
select is((select count(*) from public.mfa_recovery_codes where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'demais codigos apagados');
select is((select count(*) from public.audit_log where action = 'auth.mfa_recovery_used' and created_at >= now()), 1::bigint, 'uso auditado');
select is((select count(*) from public.audit_log where action = 'auth.mfa_factor_removed'
  and actor_user_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'remocao do fator auditada');
select is((select count(*) from public.audit_log where action = 'auth.mfa_recovery_failed' and created_at >= now()), 3::bigint, 'falhas auditadas');

-- ------------------------------------------------------------ bloqueio por tentativas
select tests.login('00000000-0000-0000-0000-0000000000a2', 'aal2');
select is(public.generate_mfa_recovery_codes() is not null, true, 'outro usuario gera os seus');
create temp table a2_codes as select (select array_agg(c) from unnest(public.generate_mfa_recovery_codes()) c) as codes;
select tests.login('00000000-0000-0000-0000-0000000000a2', 'aal1');
select public.use_mfa_recovery_code('BBBBBBBBBB') from generate_series(1, 5);
select is(public.use_mfa_recovery_code((select codes[1] from a2_codes)), false, 'apos 5 falhas, ate o certo e bloqueado');
reset role;
select is((select count(*) from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint,
  'bloqueado: fator preservado');

-- ------------------------------------------------------------ flag da plataforma
select tests.login('00000000-0000-0000-0000-0000000000c2', 'aal2');
select throws_ok($$select public.set_platform_mfa_required(true)$$, '42501', null, 'suporte nao altera');
select is(public.get_platform_mfa_required(), false, 'suporte le o estado');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select is(public.get_platform_mfa_required(), null, 'quem nao e da plataforma nao le');
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal1');
select throws_ok($$select public.set_platform_mfa_required(true)$$, '42501', null, 'ligar exige aal2');
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal2');
select lives_ok($$select public.set_platform_mfa_required(true)$$, 'platform_owner aal2 liga');
reset role;
select is((select mfa_required_for_staff from public.platform_security), true, 'flag ligada');
select is((select count(*) from public.audit_log where action = 'platform.mfa_required'), 1::bigint, 'alteracao auditada');
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal1');
select throws_ok($$select public.set_platform_mfa_required(false)$$, '42501', null, 'ligado: aal1 nao desliga');
select is(public.platform_mfa_required_for_me(), true, 'ligado: equipe aal1 sabe que a exigencia vale para ela');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select is(public.platform_mfa_required_for_me(), false, 'quem nao e da plataforma: nao se aplica');

select * from finish();
rollback;
