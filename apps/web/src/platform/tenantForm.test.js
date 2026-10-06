import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  buildDetails,
  buildLimits,
  createErrorMessage,
  formFromTenant,
  slugify,
  validateForm,
} from './tenantForm';

const valid = { ...EMPTY_FORM, name: 'Org Ótima', owner_email: 'dono@example.test' };

describe('slugify', () => {
  it('normaliza nome em identificador', () => {
    expect(slugify('Condomínio São José!')).toBe('condominio-sao-jose');
    expect(slugify('  --A  B-- ')).toBe('a-b');
    expect(slugify('x'.repeat(100))).toHaveLength(63);
  });
});

describe('validateForm', () => {
  it('aceita o minimo para criar (nome + e-mail do responsavel)', () => {
    expect(validateForm(valid, true)).toBeNull();
  });

  it('rejeita CNPJ, CEP, e-mail e limites invalidos', () => {
    expect(validateForm({ ...valid, tax_id: '11.222.333/0001-82' }, true)).toBe('CNPJ inválido.');
    expect(validateForm({ ...valid, tax_id: '11.222.333/0001-81' }, true)).toBeNull();
    expect(validateForm({ ...valid, postal_code: '123' }, true)).toBe('CEP inválido.');
    expect(validateForm({ ...valid, contact_email: 'x' }, true)).toMatch(/E-mail/);
    expect(validateForm({ ...valid, max_people: '-1' }, true)).toMatch(/Limites/);
    expect(validateForm({ ...valid, max_people: '1.5' }, true)).toMatch(/Limites/);
  });

  it('criar exige e-mail do responsavel e identificador valido', () => {
    expect(validateForm({ ...valid, owner_email: '' }, true)).toMatch(/responsável/);
    expect(validateForm({ ...valid, slugTouched: true, slug: 'Slug Ruim' }, true)).toMatch(
      /Identificador/,
    );
    expect(validateForm({ ...valid, owner_email: '' }, false)).toBeNull();
  });

  it('com senha: exige nome e no minimo 12 caracteres', () => {
    expect(validateForm({ ...valid, owner_password: 'curta-demais' }, true)).toMatch(
      /Informe o nome/,
    );
    expect(validateForm({ ...valid, owner_name: 'Ana', owner_password: 'curta' }, true)).toMatch(
      /12/,
    );
    expect(
      validateForm({ ...valid, owner_name: 'Ana', owner_password: 'senha-com-12+' }, true),
    ).toBeNull();
  });
});

describe('payloads', () => {
  it('buildDetails normaliza CNPJ/CEP/UF e nunca inclui a senha', () => {
    const d = buildDetails({
      ...valid,
      tax_id: '11.222.333/0001-81',
      postal_code: '01310-100',
      state: 'sp',
      owner_password: 'segredo-segredo',
    });
    expect(d).toMatchObject({ tax_id: '11222333000181', postal_code: '01310100', state: 'SP' });
    expect(JSON.stringify(d)).not.toContain('segredo');
  });

  it('buildLimits so envia o que foi preenchido', () => {
    expect(buildLimits({ ...valid, max_sites: '3', max_people: '' })).toEqual({ max_sites: 3 });
  });

  it('formFromTenant reaproveita limites e dados e mantem o identificador fixo', () => {
    const f = formFromTenant(
      { name: 'A', slug: 'a', limits: { max_people: 10 } },
      { tax_id: '11222333000181', postal_code: '01310100', city: 'SP' },
    );
    expect(f).toMatchObject({
      tax_id: '11.222.333/0001-81',
      postal_code: '01310-100',
      max_people: '10',
      max_sites: '',
      slugTouched: true,
    });
  });
});

describe('createErrorMessage', () => {
  it('mapeia codigos do Postgres para mensagens genericas', () => {
    expect(createErrorMessage(null)).toBeNull();
    expect(createErrorMessage({ code: '42501' })).toMatch(/permissão/);
    expect(createErrorMessage({ code: '23503' })).toMatch(/senha/);
    expect(createErrorMessage({ code: '23505' })).toMatch(/identificador/);
    expect(createErrorMessage({ code: '23514' })).toMatch(/inválido/);
    expect(createErrorMessage({ code: 'XX000' })).toBe('Não foi possível criar a organização.');
  });
});
