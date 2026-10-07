// Contrato do motor de acesso (Fase 3B): decisões, códigos de motivo ESTÁVEIS e formato do contexto.
// Os códigos são usados em relatórios e integrações: nunca renomear nem reutilizar; só acrescentar.

export const ACCESS_DECISIONS = ['ALLOW', 'DENY', 'CHALLENGE', 'DEGRADED_ALLOW', 'DEGRADED_DENY'];

export const ACCESS_REASON_CODES = [
  'POLICY_MATCH',
  'POLICY_DENY',
  'ZONE_NOT_ALLOWED',
  'OUTSIDE_SCHEDULE',
  'MULTI_FACTOR_REQUIRED',
  'CREDENTIAL_INVALID',
  'CREDENTIAL_EXPIRED',
  'PERSON_DISABLED',
  'VISITOR_EXPIRED',
  'VISITOR_ZONE_NOT_ALLOWED',
  'ANTI_PASSBACK',
  'EMERGENCY_POLICY',
  'DEVICE_UNTRUSTED',
  'ACCESS_POINT_INACTIVE',
  'OFFLINE_POLICY_DENY',
  'OFFLINE_POLICY_ALLOW',
  'CONTEXT_INVALID',
  'BIOMETRIC_REJECTED',
];

/** @typedef {'ALLOW' | 'DENY' | 'CHALLENGE' | 'DEGRADED_ALLOW' | 'DEGRADED_DENY'} AccessDecisionKind */
/** @typedef {(typeof ACCESS_REASON_CODES)[number]} AccessReasonCode */
/** @typedef {'OFF' | 'OK' | 'VIOLATION_SOFT' | 'VIOLATION_HARD'} AntiPassbackOutcome */

/**
 * Contexto já resolvido pelo chamador (banco/cache). O motor não faz I/O nem lê relógio.
 * @typedef {{
 *   now: Date,
 *   timezone: string,                               // fuso IANA do SÍTIO do ponto
 *   accessPoint: { id: string, zoneId: string, status: 'active' | 'inactive',
 *                  emergencyBehavior: 'fail_safe' | 'fail_secure',
 *                  offlineBehavior: 'degraded_deny' | 'degraded_allow' },
 *   credential: { id: string, personId: string, status: 'active' | 'suspended' | 'revoked',
 *                 expiresAt?: Date | string | null, kind?: string } | null,   // kind 'biometric' exige `biometric`
 *   person: { id: string, status: 'active' | 'inactive' | 'blocked' } | null,
 *   groupIds: readonly string[],
 *   policies: readonly import('./policy.js').AccessPolicy[],
 *   schedules: Readonly<Record<string, { schedule: import('./schedule.js').Schedule, holidayDates?: readonly string[] }>>,
 *   device?: { trusted: boolean } | null,
 *   emergencyActive?: boolean,
 *   offline?: boolean,                              // true = decisão tomada sem a nuvem (Edge)
 *   antiPassback?: { mode: 'off' | 'soft' | 'hard', violated: boolean },
 *   visit?: { state: 'active' | 'expired' | 'revoked', allowedZoneIds: readonly string[],
 *             validFrom?: Date | string | null, validUntil?: Date | string | null } | null,
 *   challengeSatisfied?: boolean,
 *   biometric?: { accepted: boolean, reasonCode: string } | null,  // resultado de evaluateBiometric (@zela/biometrics), calculado pelo chamador
 * }} AccessContext
 */

/**
 * @typedef {{
 *   decision: AccessDecisionKind,
 *   reasonCode: AccessReasonCode,
 *   policyId: string | null,
 *   evidence: {
 *     personId: string | null, credentialId: string | null, accessPointId: string | null,
 *     zoneId: string | null, policyId: string | null, scheduleId: string | null,
 *     deviceTrusted: boolean | null, antiPassback: AntiPassbackOutcome,
 *     offline: boolean, evaluatedAt: string | null, steps: string[],
 *   },
 * }} AccessDecision
 */

const REASON_SET = new Set(ACCESS_REASON_CODES);
const DECISION_SET = new Set(ACCESS_DECISIONS);

/** @param {string} code */
export const isAccessReasonCode = (code) => REASON_SET.has(code);
/** @param {string} d */
export const isAccessDecisionKind = (d) => DECISION_SET.has(d);

/** Decisões que abrem a porta. */
export const OPENING_DECISIONS = ['ALLOW', 'DEGRADED_ALLOW'];
