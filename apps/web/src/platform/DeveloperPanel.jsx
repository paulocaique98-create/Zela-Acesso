import { Navigate, Outlet } from 'react-router-dom';
import { Building2, Code2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { LoadingLogo } from '../components/LoadingLogo';
import { ShellFrame } from '../components/ShellFrame';
import { useWorkspace } from '../workspace/WorkspaceProvider';

const ITEMS = [{ to: '/plataforma', label: 'Organizações', icon: Building2, end: true }];

/**
 * Painel do Desenvolvedor (plataforma). O acesso real e imposto pelo banco (RLS e RPC por papel de
 * plataforma); esta guarda apenas evita mostrar a tela a quem nao e admin de plataforma.
 */
export function DeveloperPanel() {
  const { session, loading } = useAuth();
  const ws = useWorkspace();

  if (loading || ws.loading) return <LoadingLogo />;
  if (!session) return <Navigate to="/login" replace />;
  if (!ws.platformRole) return <Navigate to="/" replace />;

  const items = ws.current ? [...ITEMS, { to: '/', label: 'Voltar ao app', icon: Code2 }] : ITEMS;

  return (
    <ShellFrame title="Zela Acesso" subtitle="Painel do Desenvolvedor" items={items}>
      <Outlet />
    </ShellFrame>
  );
}
