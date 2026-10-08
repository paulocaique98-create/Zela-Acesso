import { describe, expect, it } from 'vitest';
import {
  FACE_AMBIGUITY_MARGIN,
  FACE_DIM,
  FACE_PROVIDER_KIND,
  encodeDescriptor,
  evaluateBiometric,
} from '@zela/biometrics';
import { createEdgeFaceProvider } from './face-provider.js';
import { openStore } from './store.js';

/** Vetor pseudoaleatório determinístico (xorshift): pessoas sintéticas distintas por semente. */
const person = (seed) => {
  let x = seed * 2654435761 + 1;
  return Float32Array.from({ length: FACE_DIM }, () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296 - 0.5) * 2;
  });
};
/** Mesma pessoa em outra captura: o vetor com ruído. */
const noisy = (v, amount, seed = 99) => {
  const n = person(seed);
  return Float32Array.from(v, (c, i) => c + n[i] * amount);
};
const sample = (v, liveness = 'PASSED') => ({ descriptor: encodeDescriptor(v), liveness });
const NOW = '2026-10-06T10:00:00.000Z';
const KEY = 'ab'.repeat(32);

describe('provedor facial do Edge', () => {
  it('declara o contrato: kind, liveness e motor', () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    expect(p.kind).toBe(FACE_PROVIDER_KIND);
    expect(p.capabilities).toMatchObject({ liveness: true, engine: 'human+sface' });
  });

  it('cadastra uma vez e nunca sobrescreve', () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    const a = encodeDescriptor(person(1));
    expect(p.enroll('face:ref-0001', a, NOW)).toBe('stored');
    expect(p.enroll('face:ref-0001', encodeDescriptor(person(2)), NOW)).toBe('exists');
    expect(p.enroll('face:ref-0002', 'lixo', NOW)).toBe('invalid');
    expect(p.enroll('', a, NOW)).toBe('invalid');
  });

  it('verify: mesma pessoa casa; outra pessoa não; liveness acompanha a amostra', async () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    const same = await p.verify({
      subjectRef: 'face:ref-0001',
      sample: sample(noisy(person(1), 0.25)),
    });
    expect(same.status).toBe('MATCH');
    expect(same.score).toBeGreaterThan(0.9);
    expect(same.liveness).toBe('PASSED');
    const other = await p.verify({ subjectRef: 'face:ref-0001', sample: sample(person(2)) });
    expect(other.status).toBe('NO_MATCH');
    expect(other.score).toBeLessThan(0.5);
    const spoof = await p.verify({
      subjectRef: 'face:ref-0001',
      sample: sample(person(1), 'FAILED'),
    });
    expect(spoof.liveness).toBe('FAILED');
  });

  it('verify é fail-closed: sem gabarito, sem amostra ou amostra inválida = indisponível', async () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    for (const probe of [
      { subjectRef: 'face:nao-existe', sample: sample(person(1)) },
      { subjectRef: 'face:ref-0001' },
      { subjectRef: 'face:ref-0001', sample: { descriptor: 'xx', liveness: 'PASSED' } },
      { subjectRef: '', sample: sample(person(1)) },
    ])
      expect(await p.verify(probe)).toMatchObject({ status: 'ERROR', error: 'UNAVAILABLE' });
  });

  it('o resultado passa por evaluateBiometric: aceita só com limiar e liveness', async () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    const policy = { enabled: true, threshold: 0.9, requireLiveness: true };
    const ok = await p.verify({
      subjectRef: 'face:ref-0001',
      sample: sample(noisy(person(1), 0.2)),
    });
    expect(evaluateBiometric(ok, policy, p.capabilities).accepted).toBe(true);
    const bad = await p.verify({
      subjectRef: 'face:ref-0001',
      sample: sample(noisy(person(1), 0.2), 'FAILED'),
    });
    expect(evaluateBiometric(bad, policy, p.capabilities)).toEqual({
      accepted: false,
      reasonCode: 'BIOMETRIC_LIVENESS_FAILED',
    });
  });

  it('identify 1:N escolhe o dono, e nega desconhecido', () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    for (const s of [1, 2, 3]) p.enroll(`face:ref-000${s}`, encodeDescriptor(person(s)), NOW);
    const refs = ['face:ref-0001', 'face:ref-0002', 'face:ref-0003'];
    expect(p.identify(sample(noisy(person(2), 0.2)), refs)?.ref).toBe('face:ref-0002');
    expect(p.identify(sample(person(77)), refs)).toBeNull();
    expect(p.identify({ descriptor: 'xx' }, refs)).toBeNull();
    expect(p.identify(sample(person(2)), [])).toBeNull();
  });

  it('identify recusa ambiguidade: dois gabaritos quase iguais (margem mínima)', () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    p.enroll('face:ref-0002', encodeDescriptor(noisy(person(1), 0.05)), NOW); // quase o mesmo rosto
    expect(FACE_AMBIGUITY_MARGIN).toBeGreaterThan(0);
    expect(p.identify(sample(person(1)), ['face:ref-0001', 'face:ref-0002'])).toBeNull();
  });

  it('duplicateOf: o mesmo rosto não entra sob duas identidades', () => {
    const p = createEdgeFaceProvider({ store: openStore() });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    expect(p.duplicateOf(encodeDescriptor(noisy(person(1), 0.2)), 'face:ref-0002')).toBe(true);
    expect(p.duplicateOf(encodeDescriptor(noisy(person(1), 0.2)), 'face:ref-0001')).toBe(false); // o próprio
    expect(p.duplicateOf(encodeDescriptor(person(9)), 'face:ref-0002')).toBe(false);
  });

  it('erase apaga o gabarito e é idempotente (fila de eliminação LGPD)', async () => {
    const store = openStore();
    const p = createEdgeFaceProvider({ store });
    p.enroll('face:ref-0001', encodeDescriptor(person(1)), NOW);
    expect(await p.erase('face:ref-0001')).toEqual({ ok: true });
    expect(store.hasFaceTemplate('face:ref-0001')).toBe(false);
    expect(await p.erase('face:ref-0001')).toEqual({ ok: true });
    expect(await p.erase('')).toEqual({ ok: false });
    const r = await p.verify({ subjectRef: 'face:ref-0001', sample: sample(person(1)) });
    expect(r.status).toBe('ERROR');
  });

  it('gabarito é cifrado em repouso e ilegível com outra chave', () => {
    const store = openStore(':memory:', { key: KEY });
    const b64 = encodeDescriptor(person(1));
    store.putFaceTemplate('face:ref-0001', b64, NOW);
    const raw = store.db.prepare('select descriptor from face_templates').get().descriptor;
    expect(raw.startsWith('v1:')).toBe(true);
    expect(raw).not.toContain(b64.slice(0, 40));
    expect(store.getFaceTemplate('face:ref-0001')).toBe(b64);
    // outra chave sobre o mesmo valor cifrado: erro explícito, nunca vetor errado
    const other = openStore(':memory:', { key: 'cd'.repeat(32) });
    other.db
      .prepare('insert into face_templates (ref, descriptor, created_at) values (?, ?, ?)')
      .run('face:x', raw, NOW);
    expect(() => other.getFaceTemplate('face:x')).toThrow();
  });
});
