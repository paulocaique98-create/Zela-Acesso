import { describe, expect, it } from 'vitest';
import { generateKeyPair, kidOf, signMessage, statementMessage } from './keys.js';
import { openStore } from './store.js';
import { KEY_REFRESH_MS, createKeyring, loadTrustedKeys, syncCommandKeys } from './trust.js';

const A = generateKeyPair();
const B = generateKeyPair();
const kidA = kidOf(A.publicKey);
const kidB = kidOf(B.publicKey);
const endorseBody = { type: 'endorse', kid: kidB, publicKey: B.publicKey };
const endorse = {
  ...endorseBody,
  signedBy: kidA,
  signature: signMessage(statementMessage(endorseBody), A.privateKey),
};
const revokeBody = { type: 'revoke', kid: kidA };
const revokeA = {
  ...revokeBody,
  signedBy: kidB,
  signature: signMessage(statementMessage(revokeBody), B.privateKey),
};
const tr = (res) => ({
  commandKeys: async () => (res instanceof Error ? Promise.reject(res) : res),
});

describe('syncCommandKeys', () => {
  it('sem âncora e sem TOFU: não confia em nada, mesmo com a lista do gateway', async () => {
    const store = openStore();
    const r = await syncCommandKeys({
      store,
      transport: tr({ keys: [{ kid: kidA, publicKey: A.publicKey }], statements: [] }),
    });
    expect(r.trusted).toEqual({});
  });

  it('TOFU aceita a primeira lista (só kid coerente) e persiste', async () => {
    const store = openStore();
    await syncCommandKeys({
      store,
      tofu: true,
      transport: tr({
        keys: [
          { kid: kidA, publicKey: A.publicKey },
          { kid: 'f'.repeat(16), publicKey: B.publicKey },
        ],
        statements: [],
      }),
    });
    expect(loadTrustedKeys(store)).toEqual({ [kidA]: A.publicKey });
  });

  it('TOFU não vale depois que já há conjunto (gateway não troca a chave sozinho)', async () => {
    const store = openStore();
    const seed = { [kidA]: A.publicKey };
    const r = await syncCommandKeys({
      store,
      seed,
      tofu: true,
      transport: tr({ keys: [{ kid: kidB, publicKey: B.publicKey }], statements: [] }),
    });
    expect(r.trusted).toEqual(seed);
  });

  it('rotação: endorse da âncora instala B; revoke de A por B remove A e persiste', async () => {
    const store = openStore();
    const seed = { [kidA]: A.publicKey };
    await syncCommandKeys({ store, seed, transport: tr({ keys: [], statements: [endorse] }) });
    expect(loadTrustedKeys(store, seed)).toEqual({ [kidA]: A.publicKey, [kidB]: B.publicKey });
    await syncCommandKeys({
      store,
      seed,
      transport: tr({ keys: [], statements: [endorse, revokeA] }),
    });
    // a âncora A continua em EDGE_COMMAND_PUBKEYS, mas a revogação assinada por B persiste
    expect(loadTrustedKeys(store, seed)).toEqual({ [kidB]: B.publicKey });
  });

  it('offline e 401 não alteram o conjunto', async () => {
    const store = openStore();
    const seed = { [kidA]: A.publicKey };
    const off = await syncCommandKeys({ store, seed, transport: tr(new Error('rede')) });
    expect(off.status).toBe('offline');
    const r = await syncCommandKeys({ store, seed, transport: tr(null) });
    expect(r.status).toBe('revoked');
    expect(r.trusted).toEqual(seed);
  });
});

describe('createKeyring', () => {
  it('consulta o gateway na 1ª vez, não repete antes de 10 min e limita o force a 1/min', async () => {
    const store = openStore();
    let calls = 0;
    const ring = createKeyring({
      store,
      seed: { [kidA]: A.publicKey },
      transport: {
        commandKeys: async () => {
          calls++;
          return { keys: [], statements: [] };
        },
      },
    });
    const t0 = new Date('2026-10-08T10:00:00Z');
    await ring.get(t0);
    await ring.get(new Date(t0.getTime() + 5_000));
    expect(calls).toBe(1);
    await ring.get(new Date(t0.getTime() + 10_000), { force: true });
    expect(calls).toBe(1);
    await ring.get(new Date(t0.getTime() + 61_000), { force: true });
    expect(calls).toBe(2);
    await ring.get(new Date(t0.getTime() + 61_000 + KEY_REFRESH_MS));
    expect(calls).toBe(3);
  });
});
