// Transportes do leitor para o Edge: WebSocket (padrão) e HTTPS (POST). Mesmo protocolo; o TCP/IP bruto não existe
// em navegador e fica para o app nativo (projeto futuro). Falha de rede/tempo esgotado lança TransportError; resposta
// do Edge (inclusive de recusa) é devolvida como objeto. WebSocket que não abre cai para HTTPS na hora.

export class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * @param {{ baseUrl: string, prefer?: 'websocket' | 'https', timeoutMs?: number,
 *   fetchImpl?: typeof fetch, WebSocketImpl?: typeof WebSocket }} cfg
 * @returns {{ send: (envelope: object) => Promise<any>, close: () => void, kind: () => 'websocket' | 'https' }}
 */
export function createTransport({
  baseUrl,
  prefer = 'websocket',
  timeoutMs = 8_000,
  fetchImpl = (...a) => fetch(...a),
  WebSocketImpl = globalThis.WebSocket,
}) {
  const root = baseUrl.replace(/\/+$/, '');
  let ws = null;
  let opening = null;
  let wsFailedAt = 0;
  let pending = []; // fila FIFO: o Edge responde na mesma ordem
  let last = prefer;

  const failPending = (err) => {
    const p = pending;
    pending = [];
    for (const w of p) w.fail(err);
  };

  function openSocket() {
    if (!WebSocketImpl) return Promise.reject(new TransportError('sem WebSocket'));
    if (ws && ws.readyState === 1) return Promise.resolve(ws);
    if (opening) return opening;
    opening = new Promise((ok, fail) => {
      const url = `${root.replace(/^http/, 'ws')}/reader/v1/ws`;
      const s = new WebSocketImpl(url);
      const timer = setTimeout(() => {
        s.close();
        fail(new TransportError('tempo esgotado ao abrir WebSocket'));
      }, timeoutMs);
      s.onopen = () => {
        clearTimeout(timer);
        ws = s;
        ok(s);
      };
      s.onmessage = (m) => {
        const w = pending.shift();
        if (!w) return;
        try {
          w.ok(JSON.parse(String(m.data)));
        } catch {
          w.fail(new TransportError('resposta inválida'));
        }
      };
      const dropped = () => {
        clearTimeout(timer);
        if (ws === s) ws = null;
        failPending(new TransportError('conexão encerrada'));
        fail(new TransportError('WebSocket indisponível'));
      };
      s.onerror = dropped;
      s.onclose = dropped;
    }).finally(() => {
      opening = null;
    });
    return opening;
  }

  function viaWebSocket(envelope) {
    return openSocket().then(
      (s) =>
        new Promise((ok, fail) => {
          const timer = setTimeout(() => {
            pending = pending.filter((w) => w !== entry);
            s.close();
            fail(new TransportError('tempo esgotado'));
          }, timeoutMs);
          const entry = {
            ok: (v) => (clearTimeout(timer), ok(v)),
            fail: (e) => (clearTimeout(timer), fail(e)),
          };
          pending.push(entry);
          s.send(JSON.stringify(envelope));
        }),
    );
  }

  async function viaHttps(envelope) {
    let res;
    try {
      res = await fetchImpl(`${root}/reader/v1/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch {
      throw new TransportError('sem conexão com o Edge');
    }
    try {
      return { status: res.status, ...(await res.json()) };
    } catch {
      throw new TransportError('resposta inválida');
    }
  }

  return {
    kind: () => last,
    close: () => {
      ws?.close();
      ws = null;
    },
    async send(envelope) {
      // WebSocket com falha recente não é retentado por 30 s: vai direto por HTTPS.
      const wsOk = prefer === 'websocket' && Date.now() - wsFailedAt > 30_000;
      if (wsOk) {
        try {
          last = 'websocket';
          return await viaWebSocket(envelope);
        } catch (e) {
          if (!(e instanceof TransportError)) throw e;
          wsFailedAt = Date.now();
        }
      }
      last = 'https';
      return viaHttps(envelope);
    },
  };
}
