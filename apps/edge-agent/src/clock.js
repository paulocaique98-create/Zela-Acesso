// Política sobre o relógio do host (Fase 4C). Limites são HIPÓTESE a calibrar por cliente.
// A deriva vem do heartbeat (diferença entre a hora do agente e a do servidor).

export const DEFAULT_CLOCK_CONFIG = {
  warnDriftSeconds: 60, // acima: alerta
  untrustedDriftSeconds: 300, // acima: hora não confiável
  maxSilenceMs: 24 * 3_600_000, // sem contato com a nuvem por mais que isso: a deriva conhecida está velha
};

/**
 * @param {{ driftSeconds: number | null, lastContactAt: string | null, now: Date, config?: Partial<typeof DEFAULT_CLOCK_CONFIG> }} input
 * @returns {{ status: 'ok' | 'warn' | 'untrusted', reasons: string[] }}
 *   `untrusted`: decisões dependentes de hora (janelas, validade, anti-passback) merecem cautela e a evidência deve registrá-lo.
 */
export function assessClock({ driftSeconds, lastContactAt, now, config }) {
  const c = { ...DEFAULT_CLOCK_CONFIG, ...config };
  if (driftSeconds === null || !lastContactAt) {
    return { status: 'untrusted', reasons: ['CLOCK_NEVER_VERIFIED'] };
  }
  const reasons = [];
  let status = /** @type {'ok' | 'warn' | 'untrusted'} */ ('ok');
  const abs = Math.abs(driftSeconds);
  if (abs > c.untrustedDriftSeconds) {
    status = 'untrusted';
    reasons.push('CLOCK_DRIFT_HIGH');
  } else if (abs > c.warnDriftSeconds) {
    status = 'warn';
    reasons.push('CLOCK_DRIFT_WARN');
  }
  const silence = now.getTime() - new Date(lastContactAt).getTime();
  if (!Number.isFinite(silence) || silence > c.maxSilenceMs) {
    status = 'untrusted';
    reasons.push('CLOCK_UNVERIFIED_LONG');
  }
  return { status, reasons };
}

/** Lê a última deriva conhecida (gravada pelo heartbeat) e avalia o relógio agora. */
export function loadClockStatus(store, now, config) {
  const d = store.getMeta('clock_drift_s');
  return assessClock({
    driftSeconds: d === null ? null : Number(d),
    lastContactAt: store.getMeta('clock_checked_at'),
    now,
    config,
  });
}
