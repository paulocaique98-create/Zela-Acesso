import { describe, expect, it } from 'vitest';
import { evaluateAccess } from './access-engine.js';
import { ACCESS_DECISIONS, ACCESS_REASON_CODES, isAccessReasonCode } from './access-contracts.js';

// 2026-10-07 é quarta-feira; 15:00Z = 12:00 em America/Sao_Paulo.
const NOW = new Date('2026-10-07T15:00:00Z');
const TZ = 'America/Sao_Paulo';
const BIZ = {
  schedule: {
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '18:00' })),
  },
};

const policy = (over = {}) => ({
  id: 'pol1',
  groupId: 'g1',
  zoneId: 'z1',
  accessPointId: null,
  effect: 'allow',
  scheduleId: 'biz',
  requireChallenge: false,
  status: 'active',
  ...over,
});

/** Contexto base que resulta em ALLOW. */
const ctx = (over = {}) => ({
  now: NOW,
  timezone: TZ,
  accessPoint: {
    id: 'ap1',
    zoneId: 'z1',
    status: 'active',
    emergencyBehavior: 'fail_safe',
    offlineBehavior: 'degraded_deny',
  },
  credential: { id: 'c1', personId: 'p1', status: 'active', expiresAt: null },
  person: { id: 'p1', status: 'active' },
  groupIds: ['g1'],
  policies: [policy()],
  schedules: { biz: BIZ },
  ...over,
});

const ap = (o) => ({ ...ctx().accessPoint, ...o });

describe('evaluateAccess', () => {
  it('libera com política vigente (POLICY_MATCH) e preenche a evidência', () => {
    const d = evaluateAccess(ctx());
    expect(d).toMatchObject({ decision: 'ALLOW', reasonCode: 'POLICY_MATCH', policyId: 'pol1' });
    expect(d.evidence).toMatchObject({
      personId: 'p1',
      credentialId: 'c1',
      accessPointId: 'ap1',
      zoneId: 'z1',
      scheduleId: 'biz',
      antiPassback: 'OFF',
      offline: false,
      evaluatedAt: NOW.toISOString(),
    });
  });

  it('é determinístico', () => {
    expect(evaluateAccess(ctx())).toEqual(evaluateAccess(ctx()));
  });

  it('nega fora da janela', () => {
    const d = evaluateAccess(ctx({ now: new Date('2026-10-07T23:00:00Z') })); // 20:00 local
    expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'OUTSIDE_SCHEDULE' });
  });

  it('nega sem política (ZONE_NOT_ALLOWED) e com janela desconhecida', () => {
    expect(evaluateAccess(ctx({ policies: [] }))).toMatchObject({
      decision: 'DENY',
      reasonCode: 'ZONE_NOT_ALLOWED',
    });
    expect(evaluateAccess(ctx({ schedules: {} }))).toMatchObject({
      decision: 'DENY',
      reasonCode: 'OUTSIDE_SCHEDULE',
    });
  });

  it('política negar vence permitir', () => {
    const d = evaluateAccess(
      ctx({ policies: [policy(), policy({ id: 'pd', effect: 'deny', scheduleId: null })] }),
    );
    expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'POLICY_DENY', policyId: 'pd' });
  });

  it('feriado nega quando a janela trata feriado como negado', () => {
    const d = evaluateAccess(ctx({ schedules: { biz: { ...BIZ, holidayDates: ['2026-10-07'] } } }));
    expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'OUTSIDE_SCHEDULE' });
  });

  describe('credencial e pessoa', () => {
    it.each([
      ['sem credencial', { credential: null }, 'CREDENTIAL_INVALID'],
      [
        'suspensa',
        { credential: { id: 'c1', personId: 'p1', status: 'suspended' } },
        'CREDENTIAL_INVALID',
      ],
      [
        'revogada',
        { credential: { id: 'c1', personId: 'p1', status: 'revoked' } },
        'CREDENTIAL_INVALID',
      ],
      [
        'expirada',
        {
          credential: {
            id: 'c1',
            personId: 'p1',
            status: 'active',
            expiresAt: '2026-10-07T14:59:59Z',
          },
        },
        'CREDENTIAL_EXPIRED',
      ],
      [
        'expira exatamente agora',
        { credential: { id: 'c1', personId: 'p1', status: 'active', expiresAt: NOW } },
        'CREDENTIAL_EXPIRED',
      ],
      [
        'data de expiração inválida',
        { credential: { id: 'c1', personId: 'p1', status: 'active', expiresAt: 'xx' } },
        'CREDENTIAL_INVALID',
      ],
      ['pessoa divergente', { person: { id: 'outra', status: 'active' } }, 'CREDENTIAL_INVALID'],
      ['sem pessoa', { person: null }, 'CREDENTIAL_INVALID'],
      ['pessoa inativa', { person: { id: 'p1', status: 'inactive' } }, 'PERSON_DISABLED'],
      ['pessoa bloqueada', { person: { id: 'p1', status: 'blocked' } }, 'PERSON_DISABLED'],
    ])('nega: %s', (_n, over, code) => {
      expect(evaluateAccess(ctx(over))).toMatchObject({ decision: 'DENY', reasonCode: code });
    });

    it('credencial ainda válida libera', () => {
      const d = evaluateAccess(
        ctx({
          credential: {
            id: 'c1',
            personId: 'p1',
            status: 'active',
            expiresAt: '2026-10-07T15:00:01Z',
          },
        }),
      );
      expect(d.decision).toBe('ALLOW');
    });
  });

  describe('ponto e dispositivo', () => {
    it('ponto inativo nega', () => {
      expect(evaluateAccess(ctx({ accessPoint: ap({ status: 'inactive' }) }))).toMatchObject({
        reasonCode: 'ACCESS_POINT_INACTIVE',
      });
    });
    it('dispositivo não confiável nega', () => {
      expect(evaluateAccess(ctx({ device: { trusted: false } }))).toMatchObject({
        decision: 'DENY',
        reasonCode: 'DEVICE_UNTRUSTED',
      });
    });
    it('dispositivo confiável libera', () => {
      const d = evaluateAccess(ctx({ device: { trusted: true } }));
      expect(d.decision).toBe('ALLOW');
      expect(d.evidence.deviceTrusted).toBe(true);
    });
  });

  describe('visitante', () => {
    it('visita expirada nega', () => {
      expect(
        evaluateAccess(ctx({ visit: { state: 'expired', allowedZoneIds: ['z1'] } })),
      ).toMatchObject({ reasonCode: 'VISITOR_EXPIRED' });
    });
    it('visita revogada nega', () => {
      expect(
        evaluateAccess(ctx({ visit: { state: 'revoked', allowedZoneIds: ['z1'] } })),
      ).toMatchObject({ reasonCode: 'VISITOR_EXPIRED' });
    });
    it('zona fora do escopo da visita nega', () => {
      expect(
        evaluateAccess(ctx({ visit: { state: 'active', allowedZoneIds: ['z9'] } })),
      ).toMatchObject({ reasonCode: 'VISITOR_ZONE_NOT_ALLOWED' });
    });
    const visitOnly = (visit, over = {}) =>
      evaluateAccess(ctx({ groupIds: [], policies: [], visit, ...over }));
    it('visita ativa na zona liberada é a própria concessão (sem grupo/política)', () => {
      const d = visitOnly({ state: 'active', allowedZoneIds: ['z1'] });
      expect(d).toMatchObject({ decision: 'ALLOW', reasonCode: 'POLICY_MATCH', policyId: null });
      expect(d.evidence.steps).toContain('visit:allowed');
    });
    it('sem visita e sem política continua negando', () => {
      expect(evaluateAccess(ctx({ groupIds: [], policies: [] })).decision).toBe('DENY');
    });
    it('janela da visita: antes do início e a partir do fim nega (VISITOR_EXPIRED)', () => {
      const v = (validFrom, validUntil) => ({
        state: 'active',
        allowedZoneIds: ['z1'],
        validFrom,
        validUntil,
      });
      const t = NOW.getTime();
      const iso = (ms) => new Date(t + ms).toISOString();
      expect(visitOnly(v(iso(3_600_000), iso(7_200_000)))).toMatchObject({
        reasonCode: 'VISITOR_EXPIRED',
      });
      expect(visitOnly(v(iso(-7_200_000), iso(0)))).toMatchObject({
        reasonCode: 'VISITOR_EXPIRED',
      });
      expect(visitOnly(v('lixo', iso(3_600_000)))).toMatchObject({ reasonCode: 'VISITOR_EXPIRED' });
      expect(visitOnly(v(iso(-3_600_000), iso(3_600_000))).decision).toBe('ALLOW');
    });
    it('visitante respeita anti-passback e modo offline', () => {
      const visit = { state: 'active', allowedZoneIds: ['z1'] };
      expect(visitOnly(visit, { antiPassback: { mode: 'hard', violated: true } })).toMatchObject({
        decision: 'DENY',
        reasonCode: 'ANTI_PASSBACK',
      });
      expect(visitOnly(visit, { offline: true })).toMatchObject({ decision: 'DEGRADED_DENY' });
    });
  });

  describe('desafio (segundo fator)', () => {
    const challengePolicy = { policies: [policy({ requireChallenge: true })] };
    it('pede desafio', () => {
      expect(evaluateAccess(ctx(challengePolicy))).toMatchObject({
        decision: 'CHALLENGE',
        reasonCode: 'MULTI_FACTOR_REQUIRED',
      });
    });
    it('libera com desafio satisfeito', () => {
      expect(evaluateAccess(ctx({ ...challengePolicy, challengeSatisfied: true }))).toMatchObject({
        decision: 'ALLOW',
        reasonCode: 'POLICY_MATCH',
      });
    });
    it('desafio satisfeito não salva uma negação', () => {
      expect(evaluateAccess(ctx({ policies: [], challengeSatisfied: true })).decision).toBe('DENY');
    });
  });

  describe('anti-passback', () => {
    it('hard violado nega', () => {
      const d = evaluateAccess(ctx({ antiPassback: { mode: 'hard', violated: true } }));
      expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'ANTI_PASSBACK' });
      expect(d.evidence.antiPassback).toBe('VIOLATION_HARD');
    });
    it('soft violado libera e registra', () => {
      const d = evaluateAccess(ctx({ antiPassback: { mode: 'soft', violated: true } }));
      expect(d.decision).toBe('ALLOW');
      expect(d.evidence.antiPassback).toBe('VIOLATION_SOFT');
    });
    it('sem violação marca OK; desligado marca OFF', () => {
      expect(
        evaluateAccess(ctx({ antiPassback: { mode: 'hard', violated: false } })).evidence
          .antiPassback,
      ).toBe('OK');
      expect(
        evaluateAccess(ctx({ antiPassback: { mode: 'off', violated: true } })).evidence
          .antiPassback,
      ).toBe('OFF');
    });
    it('não transforma uma negação em outro motivo', () => {
      const d = evaluateAccess(
        ctx({ policies: [], antiPassback: { mode: 'hard', violated: true } }),
      );
      expect(d.reasonCode).toBe('ZONE_NOT_ALLOWED');
    });
  });

  describe('emergência', () => {
    it('fail-safe libera, mesmo sem credencial', () => {
      expect(evaluateAccess(ctx({ emergencyActive: true, credential: null }))).toMatchObject({
        decision: 'ALLOW',
        reasonCode: 'EMERGENCY_POLICY',
      });
    });
    it('fail-secure mantém travado', () => {
      const d = evaluateAccess(
        ctx({ emergencyActive: true, accessPoint: ap({ emergencyBehavior: 'fail_secure' }) }),
      );
      expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'EMERGENCY_POLICY' });
    });
  });

  describe('offline', () => {
    it('degraded_deny nega mesmo com política que permitiria', () => {
      expect(evaluateAccess(ctx({ offline: true }))).toMatchObject({
        decision: 'DEGRADED_DENY',
        reasonCode: 'OFFLINE_POLICY_DENY',
      });
    });
    it('degraded_allow libera com dados em cache', () => {
      const d = evaluateAccess(
        ctx({ offline: true, accessPoint: ap({ offlineBehavior: 'degraded_allow' }) }),
      );
      expect(d).toMatchObject({
        decision: 'DEGRADED_ALLOW',
        reasonCode: 'OFFLINE_POLICY_ALLOW',
        policyId: 'pol1',
      });
      expect(d.evidence.offline).toBe(true);
    });
    it('degraded_allow não libera o que a regra nega', () => {
      const d = evaluateAccess(
        ctx({
          offline: true,
          policies: [],
          accessPoint: ap({ offlineBehavior: 'degraded_allow' }),
        }),
      );
      expect(d).toMatchObject({ decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED' });
    });
    it('degraded_allow não libera credencial revogada', () => {
      const d = evaluateAccess(
        ctx({
          offline: true,
          credential: { id: 'c1', personId: 'p1', status: 'revoked' },
          accessPoint: ap({ offlineBehavior: 'degraded_allow' }),
        }),
      );
      expect(d.decision).toBe('DENY');
    });
  });

  describe('falha fechada', () => {
    it.each([
      ['contexto vazio', undefined],
      ['sem relógio', ctx({ now: undefined })],
      ['data inválida', ctx({ now: new Date('x') })],
      ['sem fuso', ctx({ timezone: '' })],
      ['sem ponto', ctx({ accessPoint: undefined })],
      ['fuso inexistente', ctx({ timezone: 'Marte/Olimpo' })],
    ])('%s => DENY/CONTEXT_INVALID', (_n, c) => {
      expect(evaluateAccess(c)).toMatchObject({ decision: 'DENY', reasonCode: 'CONTEXT_INVALID' });
    });
  });

  it('só emite decisões e códigos do contrato', () => {
    const cases = [
      ctx(),
      ctx({ policies: [] }),
      ctx({ offline: true }),
      ctx({ emergencyActive: true }),
      undefined,
    ];
    for (const c of cases) {
      const d = evaluateAccess(c);
      expect(ACCESS_DECISIONS).toContain(d.decision);
      expect(isAccessReasonCode(d.reasonCode)).toBe(true);
    }
    expect(new Set(ACCESS_REASON_CODES).size).toBe(ACCESS_REASON_CODES.length);
  });

  it('não vaza segredo na evidência', () => {
    const json = JSON.stringify(
      evaluateAccess(
        ctx({
          credential: { id: 'c1', personId: 'p1', status: 'active', pin: '123456', token: 'abc' },
        }),
      ),
    );
    expect(json).not.toMatch(/123456|abc"/);
  });
});
