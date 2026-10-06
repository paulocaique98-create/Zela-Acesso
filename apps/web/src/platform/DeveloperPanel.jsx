import { Navigate, Outlet } from 'react-router-dom';
import {
  Building2,
  Code2,
  FileText,
  LifeBuoy,
  Receipt,
  ScanFace,
  Settings,
  Tags,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { LoadingLogo } from '../components/LoadingLogo';
import { PasswordGate } from '../components/PasswordGate';
import { ShellFrame } from '../components/ShellFrame';
import { useSupportUnread } from '../hooks/useSupportUnread';
import { useWorkspace } from '../workspace/WorkspaceProvider';

/** Menus do Painel do Desenvolvedor. `ownerOnly`: dado comercial, so platform_owner (a RLS impoe; aqui so esconde). */
const ITEMS = [
  { to: '/plataforma', label: 'Gestão de Organizações', icon: Building2, end: true },
  { to: '/plataforma/planos', label: 'Planos', icon: Tags, ownerOnly: true },
  {
    to: '/plataforma/faturamento',
    label: 'Faturamento',
    icon: Receipt,
    ownerOnly: true,
    disabled: true,
  },
  { to: '/plataforma/logs', label: 'Logs', icon: FileText },
  { to: '/plataforma/biometria', label: 'Biometria', icon: ScanFace },
  { to: '/plataforma/suporte', label: 'Suporte', icon: LifeBuoy },
  { to: '/plataforma/configuracoes', label: 'Configurações', icon: Settings },
];

/** Rota so para platform_owner (ex.: Planos): o suporte da plataforma volta para a lista de organizacoes. */
export function OwnerOnly({ children }) {
  const { platformRole } = useWorkspace();
  return platformRole === 'platform_owner' ? children : <Navigate to="/plataforma" replace />;
}

/**
 * Painel do Desenvolvedor (plataforma). O acesso real e imposto pelo banco (RLS e RPC por papel de
 * plataforma); esta guarda apenas evita mostrar a tela a quem nao e admin de plataforma.
 */
export function DeveloperPanel() {
  const { session, loading } = useAuth();
  const ws = useWorkspace();
  const unread = useSupportUnread(!!ws.platformRole);

  if (loading || ws.loading) return <LoadingLogo />;
  if (!session) return <Navigate to="/login" replace />;
  if (!ws.platformRole) return <Navigate to="/" replace />;

  const isOwner = ws.platformRole === 'platform_owner';
  const items = ITEMS.filter((i) => isOwner || !i.ownerOnly).map((i) =>
    i.to === '/plataforma/suporte' ? { ...i, badge: unread.count } : i,
  );
  if (ws.current) items.push({ to: '/', label: 'Voltar ao app', icon: Code2 });

  return (
    <PasswordGate>
      <ShellFrame title="Zela Acesso" subtitle="Painel do Desenvolvedor" items={items}>
        <Outlet />
      </ShellFrame>
    </PasswordGate>
  );
}
