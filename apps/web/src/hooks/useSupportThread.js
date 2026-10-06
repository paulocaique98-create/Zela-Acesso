import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_PAGE_SIZE } from '../components/ChatView';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

const COLS = 'id, thread_id, sender_id, sender_side, body, created_at';

/**
 * Mensagens de uma conversa de suporte: pagina (mais recentes primeiro), escuta INSERT em tempo real
 * (a RLS filtra o que chega) e envia. Sem `thread` nao faz nada.
 * @param {{ id: string, tenant_id: string } | null} thread
 * @param {string | undefined} userId
 * @param {'tenant' | 'platform'} side
 */
export function useSupportThread(thread, userId, side) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const threadId = thread?.id;
  const tenantId = thread?.tenant_id;
  const firstAt = useRef(null);
  firstAt.current = messages[0]?.created_at ?? null;

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    void supabase
      .from('support_messages')
      .select(COLS)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(CHAT_PAGE_SIZE)
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (err) setError('Não foi possível abrir esta conversa.');
        const page = (data ?? []).slice().reverse();
        setMessages(page);
        setHasMoreOlder(page.length === CHAT_PAGE_SIZE);
        setLoading(false);
        // Marca como lida do meu lado (a trigger do banco restringe cada lado a sua coluna).
        const column = side === 'platform' ? 'staff_last_read_at' : 'requester_last_read_at';
        void supabase
          .from('support_threads')
          .update({ [column]: new Date().toISOString() })
          .eq('id', threadId);
      });

    const channel = supabase
      .channel(`support-thread-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new],
          );
        },
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [threadId, side]);

  const loadOlder = useCallback(async () => {
    if (!threadId || !firstAt.current || loadingOlder) return;
    setLoadingOlder(true);
    const { data } = await supabase
      .from('support_messages')
      .select(COLS)
      .eq('thread_id', threadId)
      .lt('created_at', firstAt.current)
      .order('created_at', { ascending: false })
      .limit(CHAT_PAGE_SIZE);
    const page = (data ?? []).slice().reverse();
    setMessages((prev) => [...page, ...prev]);
    setHasMoreOlder(page.length === CHAT_PAGE_SIZE);
    setLoadingOlder(false);
  }, [threadId, loadingOlder]);

  /** @returns {Promise<string | null>} mensagem de erro, ou null se enviou. */
  const send = useCallback(
    async (body) => {
      if (!threadId || !userId) return 'Conversa indisponível.';
      const { data, error: err } = await supabase
        .from('support_messages')
        .insert({
          thread_id: threadId,
          tenant_id: tenantId,
          sender_id: userId,
          sender_side: side,
          body,
        })
        .select(COLS)
        .single();
      if (err) return safeMessage(err, 'Não foi possível enviar a mensagem.');
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      return null;
    },
    [threadId, tenantId, userId, side],
  );

  return { messages, loading, hasMoreOlder, loadingOlder, loadOlder, send, error };
}
