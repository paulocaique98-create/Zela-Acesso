import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const BTN =
  'min-h-14 rounded-zela-lg px-5 text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50';
export const BTN_PRIMARY = `${BTN} bg-primary-container text-on-primary hover:bg-primary`;
export const BTN_SECONDARY = `${BTN} bg-kiosk-raised text-on-kiosk border border-kiosk-line hover:bg-kiosk-line`;
export const BTN_DANGER = `${BTN} bg-deny text-white hover:bg-red-800`;
export const INPUT_CLASS =
  'min-h-14 w-full rounded-zela-md border border-kiosk-line bg-kiosk px-4 text-on-kiosk placeholder:text-on-kiosk-muted focus-visible:outline-2 focus-visible:outline-accent';

/** Marca Zela Pass: escudo com check (mesmo ícone do Zela Acesso) + nome. */
export function Logo({ light = false, size = 40 }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center justify-center rounded-xl bg-primary-container"
        role="presentation"
      >
        <ShieldCheck
          className="m-2 text-white"
          size={size - 16}
          aria-hidden="true"
          strokeWidth={2.25}
        />
      </div>
      <span
        className={`text-2xl font-bold tracking-tight ${light ? 'text-kiosk' : 'text-on-kiosk'}`}
      >
        Zela <span className="font-medium text-primary-container">Pass</span>
      </span>
    </div>
  );
}

/** Cabeçalho das telas internas: voltar + título (como nas telas de configuração de referência). */
export function TopBar({ title, onBack }) {
  return (
    <header className="flex items-center gap-3 bg-kiosk-raised px-4 py-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="flex size-12 items-center justify-center rounded-full hover:bg-kiosk-line focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
      )}
      <h1 className="flex-1 text-center text-xl font-semibold">{title}</h1>
      {onBack && <span className="size-12" aria-hidden="true" />}
    </header>
  );
}

export function Card({ children, className = '' }) {
  return (
    <section
      className={`mx-auto w-full max-w-xl rounded-zela-xl border border-kiosk-line bg-kiosk-raised p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-on-kiosk-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-on-kiosk-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-kiosk-line text-on-kiosk-muted',
    warn: 'border-warn text-amber-200',
    error: 'border-deny text-red-200',
  };
  return (
    <p
      role={tone === 'error' ? 'alert' : 'note'}
      className={`rounded-zela-md border p-3 text-sm ${tones[tone]}`}
    >
      {children}
    </p>
  );
}
