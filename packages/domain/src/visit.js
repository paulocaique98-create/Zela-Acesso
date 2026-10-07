// Contrato de domínio da visita (espelha public.visits; o banco é a fonte de verdade).

/** @typedef {'invited' | 'checked_in' | 'checked_out' | 'expired' | 'cancelled'} VisitStatus */

export const VISIT_MAX_DAYS = 7;
export const VISIT_MAX_ZONES = 50;

export const VISIT_STATUS_LABEL = {
  invited: 'Convidado',
  checked_in: 'Presente',
  checked_out: 'Saiu',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

// Versão e texto PROVISÓRIOS do aviso de privacidade: a redação final exige validação jurídica (LGPD).
export const VISIT_NOTICE_VERSION = 'rascunho-2026-10';
export const VISIT_NOTICE_TEXT =
  'Seus dados (nome, empresa, placa e horários de entrada e saída) são usados apenas para controlar o acesso a este local durante a visita.';

/**
 * Valida o período da visita (mesmas regras do banco).
 * @param {Date} from @param {Date} until @param {Date} [now]
 * @returns {string | null} mensagem de erro, ou null se válido
 */
export function validateVisitWindow(from, until, now = new Date()) {
  if (!(from instanceof Date) || !(until instanceof Date) || isNaN(+from) || isNaN(+until)) {
    return 'Informe início e fim da visita.';
  }
  if (until <= from) return 'O fim deve ser depois do início.';
  if (until <= now) return 'O fim da visita deve estar no futuro.';
  if (+until - +from > VISIT_MAX_DAYS * 86_400_000) {
    return `A visita pode durar no máximo ${VISIT_MAX_DAYS} dias.`;
  }
  return null;
}

/** Normaliza a placa como o banco (só letras/números, maiúsculas). Vazio vira null. @param {string} s */
export function normalizePlate(s) {
  const p = String(s ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
  return p === '' ? null : p;
}

/** @param {string | null} p @returns {string | null} */
export function validatePlate(p) {
  return p === null || /^[A-Z0-9]{5,8}$/.test(p) ? null : 'Placa inválida.';
}

/**
 * Pode fazer check-in agora? (convidado e dentro do período)
 * @param {{ status: string, valid_from: string, valid_until: string }} v @param {Date} [now]
 */
export function canCheckInNow(v, now = new Date()) {
  return v.status === 'invited' && now >= new Date(v.valid_from) && now < new Date(v.valid_until);
}
