// Fase 3C: converte uma AccessDecision em parâmetros de `record_access_event` (server-side, service_role).
// Função pura: sem I/O. O hash/seq/recorded_at são calculados pelo banco (cadeia por tenant); nunca aqui.

export const ACCESS_EVENT_SOURCES = ['ENGINE', 'EDGE_AGENT', 'DEVICE', 'ADMIN'];
export const PHYSICAL_OUTCOMES = [
  'DOOR_OPENED',
  'DOOR_NOT_OPENED',
  'DOOR_FORCED',
  'DOOR_HELD_OPEN',
  'UNKNOWN',
];

/**
 * @param {{
 *   decision: import('./access-contracts.js').AccessDecision,
 *   tenantId: string, siteId: string, occurredAt: Date | string,
 *   source?: 'ENGINE' | 'EDGE_AGENT' | 'DEVICE' | 'ADMIN',
 *   physicalOutcome?: string | null, correlationId?: string | null, idempotencyKey?: string | null,
 * }} input
 * @returns {Record<string, unknown>} argumentos nomeados da RPC `record_access_event`
 */
export function toAccessEventParams(input) {
  const { decision, tenantId, siteId, occurredAt } = input;
  const source = input.source ?? 'ENGINE';
  if (!tenantId || !siteId) throw new Error('tenantId e siteId são obrigatórios');
  if (!decision?.decision || !decision?.reasonCode) throw new Error('AccessDecision inválida');
  if (!ACCESS_EVENT_SOURCES.includes(source)) throw new Error(`source inválida: ${source}`);
  const outcome = input.physicalOutcome ?? null;
  if (outcome !== null && !PHYSICAL_OUTCOMES.includes(outcome))
    throw new Error(`physicalOutcome inválido: ${outcome}`);
  const at = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(at.getTime())) throw new Error('occurredAt inválido');

  const ev = decision.evidence ?? {};
  return {
    p_tenant: tenantId,
    p_site: siteId,
    p_event_type: 'access_decision',
    p_occurred_at: at.toISOString(),
    p_decision: decision.decision,
    p_reason_code: decision.reasonCode,
    p_person: ev.personId ?? null,
    p_credential: ev.credentialId ?? null,
    p_access_point: ev.accessPointId ?? null,
    p_zone: ev.zoneId ?? null,
    p_policy: decision.policyId ?? ev.policyId ?? null,
    p_physical_outcome: outcome,
    p_source: source,
    p_correlation: input.correlationId ?? null,
    // Só campos explícitos (allowlist): nunca repassar o contexto cru nem credenciais.
    p_evidence: {
      scheduleId: ev.scheduleId ?? null,
      deviceTrusted: ev.deviceTrusted ?? null,
      antiPassback: ev.antiPassback ?? 'OFF',
      offline: ev.offline ?? false,
      evaluatedAt: ev.evaluatedAt ?? null,
      steps: Array.isArray(ev.steps) ? ev.steps.slice(0, 50) : [],
    },
    p_idempotency_key: input.idempotencyKey ?? null,
  };
}
