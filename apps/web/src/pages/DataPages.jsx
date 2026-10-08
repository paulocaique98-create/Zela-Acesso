import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useQuery';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { MfaSettingsCard } from '../auth/MfaGate';

/** @type {Record<string, string>} */
const ROLE_LABEL = {
  organization_owner: 'Proprietário',
  organization_admin: 'Administrador',
  security_manager: 'Gestor de segurança',
  receptionist: 'Recepção',
  hr_manager: 'RH',
  auditor: 'Auditor',
  installer: 'Instalador',
  viewer: 'Visualizador',
};

/** @param {string} role */
export const roleLabel = (role) => ROLE_LABEL[role] ?? role;

/**
 * @param {{ permission: import('@zela/domain').Permission, siteLevel?: boolean, children: import('react').ReactNode }} props
 */
export function Guard({ permission, siteLevel = false, children }) {
  const { allowed, allowedInAnyScope } = useWorkspace();
  if (!(siteLevel ? allowedInAnyScope(permission) : allowed(permission))) {
    return <p role="status">Você não tem permissão para ver esta página.</p>;
  }
  return <>{children}</>;
}

/**
 * @template T
 * @param {{ q: import('../lib/useQuery').QueryState<T>, children: (d: T) => import('react').ReactNode }} props
 */
export function Status({ q, children }) {
  if (q.loading) return <p>Carregando…</p>;
  if (q.error || !q.data)
    return (
      <p role="alert" style={{ color: 'var(--danger)' }}>
        {q.error ?? 'Sem dados.'}
      </p>
    );
  return <>{children(q.data)}</>;
}

export function OverviewPage() {
  const { current, memberships } = useWorkspace();
  const mine = memberships.filter((m) => m.tenantId === current?.id);
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">{current?.name}</h1>
      <p style={{ color: 'var(--muted)' }}>
        Seu papel: {mine.map((m) => roleLabel(m.role)).join(', ') || '—'}
        {mine.some((m) => m.scopeSiteIds) ? ' (acesso restrito a locais específicos)' : ''}
      </p>
    </section>
  );
}

export function MembersPage() {
  const { current } = useWorkspace();
  const q = useQuery(async () => {
    const { data: members, error } = await supabase
      .from('memberships')
      .select('id, user_id, role, status, scope_site_ids')
      .eq('tenant_id', current?.id ?? '')
      .order('created_at')
      .limit(200);
    if (error) throw error;
    const ids = members.map((m) => m.user_id);
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', ids);
    if (pErr) throw pErr;
    const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
    return members.map((m) => ({ ...m, name: names.get(m.user_id) ?? 'Usuário' }));
  }, [current?.id]);
  return (
    <Guard permission="member:read">
      <MfaSettingsCard />
      <Status q={q}>
        {(rows) => (
          <DataTable
            caption="Membros"
            headers={['Nome', 'Papel', 'Situação', 'Escopo']}
            rows={rows.map((r) => [
              r.name,
              roleLabel(r.role),
              r.status === 'active' ? 'Ativo' : 'Suspenso',
              r.scope_site_ids ? `${r.scope_site_ids.length} local(is)` : 'Organização inteira',
            ])}
            empty="Nenhum membro."
          />
        )}
      </Status>
    </Guard>
  );
}

export function AuditPage() {
  const { current } = useWorkspace();
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, action, resource_type, created_at')
      .eq('tenant_id', current?.id ?? '')
      .order('id', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  }, [current?.id]);
  return (
    <Guard permission="audit:read">
      <Status q={q}>
        {(rows) => (
          <DataTable
            caption="Auditoria (últimos 100 registros)"
            headers={['Quando', 'Ação', 'Recurso']}
            rows={rows.map((r) => [
              new Date(r.created_at).toLocaleString('pt-BR'),
              r.action,
              r.resource_type,
            ])}
            empty="Sem registros."
          />
        )}
      </Status>
    </Guard>
  );
}
