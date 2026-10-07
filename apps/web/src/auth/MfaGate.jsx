import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';

// Mesma lista do banco (`has_permission`, migration 9B). O enforcement real e o AAL2 no banco; isto so guia a UI.
const MFA_ROLES = ['organization_owner', 'organization_admin', 'security_manager', 'hr_manager'];
const CODE = /^\d{6}$/;
const INPUT = 'w-40 rounded border px-3 py-2 tracking-widest';
const BTN = 'rounded bg-[var(--primary,#1d4ed8)] px-4 py-2 text-white disabled:opacity-50';

/** Pede o codigo TOTP quando a pessoa tem fator e a sessao ainda esta em aal1; cadastra o fator quando a organizacao exige. */
export function MfaGate({ children }) {
  const { session, signOut } = useAuth();
  const { current, memberships, loading: wsLoading } = useWorkspace();
  const { pathname } = useLocation();
  const [state, setState] = useState({ loading: true, mode: null, factorId: null });
  const userId = session?.user.id;

  const refresh = useCallback(async () => {
    if (!userId) return setState({ loading: false, mode: null, factorId: null });
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2')
      return setState({ loading: false, mode: null, factorId: null });
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.[0] ?? null; // so fatores verificados
    if (totp) return setState({ loading: false, mode: 'challenge', factorId: totp.id });
    let required = false;
    const mine = memberships.filter((m) => m.tenantId === current?.id && m.status === 'active');
    if (current && mine.some((m) => MFA_ROLES.includes(m.role))) {
      const { data } = await supabase
        .from('tenants')
        .select('mfa_required')
        .eq('id', current.id)
        .maybeSingle();
      required = data?.mfa_required === true;
    }
    setState({ loading: false, mode: required ? 'enroll' : null, factorId: null });
  }, [userId, current, memberships]);

  useEffect(() => {
    void refresh();
  }, [refresh, session?.access_token]);

  if (pathname === '/login' || !userId) return children;
  if (state.loading || wsLoading) return <p role="status">Verificando segurança da sessão…</p>;
  if (state.mode === 'challenge')
    return <Challenge factorId={state.factorId} onDone={refresh} onCancel={signOut} />;
  if (state.mode === 'enroll') return <Enroll onDone={refresh} onCancel={signOut} />;
  return children;
}

function Shell({ title, children, onCancel }) {
  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
      <button type="button" className="text-sm underline" onClick={() => void onCancel()}>
        Sair
      </button>
    </main>
  );
}

function Challenge({ factorId, onDone, onCancel }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (err) return setError('Código inválido ou expirado.');
    await onDone();
  }
  return (
    <Shell title="Confirme seu segundo fator" onCancel={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">
          Código de 6 dígitos do aplicativo autenticador
          <input
            className={`${INPUT} mt-1 block`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button className={BTN} disabled={busy || !CODE.test(code)}>
          Verificar
        </button>
      </form>
    </Shell>
  );
}

function Enroll({ onDone, onCancel, inline = false }) {
  const [factor, setFactor] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Remove tentativas anteriores nao verificadas para nao acumular fatores.
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of all?.all ?? [])
        if (f.factor_type === 'totp' && f.status === 'unverified')
          await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Zela ${Date.now()}`,
      });
      if (!active) return;
      if (err) setError('Não foi possível iniciar o cadastro do segundo fator.');
      else setFactor(data);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    setBusy(false);
    if (err) return setError('Código inválido ou expirado.');
    await onDone();
  }

  const Wrap = inline ? InlineWrap : Shell;
  return (
    <Wrap title="Cadastre o segundo fator" onCancel={onCancel}>
      <p className="text-sm">
        Leia o QR code com um aplicativo autenticador e informe o código gerado.
      </p>
      {factor && (
        <>
          <img
            src={factor.totp.qr_code}
            alt="QR code para o aplicativo autenticador"
            className="h-48 w-48"
          />
          <details className="text-sm">
            <summary>Não consigo ler o QR code</summary>
            <code className="break-all">{factor.totp.secret}</code>
          </details>
          <form onSubmit={submit} className="space-y-3">
            <input
              className={INPUT}
              aria-label="Código de 6 dígitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <div>
              <button className={BTN} disabled={busy || !CODE.test(code)}>
                Ativar
              </button>
            </div>
          </form>
        </>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </Wrap>
  );
}

function InlineWrap({ children }) {
  return <div className="space-y-3">{children}</div>;
}

/** Cartao da organizacao: cadastra o fator do proprio usuario e liga/desliga a exigencia (precisa de aal2). */
export function MfaSettingsCard() {
  const { current, allowed } = useWorkspace();
  const [info, setInfo] = useState(null);
  const [enrolling, setEnrolling] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    if (!current) return;
    const [{ data: t }, { data: aal }, { data: f }] = await Promise.all([
      supabase.from('tenants').select('mfa_required').eq('id', current.id).maybeSingle(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    setInfo({
      required: t?.mfa_required === true,
      aal2: aal?.currentLevel === 'aal2',
      hasFactor: (f?.totp?.length ?? 0) > 0,
    });
  }, [current]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!info || !allowed('tenant:update')) return null;

  async function toggle() {
    setMsg(null);
    const { error } = await supabase.rpc('set_tenant_mfa_required', {
      p_tenant: current.id,
      p_required: !info.required,
    });
    if (error) setMsg('Não foi possível alterar. Confirme seu segundo fator e tente de novo.');
    await load();
  }

  return (
    <section aria-label="Segurança da conta" className="mb-6 space-y-2 rounded border p-4">
      <h2 className="font-semibold">Verificação em duas etapas (MFA)</h2>
      <p className="text-sm">
        Exigência para administradores desta organização:{' '}
        <strong>{info.required ? 'ligada' : 'desligada'}</strong>. Seu segundo fator:{' '}
        {info.hasFactor ? 'cadastrado' : 'não cadastrado'}.
      </p>
      {!info.hasFactor && !enrolling && (
        <button type="button" className={BTN} onClick={() => setEnrolling(true)}>
          Cadastrar segundo fator
        </button>
      )}
      {enrolling && (
        <Enroll
          inline
          onDone={async () => {
            setEnrolling(false);
            await load();
          }}
          onCancel={() => setEnrolling(false)}
        />
      )}
      {info.hasFactor && info.aal2 && (
        <button type="button" className={BTN} onClick={() => void toggle()}>
          {info.required ? 'Desligar exigência' : 'Exigir MFA dos administradores'}
        </button>
      )}
      {msg && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {msg}
        </p>
      )}
    </section>
  );
}
