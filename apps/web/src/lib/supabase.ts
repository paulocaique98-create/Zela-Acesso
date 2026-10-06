import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { parseEnv } from './env';

const env = parseEnv(import.meta.env as Record<string, string | undefined>);

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
