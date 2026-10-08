import { describe, expect, it } from 'vitest';
import { createControlIdDriver } from './index.js';

const T0 = new Date('2026-10-08T10:00:00Z');
const PREFIX = '/api/notifications/s3cr3tpath';

/** Terminal simulado: guarda as chamadas e responde conforme o roteiro. NÃO é um equipamento real. */
function fakeDevice({
  interlock = false,
  expireSessionOnce = false,
  down = false,
  hang = false,
} = {}) {
  const calls = [];
  let sessions = 0;
  let expire = expireSessionOnce;
  const fetchImpl = async (url, init) => {
    if (hang)
      return new Promise((_, rej) =>
        init.signal.addEventListener('abort', () =>
          rej(Object.assign(new Error('x'), { name: 'AbortError' })),
        ),
      );
    if (down) throw new Error('ECONNREFUSED');
    const u = new URL(url);
    const body = JSON.parse(init.body);
    calls.push({ path: u.pathname, session: u.searchParams.get('session'), body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname === '/login.fcgi') {
      if (body.password !== 'segredo') return json({ error: 'bad' }, 401);
      return json({ session: `sess${++sessions}` });
    }
    if (expire && u.searchParams.get('session') === 'sess1') {
      expire = false;
      return json({}, 401);
    }
    if (u.pathname === '/execute_actions.fcgi')
      return interlock ? json({ actions: [{ action: 'sec_box', status: 'denied' }] }) : json({});
    if (u.pathname === '/set_configuration.fcgi') return json(body);
    if (u.pathname === '/doors_state.fcgi') return json({ doors: [{ id: 1, open: true }] });
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

const mk = (dev, point = {}, extra = {}) =>
  createControlIdDriver({
    points: {
      p1: {
        baseUrl: 'http://192.168.0.129',
        login: 'op',
        password: 'segredo',
        model: 'door',
        deviceId: 478435,
        ...point,
      },
    },
    fetchImpl: dev.fetchImpl,
    env: 'test',
    now: () => T0,
    monitorPathPrefix: PREFIX,
    timeoutMs: 20,
    ...extra,
  });

describe('Control iD: configuração', () => {
  it('valida os pontos e recusa admin/admin em produção', () => {
    const base = { baseUrl: 'http://10.0.0.5', login: 'op', password: 'x', model: 'door' };
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, baseUrl: 'ftp://x' } }, env: 'test' }),
    ).toThrow(/http/);
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, model: 'xyz' } }, env: 'test' }),
    ).toThrow(/model/);
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, model: 'sec_box' } }, env: 'test' }),
    ).toThrow(/secBoxId/);
    expect(() =>
      createControlIdDriver({ points: { a: { ...base, password: '' } }, env: 'test' }),
    ).toThrow(/senha/);
    expect(() =>
      createControlIdDriver({
        points: { a: { ...base, login: 'admin', password: 'admin' } },
        env: 'production',
      }),
    ).toThrow(/fábrica/);
    expect(() =>
      createControlIdDriver({
        points: { a: { ...base, login: 'admin', password: 'admin' } },
        env: 'test',
      }),
    ).not.toThrow();
  });
});

describe('Control iD: unlock', () => {
  it('faz login uma vez, reutiliza a sessão e abre com a ação do modelo', async () => {
    const dev = fakeDevice();
    const d = mk(dev, { doorNumber: 2 });
    expect(await d.unlock('p1', { durationMs: 3000 })).toEqual({ ok: true, code: 'OK' });
    expect(await d.unlock('p1')).toEqual({ ok: true, code: 'OK' });
    const logins = dev.calls.filter((c) => c.path === '/login.fcgi');
    expect(logins).toHaveLength(1);
    expect(logins[0].body).toEqual({ login: 'op', password: 'segredo' });
    const acts = dev.calls.filter((c) => c.path === '/execute_actions.fcgi');
    expect(acts[0].session).toBe('sess1');
    expect(acts[0].body).toEqual({ actions: [{ action: 'door', parameters: 'door=2' }] });
    expect(d.getStatus('p1').locked).toBe(false);
  });

  it('usa sec_box e catra com os parâmetros oficiais', async () => {
    const dev = fakeDevice();
    const sb = mk(dev, { model: 'sec_box', secBoxId: '65793', reason: 3 });
    await sb.unlock('p1');
    const ct = mk(dev, { model: 'catra', allow: 'clockwise' });
    await ct.unlock('p1');
    const acts = dev.calls
      .filter((c) => c.path === '/execute_actions.fcgi')
      .map((c) => c.body.actions[0]);
    expect(acts).toEqual([
      { action: 'sec_box', parameters: 'id=65793, reason=3' },
      { action: 'catra', parameters: 'allow=clockwise' },
    ]);
  });

  it('religa o estado local depois da duração', async () => {
    const d = mk(fakeDevice());
    await d.unlock('p1', { durationMs: 3000 });
    d.tick(new Date(T0.getTime() + 2999));
    expect(d.getStatus('p1').locked).toBe(false);
    d.tick(new Date(T0.getTime() + 3000));
    expect(d.getStatus('p1').locked).toBe(true);
  });

  it('valida ponto e duração sem chamar o terminal', async () => {
    const dev = fakeDevice();
    const d = mk(dev);
    expect((await d.unlock('x')).code).toBe('UNKNOWN_POINT');
    for (const ms of [0, -1, 1.5, 60_001, NaN])
      expect((await d.unlock('p1', { durationMs: ms })).code).toBe('INVALID_ARGUMENT');
    expect(dev.calls).toHaveLength(0);
  });

  it('refaz o login quando a sessão expira (401)', async () => {
    const dev = fakeDevice({ expireSessionOnce: true });
    const d = mk(dev);
    expect(await d.unlock('p1')).toEqual({ ok: true, code: 'OK' });
    expect(dev.calls.filter((c) => c.path === '/login.fcgi')).toHaveLength(2);
  });

  it('interlock negado vira INTERLOCK_DENIED e não destrava', async () => {
    const d = mk(fakeDevice({ interlock: true }), { model: 'sec_box', secBoxId: '1' });
    expect(await d.unlock('p1')).toEqual({ ok: false, code: 'INTERLOCK_DENIED' });
    expect(d.getStatus('p1').locked).toBe(true);
  });

  it('senha recusada falha o comando sem marcar offline; rede caída marca offline', async () => {
    const bad = mk(fakeDevice(), { password: 'errada' });
    const ev = [];
    bad.onEvent((e) => ev.push(e.type));
    expect((await bad.unlock('p1')).ok).toBe(false);
    expect(bad.getStatus('p1').online).toBe(true);
    const down = mk(fakeDevice({ down: true }));
    down.onEvent((e) => ev.push(e.type));
    expect(await down.unlock('p1')).toEqual({ ok: false, code: 'DEVICE_OFFLINE' });
    expect(down.getStatus('p1').online).toBe(false);
    expect(ev).toEqual(['device.offline']);
    expect((await down.lock('p1')).code).toBe('DEVICE_OFFLINE');
  });

  it('estouro de tempo devolve TIMEOUT', async () => {
    const d = mk(fakeDevice({ hang: true }));
    expect((await d.unlock('p1')).code).toBe('TIMEOUT');
    expect(d.getStatus('p1').online).toBe(false);
  });

  it('lock reafirma o estado travado', async () => {
    const d = mk(fakeDevice());
    await d.unlock('p1');
    expect(await d.lock('p1')).toEqual({ ok: true, code: 'OK' });
    expect(d.getStatus('p1').locked).toBe(true);
  });
});

describe('Control iD: configuração do terminal', () => {
  it('setRelayTimeout e configureMonitor enviam set_configuration', async () => {
    const dev = fakeDevice();
    const d = mk(dev, { doorNumber: 1 });
    expect(await d.setRelayTimeout('p1', 3000)).toEqual({ ok: true, code: 'OK' });
    expect(await d.configureMonitor('p1', { hostname: '192.168.0.20', port: 8000 })).toEqual({
      ok: true,
      code: 'OK',
    });
    const cfg = dev.calls.filter((c) => c.path === '/set_configuration.fcgi').map((c) => c.body);
    expect(cfg[0]).toEqual({ general: { relay1_timeout: '3000' } });
    expect(cfg[1].monitor).toMatchObject({
      hostname: '192.168.0.20',
      port: '8000',
      path: 'api/notifications/s3cr3tpath',
    });
    expect((await d.setRelayTimeout('p1', 0)).code).toBe('INVALID_ARGUMENT');
    expect((await d.configureMonitor('p1', { hostname: 'h', port: 70000 })).code).toBe(
      'INVALID_ARGUMENT',
    );
  });

  it('refreshStatus lê o estado da porta', async () => {
    const d = mk(fakeDevice());
    expect((await d.refreshStatus('p1')).door).toBe('open');
  });
});

describe('Control iD: Monitor', () => {
  const collect = (d) => {
    const ev = [];
    d.onEvent((e) => ev.push(e));
    return ev;
  };
  const log = (event, extra = {}) => ({
    object_changes: [
      {
        object: 'access_logs',
        type: 'inserted',
        values: {
          id: '519',
          time: '1532977090',
          event: String(event),
          portal_id: '1',
          user_id: '42',
          card_value: '528281023086',
          ...extra,
        },
      },
    ],
    device_id: 478435,
  });

  it('rejeita caminho sem o segredo, corpo inválido e dispositivo desconhecido', () => {
    const d = mk(fakeDevice());
    const ev = collect(d);
    expect(d.handleNotification('/api/notifications/dao', log(7)).code).toBe('FORBIDDEN');
    expect(d.handleNotification('/dao', log(7)).code).toBe('FORBIDDEN');
    expect(d.handleNotification(`${PREFIX}/dao`, null).code).toBe('MALFORMED');
    expect(d.handleNotification(`${PREFIX}/dao`, { ...log(7), device_id: 999 }).code).toBe(
      'UNKNOWN_DEVICE',
    );
    expect(ev).toEqual([]);
  });

  it('access_logs: 7 concede, 6/3/5 negam, o resto não decide; nunca vaza cartão', () => {
    const d = mk(fakeDevice());
    const ev = collect(d);
    for (const code of [7, 6, 3, 5, 4, 8, 11, 12, 13])
      d.handleNotification(`${PREFIX}/dao`, log(code));
    expect(ev.map((e) => e.type)).toEqual([
      'access.granted',
      'access.denied',
      'access.denied',
      'access.denied',
    ]);
    expect(ev[0].data).toMatchObject({
      controlIdEvent: 7,
      portalId: 1,
      deviceUserId: 42,
      deviceLogId: '519',
    });
    expect(JSON.stringify(ev)).not.toContain('528281023086');
    expect(ev[0].at).toBe(T0.toISOString());
  });

  it('ignora cartões, gabaritos e atualizações; limita o lote', () => {
    const d = mk(fakeDevice());
    const ev = collect(d);
    d.handleNotification(`${PREFIX}/dao`, {
      device_id: 478435,
      object_changes: [
        { object: 'templates', type: 'inserted', values: { template: 'BASE64' } },
        { object: 'cards', type: 'inserted', values: { value: '1' } },
        { object: 'access_logs', type: 'updated', values: { event: '7' } },
      ],
    });
    expect(ev).toEqual([]);
    const many = {
      device_id: 478435,
      object_changes: Array.from({ length: 1500 }, () => log(7).object_changes[0]),
    };
    d.handleNotification(`${PREFIX}/dao`, many);
    expect(ev).toHaveLength(1000);
  });

  it('porta: abre, fecha e sinaliza porta mantida aberta; relé aberto não vira arrombamento', () => {
    const d = mk(fakeDevice(), {}, { holdOpenMs: 10_000 });
    const ev = collect(d);
    d.handleNotification(`${PREFIX}/door`, { door: { id: 1, open: true }, device_id: 478435 });
    expect(d.getStatus('p1').door).toBe('open');
    d.tick(new Date(T0.getTime() + 10_000));
    expect(d.getStatus('p1').door).toBe('held_open');
    d.handleNotification(`${PREFIX}/door`, { door: { id: 1, open: false }, device_id: 478435 });
    expect(ev.map((e) => e.type)).toEqual(['door.opened', 'door.held_open', 'door.closed']);
    expect(
      d.handleNotification(`${PREFIX}/door`, { door: { id: 1 }, device_id: 478435 }).code,
    ).toBe('MALFORMED');
  });

  it('secbox associa pelo id da caixa e heartbeat/vivo alimenta online/offline', () => {
    const d = mk(
      fakeDevice(),
      { model: 'sec_box', secBoxId: '122641794705028910' },
      { aliveIntervalMs: 1000 },
    );
    const ev = collect(d);
    expect(
      d.handleNotification(`${PREFIX}/secbox`, { secbox: { id: '999', open: true } }).code,
    ).toBe('UNKNOWN_DEVICE');
    expect(
      d.handleNotification(`${PREFIX}/secbox`, { secbox: { id: '122641794705028910', open: true } })
        .ok,
    ).toBe(true);
    d.handleNotification(`${PREFIX}/device_is_alive`, {
      access_logs: 0,
      device_id: 478435,
      time: 1,
    });
    d.tick(new Date(T0.getTime() + 3001));
    expect(d.getStatus('p1').online).toBe(false);
    d.handleNotification(`${PREFIX}/device_is_alive`, { device_id: 478435 });
    expect(ev.map((e) => e.type)).toEqual([
      'door.opened',
      'heartbeat',
      'device.offline',
      'device.online',
      'heartbeat',
    ]);
  });
});

describe('Control iD: modo Push', () => {
  const FROM = '192.168.0.129';
  const mkPush = (extra = {}, cfg = {}) =>
    mk(fakeDevice(), { transport: 'push', ...cfg }, { pushWaitMs: 500, ...extra });
  const poll = (d, uuid = 'uuid-0001-aaaa', remoteAddress = FROM, deviceId = 478435) =>
    d.handlePush({
      method: 'GET',
      path: '/push',
      query: { deviceId: String(deviceId), uuid },
      remoteAddress,
    });
  const result = (d, body, uuid = 'uuid-0001-aaaa', remoteAddress = FROM) =>
    d.handlePush({
      method: 'POST',
      path: '/result',
      query: { deviceId: '478435', uuid },
      body,
      remoteAddress,
    });

  it('exige deviceId e configura o push_server', async () => {
    expect(() =>
      createControlIdDriver({
        points: {
          a: {
            baseUrl: 'http://10.0.0.5',
            login: 'o',
            password: 'x',
            model: 'door',
            transport: 'push',
          },
        },
        env: 'test',
      }),
    ).toThrow(/deviceId/);
    const dev = fakeDevice();
    const d = mk(dev);
    expect(await d.configurePush('p1', { hostname: '192.168.0.20', port: 8080 })).toEqual({
      ok: true,
      code: 'OK',
    });
    const cfg = dev.calls.find((c) => c.path === '/set_configuration.fcgi').body;
    expect(cfg.push_server).toEqual({
      push_request_timeout: '4000',
      push_request_period: '5',
      push_remote_address: 'http://192.168.0.20:8080',
    });
  });

  it('abre pela fila: o terminal busca o comando, executa e devolve o resultado', async () => {
    const d = mkPush();
    const pending = d.unlock('p1', { durationMs: 3000 });
    expect(poll(d, 'uuid-vazio', FROM, 478435).json).toBeDefined();
    expect(poll(d, 'uuid-vazio').json).toBeUndefined(); // entregue uma vez só
    expect(result(d, { endpoint: 'execute_actions', response: '{}' }, 'uuid-vazio')).toMatchObject({
      status: 200,
    });
    expect(await pending).toEqual({ ok: true, code: 'OK' });
    expect(d.getStatus('p1').locked).toBe(false);
  });

  it('entrega o comando no formato do exemplo oficial', async () => {
    const d = mkPush({}, { doorNumber: 2 });
    const pending = d.unlock('p1');
    expect(poll(d, 'uuid-0001-aaaa').json).toEqual({
      verb: 'POST',
      endpoint: 'execute_actions',
      body: { actions: [{ action: 'door', parameters: 'door=2' }] },
      contentType: 'application/json',
    });
    result(d, { endpoint: 'execute_actions', response: '{}' });
    await pending;
  });

  it('rejeita IP de origem, deviceId, uuid e endpoint que não batem', async () => {
    const d = mkPush();
    const pending = d.unlock('p1');
    expect(poll(d, 'uuid-0001-aaaa', '10.9.9.9').status).toBe(404);
    expect(poll(d, 'uuid-0001-aaaa', FROM, 999).status).toBe(404);
    expect(poll(d, 'x').status).toBe(400);
    poll(d);
    expect(result(d, { endpoint: 'execute_actions' }, 'outro-uuid-9999').status).toBe(404);
    expect(result(d, { endpoint: 'set_configuration' }).status).toBe(404);
    expect(result(d, { endpoint: 'execute_actions' }, 'uuid-0001-aaaa', '10.9.9.9').status).toBe(
      404,
    );
    expect(result(d, { endpoint: 'execute_actions', response: '{}' }).status).toBe(200);
    expect((await pending).ok).toBe(true);
  });

  it('erro do terminal, interlock negado, timeout e comando em aberto', async () => {
    const d = mkPush();
    let pending = d.unlock('p1');
    expect((await d.unlock('p1')).code).toBe('TIMEOUT'); // já há um comando em aberto
    poll(d);
    result(d, { endpoint: 'execute_actions', error: 'falhou' });
    expect(await pending).toEqual({ ok: false, code: 'DEVICE_OFFLINE' });
    pending = d.unlock('p1');
    poll(d, 'uuid-0002-bbbb');
    result(
      d,
      { endpoint: 'execute_actions', response: '{"actions":[{"status":"denied"}]}' },
      'uuid-0002-bbbb',
    );
    expect(await pending).toEqual({ ok: false, code: 'INTERLOCK_DENIED' });
    expect(d.getStatus('p1').locked).toBe(true);
    const slow = mkPush({ pushWaitMs: 20 });
    expect(await slow.unlock('p1')).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(slow.getStatus('p1').online).toBe(false);
    expect(
      slow.handlePush({
        method: 'GET',
        path: '/push',
        query: { deviceId: '478435', uuid: 'uuid-0003-cccc' },
        remoteAddress: FROM,
      }).json,
    ).toBeUndefined();
  });

  it('ponto direto não aceita Push', () => {
    const d = mk(fakeDevice());
    expect(poll(d).status).toBe(404);
  });
});
