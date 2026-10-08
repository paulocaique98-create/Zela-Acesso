// Zela Pass (D-027): serviço do leitor no Edge. Uma só implementação do protocolo para QUALQUER transporte
// (HTTPS, WebSocket, TCP/IP): o adaptador entrega o envelope JSON e devolve a resposta.
// O leitor nunca decide: aqui a leitura vira credencial, passa pelo `evaluateAccess` (decide.js) e, só se o ponto
// tiver atuação E houver driver, pelo caminho normal de abertura (access.js). Ponto `register_only` = sem driver.
// Autenticação: cada mensagem é assinada pela chave Ed25519 do aparelho (registrada no enroll), com instante,
// nonce (anti-replay) e hash do corpo. Erros de autenticação são genéricos (sem oráculo de existência de leitor).
// Nunca entram em log nem na evidência: PIN, token, número de cartão.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FACE_PROVIDER_KIND, checkBiometricSettings } from '@zela/biometrics';
import {
  READER_CLOCK_SKEW_MS,
  READER_OUTCOME_LABEL,
  faceCaptureCode,
  isWithinReaderClockSkew,
  normalizeCardNumber,
  normalizePersonRef,
  parseAttemptBody,
  parseEnrollBody,
  parseFaceEnrollBody,
  parseReaderEnvelope,
  readerOutcome,
  readerSigningString,
} from '@zela/domain';
import { handleAccessAttempt } from './access.js';
import { verifyBiometricAttempt } from './biometric.js';
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
  challengeTtlMs: 60_000, // validade do desafio de 2º fator (uso único)
  maxChallenges: 1_000,
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   driver?: import('@zela/device-drivers').HardwareDriver | null,
 *   biometricProvider?: ReturnType<typeof import('./face-provider.js').createEdgeFaceProvider> | null, // facial (método `face`)
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
  biometricProvider = null,
  clock = () => new Date(),
  isOffline = () => true,
  unlockMs,
  limits,
  newId = randomUUID,
}) {
  const lim = { ...DEFAULT_READER_LIMITS, ...limits };
  const buckets = new Map(); // chave -> { start, n }
  // Desafios de 2º fator abertos pelo facial: só em memória (expiram em segundos; reiniciar o Edge obriga a refazer o facial).
  const challenges = new Map(); // challengeId -> { readerId, pointId, personId, biometric, expiresAt }
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
          face: faceAvailable(index, now),
        },
        now,
      );
    }

    if (msg.type === 'face_enroll') return faceEnroll(msg, index, now);

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
    let biometric; // só no método facial: a verificação é assíncrona e acontece antes da decisão síncrona
    let secondFactor;
    if (a.challengeId) {
      // Confirmação do 2º fator: a pessoa e a verificação facial vêm do desafio, não do que o aparelho envia agora.
      const ch = challenges.get(a.challengeId);
      challenges.delete(a.challengeId); // uso único, aceito ou não
      if (!ch || ch.readerId !== msg.readerId || ch.pointId !== point.id || ch.expiresAt <= nowMs) {
        store.saveReaderAttempt(
          msg.readerId,
          a.deviceEventId,
          'INVALID_CREDENTIAL',
          now.toISOString(),
        );
        return reply(
          200,
          {
            ok: true,
            code: 'OK',
            outcome: 'INVALID_CREDENTIAL',
            label: READER_OUTCOME_LABEL.INVALID_CREDENTIAL,
            direction: point.direction,
            mode: registerOnly ? 'register_only' : 'actuate',
          },
          now,
        );
      }
      credential = { type: 'biometric', personId: ch.personId };
      biometric = ch.biometric;
      secondFactor = { pin: a.pin };
    } else if (a.method === 'pin') {
      // Identificador desconhecido: id aleatório, o motor custa o mesmo tempo e responde "credencial inválida".
      const personId =
        index.peopleByRef.get(sha256(`${tenantId}:${normalizePersonRef(a.identifier)}`)) ?? newId();
      credential = { type: 'pin', personId, pin: a.pin };
    } else if (a.method === 'face') {
      const f = await identifyFace(index, a, point.id, now);
      credential = { type: 'biometric', personId: f.personId };
      biometric = f.biometric;
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
      ...(biometric ? { biometric } : {}),
      ...(secondFactor ? { secondFactor } : {}),
    };
    const result = registerOnly
      ? processAccessAttempt(attempt)
      : await handleAccessAttempt({ ...attempt, driver, ...(unlockMs ? { unlockMs } : {}) });

    const outcome = readerOutcome(result.decision);
    store.saveReaderAttempt(msg.readerId, a.deviceEventId, outcome, now.toISOString());
    // Facial reconhecido num ponto com 2º fator: abre o desafio (o leitor pede o PIN e reenvia com o `challengeId`).
    let challengeId;
    if (
      outcome === 'CHALLENGE_REQUIRED' &&
      !secondFactor &&
      credential.type === 'biometric' &&
      result.decision.evidence.steps.includes('second_factor:required')
    )
      challengeId = openChallenge({
        readerId: msg.readerId,
        pointId: point.id,
        personId: credential.personId,
        biometric,
        nowMs,
      });
    return reply(
      200,
      {
        ok: true,
        code: 'OK',
        outcome,
        label: READER_OUTCOME_LABEL[outcome],
        direction: point.direction,
        mode,
        ...(challengeId ? { challengeId, challengeTtlMs: lim.challengeTtlMs } : {}),
      },
      now,
    );
  }

  /** Desafio de 2º fator: id de 128 bits aleatórios, uso único, curto. Sob inundação, falha fechada (não abre desafio). */
  function openChallenge({ readerId, pointId, personId, biometric, nowMs }) {
    if (challenges.size >= lim.maxChallenges) {
      for (const [k, v] of challenges) if (v.expiresAt <= nowMs) challenges.delete(k);
      if (challenges.size >= lim.maxChallenges) return undefined;
    }
    const id = randomBytes(16).toString('hex');
    challenges.set(id, {
      readerId,
      pointId,
      personId,
      biometric,
      expiresAt: nowMs + lim.challengeTtlMs,
    });
    return id;
  }

  const faceProvider = biometricProvider?.kind === FACE_PROVIDER_KIND ? biometricProvider : null;

  /** O leitor só oferece o facial se há provedor e a política da organização está completa e vigente. */
  function faceAvailable(index, now) {
    return !!faceProvider && checkBiometricSettings(index.biometricSettings, now).ok;
  }

  /** Perfis ativos do provedor facial: referência do gabarito -> pessoa. */
  function faceProfiles(index) {
    const byRef = new Map();
    for (const [personId, p] of index.biometricProfileByPerson)
      if (p.provider === FACE_PROVIDER_KIND && p.templateRef) byRef.set(p.templateRef, personId);
    return byRef;
  }

  /**
   * Identificação 1:N e verificação. Quem não é reconhecido recebe um id aleatório: o motor responde
   * "credencial inválida" gravando a evidência, sem revelar se havia gabarito parecido.
   */
  async function identifyFace(index, a, accessPointId, now) {
    const sample = { descriptor: a.descriptor, liveness: a.liveness };
    const byRef = faceProfiles(index);
    const hit = faceProvider ? faceProvider.identify(sample, [...byRef.keys()]) : null;
    if (!hit)
      return {
        personId: newId(),
        biometric: {
          accepted: false,
          reasonCode: faceProvider ? 'BIOMETRIC_NO_MATCH' : 'BIOMETRIC_PROVIDER_UNAVAILABLE',
        },
      };
    const personId = byRef.get(hit.ref);
    const biometric = await verifyBiometricAttempt({
      store,
      personId,
      accessPointId,
      now,
      provider: faceProvider,
      sample,
    });
    return { personId, biometric };
  }

  /**
   * Captura do gabarito facial de um perfil criado no painel (consentimento já registrado na nuvem). O código de
   * captura (8 hex do id do perfil) é mostrado no painel; só perfil ativo, do provedor facial e SEM gabarito aceita
   * captura, uma única vez (nunca sobrescreve). Exige prova de vida quando a política exige e recusa rosto que já
   * pertence a outro perfil.
   */
  function faceEnroll(msg, index, now) {
    const body = parseFaceEnrollBody(msg.body);
    if (!body.ok) return fail(400, 'MALFORMED', now);
    if (!faceAvailable(index, now)) return fail(409, 'FACE_UNAVAILABLE', now);
    const { code, descriptor, liveness } = body.value;
    if (index.biometricSettings.requireLiveness !== false && liveness !== 'PASSED')
      return fail(422, 'LIVENESS_FAILED', now);
    const pending = [...index.biometricProfileByPerson.values()].filter(
      (p) =>
        p.provider === FACE_PROVIDER_KIND &&
        p.templateRef &&
        faceCaptureCode(p.id) === code &&
        !store.hasFaceTemplate(p.templateRef),
    );
    if (pending.length === 0) return fail(404, 'ENROLL_NOT_FOUND', now);
    if (pending.length > 1) return fail(409, 'AMBIGUOUS_CODE', now);
    const ref = pending[0].templateRef;
    if (faceProvider.duplicateOf(descriptor, ref)) return fail(409, 'FACE_ALREADY_ENROLLED', now);
    const r = faceProvider.enroll(ref, descriptor, now.toISOString());
    if (r !== 'stored') return fail(409, 'ENROLL_NOT_FOUND', now);
    return reply(200, { ok: true, code: 'OK' }, now);
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
