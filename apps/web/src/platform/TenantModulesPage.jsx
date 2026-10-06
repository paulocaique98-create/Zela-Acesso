import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Cpu,
  DoorOpen,
  History,
  Loader2,
  Lock,
  ScanFace,
  ShieldAlert,
  Timer,
  UserPlus,
} from 'lucide-react';
import {
  MODULES,
  MODULE_BY_ID,
  MODULE_GROUPS,
  applyPackage,
  currentPackage,
  moduleHistory,
  moduleState,
  normalizeFeatures,
  toggleModule,
} from '@zela/domain';
import { ConfirmModal } from '../components/ConfirmModal';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { btnNeutral, btnPrimary, notice } from './ui';

// Modulos contratados (lista e detalhe). A esquerda o pacote e a lista agrupada (Base, Modulos, Adicionais,
// Tecnico); a direita o detalhe: o que inclui, onde aparece, o que acontece ao desligar e o historico
// (tenant_feature_changes, gravado por trigger). Regras em packages/domain/src/modules.js.

const ICONS = {
  base: Lock,
  access_control: DoorOpen,
  schedules_policies: Timer,
  visitors: UserPlus,
  reports: BarChart3,
  edge_agent: Cpu,
  biometrics: ScanFace,
  biometrics_liveness: ShieldAlert,
};
const STATE_LABEL = { on: 'Ligado', off: 'Desligado', partial: 'Parcial' };
const STATE_DOT = { on: 'bg-emerald-500', off: 'bg-slate-300', partial: 'bg-amber-500' };

function statusOf(features, mod) {
  if (mod.fixed) return { label: 'Sempre', dot: 'bg-slate-400' };
  if (mod.comingSoon) return { label: 'Em breve', dot: 'border border-dashed border-slate-400' };
  const state = moduleState(features, mod);
  return { label: STATE_LABEL[state], dot: STATE_DOT[state], state };
}

function Switch({ on, disabled, onChange, name }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={name}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-primary' : 'bg-outline-variant'}`}
    >
      <span
        className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[21px]' : 'translate-x-[3px]'}`}
      />
    </button>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-zela-lg border border-outline-variant bg-surface-container-lowest p-4">
      <p className="text-[11px] font-bold tracking-wider text-on-surface-variant uppercase">
        {title}
      </p>
      {children}
    </section>
  );
}

const when = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

export function TenantModulesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { platformRole } = useWorkspace();
  const canEdit = platformRole === 'platform_owner';
  const [tenant, setTenant] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState('access_control');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [changes, setChanges] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [packages, setPackages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('tenant_feature_changes')
      .select('feature_key, enabled, changed_at, changed_by_name')
      .eq('tenant_id', id)
      .order('changed_at', { ascending: false })
      .limit(1000);
    setChanges(data ?? []);
    setLoadingHistory(false);
  }, [id]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, pk] = await Promise.all([
        supabase
          .from('tenants')
          .select('id, name, org_code, features_enabled')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('platform_plans')
          .select('id, name, items')
          .eq('mode', 'package')
          .eq('active', true)
          .order('sort_order')
          .limit(50),
      ]);
      if (!alive) return;
      if (t.error || !t.data) {
        setLoadError('Organização não encontrada.');
        return;
      }
      setTenant(t.data);
      setDraft(normalizeFeatures(t.data.features_enabled));
      setPackages(
        (pk.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          items: (p.items ?? []).filter((i) => MODULE_BY_ID[i]),
        })),
      );
    })();
    void loadHistory();
    return () => {
      alive = false;
    };
  }, [id, loadHistory]);

  const original = tenant?.features_enabled;
  const changedKeys = useMemo(
    () =>
      draft && original
        ? MODULES.flatMap((m) => m.keys).filter((k) => draft[k] !== (original[k] === true))
        : [],
    [draft, original],
  );
  const changedItems = new Set(
    MODULES.filter((m) => m.keys.some((k) => changedKeys.includes(k))).map((m) => m.id),
  );

  if (loadError) {
    return (
      <section className="space-y-3">
        <p role="alert" className="text-error">
          {loadError}
        </p>
        <button type="button" className={btnNeutral} onClick={() => navigate('/plataforma')}>
          <ArrowLeft size={16} /> Organizações
        </button>
      </section>
    );
  }
  if (!tenant || !draft) return <p>Carregando…</p>;

  const pkgId = currentPackage(draft, packages);
  const pkg = packages.find((p) => p.id === pkgId);
  const mod = MODULE_BY_ID[selectedId];
  const status = statusOf(draft, mod);
  const requirementOk = !mod.requires || moduleState(draft, MODULE_BY_ID[mod.requires]) === 'on';
  const inPackages = packages.filter((p) => p.items.includes(mod.id)).map((p) => p.name);
  const history = moduleHistory(changes, mod);
  const Icon = ICONS[mod.id] || Lock;

  const back = () => (changedKeys.length ? setConfirmLeave(true) : navigate('/plataforma'));
  const select = (mid) => {
    setSelectedId(mid);
    setMobileDetail(true);
  };

  async function save() {
    setSaving(true);
    // Mantem chaves que o catalogo nao conhece; so troca as do catalogo.
    const merged = { ...original, ...draft };
    const { error } = await supabase.rpc('platform_set_features', {
      p_tenant: id,
      p_features: merged,
    });
    if (error) {
      setSaving(false);
      return toast.error(safeMessage(error, 'Não foi possível salvar os módulos.'));
    }
    const { data } = await supabase
      .from('tenants')
      .select('id, name, org_code, features_enabled')
      .eq('id', id)
      .maybeSingle();
    if (data) {
      setTenant(data);
      setDraft(normalizeFeatures(data.features_enabled));
    }
    setSaving(false);
    toast.success('Módulos salvos.');
    void loadHistory();
  }

  const list = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-bold tracking-wider text-on-surface-variant uppercase">
          Pacote
        </p>
        <div
          className="flex gap-0.5 rounded-zela-md border border-outline-variant bg-surface-container-lowest p-[3px]"
          role="group"
          aria-label="Pacote"
        >
          {packages.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!canEdit}
              onClick={() => setDraft((d) => applyPackage(d, p.id, packages))}
              aria-pressed={pkgId === p.id}
              className={`min-h-[36px] flex-1 rounded-[9px] px-1 text-xs font-bold transition ${pkgId === p.id ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              {p.name}
            </button>
          ))}
          <span
            className={`flex min-h-[36px] flex-1 items-center justify-center rounded-[9px] px-1 text-xs font-bold ${pkgId === 'livre' ? 'bg-surface-container text-on-surface' : 'text-on-surface-variant/60'}`}
          >
            Livre
          </span>
        </div>
        <p className="text-[11px] text-on-surface-variant">
          {packages.length === 0
            ? 'Nenhum pacote cadastrado em Planos. Os módulos podem ser combinados livremente.'
            : pkgId === 'livre'
              ? 'Combinação fora dos pacotes.'
              : `Pacote ${pkg.name}: plano base${pkg.items.map((i) => ` + ${MODULE_BY_ID[i].name}`).join('')}.`}
        </p>
      </div>

      {MODULE_GROUPS.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[11px] font-bold tracking-wider text-on-surface-variant uppercase">
            {g.label}
          </p>
          {MODULES.filter((m) => m.group === g.key).map((m) => {
            const st = statusOf(draft, m);
            const active = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => select(m.id)}
                aria-current={active ? 'true' : undefined}
                className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-zela-md px-3 text-left transition ${active ? 'md:bg-primary/10 md:ring-1 md:ring-primary/30' : 'hover:bg-surface-container/60'}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-bold ${m.comingSoon ? 'text-on-surface-variant' : 'text-on-surface'}`}
                >
                  {m.name}
                </span>
                {changedItems.has(m.id) && (
                  <span className="text-[10px] font-bold text-amber-700">alterado</span>
                )}
                <span className="text-xs whitespace-nowrap text-on-surface-variant">
                  {st.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const detail = (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-zela-md bg-primary/10 text-primary">
          <Icon size={22} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-extrabold text-on-surface">{mod.name}</h2>
          <p className="text-xs text-on-surface-variant">
            {mod.summary}
            {inPackages.length > 0 && ` · Nos pacotes ${inPackages.join(' e ')}`}
          </p>
        </div>
        {!mod.fixed && !mod.comingSoon && canEdit && (
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="hidden text-sm font-bold sm:inline">{status.label}</span>
            <Switch
              on={status.state === 'on'}
              disabled={!requirementOk && status.state !== 'on'}
              onChange={(v) => setDraft((d) => toggleModule(d, mod.id, v))}
              name={mod.name}
            />
          </div>
        )}
      </div>

      {mod.building && (
        <p className={notice}>
          <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" />
          Funcionalidade ainda em construção: a chave já pode ser ligada, mas nenhuma tela do painel
          da organização depende dela hoje.
        </p>
      )}
      {status.state === 'partial' && (
        <p className={notice}>
          <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" /> Só parte deste
          módulo está ligada (configuração antiga). Ao ligar, entra inteiro.
        </p>
      )}
      {!requirementOk && (
        <p className={notice}>
          <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" /> Depende de “
          {MODULE_BY_ID[mod.requires].name}” ligado.
        </p>
      )}

      {mod.comingSoon ? (
        <Section title="Em breve">
          <p className="text-sm">
            Este item só será liberado quando houver suporte real. Por enquanto não há nada para
            ligar.
          </p>
        </Section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="O que inclui">
            {mod.includes.map((inc) => (
              <div
                key={inc.name}
                className="border-t border-outline-variant/60 py-2 first-of-type:border-t-0"
              >
                <p className="text-sm font-bold">{inc.name}</p>
                <p className="text-xs text-on-surface-variant">{inc.desc}</p>
              </div>
            ))}
          </Section>
          <Section title="Onde aparece">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {mod.where.map((w) => (
                  <tr
                    key={w.portal}
                    className="border-t border-outline-variant/60 first:border-t-0"
                  >
                    <td className="py-2 pr-3 align-top font-bold whitespace-nowrap">{w.portal}</td>
                    <td className="py-2 text-on-surface-variant">{w.menus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          {(mod.warning || mod.onDisable) && (
            <Section title="Atenção">
              {mod.warning && <p className="text-sm">{mod.warning}</p>}
              {mod.onDisable && (
                <p className="text-sm text-amber-800">
                  <strong>Ao desligar:</strong> {mod.onDisable}
                </p>
              )}
            </Section>
          )}
          <Section title="Histórico">
            {loadingHistory ? (
              <Loader2
                size={18}
                className="animate-spin text-on-surface-variant"
                aria-label="Carregando"
              />
            ) : history.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-on-surface-variant">
                <History size={15} aria-hidden="true" /> Nenhuma mudança registrada.
              </p>
            ) : (
              history.slice(0, 8).map((h) => (
                <div
                  key={`${h.at}-${h.enabled}`}
                  className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-outline-variant/60 py-1.5 text-sm first-of-type:border-t-0"
                >
                  <span>
                    {h.enabled ? 'Ligado' : 'Desligado'}
                    {!h.complete && (
                      <span className="text-on-surface-variant"> · só {h.keys.join(', ')}</span>
                    )}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {when(h.at)} · {h.author || 'sistema'}
                  </span>
                </div>
              ))
            )}
          </Section>
        </div>
      )}
    </div>
  );

  return (
    <div className="-m-4 flex min-h-[calc(100dvh-4rem)] flex-col bg-surface md:-m-6">
      <div className="flex shrink-0 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={() => (mobileDetail ? setMobileDetail(false) : back())}
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-zela-md text-on-surface-variant hover:bg-surface-container md:hidden"
          aria-label={
            mobileDetail ? 'Voltar para a lista de módulos' : 'Voltar para as organizações'
          }
        >
          <ArrowLeft size={20} />
        </button>
        <button
          type="button"
          onClick={back}
          className="hidden items-center gap-1.5 text-sm font-bold text-primary hover:underline md:flex"
        >
          <ArrowLeft size={16} /> Organizações
        </button>
        <div className="min-w-0 flex-1 md:border-l md:border-outline-variant md:pl-3">
          <h1 className="truncate text-base font-extrabold sm:text-lg">Módulos contratados</h1>
          <p className="truncate text-xs text-on-surface-variant">
            {tenant.name} · {tenant.org_code}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`${mobileDetail ? 'hidden' : 'flex'} w-full shrink-0 flex-col overflow-y-auto bg-surface-container-low/40 p-4 md:flex md:w-[320px] md:border-r md:border-outline-variant lg:w-[360px]`}
        >
          {list}
        </aside>
        <main
          className={`${mobileDetail ? 'block' : 'hidden'} min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 md:block`}
        >
          {detail}
        </main>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-outline-variant bg-surface-container-lowest px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          {!canEdit ? (
            <p className="text-sm text-on-surface-variant">
              Somente leitura (suporte da plataforma).
            </p>
          ) : changedKeys.length ? (
            <p className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" /> {changedItems.size}{' '}
              {changedItems.size === 1 ? 'item alterado' : 'itens alterados'} · não salvo
            </p>
          ) : (
            <p className="truncate text-sm text-on-surface-variant">
              {pkgId === 'livre' ? 'Combinação livre' : pkg ? `Pacote ${pkg.name}` : 'Plano base'} ·
              tudo salvo
            </p>
          )}
        </div>
        {canEdit && changedKeys.length > 0 && (
          <button
            type="button"
            onClick={() => setDraft(normalizeFeatures(original))}
            disabled={saving}
            className={`${btnNeutral} hidden sm:inline-flex`}
          >
            Descartar
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!changedKeys.length || saving}
            className={btnPrimary}
          >
            {saving && <Loader2 size={15} className="animate-spin" />} Salvar alterações
          </button>
        )}
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="Sair sem salvar?"
          message="As mudanças nos módulos desta organização ainda não foram salvas e serão perdidas."
          confirmLabel="Sair sem salvar"
          onConfirm={() => {
            setConfirmLeave(false);
            navigate('/plataforma');
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}
