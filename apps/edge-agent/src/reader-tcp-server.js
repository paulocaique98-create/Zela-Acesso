// Zela Pass (D-027): transporte TCP/IP do leitor (para o app nativo, projeto futuro). Mesmo protocolo e MESMO serviço do
// HTTPS/WebSocket: um envelope JSON por linha (NDJSON, UTF-8, terminado em "\n"), uma resposta JSON por linha, em ordem.
// Cada mensagem continua assinada pelo aparelho; TLS é recomendado (obrigatório em produção fora de loopback, config.js).
// Limites: linha de 8 KiB, 200 conexões, inatividade de 60 s.

import { createServer as createNetServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

const MAX_LINE = 8 * 1024;
const MAX_CONNECTIONS = 200;
const IDLE_MS = 60_000;

/**
 * @param {{
 *   service: { handle: (raw: unknown, ctx?: { source?: string }) => Promise<{ status: number, body: object }> },
 *   bind: string, port: number,
 *   tls?: { cert: string | Buffer, key: string | Buffer } | null,
 *   idleMs?: number,
 *   onError?: (e: unknown) => void,
 * }} cfg
 */
export function createReaderTcpServer({
  service,
  bind,
  port,
  tls = null,
  idleMs = IDLE_MS,
  onError = () => {},
}) {
  const sockets = new Set();
  const onConnection = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const source = socket.remoteAddress;
    socket.setTimeout(idleMs, () => socket.destroy());
    socket.setNoDelay(true);
    socket.on('error', () => {});
    let buf = '';
    let chain = Promise.resolve();
    const write = (obj) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(obj)}\n`);
    };
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.length > MAX_LINE * 2 && !buf.includes('\n')) {
        write({ ok: false, code: 'TOO_LARGE' });
        return socket.destroy();
      }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        if (line.length > MAX_LINE) {
          write({ ok: false, code: 'TOO_LARGE' });
          return socket.destroy();
        }
        let json;
        try {
          json = JSON.parse(line);
        } catch {
          write({ ok: false, code: 'MALFORMED' });
          return socket.end();
        }
        chain = chain
          .then(() => service.handle(json, { source }))
          .then((r) => write({ status: r.status, ...r.body }))
          .catch((e) => {
            onError(e);
            write({ ok: false, code: 'INTERNAL' });
          });
      }
    });
  };
  const server = tls
    ? createTlsServer({ cert: tls.cert, key: tls.key }, onConnection)
    : createNetServer(onConnection);
  server.maxConnections = MAX_CONNECTIONS;
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
        server.close(() => ok());
        for (const s of sockets) s.destroy();
      }),
  };
}
