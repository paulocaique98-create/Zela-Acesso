import { METHOD_LABEL, formatUptime, summarizeAgent } from '../lib/format.js';
import { Card, TopBar } from '../ui/parts.jsx';

export const APP_VERSION = '0.1.0';
const fmt = (ms) =>
  ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';

function Rows({ rows }) {
  return (
    <dl className="divide-y divide-kiosk-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-on-kiosk-muted">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Informações do Sistema: sem dado de pessoa. */
export function Info({
  identity,
  link,
  records,
  transportKind,
  startedAt,
  log,
  clockOffsetMs,
  onBack,
}) {
  const agent = summarizeAgent(navigator.userAgent);
  const undelivered = records.filter((r) => !r.delivered).length;
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Informações do Sistema" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Card>
          <Rows
            rows={[
              ['Versão do aplicativo', APP_VERSION],
              ['Leitor', identity.readerId.slice(0, 8)],
              ['Modo', identity.mode === 'actuate' ? 'Com atuação' : 'Somente registro'],
              ['Conexão em uso', transportKind === 'websocket' ? 'WebSocket' : 'HTTPS'],
              [
                'Edge',
                link.edge === 'ok'
                  ? 'Conectado'
                  : link.edge === 'revoked'
                    ? 'Revogado'
                    : 'Sem conexão',
              ],
              ['Nuvem', link.cloudOffline ? 'Edge sem conexão' : 'Conectada'],
              ['Última comunicação', fmt(link.lastOkAt)],
              ['Diferença de relógio', `${Math.round(clockOffsetMs / 1000)} s`],
              ['Leituras guardadas (últimas)', String(records.length)],
              ['Sem resposta do Edge', String(undelivered)],
              ['Sistema', agent.os],
              ['Navegador', agent.browser],
              ['Tempo de atividade', formatUptime(Date.now() - startedAt)],
              ['Ativado em', fmt(Date.parse(identity.enrolledAt))],
            ]}
          />
        </Card>
        {log.length > 0 && (
          <Card>
            <h2 className="mb-2 text-lg font-semibold">
              Log técnico (últimos {Math.min(log.length, 30)})
            </h2>
            <ul className="space-y-1 font-mono text-xs text-on-kiosk-muted">
              {log
                .slice(-30)
                .reverse()
                .map((l, i) => (
                  <li key={`${l.at}-${i}`}>
                    {fmt(l.at)} · {l.event} · {l.code}
                  </li>
                ))}
            </ul>
          </Card>
        )}
        <p className="text-center text-xs text-on-kiosk-muted">
          Métodos aceitos: {Object.values(METHOD_LABEL).join(', ')}.
        </p>
      </div>
    </div>
  );
}
