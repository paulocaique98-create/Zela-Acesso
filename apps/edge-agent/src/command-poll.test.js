import { describe, expect, it, vi } from 'vitest';
import { createMockHardware } from '@zela/device-drivers';
import { deriveCommandKey, handle } from '../../../supabase/functions/edge-gateway/handler.js';
import { pollAndRunCommands } from './command-poll.js';
import { openStore } from './store.js';

const AGENT = '11111111-2222-3333-4444-555555555555';
const SECRET = `zes_${'a'.repeat(64)}`;
const MASTER = 'cd'.repeat(32);
const POINT = 'd0000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-10-07T12:00:05Z');
const cid = (n) => `c0000000-0000-0000-0000-00000000000${n}`;

// Gateway real (handler) com RPC simulado; o agente fala com ele via transporte em memória.
function gatewayTransport(rpc) {
  const call = async (body) => {
    const res = await handle(
      new Request('https://x.test/g', {
        method: 'POST',
        headers: { 'x-agent-id': AGENT, 'x-agent-secret': SECRET },
        body: JSON.stringify(body),
      }),
      { rpc, commandMasterKey: MASTER },
    );
    return res.status === 401 ? null : res.json();
  };
  return {
    pollCommands: () => call({ op: 'poll_commands' }),
    reportCommandResult: (commandId, status, code) =>
      call({ op: 'report_command_result', commandId, status, code }),
  };
}
const claimed = (id) => ({
  id,
  agentId: AGENT,
  pointId: POINT,
  action: 'unlock',
  durationMs: 3000,
  issuedAt: '2026-10-07T12:00:00+00:00',
  expiresAt: '2026-10-07T12:00:30+00:00',
});
const fakeRpc = (rows) =>
  vi.fn(async (name) => ({ data: name === 'edge_claim_commands' ? rows : true, error: null }));

const setup = async (rows) => {
  const store = openStore();
  const driver = createMockHardware({ points: [POINT], now: NOW, env: 'test' });
  const key = await deriveCommandKey(MASTER, AGENT);
  const rpc = fakeRpc(rows);
  const run = (extra = {}) =>
    pollAndRunCommands({
      store,
      transport: gatewayTransport(rpc),
      driver,
      key,
      agentId: AGENT,
      now: NOW,
      ...extra,
    });
  return { store, driver, rpc, run };
};

describe('pollAndRunCommands (gateway real + verificador do agente)', () => {
  it('comando assinado pelo gateway é aceito, destrava e reporta o resultado', async () => {
    const { run, driver, rpc } = await setup([claimed(cid(1))]);
    const r = await run();
    expect(r.results).toEqual([{ id: cid(1), status: 'executed', code: 'OK', reported: true }]);
    expect(driver.getStatus(POINT).locked).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      'edge_report_command_result',
      expect.objectContaining({ p_status: 'executed', p_code: 'OK' }),
    );
  });

  it('chave de outro agente rejeita (BAD_SIGNATURE) e não destrava', async () => {
    const { run, driver } = await setup([claimed(cid(2))]);
    const r = await run({ key: await deriveCommandKey(MASTER, 'outro-agente') });
    expect(r.results[0]).toMatchObject({ status: 'rejected', code: 'BAD_SIGNATURE' });
    expect(driver.getStatus(POINT).locked).toBe(true);
  });

  it('replay do mesmo id é rejeitado', async () => {
    const { run } = await setup([claimed(cid(3))]);
    await run();
    const r = await run();
    expect(r.results[0]).toMatchObject({ status: 'rejected', code: 'REPLAY' });
  });

  it('comando expirado é rejeitado', async () => {
    const { run, driver } = await setup([claimed(cid(4))]);
    const r = await run({ now: new Date('2026-10-07T12:01:00Z') });
    expect(r.results[0]).toMatchObject({ status: 'rejected', code: 'EXPIRED' });
    expect(driver.getStatus(POINT).locked).toBe(true);
  });

  it('rede caída = offline; 401 = revoked e apaga o cache', async () => {
    const { run, store } = await setup([]);
    const wipe = vi.spyOn(store, 'wipeCache');
    const down = {
      pollCommands: async () => {
        throw new Error('rede');
      },
    };
    expect((await run({ transport: down })).status).toBe('offline');
    expect((await run({ transport: { pollCommands: async () => null } })).status).toBe('revoked');
    expect(wipe).toHaveBeenCalled();
  });

  it('falha ao reportar não desfaz a execução', async () => {
    const { run, driver } = await setup([claimed(cid(5))]);
    const transport = {
      pollCommands: gatewayTransport(fakeRpc([claimed(cid(5))])).pollCommands,
      reportCommandResult: async () => {
        throw new Error('rede');
      },
    };
    const r = await run({ transport });
    expect(r.results[0]).toMatchObject({ status: 'executed', reported: false });
    expect(driver.getStatus(POINT).locked).toBe(false);
  });
});
