// Alinhamento facial (funções puras). O SFace espera o rosto em 112x112 com os 5 pontos (olhos, nariz, cantos da
// boca) nas posições de referência do ArcFace. Aqui ficam só a referência, a escolha dos 5 pontos na malha de
// 468 pontos do detector e a transformação de similaridade (escala + rotação + translação) por mínimos quadrados.

export const ALIGN_SIZE = 112;
/** Referência ArcFace 112x112: olho esquerdo da IMAGEM, olho direito, nariz, boca esquerda, boca direita. */
export const ARCFACE_REF = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Índices da malha de 468 pontos (MediaPipe FaceMesh) usados para os 5 pontos. */
const MESH = { eyeL: [33, 133], eyeR: [362, 263], nose: 1, mouthL: 61, mouthR: 291 };

/**
 * 5 pontos (coordenadas da imagem) a partir da malha. Malha incompleta ou com valores inválidos => null.
 * @param {ArrayLike<ArrayLike<number>> | null | undefined} mesh
 * @returns {number[][] | null}
 */
export function landmarks5FromMesh(mesh) {
  if (!mesh || mesh.length < 468) return null;
  const pt = (i) => {
    const p = mesh[i];
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
  };
  const mid = ([i, j]) => {
    const a = pt(i);
    const b = pt(j);
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
  };
  const out = [mid(MESH.eyeL), mid(MESH.eyeR), pt(MESH.nose), pt(MESH.mouthL), pt(MESH.mouthR)];
  return out.every(Boolean) ? out : null;
}

/**
 * Transformação de similaridade por mínimos quadrados: dst ≈ [[a, −b], [b, a]] · src + [tx, ty].
 * @param {number[][]} src @param {number[][]} dst
 * @returns {{ a: number, b: number, tx: number, ty: number } | null}
 */
export function similarityTransform(src, dst) {
  if (!src || !dst || src.length !== dst.length || src.length < 2) return null;
  const n = src.length;
  const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / n;
  const [sx, sy, dx, dy] = [mean(src, 0), mean(src, 1), mean(dst, 0), mean(dst, 1)];
  let num1 = 0;
  let num2 = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx;
    const y = src[i][1] - sy;
    const u = dst[i][0] - dx;
    const v = dst[i][1] - dy;
    num1 += x * u + y * v;
    num2 += x * v - y * u;
    den += x * x + y * y;
  }
  if (!(den > 1e-9)) return null;
  const a = num1 / den;
  const b = num2 / den;
  if (![a, b].every(Number.isFinite)) return null;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

/** Escala do rosto na imagem original (pixels da imagem por pixel do recorte): quanto menor, melhor a resolução. */
export const transformScale = (t) => Math.hypot(t.a, t.b);
