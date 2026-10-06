import { describe, expect, it } from 'vitest';
import {
  allowedModes,
  cycleValue,
  daysToExpire,
  fixedMonthly,
  monthly,
  overLimit,
  packageSuggestion,
  pricePerPerson,
  setupBase,
  setupFinal,
  validItems,
} from './pricing';

const PRICES = [
  { item_id: 'base', billing: 'per_person', price: 6.9, active: true },
  { item_id: 'access_control', billing: 'per_person', price: 3.5, active: true },
  { item_id: 'reports', billing: 'per_person', price: 1.5, active: true },
  { item_id: 'edge_agent', billing: 'fixed_monthly', price: 300, active: true },
];

describe('mensalidade', () => {
  it('por pessoa: soma base + escolhidos, vezes pessoas, com minimo', () => {
    const plan = { mode: 'per_person', monthly_minimum: 0 };
    expect(pricePerPerson(['access_control'], PRICES)).toBe(10.4);
    expect(monthly(plan, 10, PRICES, ['access_control'])).toBe(104);
    expect(monthly({ ...plan, monthly_minimum: 200 }, 10, PRICES, ['access_control'])).toBe(200);
  });

  it('pacote usa o preco do plano e soma os fixos', () => {
    const plan = {
      mode: 'package',
      items: ['edge_agent'],
      price_per_person: 8,
      monthly_minimum: 100,
    };
    expect(fixedMonthly(plan.items, PRICES)).toBe(300);
    expect(monthly(plan, 50, PRICES)).toBe(700);
  });

  it('ciclo aplica o desconto sobre os meses', () => {
    expect(cycleValue(100, { cycle: 'ANNUAL', discount_percent: 10 })).toBe(1080);
    expect(cycleValue(100, { cycle: 'MONTHLY', discount_percent: 0 })).toBe(100);
  });
});

describe('implantacao', () => {
  it('usa a do ciclo quando existe, senao a do plano', () => {
    expect(setupBase({ setup_fee: 900 }, { setup_fee: null })).toBe(900);
    expect(setupBase({ setup_fee: 900 }, { setup_fee: 500 })).toBe(500);
  });

  it('desconto em percentual e em reais, com teto', () => {
    expect(setupFinal(1000, 'percent', 10, 50)).toEqual({ discount: 100, final: 900, error: null });
    expect(setupFinal(1000, 'amount', 250, 50)).toEqual({ discount: 250, final: 750, error: null });
    expect(setupFinal(1000, 'percent', 60, 50).error).toMatch(/máximo/);
    expect(setupFinal(1000, 'amount', 600, 50).error).toMatch(/máximo/);
    expect(setupFinal(1000, 'percent', -1, 50).error).toBe('Desconto inválido.');
    expect(setupFinal(1000, 'percent', 0, 50).final).toBe(1000);
  });
});

describe('modalidades e limites', () => {
  it('acima do limite so pacote; alerta de passou do limite', () => {
    expect(allowedModes(50, 50)).toEqual(['per_person', 'package']);
    expect(allowedModes(51, 50)).toEqual(['package']);
    expect(overLimit({ mode: 'per_person' }, 51, 50)).toBe(true);
    expect(overLimit({ mode: 'package' }, 500, 50)).toBe(false);
  });

  it('itens validos: sem base, sem tecnico, sem repetir, respeita requisito', () => {
    expect(
      validItems(['base', 'access_control', 'access_control', 'biometrics_liveness', 'x']),
    ).toEqual(['access_control']);
    expect(validItems(['biometrics_liveness'])).toEqual([]);
  });

  it('sugestao de pacote mostra o desconto sobre o avulso', () => {
    expect(packageSuggestion(['access_control'], 9.36, PRICES)).toEqual({
      sum: 10.4,
      discount: 10,
    });
  });
});

describe('vencimento', () => {
  it('conta dias ate o fim, negativo se vencida', () => {
    const hoje = new Date(2026, 9, 9);
    expect(daysToExpire('2026-10-19', hoje)).toBe(10);
    expect(daysToExpire('2026-10-08', hoje)).toBe(-1);
    expect(daysToExpire(null, hoje)).toBeNull();
  });
});
