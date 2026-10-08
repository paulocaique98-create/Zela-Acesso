import { describe, expect, it } from 'vitest';
import { createControlIdDriver } from '@zela/device-drivers';
import { recordDeviceDecisions } from './device-events.js';
import { openStore } from './store.js';

const PREFIX = '/api/notifications/segredo';
const T0 = new Date('2026-10-08T10:00:00Z');
const AP = '40000000-0000-0000-0000-00000000000a';

function setup({ bound = true } = {}) {
  const store = openStore(':memory:');
  if (bound) store.setMeta('binding', 't-uuid/s-uuid');
  const driver = createControlIdDriver({
    points: {
      [AP]: {
        baseUrl: 'http://10.0.0.5',
        login: 'op',
        password: 'x',
        model: 'door',
        deviceId: 478435,
      },
    },
    env: 'test',
    now: () => T0,
    monitorPathPrefix: PREFIX,
  });
  let n = 0;
  const dropped = [];
  recordDeviceDecisions({
    store,
    driver,
    now: () => T0,
    newId: () => `id${++n}`,
    onDropped: (r) => dropped.push(r),
  });
  const log = (event, extra = {}) => ({
    device_id: 478435,
    object_changes: [
      {
        object: 'access_logs',
        type: 'inserted',
        values: {
          id: '519',
          time: '1532977090',
          event: String(event),
          portal_id: '1',
          user_id: '42',
          card_value: '528281023086',
          ...extra,
        },
      },
    ],
  });
  return { store, driver, dropped, log };
}

describe('recordDeviceDecisions', () => {
  it('enfileira concessão e negação do terminal como evidência do dispositivo', () => {
    const { store, driver, log } = setup();
    driver.handleNotification(`${PREFIX}/dao`, log(7));
    driver.handleNotification(`${PREFIX}/dao`, log(6, { id: '520' }));
    const due = store.dueEvents(T0.toISOString());
    expect(due).toHaveLength(2);
    const [a, d] = due.map((r) => r.payload);
    expect(a).toMatchObject({
      p_tenant: 't-uuid',
      p_site: 's-uuid',
      p_access_point: AP,
      p_decision: 'ALLOW',
      p_reason_code: 'DEVICE_LOCAL_ALLOW',
      p_idempotency_key: 'edge:dev:id1',
    });
    expect(a.p_evidence.device).toMatchObject({
      kind: 'controlid',
      event: '7',
      userId: '42',
      logId: '519',
    });
    expect([d.p_decision, d.p_reason_code]).toEqual(['DENY', 'DEVICE_LOCAL_DENY']);
  });

  it('nunca grava cartão do terminal', () => {
    const { store, driver, log } = setup();
    driver.handleNotification(`${PREFIX}/dao`, log(7));
    expect(JSON.stringify(store.dueEvents(T0.toISOString()))).not.toContain('528281023086');
  });

  it('ignora o que não é decisão e não enfileira sem vínculo', () => {
    const { store, driver, dropped, log } = setup();
    driver.handleNotification(`${PREFIX}/device_is_alive`, { device_id: 478435 });
    driver.handleNotification(`${PREFIX}/dao`, log(4));
    expect(store.dueEvents(T0.toISOString())).toHaveLength(0);
    const off = setup({ bound: false });
    off.driver.handleNotification(`${PREFIX}/dao`, off.log(7));
    expect(off.store.dueEvents(T0.toISOString())).toHaveLength(0);
    expect(off.dropped).toEqual(['NO_BINDING']);
    expect(dropped).toEqual([]);
  });
});
