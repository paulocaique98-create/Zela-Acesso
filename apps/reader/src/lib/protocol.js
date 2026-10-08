// Envelope assinado do protocolo Zela Pass (mesmo contrato de @zela/domain/reader.js e do serviço do Edge).
import { readerSigningString } from '@zela/domain';
import { randomHex, sha256Hex, signText } from './crypto.js';

/**
 * @param {{ type: 'enroll' | 'attempt' | 'status', readerId: string, body: object | string, privateKey: CryptoKey, ts: number }} p
 */
export async function buildEnvelope({ type, readerId, body, privateKey, ts }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const nonce = randomHex(16);
  const sig = await signText(
    privateKey,
    readerSigningString({ type, readerId, ts, nonce, bodyHash: await sha256Hex(text) }),
  );
  return { v: 1, type, readerId, ts, nonce, body: text, sig };
}
