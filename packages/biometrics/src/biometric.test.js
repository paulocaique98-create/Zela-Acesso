import { describe, expect, it } from 'vitest';
import {
  BIOMETRIC_REASON_CODES,
  createMockBiometricProvider,
  evaluateBiometric,
  isValidThreshold,
  MOCK_SCENARIOS as S,
} from './index.js';

const policy = (o = {}) => ({ enabled: true, threshold: 0.9, requireLiveness: false, ...o });
const caps = { liveness: true, engine: 'mock', engineVersion: '0' };
const run = (r, p = policy(), c = caps) => evaluateBiometric(r, p, c);

describe('evaluateBiometric', () => {
  it('aceita match acima do limiar', () => {
    expect(run(S.match)).toEqual({ accepted: true, reasonCode: 'BIOMETRIC_MATCH' });
  });
  it('recusa por padrão quando desligada ou sem política', () => {
    expect(run(S.match, policy({ enabled: false })).reasonCode).toBe('BIOMETRIC_DISABLED');
    expect(run(S.match, null).reasonCode).toBe('BIOMETRIC_DISABLED');
    expect(run(S.match, {}).reasonCode).toBe('BIOMETRIC_DISABLED');
  });
  it('recusa configuração insegura ou inválida', () => {
    for (const t of [0.5, 0.79, 1.01, NaN, '0.9', undefined])
      expect(run(S.match, policy({ threshold: t })).reasonCode).toBe('BIOMETRIC_INVALID_CONFIG');
    expect(run(S.match, policy({ requireLiveness: 'sim' })).reasonCode).toBe(
      'BIOMETRIC_INVALID_CONFIG',
    );
  });
  it('baixa confiança, no match, erro e timeout recusam', () => {
    expect(run(S.lowConfidence).reasonCode).toBe('BIOMETRIC_LOW_CONFIDENCE');
    expect(run(S.noMatch).reasonCode).toBe('BIOMETRIC_NO_MATCH');
    expect(run(S.unavailable).reasonCode).toBe('BIOMETRIC_PROVIDER_UNAVAILABLE');
    expect(run(S.timeout).reasonCode).toBe('BIOMETRIC_TIMEOUT');
    expect(run(null).accepted).toBe(false);
    expect(run({ status: 'MATCH', score: NaN, liveness: 'PASSED' }).accepted).toBe(false);
  });
  it('liveness exigido: rejeitado recusa; não suportado nunca é tratado como aprovado', () => {
    const p = policy({ requireLiveness: true });
    expect(run(S.match, p).accepted).toBe(true);
    expect(run(S.livenessFailed, p).reasonCode).toBe('BIOMETRIC_LIVENESS_FAILED');
    expect(run(S.match, p, { ...caps, liveness: false }).reasonCode).toBe(
      'BIOMETRIC_LIVENESS_UNSUPPORTED',
    );
    expect(run({ ...S.match, liveness: 'UNSUPPORTED' }, p).reasonCode).toBe(
      'BIOMETRIC_LIVENESS_UNSUPPORTED',
    );
    expect(run(S.match, p, null).reasonCode).toBe('BIOMETRIC_LIVENESS_UNSUPPORTED');
  });
  it('liveness não exigido não bloqueia por falha de liveness', () => {
    expect(run(S.livenessFailed).accepted).toBe(true);
  });
  it('só emite códigos catalogados', () => {
    for (const r of Object.values(S))
      expect(BIOMETRIC_REASON_CODES).toContain(
        run(r, policy({ requireLiveness: true })).reasonCode,
      );
  });
  it('isValidThreshold', () => {
    expect(isValidThreshold(0.8)).toBe(true);
    expect(isValidThreshold(1)).toBe(true);
    expect(isValidThreshold(0.7999)).toBe(false);
  });
});

describe('MockBiometricProvider', () => {
  it('recusa produção', () => {
    expect(() => createMockBiometricProvider({ env: 'production' })).toThrow(/produção/);
  });
  it('segue o roteiro e sem roteiro recusa (fail-closed)', async () => {
    const p = createMockBiometricProvider({ env: 'test' });
    p.script(S.match, S.timeout);
    expect(await p.verify({ subjectRef: 'a' })).toEqual(S.match);
    expect(await p.verify({ subjectRef: 'a' })).toEqual(S.timeout);
    expect((await p.verify({ subjectRef: 'a' })).status).toBe('NO_MATCH');
    expect(p.calls).toBe(3);
  });
  it('probe inválido vira erro; sem liveness declara não suportado', async () => {
    const p = createMockBiometricProvider({ env: 'test', liveness: false });
    expect((await p.verify({})).status).toBe('ERROR');
    expect(p.capabilities.liveness).toBe(false);
    expect((await p.verify({ subjectRef: 'a' })).liveness).toBe('UNSUPPORTED');
  });
});
