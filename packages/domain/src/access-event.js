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

/**
 * Alarme de porta detectado pelo Edge/terminal (sensor): `physical_outcome` DOOR_FORCED ou DOOR_HELD_OPEN, que na nuvem abre o
 * alerta (`door_forced` crítico / `door_held_open`). Não há decisão de acesso por trás, então a correlação é nova (a RPC exige uma).
 * @param {{ tenantId: string, siteId: string, occurredAt: Date | string, kind: 'DOOR_FORCED' | 'DOOR_HELD_OPEN',
 *   accessPointId: string, correlationId: string, idempotencyKey: string, source?: 'EDGE_AGENT' | 'DEVICE' }} input
 */
export function toDoorAlarmParams(input) {
  const { tenantId, siteId, occurredAt, kind } = input;
  if (!tenantId || !siteId) throw new Error('tenantId e siteId são obrigatórios');
  if (kind !== 'DOOR_FORCED' && kind !== 'DOOR_HELD_OPEN')
    throw new Error(`kind inválido: ${kind}`);
  if (!input.accessPointId) throw new Error('accessPointId é obrigatório (o alerta é por ponto)');
  if (!input.correlationId || !input.idempotencyKey)
    throw new Error('correlationId e idempotencyKey são obrigatórios');
  const at = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(at.getTime())) throw new Error('occurredAt inválido');
  return {
    p_tenant: tenantId,
    p_site: siteId,
    p_event_type: 'physical_outcome',
    p_occurred_at: at.toISOString(),
    p_decision: null,
    p_reason_code: null,
    p_person: null,
    p_credential: null,
    p_access_point: input.accessPointId,
    p_zone: null,
    p_policy: null,
    p_physical_outcome: kind,
    p_source: input.source ?? 'EDGE_AGENT',
    p_correlation: input.correlationId,
    p_evidence: { doorAlarm: { kind } },
    p_idempotency_key: input.idempotencyKey,
  };
}

const DEVICE_EVENT_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Decisão tomada pelo PRÓPRIO terminal (modo Standalone, D-023/D-024): o motor `evaluateAccess` não a reavaliou, então a
 * decisão é registrada como evidência do dispositivo (`DEVICE_LOCAL_ALLOW`/`DEVICE_LOCAL_DENY`) e nunca como `POLICY_MATCH`.
 * Evidência por allowlist: identificador numérico do usuário NO terminal e do log, nunca cartão, PIN nem gabarito.
 * @param {{
 *   tenantId: string, siteId: string, occurredAt: Date | string, allowed: boolean,
 *   accessPointId?: string | null, personId?: string | null, idempotencyKey: string,
 *   device: { kind: string, event?: string | number | null, userId?: string | number | null, logId?: string | number | null, deviceTime?: number | null },
 * }} input
 * @returns {Record<string, unknown>} argumentos nomeados da RPC `record_access_event`
 */
export function toDeviceLocalDecisionParams(input) {
  const { tenantId, siteId, occurredAt, device } = input;
  if (!tenantId || !siteId) throw new Error('tenantId e siteId são obrigatórios');
  if (typeof input.allowed !== 'boolean') throw new Error('allowed deve ser booleano');
  if (!input.idempotencyKey) throw new Error('idempotencyKey é obrigatória');
  if (!device || !DEVICE_EVENT_RE.test(String(device.kind)))
    throw new Error('device.kind inválido');
  const at = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(at.getTime())) throw new Error('occurredAt inválido');
  const clean = (v) => (v == null || !DEVICE_EVENT_RE.test(String(v)) ? null : String(v));
  const deviceTime = Number.isFinite(device.deviceTime) ? device.deviceTime : null;
  return {
    p_tenant: tenantId,
    p_site: siteId,
    p_event_type: 'access_decision',
    p_occurred_at: at.toISOString(),
    p_decision: input.allowed ? 'ALLOW' : 'DENY',
    p_reason_code: input.allowed ? 'DEVICE_LOCAL_ALLOW' : 'DEVICE_LOCAL_DENY',
    p_person: input.personId ?? null,
    p_credential: null,
    p_access_point: input.accessPointId ?? null,
    p_zone: null,
    p_policy: null,
    p_physical_outcome: null,
    p_source: 'EDGE_AGENT',
    p_correlation: null,
    p_evidence: {
      deviceLocal: true,
      device: {
        kind: String(device.kind),
        event: clean(device.event),
        userId: clean(device.userId),
        logId: clean(device.logId),
        deviceTime,
      },
      steps: [],
    },
    p_idempotency_key: input.idempotencyKey,
  };
}
