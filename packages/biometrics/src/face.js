// Gabarito e comparação facial (funções puras, sem I/O). O vetor facial é dado biométrico sensível (LGPD):
// este módulo só o transforma e compara; quem o guarda (cifrado) e quem o apaga é o armazenamento do Edge.
// O vetor sai do navegador do leitor (SFace, 128 dimensões) e viaja assinado ao Edge como float32 em base64.
// O Edge sempre renormaliza: nunca confia na normalização de quem enviou.

/** Identificador do provedor facial do Zela Acesso (gravado em biometric_profiles.provider). */
export const FACE_PROVIDER_KIND = 'sface-edge';
/** Dimensões do vetor do SFace. Vetor de outro tamanho = outro modelo = recusado. */
export const FACE_DIM = 128;
/**
 * Cosseno mínimo para o provedor declarar "mesma pessoa". É o limiar do código oficial do SFace no OpenCV Zoo
 * (`sface.py`, `_threshold_cosine`); a decisão de acesso usa o limiar da organização, bem mais exigente.
 */
export const FACE_MATCH_MIN_COSINE = 0.363;
/** Cosseno que vale 1,00 na escala 0..1 do limiar (acima disso é praticamente a mesma foto). */
export const FACE_SCORE_FULL_COSINE = 0.75;
/** Margem mínima entre o 1º e o 2º candidato na identificação 1:N; abaixo disso é ambíguo e recusa. */
export const FACE_AMBIGUITY_MARGIN = 0.05;

/** @param {ArrayLike<number>} vec @returns {Float32Array | null} vetor unitário, ou null se inválido */
export function normalizeDescriptor(vec) {
  if (!vec || vec.length !== FACE_DIM) return null;
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 1e-6)) return null;
  const out = new Float32Array(FACE_DIM);
  for (let i = 0; i < FACE_DIM; i++) out[i] = vec[i] / norm;
  return out;
}

/** Média normalizada de vários vetores (reduz ruído de quadro). @param {ArrayLike<number>[]} list */
export function averageDescriptors(list) {
  const norm = list.map(normalizeDescriptor);
  if (!norm.length || norm.some((v) => !v)) return null;
  const sum = new Float32Array(FACE_DIM);
  for (const v of norm) for (let i = 0; i < FACE_DIM; i++) sum[i] += v[i];
  return normalizeDescriptor(sum);
}

/** @param {ArrayLike<number>} vec @returns {string | null} base64 de float32 little-endian */
export function encodeDescriptor(vec) {
  const n = normalizeDescriptor(vec);
  if (!n) return null;
  const bytes = new Uint8Array(n.buffer, n.byteOffset, n.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** @param {unknown} b64 @returns {Float32Array | null} sempre renormalizado */
export function decodeDescriptor(b64) {
  if (typeof b64 !== 'string' || b64.length !== 684 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64))
    return null;
  let s;
  try {
    s = atob(b64);
  } catch {
    return null;
  }
  if (s.length !== FACE_DIM * 4) return null;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return normalizeDescriptor(new Float32Array(bytes.buffer));
}

/** Cosseno entre dois vetores unitários (−1..1). Entrada inválida => −1 (nunca casa). */
export function cosine(a, b) {
  if (!a || !b || a.length !== FACE_DIM || b.length !== FACE_DIM) return -1;
  let dot = 0;
  for (let i = 0; i < FACE_DIM; i++) dot += a[i] * b[i];
  return Number.isFinite(dot) ? dot : -1;
}

/**
 * Escala o cosseno para 0..1 (a escala de `threshold`, MIN_SAFE_THRESHOLD..1), linear por trechos:
 *   cosseno 0 -> 0 ; FACE_MATCH_MIN_COSINE -> 0,80 (piso seguro) ; FACE_SCORE_FULL_COSINE ou mais -> 1,00.
 * Assim o limiar mínimo configurável (0,80) equivale ao limiar oficial do modelo, e subir o limiar
 * exige um rosto mais parecido com o cadastrado.
 * @param {number} cos
 */
export function similarityToScore(cos) {
  if (!Number.isFinite(cos) || cos <= 0) return 0;
  if (cos >= FACE_SCORE_FULL_COSINE) return 1;
  if (cos <= FACE_MATCH_MIN_COSINE) return 0.8 * (cos / FACE_MATCH_MIN_COSINE);
  return (
    0.8 + 0.2 * ((cos - FACE_MATCH_MIN_COSINE) / (FACE_SCORE_FULL_COSINE - FACE_MATCH_MIN_COSINE))
  );
}
