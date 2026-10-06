// Ponto de entrada (Deno / Supabase Edge Runtime). Toda a logica esta em handler.js.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sao injetados pela plataforma;
// ALLOWED_ORIGINS (lista separada por virgula) deve ser definido no deploy.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.js';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const allowedOrigins = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://127.0.0.1:55173,http://localhost:55173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

Deno.serve((req) =>
  handle(req, {
    allowedOrigins,
    makeUserClient: (authHeader) =>
      createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    makeAdminClient: () =>
      createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  }),
);
