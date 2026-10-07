-- Fase 9A: nucleo LGPD (gap A-7 do documento base): politica de retencao, pedidos do titular e registro de
-- consentimento geral. Ver docs/06-LGPD.md.
-- Decisoes:
--  * Nenhum valor padrao de retencao e semeado: so existe politica declarada pela organizacao, e cada uma exige a
--    referencia do parecer juridico (`legal_opinion_ref`). Valores padrao dependem de parecer (doc base, 5 e 6).
--  * Esta fase DECLARA a politica; nada elimina dados automaticamente ainda (NAO IMPLEMENTADO).
--  * Prazo do pedido do titular: 15 dias corridos (LGPD art. 19, II) como padrao a validar com o juridico.
--  * Escritas SO por funcoes (security definer). Consentimento e append-only (revogar = novo registro).
--  * Biometria continua com consentimento proprio (`biometric_consents`, Fase 7C); aqui e a finalidade geral.
--  * Nenhum campo livre guarda dado pessoal do titular: pedidos ligam a `person_id`; a nota de resolucao nao deve
--    conter dados pessoais e o audit_log recebe so ids/codigos.

-- ---------------------------------------------------------------- tipos
create type public.privacy_data_category as enum ('access_events', 'visits', 'people', 'incidents', 'audit_log');
create type public.dsr_type as enum
  ('confirmation', 'access', 'correction', 'anonymization_deletion', 'portability', 'sharing_info',
   'consent_revocation', 'automated_review');
create type public.dsr_status as enum ('received', 'in_progress', 'completed', 'rejected');
create type public.consent_legal_basis as enum
  ('consent', 'legal_obligation', 'contract_execution', 'legitimate_interest', 'life_protection');
create type public.consent_record_action as enum ('granted', 'revoked', 'refused');

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'privacy:read'), ('organization_owner', 'privacy:manage'),
  ('organization_admin', 'privacy:read'), ('organization_admin', 'privacy:manage'),
  ('hr_manager', 'privacy:read'),
  ('auditor', 'privacy:read');

-- ---------------------------------------------------------------- politica de retencao
create table public.retention_policy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  data_category public.privacy_data_category not null,
  retention_days integer not null check (retention_days between 1 and 7300),
  legal_basis text not null check (char_length(btrim(legal_basis)) between 5 and 200),
  legal_opinion_ref text not null check (char_length(btrim(legal_opinion_ref)) between 3 and 200),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, data_category)
);
create trigger retention_policy_set_updated_at before update on public.retention_policy
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------- pedidos do titular
create table public.data_subject_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  person_id uuid not null,
  request_type public.dsr_type not null,
  channel text not null check (channel in ('in_person', 'email', 'portal', 'other')),
  status public.dsr_status not null default 'received',
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '15 days'),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(btrim(resolution_note)) between 3 and 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  handled_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint dsr_resolution_shape check (
    (status in ('received', 'in_progress') and resolved_at is null)
    or (status in ('completed', 'rejected') and resolved_at is not null and resolution_note is not null))
);
create index dsr_tenant_status_idx on public.data_subject_request (tenant_id, status, due_at);
create index dsr_person_idx on public.data_subject_request (tenant_id, person_id);
create trigger dsr_set_updated_at before update on public.data_subject_request
  for each row execute function app_private.set_updated_at();

-- Pedido e imutavel nos campos de origem; encerrado nao reabre; nunca apaga.
create function app_private.dsr_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Pedidos do titular não são apagados.';
  end if;
  if (new.tenant_id, new.person_id, new.request_type, new.channel, new.received_at, new.due_at)
     is distinct from (old.tenant_id, old.person_id, old.request_type, old.channel, old.received_at, old.due_at) then
    raise exception 'Os dados de origem do pedido são imutáveis.';
  end if;
  if old.status in ('completed', 'rejected') then
    raise exception 'Pedido encerrado não pode ser alterado.';
  end if;
  if old.status = 'in_progress' and new.status = 'received' then
    raise exception 'Pedido em andamento não volta para recebido.';
  end if;
  return new;
end $$;
create trigger dsr_guard before update or delete on public.data_subject_request
  for each row execute function app_private.dsr_guard();

-- ---------------------------------------------------------------- consentimento geral (append-only)
create table public.consent_record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  person_id uuid not null,
  purpose text not null check (purpose ~ '^[a-z0-9_]{3,60}$'),
  legal_basis public.consent_legal_basis not null,
  action public.consent_record_action not null,
  notice_version text not null check (char_length(btrim(notice_version)) between 1 and 32),
  method text not null check (method in ('in_person', 'digital', 'system')),
  recorded_by uuid default auth.uid() references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint consent_record_manual_only check (action = 'revoked' or method <> 'system')
);
create index consent_record_person_idx on public.consent_record (tenant_id, person_id, purpose, recorded_at desc);

create function app_private.consent_record_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros de consentimento são imutáveis (append-only).';
end $$;
create trigger consent_record_no_change before update or delete on public.consent_record
  for each row execute function app_private.consent_record_immutable();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.retention_policy enable row level security;
alter table public.data_subject_request enable row level security;
alter table public.consent_record enable row level security;
revoke all on public.retention_policy, public.data_subject_request, public.consent_record
  from public, anon, authenticated;
grant select on public.retention_policy, public.data_subject_request, public.consent_record to authenticated;

create policy retention_policy_select on public.retention_policy for select to authenticated
  using (app_private.has_permission(tenant_id, 'privacy:read'));
create policy dsr_select on public.data_subject_request for select to authenticated
  using (app_private.has_permission(tenant_id, 'privacy:read'));
create policy consent_record_select on public.consent_record for select to authenticated
  using (app_private.has_permission(tenant_id, 'privacy:read'));

-- ---------------------------------------------------------------- funcoes de escrita
create function public.set_retention_policy(
  p_tenant uuid, p_category public.privacy_data_category, p_days integer, p_legal_basis text, p_opinion_ref text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'privacy:manage') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_category is null then raise exception 'Escolha a categoria de dados.'; end if;
  if p_days is null or p_days not between 1 and 7300 then
    raise exception 'Retenção deve ficar entre 1 e 7300 dias.';
  end if;
  if char_length(btrim(coalesce(p_legal_basis, ''))) < 5 then raise exception 'Informe o fundamento da retenção.'; end if;
  if char_length(btrim(coalesce(p_opinion_ref, ''))) < 3 then
    raise exception 'Informe a referência do parecer jurídico que sustenta o prazo.';
  end if;
  insert into public.retention_policy (tenant_id, data_category, retention_days, legal_basis, legal_opinion_ref)
  values (p_tenant, p_category, p_days, btrim(p_legal_basis), btrim(p_opinion_ref))
  on conflict (tenant_id, data_category) do update
    set retention_days = excluded.retention_days, legal_basis = excluded.legal_basis,
        legal_opinion_ref = excluded.legal_opinion_ref, updated_by = (select auth.uid());
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'retention_policy.set', 'retention_policy', p_category::text,
          jsonb_build_object('retention_days', p_days));
end $$;

create function public.open_data_subject_request(
  p_tenant uuid, p_person uuid, p_type public.dsr_type, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'privacy:manage') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_type is null then raise exception 'Escolha o tipo de pedido.'; end if;
  if p_channel is null or p_channel not in ('in_person', 'email', 'portal', 'other') then
    raise exception 'Canal do pedido inválido.';
  end if;
  if not exists (select 1 from public.people where id = p_person and tenant_id = p_tenant) then
    raise exception 'Pessoa não encontrada nesta organização.';
  end if;
  insert into public.data_subject_request (tenant_id, person_id, request_type, channel)
  values (p_tenant, p_person, p_type, p_channel) returning id into v_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'dsr.open', 'data_subject_request', v_id::text,
          jsonb_build_object('person_id', p_person, 'request_type', p_type::text));
  return v_id;
end $$;

create function public.update_data_subject_request(p_id uuid, p_status public.dsr_status, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.data_subject_request;
begin
  select * into r from public.data_subject_request where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if (select auth.uid()) is null or not app_private.has_permission(r.tenant_id, 'privacy:manage') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_status is null or p_status = 'received' then raise exception 'Estado de destino inválido.'; end if;
  if p_status in ('completed', 'rejected') and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Registre a resolução do pedido (sem dados pessoais).';
  end if;
  update public.data_subject_request
     set status = p_status,
         resolution_note = case when p_status in ('completed', 'rejected') then btrim(p_note) else resolution_note end,
         resolved_at = case when p_status in ('completed', 'rejected') then now() else null end,
         handled_by = (select auth.uid())
   where id = p_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (r.tenant_id, (select auth.uid()), 'dsr.' || p_status::text, 'data_subject_request', p_id::text,
          jsonb_build_object('request_type', r.request_type::text, 'late', now() > r.due_at));
end $$;

create function public.record_consent(
  p_tenant uuid, p_person uuid, p_purpose text, p_basis public.consent_legal_basis,
  p_action public.consent_record_action, p_notice_version text, p_method text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'privacy:manage') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people where id = p_person and tenant_id = p_tenant) then
    raise exception 'Pessoa não encontrada nesta organização.';
  end if;
  if p_method is null or p_method not in ('in_person', 'digital') then
    raise exception 'Método inválido (o registro manual é presencial ou digital).';
  end if;
  insert into public.consent_record (tenant_id, person_id, purpose, legal_basis, action, notice_version, method)
  values (p_tenant, p_person, p_purpose, p_basis, p_action, p_notice_version, p_method)
  returning id into v_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'consent.' || p_action::text, 'consent_record', v_id::text,
          jsonb_build_object('person_id', p_person, 'purpose', p_purpose));
  return v_id;
end $$;

revoke all on function public.set_retention_policy(uuid, public.privacy_data_category, integer, text, text),
  public.open_data_subject_request(uuid, uuid, public.dsr_type, text),
  public.update_data_subject_request(uuid, public.dsr_status, text),
  public.record_consent(uuid, uuid, text, public.consent_legal_basis, public.consent_record_action, text, text)
  from public, anon;
grant execute on function public.set_retention_policy(uuid, public.privacy_data_category, integer, text, text),
  public.open_data_subject_request(uuid, uuid, public.dsr_type, text),
  public.update_data_subject_request(uuid, public.dsr_status, text),
  public.record_consent(uuid, uuid, text, public.consent_legal_basis, public.consent_record_action, text, text)
  to authenticated;
