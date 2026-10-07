-- Fase 7C: politica biometrica, consentimento append-only, perfil com retencao/eliminacao, RLS e isolamento.
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
update public.tenants set features_enabled = features_enabled || '{"biometrics":true}'::jsonb
 where id = '10000000-0000-0000-0000-00000000000a';
insert into public.memberships (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'organization_owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'receptionist'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'hr_manager'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'auditor'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'organization_owner');
insert into public.people (id, tenant_id, full_name, kind) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Pessoa 1', 'employee'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Pessoa 2', 'employee'),
  ('40000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'Pessoa 3', 'employee'),
  ('40000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'Visitante', 'visitor'),
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Pessoa B', 'employee');
insert into public.people (id, tenant_id, full_name, kind, age_category) values
  ('40000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'Menor', 'other', 'minor');

-- ------------------------------------------------------------ politica: permissao, modulo e completude
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.biometric_settings), 0::bigint, 'recepcao nao le a politica biometrica');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', false)$$, '42501',
  null, 'recepcao nao define a politica');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v1')$$, '42501',
  null, 'recepcao nao cadastra biometria');

select tests.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000b', true,
  'consent', 365, 'v1', 'dpo@beta.test', 'ripd-1', current_date, current_date + 300)$$, 'P0001',
  null, 'sem modulo contratado nao liga a biometria');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true)$$, 'P0001',
  null, 'ligar sem base legal/retencao/aviso/RIPD e recusado');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'consent', 5000, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 300)$$, 'P0001',
  null, 'retencao acima de 1095 dias e recusada');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'consent', 365, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 900)$$, 'P0001',
  null, 'RIPD com revisao a mais de 1 ano e recusado');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', false,
  null, null, null, null, null, null, null, 0.5)$$, 'P0001', null, 'limiar abaixo de 0,80 e recusado');
select lives_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'consent', 365, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 300)$$,
  'owner liga a biometria com politica completa');
select is((select count(*) from public.biometric_settings), 1::bigint, 'owner le a politica');
select is((select count(*) from public.audit_log where action = 'biometric_settings.update'), 1::bigint,
  'politica auditada');

-- ------------------------------------------------------------ cadastro guiado
select tests.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v0-antigo')$$, 'P0001',
  null, 'aviso desatualizado e recusado');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', false, true, 'v1')$$, 'P0001',
  null, 'sem confirmacao de maioridade e recusado');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', true, false, 'v1')$$, 'P0001',
  null, 'sem oferta de alternativa e recusado');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a4', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'visitante nao tem biometria');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a5', 'mock', 'tpl-ref-0099', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'menor de idade nunca tem biometria (mesmo com confirmacao do operador)');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'curto', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'referencia de gabarito invalida (nada de blob) e recusada');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000b1', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'pessoa de outro tenant nao e cadastravel');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0001', 'in_person', true, true, 'v1')$$,
  'rh cadastra o perfil biometrico');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0002', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'segundo perfil ativo para a mesma pessoa e recusado');
select is((select count(*) from public.biometric_profiles where status = 'active'), 1::bigint, 'perfil ativo visivel ao rh');
select throws_ok($$select template_ref from public.biometric_profiles$$, '42501',
  null, 'navegador nao le a referencia do gabarito');
select is((select count(*) from public.credentials where type = 'biometric' and status = 'active'), 1::bigint,
  'credencial biometrica criada');
select ok((select expires_at from public.credentials where type = 'biometric') <= now() + interval '366 days',
  'credencial biometrica expira junto da retencao');
select is((select count(*) from public.biometric_consents where action = 'granted' and legal_basis = 'consent'
           and alternative_offered and adult_confirmed), 1::bigint, 'ciencia/consentimento registrado com a base vigente');

select throws_ok($$select public.issue_credential('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'biometric', null, 'x', now() + interval '10 days')$$, '42501',
  null, 'issue_credential nao cria credencial biometrica');

-- recusa registrada
select lives_ok($$select public.refuse_biometric('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'v1')$$, 'recusa e registrada');
select is((select count(*) from public.biometric_consents where action = 'refused' and alternative_offered), 1::bigint,
  'recusa guardada com a alternativa oferecida');

-- ------------------------------------------------------------ append-only e inalterabilidade
reset role;
select throws_ok($$update public.biometric_consents set notice_version = 'x'$$, 'P0001', null, 'consentimento nao se altera');
select throws_ok($$delete from public.biometric_consents$$, 'P0001', null, 'consentimento nao se apaga');
select throws_ok($$insert into public.credentials (tenant_id, person_id, type, expires_at)
  values ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a2', 'biometric', now() + interval '1 day')$$,
  '42501', null, 'insert direto de credencial biometrica e barrado');

-- ------------------------------------------------------------ base legal unica e leitura por papel
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'fraud_prevention_security', 365, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 300)$$, 'P0001',
  null, 'nao troca a base legal com perfil ativo');
select tests.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.biometric_consents), 2::bigint, 'auditor le consentimentos');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'mock', 'tpl-ref-0003', 'in_person', true, true, 'v1')$$, '42501',
  null, 'auditor nao cadastra');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.biometric_profiles), 0::bigint, 'tenant B nao ve perfis do A');
select is((select count(*) from public.biometric_consents), 0::bigint, 'tenant B nao ve consentimentos do A');
select is((select count(*) from public.biometric_settings), 0::bigint, 'tenant B nao ve a politica do A');
select throws_ok($$select public.revoke_biometric('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1')$$, '42501', null, 'tenant B nao revoga perfil do A');

-- ------------------------------------------------------------ retencao reduzida vale para perfis existentes
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', true,
  'consent', 30, 'v1', 'dpo@alfa.test', 'ripd-1', current_date, current_date + 300)$$, 'retencao reduzida para 30 dias');
select ok((select retention_until from public.biometric_profiles where status = 'active') <= now() + interval '31 days',
  'perfil existente acompanha a retencao menor');

-- ------------------------------------------------------------ revogacao e eliminacao
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.revoke_biometric('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1')$$, 'rh revoga a biometria');
select is((select status::text from public.biometric_profiles), 'revoked', 'perfil revogado');
select ok((select erasure_requested_at is not null and erasure_confirmed_at is null from public.biometric_profiles),
  'eliminacao pedida e ainda nao confirmada');
select is((select count(*) from public.credentials where type = 'biometric' and status = 'revoked'), 1::bigint,
  'credencial biometrica revogada na hora');
select is((select count(*) from public.biometric_consents where action = 'revoked' and reason = 'HOLDER_REQUEST'), 1::bigint,
  'revogacao registrada como novo evento');
select throws_ok($$select public.revoke_biometric('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1')$$, 'P0001', null, 'revogar sem perfil ativo e recusado');
select throws_ok($$select public.confirm_biometric_erasure('10000000-0000-0000-0000-00000000000a',
  (select id from public.biometric_profiles))$$, '42501', null, 'usuario nao confirma eliminacao');

reset role;
select is((select template_ref from public.biometric_profiles), 'tpl-ref-0001',
  'referencia segue ate o provedor confirmar a eliminacao');
set local role service_role;
select lives_ok($$select public.confirm_biometric_erasure('10000000-0000-0000-0000-00000000000a',
  (select id from public.biometric_profiles))$$, 'servidor confirma a eliminacao');
select is((select status::text || ':' || coalesce(template_ref, 'null') from public.biometric_profiles), 'erased:null',
  'perfil apagado sem referencia');
reset role;

-- ------------------------------------------------------------ nova biometria apos eliminacao; pessoa inativa; RIPD vencido
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'mock', 'tpl-ref-0010', 'in_person', true, true, 'v1')$$, 'novo cadastro (pessoa 2)');
reset role;
update public.people set status = 'inactive' where id = '40000000-0000-0000-0000-0000000000a2';
select is((select status::text from public.biometric_profiles where person_id = '40000000-0000-0000-0000-0000000000a2'),
  'revoked', 'pessoa inativada tem a biometria revogada');
update public.people set status = 'active' where id = '40000000-0000-0000-0000-0000000000a2';
-- reclassificada como menor: a biometria sai
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'mock', 'tpl-ref-0011', 'in_person', true, true, 'v1')$$, 'recadastro da pessoa 2');
reset role;
update public.people set age_category = 'minor' where id = '40000000-0000-0000-0000-0000000000a2';
select is((select count(*) from public.biometric_profiles where person_id = '40000000-0000-0000-0000-0000000000a2' and status = 'active'), 0::bigint, 'pessoa reclassificada como menor perde a biometria');
update public.people set age_category = 'adult' where id = '40000000-0000-0000-0000-0000000000a2';

update public.biometric_settings set ripd_reviewed_at = current_date - 400, ripd_next_review_at = current_date - 40
 where tenant_id = '10000000-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a3', 'mock', 'tpl-ref-0020', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'RIPD vencido bloqueia novos cadastros');
reset role;
update public.biometric_settings set ripd_reviewed_at = current_date, ripd_next_review_at = current_date + 300
 where tenant_id = '10000000-0000-0000-0000-00000000000a';

-- ------------------------------------------------------------ expiracao por retencao e por modulo desligado
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a3', 'mock', 'tpl-ref-0030', 'in_person', true, true, 'v1')$$, 'cadastro da pessoa 3');
select throws_ok($$select public.expire_due_biometric_profiles()$$, '42501', null, 'usuario nao roda a expiracao');
reset role;
update public.biometric_profiles set enrolled_at = now() - interval '40 days', retention_until = now() - interval '1 minute'
 where person_id = '40000000-0000-0000-0000-0000000000a3' and status = 'active';
set local role service_role;
select is(public.expire_due_biometric_profiles(), 1, 'servidor expira o perfil vencido');
reset role;
select is((select status::text from public.biometric_profiles where person_id = '40000000-0000-0000-0000-0000000000a3'),
  'expired', 'perfil expirado');
select is((select reason from public.biometric_consents where person_id = '40000000-0000-0000-0000-0000000000a3'
            and action = 'revoked'), 'RETENTION_EXPIRED', 'motivo RETENTION_EXPIRED registrado');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a1', 'mock', 'tpl-ref-0040', 'in_person', true, true, 'v1')$$, 'recadastro da pessoa 1');
reset role;
update public.tenants set features_enabled = features_enabled || '{"biometrics":false}'::jsonb
 where id = '10000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(public.expire_due_biometric_profiles(), 1, 'modulo desligado pela plataforma expira os perfis');
reset role;
select is((select count(*) from public.biometric_consents where person_id = '40000000-0000-0000-0000-0000000000a1'
            and action = 'revoked' and reason = 'MODULE_DISABLED'), 1::bigint, 'motivo MODULE_DISABLED');
update public.tenants set features_enabled = features_enabled || '{"biometrics":true}'::jsonb
 where id = '10000000-0000-0000-0000-00000000000a';

-- ------------------------------------------------------------ desligar a politica revoga os perfis ativos
select tests.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a3', 'mock', 'tpl-ref-0050', 'in_person', true, true, 'v1')$$, 'cadastro antes de desligar');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_biometric_settings('10000000-0000-0000-0000-00000000000a', false)$$, 'owner desliga a politica');
select is((select count(*) from public.biometric_profiles where status = 'active'), 0::bigint,
  'desligar a politica revoga os perfis ativos');
select is((select enabled from public.biometric_settings), false, 'politica desligada');
select throws_ok($$select public.enroll_biometric_profile('10000000-0000-0000-0000-00000000000a',
  '40000000-0000-0000-0000-0000000000a2', 'mock', 'tpl-ref-0060', 'in_person', true, true, 'v1')$$, 'P0001',
  null, 'com a biometria desligada nao ha cadastro');

-- ------------------------------------------------------------ nada sensivel na auditoria
reset role;
select is((select count(*) from public.audit_log where action like 'biometric%' and metadata::text ~* 'tpl-ref'), 0::bigint,
  'auditoria nao guarda a referencia do gabarito');

select * from finish();
rollback;
