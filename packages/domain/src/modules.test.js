import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MODULES,
  MODULE_BY_ID,
  applyItems,
  applyPackage,
  currentPackage,
  describePackage,
  initialFeatures,
  moduleHistory,
  moduleState,
  normalizeFeatures,
  toggleModule,
} from './modules';

const PACKS = [
  { id: 'p1', name: 'Essencial', items: [] },
  { id: 'p2', name: 'Completo', items: ['access_control', 'reports'] },
];

describe('catalogo de modulos', () => {
  it('ids unicos e chaves nao compartilhadas entre itens', () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    const keys = MODULES.flatMap((m) => m.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('organizacao nova nasce so com o plano base (todo modulo desligado)', () => {
    const f = initialFeatures();
    for (const k of MODULE_BY_ID.base.keys) expect(f[k]).toBe(true);
    for (const m of MODULES.filter((x) => x.id !== 'base')) {
      for (const k of m.keys) expect(f[k]).toBe(false);
    }
  });

  it('o plano base nao pode ser desligado', () => {
    const f = toggleModule(normalizeFeatures({}), 'base', false);
    expect(moduleState(f, MODULE_BY_ID.base)).toBe('on');
  });

  it('liga e desliga o item inteiro; parcial e detectado', () => {
    let f = toggleModule(initialFeatures(), 'access_control', true);
    expect(moduleState(f, MODULE_BY_ID.access_control)).toBe('on');
    f = { ...f, credentials: false };
    expect(moduleState(f, MODULE_BY_ID.access_control)).toBe('partial');
    f = toggleModule(f, 'access_control', false);
    expect(moduleState(f, MODULE_BY_ID.access_control)).toBe('off');
  });

  it('item "em breve" nao liga; dependente exige o requisito e cai junto', () => {
    expect(
      moduleState(
        toggleModule(initialFeatures(), 'biometrics_liveness', true),
        MODULE_BY_ID.biometrics_liveness,
      ),
    ).toBe('off');
  });

  it('pacote atual e aplicacao de pacote', () => {
    const f = applyPackage(initialFeatures(), 'p2', PACKS);
    expect(moduleState(f, MODULE_BY_ID.access_control)).toBe('on');
    expect(moduleState(f, MODULE_BY_ID.reports)).toBe('on');
    expect(currentPackage(f, PACKS)).toBe('p2');
    expect(currentPackage(applyItems(f, ['visitors']), PACKS)).toBe('livre');
    expect(currentPackage(initialFeatures(), PACKS)).toBe('p1');
  });

  it('rotulo do pacote: base, nome do pacote ou livre', () => {
    expect(describePackage(initialFeatures(), PACKS)).toEqual({ id: 'base', name: 'Plano base' });
    expect(describePackage(applyPackage(initialFeatures(), 'p2', PACKS), PACKS)).toEqual({
      id: 'p2',
      name: 'Completo',
    });
    expect(describePackage(applyItems(initialFeatures(), ['visitors']), PACKS)).toEqual({
      id: 'livre',
      name: 'Livre',
    });
  });

  it('historico agrupa por momento e marca mudanca parcial', () => {
    const mod = MODULE_BY_ID.access_control;
    const h = moduleHistory(
      [
        {
          feature_key: 'access_points',
          enabled: true,
          changed_at: '2026-10-09T10:00:00Z',
          changed_by_name: 'Ana',
        },
        {
          feature_key: 'credentials',
          enabled: true,
          changed_at: '2026-10-09T10:00:00Z',
          changed_by_name: 'Ana',
        },
        {
          feature_key: 'access_points',
          enabled: false,
          changed_at: '2026-10-10T10:00:00Z',
          changed_by_name: null,
        },
        {
          feature_key: 'sites',
          enabled: true,
          changed_at: '2026-10-10T10:00:00Z',
          changed_by_name: null,
        },
      ],
      mod,
    );
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ enabled: false, complete: false, author: null });
    expect(h[1]).toMatchObject({ enabled: true, complete: true, author: 'Ana' });
  });
});

describe('espelho com o banco', () => {
  const dir = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
  const file = readdirSync(dir).find((f) => f.includes('platform_dev_panel'));
  const sql = readFileSync(dir + file, 'utf8');

  it('chaves do plano base batem com a migration (plataforma cria org com elas)', () => {
    const literal = JSON.stringify(
      Object.fromEntries(MODULE_BY_ID.base.keys.map((k) => [k, true])),
    );
    expect(sql).toContain(literal);
  });

  it('chaves de cada modulo batem com o seed de platform_module_prices', () => {
    for (const m of MODULES.filter((x) => x.keys.length && !x.comingSoon)) {
      const arr = `array[${m.keys.map((k) => `'${k}'`).join(',')}]`;
      expect(sql, m.id).toContain(`('${m.id}'`);
      expect(sql, m.id).toContain(arr);
    }
  });
});
