import { useEffect, useState } from 'react';

/** @template T @typedef {{ data: T | null, error: string | null, loading: boolean, reload: () => void }} QueryState */

/** Carrega dados assincronos descartando respostas de requisicoes antigas (troca de tenant). */
/**
 * @template T
 * @param {() => Promise<T>} load
 * @param {readonly unknown[]} deps
 * @returns {QueryState<T>}
 */
export function useQuery(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => active && setState({ data, error: null, loading: false }),
      () =>
        active &&
        setState({ data: null, error: 'Não foi possível carregar os dados.', loading: false }),
    );
    return () => {
      active = false;
    };
  }, [...deps, version]);

  return { ...state, reload: () => setVersion((v) => v + 1) };
}
