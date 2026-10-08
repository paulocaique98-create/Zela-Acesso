-- Fase 2B: credenciais. Segredo nunca em claro, colunas de segredo ilegiveis, isolamento cross-tenant,
-- matriz de papeis, revogacao terminal, auditoria sem segredo. Dados 100% sinteticos; tudo e revertido.
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
  ('00000000-0000-0000-0000-0000000000a4', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000a7', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a9', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000aa', 'a-installer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');

insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');

insert into public.memberships (tenant_id, user_id, role, scope_site_ids) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'receptionist', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'viewer', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'auditor', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a9', 'hr_manager', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'installer', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);

insert into public.people (id, tenant_id, full_name, status) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Um', 'active'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Dois', 'active'),
  ('40000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Inativa', 'inactive'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa Beta Um', 'active');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select id from public.credentials$$, '42501', null, 'anon nao le credenciais');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'pin', '482915')$$,
  '42501', null, 'anon nao executa issue_credential');
reset role;

-- ---------------------------------------------------------------- emissao pelo owner A
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'pin', '482915', 'PIN portaria')$$,
  'owner emite PIN');
select lives_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'card', '04:A1:B2:C3', 'Cartao 1')$$,
  'owner emite cartao (varias credenciais por pessoa)');
create temp table issued (token text);
grant all on issued to authenticated;
insert into issued
  select (public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'mobile_token', null, 'Visita',
    now() + interval '2 days')) ->> 'token';
select is((select char_length(token) from issued), 64, 'token de 256 bits (64 hex) devolvido uma vez');
select is((select count(*)::int from public.credentials), 3, 'owner ve as 3 credenciais');
select is((select hint from public.credentials where type = 'card'), 'B2C3', 'cartao guarda so os 4 ultimos');

-- colunas de segredo ilegiveis e escrita direta negada
select throws_ok($$select secret_hash from public.credentials$$, '42501', null, 'secret_hash ilegivel');
select throws_ok($$select identifier_hash from public.credentials$$, '42501', null, 'identifier_hash ilegivel');
select throws_ok($$select * from public.credentials$$, '42501', null, 'select * nao vaza segredo');
select throws_ok(
  $$insert into public.credentials (tenant_id, person_id, type, secret_hash)
    values ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a2', 'pin', 'x')$$,
  '42501', null, 'insert direto negado');
select throws_ok($$update public.credentials set secret_hash = 'x'$$, '42501', null, 'secret_hash nao editavel');
select throws_ok($$update public.credentials set person_id = '40000000-0000-0000-0000-0000000000a2'$$,
  '42501', null, 'nao move credencial entre pessoas');
select throws_ok($$delete from public.credentials$$, '42501', null, 'credencial nao se apaga');

-- validacoes
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '111111')$$, 'P0001', null, 'PIN repetido recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '123456')$$, 'P0001', null, 'PIN sequencial recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '987654')$$, 'P0001', null, 'PIN sequencial descendente recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '4829')$$, 'P0001', null, 'PIN curto recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', 'abc123')$$, 'P0001', null, 'PIN nao numerico recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'pin', '735190')$$, 'P0001', null, 'segundo PIN vigente da pessoa recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', '04a1b2c3')$$, 'P0001', null, 'cartao duplicado no tenant recusado (normalizado)');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'mobile_token', null, null, null)$$, 'P0001', null, 'token sem validade recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'mobile_token', null, null, now() + interval '400 days')$$,
  'P0001', null, 'token acima de 366 dias recusado');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', '99887766', null, now() - interval '1 day')$$,
  'P0001', null, 'validade no passado recusada');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a3', 'pin', '482915')$$, 'P0001', null, 'pessoa inativa nao recebe credencial');
reset role;

-- segredo nunca em claro (como postgres)
select is((select count(*)::int from public.credentials where secret_hash = '482915'), 0, 'PIN nao esta em texto puro');
select ok((select secret_hash from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin') like '$2%', 'PIN guardado como bcrypt');
select ok(
  (select secret_hash = extensions.crypt('482915', secret_hash) from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'),
  'PIN correto confere com o hash');
select ok(
  (select not (secret_hash = extensions.crypt('482916', secret_hash)) from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'),
  'PIN errado nao confere');
select isnt((select identifier_hash from public.credentials where type = 'card'), '04A1B2C3', 'cartao nao esta em claro');
select is((select char_length(identifier_hash) from public.credentials where type = 'card'), 64, 'cartao guardado como sha256');
select is(
  (select secret_hash from public.credentials where type = 'mobile_token'),
  (select encode(extensions.digest(token, 'sha256'), 'hex') from issued),
  'token guardado como sha256 do valor entregue');
select isnt((select secret_hash from public.credentials where type = 'mobile_token'), (select token from issued),
  'token nao esta em claro');

-- ---------------------------------------------------------------- auditoria sem segredo
select is((select count(*)::int from public.audit_log where resource_type = 'credentials' and action = 'credentials.insert'
    and tenant_id = '10000000-0000-0000-0000-00000000000a'),
  3, 'emissao auditada');
select is(
  (select count(*)::int from public.audit_log
   where resource_type = 'credentials' and tenant_id = '10000000-0000-0000-0000-00000000000a'
     and (metadata::text like '%482915%' or metadata::text like '%hash%' or metadata::text like '%04A1B2C3%'
          or metadata::text like '%' || (select token from issued) || '%')),
  0, 'auditoria nao contem PIN, token, cartao nem hash');

-- ---------------------------------------------------------------- revogacao terminal
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$update public.credentials set status = 'suspended' where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'$$, 'suspende PIN');
select lives_ok($$update public.credentials set status = 'active' where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'$$, 'reativa PIN suspenso');
select lives_ok($$update public.credentials set status = 'revoked' where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'$$, 'revoga PIN');
select isnt((select revoked_at from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'), null, 'revoked_at carimbado');
select throws_ok($$update public.credentials set status = 'active' where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'$$, 'P0001', null, 'revogada nao reativa');
select throws_ok($$update public.credentials set label = 'x' where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'pin'$$, 'P0001', null, 'revogada nao se edita');
select lives_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a1', 'pin', '735190')$$, 'PIN revogado libera novo PIN');
reset role;

-- ---------------------------------------------------------------- cross-tenant (owner B)
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.credentials), 0, 'owner B nao ve credenciais do A');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '482915')$$, '42501', null, 'owner B nao emite no tenant A');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000b',
    '40000000-0000-0000-0000-0000000000a2', 'pin', '482915')$$, 'P0001', null, 'pessoa do A nao recebe credencial do B');
select lives_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000b',
    '40000000-0000-0000-0000-0000000000b1', 'card', '04A1B2C3')$$, 'mesmo cartao no tenant B e permitido');
with u as (update public.credentials set status = 'revoked' where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'owner B nao altera credenciais do A');
reset role;
select isnt(
  (select identifier_hash from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000a' and type = 'card'),
  (select identifier_hash from public.credentials where tenant_id = '10000000-0000-0000-0000-00000000000b'),
  'mesmo cartao gera hash diferente por tenant');

-- ---------------------------------------------------------------- matriz de papeis (tenant A)
select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.credentials), 0, 'viewer nao le credenciais');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', 'AABBCCDD')$$, '42501', null, 'viewer nao emite');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000aa');
select is((select count(*)::int from public.credentials), 0, 'installer nao le credenciais');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a7');
select ok((select count(*)::int from public.credentials) > 0, 'auditor le credenciais');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', 'AABBCCDD')$$, '42501', null, 'auditor nao emite');
with u as (update public.credentials set label = 'x' returning 1)
select is((select count(*)::int from u), 0, 'auditor nao altera');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a9');
select ok((select count(*)::int from public.credentials) > 0, 'RH le credenciais');
select throws_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', 'AABBCCDD')$$, '42501', null, 'RH nao emite');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a4');
select lives_ok(
  $$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
    '40000000-0000-0000-0000-0000000000a2', 'card', 'AABBCCDD')$$, 'recepcao emite cartao');
select lives_ok($$update public.credentials set status = 'suspended' where type = 'card' and hint = 'CCDD'$$,
  'recepcao suspende credencial');
reset role;

-- ---------------------------------------------------------------- pessoa apagada leva as credenciais
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$delete from public.people where id = '40000000-0000-0000-0000-0000000000a2'$$, 'apaga pessoa');
select is((select count(*)::int from public.credentials where person_id = '40000000-0000-0000-0000-0000000000a2'),
  0, 'credenciais da pessoa apagada somem');
reset role;

-- ---------------------------------------------------------------- fuso da organizacao
select is((select timezone from public.tenants where slug = 'alfa'), 'America/Sao_Paulo', 'fuso padrao da organizacao');

select * from finish();
rollback;
