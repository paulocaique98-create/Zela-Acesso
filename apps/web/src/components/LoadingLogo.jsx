import { ShieldCheck } from 'lucide-react';

export function LoadingLogo({ size = 56 }) {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="flex min-h-screen items-center justify-center bg-surface"
    >
      <div
        className="animate-gentle-pulse flex items-center justify-center rounded-xl bg-primary-container"
        style={{ width: size, height: size }}
      >
        <ShieldCheck className="text-white" size={size * 0.55} aria-hidden="true" />
      </div>
    </div>
  );
}
