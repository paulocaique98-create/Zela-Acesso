// Drenagem da fila de eventos (Fase 4C). Transporte injetado. Ordem de `id`, lotes limitados, backoff com jitter.
// Reenvio é seguro: a nuvem deduplica pela chave de idempotência (`duplicate` conta como entregue).

/**
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   transport: { sendEvents: (events: object[]) => Promise<null | { results: { idempotencyKey: string, status: string, reason?: string }[] }> },
 *   now: Date,
 *   batchSize?: number,
 *   maxBatches?: number,
 *   random?: () => number,
 * }} input
 * @returns {Promise<{ status: 'idle' | 'drained' | 'partial' | 'offline' | 'revoked', sent: number, rejected: number, failed: number, error?: string }>}
 *   `revoked`: a nuvem recusou a credencial; o cache é apagado e a fila fica intacta (análise forense, sem reenvio).
 */
export async function drainQueue({
  store,
  transport,
  now,
  batchSize = 50,
  maxBatches = 10,
  random = Math.random,
}) {
  const out = { status: /** @type {any} */ ('idle'), sent: 0, rejected: 0, failed: 0 };
  for (let b = 0; b < maxBatches; b++) {
    const due = store.dueEvents(now.toISOString(), batchSize);
    if (due.length === 0) break;
    let res;
    try {
      res = await transport.sendEvents(due.map((d) => d.payload));
    } catch (e) {
      for (const d of due) store.markFailed(d.id, now, e?.message ?? e, random());
      out.failed += due.length;
      out.status = 'offline';
      out.error = String(e?.message ?? e).slice(0, 200);
      return out;
    }
    if (res === null) {
      store.wipeCache();
      out.status = 'revoked';
      return out;
    }
    const byKey = new Map((res.results ?? []).map((r) => [r.idempotencyKey, r]));
    let progressed = false;
    for (const d of due) {
      const r = byKey.get(d.idempotencyKey);
      if (r && (r.status === 'recorded' || r.status === 'duplicate')) {
        store.markSent(d.id, now.toISOString());
        out.sent++;
        progressed = true;
      } else if (r && r.status === 'rejected') {
        store.markRejected(d.id, now.toISOString(), r.reason ?? 'REJECTED');
        out.rejected++;
        progressed = true;
      } else {
        store.markFailed(d.id, now, 'sem resultado da nuvem', random()); // resposta incompleta: tenta de novo
        out.failed++;
      }
    }
    out.status = out.failed > 0 ? 'partial' : 'drained';
    if (!progressed) break; // nada avançou: evita laço; o backoff cuida da próxima tentativa
  }
  return out;
}
