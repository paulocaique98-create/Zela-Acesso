import { describe, expect, it } from 'vitest';
import { ZELA_RULE_ID, createControlIdDriver } from './index.js';

const PREFIX = '/api/notifications/s3cr3tpath';
const DEVICE_ID = 478435;

/** Terminal simulado com banco em memória (users, regras, vínculos). NÃO é um equipamento real. */
function fakeDevice(seed = {}) {
  const db = {
    users: [...(seed.users ?? [])],
    access_rules: [...(seed.access_rules ?? [])],
    portal_access_rules: [...(seed.portal_access_rules ?? [])],
    user_access_rules: [],
  };
  const calls = [];
  let failOn = null;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = JSON.parse(init.body);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname === '/login.fcgi') return json({ session: 's1' });
    calls.push({ path: u.pathname, body });
    if (failOn && failOn === `${u.pathname}:${body.object}`) return json({}, 500);
    if (u.pathname === '/load_objects.fcgi') return json({ [body.object]: db[body.object] });
    if (u.pathname === '/create_objects.fcgi') {
      db[body.object].push(...body.values);
      return json({ ids: body.values.map((v) => v.id ?? 0) });
    }
    if (u.pathname === '/destroy_objects.fcgi') {
      const ids = new Set(body.where.users.id);
      db.users = db.users.filter((x) => !ids.has(x.id));
      return json({});
    }
    return json({}, 404);
  };
  return {
    fetchImpl,
    calls,
    db: () => db,
    failOn: (k) => {
      failOn = k;
    },
  };
}

let clock = 0;
const mk = (dev, point = {}) =>
  createControlIdDriver({
    points: {
      p1: {
        baseUrl: 'http://192.168.0.129',
        login: 'op',
        password: 'segredo',
        model: 'door',
        deviceId: DEVICE_ID,
        ...point,
      },
    },
    fetchImpl: dev.fetchImpl,
    env: 'test',
    now: () => new Date(Date.UTC(2026, 9, 8, 10, 0, 0) + clock),
    monitorPathPrefix: PREFIX,
    timeoutMs: 50,
    forcedGraceMs: 5_000,
    holdOpenMs: 600_000,
  });

const at = (ms) => new Date(Date.UTC(2026, 9, 8, 10, 0, 0) + ms);
const collect = (d) => {
  const ev = [];
  d.onEvent((e) => ev.push(e));
  return ev;
};
const u = (id) => ({ deviceUserId: id, name: `Zela ${id}` });

describe('Control iD: sincronização de usuários', () => {
  it('cria regra, vínculo ao portal e usuários; é idempotente', async () => {
    const dev = fakeDevice();
    const d = mk(dev);
    const r = await d.syncRoster('p1', [u(100001), u(100002)]);
    expect(r).toMatchObject({ ok: true, code: 'OK', created: 2, removed: 0, conflicts: [] });
    const db = dev.db();
    expect(db.access_rules).toEqual([{ id: ZELA_RULE_ID, name: 'Zela', type: 1, priority: 0 }]);
    expect(db.portal_access_rules).toEqual([{ portal_id: 1, access_rule_id: ZELA_RULE_ID }]);
    expect(db.users.map((x) => [x.id, x.registration])).toEqual([
      [100001, 'zela:100001'],
      [100002, 'zela:100002'],
    ]);
    expect(db.user_access_rules).toHaveLength(2);

    const again = await d.syncRoster('p1', [u(100001), u(100002)]);
    expect(again).toMatchObject({ ok: true, created: 0, removed: 0 });
    expect(db.access_rules).toHaveLength(1);
    expect(db.portal_access_rules).toHaveLength(1);
  });

  it('revoga quem saiu e nunca toca em usuário cadastrado à mão', async () => {
    const dev = fakeDevice({
      users: [
        { id: 7, name: 'Manual', registration: 'abc' },
        { id: 100001, name: 'Zela 100001', registration: 'zela:100001' },
        { id: 100002, name: 'Zela 100002', registration: 'zela:100002' },
      ],
      access_rules: [{ id: ZELA_RULE_ID }],
      portal_access_rules: [{ portal_id: 1, access_rule_id: ZELA_RULE_ID }],
    });
    const d = mk(dev);
    const r = await d.syncRoster('p1', [u(100002)]);
    expect(r).toMatchObject({ ok: true, created: 0, removed: 1 });
    expect(dev.db().users.map((x) => x.id)).toEqual([7, 100002]);
    // lista vazia revoga todos os do Zela e preserva o manual
    await d.syncRoster('p1', []);
    expect(dev.db().users.map((x) => x.id)).toEqual([7]);
  });

  it('revoga antes de conceder', async () => {
    const dev = fakeDevice({
      users: [{ id: 100001, name: 'x', registration: 'zela:100001' }],
      access_rules: [{ id: ZELA_RULE_ID }],
      portal_access_rules: [{ portal_id: 1, access_rule_id: ZELA_RULE_ID }],
    });
    await mk(dev).syncRoster('p1', [u(100002)]);
    const order = dev.calls
      .filter((c) => c.path === '/destroy_objects.fcgi' || c.path === '/create_objects.fcgi')
      .map((c) => c.path);
    expect(order[0]).toBe('/destroy_objects.fcgi');
  });

  it('id ocupado por usuário alheio é conflito, não é sobrescrito', async () => {
    const dev = fakeDevice({
      users: [{ id: 100001, name: 'Manual', registration: '' }],
      access_rules: [{ id: ZELA_RULE_ID }],
      portal_access_rules: [{ portal_id: 1, access_rule_id: ZELA_RULE_ID }],
    });
    const r = await mk(dev).syncRoster('p1', [u(100001), u(100002)]);
    expect(r).toMatchObject({ ok: true, created: 1, conflicts: [100001] });
    expect(dev.db().users.find((x) => x.id === 100001).name).toBe('Manual');
  });

  it('grava em lotes de 100 e usa o portal configurado', async () => {
    const dev = fakeDevice();
    const d = mk(dev, { portalId: 3 });
    const many = Array.from({ length: 250 }, (_, i) => u(100001 + i));
    const r = await d.syncRoster('p1', many);
    expect(r.created).toBe(250);
    const userWrites = dev.calls.filter(
      (c) => c.path === '/create_objects.fcgi' && c.body.object === 'users',
    );
    expect(userWrites.map((c) => c.body.values.length)).toEqual([100, 100, 50]);
    expect(dev.db().portal_access_rules[0].portal_id).toBe(3);
  });

  it('valida a entrada, o ponto e o transporte', async () => {
    const dev = fakeDevice();
    const d = mk(dev);
    expect((await d.syncRoster('nope', [])).code).toBe('UNKNOWN_POINT');
    expect((await d.syncRoster('p1', [{ deviceUserId: 0, name: 'x' }])).code).toBe(
      'INVALID_ARGUMENT',
    );
    expect((await d.syncRoster('p1', [{ deviceUserId: 5, name: '' }])).code).toBe(
      'INVALID_ARGUMENT',
    );
    expect((await d.syncRoster('p1', 'x')).code).toBe('INVALID_ARGUMENT');
    const push = mk(dev, { transport: 'push' });
    expect((await push.syncRoster('p1', [])).code).toBe('INVALID_ARGUMENT');
    expect(dev.calls).toHaveLength(0);
  });

  it('falha do terminal devolve erro sem lançar e não deixa passar como sucesso', async () => {
    const dev = fakeDevice();
    dev.failOn('/create_objects.fcgi:users');
    const r = await mk(dev).syncRoster('p1', [u(100001)]);
    expect(r.ok).toBe(false);
    const down = { fetchImpl: async () => Promise.reject(new Error('ECONNREFUSED')), calls: [] };
    const r2 = await mk(down).syncRoster('p1', [u(100001)]);
    expect(r2).toEqual({ ok: false, code: 'DEVICE_OFFLINE' });
  });

  it('nunca grava cartão, PIN nem senha', async () => {
    const dev = fakeDevice();
    await mk(dev).syncRoster('p1', [u(100001)]);
    const sent = JSON.stringify(dev.calls);
    expect(sent).not.toMatch(/"cards"|"pins"|"templates"|password|salt/);
  });
});

describe('Control iD: door.forced', () => {
  const door = (d, open) =>
    d.handleNotification(`${PREFIX}/door`, { door: { id: 1, open }, device_id: DEVICE_ID });
  const granted = (d, event = 7) =>
    d.handleNotification(`${PREFIX}/dao`, {
      device_id: DEVICE_ID,
      object_changes: [
        {
          object: 'access_logs',
          type: 'inserted',
          values: { id: 1, event, user_id: 100001, time: 1, portal_id: 1 },
        },
      ],
    });

  it('porta aberta sem autorização depois da tolerância vira door.forced', () => {
    clock = 0;
    const d = mk(fakeDevice(), { doorSensor: true });
    const ev = collect(d);
    door(d, true);
    d.tick(at(4_000));
    expect(ev.map((e) => e.type)).toEqual(['door.opened']);
    d.tick(at(5_000));
    expect(ev.map((e) => e.type)).toEqual(['door.opened', 'door.forced']);
    expect(d.getStatus('p1').door).toBe('forced');
    d.tick(at(9_000)); // não repete
    expect(ev.filter((e) => e.type === 'door.forced')).toHaveLength(1);
    door(d, false);
    expect(d.getStatus('p1').door).toBe('closed');
  });

  it('acesso concedido, botão ou web (mesmo chegando depois da porta) não é arrombamento', () => {
    for (const event of [7, 11, 12]) {
      clock = 0;
      const d = mk(fakeDevice(), { doorSensor: true });
      const ev = collect(d);
      door(d, true);
      clock = 1_000;
      granted(d, event);
      d.tick(at(9_000));
      expect(ev.some((e) => e.type === 'door.forced')).toBe(false);
    }
  });

  it('autorização recente antes da abertura também vale', () => {
    clock = 0;
    const d = mk(fakeDevice(), { doorSensor: true });
    const ev = collect(d);
    granted(d);
    clock = 2_000;
    door(d, true);
    d.tick(at(9_000));
    expect(ev.some((e) => e.type === 'door.forced')).toBe(false);
  });

  it('abertura por comando do Edge conta como autorizada', async () => {
    clock = 0;
    const dev = fakeDevice();
    const orig = dev.fetchImpl;
    dev.fetchImpl = async (url, init) =>
      new URL(url).pathname === '/execute_actions.fcgi'
        ? new Response(JSON.stringify({}))
        : orig(url, init);
    const d = mk(dev, { doorSensor: true });
    const ev = collect(d);
    expect((await d.unlock('p1')).ok).toBe(true);
    clock = 1_000;
    door(d, true);
    d.tick(at(9_000));
    expect(ev.some((e) => e.type === 'door.forced')).toBe(false);
  });

  it('autorização antiga demais não protege', () => {
    clock = 0;
    const d = mk(fakeDevice(), { doorSensor: true });
    const ev = collect(d);
    granted(d);
    clock = 60_000;
    door(d, true);
    d.tick(at(70_000));
    expect(ev.some((e) => e.type === 'door.forced')).toBe(true);
  });

  it('sem doorSensor não infere arrombamento; porta fechada antes do prazo cancela', () => {
    clock = 0;
    const off = mk(fakeDevice());
    const evOff = collect(off);
    door(off, true);
    off.tick(at(20_000));
    expect(evOff.some((e) => e.type === 'door.forced')).toBe(false);

    const on = mk(fakeDevice(), { doorSensor: true });
    const evOn = collect(on);
    door(on, true);
    door(on, false);
    on.tick(at(20_000));
    expect(evOn.some((e) => e.type === 'door.forced')).toBe(false);
  });

  it('valida doorSensor e portalId', () => {
    const base = { baseUrl: 'http://10.0.0.5', login: 'op', password: 'x', model: 'door' };
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, doorSensor: 'sim' } }, env: 'test' }),
    ).toThrow(/doorSensor/);
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, portalId: 0 } }, env: 'test' }),
    ).toThrow(/portalId/);
  });
});
