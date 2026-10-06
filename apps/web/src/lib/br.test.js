import { describe, expect, it } from 'vitest';
import { formatCep, formatCnpj, generatePassword, isValidCnpj, onlyDigits } from './br';
import { safeMessage } from './errors';

describe('br', () => {
  it('formata CNPJ e CEP durante a digitacao', () => {
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90');
    expect(formatCnpj('1234')).toBe('12.34');
    expect(formatCep('01310100')).toBe('01310-100');
    expect(formatCep('0131')).toBe('0131');
    expect(onlyDigits('12.345.678/0001-90')).toBe('12345678000190');
  });

  it('valida digitos verificadores do CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });

  it('gera senha do tamanho pedido, sem repetir entre chamadas', () => {
    const a = generatePassword(16);
    expect(a).toHaveLength(16);
    expect(a).not.toBe(generatePassword(16));
    expect(generatePassword(24)).toHaveLength(24);
  });
});

describe('safeMessage', () => {
  it('repassa so regras de negocio (P0001) curtas; resto e generico', () => {
    expect(safeMessage({ code: 'P0001', message: 'Plano inexistente ou desativado.' }, 'x')).toBe(
      'Plano inexistente ou desativado.',
    );
    expect(safeMessage({ code: 'P0001', message: 'a'.repeat(400) }, 'x')).toBe('x');
    expect(safeMessage({ code: '42501', message: 'permission denied for table x' }, 'x')).toBe(
      'Você não tem permissão para esta ação.',
    );
    expect(safeMessage({ code: 'XX000', message: 'detalhe interno' }, 'falhou')).toBe('falhou');
    expect(safeMessage(null, 'falhou')).toBe('falhou');
  });
});
