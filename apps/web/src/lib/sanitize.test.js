import { describe, expect, it } from 'vitest';
import { sanitizeContext } from './sanitize';

describe('sanitizeContext', () => {
  it('remove chaves sensiveis em qualquer nivel e limita strings', () => {
    const out = sanitizeContext({
      tela: 'sites',
      password: 'x',
      pinCode: '1234',
      nested: { access_token: 't', ok: 1, deep: { refreshToken: 'r', fine: 'y' } },
      lista: [{ apiKey: 'k', v: 1 }],
      longo: 'a'.repeat(500),
    });
    expect(out.tela).toBe('sites');
    expect(out).not.toHaveProperty('password');
    expect(out).not.toHaveProperty('pinCode');
    expect(out.nested).toEqual({ ok: 1, deep: { fine: 'y' } });
    expect(out.lista).toEqual([{ v: 1 }]);
    expect(out.longo).toHaveLength(300);
  });

  it('nao quebra com null e primitivos', () => {
    expect(sanitizeContext(null)).toBeNull();
    expect(sanitizeContext(5)).toBe(5);
  });
});
