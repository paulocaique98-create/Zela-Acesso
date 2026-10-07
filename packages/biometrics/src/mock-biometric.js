// MockBiometricProvider: só para dev/teste; recusa produção. Determinístico, sem imagem nem gabarito.
// Simula: match, no match, baixa confiança, liveness aprovado/rejeitado, indisponível e timeout.

/**
 * @param {{ liveness?: boolean, env?: string }} [cfg]
 * @returns {import('./contract.js').BiometricProvider & { script: (...r: import('./contract.js').BiometricResult[]) => void, calls: number }}
 */
export function createMockBiometricProvider({ liveness = true, env } = {}) {
  if ((env ?? process.env.NODE_ENV) === 'production')
    throw new Error('MockBiometricProvider não pode ser usado em produção');

  const queue = /** @type {import('./contract.js').BiometricResult[]} */ ([]);
  const live = liveness ? 'PASSED' : 'UNSUPPORTED';
  const provider = {
    kind: 'mock',
    capabilities: { liveness, engine: 'mock', engineVersion: '0' },
    calls: 0,
    /** Enfileira os próximos resultados; sem fila, devolve NO_MATCH (fail-closed). */
    script(...results) {
      queue.push(...results);
    },
    async verify(probe) {
      provider.calls++;
      if (!probe || typeof probe.subjectRef !== 'string' || !probe.subjectRef)
        return { status: 'ERROR', score: 0, liveness: 'UNSUPPORTED', error: 'UNAVAILABLE' };
      return queue.shift() ?? { status: 'NO_MATCH', score: 0, liveness: live };
    },
  };
  return provider;
}

/** Resultados prontos para os cenários exigidos. */
export const MOCK_SCENARIOS = {
  match: { status: 'MATCH', score: 0.97, liveness: 'PASSED' },
  noMatch: { status: 'NO_MATCH', score: 0.2, liveness: 'PASSED' },
  lowConfidence: { status: 'MATCH', score: 0.82, liveness: 'PASSED' },
  livenessFailed: { status: 'MATCH', score: 0.97, liveness: 'FAILED' },
  unavailable: { status: 'ERROR', score: 0, liveness: 'UNSUPPORTED', error: 'UNAVAILABLE' },
  timeout: { status: 'ERROR', score: 0, liveness: 'UNSUPPORTED', error: 'TIMEOUT' },
};
