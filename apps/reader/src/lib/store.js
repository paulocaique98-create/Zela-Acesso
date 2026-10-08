// Estado persistente do leitor sobre o `kv`: identidade, ajustes, últimas leituras (sem dado pessoal) e log técnico.
export const DEFAULT_SETTINGS = Object.freeze({
  transport: 'websocket', // 'websocket' | 'https' (TCP/IP bruto só no app nativo)
  facingMode: 'environment',
  log: false,
});
export const MAX_RECORDS = 100;
export const MAX_LOG = 200;

export const loadSettings = async (kv) => ({ ...DEFAULT_SETTINGS, ...(await kv.get('settings')) });
export const saveSettings = (kv, s) => kv.set('settings', s);

/** Última leitura: só método, resultado e hora. NUNCA o valor lido, o identificador nem o nome da pessoa. */
export async function addRecord(kv, rec) {
  const list = (await kv.get('records')) ?? [];
  const next = [
    { at: rec.at, method: rec.method, outcome: rec.outcome, delivered: rec.delivered },
    ...list,
  ];
  await kv.set('records', next.slice(0, MAX_RECORDS));
  return next.slice(0, MAX_RECORDS);
}
export const loadRecords = async (kv) => (await kv.get('records')) ?? [];

/** Log técnico (opcional): evento e código, sem corpo de mensagem nem segredo. */
export async function addLog(kv, enabled, event, code) {
  if (!enabled) return;
  const list = (await kv.get('log')) ?? [];
  list.push({
    at: Date.now(),
    event: String(event).slice(0, 40),
    code: String(code ?? '').slice(0, 40),
  });
  await kv.set('log', list.slice(-MAX_LOG));
}
export const loadLog = async (kv) => (await kv.get('log')) ?? [];

/** Apaga TUDO deste aparelho (identidade, PIN do operador, registros, log): o leitor volta a precisar de ativação. */
export async function wipeDevice(kv) {
  for (const k of ['identity', 'operator', 'records', 'log', 'settings']) await kv.del(k);
}
