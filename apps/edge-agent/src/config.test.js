import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { EDGE_GATEWAY_URL: 'https://x.test/f', EDGE_AGENT_ID: 'a', EDGE_AGENT_SECRET: 's' };
const key = 'a'.repeat(64);

describe('loadConfig', () => {
  it('padrão: sem driver e sem comando', () => {
    const c = loadConfig(base);
    expect(c.driver).toBe('none');
    expect(c.commandKeys).toEqual([]);
  });
  it('exige variáveis obrigatórias sem vazar valores', () => {
    expect(() => loadConfig({ ...base, EDGE_AGENT_SECRET: '' })).toThrow('EDGE_AGENT_SECRET');
  });
  it('chaves atual + anterior, nessa ordem', () => {
    const c = loadConfig({
      ...base,
      EDGE_DRIVER: 'mock',
      EDGE_COMMAND_KEY: key,
      EDGE_COMMAND_KEY_PREVIOUS: 'b'.repeat(64),
    });
    expect(c.commandKeys).toEqual([key, 'b'.repeat(64)]);
  });
  it('recusa chave malformada, driver sem chave, mock em produção e driver desconhecido', () => {
    expect(() => loadConfig({ ...base, EDGE_COMMAND_KEY: 'curta' })).toThrow('64 hex');
    expect(() => loadConfig({ ...base, EDGE_DRIVER: 'mock' })).toThrow('EDGE_COMMAND_KEY');
    expect(() =>
      loadConfig({ ...base, EDGE_DRIVER: 'mock', EDGE_COMMAND_KEY: key, NODE_ENV: 'production' }),
    ).toThrow('produção');
    expect(() => loadConfig({ ...base, EDGE_DRIVER: 'real' })).toThrow('EDGE_DRIVER');
  });
  it('tick inválido', () => {
    expect(() => loadConfig({ ...base, EDGE_TICK_MS: '10' })).toThrow('EDGE_TICK_MS');
  });
});
