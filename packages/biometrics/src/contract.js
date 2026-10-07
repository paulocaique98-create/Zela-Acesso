// Contrato BiometricProvider (Fase 7A). Biometria é dado sensível (LGPD) e fica desligada por padrão.
// O núcleo só conhece esta interface; o motor concreto (local/navegador, dispositivo) fica atrás dela.
// Nenhum motor é decidido aqui (D-007: benchmark antes de fixar). Nunca `face-api.js`.
// Este pacote nunca recebe, guarda nem registra imagem ou gabarito bruto: só uma referência opaca.

/** Códigos estáveis de motivo da verificação biométrica. Só acrescentar, nunca renomear. */
export const BIOMETRIC_REASON_CODES = [
  'BIOMETRIC_MATCH',
  'BIOMETRIC_NO_MATCH',
  'BIOMETRIC_LOW_CONFIDENCE',
  'BIOMETRIC_LIVENESS_FAILED',
  'BIOMETRIC_LIVENESS_UNSUPPORTED',
  'BIOMETRIC_PROVIDER_UNAVAILABLE',
  'BIOMETRIC_TIMEOUT',
  'BIOMETRIC_DISABLED',
  'BIOMETRIC_INVALID_CONFIG',
];

/** Limiar mínimo aceito em configuração: abaixo disso o falso positivo é inaceitável para acesso físico. */
export const MIN_SAFE_THRESHOLD = 0.8;

/**
 * @typedef {'MATCH' | 'NO_MATCH' | 'ERROR'} BiometricStatus
 * @typedef {'PASSED' | 'FAILED' | 'UNSUPPORTED'} LivenessResult
 * @typedef {{ liveness: boolean, engine: string, engineVersion: string }} BiometricCapabilities
 * @typedef {{ status: BiometricStatus, score: number, liveness: LivenessResult,
 *            error?: 'UNAVAILABLE' | 'TIMEOUT' }} BiometricResult
 * @typedef {{ subjectRef: string, deviceId?: string }} BiometricProbe
 *   `subjectRef` é referência opaca à pessoa/gabarito; nunca a imagem nem o vetor.
 *
 * Contrato de um provedor biométrico.
 * @typedef {object} BiometricProvider
 * @property {string} kind identificador do provedor (ex.: 'mock')
 * @property {BiometricCapabilities} capabilities `liveness` só é true se o motor realmente oferece prova de vida
 * @property {(probe: BiometricProbe) => Promise<BiometricResult>} verify
 */

/**
 * Política da organização/ponto para aceitar a biometria.
 * @typedef {{ enabled: boolean, threshold: number, requireLiveness: boolean }} BiometricPolicy
 */

/** @param {unknown} t */
export const isValidThreshold = (t) =>
  typeof t === 'number' && Number.isFinite(t) && t >= MIN_SAFE_THRESHOLD && t <= 1;

/**
 * Decisão determinística sobre o resultado do provedor. Fail-closed: qualquer dúvida recusa.
 * Biometria desligada, configuração inválida, erro, baixa confiança, falha ou ausência de liveness exigido => recusa.
 * Vale só para entrada/identificação: nunca bloqueia saída segura.
 * @param {BiometricResult | null | undefined} result
 * @param {BiometricPolicy | null | undefined} policy
 * @param {BiometricCapabilities | null | undefined} capabilities
 * @returns {{ accepted: boolean, reasonCode: string }}
 */
export function evaluateBiometric(result, policy, capabilities) {
  const deny = (reasonCode) => ({ accepted: false, reasonCode });
  if (!policy || policy.enabled !== true) return deny('BIOMETRIC_DISABLED');
  if (!isValidThreshold(policy.threshold) || typeof policy.requireLiveness !== 'boolean')
    return deny('BIOMETRIC_INVALID_CONFIG');
  if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score))
    return deny('BIOMETRIC_PROVIDER_UNAVAILABLE');
  if (result.status === 'ERROR')
    return deny(
      result.error === 'TIMEOUT' ? 'BIOMETRIC_TIMEOUT' : 'BIOMETRIC_PROVIDER_UNAVAILABLE',
    );
  if (policy.requireLiveness) {
    if (!capabilities?.liveness || result.liveness === 'UNSUPPORTED')
      return deny('BIOMETRIC_LIVENESS_UNSUPPORTED');
    if (result.liveness !== 'PASSED') return deny('BIOMETRIC_LIVENESS_FAILED');
  }
  if (result.status !== 'MATCH') return deny('BIOMETRIC_NO_MATCH');
  if (result.score < policy.threshold) return deny('BIOMETRIC_LOW_CONFIDENCE');
  return { accepted: true, reasonCode: 'BIOMETRIC_MATCH' };
}
