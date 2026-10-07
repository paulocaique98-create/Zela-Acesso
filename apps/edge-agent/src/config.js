// Configuração do agente a partir do ambiente (fail-closed: valor ausente/inválido lança, nunca assume padrão inseguro).
// Segredos só por variável de ambiente; nunca aparecem na mensagem de erro.

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ gatewayUrl: string, agentId: string, agentSecret: string, dbPath: string, version: string,
 *   commandKeys: string[], driver: 'none' | 'mock', mockPoints: string[], tickMs: number }}
 */
export function loadConfig(env) {
  const need = (k) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`variável ${k} ausente`);
    return v;
  };
  const driver = (env.EDGE_DRIVER?.trim() || 'none').toLowerCase();
  if (driver !== 'none' && driver !== 'mock')
    throw new Error('EDGE_DRIVER deve ser "none" ou "mock" (driver real ainda não existe)');
  if (driver === 'mock' && env.NODE_ENV === 'production')
    throw new Error('EDGE_DRIVER=mock não é permitido em produção');

  // Atual primeiro, anterior depois (rotação da chave mestra, ver scripts/command-key.mjs).
  const commandKeys = [env.EDGE_COMMAND_KEY, env.EDGE_COMMAND_KEY_PREVIOUS]
    .map((k) => k?.trim())
    .filter(Boolean);
  for (const k of commandKeys)
    if (!HEX64.test(k)) throw new Error('chave de comando deve ter 64 hex');
  if (driver !== 'none' && commandKeys.length === 0)
    throw new Error('EDGE_DRIVER definido exige EDGE_COMMAND_KEY');

  const tickMs = Number(env.EDGE_TICK_MS ?? 5000);
  if (!Number.isFinite(tickMs) || tickMs < 250) throw new Error('EDGE_TICK_MS inválido (mín. 250)');

  return {
    gatewayUrl: need('EDGE_GATEWAY_URL'),
    agentId: need('EDGE_AGENT_ID'),
    agentSecret: need('EDGE_AGENT_SECRET'),
    dbPath: env.EDGE_DB_PATH?.trim() || './edge-agent.sqlite',
    version: env.EDGE_VERSION?.trim() || '0.1.0',
    commandKeys,
    driver,
    mockPoints: (env.EDGE_MOCK_POINTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tickMs,
  };
}
