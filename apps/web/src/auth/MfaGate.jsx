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
    const { data: staffRequired } = await supabase.rpc('platform_mfa_required_for_me');
    if (staffRequired === true) return setState({ loading: false, mode: 'enroll', factorId: null });
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
  const [recovery, setRecovery] = useState(false);
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
  async function submitRecovery(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('use_mfa_recovery_code', { p_code: code });
    setBusy(false);
    if (err || data !== true)
      return setError('Código de recuperação inválido ou bloqueado por excesso de tentativas.');
    await onDone(); // o fator foi removido: o app leva ao novo cadastro quando a organizacao exige
  }
  function switchMode(toRecovery) {
    setRecovery(toRecovery);
    setCode('');
    setError(null);
  }
  if (recovery)
    return (
      <Shell title="Recuperar acesso" onCancel={onCancel}>
        <form onSubmit={submitRecovery} className="space-y-3">
          <p className="text-sm">
            Usar um código de recuperação remove o segundo fator atual; você cadastrará um novo.
          </p>
          <label className="block text-sm">
            Código de recuperação
            <input
              className={`${INPUT} mt-1 block !w-64`}
              autoComplete="off"
              maxLength={16}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <button className={BTN} disabled={busy || code.replace(/\W/g, '').length < 10}>
            Recuperar
          </button>{' '}
          <button type="button" className="text-sm underline" onClick={() => switchMode(false)}>
            Voltar
          </button>
        </form>
      </Shell>
    );
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
        </button>{' '}
        <button type="button" className="text-sm underline" onClick={() => switchMode(true)}>
          Usar código de recuperação
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
  const [codes, setCodes] = useState(null);
  const load = useCallback(async () => {
    if (!current) return;
    const [{ data: t }, { data: aal }, { data: f }, { data: left }] = await Promise.all([
      supabase.from('tenants').select('mfa_required').eq('id', current.id).maybeSingle(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
      supabase.rpc('mfa_recovery_codes_remaining'),
    ]);
    setInfo({
      factorId: f?.totp?.[0]?.id ?? null,
      codesLeft: typeof left === 'number' ? left : 0,
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

  async function generateCodes() {
    setMsg(null);
    const { data, error } = await supabase.rpc('generate_mfa_recovery_codes');
    if (error)
      setMsg('Não foi possível gerar os códigos. Confirme seu segundo fator e tente de novo.');
    else setCodes(data);
    await load();
  }

  async function removeFactor() {
    if (!window.confirm('Remover o segundo fator? Você precisará cadastrar outro para continuar.'))
      return;
    setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: info.factorId });
    if (error)
      setMsg('Não foi possível remover o fator. Confirme seu segundo fator e tente de novo.');
    setCodes(null);
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
      {info.hasFactor && info.aal2 && (
        <div className="space-y-2">
          <p className="text-sm">Códigos de recuperação válidos: {info.codesLeft}.</p>
          <button type="button" className={BTN} onClick={() => void generateCodes()}>
            Gerar códigos de recuperação
          </button>{' '}
          <button
            type="button"
            className="rounded border px-4 py-2"
            onClick={() => void removeFactor()}
          >
            Remover segundo fator
          </button>
        </div>
      )}
      {codes && (
        <div role="status" className="space-y-1 rounded border p-3 text-sm">
          <p>
            Guarde estes códigos em local seguro. Eles não serão exibidos de novo; gerar novos
            invalida os anteriores.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {msg && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {msg}
        </p>
      )}
    </section>
  );
}

/** Cartao da equipe da plataforma: liga/desliga o MFA obrigatorio (so platform_owner, precisa de aal2). */
export function PlatformMfaCard() {
  const { platformRole } = useWorkspace();
  const [state, setState] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    const [{ data: required }, { data: aal }] = await Promise.all([
      supabase.rpc('get_platform_mfa_required'),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    setState({ required: required === true, aal2: aal?.currentLevel === 'aal2' });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!state || !platformRole) return null;

  async function toggle() {
    setMsg(null);
    const { error } = await supabase.rpc('set_platform_mfa_required', {
      p_required: !state.required,
    });
    if (error) setMsg('Não foi possível alterar. Confirme seu segundo fator e tente de novo.');
    await load();
  }

  return (
    <section aria-label="MFA da equipe da plataforma" className="space-y-2">
      <p className="text-small text-on-surface-variant">
        Exigência de segundo fator para a equipe da plataforma:{' '}
        <strong>{state.required ? 'ligada' : 'desligada'}</strong>. Cada pessoa da equipe cadastra o
        próprio fator no primeiro acesso depois de ligada.
      </p>
      {platformRole === 'platform_owner' ? (
        state.aal2 ? (
          <button type="button" className={BTN} onClick={() => void toggle()}>
            {state.required ? 'Desligar exigência' : 'Exigir MFA da equipe'}
          </button>
        ) : (
          <p className="text-xs">
            Para alterar, entre com o segundo fator (cadastre o seu em Membros de uma organização).
          </p>
        )
      ) : (
        <p className="text-xs">Somente o proprietário da plataforma altera esta configuração.</p>
      )}
      {msg && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {msg}
        </p>
      )}
    </section>
  );
}
