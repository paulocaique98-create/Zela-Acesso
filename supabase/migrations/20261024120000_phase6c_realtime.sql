-- Fase 6C: tempo-real da tela de Operacao. O Realtime respeita a RLS de leitura (alert:read por site),
-- entao o assinante so recebe mudancas do que ja poderia ler. Sem dados novos: so publicacao.
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alerts;
    alter publication supabase_realtime add table public.incidents;
  end if;
end $rt$;
