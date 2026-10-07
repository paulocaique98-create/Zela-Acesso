// Heartbeat periódico (Fase 4C): informa versão, fila e hora do agente; guarda a deriva e avalia o relógio.

import { loadClockStatus } from './clock.js';

/**
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   transport: { heartbeat: (info: { version: string, agentTime: string, queueDepth: number }) => Promise<null | { serverTime: string, clockDriftSeconds: number | null }> },
 *   now: Date,
 *   version: string,
 *   clockConfig?: Parameters<typeof import('./clock.js').assessClock>[0]['config'],
 * }} input
 * @returns {Promise<{ status: 'ok' | 'offline' | 'revoked', clock: ReturnType<typeof import('./clock.js').assessClock>, error?: string }>}
 *   `revoked`: credencial recusada; o cache é apagado (como em `syncSnapshot`).
 */
export async function sendHeartbeat({ store, transport, now, version, clockConfig }) {
  const clockNow = () => loadClockStatus(store, now, clockConfig);
  let res;
  try {
    res = await transport.heartbeat({
      version,
      agentTime: now.toISOString(),
      queueDepth: store.queueDepth(),
    });
  } catch (e) {
    return { status: 'offline', clock: clockNow(), error: String(e?.message ?? e).slice(0, 200) };
  }
  if (res === null) {
    store.wipeCache();
    return { status: 'revoked', clock: { status: 'untrusted', reasons: ['AGENT_REVOKED'] } };
  }
  if (res.clockDriftSeconds !== null && Number.isFinite(res.clockDriftSeconds)) {
    store.setMeta('clock_drift_s', String(res.clockDriftSeconds));
    store.setMeta('clock_checked_at', now.toISOString());
  }
  return { status: 'ok', clock: clockNow() };
}
