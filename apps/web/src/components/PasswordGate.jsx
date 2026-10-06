import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { LoadingLogo } from './LoadingLogo';

export const MIN_NEW_PASSWORD = 8;

/**
 * Troca obrigatoria de senha no primeiro acesso (conta criada pela plataforma com senha escolhida por outra
 * pessoa). A marca vive em user_security_flags; so a Edge Function a liga e o proprio usuario a limpa.
 * Falha de leitura NAO bloqueia o app (a marca e uma camada extra; o acesso em si e imposto por RLS).
 */
export function PasswordGate({ children }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState('loading'); // loading | required | ok
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void supabase
      .from('user_security_flags')
      .select('must_change_password')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => active && setState(data?.must_change_password ? 'required' : 'ok'));
    return () => {
      active = false;
    };
  }, [userId]);

  if (state === 'loading') return <LoadingLogo />;
  if (state === 'ok') return children;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_NEW_PASSWORD) {
      setError(`A nova senha deve ter pelo menos ${MIN_NEW_PASSWORD} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setBusy(false);
      setError('Não foi possível trocar a senha. Escolha outra e tente novamente.');
      return;
    }
    await supabase
      .from('user_security_flags')
      .update({ must_change_password: false })
      .eq('user_id', userId);
    setBusy(false);
    setState('ok');
  }

  const input =
    'w-full rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 text-on-surface shadow-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-zela-xl border border-outline-variant bg-white p-6 shadow-xl"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-zela-md bg-primary/10 text-primary">
            <KeyRound size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-h3 text-on-surface">Crie sua senha</h1>
            <p className="text-small text-on-surface-variant">
              Sua senha inicial foi definida por outra pessoa. Escolha uma nova para continuar.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="np" className="text-label text-on-surface">
            Nova senha
          </label>
          <input
            id="np"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="np2" className="text-label text-on-surface">
            Confirmar nova senha
          </label>
          <input
            id="np2"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={input}
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-zela-md border border-red-100 bg-red-50 p-3 text-small text-error"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-zela-md bg-primary py-3 font-bold text-white shadow-md transition hover:bg-primary-container disabled:opacity-70"
        >
          {busy ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </div>
  );
}
