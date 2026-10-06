import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { can, canInAnyScope, type MembershipView, type Permission } from '@zela/domain';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

export interface WorkspaceTenant {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceState {
  loading: boolean;
  error: string | null;
  tenants: WorkspaceTenant[];
  memberships: MembershipView[];
  current: WorkspaceTenant | null;
  selectTenant: (tenantId: string) => void;
  /** Apenas para UI. O enforcement real e RLS no banco. */
  allowed: (permission: Permission, siteId?: string) => boolean;
  /** Recursos por site: visivel se a permissao existe em algum escopo (linhas filtradas por RLS). */
  allowedInAnyScope: (permission: Permission) => boolean;
}

const Ctx = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'zela.currentTenant';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<WorkspaceTenant[]>([]);
  const [memberships, setMemberships] = useState<MembershipView[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(readStored());

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      const { data, error: err } = await supabase
        .from('memberships')
        .select('tenant_id, role, status, scope_site_ids, tenants ( id, name, slug )')
        .eq('user_id', userId);
      if (!active) return;
      if (err) {
        setError('Não foi possível carregar seus espaços de trabalho.');
        setLoading(false);
        return;
      }
      const rows = data ?? [];
      setMemberships(
        rows.map((r) => ({
          tenantId: r.tenant_id,
          role: r.role,
          status: r.status,
          scopeSiteIds: r.scope_site_ids,
        })),
      );
      const seen = new Map<string, WorkspaceTenant>();
      for (const r of rows) if (r.tenants) seen.set(r.tenants.id, r.tenants);
      setTenants([...seen.values()]);
      setError(null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const current = useMemo(
    () => tenants.find((t) => t.id === currentId) ?? tenants[0] ?? null,
    [tenants, currentId],
  );

  const selectTenant = useCallback((tenantId: string) => {
    setCurrentId(tenantId);
    try {
      localStorage.setItem(STORAGE_KEY, tenantId);
    } catch {
      /* armazenamento indisponivel: a escolha vale so nesta sessao */
    }
  }, []);

  const value = useMemo<WorkspaceState>(
    () => ({
      loading: userId ? loading : false,
      error,
      tenants,
      memberships,
      current,
      selectTenant,
      allowed: (permission, siteId) =>
        current ? can(memberships, current.id, permission, siteId) : false,
      allowedInAnyScope: (permission) =>
        current ? canInAnyScope(memberships, current.id, permission) : false,
    }),
    [userId, loading, error, tenants, memberships, current, selectTenant],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace fora de WorkspaceProvider');
  return ctx;
}
