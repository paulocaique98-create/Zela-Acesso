-- Fase 3D: anti-passback (§25). Modo por zona + estado de presenca por (pessoa, zona) mantido no backend.
-- A regra de violacao e pura e vive em packages/domain/src/antipassback.js; aqui so o estado e o acesso a ele.
-- Estado so e gravado por service_role (motor/Edge) apos passagem confirmada; reset administrativo e auditado.

create type public.antipassback_mode as enum ('off', 'soft', 'hard');

alter table public.zones
  add column antipassback_mode public.antipassback_mode not null default 'off',
  add column antipassback_reset_minutes integer
    check (antipassback_reset_minutes is null or antipassback_reset_minutes between 1 and 10080);
grant insert (antipassback_mode, antipassback_reset_minutes) on public.zones to authenticated;
grant update (antipassback_mode, antipassback_reset_minutes) on public.zones to authenticated;

create table public.presence_states (
  tenant_id uuid not null,
  site_id uuid not null,
  zone_id uuid not null,
  person_id uuid not null,
  state text not null check (state in ('present', 'absent', 'unknown')),
  since timestamptz not null,
  last_event_id uuid, -- sem FK: FK para access_events impediria o bloqueio de TRUNCATE do append-only (3C)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, zone_id, person_id),
  foreign key (tenant_id, site_id, zone_id) references public.zones (tenant_id, site_id, id) on delete cascade,
  foreign key (tenant_id, person_id) references public.people (tenant_id, id) on delete cascade
);
create index presence_states_person_idx on public.presence_states (tenant_id, person_id);
create index presence_states_site_idx on public.presence_states (tenant_id, site_id, zone_id);

-- ---------------------------------------------------------------- permissoes (espelhadas em domain/rbac.js)
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'presence:read'), ('organization_owner', 'presence:reset'),
  ('organization_admin', 'presence:read'), ('organization_admin', 'presence:reset'),
  ('security_manager', 'presence:read'), ('security_manager', 'presence:reset'),
  ('auditor', 'presence:read');

-- ---------------------------------------------------------------- leitura para o motor (server-side)
-- Devolve os insumos crus; a decisao de violacao e do dominio. Sem linha de presenca => state 'unknown'.
create function public.get_antipassback_context(p_tenant uuid, p_access_point uuid, p_person uuid)
returns table (zone_id uuid, direction public.access_point_direction, mode public.antipassback_mode,
               reset_minutes integer, state text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select z.id, ap.direction, z.antipassback_mode, z.antipassback_reset_minutes,
         coalesce(ps.state, 'unknown'), ps.since
  from public.access_points ap
  join public.zones z on z.tenant_id = ap.tenant_id and z.site_id = ap.site_id and z.id = ap.zone_id
  left join public.presence_states ps
    on ps.tenant_id = z.tenant_id and ps.zone_id = z.id and ps.person_id = p_person
  where ap.tenant_id = p_tenant and ap.id = p_access_point;
$$;
revoke all on function public.get_antipassback_context(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_antipassback_context(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------- gravacao (server-side)
-- Ignora evento mais antigo que o estado atual (replay offline fora de ordem nao regride a presenca).
create function public.commit_presence(p_tenant uuid, p_zone uuid, p_person uuid, p_state text,
                                       p_at timestamptz, p_event uuid default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_site uuid;
  v_n integer;
begin
  if p_state not in ('present', 'absent') then
    raise exception 'estado invalido' using errcode = '22023';
  end if;
  select z.site_id into v_site from public.zones z where z.tenant_id = p_tenant and z.id = p_zone;
  if v_site is null then
    raise exception 'zona nao encontrada' using errcode = 'P0002';
  end if;
  insert into public.presence_states as ps (tenant_id, site_id, zone_id, person_id, state, since, last_event_id)
    values (p_tenant, v_site, p_zone, p_person, p_state, p_at, p_event)
  on conflict (tenant_id, zone_id, person_id) do update
    set state = excluded.state, since = excluded.since, last_event_id = excluded.last_event_id, updated_at = now()
    where ps.since <= excluded.since;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.commit_presence(uuid, uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.commit_presence(uuid, uuid, uuid, text, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------- excecao administrativa (auditada)
-- p_person nulo = zona inteira. Estado volta a 'unknown' (nunca viola). Justificativa obrigatoria.
create function public.reset_presence(p_zone uuid, p_person uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  z public.zones;
  v_n integer;
begin
  select * into z from public.zones where id = p_zone;
  if not found or not app_private.has_permission(z.tenant_id, 'presence:read', z.site_id) then
    raise exception 'zona nao encontrada' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(z.tenant_id, 'presence:reset', z.site_id) then
    raise exception 'sem permissao para redefinir presenca' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'justificativa obrigatoria (min. 5 caracteres)' using errcode = '22023';
  end if;
  update public.presence_states
    set state = 'unknown', since = now(), last_event_id = null, updated_at = now()
    where tenant_id = z.tenant_id and zone_id = z.id and (p_person is null or person_id = p_person)
      and state <> 'unknown';
  get diagnostics v_n = row_count;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, reason, metadata)
    values (z.tenant_id, (select auth.uid()), 'presence.reset', 'zone', z.id::text, btrim(p_reason),
            jsonb_build_object('site_id', z.site_id, 'person_id', p_person, 'rows', v_n));
  return v_n;
end $$;
revoke all on function public.reset_presence(uuid, uuid, text) from public, anon;
grant execute on function public.reset_presence(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.presence_states enable row level security;
create policy presence_states_select on public.presence_states for select to authenticated
  using (app_private.has_permission(tenant_id, 'presence:read', site_id));
grant select on public.presence_states to authenticated;
-- escrita so por commit_presence/reset_presence (security definer); authenticated nao tem INSERT/UPDATE/DELETE.
