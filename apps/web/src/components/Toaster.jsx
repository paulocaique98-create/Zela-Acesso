import { useEffect, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { subscribeToasts } from '../lib/toast';

const STYLE = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
  error: { cls: 'border-red-200 bg-red-50 text-red-900', Icon: XCircle },
  info: { cls: 'border-outline-variant bg-surface-container-lowest text-on-surface', Icon: Info },
};

export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(
    () =>
      subscribeToasts((t) => {
        setItems((prev) => [...prev.slice(-3), t]);
        setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.durationMs);
      }),
    [],
  );

  if (items.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[1000] flex w-[min(92vw,380px)] flex-col gap-2"
    >
      {items.map((t) => {
        const { cls, Icon } = STYLE[t.type] ?? STYLE.info;
        return (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-zela-md border p-3 text-small shadow-lg ${cls}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
