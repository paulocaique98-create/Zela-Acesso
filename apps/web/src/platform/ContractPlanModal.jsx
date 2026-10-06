import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileSignature, Loader2, X } from 'lucide-react';
import {
  CYCLES,
  MODULES,
  MODULE_BY_ID,
  allowedModes,
  brl,
  cycleValue,
  daysToExpire,
  formatDate,
  monthly,
  moduleState,
  overLimit,
  setupBase,
  setupFinal,
} from '@zela/domain';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { usePlatformCommercial } from './usePlatformCommercial';
import { btnNeutral, btnPrimary, card, field, label, modalBackdrop, modalPanel } from './ui';

const cyclesOf = (data, planId) => data.cycles.filter((c) => c.plan_id === planId && c.active);
const itemsOf = (plan, chosen) => (plan.mode === 'package' ? plan.items : chosen);
const costPerPerson = (items, prices) =>
  ['base', ...items].reduce(
    (s, id) => s + Number(prices.find((p) => p.item_id === id)?.estimated_cost || 0),
    0,
  );
const sellable = (data) =>
  data.prices.filter((p) => p.item_id !== 'base' && p.active && MODULE_BY_ID[p.item_id]);
const cycleLabel = (id) => CYCLES.find((c) => c.id === id)?.label;

// ═══ Simulador ═══
export function PlansSimulator({ data }) {
  const [people, setPeople] = useState(80);
  const [chosen, setChosen] = useState([]);
  const n = Math.max(Number(people) || 0, 0);
  const plans = data.plans.filter((p) => p.active);
  const modes = allowedModes(n, data.config.max_people_per_person_plan);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="max-w-xs">
          <label className={label} htmlFor="sim-people">
            Quantidade de pessoas
          </label>
          <input
            id="sim-people"
            type="number"
            min="1"
            className={field}
            value={people}
            onChange={(e) => setPeople(e.target.value)}
          />
        </div>
        {!modes.includes('per_person') && (
          <p className="mt-3 text-sm text-amber-800">
            Acima de {data.config.max_people_per_person_plan} pessoas só vale o pacote.
          </p>
        )}
        {modes.includes('per_person') && plans.some((p) => p.mode === 'per_person') && (
          <div className="mt-3">
            <p className={label}>Módulos do plano por pessoa</p>
            <div className="flex flex-wrap gap-2">
              {sellable(data).map((p) => (
                <label
                  key={p.item_id}
                  className="flex items-center gap-2 rounded-zela-md border border-outline-variant bg-surface px-3 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.item_id)}
                    onChange={() =>
                      setChosen((c) =>
                        c.includes(p.item_id)
                          ? c.filter((i) => i !== p.item_id)
                          : [...c, p.item_id],
                      )
                    }
                  />
                  {MODULE_BY_ID[p.item_id].name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      {plans.length === 0 && (
        <p className="text-sm text-on-surface-variant">
          Cadastre um plano na aba Planos para simular.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {plans
          .filter((p) => modes.includes(p.mode))
          .map((p) => {
            const items = itemsOf(p, chosen);
            const value = monthly(p, n, data.prices, chosen);
            const cost = Math.round(costPerPerson(items, data.prices) * n * 100) / 100;
            const margin = Math.round((value - cost) * 100) / 100;
            return (
              <div key={p.id} className={card}>
                <p className="font-bold">{p.name}</p>
                <p className="mt-1 text-2xl font-black">
                  {brl(value)}
                  <span className="text-xs font-medium text-on-surface-variant"> por mês</span>
                </p>
                <p className="text-xs text-on-surface-variant">
                  Custo estimado {brl(cost)} · margem {brl(margin)} (
                  {value > 0 ? Math.round((margin / value) * 100) : 0}%)
                </p>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {cyclesOf(data, p.id).map((c) => (
                      <tr key={c.id} className="border-t border-outline-variant/60">
                        <td className="py-1.5">
                          {cycleLabel(c.cycle)}
                          {c.discount_percent > 0 ? ` (${c.discount_percent}% off)` : ''}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          {brl(cycleValue(value, c))}
                        </td>
                        <td className="py-1.5 text-right text-xs text-on-surface-variant">
                          implantação {brl(setupBase(p, c))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ═══ Contratações ═══
export function ContractsTab({ data }) {
  const [contracting, setContracting] = useState(null);
  const planById = useMemo(
    () => Object.fromEntries(data.plans.map((p) => [p.id, p])),
    [data.plans],
  );
  const contractBy = useMemo(
    () => Object.fromEntries(data.contracts.map((c) => [c.tenant_id, c])),
    [data.contracts],
  );
  const rows = data.tenants
    .filter((t) => t.status === 'active')
    .map((t) => ({ tenant: t, ct: contractBy[t.id], active: data.activePeople[t.id] || 0 }));
  const without = rows.filter((r) => !r.ct).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        {without > 0 ? `${without} organização(ões) sem contratação registrada. ` : ''}Contratar um
        plano liga os módulos dele e guarda os valores daquele momento. Mudar o plano depois não
        altera contratos vigentes.
      </p>
      <div className="overflow-x-auto rounded-zela-lg border border-outline-variant bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-container-low text-left text-[11px] tracking-wide text-on-surface-variant uppercase">
              {['Organização', 'Plano', 'Ciclo', 'Pessoas', 'Mensal', 'Vencimento', ''].map((h) => (
                <th key={h} scope="col" className="p-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tenant, ct, active }) => {
              const plan = ct ? planById[ct.plan_id] : null;
              const alert =
                ct &&
                overLimit({ mode: plan?.mode }, active, data.config.max_people_per_person_plan);
              const days = ct ? daysToExpire(ct.ends_on) : null;
              return (
                <tr key={tenant.id} className="border-t border-outline-variant/60">
                  <td className="p-3 font-medium">{tenant.name}</td>
                  <td className="p-3">
                    {plan?.name || <span className="text-on-surface-variant">Sem contratação</span>}
                  </td>
                  <td className="p-3">{ct ? cycleLabel(ct.cycle) : ''}</td>
                  <td className="p-3">
                    {ct ? ct.contracted_people : ''}{' '}
                    <span className="text-xs text-on-surface-variant">({active} ativas)</span>
                    {alert && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-800">
                        <AlertTriangle size={12} aria-hidden="true" /> passou do limite, migre para
                        pacote
                      </span>
                    )}
                  </td>
                  <td className="p-3">{ct ? brl(ct.monthly_value) : ''}</td>
                  <td
                    className={`p-3 ${days !== null && days < 0 ? 'text-error' : days !== null && days <= 30 ? 'text-amber-800' : ''}`}
                  >
                    {ct
                      ? `${formatDate(ct.ends_on)}${days !== null && days < 0 ? ' · vencida' : days !== null && days <= 30 ? ` · ${days} dia(s)` : ''}`
                      : ''}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      className={btnNeutral}
                      onClick={() => setContracting(tenant.id)}
                    >
                      <FileSignature size={14} aria-hidden="true" />{' '}
                      {ct ? 'Trocar plano' : 'Contratar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {contracting && (
        <ContractPlanModal
          data={data}
          tenantId={contracting}
          onClose={() => setContracting(null)}
          onDone={() => {
            setContracting(null);
            void data.reload();
          }}
        />
      )}
    </div>
  );
}

// ═══ Contratar ═══
export function ContractPlanModal({ data, tenantId, onClose, onDone }) {
  const tenant = data.tenants.find((t) => t.id === tenantId);
  const active = data.activePeople[tenantId] || 0;
  const [features, setFeatures] = useState(null);
  const [people, setPeople] = useState(Math.max(active, 1));
  const [mode, setMode] = useState('package');
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState('');
  const [chosen, setChosen] = useState([]);
  const [discType, setDiscType] = useState('percent');
  const [disc, setDisc] = useState('');
  const [reason, setReason] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase
      .from('tenants')
      .select('features_enabled')
      .eq('id', tenantId)
      .maybeSingle()
      .then(({ data: row }) => alive && setFeatures(row?.features_enabled ?? {}));
    return () => {
      alive = false;
    };
  }, [tenantId]);

  const n = Math.max(Number(people) || 0, 0);
  const modes = allowedModes(Math.max(n, active), data.config.max_people_per_person_plan);
  const modeOk = modes.includes(mode) ? mode : 'package';
  const plans = data.plans.filter((p) => p.active && p.mode === modeOk);
  const plan = plans.find((p) => p.id === planId) || null;
  const cycles = plan ? cyclesOf(data, plan.id) : [];
  const cycleSel = cycles.find((c) => c.cycle === cycle) || null;

  const items = plan ? itemsOf(plan, chosen) : [];
  const monthlyValue = plan ? monthly(plan, n, data.prices, chosen) : 0;
  const cycleTotal = plan && cycleSel ? cycleValue(monthlyValue, cycleSel) : 0;
  const base = plan && cycleSel ? setupBase(plan, cycleSel) : 0;
  const setup = setupFinal(base, discType, disc, data.config.setup_discount_max_percent);
  const reasonMissing = Number(disc) > 0 && reason.trim().length < 3;
  const ready = !!plan && !!cycleSel && n >= 1 && !setup.error && !reasonMissing && features;

  const changes = useMemo(() => {
    if (!features) return { on: [], off: [] };
    const after = new Set(items);
    const sell = MODULES.filter(
      (m) => (m.group === 'module' || m.group === 'addon') && m.keys.length,
    );
    return {
      on: sell
        .filter((m) => after.has(m.id) && moduleState(features, m) !== 'on')
        .map((m) => m.name),
      off: sell
        .filter((m) => !after.has(m.id) && moduleState(features, m) !== 'off')
        .map((m) => m.name),
    };
  }, [features, items]);

  async function contract() {
    setSaving(true);
    const { error } = await supabase.rpc('platform_contract_plan', {
      p_tenant_id: tenantId,
      p_plan_id: plan.id,
      p_cycle: cycleSel.cycle,
      p_people: n,
      p_items: plan.mode === 'per_person' ? chosen : null,
      p_discount_type: Number(disc) > 0 ? discType : null,
      p_discount: Number(disc) > 0 ? Number(disc) : 0,
      p_reason: Number(disc) > 0 ? reason.trim() : null,
      p_start: start || null,
    });
    setSaving(false);
    if (error) {
      setConfirming(false);
      toast.error(safeMessage(error, 'Não foi possível contratar o plano.'));
      return;
    }
    toast.success('Plano contratado e módulos atualizados.');
    onDone();
  }

  return (
    <div className={modalBackdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Contratar plano"
        className={`${modalPanel} max-w-xl`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">Contratar plano</p>
            <p className="text-xs text-on-surface-variant">
              {tenant?.name} · {active} pessoa(s) ativa(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-on-surface-variant hover:text-on-surface"
          >
            <X size={18} />
          </button>
        </div>

        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">
              Confirme a contratação de <b>{plan.name}</b> (
              {cycleLabel(cycleSel.cycle)?.toLowerCase()}) para {tenant?.name}.
            </p>
            <div className={card}>
              <p className="text-sm">
                Vai ligar: <b>{changes.on.join(', ') || 'nada'}</b>
              </p>
              <p className="mt-1 text-sm">
                Vai desligar: <b>{changes.off.join(', ') || 'nada'}</b>
              </p>
              <p className="mt-2 text-xs text-on-surface-variant">
                A contratação anterior desta organização é encerrada. O histórico de módulos
                registra a mudança.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnNeutral}
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Voltar
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void contract()}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{' '}
                Confirmar contratação
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="ct-people">
                  Pessoas contratadas
                </label>
                <input
                  id="ct-people"
                  type="number"
                  min="1"
                  className={field}
                  value={people}
                  onChange={(e) => setPeople(e.target.value)}
                />
              </div>
              <div>
                <label className={label} htmlFor="ct-start">
                  Início
                </label>
                <input
                  id="ct-start"
                  type="date"
                  className={field}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <label className={label} htmlFor="ct-mode">
                  Modalidade
                </label>
                <select
                  id="ct-mode"
                  className={field}
                  value={modeOk}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setPlanId('');
                    setCycle('');
                  }}
                >
                  <option value="package">Pacote</option>
                  {modes.includes('per_person') && <option value="per_person">Por pessoa</option>}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="ct-plan">
                  Plano
                </label>
                <select
                  id="ct-plan"
                  className={field}
                  value={planId}
                  onChange={(e) => {
                    setPlanId(e.target.value);
                    setCycle('');
                  }}
                >
                  <option value="">Escolha</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="ct-cycle">
                  Ciclo
                </label>
                <select
                  id="ct-cycle"
                  className={field}
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                  disabled={!plan}
                >
                  <option value="">Escolha</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.cycle}>
                      {cycleLabel(c.cycle)}
                      {c.discount_percent > 0 ? ` (${c.discount_percent}% off)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!modes.includes('per_person') && (
              <p className="text-xs text-amber-800">
                Acima de {data.config.max_people_per_person_plan} pessoas só vale o pacote.
              </p>
            )}
            {plan?.mode === 'per_person' && (
              <div>
                <p className={label}>Módulos (o plano base é sempre incluso)</p>
                <div className="flex flex-wrap gap-2">
                  {sellable(data).map((p) => (
                    <label
                      key={p.item_id}
                      className="flex items-center gap-2 rounded-zela-md border border-outline-variant bg-surface px-3 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.item_id)}
                        onChange={() =>
                          setChosen((c) =>
                            c.includes(p.item_id)
                              ? c.filter((i) => i !== p.item_id)
                              : [...c, p.item_id],
                          )
                        }
                      />
                      {MODULE_BY_ID[p.item_id].name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {plan && cycleSel && (
              <div className={card}>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-on-surface-variant">Mensalidade</dt>
                    <dd className="font-medium">{brl(monthlyValue)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-on-surface-variant">Valor do ciclo</dt>
                    <dd className="font-medium">{brl(cycleTotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-on-surface-variant">Implantação</dt>
                    <dd>{brl(base)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-on-surface-variant">Implantação com desconto</dt>
                    <dd className="font-medium">{brl(setup.final)}</dd>
                  </div>
                </dl>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className={label} htmlFor="ct-dt">
                      Desconto na implantação
                    </label>
                    <div className="flex gap-2">
                      <select
                        id="ct-dt"
                        className={`${field} w-24`}
                        value={discType}
                        onChange={(e) => setDiscType(e.target.value)}
                      >
                        <option value="percent">%</option>
                        <option value="amount">R$</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={field}
                        value={disc}
                        onChange={(e) => setDisc(e.target.value)}
                        aria-label="Valor do desconto"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={label} htmlFor="ct-reason">
                      Motivo (obrigatório com desconto)
                    </label>
                    <input
                      id="ct-reason"
                      className={field}
                      value={reason}
                      maxLength={300}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                </div>
                {setup.error && <p className="mt-2 text-xs text-error">{setup.error}</p>}
                {reasonMissing && (
                  <p className="mt-2 text-xs text-error">Informe o motivo do desconto.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnNeutral} onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!ready}
                onClick={() => setConfirming(true)}
              >
                Revisar e contratar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Versao autonoma (aberta pelo menu "⋯" da organizacao): carrega os dados so ao abrir. */
export function ContractPlanForTenant({ tenantId, onClose, onDone }) {
  const data = usePlatformCommercial();
  if (data.loading) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60">
        <Loader2 className="animate-spin text-white" aria-label="Carregando" />
      </div>
    );
  }
  return (
    <ContractPlanModal
      data={data}
      tenantId={tenantId}
      onClose={onClose}
      onDone={onDone ?? onClose}
    />
  );
}
