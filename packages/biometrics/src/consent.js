// Base legal, retenção e perfil (Fase 7C). Decisão pura e fail-closed: antes de pedir qualquer verificação ao
// provedor, confirma que a organização pode tratar biometria e que o perfil da pessoa está vigente.
// Nunca recebe nem devolve gabarito/imagem; só metadados (espelho de biometric_settings/biometric_profiles).

/** Códigos estáveis de bloqueio por política/consentimento. Só acrescentar, nunca renomear. */
export const BIOMETRIC_POLICY_REASON_CODES = [
  'BIOMETRIC_POLICY_MISSING',
  'BIOMETRIC_POLICY_INCOMPLETE',
  'BIOMETRIC_RIPD_OVERDUE',
  'BIOMETRIC_PROFILE_INACTIVE',
  'BIOMETRIC_RETENTION_EXPIRED',
];

/** Bases legais aceitas (LGPD art. 11). Uma única por finalidade; legítimo interesse não vale p/ dado sensível. */
export const BIOMETRIC_LEGAL_BASES = ['consent', 'fraud_prevention_security', 'legal_obligation'];

/** Retenção máxima em dias (espelha o CHECK do banco). */
export const MAX_RETENTION_DAYS = 1095;

const DAY_MS = 24 * 60 * 60 * 1000;
const asDate = (v) => (v instanceof Date ? v : new Date(v));
const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * @typedef {{ enabled: boolean, legalBasis: string | null, retentionDays: number | null,
 *            noticeVersion: string | null, dpoContact: string | null, ripdVersion: string | null,
 *            ripdNextReviewAt: Date | string | null, threshold: number, requireLiveness: boolean }} BiometricSettings
 * @typedef {{ status: 'active' | 'revoked' | 'expired' | 'erased', retentionUntil: Date | string }} BiometricProfileMeta
 */

/**
 * A política da organização está completa e vigente para tratar biometria?
 * @param {BiometricSettings | null | undefined} settings
 * @param {Date | string} now
 * @returns {{ ok: true } | { ok: false, reasonCode: string }}
 */
export function checkBiometricSettings(settings, now) {
  if (!settings || settings.enabled !== true)
    return { ok: false, reasonCode: 'BIOMETRIC_POLICY_MISSING' };
  const complete =
    BIOMETRIC_LEGAL_BASES.includes(settings.legalBasis) &&
    Number.isInteger(settings.retentionDays) &&
    settings.retentionDays >= 1 &&
    settings.retentionDays <= MAX_RETENTION_DAYS &&
    typeof settings.noticeVersion === 'string' &&
    settings.noticeVersion.trim() !== '' &&
    typeof settings.dpoContact === 'string' &&
    settings.dpoContact.trim().length >= 5 &&
    typeof settings.ripdVersion === 'string' &&
    settings.ripdVersion.trim() !== '';
  if (!complete) return { ok: false, reasonCode: 'BIOMETRIC_POLICY_INCOMPLETE' };
  const next = settings.ripdNextReviewAt == null ? null : asDate(settings.ripdNextReviewAt);
  const at = asDate(now);
  if (!next || !valid(next) || !valid(at))
    return { ok: false, reasonCode: 'BIOMETRIC_POLICY_INCOMPLETE' };
  // a revisão vale até o fim do dia indicado
  if (at.getTime() > next.getTime() + DAY_MS - 1)
    return { ok: false, reasonCode: 'BIOMETRIC_RIPD_OVERDUE' };
  return { ok: true };
}

/**
 * Resolve a política a passar para `evaluateBiometric` ou o motivo do bloqueio (fail-closed).
 * O perfil precisa estar ativo e dentro da retenção; senão a biometria é recusada sem consultar o provedor.
 * @param {BiometricSettings | null | undefined} settings
 * @param {BiometricProfileMeta | null | undefined} profile
 * @param {Date | string} now
 * @returns {{ allowed: true, policy: { enabled: true, threshold: number, requireLiveness: boolean } }
 *          | { allowed: false, reasonCode: string }}
 */
export function resolveBiometricPolicy(settings, profile, now) {
  const s = checkBiometricSettings(settings, now);
  if (!s.ok) return { allowed: false, reasonCode: s.reasonCode };
  if (!profile || profile.status !== 'active')
    return { allowed: false, reasonCode: 'BIOMETRIC_PROFILE_INACTIVE' };
  const until = asDate(profile.retentionUntil);
  const at = asDate(now);
  if (!valid(until) || !valid(at) || at.getTime() >= until.getTime())
    return { allowed: false, reasonCode: 'BIOMETRIC_RETENTION_EXPIRED' };
  return {
    allowed: true,
    policy: {
      enabled: true,
      threshold: settings.threshold,
      requireLiveness: settings.requireLiveness,
    },
  };
}
