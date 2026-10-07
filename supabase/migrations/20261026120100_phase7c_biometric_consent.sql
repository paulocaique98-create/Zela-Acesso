-- Fase 7C: politica biometrica da organizacao, consentimento/ciencia append-only, perfil biometrico com
-- retencao e eliminacao (LGPD art. 5 II, 6, 11, 14; ver docs/21-ACCESS-CONTROL-VALIDATION-REQUIREMENTS.md).
-- Decisoes (D-019):
--  * UMA base legal por finalidade (NT 4/2026 ANPD), escolhida antes da coleta; so bases do art. 11 realistas
--    para controle de acesso: consentimento, prevencao a fraude/seguranca do titular (11,II,g) e obrigacao legal.
--  * Biometria desligada por padrao; so liga com base legal, retencao, aviso, contato do encarregado e RIPD vigente.
--  * O Postgres NAO guarda gabarito, imagem nem vetor: so uma referencia opaca (`template_ref`) ao provedor.
--  * Menores nunca: cadastro exige confirmacao de maioridade; visitantes nao tem perfil (minimizacao).
--  * Alternativa nao biometrica sempre oferecida; recusa e registrada e nao gera prejuizo.
--  * Retencao com prazo maximo; revogacao/expiracao revoga a credencial na hora e abre pedido de eliminacao no
--    provedor, confirmado depois (`confirm_biometric_erasure`). O Postgres nao afirma eliminacao fisica sozinho.
--  * Escritas SO por funcoes (security definer). Consentimentos sao append-only (revogar = novo registro).

-- ---------------------------------------------------------------- tipos e auxiliares
create type public.biometric_legal_basis as enum ('consent', 'fraud_prevention_security', 'legal_obligation');
create type public.biometric_profile_status as enum ('active', 'revoked', 'expired', 'erased');
create type public.biometric_consent_action as enum ('granted', 'revoked', 'refused');

create function app_private.tenant_feature_enabled(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.features_enabled ->> p_key = 'true' from public.tenants t where t.id = p_tenant), false);
$$;
revoke all on function app_private.tenant_feature_enabled(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- credencial biometrica
alter table public.credentials drop constraint credentials_shape;
alter table public.credentials add constraint credentials_shape check (
  (type = 'pin' and secret_hash is not null and identifier_hash is null)
  or (type = 'card' and identifier_hash is not null and secret_hash is null)
  or (type = 'mobile_token' and secret_hash is not null and identifier_hash is null and expires_at is not null)
  or (type = 'biometric' and secret_hash is null and identifier_hash is null and expires_at is not null)
);
create unique index credentials_biometric_unique on public.credentials (person_id)
  where type = 'biometric' and status <> 'revoked';

-- Credencial biometrica so nasce pelo cadastro guiado (enroll_biometric_profile), nunca por issue_credential/insert direto.
create function app_private.credentials_biometric_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type = 'biometric' and coalesce(current_setting('zela.bio_enroll', true), '') <> 'on' then
    raise exception 'Credencial biométrica só é criada pelo cadastro biométrico guiado.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger credentials_biometric_guard before insert on public.credentials
  for each row execute function app_private.credentials_biometric_guard();

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia. Recepcao NAO tem acesso.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'biometric:read'), ('organization_owner', 'biometric:manage'),
  ('organization_owner', 'biometric:enroll'),
  ('organization_admin', 'biometric:read'), ('organization_admin', 'biometric:manage'),
  ('organization_admin', 'biometric:enroll'),
  ('security_manager', 'biometric:read'), ('security_manager', 'biometric:enroll'),
  ('hr_manager', 'biometric:read'), ('hr_manager', 'biometric:enroll'),
  ('auditor', 'biometric:read');

-- ---------------------------------------------------------------- politica por organizacao
create table public.biometric_settings (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  enabled boolean not null default false,
  purpose text not null default 'access_control' check (purpose = 'access_control'),
  legal_basis public.biometric_legal_basis,
  retention_days integer check (retention_days is null or retention_days between 1 and 1095),
  notice_version text check (notice_version is null or char_length(notice_version) between 1 and 32),
  dpo_contact text check (dpo_contact is null or char_length(dpo_contact) between 5 and 200),
  ripd_version text check (ripd_version is null or char_length(ripd_version) between 1 and 32),
  ripd_reviewed_at date,
  ripd_next_review_at date,
  threshold numeric(3, 2) not null default 0.90 check (threshold >= 0.80 and threshold <= 1),
  require_liveness boolean not null default true,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint biometric_settings_enabled_complete check (
    not enabled or (legal_basis is not null and retention_days is not null and notice_version is not null
      and dpo_contact is not null and ripd_version is not null and ripd_reviewed_at is not null
      and ripd_next_review_at is not null)),
  constraint biometric_settings_ripd_dates check (
    ripd_reviewed_at is null or ripd_next_review_at is null
    or (ripd_next_review_at > ripd_reviewed_at and ripd_next_review_at <= ripd_reviewed_at + 366))
);
create trigger biometric_settings_set_updated_at before update on public.biometric_settings
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------- consentimento / ciencia (append-only)
-- `legal_basis` e o snapshot da base vigente. Quando a base nao e consentimento, `granted` registra a ciencia do
-- aviso e a oferta da alternativa, nao um consentimento.
create table public.biometric_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  person_id uuid not null,
  action public.biometric_consent_action not null,
  legal_basis public.biometric_legal_basis not null,
  notice_version text not null check (char_length(notice_version) between 1 and 32),
  retention_days integer not null check (retention_days between 1 and 1095),
  method text not null check (method in ('in_person', 'digital', 'system')),
  alternative_offered boolean not null default false,
  adult_confirmed boolean not null default false,
  reason text check (reason is null or reason in
    ('HOLDER_REQUEST', 'OPERATOR', 'POLICY_DISABLED', 'RETENTION_EXPIRED', 'MODULE_DISABLED', 'PERSON_INACTIVE')),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  constraint biometric_consents_granted_shape check (
    action <> 'granted' or (adult_confirmed and alternative_offered and method <> 'system')),
  constraint biometric_consents_refused_shape check (
    action <> 'refused' or (alternative_offered and method <> 'system')),
  constraint biometric_consents_revoked_shape check (action <> 'revoked' or reason is not null)
);
create index biometric_consents_person_idx on public.biometric_consents (tenant_id, person_id, recorded_at desc);

create function app_private.biometric_consents_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros de consentimento biométrico são imutáveis (append-only).';
end $$;
create trigger biometric_consents_no_update before update or delete on public.biometric_consents
  for each row execute function app_private.biometric_consents_immutable();

-- ---------------------------------------------------------------- perfil biometrico (so metadados + referencia opaca)
create table public.biometric_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  person_id uuid not null,
  credential_id uuid,
  consent_id uuid not null references public.biometric_consents (id) on delete restrict,
  provider text not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
  template_ref text check (template_ref is null or template_ref ~ '^[A-Za-z0-9:_.-]{8,200}$'),
  legal_basis public.biometric_legal_basis not null,
  status public.biometric_profile_status not null default 'active',
  enrolled_at timestamptz not null default now(),
  retention_until timestamptz not null,
  revoked_at timestamptz,
  erasure_requested_at timestamptz,
  erasure_confirmed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint biometric_profiles_retention check (retention_until > enrolled_at),
  constraint biometric_profiles_lifecycle check (
    (status = 'active' and template_ref is not null and credential_id is not null
       and revoked_at is null and erasure_requested_at is null and erasure_confirmed_at is null)
    or (status in ('revoked', 'expired') and revoked_at is not null and erasure_requested_at is not null
       and erasure_confirmed_at is null)
    or (status = 'erased' and template_ref is null and revoked_at is not null
       and erasure_requested_at is not null and erasure_confirmed_at is not null)
  )
);
create unique index biometric_profiles_one_active on public.biometric_profiles (tenant_id, person_id)
  where status = 'active';
create index biometric_profiles_retention_idx on public.biometric_profiles (retention_until) where status = 'active';
create index biometric_profiles_pending_erasure_idx on public.biometric_profiles (tenant_id)
  where status in ('revoked', 'expired');
create trigger biometric_profiles_set_updated_at before update on public.biometric_profiles
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.biometric_settings enable row level security;
alter table public.biometric_consents enable row level security;
alter table public.biometric_profiles enable row level security;
revoke all on public.biometric_settings, public.biometric_consents, public.biometric_profiles
  from public, anon, authenticated;
grant select on public.biometric_settings, public.biometric_consents to authenticated;
-- `template_ref` nunca legivel pelo navegador: so o servidor/provedor (service_role) precisa dele.
grant select (id, tenant_id, person_id, credential_id, consent_id, provider, legal_basis, status, enrolled_at,
              retention_until, revoked_at, erasure_requested_at, erasure_confirmed_at, created_by, updated_at)
  on public.biometric_profiles to authenticated;

create policy biometric_settings_select on public.biometric_settings for select to authenticated
  using (app_private.has_permission(tenant_id, 'biometric:read'));
create policy biometric_consents_select on public.biometric_consents for select to authenticated
  using (app_private.has_permission(tenant_id, 'biometric:read'));
create policy biometric_profiles_select on public.biometric_profiles for select to authenticated
  using (app_private.has_permission(tenant_id, 'biometric:read'));

-- ---------------------------------------------------------------- nucleo: revogar/expirar um perfil
-- Revoga a credencial na hora (o motor passa a negar apos sincronizar), abre o pedido de eliminacao no provedor e
-- grava o consentimento `revoked` (com motivo) e a auditoria. Sem dado biometrico em nenhum registro.
create function app_private.biometric_close_profile(
  p_profile uuid, p_new_status public.biometric_profile_status, p_reason text, p_actor uuid, p_method text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.biometric_profiles;
  c public.biometric_consents;
begin
  select * into p from public.biometric_profiles where id = p_profile for update;
  if not found or p.status <> 'active' then
    return;
  end if;
  -- aviso e retencao vigentes na coleta (snapshot do consentimento original)
  select * into c from public.biometric_consents where id = p.consent_id;
  update public.biometric_profiles
     set status = p_new_status, revoked_at = now(), erasure_requested_at = now()
   where id = p.id;
  if p.credential_id is not null then
    update public.credentials set status = 'revoked'
     where id = p.credential_id and tenant_id = p.tenant_id and status <> 'revoked';
  end if;
  insert into public.biometric_consents
    (tenant_id, person_id, action, legal_basis, notice_version, retention_days, method, reason, recorded_by)
  values
    (p.tenant_id, p.person_id, 'revoked', p.legal_basis, c.notice_version, c.retention_days, p_method, p_reason, p_actor);
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p.tenant_id, p_actor, 'biometric.' || p_new_status::text, 'biometric_profiles', p.id::text,
          jsonb_build_object('person_id', p.person_id, 'reason', p_reason));
end $$;
revoke all on function app_private.biometric_close_profile(uuid, public.biometric_profile_status, text, uuid, text)
  from public, anon, authenticated;

-- Pessoa deixa de estar ativa, vira menor de idade ou e excluida: a biometria sai junto (minimizacao; menor nunca).
create function app_private.people_biometric_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if tg_op = 'UPDATE' and not ((old.status = 'active' and new.status <> 'active')
       or (new.age_category = 'minor' and old.age_category is distinct from new.age_category)) then
    return new;
  end if;
  for r in select id from public.biometric_profiles
            where tenant_id = old.tenant_id and person_id = old.id and status = 'active' loop
    perform app_private.biometric_close_profile(r.id, 'revoked', 'PERSON_INACTIVE', (select auth.uid()), 'system');
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger people_biometric_cleanup_upd after update of status, age_category on public.people
  for each row execute function app_private.people_biometric_cleanup();
create trigger people_biometric_cleanup_del before delete on public.people
  for each row execute function app_private.people_biometric_cleanup();

-- ---------------------------------------------------------------- politica (definir/ligar/desligar)
create function public.set_biometric_settings(
  p_tenant uuid,
  p_enabled boolean,
  p_legal_basis public.biometric_legal_basis default null,
  p_retention_days integer default null,
  p_notice_version text default null,
  p_dpo_contact text default null,
  p_ripd_version text default null,
  p_ripd_reviewed_at date default null,
  p_ripd_next_review_at date default null,
  p_threshold numeric default 0.90,
  p_require_liveness boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old public.biometric_settings;
  r record;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'biometric:manage') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Informe se a biometria fica ligada.';
  end if;
  if p_enabled then
    if not app_private.tenant_feature_enabled(p_tenant, 'biometrics') then
      raise exception 'O módulo de biometria não está contratado para esta organização.';
    end if;
    if p_legal_basis is null then raise exception 'Escolha a base legal.'; end if;
    if p_retention_days is null or p_retention_days not between 1 and 1095 then
      raise exception 'Retenção deve ficar entre 1 e 1095 dias.';
    end if;
    if btrim(coalesce(p_notice_version, '')) = '' then raise exception 'Informe a versão do aviso de privacidade.'; end if;
    if char_length(btrim(coalesce(p_dpo_contact, ''))) < 5 then raise exception 'Informe o contato do encarregado.'; end if;
    if btrim(coalesce(p_ripd_version, '')) = '' then raise exception 'Informe a versão do RIPD.'; end if;
    if p_ripd_reviewed_at is null or p_ripd_reviewed_at > current_date then
      raise exception 'Data de revisão do RIPD inválida.';
    end if;
    if p_ripd_next_review_at is null or p_ripd_next_review_at <= p_ripd_reviewed_at
       or p_ripd_next_review_at > p_ripd_reviewed_at + 366 or p_ripd_next_review_at < current_date then
      raise exception 'Próxima revisão do RIPD inválida (futura e em até 1 ano da revisão).';
    end if;
  end if;
  if p_threshold is null or p_threshold < 0.80 or p_threshold > 1 or p_require_liveness is null then
    raise exception 'Limiar mínimo de 0,80.';
  end if;

  select * into old from public.biometric_settings where tenant_id = p_tenant for update;
  if found then
    -- uma unica base legal por finalidade: nao troca com perfis ativos (NT 4/2026)
    if p_enabled and old.legal_basis is not null and p_legal_basis is distinct from old.legal_basis
       and exists (select 1 from public.biometric_profiles
                    where tenant_id = p_tenant and status = 'active') then
      raise exception 'Não é possível trocar a base legal com perfis biométricos ativos. Revogue-os antes.';
    end if;
  end if;

  insert into public.biometric_settings
    (tenant_id, enabled, legal_basis, retention_days, notice_version, dpo_contact, ripd_version,
     ripd_reviewed_at, ripd_next_review_at, threshold, require_liveness)
  values
    (p_tenant, p_enabled, case when p_enabled then p_legal_basis end, case when p_enabled then p_retention_days end,
     case when p_enabled then btrim(p_notice_version) end, case when p_enabled then btrim(p_dpo_contact) end,
     case when p_enabled then btrim(p_ripd_version) end, case when p_enabled then p_ripd_reviewed_at end,
     case when p_enabled then p_ripd_next_review_at end, p_threshold, p_require_liveness)
  on conflict (tenant_id) do update set
    enabled = excluded.enabled, legal_basis = excluded.legal_basis, retention_days = excluded.retention_days,
    notice_version = excluded.notice_version, dpo_contact = excluded.dpo_contact,
    ripd_version = excluded.ripd_version, ripd_reviewed_at = excluded.ripd_reviewed_at,
    ripd_next_review_at = excluded.ripd_next_review_at, threshold = excluded.threshold,
    require_liveness = excluded.require_liveness, updated_by = (select auth.uid());

  if p_enabled then
    -- retencao menor passa a valer tambem para perfis ja cadastrados
    update public.biometric_profiles
       set retention_until = greatest(least(retention_until, enrolled_at + make_interval(days => p_retention_days)),
                                      enrolled_at + interval '1 minute')
     where tenant_id = p_tenant and status = 'active';
    update public.credentials c set expires_at = p.retention_until
      from public.biometric_profiles p
     where p.tenant_id = p_tenant and p.status = 'active' and c.id = p.credential_id and c.tenant_id = p.tenant_id
       and c.status <> 'revoked';
  elsif old.enabled is true then
    -- desligar = parar de tratar: perfis ativos sao revogados e entram na fila de eliminacao
    for r in select id from public.biometric_profiles where tenant_id = p_tenant and status = 'active' loop
      perform app_private.biometric_close_profile(r.id, 'revoked', 'POLICY_DISABLED', (select auth.uid()), 'system');
    end loop;
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'biometric_settings.update', 'biometric_settings', p_tenant::text,
          jsonb_build_object('enabled', p_enabled, 'legal_basis', p_legal_basis, 'retention_days', p_retention_days,
                             'notice_version', p_notice_version, 'ripd_version', p_ripd_version,
                             'threshold', p_threshold, 'require_liveness', p_require_liveness));
end $$;

-- ---------------------------------------------------------------- cadastro guiado
create function public.enroll_biometric_profile(
  p_tenant uuid,
  p_person uuid,
  p_provider text,
  p_template_ref text,
  p_method text,
  p_adult_confirmed boolean,
  p_alternative_offered boolean,
  p_notice_version text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.biometric_settings;
  v_person public.people;
  v_consent uuid;
  v_cred uuid;
  v_profile uuid;
  v_until timestamptz;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'biometric:enroll') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if not app_private.tenant_feature_enabled(p_tenant, 'biometrics') then
    raise exception 'O módulo de biometria não está contratado para esta organização.';
  end if;
  select * into s from public.biometric_settings where tenant_id = p_tenant;
  if not found or s.enabled is not true then
    raise exception 'A biometria está desligada para esta organização.';
  end if;
  if s.ripd_next_review_at < current_date then
    raise exception 'O RIPD está com a revisão vencida. Revise-o antes de novos cadastros.';
  end if;
  if p_notice_version is distinct from s.notice_version then
    raise exception 'Apresente a versão vigente do aviso de privacidade (%).', s.notice_version;
  end if;
  if p_adult_confirmed is not true then
    raise exception 'Biometria só pode ser cadastrada para maiores de 18 anos.';
  end if;
  if p_alternative_offered is not true then
    raise exception 'Informe que a alternativa não biométrica foi oferecida.';
  end if;
  if p_method is null or p_method not in ('in_person', 'digital') then
    raise exception 'Forma de coleta inválida.';
  end if;
  if p_provider is null or p_provider !~ '^[a-z0-9_-]{2,40}$' then
    raise exception 'Provedor inválido.';
  end if;
  if p_template_ref is null or p_template_ref !~ '^[A-Za-z0-9:_.-]{8,200}$' then
    raise exception 'Referência do gabarito inválida (informe só a referência opaca, nunca o gabarito).';
  end if;

  select * into v_person from public.people
   where id = p_person and tenant_id = p_tenant and status = 'active' for update;
  if not found then
    raise exception 'Pessoa não encontrada ou inativa.';
  end if;
  if v_person.kind = 'visitor' then
    raise exception 'Visitantes não têm cadastro biométrico.';
  end if;
  if v_person.age_category = 'minor' then
    raise exception 'Biometria não é permitida para menores de idade.';
  end if;
  if exists (select 1 from public.biometric_profiles
              where tenant_id = p_tenant and person_id = p_person and status = 'active') then
    raise exception 'Esta pessoa já tem um perfil biométrico ativo.';
  end if;

  v_until := now() + make_interval(days => s.retention_days);
  perform set_config('zela.bio_enroll', 'on', true);
  insert into public.credentials (tenant_id, person_id, type, label, expires_at)
  values (p_tenant, p_person, 'biometric', 'Biometria', v_until)
  returning id into v_cred;
  perform set_config('zela.bio_enroll', 'off', true);

  insert into public.biometric_consents
    (tenant_id, person_id, action, legal_basis, notice_version, retention_days, method,
     alternative_offered, adult_confirmed, recorded_by)
  values
    (p_tenant, p_person, 'granted', s.legal_basis, s.notice_version, s.retention_days, p_method,
     true, true, (select auth.uid()))
  returning id into v_consent;

  insert into public.biometric_profiles
    (tenant_id, person_id, credential_id, consent_id, provider, template_ref, legal_basis, retention_until)
  values
    (p_tenant, p_person, v_cred, v_consent, p_provider, p_template_ref, s.legal_basis, v_until)
  returning id into v_profile;

  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'biometric.enroll', 'biometric_profiles', v_profile::text,
          jsonb_build_object('person_id', p_person, 'provider', p_provider, 'legal_basis', s.legal_basis,
                             'retention_until', v_until, 'notice_version', s.notice_version));

  return jsonb_build_object('profile_id', v_profile, 'credential_id', v_cred, 'retention_until', v_until);
end $$;

-- Recusa registrada: a pessoa usa a alternativa (PIN/cartao/token) sem qualquer prejuizo.
create function public.refuse_biometric(p_tenant uuid, p_person uuid, p_notice_version text, p_method text default 'in_person')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.biometric_settings;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'biometric:enroll') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  select * into s from public.biometric_settings where tenant_id = p_tenant;
  if not found or s.enabled is not true then
    raise exception 'A biometria está desligada para esta organização.';
  end if;
  if p_notice_version is distinct from s.notice_version then
    raise exception 'Apresente a versão vigente do aviso de privacidade (%).', s.notice_version;
  end if;
  if p_method not in ('in_person', 'digital') then
    raise exception 'Forma de coleta inválida.';
  end if;
  if not exists (select 1 from public.people where id = p_person and tenant_id = p_tenant) then
    raise exception 'Pessoa não encontrada.';
  end if;
  insert into public.biometric_consents
    (tenant_id, person_id, action, legal_basis, notice_version, retention_days, method, alternative_offered, recorded_by)
  values
    (p_tenant, p_person, 'refused', s.legal_basis, s.notice_version, s.retention_days, p_method, true, (select auth.uid()));
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'biometric.refuse', 'people', p_person::text, '{}'::jsonb);
end $$;

-- Revogar nunca depende do modulo estar ligado: o titular pode retirar a qualquer momento.
create function public.revoke_biometric(p_tenant uuid, p_person uuid, p_reason text default 'HOLDER_REQUEST')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'biometric:enroll') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('HOLDER_REQUEST', 'OPERATOR') then
    raise exception 'Motivo inválido.';
  end if;
  select id into v_profile from public.biometric_profiles
   where tenant_id = p_tenant and person_id = p_person and status = 'active';
  if v_profile is null then
    raise exception 'Esta pessoa não tem perfil biométrico ativo.';
  end if;
  perform app_private.biometric_close_profile(v_profile, 'revoked', p_reason, (select auth.uid()), 'in_person');
end $$;

-- ---------------------------------------------------------------- retencao e eliminacao (servidor)
-- Expira perfis vencidos, ou de organizacoes que desligaram a politica / perderam o modulo. Agendada com pg_cron.
create function public.expire_due_biometric_profiles() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.id,
           case
             when not app_private.tenant_feature_enabled(p.tenant_id, 'biometrics') then 'MODULE_DISABLED'
             when coalesce(s.enabled, false) is not true then 'POLICY_DISABLED'
             else 'RETENTION_EXPIRED'
           end as reason
      from public.biometric_profiles p
      left join public.biometric_settings s on s.tenant_id = p.tenant_id
     where p.status = 'active'
       and (p.retention_until <= now()
            or not app_private.tenant_feature_enabled(p.tenant_id, 'biometrics')
            or coalesce(s.enabled, false) is not true)
  loop
    perform app_private.biometric_close_profile(r.id, 'expired', r.reason, null, 'system');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_due_biometric_profiles() from public, anon, authenticated;
grant execute on function public.expire_due_biometric_profiles() to service_role;

-- O provedor/Edge confirma que apagou o gabarito: so entao o perfil vira `erased` e a referencia some.
create function public.confirm_biometric_erasure(p_tenant uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.biometric_profiles;
begin
  select * into p from public.biometric_profiles where id = p_profile and tenant_id = p_tenant for update;
  if not found or p.status not in ('revoked', 'expired') then
    raise exception 'Perfil não está aguardando eliminação.';
  end if;
  update public.biometric_profiles
     set status = 'erased', template_ref = null, erasure_confirmed_at = now()
   where id = p.id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p.tenant_id, null, 'biometric.erased', 'biometric_profiles', p.id::text,
          jsonb_build_object('person_id', p.person_id));
end $$;
revoke all on function public.confirm_biometric_erasure(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_biometric_erasure(uuid, uuid) to service_role;

revoke all on function public.set_biometric_settings(uuid, boolean, public.biometric_legal_basis, integer, text, text, text, date, date, numeric, boolean)
  from public, anon;
grant execute on function public.set_biometric_settings(uuid, boolean, public.biometric_legal_basis, integer, text, text, text, date, date, numeric, boolean)
  to authenticated;
revoke all on function public.enroll_biometric_profile(uuid, uuid, text, text, text, boolean, boolean, text) from public, anon;
grant execute on function public.enroll_biometric_profile(uuid, uuid, text, text, text, boolean, boolean, text) to authenticated;
revoke all on function public.refuse_biometric(uuid, uuid, text, text) from public, anon;
grant execute on function public.refuse_biometric(uuid, uuid, text, text) to authenticated;
revoke all on function public.revoke_biometric(uuid, uuid, text) from public, anon;
grant execute on function public.revoke_biometric(uuid, uuid, text) to authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('zela-expire-biometric-profiles', '*/15 * * * *', 'select public.expire_due_biometric_profiles()');
exception when others then
  raise notice 'pg_cron indisponivel (%); agende public.expire_due_biometric_profiles() fora do banco', sqlerrm;
end $$;
