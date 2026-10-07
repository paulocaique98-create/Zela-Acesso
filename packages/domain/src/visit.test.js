import { describe, expect, it } from 'vitest';
import { canCheckInNow, normalizePlate, validatePlate, validateVisitWindow } from './visit.js';

const now = new Date('2026-10-07T12:00:00Z');
const h = (n) => new Date(+now + n * 3_600_000);

describe('validateVisitWindow', () => {
  it('aceita período válido', () => expect(validateVisitWindow(h(-1), h(3), now)).toBeNull());
  it('recusa fim antes do início', () =>
    expect(validateVisitWindow(h(3), h(1), now)).toMatch(/depois do início/));
  it('recusa fim no passado', () =>
    expect(validateVisitWindow(h(-5), h(-1), now)).toMatch(/futuro/));
  it('recusa mais de 7 dias', () =>
    expect(validateVisitWindow(h(0), h(24 * 7 + 1), now)).toMatch(/7 dias/));
  it('recusa data inválida', () =>
    expect(validateVisitWindow(new Date('x'), h(1), now)).toMatch(/Informe/));
});

describe('placa', () => {
  it('normaliza', () => expect(normalizePlate('abc-1d23')).toBe('ABC1D23'));
  it('vazio vira null', () => expect(normalizePlate('  ')).toBeNull());
  it('valida tamanho', () => {
    expect(validatePlate('ABC1D23')).toBeNull();
    expect(validatePlate('AB1')).toBe('Placa inválida.');
    expect(validatePlate(null)).toBeNull();
  });
});

describe('canCheckInNow', () => {
  const v = (status, a, b) => ({
    status,
    valid_from: h(a).toISOString(),
    valid_until: h(b).toISOString(),
  });
  it('convidado dentro do período', () =>
    expect(canCheckInNow(v('invited', -1, 1), now)).toBe(true));
  it('antes do início', () => expect(canCheckInNow(v('invited', 1, 2), now)).toBe(false));
  it('depois do fim', () => expect(canCheckInNow(v('invited', -2, -1), now)).toBe(false));
  it('outro status', () => expect(canCheckInNow(v('checked_in', -1, 1), now)).toBe(false));
});
