-- Painel do Desenvolvedor completo (paridade com o portal do Dev do Zela Escola, adaptado ao Zela Acesso).
-- Organizacoes (cadastro completo, modulos), Planos/precos/contratacao, Suporte (chat), Logs de erro,
-- Configuracoes (logo/imagem de login) e troca obrigatoria de senha.
--
-- Seguranca:
--  * Dados internos (notas, CNPJ, precos, custos, contratos) so platform_owner (suporte le o que e dele).
--  * Escrita sempre por RPC SECURITY DEFINER com checagem de papel; sem grants de coluna sensivel a authenticated.
--  * Nada e apagado (sem DELETE para authenticated). Exclusao definitiva de organizacao NAO existe (decisao do dono).
--  * Logs nao recebem dado pessoal: contexto e saneado no servidor.

-- ============================================================ 1. tenants: codigo, modulos, limites
create sequence public.tenant_org_code_seq;
alter table public.tenants
  add column org_code text,
  add column features_enabled jsonb not null default '{}'::jsonb,
  add column limits jsonb not null default '{}'::jsonb;

alter table public.tenants disable trigger user;
update public.tenants t
set org_code = 'ZA' || lpad(nextval('public.tenant_org_code_seq')::text, 3, '0')
from (select id from public.tenants order by created_at, id) o
where o.id = t.id;
-- Organizacoes ja existentes nascem so com o plano base.
update public.tenants
set features_enabled = '{"sites":true,"zones":true,"people":true,"groups":true,"members":true,"audit":true}'::jsonb;
alter table public.tenants enable trigger user;

alter table public.tenants
  alter column org_code set not null,
  alter column org_code set default ('ZA' || lpad(nextval('public.tenant_org_code_seq')::text, 3, '0')),
  add constraint tenants_org_code_key unique (org_code),
  add constraint tenants_features_object check (jsonb_typeof(features_enabled) = 'object'),
  add constraint tenants_limits_object check (jsonb_typeof(limits) = 'object');

-- ============================================================ 2. tenant_details (dados internos da Zela)
create table public.tenant_details (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  legal_name text check (legal_name is null or char_length(legal_name) <= 200),
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{14}$'),
  municipal_registration text check (municipal_registration is null or char_length(municipal_registration) <= 40),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 30),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  street text check (street is null or char_length(street) <= 200),
  street_number text check (street_number is null or char_length(street_number) <= 20),
  address_complement text check (address_complement is null or char_length(address_complement) <= 100),
  district text check (district is null or char_length(district) <= 120),
  city text check (city is null or char_length(city) <= 120),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenant_details_set_updated_at before update on public.tenant_details
  for each row execute function app_private.set_updated_at();

-- Grava os dados cadastrais (lista branca de chaves; string vazia vira null; CNPJ/CEP so digitos).
create function app_private.apply_tenant_details(p_tenant uuid, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  insert into public.tenant_details as td (
    tenant_id, legal_name, tax_id, municipal_registration, contact_email, contact_phone, postal_code,
    street, street_number, address_complement, district, city, state, notes
  ) values (
    p_tenant,
    nullif(btrim(d ->> 'legal_name'), ''),
    nullif(regexp_replace(coalesce(d ->> 'tax_id', ''), '\D', '', 'g'), ''),
    nullif(btrim(d ->> 'municipal_registration'), ''),
    nullif(btrim(d ->> 'contact_email'), ''),
    nullif(btrim(d ->> 'contact_phone'), ''),
    nullif(regexp_replace(coalesce(d ->> 'postal_code', ''), '\D', '', 'g'), ''),
    nullif(btrim(d ->> 'street'), ''),
    nullif(btrim(d ->> 'street_number'), ''),
    nullif(btrim(d ->> 'address_complement'), ''),
    nullif(btrim(d ->> 'district'), ''),
    nullif(btrim(d ->> 'city'), ''),
    nullif(upper(btrim(d ->> 'state')), ''),
    nullif(btrim(d ->> 'notes'), '')
  )
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name, tax_id = excluded.tax_id,
    municipal_registration = excluded.municipal_registration, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone, postal_code = excluded.postal_code, street = excluded.street,
    street_number = excluded.street_number, address_complement = excluded.address_complement,
    district = excluded.district, city = excluded.city, state = excluded.state, notes = excluded.notes;
end $$;
revoke all on function app_private.apply_tenant_details(uuid, jsonb) from public, anon;

-- ============================================================ 3. historico de modulos
create table public.tenant_feature_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  feature_key text not null,
  enabled boolean not null,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index tenant_feature_changes_tenant_idx on public.tenant_feature_changes (tenant_id, changed_at desc);

-- Uma linha por chave que mudou (ligou/desligou). Registro auxiliar: nunca impede a alteracao.
create function app_private.log_tenant_feature_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else coalesce(old.features_enabled, '{}'::jsonb) end;
  v_new jsonb := coalesce(new.features_enabled, '{}'::jsonb);
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  begin
    select p.display_name into v_name from public.profiles p where p.user_id = v_uid;
    insert into public.tenant_feature_changes (tenant_id, feature_key, enabled, changed_by, changed_by_name)
    select new.id, k.key, coalesce(v_new -> k.key = 'true'::jsonb, false), v_uid, v_name
    from (select jsonb_object_keys(v_old) as key union select jsonb_object_keys(v_new)) k
    where coalesce(v_old -> k.key = 'true'::jsonb, false) is distinct from coalesce(v_new -> k.key = 'true'::jsonb, false);
  exception when others then
    raise warning 'log_tenant_feature_changes: %', sqlerrm;
  end;
  return new;
end $$;
create trigger tenants_feature_changes after insert or update of features_enabled on public.tenants
  for each row execute function app_private.log_tenant_feature_changes();

-- ============================================================ 4. comercial: precos, planos, ciclos, contratos
create table public.platform_commercial_config (
  id boolean primary key default true check (id),
  max_people_per_person_plan integer not null default 50 check (max_people_per_person_plan between 1 and 100000),
  setup_discount_max_percent numeric(5,2) not null default 50 check (setup_discount_max_percent between 0 and 100),
  setup_fee_min numeric(12,2) not null default 0 check (setup_fee_min >= 0),
  setup_fee_max numeric(12,2) not null default 100000 check (setup_fee_max >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (setup_fee_max >= setup_fee_min)
);
insert into public.platform_commercial_config (id) values (true);

create table public.platform_module_prices (
  item_id text primary key check (item_id ~ '^[a-z0-9_]+$'),
  billing text not null check (billing in ('per_person', 'fixed_monthly')),
  price numeric(12,2) not null default 0 check (price >= 0),
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  -- Chaves de tenants.features_enabled que o item liga (espelho de packages/domain/src/modules.js).
  keys text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  mode text not null check (mode in ('per_person', 'package')),
  items text[] not null default '{}',
  price_per_person numeric(12,2) not null default 0 check (price_per_person >= 0),
  monthly_minimum numeric(12,2) not null default 0 check (monthly_minimum >= 0),
  people_min integer check (people_min is null or people_min >= 1),
  people_max integer check (people_max is null or people_max >= 1),
  setup_fee numeric(12,2) not null default 0 check (setup_fee >= 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (people_max is null or people_min is null or people_max >= people_min)
);
create unique index platform_plans_active_name_uidx on public.platform_plans (lower(btrim(name))) where active;

create table public.platform_plan_cycles (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.platform_plans (id) on delete restrict,
  cycle text not null check (cycle in ('MONTHLY', 'SEMIANNUAL', 'ANNUAL', 'BIENNIAL')),
  months integer not null,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 50),
  setup_fee numeric(12,2) check (setup_fee is null or setup_fee >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (plan_id, cycle),
  check ((cycle = 'MONTHLY' and months = 1) or (cycle = 'SEMIANNUAL' and months = 6)
      or (cycle = 'ANNUAL' and months = 12) or (cycle = 'BIENNIAL' and months = 24))
);

create table public.tenant_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  plan_id uuid not null references public.platform_plans (id) on delete restrict,
  cycle text not null check (cycle in ('MONTHLY', 'SEMIANNUAL', 'ANNUAL', 'BIENNIAL')),
  months integer not null check (months in (1, 6, 12, 24)),
  contracted_people integer not null check (contracted_people >= 1),
  items text[] not null default '{}',
  snapshot jsonb not null,
  monthly_value numeric(12,2) not null check (monthly_value >= 0),
  cycle_value numeric(12,2) not null check (cycle_value >= 0),
  setup_base numeric(12,2) not null check (setup_base >= 0),
  setup_discount_type text check (setup_discount_type in ('percent', 'amount')),
  setup_discount numeric(12,2) not null default 0 check (setup_discount >= 0),
  setup_final numeric(12,2) not null check (setup_final >= 0),
  discount_reason text check (discount_reason is null or char_length(discount_reason) <= 300),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('draft', 'active', 'ended', 'cancelled')),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (ends_on > starts_on)
);
create unique index tenant_contracts_active_uidx on public.tenant_contracts (tenant_id) where status = 'active';
create index tenant_contracts_tenant_idx on public.tenant_contracts (tenant_id, created_at desc);

create table public.platform_pricing_history (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  action text not null,
  before_row jsonb,
  after_row jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index platform_pricing_history_idx on public.platform_pricing_history (table_name, record_id, changed_at desc);

-- Carimbo de quem/quando mexeu.
create function app_private.stamp_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
create trigger platform_commercial_config_stamp before insert or update on public.platform_commercial_config
  for each row execute function app_private.stamp_update();
create trigger platform_module_prices_stamp before insert or update on public.platform_module_prices
  for each row execute function app_private.stamp_update();
create trigger platform_plans_stamp before insert or update on public.platform_plans
  for each row execute function app_private.stamp_update();
create trigger platform_plan_cycles_stamp before insert or update on public.platform_plan_cycles
  for each row execute function app_private.stamp_update();

-- Valida plano: itens existem no catalogo de precos, sem repetir, sem o base; setup dentro da faixa.
create function app_private.validate_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.platform_commercial_config%rowtype;
begin
  select * into v_cfg from public.platform_commercial_config where id;
  if exists (select 1 from unnest(new.items) i where i = 'base' or i is null) then
    raise exception 'O plano base é sempre incluso e não entra na lista de itens.';
  end if;
  if (select count(distinct i) from unnest(new.items) i) <> coalesce(array_length(new.items, 1), 0) then
    raise exception 'Item repetido no plano.';
  end if;
  if exists (select 1 from unnest(new.items) i where not exists (select 1 from public.platform_module_prices p where p.item_id = i)) then
    raise exception 'O plano tem um item que não existe no catálogo de preços.';
  end if;
  if (tg_op = 'INSERT' or new.setup_fee is distinct from old.setup_fee)
     and (new.setup_fee < v_cfg.setup_fee_min or new.setup_fee > v_cfg.setup_fee_max) then
    raise exception 'A implantação deve ficar entre % e % (faixa da configuração comercial).', v_cfg.setup_fee_min, v_cfg.setup_fee_max;
  end if;
  if new.mode = 'per_person' and new.people_max is not null and new.people_max > v_cfg.max_people_per_person_plan then
    raise exception 'Plano por pessoa aceita no máximo % pessoas.', v_cfg.max_people_per_person_plan;
  end if;
  return new;
end $$;
create trigger platform_plans_validate before insert or update on public.platform_plans
  for each row execute function app_private.validate_plan();

create function app_private.validate_plan_cycle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.platform_commercial_config%rowtype;
  v_mode text;
begin
  select * into v_cfg from public.platform_commercial_config where id;
  select mode into v_mode from public.platform_plans where id = new.plan_id;
  if v_mode = 'per_person' and new.cycle <> 'MONTHLY' then
    raise exception 'Plano por pessoa aceita só o ciclo mensal.';
  end if;
  if new.setup_fee is not null
     and (tg_op = 'INSERT' or new.setup_fee is distinct from old.setup_fee)
     and (new.setup_fee < v_cfg.setup_fee_min or new.setup_fee > v_cfg.setup_fee_max) then
    raise exception 'A implantação deve ficar entre % e % (faixa da configuração comercial).', v_cfg.setup_fee_min, v_cfg.setup_fee_max;
  end if;
  return new;
end $$;
create trigger platform_plan_cycles_validate before insert or update on public.platform_plan_cycles
  for each row execute function app_private.validate_plan_cycle();

-- Historico antes/depois de cada mudanca de preco, plano, ciclo ou regra comercial.
create function app_private.record_pricing_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_after jsonb := to_jsonb(new);
  v_before jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
begin
  if tg_op = 'UPDATE' and v_before - 'updated_at' - 'updated_by' = v_after - 'updated_at' - 'updated_by' then
    return new;
  end if;
  begin
    insert into public.platform_pricing_history (table_name, record_id, action, before_row, after_row, changed_by)
    values (tg_table_name, coalesce(v_after ->> 'id', v_after ->> 'item_id'), tg_op, v_before, v_after, (select auth.uid()));
  exception when others then
    raise warning 'record_pricing_history: %', sqlerrm;
  end;
  return new;
end $$;
create trigger platform_module_prices_history after insert or update on public.platform_module_prices
  for each row execute function app_private.record_pricing_history();
create trigger platform_plans_history after insert or update on public.platform_plans
  for each row execute function app_private.record_pricing_history();
create trigger platform_plan_cycles_history after insert or update on public.platform_plan_cycles
  for each row execute function app_private.record_pricing_history();
create trigger platform_commercial_config_history after insert or update on public.platform_commercial_config
  for each row execute function app_private.record_pricing_history();

-- Seed do catalogo: preco 0 (placeholder). Os valores reais sao definidos pela Arx no menu Planos.
insert into public.platform_module_prices (item_id, billing, price, estimated_cost, keys, active) values
  ('base', 'per_person', 0, 0, array['sites','zones','people','groups','members','audit'], true),
  ('access_control', 'per_person', 0, 0, array['access_points','credentials'], true),
  ('schedules_policies', 'per_person', 0, 0, array['schedules','holidays','policies'], true),
  ('visitors', 'per_person', 0, 0, array['visitors'], true),
  ('reports', 'per_person', 0, 0, array['reports','evidence'], true),
  ('edge_agent', 'fixed_monthly', 0, 0, array['edge_agent'], true),
  ('biometrics', 'per_person', 0, 0, array['biometrics'], true);

-- ============================================================ 5. suporte (chat organizacao <-> plataforma)
insert into public.role_permissions (role, permission) values
  ('organization_owner', 'support:read'), ('organization_owner', 'support:write'),
  ('organization_admin', 'support:read'), ('organization_admin', 'support:write');

create table public.support_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  opened_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  staff_last_read_at timestamptz,
  requester_last_read_at timestamptz,
  unique (tenant_id, opened_by),
  unique (tenant_id, id)
);
create index support_threads_updated_idx on public.support_threads (updated_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  tenant_id uuid not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_side text not null check (sender_side in ('tenant', 'platform')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, thread_id) references public.support_threads (tenant_id, id) on delete cascade
);
create index support_messages_thread_idx on public.support_messages (thread_id, created_at desc);

-- Limite de envio e carimbo da conversa (updated_at sobe; quem enviou ja "leu").
create function app_private.support_message_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.support_messages m
      where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Muitas mensagens em pouco tempo. Aguarde um instante.';
  end if;
  return new;
end $$;
create trigger support_messages_before before insert on public.support_messages
  for each row execute function app_private.support_message_before();

create function app_private.support_message_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.support_threads t
  set updated_at = now(),
      staff_last_read_at = case when new.sender_side = 'platform' then now() else t.staff_last_read_at end,
      requester_last_read_at = case when new.sender_side = 'tenant' then now() else t.requester_last_read_at end
  where t.id = new.thread_id;
  return new;
end $$;
create trigger support_messages_after after insert on public.support_messages
  for each row execute function app_private.support_message_after();

-- Cada lado so mexe na propria marca de leitura.
create function app_private.support_thread_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.staff_last_read_at is distinct from old.staff_last_read_at and not app_private.is_platform_admin() then
    raise exception 'somente a plataforma marca a leitura do suporte' using errcode = '42501';
  end if;
  if new.requester_last_read_at is distinct from old.requester_last_read_at and old.opened_by is distinct from (select auth.uid()) then
    raise exception 'somente quem abriu a conversa marca a leitura' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger support_threads_guard before update on public.support_threads
  for each row execute function app_private.support_thread_guard();

do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.support_messages;
    alter publication supabase_realtime add table public.support_threads;
  end if;
end $rt$;

-- ============================================================ 6. logs de erro
create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('client', 'edge_function', 'cron', 'business', 'device')),
  category text not null check (char_length(category) between 1 and 200),
  severity text not null default 'error' check (severity in ('warn', 'error', 'critical')),
  message text not null,
  stack text,
  context jsonb,
  tenant_id uuid references public.tenants (id) on delete restrict,
  user_id uuid,
  screen text check (screen is null or char_length(screen) <= 200),
  url text,
  user_agent text,
  fingerprint text not null,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now()
);
-- Uma linha ABERTA por fingerprint; resolvido e reaberto vira caso novo.
create unique index error_logs_fingerprint_open_idx on public.error_logs (fingerprint) where not resolved;
create index error_logs_last_seen_idx on public.error_logs (last_seen_at desc);
create index error_logs_tenant_idx on public.error_logs (tenant_id);

create function app_private.error_logs_resolve_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.resolved then
    new.resolved_at := coalesce(old.resolved_at, now());
    new.resolved_by := coalesce(old.resolved_by, (select auth.uid()));
  else
    new.resolved_at := null;
    new.resolved_by := null;
    new.resolution_note := null;
  end if;
  return new;
end $$;
create trigger error_logs_resolve_stamp before update on public.error_logs
  for each row execute function app_private.error_logs_resolve_stamp();

-- Unica porta de escrita. Sanea: sem query string na URL, contexto sem chaves sensiveis e limitado.
create function public.log_error(
  p_source text, p_category text, p_message text,
  p_severity text default 'error', p_stack text default null, p_context jsonb default null,
  p_tenant_id uuid default null, p_screen text default null, p_url text default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_source text := lower(coalesce(p_source, ''));
  v_severity text := lower(coalesce(p_severity, 'error'));
  v_message text := left(coalesce(nullif(btrim(p_message), ''), '(sem mensagem)'), 2000);
  v_category text := left(coalesce(nullif(btrim(p_category), ''), 'unknown'), 200);
  v_context jsonb := case when jsonb_typeof(p_context) = 'object' then p_context else null end;
  v_tenant uuid := case when p_tenant_id is not null and app_private.is_member(p_tenant_id) then p_tenant_id else null end;
  v_fp text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  if v_source not in ('client', 'edge_function', 'cron', 'business', 'device') then v_source := 'client'; end if;
  if v_severity not in ('warn', 'error', 'critical') then v_severity := 'error'; end if;
  -- Limite por usuario: sem inundar a tabela com mensagens aleatorias.
  if (select count(*) from public.error_logs e where e.user_id = v_uid and e.created_at > now() - interval '1 minute') >= 30 then
    return null;
  end if;
  if v_context is not null then
    v_context := v_context - array['password', 'pin', 'token', 'secret', 'authorization', 'apikey', 'api_key',
                                   'access_token', 'refresh_token', 'credential', 'biometric', 'face', 'cookie'];
    if length(v_context::text) > 8000 then
      v_context := jsonb_build_object('truncated', true);
    end if;
  end if;
  v_fp := md5(v_source || '|' || v_category || '|' || left(v_message, 300) || '|' || coalesce(left(p_screen, 200), ''));

  insert into public.error_logs (source, category, severity, message, stack, context, tenant_id, user_id, screen, url, user_agent, fingerprint)
  values (v_source, v_category, v_severity, v_message, left(p_stack, 8000), v_context, v_tenant, v_uid,
          left(p_screen, 200), left(regexp_replace(coalesce(p_url, ''), '[?#].*$', ''), 500),
          left(p_user_agent, 300), v_fp)
  on conflict (fingerprint) where not resolved do update set
    occurrences = public.error_logs.occurrences + 1,
    last_seen_at = now(),
    context = coalesce(excluded.context, public.error_logs.context),
    tenant_id = coalesce(excluded.tenant_id, public.error_logs.tenant_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_error(text, text, text, text, text, jsonb, uuid, text, text, text) from public, anon;
grant execute on function public.log_error(text, text, text, text, text, jsonb, uuid, text, text, text) to authenticated;

-- ============================================================ 7. configuracoes globais e troca de senha
create table public.system_settings (
  key text primary key check (key in ('global_logo', 'login_image_url')),
  value text not null default '' check (
    value = ''
    or (value ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and char_length(value) <= 400000)
    or (value ~ '^https://[^[:space:]]+$' and char_length(value) <= 2000)
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger system_settings_stamp before insert or update on public.system_settings
  for each row execute function app_private.stamp_update();

create table public.user_security_flags (
  user_id uuid primary key references auth.users (id) on delete cascade,
  must_change_password boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger user_security_flags_set_updated_at before update on public.user_security_flags
  for each row execute function app_private.set_updated_at();

-- ============================================================ 8. RPCs da plataforma (somente platform_owner)
create function public.platform_create_tenant(
  p_name text, p_slug text, p_owner_user_id uuid default null, p_owner_email text default null, p_details jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := p_owner_user_id;
  v_tenant uuid;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  if v_owner is null then
    select u.id into v_owner from auth.users u where lower(u.email) = lower(btrim(coalesce(p_owner_email, ''))) limit 1;
  end if;
  if v_owner is null then
    raise exception 'usuario owner inexistente' using errcode = '23503';
  end if;
  v_tenant := public.create_tenant(p_name, p_slug, v_owner);
  perform app_private.apply_tenant_details(v_tenant, p_details);
  -- Organizacao nova nasce so com o plano base (todo modulo comeca desligado).
  update public.tenants
  set features_enabled = '{"sites":true,"zones":true,"people":true,"groups":true,"members":true,"audit":true}'::jsonb
  where id = v_tenant;
  return v_tenant;
end $$;
revoke all on function public.platform_create_tenant(text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.platform_create_tenant(text, text, uuid, text, jsonb) to authenticated;

create function public.platform_update_tenant(p_tenant uuid, p_name text, p_details jsonb, p_limits jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_limits jsonb;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'organizacao inexistente' using errcode = '23503';
  end if;
  if p_limits is not null then
    if jsonb_typeof(p_limits) <> 'object' then
      raise exception 'limites invalidos' using errcode = '23514';
    end if;
    select coalesce(jsonb_object_agg(k.key, to_jsonb(least(greatest(coalesce((p_limits ->> k.key)::int, 0), 0), 100000))), '{}'::jsonb)
      into v_limits
    from (values ('max_sites'), ('max_people')) as k(key)
    where p_limits ? k.key;
  end if;
  update public.tenants
  set name = coalesce(nullif(btrim(p_name), ''), name),
      limits = coalesce(v_limits, limits)
  where id = p_tenant;
  perform app_private.apply_tenant_details(p_tenant, p_details);
end $$;
revoke all on function public.platform_update_tenant(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.platform_update_tenant(uuid, text, jsonb, jsonb) to authenticated;

create function public.platform_set_features(p_tenant uuid, p_features jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clean jsonb;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  if jsonb_typeof(p_features) <> 'object' or (select count(*) from jsonb_object_keys(p_features)) > 64 then
    raise exception 'modulos invalidos' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_each(p_features) e where e.key !~ '^[a-z0-9_]+$' or jsonb_typeof(e.value) <> 'boolean'
  ) then
    raise exception 'modulos invalidos' using errcode = '23514';
  end if;
  -- O plano base e sempre incluso.
  v_clean := p_features || '{"sites":true,"zones":true,"people":true,"groups":true,"members":true,"audit":true}'::jsonb;
  update public.tenants set features_enabled = v_clean where id = p_tenant;
  if not found then
    raise exception 'organizacao inexistente' using errcode = '23503';
  end if;
end $$;
revoke all on function public.platform_set_features(uuid, jsonb) from public, anon;
grant execute on function public.platform_set_features(uuid, jsonb) to authenticated;

-- Pessoas ativas por organizacao (so numeros; para o limite "por pessoa" e alertas).
create function public.platform_people_counts() returns table (tenant_id uuid, active_people integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  return query
    select p.tenant_id, count(*)::integer from public.people p where p.status = 'active' group by p.tenant_id;
end $$;
revoke all on function public.platform_people_counts() from public, anon;
grant execute on function public.platform_people_counts() to authenticated;

-- Contrata um plano. Todos os valores sao recalculados aqui; o que o front mostra e so previa.
create function public.platform_contract_plan(
  p_tenant_id uuid, p_plan_id uuid, p_cycle text, p_people integer default null, p_items text[] default null,
  p_discount_type text default null, p_discount numeric default 0, p_reason text default null, p_start date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.platform_commercial_config%rowtype;
  v_plan public.platform_plans%rowtype;
  v_cycle public.platform_plan_cycles%rowtype;
  v_tenant public.tenants%rowtype;
  v_active integer;
  v_people integer;
  v_items text[];
  v_ids text[];
  v_price_person numeric(12,2);
  v_fixed numeric(12,2);
  v_monthly numeric(12,2);
  v_cycle_value numeric(12,2);
  v_setup_base numeric(12,2);
  v_setup_disc numeric(12,2) := 0;
  v_setup_final numeric(12,2);
  v_discount numeric := coalesce(p_discount, 0);
  v_start date := coalesce(p_start, current_date);
  v_prices jsonb;
  v_off jsonb;
  v_on jsonb;
  v_features jsonb;
  v_id uuid;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  select * into v_cfg from public.platform_commercial_config where id;
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Organização não encontrada.'; end if;
  select * into v_plan from public.platform_plans where id = p_plan_id;
  if not found or not v_plan.active then raise exception 'Plano inexistente ou desativado.'; end if;
  select * into v_cycle from public.platform_plan_cycles where plan_id = p_plan_id and cycle = p_cycle;
  if not found or not v_cycle.active then raise exception 'Ciclo indisponível para este plano.'; end if;

  select count(*)::integer into v_active from public.people where tenant_id = p_tenant_id and status = 'active';
  v_people := coalesce(p_people, v_active);
  if v_people < 1 then raise exception 'Informe a quantidade de pessoas contratadas (mínimo 1).'; end if;

  if v_plan.mode = 'per_person'
     and (v_people > v_cfg.max_people_per_person_plan or v_active > v_cfg.max_people_per_person_plan) then
    raise exception 'A modalidade por pessoa vale até % pessoas. Contrate um pacote.', v_cfg.max_people_per_person_plan;
  end if;
  if v_plan.people_min is not null and v_people < v_plan.people_min then
    raise exception 'Este plano exige no mínimo % pessoas.', v_plan.people_min;
  end if;
  if v_plan.people_max is not null and v_people > v_plan.people_max then
    raise exception 'Este plano aceita no máximo % pessoas.', v_plan.people_max;
  end if;

  if v_plan.mode = 'package' then v_items := v_plan.items; else v_items := coalesce(p_items, '{}'); end if;
  v_items := array(select distinct i from unnest(v_items) i where i <> 'base' order by i);
  if exists (
    select 1 from unnest(v_items) i
    where not exists (select 1 from public.platform_module_prices p where p.item_id = i and p.active)
  ) then
    raise exception 'Há um item inexistente ou desativado na lista de módulos.';
  end if;
  if not exists (select 1 from public.platform_module_prices where item_id = 'base' and active) then
    raise exception 'O preço do plano base está desativado.';
  end if;
  v_ids := array['base'] || v_items;

  select coalesce(sum(price) filter (where billing = 'fixed_monthly'), 0)
    into v_fixed from public.platform_module_prices where item_id = any(v_ids);
  if v_plan.mode = 'package' then
    v_price_person := v_plan.price_per_person;
  else
    select coalesce(sum(price) filter (where billing = 'per_person'), 0)
      into v_price_person from public.platform_module_prices where item_id = any(v_ids);
  end if;
  v_monthly := round(greatest(v_people * v_price_person, v_plan.monthly_minimum) + v_fixed, 2);
  v_cycle_value := round(v_monthly * v_cycle.months * (1 - v_cycle.discount_percent / 100.0), 2);

  v_setup_base := coalesce(v_cycle.setup_fee, v_plan.setup_fee);
  if v_discount < 0 then raise exception 'Desconto inválido.'; end if;
  if v_discount > 0 then
    if p_discount_type not in ('percent', 'amount') then raise exception 'Informe se o desconto é em porcentagem ou em reais.'; end if;
    if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'Informe o motivo do desconto na implantação.'; end if;
    if p_discount_type = 'percent' then
      if v_discount > v_cfg.setup_discount_max_percent then
        raise exception 'O desconto máximo na implantação é de % por cento.', v_cfg.setup_discount_max_percent;
      end if;
      v_setup_disc := round(v_setup_base * v_discount / 100.0, 2);
    else
      if v_setup_base > 0 and v_discount * 100.0 / v_setup_base > v_cfg.setup_discount_max_percent then
        raise exception 'O desconto máximo na implantação é de % por cento.', v_cfg.setup_discount_max_percent;
      end if;
      v_setup_disc := round(v_discount, 2);
    end if;
  end if;
  v_setup_disc := least(v_setup_disc, v_setup_base);
  v_setup_final := greatest(v_setup_base - v_setup_disc, 0);

  -- Snapshot sem custo estimado.
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'billing', billing, 'price', price) order by item_id), '[]'::jsonb)
    into v_prices from public.platform_module_prices where item_id = any(v_ids);

  -- Modulos seguem o plano (historico gravado pela trigger de tenants).
  select coalesce(jsonb_object_agg(k, false), '{}'::jsonb) into v_off
    from (select distinct unnest(keys) k from public.platform_module_prices) s;
  select coalesce(jsonb_object_agg(k, true), '{}'::jsonb) into v_on
    from (select distinct unnest(keys) k from public.platform_module_prices where item_id = any(v_ids)) s;
  v_features := coalesce(v_tenant.features_enabled, '{}'::jsonb) || v_off || v_on;

  update public.tenant_contracts set status = 'ended', ended_at = now()
   where tenant_id = p_tenant_id and status = 'active';

  insert into public.tenant_contracts (
    tenant_id, plan_id, cycle, months, contracted_people, items, snapshot, monthly_value, cycle_value,
    setup_base, setup_discount_type, setup_discount, setup_final, discount_reason, starts_on, ends_on, status, created_by
  ) values (
    p_tenant_id, p_plan_id, p_cycle, v_cycle.months, v_people, v_items,
    jsonb_build_object(
      'plan', jsonb_build_object('id', v_plan.id, 'name', v_plan.name, 'mode', v_plan.mode,
                                 'price_per_person', v_price_person, 'monthly_minimum', v_plan.monthly_minimum),
      'cycle', jsonb_build_object('cycle', v_cycle.cycle, 'months', v_cycle.months, 'discount_percent', v_cycle.discount_percent),
      'prices', v_prices
    ),
    v_monthly, v_cycle_value, v_setup_base,
    case when v_discount > 0 then p_discount_type else null end,
    v_setup_disc, v_setup_final,
    case when v_discount > 0 then btrim(p_reason) else null end,
    v_start, (v_start + make_interval(months => v_cycle.months))::date, 'active', (select auth.uid())
  ) returning id into v_id;

  update public.tenants set features_enabled = v_features where id = p_tenant_id;

  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant_id, (select auth.uid()), 'tenant_contracts.insert', 'tenant_contracts', v_id::text,
          jsonb_build_object('plan', v_plan.name, 'cycle', p_cycle));
  return v_id;
end $$;
revoke all on function public.platform_contract_plan(uuid, uuid, text, integer, text[], text, numeric, text, date) from public, anon;
grant execute on function public.platform_contract_plan(uuid, uuid, text, integer, text[], text, numeric, text, date) to authenticated;

-- "Meu plano": o dono da organizacao ve a propria contratacao, sem custo nem motivo de desconto.
create function public.my_plan(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.tenant_contracts%rowtype;
  v_name text;
  v_mode text;
begin
  if not app_private.has_permission(p_tenant, 'tenant:update') then
    return null;
  end if;
  select * into v_row from public.tenant_contracts where tenant_id = p_tenant and status = 'active';
  if not found then return null; end if;
  select name, mode into v_name, v_mode from public.platform_plans where id = v_row.plan_id;
  return jsonb_build_object(
    'plan', v_name, 'mode', v_mode, 'cycle', v_row.cycle, 'months', v_row.months,
    'contracted_people', v_row.contracted_people, 'items', v_row.items,
    'monthly_value', v_row.monthly_value, 'cycle_value', v_row.cycle_value,
    'setup_final', v_row.setup_final, 'starts_on', v_row.starts_on, 'ends_on', v_row.ends_on
  );
end $$;
revoke all on function public.my_plan(uuid) from public, anon;
grant execute on function public.my_plan(uuid) to authenticated;

-- Substitui a RPC anterior (agora coberta por platform_create_tenant).
drop function public.create_tenant_by_email(text, text, text);

-- ============================================================ 9. grants e RLS
alter table public.tenant_details enable row level security;
alter table public.tenant_feature_changes enable row level security;
alter table public.platform_commercial_config enable row level security;
alter table public.platform_module_prices enable row level security;
alter table public.platform_plans enable row level security;
alter table public.platform_plan_cycles enable row level security;
alter table public.tenant_contracts enable row level security;
alter table public.platform_pricing_history enable row level security;
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.error_logs enable row level security;
alter table public.system_settings enable row level security;
alter table public.user_security_flags enable row level security;

revoke all on public.tenant_details, public.tenant_feature_changes, public.platform_commercial_config,
  public.platform_module_prices, public.platform_plans, public.platform_plan_cycles, public.tenant_contracts,
  public.platform_pricing_history, public.support_threads, public.support_messages, public.error_logs,
  public.system_settings, public.user_security_flags from anon, authenticated;

grant select on public.tenant_details, public.tenant_feature_changes, public.tenant_contracts,
  public.platform_pricing_history, public.platform_commercial_config to authenticated;
grant update (max_people_per_person_plan, setup_discount_max_percent, setup_fee_min, setup_fee_max)
  on public.platform_commercial_config to authenticated;
grant select on public.platform_module_prices to authenticated;
grant insert (item_id, billing, price, estimated_cost, keys, active) on public.platform_module_prices to authenticated;
grant update (billing, price, estimated_cost, active) on public.platform_module_prices to authenticated;
grant select on public.platform_plans to authenticated;
grant insert (name, mode, items, price_per_person, monthly_minimum, people_min, people_max, setup_fee, sort_order, description)
  on public.platform_plans to authenticated;
grant update (name, items, price_per_person, monthly_minimum, people_min, people_max, setup_fee, sort_order, active, description)
  on public.platform_plans to authenticated;
grant select on public.platform_plan_cycles to authenticated;
grant insert (plan_id, cycle, months, discount_percent, setup_fee, active) on public.platform_plan_cycles to authenticated;
-- upsert do PostgREST atualiza todas as colunas enviadas (ON CONFLICT DO UPDATE SET col = EXCLUDED.col).
grant update (plan_id, cycle, months, discount_percent, setup_fee, active) on public.platform_plan_cycles to authenticated;
grant select on public.support_threads, public.support_messages to authenticated;
grant insert (tenant_id, opened_by) on public.support_threads to authenticated;
grant update (staff_last_read_at, requester_last_read_at) on public.support_threads to authenticated;
grant insert (thread_id, tenant_id, sender_id, sender_side, body) on public.support_messages to authenticated;
grant select on public.error_logs to authenticated;
grant update (resolved, resolution_note) on public.error_logs to authenticated;
grant select on public.system_settings to anon, authenticated;
grant insert (key, value), update (key, value) on public.system_settings to authenticated;
grant select on public.user_security_flags to authenticated;
grant update (must_change_password) on public.user_security_flags to authenticated;

-- Dados internos: platform_owner (detalhes tambem ao suporte da plataforma).
create policy tenant_details_select on public.tenant_details for select to authenticated
  using (app_private.is_platform_admin());
create policy tenant_feature_changes_select on public.tenant_feature_changes for select to authenticated
  using (app_private.is_platform_admin());
create policy platform_commercial_config_select on public.platform_commercial_config for select to authenticated
  using (app_private.is_platform_owner());
create policy platform_commercial_config_update on public.platform_commercial_config for update to authenticated
  using (app_private.is_platform_owner()) with check (app_private.is_platform_owner());
create policy platform_module_prices_select on public.platform_module_prices for select to authenticated
  using (app_private.is_platform_owner());
create policy platform_module_prices_insert on public.platform_module_prices for insert to authenticated
  with check (app_private.is_platform_owner());
create policy platform_module_prices_update on public.platform_module_prices for update to authenticated
  using (app_private.is_platform_owner()) with check (app_private.is_platform_owner());
create policy platform_plans_select on public.platform_plans for select to authenticated
  using (app_private.is_platform_owner());
create policy platform_plans_insert on public.platform_plans for insert to authenticated
  with check (app_private.is_platform_owner());
create policy platform_plans_update on public.platform_plans for update to authenticated
  using (app_private.is_platform_owner()) with check (app_private.is_platform_owner());
create policy platform_plan_cycles_select on public.platform_plan_cycles for select to authenticated
  using (app_private.is_platform_owner());
create policy platform_plan_cycles_insert on public.platform_plan_cycles for insert to authenticated
  with check (app_private.is_platform_owner());
create policy platform_plan_cycles_update on public.platform_plan_cycles for update to authenticated
  using (app_private.is_platform_owner()) with check (app_private.is_platform_owner());
create policy tenant_contracts_select on public.tenant_contracts for select to authenticated
  using (app_private.is_platform_owner());
create policy platform_pricing_history_select on public.platform_pricing_history for select to authenticated
  using (app_private.is_platform_owner());

-- Suporte: quem abriu (com permissao) e a plataforma.
create policy support_threads_select on public.support_threads for select to authenticated
  using (app_private.is_platform_admin()
         or (opened_by = (select auth.uid()) and app_private.has_permission(tenant_id, 'support:read')));
create policy support_threads_insert on public.support_threads for insert to authenticated
  with check (opened_by = (select auth.uid()) and app_private.has_permission(tenant_id, 'support:write'));
create policy support_threads_update on public.support_threads for update to authenticated
  using (app_private.is_platform_admin() or opened_by = (select auth.uid()))
  with check (app_private.is_platform_admin() or opened_by = (select auth.uid()));

create policy support_messages_select on public.support_messages for select to authenticated
  using (app_private.is_platform_admin()
         or (app_private.has_permission(tenant_id, 'support:read')
             and exists (select 1 from public.support_threads t
                         where t.id = support_messages.thread_id and t.opened_by = (select auth.uid()))));
create policy support_messages_insert on public.support_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (sender_side = 'platform' and app_private.is_platform_admin())
      or (sender_side = 'tenant' and app_private.has_permission(tenant_id, 'support:write')
          and exists (select 1 from public.support_threads t
                      where t.id = support_messages.thread_id and t.opened_by = (select auth.uid())))
    )
  );

-- Logs: leitura e triagem pela plataforma; escrita so por log_error().
create policy error_logs_select on public.error_logs for select to authenticated
  using (app_private.is_platform_admin());
create policy error_logs_update on public.error_logs for update to authenticated
  using (app_private.is_platform_admin()) with check (app_private.is_platform_admin());

-- Configuracoes: leitura publica (so as duas chaves permitidas pelo CHECK), escrita platform_owner.
create policy system_settings_select on public.system_settings for select to anon, authenticated using (true);
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check (app_private.is_platform_owner());
create policy system_settings_update on public.system_settings for update to authenticated
  using (app_private.is_platform_owner()) with check (app_private.is_platform_owner());

-- Troca de senha: cada usuario le a propria marca e so pode limpa-la (a Edge Function a liga).
create policy user_security_flags_select on public.user_security_flags for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_security_flags_update on public.user_security_flags for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and must_change_password = false);

-- service_role (Edge Function) precisa de DML nas tabelas novas.
grant select, insert, update, delete on all tables in schema public to service_role;

-- A plataforma identifica quem escreve no suporte pelo nome de exibicao (so display_name; sem e-mail).
create policy profiles_select_platform on public.profiles for select to authenticated
  using (app_private.is_platform_admin());
