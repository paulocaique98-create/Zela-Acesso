-- Fase 8A (D-022): chave publica Ed25519 do dispositivo registrada no enrollment. A privada nunca sai do agente.
-- O gateway passa a exigir assinatura de requisicao de agente que tem chave registrada (o segredo roubado sozinho
-- deixa de bastar). Agente antigo (sem chave) continua valido ate re-enrollment, salvo se o gateway for configurado
-- para recusar (EDGE_ALLOW_LEGACY_AGENTS=false). A coluna NAO e exposta ao frontend (grant por coluna ja exclui).

alter table public.edge_agents
  add column device_public_key text check (device_public_key is null or device_public_key ~ '^[0-9a-f]{64}$');
create unique index edge_agents_device_key_idx on public.edge_agents (device_public_key)
  where device_public_key is not null;

-- Mesma funcao do 4A com um parametro novo (opcional, para nao quebrar chamadores antigos).
drop function public.edge_enroll(text, text, text);
create function public.edge_enroll(p_token text, p_hostname text, p_version text, p_device_key text default null)
returns table (agent_id uuid, tenant_id uuid, site_id uuid, agent_secret text)
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  v_secret text;
begin
  if p_token is null or char_length(p_token) <> 68 then
    raise exception 'enrollment invalido' using errcode = '28000';
  end if;
  if p_device_key is not null and p_device_key !~ '^[0-9a-f]{64}$' then
    raise exception 'chave do dispositivo invalida' using errcode = '22023';
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
        device_public_key = p_device_key,
        hostname = left(p_hostname, 120), agent_version = left(p_version, 40), enrolled_at = now(), last_seen_at = now()
    where id = a.id;
  insert into public.audit_log (tenant_id, actor_type, action, resource_type, resource_id, metadata)
    values (a.tenant_id, 'device', 'edge_agent.enroll', 'edge_agent', a.id::text,
            jsonb_build_object('site_id', a.site_id, 'hostname', left(p_hostname, 120), 'version', left(p_version, 40),
                               'device_key', p_device_key is not null));
  return query select a.id, a.tenant_id, a.site_id, v_secret;
end $$;
revoke all on function public.edge_enroll(text, text, text, text) from public, anon, authenticated;
grant execute on function public.edge_enroll(text, text, text, text) to service_role;

-- Chave publica do dispositivo de um agente ATIVO (null = inexistente, revogado ou legado sem chave; o gateway
-- distingue "legado" por configuracao, nunca devolve ao agente o motivo). Nao e segredo, mas so service_role le.
create function public.edge_device_key(p_agent uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select a.device_public_key from public.edge_agents a where a.id = p_agent and a.status = 'active';
$$;
revoke all on function public.edge_device_key(uuid) from public, anon, authenticated;
grant execute on function public.edge_device_key(uuid) to service_role;
