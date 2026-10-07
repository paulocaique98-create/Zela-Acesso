// Laço de agendamento do agente (Fase 4C): heartbeat, sincronização do cache e drenagem da fila.
// Tudo injetado (transporte, relógio, timers) para testar sem rede nem espera. Revogação em qualquer etapa
// para o laço: um agente revogado não tenta mais falar com a nuvem (o cache já foi apagado pela etapa).

import { drainQueue } from './drain.js';
import { sendHeartbeat } from './heartbeat.js';
import { syncSnapshot } from './sync.js';

export const DEFAULT_INTERVALS = {
  heartbeatMs: 60_000,
  syncMs: 5 * 60_000, // também é o teto do limite conhecido "cartão revogado vale até o próximo sync"
  drainMs: 10_000,
};

/**
 * Uma rodada: executa as tarefas vencidas. Devolve o estado e o que rodou.
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   transport: object,
 *   now: Date,
 *   version: string,
 *   last: { heartbeat?: number, sync?: number, drain?: number },
 *   intervals?: Partial<typeof DEFAULT_INTERVALS>,
 *   random?: () => number,
 * }} input
 * @returns {Promise<{ revoked: boolean, ran: string[], results: Record<string, any> }>}
 */
export async function runOnce({ store, transport, now, version, last, intervals, random }) {
  const iv = { ...DEFAULT_INTERVALS, ...intervals };
  const due = (k, ms) => last[k] === undefined || now.getTime() - last[k] >= ms;
  const out = { revoked: false, ran: /** @type {string[]} */ ([]), results: {} };

  // Heartbeat primeiro: atualiza a deriva do relógio antes de sincronizar/entregar.
  if (due('heartbeat', iv.heartbeatMs)) {
    out.ran.push('heartbeat');
    last.heartbeat = now.getTime();
    out.results.heartbeat = await sendHeartbeat({ store, transport, now, version });
    if (out.results.heartbeat.status === 'revoked') return { ...out, revoked: true };
  }
  if (due('sync', iv.syncMs)) {
    out.ran.push('sync');
    last.sync = now.getTime();
    out.results.sync = await syncSnapshot({ store, transport, now });
    if (out.results.sync.status === 'revoked') return { ...out, revoked: true };
  }
  if (due('drain', iv.drainMs)) {
    out.ran.push('drain');
    last.drain = now.getTime();
    out.results.drain = await drainQueue({ store, transport, now, random });
    if (out.results.drain.status === 'revoked') return { ...out, revoked: true };
  }
  return out;
}

/**
 * Laço contínuo. Uma rodada que lança (bug inesperado) não derruba o processo: registra e segue.
 * @param {Parameters<typeof runOnce>[0] & { tickMs?: number, signal?: AbortSignal, sleep?: (ms: number) => Promise<void>, clock?: () => Date, onResult?: (r: Awaited<ReturnType<typeof runOnce>>) => void, onError?: (e: unknown) => void }} cfg
 */
export async function runLoop(cfg) {
  const {
    tickMs = 5_000,
    signal,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    clock = () => new Date(),
    onResult,
    onError,
    ...rest
  } = cfg;
  const last = rest.last ?? {};
  while (!signal?.aborted) {
    try {
      const r = await runOnce({ ...rest, now: clock(), last });
      onResult?.(r);
      if (r.revoked) return 'revoked';
    } catch (e) {
      onError?.(e);
    }
    await sleep(tickMs);
  }
  return 'stopped';
}
