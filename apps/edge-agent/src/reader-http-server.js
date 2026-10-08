// Zela Pass (D-027): transportes HTTPS e WebSocket do leitor + entrega do próprio PWA (a página sai do Edge, então
// não há conteúdo misto e o leitor funciona com a internet fora). Tudo cai no MESMO `service.handle`.
//  - POST /reader/v1/message   -> 1 envelope JSON, 1 resposta JSON
//  - GET  /reader/v1/ws (upgrade) -> envelopes JSON em mensagens de texto, uma resposta por mensagem (em ordem)
//  - GET  /*                    -> arquivos estáticos do PWA (se `webDir`), com cabeçalhos de segurança
// A autenticação é a assinatura de cada envelope (reader-service.js): origem/cookie não valem nada aqui.
// Sem TLS só em loopback/desenvolvimento (config.js recusa em produção): a senha digitada trafega no corpo.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';

const MAX_BYTES = 8 * 1024;
const MAX_WS_CLIENTS = 200;
const PING_MS = 30_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

export const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; " +
    "worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

/**
 * @param {{
 *   service: { handle: (raw: unknown, ctx?: { source?: string }) => Promise<{ status: number, body: object }> },
 *   bind: string, port: number,
 *   tls?: { cert: string | Buffer, key: string | Buffer } | null,
 *   webDir?: string | null,
 *   maxBytes?: number,
 *   onError?: (e: unknown) => void,
 * }} cfg
 */
export function createReaderHttpServer({
  service,
  bind,
  port,
  tls = null,
  webDir = null,
  maxBytes = MAX_BYTES,
  onError = () => {},
}) {
  const root = webDir ? resolve(webDir) : null;

  const send = (res, status, body, headers = {}) => {
    if (res.writableEnded) return;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    });
    res.end(text);
  };

  async function serveStatic(req, res) {
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, {});
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return send(res, 400, {});
    }
    if (rel.includes('\0')) return send(res, 400, {});
    let file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return send(res, 404, {});
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    // Rota do app (sem extensão) cai no index.html; arquivo com extensão que não existe é 404 de verdade.
    if (!info?.isFile()) {
      if (extname(rel)) return send(res, 404, {});
      file = join(root, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) return send(res, 404, {});
    }
    const data = await readFile(file);
    const hashed = file.startsWith(join(root, 'assets') + sep);
    // Modelos do facial (dezenas de MB, nome fixo): cache de 1 dia; o service worker guarda para uso sem rede.
    const heavy =
      file.startsWith(join(root, 'models') + sep) || file.startsWith(join(root, 'ort') + sep);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed
        ? 'public, max-age=31536000, immutable'
        : heavy
          ? 'public, max-age=86400'
          : 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  function readBody(req, res, cb) {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) return send(res, 413, { ok: false, code: 'TOO_LARGE' });
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        over = true;
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', () => {});
    req.on('close', () => {
      if (over) send(res, 413, { ok: false, code: 'TOO_LARGE' });
    });
    req.on('end', () => {
      if (over) return;
      let json;
      try {
        json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { ok: false, code: 'MALFORMED' });
      }
      cb(json);
    });
  }

  const handler = (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/reader/v1/message') {
      if (req.method !== 'POST') return send(res, 405, {}, { allow: 'POST' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? ''))
        return send(res, 415, { ok: false, code: 'MALFORMED' });
      return readBody(req, res, (json) => {
        service
          .handle(json, { source: req.socket.remoteAddress })
          .then((r) => send(res, r.status, r.body))
          .catch((e) => {
            onError(e);
            send(res, 500, { ok: false, code: 'INTERNAL' });
          });
      });
    }
    serveStatic(req, res).catch((e) => {
      onError(e);
      send(res, 500, {});
    });
  };

  const server = tls
    ? createHttpsServer({ cert: tls.cert, key: tls.key }, handler)
    : createHttpServer(handler);
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  // ---- WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxBytes });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/reader/v1/ws' || wss.clients.size >= MAX_WS_CLIENTS) {
      socket.write(
        `HTTP/1.1 ${path === '/reader/v1/ws' ? '503' : '404'} X\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const source = req.socket.remoteAddress;
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    // respostas na mesma ordem das mensagens (o leitor casa pedido e resposta pela fila)
    let chain = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text only');
      let json;
      try {
        json = JSON.parse(data.toString('utf8'));
      } catch {
        return ws.send(JSON.stringify({ ok: false, code: 'MALFORMED' }));
      }
      chain = chain
        .then(() => service.handle(json, { source }))
        .then((r) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ status: r.status, ...r.body }));
        })
        .catch((e) => {
          onError(e);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ok: false, code: 'INTERNAL' }));
        });
    });
    ws.on('error', () => {});
    const timer = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    timer.unref();
    ws.on('close', () => clearInterval(timer));
  });

  return {
    server,
    listen: () =>
      new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, bind, () => {
          server.off('error', fail);
          ok(server.address());
        });
      }),
    close: () =>
      new Promise((ok) => {
        for (const c of wss.clients) c.terminate();
        server.close(() => ok());
        server.closeAllConnections?.();
      }),
  };
}
