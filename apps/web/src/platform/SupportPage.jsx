import { useEffect, useState } from 'react';
import { ArrowLeft, LifeBuoy, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ChatView, formatChatTime } from '../components/ChatView';
import { useSupportThread } from '../hooks/useSupportThread';
import { supabase } from '../lib/supabase';

// Suporte: conversas dos responsaveis das organizacoes com a plataforma. A RLS decide quem le/responde
// (platform_owner e platform_support); o texto das conversas nao e auditado nem enviado a terceiros.

export function PlatformSupportPage() {
  const { session } = useAuth();
  const [threads, setThreads] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const chat = useSupportThread(active, session?.user.id, 'platform');

  async function fetchThreads() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('support_threads')
      .select(
        'id, tenant_id, opened_by, updated_at, staff_last_read_at, tenants ( name, org_code )',
      )
      .order('updated_at', { ascending: false })
      .limit(300);
    if (err) {
      setError('Não foi possível carregar as conversas.');
      setLoading(false);
      return;
    }
    setError(null);
    setThreads(data ?? []);
    const ids = [...new Set((data ?? []).map((t) => t.opened_by))];
    if (ids.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', ids);
      setNames(Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.display_name])));
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchThreads();
  }, []);

  if (active) {
    const t = active;
    return (
      <div className="-m-4 flex min-h-[calc(100dvh-4rem)] flex-col bg-surface-container-lowest md:-m-6">
        <div className="flex shrink-0 items-center gap-3 border-b border-outline-variant p-4 sm:p-5">
          <button
            type="button"
            aria-label="Voltar para as conversas"
            onClick={() => {
              setActive(null);
              void fetchThreads();
            }}
            className="-ml-1 shrink-0 rounded-zela-md p-2 text-on-surface-variant transition hover:bg-surface-container hover:text-on-surface"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-h3 text-on-surface">{names[t.opened_by] || 'Responsável'}</h1>
            <p className="text-xs text-on-surface-variant">
              {t.tenants?.org_code} · {t.tenants?.name}
            </p>
          </div>
        </div>
        <ChatView {...chat} mineSide="platform" onLoadOlder={chat.loadOlder} onSend={chat.send} />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-h2 text-on-surface">Suporte</h1>
        <p className="hidden text-small text-on-surface-variant sm:block">
          Conversas dos responsáveis de todas as organizações.
        </p>
      </div>
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando" />
        </div>
      ) : error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : threads.length === 0 ? (
        <div className="py-16 text-center text-on-surface-variant">
          <LifeBuoy className="mx-auto mb-3 h-12 w-12 opacity-30" aria-hidden="true" />
          <p className="text-sm font-semibold">Nenhuma conversa de suporte ainda.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((t) => {
            const unread = t.staff_last_read_at
              ? new Date(t.updated_at) > new Date(t.staff_last_read_at)
              : true;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setActive(t)}
                  className="flex w-full items-center gap-3 rounded-zela-lg border border-outline-variant bg-surface-container-lowest p-4 text-left transition hover:border-primary/40 hover:bg-surface-container-low"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-on-surface">
                      {names[t.opened_by] || 'Responsável'}
                    </p>
                    <p className="truncate text-xs text-on-surface-variant">
                      {t.tenants?.org_code} · {t.tenants?.name} • Atualizado em{' '}
                      {formatChatTime(t.updated_at)}
                    </p>
                  </div>
                  {unread && (
                    <span
                      aria-label="Não lida"
                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
