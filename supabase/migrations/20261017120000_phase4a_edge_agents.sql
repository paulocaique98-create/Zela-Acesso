-- Fase 4A: identidade do Edge Agent (§19). Enrollment com token de uso unico, credencial propria do agente
-- (alta entropia, so o hash e guardado), rotacao, revogacao e heartbeat. Funcoes do agente so para service_role
-- (chamadas por Edge Function que valida TLS/rate limit); administracao so por usuario com permissao.
-- Nenhum token/segredo vai para audit_log nem para metadata.

create type public.edge_agent_status as enum ('pending', 'active', 'revoked');

create table public.edge_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  status public.edge_agent_status not null default 'pending',
  enrollment_token_hash text,
  enrollment_expires_at timestamptz,
  secret_hash text,
  secret_rotated_at timestamptz,
  hostname text check (hostname is null or char_length(hostname) <= 120),
  agent_version text check (agent_version is null or char_length(agent_version) <= 40),
  enrolled_at timestamptz,
  last_seen_at timestamptz,
  last_clock_drift_seconds integer,
  last_queue_depth integer check (last_queue_depth is null or last_queue_depth >= 0),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  unique (site_id, name),
  unique (tenant_id, id),
  -- pending: so token; active: so segredo; revoked: nenhum dos dois.
  check ((status = 'pending' and enrollment_token_hash is not null and enrollment_expires_at is not null and secret_hash is null)
      or (status = 'active' and enrollment_token_hash is null and secret_hash is not null)
      or (status = 'revoked' and enrollment_token_hash is null and secret_hash is null))
);
create unique index edge_agents_enrollment_token_key on public.edge_agents (enrollment_token_hash)
  where enrollment_token_hash is not null;
create unique index edge_agents_secret_key on public.edge_agents (secret_hash) where secret_hash is not null;
create index edge_agents_tenant_site_idx on public.edge_agents (tenant_id, site_id);

create trigger edge_agents_set_updated_at before update on public.edge_agents
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------- permissoes (espelhadas em domain/rbac.js)
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'edge_agent:read'), ('organization_owner', 'edge_agent:create'), ('organization_owner', 'edge_agent:revoke'),
  ('organization_admin', 'edge_agent:read'), ('organization_admin', 'edge_agent:create'), ('organization_admin', 'edge_agent:revoke'),
  ('security_manager', 'edge_agent:read'), ('security_manager', 'edge_agent:revoke'),
  ('installer', 'edge_agent:read'), ('installer', 'edge_agent:create'),
  ('auditor', 'edge_agent:read');

-- ---------------------------------------------------------------- RLS (leitura; escrita so por RPC)
alter table public.edge_agents enable row level security;
create policy edge_agents_select on public.edge_agents for select to authenticated
  using (app_private.has_permission(tenant_id, 'edge_agent:read', site_id));
-- Colunas de segredo nunca saem pela API: grant por coluna, sem os hashes.
revoke all on public.edge_agents from anon, authenticated;
grant select (id, tenant_id, site_id, name, status, enrollment_expires_at, hostname, agent_version, enrolled_at,
              last_seen_at, last_clock_drift_seconds, last_queue_depth, revoked_at, revoked_reason, created_at, updated_at)
  on public.edge_agents to authenticated;

-- ---------------------------------------------------------------- administracao
-- Cria o agente pendente e devolve o token de enrollment UMA vez (24h, uso unico).
create function public.create_edge_agent(p_site uuid, p_name text)
returns table (agent_id uuid, enrollment_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  s public.sites;
  v_token text;
  v_id uuid;
  v_exp timestamptz := now() + interval '24 hours';
begin
  select * into s from public.sites where id = p_site;
  if not found or not app_private.has_permission(s.tenant_id, 'edge_agent:read', s.id) then
    raise exception 'unidade nao encontrada' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(s.tenant_id, 'edge_agent:create', s.id) then
    raise exception 'sem permissao para cadastrar agente' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 120 then
    raise exception 'nome invalido' using errcode = '22023';
  end if;
  if (select count(*) from public.edge_agents where site_id = s.id and status <> 'revoked') >= 20 then
    raise exception 'limite de 20 agentes por unidade' using errcode = '54000';
  end if;
  v_token := 'zea_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.edge_agents (tenant_id, site_id, name, enrollment_token_hash, enrollment_expires_at, created_by)
    values (s.tenant_id, s.id, btrim(p_name), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_exp, (select auth.uid()))
    returning id into v_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    values (s.tenant_id, (select auth.uid()), 'edge_agent.create', 'edge_agent', v_id::text,
            jsonb_build_object('site_id', s.id, 'name', btrim(p_name)));
  return query select v_id, v_token, v_exp;
end $$;
revoke all on function public.create_edge_agent(uuid, text) from public, anon;
grant execute on function public.create_edge_agent(uuid, text) to authenticated;

-- Revoga (irreversivel): o agente perde acesso imediatamente; novo agente = novo enrollment.
create function public.revoke_edge_agent(p_agent uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
begin
  select * into a from public.edge_agents where id = p_agent;
  if not found or not app_private.has_permission(a.tenant_id, 'edge_agent:read', a.site_id) then
    raise exception 'agente nao encontrado' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(a.tenant_id, 'edge_agent:revoke', a.site_id) then
    raise exception 'sem permissao para revogar agente' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'justificativa obrigatoria (min. 5 caracteres)' using errcode = '22023';
  end if;
  if a.status = 'revoked' then
    raise exception 'agente ja revogado' using errcode = '22023';
  end if;
  update public.edge_agents
    set status = 'revoked', enrollment_token_hash = null, enrollment_expires_at = null, secret_hash = null,
        revoked_at = now(), revoked_reason = btrim(p_reason)
    where id = a.id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, reason, metadata)
    values (a.tenant_id, (select auth.uid()), 'edge_agent.revoke', 'edge_agent', a.id::text, btrim(p_reason),
            jsonb_build_object('site_id', a.site_id, 'name', a.name));
end $$;
revoke all on function public.revoke_edge_agent(uuid, text) from public, anon;
grant execute on function public.revoke_edge_agent(uuid, text) to authenticated;

-- ---------------------------------------------------------------- funcoes do agente (service_role)
-- Troca o token de enrollment pela credencial do agente (devolvida UMA vez).
create function public.edge_enroll(p_token text, p_hostname text, p_version text)
returns table (agent_id uuid, tenant_id uuid, site_id uuid, agent_secret text)
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_secret text;
begin
  if p_token is null or char_length(p_token) <> 68 then
    raise exception 'enrollment invalido' using errcode = '28000';
  end if;
  select * into a from public.edge_agents
    where enrollment_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    for update;
  if not found or a.status <> 'pending' or a.enrollment_expires_at < now() then
    raise exception 'enrollment invalido' using errcode = '28000';
  end if;
  v_secret := 'zes_' || encode(extensions.gen_random_bytes(32), 'hex');
  update public.edge_agents
    set status = 'active', enrollment_token_hash = null, enrollment_expires_at = null,
        secret_hash = encode(extensions.digest(v_secret, 'sha256'), 'hex'), secret_rotated_at = now(),
        hostname = left(p_hostname, 120), agent_version = left(p_version, 40), enrolled_at = now(), last_seen_at = now()
    where id = a.id;
  insert into public.audit_log (tenant_id, actor_type, action, resource_type, resource_id, metadata)
    values (a.tenant_id, 'device', 'edge_agent.enroll', 'edge_agent', a.id::text,
            jsonb_build_object('site_id', a.site_id, 'hostname', left(p_hostname, 120), 'version', left(p_version, 40)));
  return query select a.id, a.tenant_id, a.site_id, v_secret;
end $$;
revoke all on function public.edge_enroll(text, text, text) from public, anon, authenticated;
grant execute on function public.edge_enroll(text, text, text) to service_role;

-- Autentica o agente pelo par (id, segredo). Falha generica: nao distingue id inexistente de segredo errado
-- nem de revogado. Devolve o contexto que o agente pode usar (tenant/site).
create function public.edge_authenticate(p_agent uuid, p_secret text)
returns table (tenant_id uuid, site_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.tenant_id, a.site_id
  from public.edge_agents a
  where a.id = p_agent and a.status = 'active' and p_secret is not null
    and a.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
$$;
revoke all on function public.edge_authenticate(uuid, text) from public, anon, authenticated;
grant execute on function public.edge_authenticate(uuid, text) to service_role;

-- Heartbeat: autentica, registra versao/fila/deriva do relogio e devolve a hora do servidor + versao minima.
-- Sem linha retornada = credencial invalida/revogada (o agente deve parar de aceitar comandos).
create function public.edge_heartbeat(p_agent uuid, p_secret text, p_version text, p_agent_time timestamptz,
                                      p_queue_depth integer)
returns table (server_time timestamptz, clock_drift_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_drift integer;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    for update;
  if not found then
    return;
  end if;
  v_drift := case when p_agent_time is null then null
                  else greatest(-2147483647, least(2147483647, round(extract(epoch from (p_agent_time - now())))))::integer end;
  update public.edge_agents
    set last_seen_at = now(), agent_version = coalesce(left(p_version, 40), agent_version),
        last_clock_drift_seconds = v_drift, last_queue_depth = greatest(coalesce(p_queue_depth, 0), 0)
    where id = a.id;
  return query select now(), v_drift;
end $$;
revoke all on function public.edge_heartbeat(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.edge_heartbeat(uuid, text, text, timestamptz, integer) to service_role;

-- Rotacao iniciada pelo agente: exige o segredo atual; o antigo deixa de valer na hora.
create function public.edge_rotate_secret(p_agent uuid, p_secret text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_new text;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    for update;
  if not found then
    raise exception 'credencial invalida' using errcode = '28000';
  end if;
  v_new := 'zes_' || encode(extensions.gen_random_bytes(32), 'hex');
  update public.edge_agents
    set secret_hash = encode(extensions.digest(v_new, 'sha256'), 'hex'), secret_rotated_at = now()
    where id = a.id;
  insert into public.audit_log (tenant_id, actor_type, action, resource_type, resource_id, metadata)
    values (a.tenant_id, 'device', 'edge_agent.rotate_secret', 'edge_agent', a.id::text,
            jsonb_build_object('site_id', a.site_id));
  return v_new;
end $$;
revoke all on function public.edge_rotate_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.edge_rotate_secret(uuid, text) to service_role;
