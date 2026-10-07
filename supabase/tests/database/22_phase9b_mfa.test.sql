-- Fase 9B: MFA (AAL2) exigido por organizacao para papeis administrativos e, opcionalmente, para a plataforma.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'hr_manager'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.platform_admins (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'platform_owner');

select is((select mfa_required from public.tenants where slug = 'alfa'), false, 'exigencia desligada por padrao');
select is((select mfa_required_for_staff from public.platform_security), false, 'plataforma: desligada por padrao');

-- ------------------------------------------------------------ desligado: comportamento anterior
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select ok(app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'person:read'),
  'sem exigencia, aal1 funciona');
select throws_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'ligar exige sessao aal2');

-- ------------------------------------------------------------ ligar com aal2
select tests.login('00000000-0000-0000-0000-0000000000a2', 'aal2');
select throws_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'recepcao nao altera a exigencia');
select tests.login('00000000-0000-0000-0000-0000000000b1', 'aal2');
select throws_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'outro tenant nao altera a exigencia');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select lives_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', true)$$,
  'owner em aal2 liga a exigencia');
select is((select count(*) from public.audit_log where action = 'tenant.mfa_required'), 1::bigint, 'auditado');

-- ------------------------------------------------------------ ligado: aal1 perde as permissoes administrativas
select ok(app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'person:read'), 'owner aal2 mantem acesso');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal1');
select ok(not app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'person:read'),
  'owner aal1 perde a permissao');
select is((select count(*) from public.people), 0::bigint, 'RLS nega dados a owner aal1');
select throws_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', false)$$,
  '42501', null, 'owner aal1 nao desliga a exigencia');
select tests.login('00000000-0000-0000-0000-0000000000a3', 'aal1');
select ok(not app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'person:read'),
  'RH aal1 tambem perde');
select tests.login('00000000-0000-0000-0000-0000000000a2', 'aal1');
select ok(app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'visit:read'),
  'recepcao nao e sujeita a exigencia');
select tests.login('00000000-0000-0000-0000-0000000000b1', 'aal1');
select ok(app_private.has_permission('10000000-0000-0000-0000-00000000000b', 'person:read'),
  'outra organizacao nao e afetada');
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
select lives_ok($$select public.set_tenant_mfa_required('10000000-0000-0000-0000-00000000000a', false)$$,
  'owner aal2 desliga');

-- ------------------------------------------------------------ plataforma
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal1');
select ok(app_private.is_platform_owner(), 'plataforma aal1 funciona enquanto desligado');
reset role;
update public.platform_security set mfa_required_for_staff = true;
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal1');
select ok(not app_private.is_platform_owner() and not app_private.is_platform_admin(), 'plataforma aal1 negada');
select tests.login('00000000-0000-0000-0000-0000000000c1', 'aal2');
select ok(app_private.is_platform_owner() and app_private.is_platform_admin(), 'plataforma aal2 permitida');
select throws_ok($$update public.platform_security set mfa_required_for_staff = false$$, '42501', null,
  'cliente nao altera a flag da plataforma');

select * from finish();
rollback;
