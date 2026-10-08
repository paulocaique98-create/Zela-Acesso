// Motor facial do leitor (navegador). Detecção, malha e prova de vida passiva: @vladmandic/human (D-007, só como
// detector; o descritor do próprio Human foi reprovado no benchmark, docs/26-FACE-BENCHMARK.md). Reconhecimento:
// SFace (OpenCV Zoo, Apache-2.0) via onnxruntime-web. Tudo roda no aparelho; nenhuma imagem sai dele nem é
// guardada: só o vetor de 128 dimensões segue, assinado, para o Edge. Modelos e WASM vêm da mesma origem (sem CDN).
import { Human } from '@vladmandic/human';
import * as ort from 'onnxruntime-web/wasm';
import {
  ALIGN_SIZE,
  ARCFACE_REF,
  landmarks5FromMesh,
  similarityTransform,
} from '@zela/biometrics/face-align';
import { FACE_DIM, normalizeDescriptor } from '@zela/biometrics/face';

/** Rosto pequeno demais (largura em pixels do quadro) = pouca resolução = descritor ruim. */
export const MIN_FACE_PX = 110;
/** Giro lateral máximo (rad, ~25°). */
export const MAX_YAW_RAD = 0.45;

const SFACE_MODEL = 'sface.onnx';

/**
 * @param {{ base?: string, backend?: string, bgr?: boolean, minFacePx?: number }} [opts] base: pasta pública (termina em "/")
 * @returns {Promise<FaceEngine>}
 */
export async function createFaceEngine({
  base = '/',
  backend = 'webgl',
  bgr = false,
  minFacePx = MIN_FACE_PX,
} = {}) {
  const human = new Human({
    backend,
    modelBasePath: `${base}models/`,
    cacheSensitivity: 0,
    debug: false,
    face: {
      enabled: true,
      detector: { rotation: true, maxDetected: 2, minConfidence: 0.6 },
      mesh: { enabled: true },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: true },
      liveness: { enabled: true },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
  });
  await human.load();

  ort.env.wasm.wasmPaths = `${base}ort/`; // glue .mjs e .wasm da mesma origem (vite.ort.js)
  ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = 1; // sem isolamento de origem (SharedArrayBuffer) no Edge
  const session = await ort.InferenceSession.create(`${base}models/${SFACE_MODEL}`, {
    executionProviders: ['wasm'],
    logSeverityLevel: 3,
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const canvas = document.createElement('canvas');
  canvas.width = ALIGN_SIZE;
  canvas.height = ALIGN_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /** Recorte alinhado 112x112 -> tensor CHW RGB (0..255), como o SFace do OpenCV espera. */
  function toTensor(source, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ALIGN_SIZE, ALIGN_SIZE);
    ctx.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty);
    ctx.drawImage(source, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = ctx.getImageData(0, 0, ALIGN_SIZE, ALIGN_SIZE).data;
    const plane = ALIGN_SIZE * ALIGN_SIZE;
    const data = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      data[i] = px[i * 4 + (bgr ? 2 : 0)];
      data[plane + i] = px[i * 4 + 1];
      data[2 * plane + i] = px[i * 4 + (bgr ? 0 : 2)];
    }
    return new ort.Tensor('float32', data, [1, 3, ALIGN_SIZE, ALIGN_SIZE]);
  }

  return {
    backend: human.tf.getBackend(),
    /**
     * Analisa UM quadro. Nunca guarda a imagem.
     * @param {CanvasImageSource & { videoWidth?: number, naturalWidth?: number, width?: number }} source
     * @returns {Promise<FrameResult>}
     */
    async analyzeFrame(source) {
      const res = await human.detect(source);
      const faces = (res.face ?? []).filter((f) => (f.boxScore ?? f.score ?? 0) >= 0.5);
      if (faces.length === 0) return { ok: false, code: 'NO_FACE' };
      if (faces.length > 1) return { ok: false, code: 'MULTIPLE_FACES' };
      const f = faces[0];
      const faceW = f.box?.[2] ?? 0;
      if (faceW < minFacePx) return { ok: false, code: 'TOO_FAR' };
      const yaw = f.rotation?.angle?.yaw ?? 0;
      if (Math.abs(yaw) > MAX_YAW_RAD) return { ok: false, code: 'NOT_FRONTAL' };
      const pts = landmarks5FromMesh(f.mesh);
      const t = pts ? similarityTransform(pts, ARCFACE_REF) : null;
      if (!t) return { ok: false, code: 'NO_LANDMARKS' };
      const out = await session.run({ [inputName]: toTensor(source, t) });
      const raw = out[session.outputNames[0]].data;
      const descriptor = raw.length === FACE_DIM ? normalizeDescriptor(raw) : null;
      if (!descriptor) return { ok: false, code: 'ENGINE_ERROR' };
      return {
        ok: true,
        descriptor,
        real: Number.isFinite(f.real) ? f.real : 0,
        live: Number.isFinite(f.live) ? f.live : 0,
        faceW,
      };
    },
    dispose() {
      session.release?.();
    },
  };
}

/**
 * @typedef {{ ok: true, descriptor: Float32Array, real: number, live: number, faceW: number }
 *          | { ok: false, code: 'NO_FACE' | 'MULTIPLE_FACES' | 'TOO_FAR' | 'NOT_FRONTAL' | 'NO_LANDMARKS' | 'ENGINE_ERROR' }} FrameResult
 * @typedef {{ backend: string, analyzeFrame: (s: any) => Promise<FrameResult>, dispose: () => void }} FaceEngine
 */
