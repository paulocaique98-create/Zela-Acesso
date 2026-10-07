// Comandos de dispositivo vindos da nuvem (Fase 4D): assinados, com expiração e anti-replay.
// Nenhum comando local de abertura sem autenticação: assinatura HMAC-SHA256 com chave por agente,
// vínculo ao agente, janela de validade curta e id de uso único. A decisão de abrir NÃO está aqui
// (é do motor determinístico); aqui só se verifica que a ordem é autêntica, fresca e inédita.
// O emissor (assinatura na nuvem) e a distribuição da chave de comando ao agente são PENDENTES.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COMMAND_ACTIONS = ['unlock', 'lock'];
export const COMMAND_LIMITS = {
  maxTtlMs: 60_000, // expires_at - issued_at
  skewMs: 30_000, // tolerância de relógio para issued_at no futuro
};
const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * @typedef {{
 *   v: 1, id: string, agent_id: string, action: 'unlock' | 'lock', point_id: string,
 *   duration_ms?: number, issued_at: string, expires_at: string, signature?: string
 * }} SignedCommand
 */

/** Forma canônica sem ambiguidade (array de posições fixas), independente da ordem das chaves. @param {SignedCommand} c */
export function canonicalCommand(c) {
  return JSON.stringify([
    c.v,
    c.id,
    c.agent_id,
    c.action,
    c.point_id,
    c.duration_ms ?? null,
    c.issued_at,
    c.expires_at,
  ]);
}

/** @param {Omit<SignedCommand, 'signature'>} cmd @param {string | Buffer} key */
export function signCommand(cmd, key) {
  const signature = createHmac('sha256', key)
    .update(canonicalCommand(/** @type {SignedCommand} */ (cmd)))
    .digest('hex');
  return { ...cmd, signature };
}

const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/**
 * Verifica e executa. Ordem: formato → agente → assinatura → validade → anti-replay → driver.
 * O id só é consumido depois de assinatura e validade corretas (quem não assina não enche a tabela).
 * Um comando que chega ao driver consome o id mesmo se o driver falhar: nova tentativa exige novo comando.
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   driver: import('@zela/device-drivers').HardwareDriver,
 *   key: string | Buffer,
 *   agentId: string,
 *   now: Date,
 *   command: unknown,
 *   limits?: Partial<typeof COMMAND_LIMITS>,
 * }} input
 * @returns {Promise<{ status: 'executed' | 'failed' | 'rejected', code: string }>}
 */
export async function handleCommand({ store, driver, key, agentId, now, command, limits }) {
  const lim = { ...COMMAND_LIMITS, ...limits };
  const reject = (code) => ({ status: /** @type {const} */ ('rejected'), code });
  const c = /** @type {any} */ (command);

  if (
    !c ||
    typeof c !== 'object' ||
    c.v !== 1 ||
    typeof c.id !== 'string' ||
    !ID_RE.test(c.id) ||
    typeof c.agent_id !== 'string' ||
    !COMMAND_ACTIONS.includes(c.action) ||
    typeof c.point_id !== 'string' ||
    !c.point_id ||
    !isIso(c.issued_at) ||
    !isIso(c.expires_at) ||
    typeof c.signature !== 'string' ||
    (c.duration_ms !== undefined && !Number.isInteger(c.duration_ms))
  )
    return reject('MALFORMED');

  if (c.agent_id !== agentId) return reject('WRONG_AGENT');

  const expected = createHmac('sha256', key).update(canonicalCommand(c)).digest();
  const given = /^[0-9a-f]{64}$/.test(c.signature) ? Buffer.from(c.signature, 'hex') : null;
  if (!given || !timingSafeEqual(given, expected)) return reject('BAD_SIGNATURE');

  const issued = Date.parse(c.issued_at);
  const expires = Date.parse(c.expires_at);
  if (expires <= issued || expires - issued > lim.maxTtlMs) return reject('INVALID_WINDOW');
  if (issued > now.getTime() + lim.skewMs) return reject('NOT_YET_VALID');
  if (expires <= now.getTime()) return reject('EXPIRED');

  // a linha do id sobrevive um pouco além da expiração (tolerância), depois é purgada
  if (!store.claimCommand(c.id, new Date(expires + lim.skewMs).toISOString()))
    return reject('REPLAY');
  store.purgeCommands(now.toISOString());

  const res =
    c.action === 'unlock'
      ? await driver.unlock(
          c.point_id,
          c.duration_ms === undefined ? {} : { durationMs: c.duration_ms },
        )
      : await driver.lock(c.point_id);
  return { status: res.ok ? 'executed' : 'failed', code: res.code };
}
