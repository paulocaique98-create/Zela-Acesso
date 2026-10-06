import { describe, expect, it } from 'vitest';
import { createErrorMessage, slugify } from './TenantsPage';

describe('slugify', () => {
  it('normaliza acentos, espacos e simbolos', () => {
    expect(slugify('Condomínio São José (Exemplo)')).toBe('condominio-sao-jose-exemplo');
  });
  it('limita a 63 caracteres e remove hifens nas pontas', () => {
    expect(slugify('-- a'.repeat(40)).length).toBeLessThanOrEqual(63);
    expect(slugify('  Alfa  ')).toBe('alfa');
  });
});

describe('createErrorMessage', () => {
  it('nao expoe texto bruto do banco', () => {
    expect(createErrorMessage({ code: 'XX000', message: 'detalhe interno secreto' })).toBe(
      'Não foi possível criar a organização.',
    );
  });
  it('traduz os codigos conhecidos', () => {
    expect(createErrorMessage({ code: '42501' })).toMatch(/permissão/);
    expect(createErrorMessage({ code: '23503' })).toMatch(/e-mail/);
    expect(createErrorMessage({ code: '23505' })).toMatch(/identificador/);
    expect(createErrorMessage(null)).toBeNull();
  });
});
