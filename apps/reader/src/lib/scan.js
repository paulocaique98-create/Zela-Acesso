// Leitura de QR Code e código de barras: câmera (BarcodeDetector, com jsQR como reserva só para QR) e leitor USB/Bluetooth
// que funciona como teclado ("wedge"). O valor lido vai direto ao Edge: nada é guardado nem registrado em log aqui.
import jsQR from 'jsqr';

const FORMATS = ['qr_code', 'code_39', 'itf', 'pdf417', 'code_128', 'ean_13'];
const TOKEN_RE = /^[0-9a-f]{64}$/i;

/** Câmera informa o formato; leitor-teclado só entrega texto (token móvel tem 64 hex, o resto é cartão/barras). */
export function classifyScanned(text, format) {
  if (format) return format === 'qr_code' ? 'qr' : 'barcode';
  return TOKEN_RE.test(text) ? 'qr' : 'barcode';
}

/**
 * Leitor que digita (teclado virtual de scanner): caracteres muito rápidos terminados em Enter.
 * Ignora quando o foco está em campo de texto (digitação humana) ou o tempo entre teclas é de gente.
 * @param {{ onCode: (text: string) => void, enabled?: () => boolean, maxGapMs?: number, target?: Pick<Window, 'addEventListener' | 'removeEventListener'> }} p
 * @returns {() => void} para parar
 */
export function startWedgeScanner({
  onCode,
  enabled = () => true,
  maxGapMs = 60,
  target = window,
}) {
  let buf = '';
  let lastAt = 0;
  const handler = (e) => {
    if (!enabled() || e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const now = e.timeStamp ?? Date.now();
    if (e.key === 'Enter') {
      const code = buf;
      buf = '';
      if (code.length >= 4 && code.length <= 256) onCode(code);
      return;
    }
    if (e.key.length !== 1) return;
    if (buf && now - lastAt > maxGapMs) buf = ''; // pausa de gente: recomeça
    buf += e.key;
    lastAt = now;
    if (buf.length > 256) buf = '';
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}

/**
 * Liga a câmera e chama `onCode(text, format)` a cada leitura (o chamador faz o debounce).
 * @param {HTMLVideoElement} video
 * @param {{ onCode: (text: string, format: string | null) => void, facingMode?: 'user' | 'environment', onError?: (e: unknown) => void }} p
 * @returns {Promise<() => void>} função que desliga a câmera
 */
export async function startCameraScan(video, { onCode, facingMode = 'environment', onError }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera_unsupported');
  const stream = await navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false })
    .catch((e) => {
      throw new Error(e?.name === 'NotAllowedError' ? 'camera_denied' : 'camera_unavailable');
    });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});

  let detector = null;
  if ('BarcodeDetector' in globalThis) {
    try {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length) detector = new globalThis.BarcodeDetector({ formats });
    } catch {
      detector = null;
    }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let busy = false;

  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        if (detector) {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) onCode(found[0].rawValue, found[0].format);
        } else if (video.videoWidth) {
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (qr?.data) onCode(qr.data, 'qr_code');
        }
      } catch (e) {
        onError?.(e);
      }
      busy = false;
    }
    setTimeout(tick, 200);
  };
  void tick();

  return () => {
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
}

/** Sem BarcodeDetector só o QR é lido pela câmera (barras: leitor USB/Bluetooth ou digitar). */
export const cameraReadsBarcodes = () => 'BarcodeDetector' in globalThis;
