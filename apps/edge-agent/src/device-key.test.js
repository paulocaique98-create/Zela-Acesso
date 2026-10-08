// Fase 8A (D-022): transporte assinado pela chave do dispositivo e enrollment.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEnroll } from './enroll.js';
import {
  generateKeyPair,
  publicKeyOf,
  requestMessage,
  sha256Hex,
  signMessage,
  verifyMessage,
} from './keys.js';
import { createHttpTransport, enrollAgent } from './transport.js';

const TOKEN = `zea_${'a'.repeat(64)}`;
const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200 });

describe('transporte com chave do dispositivo', () => {
  it('assina cada requisição (agente, instante, hash do corpo) e a assinatura confere', async () => {
    const k = generateKeyPair();
    let seen;
    const fetchImpl = async (_u, init) => {
      seen = init;
      return okJson({});
    };
    const t = createHttpTransport({
      baseUrl: 'https://x.test/f',
      agentId: 'AAAA',
      secret: 's',
      deviceKey: k.privateKey,
      fetchImpl,
      nowMs: () => 1_700_000_000_000,
    });
    await t.pollCommands();
    expect(seen.headers['x-agent-ts']).toBe('1700000000000');
    const msg = requestMessage({
      agentId: 'AAAA',
      ts: '1700000000000',
      bodyHash: sha256Hex(seen.body),
    });
    expect(verifyMessage(msg, seen.headers['x-agent-sig'], k.publicKey)).toBe(true);
    const other = requestMessage({
      agentId: 'AAAA',
      ts: '1700000000000',
      bodyHash: sha256Hex('{"op":"x"}'),
    });
    expect(verifyMessage(other, seen.headers['x-agent-sig'], k.publicKey)).toBe(false);
  });

  it('sem deviceKey não envia assinatura (agente legado)', async () => {
    let seen;
    const fetchImpl = async (_u, init) => {
      seen = init;
      return okJson({});
    };
    const t = createHttpTransport({
      baseUrl: 'https://x.test/f',
      agentId: 'a',
      secret: 's',
      fetchImpl,
    });
    await t.pollCommands();
    expect(seen.headers['x-agent-sig']).toBeUndefined();
  });
});

describe('enrollAgent', () => {
  const args = { token: 'zea_t', devicePublicKey: 'p', hostname: 'h', version: '1' };
  it('usa só o token (sem segredo de agente) e recusa http fora de loopback e resposta de erro', async () => {
    let seen;
    const fetchImpl = async (_u, init) => {
      seen = init;
      return okJson({ agentId: 'i', tenantId: 't', siteId: 's', agentSecret: 'zes_x' });
    };
    const r = await enrollAgent({ baseUrl: 'https://x.test/f', ...args, fetchImpl });
    expect(r.agentSecret).toBe('zes_x');
    expect(seen.headers['x-enroll-token']).toBe('zea_t');
    expect(seen.headers['x-agent-secret']).toBeUndefined();
    await expect(enrollAgent({ baseUrl: 'http://x.test/f', ...args, fetchImpl })).rejects.toThrow(
      'https',
    );
    const denied = async () => new Response('{}', { status: 401 });
    await expect(
      enrollAgent({ baseUrl: 'https://x.test/f', ...args, fetchImpl: denied }),
    ).rejects.toThrow('recusado');
  });
});

describe('runEnroll', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zela-enroll-'));
  const baseEnv = { EDGE_GATEWAY_URL: 'https://x.test/f', EDGE_ENV_OUT: join(dir, 'edge.env') };

  it('registra a PÚBLICA, grava a privada em arquivo novo (0600) e não sobrescreve', async () => {
    let sentPub;
    const fetchImpl = async (_u, init) => {
      sentPub = JSON.parse(init.body).devicePublicKey;
      return okJson({ agentId: 'ag', tenantId: 't', siteId: 's', agentSecret: 'zes_seg' });
    };
    const env = { ...baseEnv, EDGE_ENROLL_TOKEN: TOKEN };
    const r = await runEnroll(env, { fetchImpl, host: 'host-teste' });
    expect(r.agentId).toBe('ag');
    const text = readFileSync(baseEnv.EDGE_ENV_OUT, 'utf8');
    const priv = /EDGE_DEVICE_KEY=(.+)/.exec(text)[1];
    expect(publicKeyOf(priv)).toBe(sentPub);
    expect(verifyMessage('m', signMessage('m', priv), sentPub)).toBe(true);
    expect(text).toContain('EDGE_AGENT_SECRET=zes_seg');
    if (process.platform !== 'win32')
      expect(statSync(baseEnv.EDGE_ENV_OUT).mode & 0o777).toBe(0o600);
    await expect(runEnroll(env, { fetchImpl })).rejects.toThrow('novo agente');
  });

  it('token malformado ou gateway recusando: erro sem vazar o token', async () => {
    const env = { ...baseEnv, EDGE_ENV_OUT: join(dir, 'x.env') };
    await expect(runEnroll({ ...env, EDGE_ENROLL_TOKEN: 'abc' })).rejects.toThrow('formato');
    const msg = await runEnroll(
      { ...env, EDGE_ENROLL_TOKEN: TOKEN },
      { fetchImpl: async () => new Response('{}', { status: 401 }) },
    ).catch((e) => e.message);
    expect(msg).toContain('recusado');
    expect(msg).not.toContain(TOKEN);
  });
});
