// RBAC por recurso + acao + escopo. Espelha a tabela public.role_permissions e a funcao
// app_private.has_permission do banco. O banco e a fonte de verdade de enforcement (RLS);
// este modulo serve a UI (esconder/mostrar) e aos testes. scripts/check-rbac-drift.mjs detecta divergencia.

export const TENANT_ROLES = [
  'organization_owner',
  'organization_admin',
  'security_manager',
  'receptionist',
  'hr_manager',
  'auditor',
  'installer',
  'viewer',
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PLATFORM_ROLES = ['platform_owner', 'platform_support'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type Permission =
  | 'tenant:update'
  | 'member:read'
  | 'member:invite'
  | 'member:update_role'
  | 'member:remove'
  | 'site:read'
  | 'site:create'
  | 'site:update'
  | 'site:delete'
  | 'audit:read';

export const ROLE_PERMISSIONS: Readonly<Record<TenantRole, readonly Permission[]>> = {
  organization_owner: [
    'tenant:update',
    'member:read',
    'member:invite',
    'member:update_role',
    'member:remove',
    'site:read',
    'site:create',
    'site:update',
    'site:delete',
    'audit:read',
  ],
  organization_admin: [
    'member:read',
    'member:invite',
    'member:update_role',
    'member:remove',
    'site:read',
    'site:create',
    'site:update',
    'site:delete',
    'audit:read',
  ],
  security_manager: ['member:read', 'site:read', 'site:create', 'site:update', 'audit:read'],
  receptionist: ['site:read'],
  hr_manager: ['member:read', 'site:read'],
  auditor: ['member:read', 'site:read', 'audit:read'],
  installer: ['site:read', 'site:update'],
  viewer: ['site:read'],
};

/** Hierarquia: quem tem rank menor nao atribui nem altera papel de rank igual ou maior (exceto owner). */
export function roleRank(role: TenantRole): 1 | 2 | 3 {
  if (role === 'organization_owner') return 3;
  if (role === 'organization_admin') return 2;
  return 1;
}

export interface MembershipView {
  tenantId: string;
  role: TenantRole;
  status: 'active' | 'suspended';
  /** null = tenant inteiro. Array nunca vazio. */
  scopeSiteIds: readonly string[] | null;
}

export function roleHasPermission(role: TenantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Mesma semantica de app_private.has_permission: sem siteId (operacao de nivel tenant)
 * exige escopo tenant-inteiro; com siteId aceita escopo tenant-inteiro ou que contenha o site.
 * Nao considera status do tenant (o servidor considera).
 */
export function can(
  memberships: readonly MembershipView[],
  tenantId: string,
  permission: Permission,
  siteId?: string,
): boolean {
  return memberships.some(
    (m) =>
      m.tenantId === tenantId &&
      m.status === 'active' &&
      roleHasPermission(m.role, permission) &&
      (m.scopeSiteIds === null || (siteId !== undefined && m.scopeSiteIds.includes(siteId))),
  );
}

/**
 * Visibilidade na UI de recursos por site: o usuario tem a permissao em ALGUM escopo do tenant
 * (inclusive restrito a sites). Nao autoriza nada: as linhas efetivas sao filtradas por RLS.
 */
export function canInAnyScope(
  memberships: readonly MembershipView[],
  tenantId: string,
  permission: Permission,
): boolean {
  return memberships.some(
    (m) =>
      m.tenantId === tenantId && m.status === 'active' && roleHasPermission(m.role, permission),
  );
}

/** Pode o ator atribuir/alterar `target`? Espelha app_private.guard_membership (sem autoalteracao). */
export function canManageRole(actor: TenantRole, target: TenantRole): boolean {
  const actorRank = roleRank(actor);
  return actorRank === 3 || roleRank(target) < actorRank;
}
