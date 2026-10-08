// Os 3 transportes (HTTPS, WebSocket, TCP/IP) levam o MESMO protocolo ao MESMO serviço. Servidores reais em loopback.
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReaderHttpServer } from './reader-http-server.js';
import { createReaderService } from './reader-service.js';
import { createReaderTcpServer } from './reader-tcp-server.js';
import { createTestReader } from './reader-test-client.js';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';
import { ANA_TOKEN, ENROLL_CODE, IDS, MONDAY_10H, makeSnapshot } from './fixtures.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
let store;
let http;
let tcp;
let base;
let tcpPort;
let webDir;
const now = MONDAY_10H;

const meta = (over = {}) => ({
  id: IDS.reader,
  accessPointId: IDS.registerPoint,
  status: 'pending',
  enrollmentTokenHash: sha256(ENROLL_CODE),
  enrollmentExpiresAt: '2026-10-06T14:00:00Z',
  ...over,
});

beforeEach(async () => {
  store = openStore();
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', now.toISOString());
  applySnapshot(store, { hash: 'h1', snapshot: makeSnapshot({ readers: [meta()] }) }, now);
  const service = createReaderService({ store, clock: () => now, isOffline: () => false });
  webDir = mkdtempSync(join(tmpdir(), 'zela-pass-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Zela Pass</title>');
  writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(tmpdir(), 'zela-pass-segredo.txt'), 'segredo');
  http = createReaderHttpServer({ service, bind: '127.0.0.1', port: 0, webDir });
  tcp = createReaderTcpServer({ service, bind: '127.0.0.1', port: 0, idleMs: 2_000 });
  base = `http://127.0.0.1:${(await http.listen()).port}`;
  tcpPort = (await tcp.listen()).port;
});

afterEach(async () => {
  await http.close();
  await tcp.close();
});

const post = (body, headers = {}) =>
  fetch(`${base}/reader/v1/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const newReader = () => createTestReader({ nowMs: () => now.getTime() });

describe('HTTPS (POST)', () => {
  it('ativa, consulta status e registra', async () => {
    const t = newReader();
    const e = await (await post(t.enroll(ENROLL_CODE))).json();
    expect(e.ok).toBe(true);
    t.state.readerId = e.readerId;
    expect((await (await post(t.status())).json()).mode).toBe('register_only');
    // marcar o ponto como ativo no snapshot: leitor continua listado
    applySnapshot(
      store,
      {
        hash: 'h2',
        snapshot: makeSnapshot({
          readers: [meta({ status: 'active', enrollmentTokenHash: null })],
        }),
      },
      now,
    );
    const r = await post(t.attempt({ method: 'qr', value: ANA_TOKEN }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ outcome: 'REGISTERED', label: 'Registrado' });
  });

  it('status HTTP acompanha o serviço (401 sem assinatura válida) e o cabeçalho é seguro', async () => {
    const t = newReader();
    t.state.readerId = IDS.reader;
    const r = await post(t.status());
    expect(r.status).toBe(401);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('recusa método, tipo de conteúdo, JSON inválido e corpo grande', async () => {
    expect((await fetch(`${base}/reader/v1/message`)).status).toBe(405);
    expect((await post('{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('{nao-json')).status).toBe(400);
    const big = await post(JSON.stringify({ x: 'a'.repeat(20_000) }));
    expect(big.status).toBe(413);
  });
});

describe('WebSocket', () => {
  const open = () =>
    new Promise((ok, fail) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/reader/v1/ws`);
      const inbox = [];
      const waiters = [];
      ws.onmessage = (m) => {
        const j = JSON.parse(m.data);
        const w = waiters.shift();
        if (w) w(j);
        else inbox.push(j);
      };
      ws.onopen = () =>
        ok({
          ws,
          next: () =>
            inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r)),
        });
      ws.onerror = () => fail(new Error('ws'));
    });

  it('mesmo protocolo, respostas em ordem na mesma conexão', async () => {
    const { ws, next } = await open();
    const t = newReader();
    ws.send(JSON.stringify(t.enroll(ENROLL_CODE)));
    const e = await next();
    expect(e).toMatchObject({ status: 200, ok: true, readerId: IDS.reader });
    t.state.readerId = e.readerId;
    ws.send(JSON.stringify(t.status()));
    ws.send(JSON.stringify(t.status()));
    expect((await next()).ok).toBe(true);
    expect((await next()).ok).toBe(true);
    ws.close();
  });

  it('mensagem que não é JSON recebe MALFORMED sem derrubar o servidor', async () => {
    const { ws, next } = await open();
    ws.send('isto não é json');
    expect(await next()).toMatchObject({ ok: false, code: 'MALFORMED' });
    ws.close();
  });

  it('caminho de upgrade desconhecido é recusado', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/outro`);
    await new Promise((r) => {
      ws.onerror = r;
      ws.onclose = r;
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

describe('TCP/IP (NDJSON)', () => {
  const open = () =>
    new Promise((ok, fail) => {
      const sock = createConnection({ host: '127.0.0.1', port: tcpPort }, () => {
        let buf = '';
        const inbox = [];
        const waiters = [];
        sock.on('data', (d) => {
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const j = JSON.parse(buf.slice(0, i));
            buf = buf.slice(i + 1);
            const w = waiters.shift();
            if (w) w(j);
            else inbox.push(j);
          }
        });
        ok({
          sock,
          send: (o) => sock.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`),
          next: () =>
            inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r)),
        });
      });
      sock.on('error', fail);
    });

  it('ativa e consulta status pelo mesmo protocolo', async () => {
    const { sock, send, next } = await open();
    const t = newReader();
    send(t.enroll(ENROLL_CODE));
    const e = await next();
    expect(e).toMatchObject({ status: 200, ok: true, readerId: IDS.reader });
    t.state.readerId = e.readerId;
    send(t.status());
    expect(await next()).toMatchObject({ ok: true, mode: 'register_only' });
    sock.destroy();
  });

  it('linha inválida: MALFORMED e a conexão é encerrada', async () => {
    const { sock, send, next } = await open();
    send('{quebrado');
    expect(await next()).toMatchObject({ ok: false, code: 'MALFORMED' });
    await new Promise((r) => sock.on('close', r));
  });

  it('mensagens em uma só escrita são respondidas em ordem', async () => {
    const { sock, next } = await open();
    const t = newReader();
    const first = t.enroll(ENROLL_CODE);
    sock.write(`${JSON.stringify(first)}\n`);
    const e = await next();
    t.state.readerId = e.readerId;
    sock.write(`${JSON.stringify(t.status())}\n${JSON.stringify(t.status())}\n`);
    expect((await next()).ok).toBe(true);
    expect((await next()).ok).toBe(true);
    sock.destroy();
  });

  it('linha gigante derruba a conexão', async () => {
    const { sock, send, next } = await open();
    send('x'.repeat(20_000));
    expect(await next()).toMatchObject({ ok: false, code: 'TOO_LARGE' });
    await new Promise((r) => sock.on('close', r));
  });
});

describe('entrega do PWA', () => {
  it('serve index e assets com cabeçalhos de segurança; rota do app cai no index', async () => {
    const idx = await fetch(`${base}/`);
    expect(idx.status).toBe(200);
    expect(idx.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(idx.headers.get('cache-control')).toBe('no-cache');
    expect(await idx.text()).toContain('Zela Pass');
    const spa = await fetch(`${base}/configuracoes`);
    expect(await spa.text()).toContain('Zela Pass');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
  });

  it('não sai da pasta (path traversal) e arquivo inexistente é 404', async () => {
    for (const p of [
      '/../zela-pass-segredo.txt',
      '/%2e%2e/zela-pass-segredo.txt',
      '/..%2f..%2fwindows/win.ini',
      '/assets/nao-existe.js',
    ])
      expect((await fetch(`${base}${p}`)).status).toBeGreaterThanOrEqual(400);
    const raw = await new Promise((ok) => {
      const s = createConnection({ host: '127.0.0.1', port: Number(new URL(base).port) }, () =>
        s.write('GET /../zela-pass-segredo.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'),
      );
      let out = '';
      s.on('data', (d) => (out += d));
      s.on('close', () => ok(out));
    });
    expect(raw).not.toContain('segredo\n');
    expect(raw.endsWith('segredo')).toBe(false);
  });
});
