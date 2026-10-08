// Zela Pass (D-027): serviço do leitor no Edge. Uma só implementação do protocolo para QUALQUER transporte
// (HTTPS, WebSocket, TCP/IP): o adaptador entrega o envelope JSON e devolve a resposta.
// O leitor nunca decide: aqui a leitura vira credencial, passa pelo `evaluateAccess` (decide.js) e, só se o ponto
// tiver atuação E houver driver, pelo caminho normal de abertura (access.js). Ponto `register_only` = sem driver.
// Autenticação: cada mensagem é assinada pela chave Ed25519 do aparelho (registrada no enroll), com instante,
// nonce (anti-replay) e hash do corpo. Erros de autenticação são genéricos (sem oráculo de existência de leitor).
// Nunca entram em log nem na evidência: PIN, token, número de cartão.

import { createHash, randomUUID } from 'node:crypto';
import {
  READER_CLOCK_SKEW_MS,
  READER_OUTCOME_LABEL,
  isWithinReaderClockSkew,
  normalizeCardNumber,
  normalizePersonRef,
  parseAttemptBody,
  parseEnrollBody,
  parseReaderEnvelope,
  readerOutcome,
  readerSigningString,
} from '@zela/domain';
import { handleAccessAttempt } from './access.js';
import { processAccessAttempt } from './decide.js';
import { sha256Hex, verifyMessage } from './keys.js';
import { loadCache } from './snapshot.js';

export const DEFAULT_READER_LIMITS = {
  attemptsPerWindow: 30, // por leitor
  enrollPerWindow: 10, // por origem (IP/conexão)
  preAuthPerWindow: 300, // por origem, antes de autenticar (teto grosso contra inundação)
  windowMs: 60_000,
  attemptRetentionMs: 24 * 3_600_000,
  maxKeys: 5_000,
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   driver?: import('@zela/device-drivers').HardwareDriver | null,
 *   clock?: () => Date,
 *   isOffline?: () => boolean,       // sem contato recente com a nuvem (decide se o ponto usa o comportamento offline)
 *   unlockMs?: number,
 *   limits?: Partial<typeof DEFAULT_READER_LIMITS>,
 *   newId?: () => string,
 * }} cfg
 */
export function createReaderService({
  store,
  driver = null,
  clock = () => new Date(),
  isOffline = () => true,
  unlockMs,
  limits,
  newId = randomUUID,
}) {
  const lim = { ...DEFAULT_READER_LIMITS, ...limits };
  const buckets = new Map(); // chave -> { start, n }
  let calls = 0;

  /** Janela fixa por chave; recusa acima do teto. @returns {boolean} true se pode seguir */
  function allow(key, max, nowMs) {
    const b = buckets.get(key);
    if (!b || nowMs - b.start >= lim.windowMs) {
      if (buckets.size >= lim.maxKeys) {
        for (const [k, v] of buckets) if (nowMs - v.start >= lim.windowMs) buckets.delete(k);
        if (buckets.size >= lim.maxKeys) return false; // sob ataque de chaves novas: falha fechada
      }
      buckets.set(key, { start: nowMs, n: 1 });
      return true;
    }
    b.n += 1;
    return b.n <= max;
  }

  const reply = (status, body, now) => ({
    status,
    body: { ...body, serverTime: now.getTime() },
  });
  const fail = (status, code, now, extra = {}) => reply(status, { ok: false, code, ...extra }, now);

  function housekeeping(now) {
    calls += 1;
    if (calls % 200 !== 0) return;
    const iso = now.toISOString();
    store.purgeReaderNonces(iso);
    store.purgeReaderAttempts(new Date(now.getTime() - lim.attemptRetentionMs).toISOString());
  }

  /**
   * @param {unknown} raw envelope já parseado do JSON (a camada de transporte limita o tamanho e trata JSON inválido)
   * @param {{ source?: string }} [ctx] origem (ex.: IP) só para limite de taxa
   * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
   */
  async function handle(raw, ctx = {}) {
    const now = clock();
    const nowMs = now.getTime();
    housekeeping(now);
    const env = parseReaderEnvelope(raw);
    if (!env.ok) return fail(400, env.code, now);
    const { msg } = env;
    const bodyHash = sha256Hex(msg.body);
    const signed = readerSigningString({
      type: msg.type,
      readerId: msg.readerId,
      ts: msg.ts,
      nonce: msg.nonce,
      bodyHash,
    });

    if (msg.type === 'enroll') return enroll(msg, signed, ctx, now);

    // ---- mensagens de um leitor já ativado
    // Antes de autenticar só vale um teto grosso por ORIGEM: quem não tem a chave não consegue gastar a cota do leitor
    // legítimo (o teto por leitor só conta mensagem com assinatura válida).
    if (!allow(`s:${ctx.source ?? '-'}`, lim.preAuthPerWindow, nowMs))
      return fail(429, 'RATE_LIMITED', now);
    const reader = store.getReader(msg.readerId);
    if (!reader || !verifyMessage(signed, msg.sig, reader.publicKey))
      return fail(401, 'UNAUTHORIZED', now);
    if (!allow(`r:${msg.readerId}`, lim.attemptsPerWindow, nowMs))
      return fail(429, 'RATE_LIMITED', now);
    // Assinatura válida a partir daqui: o aparelho pode saber o motivo de uma recusa.
    if (!isWithinReaderClockSkew(msg.ts, nowMs))
      return fail(401, 'CLOCK_SKEW', now, { maxSkewMs: READER_CLOCK_SKEW_MS });
    const expires = new Date(nowMs + 2 * READER_CLOCK_SKEW_MS).toISOString();
    if (!store.claimReaderNonce(`${msg.readerId}:${msg.nonce}`, expires))
      return fail(401, 'REPLAY', now);

    const cache = loadCache(store);
    const index = cache?.index ?? null;
    if (!index) return fail(503, 'NO_SNAPSHOT', now);
    const meta = index.readers.get(msg.readerId);
    if (!meta) return fail(403, 'REVOKED', now); // revogado (ou removido) na nuvem
    const point = index.points.get(meta.accessPointId) ?? null;
    if (!point || point.status !== 'active') return fail(409, 'POINT_UNAVAILABLE', now);
    const registerOnly = point.actuation === 'none' || !driver;

    if (msg.type === 'status') {
      return reply(
        200,
        {
          ok: true,
          code: 'OK',
          mode: registerOnly ? 'register_only' : 'actuate',
          direction: point.direction,
          offline: isOffline(),
        },
        now,
      );
    }

    // ---- attempt
    const body = parseAttemptBody(msg.body);
    if (!body.ok) return fail(400, 'MALFORMED', now);
    const a = body.value;
    const prior = store.getReaderAttempt(msg.readerId, a.deviceEventId);
    if (prior)
      return reply(
        200,
        {
          ok: true,
          code: 'OK',
          outcome: prior,
          label: READER_OUTCOME_LABEL[prior],
          duplicate: true,
        },
        now,
      );

    const tenantId = index.snapshot.tenantId;
    let credential;
    if (a.method === 'pin') {
      // Identificador desconhecido: id aleatório, o motor custa o mesmo tempo e responde "credencial inválida".
      const personId =
        index.peopleByRef.get(sha256(`${tenantId}:${normalizePersonRef(a.identifier)}`)) ?? newId();
      credential = { type: 'pin', personId, pin: a.pin };
    } else if (a.method === 'qr') {
      credential = { type: 'mobile_token', token: a.value };
    } else {
      credential = { type: 'card', number: normalizeCardNumber(a.value) };
    }
    const mode = registerOnly ? 'register_only' : 'actuate';
    const attempt = {
      store,
      accessPointId: point.id,
      credential,
      now,
      offline: isOffline(),
      reader: { readerId: msg.readerId, method: a.method, mode },
    };
    const result = registerOnly
      ? processAccessAttempt(attempt)
      : await handleAccessAttempt({ ...attempt, driver, ...(unlockMs ? { unlockMs } : {}) });

    const outcome = readerOutcome(result.decision);
    store.saveReaderAttempt(msg.readerId, a.deviceEventId, outcome, now.toISOString());
    return reply(
      200,
      {
        ok: true,
        code: 'OK',
        outcome,
        label: READER_OUTCOME_LABEL[outcome],
        direction: point.direction,
        mode,
      },
      now,
    );
  }

  /** Ativação: código de uso único (hash vem no snapshot) + prova de posse da chave pública. */
  function enroll(msg, signed, ctx, now) {
    const nowMs = now.getTime();
    // Falhas de ativação são todas iguais para quem não tem o código (sem oráculo de código válido/expirado/usado).
    const refuse = () => fail(403, 'ENROLL_REJECTED', now);
    if (!allow(`e:${ctx.source ?? '-'}`, lim.enrollPerWindow, nowMs))
      return fail(429, 'RATE_LIMITED', now);
    const body = parseEnrollBody(msg.body);
    if (!body.ok) return fail(400, 'MALFORMED', now);
    const { code, publicKey, label } = body.value;
    if (!verifyMessage(signed, msg.sig, publicKey)) return refuse(); // prova de posse da privada
    if (!isWithinReaderClockSkew(msg.ts, nowMs))
      return fail(401, 'CLOCK_SKEW', now, { maxSkewMs: READER_CLOCK_SKEW_MS });
    const index = loadCache(store)?.index ?? null;
    if (!index) return fail(503, 'NO_SNAPSHOT', now);
    const expires = new Date(nowMs + 2 * READER_CLOCK_SKEW_MS).toISOString();
    return store.tx(() => {
      if (!store.claimReaderNonce(`enroll:${msg.nonce}`, expires)) return fail(401, 'REPLAY', now);
      const r = index.readersByCodeHash.get(sha256(code));
      if (!r || !(Date.parse(r.enrollmentExpiresAt) > nowMs)) return refuse();
      const point = index.points.get(r.accessPointId) ?? null;
      if (!point || point.status !== 'active') return refuse();
      if (!store.enrollReader(r.id, publicKey, label || null, now.toISOString())) return refuse();
      return reply(
        200,
        {
          ok: true,
          code: 'OK',
          readerId: r.id,
          accessPointId: r.accessPointId,
          mode: point.actuation === 'none' || !driver ? 'register_only' : 'actuate',
          direction: point.direction,
        },
        now,
      );
    });
  }

  return { handle };
}
