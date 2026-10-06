import { useCallback, useState } from 'react';

const KEY = 'zela-acesso.sidebar-expanded';

function read() {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Estado do menu lateral (expandido/recolhido), persistido por navegador. @returns {[boolean, () => void]} */
export function useSidebarExpanded() {
  const [expanded, setExpanded] = useState(read);
  const toggle = useCallback(() => {
    setExpanded((v) => {
      try {
        localStorage.setItem(KEY, String(!v));
      } catch {
        /* sem storage: so nao persiste */
      }
      return !v;
    });
  }, []);
  return [expanded, toggle];
}
