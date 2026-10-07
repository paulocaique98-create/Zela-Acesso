import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backoffMs, openStore } from './store.js';
import { applySnapshot, loadCache, SnapshotError } from './snapshot.js';
import { syncSnapshot } from './sync.js';
import { IDS, makeSnapshot } from './fixtures.js';

const T0 = new Date('2026-10-05T14:00:00Z');

describe('fila persistente', () => {
  it('backoff exponencial com teto de 15 min', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(30)).toBe(15 * 60_000);
    expect(backoffMs(0)).toBe(2000);
  });

  it('só devolve eventos vencidos, em ordem; falha adia; enviado sai da fila', () => {
    const s = openStore();
    s.enqueue('k1', { n: 1 }, T0.toISOString());
    s.enqueue('k2', { n: 2 }, T0.toISOString());
    const due = s.dueEvents(T0.toISOString());
    expect(due.map((e) => e.payload.n)).toEqual([1, 2]);
    s.markFailed(due[0].id, T0, 'timeout');
    expect(s.dueEvents(T0.toISOString()).map((e) => e.payload.n)).toEqual([2]);
    expect(
      s.dueEvents(new Date(T0.getTime() + 2001).toISOString()).map((e) => e.payload.n),
    ).toEqual([1, 2]);
    s.markSent(due[1].id, T0.toISOString());
    expect(s.queueDepth()).toBe(1);
    expect(s.purgeSent(new Date(T0.getTime() + 1000).toISOString())).toBe(1);
  });

  it('sobrevive a reinício do processo (arquivo em disco)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zela-edge-'));
    const file = join(dir, 'edge.db');
    try {
      const a = openStore(file);
      a.enqueue('k1', { n: 1 }, T0.toISOString());
      applySnapshot(a, { hash: 'h', snapshot: makeSnapshot() }, T0);
      a.close();
      const b = openStore(file);
      expect(b.queueDepth()).toBe(1);
      expect(loadCache(b)?.hash).toBe('h');
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('presença não regride com evento mais antigo (replay)', () => {
    const s = openStore();
    s.setPresence('z', 'p', 'present', '2026-10-05T10:00:00.000Z');
    s.setPresence('z', 'p', 'absent', '2026-10-05T09:00:00.000Z');
    expect(s.getPresence('z', 'p').state).toBe('present');
    s.setPresence('z', 'p', 'absent', '2026-10-05T11:00:00.000Z');
    expect(s.getPresence('z', 'p').state).toBe('absent');
  });
});

describe('aplicação do snapshot', () => {
  it('rejeita formato inválido e mantém o cache anterior', () => {
    const s = openStore();
    applySnapshot(s, { hash: 'ok', snapshot: makeSnapshot() }, T0);
    const bad = makeSnapshot();
    bad.accessPoints[0].zoneId = 'zona-de-outro-sitio';
    expect(() => applySnapshot(s, { hash: 'ruim', snapshot: bad }, T0)).toThrow(SnapshotError);
    expect(() =>
      applySnapshot(s, { hash: 'v2', snapshot: { ...makeSnapshot(), version: 2 } }, T0),
    ).toThrow(SnapshotError);
    expect(() =>
      applySnapshot(
        s,
        { hash: 'tz', snapshot: { ...makeSnapshot(), timezone: 'Marte/Olimpo' } },
        T0,
      ),
    ).toThrow(SnapshotError);
    expect(loadCache(s).hash).toBe('ok');
  });

  it('prende o agente ao primeiro tenant/site e rejeita outro', () => {
    const s = openStore();
    applySnapshot(s, { hash: 'a', snapshot: makeSnapshot() }, T0);
    const other = { ...makeSnapshot(), tenantId: '10000000-0000-0000-0000-00000000000b' };
    expect(() => applySnapshot(s, { hash: 'b', snapshot: other }, T0)).toThrow(/outro tenant/);
    expect(loadCache(s).hash).toBe('a');
  });

  it('novo snapshot substitui o anterior por inteiro (revogação propaga)', () => {
    const s = openStore();
    applySnapshot(s, { hash: 'a', snapshot: makeSnapshot() }, T0);
    const next = makeSnapshot();
    next.credentials = next.credentials.filter((c) => c.id !== IDS.anaPin);
    applySnapshot(s, { hash: 'b', snapshot: next }, T0);
    expect(loadCache(s).index.pinByPerson.has(IDS.ana)).toBe(false);
  });
});

describe('syncSnapshot', () => {
  const mk = (res) => ({ pullSnapshot: async () => res });

  it('aplica snapshot novo, confirma "unchanged" renovando a idade e informa offline', async () => {
    const s = openStore();
    expect(
      await syncSnapshot({
        store: s,
        now: T0,
        transport: mk({ unchanged: false, hash: 'h1', snapshot: makeSnapshot() }),
      }),
    ).toEqual({
      status: 'updated',
    });
    const later = new Date(T0.getTime() + 3600_000);
    expect(
      await syncSnapshot({ store: s, now: later, transport: mk({ unchanged: true, hash: 'h1' }) }),
    ).toEqual({
      status: 'unchanged',
    });
    expect(loadCache(s).fetchedAt.toISOString()).toBe(later.toISOString());
    const off = await syncSnapshot({
      store: s,
      now: later,
      transport: {
        pullSnapshot: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    expect(off.status).toBe('offline');
    expect(loadCache(s)).not.toBeNull();
  });

  it('credencial recusada (null) apaga o cache; snapshot inválido é rejeitado sem tocar o cache', async () => {
    const s = openStore();
    await syncSnapshot({
      store: s,
      now: T0,
      transport: mk({ unchanged: false, hash: 'h1', snapshot: makeSnapshot() }),
    });
    const rej = await syncSnapshot({
      store: s,
      now: T0,
      transport: mk({ unchanged: false, hash: 'x', snapshot: { version: 9 } }),
    });
    expect(rej.status).toBe('rejected');
    expect(loadCache(s).hash).toBe('h1');
    const mismatch = await syncSnapshot({
      store: s,
      now: T0,
      transport: mk({ unchanged: true, hash: 'outro' }),
    });
    expect(mismatch.status).toBe('rejected');
    expect(await syncSnapshot({ store: s, now: T0, transport: mk(null) })).toEqual({
      status: 'revoked',
    });
    expect(loadCache(s)).toBeNull();
  });
});
