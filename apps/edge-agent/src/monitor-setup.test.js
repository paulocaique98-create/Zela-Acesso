import { describe, expect, it } from 'vitest';
import { setupTerminals, startTerminalSetup } from './monitor-setup.js';

const fakeDriver = (failing = new Set()) => {
  const calls = [];
  return {
    calls,
    configureMonitor: async (id, a) => {
      calls.push(['monitor', id, a]);
      return { ok: !failing.has(id) };
    },
    configurePush: async (id, a) => {
      calls.push(['push', id, a]);
      return { ok: true };
    },
  };
};

describe('setupTerminals', () => {
  it('configura o Monitor em todos e o Push só nos pontos em modo push', async () => {
    const driver = fakeDriver();
    const r = await setupTerminals({
      driver,
      points: { a: {}, b: { transport: 'push' } },
      hostname: '192.168.0.20',
      port: 8000,
    });
    expect(r).toEqual({ pending: [], done: ['a', 'b'] });
    expect(driver.calls.map((c) => `${c[0]}:${c[1]}`)).toEqual([
      'monitor:a',
      'monitor:b',
      'push:b',
    ]);
  });

  it('terminal que falha fica pendente sem impedir os outros', async () => {
    const driver = fakeDriver(new Set(['a']));
    const r = await setupTerminals({ driver, points: { a: {}, b: {} }, hostname: 'h', port: 1 });
    expect(r).toEqual({ pending: ['a'], done: ['b'] });
  });

  it('exceção do driver vira pendência', async () => {
    const driver = {
      configureMonitor: async () => {
        throw new Error('x');
      },
      configurePush: async () => ({ ok: true }),
    };
    const r = await setupTerminals({ driver, points: { a: {} }, hostname: 'h', port: 1 });
    expect(r.pending).toEqual(['a']);
  });
});

describe('startTerminalSetup', () => {
  it('retenta só os pendentes até concluir e para ao abortar', async () => {
    const failing = new Set(['a']);
    const driver = fakeDriver(failing);
    const logs = [];
    const ac = new AbortController();
    await startTerminalSetup({
      driver,
      points: { a: {}, b: {} },
      hostname: 'h',
      port: 1,
      retryMs: 10,
      signal: ac.signal,
      log: (m) => logs.push(m),
    });
    expect(logs[0]).toBe('terminais configurados=1 pendentes=1');
    failing.delete('a');
    await new Promise((r) => setTimeout(r, 60));
    expect(logs.at(-1)).toBe('terminais configurados=2 pendentes=0');
    const retried = driver.calls.filter((c) => c[0] === 'monitor' && c[1] === 'b');
    expect(retried).toHaveLength(1); // b nunca foi retentado
    ac.abort();
  });
});
