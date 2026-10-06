// Validacao do ambiente publico. Recusa chaves privilegiadas: service_role nunca chega ao navegador.

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload: unknown = JSON.parse(json);
    if (typeof payload === 'object' && payload !== null && 'role' in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === 'string' ? role : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const role = jwtRole(key);
  return role !== null && role !== 'anon';
}

export function parseEnv(raw: Record<string, string | undefined>): PublicEnv {
  const url = raw['VITE_SUPABASE_URL']?.trim();
  const key = raw['VITE_SUPABASE_PUBLISHABLE_KEY']?.trim();
  if (!url) throw new Error('VITE_SUPABASE_URL ausente');
  if (!key) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY ausente');
  try {
    new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL invalida');
  }
  if (isPrivilegedKey(key)) {
    throw new Error(
      'Chave privilegiada detectada no frontend. Use somente a chave publica (publishable/anon).',
    );
  }
  return { supabaseUrl: url, supabasePublishableKey: key };
}
