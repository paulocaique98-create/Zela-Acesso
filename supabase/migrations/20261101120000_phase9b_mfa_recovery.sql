-- Fase 9B (fechamento): codigos de recuperacao do MFA, flag de MFA da equipe da plataforma com UI e auditoria
-- de remocao/cadastro de fator.
-- Decisoes:
--  * Codigo de recuperacao NAO concede aal2 (so o Supabase Auth emite aal2). Usar um codigo REMOVE os fatores TOTP da
--    pessoa e apaga os demais codigos; a sessao segue aal1 e o app leva ao novo cadastro. Assim a recuperacao nunca
--    vira um atalho para sessao aal2 sem segundo fator.
--  * Codigos: 8 por geracao, 10 caracteres de alfabeto sem ambiguidade (~50 bits), guardados so como sha256 com o
--    usuario como sal; texto puro e devolvido uma unica vez. Gerar exige aal2 e invalida os anteriores.
--  * Tentativas erradas: 5 em 15 min por usuario bloqueiam novas tentativas (a falha precisa persistir, por isso a
--    funcao devolve false em vez de lancar excecao).
--  * Nada de codigo/segredo em log ou audit_log.

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (user_id, code_hash)
);
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from public, anon, authenticated;

create table public.mfa_recovery_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index mfa_recovery_attempts_user_idx on public.mfa_recovery_attempts (user_id, created_at desc);
alter table public.mfa_recovery_attempts enable row level security;
revoke all on public.mfa_recovery_attempts from public, anon, authenticated;

-- Gera 8 codigos novos (substitui os anteriores). Exige sessao aal2 com fator TOTP verificado.
create function public.generate_mfa_recovery_codes() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_codes text[] := '{}';
  v_code text;
  v_bytes bytea;
  i int;
  j int;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  if not app_private.session_is_aal2() then
    raise exception 'Confirme o segundo fator (TOTP) antes de gerar códigos de recuperação.' using errcode = '42501';
  end if;
  delete from public.mfa_recovery_codes where user_id = v_uid;
  for i in 1..8 loop
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    for j in 0..9 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, j) % 32) + 1, 1);
    end loop;
    v_codes := v_codes || v_code;
    insert into public.mfa_recovery_codes (user_id, code_hash)
    values (v_uid, encode(extensions.digest(v_uid::text || ':' || v_code, 'sha256'), 'hex'));
  end loop;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (null, v_uid, 'auth.mfa_recovery_generated', 'auth.users', v_uid::text, jsonb_build_object('count', 8));
  return v_codes;
end $$;
revoke all on function public.generate_mfa_recovery_codes() from public, anon;
grant execute on function public.generate_mfa_recovery_codes() to authenticated;

-- Quantos codigos validos restam (nao revela os codigos).
create function public.mfa_recovery_codes_remaining() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.mfa_recovery_codes
  where user_id = (select auth.uid()) and used_at is null;
$$;
revoke all on function public.mfa_recovery_codes_remaining() from public, anon;
grant execute on function public.mfa_recovery_codes_remaining() to authenticated;

-- Usa um codigo: remove os fatores TOTP da pessoa e apaga todos os codigos. Devolve false se invalido ou bloqueado.
create function public.use_mfa_recovery_code(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  delete from public.mfa_recovery_attempts where user_id = v_uid and created_at < now() - interval '1 day';
  if (select count(*) from public.mfa_recovery_attempts
      where user_id = v_uid and created_at > now() - interval '15 minutes') >= 5 then
    return false;
  end if;
  v_hash := encode(extensions.digest(
    v_uid::text || ':' || upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
  select id into v_id from public.mfa_recovery_codes
  where user_id = v_uid and code_hash = v_hash and used_at is null;
  if v_id is null then
    insert into public.mfa_recovery_attempts (user_id) values (v_uid);
    insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    values (null, v_uid, 'auth.mfa_recovery_failed', 'auth.users', v_uid::text, '{}'::jsonb);
    return false;
  end if;
  delete from auth.mfa_factors where user_id = v_uid;
  delete from public.mfa_recovery_codes where user_id = v_uid;
  delete from public.mfa_recovery_attempts where user_id = v_uid;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (null, v_uid, 'auth.mfa_recovery_used', 'auth.users', v_uid::text, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.use_mfa_recovery_code(text) from public, anon;
grant execute on function public.use_mfa_recovery_code(text) to authenticated;

-- Auditoria de fator removido (qualquer caminho: tela, codigo de recuperacao ou admin).
create function app_private.audit_mfa_factor_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'verified' then
    insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
    values (null, old.user_id, 'auth.mfa_factor_removed', 'auth.users', old.user_id::text,
            jsonb_build_object('factor_type', old.factor_type::text));
  end if;
  return old;
end $$;
revoke all on function app_private.audit_mfa_factor_removed() from public, anon, authenticated;
create trigger audit_mfa_factor_removed after delete on auth.mfa_factors
  for each row execute function app_private.audit_mfa_factor_removed();

-- MFA da equipe da plataforma: leitura e alteracao pelo platform_owner (aal2 para ligar ou desligar).
create function public.get_platform_mfa_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select case when app_private.is_platform_admin() then
    (select ps.mfa_required_for_staff from public.platform_security ps) end;
$$;
revoke all on function public.get_platform_mfa_required() from public, anon;
grant execute on function public.get_platform_mfa_required() to authenticated;

create function public.set_platform_mfa_required(p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.is_platform_owner() then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_required is null then raise exception 'Informe se o MFA será exigido.'; end if;
  if not app_private.session_is_aal2() then
    raise exception 'Confirme o segundo fator (TOTP) antes de alterar esta configuração.' using errcode = '42501';
  end if;
  update public.platform_security set mfa_required_for_staff = p_required;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (null, (select auth.uid()), 'platform.mfa_required', 'platform_security', 'singleton',
          jsonb_build_object('required', p_required));
end $$;
revoke all on function public.set_platform_mfa_required(boolean) from public, anon;
grant execute on function public.set_platform_mfa_required(boolean) to authenticated;

-- A equipe da plataforma sem aal2 nao enxerga platform_admins (is_platform_admin exige aal2 quando ligado); esta
-- funcao diz so se a exigencia vale para a PROPRIA pessoa, para o app levar ao desafio/cadastro do fator.
create function public.platform_mfa_required_for_me() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    and (select ps.mfa_required_for_staff from public.platform_security ps);
$$;
revoke all on function public.platform_mfa_required_for_me() from public, anon;
grant execute on function public.platform_mfa_required_for_me() to authenticated;
