import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { generateKeyPair } from './keys.js';
import { reportEnrolledReaders } from './reader-report.js';
import { runOnce } from './runner.js';
import { openStore } from './store.js';

const base = { EDGE_GATEWAY_URL: 'https://x.test/f', EDGE_AGENT_ID: 'a', EDGE_AGENT_SECRET: 's' };

describe('configuração dos leitores (Zela Pass)', () => {
  it('desligado por padrão', () => {
    expect(loadConfig(base).reader).toBeNull();
  });
  it('liga com EDGE_READER_BIND e usa as portas padrão', () => {
    const c = loadConfig({ ...base, EDGE_READER_BIND: '127.0.0.1' });
    expect(c.reader).toMatchObject({ bind: '127.0.0.1', port: 8443, tcpPort: null, tlsCert: null });
  });
  it('porta TCP opcional e diferente da HTTP', () => {
    const c = loadConfig({ ...base, EDGE_READER_BIND: '127.0.0.1', EDGE_READER_TCP_PORT: '8444' });
    expect(c.reader.tcpPort).toBe(8444);
    expect(() =>
      loadConfig({
        ...base,
        EDGE_READER_BIND: '127.0.0.1',
        EDGE_READER_PORT: '9000',
        EDGE_READER_TCP_PORT: '9000',
      }),
    ).toThrow('diferir');
    expect(() =>
      loadConfig({ ...base, EDGE_READER_BIND: '127.0.0.1', EDGE_READER_PORT: '70000' }),
    ).toThrow('EDGE_READER_PORT');
  });
  it('certificado e chave só juntos', () => {
    expect(() =>
      loadConfig({ ...base, EDGE_READER_BIND: '0.0.0.0', EDGE_READER_TLS_CERT: 'c.pem' }),
    ).toThrow('juntas');
  });
  it('produção fora de loopback exige TLS; loopback e dev não', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      EDGE_DEVICE_KEY: generateKeyPair().privateKey,
      EDGE_STORE_KEY: 'a'.repeat(64),
    };
    expect(() => loadConfig({ ...prod, EDGE_READER_BIND: '0.0.0.0' })).toThrow('TLS');
    expect(
      loadConfig({
        ...prod,
        EDGE_READER_BIND: '0.0.0.0',
        EDGE_READER_TLS_CERT: 'c.pem',
        EDGE_READER_TLS_KEY: 'k.pem',
      }).reader.tlsCert,
    ).toBe('c.pem');
    expect(loadConfig({ ...prod, EDGE_READER_BIND: '127.0.0.1' }).reader).not.toBeNull();
    expect(loadConfig({ ...base, EDGE_READER_BIND: '0.0.0.0' }).reader).not.toBeNull(); // dev
  });
});

describe('relato de leitores ativados à nuvem', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const seed = (store) => {
    store.enrollReader(
      'c0000000-0000-0000-0000-0000000000a1',
      'a'.repeat(64),
      'Tablet',
      now.toISOString(),
    );
  };

  it('nada a relatar = idle e nenhuma chamada', async () => {
    const store = openStore();
    let calls = 0;
    const r = await reportEnrolledReaders({
      store,
      now,
      transport: { reportReaderEnrolled: async () => void calls++ },
    });
    expect(r).toEqual({ status: 'idle', reported: 0 });
    expect(calls).toBe(0);
  });

  it('envia chave pública e rótulo (nunca o código) e marca como informado', async () => {
    const store = openStore();
    seed(store);
    const sent = [];
    const r = await reportEnrolledReaders({
      store,
      now,
      transport: {
        reportReaderEnrolled: async (...a) => (sent.push(a), { recorded: true }),
      },
    });
    expect(r).toEqual({ status: 'ok', reported: 1 });
    expect(sent).toEqual([['c0000000-0000-0000-0000-0000000000a1', 'a'.repeat(64), 'Tablet']]);
    expect(store.unreportedReaders()).toHaveLength(0);
  });

  it('rede fora: tenta de novo depois', async () => {
    const store = openStore();
    seed(store);
    const r = await reportEnrolledReaders({
      store,
      now,
      transport: {
        reportReaderEnrolled: async () => {
          throw new Error('rede');
        },
      },
    });
    expect(r.status).toBe('offline');
    expect(store.unreportedReaders()).toHaveLength(1);
  });

  it('agente revogado (null) para o laço; recorded:false não insiste', async () => {
    const store = openStore();
    seed(store);
    expect(
      (
        await reportEnrolledReaders({
          store,
          now,
          transport: { reportReaderEnrolled: async () => null },
        })
      ).status,
    ).toBe('revoked');
    expect(store.unreportedReaders()).toHaveLength(1);
    const r = await reportEnrolledReaders({
      store,
      now,
      transport: { reportReaderEnrolled: async () => ({ recorded: false }) },
    });
    expect(r.reported).toBe(1);
    expect(store.unreportedReaders()).toHaveLength(0);
  });

  it('runOnce inclui a etapa só quando há o que relatar', async () => {
    const store = openStore();
    const transport = {
      heartbeat: async () => ({ serverTime: now.toISOString(), clockDriftSeconds: 0 }),
      pullSnapshot: async () => ({ unchanged: true, hash: 'h', serverTime: now.toISOString() }),
      sendEvents: async () => ({ results: [] }),
      reportReaderEnrolled: async () => ({ recorded: true }),
    };
    const quiet = await runOnce({ store, transport, now, version: 't', last: {} });
    expect(quiet.ran).not.toContain('readers');
    seed(store);
    const busy = await runOnce({ store, transport, now, version: 't', last: {} });
    expect(busy.ran).toContain('readers');
    expect(store.unreportedReaders()).toHaveLength(0);
  });
});
