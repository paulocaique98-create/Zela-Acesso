-- Fase 9D: rate limit global do edge-gateway (contador no banco). Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into public.tenants (id, name, slug) values ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A');
insert into public.edge_agents (id, tenant_id, site_id, name, enrollment_token_hash, enrollment_expires_at) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Agente A', 'hash-a', now() + interval '1 day'),
  ('60000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Agente B', 'hash-b', now() + interval '1 day');

set local role service_role;
select is(public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3), true, '1a chamada passa');
select is(public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3), true, '2a passa');
select is(public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3), true, '3a passa (no limite)');
select is(public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3), false, '4a excede o limite');
select is(public.edge_rate_check('60000000-0000-0000-0000-00000000000b', 3), true, 'outro agente tem contador proprio');
select is(public.edge_rate_check('99999999-9999-9999-9999-999999999999', 3), true, 'id desconhecido: passa (autenticacao recusa)');
reset role;
select is((select count(*)::int from public.edge_rate_hits where agent_id = '99999999-9999-9999-9999-999999999999'), 0,
  'id forjado nao grava linha');

set local role service_role;
select throws_ok($$select public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 0)$$, '22023', null, 'limite invalido recusado');
reset role;

set local role authenticated;
select throws_ok($$select public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3)$$, '42501', null, 'authenticated nao executa');
select throws_ok($$select count(*) from public.edge_rate_hits$$, '42501', null, 'authenticated nao le a tabela');
reset role;
set local role anon;
select throws_ok($$select public.edge_rate_check('60000000-0000-0000-0000-00000000000a', 3)$$, '42501', null, 'anon nao executa');
reset role;

select * from finish();
rollback;
