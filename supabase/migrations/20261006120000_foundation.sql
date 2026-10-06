-- Zela Acesso - Fase 1: fundacao multi-tenant (tenants, memberships, RBAC, RLS, auditoria)
-- Principios: deny-by-default; nenhum acesso para anon; escrita sensivel so via funcoes/RLS;
-- todo helper em schema nao exposto (app_private); search_path vazio em SECURITY DEFINER.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- Supabase concede privilegios amplos por padrao em tabelas novas. Revogar e conceder o minimo.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------- tipos
create type public.tenant_role as enum (
  'organization_owner', 'organization_admin', 'security_manager',
  'receptionist', 'hr_manager', 'auditor', 'installer', 'viewer'
);
create type public.platform_role as enum ('platform_owner', 'platform_support');
create type public.membership_status as enum ('active', 'suspended');
create type public.tenant_status as enum ('active', 'suspended');

-- ---------------------------------------------------------------- tabelas
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status public.tenant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Usuário' check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);
create index sites_tenant_id_idx on public.sites (tenant_id);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.tenant_role not null,
  -- null = escopo do tenant inteiro; array = restrito a esses sites (nunca vazio)
  scope_site_ids uuid[],
  status public.membership_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  check (scope_site_ids is null or cardinality(scope_site_ids) > 0)
);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

create table public.role_permissions (
  role public.tenant_role not null,
  permission text not null check (permission ~ '^[a-z_]+:[a-z_]+$'),
  primary key (role, permission)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete restrict,
  actor_user_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------- matriz de permissoes (fonte de verdade p/ RLS)
-- Espelhada em packages/domain/src/rbac.ts; scripts/check-rbac-drift.mjs detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'tenant:update'),
  ('organization_owner', 'member:read'), ('organization_owner', 'member:invite'),
  ('organization_owner', 'member:update_role'), ('organization_owner', 'member:remove'),
  ('organization_owner', 'site:read'), ('organization_owner', 'site:create'),
  ('organization_owner', 'site:update'), ('organization_owner', 'site:delete'),
  ('organization_owner', 'audit:read'),
  ('organization_admin', 'member:read'), ('organization_admin', 'member:invite'),
  ('organization_admin', 'member:update_role'), ('organization_admin', 'member:remove'),
  ('organization_admin', 'site:read'), ('organization_admin', 'site:create'),
  ('organization_admin', 'site:update'), ('organization_admin', 'site:delete'),
  ('organization_admin', 'audit:read'),
  ('security_manager', 'member:read'),
  ('security_manager', 'site:read'), ('security_manager', 'site:create'),
  ('security_manager', 'site:update'),
  ('security_manager', 'audit:read'),
  ('receptionist', 'site:read'),
  ('hr_manager', 'member:read'), ('hr_manager', 'site:read'),
  ('auditor', 'member:read'), ('auditor', 'site:read'), ('auditor', 'audit:read'),
  ('installer', 'site:read'), ('installer', 'site:update'),
  ('viewer', 'site:read');

-- ---------------------------------------------------------------- funcoes auxiliares
create function app_private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create function app_private.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.role = 'platform_owner'
  );
$$;

create function app_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

-- Membro ativo de tenant ativo (qualquer papel, qualquer escopo).
create function app_private.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and t.status = 'active'
  );
$$;

-- RBAC por recurso:acao + escopo. p_site nulo = operacao de nivel tenant (exige escopo tenant-inteiro).
create function app_private.has_permission(p_tenant uuid, p_permission text, p_site uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    join public.role_permissions rp on rp.role = m.role
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and t.status = 'active'
      and rp.permission = p_permission
      and (
        m.scope_site_ids is null
        or (p_site is not null and p_site = any (m.scope_site_ids))
      )
  );
$$;

create function app_private.role_rank(p_role public.tenant_role) returns int
language sql immutable set search_path = '' as $$
  select case p_role
    when 'organization_owner' then 3
    when 'organization_admin' then 2
    else 1
  end;
$$;

-- ---------------------------------------------------------------- triggers de integridade
create trigger tenants_set_updated_at before update on public.tenants
  for each row execute function app_private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();
create trigger sites_set_updated_at before update on public.sites
  for each row execute function app_private.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function app_private.set_updated_at();

-- Perfil automatico. Nunca usa e-mail como nome (evita vazar PII para outros membros).
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 120), ''), 'Usuário')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- Tenant: slug imutavel; status so muda por platform_owner (quando chamado por usuario autenticado).
create function app_private.guard_tenant_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'slug do tenant e imutavel' using errcode = '42501';
  end if;
  if current_setting('role', true) = 'authenticated'
     and new.status is distinct from old.status
     and not app_private.is_platform_owner() then
    raise exception 'somente platform_owner altera o status do tenant' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tenants_guard before update on public.tenants
  for each row execute function app_private.guard_tenant_update();

-- Memberships: hierarquia de papeis, sem autoelevacao, escopo valido, ultimo owner protegido.
create function app_private.guard_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_rank int;
  v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if new.scope_site_ids is not null and exists (
      select 1 from unnest(new.scope_site_ids) s(site_id)
      where not exists (
        select 1 from public.sites st where st.id = s.site_id and st.tenant_id = new.tenant_id
      )
    ) then
      raise exception 'escopo contem site de outro tenant ou inexistente' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.user_id <> old.user_id) then
    raise exception 'tenant_id e user_id de uma membership sao imutaveis' using errcode = '42501';
  end if;

  -- Hierarquia vale para chamadas via API (role = authenticated). Funcoes internas confiaveis
  -- (create_tenant) sinalizam bypass com GUC local a transacao; so SQL no servidor consegue defini-lo.
  if current_setting('role', true) = 'authenticated'
     and coalesce(current_setting('app_private.internal', true), '') <> 'create_tenant' then
    select max(app_private.role_rank(m.role)) into v_actor_rank
    from public.memberships m
    where m.tenant_id = v_tenant and m.user_id = v_actor
      and m.status = 'active' and m.scope_site_ids is null;

    if v_actor_rank is null then
      raise exception 'sem membership tenant-wide ativa' using errcode = '42501';
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
      if app_private.role_rank(new.role) >= v_actor_rank and v_actor_rank < 3 then
        raise exception 'papel igual ou superior ao seu nao pode ser atribuido' using errcode = '42501';
      end if;
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      if app_private.role_rank(old.role) >= v_actor_rank and v_actor_rank < 3 then
        raise exception 'papel igual ou superior ao seu nao pode ser alterado' using errcode = '42501';
      end if;
    end if;

    -- Sem autoalteracao/autoremocao/autocriacao: evita escalada e lockout.
    if (tg_op = 'INSERT' and new.user_id = v_actor)
       or (tg_op in ('UPDATE', 'DELETE') and old.user_id = v_actor) then
      raise exception 'nao e permitido alterar a propria membership' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      new.created_by := v_actor;
    end if;
  end if;

  -- Ultimo organization_owner ativo nao pode sair, ser rebaixado ou suspenso (qualquer origem).
  -- Vem depois da hierarquia: erros de permissao nao devem revelar o estado de owners.
  if tg_op in ('UPDATE', 'DELETE')
     and old.role = 'organization_owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'organization_owner' or new.status <> 'active')
     and not exists (
       select 1 from public.memberships m
       where m.tenant_id = old.tenant_id and m.id <> old.id
         and m.role = 'organization_owner' and m.status = 'active'
     ) then
    raise exception 'o tenant precisa manter ao menos um organization_owner ativo' using errcode = '23514';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $$;
create trigger memberships_guard before insert or update or delete on public.memberships
  for each row execute function app_private.guard_membership();

-- Auditoria append-only: UPDATE/DELETE/TRUNCATE bloqueados por trigger e por privilegio.
create function app_private.block_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log e append-only' using errcode = '42501';
end $$;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function app_private.block_audit_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app_private.block_audit_mutation();

-- Auditoria automatica. Metadata minima e nunca sensivel (sem e-mail, sem tokens).
create function app_private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := case tg_op when 'DELETE' then old else new end;
  v_tenant uuid;
  v_meta jsonb := '{}'::jsonb;
begin
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
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    v_tenant, (select auth.uid()),
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    r.id::text,
    v_meta
  );
  return r;
end $$;
create trigger tenants_audit after insert or update or delete on public.tenants
  for each row execute function app_private.audit_row_change();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app_private.audit_row_change();
create trigger sites_audit after insert or update or delete on public.sites
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RPC: criar tenant (somente platform_owner)
create function public.create_tenant(p_name text, p_slug text, p_owner_user_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'usuario owner inexistente' using errcode = '23503';
  end if;
  perform set_config('app_private.internal', 'create_tenant', true);
  insert into public.tenants (name, slug) values (p_name, p_slug) returning id into v_tenant;
  insert into public.memberships (tenant_id, user_id, role, created_by)
  values (v_tenant, p_owner_user_id, 'organization_owner', (select auth.uid()));
  perform set_config('app_private.internal', '', true);
  return v_tenant;
end $$;
revoke all on function public.create_tenant(text, text, uuid) from public, anon;
grant execute on function public.create_tenant(text, text, uuid) to authenticated;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------- RLS
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.sites enable row level security;
alter table public.memberships enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_log enable row level security;

-- Privilegios de tabela (RLS filtra as linhas). anon nao recebe nada.
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.tenants to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select on public.role_permissions to authenticated;
grant select on public.audit_log to authenticated;

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (app_private.is_member(id) or app_private.is_platform_admin());
create policy tenants_update on public.tenants for update to authenticated
  using (app_private.has_permission(id, 'tenant:update') or app_private.is_platform_owner())
  with check (app_private.has_permission(id, 'tenant:update') or app_private.is_platform_owner());

-- profiles: o proprio, ou quem compartilha tenant e tem member:read
create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.user_id
        and app_private.has_permission(m.tenant_id, 'member:read')
    )
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- platform_admins: so a propria linha
create policy platform_admins_select_own on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- role_permissions: configuracao estatica, legivel por autenticados
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (true);

-- sites (escopo por site)
create policy sites_select on public.sites for select to authenticated
  using (app_private.has_permission(tenant_id, 'site:read', id));
create policy sites_insert on public.sites for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'site:create'));
create policy sites_update on public.sites for update to authenticated
  using (app_private.has_permission(tenant_id, 'site:update', id))
  with check (app_private.has_permission(tenant_id, 'site:update', id));
create policy sites_delete on public.sites for delete to authenticated
  using (app_private.has_permission(tenant_id, 'site:delete', id));

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_permission(tenant_id, 'member:read'));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'member:invite'));
create policy memberships_update on public.memberships for update to authenticated
  using (app_private.has_permission(tenant_id, 'member:update_role'))
  with check (app_private.has_permission(tenant_id, 'member:update_role'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (app_private.has_permission(tenant_id, 'member:remove'));

-- audit_log: somente leitura para quem tem audit:read (escopo tenant inteiro)
create policy audit_log_select on public.audit_log for select to authenticated
  using (tenant_id is not null and app_private.has_permission(tenant_id, 'audit:read'));
