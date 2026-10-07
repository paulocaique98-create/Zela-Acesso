import { describe, expect, it } from 'vitest';
import { createMockHardware, HARDWARE_EVENT_TYPES } from './index.js';

const T0 = new Date('2026-10-07T10:00:00Z');
const mk = (extra = {}) => createMockHardware({ points: ['p1'], now: T0, env: 'test', ...extra });
const at = (ms) => new Date(T0.getTime() + ms);

describe('MockHardware', () => {
  it('recusa produção', () => {
    expect(() => createMockHardware({ points: ['p1'], env: 'production' })).toThrow(/produção/);
  });

  it('destrava e religa sozinho após a duração', async () => {
    const hw = mk();
    expect(await hw.unlock('p1', { durationMs: 3000 })).toEqual({ ok: true, code: 'OK' });
    expect(hw.getStatus('p1').locked).toBe(false);
    hw.tick(at(2999));
    expect(hw.getStatus('p1').locked).toBe(false);
    hw.tick(at(3000));
    expect(hw.getStatus('p1').locked).toBe(true);
  });

  it('valida argumentos e ponto', async () => {
    const hw = mk();
    expect((await hw.unlock('x')).code).toBe('UNKNOWN_POINT');
    for (const d of [0, -1, 1.5, 60_001, NaN])
      expect((await hw.unlock('p1', { durationMs: d })).code).toBe('INVALID_ARGUMENT');
    expect(hw.getStatus('p1').locked).toBe(true);
  });

  it('offline e timeout não destravam', async () => {
    const hw = mk();
    hw.setOnline('p1', false);
    expect((await hw.unlock('p1')).code).toBe('DEVICE_OFFLINE');
    hw.setOnline('p1', true);
    hw.faults.timeoutNext = 1;
    expect((await hw.unlock('p1')).code).toBe('TIMEOUT');
    expect(hw.getStatus('p1').locked).toBe(true);
    expect((await hw.unlock('p1')).ok).toBe(true);
  });

  it('eventos: aberta, fechada, forçada, mantida aberta, online/offline', async () => {
    const hw = mk({ holdOpenMs: 1000 });
    const seen = [];
    const off = hw.onEvent((e) => seen.push(e.type));
    hw.openDoor('p1'); // travada => forçada
    hw.closeDoor('p1');
    await hw.unlock('p1');
    hw.openDoor('p1');
    hw.tick(at(1000));
    hw.tick(at(2000)); // não repete held_open
    hw.closeDoor('p1');
    hw.setOnline('p1', false);
    hw.setOnline('p1', true);
    expect(seen).toEqual([
      'door.forced',
      'door.closed',
      'door.opened',
      'door.held_open',
      'door.closed',
      'device.offline',
      'device.online',
    ]);
    off();
    hw.openDoor('p1');
    expect(seen).toHaveLength(7);
    expect(seen.every((t) => HARDWARE_EVENT_TYPES.includes(t))).toBe(true);
  });

  it('leitura, grant/deny, heartbeat, clock_sync e duplicidade', () => {
    const hw = mk();
    const seen = [];
    hw.onEvent((e) => seen.push(e.type));
    expect(hw.presentCredential('p1', { valid: false })).toBe(true);
    hw.deny('p1');
    hw.faults.duplicateNext = 1;
    hw.grant('p1');
    hw.heartbeat('p1');
    hw.clockSync('p1', { driftS: 2 });
    expect(seen).toEqual([
      'access.requested',
      'access.denied',
      'access.granted',
      'access.granted',
      'heartbeat',
      'clock_sync',
    ]);
    hw.setOnline('p1', false);
    expect(hw.presentCredential('p1')).toBe(false);
  });
});
