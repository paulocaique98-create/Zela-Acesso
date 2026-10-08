// Decisão local do Edge Agent (Fase 4B): resolve a credencial no cache, monta o contexto e chama o motor
// determinístico `evaluateAccess` (packages/domain). Registra o evento na fila persistente e a presença local
// na MESMA transação. Este módulo só decide; não abre porta (comandos de dispositivo = 4D).

import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  OPENING_DECISIONS,
  evaluateAccess,
  evaluateAntiPassback,
  normalizeCardNumber,
  presenceToCommit,
  toAccessEventParams,
} from '@zela/domain';
import { loadClockStatus } from './clock.js';
import { loadCache } from './snapshot.js';

export const DEFAULT_CONFIG = {
  maxSnapshotAgeMs: 7 * 24 * 3_600_000, // além disso, ponto degraded_allow passa a negar (revogação pode estar defasada)
  enforceClock: true, // relógio não confiável + offline: ponto passa a degraded_deny (janelas/validade dependem da hora)
  pinMaxFailures: 5,
  pinLockMs: 5 * 60_000,
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
let dummyHash;
// Hash descartável: PIN de pessoa inexistente/sem PIN custa o mesmo tempo (sem oráculo de existência por tempo).
const dummy = () => (dummyHash ??= bcrypt.hashSync('zela-dummy', 10));

/**
 * Resolve a credencial apresentada contra o cache. Nunca devolve o segredo apresentado.
 * @returns {{ credential: object | null, steps: string[] }}
 */
function resolveCredential(store, index, tenantId, cred, now, cfg) {
  const none = (...steps) => ({ credential: null, steps });
  if (cred?.type === 'card' && typeof cred.number === 'string') {
    const n = normalizeCardNumber(cred.number);
    return { credential: index.cardByHash.get(sha256(`${tenantId}:${n}`)) ?? null, steps: [] };
  }
  if (cred?.type === 'mobile_token' && typeof cred.token === 'string') {
    return { credential: index.tokenByHash.get(sha256(cred.token)) ?? null, steps: [] };
  }
  if (cred?.type === 'pin' && typeof cred.personId === 'string' && typeof cred.pin === 'string') {
    const lock = store.getPinLock(cred.personId);
    if (lock?.lockedUntil && Date.parse(lock.lockedUntil) > now.getTime())
      return none('pin:locked');
    const stored = index.pinByPerson.get(cred.personId);
    const formatOk = /^[0-9]{6,8}$/.test(cred.pin);
    const match =
      bcrypt.compareSync(formatOk ? cred.pin : '0', stored?.secretHash ?? dummy()) &&
      formatOk &&
      !!stored;
    if (match) {
      store.clearPinFailures(cred.personId);
      return { credential: stored, steps: [] };
    }
    if (stored)
      store.recordPinFailure(cred.personId, now, {
        maxFailures: cfg.pinMaxFailures,
        lockMs: cfg.pinLockMs,
      });
    return none('pin:mismatch');
  }
  if (cred?.type === 'biometric' && typeof cred.personId === 'string') {
    // O perfil ativo aponta para a credencial biométrica; a verificação em si vem pronta em `input.biometric`.
    const profile = index.biometricProfileByPerson.get(cred.personId);
    const credential = profile
      ? (index.biometricCredentialById.get(profile.credentialId) ?? null)
      : null;
    return { credential: credential?.personId === cred.personId ? credential : null, steps: [] };
  }
  return none('credential:unsupported');
}

/**
 * Uma tentativa de acesso: decide, enfileira o evento (idempotente) e grava a presença — atômico.
 * @param {{
 *   store: ReturnType<import('./store.js').openStore>,
 *   accessPointId: string,
 *   credential: { type: 'biometric', personId: string } | { type: 'pin', personId: string, pin: string } | { type: 'card', number: string } | { type: 'mobile_token', token: string },
 *   now: Date,
 *   offline?: boolean,                 // padrão true: sem confirmação de que a nuvem está acessível
 *   emergencyActive?: boolean,
 *   biometric?: { accepted: boolean, reasonCode: string },  // resultado de verifyBiometricAttempt; ausente = recusa
 *   device?: { trusted: boolean } | null,
 *   reader?: { readerId: string, method: string, mode: 'register_only' | 'actuate' } | null,  // Zela Pass (D-027)
 *   config?: Partial<typeof DEFAULT_CONFIG>,
 *   newId?: () => string,
 * }} input
 */
export function processAccessAttempt(input) {
  const { store, now } = input;
  const cfg = { ...DEFAULT_CONFIG, ...input.config };
  const newId = input.newId ?? randomUUID;

  return store.tx(() => {
    const cache = loadCache(store);
    const index = cache?.index ?? null;
    const snap = index?.snapshot ?? null;
    const point = index?.points.get(input.accessPointId) ?? null;
    const zone = point ? index.zones.get(point.zoneId) : null;
    const offline = input.offline !== false;

    const { credential, steps: credSteps } = index
      ? resolveCredential(store, index, snap.tenantId, input.credential, now, cfg)
      : { credential: null, steps: [] };
    const person = credential ? (index.people.get(credential.personId) ?? null) : null;

    // Cache defasado: sem a nuvem não há como saber de revogações; ponto "permitir offline" passa a negar.
    const stale = !cache || now.getTime() - cache.fetchedAt.getTime() > cfg.maxSnapshotAgeMs;
    const clock = loadClockStatus(store, now);
    const clockDeny = cfg.enforceClock && clock.status === 'untrusted';
    const offlineBehavior =
      (stale || clockDeny) && offline
        ? 'degraded_deny'
        : (point?.offlineBehavior ?? 'degraded_deny');

    // Anti-passback local (estado em `presence`); só com pessoa e ponto conhecidos.
    let apb = null;
    if (person && point && zone) {
      const st = store.getPresence(zone.id, person.id);
      apb = evaluateAntiPassback({
        mode: zone.antipassbackMode,
        direction: point.direction,
        state: st?.state ?? null,
        since: st?.since ?? null,
        now,
        resetMinutes: zone.antipassbackResetMinutes,
      });
    }

    // Visitante: a visita (janela + zonas) vem do cache; sem visita no cache a pessoa visitante cai na política (nega).
    const visit = person ? (index.visitByPerson.get(person.id) ?? null) : null;

    const decision = evaluateAccess({
      now,
      timezone: snap?.timezone ?? '',
      accessPoint: {
        id: input.accessPointId,
        zoneId: point?.zoneId ?? '',
        status: point?.status ?? 'inactive',
        emergencyBehavior: point?.emergencyBehavior ?? 'fail_safe',
        offlineBehavior,
      },
      credential: credential
        ? {
            id: credential.id,
            personId: credential.personId,
            status: credential.status,
            expiresAt: credential.expiresAt,
            ...(credential.type === 'biometric' ? { kind: 'biometric' } : {}),
          }
        : null,
      biometric: input.biometric,
      person: person ? { id: person.id, status: person.status } : null,
      groupIds: person ? (index.groupsByPerson.get(person.id) ?? []) : [],
      policies: snap?.policies ?? [],
      schedules: index?.schedules ?? {},
      visit: visit
        ? {
            state: 'active',
            allowedZoneIds: visit.zoneIds ?? [],
            validFrom: visit.validFrom,
            validUntil: visit.validUntil,
          }
        : null,
      device: input.device ?? null,
      emergencyActive: input.emergencyActive === true,
      offline,
      antiPassback: apb ? { mode: apb.mode, violated: apb.violated } : undefined,
    });
    const clockSteps = clock.status === 'ok' ? [] : [`clock:${clock.status}`];
    // Sem credencial biométrica resolvida (ex.: sem perfil ativo) o motor não vê `kind`; registra o motivo da recusa.
    const bioSteps =
      input.credential?.type === 'biometric' && !credential && input.biometric
        ? [`biometric:${input.biometric.reasonCode}`]
        : [];
    for (const s of [
      ...credSteps,
      ...bioSteps,
      ...(stale && offline ? ['cache:stale'] : []),
      ...clockSteps,
    ])
      decision.evidence.steps.push(s);

    // Presença só avança quando a porta de fato libera (soft grava mesmo violando; hard não).
    if (apb && person && zone) {
      const next = presenceToCommit({
        decision: decision.decision,
        mode: apb.mode,
        violated: apb.violated,
        nextState: apb.nextState,
      });
      if (next) store.setPresence(zone.id, person.id, next, now.toISOString());
    }

    // Evento para a nuvem. Sem vínculo conhecido (cache nunca recebido) não há tenant/site: não enfileira.
    const [tenantId, siteId] = (
      snap ? `${snap.tenantId}/${snap.siteId}` : (store.getMeta('binding') ?? '/')
    ).split('/');
    let queued = false;
    let correlationId = null;
    if (tenantId && siteId) {
      correlationId = newId();
      const params = toAccessEventParams({
        decision,
        tenantId,
        siteId,
        occurredAt: now,
        source: 'EDGE_AGENT',
        correlationId,
        idempotencyKey: `edge:${newId()}`,
        reader: input.reader ?? null,
      });
      if (!point) {
        // ponto desconhecido: não propagar um id forjado/estranho para a nuvem
        params.p_access_point = null;
        params.p_zone = null;
      }
      queued = store.enqueue(params.p_idempotency_key, params, now.toISOString());
    }

    return {
      decision,
      open: OPENING_DECISIONS.includes(decision.decision),
      queued,
      // Vínculo do evento de decisão: o resultado físico (atuação) reaproveita a correlação.
      correlation: queued
        ? {
            tenantId,
            siteId,
            correlationId,
            accessPointId: point ? point.id : null,
            zoneId: point ? (zone?.id ?? null) : null,
            personId: person?.id ?? null,
          }
        : null,
    };
  });
}
