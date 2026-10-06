import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useQuery';
import { POLICY_EFFECTS, POLICY_EFFECT_LABEL, POLICY_STATUS_LABEL } from '@zela/domain';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import {
  BTN_PRIMARY,
  DeleteConfirm,
  Field,
  INPUT,
  Modal,
  PageHead,
  RowActions,
  save,
} from './RegistryPages';

function PolicyForm({ policy, sites, groups, zones, points, schedules, tenantId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    site_id: policy?.site_id ?? sites[0]?.id ?? '',
    name: policy?.name ?? '',
    description: policy?.description ?? '',
    group_id: policy?.group_id ?? groups[0]?.id ?? '',
    target_kind: policy?.access_point_id ? 'point' : 'zone',
    zone_id: policy?.zone_id ?? '',
    access_point_id: policy?.access_point_id ?? '',
    effect: policy?.effect ?? 'allow',
    schedule_id: policy?.schedule_id ?? '',
    require_challenge: policy?.require_challenge ?? false,
    status: policy?.status ?? 'active',
  });
  const siteZones = zones.filter((z) => z.site_id === f.site_id);
  const sitePoints = points.filter((p) => p.site_id === f.site_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const target = f.target_kind === 'zone' ? f.zone_id : f.access_point_id;

  const submit = (e) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      group_id: f.group_id,
      zone_id: f.target_kind === 'zone' ? f.zone_id : null,
      access_point_id: f.target_kind === 'point' ? f.access_point_id : null,
      effect: f.effect,
      schedule_id: f.schedule_id || null,
      require_challenge: f.effect === 'allow' && f.require_challenge,
      status: f.status,
    };
    void save(
      () =>
        policy
          ? supabase.from('access_policies').update(body).eq('id', policy.id)
          : supabase
              .from('access_policies')
              .insert({ ...body, tenant_id: tenantId, site_id: f.site_id }),
      'Política salva.',
      onDone,
      setBusy,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!policy && (
        <Field label="Local">
          <select
            className={INPUT}
            required
            value={f.site_id}
            onChange={(e) =>
              setF({ ...f, site_id: e.target.value, zone_id: '', access_point_id: '' })
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
      <Field label="Grupo">
        <select className={INPUT} required value={f.group_id} onChange={set('group_id')}>
          {groups.length === 0 && <option value="">Nenhum grupo cadastrado</option>}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Efeito">
        <select className={INPUT} value={f.effect} onChange={set('effect')}>
          {POLICY_EFFECTS.map((v) => (
            <option key={v} value={v}>
              {POLICY_EFFECT_LABEL[v]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vale para">
        <select className={INPUT} value={f.target_kind} onChange={set('target_kind')}>
          <option value="zone">Uma zona (todos os pontos dela)</option>
          <option value="point">Um ponto de acesso</option>
        </select>
      </Field>
      {f.target_kind === 'zone' ? (
        <Field label="Zona">
          <select className={INPUT} required value={f.zone_id} onChange={set('zone_id')}>
            <option value="">Selecione…</option>
            {siteZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Ponto de acesso">
          <select
            className={INPUT}
            required
            value={f.access_point_id}
            onChange={set('access_point_id')}
          >
            <option value="">Selecione…</option>
            {sitePoints.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
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
      {f.effect === 'allow' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.require_challenge}
            onChange={(e) => setF({ ...f, require_challenge: e.target.checked })}
          />
          Exigir verificação adicional (desafio)
        </label>
      )}
      <Field label="Situação">
        <select className={INPUT} value={f.status} onChange={set('status')}>
          {Object.entries(POLICY_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <p role="note" className="rounded-zela-lg bg-amber-50 p-3 text-sm text-amber-900">
        Sem política, o acesso é negado. Uma política de negar vigente vence qualquer permissão. A
        decisão só passa a valer quando o motor de acesso for ativado (Fase 3).
      </p>
      <button type="submit" className={BTN_PRIMARY} disabled={busy || !f.group_id || !target}>
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

export function PoliciesPage() {
  const { current, allowed, allowedInAnyScope } = useWorkspace();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const q = useQuery(async () => {
    const tenantId = current?.id ?? '';
    const list = (table, cols) =>
      supabase.from(table).select(cols).eq('tenant_id', tenantId).order('name').limit(500);
    const [p, g, z, ap, s, sc] = await Promise.all([
      list(
        'access_policies',
        'id, site_id, name, description, group_id, zone_id, access_point_id, effect, schedule_id, require_challenge, status',
      ),
      list('access_groups', 'id, name'),
      list('zones', 'id, site_id, name'),
      list('access_points', 'id, site_id, name'),
      list('sites', 'id, name'),
      list('access_schedules', 'id, name'),
    ]);
    for (const r of [p, g, z, s]) if (r.error) throw r.error;
    // Sem permissão de ponto ou de janela: segue sem esses seletores/nomes.
    return {
      policies: p.data,
      groups: g.data,
      zones: z.data,
      points: ap.error ? [] : ap.data,
      sites: s.data,
      schedules: sc.error ? [] : sc.data,
    };
  }, [current?.id]);
  const done = () => {
    setEditing(null);
    setDeleting(null);
    q.reload();
  };
  return (
    <Guard permission="policy:read" siteLevel>
      <PageHead
        title="Políticas de acesso"
        canCreate={allowedInAnyScope('policy:create')}
        onNew={() => setEditing({})}
      >
        <Status q={q}>
          {({ policies, groups, zones, points, sites, schedules }) => {
            const names = (list) => new Map(list.map((x) => [x.id, x.name]));
            const groupName = names(groups);
            const zoneName = names(zones);
            const pointName = names(points);
            const siteName = names(sites);
            const scheduleName = names(schedules);
            return (
              <>
                <DataTable
                  caption="Políticas de acesso"
                  headers={[
                    'Nome',
                    'Local',
                    'Grupo',
                    'Alvo',
                    'Efeito',
                    'Janela',
                    'Situação',
                    'Ações',
                  ]}
                  empty="Nenhuma política cadastrada. Sem política, o acesso é negado."
                  rows={policies.map((p) => [
                    p.name,
                    siteName.get(p.site_id) ?? '—',
                    groupName.get(p.group_id) ?? '—',
                    p.access_point_id
                      ? `Ponto: ${pointName.get(p.access_point_id) ?? '—'}`
                      : `Zona: ${zoneName.get(p.zone_id) ?? '—'}`,
                    POLICY_EFFECT_LABEL[p.effect] + (p.require_challenge ? ' (com desafio)' : ''),
                    p.schedule_id ? (scheduleName.get(p.schedule_id) ?? '—') : 'Sempre',
                    POLICY_STATUS_LABEL[p.status],
                    <RowActions
                      key={p.id}
                      canEdit={allowed('policy:update', p.site_id)}
                      canDelete={allowed('policy:delete', p.site_id)}
                      onEdit={() => setEditing(p)}
                      onDelete={() => setDeleting(p)}
                    />,
                  ])}
                />
                {editing && (
                  <Modal title={editing.id ? 'Editar política' : 'Nova política'} onClose={done}>
                    <PolicyForm
                      policy={editing.id ? editing : null}
                      sites={sites}
                      groups={groups}
                      zones={zones}
                      points={points}
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
            table="access_policies"
            label="política"
            onDone={done}
            onCancel={() => setDeleting(null)}
          />
        )}
      </PageHead>
    </Guard>
  );
}
