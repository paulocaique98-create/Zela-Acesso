-- Fase 9D (backlog #9): rate limit GLOBAL do edge-gateway (o limite em memoria vale por instancia/isolate).
-- Janela fixa de 1 minuto por agente, contada no banco. Chamada so pelo gateway (service_role).
-- Id que nao e de um agente existente nao grava linha (a autenticacao recusa depois): sem inflar a tabela com ids forjados.

create table public.edge_rate_hits (
  agent_id uuid not null references public.edge_agents (id) on delete cascade,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (agent_id, window_start)
);
alter table public.edge_rate_hits enable row level security; -- sem policy: so service_role (bypass)
revoke all on public.edge_rate_hits from public, anon, authenticated;

create function public.edge_rate_check(p_agent uuid, p_limit integer default 120)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_win timestamptz := date_trunc('minute', now());
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if not exists (select 1 from public.edge_agents a where a.id = p_agent) then
    return true; -- desconhecido: nada a contar; a autenticacao do RPC edge_* recusa
  end if;
  delete from public.edge_rate_hits where agent_id = p_agent and window_start < v_win - interval '1 hour';
  insert into public.edge_rate_hits (agent_id, window_start, hits) values (p_agent, v_win, 1)
  on conflict (agent_id, window_start) do update set hits = public.edge_rate_hits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;
revoke all on function public.edge_rate_check(uuid, integer) from public, anon, authenticated;
grant execute on function public.edge_rate_check(uuid, integer) to service_role;
