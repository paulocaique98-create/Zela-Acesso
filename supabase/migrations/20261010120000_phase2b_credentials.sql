-- Fase 2B: credenciais (PIN, cartao, token temporario) e fuso horario da organizacao.
-- Segredos nunca em texto puro: PIN = bcrypt (pgcrypto); cartao = sha256 com tenant como sal;
-- token = 256 bits aleatorios devolvidos UMA vez, guardados como sha256. Colunas de segredo nao sao
-- legiveis pelo role authenticated (privilegio por coluna, D-012). Emissao so pela funcao issue_credential.

-- ---------------------------------------------------------------- fuso da organizacao (§43)
alter table public.tenants
  add column timezone text not null default 'America/Sao_Paulo'
  check (char_length(timezone) between 3 and 64);

-- ---------------------------------------------------------------- tipos
create type public.credential_type as enum ('pin', 'card', 'mobile_token');
create type public.credential_status as enum ('active', 'suspended', 'revoked');

-- ---------------------------------------------------------------- tabela
create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  person_id uuid not null,
  type public.credential_type not null,
  label text check (label is null or char_length(label) <= 80),
  status public.credential_status not null default 'active',
  secret_hash text,
  identifier_hash text,
  hint text check (hint is null or char_length(hint) <= 8),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, person_id) references public.people (tenant_id, id) on delete cascade,
  constraint credentials_shape check (
    (type = 'pin' and secret_hash is not null and identifier_hash is null)
    or (type = 'card' and identifier_hash is not null and secret_hash is null)
    or (type = 'mobile_token' and secret_hash is not null and identifier_hash is null
        and expires_at is not null)
  ),
  constraint credentials_revoked_at check ((status = 'revoked') = (revoked_at is not null))
);
create index credentials_tenant_idx on public.credentials (tenant_id);
create index credentials_person_idx on public.credentials (person_id);
-- um cartao ativo/suspenso por identificador; revogado libera a reemissao
create unique index credentials_card_unique on public.credentials (tenant_id, identifier_hash)
  where identifier_hash is not null and status <> 'revoked';
-- um PIN vigente por pessoa (a verificacao e pessoa + PIN)
create unique index credentials_pin_unique on public.credentials (person_id)
  where type = 'pin' and status <> 'revoked';
create unique index credentials_token_unique on public.credentials (secret_hash)
  where type = 'mobile_token';

create trigger credentials_set_updated_at before update on public.credentials
  for each row execute function app_private.set_updated_at();

-- Revogacao e terminal: nao reativa nem edita; carimba revoked_at.
create function app_private.credentials_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'revoked' then
    raise exception 'Credencial revogada não pode ser alterada.';
  end if;
  if new.status = 'revoked' then
    new.revoked_at := now();
  end if;
  if old.type = 'mobile_token' and new.expires_at is distinct from old.expires_at
     and (new.expires_at is null or new.expires_at > now() + interval '366 days') then
    raise exception 'Validade do token inválida.';
  end if;
  return new;
end $$;
create trigger credentials_guard before update on public.credentials
  for each row execute function app_private.credentials_guard();

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'credential:read'), ('organization_owner', 'credential:create'),
  ('organization_owner', 'credential:update'),
  ('organization_admin', 'credential:read'), ('organization_admin', 'credential:create'),
  ('organization_admin', 'credential:update'),
  ('security_manager', 'credential:read'), ('security_manager', 'credential:create'),
  ('security_manager', 'credential:update'),
  ('receptionist', 'credential:read'), ('receptionist', 'credential:create'),
  ('receptionist', 'credential:update'),
  ('hr_manager', 'credential:read'),
  ('auditor', 'credential:read');

-- ---------------------------------------------------------------- auditoria (sem segredo, sem hash)
create or replace function app_private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := case tg_op when 'DELETE' then old else new end;
  v_tenant uuid;
  v_meta jsonb := '{}'::jsonb;
  v_rid text;
begin
  if tg_table_name = 'access_group_members' then
    v_rid := to_jsonb(r) ->> 'group_id' || ':' || (to_jsonb(r) ->> 'person_id');
  else
    v_rid := to_jsonb(r) ->> 'id';
  end if;

  if tg_table_name = 'tenants' then
    v_tenant := r.id;
    v_meta := jsonb_build_object('name', r.name, 'status', r.status);
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object('old_status', old.status, 'old_name', old.name);
    end if;
  elsif tg_table_name = 'memberships' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'target_user_id', r.user_id, 'role', r.role, 'status', r.status,
      'scope_site_ids', r.scope_site_ids
    );
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object(
        'old_role', old.role, 'old_status', old.status, 'old_scope_site_ids', old.scope_site_ids
      );
    end if;
  elsif tg_table_name = 'sites' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name);
  elsif tg_table_name = 'zones' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name, 'site_id', r.site_id, 'is_restricted', r.is_restricted);
  elsif tg_table_name = 'people' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('kind', r.kind, 'age_category', r.age_category, 'status', r.status);
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object('old_status', old.status, 'old_kind', old.kind);
    end if;
  elsif tg_table_name = 'access_groups' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name);
  elsif tg_table_name = 'access_group_members' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('group_id', r.group_id, 'person_id', r.person_id);
  elsif tg_table_name = 'credentials' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'person_id', r.person_id, 'type', r.type, 'status', r.status, 'expires_at', r.expires_at
    );
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object('old_status', old.status);
    end if;
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    v_tenant, (select auth.uid()),
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    v_rid,
    v_meta
  );
  return r;
end $$;

create trigger credentials_audit after insert or update or delete on public.credentials
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.credentials enable row level security;

-- Sem SELECT nas colunas de segredo; sem INSERT direto (so issue_credential); UPDATE so de rotulo/situacao/validade.
grant select (id, tenant_id, person_id, type, label, status, hint, expires_at, revoked_at,
              created_by, created_at, updated_at) on public.credentials to authenticated;
grant update (label, status, expires_at) on public.credentials to authenticated;

create policy credentials_select on public.credentials for select to authenticated
  using (app_private.has_permission(tenant_id, 'credential:read'));
create policy credentials_update on public.credentials for update to authenticated
  using (app_private.has_permission(tenant_id, 'credential:update'))
  with check (app_private.has_permission(tenant_id, 'credential:update'));
-- sem policy de insert/delete: a emissao e a funcao abaixo; credencial nao se apaga, se revoga.

-- ---------------------------------------------------------------- emissao
-- PIN: 6 a 8 digitos, sem repeticao total nem sequencia. Cartao: 4 a 32 caracteres alfanumericos.
-- Token: gerado aqui e devolvido uma unica vez; exige validade (maximo 366 dias).
create function public.issue_credential(
  p_tenant uuid,
  p_person uuid,
  p_type public.credential_type,
  p_secret text default null,
  p_label text default null,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_token text;
  v_card text;
  v_secret_hash text;
  v_ident_hash text;
  v_hint text;
  v_label text := nullif(btrim(p_label), '');
begin
  if (select auth.uid()) is null
     or not app_private.has_permission(p_tenant, 'credential:create') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.people
    where id = p_person and tenant_id = p_tenant and status = 'active'
  ) then
    raise exception 'Pessoa não encontrada ou inativa.';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Rótulo muito longo.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'A validade deve estar no futuro.';
  end if;

  if p_type = 'pin' then
    if p_secret is null or p_secret !~ '^[0-9]{6,8}$' then
      raise exception 'O PIN deve ter de 6 a 8 dígitos.';
    end if;
    if p_secret ~ '^(\d)\1+$'
       or position(p_secret in '0123456789') > 0
       or position(p_secret in '9876543210') > 0 then
      raise exception 'PIN muito previsível (repetido ou sequência).';
    end if;
    v_secret_hash := extensions.crypt(p_secret, extensions.gen_salt('bf', 10));
  elsif p_type = 'card' then
    v_card := upper(regexp_replace(coalesce(p_secret, ''), '[^0-9A-Za-z]', '', 'g'));
    if char_length(v_card) not between 4 and 32 then
      raise exception 'Número do cartão inválido.';
    end if;
    v_ident_hash := encode(extensions.digest(p_tenant::text || ':' || v_card, 'sha256'), 'hex');
    v_hint := right(v_card, 4);
  else
    if p_expires_at is null or p_expires_at > now() + interval '366 days' then
      raise exception 'O token exige validade de até 366 dias.';
    end if;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_secret_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  end if;

  begin
    insert into public.credentials
      (tenant_id, person_id, type, label, secret_hash, identifier_hash, hint, expires_at)
    values
      (p_tenant, p_person, p_type, v_label, v_secret_hash, v_ident_hash, v_hint, p_expires_at)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma credencial ativa deste tipo com esses dados.';
  end;

  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

revoke all on function public.issue_credential(uuid, uuid, public.credential_type, text, text, timestamptz)
  from public, anon;
grant execute on function public.issue_credential(uuid, uuid, public.credential_type, text, text, timestamptz)
  to authenticated;
