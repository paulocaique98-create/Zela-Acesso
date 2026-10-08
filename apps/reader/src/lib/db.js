// Armazenamento local do leitor: IndexedDB (aceita CryptoKey não extraível) com reserva em memória.
// Guarda: identidade do aparelho (chave privada não extraível, id do leitor, ponto), PIN do operador (só hash),
// ajustes e os últimos registros. NUNCA guarda senha digitada, token nem número de cartão.

const DB_NAME = 'zela-pass';
const STORE = 'kv';

/** @returns {{ get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void>, del: (k: string) => Promise<void>, persistent: boolean }} */
export function openKv(idb = globalThis.indexedDB) {
  const memory = new Map();
  const fallback = {
    persistent: false,
    get: async (k) => memory.get(k),
    set: async (k, v) => void memory.set(k, v),
    del: async (k) => void memory.delete(k),
  };
  if (!idb) return fallback;
  let dbp = null;
  const db = () =>
    (dbp ??= new Promise((ok, fail) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    }));
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((ok, fail) => {
      const tx = d.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  };
  return {
    persistent: true,
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
}
