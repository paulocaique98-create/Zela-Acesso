// Fase 8A (D-022): chave do dispositivo, enrollment e comandos v2 no edge-gateway (rpc simulado, sem Deno/rede).
// Inclui compatibilidade entre o assinador do gateway (WebCrypto) e o verificador do agente (node:crypto).
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalCommandV2, handleCommand } from '../../../apps/edge-agent/src/commands.js';
import {
  generateKeyPair,
  kidOf,
  requestMessage,
  sha256Hex,
  signMessage,
  verifyMessage,
} from '../../../apps/edge-agent/src/keys.js';
import { openStore } from '../../../apps/edge-agent/src/store.js';
import { handle } from '../../../supabase/functions/edge-gateway/handler.js';

const AGENT = '11111111-2222-3333-4444-555555555555';
const SECRET = `zes_${'a'.repeat(64)}`;
const NOW = 1_800_000_000_000;
const dev = generateKeyPair();

function signedReq(body, { key = dev.privateKey, ts = String(NOW), tamper = false } = {}) {
  const text = JSON.stringify(body);
  const sig = signMessage(requestMessage({ agentId: AGENT, ts, bodyHash: sha256Hex(text) }), key);
  return new Request('https://x.test/edge-gateway', {
    method: 'POST',
    headers: {
      'x-agent-id': AGENT,
      'x-agent-secret': SECRET,
      'x-agent-ts': ts,
      'x-agent-sig': sig,
    },
    body: tamper ? JSON.stringify({ ...body, extra: 1 }) : text,
  });
}
const plainReq = (body) =>
  new Request('https://x.test/edge-gateway', {
    method: 'POST',
    headers: { 'x-agent-id': AGENT, 'x-agent-secret': SECRET },
    body: JSON.stringify(body),
  });
const rpcOk = (data) => vi.fn(async () => ({ data, error: null }));
const deps = (over = {}) => ({
  rpc: rpcOk(true),
  deviceKey: async () => dev.publicKey,
  nowMs: () => NOW,
  ...over,
});

describe('prova de posse do dispositivo', () => {
  it('assinatura válida passa e chega à RPC', async () => {
    const d = deps();
    const res = await handle(signedReq({ op: 'confirm_biometric_erasure', profileId: AGENT }), d);
    expect(res.status).toBe(200);
    expect(d.rpc).toHaveBeenCalled();
  });

  it.each([
    ['sem assinatura (segredo roubado sozinho)', () => plainReq({ op: 'snapshot' })],
    [
      'assinada por outra chave',
      () => signedReq({ op: 'snapshot' }, { key: generateKeyPair().privateKey }),
    ],
    ['corpo adulterado em trânsito', () => signedReq({ op: 'snapshot' }, { tamper: true })],
    [
      'instante velho (replay tardio)',
      () => signedReq({ op: 'snapshot' }, { ts: String(NOW - 121_000) }),
    ],
    ['instante no futuro', () => signedReq({ op: 'snapshot' }, { ts: String(NOW + 121_000) })],
    ['instante malformado', () => signedReq({ op: 'snapshot' }, { ts: 'abc' })],
  ])('agente com chave registrada recusa: %s = 401 sem tocar o banco', async (_n, make) => {
    const d = deps();
    const res = await handle(make(), d);
    expect(res.status).toBe(401);
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it('assinatura de um agente não vale para outro id (amarrada ao agente)', async () => {
    const d = deps();
    const text = JSON.stringify({ op: 'snapshot' });
    const sig = signMessage(
      requestMessage({
        agentId: 'ffffffff-2222-3333-4444-555555555555',
        ts: String(NOW),
        bodyHash: sha256Hex(text),
      }),
      dev.privateKey,
    );
    const r = new Request('https://x.test/edge-gateway', {
      method: 'POST',
      headers: {
        'x-agent-id': AGENT,
        'x-agent-secret': SECRET,
        'x-agent-ts': String(NOW),
        'x-agent-sig': sig,
      },
      body: text,
    });
    expect((await handle(r, d)).status).toBe(401);
  });

  it('agente sem chave: passa por padrão (legado) e é recusado com allowLegacyAgents=false', async () => {
    const legacy = deps({ deviceKey: async () => null });
    expect((await handle(plainReq({ op: 'snapshot' }), legacy)).status).not.toBe(401);
    const strict = deps({ deviceKey: async () => null, allowLegacyAgents: false });
    expect((await handle(plainReq({ op: 'snapshot' }), strict)).status).toBe(401);
    expect(strict.rpc).not.toHaveBeenCalled();
  });

  it('falha ao consultar a chave = 502 (não cai para legado)', async () => {
    const d = deps({
      deviceKey: async () => {
        throw new Error('db');
      },
    });
    expect((await handle(plainReq({ op: 'snapshot' }), d)).status).toBe(502);
    expect(d.rpc).not.toHaveBeenCalled();
  });
});

describe('enroll', () => {
  const TOKEN = `zea_${'b'.repeat(64)}`;
  const enrollReq = (body, token = TOKEN) =>
    new Request('https://x.test/edge-gateway', {
      method: 'POST',
      headers: { 'x-enroll-token': token },
      body: JSON.stringify(body),
    });
  const row = { agent_id: AGENT, tenant_id: 't1', site_id: 's1', agent_secret: SECRET };

  it('troca o token pela credencial registrando a chave pública', async () => {
    const rpc = rpcOk([row]);
    const res = await handle(
      enrollReq({ op: 'enroll', devicePublicKey: dev.publicKey, hostname: 'h', version: '1' }),
      { rpc },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agentId: AGENT,
      tenantId: 't1',
      siteId: 's1',
      agentSecret: SECRET,
    });
    expect(rpc).toHaveBeenCalledWith('edge_enroll', {
      p_token: TOKEN,
      p_hostname: 'h',
      p_version: '1',
      p_device_key: dev.publicKey,
    });
  });

  it('token malformado = 401 sem banco; token inválido no banco (28000) = 401 genérico', async () => {
    const rpc = rpcOk([row]);
    expect((await handle(enrollReq({ op: 'enroll' }, 'zea_curto'), { rpc })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    const bad = vi.fn(async () => ({ data: null, error: { code: '28000' } }));
    const res = await handle(enrollReq({ op: 'enroll', devicePublicKey: dev.publicKey }), {
      rpc: bad,
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('enrollment');
  });

  it('chave pública malformada = 400; sem chave só com allowLegacyAgents', async () => {
    const rpc = rpcOk([row]);
    expect(
      (await handle(enrollReq({ op: 'enroll', devicePublicKey: 'xyz' }), { rpc })).status,
    ).toBe(400);
    expect(
      (await handle(enrollReq({ op: 'enroll' }), { rpc, allowLegacyAgents: false })).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await handle(enrollReq({ op: 'enroll' }), { rpc })).status).toBe(200);
  });

  it('rate limit do enroll = 429', async () => {
    const res = await handle(enrollReq({ op: 'enroll' }), {
      rpc: rpcOk([row]),
      allow: () => false,
    });
    expect(res.status).toBe(429);
  });
});

describe('comandos v2 e distribuição de chaves', () => {
  const pair = generateKeyPairSync('ed25519');
  const jwkObj = pair.privateKey.export({ format: 'jwk' });
  const JWK = JSON.stringify({ kty: jwkObj.kty, crv: jwkObj.crv, d: jwkObj.d, x: jwkObj.x });
  const pubHex = Buffer.from(jwkObj.x, 'base64url').toString('hex');
  const kid = kidOf(pubHex);
  const dbRow = {
    id: 'cmd-0000000000000abc',
    agentId: AGENT,
    action: 'unlock',
    pointId: 'p1',
    durationMs: 3000,
    issuedAt: new Date(NOW - 1000).toISOString(),
    expiresAt: new Date(NOW + 29_000).toISOString(),
  };
  const noDevice = { deviceKey: async () => null };

  it('assina v2 com kid e o AGENTE (node:crypto) verifica e executa', async () => {
    const rpc = vi.fn(async () => ({ data: [dbRow], error: null }));
    const res = await handle(plainReq({ op: 'poll_commands' }), {
      ...noDevice,
      rpc,
      commandSigningJwk: JWK,
    });
    const [cmd] = (await res.json()).commands;
    expect(cmd.v).toBe(2);
    expect(cmd.kid).toBe(kid);
    expect(verifyMessage(canonicalCommandV2(cmd), cmd.signature, pubHex)).toBe(true);
    // ponta a ponta com o executor do agente
    const driver = {
      unlock: vi.fn(async () => ({ ok: true, code: 'OK' })),
      lock: vi.fn(async () => ({ ok: true, code: 'OK' })),
    };
    const r = await handleCommand({
      store: openStore(),
      driver,
      agentId: AGENT,
      now: new Date(NOW),
      command: cmd,
      publicKeys: { [kid]: pubHex },
    });
    expect(r).toEqual({ status: 'executed', code: 'OK' });
  });

  it('prefere v2; sem chave de assinatura cai para v1; sem nenhuma, não reivindica nada', async () => {
    const MASTER = 'c'.repeat(64);
    const rpc = vi.fn(async () => ({ data: [dbRow], error: null }));
    const both = await handle(plainReq({ op: 'poll_commands' }), {
      ...noDevice,
      rpc,
      commandSigningJwk: JWK,
      commandMasterKey: MASTER,
    });
    expect((await both.json()).commands[0].v).toBe(2);
    const v1 = await handle(plainReq({ op: 'poll_commands' }), {
      ...noDevice,
      rpc,
      commandMasterKey: MASTER,
    });
    expect((await v1.json()).commands[0].v).toBe(1);
    const none = vi.fn(async () => ({ data: [dbRow], error: null }));
    const res = await handle(plainReq({ op: 'poll_commands' }), { ...noDevice, rpc: none });
    expect(await res.json()).toEqual({ commands: [] });
    expect(none).not.toHaveBeenCalled();
  });

  it('JWK inválido = falha fechada (sem v2 e sem reivindicar)', async () => {
    const rpc = vi.fn(async () => ({ data: [dbRow], error: null }));
    const res = await handle(plainReq({ op: 'poll_commands' }), {
      ...noDevice,
      rpc,
      commandSigningJwk: '{"kty":"x"}',
    });
    expect(await res.json()).toEqual({ commands: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('command_keys: só agente autenticado; devolve kid + pública (nunca a privada) e as declarações', async () => {
    const statements = JSON.stringify([
      { type: 'revoke', kid: 'a'.repeat(16), signedBy: kid, signature: 'x' },
    ]);
    const ok = await handle(plainReq({ op: 'command_keys' }), {
      ...noDevice,
      rpc: rpcOk([{ tenant_id: 't', site_id: 's' }]),
      commandSigningJwk: JWK,
      commandKeyStatements: statements,
    });
    const text = await ok.text();
    const body = JSON.parse(text);
    expect(body.keys).toEqual([{ kid, publicKey: pubHex }]);
    expect(body.statements).toHaveLength(1);
    expect(text).not.toContain(jwkObj.d);
    const denied = await handle(plainReq({ op: 'command_keys' }), {
      ...noDevice,
      rpc: rpcOk([]),
      commandSigningJwk: JWK,
    });
    expect(denied.status).toBe(401);
  });

  it('declarações malformadas viram lista vazia', async () => {
    const res = await handle(plainReq({ op: 'command_keys' }), {
      ...noDevice,
      rpc: rpcOk([{ tenant_id: 't', site_id: 's' }]),
      commandKeyStatements: 'não é json',
    });
    expect((await res.json()).statements).toEqual([]);
  });
});
