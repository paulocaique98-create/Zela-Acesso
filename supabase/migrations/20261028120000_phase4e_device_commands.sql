-- Fase 4E: emissor de comandos de dispositivo (D-021). A nuvem registra o PEDIDO do operador (auditado, por escopo de
-- site); a assinatura HMAC e feita no edge-gateway (a chave mestra nunca entra no banco). O agente busca os pedidos,
-- verifica a assinatura (apps/edge-agent/src/commands.js), aciona o HAL e devolve o resultado.
-- Nesta fase so existe `unlock` remoto: `lock` remoto pode impedir saida segura e fica PENDENTE de decisao.

insert into public.role_permissions (role, permission) values
  ('organization_owner', 'device:command'),
  ('organization_admin', 'device:command'),
  ('security_manager', 'device:command');

create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  agent_id uuid not null references public.edge_agents (id) on delete restrict,
  access_point_id uuid not null,
  action text not null check (action in ('unlock')),
  duration_ms integer check (duration_ms is null or duration_ms between 500 and 30000),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'executed', 'failed', 'rejected', 'expired')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  delivered_at timestamptz,
  expires_at timestamptz,
  result_code text check (result_code is null or result_code ~ '^[A-Z0-9_]{1,64}$'),
  resulted_at timestamptz,
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  foreign key (tenant_id, access_point_id) references public.access_points (tenant_id, id) on delete restrict
);
create index device_commands_agent_status_idx on public.device_commands (agent_id, status);
create index device_commands_tenant_site_idx on public.device_commands (tenant_id, site_id, requested_at desc);

alter table public.device_commands enable row level security;
revoke all on public.device_commands from anon, authenticated;
grant select on public.device_commands to authenticated;
create policy device_commands_select on public.device_commands for select to authenticated
  using (app_private.has_permission(tenant_id, 'device:command', site_id));

-- ---------------------------------------------------------------- pedido do operador
create function public.request_device_command(p_access_point uuid, p_action text, p_duration_ms integer, p_reason text)
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
  if p_action is distinct from 'unlock' or ap.status <> 'active'
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
revoke all on function public.request_device_command(uuid, text, integer, text) from public, anon;
grant execute on function public.request_device_command(uuid, text, integer, text) to authenticated;

-- ---------------------------------------------------------------- agente: buscar pedidos (a assinatura e do gateway)
create function public.edge_claim_commands(p_agent uuid, p_secret text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_out jsonb;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    for update;
  if not found then
    return null; -- generico
  end if;
  update public.device_commands set status = 'expired'
   where agent_id = a.id
     and ((status = 'pending' and requested_at <= now() - interval '2 minutes')
          or (status = 'delivered' and expires_at <= now()));
  with claimed as (
    update public.device_commands c
       set status = 'delivered', delivered_at = now(), expires_at = now() + interval '30 seconds'
     where c.agent_id = a.id and c.status = 'pending'
    returning c.id, c.access_point_id, c.action, c.duration_ms, c.delivered_at, c.expires_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'agentId', a.id, 'pointId', access_point_id,
           'action', action, 'durationMs', duration_ms, 'issuedAt', delivered_at, 'expiresAt', expires_at)), '[]'::jsonb)
    into v_out from claimed;
  return v_out;
end $$;
revoke all on function public.edge_claim_commands(uuid, text) from public, anon, authenticated;
grant execute on function public.edge_claim_commands(uuid, text) to service_role;

-- ---------------------------------------------------------------- agente: resultado
create function public.edge_report_command_result(p_agent uuid, p_secret text, p_command uuid, p_status text, p_code text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  c public.device_commands;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
  if not found then
    return false;
  end if;
  if p_status not in ('executed', 'failed', 'rejected') or p_code is null or p_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  update public.device_commands set status = p_status, result_code = p_code, resulted_at = now()
   where id = p_command and agent_id = a.id and status = 'delivered'
  returning * into c;
  if not found then
    return false; -- inexistente, de outro agente ou ja resolvido: sem distinguir
  end if;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (c.tenant_id, null, 'device_commands.result', 'device_commands', c.id::text,
          jsonb_build_object('site_id', c.site_id, 'access_point_id', c.access_point_id, 'status', p_status,
                             'code', p_code, 'agent_id', a.id));
  return true;
end $$;
revoke all on function public.edge_report_command_result(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.edge_report_command_result(uuid, text, uuid, text, text) to service_role;
