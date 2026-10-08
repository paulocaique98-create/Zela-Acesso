-- Fase 9D (backlog de seguranca #4): varredura agendada da cadeia de evidencia. Quebra de hash/encadeamento/sequencia
-- abre alerta critico 'chain_broken' por organizacao (so ids, sem dado pessoal). O alerta nao se resolve sozinho:
-- uma cadeia quebrada exige investigacao humana (resolve_alert com nota). Agente offline ja existe (scan_offline_agents).

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('door_forced', 'door_held_open', 'device_offline', 'chain_broken'));

create function public.scan_access_chains()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    with c as (
      select e.tenant_id, e.seq, e.site_id, e.id,
             e.hash <> app_private.access_event_hash(e) as bad_hash,
             e.prev_hash is distinct from lag(e.hash) over (partition by e.tenant_id order by e.seq) as bad_link,
             e.seq <> coalesce(lag(e.seq) over (partition by e.tenant_id order by e.seq), 0) + 1 as bad_seq
        from public.access_events e
    )
    select distinct on (c.tenant_id) c.tenant_id, c.site_id, c.id
      from c where c.bad_hash or c.bad_link or c.bad_seq
     order by c.tenant_id, c.seq
  loop
    perform app_private.raise_alert(r.tenant_id, r.site_id, 'chain_broken', 'critical', null, null, r.id,
                                    'chain_broken:' || r.tenant_id::text, now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.scan_access_chains() from public, anon, authenticated;
grant execute on function public.scan_access_chains() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('zela-scan-access-chains', '17 * * * *', 'select public.scan_access_chains()');
exception when others then
  raise notice 'pg_cron indisponivel (%); agende public.scan_access_chains() fora do banco', sqlerrm;
end $$;
