-- Fase 2B (conclusao): janelas de acesso (Schedule), calendarios de feriados (HolidayCalendar) e fuso editavel.
-- Interface: "Janelas de acesso" (nao "Horarios"); no dominio seguem Schedule/HolidayCalendar.
-- Dia da semana ISO (1 = segunda ... 7 = domingo). Janela nao atravessa a meia-noite (inicio < fim; fim exclusivo):
-- turno noturno = duas janelas. A avaliacao usa o fuso do SITIO do ponto (site herda o do tenant), no motor (Fase 3).

-- ---------------------------------------------------------------- validacao de fuso (tenants e sites)
create function app_private.validate_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido.';
  end if;
  return new;
end $$;
create trigger tenants_validate_timezone before insert or update of timezone on public.tenants
  for each row execute function app_private.validate_timezone();
create trigger sites_validate_timezone before insert or update of timezone on public.sites
  for each row execute function app_private.validate_timezone();

-- dono da organizacao edita o fuso (a policy tenants_update ja exige tenant:update)
grant update (timezone) on public.tenants to authenticated;

-- ---------------------------------------------------------------- tabelas
create type public.holiday_behavior as enum ('deny', 'ignore');

create table public.holiday_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  calendar_id uuid not null,
  holiday_date date not null,
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, calendar_id) references public.holiday_calendars (tenant_id, id) on delete cascade,
  unique (calendar_id, holiday_date)
);
create index holidays_tenant_idx on public.holidays (tenant_id);

create table public.access_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  holiday_calendar_id uuid,
  holiday_behavior public.holiday_behavior not null default 'deny',
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  foreign key (tenant_id, holiday_calendar_id) references public.holiday_calendars (tenant_id, id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table public.access_schedule_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  schedule_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, schedule_id) references public.access_schedules (tenant_id, id) on delete cascade,
  check (start_time < end_time),
  unique (schedule_id, weekday, start_time)
);
create index access_schedule_windows_tenant_idx on public.access_schedule_windows (tenant_id);
create index access_schedule_windows_schedule_idx on public.access_schedule_windows (schedule_id);

create trigger holiday_calendars_set_updated_at before update on public.holiday_calendars
  for each row execute function app_private.set_updated_at();
create trigger access_schedules_set_updated_at before update on public.access_schedules
  for each row execute function app_private.set_updated_at();

-- Limite de volume por regra (evita tabela inflada por usuario autorizado).
create function app_private.limit_children() returns trigger
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
  end if;
  return new;
end $$;
create trigger access_schedule_windows_limit before insert on public.access_schedule_windows
  for each row execute function app_private.limit_children();
create trigger holidays_limit before insert on public.holidays
  for each row execute function app_private.limit_children();

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'schedule:read'), ('organization_owner', 'schedule:create'),
  ('organization_owner', 'schedule:update'), ('organization_owner', 'schedule:delete'),
  ('organization_admin', 'schedule:read'), ('organization_admin', 'schedule:create'),
  ('organization_admin', 'schedule:update'), ('organization_admin', 'schedule:delete'),
  ('security_manager', 'schedule:read'), ('security_manager', 'schedule:create'),
  ('security_manager', 'schedule:update'),
  ('receptionist', 'schedule:read'),
  ('hr_manager', 'schedule:read'),
  ('auditor', 'schedule:read'),
  ('installer', 'schedule:read');

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

create trigger holiday_calendars_audit after insert or update or delete on public.holiday_calendars
  for each row execute function app_private.audit_row_change();
create trigger holidays_audit after insert or delete on public.holidays
  for each row execute function app_private.audit_row_change();
create trigger access_schedules_audit after insert or update or delete on public.access_schedules
  for each row execute function app_private.audit_row_change();
create trigger access_schedule_windows_audit after insert or delete on public.access_schedule_windows
  for each row execute function app_private.audit_row_change();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.holiday_calendars enable row level security;
alter table public.holidays enable row level security;
alter table public.access_schedules enable row level security;
alter table public.access_schedule_windows enable row level security;

grant select, delete on public.holiday_calendars to authenticated;
grant insert (tenant_id, name) on public.holiday_calendars to authenticated;
grant update (name) on public.holiday_calendars to authenticated;

grant select, delete on public.holidays to authenticated;
grant insert (tenant_id, calendar_id, holiday_date, name) on public.holidays to authenticated;
grant update (name) on public.holidays to authenticated;

grant select, delete on public.access_schedules to authenticated;
grant insert (tenant_id, name, description, holiday_calendar_id, holiday_behavior, valid_from, valid_until)
  on public.access_schedules to authenticated;
grant update (name, description, holiday_calendar_id, holiday_behavior, valid_from, valid_until)
  on public.access_schedules to authenticated;

grant select, delete on public.access_schedule_windows to authenticated;
grant insert (tenant_id, schedule_id, weekday, start_time, end_time)
  on public.access_schedule_windows to authenticated;

-- Calendarios e feriados seguem a permissao schedule:* (mesma equipe que mantem as janelas).
create policy holiday_calendars_select on public.holiday_calendars for select to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:read'));
create policy holiday_calendars_insert on public.holiday_calendars for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'schedule:create'));
create policy holiday_calendars_update on public.holiday_calendars for update to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:update'))
  with check (app_private.has_permission(tenant_id, 'schedule:update'));
create policy holiday_calendars_delete on public.holiday_calendars for delete to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:delete'));

create policy holidays_select on public.holidays for select to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:read'));
create policy holidays_insert on public.holidays for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'schedule:update'));
create policy holidays_update on public.holidays for update to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:update'))
  with check (app_private.has_permission(tenant_id, 'schedule:update'));
create policy holidays_delete on public.holidays for delete to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:update'));

create policy access_schedules_select on public.access_schedules for select to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:read'));
create policy access_schedules_insert on public.access_schedules for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'schedule:create'));
create policy access_schedules_update on public.access_schedules for update to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:update'))
  with check (app_private.has_permission(tenant_id, 'schedule:update'));
create policy access_schedules_delete on public.access_schedules for delete to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:delete'));

create policy access_schedule_windows_select on public.access_schedule_windows for select to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:read'));
create policy access_schedule_windows_insert on public.access_schedule_windows for insert to authenticated
  with check (app_private.has_permission(tenant_id, 'schedule:update'));
create policy access_schedule_windows_delete on public.access_schedule_windows for delete to authenticated
  using (app_private.has_permission(tenant_id, 'schedule:update'));
