-- Fase 6A: alertas, incidentes e ocupacao (§ Fase 6). Alertas nascem no servidor: porta forcada/aberta (evento fisico
-- em access_events) e agente Edge offline (varredura). Sem texto livre vindo do dispositivo no alerta (so ids e tipo).
-- Escrita so por RPC/trigger; leitura por RLS (alert:read). Nao ha tabela de dispositivos: "dispositivo offline" =
-- Edge Agent sem heartbeat (limite documentado).

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  kind text not null check (kind in ('door_forced', 'door_held_open', 'device_offline')),
  severity text not null check (severity in ('critical', 'high', 'medium')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  access_point_id uuid,
  edge_agent_id uuid,
  source_event_id uuid, -- sem FK (append-only de access_events)
  dedup_key text not null check (char_length(dedup_key) between 3 and 200),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_at timestamptz not null,
  last_at timestamptz not null,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid, -- null com status resolved = resolvido automaticamente pelo sistema
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  incident_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  foreign key (tenant_id, access_point_id) references public.access_points (tenant_id, id) on delete set null (access_point_id),
  foreign key (tenant_id, edge_agent_id) references public.edge_agents (tenant_id, id) on delete set null (edge_agent_id),
  unique (tenant_id, id),
  check ((status = 'resolved') = (resolved_at is not null))
);
-- um alerta aberto/reconhecido por chave; recorrencia incrementa `occurrences`
create unique index alerts_open_dedup_key on public.alerts (tenant_id, dedup_key) where status <> 'resolved';
create index alerts_tenant_status_idx on public.alerts (tenant_id, site_id, status, last_at desc);
create index alerts_incident_idx on public.alerts (incident_id) where incident_id is not null;

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  title text not null check (char_length(title) between 3 and 160),
  description text check (description is null or char_length(description) <= 2000),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  created_by uuid not null,
  closed_by uuid,
  closed_at timestamptz,
  closure_note text check (closure_note is null or char_length(closure_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  unique (tenant_id, id),
  check ((status = 'closed') = (closed_at is not null))
);
create index incidents_tenant_status_idx on public.incidents (tenant_id, site_id, status, created_at desc);
alter table public.alerts
  add constraint alerts_incident_fk foreign key (tenant_id, incident_id)
  references public.incidents (tenant_id, id) on delete set null (incident_id);

create trigger alerts_set_updated_at before update on public.alerts
  for each row execute function app_private.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------- permissoes (espelhadas em domain/rbac.js)
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'alert:read'), ('organization_owner', 'alert:manage'),
  ('organization_admin', 'alert:read'), ('organization_admin', 'alert:manage'),
  ('security_manager', 'alert:read'), ('security_manager', 'alert:manage'),
  ('receptionist', 'alert:read'),
  ('auditor', 'alert:read');

-- ---------------------------------------------------------------- RLS
alter table public.alerts enable row level security;
alter table public.incidents enable row level security;
revoke all on public.alerts, public.incidents from anon, authenticated;
grant select on public.alerts, public.incidents to authenticated;
create policy alerts_select on public.alerts for select to authenticated
  using (app_private.has_permission(tenant_id, 'alert:read', site_id));
create policy incidents_select on public.incidents for select to authenticated
  using (app_private.has_permission(tenant_id, 'alert:read', site_id));

-- ---------------------------------------------------------------- geracao (interna)
create function app_private.raise_alert(p_tenant uuid, p_site uuid, p_kind text, p_severity text, p_point uuid,
                                        p_agent uuid, p_event uuid, p_key text, p_at timestamptz)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.alerts (tenant_id, site_id, kind, severity, access_point_id, edge_agent_id, source_event_id,
                             dedup_key, first_at, last_at)
  values (p_tenant, p_site, p_kind, p_severity, p_point, p_agent, p_event, p_key, p_at, p_at)
  on conflict (tenant_id, dedup_key) where status <> 'resolved'
  do update set occurrences = public.alerts.occurrences + 1,
                last_at = greatest(public.alerts.last_at, excluded.last_at)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function app_private.raise_alert(uuid, uuid, text, text, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;

create function app_private.alert_from_physical_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.physical_outcome in ('DOOR_FORCED', 'DOOR_HELD_OPEN') and new.access_point_id is not null then
    perform app_private.raise_alert(
      new.tenant_id, new.site_id,
      case new.physical_outcome when 'DOOR_FORCED' then 'door_forced' else 'door_held_open' end,
      case new.physical_outcome when 'DOOR_FORCED' then 'critical' else 'high' end,
      new.access_point_id, null, new.id,
      lower(new.physical_outcome) || ':' || new.access_point_id::text, new.occurred_at);
  end if;
  return new;
end $$;
create trigger access_events_alert after insert on public.access_events
  for each row execute function app_private.alert_from_physical_event();

-- Varredura de agentes sem heartbeat (service_role / pg_cron). Abre alerta e resolve sozinho quando o agente volta.
create function public.scan_offline_agents(p_threshold_seconds integer default 180)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  if p_threshold_seconds is null or p_threshold_seconds < 30 then
    raise exception 'invalid_threshold' using errcode = '22023';
  end if;
  for r in
    select a.id, a.tenant_id, a.site_id, a.last_seen_at
    from public.edge_agents a
    where a.status = 'active' and a.last_seen_at is not null
      and a.last_seen_at < now() - make_interval(secs => p_threshold_seconds)
  loop
    perform app_private.raise_alert(r.tenant_id, r.site_id, 'device_offline', 'high', null, r.id, null,
                                    'device_offline:' || r.id::text, now());
    v_n := v_n + 1;
  end loop;
  -- agente voltou (ou foi revogado): resolve automaticamente
  update public.alerts al
     set status = 'resolved', resolved_at = now(), resolution_note = 'Resolvido automaticamente: agente voltou ou foi revogado'
   where al.kind = 'device_offline' and al.status <> 'resolved'
     and not exists (select 1 from public.edge_agents a
                      where a.id = al.edge_agent_id and a.status = 'active'
                        and a.last_seen_at < now() - make_interval(secs => p_threshold_seconds));
  return v_n;
end $$;
revoke all on function public.scan_offline_agents(integer) from public, anon, authenticated;
grant execute on function public.scan_offline_agents(integer) to service_role;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('zela-scan-offline-agents', '* * * * *', 'select public.scan_offline_agents(180)');
exception when others then
  raise notice 'pg_cron indisponivel (%); agende public.scan_offline_agents() fora do banco', sqlerrm;
end $$;

-- ---------------------------------------------------------------- acoes do operador
create function app_private.audit_alert_action(p_alert public.alerts, p_action text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_alert.tenant_id, (select auth.uid()), p_action, 'alerts', p_alert.id::text,
          jsonb_build_object('site_id', p_alert.site_id, 'kind', p_alert.kind, 'status', p_alert.status));
$$;
revoke all on function app_private.audit_alert_action(public.alerts, text) from public, anon, authenticated;

create function public.acknowledge_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.alerts;
begin
  select * into a from public.alerts where id = p_alert for update;
  if not found or not app_private.has_permission(a.tenant_id, 'alert:manage', a.site_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.status <> 'open' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  update public.alerts set status = 'acknowledged', acknowledged_by = (select auth.uid()), acknowledged_at = now()
   where id = a.id returning * into a;
  perform app_private.audit_alert_action(a, 'alerts.acknowledge');
end $$;

create function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.alerts;
begin
  select * into a from public.alerts where id = p_alert for update;
  if not found or not app_private.has_permission(a.tenant_id, 'alert:manage', a.site_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.status = 'resolved' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  update public.alerts set status = 'resolved', resolved_by = (select auth.uid()), resolved_at = now(),
         resolution_note = nullif(btrim(p_note), '')
   where id = a.id returning * into a;
  perform app_private.audit_alert_action(a, 'alerts.resolve');
end $$;

-- Abre incidente e vincula alertas do mesmo sitio (opcional).
create function public.create_incident(p_site uuid, p_title text, p_description text, p_severity text,
                                       p_alerts uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.sites;
  v_id uuid;
begin
  select * into s from public.sites where id = p_site;
  if not found or not app_private.has_permission(s.tenant_id, 'alert:manage', s.id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_severity not in ('critical', 'high', 'medium', 'low') then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;
  insert into public.incidents (tenant_id, site_id, title, description, severity, created_by)
  values (s.tenant_id, s.id, btrim(p_title), nullif(btrim(p_description), ''), p_severity, (select auth.uid()))
  returning id into v_id;
  update public.alerts set incident_id = v_id
   where tenant_id = s.tenant_id and site_id = s.id and id = any (coalesce(p_alerts, '{}'));
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (s.tenant_id, (select auth.uid()), 'incidents.create', 'incidents', v_id::text,
          jsonb_build_object('site_id', s.id, 'severity', p_severity, 'alerts', coalesce(array_length(p_alerts, 1), 0)));
  return v_id;
end $$;

create function public.update_incident_status(p_incident uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.incidents;
begin
  select * into i from public.incidents where id = p_incident for update;
  if not found or not app_private.has_permission(i.tenant_id, 'alert:manage', i.site_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_status not in ('investigating', 'closed') or i.status = 'closed'
     or (p_note is not null and char_length(p_note) > 1000) then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  update public.incidents
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() end,
         closed_by = case when p_status = 'closed' then (select auth.uid()) end,
         closure_note = case when p_status = 'closed' then nullif(btrim(p_note), '') end
   where id = i.id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (i.tenant_id, (select auth.uid()), 'incidents.' || p_status, 'incidents', i.id::text,
          jsonb_build_object('site_id', i.site_id));
end $$;

revoke all on function public.acknowledge_alert(uuid), public.resolve_alert(uuid, text),
  public.create_incident(uuid, text, text, text, uuid[]), public.update_incident_status(uuid, text, text)
  from public, anon;
grant execute on function public.acknowledge_alert(uuid), public.resolve_alert(uuid, text),
  public.create_incident(uuid, text, text, text, uuid[]), public.update_incident_status(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------- ocupacao (por zona; respeita RLS de presence_states)
create view public.zone_occupancy with (security_invoker = true) as
  select z.tenant_id, z.site_id, z.id as zone_id, z.name as zone_name,
         count(ps.person_id) filter (where ps.state = 'present')::integer as present_count
  from public.zones z
  left join public.presence_states ps on ps.tenant_id = z.tenant_id and ps.zone_id = z.id
  group by z.tenant_id, z.site_id, z.id, z.name;
revoke all on public.zone_occupancy from anon, authenticated;
grant select on public.zone_occupancy to authenticated;
