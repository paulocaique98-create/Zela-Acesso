import { useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataTable } from '../components/DataTable';
import { safeMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { useQuery } from '../lib/useQuery';
import { BIOMETRIC_LEGAL_BASES, checkBiometricSettings } from '@zela/biometrics';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Guard, Status } from './DataPages';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT, Modal, PageHead } from './RegistryPages';

const BASIS_LABEL = {
  consent: 'Consentimento (art. 11, I)',
  fraud_prevention_security: 'Prevenção à fraude e segurança do titular (art. 11, II, g)',
  legal_obligation: 'Cumprimento de obrigação legal (art. 11, II, a)',
};
const STATUS_LABEL = {
  active: 'Ativo',
  revoked: 'Revogado',
  expired: 'Expirado',
  erased: 'Eliminado',
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Ainda não há provedor biométrico real (D-007): o cadastro só roda com o provedor de teste, em desenvolvimento. */
const DEV_PROVIDER = import.meta.env.DEV;

function PolicyForm({ tenantId, settings, onClose, onSaved }) {
  const [f, setF] = useState({
    enabled: settings?.enabled ?? false,
    legal_basis: settings?.legal_basis ?? 'consent',
    retention_days: settings?.retention_days ?? 365,
    notice_version: settings?.notice_version ?? '',
    dpo_contact: settings?.dpo_contact ?? '',
    ripd_version: settings?.ripd_version ?? '',
    ripd_reviewed_at: settings?.ripd_reviewed_at ?? today(),
    ripd_next_review_at: settings?.ripd_next_review_at ?? plusDays(365),
    threshold: settings?.threshold ?? 0.9,
    require_liveness: settings?.require_liveness ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const set = (k) => (e) =>
    setF((s) => ({
      ...s,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const call = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('set_biometric_settings', {
      p_tenant: tenantId,
      p_enabled: f.enabled,
      p_legal_basis: f.enabled ? f.legal_basis : null,
      p_retention_days: f.enabled ? Number(f.retention_days) : null,
      p_notice_version: f.enabled ? f.notice_version : null,
      p_dpo_contact: f.enabled ? f.dpo_contact : null,
      p_ripd_version: f.enabled ? f.ripd_version : null,
      p_ripd_reviewed_at: f.enabled ? f.ripd_reviewed_at : null,
      p_ripd_next_review_at: f.enabled ? f.ripd_next_review_at : null,
      p_threshold: Number(f.threshold),
      p_require_liveness: f.require_liveness,
    });
    setBusy(false);
    setConfirmOff(false);
    if (error) return toast.error(safeMessage(error, 'Não foi possível salvar a política.'));
    toast.success('Política de biometria salva.');
    onSaved();
  };

  const submit = (e) => {
    e.preventDefault();
    if (!f.enabled && settings?.enabled) return setConfirmOff(true);
    call();
  };

  return (
    <Modal title="Política de biometria" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p role="note" className="rounded-zela-lg bg-amber-50 p-3 text-sm text-amber-900">
          Biometria é dado pessoal sensível (LGPD). Fica desligada por padrão. Os textos legais e o
          RIPD devem ser validados pelo jurídico da organização.
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={f.enabled} onChange={set('enabled')} />
          Biometria ligada nesta organização
        </label>
        {f.enabled && (
          <>
            <Field label="Base legal (uma só para esta finalidade)">
              <select className={INPUT} value={f.legal_basis} onChange={set('legal_basis')}>
                {BIOMETRIC_LEGAL_BASES.map((b) => (
                  <option key={b} value={b}>
                    {BASIS_LABEL[b]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Retenção (dias, de 1 a 1095)">
              <input
                className={INPUT}
                type="number"
                min={1}
                max={1095}
                required
                value={f.retention_days}
                onChange={set('retention_days')}
              />
            </Field>
            <Field label="Versão do aviso de privacidade apresentado">
              <input
                className={INPUT}
                required
                maxLength={32}
                value={f.notice_version}
                onChange={set('notice_version')}
              />
            </Field>
            <Field label="Contato do encarregado (DPO)">
              <input
                className={INPUT}
                required
                minLength={5}
                maxLength={200}
                value={f.dpo_contact}
                onChange={set('dpo_contact')}
              />
            </Field>
            <Field label="Versão do RIPD">
              <input
                className={INPUT}
                required
                maxLength={32}
                value={f.ripd_version}
                onChange={set('ripd_version')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="RIPD revisado em">
                <input
                  className={INPUT}
                  type="date"
                  required
                  max={today()}
                  value={f.ripd_reviewed_at}
                  onChange={set('ripd_reviewed_at')}
                />
              </Field>
              <Field label="Próxima revisão">
                <input
                  className={INPUT}
                  type="date"
                  required
                  min={today()}
                  value={f.ripd_next_review_at}
                  onChange={set('ripd_next_review_at')}
                />
              </Field>
            </div>
            <Field label="Confiança mínima (0,80 a 1,00)">
              <input
                className={INPUT}
                type="number"
                step="0.01"
                min={0.8}
                max={1}
                required
                value={f.threshold}
                onChange={set('threshold')}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.require_liveness}
                onChange={set('require_liveness')}
              />
              Exigir prova de vida (só vale se o provedor realmente oferece)
            </label>
          </>
        )}
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
      {confirmOff && (
        <ConfirmModal
          title="Desligar a biometria"
          message="Todos os perfis biométricos ativos serão revogados e a eliminação dos gabaritos será solicitada. Isso não pode ser desfeito."
          confirmLabel="Desligar e revogar"
          isLoading={busy}
          onCancel={() => setConfirmOff(false)}
          onConfirm={call}
        />
      )}
    </Modal>
  );
}

function EnrollForm({ tenantId, settings, people, onClose, onDone }) {
  const [f, setF] = useState({
    person: '',
    method: 'in_person',
    adult: false,
    alt: false,
    notice: false,
  });
  const [busy, setBusy] = useState(false);
  const ready = f.person && f.adult && f.alt && f.notice;

  const finish = async (promise, ok, fail) => {
    setBusy(true);
    const { error } = await promise;
    setBusy(false);
    if (error) return toast.error(safeMessage(error, fail));
    toast.success(ok);
    onDone();
  };

  const enroll = (e) => {
    e.preventDefault();
    // Gabarito nunca passa por aqui: só a referência opaca devolvida pelo provedor (teste, em desenvolvimento).
    const ref = `mock:${crypto.randomUUID()}`;
    finish(
      supabase.rpc('enroll_biometric_profile', {
        p_tenant: tenantId,
        p_person: f.person,
        p_provider: 'mock',
        p_template_ref: ref,
        p_method: f.method,
        p_adult_confirmed: f.adult,
        p_alternative_offered: f.alt,
        p_notice_version: settings.notice_version,
      }),
      'Biometria cadastrada.',
      'Não foi possível cadastrar a biometria.',
    );
  };

  const refuse = () =>
    finish(
      supabase.rpc('refuse_biometric', {
        p_tenant: tenantId,
        p_person: f.person,
        p_notice_version: settings.notice_version,
        p_method: f.method,
      }),
      'Recusa registrada. A pessoa usa a alternativa não biométrica.',
      'Não foi possível registrar a recusa.',
    );

  return (
    <Modal title="Cadastro biométrico guiado" onClose={onClose}>
      <form onSubmit={enroll} className="space-y-3">
        <Field label="Pessoa (somente adultos, sem visitantes)">
          <select
            className={INPUT}
            required
            value={f.person}
            onChange={(e) => setF((s) => ({ ...s, person: e.target.value }))}
          >
            <option value="">Selecione…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Forma de coleta">
          <select
            className={INPUT}
            value={f.method}
            onChange={(e) => setF((s) => ({ ...s, method: e.target.value }))}
          >
            <option value="in_person">Presencial</option>
            <option value="digital">Digital</option>
          </select>
        </Field>
        <p className="rounded-zela-lg bg-surface-container p-3 text-sm">
          Base legal: <strong>{BASIS_LABEL[settings.legal_basis]}</strong>. Retenção:{' '}
          <strong>{settings.retention_days} dias</strong>. Aviso vigente:{' '}
          <strong>{settings.notice_version}</strong>. Encarregado:{' '}
          <strong>{settings.dpo_contact}</strong>.
        </p>
        {[
          [
            'notice',
            'A pessoa recebeu o aviso de privacidade vigente (finalidade, retenção, direitos).',
          ],
          [
            'alt',
            'Foi oferecida a alternativa não biométrica (PIN, cartão ou token), sem prejuízo.',
          ],
          ['adult', 'Confirmo que a pessoa é maior de 18 anos.'],
        ].map(([k, label]) => (
          <label key={k} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={f[k]}
              onChange={(e) => setF((s) => ({ ...s, [k]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
        {!DEV_PROVIDER && (
          <p role="alert" className="text-sm text-error">
            Nenhum provedor biométrico está integrado neste ambiente. O cadastro fica indisponível
            até a integração (benchmark pendente).
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BTN_PRIMARY} disabled={busy || !ready || !DEV_PROVIDER}>
            {busy ? 'Salvando…' : 'Cadastrar biometria'}
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            disabled={busy || !f.person || !f.notice || !f.alt}
            onClick={refuse}
          >
            Registrar recusa
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function OrgBiometricsPage() {
  const { current, allowed } = useWorkspace();
  const tenantId = current?.id ?? '';
  const [policy, setPolicy] = useState(false);
  const [enroll, setEnroll] = useState(false);
  const [revoke, setRevoke] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);

  const q = useQuery(async () => {
    const [t, s, pr, pe] = await Promise.all([
      supabase.from('tenants').select('features_enabled').eq('id', tenantId).maybeSingle(),
      supabase.from('biometric_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase
        .from('biometric_profiles')
        .select(
          'id, person_id, provider, legal_basis, status, enrolled_at, retention_until, erasure_requested_at, erasure_confirmed_at',
        )
        .eq('tenant_id', tenantId)
        .order('enrolled_at', { ascending: false })
        .limit(500),
      supabase
        .from('people')
        .select('id, full_name, kind, age_category, status')
        .eq('tenant_id', tenantId)
        .order('full_name')
        .limit(500),
    ]);
    for (const r of [t, s, pr]) if (r.error) throw r.error;
    return {
      moduleOn: t.data?.features_enabled?.biometrics === true,
      settings: s.data,
      profiles: pr.data,
      people: pe.error ? [] : pe.data,
    };
  }, [tenantId]);

  const doRevoke = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('revoke_biometric', {
      p_tenant: tenantId,
      p_person: revoke.person_id,
      p_reason: 'HOLDER_REQUEST',
    });
    setBusy(false);
    setRevoke(null);
    if (error) return toast.error(safeMessage(error, 'Não foi possível revogar.'));
    toast.success('Biometria revogada. Eliminação solicitada ao provedor.');
    q.reload();
  };

  return (
    <Guard permission="biometric:read">
      <PageHead title="Biometria" canCreate={false} onNew={() => {}}>
        <Status q={q}>
          {({ moduleOn, settings, profiles, people }) => {
            const name = new Map(people.map((p) => [p.id, p.full_name]));
            const activeIds = new Set(
              profiles.filter((p) => p.status === 'active').map((p) => p.person_id),
            );
            const candidates = people.filter(
              (p) =>
                p.status === 'active' &&
                p.kind !== 'visitor' &&
                p.age_category === 'adult' &&
                !activeIds.has(p.id),
            );
            const view = settings && {
              enabled: settings.enabled,
              legalBasis: settings.legal_basis,
              retentionDays: settings.retention_days,
              noticeVersion: settings.notice_version,
              dpoContact: settings.dpo_contact,
              ripdVersion: settings.ripd_version,
              ripdNextReviewAt: settings.ripd_next_review_at,
              threshold: Number(settings.threshold),
              requireLiveness: settings.require_liveness,
            };
            const check = checkBiometricSettings(view, new Date());
            const ready = moduleOn && check.ok;
            return (
              <>
                {!moduleOn && (
                  <p role="status" className="rounded-zela-lg bg-surface-container p-3 text-sm">
                    O módulo de biometria não está contratado para esta organização.
                  </p>
                )}
                <div className="rounded-zela-lg border border-outline-variant p-4 text-sm">
                  <h2 className="mb-2 font-semibold">Política</h2>
                  {settings?.enabled ? (
                    <ul className="space-y-1">
                      <li>Base legal: {BASIS_LABEL[settings.legal_basis]}</li>
                      <li>Retenção: {settings.retention_days} dias</li>
                      <li>Aviso: versão {settings.notice_version}</li>
                      <li>Encarregado: {settings.dpo_contact}</li>
                      <li>
                        RIPD {settings.ripd_version} · revisado em{' '}
                        {fmtDate(settings.ripd_reviewed_at)} · próxima revisão{' '}
                        {fmtDate(settings.ripd_next_review_at)}
                      </li>
                      {!check.ok && (
                        <li role="alert" className="font-semibold text-error">
                          {check.reasonCode === 'BIOMETRIC_RIPD_OVERDUE'
                            ? 'RIPD com revisão vencida: novos cadastros bloqueados.'
                            : 'Política incompleta.'}
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p>Biometria desligada (padrão).</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {allowed('biometric:manage') && moduleOn && (
                      <button type="button" className={BTN_PRIMARY} onClick={() => setPolicy(true)}>
                        Configurar política
                      </button>
                    )}
                    {allowed('biometric:enroll') && ready && (
                      <button type="button" className={BTN_GHOST} onClick={() => setEnroll(true)}>
                        Cadastrar biometria
                      </button>
                    )}
                  </div>
                </div>
                <DataTable
                  caption="Perfis biométricos"
                  headers={[
                    'Pessoa',
                    'Situação',
                    'Base legal',
                    'Retenção até',
                    'Eliminação',
                    'Ações',
                  ]}
                  empty="Nenhum perfil biométrico."
                  rows={profiles.map((p) => [
                    name.get(p.person_id) ?? '—',
                    STATUS_LABEL[p.status],
                    BASIS_LABEL[p.legal_basis] ?? p.legal_basis,
                    fmtDate(p.retention_until),
                    p.erasure_confirmed_at
                      ? `Confirmada em ${fmtDate(p.erasure_confirmed_at)}`
                      : p.erasure_requested_at
                        ? 'Solicitada (aguardando provedor)'
                        : '—',
                    p.status === 'active' && allowed('biometric:enroll') ? (
                      <button
                        key={p.id}
                        type="button"
                        className={`${BTN_GHOST} text-error`}
                        onClick={() => setRevoke(p)}
                      >
                        Revogar
                      </button>
                    ) : (
                      '—'
                    ),
                  ])}
                />
                {policy && (
                  <PolicyForm
                    tenantId={tenantId}
                    settings={settings}
                    onClose={() => setPolicy(false)}
                    onSaved={() => {
                      setPolicy(false);
                      q.reload();
                    }}
                  />
                )}
                {enroll && (
                  <EnrollForm
                    tenantId={tenantId}
                    settings={settings}
                    people={candidates}
                    onClose={() => setEnroll(false)}
                    onDone={() => {
                      setEnroll(false);
                      q.reload();
                    }}
                  />
                )}
              </>
            );
          }}
        </Status>
      </PageHead>
      {revoke && (
        <ConfirmModal
          title="Revogar biometria"
          message="A credencial biométrica será revogada agora e a eliminação do gabarito será solicitada ao provedor. A pessoa continua com as alternativas não biométricas."
          confirmLabel="Revogar"
          isLoading={busy}
          onCancel={() => setRevoke(null)}
          onConfirm={doRevoke}
        />
      )}
    </Guard>
  );
}
