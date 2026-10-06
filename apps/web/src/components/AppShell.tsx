import { NavLink, Navigate, Outlet } from 'react-router-dom';
import type { Permission } from '@zela/domain';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';

// siteLevel: recurso por site, visivel a quem tem a permissao em qualquer escopo (RLS filtra as linhas).
const NAV: { to: string; label: string; permission: Permission | null; siteLevel?: boolean }[] = [
  { to: '/', label: 'Visão geral', permission: null },
  { to: '/sites', label: 'Locais', permission: 'site:read', siteLevel: true },
  { to: '/membros', label: 'Membros', permission: 'member:read' },
  { to: '/auditoria', label: 'Auditoria', permission: 'audit:read' },
];

export function AppShell() {
  const { session, loading, signOut } = useAuth();
  const ws = useWorkspace();

  if (loading || ws.loading) return <p className="p-6">Carregando…</p>;
  if (!session) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen">
      <header
        className="flex flex-wrap items-center gap-3 border-b px-4 py-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <strong>{BRAND.productName}</strong>
        {ws.tenants.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="tenant" className="text-sm" style={{ color: 'var(--muted)' }}>
              Organização
            </label>
            <select
              id="tenant"
              value={ws.current?.id ?? ''}
              onChange={(e) => ws.selectTenant(e.target.value)}
              className="rounded border px-2 py-1"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              {ws.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-auto rounded border px-3 py-1 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          Sair
        </button>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:flex-row">
        <nav aria-label="Principal" className="md:w-48">
          <ul className="flex gap-2 md:flex-col">
            {NAV.filter(
              (n) =>
                n.permission === null ||
                (n.siteLevel ? ws.allowedInAnyScope(n.permission) : ws.allowed(n.permission)),
            ).map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  className="block rounded px-3 py-2 text-sm"
                  style={({ isActive }) => ({
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'inherit',
                  })}
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          {ws.error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {ws.error}
            </p>
          )}
          {!ws.error && !ws.current ? (
            <p>Você ainda não pertence a nenhuma organização. Peça um convite ao administrador.</p>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
