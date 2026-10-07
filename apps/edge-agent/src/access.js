// Vertical slice do Edge (Fase 4D): credencial -> evaluateAccess (determinístico) -> evento na fila + presença -> HAL.
// O driver só é acionado se a decisão for de abertura (OPENING_DECISIONS); DENY/CHALLENGE/DEGRADED_DENY nunca chegam a ele.
// A decisão e o evento são gravados ANTES de acionar o hardware (a evidência existe mesmo se o driver falhar).
// Depois da atuação, o resultado (abriu / não abriu / desconhecido) vai à nuvem como evento `physical_outcome`
// na mesma fila (idempotente, ligado à decisão pela correlação); a decisão original nunca é alterada.

import { randomUUID } from 'node:crypto';
import { toPhysicalOutcomeParams } from '@zela/domain';
import { verifyBiometricAttempt } from './biometric.js';
import { processAccessAttempt } from './decide.js';

export const DEFAULT_UNLOCK_MS = 5_000;

/**
 * @param {Parameters<typeof processAccessAttempt>[0] & {
 *   driver: import('@zela/device-drivers').HardwareDriver,
 *   unlockMs?: number,
 *   biometricProvider?: import('@zela/biometrics').BiometricProvider,
 * }} input
 * @returns {Promise<ReturnType<typeof processAccessAttempt> & { actuation: { attempted: boolean, ok: boolean, code: string } }>}
 */
export async function handleAccessAttempt(input) {
  const { driver, unlockMs = DEFAULT_UNLOCK_MS, biometricProvider, ...attempt } = input;
  const newId = attempt.newId ?? randomUUID;
  // A verificação biométrica é assíncrona (provedor) e acontece ANTES da decisão síncrona/atômica.
  if (attempt.credential?.type === 'biometric')
    attempt.biometric = await verifyBiometricAttempt({
      store: attempt.store,
      personId: attempt.credential.personId,
      accessPointId: attempt.accessPointId,
      now: attempt.now,
      provider: biometricProvider,
    });
  const result = processAccessAttempt(attempt);
  if (!result.open)
    return { ...result, actuation: { attempted: false, ok: false, code: 'NOT_OPENED' } };
  let res;
  try {
    res = await driver.unlock(attempt.accessPointId, { durationMs: unlockMs });
  } catch {
    res = { ok: false, code: 'DRIVER_ERROR' };
  }
  const actuation = { attempted: true, ok: res.ok === true, code: res.code };
  const c = result.correlation;
  if (c) {
    const params = toPhysicalOutcomeParams({
      tenantId: c.tenantId,
      siteId: c.siteId,
      occurredAt: attempt.now,
      correlationId: c.correlationId,
      actuation,
      accessPointId: c.accessPointId,
      zoneId: c.zoneId,
      personId: c.personId,
      idempotencyKey: `edge:${newId()}`,
    });
    actuation.reported = attempt.store.enqueue(
      params.p_idempotency_key,
      params,
      attempt.now.toISOString(),
    );
  }
  return { ...result, actuation };
}
