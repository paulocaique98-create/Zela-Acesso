-- Fase 2C: hierarquia fisica opcional (predios e andares; gap A-1) e pontos de acesso.
-- Predio e andar sao niveis OPCIONAIS: zona continua valida sem eles. Tudo com tenant_id, FK composta
-- (impossivel ligar linhas de tenants/locais diferentes), RLS e privilegios por coluna (D-012).
-- Pontos de acesso herdam o caminho ate o tenant via zona e ficam no escopo do local (site_id).
-- Controlador/leitores/sensor/rele sao so ROTULOS descritivos: os dispositivos reais so existem na Fase 4
-- (nenhum protocolo e inventado aqui). Politicas (Fase 2D) ainda nao se ligam ao ponto; a janela de acesso sim.

-- ---------------------------------------------------------------- enums
create type public.access_point_type as enum ('door', 'gate', 'turnstile', 'barrier', 'elevator', 'virtual');
create type public.access_point_direction as enum ('entry', 'exit', 'bidirectional');
create type public.access_point_status as enum ('active', 'inactive');
-- fail_safe: em falha de energia/emergencia o ponto LIBERA a passagem; fail_secure: permanece TRAVADO
-- (a saida segura de pessoas continua obrigacao da instalacao, nunca do software).
create type public.emergency_behavior as enum ('fail_safe', 'fail_secure');
-- Vocabulario do motor (Fase 3): sem conexao com a nuvem o Edge decide em modo degradado.
create type public.offline_behavior as enum ('degraded_deny', 'degraded_allow');

-- ---------------------------------------------------------------- tabelas
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  unique (site_id, name),
  unique (tenant_id, id),
  unique (tenant_id, site_id, id)
);
create index buildings_tenant_site_idx on public.buildings (tenant_id, site_id);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  building_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  level smallint not null default 0 check (level between -20 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id, building_id) references public.buildings (tenant_id, site_id, id)
    on delete restrict,
  unique (building_id, name),
  unique (tenant_id, id),
  unique (tenant_id, site_id, building_id, id)
);
create index floors_tenant_building_idx on public.floors (tenant_id, building_id);

-- zonas: predio/andar anulaveis; as FKs compostas (MATCH SIMPLE) so checam quando preenchidas.
alter table public.zones
  add column building_id uuid,
  add column floor_id uuid,
  add constraint zones_floor_requires_building check (floor_id is null or building_id is not null),
  add constraint zones_building_fkey foreign key (tenant_id, site_id, building_id)
    references public.buildings (tenant_id, site_id, id) on delete restrict,
  add constraint zones_floor_fkey foreign key (tenant_id, site_id, building_id, floor_id)
    references public.floors (tenant_id, site_id, building_id, id) on delete restrict,
  add constraint zones_tenant_site_id_key unique (tenant_id, site_id, id);
create index zones_building_idx on public.zones (building_id) where building_id is not null;
create index zones_floor_idx on public.zones (floor_id) where floor_id is not null;

create table public.access_points (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  zone_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  type public.access_point_type not null default 'door',
  direction public.access_point_direction not null default 'bidirectional',
  status public.access_point_status not null default 'active',
  controller_ref text check (controller_ref is null or char_length(controller_ref) <= 80),
  entry_reader_ref text check (entry_reader_ref is null or char_length(entry_reader_ref) <= 80),
  exit_reader_ref text check (exit_reader_ref is null or char_length(exit_reader_ref) <= 80),
  sensor_ref text check (sensor_ref is null or char_length(sensor_ref) <= 80),
  relay_ref text check (relay_ref is null or char_length(relay_ref) <= 80),
  schedule_id uuid,
  emergency_behavior public.emergency_behavior not null default 'fail_safe',
  offline_behavior public.offline_behavior not null default 'degraded_deny',
  door_open_timeout_seconds integer not null default 30 check (door_open_timeout_seconds between 1 and 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id, zone_id) references public.zones (tenant_id, site_id, id) on delete restrict,
  foreign key (tenant_id, schedule_id) references public.access_schedules (tenant_id, id) on delete restrict,
  unique (site_id, name),
  unique (tenant_id, id)
);
create index access_points_tenant_site_idx on public.access_points (tenant_id, site_id);
create index access_points_zone_idx on public.access_points (zone_id);
create index access_points_schedule_idx on public.access_points (schedule_id) where schedule_id is not null;

create trigger buildings_set_updated_at before update on public.buildings
  for each row execute function app_private.set_updated_at();
create trigger floors_set_updated_at before update on public.floors
  for each row execute function app_private.set_updated_at();
create trigger access_points_set_updated_at before update on public.access_points
  for each row execute function app_private.set_updated_at();

-- Limites de volume (evita tabela inflada por usuario autorizado).
create or replace function app_private.limit_children() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'access_schedule_windows' then
    if (select count(*) from public.access_schedule_windows where schedule_id = new.schedule_id) >= 100 then
      raise exception 'Limite de 100 janelas por regra.';
    end if;
  elsif tg_table_name = 'holidays' then
    if (select count(*) from public.holidays where calendar_id = new.calendar_id) >= 1000 then
      raise exception 'Limite de 1000 feriados por calendário.';
    end if;
  elsif tg_table_name = 'floors' then
    if (select count(*) from public.floors where building_id = new.building_id) >= 300 then
      raise exception 'Limite de 300 andares por prédio.';
    end if;
  end if;
  return new;
end $$;
create trigger floors_limit before insert on public.floors
  for each row execute function app_private.limit_children();

-- ---------------------------------------------------------------- permissoes
-- Predios e andares usam zone:* (mesma equipe que mantem a estrutura fisica). Pontos tem permissao propria.
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'access_point:read'), ('organization_owner', 'access_point:create'),
  ('organization_owner', 'access_point:update'), ('organization_owner', 'access_point:delete'),
  ('organization_admin', 'access_point:read'), ('organization_admin', 'access_point:create'),
  ('organization_admin', 'access_point:update'), ('organization_admin', 'access_point:delete'),
  ('security_manager', 'access_point:read'), ('security_manager', 'access_point:create'),
  ('security_manager', 'access_point:update'),
  ('installer', 'access_point:read'), ('installer', 'access_point:create'),
  ('installer', 'access_point:update'),
  ('receptionist', 'access_point:read'),
  ('auditor', 'access_point:read');

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

create trigger buildings_audit after insert or update or delete on public.buildings
  for each row execute function app_private.audit_row_change();
create trigger floors_audit after insert or update or delete on public.floors
  for each row execute function app_private.audit_row_change();
create trigger access_points_audit after insert or update or delete on public.access_points
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.access_points enable row level security;

-- tenant_id/site_id nao sao atualizaveis (nao move linha entre tenants/locais).
grant select, delete on public.buildings to authenticated;
grant insert (tenant_id, site_id, name, description) on public.buildings to authenticated;
grant update (name, description) on public.buildings to authenticated;

grant select, delete on public.floors to authenticated;
grant insert (tenant_id, site_id, building_id, name, level) on public.floors to authenticated;
grant update (name, level) on public.floors to authenticated;

grant insert (building_id, floor_id) on public.zones to authenticated;
grant update (building_id, floor_id) on public.zones to authenticated;

grant select, delete on public.access_points to authenticated;
grant insert (
  tenant_id, site_id, zone_id, name, description, type, direction, status, controller_ref,
  entry_reader_ref, exit_reader_ref, sensor_ref, relay_ref, schedule_id, emergency_behavior,
  offline_behavior, door_open_timeout_seconds
) on public.access_points to authenticated;
grant update (
  zone_id, name, description, type, direction, status, controller_ref, entry_reader_ref,
  exit_reader_ref, sensor_ref, relay_ref, schedule_id, emergency_behavior, offline_behavior,
  door_open_timeout_seconds
) on public.access_points to authenticated;

-- predios e andares: escopo por local, permissao de zona
create policy buildings_select on public.buildings for select to authenticated
  using (app_private.has_permission(tenant_id, 'zone:read', site_id));
create policy buildings_insert on public.buildings for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'zone:create', site_id));
create policy buildings_update on public.buildings for update to authenticated
  using (app_private.has_permission(tenant_id, 'zone:update', site_id))
  with check (app_private.has_permission(tenant_id, 'zone:update', site_id));
create policy buildings_delete on public.buildings for delete to authenticated
  using (app_private.has_permission(tenant_id, 'zone:delete', site_id));

create policy floors_select on public.floors for select to authenticated
  using (app_private.has_permission(tenant_id, 'zone:read', site_id));
create policy floors_insert on public.floors for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'zone:create', site_id));
create policy floors_update on public.floors for update to authenticated
  using (app_private.has_permission(tenant_id, 'zone:update', site_id))
  with check (app_private.has_permission(tenant_id, 'zone:update', site_id));
create policy floors_delete on public.floors for delete to authenticated
  using (app_private.has_permission(tenant_id, 'zone:delete', site_id));

create policy access_points_select on public.access_points for select to authenticated
  using (app_private.has_permission(tenant_id, 'access_point:read', site_id));
create policy access_points_insert on public.access_points for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'access_point:create', site_id));
create policy access_points_update on public.access_points for update to authenticated
  using (app_private.has_permission(tenant_id, 'access_point:update', site_id))
  with check (app_private.has_permission(tenant_id, 'access_point:update', site_id));
create policy access_points_delete on public.access_points for delete to authenticated
  using (app_private.has_permission(tenant_id, 'access_point:delete', site_id));
