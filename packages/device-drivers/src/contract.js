// Contrato HAL (domínio -> abstração -> driver -> protocolo/SDK -> dispositivo).
// O Edge Agent só conhece esta interface; drivers reais (com documentação oficial do fabricante) e o mock a implementam.
// Nenhum protocolo de fabricante é inventado aqui.

/** Tipos de evento que um driver pode emitir. */
export const HARDWARE_EVENT_TYPES = [
  'access.requested',
  'access.granted',
  'access.denied',
  'door.opened',
  'door.closed',
  'door.forced',
  'door.held_open',
  'device.online',
  'device.offline',
  'heartbeat',
  'clock_sync',
];

/** Códigos estáveis de resultado de comando. */
export const COMMAND_RESULT_CODES = [
  'OK',
  'DEVICE_OFFLINE',
  'TIMEOUT',
  'UNKNOWN_POINT',
  'INVALID_ARGUMENT',
  'INTERLOCK_DENIED',
];

export const MAX_UNLOCK_MS = 60_000;

/**
 * @typedef {{ type: string, pointId: string, at: string, data?: Record<string, unknown> }} HardwareEvent
 * @typedef {{ ok: boolean, code: string }} CommandResult
 * @typedef {{ online: boolean, door: 'closed' | 'open' | 'forced' | 'held_open', locked: boolean }} PointStatus
 *
 * Contrato de um driver de hardware.
 * @typedef {object} HardwareDriver
 * @property {string} kind identificador do driver (ex.: 'mock')
 * @property {(pointId: string, opts?: { durationMs?: number }) => Promise<CommandResult>} unlock
 *   destrava por tempo limitado e religa sozinho; quem chama é responsável por já ter autenticado/autorizado.
 * @property {(pointId: string) => Promise<CommandResult>} lock
 * @property {(pointId: string) => PointStatus | null} getStatus
 * @property {(handler: (e: HardwareEvent) => void) => () => void} onEvent devolve a função de cancelamento
 * @property {(now: Date) => void} tick avança o relógio interno (religar, porta mantida aberta)
 */

/** Valida a duração de destrava: inteiro positivo, até MAX_UNLOCK_MS. @param {unknown} ms */
export function isValidUnlockMs(ms) {
  const n = /** @type {number} */ (ms);
  return Number.isInteger(n) && n > 0 && n <= MAX_UNLOCK_MS;
}
