// PIN do operador: guarda local da tela de configuração (não substitui a revogação na nuvem de um aparelho roubado).
// Só o hash PBKDF2 fica no aparelho. 5 erros seguidos travam por 5 minutos.
import { validatePin } from '@zela/domain';
import { constantTimeEqual, hashOperatorPin } from './crypto.js';

export const MAX_FAILURES = 5;
export const LOCK_MS = 5 * 60_000;

/** @returns {Promise<string | null>} mensagem de erro ou null se gravou */
export async function setOperatorPin(kv, pin) {
  const invalid = validatePin(pin);
  if (invalid) return invalid;
  const h = await hashOperatorPin(pin);
  await kv.set('operator', { ...h, failures: 0, lockedUntil: 0 });
  return null;
}

/** @returns {Promise<{ ok: boolean, lockedUntil?: number, remaining?: number }>} */
export async function verifyOperatorPin(kv, pin, nowMs = Date.now()) {
  const rec = await kv.get('operator');
  if (!rec) return { ok: false };
  if (rec.lockedUntil > nowMs) return { ok: false, lockedUntil: rec.lockedUntil };
  const h = await hashOperatorPin(String(pin), rec.salt, rec.iterations);
  if (constantTimeEqual(h.hash, rec.hash)) {
    await kv.set('operator', { ...rec, failures: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const failures = rec.failures + 1;
  const locked = failures >= MAX_FAILURES;
  await kv.set('operator', {
    ...rec,
    failures: locked ? 0 : failures,
    lockedUntil: locked ? nowMs + LOCK_MS : 0,
  });
  return locked
    ? { ok: false, lockedUntil: nowMs + LOCK_MS }
    : { ok: false, remaining: MAX_FAILURES - failures };
}
