// Receptor HTTP da Control iD: notificações do Monitor (o terminal chama o Edge) e, opcionalmente, o modo Push.
// O terminal não assina as notificações: no Monitor a autenticação é o segredo no caminho (conferido pelo driver) + rede
// local; no Push os caminhos são fixos (/push, /result) e o driver confere IP de origem, deviceId e uuid.
// Escuta só no endereço configurado, aceita só JSON pequeno e não devolve detalhes a quem erra o caminho.

import { createServer } from 'node:http';

const MAX_BYTES = 256 * 1024;

/** Ids de 64 bits perdem precisão no JSON.parse: números com 16+ dígitos viram string antes de parsear. */
export function parseJsonKeepBigInts(text) {
  return JSON.parse(text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
}

const STATUS = { OK: 200, IGNORED: 200, MALFORMED: 400 };

/**
 * @param {{ driver: { handleNotification: (path: string, body: unknown) => { ok: boolean, code: string },
 *     handlePush?: (req: any) => { status: number, json?: unknown } },
 *   bind: string, port: number, maxBytes?: number, onError?: (e: unknown) => void }} cfg
 */
export function createMonitorServer({
  driver,
  bind,
  port,
  maxBytes = MAX_BYTES,
  onError = () => {},
}) {
  const server = createServer((req, res) => {
    const send = (status, text = '{}') => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(text);
    };
    const guarded = (fn) => {
      try {
        fn();
      } catch (e) {
        onError(e);
        send(500);
      }
    };

    /** Lê o corpo (limitado) e chama `cb(json)`; `skipBody` para GET. */
    const readJson = (skipBody, cb) => {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > maxBytes) return send(413);
      if (skipBody) return guarded(() => cb(null));
      const chunks = [];
      let size = 0;
      let tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          tooBig = true;
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('error', () => {});
      req.on('close', () => {
        if (tooBig) send(413);
      });
      req.on('end', () => {
        let body;
        try {
          body = parseJsonKeepBigInts(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400);
        }
        guarded(() => cb(body));
      });
    };

    const url = new URL(req.url ?? '/', 'http://x');
    const isPush = url.pathname === '/push' || url.pathname === '/result';
    if (isPush && typeof driver.handlePush === 'function') {
      const need = url.pathname === '/push' ? 'GET' : 'POST';
      if (req.method !== need) return send(405);
      return readJson(need === 'GET', (body) => {
        const r = driver.handlePush({
          method: req.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body,
          remoteAddress: req.socket.remoteAddress,
        });
        send(r.status, r.json === undefined ? '' : JSON.stringify(r.json));
      });
    }

    if (req.method !== 'POST') return send(405);
    readJson(false, (body) => {
      const r = driver.handleNotification(url.pathname, body);
      // Caminho errado e dispositivo desconhecido respondem igual (404): não confirma o segredo a quem tenta adivinhar.
      send(r.ok ? 200 : (STATUS[r.code] ?? 404));
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, bind, () => resolve(server.address()));
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
