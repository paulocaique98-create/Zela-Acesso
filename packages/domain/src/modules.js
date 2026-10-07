// Catalogo dos modulos contratados (Painel do Desenvolvedor > Modulos). A organizacao contrata o plano base,
// modulos INTEIROS, adicionais avulsos e, so pela equipe da plataforma, chaves tecnicas. Cada item liga/desliga
// um conjunto de chaves de tenants.features_enabled; as telas leem `features.x === true` (ausente = desligado).
// Espelha platform_module_prices.keys (migration 20261009120000). `building`: a chave ja pode ser ligada, mas
// nenhuma tela depende dela ainda (fases 2B-2D e seguintes).

export const MODULE_GROUPS = [
  { key: 'base', label: 'Base' },
  { key: 'module', label: 'Módulos' },
  { key: 'addon', label: 'Adicionais' },
  { key: 'technical', label: 'Técnico · só plataforma' },
];

export const MODULES = [
  {
    id: 'base',
    group: 'base',
    name: 'Plano base',
    summary: 'Sempre incluso. O núcleo do cadastro e da administração da organização.',
    keys: ['sites', 'zones', 'people', 'groups', 'members', 'audit'],
    fixed: true,
    includes: [
      { name: 'Locais e zonas', desc: 'Sites da organização e as zonas de cada um' },
      {
        name: 'Pessoas e grupos de acesso',
        desc: 'Cadastro de pessoas e agrupamento para as regras de acesso',
      },
      { name: 'Membros e papéis', desc: 'Quem administra a organização, com escopo por local' },
      { name: 'Auditoria', desc: 'Registro append-only das ações administrativas' },
    ],
    where: [
      {
        portal: 'Painel da organização',
        menus: 'Visão geral · Locais · Membros · Auditoria (Zonas, Pessoas e Grupos em construção)',
      },
    ],
    onDisable: null,
  },
  {
    id: 'access_control',
    group: 'module',
    name: 'Pontos de acesso e credenciais',
    summary: 'Portas, catracas e cancelas, e as credenciais de cada pessoa.',
    keys: ['access_points', 'credentials'],
    building: true,
    includes: [
      { name: 'Pontos de acesso', desc: 'Cadastro de dispositivos por local e zona' },
      {
        name: 'Credenciais',
        desc: 'Múltiplas por pessoa; PIN sempre com hash; tokens temporários com expiração e revogação',
      },
    ],
    where: [{ portal: 'Painel da organização', menus: 'Pontos de acesso · Credenciais (Fase 2B)' }],
    warning:
      'PIN nunca é guardado em texto puro. Nenhum comando local de abertura sem autenticação.',
    onDisable:
      'Os pontos de acesso deixam de aceitar credenciais desta organização. O que já foi cadastrado fica guardado.',
  },
  {
    id: 'schedules_policies',
    group: 'module',
    name: 'Janelas de acesso, feriados e políticas',
    summary: 'Quando e quem pode passar, decidido por regras determinísticas.',
    keys: ['schedules', 'holidays', 'policies'],
    building: true,
    includes: [
      {
        name: 'Janelas de acesso e feriados',
        desc: 'Janelas de acesso por grupo, com calendário de feriados',
      },
      {
        name: 'Políticas de acesso',
        desc: 'Regras avaliadas pelo motor (ALLOW, DENY, CHALLENGE, modos degradados)',
      },
    ],
    where: [
      {
        portal: 'Painel da organização',
        menus: 'Janelas de acesso · Feriados · Políticas (Fases 2C e 2D)',
      },
    ],
    onDisable: 'As regras deixam de ser editáveis. As já criadas ficam guardadas.',
  },
  {
    id: 'visitors',
    group: 'module',
    name: 'Visitantes',
    summary: 'Pré-cadastro e acesso temporário de visitantes.',
    keys: ['visitors'],
    building: true,
    includes: [
      { name: 'Pré-cadastro e acesso temporário', desc: 'Convites com validade e revogação' },
    ],
    where: [{ portal: 'Painel da organização', menus: 'Visitantes (planejado)' }],
    onDisable: 'O cadastro de visitantes some. Os registros já feitos ficam guardados.',
  },
  {
    id: 'reports',
    group: 'module',
    name: 'Relatórios e Access Evidence',
    summary: 'Explicação de cada decisão de acesso relevante e relatórios.',
    keys: ['reports', 'evidence'],
    building: true,
    includes: [
      { name: 'Access Evidence', desc: 'Por que cada decisão foi tomada; eventos append-only' },
      { name: 'Relatórios', desc: 'Consultas e exportações por período, local e zona' },
    ],
    where: [{ portal: 'Painel da organização', menus: 'Relatórios · Evidências (planejado)' }],
    onDisable: 'Relatórios e evidências deixam de aparecer. Os eventos continuam sendo guardados.',
  },
  {
    id: 'edge_agent',
    group: 'addon',
    name: 'Agente local e modo offline',
    summary: 'Opera sem nuvem: fila persistente, idempotência e heartbeat.',
    keys: ['edge_agent'],
    building: true,
    includes: [
      {
        name: 'Agente local',
        desc: 'Decide e registra localmente e sincroniza quando a nuvem voltar',
      },
    ],
    where: [{ portal: 'Painel da organização', menus: 'Dispositivos e agentes (planejado)' }],
    onDisable: 'O agente local deixa de sincronizar com esta organização.',
  },
  {
    id: 'biometrics',
    group: 'addon',
    name: 'Biometria',
    summary: 'Dado sensível (LGPD). Desligado por padrão e sempre via provedor.',
    keys: ['biometrics'],
    building: true,
    includes: [
      {
        name: 'Reconhecimento biométrico',
        desc: 'Por meio de um BiometricProvider, sujeito a benchmark e à base legal da organização',
      },
    ],
    where: [{ portal: 'Painel da organização', menus: 'Biometria' }],
    warning:
      'Só ligar com base legal e consentimento da organização. A plataforma não acessa imagens.',
    onDisable:
      'A biometria deixa de ser aceita. Os gabaritos já cadastrados devem ser tratados conforme a política de retenção.',
  },
  {
    id: 'biometrics_liveness',
    group: 'technical',
    name: 'Prova de vida',
    summary: 'Só será liberada se o provedor suportar de fato.',
    keys: ['biometrics_liveness'],
    requires: 'biometrics',
    comingSoon: true,
    includes: [],
    where: [],
    onDisable: null,
  },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m]));
const ALL_KEYS = MODULES.flatMap((m) => m.keys);
const SELLABLE = MODULES.filter(
  (m) => (m.group === 'module' || m.group === 'addon') && m.keys.length,
);

/** 'on' | 'off' | 'partial' (so parte das chaves ligadas). */
export function moduleState(features, mod) {
  if (!mod.keys.length) return 'off';
  const on = mod.keys.filter((k) => features?.[k] === true).length;
  if (on === 0) return 'off';
  return on === mod.keys.length ? 'on' : 'partial';
}

export function toggleModule(features, moduleId, enabled) {
  const mod = MODULE_BY_ID[moduleId];
  if (!mod || mod.fixed || mod.comingSoon) return features;
  if (enabled && mod.requires && moduleState(features, MODULE_BY_ID[mod.requires]) !== 'on')
    return features;
  const next = { ...features };
  for (const k of mod.keys) next[k] = enabled;
  // Quem depende deste item desliga junto.
  if (!enabled) {
    for (const dep of MODULES.filter((m) => m.requires === moduleId))
      for (const k of dep.keys) next[k] = false;
  }
  return next;
}

/** Base sempre ligada; chaves do catalogo sempre com true/false. */
export function normalizeFeatures(features) {
  const next = { ...features };
  for (const k of ALL_KEYS) next[k] = next[k] === true;
  for (const k of MODULE_BY_ID.base.keys) next[k] = true;
  return next;
}

/** Pacote = lista de planos `package` do banco: [{ id, name, items }]. 'livre' = fora dos pacotes. */
export function currentPackage(features, packages = []) {
  const on = new Set(SELLABLE.filter((m) => moduleState(features, m) === 'on').map((m) => m.id));
  if (SELLABLE.some((m) => moduleState(features, m) === 'partial')) return 'livre';
  const found = packages.find(
    (p) => p.items.length === on.size && p.items.every((id) => on.has(id)),
  );
  return found ? found.id : 'livre';
}

export function applyPackage(features, packageId, packages = []) {
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg) return features;
  return applyItems(features, pkg.items);
}

/** Liga o base e os itens informados; desliga os demais itens vendaveis. */
export function applyItems(features, itemIds) {
  const ids = new Set(itemIds || []);
  let next = normalizeFeatures(features);
  for (const m of SELLABLE) next = toggleModule(next, m.id, ids.has(m.id));
  return next;
}

/** Regra do dono: todo modulo nasce DESLIGADO; organizacao nova nasce so com o plano base. */
export function initialFeatures() {
  return applyItems({}, []);
}

/** Agrupa as linhas de tenant_feature_changes de um item por momento. */
export function moduleHistory(changes, mod) {
  const keys = new Set(mod.keys);
  const groups = new Map();
  for (const c of changes) {
    if (!keys.has(c.feature_key)) continue;
    const at = String(c.changed_at).slice(0, 19);
    const id = `${at}|${c.enabled}`;
    if (!groups.has(id))
      groups.set(id, {
        at: c.changed_at,
        enabled: c.enabled,
        author: c.changed_by_name || null,
        keys: [],
      });
    groups.get(id).keys.push(c.feature_key);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, complete: g.keys.length === mod.keys.length }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

/**
 * Rotulo do pacote atual para listagens: 'base' (so o plano base), o nome do pacote igual ao conjunto ligado
 * ou 'livre' (combinacao fora dos pacotes).
 * @param {Record<string, boolean>} features
 * @param {{ id: string, name: string, items: string[] }[]} packages
 * @returns {{ id: string, name: string }}
 */
export function describePackage(features, packages = []) {
  if (!SELLABLE.some((m) => moduleState(features, m) !== 'off'))
    return { id: 'base', name: 'Plano base' };
  const id = currentPackage(features, packages);
  const found = packages.find((p) => p.id === id);
  return found ? { id, name: found.name } : { id: 'livre', name: 'Livre' };
}
