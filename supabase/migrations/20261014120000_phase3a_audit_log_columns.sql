-- Fase 3A (gate R1, gap A-2): colunas faltantes do audit_log (§33). Migration ADITIVA: colunas anulaveis,
-- sem reescrever o historico. O append-only (trigger + privilegio) permanece; as novas colunas tambem
-- nao sao editaveis. ip/user_agent so sao preenchidos pela borda (Edge Function/servico via service_role).

alter table public.audit_log
  add column actor_type text,
  add column before jsonb,
  add column after jsonb,
  add column reason text,
  add column ip inet,
  add column user_agent text,
  add column correlation_id uuid,
  add constraint audit_log_actor_type_check check (actor_type is null or actor_type in ('user', 'system', 'device', 'service')),
  add constraint audit_log_reason_len check (reason is null or char_length(reason) <= 500),
  add constraint audit_log_user_agent_len check (user_agent is null or char_length(user_agent) <= 400);

-- Preenche actor_type e correlation_id sem reescrever as funcoes de auditoria existentes.
-- correlation_id vem do GUC `app.correlation_id` (uuid valido) quando a transacao o define; senao fica nulo.
create function app_private.audit_log_defaults() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_corr text := nullif(current_setting('app.correlation_id', true), '');
begin
  if new.actor_type is null then
    new.actor_type := case when new.actor_user_id is not null then 'user' else 'system' end;
  end if;
  if new.correlation_id is null and v_corr is not null then
    begin
      new.correlation_id := v_corr::uuid;
    exception when invalid_text_representation then
      new.correlation_id := null;
    end;
  end if;
  return new;
end $$;
create trigger audit_log_defaults before insert on public.audit_log
  for each row execute function app_private.audit_log_defaults();

create index audit_log_correlation_idx on public.audit_log (tenant_id, correlation_id)
  where correlation_id is not null;

-- leitura: audit:read (policy existente) continua valendo; colunas novas entram no grant de select ja existente.
-- Nenhum grant de insert/update para authenticated (mantido).
