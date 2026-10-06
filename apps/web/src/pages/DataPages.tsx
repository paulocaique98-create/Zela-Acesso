import type { Permission } from '@zela/domain';
import type { ReactNode } from 'react';
import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useQuery';
import { useWorkspace } from '../workspace/WorkspaceProvider';

const ROLE_LABEL: Record<string, string> = {
  organization_owner: 'Proprietário',
  organization_admin: 'Administrador',
  security_manager: 'Gestor de segurança',
  receptionist: 'Recepção',
  hr_manager: 'RH',
  auditor: 'Auditor',
  installer: 'Instalador',
  viewer: 'Visualizador',
};

export const roleLabel = (role: string): string => ROLE_LABEL[role] ?? role;

function Guard({
  permission,
  siteLevel = false,
  children,
}: {
  permission: Permission;
  siteLevel?: boolean;
  children: ReactNode;
}) {
  const { allowed, allowedInAnyScope } = useWorkspace();
  if (!(siteLevel ? allowedInAnyScope(permission) : allowed(permission))) {
    return <p role="status">Você não tem permissão para ver esta página.</p>;
  }
  return <>{children}</>;
}

function Status<T>({
  q,
  children,
}: {
  q: { data: T | null; error: string | null; loading: boolean };
  children: (d: T) => ReactNode;
}) {
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

export function SitesPage() {
  const { current } = useWorkspace();
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('sites')
      .select('id, name, timezone')
      .eq('tenant_id', current?.id ?? '')
      .order('name')
      .limit(200);
    if (error) throw error;
    return data;
  }, [current?.id]);
  return (
    <Guard permission="site:read" siteLevel>
      <Status q={q}>
        {(rows) => (
          <DataTable
            caption="Locais"
            headers={['Nome', 'Fuso horário']}
            rows={rows.map((r) => [r.name, r.timezone])}
            empty="Nenhum local cadastrado."
          />
        )}
      </Status>
    </Guard>
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
