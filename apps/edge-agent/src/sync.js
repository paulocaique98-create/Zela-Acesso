// Sincronização do cache (Fase 4B). O transporte é injetado: o agente NUNCA guarda service_role; fala com uma
// Edge Function autenticada (4C) que chama `edge_pull_snapshot`. Aqui só a lógica de aplicar/atualizar/revogar.

import { SnapshotError, applySnapshot } from './snapshot.js';

/**
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   transport: { pullSnapshot: (knownHash: string | null) => Promise<null | { unchanged: boolean, hash: string, snapshot?: object }> },
 *   now: Date,
 * }} input
 * @returns {Promise<{ status: 'updated' | 'unchanged' | 'revoked' | 'offline' | 'rejected', error?: string }>}
 *   `revoked` = a nuvem recusou a credencial do agente: o cache (hashes de credenciais) é apagado.
 */
export async function syncSnapshot({ store, transport, now }) {
  const known = store.loadSnapshotRow()?.hash ?? null;
  let res;
  try {
    res = await transport.pullSnapshot(known);
  } catch (e) {
    return { status: 'offline', error: String(e?.message ?? e).slice(0, 200) };
  }
  if (res === null) {
    store.wipeCache();
    return { status: 'revoked' };
  }
  if (res.unchanged) {
    if (known && res.hash === known) {
      store.touchSnapshot(now.toISOString()); // confirmado em dia: renova a "idade" do cache
      return { status: 'unchanged' };
    }
    return { status: 'rejected', error: 'resposta "unchanged" sem hash correspondente' };
  }
  try {
    applySnapshot(store, { hash: res.hash, snapshot: res.snapshot }, now);
    return { status: 'updated' };
  } catch (e) {
    if (e instanceof SnapshotError) return { status: 'rejected', error: e.message };
    throw e;
  }
}
