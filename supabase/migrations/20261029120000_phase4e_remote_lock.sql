-- Fase 4E (fechamento): `lock` remoto. Reafirma o estado travado normal do ponto; NAO impede saida: o egresso livre
-- (barra antipanico/botoeira mecanica, emergency_behavior) e responsabilidade do hardware e nunca depende deste comando.
-- Mesmas protecoes do `unlock`: permissao device:command por site, motivo obrigatorio, 1 pedido em aberto por ponto,
-- entrega unica assinada, auditoria. `lock` nao aceita duracao.

alter table public.device_commands drop constraint device_commands_action_check;
alter table public.device_commands add constraint device_commands_action_check check (action in ('unlock', 'lock'));

create or replace function public.request_device_command(p_access_point uuid, p_action text, p_duration_ms integer, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ap public.access_points;
  v_agent uuid;
  v_id uuid;
begin
  select * into ap from public.access_points where id = p_access_point;
  if not found or (select auth.uid()) is null
     or not app_private.has_permission(ap.tenant_id, 'device:command', ap.site_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action not in ('unlock', 'lock') or ap.status <> 'active'
     or (p_action = 'lock' and p_duration_ms is not null)
     or (p_duration_ms is not null and p_duration_ms not between 500 and 30000)
     or p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'invalid_command' using errcode = '22023';
  end if;
  select e.id into v_agent from public.edge_agents e
    where e.tenant_id = ap.tenant_id and e.site_id = ap.site_id and e.status = 'active'
    order by e.last_seen_at desc nulls last limit 1;
  if v_agent is null then
    raise exception 'no_agent' using errcode = '22023';
  end if;
  -- um pedido em aberto por ponto: evita enfileirar aberturas repetidas
  if exists (select 1 from public.device_commands c
             where c.access_point_id = ap.id and c.status = 'pending' and c.requested_at > now() - interval '2 minutes')
     or exists (select 1 from public.device_commands c
                where c.access_point_id = ap.id and c.status = 'delivered' and c.expires_at > now()) then
    raise exception 'busy' using errcode = '22023';
  end if;
  insert into public.device_commands (tenant_id, site_id, agent_id, access_point_id, action, duration_ms, reason, requested_by)
  values (ap.tenant_id, ap.site_id, v_agent, ap.id, p_action, p_duration_ms, btrim(p_reason), (select auth.uid()))
  returning id into v_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (ap.tenant_id, (select auth.uid()), 'device_commands.request', 'device_commands', v_id::text,
          jsonb_build_object('site_id', ap.site_id, 'access_point_id', ap.id, 'action', p_action,
                             'agent_id', v_agent, 'reason', btrim(p_reason)));
  return v_id;
end $$;
