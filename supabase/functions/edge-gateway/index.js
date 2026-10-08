// Ponto de entrada (Deno / Supabase Edge Runtime). Toda a logica esta em handler.js.
// verify_jwt = false (config.toml): o agente nao tem JWT; a autenticacao e o par id/segredo validado pelas RPCs edge_*.
// SUPABASE_SERVICE_ROLE_KEY existe so aqui (server-side) e nunca e devolvida nem registrada.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { RATE_LIMIT_PER_MINUTE, createRateLimiter, handle } from './handler.js';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const allow = createRateLimiter();

// Chave publica do dispositivo por agente (D-022). So resultado positivo e guardado (5 min): a chave e imutavel
// depois do enrollment e a revogacao e tratada pelas RPCs edge_* (que autenticam o segredo a cada chamada).
const deviceKeyCache = new Map();
const DEVICE_KEY_TTL_MS = 5 * 60_000;
async function deviceKey(agentId) {
  const hit = deviceKeyCache.get(agentId);
  if (hit && Date.now() - hit.at < DEVICE_KEY_TTL_MS) return hit.key;
  const { data, error } = await admin.rpc('edge_device_key', { p_agent: agentId });
  if (error) throw new Error('device_key_failed');
  if (typeof data === 'string' && data) {
    if (deviceKeyCache.size > 5000) deviceKeyCache.clear();
    deviceKeyCache.set(agentId, { key: data, at: Date.now() });
    return data;
  }
  return null;
}

// COMMAND_SIGNING_JWK (JWK Ed25519 com `d`) assina comandos v2 com kid (D-022); COMMAND_KEY_STATEMENTS repassa as
// declaracoes de rotacao (endorse/revoke) assinadas offline. COMMAND_MASTER_KEY (64 hex) e o legado v1 (D-021).
// EDGE_ALLOW_LEGACY_AGENTS=false recusa agente sem chave de dispositivo (usar em producao apos o re-enrollment).
Deno.serve((req) =>
  handle(req, {
    rpc: (name, args) => admin.rpc(name, args),
    allow,
    deviceKey,
    allowLegacyAgents: Deno.env.get('EDGE_ALLOW_LEGACY_AGENTS') !== 'false',
    commandSigningJwk: Deno.env.get('COMMAND_SIGNING_JWK') ?? '',
    commandKeyStatements: Deno.env.get('COMMAND_KEY_STATEMENTS') ?? '',
    // limite global por agente (todas as instancias), contado no banco
    allowGlobal: async (agentId) => {
      const { data, error } = await admin.rpc('edge_rate_check', {
        p_agent: agentId,
        p_limit: RATE_LIMIT_PER_MINUTE,
      });
      if (error) throw new Error('rate_check_failed');
      return data === true;
    },
    commandMasterKey: Deno.env.get('COMMAND_MASTER_KEY') ?? '',
  }),
);
