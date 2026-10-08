import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { generateKeyPair, kidOf } from './keys.js';

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
    expect(() => loadConfig({ ...base, EDGE_DRIVER: 'mock' })).toThrow('EDGE_COMMAND_PUBKEYS');
    expect(() =>
      loadConfig({ ...base, EDGE_DRIVER: 'mock', EDGE_COMMAND_KEY: key, NODE_ENV: 'production' }),
    ).toThrow('produção');
    expect(() => loadConfig({ ...base, EDGE_DRIVER: 'real' })).toThrow('EDGE_DRIVER');
  });
  it('tick inválido', () => {
    expect(() => loadConfig({ ...base, EDGE_TICK_MS: '10' })).toThrow('EDGE_TICK_MS');
  });
});

describe('loadConfig (Fase 8A)', () => {
  const k = generateKeyPair();
  const kid = kidOf(k.publicKey);
  const prod = { ...base, NODE_ENV: 'production', EDGE_STORE_KEY: key };
  it('driver aceita só chaves públicas (sem HMAC) e expõe a âncora', () => {
    const c = loadConfig({
      ...base,
      EDGE_DRIVER: 'mock',
      EDGE_COMMAND_PUBKEYS: `${kid}:${k.publicKey}`,
    });
    expect(c.commandPubKeys).toEqual({ [kid]: k.publicKey });
    expect(c.commandKeys).toEqual([]);
  });
  it('TOFU só quando pedido e nunca em produção; pubkeys malformada recusa', () => {
    expect(loadConfig({ ...base, EDGE_DRIVER: 'mock', EDGE_COMMAND_TOFU: '1' }).commandTofu).toBe(
      true,
    );
    expect(() => loadConfig({ ...prod, EDGE_COMMAND_TOFU: '1' })).toThrow('TOFU');
    expect(() => loadConfig({ ...base, EDGE_COMMAND_PUBKEYS: 'lixo' })).toThrow(
      'EDGE_COMMAND_PUBKEYS',
    );
  });
  it('chave do dispositivo: validada e obrigatória em produção', () => {
    expect(loadConfig({ ...base, EDGE_DEVICE_KEY: k.privateKey }).deviceKey).toBe(k.privateKey);
    expect(() => loadConfig({ ...base, EDGE_DEVICE_KEY: 'invalida' })).toThrow('EDGE_DEVICE_KEY');
    expect(() => loadConfig(prod)).toThrow('EDGE_DEVICE_KEY');
    expect(loadConfig({ ...prod, EDGE_DEVICE_KEY: k.privateKey }).deviceKey).toBe(k.privateKey);
  });

  describe('driver controlid', () => {
    const pubs = { EDGE_COMMAND_TOFU: '1' };
    const ok = {
      ...base,
      ...pubs,
      EDGE_DRIVER: 'controlid',
      EDGE_CONTROLID_POINTS: JSON.stringify({
        p1: { baseUrl: 'http://192.168.0.129', login: 'op', passwordEnv: 'CID_P1', model: 'door' },
      }),
      CID_P1: 'senha-forte',
      EDGE_MONITOR_SECRET: 'a'.repeat(40),
      EDGE_MONITOR_BIND: '192.168.0.20',
    };
    it('monta pontos com a senha vinda da variável e o receptor', () => {
      const c = loadConfig(ok);
      expect(c.controlIdPoints.p1).toMatchObject({
        login: 'op',
        password: 'senha-forte',
        model: 'door',
      });
      expect(c.controlIdPoints.p1.passwordEnv).toBeUndefined();
      expect(c.monitor).toEqual({
        bind: '192.168.0.20',
        port: 8000,
        secret: 'a'.repeat(40),
        advertise: '192.168.0.20',
      });
    });
    it('falha fechado sem vazar a senha', () => {
      expect(() => loadConfig({ ...ok, CID_P1: '' })).toThrow('CID_P1');
      expect(() => loadConfig({ ...ok, EDGE_CONTROLID_POINTS: '{nao' })).toThrow('JSON');
      expect(() => loadConfig({ ...ok, EDGE_CONTROLID_POINTS: '{}' })).toThrow('não vazio');
      expect(() => loadConfig({ ...ok, EDGE_CONTROLID_POINTS: '{"p1":{"password":"x"}}' })).toThrow(
        'passwordEnv',
      );
      expect(() => loadConfig({ ...ok, EDGE_MONITOR_SECRET: 'curto' })).toThrow(
        'EDGE_MONITOR_SECRET',
      );
      expect(() => loadConfig({ ...ok, EDGE_MONITOR_BIND: '' })).toThrow('EDGE_MONITOR_BIND');
      expect(() => loadConfig({ ...ok, EDGE_MONITOR_PORT: '70000' })).toThrow('EDGE_MONITOR_PORT');
      expect(() => loadConfig({ ...ok, EDGE_MONITOR_BIND: '0.0.0.0' })).toThrow('ADVERTISE_HOST');
      expect(
        loadConfig({
          ...ok,
          EDGE_MONITOR_BIND: '0.0.0.0',
          EDGE_MONITOR_ADVERTISE_HOST: '192.168.0.20',
        }).monitor.advertise,
      ).toBe('192.168.0.20');
      try {
        loadConfig({ ...ok, EDGE_MONITOR_SECRET: 'curto' });
      } catch (e) {
        expect(String(e)).not.toContain('senha-forte');
      }
    });
  });
});

describe('loadConfig (facial)', () => {
  const base = { EDGE_GATEWAY_URL: 'https://x.test', EDGE_AGENT_ID: 'a', EDGE_AGENT_SECRET: 's' };
  it('facial desligado por padrão; liga só com EDGE_FACE=1', () => {
    expect(loadConfig(base).face).toBe(false);
    expect(loadConfig({ ...base, EDGE_FACE: '0' }).face).toBe(false);
    expect(loadConfig({ ...base, EDGE_FACE: 'true' }).face).toBe(false);
    expect(loadConfig({ ...base, EDGE_FACE: '1' }).face).toBe(true);
  });
});
