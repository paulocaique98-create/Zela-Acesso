// Zela Pass (D-027): contrato do leitor em tablet/celular. Funções puras, sem I/O nem relógio.
// O leitor NUNCA decide: envia a leitura ao Edge, que avalia com `evaluateAccess`. Mesmo protocolo em qualquer
// transporte (HTTPS, WebSocket, TCP/IP): o envelope é JSON; `body` vai como TEXTO e a assinatura cobre o hash desse texto.

/** @typedef {'pending' | 'active' | 'revoked'} ReaderStatus */
/** @typedef {'pin' | 'qr' | 'barcode'} ReaderMethod */
/** @typedef {'enroll' | 'attempt' | 'status'} ReaderMessageType */
/** @typedef {'REGISTERED' | 'NOT_AUTHORIZED' | 'INVALID_CREDENTIAL' | 'CHALLENGE_REQUIRED' | 'UNAVAILABLE'} ReaderOutcome */

export const READER_PROTOCOL_VERSION = 1;
export const READER_STATUSES = ['pending', 'active', 'revoked'];
export const READER_METHODS = ['pin', 'qr', 'barcode'];
export const READER_MESSAGE_TYPES = ['enroll', 'attempt', 'status'];
export const READER_TRANSPORTS = ['https', 'websocket', 'tcp'];
export const POINT_ACTUATIONS = ['driver', 'none'];

export const READER_NAME_MIN = 2;
export const READER_NAME_MAX = 120;
export const READER_CLOCK_SKEW_MS = 120_000; // mesma janela do agente (D-022)
export const READER_VALUE_MAX = 256;

export const READER_STATUS_LABEL = {
  pending: 'Aguardando ativação',
  active: 'Ativo',
  revoked: 'Revogado',
};
export const READER_METHOD_LABEL = { pin: 'Senha', qr: 'QR Code', barcode: 'Código de barras' };
export const POINT_ACTUATION_LABEL = {
  driver: 'Com atuação (abre porta/catraca)',
  none: 'Somente registro (sem atuar)',
};
/** Texto curto mostrado no leitor: nunca o motivo detalhado (fica na evidência). */
export const READER_OUTCOME_LABEL = {
  REGISTERED: 'Registrado',
  NOT_AUTHORIZED: 'Não autorizado',
  INVALID_CREDENTIAL: 'Credencial inválida',
  CHALLENGE_REQUIRED: 'Confirmação adicional necessária',
  UNAVAILABLE: 'Sem conexão com o Edge',
};

const DEVICE_EVENT_RE = /^[A-Za-z0-9_.:-]{8,64}$/;
const NONCE_RE = /^[0-9a-f]{16,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENROLL_CODE_RE = /^zrd_[0-9a-f]{64}$/;
const PUB_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const IDENTIFIER_RE = /^[0-9A-Za-z._-]{1,40}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** @param {string} name @returns {string | null} */
export function validateReaderName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n.length >= READER_NAME_MIN && n.length <= READER_NAME_MAX
    ? null
    : `O nome do leitor deve ter de ${READER_NAME_MIN} a ${READER_NAME_MAX} caracteres.`;
}

export const isEnrollmentCode = (s) => typeof s === 'string' && ENROLL_CODE_RE.test(s);

/**
 * Texto que o leitor assina (e o Edge confere). Cada campo é validado sem quebra de linha.
 * @param {{ type: string, readerId: string, ts: number, nonce: string, bodyHash: string }} m
 */
export function readerSigningString(m) {
  return [
    `zela-reader/v${READER_PROTOCOL_VERSION}`,
    m.type,
    m.readerId,
    String(m.ts),
    m.nonce,
    m.bodyHash,
  ].join('\n');
}

/**
 * Valida a FORMA do envelope (não confere assinatura nem relógio: isso é do Edge).
 * @param {unknown} raw
 * @returns {{ ok: true, msg: { v: number, type: ReaderMessageType, readerId: string, ts: number, nonce: string, body: string, sig: string } } | { ok: false, code: string }}
 */
export function parseReaderEnvelope(raw) {
  const bad = (code) => ({ ok: false, code });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('MALFORMED');
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (m.v !== READER_PROTOCOL_VERSION) return bad('UNSUPPORTED_VERSION');
  if (typeof m.type !== 'string' || !READER_MESSAGE_TYPES.includes(m.type)) return bad('MALFORMED');
  if (m.type === 'enroll' ? m.readerId !== 'enroll' : !UUID_RE.test(String(m.readerId)))
    return bad('MALFORMED');
  if (!Number.isSafeInteger(m.ts)) return bad('MALFORMED');
  if (typeof m.nonce !== 'string' || !NONCE_RE.test(m.nonce)) return bad('MALFORMED');
  if (typeof m.body !== 'string' || m.body.length > 2048) return bad('MALFORMED');
  if (typeof m.sig !== 'string' || !SIG_RE.test(m.sig)) return bad('MALFORMED');
  return {
    ok: true,
    msg: {
      v: 1,
      type: /** @type {ReaderMessageType} */ (m.type),
      readerId: String(m.readerId),
      ts: /** @type {number} */ (m.ts),
      nonce: m.nonce,
      body: m.body,
      sig: m.sig,
    },
  };
}

/** @param {number} ts @param {number} nowMs */
export const isWithinReaderClockSkew = (ts, nowMs) => Math.abs(nowMs - ts) <= READER_CLOCK_SKEW_MS;

/**
 * Corpo de `enroll`: código de ativação + chave pública gerada no aparelho (a privada nunca sai dele).
 * @param {unknown} raw
 * @returns {{ ok: true, value: { code: string, publicKey: string, label: string } } | { ok: false, code: string }}
 */
export function parseEnrollBody(raw) {
  const o = safeJson(raw);
  if (
    !o ||
    !isEnrollmentCode(o.code) ||
    typeof o.publicKey !== 'string' ||
    !PUB_RE.test(o.publicKey)
  )
    return { ok: false, code: 'MALFORMED' };
  const label = typeof o.label === 'string' ? o.label.replace(CONTROL_RE, ' ').slice(0, 80) : '';
  return { ok: true, value: { code: o.code, publicKey: o.publicKey, label } };
}

/**
 * Corpo de `attempt`.
 *  - pin: { method:'pin', identifier, pin }   (identificador = matrícula/identificador da pessoa)
 *  - qr: { method:'qr', value }               (token móvel)
 *  - barcode: { method:'barcode', value }     (número de cartão/credencial)
 * @param {unknown} raw texto JSON ou objeto
 * @returns {{ ok: true, value: { method: ReaderMethod, deviceEventId: string, identifier?: string, pin?: string, value?: string } } | { ok: false, code: string }}
 */
export function parseAttemptBody(raw) {
  const o = safeJson(raw);
  const bad = { ok: false, code: 'MALFORMED' };
  if (!o || !READER_METHODS.includes(o.method)) return bad;
  if (typeof o.deviceEventId !== 'string' || !DEVICE_EVENT_RE.test(o.deviceEventId)) return bad;
  if (o.method === 'pin') {
    if (typeof o.identifier !== 'string' || !IDENTIFIER_RE.test(o.identifier)) return bad;
    if (typeof o.pin !== 'string' || !/^[0-9]{6,8}$/.test(o.pin)) return bad;
    return {
      ok: true,
      value: {
        method: 'pin',
        deviceEventId: o.deviceEventId,
        identifier: o.identifier,
        pin: o.pin,
      },
    };
  }
  if (typeof o.value !== 'string' || o.value.length < 4 || o.value.length > READER_VALUE_MAX)
    return bad;
  if (CONTROL_RE.test(o.value)) return bad;
  return { ok: true, value: { method: o.method, deviceEventId: o.deviceEventId, value: o.value } };
}

/**
 * Resposta ao leitor a partir da decisão do motor. Não vaza o motivo: só uma categoria.
 * @param {{ decision: string, reasonCode: string }} d
 * @returns {ReaderOutcome}
 */
export function readerOutcome(d) {
  if (d.decision === 'ALLOW' || d.decision === 'DEGRADED_ALLOW') return 'REGISTERED';
  if (d.decision === 'CHALLENGE') return 'CHALLENGE_REQUIRED';
  if (['CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED', 'BIOMETRIC_REJECTED'].includes(d.reasonCode))
    return 'INVALID_CREDENTIAL';
  return 'NOT_AUTHORIZED';
}

function safeJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Normaliza o identificador da pessoa (matrícula) como o banco: sem espaços nas pontas, maiúsculo. */
export const normalizePersonRef = (raw) => String(raw).trim().toUpperCase();
