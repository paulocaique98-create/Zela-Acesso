import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  Code2,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  ShieldCheck,
  Siren,
  UsersRound,
} from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { LoadingLogo } from './LoadingLogo';
import { PasswordGate } from './PasswordGate';
import { ShellFrame } from './ShellFrame';

// siteLevel: recurso por site, visivel a quem tem a permissao em qualquer escopo (RLS filtra as linhas).
// Menu = assunto; submenus so do mesmo assunto. Grupo sem submenu visivel some; com um so vira item direto.
/** @typedef {{ to: string, label: string, permission: import('@zela/domain').Permission | null, siteLevel?: boolean }} NavLeaf */
/** @type {({ label: string, icon: import('react').ElementType, children: NavLeaf[] } | (NavLeaf & { icon: import('react').ElementType }))[]} */
const NAV = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, permission: null },
  {
    label: 'Cadastro',
    icon: Building2,
    children: [
      { to: '/cadastro/locais', label: 'Cadastrar local', permission: 'site:create' },
      { to: '/cadastro/predios', label: 'Cadastrar prédio ou andar', permission: 'zone:create' },
      { to: '/cadastro/zonas', label: 'Cadastrar zona', permission: 'zone:create' },
      {
        to: '/cadastro/pontos',
        label: 'Cadastrar ponto de acesso',
        permission: 'access_point:create',
        siteLevel: true,
      },
      {
        to: '/cadastro/leitores',
        label: 'Cadastrar leitor',
        permission: 'reader:create',
        siteLevel: true,
      },
      { to: '/cadastro/pessoas', label: 'Cadastrar pessoa', permission: 'person:create' },
      { to: '/cadastro/grupos', label: 'Cadastrar grupo', permission: 'group:create' },
      { to: '/cadastro/biometria', label: 'Cadastrar biometria', permission: 'biometric:read' },
    ],
  },
  {
    label: 'Gerenciar',
    icon: UsersRound,
    children: [
      { to: '/gerenciar/locais', label: 'Locais', permission: 'site:read', siteLevel: true },
      {
        to: '/gerenciar/predios',
        label: 'Prédios e andares',
        permission: 'zone:read',
        siteLevel: true,
      },
      { to: '/gerenciar/zonas', label: 'Zonas', permission: 'zone:read', siteLevel: true },
      {
        to: '/gerenciar/pontos',
        label: 'Pontos de acesso',
        permission: 'access_point:read',
        siteLevel: true,
      },
      {
        to: '/gerenciar/leitores',
        label: 'Leitores Zela Pass',
        permission: 'reader:read',
        siteLevel: true,
      },
      { to: '/gerenciar/pessoas', label: 'Pessoas', permission: 'person:read' },
      { to: '/gerenciar/grupos', label: 'Grupos', permission: 'group:read' },
    ],
  },
  {
    label: 'Regras de acesso',
    icon: ShieldCheck,
    children: [
      {
        to: '/politicas',
        label: 'Políticas de acesso',
        permission: 'policy:read',
        siteLevel: true,
      },
      { to: '/janelas', label: 'Janelas de acesso', permission: 'schedule:read' },
      { to: '/feriados', label: 'Feriados', permission: 'schedule:read' },
    ],
  },
  {
    label: 'Portaria e operação',
    icon: Siren,
    children: [
      {
        to: '/operacao',
        label: 'Alertas e ocorrências',
        permission: 'alert:read',
        siteLevel: true,
      },
      { to: '/visitantes', label: 'Visitantes', permission: 'visit:read', siteLevel: true },
    ],
  },
  {
    label: 'Administração',
    icon: Settings,
    children: [
      { to: '/membros', label: 'Membros e papéis', permission: 'member:read' },
      { to: '/auditoria', label: 'Auditoria', permission: 'audit:read' },
    ],
  },
  { to: '/suporte', label: 'Suporte', icon: LifeBuoy, permission: 'support:read' },
];

// Celular: icone + seta abre uma lista propria, presa a borda da tela (o <select> nativo abria fora da tela).
function MobileTenantMenu({ tenants, currentId, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label="Organização"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1 rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest px-2 text-on-surface-variant shadow-sm"
      >
        <Building2 size={18} aria-hidden="true" />
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Fechar lista de organizações"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            role="listbox"
            aria-label="Organização"
            className="fixed top-[56px] right-4 z-50 max-h-[60vh] w-max max-w-[calc(100vw-2rem)] overflow-y-auto rounded-zela-md border border-outline-variant bg-surface-container-low p-1 shadow-lg"
          >
            {tenants.map((t) => (
              <li key={t.id} role="option" aria-selected={t.id === currentId}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(t.id);
                    setOpen(false);
                  }}
                  className={`block w-full rounded-zela-sm px-3 py-2 text-left text-sm break-words ${
                    t.id === currentId
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function AppShell() {
  const { session, loading } = useAuth();
  const ws = useWorkspace();

  if (loading || ws.loading) return <LoadingLogo />;
  if (!session) return <Navigate to="/login" replace />;
  // Admin de plataforma sem organizacao: o lugar dele e o Painel do Desenvolvedor.
  if (!ws.error && !ws.current && ws.platformRole) return <Navigate to="/plataforma" replace />;

  const can = (n) =>
    n.permission === null ||
    (n.siteLevel ? ws.allowedInAnyScope(n.permission) : ws.allowed(n.permission));
  const items = NAV.flatMap((n) => {
    if (!n.children) return can(n) ? [n] : [];
    const kids = n.children.filter(can);
    if (kids.length === 0) return [];
    if (kids.length === 1) return [{ ...kids[0], icon: n.icon }];
    return [{ label: n.label, icon: n.icon, children: kids }];
  });
  if (ws.platformRole) {
    items.push({ to: '/plataforma', label: 'Painel do Desenvolvedor', icon: Code2 });
  }

  const tenantPicker =
    ws.tenants.length > 0 ? (
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="tenant" className="hidden text-caption text-on-surface-variant sm:block">
          Organização
        </label>
        <MobileTenantMenu
          tenants={ws.tenants}
          currentId={ws.current?.id}
          onSelect={ws.selectTenant}
        />
        <select
          id="tenant"
          aria-label="Organização"
          value={ws.current?.id ?? ''}
          onChange={(e) => ws.selectTenant(e.target.value)}
          className="hidden max-w-[40vw] rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-1.5 text-label text-on-surface shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 sm:block"
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
