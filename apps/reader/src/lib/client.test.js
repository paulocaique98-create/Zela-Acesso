// O cliente do PWA (WebCrypto) contra o serviço REAL do Edge: prova que as assinaturas e o protocolo são compatíveis.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { applySnapshot, createReaderService, openStore } from '@zela/edge-agent';
import {
  ANA_CARD,
  ANA_PIN,
  ANA_REF,
  ANA_TOKEN,
  ENROLL_CODE,
  IDS,
  MONDAY_10H,
  makeSnapshot,
} from '../../../edge-agent/src/fixtures.js';
import { createReaderClient } from './client.js';
import {
  constantTimeEqual,
  ed25519Supported,
  generateDeviceKeys,
  hashOperatorPin,
} from './crypto.js';
import { openKv } from './db.js';
import { TransportError, createTransport } from './transport.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const meta = (over = {}) => ({
  id: IDS.reader,
  accessPointId: IDS.registerPoint,
  status: 'pending',
  enrollmentTokenHash: sha256(ENROLL_CODE),
  enrollmentExpiresAt: '2026-10-06T14:00:00Z',
  ...over,
});

let store;
let service;
let edgeNow;
let hits;
const load = (readers) =>
  applySnapshot(
    store,
    { hash: `h${Math.random()}`, snapshot: makeSnapshot({ readers }) },
    MONDAY_10H,
  );

/** Transporte de teste: entrega o envelope direto ao serviço do Edge. */
const direct = (over = {}) => ({
  async send(env) {
    hits.push(env);
    if (over.fail?.()) throw new TransportError('rede');
    const r = await service.handle(env, { source: 'teste' });
    return { status: r.status, ...r.body };
  },
});

async function activatedClient(deviceNow = () => edgeNow) {
  load([meta()]);
  const keys = await generateDeviceKeys();
  const client = createReaderClient({ transport: direct(), now: deviceNow });
  const e = await client.enroll({ code: ENROLL_CODE, label: 'Tablet', ...keys });
  expect(e.ok).toBe(true);
  client.setIdentity({ readerId: e.readerId, privateKey: keys.privateKey });
  load([meta({ status: 'active', enrollmentTokenHash: null })]);
  return { client, keys, e };
}

beforeEach(() => {
  store = openStore();
  edgeNow = MONDAY_10H.getTime();
  hits = [];
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  service = createReaderService({ store, clock: () => new Date(edgeNow), isOffline: () => false });
});

describe('WebCrypto x Edge', () => {
  it('este ambiente suporta Ed25519 e a chave privada não é extraível', async () => {
    expect(await ed25519Supported()).toBe(true);
    const k = await generateDeviceKeys();
    expect(k.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(k.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', k.privateKey)).rejects.toThrow();
  });

  it('ativa, consulta status e registra por QR, barras e senha', async () => {
    const { client, e } = await activatedClient();
    expect(e).toMatchObject({ readerId: IDS.reader, mode: 'register_only' });
    expect((await client.status()).ok).toBe(true);
    for (const reading of [
      { method: 'qr', value: ANA_TOKEN },
      { method: 'barcode', value: ANA_CARD },
      { method: 'pin', identifier: ANA_REF, pin: ANA_PIN },
    ]) {
      const r = await client.attempt(reading);
      expect(r, reading.method).toMatchObject({
        ok: true,
        outcome: 'REGISTERED',
        label: 'Registrado',
      });
    }
  });

  it('credencial inválida: o Edge responde sem motivo e nada é aceito', async () => {
    const { client } = await activatedClient();
    const r = await client.attempt({ method: 'qr', value: 'token-que-nao-existe-1' });
    expect(r.outcome).toBe('INVALID_CREDENTIAL');
  });

  it('relógio do aparelho muda para 10 min atrás: corrige sozinho e reenvia', async () => {
    let skew = 0;
    const { client } = await activatedClient(() => edgeNow - skew);
    skew = 10 * 60_000; // alguém mexeu na hora do tablet depois da ativação
    hits.length = 0;
    const r = await client.attempt({ method: 'qr', value: ANA_TOKEN });
    expect(r.outcome).toBe('REGISTERED');
    expect(hits.length).toBe(2); // 1ª recusada por CLOCK_SKEW, 2ª já com a hora do Edge
    expect(Math.abs(client.clockOffsetMs() - 10 * 60_000)).toBeLessThan(2_000);
    expect(Math.abs(client.edgeNow() - edgeNow)).toBeLessThan(2_000);
    hits.length = 0;
    await client.attempt({ method: 'qr', value: ANA_TOKEN });
    expect(hits.length).toBe(1); // offset aprendido: não repete o erro
  });

  it('ativação já funciona com o relógio do aparelho errado (aprende a hora do Edge)', async () => {
    const { client } = await activatedClient(() => edgeNow + 30 * 60_000);
    expect(Math.abs(client.clockOffsetMs() + 30 * 60_000)).toBeLessThan(2_000);
    expect((await client.status()).ok).toBe(true);
  });

  it('sem conexão com o Edge: UNAVAILABLE, depois de uma nova tentativa', async () => {
    const { client, keys, e } = await activatedClient();
    const down = createReaderClient({
      transport: direct({ fail: () => true }),
      now: () => edgeNow,
      identity: { readerId: e.readerId, privateKey: keys.privateKey },
    });
    const r = await down.attempt({ method: 'qr', value: ANA_TOKEN });
    expect(r).toMatchObject({ ok: false, outcome: 'UNAVAILABLE' });
    expect(client).toBeDefined(); // o cliente ativo segue válido
  });
});

describe('resposta perdida (idempotência ponta a ponta)', () => {
  it('o Edge processou, o aparelho não soube: o reenvio devolve o mesmo resultado', async () => {
    load([meta()]);
    const keys = await generateDeviceKeys();
    let lose = false;
    const seen = [];
    const transport = {
      async send(env) {
        const r = await service.handle(env, { source: 't' });
        seen.push(env);
        if (lose && env.type === 'attempt') {
          lose = false;
          throw new TransportError('resposta perdida');
        }
        return { status: r.status, ...r.body };
      },
    };
    const client = createReaderClient({ transport, now: () => edgeNow });
    const e = await client.enroll({ code: ENROLL_CODE, label: 'T', ...keys });
    client.setIdentity({ readerId: e.readerId, privateKey: keys.privateKey });
    load([meta({ status: 'active', enrollmentTokenHash: null })]);
    lose = true;
    const r = await client.attempt({ method: 'qr', value: ANA_TOKEN });
    expect(r).toMatchObject({ ok: true, outcome: 'REGISTERED', duplicate: true });
    const events = store.dueEvents('9999-01-01T00:00:00Z').map((d) => d.payload);
    expect(events).toHaveLength(1); // registrou UMA vez
    const attempts = seen.filter((s) => s.type === 'attempt');
    expect(attempts).toHaveLength(2);
    expect(JSON.parse(attempts[0].body).deviceEventId).toBe(
      JSON.parse(attempts[1].body).deviceEventId,
    );
    expect(attempts[0].nonce).not.toBe(attempts[1].nonce);
  });
});

describe('transporte', () => {
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

  it('HTTPS: devolve o status e o corpo; falha de rede vira TransportError', async () => {
    const t = createTransport({
      baseUrl: 'https://edge.local:8443/',
      prefer: 'https',
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://edge.local:8443/reader/v1/message');
        expect(init.method).toBe('POST');
        expect(init.cache).toBe('no-store');
        return okResponse({ ok: true, code: 'OK' });
      },
    });
    expect(await t.send({ v: 1 })).toMatchObject({ status: 200, ok: true });
    const down = createTransport({
      baseUrl: 'https://edge.local',
      prefer: 'https',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(down.send({})).rejects.toBeInstanceOf(TransportError);
  });

  it('WebSocket que não abre cai para HTTPS e não insiste por 30 s', async () => {
    let fetches = 0;
    let sockets = 0;
    class FailingWs {
      constructor() {
        sockets++;
        setTimeout(() => this.onerror?.(), 0);
      }
      close() {}
    }
    const t = createTransport({
      baseUrl: 'http://edge.local:8080',
      prefer: 'websocket',
      WebSocketImpl: FailingWs,
      fetchImpl: async () => (fetches++, okResponse({ ok: true })),
    });
    expect((await t.send({})).ok).toBe(true);
    expect(t.kind()).toBe('https');
    await t.send({});
    expect(sockets).toBe(1);
    expect(fetches).toBe(2);
  });

  it('WebSocket: usa wss na URL, respostas em ordem e erro se a conexão cair', async () => {
    const created = [];
    class FakeWs {
      readyState = 0;
      constructor(url) {
        created.push(this);
        this.url = url;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }
      send(text) {
        const n = JSON.parse(text).n;
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ ok: true, n }) }), 1);
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }
    const t = createTransport({
      baseUrl: 'https://edge.local:8443',
      WebSocketImpl: FakeWs,
      fetchImpl: async () => {
        throw new Error('não deveria usar HTTPS');
      },
    });
    const [a, b] = await Promise.all([t.send({ n: 1 }), t.send({ n: 2 })]);
    expect([a.n, b.n]).toEqual([1, 2]);
    expect(created[0].url).toBe('wss://edge.local:8443/reader/v1/ws');
    expect(t.kind()).toBe('websocket');
  });
});

describe('PIN do operador e armazenamento local', () => {
  it('PBKDF2 com sal: mesmo PIN e sal repetem o hash; PIN ou sal diferente, não', async () => {
    const a = await hashOperatorPin('482913', 'aa'.repeat(16), 1000);
    const b = await hashOperatorPin('482913', 'aa'.repeat(16), 1000);
    const c = await hashOperatorPin('482914', 'aa'.repeat(16), 1000);
    const d = await hashOperatorPin('482913', 'bb'.repeat(16), 1000);
    expect(constantTimeEqual(a.hash, b.hash)).toBe(true);
    expect(constantTimeEqual(a.hash, c.hash)).toBe(false);
    expect(constantTimeEqual(a.hash, d.hash)).toBe(false);
    expect(a.hash).not.toContain('482913');
  });

  it('armazenamento em memória quando não há IndexedDB', async () => {
    const kv = openKv(null);
    expect(kv.persistent).toBe(false);
    await kv.set('a', { x: 1 });
    expect(await kv.get('a')).toEqual({ x: 1 });
    await kv.del('a');
    expect(await kv.get('a')).toBeUndefined();
  });
});
