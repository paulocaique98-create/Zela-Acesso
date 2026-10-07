-- Fase 3C: eventos de acesso (Access Evidence) append-only com hash encadeado por tenant (§14, §15, §94).
-- O hash e INTEGRIDADE TECNICA para detectar adulteracao posterior; nao tem valor juridico declarado (§94).
-- Correcao = novo evento `correction` que referencia o original (que permanece intacto).
-- Nunca gravar PIN, token, segredo ou biometria bruta em `evidence` (check abaixo + testes).

create table public.access_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  site_id uuid not null,
  seq bigint not null,
  event_type text not null check (event_type in ('access_decision', 'physical_outcome', 'correction')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  decision text check (decision is null or decision in ('ALLOW', 'DENY', 'CHALLENGE', 'DEGRADED_ALLOW', 'DEGRADED_DENY')),
  reason_code text check (reason_code is null or reason_code in (
    'POLICY_MATCH', 'POLICY_DENY', 'ZONE_NOT_ALLOWED', 'OUTSIDE_SCHEDULE', 'MULTI_FACTOR_REQUIRED',
    'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED', 'PERSON_DISABLED', 'VISITOR_EXPIRED', 'VISITOR_ZONE_NOT_ALLOWED',
    'ANTI_PASSBACK', 'EMERGENCY_POLICY', 'DEVICE_UNTRUSTED', 'ACCESS_POINT_INACTIVE', 'OFFLINE_POLICY_DENY',
    'OFFLINE_POLICY_ALLOW', 'CONTEXT_INVALID')),
  person_id uuid,
  credential_id uuid,
  access_point_id uuid,
  zone_id uuid,
  policy_id uuid,
  physical_outcome text check (physical_outcome is null or physical_outcome in
    ('DOOR_OPENED', 'DOOR_NOT_OPENED', 'DOOR_FORCED', 'DOOR_HELD_OPEN', 'UNKNOWN')),
  source text not null check (source in ('ENGINE', 'EDGE_AGENT', 'DEVICE', 'ADMIN')),
  correlation_id uuid,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  evidence jsonb not null default '{}'::jsonb,
  corrects_event_id uuid references public.access_events (id) on delete restrict,
  correction_reason text check (correction_reason is null or char_length(correction_reason) between 5 and 500),
  actor_user_id uuid,
  prev_hash text,
  hash text not null,
  hash_version smallint not null default 1,
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  unique (tenant_id, seq),
  constraint access_events_evidence_object check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 16384),
  -- defesa em profundidade: chaves tipicamente sensiveis nao entram na evidencia
  constraint access_events_evidence_no_secrets check (
    evidence::text !~* '"(pin|secret|token|password|secret_hash|biometric|template|face_template)"[[:space:]]*:'),
  constraint access_events_decision_required check (event_type <> 'access_decision' or (decision is not null and reason_code is not null)),
  constraint access_events_correction_shape check (
    (event_type = 'correction') = (corrects_event_id is not null and correction_reason is not null and actor_user_id is not null))
);
create unique index access_events_idempotency_key on public.access_events (tenant_id, idempotency_key) where idempotency_key is not null;
create index access_events_tenant_time_idx on public.access_events (tenant_id, occurred_at desc);
create index access_events_site_time_idx on public.access_events (tenant_id, site_id, occurred_at desc);
create index access_events_person_idx on public.access_events (tenant_id, person_id, occurred_at desc) where person_id is not null;
create index access_events_point_idx on public.access_events (tenant_id, access_point_id, occurred_at desc) where access_point_id is not null;
create index access_events_correlation_idx on public.access_events (tenant_id, correlation_id) where correlation_id is not null;
create index access_events_corrects_idx on public.access_events (corrects_event_id) where corrects_event_id is not null;

-- ---------------------------------------------------------------- hash encadeado
-- Entrada canonica: array JSON posicional (ordem fixa, versionada). Datas em UTC com microssegundos para nao
-- depender do fuso da sessao. jsonb::text e deterministico (chaves ordenadas pelo proprio jsonb).
create function app_private.access_event_hash(e public.access_events) returns text
language sql stable set search_path = '' as $$
  select encode(extensions.digest(
    convert_to(
      coalesce(e.prev_hash, '') || '|' ||
      jsonb_build_array(
        e.hash_version, e.id, e.tenant_id, e.site_id, e.seq, e.event_type,
        to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        e.decision, e.reason_code, e.person_id, e.credential_id, e.access_point_id, e.zone_id, e.policy_id,
        e.physical_outcome, e.source, e.correlation_id, e.idempotency_key, e.evidence,
        e.corrects_event_id, e.correction_reason, e.actor_user_id
      )::text,
      'UTF8'),
    'sha256'), 'hex');
$$;

-- Serializa a cadeia por tenant (lock transacional) e preenche seq/prev_hash/recorded_at/hash.
-- Qualquer valor enviado pelo chamador para esses campos e descartado.
create function app_private.access_events_chain() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_last record;
begin
  perform pg_advisory_xact_lock(hashtextextended('access_events:' || new.tenant_id::text, 0));
  select e.seq, e.hash into v_last
    from public.access_events e where e.tenant_id = new.tenant_id order by e.seq desc limit 1;
  new.seq := coalesce(v_last.seq, 0) + 1;
  new.prev_hash := v_last.hash;
  new.recorded_at := clock_timestamp();
  new.hash_version := 1;
  new.hash := app_private.access_event_hash(new);
  return new;
end $$;
create trigger access_events_chain before insert on public.access_events
  for each row execute function app_private.access_events_chain();

-- Append-only: UPDATE/DELETE/TRUNCATE bloqueados por trigger e por privilegio (vale tambem para service_role).
create function app_private.block_access_event_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'access_events e append-only' using errcode = '42501';
end $$;
create trigger access_events_no_update_delete before update or delete on public.access_events
  for each row execute function app_private.block_access_event_mutation();
create trigger access_events_no_truncate before truncate on public.access_events
  for each statement execute function app_private.block_access_event_mutation();

-- ---------------------------------------------------------------- permissoes
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'access_event:read'), ('organization_owner', 'access_event:correct'),
  ('organization_admin', 'access_event:read'), ('organization_admin', 'access_event:correct'),
  ('security_manager', 'access_event:read'), ('security_manager', 'access_event:correct'),
  ('auditor', 'access_event:read');

-- ---------------------------------------------------------------- gravacao (server-side: motor/Edge)
-- Uso exclusivo de service_role. Idempotente por (tenant, idempotency_key): repetir devolve o mesmo evento.
create function public.record_access_event(
  p_tenant uuid, p_site uuid, p_event_type text, p_occurred_at timestamptz,
  p_decision text, p_reason_code text,
  p_person uuid, p_credential uuid, p_access_point uuid, p_zone uuid, p_policy uuid,
  p_physical_outcome text, p_source text, p_correlation uuid, p_evidence jsonb, p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_event_type = 'correction' then
    raise exception 'correcao so por record_access_correction' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select e.id into v_id from public.access_events e
      where e.tenant_id = p_tenant and e.idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;
  insert into public.access_events (
    tenant_id, site_id, seq, event_type, occurred_at, decision, reason_code, person_id, credential_id,
    access_point_id, zone_id, policy_id, physical_outcome, source, correlation_id, idempotency_key, evidence, hash)
  values (
    p_tenant, p_site, 0, p_event_type, p_occurred_at, p_decision, p_reason_code, p_person, p_credential,
    p_access_point, p_zone, p_policy, p_physical_outcome, p_source,
    coalesce(p_correlation, nullif(current_setting('app.correlation_id', true), '')::uuid),
    p_idempotency_key, coalesce(p_evidence, '{}'::jsonb), '')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_access_event(uuid, uuid, text, timestamptz, text, text, uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.record_access_event(uuid, uuid, text, timestamptz, text, text, uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------- correcao administrativa (novo evento)
create function public.record_access_correction(p_event_id uuid, p_reason text, p_corrected jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.access_events;
  v_id uuid;
begin
  select * into o from public.access_events where id = p_event_id;
  if not found or not app_private.has_permission(o.tenant_id, 'access_event:read', o.site_id) then
    raise exception 'evento nao encontrado' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(o.tenant_id, 'access_event:correct', o.site_id) then
    raise exception 'sem permissao para corrigir eventos' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'justificativa obrigatoria (min. 5 caracteres)' using errcode = '22023';
  end if;
  if p_corrected is null or jsonb_typeof(p_corrected) <> 'object' then
    raise exception 'valor corrigido deve ser um objeto' using errcode = '22023';
  end if;
  insert into public.access_events (
    tenant_id, site_id, seq, event_type, occurred_at, person_id, credential_id, access_point_id, zone_id, policy_id,
    source, correlation_id, evidence, corrects_event_id, correction_reason, actor_user_id, hash)
  values (
    o.tenant_id, o.site_id, 0, 'correction', now(), o.person_id, o.credential_id, o.access_point_id, o.zone_id, o.policy_id,
    'ADMIN', o.correlation_id,
    jsonb_build_object('original_seq', o.seq, 'original_hash', o.hash, 'corrected', p_corrected),
    o.id, btrim(p_reason), (select auth.uid()), '')
  returning id into v_id;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, reason, metadata)
    values (o.tenant_id, (select auth.uid()), 'access_event.correct', 'access_event', v_id::text, btrim(p_reason),
            jsonb_build_object('corrects_event_id', o.id));
  return v_id;
end $$;
revoke all on function public.record_access_correction(uuid, text, jsonb) from public, anon;
grant execute on function public.record_access_correction(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- verificacao da cadeia
-- Recalcula cada hash e confere o encadeamento e a sequencia. Retorna a primeira quebra (se houver).
create function public.verify_access_chain(p_tenant uuid)
returns table (ok boolean, checked bigint, first_broken_seq bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.has_permission(p_tenant, 'audit:read') or (select auth.role()) = 'service_role') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return query
  with c as (
    select e.seq, e.hash,
           app_private.access_event_hash(e) as recomputed,
           e.prev_hash is not distinct from lag(e.hash) over (order by e.seq) as linked,
           e.seq = coalesce(lag(e.seq) over (order by e.seq), 0) + 1 as sequential
    from public.access_events e where e.tenant_id = p_tenant
  )
  select not exists (select 1 from c where c.hash <> c.recomputed or not c.linked or not c.sequential),
         (select count(*) from c),
         (select min(c.seq) from c where c.hash <> c.recomputed or not c.linked or not c.sequential);
end $$;
revoke all on function public.verify_access_chain(uuid) from public, anon;
grant execute on function public.verify_access_chain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.access_events enable row level security;
create policy access_events_select on public.access_events for select to authenticated
  using (app_private.has_permission(tenant_id, 'access_event:read', site_id));
grant select on public.access_events to authenticated;
revoke update, delete, truncate on public.access_events from authenticated, anon, service_role;
-- insert so por record_access_event/record_access_correction (security definer); authenticated nao tem INSERT.
