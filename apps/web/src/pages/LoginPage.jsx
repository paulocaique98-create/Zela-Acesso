import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Quote, ShieldCheck } from 'lucide-react';
import { BRAND } from '../brand';
import { useAuth } from '../auth/AuthProvider';
import { LoadingLogo } from '../components/LoadingLogo';
import { useBranding } from '../hooks/useBranding';

const INPUT =
  'w-full rounded-zela-md border border-outline-variant/60 bg-surface-container-lowest py-3.5 pl-11 text-on-surface shadow-sm outline-none transition-all placeholder:text-on-surface-variant/40 hover:border-outline focus:border-primary focus:ring-4 focus:ring-primary/10';

export function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { loginImage } = useBranding();

  if (loading) return <LoadingLogo />;
  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  }

  return (
    <div className="relative flex min-h-[100dvh] w-full overflow-hidden bg-surface-container-lowest lg:h-screen">
      <div className="pointer-events-none absolute top-[-10%] right-[-5%] h-[40vw] w-[40vw] rounded-full bg-primary/5 blur-3xl mix-blend-multiply" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[50vw] w-[50vw] rounded-full bg-secondary/5 blur-3xl mix-blend-multiply" />

      <div className="relative hidden flex-col justify-between overflow-hidden bg-surface-container-low p-8 shadow-[inset_-24px_0_48px_-12px_rgba(0,0,0,0.02)] lg:flex lg:w-1/2 xl:p-12">
        <div className="relative z-10 flex shrink-0 items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-zela-lg bg-primary-container shadow-sm">
            <ShieldCheck className="text-white" size={24} aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-h2 leading-none tracking-tight text-on-surface">
              {BRAND.productName}
            </span>
            <span className="mt-1 text-caption tracking-widest text-on-surface-variant uppercase">
              {BRAND.company}
            </span>
          </div>
        </div>

        <div className="relative z-10 my-6 flex min-h-0 flex-1 items-center justify-center">
          <div className="relative flex aspect-square h-full max-h-[42vh] w-full max-w-lg items-center justify-center overflow-hidden rounded-[32px] bg-gradient-to-br from-primary via-secondary to-tertiary shadow-2xl">
            {loginImage ? (
              <img src={loginImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <ShieldCheck
                className="text-white/15"
                size={140}
                strokeWidth={1}
                aria-hidden="true"
              />
            )}
          </div>
        </div>

        <div className="relative z-10 max-w-md shrink-0">
          <Quote className="mb-3 text-primary/40" size={32} aria-hidden="true" />
          <p className="text-h3 leading-relaxed text-on-surface">{BRAND.tagline}.</p>
        </div>
      </div>

      <div className="relative z-10 flex w-full items-center justify-center p-6 sm:p-12 lg:w-1/2">
        <div className="flex w-full max-w-[420px] flex-col">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-zela-lg bg-primary-container shadow-sm">
              <ShieldCheck className="text-white" size={20} aria-hidden="true" />
            </div>
            <span className="text-h2 leading-none tracking-tight text-on-surface">
              {BRAND.productName}
            </span>
          </div>

          <div className="mb-8 text-left">
            <h1 className="mb-2 text-h1-mobile tracking-tight text-on-surface lg:text-display">
              Bem-vindo
            </h1>
            <p className="text-on-surface-variant">Portal de controle de acesso</p>
          </div>

          <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-label text-on-surface" htmlFor="email">
                E-mail
              </label>
              <div className="relative">
                <Mail
                  className="absolute top-1/2 left-3.5 -translate-y-1/2 text-on-surface-variant/70"
                  size={20}
                  aria-hidden="true"
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${INPUT} pr-4`}
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-label text-on-surface" htmlFor="password">
                Senha
              </label>
              <div className="relative">
                <Lock
                  className="absolute top-1/2 left-3.5 -translate-y-1/2 text-on-surface-variant/70"
                  size={20}
                  aria-hidden="true"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${INPUT} pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ocultar caracteres' : 'Exibir caracteres'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-on-surface-variant/70 transition-colors hover:text-on-surface"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
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
              className="group flex w-full items-center justify-center gap-2 rounded-zela-md bg-primary py-3.5 font-bold text-white shadow-md transition-all hover:bg-primary-container hover:shadow-lg disabled:opacity-70"
            >
              {busy ? (
                'Entrando…'
              ) : (
                <>
                  Entrar
                  <ArrowRight
                    size={20}
                    className="transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-caption text-on-surface-variant">© {BRAND.company}</p>
        </div>
      </div>
    </div>
  );
}
