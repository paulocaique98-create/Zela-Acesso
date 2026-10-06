-- Painel do Desenvolvedor (plataforma): criar organizacao a partir do e-mail do dono.
-- Somente platform_owner. Nao revela se o e-mail existe a quem nao e platform_owner (a checagem de papel vem antes).
create function public.create_tenant_by_email(p_name text, p_slug text, p_owner_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if not app_private.is_platform_owner() then
    raise exception 'permissao negada' using errcode = '42501';
  end if;
  select u.id into v_owner from auth.users u
  where lower(u.email) = lower(btrim(p_owner_email))
  limit 1;
  if v_owner is null then
    raise exception 'usuario owner inexistente' using errcode = '23503';
  end if;
  return public.create_tenant(p_name, p_slug, v_owner);
end $$;
revoke all on function public.create_tenant_by_email(text, text, text) from public, anon;
grant execute on function public.create_tenant_by_email(text, text, text) to authenticated;
