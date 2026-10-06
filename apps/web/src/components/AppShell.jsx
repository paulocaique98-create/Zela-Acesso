import { Navigate, Outlet } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  CalendarDays,
  Code2,
  DoorOpen,
  Landmark,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { LoadingLogo } from './LoadingLogo';
import { PasswordGate } from './PasswordGate';
import { ShellFrame } from './ShellFrame';

// siteLevel: recurso por site, visivel a quem tem a permissao em qualquer escopo (RLS filtra as linhas).
/** @type {{ to: string, label: string, icon: import('react').ElementType, permission: import('@zela/domain').Permission | null, siteLevel?: boolean }[]} */
const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, permission: null },
  { to: '/sites', label: 'Locais', icon: Building2, permission: 'site:read', siteLevel: true },
  {
    to: '/predios',
    label: 'Prédios e andares',
    icon: Landmark,
    permission: 'zone:read',
    siteLevel: true,
  },
  { to: '/zonas', label: 'Zonas', icon: Layers, permission: 'zone:read', siteLevel: true },
  {
    to: '/pontos',
    label: 'Pontos de acesso',
    icon: DoorOpen,
    permission: 'access_point:read',
    siteLevel: true,
  },
  { to: '/pessoas', label: 'Pessoas', icon: UserRound, permission: 'person:read' },
  { to: '/grupos', label: 'Grupos', icon: UsersRound, permission: 'group:read' },
  {
    to: '/politicas',
    label: 'Políticas de acesso',
    icon: ShieldCheck,
    permission: 'policy:read',
    siteLevel: true,
  },
  { to: '/janelas', label: 'Janelas de acesso', icon: CalendarClock, permission: 'schedule:read' },
  { to: '/feriados', label: 'Feriados', icon: CalendarDays, permission: 'schedule:read' },
  { to: '/membros', label: 'Membros', icon: Users, permission: 'member:read' },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText, permission: 'audit:read' },
  { to: '/suporte', label: 'Suporte', icon: LifeBuoy, permission: 'support:read' },
];

export function AppShell() {
  const { session, loading } = useAuth();
  const ws = useWorkspace();

  if (loading || ws.loading) return <LoadingLogo />;
  if (!session) return <Navigate to="/login" replace />;
  // Admin de plataforma sem organizacao: o lugar dele e o Painel do Desenvolvedor.
  if (!ws.error && !ws.current && ws.platformRole) return <Navigate to="/plataforma" replace />;

  const items = NAV.filter(
    (n) =>
      n.permission === null ||
      (n.siteLevel ? ws.allowedInAnyScope(n.permission) : ws.allowed(n.permission)),
  );
  if (ws.platformRole) {
    items.push({ to: '/plataforma', label: 'Painel do Desenvolvedor', icon: Code2 });
  }

  const tenantPicker =
    ws.tenants.length > 0 ? (
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="tenant" className="hidden text-caption text-on-surface-variant sm:block">
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
    ) : null;

  return (
    <PasswordGate>
      <ShellFrame title={BRAND.productName} items={items} headerCenter={tenantPicker}>
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
      </ShellFrame>
    </PasswordGate>
  );
}
