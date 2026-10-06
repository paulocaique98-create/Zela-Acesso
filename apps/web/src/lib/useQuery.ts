import { useEffect, useState } from 'react';

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Carrega dados assincronos descartando respostas de requisicoes antigas (troca de tenant). */
export function useQuery<T>(load: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: null, loading: true });

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
  }, deps);

  return state;
}
