import { describe, expect, it } from 'vitest';
import { FACE_DIM, decodeDescriptor } from '@zela/biometrics/face';
import { LIVENESS_MIN, summarizeFrames } from './summarize.js';

const vec = (seed) => {
  let x = seed * 2654435761 + 1;
  return Float32Array.from({ length: FACE_DIM }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296 - 0.5) * 2;
  });
};
const near = (v, k, seed) => {
  const n = vec(seed);
  return Float32Array.from(v, (c, i) => c + n[i] * k);
};
const frame = (descriptor, real = 0.9, live = 0.9) => ({ descriptor, real, live });

describe('summarizeFrames', () => {
  it('média de quadros consistentes + prova de vida aprovada', () => {
    const base = vec(1);
    const r = summarizeFrames([
      frame(near(base, 0.1, 5)),
      frame(near(base, 0.1, 6)),
      frame(near(base, 0.1, 7)),
    ]);
    expect(r.ok).toBe(true);
    expect(r.lv).toBe('PASSED');
    expect(decodeDescriptor(r.d)).not.toBeNull(); // 128 floats unitários prontos para o protocolo
    expect(r.d).toHaveLength(684);
  });
  it('prova de vida pela MEDIANA: um quadro ruim não reprova, a maioria ruim reprova', () => {
    const base = vec(1);
    const mk = (reals) => reals.map((re, i) => frame(near(base, 0.1, 10 + i), re, 0.9));
    expect(summarizeFrames(mk([0.9, 0.9, 0.1, 0.9, 0.9])).lv).toBe('PASSED');
    expect(summarizeFrames(mk([0.1, 0.2, 0.9, 0.1, 0.2])).lv).toBe('FAILED');
  });
  it('live baixo também reprova', () => {
    const base = vec(1);
    const r = summarizeFrames([
      frame(near(base, 0.1, 5), 0.9, 0.1),
      frame(near(base, 0.1, 6), 0.9, 0.2),
    ]);
    expect(r.lv).toBe('FAILED');
    expect(LIVENESS_MIN.live).toBeGreaterThan(0.2);
  });
  it('quadros de pessoas diferentes = instável (não envia)', () => {
    expect(summarizeFrames([frame(vec(1)), frame(vec(2)), frame(vec(3))])).toEqual({
      ok: false,
      code: 'UNSTABLE',
    });
  });
  it('sem quadros ou vetor inválido é erro, nunca um resultado', () => {
    expect(summarizeFrames([])).toEqual({ ok: false, code: 'NO_FRAMES' });
    expect(summarizeFrames(null)).toEqual({ ok: false, code: 'NO_FRAMES' });
    expect(summarizeFrames([frame(new Float32Array(5))])).toEqual({
      ok: false,
      code: 'ENGINE_ERROR',
    });
    expect(summarizeFrames([frame(new Float32Array(FACE_DIM))])).toEqual({
      ok: false,
      code: 'ENGINE_ERROR',
    });
  });
});
