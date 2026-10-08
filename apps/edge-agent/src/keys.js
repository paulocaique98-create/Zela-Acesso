// Chaves assimétricas do agente (Fase 8A, D-022). Ed25519 via node:crypto, sem dependência externa.
// 1) Chave do DISPOSITIVO: o agente guarda a privada; a nuvem guarda só a pública (registrada no enrollment). Cada
//    requisição ao gateway é assinada, então o segredo roubado sozinho não basta (substitui mTLS: a Edge Function
//    do Supabase não permite exigir certificado de cliente).
// 2) Chaves de COMANDO: a nuvem assina com a privada; o agente guarda só públicas, identificadas por `kid`. Roubar o
//    agente não permite forjar comando. Mudança de conjunto de chaves só por declaração assinada por chave já confiável.
// Chaves públicas trafegam como 32 bytes em hex; privadas como PKCS#8 DER em base64. Nada disso vai a log.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // SPKI Ed25519 + 32 bytes
const PUB_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const KID_RE = /^[0-9a-f]{16}$/;

/** kid = 16 primeiros hex do SHA-256 da chave pública (estável, sem segredo). @param {string} pubHex */
export const kidOf = (pubHex) =>
  createHash('sha256').update(pubHex, 'utf8').digest('hex').slice(0, 16);

export const isPublicKeyHex = (s) => typeof s === 'string' && PUB_RE.test(s);
export const isKid = (s) => typeof s === 'string' && KID_RE.test(s);

const toPublicObject = (pubHex) =>
  createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });

/** @returns {{ publicKey: string, privateKey: string }} publicKey em hex (32 B); privateKey PKCS#8 DER em base64 */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: Buffer.from(spki.subarray(spki.length - 32)).toString('hex'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** @param {string} privateKeyB64 @returns {string} chave pública em hex */
export function publicKeyOf(privateKeyB64) {
  const pub = createPublicKey(
    createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' }),
  ).export({ format: 'der', type: 'spki' });
  return Buffer.from(pub.subarray(pub.length - 32)).toString('hex');
}

/** @param {string} message @param {string} privateKeyB64 @returns {string} assinatura em hex (64 B) */
export function signMessage(message, privateKeyB64) {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(message, 'utf8'), key).toString('hex');
}

/** Nunca lança: entrada malformada = false. */
export function verifyMessage(message, signatureHex, publicKeyHex) {
  if (
    typeof signatureHex !== 'string' ||
    !SIG_RE.test(signatureHex) ||
    !isPublicKeyHex(publicKeyHex)
  )
    return false;
  try {
    return verify(
      null,
      Buffer.from(message, 'utf8'),
      toPublicObject(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- assinatura de requisição (chave do dispositivo)
export const REQUEST_SKEW_MS = 120_000;

/** Mensagem assinada em cada requisição: amarra agente, instante e corpo. Mesma forma no gateway. */
export const requestMessage = ({ agentId, ts, bodyHash }) =>
  `zela-req/v1\n${agentId.toLowerCase()}\n${ts}\n${bodyHash}`;

export const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ---------------------------------------------------------------- conjunto de chaves de comando confiáveis
/**
 * Declaração de mudança do conjunto, assinada por uma chave JÁ confiável:
 *   endorse: passa a confiar em (kid, publicKey);  revoke: deixa de confiar em kid.
 * @param {{ type: 'endorse' | 'revoke', kid: string, publicKey?: string }} s
 */
export const statementMessage = (s) =>
  s.type === 'endorse'
    ? `zela-key-endorse/v1\n${s.kid}\n${s.publicKey}`
    : `zela-key-revoke/v1\n${s.kid}`;

/**
 * Aplica declarações ao conjunto confiável. Cada declaração só vale se assinada por uma chave que já está no
 * conjunto naquele momento (aplicadas em ordem). Declaração inválida é ignorada, nunca lança.
 * @param {Record<string, string>} trusted kid -> publicKey
 * @param {Array<{ type: string, kid: string, publicKey?: string, signedBy: string, signature: string }>} statements
 * @returns {{ trusted: Record<string, string>, changed: boolean }}
 */
export function applyKeyStatements(trusted, statements) {
  const out = { ...trusted };
  let changed = false;
  for (const s of Array.isArray(statements) ? statements : []) {
    if (!s || (s.type !== 'endorse' && s.type !== 'revoke') || !isKid(s.kid)) continue;
    if (s.type === 'endorse' && (!isPublicKeyHex(s.publicKey) || kidOf(s.publicKey) !== s.kid))
      continue;
    const signerKey = out[s.signedBy];
    if (!signerKey || !verifyMessage(statementMessage(s), s.signature, signerKey)) continue;
    if (s.type === 'endorse' && out[s.kid] !== s.publicKey) {
      out[s.kid] = s.publicKey;
      changed = true;
    }
    // uma chave não revoga a si mesma: evita deixar o agente sem nenhuma chave por declaração única
    if (s.type === 'revoke' && s.kid !== s.signedBy && out[s.kid]) {
      delete out[s.kid];
      changed = true;
    }
  }
  return { trusted: out, changed };
}

/** @param {string | undefined} text "kid:hexpub,kid:hexpub" (ancoragem manual na instalação) */
export function parsePublicKeys(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of (text ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [kid, pub] = part.split(':');
    if (!isKid(kid) || !isPublicKeyHex(pub) || kidOf(pub) !== kid)
      throw new Error('EDGE_COMMAND_PUBKEYS inválida (esperado kid:chavePublicaHex coerentes)');
    out[kid] = pub;
  }
  return out;
}
