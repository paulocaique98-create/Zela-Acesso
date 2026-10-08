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

const MASTER_RE = /^[0-9a-f]{64}$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
}

/** Chave de comando do agente (D-021): HMAC(mestra, id do agente). A mestra nunca vai ao banco nem ao agente. */
export const deriveCommandKey = (masterHex, agentId) =>
  hmacHex(masterHex, `zela-cmd-key/v1:${agentId.toLowerCase()}`);

/** Mesma forma canonica de apps/edge-agent/src/commands.js (canonicalCommand). */
async function signCommandRow(row, key) {
  const cmd = {
    v: 1,
    id: row.id,
    agent_id: row.agentId,
    action: row.action,
    point_id: row.pointId,
    ...(row.durationMs == null ? {} : { duration_ms: row.durationMs }),
    issued_at: new Date(row.issuedAt).toISOString(),
    expires_at: new Date(row.expiresAt).toISOString(),
  };
  const canonical = JSON.stringify([
    cmd.v,
    cmd.id,
    cmd.agent_id,
    cmd.action,
    cmd.point_id,
    cmd.duration_ms ?? null,
    cmd.issued_at,
    cmd.expires_at,
  ]);
  return { ...cmd, signature: await hmacHex(key, canonical) };
}

// ---------------------------------------------------------------- Fase 8A (D-022): Ed25519 (WebCrypto, Deno e Node)
const b64uToBytes = (s) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
const hexToBytes = (h) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const PUB_HEX_RE = /^[0-9a-f]{64}$/;
const SIG_HEX_RE = /^[0-9a-f]{128}$/;
export const REQUEST_SKEW_MS = 120_000;

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
/** Mesma regra de apps/edge-agent/src/keys.js (kidOf): 16 primeiros hex do SHA-256 da chave publica em hex. */
export const kidOfPublicKey = async (pubHex) => (await sha256Hex(pubHex)).slice(0, 16);

/** Mensagem assinada pelo agente em cada requisicao (mesma forma de keys.js requestMessage). */
export const requestMessage = ({ agentId, ts, bodyHash }) =>
  `zela-req/v1\n${agentId.toLowerCase()}\n${ts}\n${bodyHash}`;

/** Nunca lanca: qualquer entrada invalida = false. */
export async function verifyEd25519(message, sigHex, pubHex) {
  if (typeof sigHex !== 'string' || !SIG_HEX_RE.test(sigHex) || !PUB_HEX_RE.test(pubHex ?? ''))
    return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(pubHex),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hexToBytes(sigHex),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

const signingCache = new Map();
/** Carrega a chave de assinatura de comando (JWK Ed25519 com `d`). Memoriza por texto; invalida = null (falha fechada). */
export async function loadSigningKey(jwkText) {
  if (!jwkText) return null;
  if (signingCache.has(jwkText)) return signingCache.get(jwkText);
  let out = null;
  try {
    const jwk = JSON.parse(jwkText);
    if (
      jwk?.kty === 'OKP' &&
      jwk.crv === 'Ed25519' &&
      typeof jwk.d === 'string' &&
      typeof jwk.x === 'string'
    ) {
      const publicKey = hex(b64uToBytes(jwk.x));
      if (PUB_HEX_RE.test(publicKey)) {
        const privateKey = await crypto.subtle.importKey(
          'jwk',
          { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x },
          { name: 'Ed25519' },
          false,
          ['sign'],
        );
        out = { kid: await kidOfPublicKey(publicKey), publicKey, privateKey };
      }
    }
  } catch {
    out = null;
  }
  signingCache.set(jwkText, out);
  return out;
}

/** Comando v2: Ed25519 com kid na forma canonica (igual a commands.js canonicalCommandV2). */
async function signCommandRowV2(row, signing) {
  const cmd = {
    v: 2,
    kid: signing.kid,
    id: row.id,
    agent_id: row.agentId,
    action: row.action,
    point_id: row.pointId,
    ...(row.durationMs == null ? {} : { duration_ms: row.durationMs }),
    issued_at: new Date(row.issuedAt).toISOString(),
    expires_at: new Date(row.expiresAt).toISOString(),
  };
  const canonical = JSON.stringify([
    2,
    cmd.kid,
    cmd.id,
    cmd.agent_id,
    cmd.action,
    cmd.point_id,
    cmd.duration_ms ?? null,
    cmd.issued_at,
    cmd.expires_at,
  ]);
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    signing.privateKey,
    new TextEncoder().encode(canonical),
  );
  return { ...cmd, signature: hex(sig) };
}

/** Declaracoes assinadas offline (scripts/command-key.mjs): so repassa, o agente e quem as valida. */
function parseStatements(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v.slice(0, 20) : [];
  } catch {
    return [];
  }
}

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
 *           allow?: (key: string) => boolean, allowGlobal?: (key: string) => Promise<boolean>, commandMasterKey?: string,
 *           deviceKey?: (agentId: string) => Promise<string | null>, allowLegacyAgents?: boolean,
 *           commandSigningJwk?: string, commandKeyStatements?: string, nowMs?: () => number }} deps
 * `deviceKey`: chave publica do dispositivo (null = sem chave/inexistente/revogado). Com chave registrada a
 * assinatura da requisicao e obrigatoria; sem chave, so passa se `allowLegacyAgents !== false` (D-022).
 */
export async function handle(req, deps) {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const enrollToken = req.headers.get('x-enroll-token');
  if (enrollToken !== null) return enroll(req, deps, enrollToken);

  const agentId = req.headers.get('x-agent-id') ?? '';
  const secret = req.headers.get('x-agent-secret') ?? '';
  if (!AGENT_ID_RE.test(agentId) || !SECRET_RE.test(secret)) return unauthorized();
  if (deps.allow && !deps.allow(agentId.toLowerCase())) return json(429, { error: 'rate_limited' });
  // Limite global (todas as instancias), contado no banco. Se o banco falhar, vale so o limite local acima
  // (nao derruba o agente por falha do contador; a autenticacao das RPCs continua obrigatoria).
  if (deps.allowGlobal) {
    const ok = await deps.allowGlobal(agentId.toLowerCase()).catch(() => true);
    if (!ok) return json(429, { error: 'rate_limited' });
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
  let text;
  try {
    text = await req.text();
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });

  // Prova de posse do dispositivo (D-022). Falha de consulta = 502 (nao cai para "legado" por erro do banco).
  let devicePub;
  try {
    devicePub = deps.deviceKey ? await deps.deviceKey(agentId.toLowerCase()) : null;
  } catch {
    return json(502, { error: 'upstream_error' });
  }
  if (devicePub) {
    const ts = req.headers.get('x-agent-ts') ?? '';
    const sig = req.headers.get('x-agent-sig') ?? '';
    const now = (deps.nowMs ?? Date.now)();
    if (!/^\d{10,16}$/.test(ts) || Math.abs(now - Number(ts)) > REQUEST_SKEW_MS)
      return unauthorized();
    const msg = requestMessage({ agentId, ts, bodyHash: await sha256Hex(text) });
    if (!(await verifyEd25519(msg, sig, devicePub))) return unauthorized();
  } else if (deps.allowLegacyAgents === false) {
    return unauthorized();
  }

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
    case 'confirm_biometric_erasure': {
      const profile = typeof body.profileId === 'string' ? body.profileId : '';
      if (!AGENT_ID_RE.test(profile)) return json(400, { error: 'invalid_body' });
      const { data, error } = await deps.rpc('edge_confirm_biometric_erasure', {
        ...base,
        p_profile: profile,
      });
      if (error) return fail();
      // false = agente invalido OU perfil nao elegivel (ja apagado / outro tenant); a RPC nao distingue, o gateway tambem nao.
      return json(200, { confirmed: data === true });
    }
    case 'reader_enrolled': {
      // Zela Pass (D-027): o Edge conferiu o codigo e registrou a chave publica do leitor; reflete na nuvem.
      const reader = typeof body.readerId === 'string' ? body.readerId : '';
      const pub = typeof body.publicKey === 'string' ? body.publicKey : '';
      if (!AGENT_ID_RE.test(reader) || !/^[0-9a-f]{64}$/.test(pub))
        return json(400, { error: 'invalid_body' });
      const { data, error } = await deps.rpc('edge_report_reader_enrolled', {
        ...base,
        p_reader: reader,
        p_public_key: pub,
        p_label: typeof body.label === 'string' ? body.label.slice(0, 80) : null,
      });
      if (error) return fail();
      // false = agente invalido OU leitor nao elegivel (ja ativo/revogado/outro tenant); a RPC nao distingue.
      return json(200, { recorded: data === true });
    }
    case 'poll_commands': {
      // Prefere v2 (Ed25519 + kid, D-022); sem chave de assinatura cai para v1 (HMAC, legado). Sem nenhuma das
      // duas nada e reivindicado nem assinado (falha fechada; o pedido segue pendente).
      const signing = await loadSigningKey(deps.commandSigningJwk);
      const master = deps.commandMasterKey;
      const v1 = !signing && master && MASTER_RE.test(master);
      if (!signing && !v1) return json(200, { commands: [] });
      const { data, error } = await deps.rpc('edge_claim_commands', base);
      if (error) return fail();
      if (!data) return unauthorized();
      const commands = signing
        ? await Promise.all(data.map((row) => signCommandRowV2(row, signing)))
        : await (async () => {
            const key = await deriveCommandKey(master, agentId);
            return Promise.all(data.map((row) => signCommandRow(row, key)));
          })();
      return json(200, { commands });
    }
    case 'command_keys': {
      // Canal de distribuicao das chaves publicas de comando: so para agente autenticado (e com prova de posse).
      const { data, error } = await deps.rpc('edge_authenticate', base);
      if (error) return fail();
      if (!Array.isArray(data) ? !data : data.length === 0) return unauthorized();
      const signing = await loadSigningKey(deps.commandSigningJwk);
      return json(200, {
        keys: signing ? [{ kid: signing.kid, publicKey: signing.publicKey }] : [],
        statements: parseStatements(deps.commandKeyStatements),
      });
    }
    case 'report_command_result': {
      const id = typeof body.commandId === 'string' ? body.commandId : '';
      const status = body.status;
      const code = body.code;
      if (
        !AGENT_ID_RE.test(id) ||
        !['executed', 'failed', 'rejected'].includes(status) ||
        typeof code !== 'string' ||
        !/^[A-Z0-9_]{1,64}$/.test(code)
      )
        return json(400, { error: 'invalid_body' });
      const { data, error } = await deps.rpc('edge_report_command_result', {
        ...base,
        p_command: id,
        p_status: status,
        p_code: code,
      });
      if (error) return error.code === '22023' ? json(400, { error: 'invalid_body' }) : fail();
      return json(200, { recorded: data === true });
    }
    default:
      return json(400, { error: 'invalid_body' });
  }
}

const ENROLL_TOKEN_RE = /^zea_[0-9a-f]{64}$/;

/**
 * Enrollment (D-022): troca o token de uso unico pela credencial do agente e registra a chave publica do
 * dispositivo. Sem cabecalhos de agente. Token invalido/expirado/usado = 401 generico. Sem chave de dispositivo
 * so e aceito com `allowLegacyAgents !== false`. Nunca registrar token, segredo ou corpo.
 */
async function enroll(req, deps, token) {
  if (!ENROLL_TOKEN_RE.test(token)) return unauthorized();
  if (deps.allow && !deps.allow('enroll')) return json(429, { error: 'rate_limited' });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > 4096) return json(413, { error: 'payload_too_large' });
  let body;
  try {
    const text = await req.text();
    if (text.length > 4096) return json(413, { error: 'payload_too_large' });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid_body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.op !== 'enroll')
    return json(400, { error: 'invalid_body' });
  const devicePub = body.devicePublicKey ?? null;
  if (devicePub !== null && !(typeof devicePub === 'string' && PUB_HEX_RE.test(devicePub)))
    return json(400, { error: 'invalid_body' });
  if (devicePub === null && deps.allowLegacyAgents === false)
    return json(400, { error: 'invalid_body' });
  const { data, error } = await deps.rpc('edge_enroll', {
    p_token: token,
    p_hostname: typeof body.hostname === 'string' ? body.hostname.slice(0, 120) : '',
    p_version: typeof body.version === 'string' ? body.version.slice(0, 40) : '',
    p_device_key: devicePub,
  });
  if (error) {
    if (error.code === '28000') return unauthorized();
    return error.code === '22023'
      ? json(400, { error: 'invalid_body' })
      : json(502, { error: 'upstream_error' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return unauthorized();
  return json(200, {
    agentId: row.agent_id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    agentSecret: row.agent_secret,
  });
}
