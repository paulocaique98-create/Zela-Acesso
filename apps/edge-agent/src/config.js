// Configuração do agente a partir do ambiente (fail-closed: valor ausente/inválido lança, nunca assume padrão inseguro).
// Segredos só por variável de ambiente; nunca aparecem na mensagem de erro.

import { parsePublicKeys, publicKeyOf } from './keys.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ gatewayUrl: string, agentId: string, agentSecret: string, dbPath: string, version: string,
 *   commandKeys: string[], commandPubKeys: Record<string, string>, commandTofu: boolean, deviceKey: string | null, storeKey: string | null, face: boolean, driver: 'none' | 'mock' | 'controlid', controlIdPoints: Record<string, any>, monitor: { bind: string, port: number, secret: string, advertise: string } | null, reader: { bind: string, port: number, tcpPort: number | null, tlsCert: string | null, tlsKey: string | null, webDir: string | null } | null, mockPoints: string[], tickMs: number }}
 */
export function loadConfig(env) {
  const need = (k) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`variável ${k} ausente`);
    return v;
  };
  const driver = (env.EDGE_DRIVER?.trim() || 'none').toLowerCase();
  if (driver !== 'none' && driver !== 'mock' && driver !== 'controlid')
    throw new Error('EDGE_DRIVER deve ser "none", "mock" ou "controlid"');
  if (driver === 'mock' && env.NODE_ENV === 'production')
    throw new Error('EDGE_DRIVER=mock não é permitido em produção');

  // Atual primeiro, anterior depois (rotação da chave mestra, ver scripts/command-key.mjs).
  const commandKeys = [env.EDGE_COMMAND_KEY, env.EDGE_COMMAND_KEY_PREVIOUS]
    .map((k) => k?.trim())
    .filter(Boolean);
  for (const k of commandKeys)
    if (!HEX64.test(k)) throw new Error('chave de comando deve ter 64 hex');
  // Fase 8A (D-022): chaves públicas Ed25519 por kid (âncora manual); TOFU só se pedido explicitamente.
  const commandPubKeys = parsePublicKeys(env.EDGE_COMMAND_PUBKEYS);
  const commandTofu = env.EDGE_COMMAND_TOFU?.trim() === '1';
  if (commandTofu && env.NODE_ENV === 'production')
    throw new Error('EDGE_COMMAND_TOFU não é permitido em produção (use EDGE_COMMAND_PUBKEYS)');
  if (
    driver !== 'none' &&
    commandKeys.length === 0 &&
    Object.keys(commandPubKeys).length === 0 &&
    !commandTofu
  )
    throw new Error('EDGE_DRIVER definido exige EDGE_COMMAND_PUBKEYS (ou EDGE_COMMAND_KEY legada)');

  // Chave do dispositivo (Ed25519, PKCS#8 base64): obrigatória em produção; gerada por enroll.js.
  const deviceKey = env.EDGE_DEVICE_KEY?.trim() || null;
  if (deviceKey) {
    try {
      publicKeyOf(deviceKey);
    } catch {
      throw new Error('EDGE_DEVICE_KEY inválida');
    }
  }
  if (!deviceKey && env.NODE_ENV === 'production')
    throw new Error('EDGE_DEVICE_KEY é obrigatória em produção');

  // Cifragem em repouso do SQLite: obrigatória em produção (fail-closed), opcional em dev/teste.
  const storeKey = env.EDGE_STORE_KEY?.trim() || null;
  if (storeKey && !HEX64.test(storeKey)) throw new Error('EDGE_STORE_KEY deve ter 64 hex');
  if (!storeKey && env.NODE_ENV === 'production')
    throw new Error('EDGE_STORE_KEY é obrigatória em produção');

  // Facial (leitor em tablet/celular): desligado por padrão (biometria é opt-in). Em produção o gabarito só existe
  // com o armazenamento cifrado, porque EDGE_STORE_KEY já é obrigatória acima.
  const face = env.EDGE_FACE?.trim() === '1';

  // Driver Control iD (D-023): pontos por JSON (senha só por variável apontada em passwordEnv) + receptor do Monitor.
  let controlIdPoints = {};
  let monitor = null;
  if (driver === 'controlid') {
    const text = need('EDGE_CONTROLID_POINTS');
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch {
      /* sem anexar a causa: o texto pode conter credenciais */
    }
    if (raw === null) throw new Error('EDGE_CONTROLID_POINTS não é JSON válido');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0)
      throw new Error('EDGE_CONTROLID_POINTS deve ser um objeto {pontoId: {...}} não vazio');
    for (const [id, p] of Object.entries(raw)) {
      if (!p || typeof p !== 'object' || typeof p.passwordEnv !== 'string')
        throw new Error(
          `EDGE_CONTROLID_POINTS.${id}: passwordEnv obrigatório (nome da variável da senha)`,
        );
      const { passwordEnv, ...rest } = p;
      const password = env[passwordEnv]?.trim();
      if (!password) throw new Error(`variável ${passwordEnv} ausente (senha do ponto ${id})`);
      controlIdPoints[id] = { ...rest, password };
    }
    const secret = need('EDGE_MONITOR_SECRET');
    if (!/^[A-Za-z0-9_-]{32,}$/.test(secret))
      throw new Error('EDGE_MONITOR_SECRET deve ter 32+ caracteres [A-Za-z0-9_-]');
    const port = Number(env.EDGE_MONITOR_PORT ?? 8000);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('EDGE_MONITOR_PORT inválida');
    const bind = need('EDGE_MONITOR_BIND');
    // Endereço que o TERMINAL usa para chamar este Edge (IP da LAN). Obrigatório quando se escuta em todas as interfaces.
    const advertise =
      env.EDGE_MONITOR_ADVERTISE_HOST?.trim() || (bind === '0.0.0.0' || bind === '::' ? '' : bind);
    if (!advertise)
      throw new Error(
        'EDGE_MONITOR_ADVERTISE_HOST é obrigatório quando EDGE_MONITOR_BIND escuta em todas as interfaces',
      );
    monitor = { bind, port, secret, advertise };
  }

  // Zela Pass (D-027): leitores em tablet/celular. Desligado sem EDGE_READER_BIND. A senha digitada trafega no corpo da
  // mensagem, então fora de loopback em produção TLS é obrigatório (HTTPS/WSS e TCP com TLS).
  let reader = null;
  const readerBind = env.EDGE_READER_BIND?.trim();
  if (readerBind) {
    const portOf = (k, dflt) => {
      const raw = env[k]?.trim();
      if (!raw) return dflt;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${k} inválida`);
      return n;
    };
    const tlsCert = env.EDGE_READER_TLS_CERT?.trim() || null;
    const tlsKey = env.EDGE_READER_TLS_KEY?.trim() || null;
    if (!!tlsCert !== !!tlsKey)
      throw new Error('EDGE_READER_TLS_CERT e EDGE_READER_TLS_KEY devem ser definidas juntas');
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(readerBind);
    if (!tlsCert && !loopback && env.NODE_ENV === 'production')
      throw new Error(
        'leitores fora de loopback em produção exigem TLS (EDGE_READER_TLS_CERT/KEY)',
      );
    const port = portOf('EDGE_READER_PORT', 8443);
    const tcpPort = portOf('EDGE_READER_TCP_PORT', null);
    if (tcpPort === port) throw new Error('EDGE_READER_TCP_PORT deve diferir de EDGE_READER_PORT');
    reader = {
      bind: readerBind,
      port,
      tcpPort,
      tlsCert,
      tlsKey,
      webDir: env.EDGE_READER_WEB_DIR?.trim() || null,
    };
  }

  const tickMs = Number(env.EDGE_TICK_MS ?? 5000);
  if (!Number.isFinite(tickMs) || tickMs < 250) throw new Error('EDGE_TICK_MS inválido (mín. 250)');

  return {
    gatewayUrl: need('EDGE_GATEWAY_URL'),
    agentId: need('EDGE_AGENT_ID'),
    agentSecret: need('EDGE_AGENT_SECRET'),
    dbPath: env.EDGE_DB_PATH?.trim() || './edge-agent.sqlite',
    version: env.EDGE_VERSION?.trim() || '0.1.0',
    commandKeys,
    commandPubKeys,
    commandTofu,
    deviceKey,
    storeKey,
    face,
    driver,
    controlIdPoints,
    monitor,
    reader,
    mockPoints: (env.EDGE_MOCK_POINTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tickMs,
  };
}
