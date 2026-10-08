-- Fase 8A (D-022): chave publica do dispositivo no enrollment. Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into public.tenants (id, name, slug) values ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A');
-- tokens de enrollment de 68 caracteres ('zea_' + 64); o hash e o sha256 do token
insert into public.edge_agents (id, tenant_id, site_id, name, enrollment_token_hash, enrollment_expires_at) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Com chave', encode(extensions.digest('zea_' || repeat('a', 64), 'sha256'), 'hex'), now() + interval '1 day'),
  ('60000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Legado', encode(extensions.digest('zea_' || repeat('b', 64), 'sha256'), 'hex'), now() + interval '1 day'),
  ('60000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'Chave invalida', encode(extensions.digest('zea_' || repeat('c', 64), 'sha256'), 'hex'), now() + interval '1 day');

set local role service_role;

select is((select count(*)::int from public.edge_enroll('zea_' || repeat('a', 64), 'host', '1.0', repeat('1', 64))), 1,
  'enrollment com chave publica do dispositivo');
select is(public.edge_device_key('60000000-0000-0000-0000-00000000000a'), repeat('1', 64), 'edge_device_key devolve a publica');

select is((select count(*)::int from public.edge_enroll('zea_' || repeat('b', 64), 'host', '1.0')), 1,
  'chamada de 3 argumentos (legado) segue valendo');
select is(public.edge_device_key('60000000-0000-0000-0000-00000000000b'), null, 'agente legado: sem chave');

select throws_ok($$select * from public.edge_enroll('zea_' || repeat('c', 64), 'host', '1.0', 'curta')$$, '22023', null,
  'chave malformada recusada');
select throws_ok($$select * from public.edge_enroll('zea_' || repeat('c', 64), 'host', '1.0', repeat('G', 64))$$, '22023', null,
  'chave nao-hex recusada');
select is(public.edge_device_key('60000000-0000-0000-0000-00000000000c'), null, 'enrollment recusado nao ativa o agente');
select is(public.edge_device_key('99999999-9999-9999-9999-999999999999'), null, 'agente inexistente: null');

select throws_ok($$select * from public.edge_enroll('zea_' || repeat('a', 64), 'host', '1.0', repeat('2', 64))$$, '28000', null,
  'token de uso unico: segundo enrollment recusado');
select is(public.edge_device_key('60000000-0000-0000-0000-00000000000a'), repeat('1', 64), 'chave nao foi sobrescrita');
reset role;

select is((select metadata ->> 'device_key' from public.audit_log
            where action = 'edge_agent.enroll' and resource_id = '60000000-0000-0000-0000-00000000000a'), 'true',
  'auditoria marca que a chave foi registrada (sem gravar a chave)');
select is((select count(*)::int from public.audit_log where metadata::text like '%' || repeat('1', 64) || '%'), 0,
  'chave publica nao vai ao audit_log');

-- revogado: sem chave valida para o gateway
update public.edge_agents set status = 'revoked', secret_hash = null where id = '60000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(public.edge_device_key('60000000-0000-0000-0000-00000000000a'), null, 'agente revogado: edge_device_key = null');
reset role;

-- duas chaves iguais nao podem coexistir
select throws_ok($$update public.edge_agents set device_public_key = repeat('1', 64) where id = '60000000-0000-0000-0000-00000000000c'$$,
  null, null, 'indice unico: chave de dispositivo nao se repete') ;
-- (a linha 'a' revogada ainda guarda a chave; a duplicata acima viola o indice)

-- a coluna nao e exposta ao frontend
set local role authenticated;
select throws_ok($$select device_public_key from public.edge_agents$$, '42501', null, 'authenticated nao le device_public_key');
select throws_ok($$select public.edge_device_key('60000000-0000-0000-0000-00000000000b')$$, '42501', null, 'authenticated nao executa edge_device_key');
select throws_ok($$select * from public.edge_enroll('zea_' || repeat('a', 64), 'h', '1')$$, '42501', null, 'authenticated nao executa edge_enroll');
reset role;
set local role anon;
select throws_ok($$select public.edge_device_key('60000000-0000-0000-0000-00000000000b')$$, '42501', null, 'anon nao executa edge_device_key');
reset role;

select * from finish();
rollback;
