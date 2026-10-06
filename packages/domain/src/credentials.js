// Regras de credencial espelhadas de public.issue_credential (o banco e a fonte de verdade;
// aqui so para dar retorno imediato na tela). Nada aqui faz hash nem guarda segredo.

/** @typedef {'pin' | 'card' | 'mobile_token'} CredentialType */
/** @typedef {'active' | 'suspended' | 'revoked'} CredentialStatus */

export const TOKEN_MAX_DAYS = 366;

/**
 * @param {string} pin
 * @returns {string | null} mensagem de erro, ou null se o PIN e aceitavel
 */
export function validatePin(pin) {
  if (!/^[0-9]{6,8}$/.test(pin)) return 'O PIN deve ter de 6 a 8 dígitos.';
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return 'PIN muito previsível (repetido ou sequência).';
  }
  return null;
}

/**
 * Normaliza o numero do cartao como o banco: so alfanumerico, maiusculo.
 * @param {string} raw
 */
export function normalizeCardNumber(raw) {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
export function validateCardNumber(raw) {
  const n = normalizeCardNumber(raw);
  return n.length >= 4 && n.length <= 32 ? null : 'Número do cartão inválido.';
}

/**
 * @param {number} days
 * @returns {string | null}
 */
export function validateTokenDays(days) {
  return Number.isInteger(days) && days >= 1 && days <= TOKEN_MAX_DAYS
    ? null
    : `A validade deve ser de 1 a ${TOKEN_MAX_DAYS} dias.`;
}
