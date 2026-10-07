import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCENARIOS, createMockBiometricProvider } from '@zela/biometrics';
import { createMockHardware } from '@zela/device-drivers';
import { handleAccessAttempt } from './access.js';
import { processBiometricErasures } from './biometric.js';
import { IDS, MONDAY_10H, makeSnapshot } from './fixtures.js';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';

const BIO_CRED = 'a0000000-0000-0000-0000-0000000000b1';
const settings = (o = {}) => ({
  enabled: true,
  legalBasis: 'fraud_prevention_security',
  retentionDays: 365,
  noticeVersion: 'v1',
  dpoContact: 'dpo@exemplo.com',
  ripdVersion: 'r1',
  ripdNextReviewAt: '2027-06-01',
  threshold: 0.9,
  requireLiveness: true,
  ...o,
});
const profile = (o = {}) => ({
  id: 'b0000000-0000-0000-0000-000000000001',
  personId: IDS.ana,
  credentialId: BIO_CRED,
  provider: 'mock',
  templateRef: 'mock:tpl-0001',
  status: 'active',
  retentionUntil: '2027-10-01T00:00:00Z',
  ...o,
});
const snap = ({ s = settings(), p = profile(), erasure = [], noBio = false } = {}) => {
  const base = makeSnapshot();
  base.credentials.push({
    id: BIO_CRED,
    personId: IDS.ana,
    type: 'biometric',
    status: 'active',
    secretHash: null,
    identifierHash: null,
    expiresAt: null,
  });
  if (!noBio) base.biometric = { settings: s, profiles: p ? [p] : [], pendingErasure: erasure };
  return base;
};

let store;
let driver;
let provider;
let n;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const load = (snapshot) => applySnapshot(store, { hash: 'h', snapshot }, MONDAY_10H);
const go = (extra = {}) =>
  handleAccessAttempt({
    store,
    driver,
    accessPointId: IDS.point,
    credential: { type: 'biometric', personId: IDS.ana },
    now: MONDAY_10H,
    offline: false,
    newId: ids,
    biometricProvider: provider,
    ...extra,
  });

beforeEach(() => {
  store = openStore();
  n = 0;
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  driver = createMockHardware({ points: [IDS.point], now: MONDAY_10H, env: 'test' });
  provider = createMockBiometricProvider({ env: 'test' });
});

describe('biometria no Edge (7D)', () => {
  it('MATCH com política e perfil vigentes: ALLOW e porta destrava', async () => {
    load(snap());
    provider.script(MOCK_SCENARIOS.match);
    const r = await go();
    expect(r.decision.decision).toBe('ALLOW');
    expect(r.actuation.attempted).toBe(true);
    expect(provider.calls).toBe(1);
    expect(r.decision.evidence.steps).toContain('biometric:BIOMETRIC_MATCH');
  });

  it.each([
    ['NO_MATCH', MOCK_SCENARIOS.noMatch],
    ['baixa confiança', MOCK_SCENARIOS.lowConfidence],
    ['liveness falhou', MOCK_SCENARIOS.livenessFailed],
    ['provedor indisponível', MOCK_SCENARIOS.unavailable],
    ['timeout', MOCK_SCENARIOS.timeout],
  ])('%s: nega (BIOMETRIC_REJECTED) e não aciona o driver', async (_n, scenario) => {
    load(snap());
    provider.script(scenario);
    const r = await go();
    expect(r.decision.decision).toBe('DENY');
    expect(r.decision.reasonCode).toBe('BIOMETRIC_REJECTED');
    expect(r.actuation.attempted).toBe(false);
    expect(driver.getStatus(IDS.point).locked).toBe(true);
  });

  it('exceção do provedor vira recusa', async () => {
    load(snap());
    provider.verify = async () => {
      throw new Error('boom');
    };
    expect((await go()).decision.decision).toBe('DENY');
  });

  it.each([
    ['sem bloco biometric (snapshot antigo)', { noBio: true }, 'BIOMETRIC_POLICY_MISSING'],
    ['política desligada', { s: settings({ enabled: false }) }, 'BIOMETRIC_POLICY_MISSING'],
    ['RIPD vencido', { s: settings({ ripdNextReviewAt: '2026-01-01' }) }, 'BIOMETRIC_RIPD_OVERDUE'],
    ['sem perfil', { p: null }, 'BIOMETRIC_PROFILE_INACTIVE'],
    [
      'retenção vencida',
      { p: profile({ retentionUntil: '2026-10-01T00:00:00Z' }) },
      'BIOMETRIC_RETENTION_EXPIRED',
    ],
  ])('%s: recusa sem consultar o provedor', async (_n, o, code) => {
    load(snap(o));
    provider.script(MOCK_SCENARIOS.match);
    const r = await go();
    expect(r.decision.decision).toBe('DENY');
    expect(r.decision.evidence.steps).toContain(`biometric:${code}`);
    expect(provider.calls).toBe(0);
  });

  it('sem provedor ou provedor diferente do cadastro: recusa', async () => {
    load(snap());
    expect((await go({ biometricProvider: undefined })).decision.decision).toBe('DENY');
    const other = { ...provider, kind: 'outro' };
    expect((await go({ biometricProvider: other })).decision.decision).toBe('DENY');
    expect(provider.calls).toBe(0);
  });

  it('credencial biométrica revogada fora do cache: perfil sem credencial correspondente nega', async () => {
    load(snap({ p: profile({ credentialId: 'a0000000-0000-0000-0000-0000000000ff' }) }));
    provider.script(MOCK_SCENARIOS.match);
    expect((await go()).decision.decision).toBe('DENY');
  });
});

describe('fila de eliminação (7D)', () => {
  const pending = [
    {
      profileId: 'b0000000-0000-0000-0000-000000000009',
      provider: 'mock',
      templateRef: 'mock:old-0001',
    },
  ];

  it('apaga no provedor e lista os perfis confirmados', async () => {
    load(snap({ erasure: pending }));
    const r = await processBiometricErasures({ store, provider });
    expect(r).toEqual({ erased: [pending[0].profileId], failed: [] });
    expect(provider.erased).toEqual(['mock:old-0001']);
  });

  it('sem provedor compatível ou com falha: não confirma', async () => {
    load(snap({ erasure: pending }));
    expect((await processBiometricErasures({ store, provider: null })).failed).toHaveLength(1);
    provider.erase = async () => {
      throw new Error('x');
    };
    expect((await processBiometricErasures({ store, provider })).erased).toEqual([]);
  });
});
