import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Pencil, Plus, Power, X } from 'lucide-react';
import { CYCLES, MODULE_BY_ID, brl, overLimit, packageSuggestion } from '@zela/domain';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { ContractsTab, PlansSimulator } from './ContractPlanModal';
import { usePlatformCommercial } from './usePlatformCommercial';
import { btnNeutral, btnSoft, card, field, label, modalBackdrop, modalPanel } from './ui';

// Planos: formas de contratacao da ORGANIZACAO com a plataforma. O menu escolhe itens do catalogo
// (packages/domain/src/modules.js); modulo novo continua exigindo codigo.

const TABS = [
  { id: 'plans', label: 'Planos' },
  { id: 'prices', label: 'Preços dos módulos' },
  { id: 'simulator', label: 'Simulador' },
  { id: 'contracts', label: 'Contratações' },
];
const MODE_LABEL = { per_person: 'Por pessoa', package: 'Pacote' };
const itemName = (id) => MODULE_BY_ID[id]?.name || id;

export function PlansPage() {
  const data = usePlatformCommercial();
  const [tab, setTab] = useState('plans');

  const alerts = useMemo(
    () =>
      data.contracts.filter((ct) => {
        const plan = data.plans.find((p) => p.id === ct.plan_id);
        return overLimit(
          { mode: plan?.mode },
          data.activePeople[ct.tenant_id] || 0,
          data.config.max_people_per_person_plan,
        );
      }).length,
    [data.contracts, data.plans, data.activePeople, data.config],
  );

  if (data.loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-on-surface-variant" aria-label="Carregando" />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-h2 text-on-surface">Planos</h1>
      {data.error && (
        <p role="alert" className="text-sm text-error">
          {data.error}
        </p>
      )}
      {alerts > 0 && (
        <button
          type="button"
          onClick={() => setTab('contracts')}
          className="flex w-full items-center gap-2 rounded-zela-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"
        >
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
          {alerts === 1
            ? '1 organização por pessoa passou do limite.'
            : `${alerts} organizações por pessoa passaram do limite.`}{' '}
          Migre para um pacote.
        </button>
      )}
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'plans' && <PlansTab data={data} />}
      {tab === 'prices' && <PricesTab data={data} />}
      {tab === 'simulator' && <PlansSimulator data={data} />}
      {tab === 'contracts' && <ContractsTab data={data} />}
    </section>
  );
}

// ═══ Preços dos módulos ═══
function PricesTab({ data }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(null);
  const [cfg, setCfg] = useState(null);
  const valueOf = (p, k) => draft[p.item_id]?.[k] ?? p[k];
  const change = (p, k, v) => setDraft((d) => ({ ...d, [p.item_id]: { ...d[p.item_id], [k]: v } }));
  const dirty = (p) =>
    !!draft[p.item_id] &&
    Object.keys(draft[p.item_id]).some((k) => String(draft[p.item_id][k]) !== String(p[k]));

  async function save(p) {
    const price = Number(valueOf(p, 'price'));
    const cost = Number(valueOf(p, 'estimated_cost'));
    if (!(price >= 0) || !(cost >= 0))
      return toast.error('Informe valores maiores ou iguais a zero.');
    setSaving(p.item_id);
    const { error } = await supabase
      .from('platform_module_prices')
      .update({
        price,
        estimated_cost: cost,
        billing: valueOf(p, 'billing'),
        active: valueOf(p, 'active'),
      })
      .eq('item_id', p.item_id);
    setSaving(null);
    if (error) return toast.error(safeMessage(error, 'Não foi possível salvar o preço.'));
    toast.success('Preço salvo. Contratações vigentes não mudam.');
    setDraft((d) => {
      const next = { ...d };
      delete next[p.item_id];
      return next;
    });
    void data.reload();
  }

  async function saveConfig() {
    const { error } = await supabase
      .from('platform_commercial_config')
      .update({
        max_people_per_person_plan: Number(c.max_people_per_person_plan),
        setup_discount_max_percent: Number(c.setup_discount_max_percent),
        setup_fee_min: Number(c.setup_fee_min),
        setup_fee_max: Number(c.setup_fee_max),
      })
      .eq('id', true);
    if (error) return toast.error(safeMessage(error, 'Não foi possível salvar a configuração.'));
    toast.success('Configuração comercial salva.');
    setCfg(null);
    void data.reload();
  }

  const c = cfg || data.config;
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-3 text-sm text-on-surface-variant">
          Preço por pessoa por mês de cada item. O plano base é sempre incluso. Itens com cobrança
          fixa somam um valor mensal fixo. Desativar tira o item das novas contratações; as vigentes
          continuam iguais. Os valores iniciais são 0 até a Arx definir a tabela de preços.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-on-surface-variant uppercase">
                {['Item', 'Cobrança', 'Valor', 'Custo estimado', 'Ativo'].map((h) => (
                  <th key={h} className="py-2 pr-3">
                    {h}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.prices.map((p) => {
                const mod = MODULE_BY_ID[p.item_id];
                return (
                  <tr key={p.item_id} className="border-t border-outline-variant/60">
                    <td className="py-2 pr-3 font-medium">{mod?.name || p.item_id}</td>
                    <td className="py-2 pr-3">
                      <select
                        className={field}
                        value={valueOf(p, 'billing')}
                        onChange={(e) => change(p, 'billing', e.target.value)}
                        disabled={p.item_id === 'base'}
                        aria-label={`Tipo de cobrança de ${mod?.name}`}
                      >
                        <option value="per_person">Por pessoa</option>
                        <option value="fixed_monthly">Fixo mensal</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${field} w-28`}
                        value={valueOf(p, 'price')}
                        onChange={(e) => change(p, 'price', e.target.value)}
                        aria-label={`Valor de ${mod?.name}`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${field} w-28`}
                        value={valueOf(p, 'estimated_cost')}
                        onChange={(e) => change(p, 'estimated_cost', e.target.value)}
                        aria-label={`Custo estimado de ${mod?.name}`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={valueOf(p, 'active')}
                        disabled={p.item_id === 'base'}
                        onChange={(e) => change(p, 'active', e.target.checked)}
                        aria-label={`Ativar ${mod?.name}`}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className={btnSoft}
                        disabled={!dirty(p) || saving === p.item_id}
                        onClick={() => void save(p)}
                      >
                        {saving === p.item_id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}{' '}
                        Salvar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <p className="mb-3 text-sm font-bold">Regras comerciais</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label} htmlFor="cfg-lim">
              Limite de pessoas (por pessoa)
            </label>
            <input
              id="cfg-lim"
              type="number"
              min="1"
              className={field}
              value={c.max_people_per_person_plan}
              onChange={(e) => setCfg({ ...c, max_people_per_person_plan: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="cfg-desc">
              Desconto máximo na implantação (%)
            </label>
            <input
              id="cfg-desc"
              type="number"
              min="0"
              max="100"
              className={field}
              value={c.setup_discount_max_percent}
              onChange={(e) => setCfg({ ...c, setup_discount_max_percent: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="cfg-min">
              Implantação mínima (R$)
            </label>
            <input
              id="cfg-min"
              type="number"
              min="0"
              className={field}
              value={c.setup_fee_min}
              onChange={(e) => setCfg({ ...c, setup_fee_min: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="cfg-max">
              Implantação máxima (R$)
            </label>
            <input
              id="cfg-max"
              type="number"
              min="0"
              className={field}
              value={c.setup_fee_max}
              onChange={(e) => setCfg({ ...c, setup_fee_max: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className={btnSoft}
            disabled={!cfg}
            onClick={() => void saveConfig()}
          >
            <Check size={14} /> Salvar regras
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══ Planos ═══
const EMPTY = {
  name: '',
  mode: 'package',
  items: [],
  price_per_person: '',
  monthly_minimum: '',
  setup_fee: '',
  description: '',
  people_min: '',
  people_max: '',
};

function PlansTab({ data }) {
  const [editing, setEditing] = useState(null);
  const usage = useMemo(() => {
    const m = {};
    for (const ct of data.contracts) m[ct.plan_id] = (m[ct.plan_id] || 0) + 1;
    return m;
  }, [data.contracts]);

  const newPlan = () =>
    setEditing({
      plan: { ...EMPTY },
      cycles: CYCLES.map((c) => ({
        cycle: c.id,
        months: c.months,
        discount_percent: 0,
        setup_fee: '',
        active: c.id === 'MONTHLY',
      })),
    });
  const open = (p, duplicate = false) => {
    const existing = data.cycles.filter((c) => c.plan_id === p.id);
    const cycles = CYCLES.map((c) => {
      const e = existing.find((x) => x.cycle === c.id);
      return {
        cycle: c.id,
        months: c.months,
        discount_percent: e?.discount_percent ?? 0,
        setup_fee: e?.setup_fee ?? '',
        active: e ? e.active : false,
      };
    });
    setEditing({
      plan: duplicate ? { ...p, id: undefined, name: `${p.name} (cópia)` } : { ...p },
      cycles,
    });
  };
  async function toggleActive(p) {
    const { error } = await supabase
      .from('platform_plans')
      .update({ active: !p.active })
      .eq('id', p.id);
    if (error) return toast.error(safeMessage(error, 'Não foi possível alterar o plano.'));
    toast.success(
      p.active ? 'Plano desativado. As contratações vigentes continuam.' : 'Plano reativado.',
    );
    void data.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={btnSoft} onClick={newPlan}>
          <Plus size={14} /> Novo plano
        </button>
      </div>
      {data.plans.length === 0 && (
        <p className="text-sm text-on-surface-variant">
          Nenhum plano cadastrado. Crie o primeiro com “Novo plano”.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((p) => {
          const active = data.cycles.filter((c) => c.plan_id === p.id && c.active);
          return (
            <div key={p.id} className={`${card} ${p.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-bold">{p.name}</p>
                  <p className="text-[11px] tracking-wide text-on-surface-variant uppercase">
                    {MODE_LABEL[p.mode]}
                    {p.active ? '' : ' · desativado'}
                  </p>
                </div>
                <span className="text-xs whitespace-nowrap text-on-surface-variant">
                  {usage[p.id] || 0} organização(ões)
                </span>
              </div>
              {p.description && (
                <p className="mt-2 text-sm text-on-surface-variant">{p.description}</p>
              )}
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-on-surface-variant">Itens</dt>
                  <dd className="text-right">
                    {p.mode === 'per_person'
                      ? 'Escolhidos na contratação'
                      : ['Plano base', ...p.items.map(itemName)].join(', ')}
                  </dd>
                </div>
                {p.mode === 'package' && (
                  <div className="flex justify-between">
                    <dt className="text-on-surface-variant">Por pessoa</dt>
                    <dd>{brl(p.price_per_person)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-on-surface-variant">Mínimo mensal</dt>
                  <dd>{brl(p.monthly_minimum)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-on-surface-variant">Implantação</dt>
                  <dd>{brl(p.setup_fee)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-on-surface-variant">Ciclos</dt>
                  <dd className="text-right">
                    {active
                      .map(
                        (c) =>
                          `${CYCLES.find((x) => x.id === c.cycle)?.label} ${c.discount_percent}%`,
                      )
                      .join(' · ') || 'Nenhum'}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={btnNeutral} onClick={() => open(p)}>
                  <Pencil size={14} /> Editar
                </button>
                <button type="button" className={btnNeutral} onClick={() => open(p, true)}>
                  <Copy size={14} /> Duplicar
                </button>
                <button type="button" className={btnNeutral} onClick={() => void toggleActive(p)}>
                  <Power size={14} /> {p.active ? 'Desativar' : 'Reativar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && (
        <PlanEditor
          state={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void data.reload();
          }}
        />
      )}
    </div>
  );
}

function PlanEditor({ state, data, onClose, onSaved }) {
  const [plan, setPlan] = useState(state.plan);
  const [cycles, setCycles] = useState(state.cycles);
  const [saving, setSaving] = useState(false);
  const { config } = data;
  const sellable = data.prices.filter(
    (p) =>
      p.item_id !== 'base' &&
      MODULE_BY_ID[p.item_id] &&
      (p.active || plan.items.includes(p.item_id)),
  );
  const isPackage = plan.mode === 'package';
  const suggestion = isPackage
    ? packageSuggestion(plan.items, plan.price_per_person, data.prices)
    : null;
  const toggleItem = (id) =>
    setPlan((p) => ({
      ...p,
      items: p.items.includes(id) ? p.items.filter((i) => i !== id) : [...p.items, id],
    }));
  const setCycle = (id, k, v) =>
    setCycles((cs) => cs.map((c) => (c.cycle === id ? { ...c, [k]: v } : c)));
  const inRange = (v) => Number(v) >= config.setup_fee_min && Number(v) <= config.setup_fee_max;

  async function save() {
    const name = plan.name.trim();
    if (!name) return toast.error('Informe o nome do plano.');
    if (!inRange(plan.setup_fee)) {
      return toast.error(
        `A implantação deve ficar entre ${brl(config.setup_fee_min)} e ${brl(config.setup_fee_max)}.`,
      );
    }
    if (isPackage && !(Number(plan.price_per_person) > 0))
      return toast.error('Informe o preço por pessoa do pacote.');
    if (!cycles.some((c) => c.active)) return toast.error('Deixe pelo menos um ciclo ativo.');
    for (const c of cycles) {
      if (Number(c.discount_percent) < 0 || Number(c.discount_percent) > 50)
        return toast.error('O desconto do ciclo vai de 0 a 50 por cento.');
      if (c.setup_fee !== '' && !inRange(c.setup_fee)) {
        return toast.error(
          `A implantação do ciclo deve ficar entre ${brl(config.setup_fee_min)} e ${brl(config.setup_fee_max)}.`,
        );
      }
    }
    const nullable = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      name,
      items: isPackage ? plan.items : [],
      price_per_person: isPackage ? Number(plan.price_per_person) : 0,
      monthly_minimum: Number(plan.monthly_minimum || 0),
      setup_fee: Number(plan.setup_fee),
      description: plan.description?.trim() || null,
      people_min: nullable(plan.people_min),
      people_max: nullable(plan.people_max),
    };
    setSaving(true);
    let planId = plan.id;
    if (planId) {
      const { error } = await supabase.from('platform_plans').update(body).eq('id', planId);
      if (error) {
        setSaving(false);
        return toast.error(safeMessage(error, 'Não foi possível salvar o plano.'));
      }
    } else {
      const { data: created, error } = await supabase
        .from('platform_plans')
        .insert({ ...body, mode: plan.mode, sort_order: data.plans.length + 1 })
        .select('id')
        .single();
      if (error) {
        setSaving(false);
        return toast.error(safeMessage(error, 'Não foi possível criar o plano.'));
      }
      planId = created.id;
    }
    const rows = cycles
      .filter((c) => !(plan.mode === 'per_person' && c.cycle !== 'MONTHLY'))
      .map((c) => ({
        plan_id: planId,
        cycle: c.cycle,
        months: c.months,
        active: !!c.active,
        discount_percent: Number(c.discount_percent || 0),
        setup_fee: nullable(c.setup_fee),
      }));
    const { error: cycleError } = await supabase
      .from('platform_plan_cycles')
      .upsert(rows, { onConflict: 'plan_id,cycle' });
    setSaving(false);
    if (cycleError)
      return toast.error(safeMessage(cycleError, 'O plano foi salvo, mas os ciclos não.'));
    toast.success('Plano salvo. Vale para novas contratações.');
    onSaved();
  }

  return (
    <div className={modalBackdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={plan.id ? 'Editar plano' : 'Novo plano'}
        className={`${modalPanel} max-w-2xl`}
      >
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold">{plan.id ? 'Editar plano' : 'Novo plano'}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-on-surface-variant hover:text-on-surface"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="pl-name">
              Nome
            </label>
            <input
              id="pl-name"
              className={field}
              value={plan.name}
              maxLength={60}
              onChange={(e) => setPlan({ ...plan, name: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="pl-mode">
              Modalidade
            </label>
            <select
              id="pl-mode"
              className={field}
              value={plan.mode}
              disabled={!!plan.id}
              onChange={(e) => {
                const mode = e.target.value;
                setPlan({ ...plan, mode });
                if (mode === 'per_person')
                  setCycles((cs) => cs.map((c) => ({ ...c, active: c.cycle === 'MONTHLY' })));
              }}
            >
              <option value="package">Pacote</option>
              <option value="per_person">Por pessoa</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="pl-desc">
              Descrição
            </label>
            <input
              id="pl-desc"
              className={field}
              value={plan.description || ''}
              maxLength={500}
              onChange={(e) => setPlan({ ...plan, description: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="pl-pmin">
              Mínimo de pessoas (opcional)
            </label>
            <input
              id="pl-pmin"
              type="number"
              min="1"
              className={field}
              value={plan.people_min ?? ''}
              onChange={(e) => setPlan({ ...plan, people_min: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="pl-pmax">
              Máximo de pessoas (opcional)
            </label>
            <input
              id="pl-pmax"
              type="number"
              min="1"
              className={field}
              value={plan.people_max ?? ''}
              onChange={(e) => setPlan({ ...plan, people_max: e.target.value })}
            />
          </div>
        </div>

        {isPackage && (
          <div>
            <p className={label}>Itens além do plano base (sempre incluso)</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sellable.map((p) => (
                <label
                  key={p.item_id}
                  className="flex items-center gap-2 rounded-zela-md border border-outline-variant bg-surface px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={plan.items.includes(p.item_id)}
                    onChange={() => toggleItem(p.item_id)}
                  />
                  <span className="flex-1">{MODULE_BY_ID[p.item_id].name}</span>
                  <span className="text-xs text-on-surface-variant">
                    {brl(p.price)}
                    {p.billing === 'fixed_monthly' ? ' fixo' : ''}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {isPackage && (
            <div>
              <label className={label} htmlFor="pl-pp">
                Preço por pessoa (R$)
              </label>
              <input
                id="pl-pp"
                type="number"
                min="0"
                step="0.01"
                className={field}
                value={plan.price_per_person}
                onChange={(e) => setPlan({ ...plan, price_per_person: e.target.value })}
              />
            </div>
          )}
          <div>
            <label className={label} htmlFor="pl-min">
              Mínimo mensal (R$)
            </label>
            <input
              id="pl-min"
              type="number"
              min="0"
              step="0.01"
              className={field}
              value={plan.monthly_minimum}
              onChange={(e) => setPlan({ ...plan, monthly_minimum: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="pl-setup">
              Implantação (R$)
            </label>
            <input
              id="pl-setup"
              type="number"
              min="0"
              step="0.01"
              className={field}
              value={plan.setup_fee}
              onChange={(e) => setPlan({ ...plan, setup_fee: e.target.value })}
            />
          </div>
        </div>
        {suggestion && suggestion.sum > 0 && (
          <p className="text-xs text-on-surface-variant">
            Soma dos itens avulsos: {brl(suggestion.sum)} por pessoa.{' '}
            {Number(plan.price_per_person) > 0 &&
              `Seu preço dá ${suggestion.discount.toString().replace('.', ',')} por cento de desconto sobre o avulso.`}
          </p>
        )}

        <div>
          <p className={label}>
            Ciclos{plan.mode === 'per_person' ? ' (por pessoa é só mensal)' : ''}
          </p>
          <div className="space-y-2">
            {cycles.map((c) => {
              const blocked = plan.mode === 'per_person' && c.cycle !== 'MONTHLY';
              const cl = CYCLES.find((x) => x.id === c.cycle).label;
              return (
                <div
                  key={c.cycle}
                  className={`grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-2 rounded-zela-md border border-outline-variant bg-surface px-3 py-2 ${blocked ? 'opacity-40' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={!!c.active && !blocked}
                    disabled={blocked}
                    onChange={(e) => setCycle(c.cycle, 'active', e.target.checked)}
                    aria-label={`Ativar ciclo ${cl}`}
                  />
                  <span className="text-sm font-medium">{cl}</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    className={field}
                    disabled={blocked}
                    value={c.discount_percent}
                    onChange={(e) => setCycle(c.cycle, 'discount_percent', e.target.value)}
                    aria-label={`Desconto do ciclo ${cl} em porcentagem`}
                    placeholder="Desconto %"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={field}
                    disabled={blocked}
                    value={c.setup_fee}
                    onChange={(e) => setCycle(c.cycle, 'setup_fee', e.target.value)}
                    aria-label={`Implantação do ciclo ${cl}`}
                    placeholder="Implantação própria"
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">
            Colunas: ativar, desconto em porcentagem (0 a 50) e implantação própria do ciclo (vazio
            usa a do plano).
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnNeutral} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={btnSoft} disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
            plano
          </button>
        </div>
      </div>
    </div>
  );
}
