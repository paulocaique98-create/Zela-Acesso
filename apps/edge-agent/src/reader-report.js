// Zela Pass (D-027): informa à nuvem os leitores ativados AQUI (código conferido, chave pública registrada), para o
// painel mostrar "Ativo" e o código de ativação deixar de existir no snapshot. Idempotente; falha de rede = tenta depois.
// Só vão a chave PÚBLICA e o rótulo: nunca o código de ativação.

/**
 * @param {{ store: ReturnType<import('./store.js').openStore>, transport: { reportReaderEnrolled: Function }, now: Date }} input
 * @returns {Promise<{ status: 'idle' | 'ok' | 'offline' | 'revoked', reported: number }>}
 */
export async function reportEnrolledReaders({ store, transport, now }) {
  const pending = store.unreportedReaders();
  if (pending.length === 0) return { status: 'idle', reported: 0 };
  let reported = 0;
  for (const r of pending) {
    let res;
    try {
      res = await transport.reportReaderEnrolled(r.readerId, r.publicKey, r.label ?? null);
    } catch {
      return { status: 'offline', reported };
    }
    if (res === null) return { status: 'revoked', reported }; // agente revogado
    // recorded:false = a nuvem não aceita (já ativo, revogado ou inexistente): não adianta insistir
    store.markReaderReported(r.readerId, now.toISOString());
    reported += 1;
  }
  return { status: 'ok', reported };
}
