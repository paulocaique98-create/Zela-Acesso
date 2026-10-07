// Vertical slice do Edge (Fase 4D): credencial -> evaluateAccess (determinístico) -> evento na fila + presença -> HAL.
// O driver só é acionado se a decisão for de abertura (OPENING_DECISIONS); DENY/CHALLENGE/DEGRADED_DENY nunca chegam a ele.
// A decisão e o evento são gravados ANTES de acionar o hardware (a evidência existe mesmo se o driver falhar).

import { processAccessAttempt } from './decide.js';

export const DEFAULT_UNLOCK_MS = 5_000;

/**
 * @param {Parameters<typeof processAccessAttempt>[0] & {
 *   driver: import('@zela/device-drivers').HardwareDriver,
 *   unlockMs?: number,
 * }} input
 * @returns {Promise<ReturnType<typeof processAccessAttempt> & { actuation: { attempted: boolean, ok: boolean, code: string } }>}
 */
export async function handleAccessAttempt(input) {
  const { driver, unlockMs = DEFAULT_UNLOCK_MS, ...attempt } = input;
  const result = processAccessAttempt(attempt);
  if (!result.open)
    return { ...result, actuation: { attempted: false, ok: false, code: 'NOT_OPENED' } };
  let res;
  try {
    res = await driver.unlock(attempt.accessPointId, { durationMs: unlockMs });
  } catch {
    res = { ok: false, code: 'DRIVER_ERROR' };
  }
  return { ...result, actuation: { attempted: true, ok: res.ok, code: res.code } };
}
