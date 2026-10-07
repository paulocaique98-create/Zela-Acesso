// Mock Hardware Adapter: simula leitor, fechadura e sensor de porta atrás do contrato HAL.
// Só para dev/teste: recusa-se a existir em produção. Determinístico (o tempo vem de tick()).

import { isValidUnlockMs } from './contract.js';

const DEFAULT_UNLOCK_MS = 5_000;

/**
 * @param {{ points: string[], holdOpenMs?: number, now?: Date, env?: string }} cfg
 * @returns {import('./contract.js').HardwareDriver & Record<string, any>}
 */
export function createMockHardware({ points, holdOpenMs = 30_000, now = new Date(0), env }) {
  if ((env ?? process.env.NODE_ENV) === 'production')
    throw new Error('MockHardware não pode ser usado em produção');

  let clock = now;
  const handlers = new Set();
  /** @type {Map<string, any>} */
  const state = new Map(
    points.map((id) => [
      id,
      {
        online: true,
        door: 'closed',
        locked: true,
        unlockedUntil: 0,
        openedAt: 0,
        heldFlagged: false,
      },
    ]),
  );
  const faults = { timeoutNext: 0, duplicateNext: 0 };
  const log = /** @type {import('./contract.js').HardwareEvent[]} */ ([]);

  const emit = (type, pointId, data) => {
    const e = { type, pointId, at: clock.toISOString(), ...(data ? { data } : {}) };
    log.push(e);
    const times = faults.duplicateNext > 0 ? 2 : 1;
    if (faults.duplicateNext > 0) faults.duplicateNext--;
    for (let i = 0; i < times; i++) for (const h of handlers) h(e);
  };
  const get = (id) => state.get(id) ?? null;

  return {
    kind: 'mock',
    log,
    faults,

    async unlock(pointId, opts = {}) {
      const p = get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      const durationMs = opts.durationMs ?? DEFAULT_UNLOCK_MS;
      if (!isValidUnlockMs(durationMs)) return { ok: false, code: 'INVALID_ARGUMENT' };
      if (!p.online) return { ok: false, code: 'DEVICE_OFFLINE' };
      if (faults.timeoutNext > 0) {
        faults.timeoutNext--;
        return { ok: false, code: 'TIMEOUT' };
      }
      p.locked = false;
      p.unlockedUntil = clock.getTime() + durationMs;
      return { ok: true, code: 'OK' };
    },
    async lock(pointId) {
      const p = get(pointId);
      if (!p) return { ok: false, code: 'UNKNOWN_POINT' };
      if (!p.online) return { ok: false, code: 'DEVICE_OFFLINE' };
      p.locked = true;
      p.unlockedUntil = 0;
      return { ok: true, code: 'OK' };
    },
    getStatus: (pointId) => {
      const p = get(pointId);
      return p ? { online: p.online, door: p.door, locked: p.locked } : null;
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    tick(next) {
      clock = next;
      const t = next.getTime();
      for (const [id, p] of state) {
        if (!p.locked && p.unlockedUntil && t >= p.unlockedUntil) {
          p.locked = true;
          p.unlockedUntil = 0;
        }
        if (p.door === 'open' && !p.heldFlagged && t - p.openedAt >= holdOpenMs) {
          p.door = 'held_open';
          p.heldFlagged = true;
          emit('door.held_open', id);
        }
      }
    },

    // ---- simulação (não faz parte do contrato HAL)
    setOnline(pointId, online) {
      const p = get(pointId);
      if (!p || p.online === online) return;
      p.online = online;
      emit(online ? 'device.online' : 'device.offline', pointId);
    },
    /** Leitura de credencial: emite access.requested; a decisão volta por grant()/deny(). */
    presentCredential(pointId, { valid = true } = {}) {
      const p = get(pointId);
      if (!p || !p.online) return false;
      emit('access.requested', pointId, { credentialValid: valid });
      return true;
    },
    grant: (pointId) => emit('access.granted', pointId),
    deny: (pointId) => emit('access.denied', pointId),
    /** Abrir a porta: se estava travada, é arrombamento (door.forced). */
    openDoor(pointId) {
      const p = get(pointId);
      if (!p) return;
      p.openedAt = clock.getTime();
      p.heldFlagged = false;
      if (p.locked) {
        p.door = 'forced';
        emit('door.forced', pointId);
      } else {
        p.door = 'open';
        emit('door.opened', pointId);
      }
    },
    closeDoor(pointId) {
      const p = get(pointId);
      if (!p || p.door === 'closed') return;
      p.door = 'closed';
      emit('door.closed', pointId);
    },
    heartbeat: (pointId) => emit('heartbeat', pointId),
    clockSync: (pointId, data) => emit('clock_sync', pointId, data),
  };
}
