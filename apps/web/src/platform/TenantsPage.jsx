import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useQuery';
import { useWorkspace } from '../workspace/WorkspaceProvider';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** @param {string} name */
export function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/** Mensagens genericas por codigo do Postgres; nunca expoe texto bruto do banco. @param {{ code?: string } | null} err */
export function createErrorMessage(err) {
  if (!err) return null;
  if (err.code === '42501') return 'Você não tem permissão para criar organizações.';
  if (err.code === '23503')
    return 'Não existe usuário com esse e-mail. O dono precisa ter uma conta antes.';
  if (err.code === '23505') return 'Já existe uma organização com esse identificador.';
  if (err.code === '23514') return 'Nome ou identificador inválido.';
  return 'Não foi possível criar a organização.';
}

const STATUS_LABEL = { active: 'Ativa', suspended: 'Suspensa' };

function CreateTenantModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugOk = SLUG_RE.test(effectiveSlug);

  async function submit(e) {
    e.preventDefault();
    if (!slugOk) {
      setError('Identificador inválido: use letras minúsculas, números e hífen (2 a 63).');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('create_tenant_by_email', {
      p_name: name.trim(),
      p_slug: effectiveSlug,
      p_owner_email: ownerEmail.trim(),
    });
    setBusy(false);
    if (err) {
      setError(createErrorMessage(err));
      return;
    }
    onCreated();
  }

  const input =
    'w-full rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 text-on-surface shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tenant-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-zela-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <h2 id="create-tenant-title" className="font-bold text-on-surface">
            Nova organização
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-zela-md p-1.5 text-on-surface-variant hover:bg-surface-container"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="t-name" className="text-label text-on-surface">
              Nome
            </label>
            <input
              id="t-name"
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="t-slug" className="text-label text-on-surface">
              Identificador (não pode ser alterado depois)
            </label>
            <input
              id="t-slug"
              required
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className={input}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="t-owner" className="text-label text-on-surface">
              E-mail do proprietário
            </label>
            <input
              id="t-owner"
              type="email"
              required
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className={input}
            />
            <p className="text-caption text-on-surface-variant">
              O proprietário precisa já ter conta. O convite por e-mail virá em uma próxima etapa.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-zela-md border border-red-100 bg-red-50 p-3 text-small text-error"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-zela-md px-4 py-2 text-label text-on-surface-variant hover:bg-surface-container"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-zela-md bg-primary px-4 py-2 text-label font-bold text-white shadow-sm hover:bg-primary-container disabled:opacity-70"
            >
              {busy ? 'Criando…' : 'Criar organização'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TenantsPage() {
  const { platformRole } = useWorkspace();
  const isOwner = platformRole === 'platform_owner';
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState(null);

  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, slug, status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }, [reload]);

  async function setStatus(id, status) {
    setActionError(null);
    const { error } = await supabase.from('tenants').update({ status }).eq('id', id);
    if (error) setActionError('Não foi possível alterar o status da organização.');
    setReload((n) => n + 1);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-on-surface">Organizações</h1>
        {isOwner && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-zela-md bg-primary px-4 py-2 text-label font-bold text-white shadow-sm hover:bg-primary-container"
          >
            <Plus size={18} aria-hidden="true" />
            Nova organização
          </button>
        )}
      </div>
      {!isOwner && (
        <p className="text-small text-on-surface-variant">
          Seu papel (suporte da plataforma) é somente leitura.
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-error">
          {actionError}
        </p>
      )}
      {q.loading ? (
        <p>Carregando…</p>
      ) : q.error || !q.data ? (
        <p role="alert" className="text-error">
          {q.error ?? 'Sem dados.'}
        </p>
      ) : (
        <DataTable
          caption="Organizações cadastradas"
          headers={['Nome', 'Identificador', 'Status', 'Criada em', ...(isOwner ? ['Ações'] : [])]}
          empty="Nenhuma organização cadastrada."
          rows={q.data.map((t) => [
            t.name,
            t.slug,
            STATUS_LABEL[t.status] ?? t.status,
            new Date(t.created_at).toLocaleDateString('pt-BR'),
            ...(isOwner
              ? [
                  <button
                    key="a"
                    type="button"
                    onClick={() =>
                      void setStatus(t.id, t.status === 'active' ? 'suspended' : 'active')
                    }
                    className="rounded-zela-sm px-2 py-1 text-label text-primary hover:bg-surface-container"
                  >
                    {t.status === 'active' ? 'Suspender' : 'Reativar'}
                  </button>,
                ]
              : []),
          ])}
        />
      )}
      {creating && (
        <CreateTenantModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
