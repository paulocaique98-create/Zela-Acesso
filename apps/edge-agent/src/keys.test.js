import { describe, expect, it } from 'vitest';
import {
  applyKeyStatements,
  generateKeyPair,
  kidOf,
  parsePublicKeys,
  publicKeyOf,
  requestMessage,
  sha256Hex,
  signMessage,
  statementMessage,
  verifyMessage,
} from './keys.js';

describe('keys (Ed25519)', () => {
  it('gera par, deriva a pública e verifica assinatura; adulteração e chave errada falham', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(publicKeyOf(a.privateKey)).toBe(a.publicKey);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    const sig = signMessage('olá', a.privateKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyMessage('olá', sig, a.publicKey)).toBe(true);
    expect(verifyMessage('olá!', sig, a.publicKey)).toBe(false);
    expect(verifyMessage('olá', sig, b.publicKey)).toBe(false);
  });

  it('verifyMessage nunca lança com entrada malformada', () => {
    const a = generateKeyPair();
    for (const bad of [undefined, null, '', 'zz', 'a'.repeat(128), 42])
      expect(verifyMessage('x', /** @type {any} */ (bad), a.publicKey)).toBe(false);
    expect(verifyMessage('x', signMessage('x', a.privateKey), 'curta')).toBe(false);
  });

  it('mensagem de requisição amarra agente, instante e corpo', () => {
    const k = generateKeyPair();
    const m = requestMessage({ agentId: 'ABC', ts: '1', bodyHash: sha256Hex('{}') });
    const sig = signMessage(m, k.privateKey);
    expect(verifyMessage(m, sig, k.publicKey)).toBe(true);
    const outroTs = requestMessage({ agentId: 'abc', ts: '2', bodyHash: sha256Hex('{}') });
    const outroCorpo = requestMessage({ agentId: 'abc', ts: '1', bodyHash: sha256Hex('{"a":1}') });
    expect(verifyMessage(outroTs, sig, k.publicKey)).toBe(false);
    expect(verifyMessage(outroCorpo, sig, k.publicKey)).toBe(false);
  });

  it('parsePublicKeys exige kid coerente com a chave', () => {
    const k = generateKeyPair();
    const kid = kidOf(k.publicKey);
    expect(parsePublicKeys(`${kid}:${k.publicKey}`)).toEqual({ [kid]: k.publicKey });
    expect(parsePublicKeys('')).toEqual({});
    expect(() => parsePublicKeys(`${'0'.repeat(16)}:${k.publicKey}`)).toThrow(
      'EDGE_COMMAND_PUBKEYS',
    );
    expect(() => parsePublicKeys('lixo')).toThrow('EDGE_COMMAND_PUBKEYS');
  });
});

describe('declarações de chave (endorse/revoke)', () => {
  const A = generateKeyPair();
  const B = generateKeyPair();
  const kidA = kidOf(A.publicKey);
  const kidB = kidOf(B.publicKey);
  const stmt = (s, signer) => ({
    ...s,
    signedBy: kidOf(publicKeyOf(signer)),
    signature: signMessage(statementMessage(s), signer),
  });
  const endorseB = { type: 'endorse', kid: kidB, publicKey: B.publicKey };

  it('chave confiável endossa a nova; nova passa a valer', () => {
    const { trusted, changed } = applyKeyStatements({ [kidA]: A.publicKey }, [
      stmt(endorseB, A.privateKey),
    ]);
    expect(changed).toBe(true);
    expect(trusted).toEqual({ [kidA]: A.publicKey, [kidB]: B.publicKey });
  });

  it('declaração de quem NÃO é confiável é ignorada (atacante no canal não instala chave)', () => {
    const evil = generateKeyPair();
    const s = stmt(
      { type: 'endorse', kid: kidOf(evil.publicKey), publicKey: evil.publicKey },
      evil.privateKey,
    );
    const { trusted, changed } = applyKeyStatements({ [kidA]: A.publicKey }, [s]);
    expect(changed).toBe(false);
    expect(trusted).toEqual({ [kidA]: A.publicKey });
  });

  it('endorse com kid que não confere com a chave é ignorado', () => {
    const wrongKid = kidB.startsWith('0') ? `1${kidB.slice(1)}` : `0${kidB.slice(1)}`;
    const s = stmt({ type: 'endorse', kid: wrongKid, publicKey: B.publicKey }, A.privateKey);
    expect(applyKeyStatements({ [kidA]: A.publicKey }, [s]).changed).toBe(false);
  });

  it('revoke por outra chave remove; chave não revoga a si mesma; assinatura adulterada é ignorada', () => {
    const base = { [kidA]: A.publicKey, [kidB]: B.publicKey };
    const rev = applyKeyStatements(base, [stmt({ type: 'revoke', kid: kidA }, B.privateKey)]);
    expect(rev.trusted).toEqual({ [kidB]: B.publicKey });
    const self = applyKeyStatements(base, [stmt({ type: 'revoke', kid: kidA }, A.privateKey)]);
    expect(self.changed).toBe(false);
    const forged = { ...stmt({ type: 'revoke', kid: kidA }, B.privateKey), kid: kidB };
    expect(applyKeyStatements(base, [forged]).changed).toBe(false);
  });

  it('lixo não lança', () => {
    expect(() =>
      applyKeyStatements({}, /** @type {any} */ ([null, 1, {}, { type: 'x' }])),
    ).not.toThrow();
    expect(() => applyKeyStatements({}, /** @type {any} */ ('x'))).not.toThrow();
  });
});
