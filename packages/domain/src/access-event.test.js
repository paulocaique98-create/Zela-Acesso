import { describe, expect, it } from 'vitest';
import { toAccessEventParams, toPhysicalOutcomeParams } from './access-event.js';
import { evaluateAccess } from './access-engine.js';

const decision = {
  decision: 'ALLOW',
  reasonCode: 'POLICY_MATCH',
  policyId: 'pol1',
  evidence: {
    personId: 'p1',
    credentialId: 'c1',
    accessPointId: 'ap1',
    zoneId: 'z1',
    policyId: 'pol1',
    scheduleId: 'biz',
    deviceTrusted: true,
    antiPassback: 'OK',
    offline: false,
    evaluatedAt: '2026-10-07T15:00:00.000Z',
    steps: ['a', 'b'],
  },
};
const base = {
  decision,
  tenantId: 't1',
  siteId: 's1',
  occurredAt: new Date('2026-10-07T15:00:00Z'),
};

describe('toAccessEventParams', () => {
  it('mapeia decisão e evidência para a RPC', () => {
    const p = toAccessEventParams(base);
    expect(p).toMatchObject({
      p_tenant: 't1',
      p_site: 's1',
      p_event_type: 'access_decision',
      p_decision: 'ALLOW',
      p_reason_code: 'POLICY_MATCH',
      p_person: 'p1',
      p_credential: 'c1',
      p_access_point: 'ap1',
      p_zone: 'z1',
      p_policy: 'pol1',
      p_source: 'ENGINE',
      p_occurred_at: '2026-10-07T15:00:00.000Z',
      p_physical_outcome: null,
      p_idempotency_key: null,
    });
    expect(p.p_evidence).toEqual({
      scheduleId: 'biz',
      deviceTrusted: true,
      antiPassback: 'OK',
      offline: false,
      evaluatedAt: '2026-10-07T15:00:00.000Z',
      steps: ['a', 'b'],
    });
  });

  it('não repassa campos fora da allowlist (ex.: segredos no evidence)', () => {
    const d = {
      ...decision,
      evidence: { ...decision.evidence, pin: '1234', token: 'abc', secret: 'x' },
    };
    const json = JSON.stringify(toAccessEventParams({ ...base, decision: d }).p_evidence);
    expect(json).not.toMatch(/pin|token|secret/i);
  });

  it('aceita string ISO, fonte EDGE_AGENT, resultado físico e chave de idempotência', () => {
    const p = toAccessEventParams({
      ...base,
      occurredAt: '2026-10-07T15:00:00Z',
      source: 'EDGE_AGENT',
      physicalOutcome: 'DOOR_OPENED',
      idempotencyKey: 'edge-0001-xyz',
    });
    expect(p).toMatchObject({
      p_source: 'EDGE_AGENT',
      p_physical_outcome: 'DOOR_OPENED',
      p_idempotency_key: 'edge-0001-xyz',
    });
  });

  it('rejeita entradas inválidas', () => {
    expect(() => toAccessEventParams({ ...base, tenantId: '' })).toThrow();
    expect(() => toAccessEventParams({ ...base, decision: {} })).toThrow();
    expect(() => toAccessEventParams({ ...base, source: 'X' })).toThrow();
    expect(() => toAccessEventParams({ ...base, physicalOutcome: 'X' })).toThrow();
    expect(() => toAccessEventParams({ ...base, occurredAt: 'lixo' })).toThrow();
  });

  it('funciona com a saída real do motor (falha fechada incluída)', () => {
    const d = evaluateAccess({});
    const p = toAccessEventParams({ ...base, decision: d });
    expect(p).toMatchObject({ p_decision: 'DENY', p_reason_code: 'CONTEXT_INVALID' });
  });
});

describe('contrato x migration 3C', () => {
  it('códigos de motivo e decisões do JS são exatamente os do CHECK do banco', async () => {
    const { readFileSync } = await import('node:fs');
    const { ACCESS_REASON_CODES, ACCESS_DECISIONS } = await import('./access-contracts.js');
    const mig = (f) =>
      readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
    const sql = mig('20261015120000_phase3c_access_events.sql');
    // A lista de motivos vigente é a da migration mais recente que a redefine (7B amplia o CHECK).
    const reasonSql = mig('20261025120000_phase7b_biometric_reason.sql');
    const list = (re) =>
      [...(re.exec(sql)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(
      [...(/reason_code in \(([^;]*?)\)\);/.exec(reasonSql)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)]
        .map((m) => m[1])
        .sort(),
    ).toEqual([...ACCESS_REASON_CODES].sort());
    expect(list(/decision in \(([^)]*)\)\),\s*reason_code/)).toEqual([...ACCESS_DECISIONS].sort());
  });
});

describe('toPhysicalOutcomeParams', () => {
  const base = {
    tenantId: '10000000-0000-0000-0000-00000000000a',
    siteId: '20000000-0000-0000-0000-00000000000a',
    occurredAt: new Date('2026-10-07T12:00:00Z'),
    correlationId: '00000000-0000-4000-8000-000000000001',
  };

  it('ok => DOOR_OPENED, ligado à decisão pela correlação, sem decisão própria', () => {
    const p = toPhysicalOutcomeParams({ ...base, actuation: { ok: true, code: 'OK' } });
    expect(p.p_event_type).toBe('physical_outcome');
    expect(p.p_physical_outcome).toBe('DOOR_OPENED');
    expect(p.p_correlation).toBe(base.correlationId);
    expect(p.p_decision).toBeNull();
    expect(p.p_reason_code).toBeNull();
    expect(p.p_source).toBe('EDGE_AGENT');
  });

  it('falha => DOOR_NOT_OPENED com o código do driver; TIMEOUT => UNKNOWN', () => {
    const off = toPhysicalOutcomeParams({
      ...base,
      actuation: { ok: false, code: 'DEVICE_OFFLINE' },
    });
    expect(off.p_physical_outcome).toBe('DOOR_NOT_OPENED');
    expect(off.p_evidence).toEqual({ actuation: { ok: false, code: 'DEVICE_OFFLINE' } });
    const to = toPhysicalOutcomeParams({ ...base, actuation: { ok: false, code: 'TIMEOUT' } });
    expect(to.p_physical_outcome).toBe('UNKNOWN');
  });

  it('código fora do padrão vira UNKNOWN (nada livre na evidência)', () => {
    const p = toPhysicalOutcomeParams({
      ...base,
      actuation: { ok: false, code: 'pin=1234 falhou' },
    });
    expect(p.p_evidence.actuation.code).toBe('UNKNOWN');
  });

  it('exige correlação, tenant/site, actuation e data válidos', () => {
    const act = { ok: true, code: 'OK' };
    expect(() => toPhysicalOutcomeParams({ ...base, correlationId: '', actuation: act })).toThrow();
    expect(() => toPhysicalOutcomeParams({ ...base, tenantId: '', actuation: act })).toThrow();
    expect(() => toPhysicalOutcomeParams({ ...base, actuation: {} })).toThrow();
    expect(() => toPhysicalOutcomeParams({ ...base, occurredAt: 'x', actuation: act })).toThrow();
    expect(() => toPhysicalOutcomeParams({ ...base, source: 'ENGINE', actuation: act })).toThrow();
  });
});
