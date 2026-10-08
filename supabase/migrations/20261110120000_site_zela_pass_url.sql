-- Zela Pass: endereco do Edge que serve o app do leitor (https://<host>[:porta]), por Local. A nuvem so guarda o texto para o
-- painel montar o link de abertura nos tablets; nao ha segredo aqui. Editar exige site:update (mesma politica de sites).
alter table public.sites
  add column zela_pass_url text
    check (zela_pass_url is null or (char_length(zela_pass_url) <= 200
      and zela_pass_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'));

grant insert (zela_pass_url) on public.sites to authenticated;
grant update (zela_pass_url) on public.sites to authenticated;
