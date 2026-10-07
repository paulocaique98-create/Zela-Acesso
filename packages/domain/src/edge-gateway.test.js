// Testa a Edge Function edge-gateway com `rpc` simulado (sem Deno e sem rede).
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EVENTS_PER_BATCH,
  createRateLimiter,
  handle,
} from '../../../supabase/functions/edge-gateway/handler.js';

const AGENT = '11111111-2222-3333-4444-555555555555';
const SECRET = `zes_${'a'.repeat(64)}`;

function req(body, { headers = {}, method = 'POST', raw } = {}) {
  return new Request('https://x.test/edge-gateway', {
    method,
    headers: { 'x-agent-id': AGENT, 'x-agent-secret': SECRET, ...headers },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
}
const rpcOk = (data) => vi.fn(async () => ({ data, error: null }));

describe('edge-gateway', () => {
  it('só aceita POST', async () => {
    const res = await handle(req(null, { method: 'GET' }), { rpc: rpcOk(null) });
    expect(res.status).toBe(405);
  });

  it.each([
    ['sem id', { 'x-agent-id': '' }],
    ['id malformado', { 'x-agent-id': 'abc' }],
    ['sem segredo', { 'x-agent-secret': '' }],
    ['segredo malformado', { 'x-agent-secret': 'zes_curto' }],
  ])('credencial mal formada (%s) = 401 sem chamar o banco', async (_n, headers) => {
    const rpc = rpcOk(null);
    const res = await handle(req({ op: 'snapshot' }, { headers }), { rpc });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('corpo inválido / op desconhecido = 400', async () => {
    const deps = { rpc: rpcOk(null) };
    expect((await handle(req(null, { raw: 'nao-json' }), deps)).status).toBe(400);
    expect((await handle(req([1]), deps)).status).toBe(400);
    expect((await handle(req({ op: 'abrir_porta' }), deps)).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('corpo grande demais = 413', async () => {
    const res = await handle(
      req(null, { raw: JSON.stringify({ op: 'events', x: 'a'.repeat(600_000) }) }),
      {
        rpc: rpcOk(null),
      },
    );
    expect(res.status).toBe(413);
  });

  it('rate limit = 429', async () => {
    const res = await handle(req({ op: 'snapshot' }), { rpc: rpcOk(null), allow: () => false });
    expect(res.status).toBe(429);
  });

  describe('heartbeat', () => {
    it('repassa à RPC e devolve hora/deriva', async () => {
      const rpc = rpcOk([{ server_time: '2026-10-05T14:00:00Z', clock_drift_seconds: 3 }]);
      const res = await handle(
        req({
          op: 'heartbeat',
          version: '0.1.0',
          agentTime: '2026-10-05T14:00:03Z',
          queueDepth: 4,
        }),
        { rpc },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        serverTime: '2026-10-05T14:00:00Z',
        clockDriftSeconds: 3,
      });
      expect(rpc).toHaveBeenCalledWith('edge_heartbeat', {
        p_agent: AGENT,
        p_secret: SECRET,
        p_version: '0.1.0',
        p_agent_time: '2026-10-05T14:00:03.000Z',
        p_queue_depth: 4,
      });
    });
    it('sem linha = 401 (credencial recusada); hora inválida = 400', async () => {
      expect(
        (
          await handle(req({ op: 'heartbeat', agentTime: '2026-10-05T14:00:03Z' }), {
            rpc: rpcOk([]),
          })
        ).status,
      ).toBe(401);
      expect(
        (await handle(req({ op: 'heartbeat', agentTime: 'ontem' }), { rpc: rpcOk([]) })).status,
      ).toBe(400);
    });
  });

  describe('snapshot', () => {
    it('repassa o hash conhecido e devolve o snapshot', async () => {
      const rpc = rpcOk({ unchanged: true, hash: 'h' });
      const res = await handle(req({ op: 'snapshot', knownHash: 'b'.repeat(64) }), { rpc });
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('edge_pull_snapshot', {
        p_agent: AGENT,
        p_secret: SECRET,
        p_known_hash: 'b'.repeat(64),
      });
    });
    it('hash conhecido malformado = 400; null do banco = 401', async () => {
      expect(
        (await handle(req({ op: 'snapshot', knownHash: "x'; drop" }), { rpc: rpcOk(null) })).status,
      ).toBe(400);
      expect((await handle(req({ op: 'snapshot' }), { rpc: rpcOk(null) })).status).toBe(401);
    });
  });

  describe('events', () => {
    const ev = (n) => ({ p_idempotency_key: `edge:${n}` });
    it('repassa o lote', async () => {
      const rpc = rpcOk({ serverTime: 't', results: [] });
      const res = await handle(req({ op: 'events', events: [ev(1)] }), { rpc });
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('edge_ingest_events', {
        p_agent: AGENT,
        p_secret: SECRET,
        p_events: [ev(1)],
      });
    });
    it('lote vazio, grande demais ou não-array = 400', async () => {
      const deps = { rpc: rpcOk({}) };
      expect((await handle(req({ op: 'events', events: [] }), deps)).status).toBe(400);
      expect((await handle(req({ op: 'events', events: 'x' }), deps)).status).toBe(400);
      const big = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, i) => ev(i));
      expect((await handle(req({ op: 'events', events: big }), deps)).status).toBe(400);
    });
    it('credencial recusada = 401', async () => {
      expect(
        (await handle(req({ op: 'events', events: [ev(1)] }), { rpc: rpcOk(null) })).status,
      ).toBe(401);
    });
    it('erro do banco = 502 genérico, sem vazar a mensagem', async () => {
      const rpc = vi.fn(async () => ({
        data: null,
        error: { code: 'XX000', message: 'segredo interno do banco' },
      }));
      const res = await handle(req({ op: 'events', events: [ev(1)] }), { rpc });
      expect(res.status).toBe(502);
      expect(JSON.stringify(await res.json())).not.toContain('segredo interno');
    });
  });

  it('createRateLimiter: bloqueia acima do limite e libera após a janela', () => {
    const allow = createRateLimiter(2, 1000);
    expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2)]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(allow('a', 1500)).toBe(true);
  });
});
