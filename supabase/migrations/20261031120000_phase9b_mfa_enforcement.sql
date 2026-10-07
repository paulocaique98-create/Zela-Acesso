-- Fase 9B: MFA (TOTP) obrigatorio para papeis administrativos (D-016, RNF-04), aplicado no banco por AAL2.
-- Decisoes:
--  * A exigencia e POR ORGANIZACAO (`tenants.mfa_required`), desligada por padrao para nao quebrar organizacoes
--    existentes; ligar e requisito do piloto (checklist 18). Para a equipe da plataforma, flag unica em
--    `platform_security` (so service_role/migration altera; sem UI).
--  * Papeis sujeitos: owner, admin, security_manager e hr_manager (administram pessoas, credenciais, biometria
--    e privacidade). Recepcao, auditor, instalador e viewer ficam fora; revisar com o dono (D-016).
--  * Com a exigencia ligada, sessao sem `aal2` perde TODA permissao desses papeis (has_permission = false), o que
--    leva a RLS a negar. O app leva a pessoa ao desafio TOTP; nenhuma policy foi afrouxada.
--  * Ligar exige a propria sessao em aal2 (evita travar o dono sem fator cadastrado).
--  * Limite: a verificacao e do JWT atual; revogar fator ou sessao e do Supabase Auth. Sem codigos de recuperacao
--    proprios (PENDENTE).

alter table public.tenants add column mfa_required boolean not null default false;

create table public.platform_security (
  singleton boolean primary key default true check (singleton),
  mfa_required_for_staff boolean not null default false
);
insert into public.platform_security default values;
alter table public.platform_security enable row level security;
revoke all on public.platform_security from public, anon, authenticated;

create function app_private.session_is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

create or replace function app_private.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.role = 'platform_owner'
  ) and (app_private.session_is_aal2()
         or not (select ps.mfa_required_for_staff from public.platform_security ps));
$$;

create or replace function app_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  ) and (app_private.session_is_aal2()
         or not (select ps.mfa_required_for_staff from public.platform_security ps));
$$;

create or replace function app_private.has_permission(p_tenant uuid, p_permission text, p_site uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    join public.role_permissions rp on rp.role = m.role
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and t.status = 'active'
      and rp.permission = p_permission
      and (
        m.scope_site_ids is null
        or (p_site is not null and p_site = any (m.scope_site_ids))
      )
      and (
        not t.mfa_required
        or m.role not in ('organization_owner', 'organization_admin', 'security_manager', 'hr_manager')
        or app_private.session_is_aal2()
      )
  );
$$;

-- Liga/desliga a exigencia. Exige tenant:update e sessao em aal2 (o dono prova que tem o segundo fator antes).
create function public.set_tenant_mfa_required(p_tenant uuid, p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.has_permission(p_tenant, 'tenant:update') then
    raise exception 'Você não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if p_required is null then raise exception 'Informe se o MFA será exigido.'; end if;
  if not app_private.session_is_aal2() then
    raise exception 'Confirme o segundo fator (TOTP) antes de alterar esta configuração.' using errcode = '42501';
  end if;
  update public.tenants set mfa_required = p_required where id = p_tenant;
  insert into public.audit_log (tenant_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_tenant, (select auth.uid()), 'tenant.mfa_required', 'tenants', p_tenant::text,
          jsonb_build_object('required', p_required));
end $$;
revoke all on function public.set_tenant_mfa_required(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_mfa_required(uuid, boolean) to authenticated;
