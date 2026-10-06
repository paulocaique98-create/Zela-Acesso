import { describe, expect, it } from 'vitest';
import { isPrivilegedKey, parseEnv } from './env';

function fakeJwt(role) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role })}.assinatura`;
}

describe('isPrivilegedKey', () => {
  it('bloqueia sb_secret_', () => {
    expect(isPrivilegedKey('sb_secret_abc')).toBe(true);
  });
  it('bloqueia JWT service_role', () => {
    expect(isPrivilegedKey(fakeJwt('service_role'))).toBe(true);
  });
  it('bloqueia JWT com qualquer role diferente de anon', () => {
    expect(isPrivilegedKey(fakeJwt('postgres'))).toBe(true);
  });
  it('aceita JWT anon e chave publishable', () => {
    expect(isPrivilegedKey(fakeJwt('anon'))).toBe(false);
    expect(isPrivilegedKey('sb_publishable_abc')).toBe(false);
  });
});

describe('parseEnv', () => {
  const ok = {
    VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  };
  it('aceita ambiente valido', () => {
    expect(parseEnv(ok).supabaseUrl).toBe('http://127.0.0.1:55321');
  });
  it('recusa variaveis ausentes', () => {
    expect(() => parseEnv({})).toThrow(/VITE_SUPABASE_URL/);
    expect(() => parseEnv({ VITE_SUPABASE_URL: ok.VITE_SUPABASE_URL })).toThrow(/PUBLISHABLE/);
  });
  it('recusa URL invalida', () => {
    expect(() => parseEnv({ ...ok, VITE_SUPABASE_URL: 'nao-e-url' })).toThrow(/invalida/);
  });
  it('recusa chave privilegiada sem ecoar o valor', () => {
    const secret = 'sb_secret_SEGREDO123';
    try {
      parseEnv({ ...ok, VITE_SUPABASE_PUBLISHABLE_KEY: secret });
      throw new Error('deveria falhar');
    } catch (e) {
      expect(e.message).toMatch(/privilegiada/);
      expect(e.message).not.toContain('SEGREDO123');
    }
  });
});
