// Cifragem em repouso dos campos sensíveis do SQLite do Edge (snapshot e fila de eventos).
// AES-256-GCM, IV aleatório de 12 bytes por valor, coluna como AAD (impede trocar o conteúdo entre colunas).
// Formato: "v1:" + base64(iv | tag | texto cifrado). A chave vem do ambiente (EDGE_STORE_KEY, 64 hex) e nunca é gravada.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'v1:';

/** @param {string | Buffer | null | undefined} key 64 hex ou 32 bytes; ausente = sem cifragem (só dev/teste) */
export function createSealer(key) {
  if (key == null || key === '') return { enabled: false, seal: (_c, v) => v, open: openPlain };
  const k = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex');
  if (k.length !== 32) throw new Error('chave do armazenamento deve ter 32 bytes (64 hex)');
  return {
    enabled: true,
    /** @param {string} column @param {string} value */
    seal(column, value) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', k, iv);
      c.setAAD(Buffer.from(column));
      const ct = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    },
    /** Aceita valor legado em texto puro (migração); valor cifrado adulterado ou com outra chave lança. */
    open(column, value) {
      if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
      const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
      const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
      d.setAAD(Buffer.from(column));
      d.setAuthTag(raw.subarray(12, 28));
      try {
        return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
      } catch {
        throw new Error('armazenamento local ilegível: chave errada ou dado adulterado');
      }
    },
  };
}

function openPlain(_column, value) {
  if (typeof value === 'string' && value.startsWith(PREFIX))
    throw new Error('armazenamento local cifrado: EDGE_STORE_KEY ausente');
  return value;
}
