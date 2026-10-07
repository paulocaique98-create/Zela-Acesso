-- Fase 4D: reporte de resultado fisico da atuacao. O agente ja entregava decisoes (`access_decision`); agora tambem
-- entrega `physical_outcome` (DOOR_OPENED / DOOR_NOT_OPENED / UNKNOWN...) ligado a decisao pela correlacao. O evento e
-- novo (append-only): a decisao original nao e alterada. Mesmas garantias da 4C: tenant/site vem do agente autenticado,
-- referencias estranhas viram null, idempotencia por chave, rejeicao nao derruba o lote. `correction` continua vedado.
-- create or replace preserva os grants da 4C (so service_role).

create or replace function public.edge_ingest_events(p_agent uuid, p_secret text, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.edge_agents;
  e jsonb;
  v_key text;
  v_at timestamptz;
  v_point uuid;
  v_zone uuid;
  v_person uuid;
  v_cred uuid;
  v_policy uuid;
  v_corr uuid;
  v_type text;
  v_results jsonb := '[]'::jsonb;
begin
  select * into a from public.edge_agents
    where id = p_agent and status = 'active' and p_secret is not null
      and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    for update;
  if not found then
    return null; -- credencial invalida/revogada: o agente trata como revogado
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events deve ser um array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100 then
    raise exception 'lote maximo de 100 eventos' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_events) loop
    v_key := e ->> 'p_idempotency_key';
    begin
      if v_key is null or char_length(v_key) not between 8 and 120 then
        raise exception 'chave de idempotencia invalida' using errcode = '22023';
      end if;
      v_type := e ->> 'p_event_type';
      if v_type is null or v_type not in ('access_decision', 'physical_outcome') then
        raise exception 'tipo de evento nao aceito do agente' using errcode = '22023';
      end if;
      if v_type = 'physical_outcome'
         and (nullif(e ->> 'p_physical_outcome', '') is null or nullif(e ->> 'p_correlation', '') is null) then
        raise exception 'resultado fisico exige resultado e correlacao' using errcode = '22023';
      end if;
      v_at := (e ->> 'p_occurred_at')::timestamptz;
      if v_at is null or v_at > now() + interval '5 minutes' then
        raise exception 'occurred_at ausente ou no futuro' using errcode = '22023';
      end if;
      if exists (select 1 from public.access_events x where x.tenant_id = a.tenant_id and x.idempotency_key = v_key) then
        v_results := v_results || jsonb_build_object('idempotencyKey', v_key, 'status', 'duplicate');
        continue;
      end if;

      v_point := null; v_zone := null; v_person := null; v_cred := null; v_policy := null; v_corr := null;
      select ap.id into v_point from public.access_points ap
        where ap.id = nullif(e ->> 'p_access_point', '')::uuid and ap.tenant_id = a.tenant_id and ap.site_id = a.site_id;
      select z.id into v_zone from public.zones z
        where z.id = nullif(e ->> 'p_zone', '')::uuid and z.tenant_id = a.tenant_id and z.site_id = a.site_id;
      select pe.id into v_person from public.people pe
        where pe.id = nullif(e ->> 'p_person', '')::uuid and pe.tenant_id = a.tenant_id;
      select c.id into v_cred from public.credentials c
        where c.id = nullif(e ->> 'p_credential', '')::uuid and c.tenant_id = a.tenant_id;
      select ap.id into v_policy from public.access_policies ap
        where ap.id = nullif(e ->> 'p_policy', '')::uuid and ap.tenant_id = a.tenant_id and ap.site_id = a.site_id;
      v_corr := nullif(e ->> 'p_correlation', '')::uuid;

      perform public.record_access_event(
        a.tenant_id, a.site_id, v_type, v_at,
        case when v_type = 'access_decision' then e ->> 'p_decision' end,
        case when v_type = 'access_decision' then e ->> 'p_reason_code' end,
        v_person, v_cred, v_point, v_zone, v_policy,
        nullif(e ->> 'p_physical_outcome', ''), 'EDGE_AGENT', v_corr,
        coalesce(e -> 'p_evidence', '{}'::jsonb) || jsonb_build_object('agentId', a.id),
        v_key);
      v_results := v_results || jsonb_build_object('idempotencyKey', v_key, 'status', 'recorded');
    exception when others then
      -- nunca devolver a mensagem crua do banco; o agente so precisa saber que e rejeicao definitiva
      v_results := v_results || jsonb_build_object('idempotencyKey', v_key, 'status', 'rejected',
        'reason', 'INVALID');
    end;
  end loop;

  update public.edge_agents set last_seen_at = now() where id = a.id;
  return jsonb_build_object('serverTime', now(), 'results', v_results);
end $$;
