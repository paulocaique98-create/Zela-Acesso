// Comandos remotos (Fase 4E): busca os pedidos assinados no gateway, passa cada um por `handleCommand` (assinatura,
// agente, validade, anti-replay) e reporta o resultado. Falha de rede = offline; o pedido expira na nuvem (30 s) e o
// operador emite outro. Falha ao reportar não desfaz a execução (o id já foi consumido).

import { handleCommand } from './commands.js';

/**
 * @param {{ store: object, transport: object, driver: object, key: string | Buffer, agentId: string, now: Date }} input
 * @returns {Promise<{ status: 'ok' | 'offline' | 'revoked', results: Array<{ id: unknown, status: string, code: string, reported: boolean }> }>}
 */
export async function pollAndRunCommands({ store, transport, driver, key, agentId, now }) {
  let res;
  try {
    res = await transport.pollCommands();
  } catch {
    return { status: 'offline', results: [] };
  }
  if (res === null) {
    store.wipeCache();
    return { status: 'revoked', results: [] };
  }
  const list = Array.isArray(res?.commands) ? res.commands : [];
  const results = [];
  for (const command of list) {
    const r = await handleCommand({ store, driver, key, agentId, now, command }).catch(() => ({
      status: /** @type {const} */ ('failed'),
      code: 'DRIVER_ERROR',
    }));
    let reported = false;
    try {
      const ack = await transport.reportCommandResult(command?.id, r.status, r.code);
      reported = ack?.recorded === true;
    } catch {
      /* sem rede: o pedido expira na nuvem */
    }
    results.push({ id: command?.id, ...r, reported });
  }
  return { status: 'ok', results };
}
