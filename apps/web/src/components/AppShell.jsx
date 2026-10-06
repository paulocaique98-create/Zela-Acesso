import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import {
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSidebarExpanded } from '../hooks/useSidebarExpanded';
import { LoadingLogo } from './LoadingLogo';
import { SidebarItem, SidebarToggleButton } from './SidebarNav';

// siteLevel: recurso por site, visivel a quem tem a permissao em qualquer escopo (RLS filtra as linhas).
/** @type {{ to: string, label: string, icon: import('react').ElementType, permission: import('@zela/domain').Permission | null, siteLevel?: boolean }[]} */
const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, permission: null },
  { to: '/sites', label: 'Locais', icon: Building2, permission: 'site:read', siteLevel: true },
  { to: '/membros', label: 'Membros', icon: Users, permission: 'member:read' },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText, permission: 'audit:read' },
];

export function AppShell() {
  const { session, loading, signOut } = useAuth();
  const ws = useWorkspace();
  const [isExpanded, toggleExpanded] = useSidebarExpanded();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading || ws.loading) return <LoadingLogo />;
  if (!session) return <Navigate to="/login" replace />;

  const items = NAV.filter(
    (n) =>
      n.permission === null ||
      (n.siteLevel ? ws.allowedInAnyScope(n.permission) : ws.allowed(n.permission)),
  );

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-40 flex h-[60px] items-center justify-between gap-2 border-b border-transparent bg-surface-container-low px-4 md:h-16 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            className="-ml-1 shrink-0 rounded-zela-sm p-1.5 text-primary transition hover:bg-surface-container active:scale-95 md:hidden"
          >
            <Menu size={24} />
          </button>
          <div
            className={`hidden shrink-0 items-center transition-[margin] duration-300 md:flex ${isExpanded ? 'md:ml-0.5' : 'md:-ml-2.5'}`}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-zela-md bg-primary">
              <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
          </div>
          <h1 className="flex min-w-0 items-center gap-1.5 text-lg leading-none font-bold tracking-tight whitespace-nowrap text-on-surface">
            {BRAND.productName}
          </h1>
        </div>

        {ws.tenants.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <label
              htmlFor="tenant"
              className="hidden text-caption text-on-surface-variant sm:block"
            >
              Organização
            </label>
            <select
              id="tenant"
              value={ws.current?.id ?? ''}
              onChange={(e) => ws.selectTenant(e.target.value)}
              className="max-w-[40vw] rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-1.5 text-label text-on-surface shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              {ws.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-1 items-center justify-end">
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sair"
            title="Sair do sistema"
            className="flex items-center justify-center rounded-zela-sm p-2 text-on-surface-variant transition hover:bg-red-50 hover:text-error active:scale-95"
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex">
        <aside
          data-expanded={isExpanded}
          className={`group/side fixed top-[60px] left-0 z-20 h-[calc(100dvh-60px)] w-72 shrink-0 border-r border-outline-variant bg-surface-container-low transition-all duration-300 ease-in-out md:sticky md:top-16 md:z-30 md:h-[calc(100dvh-4rem)] md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${isExpanded ? 'md:w-[280px]' : 'md:w-16'}`}
        >
          <nav
            aria-label="Principal"
            className="h-full overflow-x-hidden overflow-y-auto px-3 py-4 md:px-[14px]"
          >
            <ul className="flex flex-col gap-1">
              {items.map((n) => (
                <li key={n.to}>
                  <SidebarItem
                    to={n.to}
                    end={n.to === '/'}
                    icon={n.icon}
                    label={n.label}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </li>
              ))}
            </ul>
          </nav>
          <SidebarToggleButton isExpanded={isExpanded} onToggle={toggleExpanded} />
        </aside>

        <main className="min-w-0 flex-1 border-t border-outline-variant/60 p-4 md:p-6">
          {ws.error && (
            <p role="alert" className="text-error">
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
