import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataTable } from '../components/DataTable';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
import {
  VISIT_MAX_ZONES,
  VISIT_NOTICE_TEXT,
  VISIT_NOTICE_VERSION,
  VISIT_STATUS_LABEL,
  canCheckInNow,
  normalizePlate,
  validatePlate,
  validateVisitWindow,
} from '@zela/domain';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT, Modal, PageHead } from './RegistryPages';

const fmt = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** `datetime-local` (hora local do navegador) a partir de um Date. */
const localInput = (d) => {
  const p = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return p.toISOString().slice(0, 16);
};

/** QR em SVG montado módulo a módulo (sem HTML injetado). @param {{ text: string }} props */
function Qr({ text }) {
  const { n, dark } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: count + 8, dark: d };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label="QR code"
      viewBox={`0 0 ${n} ${n}`}
      className="mx-auto h-48 w-48 bg-white"
      shapeRendering="crispEdges"
    >
      <path d={dark} fill="#000" />
    </svg>
  );
}

/** Segredo mostrado uma única vez, em texto e QR. */
function SecretModal({ title, intro, token, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <p role="note" className="rounded-zela-lg bg-amber-50 p-3 text-sm text-amber-900">
          {intro} Ele é mostrado uma única vez: não fica guardado de forma legível.
        </p>
        <Qr text={token} />
        <code className="block break-all text-center text-xs select-all">{token}</code>
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() =>
            navigator.clipboard?.writeText(token).then(
              () => toast.success('Copiado.'),
              () => toast.error('Não foi possível copiar.'),
            )
          }
        >
          Copiar
        </button>
      </div>
    </Modal>
  );
}

function VisitForm({ sites, hosts, zones, tenantId, onCreated, onClose }) {
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const [f, setF] = useState({
    site_id: sites[0]?.id ?? '',
    host: '',
    name: '',
    company: '',
    doc: '',
    plate: '',
    companions: 0,
    purpose: '',
    from: localInput(now),
    until: localInput(new Date(now.getTime() + 4 * 3_600_000)),
    zone_ids: /** @type {string[]} */ ([]),
  });
  const siteZones = zones.filter((z) => z.site_id === f.site_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleZone = (id) =>
    setF({
      ...f,
      zone_ids: f.zone_ids.includes(id) ? f.zone_ids.filter((z) => z !== id) : [...f.zone_ids, id],
    });

  const submit = async (e) => {
    e.preventDefault();
    const plate = normalizePlate(f.plate);
    const err =
      validateVisitWindow(new Date(f.from), new Date(f.until)) ??
      validatePlate(plate) ??
      (f.zone_ids.length === 0 ? 'Escolha ao menos uma zona.' : null) ??
      (f.zone_ids.length > VISIT_MAX_ZONES ? 'Zonas demais.' : null);
    if (err) return toast.error(err);
    setBusy(true);
    const { data, error } = await supabase.rpc('create_visit', {
      p_tenant: tenantId,
      p_site: f.site_id,
      p_host: f.host,
      p_visitor_name: f.name.trim(),
      p_valid_from: new Date(f.from).toISOString(),
      p_valid_until: new Date(f.until).toISOString(),
      p_zone_ids: f.zone_ids,
      p_company: f.company.trim() || null,
      p_document_hint: f.doc.trim() || null,
      p_vehicle_plate: plate,
      p_companions: Number(f.companions) || 0,
      p_purpose: f.purpose.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível criar o convite.'));
    onCreated(data?.token ?? null);
  };

  return (
    <Modal title="Novo convite" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Local">
          <select
            className={INPUT}
            required
            value={f.site_id}
            onChange={(e) => setF({ ...f, site_id: e.target.value, zone_ids: [] })}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anfitrião">
          <select className={INPUT} required value={f.host} onChange={set('host')}>
            <option value="">Selecione…</option>
            {hosts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome do visitante">
          <input
            className={INPUT}
            required
            minLength={2}
            maxLength={120}
            value={f.name}
            onChange={set('name')}
          />
        </Field>
        <Field label="Empresa (opcional)">
          <input className={INPUT} maxLength={120} value={f.company} onChange={set('company')} />
        </Field>
        <Field label="Documento: últimos 4 caracteres (opcional)">
          <input className={INPUT} maxLength={4} value={f.doc} onChange={set('doc')} />
        </Field>
        <Field label="Placa do veículo (opcional)">
          <input className={INPUT} maxLength={10} value={f.plate} onChange={set('plate')} />
        </Field>
        <Field label="Acompanhantes">
          <input
            className={INPUT}
            type="number"
            min={0}
            max={20}
            value={f.companions}
            onChange={set('companions')}
          />
        </Field>
        <Field label="Motivo (opcional)">
          <input className={INPUT} maxLength={200} value={f.purpose} onChange={set('purpose')} />
        </Field>
        <Field label="Início">
          <input
            className={INPUT}
            type="datetime-local"
            required
            value={f.from}
            onChange={set('from')}
          />
        </Field>
        <Field label="Fim">
          <input
            className={INPUT}
            type="datetime-local"
            required
            value={f.until}
            onChange={set('until')}
          />
        </Field>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium">Zonas permitidas</legend>
          {siteZones.length === 0 && <p>Este local não tem zonas cadastradas.</p>}
          {siteZones.map((z) => (
            <label key={z.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.zone_ids.includes(z.id)}
                onChange={() => toggleZone(z.id)}
              />
              {z.name}
            </label>
          ))}
        </fieldset>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.host}>
          {busy ? 'Criando…' : 'Criar convite'}
        </button>
      </form>
    </Modal>
  );
}

/** Check-in por token (campo) ou por visita já escolhida na lista. */
function CheckInForm({ tenantId, visit, onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [ack, setAck] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('check_in_visit', {
      p_tenant: tenantId,
      p_visit: visit?.id ?? null,
      p_token: visit ? null : token.trim(),
      p_notice_version: VISIT_NOTICE_VERSION,
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível fazer o check-in.'));
    onDone(data?.token ?? null);
  };

  return (
    <Modal title="Check-in de visitante" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {visit ? (
          <p className="text-sm">
            Visitante: <strong>{visit.visitor_name}</strong>
          </p>
        ) : (
          <Field label="Token do convite (QR)">
            <input
              className={INPUT}
              required
              autoFocus
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
        )}
        <p className="rounded-zela-lg bg-surface-container p-3 text-sm">
          {VISIT_NOTICE_TEXT} <em>(Texto provisório, pendente de validação jurídica.)</em>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          Visitante ciente do aviso de privacidade
        </label>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !ack || (!visit && !token)}>
          {busy ? 'Registrando…' : 'Registrar entrada'}
        </button>
      </form>
    </Modal>
  );
}

export function VisitsPage() {
  const { current, allowed, allowedInAnyScope } = useWorkspace();
  const tenantId = current?.id ?? '';
  const [creating, setCreating] = useState(false);
  const [checkIn, setCheckIn] = useState(/** @type {any} */ (null)); // {} = por token; visita = por linha
  const [confirm, setConfirm] = useState(/** @type {any} */ (null)); // { kind, visit }
  const [secret, setSecret] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);

  const q = useQuery(async () => {
    const [v, vz, s, z, p] = await Promise.all([
      supabase
        .from('visits')
        .select(
          'id, site_id, host_person_id, visitor_name, company, vehicle_plate, companions, valid_from, valid_until, status, checked_in_at, checked_out_at',
        )
        .eq('tenant_id', tenantId)
        .order('valid_from', { ascending: false })
        .limit(500),
      supabase
        .from('visit_zones')
        .select('visit_id, zone_id')
        .eq('tenant_id', tenantId)
        .limit(5000),
      supabase.from('sites').select('id, name').eq('tenant_id', tenantId).order('name').limit(500),
      supabase
        .from('zones')
        .select('id, site_id, name')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('people')
        .select('id, full_name, kind, status')
        .eq('tenant_id', tenantId)
        .order('full_name')
        .limit(500),
    ]);
    for (const r of [v, vz, s]) if (r.error) throw r.error;
    // Sem permissão de pessoas/zonas: segue sem os seletores (nomes viram "—").
    return {
      visits: v.data,
      links: vz.data,
      sites: s.data,
      zones: z.error ? [] : z.data,
      people: p.error ? [] : p.data,
    };
  }, [tenantId]);

  const reload = () => q.reload();

  const run = async (name, args, ok, fail) => {
    setBusy(true);
    const { error } = await supabase.rpc(name, args);
    setBusy(false);
    setConfirm(null);
    if (error) return toast.error(safeMessage(error, fail));
    toast.success(ok);
    reload();
  };

  return (
    <Guard permission="visit:read" siteLevel>
      <PageHead
        title="Visitantes"
        canCreate={allowedInAnyScope('visit:create')}
        onNew={() => setCreating(true)}
      >
        {allowedInAnyScope('visit:checkin') && (
          <div>
            <button type="button" className={BTN_GHOST} onClick={() => setCheckIn({})}>
              Check-in por token
            </button>
          </div>
        )}
        <Status q={q}>
          {({ visits, links, sites, zones, people }) => {
            const names = (list, key = 'name') => new Map(list.map((x) => [x.id, x[key]]));
            const siteName = names(sites);
            const zoneName = names(zones);
            const personName = names(people, 'full_name');
            const zonesOf = new Map();
            for (const l of links) {
              zonesOf.set(l.visit_id, [...(zonesOf.get(l.visit_id) ?? []), l.zone_id]);
            }
            const hosts = people.filter((p) => p.status === 'active' && p.kind !== 'visitor');
            return (
              <>
                <DataTable
                  caption="Visitantes"
                  headers={[
                    'Visitante',
                    'Anfitrião',
                    'Local',
                    'Zonas',
                    'Período',
                    'Situação',
                    'Ações',
                  ]}
                  empty="Nenhum visitante cadastrado."
                  rows={visits.map((v) => [
                    v.company ? `${v.visitor_name} (${v.company})` : v.visitor_name,
                    personName.get(v.host_person_id) ?? '—',
                    siteName.get(v.site_id) ?? '—',
                    (zonesOf.get(v.id) ?? []).map((id) => zoneName.get(id) ?? '—').join(', ') ||
                      '—',
                    `${fmt(v.valid_from)} – ${fmt(v.valid_until)}`,
                    VISIT_STATUS_LABEL[v.status],
                    <div key={v.id} className="flex flex-wrap gap-2">
                      {allowed('visit:checkin', v.site_id) && canCheckInNow(v) && (
                        <button type="button" className={BTN_GHOST} onClick={() => setCheckIn(v)}>
                          Check-in
                        </button>
                      )}
                      {allowed('visit:checkin', v.site_id) && v.status === 'checked_in' && (
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => setConfirm({ kind: 'out', visit: v })}
                        >
                          Check-out
                        </button>
                      )}
                      {allowed('visit:update', v.site_id) && v.status === 'invited' && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} text-error`}
                          onClick={() => setConfirm({ kind: 'cancel', visit: v })}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>,
                  ])}
                />
                {creating && (
                  <VisitForm
                    sites={sites}
                    hosts={hosts}
                    zones={zones}
                    tenantId={tenantId}
                    onClose={() => setCreating(false)}
                    onCreated={(token) => {
                      setCreating(false);
                      reload();
                      if (token) setSecret({ kind: 'invite', token });
                    }}
                  />
                )}
              </>
            );
          }}
        </Status>
      </PageHead>
      {checkIn && (
        <CheckInForm
          tenantId={tenantId}
          visit={checkIn.id ? checkIn : null}
          onClose={() => setCheckIn(null)}
          onDone={(token) => {
            setCheckIn(null);
            reload();
            toast.success('Entrada registrada.');
            if (token) setSecret({ kind: 'badge', token });
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'out' ? 'Registrar saída' : 'Cancelar convite'}
          message={
            confirm.kind === 'out'
              ? `Registrar a saída de "${confirm.visit.visitor_name}"? A credencial será revogada.`
              : `Cancelar o convite de "${confirm.visit.visitor_name}"?`
          }
          confirmLabel={confirm.kind === 'out' ? 'Registrar saída' : 'Cancelar convite'}
          isLoading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            confirm.kind === 'out'
              ? run(
                  'check_out_visit',
                  { p_tenant: tenantId, p_visit: confirm.visit.id },
                  'Saída registrada.',
                  'Não foi possível registrar a saída.',
                )
              : run(
                  'cancel_visit',
                  { p_tenant: tenantId, p_visit: confirm.visit.id },
                  'Convite cancelado.',
                  'Não foi possível cancelar.',
                )
          }
        />
      )}
      {secret && (
        <SecretModal
          title={secret.kind === 'invite' ? 'Convite criado' : 'Credencial do visitante'}
          intro={
            secret.kind === 'invite'
              ? 'Entregue este QR/token ao visitante para o check-in.'
              : 'Entregue este QR/token ao visitante como credencial de acesso.'
          }
          token={secret.token}
          onClose={() => setSecret(null)}
        />
      )}
    </Guard>
  );
}
