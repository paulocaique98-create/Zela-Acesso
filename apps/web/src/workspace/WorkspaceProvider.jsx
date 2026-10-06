import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { can, canInAnyScope } from '@zela/domain';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

/**
 * @typedef {{ id: string, name: string, slug: string }} WorkspaceTenant
 * @typedef {import('@zela/domain').MembershipView} MembershipView
 * @typedef {import('@zela/domain').Permission} Permission
 * @typedef {{
 *   loading: boolean,
 *   error: string | null,
 *   tenants: WorkspaceTenant[],
 *   memberships: MembershipView[],
 *   current: WorkspaceTenant | null,
 *   selectTenant: (tenantId: string) => void,
 *   allowed: (permission: Permission, siteId?: string) => boolean,
 *   allowedInAnyScope: (permission: Permission) => boolean,
 * }} WorkspaceState
 * `allowed` e apenas para UI (o enforcement real e RLS no banco); `allowedInAnyScope` vale para
 * recursos por site: visivel se a permissao existe em algum escopo (linhas filtradas por RLS).
 */

/** @type {import('react').Context<WorkspaceState | null>} */
const Ctx = createContext(null);
const STORAGE_KEY = 'zela.currentTenant';

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [currentId, setCurrentId] = useState(readStored());

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
      const seen = new Map();
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

  const selectTenant = useCallback((tenantId) => {
    setCurrentId(tenantId);
    try {
      localStorage.setItem(STORAGE_KEY, tenantId);
    } catch {
      /* armazenamento indisponivel: a escolha vale so nesta sessao */
    }
  }, []);

  const value = useMemo(
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

/** @returns {WorkspaceState} */
export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace fora de WorkspaceProvider');
  return ctx;
}
