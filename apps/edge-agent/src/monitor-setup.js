// Configura os terminais Control iD na partida: aponta o Monitor (e o Push, nos pontos em modo push) para este Edge.
// Idempotente: pode repetir. Falha de um terminal não impede os outros nem derruba o daemon; quem falhou é retentado.

/**
 * @param {{ driver: { configureMonitor: Function, configurePush: Function },
 *   points: Record<string, { transport?: string }>, hostname: string, port: number }} cfg
 * @returns {Promise<{ pending: string[], done: string[] }>} pendentes (a retentar) e concluídos
 */
export async function setupTerminals({ driver, points, hostname, port, only }) {
  const pending = [];
  const done = [];
  for (const id of only ?? Object.keys(points)) {
    let ok;
    try {
      const m = await driver.configureMonitor(id, { hostname, port });
      ok = m.ok;
      if (ok && points[id]?.transport === 'push')
        ok = (await driver.configurePush(id, { hostname, port })).ok;
    } catch {
      ok = false;
    }
    (ok ? done : pending).push(id);
  }
  return { pending, done };
}

/**
 * Tenta agora e retenta os pendentes a cada `retryMs` até concluir ou `signal` abortar.
 * @returns {Promise<void>} resolve quando o primeiro ciclo termina (os retries seguem em segundo plano)
 */
export async function startTerminalSetup({ retryMs = 60_000, signal, log = () => {}, ...cfg }) {
  let state = await setupTerminals(cfg);
  const report = () =>
    log(`terminais configurados=${state.done.length} pendentes=${state.pending.length}`);
  report();
  if (state.pending.length === 0) return;
  const timer = setInterval(async () => {
    const r = await setupTerminals({ ...cfg, only: state.pending });
    state = { pending: r.pending, done: [...state.done, ...r.done] };
    report();
    if (state.pending.length === 0) clearInterval(timer);
  }, retryMs);
  timer.unref();
  signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
}
