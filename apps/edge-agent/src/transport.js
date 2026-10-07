// Transporte HTTP do agente para o `edge-gateway` (Fase 4C). Só TLS (exceto loopback, para desenvolvimento).
// O segredo vai em cabeçalho, nunca em URL nem em log. 401 = credencial recusada (revogada) -> `null`.
// Qualquer outra falha (rede, timeout, 5xx, 429) lança: o chamador trata como offline e usa backoff.

const isLoopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/**
 * @param {{ baseUrl: string, agentId: string, secret: string, fetchImpl?: typeof fetch, timeoutMs?: number }} cfg
 */
export function createHttpTransport({
  baseUrl,
  agentId,
  secret,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))
    throw new Error('baseUrl deve usar https');

  async function call(body) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-id': agentId,
        'x-agent-secret': secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`gateway respondeu ${res.status}`);
    return res.json();
  }

  return {
    heartbeat: (info) => call({ op: 'heartbeat', ...info }),
    pullSnapshot: (knownHash) => call({ op: 'snapshot', knownHash }),
    sendEvents: (events) => call({ op: 'events', events }),
  };
}
