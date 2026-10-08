// Conjunto de chaves públicas de comando em que o agente confia (Fase 8A, D-022).
// Origem da confiança, em ordem: (1) ancoragem manual na instalação (EDGE_COMMAND_PUBKEYS, âncora fora de banda);
// (2) declarações assinadas por chave já confiável (endorse/revoke), recebidas do gateway; (3) TOFU opcional, só
// quando o conjunto está vazio e EDGE_COMMAND_TOFU=1 (a primeira lista do gateway vira âncora; risco: quem
// controlar o canal na primeira conexão escolhe a chave — por isso é desligado por padrão e deve ser usado só
// em instalação supervisionada). O conjunto persiste no SQLite do agente (meta), sobrevive a reinício.

import { applyKeyStatements, isKid, isPublicKeyHex, kidOf } from './keys.js';

const META_KEYS = 'command_pubkeys';
const META_REVOKED = 'command_pubkeys_revoked';

const readJson = (store, k, fallback) => {
  try {
    const v = JSON.parse(store.getMeta(k) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/** @returns {Record<string, string>} kid -> chave pública efetiva (âncora + persistidas − revogadas) */
export function loadTrustedKeys(store, seed = {}) {
  const revoked = new Set(readJson(store, META_REVOKED, []));
  const all = { ...seed, ...readJson(store, META_KEYS, {}) };
  for (const kid of Object.keys(all)) if (revoked.has(kid)) delete all[kid];
  return all;
}

/**
 * Busca a lista no gateway e atualiza o conjunto. Nunca lança por rede; devolve o conjunto efetivo.
 * @param {{ store: object, transport: { commandKeys?: () => Promise<any> }, seed?: Record<string,string>, tofu?: boolean }} input
 * @returns {Promise<{ trusted: Record<string,string>, status: 'ok' | 'offline' | 'revoked' | 'unsupported' }>}
 */
export async function syncCommandKeys({ store, transport, seed = {}, tofu = false }) {
  let trusted = loadTrustedKeys(store, seed);
  if (typeof transport.commandKeys !== 'function') return { trusted, status: 'unsupported' };
  let res;
  try {
    res = await transport.commandKeys();
  } catch {
    return { trusted, status: 'offline' };
  }
  if (res === null) return { trusted, status: 'revoked' };

  // TOFU: só com conjunto vazio, e só chaves cujo kid confere com a chave (ninguém "escolhe" kid).
  if (Object.keys(trusted).length === 0 && tofu && Array.isArray(res?.keys)) {
    for (const k of res.keys) {
      if (isKid(k?.kid) && isPublicKeyHex(k?.publicKey) && kidOf(k.publicKey) === k.kid)
        trusted[k.kid] = k.publicKey;
    }
  }

  const before = JSON.stringify(trusted);
  const applied = applyKeyStatements(trusted, res?.statements);
  trusted = applied.trusted;

  // Persistência: tudo que não é âncora fica em meta; kids que sumiram do conjunto vão para a lista de revogados.
  const revoked = new Set(readJson(store, META_REVOKED, []));
  for (const kid of Object.keys(loadTrustedKeys(store, seed)))
    if (!(kid in trusted)) revoked.add(kid);
  for (const kid of Object.keys(trusted)) revoked.delete(kid);
  const persisted = Object.fromEntries(
    Object.entries(trusted).filter(([kid]) => seed[kid] !== trusted[kid]),
  );
  if (JSON.stringify(trusted) !== before || applied.changed || Object.keys(persisted).length > 0) {
    store.setMeta(META_KEYS, JSON.stringify(persisted));
    store.setMeta(META_REVOKED, JSON.stringify([...revoked]));
  }
  return { trusted, status: 'ok' };
}

export const KEY_REFRESH_MS = 10 * 60_000;

/**
 * Chaveiro com atualização preguiçosa (custo baixo): consulta o gateway na primeira vez, a cada 10 min e quando
 * chega comando com kid desconhecido (no máximo uma vez por minuto, para kid falso não virar martelo no gateway).
 * @param {{ store: object, transport: object, seed?: Record<string,string>, tofu?: boolean }} cfg
 */
export function createKeyring({ store, transport, seed = {}, tofu = false }) {
  let lastSync = 0;
  return {
    /** @param {Date} now @param {{ force?: boolean }} [opts] */
    async get(now, { force = false } = {}) {
      const t = now.getTime();
      const due =
        lastSync === 0 || t - lastSync >= KEY_REFRESH_MS || (force && t - lastSync >= 60_000);
      if (!due) return loadTrustedKeys(store, seed);
      lastSync = t;
      return (await syncCommandKeys({ store, transport, seed, tofu })).trusted;
    },
  };
}
