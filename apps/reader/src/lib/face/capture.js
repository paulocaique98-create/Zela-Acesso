// Câmera frontal e captura de vários quadros para o facial. A imagem vive só no <video>/canvas do aparelho e
// nunca é gravada nem enviada; só o vetor resumido segue para o Edge. As trilhas da câmera são sempre desligadas.
import { summarizeFrames } from './summarize.js';

export const CAMERA_ERRORS = {
  camera_denied: 'A câmera está bloqueada para este site. Libere nas permissões do navegador.',
  camera_unsupported: 'Este navegador não permite usar a câmera aqui (é preciso HTTPS).',
  camera_unavailable: 'Não foi possível abrir a câmera.',
};

/** Orientação ao usuário para cada motivo de quadro descartado. */
export const FRAME_HINTS = {
  NO_FACE: 'Aproxime o rosto da câmera',
  MULTIPLE_FACES: 'Deve aparecer só uma pessoa na imagem',
  TOO_FAR: 'Aproxime-se um pouco mais',
  NOT_FRONTAL: 'Olhe de frente para a câmera',
  NO_LANDMARKS: 'Mostre o rosto inteiro, sem cobrir',
  ENGINE_ERROR: 'Não foi possível analisar a imagem',
};

/** Abre a câmera frontal no <video>. @returns {Promise<() => void>} desliga a câmera */
export async function openCamera(video, facingMode = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera_unsupported');
  const stream = await navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    .catch((e) => {
      throw new Error(e?.name === 'NotAllowedError' ? 'camera_denied' : 'camera_unavailable');
    });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});
  return () => {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
}

/**
 * Reúne `frames` quadros válidos (um rosto, de frente) em até `maxMs` e os resume.
 * @param {{ analyzeFrame: (v: HTMLVideoElement) => Promise<any> }} engine
 * @param {HTMLVideoElement} video
 * @param {{ frames?: number, maxMs?: number, signal?: AbortSignal, onHint?: (code: string) => void }} [o]
 * @returns {Promise<{ ok: true, d: string, lv: 'PASSED' | 'FAILED' } | { ok: false, code: string }>}
 */
export async function captureFace(
  engine,
  video,
  { frames = 5, maxMs = 20_000, signal, onHint } = {},
) {
  const good = [];
  const t0 = Date.now();
  let last = 'NO_FACE';
  while (good.length < frames) {
    if (signal?.aborted) return { ok: false, code: 'ABORTED' };
    if (Date.now() - t0 > maxMs)
      return { ok: false, code: last === 'ENGINE_ERROR' ? last : 'TIMEOUT' };
    if (video.readyState < 2 || !video.videoWidth) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    let r;
    try {
      r = await engine.analyzeFrame(video);
    } catch {
      r = { ok: false, code: 'ENGINE_ERROR' };
    }
    if (r.ok) {
      good.push(r);
      onHint?.('OK');
    } else {
      // quadros de sequências diferentes não se misturam: se perdeu o rosto, recomeça
      good.length = 0;
      last = r.code;
      onHint?.(r.code);
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  const s = summarizeFrames(good);
  return s.ok ? { ok: true, d: s.d, lv: s.lv } : { ok: false, code: s.code };
}

let enginePromise = null;
/** Carrega Human + SFace uma vez por sessão, sob demanda (o bundle principal do leitor não os inclui). */
export function getFaceEngine() {
  enginePromise ??= import('./engine.js')
    .then((m) => m.createFaceEngine({ base: '/' }))
    .catch((e) => {
      enginePromise = null;
      throw e;
    });
  return enginePromise;
}
