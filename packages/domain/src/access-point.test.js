import { describe, expect, it } from 'vitest';
import {
  ACCESS_POINT_DIRECTIONS,
  ACCESS_POINT_DIRECTION_LABEL,
  ACCESS_POINT_TYPES,
  ACCESS_POINT_TYPE_LABEL,
  EMERGENCY_BEHAVIORS,
  EMERGENCY_BEHAVIOR_LABEL,
  OFFLINE_BEHAVIORS,
  OFFLINE_BEHAVIOR_LABEL,
  accessPointWarnings,
  validateDoorOpenTimeout,
} from './access-point.js';

describe('rótulos', () => {
  it('todo valor de enum tem rótulo', () => {
    for (const t of ACCESS_POINT_TYPES) expect(ACCESS_POINT_TYPE_LABEL[t]).toBeTruthy();
    for (const d of ACCESS_POINT_DIRECTIONS) expect(ACCESS_POINT_DIRECTION_LABEL[d]).toBeTruthy();
    for (const e of EMERGENCY_BEHAVIORS) expect(EMERGENCY_BEHAVIOR_LABEL[e]).toBeTruthy();
    for (const o of OFFLINE_BEHAVIORS) expect(OFFLINE_BEHAVIOR_LABEL[o]).toBeTruthy();
  });
});

describe('validateDoorOpenTimeout', () => {
  it('aceita 1..3600', () => {
    expect(validateDoorOpenTimeout(1)).toBeNull();
    expect(validateDoorOpenTimeout(30)).toBeNull();
    expect(validateDoorOpenTimeout(3600)).toBeNull();
  });
  it('recusa fora da faixa, fracionário e não numérico', () => {
    expect(validateDoorOpenTimeout(0)).toMatch(/1 a 3600/);
    expect(validateDoorOpenTimeout(3601)).not.toBeNull();
    expect(validateDoorOpenTimeout(1.5)).not.toBeNull();
    expect(validateDoorOpenTimeout(Number.NaN)).not.toBeNull();
  });
});

describe('accessPointWarnings', () => {
  const base = {
    emergency_behavior: 'fail_safe',
    offline_behavior: 'degraded_deny',
    direction: 'entry',
  };
  it('sem aviso nos padrões seguros', () => {
    expect(accessPointWarnings(base)).toEqual([]);
  });
  it('avisa fail-secure e degraded_allow', () => {
    expect(accessPointWarnings({ ...base, emergency_behavior: 'fail_secure' })).toHaveLength(1);
    expect(accessPointWarnings({ ...base, offline_behavior: 'degraded_allow' })).toHaveLength(1);
    expect(
      accessPointWarnings({
        ...base,
        emergency_behavior: 'fail_secure',
        offline_behavior: 'degraded_allow',
      }),
    ).toHaveLength(2);
  });
});
