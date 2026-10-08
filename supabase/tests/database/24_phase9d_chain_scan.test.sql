-- Fase 9D: varredura agendada da cadeia de evidencia (alerta critico chain_broken). Dados sinteticos; tudo e revertido.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');
insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash)
  select t, s, 0, 'access_decision', now(), 'DENY', 'CREDENTIAL_INVALID', 'DEVICE', 'x'
    from (values ('10000000-0000-0000-0000-00000000000a'::uuid, '20000000-0000-0000-0000-00000000000a'::uuid),
                 ('10000000-0000-0000-0000-00000000000b'::uuid, '20000000-0000-0000-0000-00000000000b'::uuid)) v(t, s),
         generate_series(1, 3);

select has_function('public', 'scan_access_chains', 'funcao existe');
select is(public.scan_access_chains(), 0, 'cadeias integras: nenhum alerta');
select is((select count(*)::int from public.alerts where kind = 'chain_broken'), 0, 'sem alerta chain_broken');

-- adulteracao (so possivel sem triggers: simula atacante com acesso ao banco)
set local session_replication_role = replica;
update public.access_events set reason_code = 'POLICY_MATCH'
 where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 2;
set local session_replication_role = origin;

select is(public.scan_access_chains(), 1, 'adulteracao em uma organizacao: 1 alerta');
select is((select severity from public.alerts where kind = 'chain_broken' and tenant_id = '10000000-0000-0000-0000-00000000000a'),
  'critical', 'alerta critico na organizacao adulterada');
select is((select count(*)::int from public.alerts where kind = 'chain_broken' and tenant_id = '10000000-0000-0000-0000-00000000000b'),
  0, 'outra organizacao nao afetada');
select is((select count(*)::int from public.alerts where kind = 'chain_broken' and tenant_id = '10000000-0000-0000-0000-00000000000a'
  and dedup_key like 'chain_broken:%'), 1, 'chave de deduplicacao por organizacao');

select public.scan_access_chains();
select is((select occurrences from public.alerts where kind = 'chain_broken'), 2, 'repeticao incrementa, nao duplica');

-- permissao
set local role authenticated;
select throws_ok($$select public.scan_access_chains()$$, '42501', null, 'authenticated nao executa a varredura');
reset role;

select * from finish();
rollback;
