import { createContext, useContext, useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataTable } from '../components/DataTable';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
import { validateCardNumber, validatePin, validateTokenDays } from '@zela/domain';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';

export const INPUT =
  'w-full rounded-zela-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm';
const BTN = 'rounded-zela-lg px-3 py-2 text-sm font-semibold';
export const BTN_PRIMARY = `${BTN} bg-primary text-white disabled:opacity-60`;
export const BTN_GHOST = `${BTN} border border-outline-variant text-on-surface`;

const KIND_LABEL = {
  employee: 'Funcionário',
  resident: 'Morador',
  contractor: 'Terceirizado',
  visitor: 'Visitante',
  other: 'Outro',
};
const AGE_LABEL = { adult: 'Adulto', minor: 'Menor de idade' };
const STATUS_LABEL = { active: 'Ativa', inactive: 'Inativa' };

/** @param {{ label: string, children: import('react').ReactNode }} props */
export function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-on-surface">{label}</span>
      {children}
    </label>
  );
}

/** @param {{ title: string, onClose: () => void, children: import('react').ReactNode }} props */
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-900/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-zela-xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className={BTN_GHOST} onClick={onClose}>
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Modo da tela, definido pela rota do menu: 'create' (Cadastro: abre o formulario de novo, lista so para consulta),
 * 'manage' (Gerenciar: lista com editar/excluir, sem criar) ou 'both' (rotas antigas, tudo junto).
 * @type {import('react').Context<'create' | 'manage' | 'both'>}
 */
const PageModeContext = createContext(/** @type {'create' | 'manage' | 'both'} */ ('both'));

/** @param {{ mode: 'create' | 'manage', children: import('react').ReactNode }} props */
export function PageMode({ mode, children }) {
  return <PageModeContext.Provider value={mode}>{children}</PageModeContext.Provider>;
}

export const usePageMode = () => useContext(PageModeContext);

/** @param {{ title: string, canCreate: boolean, onNew: () => void, children: import('react').ReactNode }} props */
export function PageHead({ title, canCreate, onNew, children }) {
  const mode = usePageMode();
  const showNew = canCreate && mode !== 'manage';
  useEffect(() => {
    // Cadastro: a pessoa veio para criar, entao o formulario ja abre (so na entrada da tela).
    if (mode === 'create' && canCreate) onNew();
  }, [mode, canCreate]);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {mode === 'create'
            ? `Cadastro · ${title}`
            : mode === 'manage'
              ? `Gerenciar · ${title}`
              : title}
        </h1>
        {showNew && (
          <button type="button" className={BTN_PRIMARY} onClick={onNew}>
            Novo
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Grava (insert/update) e fecha; erro do banco vira mensagem segura.
 * @param {() => PromiseLike<{ error: any }>} run
 * @param {string} ok
 * @param {() => void} done
 * @param {(b: boolean) => void} setBusy
 */
export async function save(run, ok, done, setBusy) {
  setBusy(true);
  const { error } = await run();
  setBusy(false);
  if (error) return toast.error(safeMessage(error, 'Não foi possível salvar.'));
  toast.success(ok);
  done();
}

/** @param {{ row: any, table: string, label: string, onDone: () => void, onCancel: () => void }} props */
export function DeleteConfirm({ row, table, label, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmModal
      title={`Excluir ${label}`}
      message={`Excluir "${row.name ?? row.full_name}"? Esta ação não pode ser desfeita.`}
      confirmLabel="Excluir"
      isLoading={busy}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        const { error } = await supabase.from(table).delete().eq('id', row.id);
        setBusy(false);
        if (error)
          return toast.error(
            error.code === '23503'
              ? 'Este registro está em uso e não pode ser excluído.'
              : safeMessage(error, 'Não foi possível excluir.'),
          );
        toast.success('Excluído.');
        onDone();
      }}
    />
  );
}

/** @param {{ canEdit: boolean, canDelete: boolean, onEdit: () => void, onDelete: () => void, extra?: import('react').ReactNode }} props */
export function RowActions({ canEdit, canDelete, onEdit, onDelete, extra }) {
  const creating = usePageMode() === 'create'; // Cadastro cria; editar e excluir ficam em Gerenciar
  canEdit = canEdit && !creating;
  canDelete = canDelete && !creating;
  return (
    <div className="flex flex-wrap gap-2">
      {extra}
      {canEdit && (
        <button type="button" className={BTN_GHOST} onClick={onEdit}>
          Editar
        </button>
      )}
      {canDelete && (
        <button type="button" className={`${BTN_GHOST} text-error`} onClick={onDelete}>
          Excluir
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Zonas

function ZoneForm({ zone, sites, buildings, floors, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    site_id: zone?.site_id ?? sites[0]?.id ?? '',
    name: zone?.name ?? '',
    description: zone?.description ?? '',
    is_restricted: zone?.is_restricted ?? false,
    building_id: zone?.building_id ?? '',
    floor_id: zone?.floor_id ?? '',
  });
  const siteBuildings = buildings.filter((b) => b.site_id === f.site_id);
  const buildingFloors = floors.filter((fl) => fl.building_id === f.building_id);
  const submit = (e) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      is_restricted: f.is_restricted,
      building_id: f.building_id || null,
      floor_id: f.building_id && f.floor_id ? f.floor_id : null,
    };
    void save(
      () =>
        zone
          ? supabase.from('zones').update(body).eq('id', zone.id)
          : supabase.from('zones').insert({ ...body, tenant_id: tenantId, site_id: f.site_id }),
      'Zona salva.',
      onDone,
      setBusy,
    );
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!zone && (
        <Field label="Local">
          <select
            className={INPUT}
            required
            value={f.site_id}
            onChange={(e) => setF({ ...f, site_id: e.target.value, building_id: '', floor_id: '' })}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Nome">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={120}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field label="Descrição (opcional)">
        <textarea
          className={INPUT}
          maxLength={500}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
      {siteBuildings.length > 0 && (
        <Field label="Prédio (opcional)">
          <select
            className={INPUT}
            value={f.building_id}
            onChange={(e) => setF({ ...f, building_id: e.target.value, floor_id: '' })}
          >
            <option value="">Sem prédio</option>
            {siteBuildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {f.building_id && buildingFloors.length > 0 && (
        <Field label="Andar (opcional)">
          <select
            className={INPUT}
            value={f.floor_id}
            onChange={(e) => setF({ ...f, floor_id: e.target.value })}
          >
            <option value="">Sem andar</option>
            {buildingFloors.map((fl) => (
              <option key={fl.id} value={fl.id}>
                {fl.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.is_restricted}
          onChange={(e) => setF({ ...f, is_restricted: e.target.checked })}
        />
        Zona restrita
      </label>
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.site_id}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

export function ZonesPage() {
  const { current, allowed } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const tenantId = current?.id ?? '';
    const [z, s, b, fl] = await Promise.all([
      supabase
        .from('zones')
        .select('id, site_id, name, description, is_restricted, building_id, floor_id')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase.from('sites').select('id, name').eq('tenant_id', tenantId).order('name').limit(200),
      supabase
        .from('buildings')
        .select('id, site_id, name')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('floors')
        .select('id, building_id, name')
        .eq('tenant_id', tenantId)
        .order('level')
        .limit(5000),
    ]);
    for (const r of [z, s, b, fl]) if (r.error) throw r.error;
    return { zones: z.data, sites: s.data, buildings: b.data, floors: fl.data };
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="zone:read" siteLevel>
      <PageHead title="Zonas" canCreate={allowed('zone:create')} onNew={() => setEditing({})}>
        <Status q={q}>
          {({ zones, sites, buildings, floors }) => {
            const siteName = new Map(sites.map((s) => [s.id, s.name]));
            const buildingName = new Map(buildings.map((b) => [b.id, b.name]));
            const floorName = new Map(floors.map((fl) => [fl.id, fl.name]));
            return (
              <>
                <DataTable
                  caption="Zonas"
                  headers={['Nome', 'Local', 'Prédio / andar', 'Restrita', 'Ações']}
                  empty="Nenhuma zona cadastrada."
                  rows={zones.map((z) => [
                    z.name,
                    siteName.get(z.site_id) ?? '—',
                    z.building_id
                      ? [buildingName.get(z.building_id), floorName.get(z.floor_id)]
                          .filter(Boolean)
                          .join(' / ')
                      : '—',
                    z.is_restricted ? 'Sim' : 'Não',
                    <RowActions
                      key={z.id}
                      canEdit={allowed('zone:update', z.site_id)}
                      canDelete={allowed('zone:delete', z.site_id)}
                      onEdit={() => setEditing(z)}
                      onDelete={() => setDeleting(z)}
                    />,
                  ])}
                />
                {editing && (
                  <Modal title={editing.id ? 'Editar zona' : 'Nova zona'} onClose={done}>
                    <ZoneForm
                      zone={editing.id ? editing : null}
                      sites={sites}
                      buildings={buildings}
                      floors={floors}
                      tenantId={current?.id ?? ''}
                      onDone={done}
                    />
                  </Modal>
                )}
              </>
            );
          }}
        </Status>
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="zones"
            label="zona"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}

// ---------------------------------------------------------------- Pessoas

function PersonForm({ person, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    full_name: person?.full_name ?? '',
    kind: person?.kind ?? 'employee',
    age_category: person?.age_category ?? 'adult',
    status: person?.status ?? 'active',
    external_ref: person?.external_ref ?? '',
  });
  const submit = (e) => {
    e.preventDefault();
    const body = {
      ...f,
      full_name: f.full_name.trim(),
      external_ref: f.external_ref.trim() || null,
    };
    void save(
      () =>
        person
          ? supabase.from('people').update(body).eq('id', person.id)
          : supabase.from('people').insert({ ...body, tenant_id: tenantId }),
      'Pessoa salva.',
      onDone,
      setBusy,
    );
  };
  const select = (key, labels) => (
    <select
      className={INPUT}
      value={f[key]}
      onChange={(e) => setF({ ...f, [key]: e.target.value })}
    >
      {Object.entries(labels).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nome completo">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={160}
          value={f.full_name}
          onChange={(e) => setF({ ...f, full_name: e.target.value })}
        />
      </Field>
      <Field label="Tipo">{select('kind', KIND_LABEL)}</Field>
      <Field label="Faixa etária">{select('age_category', AGE_LABEL)}</Field>
      <Field label="Situação">{select('status', STATUS_LABEL)}</Field>
      <Field label="Código externo (opcional)">
        <input
          className={INPUT}
          maxLength={80}
          value={f.external_ref}
          onChange={(e) => setF({ ...f, external_ref: e.target.value })}
        />
      </Field>
      <button type="submit" className={BTN_PRIMARY} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Credenciais

const CRED_TYPE_LABEL = { pin: 'PIN', card: 'Cartão', mobile_token: 'Token temporário' };
const CRED_STATUS_LABEL = { active: 'Ativa', suspended: 'Suspensa', revoked: 'Revogada' };

/** @param {{ person: any, tenantId: string, canCreate: boolean, canUpdate: boolean, onClose: () => void }} props */
function CredentialsModal({ person, tenantId, canCreate, canUpdate, onClose }) {
  const [type, setType] = useState('pin');
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [issuedToken, setIssuedToken] = useState(/** @type {string | null} */ (null));
  const [revoking, setRevoking] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('credentials')
      .select('id, type, label, status, hint, expires_at')
      .eq('person_id', person.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  }, [person.id]);

  const issue = async (e) => {
    e.preventDefault();
    const err =
      type === 'pin'
        ? validatePin(secret)
        : type === 'card'
          ? validateCardNumber(secret)
          : validateTokenDays(Number(days));
    if (err) return toast.error(err);
    setBusy(true);
    const { data, error } = await supabase.rpc('issue_credential', {
      p_tenant: tenantId,
      p_person: person.id,
      p_type: type,
      p_secret: type === 'mobile_token' ? null : secret,
      p_label: label.trim() || null,
      p_expires_at:
        type === 'mobile_token'
          ? new Date(Date.now() + Number(days) * 86_400_000).toISOString()
          : null,
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível emitir a credencial.'));
    setSecret('');
    setLabel('');
    setIssuedToken(data?.token ?? null);
    toast.success('Credencial emitida.');
    q.reload();
  };

  const setStatus = async (row, status) => {
    const { error } = await supabase.from('credentials').update({ status }).eq('id', row.id);
    if (error) return toast.error(safeMessage(error, 'Não foi possível alterar a credencial.'));
    q.reload();
  };

  return (
    <Modal title={`Credenciais — ${person.full_name}`} onClose={onClose}>
      <div className="space-y-5">
        {issuedToken && (
          <div role="status" className="rounded-zela-lg border border-outline-variant p-3 text-sm">
            <p className="mb-1 font-semibold">
              Token emitido — copie agora, ele não será exibido de novo.
            </p>
            <code className="block break-all select-all">{issuedToken}</code>
            <button
              type="button"
              className={`${BTN_GHOST} mt-2`}
              onClick={() => setIssuedToken(null)}
            >
              Ocultar
            </button>
          </div>
        )}
        <Status q={q}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Nenhuma credencial.</p>
            ) : (
              <ul className="divide-y divide-outline-variant/60">
                {rows.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      <strong>{CRED_TYPE_LABEL[c.type]}</strong>
                      {c.hint ? ` •••• ${c.hint}` : ''}
                      {c.label ? ` — ${c.label}` : ''}
                      <br />
                      <span className="text-on-surface-variant">
                        {CRED_STATUS_LABEL[c.status]}
                        {c.expires_at
                          ? ` · expira em ${new Date(c.expires_at).toLocaleDateString('pt-BR')}`
                          : ''}
                      </span>
                    </span>
                    {canUpdate && c.status !== 'revoked' && (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() =>
                            setStatus(c, c.status === 'active' ? 'suspended' : 'active')
                          }
                        >
                          {c.status === 'active' ? 'Suspender' : 'Reativar'}
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} text-error`}
                          onClick={() => setRevoking(c)}
                        >
                          Revogar
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Status>
        {canCreate && (
          <form onSubmit={issue} className="space-y-3 border-t border-outline-variant/60 pt-4">
            <h3 className="font-semibold">Emitir credencial</h3>
            <Field label="Tipo">
              <select
                className={INPUT}
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setSecret('');
                }}
              >
                {Object.entries(CRED_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {type === 'pin' && (
              <Field label="PIN (6 a 8 dígitos)">
                <input
                  className={INPUT}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
            )}
            {type === 'card' && (
              <Field label="Número do cartão">
                <input
                  className={INPUT}
                  autoComplete="off"
                  maxLength={48}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
            )}
            {type === 'mobile_token' && (
              <Field label="Validade (dias, máx. 366)">
                <input
                  className={INPUT}
                  type="number"
                  min={1}
                  max={366}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </Field>
            )}
            <Field label="Rótulo (opcional)">
              <input
                className={INPUT}
                maxLength={80}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {busy ? 'Emitindo…' : 'Emitir'}
            </button>
          </form>
        )}
      </div>
      {revoking && (
        <ConfirmModal
          title="Revogar credencial"
          message="A revogação é definitiva: a credencial não poderá ser reativada."
          confirmLabel="Revogar"
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            await setStatus(revoking, 'revoked');
            setRevoking(null);
          }}
        />
      )}
    </Modal>
  );
}

export function PeoplePage() {
  const { current, allowed } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [credsFor, setCredsFor] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('people')
      .select('id, full_name, kind, age_category, status, external_ref')
      .eq('tenant_id', current?.id ?? '')
      .order('full_name')
      .limit(500);
    if (error) throw error;
    return data;
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="person:read">
      <PageHead title="Pessoas" canCreate={allowed('person:create')} onNew={() => setEditing({})}>
        <Status q={q}>
          {(rows) => (
            <DataTable
              caption="Pessoas"
              headers={['Nome', 'Tipo', 'Faixa etária', 'Situação', 'Ações']}
              empty="Nenhuma pessoa cadastrada."
              rows={rows.map((p) => [
                p.full_name,
                KIND_LABEL[p.kind] ?? p.kind,
                AGE_LABEL[p.age_category] ?? p.age_category,
                STATUS_LABEL[p.status] ?? p.status,
                <RowActions
                  key={p.id}
                  canEdit={allowed('person:update')}
                  canDelete={allowed('person:delete')}
                  onEdit={() => setEditing(p)}
                  onDelete={() => setDeleting(p)}
                  extra={
                    allowed('credential:read') && (
                      <button type="button" className={BTN_GHOST} onClick={() => setCredsFor(p)}>
                        Credenciais
                      </button>
                    )
                  }
                />,
              ])}
            />
          )}
        </Status>
        {editing && (
          <Modal title={editing.id ? 'Editar pessoa' : 'Nova pessoa'} onClose={done}>
            <PersonForm
              person={editing.id ? editing : null}
              tenantId={current?.id ?? ''}
              onDone={done}
            />
          </Modal>
        )}
        {credsFor && (
          <CredentialsModal
            person={credsFor}
            tenantId={current?.id ?? ''}
            canCreate={allowed('credential:create')}
            canUpdate={allowed('credential:update')}
            onClose={() => setCredsFor(null)}
          />
        )}
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="people"
            label="pessoa"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}

// ---------------------------------------------------------------- Grupos

function GroupForm({ group, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: group?.name ?? '', description: group?.description ?? '' });
  const submit = (e) => {
    e.preventDefault();
    const body = { name: f.name.trim(), description: f.description.trim() || null };
    void save(
      () =>
        group
          ? supabase.from('access_groups').update(body).eq('id', group.id)
          : supabase.from('access_groups').insert({ ...body, tenant_id: tenantId }),
      'Grupo salvo.',
      onDone,
      setBusy,
    );
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nome">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={120}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field label="Descrição (opcional)">
        <textarea
          className={INPUT}
          maxLength={500}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
      <button type="submit" className={BTN_PRIMARY} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

function GroupMembers({ group, tenantId, canEdit, onClose }) {
  const [pick, setPick] = useState('');
  const q = useQuery(async () => {
    const [m, p] = await Promise.all([
      supabase
        .from('access_group_members')
        .select('person_id')
        .eq('group_id', group.id)
        .limit(1000),
      supabase
        .from('people')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .order('full_name')
        .limit(1000),
    ]);
    if (m.error) throw m.error;
    if (p.error) throw p.error;
    return { memberIds: new Set(m.data.map((r) => r.person_id)), people: p.data };
  }, [group.id, tenantId]);
  const add = async () => {
    if (!pick) return;
    const { error } = await supabase
      .from('access_group_members')
      .insert({ tenant_id: tenantId, group_id: group.id, person_id: pick });
    if (error) return toast.error(safeMessage(error, 'Não foi possível adicionar.'));
    setPick('');
    q.reload();
  };
  const remove = async (personId) => {
    const { error } = await supabase
      .from('access_group_members')
      .delete()
      .eq('group_id', group.id)
      .eq('person_id', personId);
    if (error) return toast.error(safeMessage(error, 'Não foi possível remover.'));
    q.reload();
  };
  return (
    <Modal title={`Membros — ${group.name}`} onClose={onClose}>
      <Status q={q}>
        {({ memberIds, people }) => {
          const inGroup = people.filter((p) => memberIds.has(p.id));
          const available = people.filter((p) => !memberIds.has(p.id));
          return (
            <div className="space-y-4">
              {canEdit && (
                <div className="flex gap-2">
                  <select
                    className={INPUT}
                    aria-label="Pessoa"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                  >
                    <option value="">Selecione uma pessoa…</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={BTN_PRIMARY} disabled={!pick} onClick={add}>
                    Adicionar
                  </button>
                </div>
              )}
              {inGroup.length === 0 ? (
                <p className="text-sm text-on-surface-variant">Nenhuma pessoa no grupo.</p>
              ) : (
                <ul className="divide-y divide-outline-variant/60">
                  {inGroup.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      {p.full_name}
                      {canEdit && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} text-error`}
                          onClick={() => remove(p.id)}
                        >
                          Remover
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </Status>
    </Modal>
  );
}

// ---------------------------------------------------------------- Locais

const TIMEZONES = [
  ['America/Sao_Paulo', 'Brasília (UTC−3)'],
  ['America/Manaus', 'Manaus (UTC−4)'],
  ['America/Cuiaba', 'Cuiabá (UTC−4)'],
  ['America/Rio_Branco', 'Rio Branco (UTC−5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC−2)'],
];

function SiteForm({ site, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: site?.name ?? '',
    timezone: site?.timezone ?? 'America/Sao_Paulo',
    zela_pass_url: site?.zela_pass_url ?? '',
  });
  const submit = (e) => {
    e.preventDefault();
    const url = f.zela_pass_url.trim().replace(/\/+$/, '');
    if (url && !/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?$/.test(url))
      return toast.error('Endereço do Zela Pass: use https://endereço ou https://endereço:porta.');
    const body = { name: f.name.trim(), timezone: f.timezone, zela_pass_url: url || null };
    void save(
      () =>
        site
          ? supabase.from('sites').update(body).eq('id', site.id)
          : supabase.from('sites').insert({ ...body, tenant_id: tenantId }),
      'Local salvo.',
      onDone,
      setBusy,
    );
  };
  const zones = TIMEZONES.some(([tz]) => tz === f.timezone)
    ? TIMEZONES
    : [...TIMEZONES, [f.timezone, f.timezone]];
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nome do local">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={120}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field label="Fuso horário">
        <select
          className={INPUT}
          value={f.timezone}
          onChange={(e) => setF({ ...f, timezone: e.target.value })}
        >
          {zones.map(([tz, text]) => (
            <option key={tz} value={tz}>
              {text}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Endereço do Zela Pass (opcional)">
        <input
          className={INPUT}
          maxLength={200}
          inputMode="url"
          placeholder="https://192.168.0.10:8443"
          value={f.zela_pass_url}
          onChange={(e) => setF({ ...f, zela_pass_url: e.target.value })}
        />
        <span className="mt-1 block text-xs text-on-surface-variant">
          Endereço do computador Edge deste local, na rede dos tablets. Com ele, a tela de Leitores
          gera o link para abrir o Zela Pass.
        </span>
      </Field>
      <button type="submit" className={BTN_PRIMARY} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

export function SitesPage() {
  const { current, allowed } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('sites')
      .select('id, name, timezone, zela_pass_url')
      .eq('tenant_id', current?.id ?? '')
      .order('name')
      .limit(200);
    if (error) throw error;
    return data;
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    q.reload();
  };
  return (
    <Guard permission="site:read" siteLevel>
      <PageHead title="Locais" canCreate={allowed('site:create')} onNew={() => setEditing({})}>
        <Status q={q}>
          {(rows) => (
            <DataTable
              caption="Locais"
              headers={['Nome', 'Fuso horário', 'Ações']}
              empty="Nenhum local cadastrado."
              rows={rows.map((r) => [
                r.name,
                TIMEZONES.find(([tz]) => tz === r.timezone)?.[1] ?? r.timezone,
                <RowActions
                  key={r.id}
                  canEdit={allowed('site:update', r.id)}
                  canDelete={false}
                  onEdit={() => setEditing(r)}
                  onDelete={() => {}}
                />,
              ])}
            />
          )}
        </Status>
        {editing && (
          <Modal title={editing.id ? 'Editar local' : 'Novo local'} onClose={done}>
            <SiteForm
              site={editing.id ? editing : null}
              tenantId={current?.id ?? ''}
              onDone={done}
            />
          </Modal>
        )}
      </PageHead>
    </Guard>
  );
}

export function GroupsPage() {
  const { current, allowed } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [managing, setManaging] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('access_groups')
      .select('id, name, description')
      .eq('tenant_id', current?.id ?? '')
      .order('name')
      .limit(500);
    if (error) throw error;
    return data;
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="group:read">
      <PageHead title="Grupos" canCreate={allowed('group:create')} onNew={() => setEditing({})}>
        <Status q={q}>
          {(rows) => (
            <DataTable
              caption="Grupos de acesso"
              headers={['Nome', 'Descrição', 'Ações']}
              empty="Nenhum grupo cadastrado."
              rows={rows.map((g) => [
                g.name,
                g.description ?? '—',
                <RowActions
                  key={g.id}
                  canEdit={allowed('group:update')}
                  canDelete={allowed('group:delete')}
                  onEdit={() => setEditing(g)}
                  onDelete={() => setDeleting(g)}
                  extra={
                    <button type="button" className={BTN_GHOST} onClick={() => setManaging(g)}>
                      Membros
                    </button>
                  }
                />,
              ])}
            />
          )}
        </Status>
        {editing && (
          <Modal title={editing.id ? 'Editar grupo' : 'Novo grupo'} onClose={done}>
            <GroupForm
              group={editing.id ? editing : null}
              tenantId={current?.id ?? ''}
              onDone={done}
            />
          </Modal>
        )}
        {managing && (
          <GroupMembers
            group={managing}
            tenantId={current?.id ?? ''}
            canEdit={allowed('group:update')}
            onClose={() => setManaging(null)}
          />
        )}
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="access_groups"
            label="grupo"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}
