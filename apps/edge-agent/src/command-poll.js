// Comandos remotos (Fase 4E): busca os pedidos assinados no gateway, passa cada um por `handleCommand` (assinatura,
// agente, validade, anti-replay) e reporta o resultado. Falha de rede = offline; o pedido expira na nuvem (30 s) e o
// operador emite outro. Falha ao reportar não desfaz a execução (o id já foi consumido).
// Relógio não confiável (deriva alta ou nunca verificada): a janela de validade não pode ser julgada, então `unlock`
// é recusado (CLOCK_UNTRUSTED, sem consumir o id); `lock` segue, pois só reafirma o estado travado.

import { loadClockStatus } from './clock.js';
import { handleCommand } from './commands.js';

/**
 * @param {{ store: object, transport: object, driver: object, key?: string | Buffer | Array<string | Buffer>,
 *   keyring?: ReturnType<typeof import('./trust.js').createKeyring>, agentId: string, now: Date }} input
 * `key`: HMAC v1 (legado). `keyring`: chaves públicas v2 por kid (D-022).
 * @returns {Promise<{ status: 'ok' | 'offline' | 'revoked', results: Array<{ id: unknown, status: string, code: string, reported: boolean }> }>}
 */
export async function pollAndRunCommands({ store, transport, driver, key, keyring, agentId, now }) {
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
  const clockUntrusted = loadClockStatus(store, now).status === 'untrusted';
  let publicKeys = keyring && list.length > 0 ? await keyring.get(now) : {};
  for (const command of list) {
    // kid desconhecido: pode ser rotação recém-publicada; tenta atualizar o chaveiro uma vez (limitado a 1/min)
    if (keyring && command?.v === 2 && !Object.hasOwn(publicKeys, command.kid))
      publicKeys = await keyring.get(now, { force: true });
    const gated = clockUntrusted && command?.action !== 'lock';
    const r = await (gated
      ? Promise.resolve({ status: /** @type {const} */ ('rejected'), code: 'CLOCK_UNTRUSTED' })
      : handleCommand({ store, driver, key, publicKeys, agentId, now, command }).catch(() => ({
          status: /** @type {const} */ ('failed'),
          code: 'DRIVER_ERROR',
        })));
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
