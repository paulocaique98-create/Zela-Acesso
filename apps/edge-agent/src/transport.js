// Transporte HTTP do agente para o `edge-gateway` (Fase 4C). Só TLS (exceto loopback, para desenvolvimento).
// O segredo vai em cabeçalho, nunca em URL nem em log. 401 = credencial recusada (revogada) -> `null`.
// Qualquer outra falha (rede, timeout, 5xx, 429) lança: o chamador trata como offline e usa backoff.
// Fase 8A (D-022): com `deviceKey`, cada requisição leva assinatura Ed25519 (agente + instante + hash do corpo),
// provando posse do dispositivo além do segredo. O gateway recusa agente com chave registrada sem assinatura válida.

import { requestMessage, sha256Hex, signMessage } from './keys.js';

const isLoopback = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

function checkedUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))
    throw new Error('baseUrl deve usar https');
  return url;
}

/**
 * @param {{ baseUrl: string, agentId: string, secret: string, deviceKey?: string, fetchImpl?: typeof fetch,
 *   timeoutMs?: number, nowMs?: () => number }} cfg `deviceKey`: privada Ed25519 PKCS#8 em base64
 */
export function createHttpTransport({
  baseUrl,
  agentId,
  secret,
  deviceKey,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  nowMs = Date.now,
}) {
  const url = checkedUrl(baseUrl);

  async function call(body) {
    const text = JSON.stringify(body);
    const headers = {
      'content-type': 'application/json',
      'x-agent-id': agentId,
      'x-agent-secret': secret,
    };
    if (deviceKey) {
      const ts = String(nowMs());
      headers['x-agent-ts'] = ts;
      headers['x-agent-sig'] = signMessage(
        requestMessage({ agentId, ts, bodyHash: sha256Hex(text) }),
        deviceKey,
      );
    }
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: text,
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
    pollCommands: () => call({ op: 'poll_commands' }),
    reportCommandResult: (commandId, status, code) =>
      call({ op: 'report_command_result', commandId, status, code }),
    confirmBiometricErasure: (profileId) => call({ op: 'confirm_biometric_erasure', profileId }),
    commandKeys: () => call({ op: 'command_keys' }),
    reportReaderEnrolled: (readerId, publicKey, label) =>
      call({ op: 'reader_enrolled', readerId, publicKey, label }),
  };
}

/**
 * Enrollment: troca o token de uso único pela credencial do agente, registrando a chave pública do dispositivo.
 * Não usa cabeçalhos de agente (ainda não existem). Lança em qualquer falha (token inválido inclusive).
 * @param {{ baseUrl: string, token: string, devicePublicKey: string, hostname: string, version: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number }} cfg
 * @returns {Promise<{ agentId: string, tenantId: string, siteId: string, agentSecret: string }>}
 */
export async function enrollAgent({
  baseUrl,
  token,
  devicePublicKey,
  hostname,
  version,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) {
  const res = await fetchImpl(checkedUrl(baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-enroll-token': token },
    body: JSON.stringify({ op: 'enroll', devicePublicKey, hostname, version }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`enrollment recusado (${res.status})`);
  const out = await res.json();
  return {
    agentId: out.agentId,
    tenantId: out.tenantId,
    siteId: out.siteId,
    agentSecret: out.agentSecret,
  };
}
