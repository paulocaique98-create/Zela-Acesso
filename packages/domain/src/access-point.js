// Contrato de domínio do ponto de acesso (espelha public.access_points; o banco é a fonte de verdade).
// Controlador/leitores/sensor/relé são só rótulos descritivos até a Fase 4 (dispositivos reais).

/** @typedef {'door' | 'gate' | 'turnstile' | 'barrier' | 'elevator' | 'virtual'} AccessPointType */
/** @typedef {'entry' | 'exit' | 'bidirectional'} AccessPointDirection */
/** @typedef {'active' | 'inactive'} AccessPointStatus */
/** @typedef {'fail_safe' | 'fail_secure'} EmergencyBehavior */
/** @typedef {'degraded_deny' | 'degraded_allow'} OfflineBehavior */

export const ACCESS_POINT_TYPES = ['door', 'gate', 'turnstile', 'barrier', 'elevator', 'virtual'];
export const ACCESS_POINT_DIRECTIONS = ['entry', 'exit', 'bidirectional'];
export const EMERGENCY_BEHAVIORS = ['fail_safe', 'fail_secure'];
export const OFFLINE_BEHAVIORS = ['degraded_deny', 'degraded_allow'];

export const DOOR_OPEN_TIMEOUT_MIN = 1;
export const DOOR_OPEN_TIMEOUT_MAX = 3600;
export const HARDWARE_REF_MAX = 80;

/** Rótulos em português para a interface. */
export const ACCESS_POINT_TYPE_LABEL = {
  door: 'Porta',
  gate: 'Portão',
  turnstile: 'Catraca',
  barrier: 'Cancela',
  elevator: 'Elevador',
  virtual: 'Área virtual',
};
export const ACCESS_POINT_DIRECTION_LABEL = {
  entry: 'Entrada',
  exit: 'Saída',
  bidirectional: 'Entrada e saída',
};
export const EMERGENCY_BEHAVIOR_LABEL = {
  fail_safe: 'Libera em emergência (fail-safe)',
  fail_secure: 'Permanece travado (fail-secure)',
};
export const OFFLINE_BEHAVIOR_LABEL = {
  degraded_deny: 'Nega sem conexão',
  degraded_allow: 'Permite com dados em cache',
};

/**
 * @param {number} seconds
 * @returns {string | null} mensagem de erro, ou null se válido
 */
export function validateDoorOpenTimeout(seconds) {
  return Number.isInteger(seconds) &&
    seconds >= DOOR_OPEN_TIMEOUT_MIN &&
    seconds <= DOOR_OPEN_TIMEOUT_MAX
    ? null
    : `O tempo de porta aberta deve ser de ${DOOR_OPEN_TIMEOUT_MIN} a ${DOOR_OPEN_TIMEOUT_MAX} segundos.`;
}

/**
 * Aviso (não bloqueia) para configurações que merecem atenção do instalador.
 * O software nunca bloqueia saída segura: fail-secure exige que a instalação garanta rota de saída
 * (botoeira, barra antipânico ou equivalente). Validação legal/normativa é externa ao software.
 * @param {{ emergency_behavior: EmergencyBehavior, offline_behavior: OfflineBehavior, direction: AccessPointDirection }} ap
 * @returns {string[]}
 */
export function accessPointWarnings(ap) {
  const out = [];
  if (ap.emergency_behavior === 'fail_secure') {
    out.push(
      'Fail-secure mantém o ponto travado em emergência: garanta uma saída segura (botoeira, barra antipânico ou equivalente) na instalação.',
    );
  }
  if (ap.offline_behavior === 'degraded_allow') {
    out.push(
      'Sem conexão, o ponto poderá liberar com dados em cache (credenciais revogadas há pouco podem ainda valer).',
    );
  }
  return out;
}
