// Entrypoint do daemon: `node apps/edge-agent/src/main.js`. Configuração só por ambiente (ver config.js).
import { createMockHardware } from '@zela/device-drivers';
import { loadConfig } from './config.js';
import { runLoop } from './runner.js';
import { openStore } from './store.js';
import { createHttpTransport } from './transport.js';

const cfg = loadConfig(process.env);
const store = openStore(cfg.dbPath);
const transport = createHttpTransport({
  baseUrl: cfg.gatewayUrl,
  agentId: cfg.agentId,
  secret: cfg.agentSecret,
});
const commands =
  cfg.driver === 'mock'
    ? {
        driver: createMockHardware({ points: cfg.mockPoints }),
        key: cfg.commandKeys,
        agentId: cfg.agentId,
      }
    : null;

const ac = new AbortController();
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => ac.abort());

const outcome = await runLoop({
  store,
  transport,
  version: cfg.version,
  commands,
  tickMs: cfg.tickMs,
  signal: ac.signal,
  // sem segredo/payload: só o nome das etapas e o status
  onError: (e) => console.error('rodada falhou:', e instanceof Error ? e.message : 'erro'),
});
console.error(`agente encerrado: ${outcome}`);
process.exit(outcome === 'revoked' ? 2 : 0);
