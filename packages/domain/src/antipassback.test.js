import { describe, expect, it } from 'vitest';
import { evaluateAntiPassback, presenceToCommit } from './antipassback.js';

const now = new Date('2026-10-07T12:00:00Z');
const run = (o) =>
  evaluateAntiPassback({ mode: 'hard', direction: 'entry', state: 'unknown', now, ...o });

describe('evaluateAntiPassback', () => {
  it('modo off nunca viola nem grava', () => {
    expect(run({ mode: 'off', state: 'present' })).toMatchObject({
      violated: false,
      nextState: null,
    });
  });
  it('entrada com presença já registrada viola', () => {
    expect(run({ state: 'present' })).toMatchObject({ violated: true, nextState: 'present' });
  });
  it('saída com ausência registrada viola', () => {
    expect(run({ direction: 'exit', state: 'absent' })).toMatchObject({
      violated: true,
      nextState: 'absent',
    });
  });
  it('sequência normal não viola', () => {
    expect(run({ state: 'absent' }).violated).toBe(false);
    expect(run({ direction: 'exit', state: 'present' }).violated).toBe(false);
  });
  it('UNKNOWN nunca viola', () => {
    expect(run({ state: 'unknown' }).violated).toBe(false);
    expect(run({ direction: 'exit', state: 'unknown' }).violated).toBe(false);
    expect(run({ state: undefined }).violated).toBe(false);
  });
  it('ponto bidirecional não verifica nem grava', () => {
    expect(run({ direction: 'bidirectional', state: 'present' })).toMatchObject({
      violated: false,
      nextState: null,
    });
  });
  it('modo ou sentido inválido falha aberto só no APB (sem violação), nunca grava', () => {
    expect(run({ mode: 'x', state: 'present' })).toMatchObject({
      mode: 'off',
      violated: false,
      nextState: null,
    });
    expect(run({ direction: 'x', state: 'present' })).toMatchObject({
      violated: false,
      nextState: null,
    });
  });
  it('reset automático: estado vencido vira unknown', () => {
    const since = new Date(now.getTime() - 61 * 60_000);
    expect(run({ state: 'present', since, resetMinutes: 60 })).toMatchObject({
      violated: false,
      effectiveState: 'unknown',
    });
    expect(run({ state: 'present', since, resetMinutes: 120 }).violated).toBe(true);
    expect(run({ state: 'present', since: 'lixo', resetMinutes: 60 }).violated).toBe(true);
  });
});

describe('presenceToCommit', () => {
  const base = { mode: 'soft', violated: false, nextState: 'present' };
  it('grava só quando a porta libera', () => {
    expect(presenceToCommit({ ...base, decision: 'ALLOW' })).toBe('present');
    expect(presenceToCommit({ ...base, decision: 'DEGRADED_ALLOW' })).toBe('present');
    for (const d of ['DENY', 'CHALLENGE', 'DEGRADED_DENY'])
      expect(presenceToCommit({ ...base, decision: d })).toBeNull();
  });
  it('soft grava mesmo com violação; hard não', () => {
    expect(presenceToCommit({ ...base, violated: true, decision: 'ALLOW' })).toBe('present');
    expect(
      presenceToCommit({ ...base, mode: 'hard', violated: true, decision: 'ALLOW' }),
    ).toBeNull();
  });
  it('sem nextState não grava', () => {
    expect(presenceToCommit({ ...base, nextState: null, decision: 'ALLOW' })).toBeNull();
  });
});
