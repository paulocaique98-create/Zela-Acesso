// Gateway do Edge Agent (Fase 4C): unico ponto de entrada do agente na nuvem. O agente NAO tem JWT de usuario nem
// service_role: manda o id e o segredo proprios (TLS); esta funcao os repassa as RPCs `edge_*` (so service_role),
// que autenticam de novo. Credencial invalida/revogada = 401 generico (sem distinguir o motivo).
// Nunca registrar segredo, corpo ou payload em log. Logica pura (rpc injetado): ver packages/domain/src/edge-gateway.test.js.

export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_EVENTS_PER_BATCH = 100;
export const RATE_LIMIT_PER_MINUTE = 120;
const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^zes_[0-9a-f]{64}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const unauthorized = () => json(401, { error: 'unauthorized' });

/** Limite por agente em janela de 1 minuto (melhor esforco: o estado vive no isolate). */
export function createRateLimiter(limit = RATE_LIMIT_PER_MINUTE, windowMs = 60_000) {
  const hits = new Map();
  return (key, nowMs = Date.now()) => {
    const fresh = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
    if (fresh.length >= limit) {
      hits.set(key, fresh);
      return false;
    }
    fresh.push(nowMs);
    hits.set(key, fresh);
    if (hits.size > 5000)
      for (const [k, v] of hits) if (!v.some((t) => nowMs - t < windowMs)) hits.delete(k);
    return true;
  };
}

/**
 * @param {Request} req
 * @param {{ rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any, error: any }>,
 *           allow?: (key: string) => boolean }} deps
 */
export async function handle(req, deps) {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const agentId = req.headers.get('x-agent-id') ?? '';
  const secret = req.headers.get('x-agent-secret') ?? '';
  if (!AGENT_ID_RE.test(agentId) || !SECRET_RE.test(secret)) return unauthorized();
  if (deps.allow && !deps.allow(agentId.toLowerCase())) return json(429, { error: 'rate_limited' });

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
  let text;
  try {
    text = await req.text();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json(400, { error: 'invalid_body' });

  const base = { p_agent: agentId, p_secret: secret };
  const fail = () => json(502, { error: 'upstream_error' }); // nunca devolver a mensagem do banco

  switch (body.op) {
    case 'heartbeat': {
      const at = typeof body.agentTime === 'string' ? new Date(body.agentTime) : null;
      if (!at || Number.isNaN(at.getTime())) return json(400, { error: 'invalid_body' });
      const depth = Number.isInteger(body.queueDepth) && body.queueDepth >= 0 ? body.queueDepth : 0;
      const { data, error } = await deps.rpc('edge_heartbeat', {
        ...base,
        p_version: typeof body.version === 'string' ? body.version.slice(0, 40) : null,
        p_agent_time: at.toISOString(),
        p_queue_depth: depth,
      });
      if (error) return fail();
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return unauthorized();
      return json(200, { serverTime: row.server_time, clockDriftSeconds: row.clock_drift_seconds });
    }
    case 'snapshot': {
      const known = body.knownHash == null ? null : String(body.knownHash);
      if (known !== null && !HASH_RE.test(known)) return json(400, { error: 'invalid_body' });
      const { data, error } = await deps.rpc('edge_pull_snapshot', {
        ...base,
        p_known_hash: known,
      });
      if (error) return fail();
      if (!data) return unauthorized();
      return json(200, data);
    }
    case 'events': {
      if (
        !Array.isArray(body.events) ||
        body.events.length === 0 ||
        body.events.length > MAX_EVENTS_PER_BATCH
      )
        return json(400, { error: 'invalid_body' });
      const { data, error } = await deps.rpc('edge_ingest_events', {
        ...base,
        p_events: body.events,
      });
      if (error) return error.code === '22023' ? json(400, { error: 'invalid_body' }) : fail();
      if (!data) return unauthorized();
      return json(200, data);
    }
    default:
      return json(400, { error: 'invalid_body' });
  }
}
