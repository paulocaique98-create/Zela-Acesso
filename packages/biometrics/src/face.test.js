import { describe, expect, it } from 'vitest';
import {
  FACE_DIM,
  FACE_MATCH_MIN_COSINE,
  FACE_SCORE_FULL_COSINE,
  averageDescriptors,
  cosine,
  decodeDescriptor,
  encodeDescriptor,
  normalizeDescriptor,
  similarityToScore,
} from './face.js';
import { MIN_SAFE_THRESHOLD } from './contract.js';
import {
  ALIGN_SIZE,
  ARCFACE_REF,
  landmarks5FromMesh,
  similarityTransform,
  transformScale,
} from './face-align.js';

const vec = (seed) => {
  let x = seed * 2654435761 + 1;
  return Float32Array.from({ length: FACE_DIM }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296 - 0.5) * 2;
  });
};

describe('vetor facial', () => {
  it('normaliza para norma 1 e recusa entrada inválida', () => {
    const n = normalizeDescriptor(vec(1));
    expect(Math.hypot(...n)).toBeCloseTo(1, 5);
    expect(normalizeDescriptor(new Float32Array(FACE_DIM))).toBeNull(); // vetor nulo
    expect(normalizeDescriptor(vec(1).slice(0, 64))).toBeNull(); // outro modelo
    const nan = vec(1);
    nan[3] = Number.NaN;
    expect(normalizeDescriptor(nan)).toBeNull();
    const inf = vec(1);
    inf[0] = Number.POSITIVE_INFINITY;
    expect(normalizeDescriptor(inf)).toBeNull();
    expect(normalizeDescriptor(null)).toBeNull();
  });

  it('base64 ida e volta sem perda; o tamanho cabe no protocolo (684 caracteres)', () => {
    const b64 = encodeDescriptor(vec(2));
    expect(b64).toHaveLength(684);
    const back = decodeDescriptor(b64);
    expect(cosine(back, normalizeDescriptor(vec(2)))).toBeCloseTo(1, 6);
  });

  it('decodificação recusa lixo, tamanho errado e valores não finitos', () => {
    for (const bad of [
      undefined,
      null,
      5,
      '',
      'abc',
      'A'.repeat(684),
      '!'.repeat(684),
      'A'.repeat(683),
    ])
      expect(decodeDescriptor(bad)).toBeNull();
    // NaN em float32 (0x7fc00000) codificado: o Edge não pode aceitar
    const bytes = new Uint8Array(FACE_DIM * 4);
    bytes.set([0x00, 0x00, 0xc0, 0x7f], 0);
    for (let i = 4; i < bytes.length; i += 4) bytes.set([0x00, 0x00, 0x80, 0x3f], i);
    expect(decodeDescriptor(btoa(String.fromCharCode(...bytes)))).toBeNull();
  });

  it('o Edge renormaliza: vetor enviado com escala errada vira unitário', () => {
    const big = vec(3).map((v) => v * 1000);
    const bytes = new Uint8Array(big.buffer);
    const d = decodeDescriptor(btoa(String.fromCharCode(...bytes)));
    expect(Math.hypot(...d)).toBeCloseTo(1, 4);
  });

  it('cosseno: 1 para o mesmo vetor, ~0 para pessoas aleatórias, −1 para entrada inválida', () => {
    const a = normalizeDescriptor(vec(1));
    expect(cosine(a, a)).toBeCloseTo(1, 6);
    expect(Math.abs(cosine(a, normalizeDescriptor(vec(2))))).toBeLessThan(0.4);
    expect(cosine(a, null)).toBe(-1);
    expect(cosine(a, a.slice(0, 5))).toBe(-1);
  });

  it('média de capturas é unitária e fica perto de cada uma', () => {
    const base = vec(1);
    const noisy = (s) => Float32Array.from(base, (v, i) => v + vec(s)[i] * 0.1);
    const avg = averageDescriptors([noisy(5), noisy(6), noisy(7)]);
    expect(Math.hypot(...avg)).toBeCloseTo(1, 5);
    expect(cosine(avg, normalizeDescriptor(base))).toBeGreaterThan(0.95);
    expect(averageDescriptors([])).toBeNull();
    expect(averageDescriptors([vec(1), new Float32Array(3)])).toBeNull();
  });
});

describe('escala de pontuação', () => {
  it('âncoras: 0 -> 0; limiar oficial -> 0,80 (piso do produto); >= 0,75 -> 1', () => {
    expect(similarityToScore(0)).toBe(0);
    expect(similarityToScore(-0.5)).toBe(0);
    expect(similarityToScore(FACE_MATCH_MIN_COSINE)).toBeCloseTo(MIN_SAFE_THRESHOLD, 10);
    expect(similarityToScore(FACE_SCORE_FULL_COSINE)).toBe(1);
    expect(similarityToScore(0.99)).toBe(1);
  });
  it('monotônica e limitada a 0..1; entrada inválida vale 0', () => {
    let prev = -1;
    for (let c = -1; c <= 1; c += 0.01) {
      const s = similarityToScore(c);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
    expect(similarityToScore(Number.NaN)).toBe(0);
    expect(similarityToScore(undefined)).toBe(0);
  });
});

describe('alinhamento 5 pontos', () => {
  it('recupera escala, rotação e translação conhecidas', () => {
    const s = 1.7;
    const th = 0.3;
    const t = [40, -25];
    const src = ARCFACE_REF.map(([x, y]) => [
      (s * (x * Math.cos(th) - y * Math.sin(th))) / 1 + t[0],
      s * (x * Math.sin(th) + y * Math.cos(th)) + t[1],
    ]);
    const m = similarityTransform(src, ARCFACE_REF);
    expect(transformScale(m)).toBeCloseTo(1 / s, 6);
    for (let i = 0; i < 5; i++) {
      const [x, y] = src[i];
      expect(m.a * x - m.b * y + m.tx).toBeCloseTo(ARCFACE_REF[i][0], 5);
      expect(m.b * x + m.a * y + m.ty).toBeCloseTo(ARCFACE_REF[i][1], 5);
    }
    expect(ALIGN_SIZE).toBe(112);
  });
  it('entradas degeneradas devolvem null', () => {
    expect(similarityTransform(null, ARCFACE_REF)).toBeNull();
    expect(similarityTransform([[1, 1]], [[1, 1]])).toBeNull();
    expect(
      similarityTransform(
        [
          [2, 2],
          [2, 2],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      ),
    ).toBeNull(); // todos os pontos iguais
    expect(similarityTransform(ARCFACE_REF, ARCFACE_REF.slice(0, 4))).toBeNull();
  });
  it('5 pontos a partir da malha de 468; malha curta ou inválida => null', () => {
    const mesh = Array.from({ length: 468 }, (_, i) => [i, i * 2, 0]);
    const p = landmarks5FromMesh(mesh);
    expect(p).toHaveLength(5);
    expect(p[0]).toEqual([(33 + 133) / 2, (33 * 2 + 133 * 2) / 2]); // olho esquerdo da imagem
    expect(p[2]).toEqual([1, 2]); // ponta do nariz
    expect(landmarks5FromMesh(mesh.slice(0, 100))).toBeNull();
    expect(landmarks5FromMesh(null)).toBeNull();
    const bad = mesh.map((m) => [...m]);
    bad[291] = [Number.NaN, 0, 0];
    expect(landmarks5FromMesh(bad)).toBeNull();
  });
});
