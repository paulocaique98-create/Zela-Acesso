import { describe, expect, it } from 'vitest';
import {
  BIOMETRIC_LEGAL_BASES,
  checkBiometricSettings,
  evaluateBiometric,
  MOCK_SCENARIOS as S,
  resolveBiometricPolicy,
} from './index.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const settings = (o = {}) => ({
  enabled: true,
  legalBasis: 'consent',
  retentionDays: 365,
  noticeVersion: 'v1',
  dpoContact: 'dpo@exemplo.test',
  ripdVersion: 'ripd-1',
  ripdNextReviewAt: '2027-01-01',
  threshold: 0.9,
  requireLiveness: false,
  ...o,
});
const profile = (o = {}) => ({ status: 'active', retentionUntil: '2027-01-01T00:00:00Z', ...o });

describe('checkBiometricSettings', () => {
  it('política completa e vigente passa', () => {
    expect(checkBiometricSettings(settings(), NOW)).toEqual({ ok: true });
  });
  it('ausente ou desligada recusa (padrão)', () => {
    for (const s of [null, undefined, {}, settings({ enabled: false })])
      expect(checkBiometricSettings(s, NOW)).toEqual({
        ok: false,
        reasonCode: 'BIOMETRIC_POLICY_MISSING',
      });
  });
  it('incompleta recusa, inclusive base legal fora das aceitas', () => {
    for (const o of [
      { legalBasis: null },
      { legalBasis: 'legitimate_interest' },
      { retentionDays: 0 },
      { retentionDays: 1096 },
      { retentionDays: 1.5 },
      { noticeVersion: ' ' },
      { dpoContact: 'x' },
      { ripdVersion: '' },
      { ripdNextReviewAt: null },
      { ripdNextReviewAt: 'lixo' },
    ])
      expect(checkBiometricSettings(settings(o), NOW).reasonCode).toBe(
        'BIOMETRIC_POLICY_INCOMPLETE',
      );
  });
  it('RIPD vencido bloqueia; vale até o fim do dia da revisão', () => {
    expect(
      checkBiometricSettings(settings({ ripdNextReviewAt: '2026-10-06' }), NOW).reasonCode,
    ).toBe('BIOMETRIC_RIPD_OVERDUE');
    expect(checkBiometricSettings(settings({ ripdNextReviewAt: '2026-10-07' }), NOW).ok).toBe(true);
  });
  it('as três bases legais aceitas', () => {
    expect(BIOMETRIC_LEGAL_BASES).toEqual([
      'consent',
      'fraud_prevention_security',
      'legal_obligation',
    ]);
  });
});

describe('resolveBiometricPolicy', () => {
  it('perfil ativo dentro da retenção libera a política do motor', () => {
    expect(resolveBiometricPolicy(settings(), profile(), NOW)).toEqual({
      allowed: true,
      policy: { enabled: true, threshold: 0.9, requireLiveness: false },
    });
  });
  it('perfil ausente, revogado, expirado ou apagado recusa', () => {
    for (const p of [
      null,
      undefined,
      profile({ status: 'revoked' }),
      profile({ status: 'expired' }),
      profile({ status: 'erased' }),
    ])
      expect(resolveBiometricPolicy(settings(), p, NOW).reasonCode).toBe(
        'BIOMETRIC_PROFILE_INACTIVE',
      );
  });
  it('retenção vencida recusa mesmo com status ativo (cron ainda não rodou)', () => {
    const at = resolveBiometricPolicy(
      settings(),
      profile({ retentionUntil: '2026-10-07T12:00:00Z' }),
      NOW,
    );
    expect(at.reasonCode).toBe('BIOMETRIC_RETENTION_EXPIRED');
    const bad = resolveBiometricPolicy(settings(), profile({ retentionUntil: 'lixo' }), NOW);
    expect(bad.reasonCode).toBe('BIOMETRIC_RETENTION_EXPIRED');
  });
  it('bloqueio de política vem antes do perfil', () => {
    expect(resolveBiometricPolicy(settings({ enabled: false }), profile(), NOW).reasonCode).toBe(
      'BIOMETRIC_POLICY_MISSING',
    );
  });
  it('compõe com evaluateBiometric', () => {
    const r = resolveBiometricPolicy(settings(), profile(), NOW);
    const caps = { liveness: true, engine: 'mock', engineVersion: '0' };
    expect(r.allowed && evaluateBiometric(S.match, r.policy, caps).accepted).toBe(true);
  });
});
