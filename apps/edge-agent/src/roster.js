// Sincronização de usuários e regras com terminais em modo Standalone (D-023/D-025).
// O terminal decide sozinho com o que tem cadastrado; aqui o Edge calcula, com o MESMO motor determinístico
// (`evaluateAccess`), quem a política do Zela libera AGORA em cada ponto e mantém só essas pessoas no terminal.
// Quem deixa de ser liberado (revogação, fora da janela, visita vencida) é removido na rodada seguinte.
// Não envia cartão, PIN nem biometria: a nuvem guarda só hash. O credencial é cadastrado no terminal para o id do usuário.

import { OPENING_DECISIONS, evaluateAccess } from '@zela/domain';
import { loadClockStatus } from './clock.js';
import { DEFAULT_CONFIG } from './decide.js';
import { loadCache } from './snapshot.js';

const META_KEY = 'device_users';
const FIRST_DEVICE_USER_ID = 100_000; // acima de ids que operadores costumam usar à mão

/** @returns {Record<string, number>} personId -> id do usuário no terminal */
function readMap(store) {
  try {
    const m = JSON.parse(store.getMeta(META_KEY) ?? '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

/** Pessoa dona do id de usuário do terminal (para a evidência dos eventos do dispositivo); null se desconhecido. */
export function personIdForDeviceUser(store, deviceUserId) {
  const n = Number(deviceUserId);
  if (!Number.isSafeInteger(n)) return null;
  for (const [personId, id] of Object.entries(readMap(store))) if (id === n) return personId;
  return null;
}

/** Atribui ids numéricos estáveis (nunca reaproveitados, mesmo depois de a pessoa sair). Persiste só se houver novos. */
export function allocateDeviceUserIds(store, personIds) {
  return store.tx(() => {
    const map = readMap(store);
    let next = Math.max(FIRST_DEVICE_USER_ID - 1, ...Object.values(map)) + 1;
    let changed = false;
    for (const pid of personIds)
      if (map[pid] === undefined) {
        map[pid] = next++;
        changed = true;
      }
    if (changed) store.setMeta(META_KEY, JSON.stringify(map));
    return map;
  });
}

/**
 * Pessoas que a política libera neste ponto no instante `now`. Usa o motor com uma credencial ativa sintética: o terminal
 * não tem como desafiar nem aplicar anti-passback, então só ALLOW/DEGRADED_ALLOW entram (CHALLENGE e o resto ficam de fora).
 * @returns {string[]}
 */
export function authorizedPeople(index, accessPointId, now) {
  const snap = index.snapshot;
  const point = index.points.get(accessPointId);
  if (!point) return [];
  const out = [];
  for (const person of snap.people) {
    const decision = evaluateAccess({
      now,
      timezone: snap.timezone,
      accessPoint: {
        id: point.id,
        zoneId: point.zoneId,
        status: point.status,
        emergencyBehavior: point.emergencyBehavior,
        offlineBehavior: point.offlineBehavior,
      },
      credential: { id: 'roster', personId: person.id, status: 'active', expiresAt: null },
      person: { id: person.id, status: person.status },
      groupIds: index.groupsByPerson.get(person.id) ?? [],
      policies: snap.policies,
      schedules: index.schedules,
      visit: (() => {
        const v = index.visitByPerson.get(person.id);
        return v
          ? {
              state: 'active',
              allowedZoneIds: v.zoneIds ?? [],
              validFrom: v.validFrom,
              validUntil: v.validUntil,
            }
          : null;
      })(),
      device: null,
      emergencyActive: false,
      offline: false,
    });
    if (OPENING_DECISIONS.includes(decision.decision)) out.push(person.id);
  }
  return out;
}

/**
 * Uma rodada de sincronização para os pontos dados. Sem cache (nunca sincronizado ou corrompido) NÃO mexe nos terminais:
 * apagar todos por falta de dados seria pior que manter o último estado. Nunca lança; devolve só contagens e códigos.
 * @param {{ store: ReturnType<import('./store.js').openStore>,
 *   driver: { syncRoster: (pointId: string, desired: Array<{ deviceUserId: number, name: string }>) => Promise<any> },
 *   pointIds: string[], now: Date }} input
 * @returns {Promise<{ status: 'no_cache' | 'done', points: Record<string, { ok: boolean, code: string, created?: number, removed?: number, conflicts?: number }> }>}
 */
export async function syncRosters({ store, driver, pointIds, now }) {
  const cache = loadCache(store);
  if (!cache) return { status: 'no_cache', points: {} };
  // Mesma cautela de decide.js: cache defasado ou relógio não confiável = a política pode estar velha ou a janela errada.
  // Ponto degraded_deny esvazia o roster; ponto degraded_allow congela o que já está no terminal (não adiciona nem remove).
  const degraded =
    now.getTime() - cache.fetchedAt.getTime() > DEFAULT_CONFIG.maxSnapshotAgeMs ||
    loadClockStatus(store, now).status === 'untrusted';
  const points = {};
  for (const pointId of pointIds) {
    try {
      const point = cache.index.points.get(pointId);
      if (!point) {
        points[pointId] = { ok: false, code: 'UNKNOWN_POINT' };
        continue;
      }
      if (degraded && point.offlineBehavior !== 'degraded_deny') {
        points[pointId] = { ok: true, code: 'FROZEN' };
        continue;
      }
      const people = degraded ? [] : authorizedPeople(cache.index, pointId, now);
      const ids = allocateDeviceUserIds(store, people);
      const r = await driver.syncRoster(
        pointId,
        people.map((pid) => ({ deviceUserId: ids[pid], name: `Zela ${ids[pid]}` })),
      );
      points[pointId] = {
        ok: r.ok,
        code: r.code,
        ...(r.ok
          ? { created: r.created, removed: r.removed, conflicts: r.conflicts?.length ?? 0 }
          : {}),
      };
    } catch {
      points[pointId] = { ok: false, code: 'ERROR' };
    }
  }
  return { status: 'done', points };
}
