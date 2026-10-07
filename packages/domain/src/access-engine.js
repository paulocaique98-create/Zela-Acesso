// Motor de decisão de acesso (Fase 3B). Determinístico, puro, sem I/O, sem relógio, sem IA.
// Falha fechada: contexto inválido ou erro interno => DENY/CONTEXT_INVALID (nunca abre por engano).
// Precedência (a primeira que decide, vence): emergência > ponto/dispositivo > credencial > pessoa >
// visita > políticas/janelas > desafio > anti-passback > modo offline.

import { evaluatePolicies } from './policy.js';
import { evaluateSchedule } from './schedule.js';

/** @typedef {import('./access-contracts.js').AccessContext} AccessContext */
/** @typedef {import('./access-contracts.js').AccessDecision} AccessDecision */

/**
 * @param {AccessContext} ctx
 * @returns {AccessDecision}
 */
export function evaluateAccess(ctx) {
  /** @type {string[]} */
  const steps = [];
  const ev = {
    personId: null,
    credentialId: null,
    accessPointId: null,
    zoneId: null,
    policyId: null,
    scheduleId: null,
    deviceTrusted: null,
    antiPassback: /** @type {import('./access-contracts.js').AntiPassbackOutcome} */ ('OFF'),
    offline: false,
    evaluatedAt: /** @type {string | null} */ (null),
    steps,
  };
  /** @type {(decision: AccessDecision['decision'], reasonCode: AccessDecision['reasonCode'], policyId?: string | null) => AccessDecision} */
  const out = (decision, reasonCode, policyId = null) => {
    steps.push(`${decision}:${reasonCode}`);
    ev.policyId = policyId ?? ev.policyId;
    return { decision, reasonCode, policyId: ev.policyId, evidence: ev };
  };

  try {
    const now = ctx?.now;
    if (
      !(now instanceof Date) ||
      Number.isNaN(now.getTime()) ||
      !ctx.timezone ||
      !ctx.accessPoint?.id ||
      !ctx.accessPoint.zoneId
    ) {
      return out('DENY', 'CONTEXT_INVALID');
    }
    ev.evaluatedAt = now.toISOString();
    ev.accessPointId = ctx.accessPoint.id;
    ev.zoneId = ctx.accessPoint.zoneId;
    ev.credentialId = ctx.credential?.id ?? null;
    ev.personId = ctx.person?.id ?? ctx.credential?.personId ?? null;
    ev.deviceTrusted = ctx.device ? ctx.device.trusted === true : null;
    ev.offline = ctx.offline === true;

    // 1. Emergência: fail-safe libera (software nunca bloqueia saída segura); fail-secure mantém travado.
    if (ctx.emergencyActive === true) {
      steps.push('emergency');
      return ctx.accessPoint.emergencyBehavior === 'fail_safe'
        ? out('ALLOW', 'EMERGENCY_POLICY')
        : out('DENY', 'EMERGENCY_POLICY');
    }

    // 2. Ponto e dispositivo.
    if (ctx.accessPoint.status !== 'active') return out('DENY', 'ACCESS_POINT_INACTIVE');
    if (ctx.device && ctx.device.trusted !== true) return out('DENY', 'DEVICE_UNTRUSTED');

    // 3. Credencial.
    const cred = ctx.credential;
    if (!cred || cred.status !== 'active') return out('DENY', 'CREDENTIAL_INVALID');
    if (cred.expiresAt != null) {
      const exp = new Date(cred.expiresAt);
      if (Number.isNaN(exp.getTime())) return out('DENY', 'CREDENTIAL_INVALID');
      if (exp.getTime() <= now.getTime()) return out('DENY', 'CREDENTIAL_EXPIRED');
    }

    // 4. Pessoa (e vínculo credencial-pessoa).
    if (!ctx.person || ctx.person.id !== cred.personId) return out('DENY', 'CREDENTIAL_INVALID');
    if (ctx.person.status !== 'active') return out('DENY', 'PERSON_DISABLED');

    // 5. Visita (quando a pessoa está em visita).
    if (ctx.visit) {
      if (ctx.visit.state !== 'active') return out('DENY', 'VISITOR_EXPIRED');
      if (!ctx.visit.allowedZoneIds.includes(ctx.accessPoint.zoneId)) {
        return out('DENY', 'VISITOR_ZONE_NOT_ALLOWED');
      }
    }

    // 6. Políticas + janelas (padrão é negar; janela desconhecida nega).
    let lastScheduleId = null;
    const scheduleAllows = (/** @type {string} */ id) => {
      lastScheduleId = id;
      const s = ctx.schedules?.[id];
      return s
        ? evaluateSchedule(s.schedule, now, ctx.timezone, s.holidayDates ?? []).allowed
        : false;
    };
    const pol = evaluatePolicies({
      policies: ctx.policies ?? [],
      groupIds: ctx.groupIds ?? [],
      zoneId: ctx.accessPoint.zoneId,
      accessPointId: ctx.accessPoint.id,
      scheduleAllows,
    });
    ev.policyId = pol.policyId;
    const matched = (ctx.policies ?? []).find((p) => p.id === pol.policyId);
    ev.scheduleId = matched?.scheduleId ?? lastScheduleId;
    steps.push(`policy:${pol.decision}:${pol.reason}`);

    /** @type {AccessDecision['decision']} */
    let decision = pol.decision;
    /** @type {AccessDecision['reasonCode']} */
    let reason = pol.reason;

    // 7. Desafio (segundo fator) já satisfeito pelo chamador.
    if (decision === 'CHALLENGE' && ctx.challengeSatisfied === true) {
      decision = 'ALLOW';
      reason = 'POLICY_MATCH';
      steps.push('challenge:satisfied');
    }

    // 8. Anti-passback só interfere em quem seria liberado.
    if (decision === 'ALLOW' || decision === 'CHALLENGE') {
      const apb = ctx.antiPassback;
      if (apb && apb.mode !== 'off') {
        if (!apb.violated) ev.antiPassback = 'OK';
        else if (apb.mode === 'hard') {
          ev.antiPassback = 'VIOLATION_HARD';
          return out('DENY', 'ANTI_PASSBACK');
        } else ev.antiPassback = 'VIOLATION_SOFT'; // soft: libera e registra a violação na evidência
      }
    }

    // 9. Modo offline: o comportamento do ponto manda; regra que nega continua negando.
    if (ctx.offline === true) {
      if (ctx.accessPoint.offlineBehavior !== 'degraded_allow') {
        return out('DEGRADED_DENY', 'OFFLINE_POLICY_DENY');
      }
      if (decision === 'ALLOW') return out('DEGRADED_ALLOW', 'OFFLINE_POLICY_ALLOW', pol.policyId);
    }

    return out(decision, reason, pol.policyId);
  } catch {
    return out('DENY', 'CONTEXT_INVALID');
  }
}
