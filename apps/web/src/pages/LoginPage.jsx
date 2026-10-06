import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';

export function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">{BRAND.productName}</h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--muted)' }}>
        {BRAND.tagline}
      </p>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border p-5"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border px-3 py-2"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border px-3 py-2"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded px-3 py-2 font-medium disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-6 text-xs" style={{ color: 'var(--muted)' }}>
        © {BRAND.company}
      </p>
    </main>
  );
}
