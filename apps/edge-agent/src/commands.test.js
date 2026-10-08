import { describe, expect, it } from 'vitest';
import { createMockHardware } from '@zela/device-drivers';
import { handleCommand, signCommand, signCommandV2 } from './commands.js';
import { generateKeyPair, kidOf } from './keys.js';
import { openStore } from './store.js';

const KEY = 'chave-de-comando-do-agente-A';
const AGENT = 'agent-A';
const NOW = new Date('2026-10-07T10:00:00Z');
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();

const setup = () => {
  const store = openStore();
  const driver = createMockHardware({ points: ['p1'], now: NOW, env: 'test' });
  const base = {
    v: 1,
    id: 'cmd-0000000000000001',
    agent_id: AGENT,
    action: 'unlock',
    point_id: 'p1',
    duration_ms: 3000,
    issued_at: iso(-1000),
    expires_at: iso(9000),
  };
  const run = (command, extra = {}) =>
    handleCommand({ store, driver, key: KEY, agentId: AGENT, now: NOW, command, ...extra });
  return { store, driver, base, run, sign: (c, k = KEY) => signCommand(c, k) };
};

describe('handleCommand', () => {
  it('executa comando válido e destrava', async () => {
    const { run, sign, base, driver } = setup();
    expect(await run(sign(base))).toEqual({ status: 'executed', code: 'OK' });
    expect(driver.getStatus('p1').locked).toBe(false);
  });

  it('replay do mesmo id é rejeitado e não age de novo', async () => {
    const { run, sign, base, driver } = setup();
    const cmd = sign(base);
    await run(cmd);
    await driver.lock('p1');
    expect(await run(cmd)).toEqual({ status: 'rejected', code: 'REPLAY' });
    expect(driver.getStatus('p1').locked).toBe(true);
  });

  it('assinatura adulterada, chave errada e campo alterado são rejeitados', async () => {
    const { run, sign, base, driver } = setup();
    expect((await run(sign(base, 'outra-chave'))).code).toBe('BAD_SIGNATURE');
    expect((await run({ ...sign(base), point_id: 'p2' })).code).toBe('BAD_SIGNATURE');
    expect((await run({ ...sign(base), duration_ms: 60000 })).code).toBe('BAD_SIGNATURE');
    expect((await run({ ...sign(base), signature: 'zz' })).code).toBe('BAD_SIGNATURE');
    expect(driver.getStatus('p1').locked).toBe(true);
  });

  it('rotação: aceita assinatura da chave atual ou da anterior; rejeita chave fora da lista', async () => {
    const { run, sign, base } = setup();
    const keys = ['chave-nova', KEY];
    expect((await run(sign(base, 'chave-nova'), { key: keys })).status).toBe('executed');
    expect(
      (await run(sign({ ...base, id: 'cmd-0000000000000002' }, KEY), { key: keys })).status,
    ).toBe('executed');
    const r = await run(sign({ ...base, id: 'cmd-0000000000000003' }, 'chave-revogada'), {
      key: keys,
    });
    expect(r.code).toBe('BAD_SIGNATURE');
    expect((await run(sign({ ...base, id: 'cmd-0000000000000004' }), { key: [] })).code).toBe(
      'BAD_SIGNATURE',
    );
  });

  it('comando de outro agente é rejeitado', async () => {
    const { run, sign, base } = setup();
    expect((await run(sign({ ...base, agent_id: 'agent-B' }))).code).toBe('WRONG_AGENT');
  });

  it('expirado, futuro e janela longa demais', async () => {
    const { run, sign, base } = setup();
    expect(
      (await run(sign({ ...base, id: 'cmd-0000000000000002', expires_at: iso(0) }))).code,
    ).toBe('EXPIRED');
    expect(
      (
        await run(
          sign({
            ...base,
            id: 'cmd-0000000000000003',
            issued_at: iso(31_000),
            expires_at: iso(40_000),
          }),
        )
      ).code,
    ).toBe('NOT_YET_VALID');
    expect(
      (
        await run(
          sign({
            ...base,
            id: 'cmd-0000000000000004',
            issued_at: iso(-1000),
            expires_at: iso(70_000),
          }),
        )
      ).code,
    ).toBe('INVALID_WINDOW');
    expect(
      (await run(sign({ ...base, id: 'cmd-0000000000000005', expires_at: iso(-2000) }))).code,
    ).toBe('INVALID_WINDOW');
  });

  it('formato inválido', async () => {
    const { run, sign, base } = setup();
    for (const bad of [
      null,
      'x',
      {},
      { ...sign(base), v: 2 },
      { ...sign(base), id: 'curto' },
      { ...sign(base), action: 'open_all' },
    ])
      expect((await run(bad)).code).toBe('MALFORMED');
  });

  it('comando inválido não consome o id; falha do driver consome', async () => {
    const { run, sign, base, driver } = setup();
    await run({ ...sign(base, 'errada') });
    driver.setOnline('p1', false);
    expect(await run(sign(base))).toEqual({ status: 'failed', code: 'DEVICE_OFFLINE' });
    expect((await run(sign(base))).code).toBe('REPLAY');
  });

  it('duração inválida e ponto desconhecido chegam como falha do driver', async () => {
    const { run, sign, base } = setup();
    expect(await run(sign({ ...base, duration_ms: 999_999 }))).toEqual({
      status: 'failed',
      code: 'INVALID_ARGUMENT',
    });
    expect(await run(sign({ ...base, id: 'cmd-0000000000000009', point_id: 'zz' }))).toEqual({
      status: 'failed',
      code: 'UNKNOWN_POINT',
    });
  });

  it('lock religa; ids expirados são purgados', async () => {
    const { run, sign, base, driver, store } = setup();
    await run(sign(base));
    expect(
      await run(
        sign({ ...base, id: 'cmd-0000000000000006', action: 'lock', duration_ms: undefined }),
      ),
    ).toEqual({
      status: 'executed',
      code: 'OK',
    });
    expect(driver.getStatus('p1').locked).toBe(true);
    expect(store.purgeCommands(iso(10 * 60_000))).toBe(2);
  });
});

describe('handleCommand v2 (Ed25519 + kid, D-022)', () => {
  const A = generateKeyPair();
  const B = generateKeyPair();
  const pubs = { [kidOf(A.publicKey)]: A.publicKey };
  const body = {
    id: 'cmd-0000000000000101',
    agent_id: AGENT,
    action: 'unlock',
    point_id: 'p1',
    duration_ms: 3000,
    issued_at: iso(-1000),
    expires_at: iso(9000),
  };

  it('executa comando v2 assinado por chave confiável, sem nenhuma chave HMAC no agente', async () => {
    const { run, driver } = setup();
    const r = await run(signCommandV2(body, A.privateKey), { key: [], publicKeys: pubs });
    expect(r).toEqual({ status: 'executed', code: 'OK' });
    expect(driver.getStatus('p1').locked).toBe(false);
  });

  it('rejeita: chave fora do conjunto, kid trocado/malformado, campo alterado e v1 sem HMAC', async () => {
    const { run, driver } = setup();
    const opts = { key: [], publicKeys: pubs };
    expect((await run(signCommandV2(body, B.privateKey), opts)).code).toBe('BAD_SIGNATURE');
    const ok = signCommandV2(body, A.privateKey);
    expect((await run({ ...ok, kid: kidOf(B.publicKey) }, opts)).code).toBe('BAD_SIGNATURE');
    expect((await run({ ...ok, kid: 'z'.repeat(16) }, opts)).code).toBe('MALFORMED');
    expect((await run({ ...ok, point_id: 'p2' }, opts)).code).toBe('BAD_SIGNATURE');
    expect((await run({ ...ok, duration_ms: 60000 }, opts)).code).toBe('BAD_SIGNATURE');
    // v1 com HMAC válido, mas o agente só tem chaves públicas: recusa (sem downgrade)
    const v1 = signCommand({ v: 1, ...body }, KEY);
    expect((await run(v1, opts)).code).toBe('BAD_SIGNATURE');
    expect(driver.getStatus('p1').locked).toBe(true);
  });

  it('kid removido do conjunto deixa de valer; replay é rejeitado; v1 segue valendo se há HMAC', async () => {
    const { run } = setup();
    const cmd = signCommandV2(body, A.privateKey);
    expect((await run(cmd, { publicKeys: {} })).code).toBe('BAD_SIGNATURE');
    expect((await run(cmd, { publicKeys: pubs })).status).toBe('executed');
    expect((await run(cmd, { publicKeys: pubs })).code).toBe('REPLAY');
    const v1 = signCommand({ v: 1, ...body, id: 'cmd-0000000000000102' }, KEY);
    expect((await run(v1, { publicKeys: pubs })).status).toBe('executed');
  });
});
