import { describe, expect, it } from 'vitest';
import { toAccessEventParams } from './access-event.js';
import {
  isWithinReaderClockSkew,
  normalizePersonRef,
  parseAttemptBody,
  parseEnrollBody,
  parseReaderEnvelope,
  readerOutcome,
  readerSigningString,
  validateReaderName,
} from './reader.js';

const UUID = '3f2b8a0e-5c1d-4e7a-9b6f-1a2b3c4d5e6f';
const hex = (n) => 'a'.repeat(n);
const envelope = (over = {}) => ({
  v: 1,
  type: 'attempt',
  readerId: UUID,
  ts: 1_800_000_000_000,
  nonce: hex(32),
  body: '{}',
  sig: hex(128),
  ...over,
});

describe('envelope', () => {
  it('aceita envelope bem formado', () => {
    const r = parseReaderEnvelope(envelope());
    expect(r.ok).toBe(true);
  });
  it('enroll usa readerId fixo', () => {
    expect(parseReaderEnvelope(envelope({ type: 'enroll', readerId: 'enroll' })).ok).toBe(true);
    expect(parseReaderEnvelope(envelope({ type: 'enroll' })).ok).toBe(false);
    expect(parseReaderEnvelope(envelope({ readerId: 'enroll' })).ok).toBe(false);
  });
  it.each([
    ['versão', { v: 2 }, 'UNSUPPORTED_VERSION'],
    ['tipo', { type: 'open_door' }, 'MALFORMED'],
    ['id', { readerId: 'x' }, 'MALFORMED'],
    ['ts', { ts: 1.5 }, 'MALFORMED'],
    ['nonce curto', { nonce: 'ab' }, 'MALFORMED'],
    ['nonce não hex', { nonce: 'z'.repeat(32) }, 'MALFORMED'],
    ['corpo grande', { body: 'x'.repeat(3000) }, 'MALFORMED'],
    ['assinatura curta', { sig: hex(10) }, 'MALFORMED'],
  ])('recusa %s', (_n, over, code) => {
    expect(parseReaderEnvelope(envelope(over))).toEqual({ ok: false, code });
  });
  it.each([null, 'x', 5, [], undefined])('recusa não objeto %j', (v) => {
    expect(parseReaderEnvelope(v).ok).toBe(false);
  });
  it('string de assinatura é determinística e cobre todos os campos', () => {
    const m = { type: 'attempt', readerId: UUID, ts: 1, nonce: hex(16), bodyHash: hex(64) };
    const base = readerSigningString(m);
    expect(base).toBe(readerSigningString({ ...m }));
    for (const k of Object.keys(m))
      expect(readerSigningString({ ...m, [k]: k === 'ts' ? 2 : 'b'.repeat(16) })).not.toBe(base);
  });
  it('janela de relógio de ±120 s', () => {
    expect(isWithinReaderClockSkew(1_000_000, 1_000_000 + 120_000)).toBe(true);
    expect(isWithinReaderClockSkew(1_000_000, 1_000_000 + 120_001)).toBe(false);
    expect(isWithinReaderClockSkew(1_000_000 + 120_001, 1_000_000)).toBe(false);
  });
});

describe('enroll', () => {
  const code = `zrd_${hex(64)}`;
  it('aceita código + chave pública', () => {
    const r = parseEnrollBody(
      JSON.stringify({ code, publicKey: hex(64), label: 'Tablet portaria' }),
    );
    expect(r).toEqual({ ok: true, value: { code, publicKey: hex(64), label: 'Tablet portaria' } });
  });
  it.each([
    { code: 'zrd_x', publicKey: hex(64) },
    { code, publicKey: hex(10) },
    { publicKey: hex(64) },
    'não é json',
  ])('recusa %j', (b) => {
    expect(parseEnrollBody(typeof b === 'string' ? b : JSON.stringify(b)).ok).toBe(false);
  });
  it('limpa controle e limita o rótulo', () => {
    const r = parseEnrollBody({ code, publicKey: hex(64), label: `a\nb${'x'.repeat(200)}` });
    expect(r.ok && r.value.label.includes('\n')).toBe(false);
    expect(r.ok && r.value.label.length).toBe(80);
  });
});

describe('attempt', () => {
  const ev = 'evt-0123456789';
  it('PIN com identificador', () => {
    const r = parseAttemptBody(
      JSON.stringify({ method: 'pin', identifier: 'M-309', pin: '482915', deviceEventId: ev }),
    );
    expect(r).toEqual({
      ok: true,
      value: { method: 'pin', deviceEventId: ev, identifier: 'M-309', pin: '482915' },
    });
  });
  it('QR e código de barras usam value', () => {
    expect(parseAttemptBody({ method: 'qr', value: 'tok_abcdef', deviceEventId: ev }).ok).toBe(
      true,
    );
    expect(parseAttemptBody({ method: 'barcode', value: '04A1B2C3', deviceEventId: ev }).ok).toBe(
      true,
    );
  });
  it.each([
    { method: 'pin', identifier: 'M1', pin: '12', deviceEventId: 'evt-0123456789' },
    { method: 'pin', identifier: 'a b', pin: '482915', deviceEventId: 'evt-0123456789' },
    { method: 'pin', identifier: 'M1', pin: '48291a', deviceEventId: 'evt-0123456789' },
    { method: 'qr', value: 'abc', deviceEventId: 'evt-0123456789' },
    { method: 'qr', value: 'x'.repeat(300), deviceEventId: 'evt-0123456789' },
    { method: 'qr', value: 'abc\ndef', deviceEventId: 'evt-0123456789' },
    { method: 'face', value: 'abcdef', deviceEventId: 'evt-0123456789' },
    { method: 'qr', value: 'abcdef', deviceEventId: 'curto' },
    { method: 'qr', value: 'abcdef' },
  ])('recusa %j', (b) => {
    expect(parseAttemptBody(b).ok).toBe(false);
  });
  it('normaliza identificador como o banco', () => {
    expect(normalizePersonRef('  m-309 ')).toBe('M-309');
  });
});

describe('resultado mostrado no leitor', () => {
  it('só uma categoria, sem o motivo', () => {
    expect(readerOutcome({ decision: 'ALLOW', reasonCode: 'POLICY_MATCH' })).toBe('REGISTERED');
    expect(readerOutcome({ decision: 'DEGRADED_ALLOW', reasonCode: 'OFFLINE_POLICY_ALLOW' })).toBe(
      'REGISTERED',
    );
    expect(readerOutcome({ decision: 'CHALLENGE', reasonCode: 'MULTI_FACTOR_REQUIRED' })).toBe(
      'CHALLENGE_REQUIRED',
    );
    expect(readerOutcome({ decision: 'DENY', reasonCode: 'CREDENTIAL_INVALID' })).toBe(
      'INVALID_CREDENTIAL',
    );
    expect(readerOutcome({ decision: 'DENY', reasonCode: 'OUTSIDE_SCHEDULE' })).toBe(
      'NOT_AUTHORIZED',
    );
    expect(readerOutcome({ decision: 'DENY', reasonCode: 'ANTI_PASSBACK' })).toBe('NOT_AUTHORIZED');
    expect(readerOutcome({ decision: 'DEGRADED_DENY', reasonCode: 'OFFLINE_POLICY_DENY' })).toBe(
      'NOT_AUTHORIZED',
    );
  });
});

describe('nome do leitor', () => {
  it('2 a 120 caracteres', () => {
    expect(validateReaderName('Tablet portaria')).toBeNull();
    expect(validateReaderName(' a ')).not.toBeNull();
    expect(validateReaderName('x'.repeat(121))).not.toBeNull();
  });
});

describe('evidência da marcação', () => {
  const decision = {
    decision: 'ALLOW',
    reasonCode: 'POLICY_MATCH',
    policyId: null,
    evidence: { personId: UUID, steps: [] },
  };
  const base = {
    decision,
    tenantId: UUID,
    siteId: UUID,
    occurredAt: new Date('2026-10-08T12:00:00Z'),
  };
  it('inclui só id, método e modo do leitor', () => {
    const p = toAccessEventParams({
      ...base,
      reader: { readerId: UUID, method: 'pin', mode: 'register_only', value: 'segredo' },
    });
    expect(p.p_evidence.reader).toEqual({ readerId: UUID, method: 'pin', mode: 'register_only' });
    expect(JSON.stringify(p)).not.toContain('segredo');
  });
  it('sem leitor não muda a evidência existente', () => {
    expect(toAccessEventParams(base).p_evidence).not.toHaveProperty('reader');
  });
  it('recusa método ou modo desconhecido', () => {
    expect(() =>
      toAccessEventParams({
        ...base,
        reader: { readerId: UUID, method: 'face', mode: 'register_only' },
      }),
    ).toThrow();
    expect(() =>
      toAccessEventParams({ ...base, reader: { readerId: UUID, method: 'pin', mode: 'x' } }),
    ).toThrow();
  });
});
