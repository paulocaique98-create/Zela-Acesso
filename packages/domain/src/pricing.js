// Regras de preco dos planos (Painel do Desenvolvedor > Planos). A RPC platform_contract_plan recalcula tudo no
// servidor com a mesma regra; o que vem daqui e so previa. Valores em reais, sempre arredondados em centavos.
import { MODULE_BY_ID } from './modules.js';

export const CYCLES = [
  { id: 'MONTHLY', label: 'Mensal', months: 1 },
  { id: 'SEMIANNUAL', label: 'Semestral', months: 6 },
  { id: 'ANNUAL', label: 'Anual', months: 12 },
  { id: 'BIENNIAL', label: 'Bianual', months: 24 },
];
export const CYCLE_BY_ID = Object.fromEntries(CYCLES.map((c) => [c.id, c]));

export const DEFAULT_COMMERCIAL_CONFIG = {
  max_people_per_person_plan: 50,
  setup_discount_max_percent: 50,
  setup_fee_min: 0,
  setup_fee_max: 100000,
};

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const brl = (n) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// prices: linhas de platform_module_prices ({ item_id, billing, price, active }).
const byId = (prices) => Object.fromEntries((prices || []).map((p) => [p.item_id, p]));

/** Itens vendaveis (nunca tecnicos nem o base), sem repetir, respeitando `requires`. */
export function validItems(items) {
  const seen = new Set();
  const ok = [];
  for (const id of items || []) {
    const mod = MODULE_BY_ID[id];
    if (!mod || mod.fixed || mod.group === 'technical' || seen.has(id)) continue;
    seen.add(id);
    ok.push(id);
  }
  return ok.filter((id) => {
    const req = MODULE_BY_ID[id].requires;
    return !req || seen.has(req);
  });
}

/** Soma dos precos por pessoa do base + itens escolhidos. */
export function pricePerPerson(items, prices) {
  const map = byId(prices);
  const ids = ['base', ...(items || []).filter((i) => i !== 'base')];
  return round2(
    ids.reduce((s, id) => {
      const p = map[id];
      return s + (p && p.billing === 'per_person' ? Number(p.price) : 0);
    }, 0),
  );
}

/** Itens de cobranca fixa mensal. */
export function fixedMonthly(items, prices) {
  const map = byId(prices);
  return round2(
    (items || []).reduce((s, id) => {
      const p = map[id];
      return s + (p && p.billing === 'fixed_monthly' ? Number(p.price) : 0);
    }, 0),
  );
}

/** Maior valor entre pessoas x preco e o minimo mensal, mais os fixos. Pacote usa o preco do plano. */
export function monthly(plan, people, prices, chosenItems) {
  const items = plan.mode === 'package' ? plan.items || [] : chosenItems || [];
  const perPerson =
    plan.mode === 'package' ? Number(plan.price_per_person) : pricePerPerson(items, prices);
  const base = Math.max(Number(people || 0) * perPerson, Number(plan.monthly_minimum || 0));
  return round2(base + fixedMonthly(items, prices));
}

/** Valor do ciclo com o desconto do ciclo. */
export function cycleValue(monthlyValue, cycle) {
  const months = cycle.months ?? CYCLE_BY_ID[cycle.cycle]?.months ?? 1;
  return round2(Number(monthlyValue) * months * (1 - Number(cycle.discount_percent || 0) / 100));
}

export function setupBase(plan, cycle) {
  return Number(cycle?.setup_fee ?? plan.setup_fee ?? 0);
}

/** Desconto em % ou R$, nunca negativo. Retorna { discount, final, error }. */
export function setupFinal(
  base,
  type,
  discount,
  maxPercent = DEFAULT_COMMERCIAL_CONFIG.setup_discount_max_percent,
) {
  const b = Number(base || 0);
  const d = Number(discount || 0);
  if (!d) return { discount: 0, final: round2(b), error: null };
  if (d < 0) return { discount: 0, final: round2(b), error: 'Desconto inválido.' };
  const pct = type === 'percent' ? d : b > 0 ? (d * 100) / b : 100;
  if (pct > maxPercent) {
    return {
      discount: 0,
      final: round2(b),
      error: `O desconto máximo na implantação é de ${maxPercent} por cento.`,
    };
  }
  const value = Math.min(type === 'percent' ? round2((b * d) / 100) : round2(d), b);
  return { discount: value, final: round2(Math.max(b - value, 0)), error: null };
}

/** Modalidades permitidas: ate o limite escolhe entre por pessoa e pacote; acima, so pacote. */
export function allowedModes(people, limit = DEFAULT_COMMERCIAL_CONFIG.max_people_per_person_plan) {
  return Number(people) <= limit ? ['per_person', 'package'] : ['package'];
}

/** Organizacao com contratacao por pessoa que passou do limite. */
export function overLimit(
  contract,
  activePeople,
  limit = DEFAULT_COMMERCIAL_CONFIG.max_people_per_person_plan,
) {
  return contract?.mode === 'per_person' && Number(activePeople) > limit;
}

/** Preco sugerido de um pacote: soma dos avulsos e o desconto implicito. */
export function packageSuggestion(items, pricePerPersonValue, prices) {
  const sum = pricePerPerson(items, prices);
  const discount = sum > 0 ? round2((1 - Number(pricePerPersonValue) / sum) * 100) : 0;
  return { sum, discount };
}

/** Dias ate o fim da contratacao (negativo = vencida). */
export function daysToExpire(end, today = new Date()) {
  if (!end) return null;
  const [y, m, d] = String(end).slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const ref = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - ref) / 86400000);
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
