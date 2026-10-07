-- Fase 3C: access_events (append-only, hash encadeado, idempotencia, correcao, RLS cross-tenant, verificacao).
-- Dados sinteticos; tudo e revertido.
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
  ('00000000-0000-0000-0000-0000000000a2', 'a-auditor@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'auditor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.sites (id, tenant_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Sede A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Sede B');

-- gravacao pelo servidor (service_role)
set local role service_role;
select lives_ok($$select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'access_decision', '2026-10-07 12:00:00+00', 'ALLOW', 'POLICY_MATCH', null, null, null, null, null, null, 'ENGINE', null,
  '{"steps":["policy"]}', 'idem-0001-aaaa')$$, 'service_role grava evento de decisao');
select lives_ok($$select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'access_decision', '2026-10-07 12:01:00+00', 'DENY', 'OUTSIDE_SCHEDULE', null, null, null, null, null, null, 'EDGE_AGENT', null,
  '{}', 'idem-0002-aaaa')$$, 'segundo evento');
select is(public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'access_decision', '2026-10-07 12:00:00+00', 'ALLOW', 'POLICY_MATCH', null, null, null, null, null, null, 'ENGINE', null,
  '{"steps":["policy"]}', 'idem-0001-aaaa'),
  (select id from public.access_events where idempotency_key = 'idem-0001-aaaa'), 'idempotente: repetir devolve o mesmo evento');
select lives_ok($$select public.record_access_event('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
  'access_decision', '2026-10-07 12:00:00+00', 'ALLOW', 'POLICY_MATCH', null, null, null, null, null, null, 'ENGINE', null, '{}', null)$$,
  'evento do tenant B (cadeia propria)');
reset role;

select is((select count(*)::int from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2, 'idempotencia nao duplicou');
select is((select array_agg(seq order by seq) from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  array[1, 2]::bigint[], 'seq sequencial por tenant');
select is((select seq from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000b'), 1::bigint, 'tenant B reinicia a cadeia');
select is((select prev_hash from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 1), null, 'primeiro evento sem prev_hash');
select is((select prev_hash from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 2),
  (select hash from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 1), 'encadeado ao anterior');
select matches((select hash from public.access_events where seq = 1 and tenant_id = '10000000-0000-0000-0000-00000000000a'), '^[0-9a-f]{64}$', 'hash sha256 hex');

-- chamador nao controla seq/hash
insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash, prev_hash)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 99, 'access_decision', now(), 'DENY', 'CREDENTIAL_INVALID', 'DEVICE', 'forjado', 'forjado');
select is((select seq from public.access_events where hash <> 'forjado' and source = 'DEVICE'), 3::bigint, 'seq forjado descartado');
select is((select count(*)::int from public.access_events where hash = 'forjado' or prev_hash = 'forjado'), 0, 'hash/prev_hash forjados descartados');

-- cadeia integra
select is((select ok from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), true, 'cadeia integra verificada');
select is((select checked from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), 3::bigint, 'verificou 3 eventos');

-- append-only
select throws_ok($$update public.access_events set decision = 'ALLOW'$$, '42501', null, 'UPDATE bloqueado (postgres)');
select throws_ok($$delete from public.access_events$$, '42501', null, 'DELETE bloqueado (postgres)');
select throws_ok($$truncate public.access_events$$, '42501', null, 'TRUNCATE bloqueado (postgres)');

-- adulteracao: simula violacao fora do trigger (desabilita trigger so aqui, como superusuario) e detecta
alter table public.access_events disable trigger access_events_no_update_delete;
update public.access_events set reason_code = 'POLICY_MATCH', decision = 'ALLOW'
  where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 2;
select is((select ok from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), false, 'adulteracao detectada');
select is((select first_broken_seq from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), 2::bigint, 'aponta o primeiro evento adulterado');
alter table public.access_events enable trigger access_events_no_update_delete;

-- constraints
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, source, hash)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 0, 'access_decision', now(), 'ENGINE', '')$$,
  '23514', null, 'decisao exige decision + reason_code');
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 0, 'access_decision', now(), 'ALLOW', 'INVENTADO', 'ENGINE', '')$$,
  '23514', null, 'reason_code fora da lista estavel rejeitado');
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash, evidence)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 0, 'access_decision', now(), 'ALLOW', 'POLICY_MATCH', 'ENGINE', '', '{"pin":"1234"}')$$,
  '23514', null, 'evidencia com chave sensivel (pin) rejeitada');
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash, evidence)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 0, 'access_decision', now(), 'ALLOW', 'POLICY_MATCH', 'ENGINE', '', '{"x":{"Token":"abc"}}')$$,
  '23514', null, 'chave sensivel aninhada/maiuscula rejeitada');
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', 0, 'access_decision', now(), 'ALLOW', 'POLICY_MATCH', 'ENGINE', '')$$,
  '23503', null, 'site de outro tenant rejeitado (FK composta)');

-- RPC de gravacao e restrita a service_role
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.record_access_event('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
  'access_decision', now(), 'ALLOW', 'POLICY_MATCH', null, null, null, null, null, null, 'ENGINE', null, '{}', null)$$,
  '42501', null, 'owner nao grava evento direto (so servidor)');
select throws_ok($$insert into public.access_events (tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, source, hash)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 0, 'access_decision', now(), 'ALLOW', 'POLICY_MATCH', 'ENGINE', '')$$,
  '42501', null, 'owner nao insere direto na tabela');

-- leitura e isolamento
select is((select count(*)::int from public.access_events), 3, 'owner A le os 3 eventos do tenant A');
select is((select count(*)::int from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0, 'owner A nao ve eventos do tenant B');
select throws_ok($$update public.access_events set decision = 'DENY'$$, '42501', null, 'owner nao atualiza');
select throws_ok($$delete from public.access_events$$, '42501', null, 'owner nao apaga');

-- correcao: novo evento; original preservado
select lives_ok($$select public.record_access_correction(
  (select id from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 1),
  'porta aberta manualmente pelo vigilante', '{"physical_outcome":"DOOR_OPENED"}')$$, 'owner corrige (gera novo evento)');
select is((select count(*)::int from public.access_events where event_type = 'correction'), 1, 'correcao e um novo evento');
select is((select seq from public.access_events where event_type = 'correction'), 4::bigint, 'correcao entra no fim da cadeia');
select is((select actor_user_id from public.access_events where event_type = 'correction'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'correcao registra o usuario');
select is((select count(*)::int from public.access_events where seq = 1 and decision = 'ALLOW' and event_type = 'access_decision'), 1, 'evento original intacto');
select is((select count(*)::int from public.audit_log where action = 'access_event.correct' and reason is not null), 1, 'correcao gera auditoria administrativa com motivo');
select throws_ok($$select public.record_access_correction(
  (select id from public.access_events where seq = 1 and tenant_id = '10000000-0000-0000-0000-00000000000a'), 'abc', '{}')$$, '22023', null, 'justificativa curta rejeitada');
reset role;

-- auditor le e verifica, mas nao corrige; viewer nao le
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.access_events), 4, 'auditor le eventos');
select is((select ok from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')), false, 'auditor verifica cadeia (aqui quebrada pela adulteracao simulada)');
select throws_ok($$select public.record_access_correction((select id from public.access_events where seq = 1), 'tentativa sem permissao', '{}')$$,
  '42501', null, 'auditor nao corrige');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.access_events), 0, 'viewer nao le eventos');
select throws_ok($$select * from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'viewer nao verifica cadeia');
reset role;

-- owner B nao corrige nem verifica evento/tenant de A
select set_config('t.a1', (select id::text from public.access_events where tenant_id = '10000000-0000-0000-0000-00000000000a' and seq = 1), true);
select tests.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.record_access_correction(current_setting('t.a1')::uuid, 'cross-tenant tentativa', '{}')$$,
  'P0002', null, 'cross-tenant: evento invisivel, correcao negada');
select throws_ok($$select * from public.verify_access_chain('10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'cross-tenant: verificacao negada');
reset role;

select * from finish();
rollback;
