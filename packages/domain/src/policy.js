// Contrato de domínio da política de acesso (espelha public.access_policies; o banco é a fonte de verdade).
// Função pura e determinística: o motor da Fase 3 a reutiliza. Sem IA, sem I/O.

/** @typedef {'allow' | 'deny'} PolicyEffect */
/** @typedef {'active' | 'inactive'} PolicyStatus */
/**
 * @typedef {{
 *   id: string, groupId: string, zoneId: string | null, accessPointId: string | null,
 *   effect: PolicyEffect, scheduleId: string | null, requireChallenge: boolean, status: PolicyStatus,
 * }} AccessPolicy
 */
/** @typedef {'POLICY_MATCH' | 'POLICY_DENY' | 'ZONE_NOT_ALLOWED' | 'OUTSIDE_SCHEDULE' | 'MULTI_FACTOR_REQUIRED'} PolicyReason */

export const POLICY_EFFECTS = ['allow', 'deny'];

export const POLICY_EFFECT_LABEL = { allow: 'Permitir', deny: 'Negar' };
export const POLICY_STATUS_LABEL = { active: 'Ativa', inactive: 'Inativa' };

/**
 * Padrão é negar. Política negar vigente vence qualquer permitir. Permitir fora da janela não vale.
 * @param {{
 *   policies: readonly AccessPolicy[],
 *   groupIds: ReadonlySet<string> | readonly string[],
 *   zoneId: string,
 *   accessPointId: string,
 *   scheduleAllows: (scheduleId: string) => boolean,
 * }} input `scheduleAllows` diz se a janela está aberta agora (use evaluateSchedule); janela desconhecida deve devolver false.
 * @returns {{ decision: 'ALLOW' | 'DENY' | 'CHALLENGE', reason: PolicyReason, policyId: string | null }}
 */
export function evaluatePolicies({ policies, groupIds, zoneId, accessPointId, scheduleAllows }) {
  const groups = new Set(groupIds);
  const applicable = policies.filter(
    (p) =>
      p.status === 'active' &&
      groups.has(p.groupId) &&
      (p.accessPointId === accessPointId || (p.accessPointId === null && p.zoneId === zoneId)),
  );
  const inWindow = (p) => p.scheduleId === null || scheduleAllows(p.scheduleId) === true;

  const deny = applicable.find((p) => p.effect === 'deny' && inWindow(p));
  if (deny) return { decision: 'DENY', reason: 'POLICY_DENY', policyId: deny.id };

  const allows = applicable.filter((p) => p.effect === 'allow');
  const open = allows.filter(inWindow);
  if (open.length === 0) {
    return allows.length > 0
      ? { decision: 'DENY', reason: 'OUTSIDE_SCHEDULE', policyId: allows[0].id }
      : { decision: 'DENY', reason: 'ZONE_NOT_ALLOWED', policyId: null };
  }
  const free = open.find((p) => !p.requireChallenge);
  if (free) return { decision: 'ALLOW', reason: 'POLICY_MATCH', policyId: free.id };
  return { decision: 'CHALLENGE', reason: 'MULTI_FACTOR_REQUIRED', policyId: open[0].id };
}
