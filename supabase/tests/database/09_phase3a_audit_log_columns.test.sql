-- Fase 3A: novas colunas do audit_log (actor_type, before, after, reason, ip, user_agent, correlation_id).
-- Aditivo, append-only preservado, defaults por trigger, RLS inalterada. Dados sinteticos; tudo e revertido.
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
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');

-- colunas existem
select has_column('public', 'audit_log', c, 'audit_log tem ' || c)
  from unnest(array['actor_type', 'before', 'after', 'reason', 'ip', 'user_agent', 'correlation_id']) c;

-- defaults por trigger
insert into public.audit_log (tenant_id, action, resource_type, resource_id)
  values ('10000000-0000-0000-0000-00000000000a', 'teste.sistema', 'teste', '1');
select is((select actor_type from public.audit_log where action = 'teste.sistema'), 'system',
  'sem ator: actor_type = system');
select is((select count(*)::int from public.audit_log where action = 'tenants.insert' and created_at = now() and actor_type is null), 0,
  'auditoria gerada por trigger tambem recebe actor_type');

select set_config('app.correlation_id', '30000000-0000-0000-0000-0000000000c1', true);
insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, reason, ip, user_agent, before, after)
  values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'teste.usuario', 'teste',
          'motivo', '203.0.113.7', 'agente/1.0', '{"a":1}', '{"a":2}');
select is((select actor_type from public.audit_log where action = 'teste.usuario'), 'user', 'com ator: actor_type = user');
select is((select correlation_id from public.audit_log where action = 'teste.usuario'),
  '30000000-0000-0000-0000-0000000000c1'::uuid, 'correlation_id vem do GUC da transacao');
select is((select ip::text from public.audit_log where action = 'teste.usuario'), '203.0.113.7/32', 'ip gravado pela borda');

select set_config('app.correlation_id', 'nao-e-uuid', true);
insert into public.audit_log (tenant_id, action, resource_type) values ('10000000-0000-0000-0000-00000000000a', 'teste.corr-invalida', 'teste');
select is((select correlation_id from public.audit_log where action = 'teste.corr-invalida'), null,
  'GUC invalido nao derruba a transacao: correlation_id nulo');

-- constraints
select throws_ok($$insert into public.audit_log (tenant_id, action, resource_type, actor_type)
  values ('10000000-0000-0000-0000-00000000000a', 'x', 'x', 'alien')$$, '23514', null, 'actor_type invalido rejeitado');
select throws_ok($$insert into public.audit_log (tenant_id, action, resource_type, reason)
  values ('10000000-0000-0000-0000-00000000000a', 'x', 'x', repeat('r', 501))$$, '23514', null, 'reason > 500 rejeitado');

-- append-only inclui as novas colunas
select throws_ok($$update public.audit_log set reason = 'adulterado' where action = 'teste.usuario'$$, '42501', null,
  'UPDATE de reason bloqueado (postgres)');
select throws_ok($$update public.audit_log set after = '{}' where action = 'teste.usuario'$$, '42501', null,
  'UPDATE de after bloqueado (postgres)');
select throws_ok($$delete from public.audit_log where action = 'teste.usuario'$$, '42501', null, 'DELETE bloqueado');

-- usuario comum: le o proprio tenant, nao escreve nas novas colunas, nao ve o outro tenant
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.audit_log where action = 'teste.usuario'), 1, 'owner A le evento com novas colunas');
select is((select count(*)::int from public.audit_log where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0,
  'owner A nao ve auditoria do tenant B');
select throws_ok($$insert into public.audit_log (tenant_id, action, resource_type, reason, ip)
  values ('10000000-0000-0000-0000-00000000000a', 'forjado', 'x', 'r', '1.1.1.1')$$, '42501', null,
  'usuario nao insere (nem ip/reason forjados)');
select throws_ok($$update public.audit_log set reason = 'x'$$, '42501', null, 'usuario nao altera reason');
reset role;

select * from finish();
rollback;
