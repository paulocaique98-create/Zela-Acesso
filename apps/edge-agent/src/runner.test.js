// Fase 4C: laço de agendamento (transporte e tempo simulados).
import { describe, expect, it, vi } from 'vitest';
import { openStore } from './store.js';
import { runLoop, runOnce } from './runner.js';

const T0 = new Date('2026-10-05T14:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
const hb = { serverTime: T0.toISOString(), clockDriftSeconds: 0 };

function transport(over = {}) {
  return {
    heartbeat: vi.fn(async () => hb),
    pullSnapshot: vi.fn(async (known) => ({ unchanged: true, hash: known })),
    sendEvents: vi.fn(async () => ({ results: [] })),
    ...over,
  };
}

describe('runOnce — comandos remotos (4E)', () => {
  it('só roda com `commands` configurado e a cada commandsMs; 401 revoga', async () => {
    const store = openStore();
    const pollCommands = vi.fn(async () => ({ commands: [] }));
    const t = transport({ pollCommands });
    const last = {};
    const commands = { driver: {}, key: 'k', agentId: 'a' };
    const none = await runOnce({ store, transport: t, now: T0, version: 'v', last: {} });
    expect(none.ran).not.toContain('commands');
    const a = await runOnce({ store, transport: t, now: T0, version: 'v', last, commands });
    expect(a.ran).toEqual(['heartbeat', 'sync', 'commands', 'drain']);
    const b = await runOnce({ store, transport: t, now: at(1_000), version: 'v', last, commands });
    expect(b.ran).toEqual([]);
    const c = await runOnce({ store, transport: t, now: at(5_000), version: 'v', last, commands });
    expect(c.ran).toEqual(['commands']);
    const rev = transport({ pollCommands: async () => null });
    const d = await runOnce({
      store,
      transport: rev,
      now: at(10_000),
      version: 'v',
      last,
      commands,
    });
    expect(d.revoked).toBe(true);
  });
});

describe('runOnce', () => {
  it('primeira rodada executa tudo, nesta ordem; a seguinte não repete antes do intervalo', async () => {
    const store = openStore();
    const t = transport();
    const last = {};
    const a = await runOnce({ store, transport: t, now: T0, version: 'v', last });
    expect(a.ran).toEqual(['heartbeat', 'sync', 'drain']);
    const b = await runOnce({ store, transport: t, now: at(1_000), version: 'v', last });
    expect(b.ran).toEqual([]);
    const c = await runOnce({ store, transport: t, now: at(10_000), version: 'v', last });
    expect(c.ran).toEqual(['drain']);
    const d = await runOnce({ store, transport: t, now: at(60_000), version: 'v', last });
    expect(d.ran).toEqual(['heartbeat', 'drain']);
  });

  it('heartbeat recusado (revogado) interrompe a rodada: não sincroniza nem entrega', async () => {
    const store = openStore();
    store.enqueue('e-000001', { p_idempotency_key: 'e-000001' }, T0.toISOString());
    const t = transport({ heartbeat: vi.fn(async () => null) });
    const r = await runOnce({ store, transport: t, now: T0, version: 'v', last: {} });
    expect(r).toMatchObject({ revoked: true, ran: ['heartbeat'] });
    expect(t.pullSnapshot).not.toHaveBeenCalled();
    expect(t.sendEvents).not.toHaveBeenCalled();
    expect(store.queueDepth()).toBe(1); // fila preservada
  });

  it('nuvem fora do ar: tudo vira offline, sem lançar', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };
    const store = openStore();
    store.enqueue('e-000001', { p_idempotency_key: 'e-000001' }, T0.toISOString());
    const t = transport({ heartbeat: boom, pullSnapshot: boom, sendEvents: boom });
    const r = await runOnce({ store, transport: t, now: T0, version: 'v', last: {} });
    expect(r.revoked).toBe(false);
    expect(r.results.heartbeat.status).toBe('offline');
    expect(r.results.sync.status).toBe('offline');
    expect(r.results.drain.status).toBe('offline');
    expect(store.queueDepth()).toBe(1);
  });
});

describe('runOnce: eliminação biométrica (7D)', () => {
  const run = (t, extra) =>
    runOnce({ store: openStore(), transport: t, now: T0, version: 'v', last: {}, ...extra });

  it('sem biometricProvider (Edge sem biometria): a etapa não roda', async () => {
    const r = await run(transport());
    expect(r.ran).toEqual(['heartbeat', 'sync', 'drain']);
  });

  it('roda logo depois do sync, antes do drain', async () => {
    const r = await run(transport(), { biometricProvider: null });
    expect(r.ran).toEqual(['heartbeat', 'sync', 'biometricErasure', 'drain']);
  });

  it('sync offline: pula a etapa (a fila só vem do snapshot)', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await run(transport({ pullSnapshot: boom }), { biometricProvider: null });
    expect(r.ran).toEqual(['heartbeat', 'sync', 'drain']);
  });
});

describe('runLoop', () => {
  it('para ao ser revogado e devolve "revoked"', async () => {
    const t = transport({ heartbeat: vi.fn(async () => null) });
    const r = await runLoop({
      store: openStore(),
      transport: t,
      version: 'v',
      sleep: async () => {},
    });
    expect(r).toBe('revoked');
  });

  it('erro inesperado numa rodada não derruba o laço; para pelo AbortSignal', async () => {
    const ctl = new AbortController();
    const onError = vi.fn();
    let calls = 0;
    const t = transport({
      heartbeat: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('bug');
        return hb;
      }),
    });
    // sendHeartbeat captura o erro como offline; forçamos um erro fora dele
    const store = openStore();
    const orig = store.dueEvents;
    let boomed = false;
    store.dueEvents = () => {
      if (!boomed) {
        boomed = true;
        throw new Error('sqlite travou');
      }
      return orig();
    };
    let ticks = 0;
    const r = await runLoop({
      store,
      transport: t,
      version: 'v',
      onError,
      signal: ctl.signal,
      sleep: async () => {
        if (++ticks >= 2) ctl.abort();
      },
    });
    expect(r).toBe('stopped');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ticks).toBe(2);
  });
});
