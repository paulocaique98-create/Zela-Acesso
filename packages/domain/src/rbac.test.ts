import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  can,
  canInAnyScope,
  canManageRole,
  roleHasPermission,
  type MembershipView,
} from './rbac';

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const S1 = 'site-1';
const S2 = 'site-2';

const m = (over: Partial<MembershipView> = {}): MembershipView => ({
  tenantId: T1,
  role: 'viewer',
  status: 'active',
  scopeSiteIds: null,
  ...over,
});

describe('matriz de permissoes', () => {
  it('toda role tem ao menos site:read', () => {
    for (const role of TENANT_ROLES) expect(roleHasPermission(role, 'site:read')).toBe(true);
  });

  it('somente organization_owner altera o tenant', () => {
    const withUpdate = TENANT_ROLES.filter((r) => roleHasPermission(r, 'tenant:update'));
    expect(withUpdate).toEqual(['organization_owner']);
  });

  it('somente owner/admin gerenciam membros', () => {
    for (const p of ['member:invite', 'member:update_role', 'member:remove'] as const) {
      const roles = TENANT_ROLES.filter((r) => roleHasPermission(r, p));
      expect(roles).toEqual(['organization_owner', 'organization_admin']);
    }
  });

  it('total de permissoes bate com o banco (33)', () => {
    const total = Object.values(ROLE_PERMISSIONS).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(33);
  });

  it('nao ha permissoes duplicadas por role', () => {
    for (const role of TENANT_ROLES) {
      expect(new Set(ROLE_PERMISSIONS[role]).size).toBe(ROLE_PERMISSIONS[role].length);
    }
  });
});

describe('can()', () => {
  it('nega sem memberships', () => {
    expect(can([], T1, 'site:read')).toBe(false);
  });

  it('nega em outro tenant', () => {
    expect(can([m({ role: 'organization_owner' })], T2, 'site:read')).toBe(false);
  });

  it('nega membership suspensa', () => {
    expect(can([m({ role: 'organization_owner', status: 'suspended' })], T1, 'site:read')).toBe(
      false,
    );
  });

  it('nega permissao que o papel nao tem', () => {
    expect(can([m({ role: 'viewer' })], T1, 'site:create')).toBe(false);
  });

  it('escopo tenant-inteiro vale para qualquer site e para operacao de tenant', () => {
    const list = [m({ role: 'security_manager' })];
    expect(can(list, T1, 'site:update', S1)).toBe(true);
    expect(can(list, T1, 'site:update', S2)).toBe(true);
    expect(can(list, T1, 'audit:read')).toBe(true);
  });

  it('escopo por site: vale so no site listado', () => {
    const list = [m({ role: 'installer', scopeSiteIds: [S1] })];
    expect(can(list, T1, 'site:update', S1)).toBe(true);
    expect(can(list, T1, 'site:update', S2)).toBe(false);
  });

  it('escopo por site: nao vale para operacao de nivel tenant (sem siteId)', () => {
    const list = [m({ role: 'organization_admin', scopeSiteIds: [S1] })];
    expect(can(list, T1, 'member:invite')).toBe(false);
    expect(can(list, T1, 'audit:read')).toBe(false);
  });

  it('propriedade: escopo nunca concede permissao que o papel nao tem', () => {
    for (const role of TENANT_ROLES) {
      for (const scope of [null, [S1]] as const) {
        const list = [m({ role, scopeSiteIds: scope })];
        for (const p of ['tenant:update', 'site:delete', 'member:remove'] as const) {
          if (!roleHasPermission(role, p)) expect(can(list, T1, p, S1)).toBe(false);
        }
      }
    }
  });
});

describe('canInAnyScope()', () => {
  it('usuario com escopo por site enxerga o recurso de site na UI', () => {
    const list = [m({ role: 'viewer', scopeSiteIds: [S1] })];
    expect(canInAnyScope(list, T1, 'site:read')).toBe(true);
    expect(can(list, T1, 'site:read')).toBe(false);
  });
  it('nao concede permissao que o papel nao tem', () => {
    expect(canInAnyScope([m({ role: 'viewer', scopeSiteIds: [S1] })], T1, 'audit:read')).toBe(
      false,
    );
  });
  it('nao vale para outro tenant nem membership suspensa', () => {
    expect(canInAnyScope([m({ role: 'organization_owner' })], T2, 'site:read')).toBe(false);
    expect(
      canInAnyScope([m({ role: 'organization_owner', status: 'suspended' })], T1, 'site:read'),
    ).toBe(false);
  });
});

describe('canManageRole()', () => {
  it('owner gerencia qualquer papel', () => {
    for (const r of TENANT_ROLES) expect(canManageRole('organization_owner', r)).toBe(true);
  });

  it('admin so gerencia papeis de rank menor', () => {
    expect(canManageRole('organization_admin', 'organization_owner')).toBe(false);
    expect(canManageRole('organization_admin', 'organization_admin')).toBe(false);
    expect(canManageRole('organization_admin', 'security_manager')).toBe(true);
    expect(canManageRole('organization_admin', 'viewer')).toBe(true);
  });

  it('demais papeis nunca gerenciam outro papel', () => {
    const others = TENANT_ROLES.filter(
      (r) => r !== 'organization_owner' && r !== 'organization_admin',
    );
    for (const a of others) {
      for (const t of TENANT_ROLES) expect(canManageRole(a, t)).toBe(false);
    }
  });
});
