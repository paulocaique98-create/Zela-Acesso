import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { safeMessage } from '../lib/errors';
import { useQuery } from '../lib/useQuery';
import {
  ACCESS_POINT_DIRECTIONS,
  ACCESS_POINT_DIRECTION_LABEL,
  ACCESS_POINT_TYPES,
  ACCESS_POINT_TYPE_LABEL,
  DOOR_OPEN_TIMEOUT_MAX,
  DOOR_OPEN_TIMEOUT_MIN,
  EMERGENCY_BEHAVIORS,
  EMERGENCY_BEHAVIOR_LABEL,
  HARDWARE_REF_MAX,
  OFFLINE_BEHAVIORS,
  OFFLINE_BEHAVIOR_LABEL,
  POINT_ACTUATIONS,
  POINT_SECOND_FACTORS,
  POINT_SECOND_FACTOR_LABEL,
  POINT_ACTUATION_LABEL,
  accessPointWarnings,
  validateDoorOpenTimeout,
} from '@zela/domain';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  DeleteConfirm,
  Field,
  INPUT,
  Modal,
  PageHead,
  RowActions,
  save,
} from './RegistryPages';

// ---------------------------------------------------------------- Prédios e andares (opcionais)

function BuildingForm({ building, sites, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    site_id: building?.site_id ?? sites[0]?.id ?? '',
    name: building?.name ?? '',
    description: building?.description ?? '',
  });
  const submit = (e) => {
    e.preventDefault();
    const body = { name: f.name.trim(), description: f.description.trim() || null };
    void save(
      () =>
        building
          ? supabase.from('buildings').update(body).eq('id', building.id)
          : supabase.from('buildings').insert({ ...body, tenant_id: tenantId, site_id: f.site_id }),
      'Prédio salvo.',
      onDone,
      setBusy,
    );
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!building && (
        <Field label="Local">
          <select
            className={INPUT}
            required
            value={f.site_id}
            onChange={(e) => setF({ ...f, site_id: e.target.value })}
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
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.site_id}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

function FloorsModal({ building, tenantId, canCreate, canDelete, onClose }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('0');
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('floors')
      .select('id, name, level')
      .eq('building_id', building.id)
      .order('level')
      .limit(300);
    if (error) throw error;
    return data;
  }, [building.id]);

  const add = (e) => {
    e.preventDefault();
    void save(
      () =>
        supabase.from('floors').insert({
          tenant_id: tenantId,
          site_id: building.site_id,
          building_id: building.id,
          name: name.trim(),
          level: Number(level),
        }),
      'Andar adicionado.',
      () => {
        setName('');
        setLevel('0');
        q.reload();
      },
      setBusy,
    );
  };
  const remove = async (floor) => {
    const { error } = await supabase.from('floors').delete().eq('id', floor.id);
    if (error)
      return toast.error(
        error.code === '23503'
          ? 'Este andar está em uso por uma zona e não pode ser excluído.'
          : safeMessage(error, 'Não foi possível excluir.'),
      );
    toast.success('Andar excluído.');
    q.reload();
  };

  return (
    <Modal title={`Andares — ${building.name}`} onClose={onClose}>
      <Status q={q}>
        {(floors) => (
          <DataTable
            caption="Andares"
            headers={['Nome', 'Nível', 'Ações']}
            empty="Nenhum andar cadastrado."
            rows={floors.map((fl) => [
              fl.name,
              String(fl.level),
              canDelete ? (
                <button
                  key={fl.id}
                  type="button"
                  className={`${BTN_GHOST} text-error`}
                  onClick={() => void remove(fl)}
                >
                  Excluir
                </button>
              ) : (
                '—'
              ),
            ])}
          />
        )}
      </Status>
      {canCreate && (
        <form onSubmit={add} className="mt-4 space-y-3 border-t border-outline-variant pt-4">
          <Field label="Nome do andar">
            <input
              className={INPUT}
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Nível (0 = térreo; negativo = subsolo)">
            <input
              className={INPUT}
              type="number"
              required
              min={-20}
              max={200}
              step={1}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
          </Field>
          <button type="submit" className={BTN_PRIMARY} disabled={busy}>
            {busy ? 'Salvando…' : 'Adicionar andar'}
          </button>
        </form>
      )}
    </Modal>
  );
}

export function BuildingsPage() {
  const { current, allowed } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [floorsOf, setFloorsOf] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const tenantId = current?.id ?? '';
    const [b, f, s] = await Promise.all([
      supabase
        .from('buildings')
        .select('id, site_id, name, description')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase.from('floors').select('building_id').eq('tenant_id', tenantId).limit(5000),
      supabase.from('sites').select('id, name').eq('tenant_id', tenantId).order('name').limit(200),
    ]);
    if (b.error) throw b.error;
    if (f.error) throw f.error;
    if (s.error) throw s.error;
    return { buildings: b.data, floors: f.data, sites: s.data };
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    setFloorsOf(null);
    q.reload();
  };
  return (
    <Guard permission="zone:read" siteLevel>
      <PageHead
        title="Prédios e andares"
        canCreate={allowed('zone:create')}
        onNew={() => setEditing({})}
      >
        <p className="text-sm text-on-surface-variant">
          Opcional: use para organizar zonas em organizações com vários prédios ou andares. Uma zona
          continua válida sem prédio.
        </p>
        <Status q={q}>
          {({ buildings, floors, sites }) => {
            const siteName = new Map(sites.map((s) => [s.id, s.name]));
            const count = new Map();
            for (const fl of floors)
              count.set(fl.building_id, (count.get(fl.building_id) ?? 0) + 1);
            return (
              <>
                <DataTable
                  caption="Prédios"
                  headers={['Nome', 'Local', 'Andares', 'Ações']}
                  empty="Nenhum prédio cadastrado."
                  rows={buildings.map((b) => [
                    b.name,
                    siteName.get(b.site_id) ?? '—',
                    String(count.get(b.id) ?? 0),
                    <RowActions
                      key={b.id}
                      canEdit={allowed('zone:update', b.site_id)}
                      canDelete={allowed('zone:delete', b.site_id)}
                      onEdit={() => setEditing(b)}
                      onDelete={() => setDeleting(b)}
                      extra={
                        <button type="button" className={BTN_GHOST} onClick={() => setFloorsOf(b)}>
                          Andares
                        </button>
                      }
                    />,
                  ])}
                />
                {editing && (
                  <Modal title={editing.id ? 'Editar prédio' : 'Novo prédio'} onClose={done}>
                    <BuildingForm
                      building={editing.id ? editing : null}
                      sites={sites}
                      tenantId={current?.id ?? ''}
                      onDone={done}
                    />
                  </Modal>
                )}
                {floorsOf && (
                  <FloorsModal
                    building={floorsOf}
                    tenantId={current?.id ?? ''}
                    canCreate={allowed('zone:create', floorsOf.site_id)}
                    canDelete={allowed('zone:delete', floorsOf.site_id)}
                    onClose={done}
                  />
                )}
              </>
            );
          }}
        </Status>
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="buildings"
            label="prédio"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}

// ---------------------------------------------------------------- Pontos de acesso

const STATUS_LABEL = { active: 'Ativo', inactive: 'Inativo' };

function AccessPointForm({ point, sites, zones, schedules, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const firstSite = point?.site_id ?? sites[0]?.id ?? '';
  const [f, setF] = useState({
    site_id: firstSite,
    zone_id: point?.zone_id ?? zones.find((z) => z.site_id === firstSite)?.id ?? '',
    name: point?.name ?? '',
    description: point?.description ?? '',
    type: point?.type ?? 'door',
    direction: point?.direction ?? 'bidirectional',
    status: point?.status ?? 'active',
    actuation: point?.actuation ?? 'driver',
    second_factor: point?.second_factor ?? 'none',
    controller_ref: point?.controller_ref ?? '',
    entry_reader_ref: point?.entry_reader_ref ?? '',
    exit_reader_ref: point?.exit_reader_ref ?? '',
    sensor_ref: point?.sensor_ref ?? '',
    relay_ref: point?.relay_ref ?? '',
    schedule_id: point?.schedule_id ?? '',
    emergency_behavior: point?.emergency_behavior ?? 'fail_safe',
    offline_behavior: point?.offline_behavior ?? 'degraded_deny',
    door_open_timeout_seconds: String(point?.door_open_timeout_seconds ?? 30),
  });
  const siteZones = zones.filter((z) => z.site_id === f.site_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ref = (k) => f[k].trim() || null;
  const warnings = accessPointWarnings(f);

  const submit = (e) => {
    e.preventDefault();
    const timeout = Number(f.door_open_timeout_seconds);
    const invalid = validateDoorOpenTimeout(timeout);
    if (invalid) return toast.error(invalid);
    const body = {
      zone_id: f.zone_id,
      name: f.name.trim(),
      description: f.description.trim() || null,
      type: f.type,
      direction: f.direction,
      status: f.status,
      actuation: f.actuation,
      second_factor: f.second_factor,
      controller_ref: ref('controller_ref'),
      entry_reader_ref: ref('entry_reader_ref'),
      exit_reader_ref: ref('exit_reader_ref'),
      sensor_ref: ref('sensor_ref'),
      relay_ref: ref('relay_ref'),
      schedule_id: f.schedule_id || null,
      emergency_behavior: f.emergency_behavior,
      offline_behavior: f.offline_behavior,
      door_open_timeout_seconds: timeout,
    };
    void save(
      () =>
        point
          ? supabase.from('access_points').update(body).eq('id', point.id)
          : supabase
              .from('access_points')
              .insert({ ...body, tenant_id: tenantId, site_id: f.site_id }),
      'Ponto de acesso salvo.',
      onDone,
      setBusy,
    );
  };

  const select = (label, key, values, labels) => (
    <Field label={label}>
      <select className={INPUT} value={f[key]} onChange={set(key)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]}
          </option>
        ))}
      </select>
    </Field>
  );
  const refInput = (label, key) => (
    <Field label={`${label} (opcional)`}>
      <input
        className={INPUT}
        maxLength={HARDWARE_REF_MAX}
        value={f[key]}
        onChange={set(key)}
        placeholder="Identificação descritiva"
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-3">
      {!point && (
        <Field label="Local">
          <select
            className={INPUT}
            required
            value={f.site_id}
            onChange={(e) =>
              setF({
                ...f,
                site_id: e.target.value,
                zone_id: zones.find((z) => z.site_id === e.target.value)?.id ?? '',
              })
            }
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Zona">
        <select className={INPUT} required value={f.zone_id} onChange={set('zone_id')}>
          {siteZones.length === 0 && <option value="">Nenhuma zona neste local</option>}
          {siteZones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nome">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={120}
          value={f.name}
          onChange={set('name')}
        />
      </Field>
      <Field label="Descrição (opcional)">
        <textarea
          className={INPUT}
          maxLength={500}
          value={f.description}
          onChange={set('description')}
        />
      </Field>
      {select('Tipo', 'type', ACCESS_POINT_TYPES, ACCESS_POINT_TYPE_LABEL)}
      {select('Direção', 'direction', ACCESS_POINT_DIRECTIONS, ACCESS_POINT_DIRECTION_LABEL)}
      {select('Situação', 'status', ['active', 'inactive'], STATUS_LABEL)}
      {select('Modo do ponto', 'actuation', POINT_ACTUATIONS, POINT_ACTUATION_LABEL)}
      {f.actuation === 'none' && (
        <p role="note" className="text-sm text-on-surface-variant">
          Somente registro: o ponto identifica e registra a entrada/saída (por exemplo, num leitor
          Zela Pass), mas nunca envia comando para porta, catraca ou cancela.
        </p>
      )}
      {select(
        'Segundo fator (facial)',
        'second_factor',
        POINT_SECOND_FACTORS,
        POINT_SECOND_FACTOR_LABEL,
      )}
      {f.second_factor === 'pin' && (
        <p role="note" className="text-sm text-on-surface-variant">
          Quem entra pelo facial precisa também digitar a própria senha (PIN). Recomendado em áreas
          críticas enquanto a proteção contra foto ou tela diante da câmera não tiver sido validada.
        </p>
      )}
      <Field label="Janela de acesso (opcional)">
        <select className={INPUT} value={f.schedule_id} onChange={set('schedule_id')}>
          <option value="">Sem janela (sempre)</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {select(
        'Comportamento em emergência',
        'emergency_behavior',
        EMERGENCY_BEHAVIORS,
        EMERGENCY_BEHAVIOR_LABEL,
      )}
      {select(
        'Comportamento sem conexão',
        'offline_behavior',
        OFFLINE_BEHAVIORS,
        OFFLINE_BEHAVIOR_LABEL,
      )}
      <Field label="Tempo de porta aberta (segundos)">
        <input
          className={INPUT}
          type="number"
          required
          min={DOOR_OPEN_TIMEOUT_MIN}
          max={DOOR_OPEN_TIMEOUT_MAX}
          step={1}
          value={f.door_open_timeout_seconds}
          onChange={set('door_open_timeout_seconds')}
        />
      </Field>
      {warnings.map((w) => (
        <p key={w} role="note" className="rounded-zela-lg bg-amber-50 p-3 text-sm text-amber-900">
          {w}
        </p>
      ))}
      <fieldset className="space-y-3 rounded-zela-lg border border-outline-variant p-3">
        <legend className="px-1 text-sm font-medium">Hardware (rótulos descritivos)</legend>
        <p className="text-xs text-on-surface-variant">
          Só identificação para o instalador. A ligação com dispositivos reais vem com o agente
          local.
        </p>
        {refInput('Controlador', 'controller_ref')}
        {refInput('Leitor de entrada', 'entry_reader_ref')}
        {refInput('Leitor de saída', 'exit_reader_ref')}
        {refInput('Sensor', 'sensor_ref')}
        {refInput('Relé', 'relay_ref')}
      </fieldset>
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.zone_id}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

const COMMAND_STATUS_LABEL = {
  pending: 'Aguardando o agente',
  delivered: 'Entregue ao agente',
  executed: 'Executado',
  failed: 'Falhou',
  rejected: 'Rejeitado pelo agente',
  expired: 'Expirado',
};

const UNLOCK_ERRORS = {
  no_agent: 'Não há agente Edge ativo neste local para executar o comando.',
  busy: 'Já existe um comando em andamento neste ponto. Aguarde o resultado.',
  invalid_command: 'Dados do comando inválidos ou ponto inativo.',
};

/** Pedido de abertura/travamento remoto: o banco registra e audita; o agente Edge verifica a assinatura e aciona o ponto. */
function CommandForm({ point, action, onDone }) {
  const locking = action === 'lock';
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('request_device_command', {
      p_access_point: point.id,
      p_action: action,
      p_duration_ms: null,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      return toast.error(
        UNLOCK_ERRORS[error.message] ?? safeMessage(error, 'Não foi possível enviar o pedido.'),
      );
    }
    toast.success('Pedido enviado. O resultado aparece em "Comandos recentes".');
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-on-surface-variant">
        {locking ? 'Travamento remoto' : 'Abertura remota'} de <strong>{point.name}</strong>. O
        pedido fica registrado na auditoria com o seu usuário e o motivo, e vale por poucos segundos
        após a entrega ao agente.{' '}
        {locking &&
          'Travar não impede a saída: a saída livre depende do hardware do ponto, não deste comando.'}
      </p>
      <Field label="Motivo (3 a 300 caracteres)">
        <input
          className={INPUT}
          required
          minLength={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || reason.trim().length < 3}>
          {busy ? 'Enviando…' : locking ? 'Travar ponto' : 'Abrir ponto'}
        </button>
      </div>
    </form>
  );
}

const fetchRecentCommands = (tenantId) =>
  supabase
    .from('device_commands')
    .select('id, access_point_id, action, status, reason, result_code, requested_at')
    .eq('tenant_id', tenantId)
    .order('requested_at', { ascending: false })
    .limit(10);

const COMMAND_ACTION_LABEL = { unlock: 'Abrir', lock: 'Travar' };
const OPEN_COMMAND = ['pending', 'delivered'];

export function AccessPointsPage() {
  const { current, allowed, allowedInAnyScope } = useWorkspace();
  const [commanding, setCommanding] = useState(/** @type {any} */ (null)); // { point, action }
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [freshCommands, setFreshCommands] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const tenantId = current?.id ?? '';
    const [p, z, s, sc] = await Promise.all([
      supabase
        .from('access_points')
        .select(
          'id, site_id, zone_id, name, description, type, direction, status, controller_ref, entry_reader_ref, exit_reader_ref, sensor_ref, relay_ref, schedule_id, emergency_behavior, offline_behavior, door_open_timeout_seconds, actuation, second_factor',
        )
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('zones')
        .select('id, site_id, name')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase.from('sites').select('id, name').eq('tenant_id', tenantId).order('name').limit(200),
      supabase
        .from('access_schedules')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
    ]);
    for (const r of [p, z, s]) if (r.error) throw r.error;
    // Quem não tem device:command recebe lista vazia pela RLS; falha aqui não derruba a página.
    const cmd = await fetchRecentCommands(tenantId);
    // Quem gerencia pontos mas não lê janelas (sem schedule:read) segue sem o seletor de janela.
    return {
      points: p.data,
      zones: z.data,
      sites: s.data,
      schedules: sc.error ? [] : sc.data,
      commands: cmd.error ? [] : cmd.data,
    };
  }, [current?.id]);
  // Enquanto houver comando em aberto, atualiza só a lista de comandos (sem recarregar a página nem fechar o modal).
  const shown = freshCommands ?? q.data?.commands ?? [];
  const hasOpen = shown.some((c) => OPEN_COMMAND.includes(c.status));
  useEffect(() => {
    if (!hasOpen) return undefined;
    const t = setInterval(async () => {
      const r = await fetchRecentCommands(current?.id ?? '');
      if (!r.error) setFreshCommands(r.data);
    }, 4000);
    return () => clearInterval(t);
  }, [hasOpen, current?.id]);
  const done = () => {
    setFreshCommands(null);
    setCommanding(null);
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="access_point:read" siteLevel>
      <PageHead
        title="Pontos de acesso"
        canCreate={allowedInAnyScope('access_point:create')}
        onNew={() => setEditing({})}
      >
        <Status q={q}>
          {({ points, zones, sites, schedules }) => {
            const pointName = new Map(points.map((p) => [p.id, p.name]));
            const siteName = new Map(sites.map((s) => [s.id, s.name]));
            const zoneName = new Map(zones.map((z) => [z.id, z.name]));
            const scheduleName = new Map(schedules.map((s) => [s.id, s.name]));
            return (
              <>
                <DataTable
                  caption="Pontos de acesso"
                  headers={[
                    'Nome',
                    'Tipo',
                    'Local / zona',
                    'Direção',
                    'Modo',
                    'Janela',
                    'Situação',
                    'Ações',
                  ]}
                  empty="Nenhum ponto de acesso cadastrado."
                  rows={points.map((p) => [
                    p.name,
                    ACCESS_POINT_TYPE_LABEL[p.type],
                    `${siteName.get(p.site_id) ?? '—'} / ${zoneName.get(p.zone_id) ?? '—'}`,
                    ACCESS_POINT_DIRECTION_LABEL[p.direction],
                    p.actuation === 'none' ? 'Somente registro' : 'Com atuação',
                    p.schedule_id ? (scheduleName.get(p.schedule_id) ?? '—') : 'Sem janela',
                    STATUS_LABEL[p.status],
                    <RowActions
                      key={p.id}
                      canEdit={allowed('access_point:update', p.site_id)}
                      canDelete={allowed('access_point:delete', p.site_id)}
                      onEdit={() => setEditing(p)}
                      onDelete={() => setDeleting(p)}
                      extra={
                        p.status === 'active' && allowed('device:command', p.site_id) ? (
                          <>
                            <button
                              type="button"
                              className={BTN_GHOST}
                              onClick={() => setCommanding({ point: p, action: 'unlock' })}
                            >
                              Abrir remotamente
                            </button>
                            <button
                              type="button"
                              className={BTN_GHOST}
                              onClick={() => setCommanding({ point: p, action: 'lock' })}
                            >
                              Travar remotamente
                            </button>
                          </>
                        ) : null
                      }
                    />,
                  ])}
                />
                {shown.length > 0 && (
                  <DataTable
                    caption="Comandos recentes"
                    headers={['Quando', 'Ponto', 'Ação', 'Motivo', 'Situação']}
                    empty=""
                    rows={shown.map((c) => [
                      new Date(c.requested_at).toLocaleString('pt-BR'),
                      pointName.get(c.access_point_id) ?? '—',
                      COMMAND_ACTION_LABEL[c.action] ?? c.action,
                      c.reason,
                      `${COMMAND_STATUS_LABEL[c.status] ?? c.status}${c.result_code ? ` (${c.result_code})` : ''}`,
                    ])}
                  />
                )}
                {commanding && (
                  <Modal
                    title={
                      commanding.action === 'lock'
                        ? 'Travar ponto remotamente'
                        : 'Abrir ponto remotamente'
                    }
                    onClose={done}
                  >
                    <CommandForm
                      point={commanding.point}
                      action={commanding.action}
                      onDone={done}
                    />
                  </Modal>
                )}
                {editing && (
                  <Modal
                    title={editing.id ? 'Editar ponto de acesso' : 'Novo ponto de acesso'}
                    onClose={done}
                  >
                    <AccessPointForm
                      point={editing.id ? editing : null}
                      sites={sites}
                      zones={zones}
                      schedules={schedules}
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
            table="access_points"
            label="ponto de acesso"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}
