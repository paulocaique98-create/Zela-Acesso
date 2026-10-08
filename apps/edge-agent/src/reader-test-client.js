// Cliente de leitor para testes e E2E (Node): monta e assina envelopes do protocolo Zela Pass.
// Espelha o que o PWA faz com WebCrypto. Não importar em código de produção.

import { randomBytes } from 'node:crypto';
import { readerSigningString } from '@zela/domain';
import { generateKeyPair, sha256Hex, signMessage } from './keys.js';

/** @param {{ readerId?: string, keys?: { publicKey: string, privateKey: string }, nowMs?: () => number }} [o] */
export function createTestReader(o = {}) {
  const keys = o.keys ?? generateKeyPair();
  const nowMs = o.nowMs ?? Date.now;
  const state = { readerId: o.readerId ?? 'enroll' };
  const envelope = (type, body, over = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const readerId = over.readerId ?? (type === 'enroll' ? 'enroll' : state.readerId);
    const ts = over.ts ?? nowMs();
    const nonce = over.nonce ?? randomBytes(16).toString('hex');
    const sig = signMessage(
      readerSigningString({ type, readerId, ts, nonce, bodyHash: sha256Hex(text) }),
      over.privateKey ?? keys.privateKey,
    );
    return { v: 1, type, readerId, ts, nonce, body: text, sig };
  };
  let seq = 0;
  return {
    keys,
    state,
    envelope,
    enroll: (code, label = 'Tablet de teste', over) =>
      envelope('enroll', { code, publicKey: keys.publicKey, label }, over),
    status: (over) => envelope('status', '{}', over),
    faceEnroll: (fields, over) => envelope('face_enroll', fields, over),
    attempt: (fields, over) =>
      envelope('attempt', { deviceEventId: `evt-${Date.now()}-${++seq}`, ...fields }, over),
  };
}
