import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_COMMERCIAL_CONFIG } from '@zela/domain';
import { supabase } from '../lib/supabase';

// Dados do menu Planos (so platform_owner le estas tabelas; para o suporte as listas vem vazias).
// Sem Realtime: recarrega ao salvar.
const PRICES = 'item_id, billing, price, estimated_cost, keys, active';
const PLANS =
  'id, name, mode, items, price_per_person, monthly_minimum, people_min, people_max, setup_fee, sort_order, active, description';
const CYCLES = 'id, plan_id, cycle, months, discount_percent, setup_fee, active';
const CONFIG =
  'max_people_per_person_plan, setup_discount_max_percent, setup_fee_min, setup_fee_max';
const CONTRACTS =
  'id, tenant_id, plan_id, cycle, months, contracted_people, items, monthly_value, cycle_value, setup_base, setup_discount_type, setup_discount, setup_final, discount_reason, starts_on, ends_on, status, created_at';

export function usePlatformCommercial() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    prices: [],
    plans: [],
    cycles: [],
    config: DEFAULT_COMMERCIAL_CONFIG,
    contracts: [],
    tenants: [],
    activePeople: {},
  });

  const reload = useCallback(async () => {
    const [prices, plans, cycles, config, contracts, tenants, counts] = await Promise.all([
      supabase.from('platform_module_prices').select(PRICES).order('item_id'),
      supabase.from('platform_plans').select(PLANS).order('sort_order').order('name').limit(200),
      supabase.from('platform_plan_cycles').select(CYCLES).limit(1000),
      supabase.from('platform_commercial_config').select(CONFIG).maybeSingle(),
      supabase.from('tenant_contracts').select(CONTRACTS).eq('status', 'active').limit(2000),
      supabase.from('tenants').select('id, name, org_code, status').order('name').limit(1000),
      supabase.rpc('platform_people_counts'),
    ]);
    const failed = [prices, plans, cycles, config, contracts, tenants].find((r) => r.error);
    const activePeople = {};
    for (const row of counts.data ?? []) activePeople[row.tenant_id] = row.active_people;
    setState({
      loading: false,
      error: failed ? 'Não foi possível carregar todos os dados comerciais.' : null,
      prices: prices.data ?? [],
      plans: plans.data ?? [],
      cycles: cycles.data ?? [],
      config: { ...DEFAULT_COMMERCIAL_CONFIG, ...config.data },
      contracts: contracts.data ?? [],
      tenants: tenants.data ?? [],
      activePeople,
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
