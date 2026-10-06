import { createClient } from '@supabase/supabase-js';
import { parseEnv } from './env';

const env = parseEnv(import.meta.env);

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
