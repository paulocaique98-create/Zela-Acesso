import { describe, expect, it } from 'vitest';
import {
  normalizeCardNumber,
  validateCardNumber,
  validatePin,
  validateTokenDays,
} from './credentials.js';

describe('validatePin', () => {
  it('aceita PIN de 6 a 8 digitos nao previsivel', () => {
    expect(validatePin('482915')).toBeNull();
    expect(validatePin('73519028')).toBeNull();
  });
  it.each(['4829', '123456789', 'abc123', '', '48 2915'])('recusa formato invalido %j', (p) => {
    expect(validatePin(p)).not.toBeNull();
  });
  it.each(['111111', '000000', '123456', '234567', '987654', '76543210'])(
    'recusa previsivel %s',
    (p) => {
      expect(validatePin(p)).not.toBeNull();
    },
  );
});

describe('cartao', () => {
  it('normaliza como o banco', () => {
    expect(normalizeCardNumber('04:a1-b2 c3')).toBe('04A1B2C3');
  });
  it('valida tamanho 4..32', () => {
    expect(validateCardNumber('04:A1:B2:C3')).toBeNull();
    expect(validateCardNumber('ab')).not.toBeNull();
    expect(validateCardNumber('A'.repeat(33))).not.toBeNull();
  });
});

describe('validateTokenDays', () => {
  it('aceita 1..366 inteiros', () => {
    expect(validateTokenDays(1)).toBeNull();
    expect(validateTokenDays(366)).toBeNull();
  });
  it.each([0, 367, 1.5, Number.NaN])('recusa %s', (d) => {
    expect(validateTokenDays(d)).not.toBeNull();
  });
});
