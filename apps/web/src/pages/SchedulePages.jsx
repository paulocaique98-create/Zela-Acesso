import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
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

// Dia da semana ISO (igual ao banco): 1 = segunda ... 7 = domingo.
const WEEKDAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
];
const WEEKDAY_NAME = Object.fromEntries(WEEKDAYS);

const BR_TIMEZONES = [
  ['America/Sao_Paulo', 'Brasília (São Paulo, Rio, Sul, Sudeste)'],
  ['America/Bahia', 'Bahia'],
  ['America/Fortaleza', 'Fortaleza'],
  ['America/Recife', 'Recife'],
  ['America/Belem', 'Belém'],
  ['America/Cuiaba', 'Cuiabá'],
  ['America/Campo_Grande', 'Campo Grande'],
  ['America/Manaus', 'Manaus'],
  ['America/Porto_Velho', 'Porto Velho'],
  ['America/Rio_Branco', 'Rio Branco'],
  ['America/Noronha', 'Fernando de Noronha'],
];

const BEHAVIOR_LABEL = { deny: 'Negar acesso', ignore: 'Tratar como dia comum' };

/** @param {string} t "HH:MM:SS" */
const hhmm = (t) => t.slice(0, 5);

/** @param {string} iso "YYYY-MM-DD" */
const brDate = (iso) => iso.split('-').reverse().join('/');

// ---------------------------------------------------------------- fuso da organizacao

function TimezoneCard() {
  const { current, allowed } = useWorkspace();
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('tenants')
      .select('timezone')
      .eq('id', current?.id ?? '')
      .single();
    if (error) throw error;
    return data.timezone;
  }, [current?.id]);
  const [busy, setBusy] = useState(false);
  const canEdit = allowed('tenant:update');
  const change = async (timezone) => {
    setBusy(true);
    const { error } = await supabase
      .from('tenants')
      .update({ timezone })
      .eq('id', current?.id ?? '');
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível alterar o fuso.'));
    toast.success('Fuso horário atualizado.');
    q.reload();
  };
  return (
    <div className="rounded-zela-lg border border-outline-variant bg-surface-container-lowest p-4 text-sm">
      <Status q={q}>
        {(tz) => (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">Fuso horário da organização:</span>
            {canEdit ? (
              <select
                aria-label="Fuso horário da organização"
                className={`${INPUT} max-w-xs`}
                value={tz}
                disabled={busy}
                onChange={(e) => change(e.target.value)}
              >
                {!BR_TIMEZONES.some(([v]) => v === tz) && <option value={tz}>{tz}</option>}
                {BR_TIMEZONES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <span>{tz}</span>
            )}
            <span className="text-on-surface-variant">
              As janelas valem no fuso do local do ponto de acesso; sem fuso próprio, o da
              organização.
            </span>
          </div>
        )}
      </Status>
    </div>
  );
}

// ---------------------------------------------------------------- janelas de acesso

function ScheduleFields({ schedule, calendars, tenantId, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: schedule?.name ?? '',
    description: schedule?.description ?? '',
    holiday_calendar_id: schedule?.holiday_calendar_id ?? '',
    holiday_behavior: schedule?.holiday_behavior ?? 'deny',
    valid_from: schedule?.valid_from ?? '',
    valid_until: schedule?.valid_until ?? '',
  });
  const submit = async (e) => {
    e.preventDefault();
    if (f.valid_from && f.valid_until && f.valid_until < f.valid_from) {
      return toast.error('O fim da vigência não pode ser anterior ao início.');
    }
    const body = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      holiday_calendar_id: f.holiday_calendar_id || null,
      holiday_behavior: f.holiday_behavior,
      valid_from: f.valid_from || null,
      valid_until: f.valid_until || null,
    };
    setBusy(true);
    const res = schedule
      ? await supabase
          .from('access_schedules')
          .update(body)
          .eq('id', schedule.id)
          .select('id')
          .single()
      : await supabase
          .from('access_schedules')
          .insert({ ...body, tenant_id: tenantId })
          .select('id')
          .single();
    setBusy(false);
    if (res.error) return toast.error(safeMessage(res.error, 'Não foi possível salvar.'));
    toast.success('Regra salva.');
    onSaved(res.data.id);
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
      <Field label="Calendário de feriados (opcional)">
        <select
          className={INPUT}
          value={f.holiday_calendar_id}
          onChange={(e) => setF({ ...f, holiday_calendar_id: e.target.value })}
        >
          <option value="">Nenhum</option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nos feriados">
        <select
          className={INPUT}
          value={f.holiday_behavior}
          onChange={(e) => setF({ ...f, holiday_behavior: e.target.value })}
        >
          {Object.entries(BEHAVIOR_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vale a partir de">
          <input
            className={INPUT}
            type="date"
            value={f.valid_from}
            onChange={(e) => setF({ ...f, valid_from: e.target.value })}
          />
        </Field>
        <Field label="Vale até">
          <input
            className={INPUT}
            type="date"
            value={f.valid_until}
            onChange={(e) => setF({ ...f, valid_until: e.target.value })}
          />
        </Field>
      </div>
      <button type="submit" className={BTN_PRIMARY} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar regra'}
      </button>
    </form>
  );
}

function WindowsEditor({ scheduleId, tenantId, windows, canEdit, onChanged }) {
  const [days, setDays] = useState(/** @type {number[]} */ ([1, 2, 3, 4, 5]));
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const mine = windows
    .filter((w) => w.schedule_id === scheduleId)
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));

  const add = async (e) => {
    e.preventDefault();
    if (days.length === 0) return toast.error('Selecione ao menos um dia.');
    if (!(start < end))
      return toast.error('O início deve ser antes do fim (a janela não atravessa a meia-noite).');
    setBusy(true);
    const { error } = await supabase.from('access_schedule_windows').insert(
      days.map((weekday) => ({
        tenant_id: tenantId,
        schedule_id: scheduleId,
        weekday,
        start_time: start,
        end_time: end,
      })),
    );
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível adicionar a janela.'));
    onChanged();
  };
  const remove = async (id) => {
    const { error } = await supabase.from('access_schedule_windows').delete().eq('id', id);
    if (error) return toast.error(safeMessage(error, 'Não foi possível remover.'));
    onChanged();
  };

  return (
    <div className="space-y-3 border-t border-outline-variant/60 pt-4">
      <h3 className="font-semibold">Janelas</h3>
      {mine.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          Sem janelas: ninguém passa por esta regra (nega por padrão).
        </p>
      ) : (
        <ul className="divide-y divide-outline-variant/60 text-sm">
          {mine.map((w) => (
            <li key={w.id} className="flex items-center justify-between py-1.5">
              <span>
                {WEEKDAY_NAME[w.weekday]} · {hhmm(w.start_time)}–{hhmm(w.end_time)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className={`${BTN_GHOST} text-error`}
                  aria-label={`Remover ${WEEKDAY_NAME[w.weekday]} ${hhmm(w.start_time)}`}
                  onClick={() => remove(w.id)}
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={add} className="space-y-3">
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1 font-medium">Dias</legend>
            {WEEKDAYS.map(([n, label]) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={days.includes(n)}
                  onChange={(e) =>
                    setDays(e.target.checked ? [...days, n] : days.filter((d) => d !== n))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Das">
              <input
                className={INPUT}
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Até (exclusivo)">
              <input
                className={INPUT}
                type="time"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <button type="submit" className={BTN_GHOST} disabled={busy}>
            Adicionar janela
          </button>
        </form>
      )}
    </div>
  );
}

function summarize(windows) {
  if (windows.length === 0) return 'Sem janelas';
  const byRange = new Map();
  for (const w of windows) {
    const key = `${hhmm(w.start_time)}–${hhmm(w.end_time)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), w.weekday]);
  }
  return [...byRange]
    .map(
      ([range, ds]) =>
        `${[...new Set(ds)]
          .sort()
          .map((d) => WEEKDAY_NAME[d])
          .join(', ')} ${range}`,
    )
    .join(' · ');
}

export function SchedulesPage() {
  const { current, allowed } = useWorkspace();
  const tenantId = current?.id ?? '';
  const [editingId, setEditingId] = useState(/** @type {string | null | undefined} */ (undefined));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const [s, w, c] = await Promise.all([
      supabase
        .from('access_schedules')
        .select(
          'id, name, description, holiday_calendar_id, holiday_behavior, valid_from, valid_until',
        )
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(500),
      supabase
        .from('access_schedule_windows')
        .select('id, schedule_id, weekday, start_time, end_time')
        .eq('tenant_id', tenantId)
        .limit(5000),
      supabase
        .from('holiday_calendars')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name')
        .limit(200),
    ]);
    for (const r of [s, w, c]) if (r.error) throw r.error;
    return { schedules: s.data, windows: w.data, calendars: c.data };
  }, [tenantId]);
  const closeAll = () => {
    setEditingId(undefined);
    setDeleting(null);
    q.reload();
  };
  const canUpdate = allowed('schedule:update');

  return (
    <Guard permission="schedule:read">
      <PageHead
        title="Janelas de acesso"
        canCreate={allowed('schedule:create')}
        onNew={() => setEditingId(null)}
      >
        <TimezoneCard />
        <Status q={q}>
          {({ schedules, windows, calendars }) => {
            const calName = new Map(calendars.map((c) => [c.id, c.name]));
            const editing = editingId ? schedules.find((s) => s.id === editingId) : null;
            return (
              <>
                <DataTable
                  caption="Regras de janela de acesso"
                  headers={['Nome', 'Quando', 'Feriados', 'Vigência', 'Ações']}
                  empty="Nenhuma janela de acesso cadastrada."
                  rows={schedules.map((s) => [
                    s.name,
                    summarize(windows.filter((w) => w.schedule_id === s.id)),
                    s.holiday_calendar_id
                      ? `${calName.get(s.holiday_calendar_id) ?? '—'}: ${BEHAVIOR_LABEL[s.holiday_behavior]}`
                      : '—',
                    s.valid_from || s.valid_until
                      ? `${s.valid_from ? brDate(s.valid_from) : '…'} a ${s.valid_until ? brDate(s.valid_until) : '…'}`
                      : 'Sem prazo',
                    <RowActions
                      key={s.id}
                      canEdit={canUpdate}
                      canDelete={allowed('schedule:delete')}
                      onEdit={() => setEditingId(s.id)}
                      onDelete={() => setDeleting(s)}
                    />,
                  ])}
                />
                {editingId !== undefined && (
                  <Modal
                    title={editing ? 'Editar janela de acesso' : 'Nova janela de acesso'}
                    onClose={closeAll}
                  >
                    <div className="space-y-5">
                      <ScheduleFields
                        key={editing?.id ?? 'new'}
                        schedule={editing}
                        calendars={calendars}
                        tenantId={tenantId}
                        onSaved={(id) => {
                          setEditingId(id);
                          q.reload();
                        }}
                      />
                      {editing && (
                        <WindowsEditor
                          scheduleId={editing.id}
                          tenantId={tenantId}
                          windows={windows}
                          canEdit={canUpdate}
                          onChanged={q.reload}
                        />
                      )}
                    </div>
                  </Modal>
                )}
              </>
            );
          }}
        </Status>
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="access_schedules"
            label="janela de acesso"
            onDone={closeAll}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}

// ---------------------------------------------------------------- feriados

function CalendarForm({ calendar, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(calendar?.name ?? '');
  const submit = (e) => {
    e.preventDefault();
    void save(
      () =>
        calendar
          ? supabase.from('holiday_calendars').update({ name: name.trim() }).eq('id', calendar.id)
          : supabase.from('holiday_calendars').insert({ tenant_id: tenantId, name: name.trim() }),
      'Calendário salvo.',
      onDone,
      setBusy,
    );
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nome do calendário">
        <input
          className={INPUT}
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <button type="submit" className={BTN_PRIMARY} disabled={busy}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

function HolidaysModal({ calendar, tenantId, canEdit, onClose }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('holidays')
      .select('id, holiday_date, name')
      .eq('calendar_id', calendar.id)
      .order('holiday_date')
      .limit(1000);
    if (error) throw error;
    return data;
  }, [calendar.id]);
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('holidays').insert({
      tenant_id: tenantId,
      calendar_id: calendar.id,
      holiday_date: date,
      name: name.trim(),
    });
    setBusy(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível adicionar o feriado.'));
    setDate('');
    setName('');
    q.reload();
  };
  const remove = async (id) => {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (error) return toast.error(safeMessage(error, 'Não foi possível remover.'));
    q.reload();
  };
  return (
    <Modal title={`Feriados — ${calendar.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Status q={q}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Nenhum feriado cadastrado.</p>
            ) : (
              <ul className="divide-y divide-outline-variant/60 text-sm">
                {rows.map((h) => (
                  <li key={h.id} className="flex items-center justify-between py-1.5">
                    <span>
                      {brDate(h.holiday_date)} — {h.name}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className={`${BTN_GHOST} text-error`}
                        aria-label={`Remover ${h.name}`}
                        onClick={() => remove(h.id)}
                      >
                        Remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Status>
        {canEdit && (
          <form onSubmit={add} className="space-y-3 border-t border-outline-variant/60 pt-4">
            <Field label="Data">
              <input
                className={INPUT}
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Descrição do feriado">
              <input
                className={INPUT}
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              Adicionar feriado
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

export function HolidaysPage() {
  const { current, allowed } = useWorkspace();
  const tenantId = current?.id ?? '';
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [managing, setManaging] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const { data, error } = await supabase
      .from('holiday_calendars')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name')
      .limit(200);
    if (error) throw error;
    return data;
  }, [tenantId]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="schedule:read">
      <PageHead
        title="Feriados"
        canCreate={allowed('schedule:create')}
        onNew={() => setEditing({})}
      >
        <Status q={q}>
          {(rows) => (
            <DataTable
              caption="Calendários de feriados"
              headers={['Calendário', 'Ações']}
              empty="Nenhum calendário cadastrado."
              rows={rows.map((c) => [
                c.name,
                <RowActions
                  key={c.id}
                  canEdit={allowed('schedule:update')}
                  canDelete={allowed('schedule:delete')}
                  onEdit={() => setEditing(c)}
                  onDelete={() => setDeleting(c)}
                  extra={
                    <button type="button" className={BTN_GHOST} onClick={() => setManaging(c)}>
                      Feriados
                    </button>
                  }
                />,
              ])}
            />
          )}
        </Status>
        {editing && (
          <Modal title={editing.id ? 'Editar calendário' : 'Novo calendário'} onClose={done}>
            <CalendarForm
              calendar={editing.id ? editing : null}
              tenantId={tenantId}
              onDone={done}
            />
          </Modal>
        )}
        {managing && (
          <HolidaysModal
            calendar={managing}
            tenantId={tenantId}
            canEdit={allowed('schedule:update')}
            onClose={() => setManaging(null)}
          />
        )}
        {deleting && (
          <DeleteConfirm
            row={deleting}
            table="holiday_calendars"
            label="calendário"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}
