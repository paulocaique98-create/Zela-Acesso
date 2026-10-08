import { describe, expect, it } from 'vitest';
import { dnsSlug, suggestZelaPassUrl, ZELA_PASS_BASE_DOMAIN } from './zela-pass-address.js';

describe('dnsSlug', () => {
  it('tira acento, caixa e simbolos', () => {
    expect(dnsSlug('Tânia Velz')).toBe('tania-velz');
    expect(dnsSlug('  Portaria   Principal! ')).toBe('portaria-principal');
    expect(dnsSlug('Bloco A/B_2')).toBe('bloco-a-b-2');
  });
  it('entrada vazia ou so simbolos vira vazio', () => {
    expect(dnsSlug('')).toBe('');
    expect(dnsSlug('!!!')).toBe('');
    expect(dnsSlug(undefined)).toBe('');
  });
});

describe('suggestZelaPassUrl', () => {
  it('monta organizacao-local no dominio-base', () => {
    expect(suggestZelaPassUrl('Condomínio Alfa', 'Portaria Principal')).toBe(
      `https://condominio-alfa-portaria-principal.${ZELA_PASS_BASE_DOMAIN}`,
    );
  });
  it('remove sufixo societario da organizacao', () => {
    expect(suggestZelaPassUrl('TANIA VELZ LTDA', 'Matriz')).toBe(
      `https://tania-velz-matriz.${ZELA_PASS_BASE_DOMAIN}`,
    );
    expect(suggestZelaPassUrl('Alfa Serviços ME', 'Sede')).toBe(
      `https://alfa-servicos-sede.${ZELA_PASS_BASE_DOMAIN}`,
    );
  });
  it('sem nome do local nao sugere nada', () => {
    expect(suggestZelaPassUrl('Alfa', '')).toBe('');
    expect(suggestZelaPassUrl('Alfa', '  ')).toBe('');
  });
  it('sem organizacao usa so o local', () => {
    expect(suggestZelaPassUrl('', 'Sede')).toBe(`https://sede.${ZELA_PASS_BASE_DOMAIN}`);
  });
  it('respeita o limite de 63 caracteres do rotulo e nao termina em hifen', () => {
    const url = suggestZelaPassUrl(
      'Organização com um nome muito longo mesmo',
      'Local com um nome também enorme demais',
    );
    const label = url.replace('https://', '').split('.')[0];
    expect(label.length).toBeLessThanOrEqual(63);
    expect(label.endsWith('-')).toBe(false);
  });
  it('o resultado passa na mesma regra do banco (https, sem caminho)', () => {
    const url = suggestZelaPassUrl('Alfa', 'Sede');
    expect(url).toMatch(/^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$/);
  });
});
