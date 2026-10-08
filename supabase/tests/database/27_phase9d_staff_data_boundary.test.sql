-- Fase 9D (backlog #5): fronteira de dados da equipe da plataforma. Nenhuma policy RLS de tabela operacional do cliente
-- (pessoas, credenciais, eventos, auditoria, visitas, biometria, LGPD...) concede acesso a platform_owner/platform_support.
-- Se alguem acrescentar acesso permanente de suporte a dado de cliente, este teste falha e exige decisao explicita
-- (acesso JIT: temporario, justificado e auditado) em vez de uma policy permissiva.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is(
  (select coalesce(array_agg(distinct tablename order by tablename), '{}')
     from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_platform_(admin|owner)'),
  array['error_logs', 'platform_commercial_config', 'platform_module_prices', 'platform_plan_cycles', 'platform_plans',
        'platform_pricing_history', 'profiles', 'support_messages', 'support_threads', 'system_settings',
        'tenant_contracts', 'tenant_details', 'tenant_feature_changes', 'tenants']::name[],
  'so tabelas de plataforma/comercial/suporte (e perfis, tenants) tem policy de equipe da plataforma');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('people', 'credentials', 'access_events', 'audit_log', 'visits', 'biometric_profiles',
                        'biometric_consents', 'consent_record', 'data_subject_request', 'device_commands', 'presence_states')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_platform_'),
  0, 'dado pessoal, evidencia e auditoria do cliente nao tem policy de equipe da plataforma');

select * from finish();
rollback;
