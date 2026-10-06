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
];
/** @typedef {'organization_owner' | 'organization_admin' | 'security_manager' | 'receptionist' | 'hr_manager' | 'auditor' | 'installer' | 'viewer'} TenantRole */

export const PLATFORM_ROLES = ['platform_owner', 'platform_support'];
/** @typedef {'platform_owner' | 'platform_support'} PlatformRole */

/** @typedef {'tenant:update' | 'member:read' | 'member:invite' | 'member:update_role' | 'member:remove' | 'site:read' | 'site:create' | 'site:update' | 'site:delete' | 'audit:read'} Permission */

/** @type {Readonly<Record<TenantRole, readonly Permission[]>>} */
export const ROLE_PERMISSIONS = {
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
/** @param {TenantRole} role @returns {1 | 2 | 3} */
export function roleRank(role) {
  if (role === 'organization_owner') return 3;
  if (role === 'organization_admin') return 2;
  return 1;
}

/**
 * `scopeSiteIds`: null = tenant inteiro; array nunca vazio.
 * @typedef {{ tenantId: string, role: TenantRole, status: 'active' | 'suspended', scopeSiteIds: readonly string[] | null }} MembershipView
 */

/** @param {TenantRole} role @param {Permission} permission */
export function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Mesma semantica de app_private.has_permission: sem siteId (operacao de nivel tenant)
 * exige escopo tenant-inteiro; com siteId aceita escopo tenant-inteiro ou que contenha o site.
 * Nao considera status do tenant (o servidor considera).
 * @param {readonly MembershipView[]} memberships
 * @param {string} tenantId
 * @param {Permission} permission
 * @param {string} [siteId]
 * @returns {boolean}
 */
export function can(memberships, tenantId, permission, siteId) {
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
 * @param {readonly MembershipView[]} memberships
 * @param {string} tenantId
 * @param {Permission} permission
 * @returns {boolean}
 */
export function canInAnyScope(memberships, tenantId, permission) {
  return memberships.some(
    (m) =>
      m.tenantId === tenantId && m.status === 'active' && roleHasPermission(m.role, permission),
  );
}

/** Pode o ator atribuir/alterar `target`? Espelha app_private.guard_membership (sem autoalteracao).
 * @param {TenantRole} actor @param {TenantRole} target
 */
export function canManageRole(actor, target) {
  const actorRank = roleRank(actor);
  return actorRank === 3 || roleRank(target) < actorRank;
}
