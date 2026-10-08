// WebCrypto do leitor Zela Pass: chave Ed25519 do aparelho (a privada NUNCA é extraível), SHA-256 e PBKDF2.
// Mesmo formato do Edge (keys.js): chave pública = 32 bytes em hex; assinatura = 64 bytes em hex.

const enc = new TextEncoder();

export const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** O navegador precisa de Ed25519 no WebCrypto (Chrome 137+, Firefox 129+, Safari 17+). */
export async function ed25519Supported() {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

/** Gera o par do aparelho: a privada não é extraível (nem por script da página). */
export async function generateDeviceKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyHex: toHex(raw) };
}

/** @param {CryptoKey} privateKey @param {string} text @returns {Promise<string>} assinatura em hex */
export async function signText(privateKey, text) {
  return toHex(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(text)));
}

// ---- PIN do operador (guarda local da tela de configuração): PBKDF2-SHA256, sal por aparelho
export const PIN_ITERATIONS = 210_000;

export async function hashOperatorPin(pin, saltHex = randomHex(16), iterations = PIN_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    key,
    256,
  );
  return { salt: saltHex, iterations, hash: toHex(bits) };
}

/** Comparação em tempo constante. */
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
