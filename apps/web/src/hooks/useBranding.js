import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const EMPTY = { logo: '', loginImage: '' };
let cache = null;
const listeners = new Set();

async function load() {
  const { data } = await supabase.from('system_settings').select('key, value');
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  cache = { logo: map.global_logo ?? '', loginImage: map.login_image_url ?? '' };
  listeners.forEach((fn) => fn(cache));
}

/** Logo global e imagem da tela de login (system_settings; leitura publica, escrita so platform_owner). */
export function useBranding() {
  const [state, setState] = useState(cache ?? EMPTY);

  useEffect(() => {
    listeners.add(setState);
    if (!cache) void load();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const refresh = useCallback(() => load(), []);
  return { ...state, refresh };
}
