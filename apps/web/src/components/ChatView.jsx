import { useEffect, useRef, useState } from 'react';
import { ChevronUp, LifeBuoy, Loader2, Send } from 'lucide-react';

export const CHAT_PAGE_SIZE = 50;

export const formatChatTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Conversa de suporte (lista de mensagens paginada + campo de envio). Reaproveitada pelo painel da plataforma
 * e pela organizacao; `mineSide` diz de que lado ('tenant' | 'platform') sao as mensagens "minhas".
 * @param {{
 *   messages: { id: string, sender_side: string, body: string, created_at: string }[],
 *   mineSide: 'tenant' | 'platform', loading: boolean, hasMoreOlder: boolean, loadingOlder: boolean,
 *   onLoadOlder: () => void, onSend: (body: string) => Promise<string | null>, error?: string | null,
 *   scrollKey?: unknown,
 * }} props
 */
export function ChatView({
  messages,
  mineSide,
  loading,
  hasMoreOlder,
  loadingOlder,
  onLoadOlder,
  onSend,
  error,
  disabled = false,
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!stickToBottom.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    stickToBottom.current = true;
    const failure = await onSend(body.trim());
    setSending(false);
    if (failure) setSendError(failure);
    else setBody('');
  }

  async function older() {
    const el = scrollRef.current;
    const prev = el?.scrollHeight ?? 0;
    stickToBottom.current = false;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prev;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5"
        aria-live="polite"
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center text-on-surface-variant">
            <LifeBuoy className="mx-auto mb-3 h-12 w-12 opacity-30" aria-hidden="true" />
            <p className="text-sm font-semibold">Nenhuma mensagem ainda.</p>
          </div>
        ) : (
          <>
            {hasMoreOlder && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={() => void older()}
                  disabled={loadingOlder}
                  className="flex items-center gap-1.5 rounded-zela-md bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/15 disabled:opacity-60"
                >
                  {loadingOlder ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ChevronUp size={14} />
                  )}
                  Carregar mensagens anteriores
                </button>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.sender_side === mineSide;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-zela-lg px-4 py-2.5 text-sm sm:max-w-[65%] ${mine ? 'bg-primary text-white' : 'bg-surface-container text-on-surface'}`}
                  >
                    <p className="break-words whitespace-pre-wrap">{m.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-on-surface-variant'}`}
                    >
                      {formatChatTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {(error || sendError) && (
        <div className="px-4 pb-2 sm:px-5">
          <p
            role="alert"
            className="rounded-zela-md border border-red-100 bg-red-50 p-2.5 text-xs font-medium text-error"
          >
            {error || sendError}
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="flex shrink-0 items-center gap-2 border-t border-outline-variant p-4 sm:p-5"
      >
        <input
          type="text"
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Digite sua mensagem..."
          aria-label="Mensagem"
          className="min-w-0 flex-1 rounded-zela-md border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
        />
        <button
          type="submit"
          disabled={disabled || sending || !body.trim()}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-zela-md bg-primary p-2.5 font-bold text-white transition active:scale-95 disabled:bg-surface-container disabled:text-on-surface-variant sm:px-4"
        >
          {sending ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={18} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Enviar</span>
        </button>
      </form>
    </div>
  );
}
