import { beforeEach, describe, expect, it } from 'vitest';
import { createMockHardware } from '@zela/device-drivers';
import { handleAccessAttempt } from './access.js';
import { applySnapshot } from './snapshot.js';
import { openStore } from './store.js';
import { ANA_CARD, ANA_PIN, IDS, MONDAY_10H, MONDAY_20H, makeSnapshot } from './fixtures.js';

let store;
let driver;
let n;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const go = (credential, extra = {}) =>
  handleAccessAttempt({
    store,
    driver,
    accessPointId: IDS.point,
    credential,
    now: MONDAY_10H,
    offline: false,
    newId: ids,
    ...extra,
  });
const ana = { type: 'pin', personId: IDS.ana, pin: ANA_PIN };

beforeEach(() => {
  store = openStore();
  n = 0;
  store.setMeta('clock_drift_s', '0');
  store.setMeta('clock_checked_at', MONDAY_10H.toISOString());
  applySnapshot(store, { hash: 'h1', snapshot: makeSnapshot() }, MONDAY_10H);
  driver = createMockHardware({ points: [IDS.point], now: MONDAY_10H, env: 'test' });
});

describe('handleAccessAttempt (vertical slice)', () => {
  it('ALLOW: enfileira o evento e destrava a porta', async () => {
    const r = await go({ type: 'card', number: ANA_CARD });
    expect(r.decision.decision).toBe('ALLOW');
    expect(r.queued).toBe(true);
    expect(r.actuation).toEqual({ attempted: true, ok: true, code: 'OK' });
    expect(driver.getStatus(IDS.point).locked).toBe(false);
    expect(store.queueDepth()).toBe(1);
  });

  it('DENY (PIN errado, fora da janela): nunca aciona o driver, mas registra o evento', async () => {
    const wrong = await go({ type: 'pin', personId: IDS.ana, pin: '000000' });
    const late = await go(ana, { now: MONDAY_20H });
    for (const r of [wrong, late]) {
      expect(r.decision.decision).not.toBe('ALLOW');
      expect(r.actuation).toEqual({ attempted: false, ok: false, code: 'NOT_OPENED' });
    }
    expect(driver.getStatus(IDS.point).locked).toBe(true);
    expect(store.queueDepth()).toBe(2);
  });

  it('driver offline: decisão e evento preservados, falha reportada, porta trancada', async () => {
    driver.setOnline(IDS.point, false);
    const r = await go(ana);
    expect(r.decision.decision).toBe('ALLOW');
    expect(r.queued).toBe(true);
    expect(r.actuation).toEqual({ attempted: true, ok: false, code: 'DEVICE_OFFLINE' });
    expect(driver.getStatus(IDS.point).locked).toBe(true);
  });

  it('exceção do driver não derruba a tentativa', async () => {
    const boom = {
      ...driver,
      unlock: async () => {
        throw new Error('x');
      },
    };
    const r = await go(ana, { driver: boom });
    expect(r.actuation).toEqual({ attempted: true, ok: false, code: 'DRIVER_ERROR' });
    expect(r.queued).toBe(true);
  });

  it('religa após o tempo de destrava', async () => {
    await go(ana, { unlockMs: 2000 });
    driver.tick(new Date(MONDAY_10H.getTime() + 2000));
    expect(driver.getStatus(IDS.point).locked).toBe(true);
  });
});
