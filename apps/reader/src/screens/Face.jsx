import { useEffect, useRef, useState } from 'react';
import {
  CAMERA_ERRORS,
  FRAME_HINTS,
  captureFace,
  getFaceEngine,
  openCamera,
} from '../lib/face/capture.js';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Card,
  Field,
  INPUT_CLASS,
  Notice,
  TopBar,
} from '../ui/parts.jsx';

const IDLE_MS = 60_000;
const CAPTURE_ERRORS = {
  TIMEOUT: 'Não foi possível ver o rosto com clareza. Melhore a luz e tente de novo.',
  UNSTABLE: 'A imagem mexeu demais. Fique parado e tente de novo.',
  ENGINE_ERROR: 'Não foi possível analisar a imagem neste aparelho.',
  NO_FRAMES: 'Não foi possível ver o rosto.',
};

/**
 * Câmera frontal + captura. `onCaptured({ d, lv })` recebe o vetor resumido (nunca imagem). Ao desmontar, a câmera
 * é desligada. Só o vetor sai daqui; o que fazer com ele é do chamador (tentativa de acesso ou cadastro).
 */
function FaceCamera({ onCaptured, onCancel }) {
  const video = useRef(null);
  const done = useRef(onCaptured);
  done.current = onCaptured;
  const [phase, setPhase] = useState('loading'); // loading | capturing | error
  const [hint, setHint] = useState('Preparando o reconhecimento…');
  const [error, setError] = useState('');
  const [attemptNo, setAttemptNo] = useState(0);
  const idle = useRef(null);

  useEffect(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(onCancel, IDLE_MS);
    return () => clearTimeout(idle.current);
  }, [attemptNo, onCancel]);

  useEffect(() => {
    const ac = new AbortController();
    let stop = null;
    (async () => {
      try {
        setPhase('loading');
        setHint('Preparando o reconhecimento…');
        const cam = await openCamera(video.current);
        if (ac.signal.aborted) return cam();
        stop = cam;
        const engine = await getFaceEngine();
        if (ac.signal.aborted) return;
        setPhase('capturing');
        setHint('Olhe para a câmera');
        const r = await captureFace(engine, video.current, {
          signal: ac.signal,
          onHint: (c) =>
            setHint(c === 'OK' ? 'Fique parado…' : (FRAME_HINTS[c] ?? 'Olhe para a câmera')),
        });
        if (ac.signal.aborted) return;
        if (r.ok) done.current({ d: r.d, lv: r.lv });
        else {
          setError(CAPTURE_ERRORS[r.code] ?? CAPTURE_ERRORS.TIMEOUT);
          setPhase('error');
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(CAMERA_ERRORS[e?.message] ?? 'Não foi possível iniciar o reconhecimento facial.');
        setPhase('error');
      }
    })();
    return () => {
      ac.abort();
      stop?.();
    };
  }, [attemptNo]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-zela-xl border border-kiosk-line bg-black">
        <video
          ref={video}
          muted
          playsInline
          className="aspect-[4/3] w-full -scale-x-100 object-cover"
          aria-label="Imagem da câmera"
        />
        <div
          className="pointer-events-none absolute inset-x-[22%] inset-y-[8%] rounded-[50%] border-4 border-accent/80"
          aria-hidden="true"
        />
      </div>
      {phase !== 'error' && (
        <p role="status" aria-live="polite" className="text-center text-xl">
          {hint}
        </p>
      )}
      {phase === 'error' && (
        <>
          <Notice tone="error">{error}</Notice>
          <button
            type="button"
            className={`${BTN_PRIMARY} mx-auto w-full max-w-xl`}
            onClick={() => setAttemptNo((n) => n + 1)}
          >
            Tentar de novo
          </button>
        </>
      )}
      <button
        type="button"
        className={`${BTN_SECONDARY} mx-auto w-full max-w-xl`}
        onClick={onCancel}
      >
        Cancelar
      </button>
    </div>
  );
}

/** Identificação por rosto: captura e entrega ao Edge, que reconhece e decide. */
export function FaceScan({ onRead, onCancel }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar title="Reconhecimento facial" onBack={onCancel} />
      <FaceCamera
        onCaptured={({ d, lv }) => onRead({ method: 'face', d, lv })}
        onCancel={onCancel}
      />
    </div>
  );
}

const ENROLL_MESSAGES = {
  OK: ['ok', 'Rosto cadastrado. A pessoa já pode usar o facial.'],
  ENROLL_NOT_FOUND: ['error', 'Código não encontrado ou já utilizado. Confira no painel.'],
  AMBIGUOUS_CODE: [
    'error',
    'Há mais de um cadastro com esse código. Gere o cadastro de novo no painel.',
  ],
  LIVENESS_FAILED: [
    'error',
    'Não foi possível confirmar que é uma pessoa real. Melhore a luz e tente de novo.',
  ],
  FACE_ALREADY_ENROLLED: ['error', 'Este rosto já está cadastrado em outro perfil.'],
  FACE_UNAVAILABLE: [
    'error',
    'O facial não está disponível: confira a política biométrica no painel e se o Edge está com o facial ligado.',
  ],
  RATE_LIMITED: ['error', 'Muitas tentativas. Aguarde um instante.'],
  UNAVAILABLE: ['error', 'Sem conexão com o Edge.'],
};

/** Cadastro do gabarito facial pelo operador (consentimento já registrado no painel; aqui só a captura). */
export function FaceEnroll({ onSubmit, onBack }) {
  const [step, setStep] = useState('code'); // code | capture | sending | done
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const valid = /^[0-9a-f]{8}$/.test(code);

  const send = async ({ d, lv }) => {
    setStep('sending');
    const res = await onSubmit({ code, d, lv });
    setMsg(ENROLL_MESSAGES[res?.code] ?? ['error', 'Não foi possível cadastrar o rosto.']);
    setStep('done');
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Cadastro facial" onBack={onBack} />
      {step === 'code' && (
        <div className="flex-1 overflow-y-auto p-4">
          <Card className="mx-auto max-w-xl space-y-4">
            <p>
              Na tela de biometria do painel, após registrar o aviso e o consentimento, será
              mostrado um <strong>código de captura</strong> de 8 letras/números. Digite-o aqui e
              peça que a pessoa olhe para a câmera.
            </p>
            <Field label="Código de captura">
              <input
                className={`${INPUT_CLASS} text-center font-mono text-2xl tracking-widest`}
                value={code}
                onChange={(e) => setCode(e.target.value.trim().toLowerCase().slice(0, 8))}
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={8}
                aria-label="Código de captura"
              />
            </Field>
            <button
              type="button"
              className={`${BTN_PRIMARY} w-full`}
              disabled={!valid}
              onClick={() => setStep('capture')}
            >
              Capturar o rosto
            </button>
          </Card>
        </div>
      )}
      {step === 'capture' && <FaceCamera onCaptured={send} onCancel={onBack} />}
      {step === 'sending' && <p className="p-8 text-center text-xl">Enviando…</p>}
      {step === 'done' && msg && (
        <div className="flex-1 space-y-4 p-4">
          <div className="mx-auto max-w-xl space-y-4">
            <Notice tone={msg[0] === 'ok' ? 'info' : 'error'}>{msg[1]}</Notice>
            <button type="button" className={`${BTN_PRIMARY} w-full`} onClick={onBack}>
              Concluir
            </button>
            {msg[0] !== 'ok' && (
              <button
                type="button"
                className={`${BTN_SECONDARY} w-full`}
                onClick={() => setStep('code')}
              >
                Tentar de novo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
