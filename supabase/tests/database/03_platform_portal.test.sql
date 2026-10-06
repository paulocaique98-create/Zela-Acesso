-- Painel do Desenvolvedor: platform_create_tenant e limites do platform_support. Dados sinteticos; reverte no final.
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
  ('00000000-0000-0000-0000-0000000000c1', 'platform-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform-support@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'novo-dono@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'comum@example.test');
insert into public.platform_admins (user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'platform_owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform_support');

-- anon nao executa
set local role anon;
select throws_ok($$select public.platform_create_tenant('X Org', 'x-org', null, 'novo-dono@example.test', null)$$,
  '42501', null, 'anon nao executa platform_create_tenant');
reset role;

-- usuario comum e platform_support: negado
select tests.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.platform_create_tenant('X Org', 'x-org', null, 'novo-dono@example.test', null)$$,
  '42501', null, 'usuario comum nao cria organizacao');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.platform_create_tenant('X Org', 'x-org', null, 'novo-dono@example.test', null)$$,
  '42501', null, 'platform_support nao cria organizacao');
reset role;

-- platform_owner: cria, e-mail case-insensitive, dono vira organization_owner
select tests.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.platform_create_tenant('Org Nova', 'org-nova', null, ' Novo-Dono@Example.test ', null)$$,
  'platform_owner cria organizacao pelo e-mail do dono (RPC platform_create_tenant)');
select throws_ok($$select public.platform_create_tenant('Org Fantasma', 'org-fantasma', null, 'ninguem@example.test', null)$$,
  '23503', null, 'e-mail inexistente: rejeitado');
select throws_ok($$select public.platform_create_tenant('Org Nova 2', 'org-nova', null, 'novo-dono@example.test', null)$$,
  '23505', null, 'slug duplicado: rejeitado');
select is((select count(*)::int from public.tenants where slug = 'org-fantasma'), 0,
  'falha nao deixa organizacao parcial');
-- suspender e reativar (so owner)
select lives_ok($$update public.tenants set status = 'suspended' where slug = 'org-nova'$$, 'owner suspende');
select is((select status::text from public.tenants where slug = 'org-nova'), 'suspended', 'status suspenso');
select lives_ok($$update public.tenants set status = 'active' where slug = 'org-nova'$$, 'owner reativa');
reset role;

select is((select role::text from public.memberships m join public.tenants t on t.id = m.tenant_id
  where t.slug = 'org-nova' and m.user_id = '00000000-0000-0000-0000-0000000000e1'),
  'organization_owner', 'dono indicado e organization_owner');

-- platform_support: lista, nao altera status
select tests.login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.tenants where slug = 'org-nova'), 1, 'platform_support lista a organizacao');
with u as (update public.tenants set status = 'suspended' where slug = 'org-nova' returning 1)
select is((select count(*)::int from u), 0, 'platform_support nao altera status');
reset role;

-- auditoria registra a criacao
select is((select count(*)::int from public.audit_log where action = 'tenants.insert'
  and metadata ->> 'name' = 'Org Nova'), 1, 'auditoria registra a criacao da organizacao');

select * from finish();
rollback;
