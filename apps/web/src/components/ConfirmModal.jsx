import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Confirmacao customizada (substitui window.confirm). `requireText` exige digitar uma palavra exata.
 * @param {{
 *   title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean,
 *   requireText?: string, isLoading?: boolean, onConfirm: () => void, onCancel: () => void,
 * }} props
 */
export function ConfirmModal({
  title = 'Confirmar ação',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = true,
  requireText,
  isLoading = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const canConfirm = !requireText || typed.trim() === requireText;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-zela-xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <div
            className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-error' : 'bg-primary/10 text-primary'}`}
          >
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-on-surface">{title}</h3>
          {message && (
            <p className="mt-1 text-sm whitespace-pre-wrap text-on-surface-variant">{message}</p>
          )}
        </div>
        {requireText && (
          <input
            type="text"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Digite ${requireText} para confirmar`}
            aria-label={`Digite ${requireText} para confirmar`}
            className="mb-4 w-full rounded-zela-md border border-outline-variant bg-surface p-3 text-center text-sm font-bold uppercase outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 rounded-zela-md bg-surface-container py-3 text-sm font-bold text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading || !canConfirm}
            className={`flex flex-[1.5] items-center justify-center gap-2 rounded-zela-md py-3 text-sm font-bold text-white transition disabled:bg-slate-300 disabled:text-slate-500 ${danger ? 'bg-error hover:brightness-90' : 'bg-primary hover:bg-primary-container'}`}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
