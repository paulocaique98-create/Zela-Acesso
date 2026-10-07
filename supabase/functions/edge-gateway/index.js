// Ponto de entrada (Deno / Supabase Edge Runtime). Toda a logica esta em handler.js.
// verify_jwt = false (config.toml): o agente nao tem JWT; a autenticacao e o par id/segredo validado pelas RPCs edge_*.
// SUPABASE_SERVICE_ROLE_KEY existe so aqui (server-side) e nunca e devolvida nem registrada.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRateLimiter, handle } from './handler.js';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const allow = createRateLimiter();

// COMMAND_MASTER_KEY (64 hex) assina os comandos de dispositivo; sem ela o gateway nao entrega comandos (D-021).
Deno.serve((req) =>
  handle(req, {
    rpc: (name, args) => admin.rpc(name, args),
    allow,
    commandMasterKey: Deno.env.get('COMMAND_MASTER_KEY') ?? '',
  }),
);
