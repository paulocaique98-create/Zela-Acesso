// Cache de política/credenciais (Fase 4B): validação, aplicação atômica e índices em memória.
// O snapshot vem da nuvem (função `edge_pull_snapshot` via Edge Function — 4C) e substitui o cache inteiro.

const ARRAYS = [
  'zones',
  'accessPoints',
  'policies',
  'schedules',
  'groupMembers',
  'people',
  'credentials',
];

export class SnapshotError extends Error {}

/** Valida o formato do snapshot; qualquer desvio rejeita (o cache anterior permanece). */
export function validateSnapshot(s) {
  const fail = (m) => {
    throw new SnapshotError(`snapshot inválido: ${m}`);
  };
  if (!s || typeof s !== 'object') fail('não é objeto');
  if (s.version !== 1) fail(`versão ${String(s.version)} não suportada`);
  for (const k of ['tenantId', 'siteId', 'timezone'])
    if (typeof s[k] !== 'string' || !s[k]) fail(`${k} ausente`);
  for (const k of ARRAYS) if (!Array.isArray(s[k])) fail(`${k} ausente`);
  if (s.visits !== undefined && !Array.isArray(s.visits)) fail('visits malformado'); // ausente = snapshot antigo
  if (s.biometric !== undefined) {
    const b = s.biometric;
    if (
      !b ||
      typeof b !== 'object' ||
      !Array.isArray(b.profiles) ||
      !Array.isArray(b.pendingErasure)
    )
      fail('biometric malformado'); // ausente = snapshot antigo (biometria fica recusada)
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s.timezone });
  } catch {
    fail('fuso inválido');
  }
  const zoneIds = new Set(s.zones.map((z) => z.id));
  for (const ap of s.accessPoints)
    if (!ap.id || !zoneIds.has(ap.zoneId)) fail('ponto sem zona do sítio');
  for (const c of s.credentials) {
    if (!c.id || !c.personId || !['pin', 'card', 'mobile_token', 'biometric'].includes(c.type))
      fail('credencial malformada');
    if (c.type === 'pin' && !c.secretHash) fail('PIN sem hash');
  }
  return s;
}

/**
 * Aplica um snapshot de forma atômica. O agente é preso ao primeiro tenant/site que recebe: snapshot de outro
 * vínculo é rejeitado (defesa contra resposta trocada/erro de configuração).
 */
export function applySnapshot(store, { hash, snapshot }, now) {
  validateSnapshot(snapshot);
  store.tx(() => {
    const bound = store.getMeta('binding');
    const binding = `${snapshot.tenantId}/${snapshot.siteId}`;
    if (bound && bound !== binding)
      throw new SnapshotError('snapshot de outro tenant/site rejeitado');
    if (!bound) store.setMeta('binding', binding);
    store.saveSnapshot({ hash, fetchedAt: now.toISOString(), body: JSON.stringify(snapshot) });
  });
}

/** Índices para consulta O(1) na decisão. */
export function buildIndex(snapshot) {
  const pickBy = (type, key) => {
    const m = new Map();
    for (const c of snapshot.credentials) if (c.type === type && c[key]) m.set(c[key], c);
    return m;
  };
  const groupsByPerson = new Map();
  for (const m of snapshot.groupMembers) {
    if (!groupsByPerson.has(m.personId)) groupsByPerson.set(m.personId, []);
    groupsByPerson.get(m.personId).push(m.groupId);
  }
  const pinByPerson = new Map();
  for (const c of snapshot.credentials) if (c.type === 'pin') pinByPerson.set(c.personId, c);
  // Biometria: só o perfil ATIVO e a credencial a que ele pertence; sem `biometric` no snapshot nada é aceito.
  const bio = snapshot.biometric ?? null;
  const biometricProfileByPerson = new Map(
    (bio?.profiles ?? []).filter((p) => p.status === 'active').map((p) => [p.personId, p]),
  );
  const biometricCredentialById = new Map(
    snapshot.credentials.filter((c) => c.type === 'biometric').map((c) => [c.id, c]),
  );
  const peopleByRef = new Map(
    snapshot.people.filter((p) => p.refHash).map((p) => [p.refHash, p.id]),
  );
  const readers = new Map((snapshot.readers ?? []).map((r) => [r.id, r]));
  const readersByCodeHash = new Map(
    (snapshot.readers ?? [])
      .filter((r) => r.status === 'pending' && r.enrollmentTokenHash)
      .map((r) => [r.enrollmentTokenHash, r]),
  );
  const visitByPerson = new Map((snapshot.visits ?? []).map((v) => [v.personId, v]));
  return {
    snapshot,
    visitByPerson,
    peopleByRef,
    readers,
    readersByCodeHash,
    biometricSettings: bio?.settings ?? null,
    biometricProfileByPerson,
    biometricCredentialById,
    biometricPendingErasure: bio?.pendingErasure ?? [],
    zones: new Map(snapshot.zones.map((z) => [z.id, z])),
    points: new Map(snapshot.accessPoints.map((p) => [p.id, p])),
    people: new Map(snapshot.people.map((p) => [p.id, p])),
    groupsByPerson,
    pinByPerson,
    cardByHash: pickBy('card', 'identifierHash'),
    tokenByHash: pickBy('mobile_token', 'secretHash'),
    schedules: Object.fromEntries(
      snapshot.schedules.map((s) => [
        s.id,
        {
          schedule: {
            windows: s.windows.map((w) => ({ weekday: w.weekday, start: w.start, end: w.end })),
            validFrom: s.validFrom,
            validUntil: s.validUntil,
            holidayBehavior: s.holidayBehavior,
          },
          holidayDates: s.holidayDates,
        },
      ]),
    ),
  };
}

/** Carrega o cache; null se vazio ou corrompido (falha fechada: decisões saem como CONTEXT_INVALID). */
export function loadCache(store) {
  const row = store.loadSnapshotRow();
  if (!row) return null;
  try {
    const snapshot = validateSnapshot(JSON.parse(row.body));
    return { hash: row.hash, fetchedAt: new Date(row.fetchedAt), index: buildIndex(snapshot) };
  } catch {
    return null;
  }
}
