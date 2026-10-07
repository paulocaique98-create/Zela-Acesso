-- Fase 5C: visitante abre porta. O snapshot do Edge passa a levar as visitas com check-in do sitio (so ids, janela e
-- zonas liberadas; sem nome, documento, placa ou token) e a expiracao e agendada com pg_cron quando disponivel.
-- A decisao continua no motor (packages/domain): a visita ativa, dentro da janela e com a zona liberada e a concessao.
create or replace function public.edge_pull_snapshot(p_agent uuid, p_secret text, p_known_hash text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_tz text;
  v_body jsonb;
  v_hash text;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    for update;
  if not found then
    return null; -- generico: nao distingue id inexistente, segredo errado nem revogado
  end if;

  select s.timezone into v_tz from public.sites s where s.tenant_id = a.tenant_id and s.id = a.site_id;

  v_body := jsonb_build_object(
    'version', 1,
    'tenantId', a.tenant_id,
    'siteId', a.site_id,
    'timezone', v_tz,
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'antipassbackMode', z.antipassback_mode,
                                          'antipassbackResetMinutes', z.antipassback_reset_minutes) order by z.id)
      from public.zones z where z.tenant_id = a.tenant_id and z.site_id = a.site_id), '[]'::jsonb),
    'accessPoints', coalesce((
      select jsonb_agg(jsonb_build_object('id', ap.id, 'zoneId', ap.zone_id, 'status', ap.status,
                                          'direction', ap.direction, 'emergencyBehavior', ap.emergency_behavior,
                                          'offlineBehavior', ap.offline_behavior) order by ap.id)
      from public.access_points ap where ap.tenant_id = a.tenant_id and ap.site_id = a.site_id), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'groupId', p.group_id, 'zoneId', p.zone_id,
                                          'accessPointId', p.access_point_id, 'effect', p.effect,
                                          'scheduleId', p.schedule_id, 'requireChallenge', p.require_challenge,
                                          'status', p.status) order by p.id)
      from public.access_policies p
      where p.tenant_id = a.tenant_id and p.site_id = a.site_id and p.status = 'active'), '[]'::jsonb),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sc.id, 'validFrom', sc.valid_from, 'validUntil', sc.valid_until,
        'holidayBehavior', sc.holiday_behavior,
        'windows', coalesce((select jsonb_agg(jsonb_build_object(
                     'weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI:SS'),
                     'end', to_char(w.end_time, 'HH24:MI:SS')) order by w.weekday, w.start_time)
                   from public.access_schedule_windows w where w.schedule_id = sc.id), '[]'::jsonb),
        'holidayDates', coalesce((select jsonb_agg(to_char(h.holiday_date, 'YYYY-MM-DD') order by h.holiday_date)
                   from public.holidays h where h.calendar_id = sc.holiday_calendar_id), '[]'::jsonb)
      ) order by sc.id)
      from public.access_schedules sc
      where sc.tenant_id = a.tenant_id
        and sc.id in (select p.schedule_id from public.access_policies p
                      where p.tenant_id = a.tenant_id and p.site_id = a.site_id
                        and p.status = 'active' and p.schedule_id is not null)), '[]'::jsonb),
    'groupMembers', coalesce((
      select jsonb_agg(jsonb_build_object('groupId', m.group_id, 'personId', m.person_id)
                       order by m.group_id, m.person_id)
      from public.access_group_members m
      where m.tenant_id = a.tenant_id
        and m.group_id in (select p.group_id from public.access_policies p
                           where p.tenant_id = a.tenant_id and p.site_id = a.site_id and p.status = 'active')), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', pe.id, 'status', pe.status) order by pe.id)
      from public.people pe
      where pe.tenant_id = a.tenant_id
        and exists (select 1 from public.credentials c
                    where c.tenant_id = pe.tenant_id and c.person_id = pe.id and c.status <> 'revoked')), '[]'::jsonb),
    'credentials', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'personId', c.person_id, 'type', c.type, 'status', c.status,
                                          'secretHash', c.secret_hash, 'identifierHash', c.identifier_hash,
                                          'expiresAt', c.expires_at) order by c.id)
      from public.credentials c where c.tenant_id = a.tenant_id and c.status <> 'revoked'), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'personId', v.person_id, 'validFrom', v.valid_from,
        'validUntil', v.valid_until,
        'zoneIds', coalesce((select jsonb_agg(vz.zone_id order by vz.zone_id)
                             from public.visit_zones vz where vz.visit_id = v.id), '[]'::jsonb)) order by v.id)
      from public.visits v
      where v.tenant_id = a.tenant_id and v.site_id = a.site_id and v.status = 'checked_in'
        and v.person_id is not null and v.valid_until > now()), '[]'::jsonb)
  );
  v_hash := encode(extensions.digest(v_body::text, 'sha256'), 'hex');

  update public.edge_agents set last_snapshot_at = now(), last_snapshot_hash = v_hash where id = a.id;

  if p_known_hash is not null and p_known_hash = v_hash then
    return jsonb_build_object('unchanged', true, 'hash', v_hash, 'serverTime', now());
  end if;
  return jsonb_build_object('unchanged', false, 'hash', v_hash, 'serverTime', now(), 'snapshot', v_body);
end $$;
revoke all on function public.edge_pull_snapshot(uuid, text, text) from public, anon, authenticated;
grant execute on function public.edge_pull_snapshot(uuid, text, text) to service_role;

-- Expiracao agendada (a janela tambem e checada no motor, entao o job so limpa credencial/pessoa).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('zela-expire-due-visits', '* * * * *', 'select public.expire_due_visits()');
exception when others then
  raise notice 'pg_cron indisponivel (%); agende public.expire_due_visits() fora do banco', sqlerrm;
end $$;
