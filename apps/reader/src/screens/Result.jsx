import { useEffect } from 'react';
import { CheckCircle2, ShieldAlert, WifiOff, XCircle } from 'lucide-react';

const DIRECTION_TEXT = { entry: 'Entrada', exit: 'Saída' };

/** Resposta de cada leitura: cor + ícone + texto (nunca só cor). Some sozinha; toque também fecha. */
export function Result({ result, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, result.outcome === 'REGISTERED' ? 3000 : 4500);
    if (result.outcome === 'REGISTERED') navigator.vibrate?.(80);
    else navigator.vibrate?.([120, 60, 120]);
    return () => clearTimeout(t);
  }, [result, onClose]);

  const ok = result.outcome === 'REGISTERED';
  const warn = result.outcome === 'CHALLENGE_REQUIRED' || result.outcome === 'UNAVAILABLE';
  const Icon = ok
    ? CheckCircle2
    : result.outcome === 'UNAVAILABLE'
      ? WifiOff
      : warn
        ? ShieldAlert
        : XCircle;
  const bg = ok ? 'bg-ok' : warn ? 'bg-warn' : 'bg-deny';
  const sub = ok ? (DIRECTION_TEXT[result.direction] ?? '') : '';
  return (
    <button
      type="button"
      onClick={onClose}
      aria-live="assertive"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 ${bg} text-white`}
    >
      <Icon size={160} aria-hidden="true" strokeWidth={1.5} />
      <span className="text-5xl font-bold">{result.label}</span>
      {sub && <span className="text-3xl">{sub}</span>}
      {result.code === 'RATE_LIMITED' && (
        <span className="text-xl">Muitas tentativas. Aguarde um instante.</span>
      )}
    </button>
  );
}
