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

const ACTUATION_CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * Resultado físico da atuação (Fase 4): evento `physical_outcome` ligado à decisão pela correlação. Append-only:
 * a decisão original não muda. Só o código de resultado do driver entra na evidência (allowlist; nunca credencial).
 * `ok` => DOOR_OPENED; TIMEOUT => UNKNOWN (não se sabe o estado da porta); qualquer outra falha => DOOR_NOT_OPENED.
 * @param {{
 *   tenantId: string, siteId: string, occurredAt: Date | string, correlationId: string,
 *   actuation: { ok: boolean, code: string },
 *   accessPointId?: string | null, zoneId?: string | null, personId?: string | null,
 *   source?: 'EDGE_AGENT' | 'DEVICE', idempotencyKey?: string | null,
 * }} input
 * @returns {Record<string, unknown>} argumentos nomeados da RPC `record_access_event`
 */
export function toPhysicalOutcomeParams(input) {
  const { tenantId, siteId, occurredAt, correlationId, actuation } = input;
  if (!tenantId || !siteId) throw new Error('tenantId e siteId são obrigatórios');
  if (!correlationId) throw new Error('correlationId é obrigatório (liga o resultado à decisão)');
  if (typeof actuation?.ok !== 'boolean') throw new Error('actuation inválida');
  const source = input.source ?? 'EDGE_AGENT';
  if (!['EDGE_AGENT', 'DEVICE'].includes(source)) throw new Error(`source inválida: ${source}`);
  const at = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(at.getTime())) throw new Error('occurredAt inválido');
  const code = ACTUATION_CODE_RE.test(String(actuation.code)) ? String(actuation.code) : 'UNKNOWN';
  const physicalOutcome = actuation.ok
    ? 'DOOR_OPENED'
    : code === 'TIMEOUT'
      ? 'UNKNOWN'
      : 'DOOR_NOT_OPENED';
  return {
    p_tenant: tenantId,
    p_site: siteId,
    p_event_type: 'physical_outcome',
    p_occurred_at: at.toISOString(),
    p_decision: null,
    p_reason_code: null,
    p_person: input.personId ?? null,
    p_credential: null,
    p_access_point: input.accessPointId ?? null,
    p_zone: input.zoneId ?? null,
    p_policy: null,
    p_physical_outcome: physicalOutcome,
    p_source: source,
    p_correlation: correlationId,
    p_evidence: { actuation: { ok: actuation.ok, code } },
    p_idempotency_key: input.idempotencyKey ?? null,
  };
}
