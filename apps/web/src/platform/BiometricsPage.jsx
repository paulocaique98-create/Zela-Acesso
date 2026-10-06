import { ScanFace } from 'lucide-react';
import { useQuery } from '../lib/useQuery';
import { supabase } from '../lib/supabase';
import { card } from './ui';

// Biometria (plataforma). So NUMEROS: a plataforma nunca acessa imagens ou gabaritos (LGPD). O modulo de
// biometria ainda nao foi implementado; ate la a tela mostra quantas organizacoes ligaram a chave.
export function BiometricsPage() {
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, org_code, features_enabled')
      .order('org_code');
    if (error) throw error;
    return data;
  }, []);
  const enabled = (q.data ?? []).filter((t) => t.features_enabled?.biometrics === true);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-zela-md bg-primary/10 p-2.5 text-primary">
          <ScanFace size={20} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-h2 text-on-surface">Biometria</h1>
          <p className="text-small text-on-surface-variant">
            Qualidade e uso da biometria, somente em números.
          </p>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm text-on-surface">
          O módulo de biometria ainda não foi implementado. Quando existir, esta tela mostrará só
          números de qualidade (fotos boas, a refazer, sem análise), nunca imagens ou gabaritos: a
          plataforma não tem acesso a dados biométricos (LGPD). A biometria é desligada por padrão e
          só entra com base legal da organização.
        </p>
      </div>

      {q.loading ? (
        <p>Carregando…</p>
      ) : q.error ? (
        <p role="alert" className="text-error">
          {q.error}
        </p>
      ) : (
        <div className={card}>
          <p className="text-[11px] font-bold tracking-wide text-on-surface-variant uppercase">
            Organizações com a chave de biometria ligada
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">{enabled.length}</p>
          {enabled.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {enabled.map((t) => (
                <li key={t.id}>
                  <span className="mr-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                    {t.org_code}
                  </span>
                  {t.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
