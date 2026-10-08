// Resumo de vários quadros de uma captura facial (puro, sem câmera): vetor médio, consistência entre quadros e
// prova de vida passiva. A decisão de abrir NÃO é daqui: o resultado vai ao Edge, que decide.
import { averageDescriptors, cosine, encodeDescriptor } from '@zela/biometrics/face';

/**
 * Quadros consecutivos da MESMA pessoa são quase idênticos; qualquer par abaixo disso = pessoa trocou, rosto
 * parcialmente coberto ou captura instável. Par a par (e não contra a média) para pegar a troca mesmo com poucos quadros.
 */
export const MIN_FRAME_CONSISTENCY = 0.6;
/** Mediana mínima dos modelos antispoof/liveness do Human para declarar prova de vida. */
export const LIVENESS_MIN = { real: 0.5, live: 0.5 };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {{ descriptor: Float32Array, real: number, live: number }[]} frames quadros válidos (um rosto, de frente)
 * @returns {{ ok: true, d: string, lv: 'PASSED' | 'FAILED', real: number, live: number }
 *          | { ok: false, code: 'NO_FRAMES' | 'UNSTABLE' | 'ENGINE_ERROR' }}
 */
export function summarizeFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return { ok: false, code: 'NO_FRAMES' };
  const avg = averageDescriptors(frames.map((f) => f.descriptor));
  if (!avg) return { ok: false, code: 'ENGINE_ERROR' };
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++)
      if (cosine(frames[i].descriptor, frames[j].descriptor) < MIN_FRAME_CONSISTENCY)
        return { ok: false, code: 'UNSTABLE' };
  const real = median(frames.map((f) => f.real));
  const live = median(frames.map((f) => f.live));
  const d = encodeDescriptor(avg);
  if (!d) return { ok: false, code: 'ENGINE_ERROR' };
  return {
    ok: true,
    d,
    lv: real >= LIVENESS_MIN.real && live >= LIVENESS_MIN.live ? 'PASSED' : 'FAILED',
    real,
    live,
  };
}
