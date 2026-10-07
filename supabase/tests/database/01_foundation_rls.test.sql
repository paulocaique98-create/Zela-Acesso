-- Fase 1: RLS, RBAC, isolamento entre tenants, hierarquia de papeis e auditoria.
-- Dados 100% sinteticos. Tudo roda em transacao e e revertido no final.
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

-- ---------------------------------------------------------------- fixtures (como postgres)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a-admin@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-security@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'a-scoped@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a8', 'a-newhire@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'platform-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform-support@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@example.test');

insert into public.platform_admins (user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'platform_owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform_support');

insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');

insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Alfa Sede'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Alfa Filial'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Beta Sede');

insert into public.memberships (tenant_id, user_id, role, scope_site_ids) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'organization_admin', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'security_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'receptionist', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'viewer', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a6', 'viewer',
     array['20000000-0000-0000-0000-0000000000a1']::uuid[]),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'auditor', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);

-- ---------------------------------------------------------------- anon: nada
select tests.login('00000000-0000-0000-0000-0000000000a1'); reset role;
set local role anon;
select throws_ok($$select id from public.tenants$$, '42501', null, 'anon nao le tenants');
select throws_ok($$select id from public.memberships$$, '42501', null, 'anon nao le memberships');
select throws_ok($$select id from public.sites$$, '42501', null, 'anon nao le sites');
select throws_ok($$select id from public.audit_log$$, '42501', null, 'anon nao le audit_log');
select throws_ok(
  $$select public.create_tenant('X Tenant', 'x-tenant', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'anon nao executa create_tenant');
reset role;

-- ---------------------------------------------------------------- isolamento cross-tenant
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.tenants), 1, 'owner B ve apenas o proprio tenant');
select is((select slug from public.tenants), 'beta', 'tenant visivel e o B');
select is((select count(*)::int from public.sites), 1, 'owner B ve apenas sites do B');
select is((select count(*)::int from public.memberships where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'owner B nao ve memberships do A');
select is((select count(*)::int from public.audit_log where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'owner B nao ve auditoria do A');
select is((select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'owner B nao ve perfil de usuario do A');
select throws_ok(
  $$insert into public.sites (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Invasao')$$,
  '42501', null, 'owner B nao insere site no A');
with u as (update public.sites set name = 'Hackeado' where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera sites do A');
with d as (delete from public.sites where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from d), 0, 'owner B nao apaga sites do A');
with u as (update public.tenants set name = 'Hackeado' where id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera tenant A');
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'viewer')$$,
  '42501', null, 'owner B nao cria membership no A');
reset role;
select is((select count(*)::int from public.sites where name = 'Hackeado'), 0, 'nenhum site do A foi alterado');
select is((select name from public.tenants where slug = 'alfa'), 'Tenant Alfa', 'tenant A intacto');

-- usuario sem membership
select tests.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.tenants), 0, 'sem membership: nenhum tenant');
select is((select count(*)::int from public.sites), 0, 'sem membership: nenhum site');
select is((select count(*)::int from public.audit_log), 0, 'sem membership: nenhuma auditoria');
reset role;

-- ---------------------------------------------------------------- matriz de papeis (tenant A)
select tests.login('00000000-0000-0000-0000-0000000000a5'); -- viewer
select is((select count(*)::int from public.sites), 2, 'viewer le os 2 sites');
select throws_ok(
  $$insert into public.sites (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Nova')$$,
  '42501', null, 'viewer nao cria site');
select is((select count(*)::int from public.memberships), 1, 'viewer ve apenas a propria membership');
select is((select count(*)::int from public.audit_log), 0, 'viewer nao le auditoria');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4'); -- receptionist
select is((select count(*)::int from public.sites), 2, 'receptionist le sites');
select is((select count(*)::int from public.memberships), 1, 'receptionist nao lista membros');
with u as (update public.sites set name = 'X Rename' where id = '20000000-0000-0000-0000-0000000000a1' returning 1)
select is((select count(*)::int from u), 0, 'receptionist nao edita site');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3'); -- security_manager
select lives_ok(
  $$insert into public.sites (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Alfa Anexo')$$,
  'security_manager cria site');
select is((select count(*)::int from public.audit_log where action = 'sites.insert' and metadata ->> 'name' = 'Alfa Anexo'), 1,
  'criacao de site gerou auditoria visivel a security_manager');
select is((select count(*)::int from public.memberships), 7, 'security_manager lista os 7 membros do A');
with d as (delete from public.sites where name = 'Alfa Anexo' returning 1)
select is((select count(*)::int from d), 0, 'security_manager nao apaga site (sem site:delete)');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a7'); -- auditor
select ok((select count(*) from public.audit_log) > 0, 'auditor le auditoria');
select throws_ok(
  $$insert into public.sites (tenant_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Auditor Site')$$,
  '42501', null, 'auditor nao escreve');
reset role;

-- ---------------------------------------------------------------- escopo por site
select tests.login('00000000-0000-0000-0000-0000000000a6'); -- viewer restrito ao site a1
select is((select count(*)::int from public.sites), 1, 'viewer escopado ve so 1 site');
select is((select name from public.sites), 'Alfa Sede', 'o site visivel e o do escopo');
select is((select count(*)::int from public.tenants), 1, 'viewer escopado ainda ve o proprio tenant');
select is((select count(*)::int from public.audit_log), 0, 'viewer escopado sem auditoria');
reset role;

-- ---------------------------------------------------------------- hierarquia / escalonamento
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- organization_admin
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a8', 'organization_admin')$$,
  '42501', null, 'admin nao cria outro admin');
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a8', 'organization_owner')$$,
  '42501', null, 'admin nao cria owner');
select lives_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a8', 'viewer')$$,
  'admin cria viewer');
select throws_ok(
  $$update public.memberships set role = 'organization_owner' where user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  '42501', null, 'admin nao se promove');
select throws_ok(
  $$update public.memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'admin nao rebaixa owner');
select throws_ok(
  $$delete from public.memberships where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'admin nao remove owner');
select throws_ok(
  $$delete from public.memberships where user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  '42501', null, 'admin nao se remove');
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'viewer')$$,
  '42501', null, 'admin do A nao cria membership no B');
select throws_ok(
  $$update public.memberships set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where user_id = '00000000-0000-0000-0000-0000000000a5'$$,
  '42501', null, 'admin nao move membership para outro tenant');
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role, scope_site_ids)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'viewer',
            array['20000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  '23514', null, 'escopo com site de outro tenant e recusado');
reset role;

-- owner: pode promover a admin, mas nao mexer na propria membership
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$update public.memberships set role = 'organization_admin' where user_id = '00000000-0000-0000-0000-0000000000a8'$$,
  'owner promove viewer a admin');
select throws_ok(
  $$update public.memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner nao altera a propria membership');
select lives_ok(
  $$update public.tenants set name = 'Tenant Alfa Renomeado' where id = '10000000-0000-0000-0000-00000000000a'$$,
  'owner renomeia o tenant');
select throws_ok(
  $$update public.tenants set status = 'suspended' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'owner nao suspende o proprio tenant');
select throws_ok(
  $$update public.tenants set slug = 'outro' where id = '10000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'slug e imutavel');
select throws_ok(
  $$select public.create_tenant('Invasor Tenant', 'invasor', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'owner de tenant nao cria tenants');
reset role;

-- ultimo owner protegido mesmo fora da API
select throws_ok(
  $$update public.memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-0000000000b1'$$,
  '23514', null, 'ultimo owner nao pode ser rebaixado');
select throws_ok(
  $$delete from public.memberships where user_id = '00000000-0000-0000-0000-0000000000b1'$$,
  '23514', null, 'ultimo owner nao pode ser removido');

-- ---------------------------------------------------------------- plataforma
select tests.login('00000000-0000-0000-0000-0000000000c2'); -- platform_support
select is((select count(*)::int from public.tenants where slug in ('alfa', 'beta')), 2, 'platform_support lista tenants (independe do seed)');
select is((select count(*)::int from public.sites), 0, 'platform_support nao le dados de site');
select is((select count(*)::int from public.audit_log), 0, 'platform_support nao le auditoria do tenant');
with u as (update public.tenants set name = 'Hack' where slug = 'beta' returning 1)
select is((select count(*)::int from u), 0, 'platform_support nao altera tenants');
select throws_ok(
  $$select public.create_tenant('Suporte Tenant', 'suporte', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'platform_support nao cria tenant');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1'); -- platform_owner
select is((select public.create_tenant('Tenant Gama', 'gama', '00000000-0000-0000-0000-0000000000d1') is not null),
  true, 'platform_owner cria tenant');
select lives_ok(
  $$update public.tenants set status = 'suspended' where slug = 'beta'$$,
  'platform_owner suspende tenant');
reset role;
select is((select count(*)::int from public.memberships m join public.tenants t on t.id = m.tenant_id
  where t.slug = 'gama' and m.role = 'organization_owner'), 1, 'tenant Gama nasceu com 1 owner');
select is((select count(*)::int from public.audit_log where action = 'tenants.insert' and metadata ->> 'name' = 'Tenant Gama'),
  1, 'criacao do tenant Gama foi auditada');
select is((select actor_user_id from public.audit_log where action = 'tenants.insert' and metadata ->> 'name' = 'Tenant Gama'),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'auditoria registra o ator (platform_owner)');

-- tenant suspenso perde acesso
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.tenants), 0, 'tenant suspenso: owner nao ve nada');
select is((select count(*)::int from public.sites), 0, 'tenant suspenso: sem sites');
reset role;

-- ---------------------------------------------------------------- auditoria append-only
select throws_ok($$update public.audit_log set action = 'x'$$, '42501', null, 'audit_log: UPDATE bloqueado (postgres)');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'audit_log: DELETE bloqueado (postgres)');
select throws_ok($$truncate public.audit_log$$, '42501', null, 'audit_log: TRUNCATE bloqueado (postgres)');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$insert into public.audit_log (tenant_id, action, resource_type) values ('10000000-0000-0000-0000-00000000000a', 'forjado', 'x')$$,
  '42501', null, 'usuario nao insere em audit_log');
select throws_ok($$update public.audit_log set action = 'x'$$, '42501', null, 'usuario nao altera audit_log');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'usuario nao apaga audit_log');
select ok((select count(*) from public.audit_log) > 0, 'owner A le a auditoria do proprio tenant');
select is((select count(*)::int from public.audit_log where tenant_id <> '10000000-0000-0000-0000-00000000000a'),
  0, 'owner A nao ve auditoria de outro tenant');
reset role;

-- ---------------------------------------------------------------- RBAC: matriz minima
-- Fase 1: 33; 2A soma 51 = 84; painel do Dev soma 4 (support) = 88; 2B soma 14 (credential) = 102; 2B-janelas soma 15 (schedule) = 117; 2C-pontos soma 16 (access_point) = 133; 2D-politicas soma 12 (policy) = 145; 3C-eventos soma 7 (access_event) = 152; 3D-presenca soma 7 (presence) = 159; 4A-agentes soma 11 (edge_agent) = 170; 5A-visitas soma 19 (visit) = 189; 6A-alertas soma 8 (alert) = 197; 7C-biometria soma 11 (biometric) = 208.
select is((select count(*)::int from public.role_permissions), 208, 'matriz tem 208 permissoes (drift: atualizar domain/rbac.js)');
select is((select count(*)::int from public.role_permissions where role = 'viewer' and permission not in ('site:read', 'zone:read')),
  0, 'viewer so tem site:read e zone:read');

-- ---------------------------------------------------------------- privilegios por coluna (ataques de movimentacao/forja)
-- a1 e dono do A e tambem administrador do B (fixture): cenario classico de "mover" dados entre tenants.
insert into public.memberships (tenant_id, user_id, role)
  values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'organization_admin');
-- tenant B foi suspenso mais acima; reativa so para este bloco
update public.tenants set status = 'active' where slug = 'beta';

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$update public.sites set tenant_id = '10000000-0000-0000-0000-00000000000b'
    where id = '20000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'nao move site entre tenants (tenant_id sem privilegio de UPDATE)');
select throws_ok(
  $$insert into public.memberships (tenant_id, user_id, role, created_by)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'viewer',
            '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'nao forja created_by');
select throws_ok(
  $$update public.profiles set user_id = '00000000-0000-0000-0000-0000000000b1'
    where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'nao altera user_id do perfil');
select lives_ok(
  $$update public.profiles set display_name = 'Nome Novo' where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'altera o proprio display_name');
select throws_ok(
  $$update public.sites set id = gen_random_uuid() where id = '20000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'nao altera id do site');
reset role;

-- helpers internos nao sao acessiveis a anon
set local role anon;
select throws_ok(
  $$select app_private.has_permission('10000000-0000-0000-0000-00000000000a', 'site:read', null)$$,
  '42501', null, 'anon nao executa helpers de app_private');
reset role;

select * from finish();
rollback;
