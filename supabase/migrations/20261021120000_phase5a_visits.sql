-- Fase 5A: visitantes (pre-cadastro, convite com token, check-in/check-out, expiracao, escopo por zona).
-- Minimizacao (§26): sem documento completo (so os 4 ultimos caracteres, opcional); placa opcional.
-- Escritas SO por funcoes (security definer); a tabela e somente leitura para o role authenticated.
-- Convite = token de 256 bits devolvido UMA vez, guardado como sha256. No check-in nasce uma pessoa
-- `visitor` e uma credencial `mobile_token` NOVA (segredo diferente do convite) com validade ate o fim da visita.

alter type public.person_kind add value if not exists 'visitor';

create type public.visit_status as enum ('invited', 'checked_in', 'checked_out', 'expired', 'cancelled');

-- ---------------------------------------------------------------- tabelas
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  host_person_id uuid not null,
  visitor_name text not null check (char_length(visitor_name) between 2 and 120),
  company text check (company is null or char_length(company) <= 120),
  document_hint text check (document_hint is null or char_length(document_hint) <= 4),
  vehicle_plate text check (vehicle_plate is null or vehicle_plate ~ '^[A-Z0-9]{5,8}$'),
  companions smallint not null default 0 check (companions between 0 and 20),
  purpose text check (purpose is null or char_length(purpose) <= 200),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status public.visit_status not null default 'invited',
  token_hash text not null,
  person_id uuid,
  credential_id uuid,
  privacy_notice_version text check (privacy_notice_version is null or char_length(privacy_notice_version) <= 32),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  checked_in_by uuid references auth.users (id) on delete set null,
  checked_out_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, site_id, id),
  foreign key (tenant_id, site_id) references public.sites (tenant_id, id) on delete restrict,
  foreign key (tenant_id, host_person_id) references public.people (tenant_id, id) on delete restrict,
  foreign key (tenant_id, person_id) references public.people (tenant_id, id) on delete restrict,
  foreign key (tenant_id, credential_id) references public.credentials (tenant_id, id) on delete restrict,
  constraint visits_window check (valid_until > valid_from and valid_until <= valid_from + interval '7 days'),
  constraint visits_lifecycle check (
    (status in ('invited', 'cancelled') and person_id is null and credential_id is null
       and checked_in_at is null and checked_out_at is null)
    or (status = 'checked_in' and person_id is not null and credential_id is not null
       and checked_in_at is not null and checked_out_at is null)
    or (status = 'checked_out' and checked_in_at is not null and checked_out_at is not null)
    or (status = 'expired' and checked_out_at is null)
  )
);
create unique index visits_token_unique on public.visits (token_hash);
create index visits_tenant_site_status_idx on public.visits (tenant_id, site_id, status);
create index visits_valid_until_idx on public.visits (valid_until) where status in ('invited', 'checked_in');

create trigger visits_set_updated_at before update on public.visits
  for each row execute function app_private.set_updated_at();

create table public.visit_zones (
  tenant_id uuid not null,
  site_id uuid not null,
  visit_id uuid not null,
  zone_id uuid not null,
  primary key (visit_id, zone_id),
  foreign key (tenant_id, site_id, visit_id) references public.visits (tenant_id, site_id, id) on delete cascade,
  foreign key (tenant_id, site_id, zone_id) references public.zones (tenant_id, site_id, id) on delete restrict
);
create index visit_zones_tenant_idx on public.visit_zones (tenant_id, site_id);

-- ---------------------------------------------------------------- permissoes
-- Espelhadas em packages/domain/src/rbac.js; `pnpm rbac:drift` detecta divergencia.
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'visit:read'), ('organization_owner', 'visit:create'),
  ('organization_owner', 'visit:update'), ('organization_owner', 'visit:checkin'),
  ('organization_admin', 'visit:read'), ('organization_admin', 'visit:create'),
  ('organization_admin', 'visit:update'), ('organization_admin', 'visit:checkin'),
  ('security_manager', 'visit:read'), ('security_manager', 'visit:create'),
  ('security_manager', 'visit:update'), ('security_manager', 'visit:checkin'),
  ('receptionist', 'visit:read'), ('receptionist', 'visit:create'),
  ('receptionist', 'visit:update'), ('receptionist', 'visit:checkin'),
  ('hr_manager', 'visit:read'), ('hr_manager', 'visit:create'),
  ('auditor', 'visit:read');

-- ---------------------------------------------------------------- auditoria (sem nome, documento, placa, token)
create function app_private.audit_visit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := jsonb_build_object(
    'site_id', new.site_id, 'host_person_id', new.host_person_id, 'status', new.status,
    'valid_from', new.valid_from, 'valid_until', new.valid_until
  );
begin
  if tg_op = 'UPDATE' then
    v_meta := v_meta || jsonb_build_object('old_status', old.status);
  end if;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (new.tenant_id, (select auth.uid()), 'visits.' || lower(tg_op), 'visits', new.id::text, v_meta);
  return new;
end $$;
create trigger visits_audit after insert or update on public.visits
  for each row execute function app_private.audit_visit_change();

-- ---------------------------------------------------------------- RLS e privilegios
alter table public.visits enable row level security;
alter table public.visit_zones enable row level security;

-- token_hash nunca legivel; nenhuma escrita direta.
grant select (id, tenant_id, site_id, host_person_id, visitor_name, company, document_hint, vehicle_plate,
              companions, purpose, valid_from, valid_until, status, person_id, credential_id,
              privacy_notice_version, checked_in_at, checked_out_at, checked_in_by, checked_out_by,
              created_by, created_at, updated_at) on public.visits to authenticated;
grant select on public.visit_zones to authenticated;

create policy visits_select on public.visits for select to authenticated
  using (app_private.has_permission(tenant_id, 'visit:read', site_id));
create policy visit_zones_select on public.visit_zones for select to authenticated
  using (app_private.has_permission(tenant_id, 'visit:read', site_id));

-- ---------------------------------------------------------------- funcoes auxiliares
create function app_private.visit_token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Encerra pessoa/credencial de uma visita (check-out e expiracao).
create function app_private.visit_close_access(p_visit public.visits) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.credentials set status = 'revoked'
   where id = p_visit.credential_id and tenant_id = p_visit.tenant_id and status <> 'revoked';
  update public.people set status = 'inactive'
   where id = p_visit.person_id and tenant_id = p_visit.tenant_id and status <> 'inactive';
end $$;
revoke all on function app_private.visit_close_access(public.visits) from public, anon, authenticated;

-- ---------------------------------------------------------------- criar convite
create function public.create_visit(
  p_tenant uuid,
  p_site uuid,
  p_host uuid,
  p_visitor_name text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_zone_ids uuid[],
  p_company text default null,
  p_document_hint text default null,
  p_vehicle_plate text default null,
  p_companions int default 0,
  p_purpose text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_token text;
  v_zones uuid[];
  v_plate text := nullif(upper(regexp_replace(coalesce(p_vehicle_plate, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_name text := btrim(coalesce(p_visitor_name, ''));
begin
  if (select auth.uid()) is null
     or not app_private.has_permission(p_tenant, 'visit:create', p_site) then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Informe o nome do visitante.';
  end if;
  if p_valid_from is null or p_valid_until is null or p_valid_until <= now()
     or p_valid_until <= p_valid_from or p_valid_until > p_valid_from + interval '7 days' then
    raise exception 'Período da visita inválido (fim no futuro, no máximo 7 dias).';
  end if;
  if not exists (select 1 from public.sites where id = p_site and tenant_id = p_tenant) then
    raise exception 'Local não encontrado.';
  end if;
  if not exists (
    select 1 from public.people where id = p_host and tenant_id = p_tenant and status = 'active'
      and kind <> 'visitor'
  ) then
    raise exception 'Anfitrião não encontrado ou inativo.';
  end if;
  select array_agg(distinct z) into v_zones from unnest(coalesce(p_zone_ids, '{}')) as z;
  if v_zones is null or cardinality(v_zones) not between 1 and 50 then
    raise exception 'Informe de 1 a 50 zonas permitidas.';
  end if;
  if (select count(*) from public.zones
       where tenant_id = p_tenant and site_id = p_site and id = any (v_zones)) <> cardinality(v_zones) then
    raise exception 'Alguma zona não pertence a este local.';
  end if;
  if p_document_hint is not null and char_length(p_document_hint) > 4 then
    raise exception 'Guarde só os 4 últimos caracteres do documento.';
  end if;
  if v_plate is not null and v_plate !~ '^[A-Z0-9]{5,8}$' then
    raise exception 'Placa inválida.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.visits
    (tenant_id, site_id, host_person_id, visitor_name, company, document_hint, vehicle_plate,
     companions, purpose, valid_from, valid_until, token_hash)
  values
    (p_tenant, p_site, p_host, v_name, nullif(btrim(p_company), ''), nullif(btrim(p_document_hint), ''),
     v_plate, coalesce(p_companions, 0), nullif(btrim(p_purpose), ''), p_valid_from, p_valid_until,
     app_private.visit_token_hash(v_token))
  returning id into v_id;
  insert into public.visit_zones (tenant_id, site_id, visit_id, zone_id)
  select p_tenant, p_site, v_id, z from unnest(v_zones) as z;

  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- ---------------------------------------------------------------- cancelar convite
create function public.cancel_visit(p_tenant uuid, p_visit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
begin
  select * into v from public.visits where id = p_visit and tenant_id = p_tenant for update;
  if not found or (select auth.uid()) is null
     or not app_private.has_permission(p_tenant, 'visit:update', v.site_id) then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if v.status <> 'invited' then
    raise exception 'Só convites ainda não utilizados podem ser cancelados.';
  end if;
  update public.visits set status = 'cancelled' where id = p_visit;
end $$;

-- ---------------------------------------------------------------- check-in
-- Por convite (QR/token) ou, sem token, pelo id (recepcao com o visitante presente).
-- Falha generica: nao distingue token errado, expirado, cancelado ou de outro local.
create function public.check_in_visit(
  p_tenant uuid,
  p_visit uuid default null,
  p_token text default null,
  p_notice_version text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
  v_person uuid;
  v_cred uuid;
  v_token text;
  v_fail constant text := 'Convite inválido, expirado ou fora do horário.';
begin
  if (select auth.uid()) is null then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_token is not null then
    select * into v from public.visits
     where tenant_id = p_tenant and token_hash = app_private.visit_token_hash(p_token) for update;
  elsif p_visit is not null then
    select * into v from public.visits where tenant_id = p_tenant and id = p_visit for update;
  end if;
  if not found or not app_private.has_permission(p_tenant, 'visit:checkin', v.site_id) then
    raise exception '%', v_fail;
  end if;
  if v.status <> 'invited' or now() < v.valid_from or now() >= v.valid_until then
    raise exception '%', v_fail;
  end if;
  if p_notice_version is null or btrim(p_notice_version) = '' then
    raise exception 'Registre a ciência do aviso de privacidade.';
  end if;

  insert into public.people (tenant_id, full_name, kind, status)
  values (p_tenant, v.visitor_name, 'visitor', 'active')
  returning id into v_person;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.credentials (tenant_id, person_id, type, label, secret_hash, expires_at)
  values (p_tenant, v_person, 'mobile_token', 'Visita',
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v.valid_until)
  returning id into v_cred;

  update public.visits
     set status = 'checked_in', person_id = v_person, credential_id = v_cred,
         privacy_notice_version = left(btrim(p_notice_version), 32),
         checked_in_at = now(), checked_in_by = (select auth.uid())
   where id = v.id;

  return jsonb_build_object('visit_id', v.id, 'person_id', v_person, 'token', v_token,
                            'valid_until', v.valid_until);
end $$;

-- ---------------------------------------------------------------- check-out
create function public.check_out_visit(p_tenant uuid, p_visit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
begin
  select * into v from public.visits where id = p_visit and tenant_id = p_tenant for update;
  if not found or (select auth.uid()) is null
     or not app_private.has_permission(p_tenant, 'visit:checkin', v.site_id) then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if v.status <> 'checked_in' then
    raise exception 'A visita não está em andamento.';
  end if;
  update public.visits
     set status = 'checked_out', checked_out_at = now(), checked_out_by = (select auth.uid())
   where id = v.id;
  perform app_private.visit_close_access(v);
end $$;

-- ---------------------------------------------------------------- expiracao (job; so service_role)
create function public.expire_due_visits() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
  n int := 0;
begin
  for v in
    select * from public.visits
     where status in ('invited', 'checked_in') and valid_until <= now()
     order by valid_until limit 500 for update skip locked
  loop
    update public.visits set status = 'expired' where id = v.id;
    if v.status = 'checked_in' then
      perform app_private.visit_close_access(v);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.create_visit(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, text, text, int, text) from public, anon;
revoke all on function public.cancel_visit(uuid, uuid) from public, anon;
revoke all on function public.check_in_visit(uuid, uuid, text, text) from public, anon;
revoke all on function public.check_out_visit(uuid, uuid) from public, anon;
revoke all on function public.expire_due_visits() from public, anon, authenticated;
grant execute on function public.create_visit(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, text, text, int, text) to authenticated;
grant execute on function public.cancel_visit(uuid, uuid) to authenticated;
grant execute on function public.check_in_visit(uuid, uuid, text, text) to authenticated;
grant execute on function public.check_out_visit(uuid, uuid) to authenticated;
grant execute on function public.expire_due_visits() to service_role;
