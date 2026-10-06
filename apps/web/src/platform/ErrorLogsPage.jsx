import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { btnNeutral, field } from './ui';

const SOURCE_LABELS = {
  client: 'Frontend',
  edge_function: 'Edge Function',
  cron: 'Cron',
  business: 'Negócio',
  device: 'Dispositivo',
};
const SEVERITY_LABELS = { warn: 'Aviso', error: 'Erro', critical: 'Crítico' };
const SEVERITY_CLS = {
  warn: 'border-amber-300 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-error',
  critical: 'border-red-300 bg-red-100 text-error',
};
const PERIODS = [
  { id: 'today', label: 'Hoje' },
  { id: '7days', label: 'Semana' },
  { id: '30days', label: 'Mês' },
  { id: 'all', label: 'Tudo' },
];
const SCREEN_LABELS = {
  '/': 'Visão geral',
  '/sites': 'Locais',
  '/membros': 'Membros',
  '/auditoria': 'Auditoria',
  '/suporte': 'Suporte',
  '/login': 'Login',
  '/plataforma': 'Painel: Organizações',
  '/plataforma/planos': 'Painel: Planos',
  '/plataforma/logs': 'Painel: Logs',
  '/plataforma/suporte': 'Painel: Suporte',
  '/plataforma/configuracoes': 'Painel: Configurações',
};
const screenLabel = (s) => (s ? (SCREEN_LABELS[s] ?? s) : null);
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
const COLS =
  'id, source, category, severity, message, stack, context, tenant_id, screen, url, user_agent, occurrences, first_seen_at, last_seen_at, resolved, resolution_note';

function useOutsideClose(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return ref;
}

// Logs de erro (public.error_logs): cada linha ja e um fingerprint (a deduplicacao e do log_error), ordenado por
// mais recente por padrao; "mais frequentes" evita esconder um erro raro-mas-critico atras de ruido recente.
export function ErrorLogsPage() {
  const [logs, setLogs] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [tenantId, setTenantId] = useState('all');
  const [screen, setScreen] = useState('all');
  const [period, setPeriod] = useState('today');
  const [showResolved, setShowResolved] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('last_seen_at');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const periodRef = useOutsideClose(periodOpen, () => setPeriodOpen(false));
  const filtersRef = useOutsideClose(filtersOpen, () => setFiltersOpen(false));

  const activeFilters = [
    source !== 'all',
    severity !== 'all',
    tenantId !== 'all',
    screen !== 'all',
    sortBy !== 'last_seen_at',
    showResolved,
    search.trim(),
  ].filter(Boolean).length;
  const tenantName = useMemo(
    () => Object.fromEntries(tenants.map((t) => [t.id, t.name])),
    [tenants],
  );

  useEffect(() => {
    void supabase
      .from('tenants')
      .select('id, name')
      .then(({ data }) => setTenants(data ?? []));
  }, []);

  async function fetchLogs() {
    setLoading(true);
    setErrorMsg('');
    let query = supabase.from('error_logs').select(COLS).limit(300);
    if (source !== 'all') query = query.eq('source', source);
    if (severity !== 'all') query = query.eq('severity', severity);
    if (tenantId !== 'all') query = query.eq('tenant_id', tenantId);
    if (screen !== 'all') query = query.eq('screen', screen);
    if (!showResolved) query = query.eq('resolved', false);
    if (period !== 'all') {
      const start = new Date();
      if (period === 'today') start.setHours(0, 0, 0, 0);
      else if (period === '7days') start.setDate(start.getDate() - 6);
      else start.setDate(start.getDate() - 29);
      query = query.gte('last_seen_at', start.toISOString());
    }
    const { data, error } = await query.order(sortBy, { ascending: false });
    if (error) setErrorMsg('Não foi possível carregar os logs de erro.');
    else setLogs(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void fetchLogs();
  }, [source, severity, tenantId, screen, period, showResolved, sortBy]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return term
      ? logs.filter(
          (l) => l.message.toLowerCase().includes(term) || l.category.toLowerCase().includes(term),
        )
      : logs;
  }, [logs, search]);

  const categoryCounts = useMemo(() => {
    const counts = new Map();
    for (const l of filtered) counts.set(l.category, (counts.get(l.category) || 0) + l.occurrences);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // So oferece no filtro as telas que de fato tem log agora (baseado em `logs`, nao em `filtered`).
  const screens = useMemo(
    () => [...new Set(logs.map((l) => l.screen).filter(Boolean))].sort(),
    [logs],
  );

  async function setResolved(log, resolved) {
    setSaving(true);
    const { error } = await supabase
      .from('error_logs')
      .update({ resolved, resolution_note: resolved ? note || null : null })
      .eq('id', log.id);
    setSaving(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível atualizar o log.'));
    setLogs((prev) =>
      resolved && !showResolved
        ? prev.filter((l) => l.id !== log.id)
        : prev.map((l) => (l.id === log.id ? { ...l, resolved } : l)),
    );
    if (resolved) {
      setExpanded(null);
      setNote('');
    }
  }

  const sel =
    'w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-bold text-on-surface outline-none';

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-zela-md bg-primary/10 p-2.5 text-primary">
            <Bug size={20} aria-hidden="true" />
          </div>
          <div className="relative min-w-0" ref={periodRef}>
            <button
              type="button"
              aria-expanded={periodOpen}
              onClick={() => setPeriodOpen((o) => !o)}
              className="flex items-center gap-1.5 text-h3 text-on-surface transition hover:text-primary"
            >
              <span className="truncate">Logs de erro</span>
              <span className="whitespace-nowrap text-primary">
                — {PERIODS.find((p) => p.id === period)?.label}
              </span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-primary transition-transform ${periodOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {periodOpen && (
              <div
                role="menu"
                className="absolute top-full left-0 z-20 mt-1.5 w-40 rounded-zela-md border border-outline-variant bg-white p-1 shadow-lg"
              >
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPeriod(p.id);
                      setPeriodOpen(false);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold transition ${period === p.id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${filtersOpen ? 'border-primary/40 bg-primary/10 text-primary' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:text-on-surface'}`}
            >
              <SlidersHorizontal size={13} aria-hidden="true" /> Filtros
              {activeFilters > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[9px] font-black text-white">
                  {activeFilters}
                </span>
              )}
            </button>
            {filtersOpen && (
              <div className="absolute top-full right-0 z-20 mt-1.5 w-72 max-w-[calc(100vw-2.5rem)] space-y-2.5 rounded-zela-md border border-outline-variant bg-white p-3 shadow-lg">
                <input
                  type="text"
                  placeholder="Buscar por mensagem ou categoria..."
                  aria-label="Buscar nos logs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${field} !rounded-xl !text-xs`}
                />
                <select
                  aria-label="Fonte"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className={sel}
                >
                  <option value="all">Todas as fontes</option>
                  {Object.entries(SOURCE_LABELS).map(([id, l]) => (
                    <option key={id} value={id}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Severidade"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className={sel}
                >
                  <option value="all">Toda severidade</option>
                  {Object.entries(SEVERITY_LABELS).map(([id, l]) => (
                    <option key={id} value={id}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Organização"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className={sel}
                >
                  <option value="all">Todas as organizações</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Tela"
                  value={screen}
                  onChange={(e) => setScreen(e.target.value)}
                  className={sel}
                >
                  <option value="all">Todas as telas</option>
                  {screens.map((s) => (
                    <option key={s} value={s}>
                      {screenLabel(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Ordenação"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={sel}
                >
                  <option value="occurrences">Mais frequentes</option>
                  <option value="last_seen_at">Mais recentes</option>
                </select>
                <label className="flex cursor-pointer items-center gap-1.5 px-1 py-1 text-xs font-bold text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={(e) => setShowResolved(e.target.checked)}
                  />{' '}
                  Ver resolvidos
                </label>
                {categoryCounts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-outline-variant pt-1">
                    {categoryCounts.map(([category, count]) => (
                      <span
                        key={category}
                        className="rounded-full border border-outline-variant bg-surface px-2 py-1 text-[9.5px] font-bold text-on-surface-variant"
                      >
                        {category} <span className="text-on-surface">{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void fetchLogs()}
            title="Atualizar"
            aria-label="Atualizar"
            className="rounded-lg p-2 text-on-surface-variant transition hover:bg-primary/10 hover:text-primary"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <p
          role="alert"
          className="rounded-zela-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-error"
        >
          {errorMsg}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div
            className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
            role="status"
            aria-label="Carregando"
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-on-surface-variant">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 opacity-40" aria-hidden="true" />
          <p className="text-sm font-semibold">Nenhum erro no filtro atual.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((log) => {
            const open = expanded === log.id;
            return (
              <li
                key={log.id}
                className={`overflow-hidden rounded-zela-md border border-outline-variant bg-surface-container-lowest ${log.resolved ? 'opacity-60' : ''}`}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    setExpanded(open ? null : log.id);
                    setNote('');
                  }}
                  className="flex w-full items-start gap-3 p-3.5 text-left transition hover:bg-surface-container-low"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${SEVERITY_CLS[log.severity] || SEVERITY_CLS.error}`}
                      >
                        {SEVERITY_LABELS[log.severity] || log.severity}
                      </span>
                      <span className="rounded bg-surface-container px-1.5 py-0.5 text-[9px] font-bold uppercase text-on-surface-variant">
                        {SOURCE_LABELS[log.source] || log.source}
                      </span>
                      <span className="rounded bg-surface-container px-1.5 py-0.5 text-[9px] font-bold uppercase text-on-surface-variant">
                        {log.category}
                      </span>
                      {screenLabel(log.screen) && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                          {screenLabel(log.screen)}
                        </span>
                      )}
                      {log.occurrences > 1 && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-black text-primary">
                          {log.occurrences}x
                        </span>
                      )}
                      {log.resolved && (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 uppercase">
                          Resolvido
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm font-bold text-on-surface">{log.message}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
                      <span>1ª vez: {fmt(log.first_seen_at)}</span>
                      <span>última: {fmt(log.last_seen_at)}</span>
                      {log.tenant_id && (
                        <span>
                          organização:{' '}
                          {tenantName[log.tenant_id] || `${log.tenant_id.slice(0, 8)}…`}
                        </span>
                      )}
                    </div>
                  </div>
                  {open ? (
                    <ChevronUp size={16} className="shrink-0 text-on-surface-variant" />
                  ) : (
                    <ChevronDown size={16} className="shrink-0 text-on-surface-variant" />
                  )}
                </button>

                {open && (
                  <div className="space-y-3 border-t border-outline-variant bg-surface-container-low/40 p-3.5">
                    {log.context && (
                      <div>
                        <p className="mb-1 text-[10px] font-bold tracking-wide text-on-surface-variant uppercase">
                          Contexto
                        </p>
                        <pre className="max-h-56 overflow-y-auto rounded-lg bg-surface-container-lowest p-2.5 text-[11px] break-all whitespace-pre-wrap text-on-surface-variant">
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.stack && (
                      <div>
                        <p className="mb-1 text-[10px] font-bold tracking-wide text-on-surface-variant uppercase">
                          Stack
                        </p>
                        <pre className="max-h-56 overflow-y-auto rounded-lg bg-surface-container-lowest p-2.5 text-[11px] break-all whitespace-pre-wrap text-on-surface-variant">
                          {log.stack}
                        </pre>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-on-surface-variant">
                      {log.url && <span className="max-w-full truncate">{log.url}</span>}
                      {log.user_agent && (
                        <span className="max-w-full truncate">{log.user_agent}</span>
                      )}
                    </div>
                    {log.resolved ? (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-[11px] text-on-surface-variant">
                          {log.resolution_note
                            ? `Nota: ${log.resolution_note}`
                            : 'Sem nota de resolução.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => void setResolved(log, false)}
                          disabled={saving}
                          className={`${btnNeutral} shrink-0 !px-3 !py-1.5 !text-xs`}
                        >
                          <RotateCcw size={13} aria-hidden="true" /> Reabrir
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                        <input
                          type="text"
                          placeholder="Nota de resolução (opcional)"
                          aria-label="Nota de resolução"
                          maxLength={1000}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className={`${field} flex-1 !py-1.5 !text-xs`}
                        />
                        <button
                          type="button"
                          onClick={() => void setResolved(log, true)}
                          disabled={saving}
                          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 size={13} aria-hidden="true" /> Marcar como resolvido
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
