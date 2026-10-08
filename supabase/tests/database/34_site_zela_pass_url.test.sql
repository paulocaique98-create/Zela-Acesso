-- Local: endereco do Zela Pass (https obrigatorio, sem caminho) editavel so por quem tem site:update no proprio tenant.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Site Alfa');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$update public.sites set zela_pass_url = 'https://192.168.0.10:8443' where id = '20000000-0000-0000-0000-00000000000a'$$,
  'dono grava o endereco https do Zela Pass');
select is((select zela_pass_url from public.sites where id = '20000000-0000-0000-0000-00000000000a'),
  'https://192.168.0.10:8443', 'endereco gravado');
select throws_ok(
  $$update public.sites set zela_pass_url = 'http://192.168.0.10:8443' where id = '20000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'http (sem TLS) e recusado');
select throws_ok(
  $$update public.sites set zela_pass_url = 'https://host/caminho' where id = '20000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'endereco com caminho e recusado');
select throws_ok(
  $$update public.sites set zela_pass_url = 'javascript:alert(1)' where id = '20000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'esquema nao-https e recusado');

select tests.login('00000000-0000-0000-0000-0000000000b1');
update public.sites set zela_pass_url = 'https://invasor.example' where id = '20000000-0000-0000-0000-00000000000a';
reset role;
select is((select zela_pass_url from public.sites where id = '20000000-0000-0000-0000-00000000000a'),
  'https://192.168.0.10:8443', 'outro tenant nao altera o endereco (RLS)');

select * from finish();
rollback;
