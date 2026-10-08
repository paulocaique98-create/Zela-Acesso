import { afterEach, describe, expect, it } from 'vitest';
import { createControlIdDriver } from '@zela/device-drivers';
import { createMonitorServer, parseJsonKeepBigInts } from './monitor-server.js';

const PREFIX = '/api/notifications/segredo-aleatorio-de-teste-0123456789';
let srv;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

async function start(extra = {}) {
  const driver = createControlIdDriver({
    points: {
      p1: {
        baseUrl: 'http://127.0.0.1:1',
        login: 'op',
        password: 'x',
        model: 'sec_box',
        secBoxId: '122641794705028911',
        deviceId: '6613047045004349',
      },
    },
    env: 'test',
    monitorPathPrefix: PREFIX,
  });
  const events = [];
  driver.onEvent((e) => events.push(e));
  srv = createMonitorServer({ driver, bind: '127.0.0.1', port: 0, ...extra });
  const { port } = await srv.listen();
  const post = (path, body, init = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });
  return { driver, events, port, post };
}

describe('parseJsonKeepBigInts', () => {
  it('preserva ids de 64 bits e não mexe em números pequenos', () => {
    const o = parseJsonKeepBigInts(
      '{"device_id": 6613047045004349, "time": 1739376235, "l":[122641794705028911]}',
    );
    expect(o.device_id).toBe('6613047045004349');
    expect(o.time).toBe(1739376235);
    expect(o.l[0]).toBe('122641794705028911');
  });
});

describe('monitor-server', () => {
  it('entrega a notificação ao driver e responde 200', async () => {
    const { post, events } = await start();
    const r = await post(
      `${PREFIX}/device_is_alive`,
      '{"access_logs":0,"device_id":6613047045004349,"time":1739376235}',
    );
    expect(r.status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(['heartbeat']);
    const s = await post(`${PREFIX}/secbox`, '{"secbox":{"id":122641794705028911,"open":true}}');
    expect(s.status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(['heartbeat', 'door.opened']);
  });

  it('caminho sem segredo e dispositivo desconhecido respondem 404 igual', async () => {
    const { post, events } = await start();
    expect((await post('/api/notifications/dao', {})).status).toBe(404);
    expect((await post(`${PREFIX}/dao`, { device_id: 1, object_changes: [] })).status).toBe(404);
    expect(events).toEqual([]);
  });

  it('recusa método, JSON inválido e corpo grande', async () => {
    const { post, port } = await start({ maxBytes: 100 });
    expect((await fetch(`http://127.0.0.1:${port}${PREFIX}/dao`)).status).toBe(405);
    expect((await post(`${PREFIX}/dao`, '{nao json')).status).toBe(400);
    expect((await post(`${PREFIX}/dao`, 'x'.repeat(500))).status).toBe(413);
  });

  it('erro interno do driver vira 500 sem vazar detalhe', async () => {
    const errs = [];
    const bad = {
      handleNotification: () => {
        throw new Error('segredo-interno');
      },
    };
    srv = createMonitorServer({
      driver: bad,
      bind: '127.0.0.1',
      port: 0,
      onError: (e) => errs.push(e),
    });
    const { port } = await srv.listen();
    const r = await fetch(`http://127.0.0.1:${port}/x`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('{}');
    expect(errs).toHaveLength(1);
  });
});

describe('monitor-server: modo Push', () => {
  it('serve /push e /result só ao IP do ponto e ao deviceId conhecido', async () => {
    const driver = createControlIdDriver({
      points: {
        p1: {
          baseUrl: 'http://127.0.0.1:1',
          login: 'op',
          password: 'x',
          model: 'door',
          deviceId: 478435,
          transport: 'push',
        },
        p2: {
          baseUrl: 'http://10.9.9.9',
          login: 'op',
          password: 'x',
          model: 'door',
          deviceId: 777,
          transport: 'push',
        },
      },
      env: 'test',
      pushWaitMs: 2000,
    });
    srv = createMonitorServer({ driver, bind: '127.0.0.1', port: 0 });
    const { port } = await srv.listen();
    const base = `http://127.0.0.1:${port}`;
    const pending = driver.unlock('p1');
    expect((await fetch(`${base}/push?deviceId=777&uuid=uuid-aaaa-0001`)).status).toBe(404); // IP não é o do ponto
    expect((await fetch(`${base}/push?deviceId=1&uuid=uuid-aaaa-0001`)).status).toBe(404);
    const g = await fetch(`${base}/push?deviceId=478435&uuid=uuid-aaaa-0001`);
    expect(g.status).toBe(200);
    expect((await g.json()).endpoint).toBe('execute_actions');
    expect(await (await fetch(`${base}/push?deviceId=478435&uuid=uuid-aaaa-0001`)).text()).toBe('');
    const r = await fetch(`${base}/result?deviceId=478435&uuid=uuid-aaaa-0001`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'execute_actions', response: '{}' }),
    });
    expect(r.status).toBe(200);
    expect(await pending).toEqual({ ok: true, code: 'OK' });
    expect((await fetch(`${base}/push`, { method: 'POST' })).status).toBe(405);
  });
});
