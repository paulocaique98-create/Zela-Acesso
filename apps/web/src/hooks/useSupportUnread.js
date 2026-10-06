import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Conversas de suporte com mensagem nova nao lida pela plataforma (badge do menu). A RLS ja limita o que cada
 * usuario ve; aqui so se compara updated_at com a marca de leitura. Escuta UPDATE de support_threads (um trigger
 * do banco atualiza updated_at a cada mensagem), sem filtro porque a plataforma atende varias organizacoes.
 */
export function useSupportUnread(enabled) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return setCount(0);
    const { data, error } = await supabase
      .from('support_threads')
      .select('id, updated_at, staff_last_read_at')
      .limit(500);
    if (error) return;
    setCount(
      (data ?? []).filter(
        (t) => !t.staff_last_read_at || new Date(t.updated_at) > new Date(t.staff_last_read_at),
      ).length,
    );
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const channel = supabase
      .channel('support-unread')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_threads' },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return { count, refresh };
}
