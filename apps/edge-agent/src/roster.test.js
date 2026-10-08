import { describe, expect, it } from 'vitest';
import { createControlIdDriver } from '@zela/device-drivers';
import { IDS, MONDAY_10H, MONDAY_20H, makeSnapshot } from './fixtures.js';
import { recordDeviceDecisions } from './device-events.js';
import {
  allocateDeviceUserIds,
  authorizedPeople,
  personIdForDeviceUser,
  syncRosters,
} from './roster.js';
import { runOnce } from './runner.js';
import { applySnapshot, buildIndex } from './snapshot.js';
import { openStore } from './store.js';

const PREFIX = '/api/notifications/segredo';
const withSnap = (o, now = MONDAY_10H, { clockOk = true } = {}) => {
  const store = openStore(':memory:');
  if (clockOk) {
    store.setMeta('clock_drift_s', '0');
    store.setMeta('clock_checked_at', now.toISOString());
  }
  applySnapshot(store, { hash: 'h1', snapshot: makeSnapshot(o) }, now);
  return store;
};

describe('authorizedPeople', () => {
  const idx = (o) => buildIndex(makeSnapshot(o));
  it('inclui só quem a política libera agora', () => {
    expect(authorizedPeople(idx(), IDS.point, MONDAY_10H)).toEqual([IDS.ana]);
  });
  it('fora da janela de horário ninguém é liberado', () => {
    expect(authorizedPeople(idx(), IDS.point, MONDAY_20H)).toEqual([]);
  });
  it('ponto desconhecido ou inativo não libera ninguém', () => {
    expect(authorizedPeople(idx(), 'x', MONDAY_10H)).toEqual([]);
    const s = makeSnapshot();
    s.accessPoints[0].status = 'inactive';
    expect(authorizedPeople(buildIndex(s), IDS.point, MONDAY_10H)).toEqual([]);
  });
  it('pessoa inativa sai do roster', () => {
    const s = makeSnapshot();
    s.people[0].status = 'suspended';
    expect(authorizedPeople(buildIndex(s), IDS.point, MONDAY_10H)).toEqual([]);
  });
});

describe('allocateDeviceUserIds', () => {
  it('ids estáveis, crescentes e nunca reaproveitados', () => {
    const store = openStore(':memory:');
    const a = allocateDeviceUserIds(store, ['p1', 'p2']);
    expect(a).toEqual({ p1: 100000, p2: 100001 });
    const b = allocateDeviceUserIds(store, ['p2', 'p3']); // p1 saiu
    expect(b).toEqual({ p1: 100000, p2: 100001, p3: 100002 });
    expect(personIdForDeviceUser(store, 100001)).toBe('p2');
    expect(personIdForDeviceUser(store, 55)).toBeNull();
    expect(personIdForDeviceUser(store, 'abc')).toBeNull();
  });
  it('meta corrompido não derruba', () => {
    const store = openStore(':memory:');
    store.setMeta('device_users', '{nao-json');
    expect(allocateDeviceUserIds(store, ['p1'])).toEqual({ p1: 100000 });
  });
});

describe('syncRosters', () => {
  it('sem cache não mexe no terminal', async () => {
    const calls = [];
    const r = await syncRosters({
      store: openStore(':memory:'),
      driver: { syncRoster: async (...a) => calls.push(a) },
      pointIds: [IDS.point],
      now: MONDAY_10H,
    });
    expect(r).toEqual({ status: 'no_cache', points: {} });
    expect(calls).toHaveLength(0);
  });

  it('envia a lista desejada, resume e isola falhas por ponto', async () => {
    const store = withSnap();
    const sent = [];
    const driver = {
      syncRoster: async (id, list) => {
        sent.push([id, list]);
        if (id === IDS.exitPoint) throw new Error('boom');
        return { ok: true, code: 'OK', created: list.length, removed: 0, conflicts: [] };
      },
    };
    const r = await syncRosters({
      store,
      driver,
      pointIds: [IDS.point, IDS.exitPoint, 'desconhecido'],
      now: MONDAY_10H,
    });
    expect(sent[0]).toEqual([IDS.point, [{ deviceUserId: 100000, name: 'Zela 100000' }]]);
    expect(r.points[IDS.point]).toEqual({
      ok: true,
      code: 'OK',
      created: 1,
      removed: 0,
      conflicts: 0,
    });
    expect(r.points[IDS.exitPoint]).toEqual({ ok: false, code: 'ERROR' });
    expect(r.points.desconhecido).toEqual({ ok: false, code: 'UNKNOWN_POINT' });
    expect(personIdForDeviceUser(store, 100000)).toBe(IDS.ana);
  });

  it('o runner executa a etapa no intervalo e não a repete antes dele', async () => {
    const store = withSnap();
    const calls = [];
    const roster = {
      driver: { syncRoster: async (...a) => (calls.push(a), { ok: true, code: 'OK' }) },
      pointIds: [IDS.point],
    };
    const last = {};
    const base = { store, transport: null, version: 't', last, commands: null, roster };
    const iv = { heartbeatMs: 1e12, syncMs: 1e12, drainMs: 1e12 };
    last.heartbeat = last.sync = last.drain = MONDAY_10H.getTime();
    const r1 = await runOnce({ ...base, now: MONDAY_10H, intervals: iv });
    expect(r1.ran).toEqual(['roster']);
    const r2 = await runOnce({
      ...base,
      now: new Date(MONDAY_10H.getTime() + 30_000),
      intervals: iv,
    });
    expect(r2.ran).toEqual([]);
    const r3 = await runOnce({
      ...base,
      now: new Date(MONDAY_10H.getTime() + 61_000),
      intervals: iv,
    });
    expect(r3.ran).toEqual(['roster']);
    expect(calls).toHaveLength(2);
  });
});

describe('syncRosters: cautela com cache defasado e relógio não confiável', () => {
  const recorder = () => {
    const sent = [];
    return {
      sent,
      driver: {
        syncRoster: async (id, list) => (
          sent.push([id, list]),
          { ok: true, code: 'OK', created: 0, removed: 0, conflicts: [] }
        ),
      },
    };
  };
  const run = (store, driver, now) => syncRosters({ store, driver, pointIds: [IDS.point], now });
  const DAY = 24 * 3_600_000;

  it('relógio nunca verificado: ponto degraded_allow congela, degraded_deny esvazia', async () => {
    const frozen = recorder();
    const r1 = await run(withSnap({}, MONDAY_10H, { clockOk: false }), frozen.driver, MONDAY_10H);
    expect(r1.points[IDS.point]).toEqual({ ok: true, code: 'FROZEN' });
    expect(frozen.sent).toHaveLength(0);

    const deny = recorder();
    const r2 = await run(
      withSnap({ offlineBehavior: 'degraded_deny' }, MONDAY_10H, { clockOk: false }),
      deny.driver,
      MONDAY_10H,
    );
    expect(r2.points[IDS.point].ok).toBe(true);
    expect(deny.sent).toEqual([[IDS.point, []]]);
  });

  it('cache com mais de 7 dias: mesma regra, mesmo com relógio bom', async () => {
    const later = new Date(MONDAY_10H.getTime() + 8 * DAY);
    const mk = (o) => {
      const st = withSnap(o);
      st.setMeta('clock_checked_at', later.toISOString());
      return st;
    };
    const frozen = recorder();
    expect((await run(mk({}), frozen.driver, later)).points[IDS.point].code).toBe('FROZEN');
    const deny = recorder();
    await run(mk({ offlineBehavior: 'degraded_deny' }), deny.driver, later);
    expect(deny.sent).toEqual([[IDS.point, []]]);
  });

  it('cache fresco e relógio ok: sincroniza normalmente', async () => {
    const ok = recorder();
    await run(withSnap(), ok.driver, MONDAY_10H);
    expect(ok.sent[0][1]).toHaveLength(1);
  });
});

describe('integração com o driver e os eventos do terminal', () => {
  const T = new Date('2026-10-08T10:00:00Z');
  function setup() {
    const store = withSnap();
    const driver = createControlIdDriver({
      points: {
        [IDS.point]: {
          baseUrl: 'http://10.0.0.5',
          login: 'op',
          password: 'x',
          model: 'door',
          deviceId: 478435,
          doorSensor: true,
        },
      },
      env: 'test',
      now: () => T,
      monitorPathPrefix: PREFIX,
      forcedGraceMs: 5_000,
      fetchImpl: async (url) => {
        const p = new URL(url).pathname;
        const ok = (o) => new Response(JSON.stringify(o));
        if (p === '/login.fcgi') return ok({ session: 's' });
        if (p === '/load_objects.fcgi')
          return ok({ users: [], access_rules: [], portal_access_rules: [] });
        return ok({});
      },
    });
    let n = 0;
    recordDeviceDecisions({
      store,
      driver,
      now: () => T,
      newId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
    });
    return { store, driver };
  }
  const dao = (d, userId) =>
    d.handleNotification(`${PREFIX}/dao`, {
      device_id: 478435,
      object_changes: [
        {
          object: 'access_logs',
          type: 'inserted',
          values: { id: '9', event: '7', user_id: String(userId), portal_id: '1', time: '1' },
        },
      ],
    });

  it('o deviceUserId sincronizado vira a pessoa na evidência; usuário manual fica sem pessoa', async () => {
    const { store, driver } = setup();
    await syncRosters({ store, driver, pointIds: [IDS.point], now: MONDAY_10H });
    dao(driver, 100000);
    dao(driver, 7);
    const [a, m] = store.dueEvents(T.toISOString()).map((r) => r.payload);
    expect(a.p_person).toBe(IDS.ana);
    expect(a.p_reason_code).toBe('DEVICE_LOCAL_ALLOW');
    expect(m.p_person).toBeNull();
  });

  it('door.forced vira physical_outcome DOOR_FORCED com correlação própria', () => {
    const { store, driver } = setup();
    driver.handleNotification(`${PREFIX}/door`, { door: { id: 1, open: true }, device_id: 478435 });
    driver.tick(new Date(T.getTime() + 5_000));
    const [e] = store.dueEvents(T.toISOString()).map((r) => r.payload);
    expect(e).toMatchObject({
      p_event_type: 'physical_outcome',
      p_physical_outcome: 'DOOR_FORCED',
      p_access_point: IDS.point,
      p_tenant: IDS.tenant,
    });
    expect(e.p_correlation).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.p_idempotency_key.startsWith('edge:door:')).toBe(true);
  });
});
