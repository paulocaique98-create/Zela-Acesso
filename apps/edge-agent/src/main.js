// Entrypoint do daemon: `node apps/edge-agent/src/main.js`. Configuração só por ambiente (ver config.js).
import { createControlIdDriver, createMockHardware } from '@zela/device-drivers';
import { loadConfig } from './config.js';
import { recordDeviceDecisions } from './device-events.js';
import { createMonitorServer } from './monitor-server.js';
import { startTerminalSetup } from './monitor-setup.js';
import { runLoop } from './runner.js';
import { openStore } from './store.js';
import { createHttpTransport } from './transport.js';
import { createKeyring } from './trust.js';

const cfg = loadConfig(process.env);
const store = openStore(cfg.dbPath, { key: cfg.storeKey ?? undefined });
const transport = createHttpTransport({
  baseUrl: cfg.gatewayUrl,
  agentId: cfg.agentId,
  secret: cfg.agentSecret,
  deviceKey: cfg.deviceKey ?? undefined,
});
const driver =
  cfg.driver === 'mock'
    ? createMockHardware({ points: cfg.mockPoints })
    : cfg.driver === 'controlid'
      ? createControlIdDriver({
          points: cfg.controlIdPoints,
          monitorPathPrefix: `/api/notifications/${cfg.monitor.secret}`,
        })
      : null;
const commands = driver
  ? {
      driver,
      key: cfg.commandKeys, // v1 (HMAC legado); vazio quando só v2
      keyring: createKeyring({
        store,
        transport,
        seed: cfg.commandPubKeys,
        tofu: cfg.commandTofu,
      }),
      agentId: cfg.agentId,
    }
  : null;

// Eventos do terminal (decisão local, modo Standalone) viram evidência `DEVICE_LOCAL_*` na fila (D-024).
// No log só aparecem o tipo e o ponto: nunca cartão, usuário do terminal ou corpo da notificação.
let monitorServer = null;
if (driver && cfg.driver === 'controlid') {
  driver.onEvent((e) => console.error(`evento ${e.type} ponto=${e.pointId}`));
  recordDeviceDecisions({
    store,
    driver,
    onDropped: (r) => console.error(`evento do terminal descartado: ${r}`),
  });
  monitorServer = createMonitorServer({
    driver,
    bind: cfg.monitor.bind,
    port: cfg.monitor.port,
    onError: () => console.error('monitor: erro ao tratar notificação'),
  });
  await monitorServer.listen();
}

const ac = new AbortController();
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => ac.abort());

if (monitorServer) {
  // Aponta Monitor/Push de cada terminal para este Edge; falha de um não derruba o daemon (retenta a cada 60 s).
  await startTerminalSetup({
    driver,
    points: cfg.controlIdPoints,
    hostname: cfg.monitor.advertise,
    port: cfg.monitor.port,
    signal: ac.signal,
    log: (m) => console.error(m),
  });
}

// door.forced/door.held_open dependem do relógio do driver; sem este tick nunca disparam.
if (driver && cfg.driver === 'controlid') {
  const t = setInterval(() => driver.tick(new Date()), 1_000);
  t.unref();
}

const outcome = await runLoop({
  store,
  transport,
  version: cfg.version,
  commands,
  // Usuários do terminal Standalone espelham a política do Zela (só pontos em modo direto; o Push não suporta).
  roster:
    driver && cfg.driver === 'controlid'
      ? {
          driver,
          pointIds: Object.keys(cfg.controlIdPoints).filter(
            (id) => cfg.controlIdPoints[id].transport !== 'push',
          ),
        }
      : null,
  tickMs: cfg.tickMs,
  signal: ac.signal,
  // sem segredo/payload: só o nome das etapas e o status
  onError: (e) => console.error('rodada falhou:', e instanceof Error ? e.message : 'erro'),
});
await monitorServer?.close();
console.error(`agente encerrado: ${outcome}`);
process.exit(outcome === 'revoked' ? 2 : 0);
