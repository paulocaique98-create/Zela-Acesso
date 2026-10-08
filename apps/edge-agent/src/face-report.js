// Facial: informa à nuvem os perfis cujo rosto já foi capturado AQUI, para o painel mostrar "capturado".
// Só o id do perfil vai (nunca vetor, imagem ou referência); o snapshot traz `capturedAt` e encerra o relato.
// Idempotente; falha de rede = tenta no próximo sync.
import { FACE_PROVIDER_KIND } from '@zela/biometrics';
import { loadCache } from './snapshot.js';

/**
 * @param {{ store: ReturnType<import('./store.js').openStore>, transport: { reportFaceCaptured?: Function } }} input
 * @returns {Promise<{ status: 'idle' | 'ok' | 'offline' | 'revoked', reported: number }>}
 */
export async function reportFaceCaptures({ store, transport }) {
  const index = loadCache(store)?.index;
  if (!index || typeof transport.reportFaceCaptured !== 'function')
    return { status: 'idle', reported: 0 };
  const pending = [...index.biometricProfileByPerson.values()].filter(
    (p) =>
      p.provider === FACE_PROVIDER_KIND &&
      !p.capturedAt &&
      p.templateRef &&
      store.hasFaceTemplate(p.templateRef),
  );
  let reported = 0;
  for (const p of pending) {
    try {
      const res = await transport.reportFaceCaptured(p.id);
      if (res === null) {
        store.wipeCache();
        return { status: 'revoked', reported };
      }
    } catch {
      return { status: 'offline', reported };
    }
    reported += 1;
  }
  return { status: reported === 0 ? 'idle' : 'ok', reported };
}
