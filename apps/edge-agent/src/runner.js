// Laço de agendamento do agente (Fase 4C): heartbeat, sincronização do cache e drenagem da fila.
// Tudo injetado (transporte, relógio, timers) para testar sem rede nem espera. Revogação em qualquer etapa
// para o laço: um agente revogado não tenta mais falar com a nuvem (o cache já foi apagado pela etapa).

import { runBiometricErasures } from './biometric.js';
import { pollAndRunCommands } from './command-poll.js';
import { drainQueue } from './drain.js';
import { reportEnrolledReaders } from './reader-report.js';
import { sendHeartbeat } from './heartbeat.js';
import { syncRosters } from './roster.js';
import { syncSnapshot } from './sync.js';

export const DEFAULT_INTERVALS = {
  heartbeatMs: 60_000,
  syncMs: 5 * 60_000, // também é o teto do limite conhecido "cartão revogado vale até o próximo sync"
  drainMs: 10_000,
  commandsMs: 5_000, // latência de uma abertura remota
  readersMs: 15_000, // leitores Zela Pass ativados aqui e ainda não informados à nuvem
  rosterMs: 60_000, // usuários do terminal Standalone: janelas de horário e revogações valem com até este atraso
};

/**
 * Uma rodada: executa as tarefas vencidas. Devolve o estado e o que rodou.
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   transport: object,
 *   now: Date,
 *   version: string,
 *   last: { heartbeat?: number, sync?: number, drain?: number, commands?: number, roster?: number, readers?: number },
 *   intervals?: Partial<typeof DEFAULT_INTERVALS>,
 *   random?: () => number,
 *   biometricProvider?: object | null, // omitido = Edge sem biometria (não roda a fila); null = sem provedor (perfis ficam na fila)
 *   commands?: { driver: object, key?: string | Buffer | Array<string | Buffer>, keyring?: object, agentId: string } | null, // omitido = Edge sem comando remoto
 *   roster?: { driver: { syncRoster: Function }, pointIds: string[] } | null, // omitido = sem sincronização de usuários do terminal
 * }} input
 * @returns {Promise<{ revoked: boolean, ran: string[], results: Record<string, any> }>}
 */
export async function runOnce({
  store,
  transport,
  now,
  version,
  last,
  intervals,
  random,
  biometricProvider: provider,
  commands,
  roster,
}) {
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
    // Fila de eliminação biométrica (7D): depois de cada sync, que é quem traz/atualiza a fila.
    if (provider !== undefined && out.results.sync.status !== 'offline') {
      out.ran.push('biometricErasure');
      out.results.biometricErasure = await runBiometricErasures({ store, transport, provider });
      if (out.results.biometricErasure.status === 'revoked') return { ...out, revoked: true };
    }
  }
  if (commands && due('commands', iv.commandsMs)) {
    out.ran.push('commands');
    last.commands = now.getTime();
    out.results.commands = await pollAndRunCommands({ store, transport, now, ...commands });
    if (out.results.commands.status === 'revoked') return { ...out, revoked: true };
  }
  if (roster && due('roster', iv.rosterMs)) {
    out.ran.push('roster');
    last.roster = now.getTime();
    out.results.roster = await syncRosters({ store, now, ...roster });
  }
  if (due('readers', iv.readersMs)) {
    last.readers = now.getTime();
    const rep = await reportEnrolledReaders({ store, transport, now });
    if (rep.status !== 'idle') {
      out.ran.push('readers');
      out.results.readers = rep;
    }
    if (rep.status === 'revoked') return { ...out, revoked: true };
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
