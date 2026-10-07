import { describe, expect, it } from 'vitest';
import { toAccessEventParams } from './access-event.js';
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
    const sql = readFileSync(
      new URL(
        '../../../supabase/migrations/20261015120000_phase3c_access_events.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const list = (re) =>
      [...(re.exec(sql)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(list(/reason_code in \(([^;]*?)\)\),\s*person_id/)).toEqual(
      [...ACCESS_REASON_CODES].sort(),
    );
    expect(list(/decision in \(([^)]*)\)\),\s*reason_code/)).toEqual([...ACCESS_DECISIONS].sort());
  });
});
