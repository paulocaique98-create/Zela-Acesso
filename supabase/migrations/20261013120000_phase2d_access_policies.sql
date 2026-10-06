-- Fase 2D: politicas de acesso (grupo -> zona ou ponto de acesso). Somente dados: quem decide e o motor (Fase 3).
-- Semantica (espelhada em packages/domain/src/policy.js): padrao negar; deny vigente vence allow; allow pode exigir desafio.

create type public.policy_effect as enum ('allow', 'deny');
create type public.policy_status as enum ('active', 'inactive');

-- FK composta precisa de (tenant_id, site_id, id) unico em pontos de acesso.
alter table public.access_points
  add constraint access_points_tenant_site_id_key unique (tenant_id, site_id, id);

create table public.access_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  group_id uuid not null,
  zone_id uuid,
  access_point_id uuid,
  effect public.policy_effect not null default 'allow',
  schedule_id uuid,
  require_challenge boolean not null default false,
  status public.policy_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- alvo: exatamente um entre zona e ponto
  constraint access_policies_one_target check ((zone_id is null) <> (access_point_id is null)),
  constraint access_policies_deny_no_challenge check (not (effect = 'deny' and require_challenge)),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  foreign key (tenant_id, group_id) references public.access_groups (tenant_id, id) on delete restrict,
  foreign key (tenant_id, site_id, zone_id) references public.zones (tenant_id, site_id, id) on delete restrict,
  foreign key (tenant_id, site_id, access_point_id)
    references public.access_points (tenant_id, site_id, id) on delete restrict,
  foreign key (tenant_id, schedule_id) references public.access_schedules (tenant_id, id) on delete restrict,
  unique (site_id, name),
  unique (tenant_id, id)
);
create index access_policies_tenant_site_idx on public.access_policies (tenant_id, site_id);
create index access_policies_group_idx on public.access_policies (group_id);
create index access_policies_zone_idx on public.access_policies (zone_id) where zone_id is not null;
create index access_policies_point_idx on public.access_policies (access_point_id) where access_point_id is not null;
create index access_policies_schedule_idx on public.access_policies (schedule_id) where schedule_id is not null;

create trigger access_policies_set_updated_at before update on public.access_policies
  for each row execute function app_private.set_updated_at();

-- Limite de volume: 1000 politicas por local.
create or replace function app_private.limit_policies() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.access_policies where site_id = new.site_id) >= 1000 then
    raise exception 'Limite de 1000 políticas por local.';
  end if;
  return new;
end $$;
create trigger access_policies_limit before insert on public.access_policies
  for each row execute function app_private.limit_policies();

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'policy:read'), ('organization_owner', 'policy:create'),
  ('organization_owner', 'policy:update'), ('organization_owner', 'policy:delete'),
  ('organization_admin', 'policy:read'), ('organization_admin', 'policy:create'),
  ('organization_admin', 'policy:update'), ('organization_admin', 'policy:delete'),
  ('security_manager', 'policy:read'), ('security_manager', 'policy:create'),
  ('security_manager', 'policy:update'),
  ('auditor', 'policy:read');

-- ---------------------------------------------------------------- auditoria
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
    v_meta := jsonb_build_object('name', r.name, 'status', r.status, 'timezone', r.timezone);
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object(
        'old_status', old.status, 'old_name', old.name, 'old_timezone', old.timezone
      );
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
    v_meta := jsonb_build_object(
      'name', r.name, 'site_id', r.site_id, 'is_restricted', r.is_restricted,
      'building_id', r.building_id, 'floor_id', r.floor_id
    );
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
  elsif tg_table_name = 'holiday_calendars' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name);
  elsif tg_table_name = 'holidays' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('calendar_id', r.calendar_id, 'holiday_date', r.holiday_date);
  elsif tg_table_name = 'access_schedules' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'name', r.name, 'holiday_calendar_id', r.holiday_calendar_id,
      'holiday_behavior', r.holiday_behavior, 'valid_from', r.valid_from, 'valid_until', r.valid_until
    );
  elsif tg_table_name = 'access_schedule_windows' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'schedule_id', r.schedule_id, 'weekday', r.weekday,
      'start_time', r.start_time, 'end_time', r.end_time
    );
  elsif tg_table_name = 'buildings' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name, 'site_id', r.site_id);
  elsif tg_table_name = 'floors' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object('name', r.name, 'building_id', r.building_id, 'level', r.level);
  elsif tg_table_name = 'access_points' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'name', r.name, 'site_id', r.site_id, 'zone_id', r.zone_id, 'type', r.type,
      'direction', r.direction, 'status', r.status, 'schedule_id', r.schedule_id,
      'emergency_behavior', r.emergency_behavior, 'offline_behavior', r.offline_behavior,
      'door_open_timeout_seconds', r.door_open_timeout_seconds
    );
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object(
        'old_status', old.status, 'old_emergency_behavior', old.emergency_behavior,
        'old_offline_behavior', old.offline_behavior, 'old_schedule_id', old.schedule_id
      );
    end if;
  elsif tg_table_name = 'access_policies' then
    v_tenant := r.tenant_id;
    v_meta := jsonb_build_object(
      'name', r.name, 'site_id', r.site_id, 'group_id', r.group_id, 'zone_id', r.zone_id,
      'access_point_id', r.access_point_id, 'effect', r.effect, 'schedule_id', r.schedule_id,
      'require_challenge', r.require_challenge, 'status', r.status
    );
    if tg_op = 'UPDATE' then
      v_meta := v_meta || jsonb_build_object(
        'old_effect', old.effect, 'old_status', old.status,
        'old_require_challenge', old.require_challenge, 'old_schedule_id', old.schedule_id
      );
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

create trigger access_policies_audit after insert or update or delete on public.access_policies
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.access_policies enable row level security;

-- tenant_id/site_id nao sao atualizaveis; alvo (zona/ponto) e grupo podem mudar (FK composta valida o local).
grant select, delete on public.access_policies to authenticated;
grant insert (
  tenant_id, site_id, name, description, group_id, zone_id, access_point_id, effect, schedule_id,
  require_challenge, status
) on public.access_policies to authenticated;
grant update (
  name, description, group_id, zone_id, access_point_id, effect, schedule_id, require_challenge, status
) on public.access_policies to authenticated;

create policy access_policies_select on public.access_policies for select to authenticated
  using (app_private.has_permission(tenant_id, 'policy:read', site_id));
create policy access_policies_insert on public.access_policies for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'policy:create', site_id));
create policy access_policies_update on public.access_policies for update to authenticated
  using (app_private.has_permission(tenant_id, 'policy:update', site_id))
  with check (app_private.has_permission(tenant_id, 'policy:update', site_id));
create policy access_policies_delete on public.access_policies for delete to authenticated
  using (app_private.has_permission(tenant_id, 'policy:delete', site_id));
