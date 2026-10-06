import { describe, expect, it } from 'vitest';
import { evaluatePolicies } from './policy.js';

const base = {
  id: 'p1',
  groupId: 'g1',
  zoneId: 'z1',
  accessPointId: null,
  effect: 'allow',
  scheduleId: null,
  requireChallenge: false,
  status: 'active',
};
const run = (policies, over = {}) =>
  evaluatePolicies({
    policies,
    groupIds: ['g1'],
    zoneId: 'z1',
    accessPointId: 'a1',
    scheduleAllows: (id) => id === 'open',
    ...over,
  });

describe('evaluatePolicies', () => {
  it('nega por padrão sem política', () => {
    expect(run([])).toEqual({ decision: 'DENY', reason: 'ZONE_NOT_ALLOWED', policyId: null });
  });
  it('permite por política da zona', () => {
    expect(run([base])).toEqual({ decision: 'ALLOW', reason: 'POLICY_MATCH', policyId: 'p1' });
  });
  it('permite por política do ponto', () => {
    const r = run([{ ...base, zoneId: null, accessPointId: 'a1' }]);
    expect(r.decision).toBe('ALLOW');
  });
  it('ignora grupo que a pessoa não tem, outro ponto e política inativa', () => {
    expect(run([{ ...base, groupId: 'g2' }]).decision).toBe('DENY');
    expect(run([{ ...base, zoneId: null, accessPointId: 'a2' }]).decision).toBe('DENY');
    expect(run([{ ...base, status: 'inactive' }]).decision).toBe('DENY');
  });
  it('negar vence permitir', () => {
    const r = run([base, { ...base, id: 'p2', effect: 'deny' }]);
    expect(r).toEqual({ decision: 'DENY', reason: 'POLICY_DENY', policyId: 'p2' });
  });
  it('negar com janela fechada não vale; permitir segue', () => {
    const r = run([base, { ...base, id: 'p2', effect: 'deny', scheduleId: 'closed' }]);
    expect(r.decision).toBe('ALLOW');
  });
  it('permitir fora da janela nega com OUTSIDE_SCHEDULE', () => {
    const r = run([{ ...base, scheduleId: 'closed' }]);
    expect(r).toEqual({ decision: 'DENY', reason: 'OUTSIDE_SCHEDULE', policyId: 'p1' });
    expect(run([{ ...base, scheduleId: 'open' }]).decision).toBe('ALLOW');
  });
  it('exige desafio, mas uma permissão sem desafio prevalece', () => {
    const ch = { ...base, requireChallenge: true };
    expect(run([ch])).toEqual({
      decision: 'CHALLENGE',
      reason: 'MULTI_FACTOR_REQUIRED',
      policyId: 'p1',
    });
    expect(run([ch, { ...base, id: 'p2' }]).decision).toBe('ALLOW');
  });
});
