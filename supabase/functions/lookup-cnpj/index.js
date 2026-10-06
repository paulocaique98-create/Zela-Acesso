// Ponto de entrada (Deno / Supabase Edge Runtime). Toda a logica esta em handler.js.
// Nao usa secrets proprios (API aberta da CNPJa); ALLOWED_ORIGINS (lista separada por virgula) deve ser definido no deploy.
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
  }),
);
