import { READER_OUTCOME_LABEL } from '@zela/domain';
import { METHOD_LABEL } from '../lib/format.js';
import { Card, TopBar } from '../ui/parts.jsx';

/**
 * Últimas leituras DESTE aparelho: método, resultado e hora. Sem nome, sem identificador, sem valor lido
 * (minimização de dados). "Sinc." = o Edge respondeu (a decisão e a evidência ficam no Edge/nuvem).
 */
export function Records({ records, onBack }) {
  const allDelivered = records.every((r) => r.delivered);
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Registros" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4">
        <p
          role="status"
          className={`mx-auto mb-4 max-w-xl text-center text-lg font-medium ${allDelivered ? 'text-emerald-300' : 'text-amber-200'}`}
        >
          {records.length === 0
            ? 'Nenhuma leitura neste aparelho.'
            : allDelivered
              ? 'Todas as leituras foram entregues ao Edge'
              : 'Algumas leituras não receberam resposta do Edge'}
        </p>
        {records.length > 0 && (
          <Card className="p-0">
            <table className="w-full text-left">
              <caption className="sr-only">Últimas leituras deste aparelho</caption>
              <thead>
                <tr className="border-b border-kiosk-line text-sm text-on-kiosk-muted">
                  <th className="p-3 font-medium">Data e hora</th>
                  <th className="p-3 font-medium">Forma</th>
                  <th className="p-3 font-medium">Resultado</th>
                  <th className="p-3 text-center font-medium">Sinc.</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={`${r.at}-${i}`} className="border-b border-kiosk-line last:border-0">
                    <td className="p-3 tabular-nums">
                      {new Date(r.at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3">{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className="p-3">{READER_OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                    <td className="p-3 text-center">
                      <span
                        role="img"
                        aria-label={r.delivered ? 'Entregue' : 'Sem resposta'}
                        className={`inline-block size-4 rounded-full ${r.delivered ? 'bg-emerald-400' : 'bg-amber-400'}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
