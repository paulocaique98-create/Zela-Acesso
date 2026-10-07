// Fase 4C: drenagem da fila, relógio, heartbeat e transporte HTTP (tudo com transporte/fetch simulados, sem rede).
import { describe, expect, it, vi } from 'vitest';
import { openStore } from './store.js';
import { drainQueue } from './drain.js';
import { assessClock } from './clock.js';
import { sendHeartbeat } from './heartbeat.js';
import { createHttpTransport } from './transport.js';

const T0 = new Date('2026-10-05T14:00:00Z');
const iso = (d) => d.toISOString();

function storeWith(keys) {
  const s = openStore();
  for (const k of keys) s.enqueue(k, { p_idempotency_key: k }, iso(T0));
  return s;
}
const ok = (keys, status = 'recorded') => ({
  results: keys.map((k) => ({ idempotencyKey: k, status })),
});

describe('drainQueue', () => {
  it('fila vazia = idle, sem chamar a nuvem', async () => {
    const transport = { sendEvents: vi.fn() };
    const r = await drainQueue({ store: openStore(), transport, now: T0 });
    expect(r.status).toBe('idle');
    expect(transport.sendEvents).not.toHaveBeenCalled();
  });

  it('entrega em ordem, em lotes, e esvazia a fila', async () => {
    const keys = ['e-000001', 'e-000002', 'e-000003'];
    const store = storeWith(keys);
    const sent = [];
    const transport = {
      sendEvents: async (evs) => {
        sent.push(evs.map((e) => e.p_idempotency_key));
        return ok(evs.map((e) => e.p_idempotency_key));
      },
    };
    const r = await drainQueue({ store, transport, now: T0, batchSize: 2 });
    expect(sent).toEqual([['e-000001', 'e-000002'], ['e-000003']]);
    expect(r).toMatchObject({ status: 'drained', sent: 3, failed: 0 });
    expect(store.queueDepth()).toBe(0);
  });

  it('duplicate conta como entregue (reenvio após timeout)', async () => {
    const store = storeWith(['e-000001']);
    const r = await drainQueue({
      store,
      now: T0,
      transport: { sendEvents: async () => ok(['e-000001'], 'duplicate') },
    });
    expect(r.sent).toBe(1);
    expect(store.queueDepth()).toBe(0);
  });

  it('erro de transporte: offline, mantém tudo na fila com backoff e jitter', async () => {
    const store = storeWith(['e-000001']);
    const r = await drainQueue({
      store,
      now: T0,
      random: () => 0.5,
      transport: {
        sendEvents: async () => {
          throw new Error('fetch failed');
        },
      },
    });
    expect(r.status).toBe('offline');
    expect(store.queueDepth()).toBe(1);
    expect(store.dueEvents(iso(T0))).toHaveLength(0); // adiado
    // 2 s de base + 10% de jitter (0.2 * 0.5)
    expect(store.dueEvents(iso(new Date(T0.getTime() + 2_199)))).toHaveLength(0);
    expect(store.dueEvents(iso(new Date(T0.getTime() + 2_200)))).toHaveLength(1);
  });

  it('rejeição definitiva sai do envio mas fica guardada (nunca apagada)', async () => {
    const store = storeWith(['e-000001', 'e-000002']);
    const r = await drainQueue({
      store,
      now: T0,
      transport: {
        sendEvents: async () => ({
          results: [
            { idempotencyKey: 'e-000001', status: 'rejected', reason: 'INVALID' },
            { idempotencyKey: 'e-000002', status: 'recorded' },
          ],
        }),
      },
    });
    expect(r).toMatchObject({ sent: 1, rejected: 1 });
    expect(store.queueDepth()).toBe(0);
    expect(store.rejectedCount()).toBe(1);
    expect(store.purgeSent(iso(new Date(T0.getTime() + 1e9)))).toBe(1); // só o entregue é purgável
    expect(store.rejectedCount()).toBe(1);
  });

  it('resposta sem resultado para um evento: ele volta com backoff, sem laço infinito', async () => {
    const store = storeWith(['e-000001']);
    const transport = { sendEvents: vi.fn(async () => ({ results: [] })) };
    const r = await drainQueue({ store, transport, now: T0 });
    expect(r).toMatchObject({ status: 'partial', failed: 1 });
    expect(transport.sendEvents).toHaveBeenCalledTimes(1);
    expect(store.queueDepth()).toBe(1);
  });

  it('credencial recusada (revogado): apaga o cache, não reenvia e preserva a fila', async () => {
    const store = storeWith(['e-000001']);
    store.saveSnapshot({ hash: 'h', fetchedAt: iso(T0), body: '{}' });
    const r = await drainQueue({ store, now: T0, transport: { sendEvents: async () => null } });
    expect(r.status).toBe('revoked');
    expect(store.loadSnapshotRow()).toBeNull();
    expect(store.queueDepth()).toBe(1);
  });

  it('migra banco antigo sem a coluna rejected_at', () => {
    const s = openStore();
    expect(
      s.db
        .prepare('pragma table_info(event_queue)')
        .all()
        .map((c) => c.name),
    ).toContain('rejected_at');
  });
});

describe('assessClock', () => {
  const at = (ms) => new Date(T0.getTime() + ms);
  it('nunca verificado = não confiável', () => {
    expect(assessClock({ driftSeconds: null, lastContactAt: null, now: T0 })).toEqual({
      status: 'untrusted',
      reasons: ['CLOCK_NEVER_VERIFIED'],
    });
  });
  it('faixas de deriva (positiva e negativa)', () => {
    const f = (d) => assessClock({ driftSeconds: d, lastContactAt: iso(T0), now: T0 }).status;
    expect([f(0), f(60), f(61), f(-61), f(300), f(301), f(-301)]).toEqual([
      'ok',
      'ok',
      'warn',
      'warn',
      'warn',
      'untrusted',
      'untrusted',
    ]);
  });
  it('muito tempo sem contato torna a deriva conhecida não confiável', () => {
    const r = assessClock({ driftSeconds: 1, lastContactAt: iso(T0), now: at(25 * 3_600_000) });
    expect(r).toEqual({ status: 'untrusted', reasons: ['CLOCK_UNVERIFIED_LONG'] });
  });
});

describe('sendHeartbeat', () => {
  it('guarda a deriva e avalia o relógio; informa a fila', async () => {
    const store = storeWith(['e-000001']);
    const heartbeat = vi.fn(async () => ({ serverTime: iso(T0), clockDriftSeconds: 90 }));
    const r = await sendHeartbeat({ store, transport: { heartbeat }, now: T0, version: '0.1.0' });
    expect(heartbeat).toHaveBeenCalledWith({ version: '0.1.0', agentTime: iso(T0), queueDepth: 1 });
    expect(r).toMatchObject({ status: 'ok', clock: { status: 'warn' } });
  });
  it('offline: mantém a última deriva conhecida', async () => {
    const store = openStore();
    store.setMeta('clock_drift_s', '2');
    store.setMeta('clock_checked_at', iso(T0));
    const r = await sendHeartbeat({
      store,
      now: new Date(T0.getTime() + 1000),
      version: '0.1.0',
      transport: {
        heartbeat: async () => {
          throw new Error('timeout');
        },
      },
    });
    expect(r).toMatchObject({ status: 'offline', clock: { status: 'ok' } });
  });
  it('revogado: apaga o cache e marca o relógio como não confiável', async () => {
    const store = openStore();
    store.saveSnapshot({ hash: 'h', fetchedAt: iso(T0), body: '{}' });
    const r = await sendHeartbeat({
      store,
      now: T0,
      version: '0.1.0',
      transport: { heartbeat: async () => null },
    });
    expect(r.status).toBe('revoked');
    expect(store.loadSnapshotRow()).toBeNull();
  });
});

describe('createHttpTransport', () => {
  const cfg = {
    agentId: 'a1',
    secret: 'zes_x',
    baseUrl: 'https://x.supabase.co/functions/v1/edge-gateway',
  };
  const resp = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });

  it('exige https (loopback liberado para dev)', () => {
    expect(() => createHttpTransport({ ...cfg, baseUrl: 'http://example.com/x' })).toThrow(/https/);
    expect(() =>
      createHttpTransport({ ...cfg, baseUrl: 'http://127.0.0.1:55321/f' }),
    ).not.toThrow();
  });
  it('envia id e segredo em cabeçalhos (nunca na URL) e o op no corpo', async () => {
    const fetchImpl = vi.fn(async () => resp(200, { ok: true }));
    const t = createHttpTransport({ ...cfg, fetchImpl });
    await t.sendEvents([{ a: 1 }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain('zes_x');
    expect(init.headers).toMatchObject({ 'x-agent-id': 'a1', 'x-agent-secret': 'zes_x' });
    expect(JSON.parse(init.body)).toEqual({ op: 'events', events: [{ a: 1 }] });
  });
  it('401 = null (revogado); 5xx e 429 lançam (offline); falha de rede lança', async () => {
    const mk = (r) => createHttpTransport({ ...cfg, fetchImpl: async () => r });
    expect(await mk(resp(401, {})).heartbeat({})).toBeNull();
    await expect(mk(resp(503, {})).heartbeat({})).rejects.toThrow(/503/);
    await expect(mk(resp(429, {})).pullSnapshot(null)).rejects.toThrow(/429/);
    const boom = createHttpTransport({
      ...cfg,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    await expect(boom.sendEvents([])).rejects.toThrow('ECONNRESET');
  });
});
