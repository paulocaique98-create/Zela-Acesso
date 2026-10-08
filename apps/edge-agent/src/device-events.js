// Eventos do terminal (modo Standalone, D-023/D-024) -> fila persistente -> nuvem.
// O terminal decide sozinho; aqui só se registra a decisão dele como evidência do dispositivo (DEVICE_LOCAL_ALLOW/DENY).
// O motor NÃO reavalia e nada aqui abre porta. Sem vínculo tenant/site conhecido (snapshot nunca recebido) não enfileira.

import { randomUUID } from 'node:crypto';
import { toDeviceLocalDecisionParams, toDoorAlarmParams } from '@zela/domain';
import { personIdForDeviceUser } from './roster.js';

const DOOR_ALARMS = { 'door.forced': 'DOOR_FORCED', 'door.held_open': 'DOOR_HELD_OPEN' };

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openStore>,
 *   driver: { onEvent: (h: (e: any) => void) => () => void, kind: string },
 *   now?: () => Date, newId?: () => string,
 *   onDropped?: (reason: string) => void }} cfg
 * @returns {() => void} cancela a assinatura
 */
export function recordDeviceDecisions({
  store,
  driver,
  now = () => new Date(),
  newId = randomUUID,
  onDropped = () => {},
}) {
  return driver.onEvent((e) => {
    const alarm = DOOR_ALARMS[e.type];
    if (e.type !== 'access.granted' && e.type !== 'access.denied' && !alarm) return;
    const [tenantId, siteId] = (store.getMeta('binding') ?? '/').split('/');
    if (!tenantId || !siteId) return onDropped('NO_BINDING');
    try {
      const at = now();
      if (alarm) {
        // Arrombamento/porta mantida aberta vistos pelo sensor do terminal -> alerta na nuvem (physical_outcome).
        const p = toDoorAlarmParams({
          tenantId,
          siteId,
          occurredAt: at,
          kind: alarm,
          accessPointId: e.pointId,
          correlationId: newId(),
          idempotencyKey: `edge:door:${newId()}`,
        });
        store.enqueue(p.p_idempotency_key, p, at.toISOString());
        return;
      }
      const params = toDeviceLocalDecisionParams({
        tenantId,
        siteId,
        occurredAt: at,
        allowed: e.type === 'access.granted',
        accessPointId: e.pointId,
        // id do usuário no terminal -> pessoa (mapa gravado pela sincronização); usuário cadastrado à mão fica sem pessoa
        personId:
          e.data?.deviceUserId != null ? personIdForDeviceUser(store, e.data.deviceUserId) : null,
        idempotencyKey: `edge:dev:${newId()}`,
        device: {
          kind: driver.kind,
          event: e.data?.controlIdEvent,
          userId: e.data?.deviceUserId,
          logId: e.data?.deviceLogId,
          deviceTime: e.data?.deviceTime,
        },
      });
      store.enqueue(params.p_idempotency_key, params, at.toISOString());
    } catch {
      // evento malformado do terminal não pode derrubar o daemon nem vazar conteúdo
      onDropped('INVALID_EVENT');
    }
  });
}
