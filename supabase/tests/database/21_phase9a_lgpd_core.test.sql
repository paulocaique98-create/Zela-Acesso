-- Fase 9A: retencao, pedidos do titular e consentimento geral (RLS, permissoes, imutabilidade, auditoria, isolamento).
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
  ('00000000-0000-0000-0000-0000000000a2', 'a-recep@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-hr@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'a-audit@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'hr_manager'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'auditor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.people (id, tenant_id, full_name, kind) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa 1', 'employee'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa B', 'employee');

-- ------------------------------------------------------------ nada e semeado
select is((select count(*) from public.retention_policy), 0::bigint, 'nenhum prazo de retencao padrao semeado');

-- ------------------------------------------------------------ permissoes: recepcao nao ve nem escreve
select tests.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 365, 'Contrato X', 'PARECER-1')$$, '42501', null, 'recepcao nao define retencao');
select throws_ok($$select public.open_data_subject_request('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'access', 'in_person')$$, '42501', null, 'recepcao nao abre pedido');
select throws_ok($$select public.record_consent('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'controle_acesso', 'consent', 'granted', 'v1', 'in_person')$$,
  '42501', null, 'recepcao nao registra consentimento');

-- ------------------------------------------------------------ retencao exige parecer e faixa valida
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 365, 'Contrato X', '')$$, 'P0001', null, 'retencao sem referencia de parecer e recusada');
select throws_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 0, 'Contrato X', 'PARECER-1')$$, 'P0001', null, 'retencao de 0 dias e recusada');
select throws_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 9999, 'Contrato X', 'PARECER-1')$$, 'P0001', null, 'retencao acima de 7300 dias e recusada');
select lives_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 365, 'Contrato X', 'PARECER-1')$$, 'owner define retencao');
select lives_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'access_events', 400, 'Contrato X', 'PARECER-2')$$, 'redefinir atualiza (upsert)');
select is((select retention_days from public.retention_policy where data_category = 'access_events'), 400,
  'valor atualizado');
select is((select count(*) from public.retention_policy), 1::bigint, 'uma linha por categoria');
select is((select count(*) from public.audit_log where action = 'retention_policy.set'), 2::bigint,
  'retencao auditada');
select throws_ok($$insert into public.retention_policy (tenant_id, data_category, retention_days, legal_basis,
  legal_opinion_ref) values ('10000000-0000-0000-0000-00000000000a', 'visits', 30, 'Contrato X', 'P')$$,
  '42501', null, 'insert direto negado (so por funcao)');

-- ------------------------------------------------------------ pedidos do titular
select throws_ok($$select public.open_data_subject_request('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000b1', 'access', 'in_person')$$, 'P0001', null,
  'pessoa de outro tenant e recusada');
select throws_ok($$select public.open_data_subject_request('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'access', 'telepatia')$$, 'P0001', null, 'canal invalido e recusado');
select lives_ok($$select public.open_data_subject_request('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'access', 'in_person')$$, 'owner abre pedido');
select is((select status::text from public.data_subject_request), 'received', 'nasce como recebido');
select ok((select due_at - received_at = interval '15 days' from public.data_subject_request),
  'prazo padrao de 15 dias');
select throws_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'completed', '')$$, 'P0001', null,
  'encerrar exige registro da resolucao');
select lives_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'in_progress')$$, 'vai para em andamento');
select throws_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'received')$$, 'P0001', null, 'nao volta para recebido');
select throws_ok($$update public.data_subject_request set person_id = gen_random_uuid()$$, '42501', null,
  'update direto negado');
select lives_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'completed', 'Relatorio entregue ao titular')$$, 'conclui com nota');
select throws_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'rejected', 'Tentativa de reabrir')$$, 'P0001', null,
  'pedido encerrado nao muda');
select is((select count(*) from public.audit_log where action in ('dsr.open', 'dsr.in_progress', 'dsr.completed')),
  3::bigint, 'ciclo do pedido auditado');
select is((select count(*) from public.audit_log where metadata::text like '%Relatorio%'
  or metadata::text like '%Pessoa 1%'), 0::bigint, 'auditoria sem nota livre nem nome');

-- ------------------------------------------------------------ consentimento geral append-only
select throws_ok($$select public.record_consent('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'Controle Acesso!', 'consent', 'granted', 'v1', 'in_person')$$,
  '23514', null, 'finalidade fora do padrao e recusada');
select throws_ok($$select public.record_consent('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'controle_acesso', 'consent', 'granted', 'v1', 'system')$$,
  'P0001', null, 'metodo system nao e manual');
select lives_ok($$select public.record_consent('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'controle_acesso', 'consent', 'granted', 'v1', 'in_person')$$,
  'registra consentimento');
select lives_ok($$select public.record_consent('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'controle_acesso', 'consent', 'revoked', 'v1', 'digital')$$,
  'revogar = novo registro');
select is((select count(*) from public.consent_record), 2::bigint, 'historico preservado');
select throws_ok($$update public.consent_record set action = 'granted'$$, '42501', null, 'update direto negado');
select throws_ok($$delete from public.consent_record$$, '42501', null, 'delete direto negado');

-- ------------------------------------------------------------ leitura por papel e isolamento
select tests.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*) from public.consent_record), 2::bigint, 'RH le consentimentos');
select throws_ok($$select public.set_retention_policy('10000000-0000-0000-0000-00000000000a',
  'visits', 30, 'Contrato X', 'PARECER-1')$$, '42501', null, 'RH le mas nao escreve');
select tests.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.data_subject_request), 1::bigint, 'auditor le pedidos');
select is((select count(*) from public.retention_policy), 1::bigint, 'auditor le retencao');
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.data_subject_request), 0::bigint, 'recepcao nao le pedidos');
select is((select count(*) from public.consent_record), 0::bigint, 'recepcao nao le consentimentos');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.data_subject_request), 0::bigint, 'outro tenant nao ve pedidos');
select is((select count(*) from public.consent_record), 0::bigint, 'outro tenant nao ve consentimentos');
select is((select count(*) from public.retention_policy), 0::bigint, 'outro tenant nao ve retencao');
select throws_ok($$select public.update_data_subject_request(
  (select id from public.data_subject_request), 'rejected', 'invasao')$$, 'P0001', null,
  'outro tenant nem enxerga o pedido para alterar');

select * from finish();
rollback;
