import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT, Modal, PageHead } from './RegistryPages';

const KIND_LABEL = {
  door_forced: 'Porta forçada',
  door_held_open: 'Porta aberta por tempo excessivo',
  device_offline: 'Agente Edge offline',
  chain_broken: 'Cadeia de evidência quebrada',
};
const SEVERITY_LABEL = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa' };
const ALERT_STATUS_LABEL = { open: 'Aberto', acknowledged: 'Reconhecido', resolved: 'Resolvido' };
const INCIDENT_STATUS_LABEL = {
  open: 'Aberto',
  investigating: 'Em investigação',
  closed: 'Encerrado',
};

const fmt = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-zela-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

/** Abre incidente a partir de um alerta (ou avulso, se `alert` for null). */
function IncidentModal({ alert, sites, onClose, onDone }) {
  const [site, setSite] = useState(alert?.site_id ?? sites[0]?.id ?? '');
  const [title, setTitle] = useState(alert ? KIND_LABEL[alert.kind] : '');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState(alert?.severity ?? 'medium');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('create_incident', {
      p_site: site,
      p_title: title,
      p_description: description,
      p_severity: severity,
      p_alerts: alert ? [alert.id] : [],
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível abrir o incidente.'));
    toast.success('Incidente aberto.');
    onDone();
  };

  return (
    <Modal title="Abrir incidente" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Local">
          <select
            className={INPUT}
            value={site}
            onChange={(e) => setSite(e.target.value)}
            disabled={Boolean(alert)}
            required
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título">
          <input
            className={INPUT}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={160}
            required
          />
        </Field>
        <Field label="Descrição">
          <textarea
            className={INPUT}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </Field>
        <Field label="Severidade">
          <select className={INPUT} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {Object.entries(SEVERITY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !site}>
          {busy ? 'Abrindo…' : 'Abrir incidente'}
        </button>
      </form>
    </Modal>
  );
}

/** Pede uma nota (opcional) e executa a RPC de resolução/encerramento. */
function NoteModal({ title, label, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSubmit(note);
          setBusy(false);
        }}
      >
        <Field label={label}>
          <textarea
            className={INPUT}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy ? 'Salvando…' : 'Confirmar'}
        </button>
      </form>
    </Modal>
  );
}

export function OperationsPage() {
  const { current, allowed, allowedInAnyScope } = useWorkspace();
  const tenantId = current?.id ?? '';
  const [incidentFor, setIncidentFor] = useState(/** @type {any} */ (null)); // { alert } | {}
  const [note, setNote] = useState(/** @type {any} */ (null)); // { kind: 'alert'|'incident', id }
  const [showResolved, setShowResolved] = useState(false);

  const q = useQuery(async () => {
    const [a, i, s, o, g, ap] = await Promise.all([
      supabase
        .from('alerts')
        .select(
          'id, site_id, kind, severity, status, access_point_id, edge_agent_id, occurrences, first_at, last_at, resolved_at, incident_id',
        )
        .eq('tenant_id', tenantId)
        .order('last_at', { ascending: false })
        .limit(300),
      supabase
        .from('incidents')
        .select('id, site_id, title, severity, status, created_at, closed_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('sites').select('id, name').eq('tenant_id', tenantId).order('name').limit(500),
      supabase
        .from('zone_occupancy')
        .select('site_id, zone_id, zone_name, present_count')
        .eq('tenant_id', tenantId)
        .limit(500),
      supabase.from('edge_agents').select('id, name').eq('tenant_id', tenantId).limit(500),
      supabase.from('access_points').select('id, name').eq('tenant_id', tenantId).limit(500),
    ]);
    for (const r of [a, i, s]) if (r.error) throw r.error;
    return {
      alerts: a.data,
      incidents: i.data,
      sites: s.data,
      occupancy: o.error ? null : o.data,
      agents: g.error ? [] : g.data,
      points: ap.error ? [] : ap.data,
    };
  }, [tenantId]);

  // Tempo-real: o Realtime aplica a RLS; qualquer mudanca recarrega e alerta novo avisa por toast.
  const reload = q.reload;
  useEffect(() => {
    if (!tenantId) return undefined;
    const filter = `tenant_id=eq.${tenantId}`;
    const channel = supabase
      .channel(`operations-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter }, (p) => {
        if (p.eventType === 'INSERT' && KIND_LABEL[p.new?.kind])
          toast.error(`Novo alerta: ${KIND_LABEL[p.new.kind]}.`);
        reload();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents', filter }, () =>
        reload(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const call = async (name, args, ok, fail) => {
    const { error } = await supabase.rpc(name, args);
    setNote(null);
    if (error) return toast.error(safeMessage(error, fail));
    toast.success(ok);
    q.reload();
  };

  return (
    <Guard permission="alert:read" siteLevel>
      <PageHead title="Operação">
        <Status q={q}>
          {({ alerts, incidents, sites, occupancy, agents, points }) => {
            const siteName = new Map(sites.map((s) => [s.id, s.name]));
            const pointName = new Map(points.map((p) => [p.id, p.name]));
            const agentName = new Map(agents.map((a) => [a.id, a.name]));
            const active = alerts.filter((a) => a.status !== 'resolved');
            const count = (kind) => active.filter((a) => a.kind === kind).length;
            const shown = showResolved ? alerts : active;
            const present = occupancy?.reduce((n, z) => n + z.present_count, 0);
            const canManage = (siteId) => allowed('alert:manage', siteId);
            return (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Tile
                    label="Portas forçadas"
                    value={count('door_forced')}
                    tone={count('door_forced') ? 'text-error' : ''}
                  />
                  <Tile label="Portas abertas" value={count('door_held_open')} />
                  <Tile label="Agentes offline" value={count('device_offline')} />
                  <Tile label="Pessoas presentes" value={present ?? '—'} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Alertas</h2>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showResolved}
                      onChange={(e) => setShowResolved(e.target.checked)}
                    />
                    Mostrar resolvidos
                  </label>
                </div>
                <DataTable
                  caption="Alertas"
                  headers={[
                    'Alerta',
                    'Local',
                    'Origem',
                    'Gravidade',
                    'Última vez',
                    'Situação',
                    'Ações',
                  ]}
                  empty="Nenhum alerta ativo."
                  rows={shown.map((a) => [
                    a.occurrences > 1
                      ? `${KIND_LABEL[a.kind]} (${a.occurrences}×)`
                      : KIND_LABEL[a.kind],
                    siteName.get(a.site_id) ?? '—',
                    pointName.get(a.access_point_id) ?? agentName.get(a.edge_agent_id) ?? '—',
                    SEVERITY_LABEL[a.severity],
                    fmt(a.last_at),
                    ALERT_STATUS_LABEL[a.status],
                    <div key={a.id} className="flex flex-wrap gap-2">
                      {canManage(a.site_id) && a.status === 'open' && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() =>
                            call(
                              'acknowledge_alert',
                              { p_alert: a.id },
                              'Alerta reconhecido.',
                              'Não foi possível reconhecer o alerta.',
                            )
                          }
                        >
                          Reconhecer
                        </button>
                      )}
                      {canManage(a.site_id) && a.status !== 'resolved' && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => setNote({ kind: 'alert', id: a.id })}
                        >
                          Resolver
                        </button>
                      )}
                      {canManage(a.site_id) && a.status !== 'resolved' && !a.incident_id && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => setIncidentFor({ alert: a })}
                        >
                          Abrir incidente
                        </button>
                      )}
                    </div>,
                  ])}
                />

                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Incidentes</h2>
                  {allowedInAnyScope('alert:manage') && (
                    <button type="button" className={BTN_GHOST} onClick={() => setIncidentFor({})}>
                      Novo incidente
                    </button>
                  )}
                </div>
                <DataTable
                  caption="Incidentes"
                  headers={['Incidente', 'Local', 'Gravidade', 'Aberto em', 'Situação', 'Ações']}
                  empty="Nenhum incidente."
                  rows={incidents.map((i) => [
                    i.title,
                    siteName.get(i.site_id) ?? '—',
                    SEVERITY_LABEL[i.severity],
                    fmt(i.created_at),
                    INCIDENT_STATUS_LABEL[i.status],
                    <div key={i.id} className="flex flex-wrap gap-2">
                      {canManage(i.site_id) && i.status === 'open' && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() =>
                            call(
                              'update_incident_status',
                              { p_incident: i.id, p_status: 'investigating' },
                              'Incidente em investigação.',
                              'Não foi possível atualizar o incidente.',
                            )
                          }
                        >
                          Investigar
                        </button>
                      )}
                      {canManage(i.site_id) && i.status !== 'closed' && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => setNote({ kind: 'incident', id: i.id })}
                        >
                          Encerrar
                        </button>
                      )}
                    </div>,
                  ])}
                />

                <h2 className="text-lg font-semibold">Ocupação por zona</h2>
                {occupancy ? (
                  <DataTable
                    caption="Ocupação por zona"
                    headers={['Zona', 'Local', 'Presentes']}
                    empty="Nenhuma zona."
                    rows={occupancy.map((z) => [
                      z.zone_name,
                      siteName.get(z.site_id) ?? '—',
                      String(z.present_count),
                    ])}
                  />
                ) : (
                  <p role="status">Sem permissão para ver a ocupação.</p>
                )}

                {incidentFor && (
                  <IncidentModal
                    alert={incidentFor.alert ?? null}
                    sites={sites}
                    onClose={() => setIncidentFor(null)}
                    onDone={() => {
                      setIncidentFor(null);
                      q.reload();
                    }}
                  />
                )}
                {note && (
                  <NoteModal
                    title={note.kind === 'alert' ? 'Resolver alerta' : 'Encerrar incidente'}
                    label={
                      note.kind === 'alert'
                        ? 'Nota de resolução (opcional)'
                        : 'Nota de encerramento (opcional)'
                    }
                    onClose={() => setNote(null)}
                    onSubmit={(text) =>
                      note.kind === 'alert'
                        ? call(
                            'resolve_alert',
                            { p_alert: note.id, p_note: text },
                            'Alerta resolvido.',
                            'Não foi possível resolver o alerta.',
                          )
                        : call(
                            'update_incident_status',
                            { p_incident: note.id, p_status: 'closed', p_note: text },
                            'Incidente encerrado.',
                            'Não foi possível encerrar o incidente.',
                          )
                    }
                  />
                )}
              </>
            );
          }}
        </Status>
      </PageHead>
    </Guard>
  );
}
