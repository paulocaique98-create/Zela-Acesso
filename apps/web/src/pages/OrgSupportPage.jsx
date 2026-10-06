import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ChatView } from '../components/ChatView';
import { useSupportThread } from '../hooks/useSupportThread';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useWorkspace } from '../workspace/WorkspaceProvider';

/** Suporte da organizacao: conversa de quem tem permissao (owner/admin) com a equipe da plataforma. */
export function OrgSupportPage() {
  const { session } = useAuth();
  const ws = useWorkspace();
  const userId = session?.user.id;
  const tenantId = ws.current?.id;
  const [thread, setThread] = useState(null);
  const [ready, setReady] = useState(false);
  const chat = useSupportThread(thread, userId, 'tenant');

  useEffect(() => {
    if (!tenantId || !userId) return;
    let alive = true;
    setReady(false);
    void supabase
      .from('support_threads')
      .select('id, tenant_id')
      .eq('tenant_id', tenantId)
      .eq('opened_by', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setThread(data ?? null);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [tenantId, userId]);

  // A conversa so e criada na primeira mensagem (evita conversas vazias na lista da plataforma).
  async function send(body) {
    if (thread) return chat.send(body);
    const { data: created, error } = await supabase
      .from('support_threads')
      .insert({ tenant_id: tenantId, opened_by: userId })
      .select('id, tenant_id')
      .single();
    if (error) return safeMessage(error, 'Não foi possível iniciar a conversa.');
    const { error: msgError } = await supabase.from('support_messages').insert({
      thread_id: created.id,
      tenant_id: tenantId,
      sender_id: userId,
      sender_side: 'tenant',
      body,
    });
    if (msgError) return safeMessage(msgError, 'Não foi possível enviar a mensagem.');
    setThread(created);
    return null;
  }

  return (
    <section className="-m-4 flex min-h-[calc(100dvh-4rem)] flex-col bg-surface-container-lowest md:-m-6">
      <div className="shrink-0 border-b border-outline-variant p-4 sm:p-5">
        <h1 className="text-h2 text-on-surface">Suporte</h1>
        <p className="text-small text-on-surface-variant">
          Fale com a equipe da plataforma. Não envie senhas, PINs ou dados biométricos.
        </p>
      </div>
      <ChatView
        {...chat}
        loading={!ready || chat.loading}
        mineSide="tenant"
        disabled={!ready}
        onLoadOlder={chat.loadOlder}
        onSend={send}
      />
    </section>
  );
}
