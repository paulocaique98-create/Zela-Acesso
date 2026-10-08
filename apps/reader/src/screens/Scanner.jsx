import { useEffect, useRef, useState } from 'react';
import { cameraReadsBarcodes, startCameraScan } from '../lib/scan.js';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, Notice, TopBar } from '../ui/parts.jsx';

const CAMERA_ERRORS = {
  camera_denied: 'A câmera está bloqueada para este site. Libere nas permissões do navegador.',
  camera_unsupported: 'Este navegador não permite usar a câmera aqui (é preciso HTTPS).',
  camera_unavailable: 'Não foi possível abrir a câmera.',
};
const IDLE_MS = 45_000;

/**
 * Câmera para QR e código de barras, com campo para digitar o código (ou usar leitor USB/Bluetooth).
 * `onCode(text, format)` recebe cada leitura; o chamador decide o que fazer (e faz o debounce).
 */
export function Scanner({
  title = 'Aproxime o QR Code ou código de barras',
  facingMode,
  onCode,
  onCancel,
  allowManual = true,
}) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const idle = useRef(null);
  const wake = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(onCancel, IDLE_MS);
  };

  useEffect(() => {
    let stop = null;
    let cancelled = false;
    wake();
    startCameraScan(video.current, {
      facingMode,
      onCode: (text, format) => {
        wake();
        onCode(text, format);
      },
    })
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e) => setError(CAMERA_ERRORS[e?.message] ?? CAMERA_ERRORS.camera_unavailable));
    return () => {
      cancelled = true;
      stop?.();
      clearTimeout(idle.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Leitura de código" onBack={onCancel} />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-center text-lg">{title}</p>
        <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-zela-xl border border-kiosk-line bg-black">
          <video ref={video} muted playsInline className="aspect-[4/3] w-full object-cover" />
          <div
            className="pointer-events-none absolute inset-8 rounded-zela-lg border-4 border-accent/80"
            aria-hidden="true"
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {!cameraReadsBarcodes() && !error && (
          <Notice>
            Esta câmera lê QR Code. Para código de barras use um leitor USB/Bluetooth ou digite o
            código abaixo.
          </Notice>
        )}
        {allowManual && (
          <form
            className="mx-auto flex w-full max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim().length >= 4) {
                onCode(manual.trim(), null);
                setManual('');
              }
            }}
          >
            <input
              className={INPUT_CLASS}
              value={manual}
              onChange={(e) => {
                wake();
                setManual(e.target.value);
              }}
              placeholder="Digitar o código"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={256}
              aria-label="Digitar o código"
            />
            <button type="submit" className={BTN_PRIMARY} disabled={manual.trim().length < 4}>
              Enviar
            </button>
          </form>
        )}
        <button
          type="button"
          className={`${BTN_SECONDARY} mx-auto w-full max-w-xl`}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
