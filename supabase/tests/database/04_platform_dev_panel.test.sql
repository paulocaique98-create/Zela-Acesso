-- Painel do Desenvolvedor completo: organizacoes, modulos, planos/contratacao, suporte, logs, configuracoes, troca de senha.
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

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'p-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'p-support@example.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'a-viewer@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@example.test');
insert into public.platform_admins (user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'platform_owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'platform_support');
insert into public.tenants (id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', 'Tenant Alfa', 'alfa'),
  ('10000000-0000-0000-0000-00000000000b', 'Tenant Beta', 'beta');
insert into public.memberships (tenant_id, user_id, role, scope_site_ids) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner', null),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5', 'viewer', null),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner', null);
insert into public.people (tenant_id, full_name) values
  ('10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Um'),
  ('10000000-0000-0000-0000-00000000000a', 'Pessoa Alfa Dois');

-- ================================================================ 1. tenants: codigo, modulos, limites
select matches((select org_code from public.tenants where slug = 'alfa'), '^ZA[0-9]{3,}$', 'org_code no formato ZA###');
select isnt((select org_code from public.tenants where slug = 'alfa'), (select org_code from public.tenants where slug = 'beta'), 'org_code unico');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$update public.tenants set features_enabled = '{"biometrics":true}' where slug = 'alfa'$$,
  '42501', null, 'dono da organizacao nao altera os modulos direto');
select throws_ok($$update public.tenants set limits = '{"max_people":999999}' where slug = 'alfa'$$,
  '42501', null, 'dono da organizacao nao altera limites direto');
select throws_ok($$update public.tenants set org_code = 'ZA999' where slug = 'alfa'$$,
  '42501', null, 'org_code nao e editavel');
select is((select count(*)::int from public.tenant_details), 0, 'dono da organizacao nao le dados internos (tenant_details)');
select throws_ok($$select public.platform_set_features('10000000-0000-0000-0000-00000000000a', '{"biometrics":true}')$$,
  '42501', null, 'dono da organizacao nao chama platform_set_features');
select throws_ok($$select public.platform_update_tenant('10000000-0000-0000-0000-00000000000a', 'Novo', '{}', null)$$,
  '42501', null, 'dono da organizacao nao chama platform_update_tenant');
reset role;

-- ================================================================ 2. platform_create_tenant com cadastro completo
select tests.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.platform_create_tenant('Org S', 'org-s', null, 'a-owner@example.test', null)$$,
  '42501', null, 'platform_support nao cria organizacao');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.platform_create_tenant('Org Gama', 'gama', null, 'nobody@example.test',
  '{"legal_name":"Gama Ltda","tax_id":"12.345.678/0001-90","contact_email":"c@gama.test","postal_code":"01310-100","state":"sp","notes":"interna"}')$$,
  'owner cria organizacao com cadastro completo');
select is((select tax_id from public.tenant_details d join public.tenants t on t.id = d.tenant_id where t.slug = 'gama'),
  '12345678000190', 'CNPJ normalizado para digitos');
select is((select state from public.tenant_details d join public.tenants t on t.id = d.tenant_id where t.slug = 'gama'),
  'SP', 'UF em maiuscula');
select is((select features_enabled from public.tenants where slug = 'gama'),
  '{"sites":true,"zones":true,"people":true,"groups":true,"members":true,"audit":true}'::jsonb,
  'organizacao nova nasce so com o plano base');
select throws_ok($$select public.platform_create_tenant('Org Ruim', 'ruim', null, 'nobody@example.test', '{"tax_id":"123"}')$$,
  '23514', null, 'CNPJ invalido rejeitado');
select is((select count(*)::int from public.tenants where slug = 'ruim'), 0, 'falha nao deixa organizacao parcial');
reset role;
select is((select role::text from public.memberships m join public.tenants t on t.id = m.tenant_id
  where t.slug = 'gama' and m.user_id = '00000000-0000-0000-0000-0000000000d1'), 'organization_owner',
  'dono indicado e organization_owner');

select tests.login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.tenant_details where legal_name = 'Gama Ltda'), 1, 'platform_support le o cadastro das organizacoes');
reset role;

-- ================================================================ 3. modulos e historico
select tests.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.platform_set_features('10000000-0000-0000-0000-00000000000a', '{"x y":true}')$$,
  '23514', null, 'chave invalida rejeitada');
select throws_ok($$select public.platform_set_features('10000000-0000-0000-0000-00000000000a', '{"biometrics":"sim"}')$$,
  '23514', null, 'valor nao booleano rejeitado');
select lives_ok($$select public.platform_set_features('10000000-0000-0000-0000-00000000000a',
  '{"access_points":true,"credentials":true,"sites":false}')$$, 'owner altera os modulos');
select is((select (features_enabled ->> 'sites')::boolean from public.tenants where slug = 'alfa'), true,
  'plano base e sempre incluso (sites nao desliga)');
select is((select (features_enabled ->> 'credentials')::boolean from public.tenants where slug = 'alfa'), true, 'modulo ligado');
select is((select count(*)::int from public.tenant_feature_changes
  where tenant_id = '10000000-0000-0000-0000-00000000000a' and feature_key = 'access_points' and enabled
    and changed_by = '00000000-0000-0000-0000-0000000000c1'), 1, 'historico registra quem ligou');
select lives_ok($$select public.platform_update_tenant('10000000-0000-0000-0000-00000000000a', 'Alfa Renomeada',
  '{"city":"Sao Paulo","notes":"x"}', '{"max_people":200,"max_sites":-5,"lixo":1}')$$, 'owner atualiza cadastro e limites');
select is((select name from public.tenants where slug = 'alfa'), 'Alfa Renomeada', 'nome atualizado');
select is((select limits from public.tenants where slug = 'alfa'), '{"max_people":200,"max_sites":0}'::jsonb,
  'limites: so chaves conhecidas e nao negativos');
select is((select city from public.tenant_details where tenant_id = '10000000-0000-0000-0000-00000000000a'), 'Sao Paulo', 'detalhes gravados');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.platform_set_features('10000000-0000-0000-0000-00000000000a', '{"visitors":true}')$$,
  '42501', null, 'platform_support nao altera modulos');
select is((select count(*)::int from public.tenant_feature_changes where tenant_id in
  ('10000000-0000-0000-0000-00000000000a', (select id from public.tenants where slug = 'gama'))), 14, 'platform_support le o historico de modulos');
reset role;

-- ================================================================ 4. comercial
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.platform_module_prices), 0, 'dono da organizacao nao le precos');
select is((select count(*)::int from public.platform_plans), 0, 'dono da organizacao nao le planos');
select is((select count(*)::int from public.tenant_contracts), 0, 'dono da organizacao nao le contratos');
with u as (update public.platform_module_prices set price = 1 where item_id = 'base' returning 1)
select is((select count(*)::int from u), 0, 'dono nao altera precos (RLS filtra)');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.platform_module_prices), 0, 'platform_support nao le precos (dado comercial so do owner)');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.platform_module_prices), 7, 'owner le o catalogo de precos (7 itens)');
select lives_ok($$update public.platform_module_prices set price = 5 where item_id = 'base'$$, 'owner altera preco');
select lives_ok($$update public.platform_module_prices set price = 2 where item_id = 'access_control'$$, 'owner altera preco 2');
select is((select count(*)::int from public.platform_pricing_history where table_name = 'platform_module_prices' and record_id = 'base' and action = 'UPDATE'),
  1, 'historico de preco registrado');

select lives_ok($$insert into public.platform_plans (name, mode, items, price_per_person, monthly_minimum, setup_fee)
  values ('Completo', 'package', array['access_control'], 8, 100, 1000)$$, 'owner cria pacote');
select set_config('t.plan1', (select id::text from public.platform_plans where name = 'Completo'), true);
select lives_ok($$insert into public.platform_plan_cycles (plan_id, cycle, months, discount_percent) values
  (current_setting('t.plan1')::uuid, 'MONTHLY', 1, 0), (current_setting('t.plan1')::uuid, 'ANNUAL', 12, 10)$$,
  'owner cria ciclos');
select lives_ok($$insert into public.platform_plans (name, mode, setup_fee)
  values ('Por pessoa', 'per_person', 500)$$, 'owner cria plano por pessoa');
select set_config('t.plan2', (select id::text from public.platform_plans where name = 'Por pessoa'), true);
select lives_ok($$insert into public.platform_plan_cycles (plan_id, cycle, months) values
  (current_setting('t.plan2')::uuid, 'MONTHLY', 1)$$, 'ciclo mensal do por pessoa');
select throws_ok($$insert into public.platform_plan_cycles (plan_id, cycle, months) values
  (current_setting('t.plan2')::uuid, 'ANNUAL', 12)$$, 'P0001', null, 'plano por pessoa so aceita ciclo mensal');
select throws_ok($$insert into public.platform_plans (name, mode, items) values ('Ruim', 'package', array['base'])$$,
  'P0001', null, 'base nao entra na lista de itens');
select throws_ok($$insert into public.platform_plans (name, mode, items) values ('Ruim2', 'package', array['inexistente'])$$,
  'P0001', null, 'item fora do catalogo rejeitado');
select throws_ok($$insert into public.platform_plans (name, mode) values ('completo', 'package')$$,
  '23505', null, 'nome de plano ativo e unico (sem diferenciar maiusculas)');

-- contratacao
select throws_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan1')::uuid, 'ANNUAL', 50, null, 'percent', 60, 'amigo')$$,
  'P0001', null, 'desconto acima do teto rejeitado');
select throws_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan1')::uuid, 'ANNUAL', 50, null, 'percent', 10, '')$$,
  'P0001', null, 'desconto exige motivo');
select throws_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan1')::uuid, 'SEMIANNUAL', 50)$$, 'P0001', null, 'ciclo indisponivel rejeitado');
select throws_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan2')::uuid, 'MONTHLY', 51)$$, 'P0001', null, 'por pessoa acima do limite (50) rejeitado');
select lives_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan1')::uuid, 'ANNUAL', 50, null, 'percent', 10, 'parceria', '2026-10-01')$$, 'owner contrata o pacote');
select is((select monthly_value from public.tenant_contracts where status = 'active'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), 400.00::numeric, 'mensalidade recalculada no servidor (50 x 8)');
select is((select cycle_value from public.tenant_contracts where status = 'active'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), 4320.00::numeric, 'valor do ciclo anual com 10% de desconto');
select is((select setup_final from public.tenant_contracts where status = 'active'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), 900.00::numeric, 'implantacao com desconto');
select is((select ends_on from public.tenant_contracts where status = 'active'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), '2027-10-01'::date, 'fim = inicio + ciclo');
select is((select features_enabled ->> 'access_points' from public.tenants where slug = 'alfa'), 'true', 'modulos seguem o plano (ligou)');
select is((select features_enabled ->> 'visitors' from public.tenants where slug = 'alfa'), 'false', 'modulos fora do plano ficam desligados');
reset role;
select is((select count(*)::int from public.audit_log where action = 'tenant_contracts.insert'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), 1, 'auditoria registra a contratacao');
select tests.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into public.tenant_contracts (tenant_id, plan_id, cycle, months, contracted_people, snapshot,
  monthly_value, cycle_value, setup_base, setup_final, starts_on, ends_on)
  values ('10000000-0000-0000-0000-00000000000a', current_setting('t.plan1')::uuid, 'MONTHLY', 1, 1, '{}', 0, 0, 0, 0,
  '2026-01-01', '2026-02-01')$$, '42501', null, 'contrato nao se grava direto (so pela RPC)');

-- troca de plano encerra o anterior
select lives_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan2')::uuid, 'MONTHLY', 10, array['access_control'])$$, 'owner troca para plano por pessoa');
select is((select monthly_value from public.tenant_contracts where status = 'active'
  and tenant_id = '10000000-0000-0000-0000-00000000000a'), 70.00::numeric, 'por pessoa: 10 x (5 + 2)');
select is((select count(*)::int from public.tenant_contracts where tenant_id = '10000000-0000-0000-0000-00000000000a' and status = 'ended'),
  1, 'contratacao anterior encerrada');
select is((select count(*)::int from public.tenant_contracts where tenant_id = '10000000-0000-0000-0000-00000000000a' and status = 'active'),
  1, 'no maximo uma contratacao ativa');
select is((select active_people from public.platform_people_counts() where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  2, 'contagem de pessoas ativas por organizacao');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.platform_contract_plan('10000000-0000-0000-0000-00000000000a',
  current_setting('t.plan1')::uuid, 'MONTHLY', 5)$$, '42501', null, 'platform_support nao contrata');
select throws_ok($$select * from public.platform_people_counts()$$, '42501', null, 'platform_support nao conta pessoas');
reset role;

-- my_plan
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select public.my_plan('10000000-0000-0000-0000-00000000000a') ->> 'plan'), 'Por pessoa', 'dono ve o proprio plano');
select ok((select not (public.my_plan('10000000-0000-0000-0000-00000000000a') ? 'estimated_cost')
           and not (public.my_plan('10000000-0000-0000-0000-00000000000a') ? 'discount_reason')),
  'my_plan nao expoe custo nem motivo de desconto');
select is(public.my_plan('10000000-0000-0000-0000-00000000000b'), null, 'my_plan de outro tenant: null');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a5');
select is(public.my_plan('10000000-0000-0000-0000-00000000000a'), null, 'viewer nao ve o plano');
reset role;

-- ================================================================ 5. suporte
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into public.support_threads (tenant_id, opened_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1')$$,
  'dono abre conversa de suporte');
select set_config('t.thread1', (select id::text from public.support_threads limit 1), true);
select throws_ok($$insert into public.support_threads (tenant_id, opened_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5')$$,
  '42501', null, 'nao abre conversa em nome de outro usuario');
select lives_ok($$insert into public.support_messages (thread_id, tenant_id, sender_id, sender_side, body) values
  (current_setting('t.thread1')::uuid, '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'tenant', 'Preciso de ajuda')$$,
  'dono envia mensagem');
select throws_ok($$insert into public.support_messages (thread_id, tenant_id, sender_id, sender_side, body) values
  (current_setting('t.thread1')::uuid, '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'platform', 'forjada')$$,
  '42501', null, 'dono nao forja mensagem da plataforma');
select throws_ok($$insert into public.support_messages (thread_id, tenant_id, sender_id, sender_side, body) values
  (current_setting('t.thread1')::uuid, '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'tenant', '   ')$$,
  '23514', null, 'mensagem vazia rejeitada');
select throws_ok($$update public.support_threads set staff_last_read_at = now() + interval '1 second' where id = current_setting('t.thread1')::uuid$$,
  '42501', null, 'dono nao marca a leitura da plataforma');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.support_threads), 0, 'viewer nao ve conversas');
select throws_ok($$insert into public.support_threads (tenant_id, opened_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5')$$,
  '42501', null, 'viewer sem support:write nao abre conversa');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.support_messages), 0, 'outra organizacao nao ve as mensagens');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.support_messages where thread_id = current_setting('t.thread1')::uuid), 1, 'platform_support le o suporte');
select lives_ok($$insert into public.support_messages (thread_id, tenant_id, sender_id, sender_side, body) values
  (current_setting('t.thread1')::uuid, '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'platform', 'Ola, pode falar')$$,
  'platform_support responde');
select throws_ok($$insert into public.support_messages (thread_id, tenant_id, sender_id, sender_side, body) values
  (current_setting('t.thread1')::uuid, '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'tenant', 'forjada')$$,
  '42501', null, 'plataforma nao forja mensagem do cliente');
select lives_ok($$update public.support_threads set staff_last_read_at = now() + interval '1 second' where id = current_setting('t.thread1')::uuid$$,
  'plataforma marca a propria leitura');
select throws_ok($$update public.support_threads set requester_last_read_at = now() + interval '1 second' where id = current_setting('t.thread1')::uuid$$,
  '42501', null, 'plataforma nao marca a leitura do cliente');
reset role;
select is((select count(*)::int from public.support_messages where thread_id = current_setting('t.thread1')::uuid), 2, 'conversa tem 2 mensagens');

-- ================================================================ 6. logs de erro
set local role anon;
select throws_ok($$select public.log_error('client', 'ui', 'falha qualquer')$$, '42501', null, 'anon nao grava log');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.log_error('client', 'ui', 'Falha ao renderizar', 'error', 'stack aqui',
  '{"password":"x","pin":"1234","token":"t","tela":"sites","nested":{"ok":1}}', '10000000-0000-0000-0000-00000000000a',
  'sites', 'https://app.example.test/sites?token=abc#frag', 'UA')$$, 'usuario grava log');
select lives_ok($$select public.log_error('client', 'ui', 'Falha ao renderizar', 'error', 'stack aqui', '{"tela":"sites"}',
  '10000000-0000-0000-0000-00000000000a', 'sites')$$, 'mesmo erro de novo');
select lives_ok($$select public.log_error('client', 'ui', 'Outra falha', 'error', null, null, '10000000-0000-0000-0000-00000000000b')$$,
  'tenant alheio e ignorado (nao e membro)');
select is((select count(*)::int from public.error_logs), 0, 'dono da organizacao nao le logs');
with u as (update public.error_logs set resolved = true returning 1)
select is((select count(*)::int from u), 0, 'dono nao resolve logs (RLS filtra)');
reset role;

select is((select count(*)::int from public.error_logs where message = 'Falha ao renderizar'), 1, 'mesmo erro deduplicado em 1 linha');
select is((select occurrences from public.error_logs where message = 'Falha ao renderizar'), 2, 'contador de ocorrencias');
select is((select tenant_id from public.error_logs where message = 'Outra falha'), null, 'tenant de que nao e membro nao e gravado');
select is((select url from public.error_logs where message = 'Falha ao renderizar'), 'https://app.example.test/sites',
  'URL sem query string nem fragmento');
select is((select context from public.error_logs where message = 'Falha ao renderizar'), '{"tela":"sites"}'::jsonb,
  'contexto mais recente mantido');
select ok((select not (context ? 'password') and not (context ? 'pin') and not (context ? 'token')
  from public.error_logs where message = 'Outra falha' or message = 'Falha ao renderizar' limit 1), 'chaves sensiveis nao ficam no contexto');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.log_error('client', 'ui', 'Com segredo', 'error', null,
  '{"password":"x","pin":"1234","token":"t","refresh_token":"r","tela":"s"}')$$, 'log com chaves sensiveis');
reset role;
select is((select context from public.error_logs where message = 'Com segredo'), '{"tela":"s"}'::jsonb,
  'servidor remove password, pin, token e refresh_token do contexto');

select tests.login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.error_logs where message in ('Falha ao renderizar', 'Outra falha', 'Com segredo')), 3, 'platform_support le os logs');
select lives_ok($$update public.error_logs set resolved = true, resolution_note = 'ok' where message = 'Falha ao renderizar'$$, 'plataforma resolve');
reset role;
select is((select resolved_by from public.error_logs where message = 'Falha ao renderizar'),
  '00000000-0000-0000-0000-0000000000c2'::uuid, 'resolved_by carimbado pelo servidor');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.log_error('client', 'ui', 'Falha ao renderizar', 'error', null, null, null, 'sites')$$,
  'erro resolvido que volta');
reset role;
select is((select count(*)::int from public.error_logs where message = 'Falha ao renderizar'), 2,
  'erro resolvido que volta vira caso novo (reabre)');

-- ================================================================ 7. configuracoes globais
set local role anon;
select lives_ok($$select count(*) from public.system_settings$$, 'anon le configuracoes');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$insert into public.system_settings (key, value) values ('global_logo', '')$$, '42501', null, 'dono da organizacao nao grava configuracao');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$insert into public.system_settings (key, value) values ('global_logo', '')$$, '42501', null, 'platform_support nao grava configuracao');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into public.system_settings (key, value) values ('global_logo', 'data:image/png;base64,iVBORw0KGgo=')
  on conflict (key) do update set value = excluded.value$$, 'owner grava logo (upsert)');
select throws_ok($$insert into public.system_settings (key, value) values ('login_image_url', 'javascript:alert(1)')$$,
  '23514', null, 'valor que nao e imagem nem https rejeitado');
select throws_ok($$insert into public.system_settings (key, value) values ('outra_chave', '')$$, '23514', null, 'so duas chaves existem');
select throws_ok($$insert into public.system_settings (key, value) values ('login_image_url', 'data:image/svg+xml;base64,PHN2Zz4=')$$,
  '23514', null, 'SVG nao permitido');
reset role;
set local role anon;
select is((select value from public.system_settings where key = 'global_logo'), 'data:image/png;base64,iVBORw0KGgo=',
  'anon le a logo (tela de login)');
reset role;

-- ================================================================ 8. troca obrigatoria de senha
insert into public.user_security_flags (user_id, must_change_password) values
  ('00000000-0000-0000-0000-0000000000a1', true), ('00000000-0000-0000-0000-0000000000b1', true);
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.user_security_flags), 1, 'usuario le so a propria marca');
select throws_ok($$update public.user_security_flags set must_change_password = true$$, '42501', null, 'usuario nao liga a marca');
select lives_ok($$update public.user_security_flags set must_change_password = false$$, 'usuario limpa a propria marca');
select throws_ok($$insert into public.user_security_flags (user_id) values ('00000000-0000-0000-0000-0000000000a5')$$,
  '42501', null, 'usuario nao cria marcas');
reset role;
select is((select must_change_password from public.user_security_flags where user_id = '00000000-0000-0000-0000-0000000000b1'), true,
  'marca de outro usuario intacta');

select * from finish();
rollback;
