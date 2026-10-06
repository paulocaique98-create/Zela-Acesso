-- Fase 2A: zonas, pessoas, grupos de acesso e membros de grupo.
-- Segue o padrao da fundacao: tenant_id + RLS, privilegios por coluna (D-012), auditoria sem dado pessoal.

-- ---------------------------------------------------------------- enums
create type public.person_kind as enum ('employee', 'resident', 'contractor', 'other');
create type public.person_status as enum ('active', 'inactive');
create type public.age_category as enum ('adult', 'minor');

-- ---------------------------------------------------------------- tabelas
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  is_restricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  unique (site_id, name),
  unique (tenant_id, id)
);
create index zones_tenant_site_idx on public.zones (tenant_id, site_id);

-- Dados minimos (LGPD): sem CPF, sem foto, sem biometria. Pessoa e nivel tenant (nao pertence a um site).
create table public.people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 160),
  kind public.person_kind not null default 'employee',
  age_category public.age_category not null default 'adult',
  status public.person_status not null default 'active',
  external_ref text check (external_ref is null or char_length(external_ref) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index people_tenant_idx on public.people (tenant_id);
create unique index people_tenant_external_ref_key on public.people (tenant_id, external_ref)
  where external_ref is not null;

create table public.access_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);
create index access_groups_tenant_idx on public.access_groups (tenant_id);

-- FKs compostas com tenant_id: impossivel ligar pessoa de um tenant a grupo de outro.
create table public.access_group_members (
  tenant_id uuid not null,
  group_id uuid not null,
  person_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, person_id),
  foreign key (tenant_id, group_id) references public.access_groups (tenant_id, id) on delete cascade,
  foreign key (tenant_id, person_id) references public.people (tenant_id, id) on delete cascade
);
create index access_group_members_tenant_idx on public.access_group_members (tenant_id);
create index access_group_members_person_idx on public.access_group_members (person_id);

-- ---------------------------------------------------------------- matriz de permissoes
-- Espelhada em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'zone:read'), ('organization_owner', 'zone:create'),
  ('organization_owner', 'zone:update'), ('organization_owner', 'zone:delete'),
  ('organization_owner', 'person:read'), ('organization_owner', 'person:create'),
  ('organization_owner', 'person:update'), ('organization_owner', 'person:delete'),
  ('organization_owner', 'group:read'), ('organization_owner', 'group:create'),
  ('organization_owner', 'group:update'), ('organization_owner', 'group:delete'),
  ('organization_admin', 'zone:read'), ('organization_admin', 'zone:create'),
  ('organization_admin', 'zone:update'), ('organization_admin', 'zone:delete'),
  ('organization_admin', 'person:read'), ('organization_admin', 'person:create'),
  ('organization_admin', 'person:update'), ('organization_admin', 'person:delete'),
  ('organization_admin', 'group:read'), ('organization_admin', 'group:create'),
  ('organization_admin', 'group:update'), ('organization_admin', 'group:delete'),
  ('security_manager', 'zone:read'), ('security_manager', 'zone:create'),
  ('security_manager', 'zone:update'),
  ('security_manager', 'person:read'), ('security_manager', 'person:create'),
  ('security_manager', 'person:update'),
  ('security_manager', 'group:read'), ('security_manager', 'group:create'),
  ('security_manager', 'group:update'),
  ('receptionist', 'zone:read'),
  ('receptionist', 'person:read'), ('receptionist', 'person:create'), ('receptionist', 'person:update'),
  ('receptionist', 'group:read'),
  ('hr_manager', 'zone:read'),
  ('hr_manager', 'person:read'), ('hr_manager', 'person:create'),
  ('hr_manager', 'person:update'), ('hr_manager', 'person:delete'),
  ('hr_manager', 'group:read'),
  ('auditor', 'zone:read'), ('auditor', 'person:read'), ('auditor', 'group:read'),
  ('installer', 'zone:read'), ('installer', 'zone:create'), ('installer', 'zone:update'),
  ('viewer', 'zone:read');

-- ---------------------------------------------------------------- triggers
create trigger zones_set_updated_at before update on public.zones
  for each row execute function app_private.set_updated_at();
create trigger people_set_updated_at before update on public.people
  for each row execute function app_private.set_updated_at();
create trigger access_groups_set_updated_at before update on public.access_groups
  for each row execute function app_private.set_updated_at();

-- Auditoria: metadata minima. Nunca grava nome de pessoa (dado pessoal) no audit_log append-only.
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

create trigger zones_audit after insert or update or delete on public.zones
  for each row execute function app_private.audit_row_change();
create trigger people_audit after insert or update or delete on public.people
  for each row execute function app_private.audit_row_change();
create trigger access_groups_audit after insert or update or delete on public.access_groups
  for each row execute function app_private.audit_row_change();
create trigger access_group_members_audit after insert or delete on public.access_group_members
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RLS
alter table public.zones enable row level security;
alter table public.people enable row level security;
alter table public.access_groups enable row level security;
alter table public.access_group_members enable row level security;

-- Privilegios por coluna: tenant_id/site_id nao sao atualizaveis (nao move linha entre tenants/sites).
grant select, delete on public.zones to authenticated;
grant insert (tenant_id, site_id, name, description, is_restricted) on public.zones to authenticated;
grant update (name, description, is_restricted) on public.zones to authenticated;

grant select, delete on public.people to authenticated;
grant insert (tenant_id, full_name, kind, age_category, status, external_ref) on public.people to authenticated;
grant update (full_name, kind, age_category, status, external_ref) on public.people to authenticated;

grant select, delete on public.access_groups to authenticated;
grant insert (tenant_id, name, description) on public.access_groups to authenticated;
grant update (name, description) on public.access_groups to authenticated;

grant select, delete on public.access_group_members to authenticated;
grant insert (tenant_id, group_id, person_id) on public.access_group_members to authenticated;

-- zonas: escopo por site
create policy zones_select on public.zones for select to authenticated
  using (app_private.has_permission(tenant_id, 'zone:read', site_id));
create policy zones_insert on public.zones for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'zone:create', site_id));
create policy zones_update on public.zones for update to authenticated
  using (app_private.has_permission(tenant_id, 'zone:update', site_id))
  with check (app_private.has_permission(tenant_id, 'zone:update', site_id));
create policy zones_delete on public.zones for delete to authenticated
  using (app_private.has_permission(tenant_id, 'zone:delete', site_id));

-- pessoas e grupos: nivel tenant (exigem escopo tenant-inteiro)
create policy people_select on public.people for select to authenticated
  using (app_private.has_permission(tenant_id, 'person:read'));
create policy people_insert on public.people for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'person:create'));
create policy people_update on public.people for update to authenticated
  using (app_private.has_permission(tenant_id, 'person:update'))
  with check (app_private.has_permission(tenant_id, 'person:update'));
create policy people_delete on public.people for delete to authenticated
  using (app_private.has_permission(tenant_id, 'person:delete'));

create policy access_groups_select on public.access_groups for select to authenticated
  using (app_private.has_permission(tenant_id, 'group:read'));
create policy access_groups_insert on public.access_groups for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'group:create'));
create policy access_groups_update on public.access_groups for update to authenticated
  using (app_private.has_permission(tenant_id, 'group:update'))
  with check (app_private.has_permission(tenant_id, 'group:update'));
create policy access_groups_delete on public.access_groups for delete to authenticated
  using (app_private.has_permission(tenant_id, 'group:delete'));

-- membros de grupo: gerir membros = group:update
create policy access_group_members_select on public.access_group_members for select to authenticated
  using (app_private.has_permission(tenant_id, 'group:read'));
create policy access_group_members_insert on public.access_group_members for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'group:update'));
create policy access_group_members_delete on public.access_group_members for delete to authenticated
  using (app_private.has_permission(tenant_id, 'group:update'));
