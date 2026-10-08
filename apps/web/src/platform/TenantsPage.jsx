import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  Dices,
  Edit2,
  Eye,
  EyeOff,
  FileSignature,
  LayoutGrid,
  MoreVertical,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { describePackage } from '@zela/domain';
import { formatCep, formatCnpj, generatePassword, isValidCnpj } from '../lib/br';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { ContractPlanForTenant } from './ContractPlanModal';
import {
  EMPTY_FORM,
  UFS,
  applyCompany,
  buildDetails,
  buildLimits,
  createErrorMessage,
  formFromTenant,
  slugify,
  validateForm,
} from './tenantForm';
import { btnNeutral, btnPrimary, field, label, modalBackdrop } from './ui';

const AVATAR_PALETTE = ['#4f46e5', '#b45309', '#047857', '#be123c', '#1d4ed8', '#7e22ce'];
const initials = (name) =>
  (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

async function functionErrorMessage(error) {
  // O corpo das nossas respostas de erro e controlado (sem texto de banco); falha de rede/funcao ausente e generica.
  try {
    const body = await error.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    /* corpo ilegivel */
  }
  return 'Serviço de criação de contas indisponível neste ambiente. Tente novamente ou use o e-mail de uma conta existente.';
}

async function lookupErrorMessage(error) {
  try {
    const body = await error.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    /* corpo ilegivel */
  }
  return 'Consulta de CNPJ indisponível neste ambiente. Preencha manualmente.';
}

function TenantModal({ tenant, details, onClose, onSaved }) {
  const editing = !!tenant;
  const [form, setForm] = useState(() =>
    tenant ? formFromTenant(tenant, details) : { ...EMPTY_FORM },
  );
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [looking, setLooking] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const effectiveSlug = form.slugTouched ? form.slug : slugify(form.name);

  // Preenche os campos vazios a partir do CNPJ (API aberta da CNPJa via Edge Function). Falha nunca bloqueia o cadastro manual.
  async function lookupCnpj() {
    setLooking(true);
    const { data, error: err } = await supabase.functions.invoke('lookup-cnpj', {
      body: { cnpj: form.tax_id },
    });
    setLooking(false);
    if (err) return toast.error(await lookupErrorMessage(err));
    const company = data?.company ?? {};
    const { form: next, filled } = applyCompany(form, company);
    setForm(next);
    const inactive = company.status && company.status !== 'Ativa';
    if (inactive) toast.error(`Situação cadastral na Receita: ${company.status}.`);
    else
      toast.success(
        filled
          ? `${filled} campo(s) preenchido(s) pelo CNPJ.`
          : 'Nenhum campo vazio para preencher.',
      );
  }

  async function submit(e) {
    e.preventDefault();
    const problem = validateForm(form, !editing);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    let message = null;
    if (editing) {
      const { error: err } = await supabase.rpc('platform_update_tenant', {
        p_tenant: tenant.id,
        p_name: form.name.trim(),
        p_details: buildDetails(form),
        p_limits: buildLimits(form),
      });
      if (err)
        message =
          err.code === '42501'
            ? 'Você não tem permissão para editar organizações.'
            : 'Não foi possível salvar as alterações.';
    } else if (form.owner_password) {
      const { error: err } = await supabase.functions.invoke('create-tenant-owner', {
        body: {
          name: form.name.trim(),
          slug: effectiveSlug,
          owner_name: form.owner_name.trim(),
          owner_email: form.owner_email.trim(),
          password: form.owner_password,
          details: buildDetails(form),
        },
      });
      if (err) message = await functionErrorMessage(err);
    } else {
      const { error: err } = await supabase.rpc('platform_create_tenant', {
        p_name: form.name.trim(),
        p_slug: effectiveSlug,
        p_owner_user_id: null,
        p_owner_email: form.owner_email.trim(),
        p_details: buildDetails(form),
      });
      if (err) message = createErrorMessage(err);
    }
    setBusy(false);
    if (message) return setError(message);
    toast.success(editing ? 'Organização atualizada.' : 'Organização criada.');
    onSaved();
  }

  const text = (id, text, key, extra = {}) => (
    <div className={extra.wrapper}>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      <input
        id={id}
        type={extra.type || 'text'}
        className={field}
        value={form[key]}
        onChange={extra.onChange || set(key)}
        {...extra.input}
      />
    </div>
  );

  return (
    <div className={`${modalBackdrop} !items-center sm:p-4`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tenant-modal-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-zela-xl border border-outline-variant bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface px-5 py-4">
          <h2
            id="tenant-modal-title"
            className="flex items-center gap-2 text-lg font-bold text-on-surface"
          >
            <Building2 size={20} className="text-primary" aria-hidden="true" />
            {editing ? `Editar ${tenant.org_code}` : 'Nova organização contratante'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 text-on-surface-variant hover:text-on-surface"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="t-cnpj" className={label}>
                CNPJ
              </label>
              <div className="flex gap-2">
                <input
                  id="t-cnpj"
                  className={field}
                  value={form.tax_id}
                  onChange={(e) => setForm((f) => ({ ...f, tax_id: formatCnpj(e.target.value) }))}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                />
                <button
                  type="button"
                  className={`${btnNeutral} shrink-0`}
                  disabled={looking || !isValidCnpj(form.tax_id)}
                  onClick={() => void lookupCnpj()}
                >
                  <Search size={16} aria-hidden="true" />
                  {looking ? 'Buscando…' : 'Buscar dados'}
                </button>
              </div>
              <p className="mt-1 text-caption text-on-surface-variant">
                Preenche os campos vazios com os dados públicos do CNPJ.
              </p>
            </div>
            {text('t-name', 'Nome fantasia', 'name', {
              input: { required: true, minLength: 2, maxLength: 120 },
            })}
            {text('t-legal', 'Razão social', 'legal_name', {
              input: { placeholder: 'Como está no CNPJ', maxLength: 200 },
            })}
            {text('t-im', 'Inscrição municipal', 'municipal_registration', {
              input: { maxLength: 40 },
            })}
            {text('t-email', 'E-mail da organização', 'contact_email', { type: 'email' })}
            {text('t-phone', 'Telefone', 'contact_phone', { input: { maxLength: 30 } })}
            {!editing &&
              text('t-slug', 'Identificador (não pode ser alterado depois)', 'slug', {
                wrapper: 'md:col-span-2',
                input: { required: true, value: effectiveSlug },
                onChange: (e) =>
                  setForm((f) => ({ ...f, slugTouched: true, slug: e.target.value.toLowerCase() })),
              })}

            <fieldset className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-6">
              <legend className="mb-2 text-caption font-bold tracking-wide text-on-surface-variant uppercase">
                Endereço (sai no contrato)
              </legend>
              {text('t-cep', 'CEP', 'postal_code', {
                wrapper: 'md:col-span-2',
                onChange: (e) => setForm((f) => ({ ...f, postal_code: formatCep(e.target.value) })),
                input: { inputMode: 'numeric', placeholder: '00000-000' },
              })}
              {text('t-street', 'Logradouro', 'street', {
                wrapper: 'md:col-span-3',
                input: { maxLength: 200 },
              })}
              {text('t-number', 'Número', 'street_number', {
                wrapper: 'md:col-span-1',
                input: { maxLength: 20 },
              })}
              {text('t-compl', 'Complemento', 'address_complement', {
                wrapper: 'md:col-span-2',
                input: { maxLength: 100 },
              })}
              {text('t-district', 'Bairro', 'district', {
                wrapper: 'md:col-span-2',
                input: { maxLength: 120 },
              })}
              {text('t-city', 'Cidade', 'city', {
                wrapper: 'md:col-span-1',
                input: { maxLength: 120 },
              })}
              <div className="md:col-span-1">
                <label htmlFor="t-uf" className={label}>
                  UF
                </label>
                <select id="t-uf" className={field} value={form.state} onChange={set('state')}>
                  <option value="">—</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            <div className="md:col-span-2">
              <label htmlFor="t-notes" className={label}>
                Notas internas da Arx
              </label>
              <textarea
                id="t-notes"
                rows={2}
                maxLength={2000}
                className={field}
                value={form.notes}
                onChange={set('notes')}
              />
              <p className="mt-1 text-caption text-on-surface-variant">
                Visível só para a plataforma; a organização não vê.
              </p>
            </div>
          </div>

          <div className="border-t border-outline-variant pt-4">
            <h3 className="text-sm font-bold text-on-surface">Limites contratados</h3>
            <p className="mb-3 text-xs text-on-surface-variant">
              Valores registrados para o contrato. A aplicação automática dos limites ainda não está
              ativa; vazio = sem limite registrado.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text('t-maxsites', 'Locais (sites)', 'max_sites', {
                type: 'number',
                input: { min: 0, max: 100000 },
              })}
              {text('t-maxpeople', 'Pessoas cadastradas', 'max_people', {
                type: 'number',
                input: { min: 0, max: 100000 },
              })}
            </div>
          </div>

          {!editing && (
            <div className="border-t border-outline-variant pt-4">
              <h3 className="text-sm font-bold text-primary">
                Responsável pela organização (primeiro acesso)
              </h3>
              <p className="mb-3 text-xs text-on-surface-variant">
                Será o <strong>organization_owner</strong>, quem convida e administra os demais.
                Informando uma senha, a conta é criada agora e a pessoa troca a senha no primeiro
                login. Sem senha, o e-mail precisa ser de uma conta que já existe.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {text('t-oname', 'Nome do responsável', 'owner_name', {
                  wrapper: 'md:col-span-2',
                  input: { placeholder: 'Ex.: Ana Paula Souza', maxLength: 120 },
                })}
                {text('t-oemail', 'E-mail de login', 'owner_email', {
                  type: 'email',
                  input: {
                    required: true,
                    placeholder: 'responsavel@empresa.com.br',
                    autoComplete: 'off',
                  },
                })}
                <div>
                  <label htmlFor="t-opass" className={label}>
                    Senha de acesso (opcional)
                  </label>
                  <div className="flex gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="t-opass"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className={`${field} pr-9`}
                        placeholder="Mínimo 8 caracteres"
                        value={form.owner_password}
                        onChange={set('owner_password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={
                          showPassword
                            ? 'Ocultar senha do responsável'
                            : 'Exibir senha do responsável'
                        }
                        className="absolute top-1/2 right-2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      title="Gerar senha forte"
                      aria-label="Gerar senha forte"
                      onClick={() => {
                        setForm((f) => ({ ...f, owner_password: generatePassword(16) }));
                        setShowPassword(true);
                      }}
                      className={`${btnNeutral} px-2.5`}
                    >
                      <Dices size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-zela-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-error"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-outline-variant pt-4">
            <button type="button" onClick={onClose} className={btnNeutral}>
              Cancelar
            </button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar organização'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RowMenu({ open, onToggle, items }) {
  return (
    <>
      <button
        type="button"
        data-tenants-menu
        aria-label="Mais ações"
        aria-expanded={open}
        onClick={onToggle}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container hover:text-on-surface"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          data-tenants-menu
          role="menu"
          className="absolute top-full right-4 z-20 mt-1 w-44 rounded-zela-md border border-outline-variant bg-white py-1 shadow-lg"
        >
          {items.map(({ id, icon: Icon, text, run }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={run}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-on-surface transition hover:bg-surface-container"
            >
              <Icon size={13} aria-hidden="true" /> {text}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function StatusSwitch({ tenant, onToggle }) {
  const on = tenant.status === 'active';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? 'Suspender' : 'Reativar'} acesso de ${tenant.name}`}
      title={on ? 'Suspender acesso' : 'Reativar acesso'}
      onClick={() => onToggle(tenant)}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-outline-variant'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export function TenantsPage() {
  const { platformRole } = useWorkspace();
  const navigate = useNavigate();
  const isOwner = platformRole === 'platform_owner';
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState(null); // { tenant? }
  const [contractFor, setContractFor] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);

  const q = useQuery(async () => {
    const [tenants, details, plans, contracts] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, name, slug, status, org_code, features_enabled, limits, created_at')
        .order('org_code'),
      supabase
        .from('tenant_details')
        .select(
          'tenant_id, legal_name, tax_id, municipal_registration, contact_email, contact_phone, postal_code, street, street_number, address_complement, district, city, state, notes',
        ),
      supabase.from('platform_plans').select('id, name, mode, items, active'),
      supabase.from('tenant_contracts').select('tenant_id, plan_id').eq('status', 'active'),
    ]);
    if (tenants.error) throw tenants.error;
    return {
      tenants: tenants.data,
      details: Object.fromEntries((details.data ?? []).map((d) => [d.tenant_id, d])),
      plans: plans.data ?? [],
      contracts: Object.fromEntries((contracts.data ?? []).map((c) => [c.tenant_id, c.plan_id])),
    };
  }, [reload]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e) => {
      if (!e.target.closest('[data-tenants-menu]')) setOpenMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  const packages = useMemo(
    () =>
      (q.data?.plans ?? [])
        .filter((p) => p.mode === 'package' && p.active)
        .map((p) => ({ id: p.id, name: p.name, items: p.items })),
    [q.data],
  );

  async function toggleStatus(tenant) {
    const { error } = await supabase
      .from('tenants')
      .update({ status: tenant.status === 'active' ? 'suspended' : 'active' })
      .eq('id', tenant.id);
    if (error) toast.error('Não foi possível alterar o status da organização.');
    setReload((n) => n + 1);
  }

  const rows = q.data?.tenants ?? [];
  const planName = (t) => q.data.plans.find((p) => p.id === q.data.contracts[t.id])?.name;

  const menuItems = (t) => [
    {
      id: 'edit',
      icon: Edit2,
      text: 'Editar',
      run: () => {
        setModal({ tenant: t });
        setOpenMenu(null);
      },
    },
    {
      id: 'modules',
      icon: LayoutGrid,
      text: 'Módulos',
      run: () => navigate(`/plataforma/organizacoes/${t.id}/modulos`),
    },
    {
      id: 'contract',
      icon: FileSignature,
      text: 'Contratar plano',
      run: () => {
        setContractFor(t.id);
        setOpenMenu(null);
      },
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-on-surface">Organizações</h1>
          {q.data && (
            <p className="hidden text-small text-on-surface-variant sm:block">
              {rows.length} organização(ões) cadastrada(s)
            </p>
          )}
        </div>
        {isOwner && (
          <button type="button" onClick={() => setModal({})} className={`${btnPrimary} ml-auto`}>
            <Plus size={16} aria-hidden="true" /> <span>Cadastrar organização</span>
          </button>
        )}
      </div>
      {!isOwner && (
        <p className="text-small text-on-surface-variant">
          Seu papel (suporte da plataforma) é somente leitura.
        </p>
      )}

      {q.loading ? (
        <p>Carregando…</p>
      ) : q.error || !q.data ? (
        <p role="alert" className="text-error">
          {q.error ?? 'Sem dados.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-on-surface-variant">
          Nenhuma organização cadastrada.
        </p>
      ) : (
        <>
          <table className="hidden w-full border-collapse rounded-zela-md border border-outline-variant bg-surface-container-lowest md:table">
            <caption className="sr-only">Organizações cadastradas</caption>
            <thead>
              <tr className="bg-surface-container-low text-left text-[10px] font-bold tracking-wide text-on-surface-variant uppercase">
                <th scope="col" className="px-4 py-3">
                  Organização
                </th>
                <th scope="col" className="px-4 py-3">
                  Plano
                </th>
                <th scope="col" className="px-4 py-3">
                  Pacote
                </th>
                <th scope="col" className="px-4 py-3">
                  {isOwner ? 'Ativa' : 'Status'}
                </th>
                {isOwner && (
                  <th scope="col" className="w-10 px-4 py-3">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const color = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
                const detail = q.data.details[t.id];
                return (
                  <tr
                    key={t.id}
                    className={`relative border-t border-outline-variant/60 transition hover:bg-surface-container-low/60 ${t.status !== 'active' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                          style={{ background: `${color}22`, color }}
                          aria-hidden="true"
                        >
                          {initials(t.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-on-surface">{t.name}</p>
                          <p className="truncate text-[11px] text-on-surface-variant">
                            <span className="mr-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono font-bold text-primary">
                              {t.org_code}
                            </span>
                            {detail?.tax_id
                              ? formatCnpj(detail.tax_id)
                              : detail?.contact_email || 'Sem CNPJ'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-outline-variant bg-surface px-2 py-1 text-[10px] font-black tracking-wide text-on-surface-variant uppercase">
                        {planName(t) || 'Sem plano'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/plataforma/organizacoes/${t.id}/modulos`)}
                          className="text-xs font-bold text-primary hover:underline"
                        >
                          {describePackage(t.features_enabled, packages).name}
                        </button>
                      ) : (
                        <span className="text-xs font-bold">
                          {describePackage(t.features_enabled, packages).name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isOwner ? (
                        <StatusSwitch tenant={t} onToggle={(x) => void toggleStatus(x)} />
                      ) : (
                        <span className="text-sm">
                          {t.status === 'active' ? 'Ativa' : 'Suspensa'}
                        </span>
                      )}
                    </td>
                    {isOwner && (
                      <td className="relative px-4 py-3 text-right">
                        <RowMenu
                          open={openMenu === t.id}
                          onToggle={() => setOpenMenu(openMenu === t.id ? null : t.id)}
                          items={menuItems(t)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul className="flex flex-col gap-2.5 md:hidden">
            {rows.map((t, i) => {
              const color = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
              return (
                <li
                  key={t.id}
                  className={`relative rounded-zela-md border border-outline-variant bg-surface-container-lowest p-3.5 ${t.status !== 'active' ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                        style={{ background: `${color}22`, color }}
                        aria-hidden="true"
                      >
                        {initials(t.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{t.name}</p>
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                          {t.org_code}
                        </span>
                      </div>
                    </div>
                    {isOwner && (
                      <RowMenu
                        open={openMenu === `m-${t.id}`}
                        onToggle={() => setOpenMenu(openMenu === `m-${t.id}` ? null : `m-${t.id}`)}
                        items={menuItems(t)}
                      />
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-outline-variant pt-3">
                    <span className="rounded-md border border-outline-variant bg-surface px-2 py-1 text-[10px] font-black tracking-wide text-on-surface-variant uppercase">
                      {planName(t) || 'Sem plano'}
                    </span>
                    <span className="mr-auto ml-2 text-xs font-bold text-primary">
                      {describePackage(t.features_enabled, packages).name}
                    </span>
                    {isOwner ? (
                      <StatusSwitch tenant={t} onToggle={(x) => void toggleStatus(x)} />
                    ) : (
                      <span className="text-xs">
                        {t.status === 'active' ? 'Ativa' : 'Suspensa'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {modal && (
        <TenantModal
          tenant={modal.tenant}
          details={modal.tenant ? q.data?.details[modal.tenant.id] : undefined}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {contractFor && (
        <ContractPlanForTenant
          tenantId={contractFor}
          onClose={() => setContractFor(null)}
          onDone={() => {
            setContractFor(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
