// Provedor facial do Edge (`sface-edge`): implementa o contrato BiometricProvider de @zela/biometrics.
// O navegador do leitor extrai o vetor (SFace, 128 dimensões) e a prova de vida; aqui ficam o gabarito CIFRADO
// (store.js, EDGE_STORE_KEY), a comparação por cosseno e o apagamento (fila de eliminação LGPD). Nenhuma imagem
// chega ao Edge. Nada daqui vai para log: vetor, gabarito e pontuação são dados biométricos.
//
// Limite de confiança, declarado: o vetor e a prova de vida são produzidos no leitor autenticado (assinatura
// Ed25519 do aparelho). Um leitor comprometido pode mentir; por isso o aparelho é revogável na nuvem e a decisão
// final (política, janela, retenção, limiar) continua no motor determinístico do Edge.

import {
  FACE_AMBIGUITY_MARGIN,
  FACE_MATCH_MIN_COSINE,
  FACE_PROVIDER_KIND,
  cosine,
  decodeDescriptor,
  similarityToScore,
} from '@zela/biometrics';

export const FACE_ENGINE_VERSION = 'human-3.3.6+sface-2021dec';

const UNAVAILABLE = { status: 'ERROR', score: 0, liveness: 'UNSUPPORTED', error: 'UNAVAILABLE' };
const LIVENESS = new Set(['PASSED', 'FAILED', 'UNSUPPORTED']);

/**
 * @param {{ store: ReturnType<import('./store.js').openStore> }} cfg
 * @returns {import('@zela/biometrics').BiometricProvider & {
 *   identify: (sample: object, refs: string[]) => { ref: string, cosine: number } | null,
 *   enroll: (ref: string, descriptorB64: string, nowIso: string) => 'stored' | 'exists' | 'invalid',
 *   duplicateOf: (descriptorB64: string, exceptRef: string) => boolean,
 * }}
 */
export function createEdgeFaceProvider({ store }) {
  const template = (ref) => {
    const b64 = typeof ref === 'string' && ref ? store.getFaceTemplate(ref) : null;
    return b64 ? decodeDescriptor(b64) : null;
  };
  const probe = (sample) =>
    sample && typeof sample === 'object' ? decodeDescriptor(sample.descriptor) : null;

  return {
    kind: FACE_PROVIDER_KIND,
    capabilities: { liveness: true, engine: 'human+sface', engineVersion: FACE_ENGINE_VERSION },

    /** 1:1 contra o gabarito de `subjectRef`. Gabarito ou amostra ausente/ilegível = indisponível (recusa). */
    async verify({ subjectRef, sample }) {
      const probeVec = probe(sample);
      const tpl = template(subjectRef);
      if (!probeVec || !tpl) return { ...UNAVAILABLE };
      const cos = cosine(probeVec, tpl);
      const liveness = LIVENESS.has(sample.liveness) ? sample.liveness : 'UNSUPPORTED';
      return {
        status: cos >= FACE_MATCH_MIN_COSINE ? 'MATCH' : 'NO_MATCH',
        score: similarityToScore(cos),
        liveness,
      };
    },

    /**
     * 1:N entre as referências dadas. Devolve a melhor só se passar do ponto de operação do modelo e se não houver
     * outro candidato quase tão parecido (ambíguo = ninguém; falso aceite entre pessoas parecidas é pior que recusar).
     */
    identify(sample, refs) {
      const probeVec = probe(sample);
      if (!probeVec) return null;
      let best = null;
      let second = -1;
      for (const ref of refs) {
        const tpl = template(ref);
        if (!tpl) continue;
        const c = cosine(probeVec, tpl);
        if (!best || c > best.cosine) {
          if (best) second = Math.max(second, best.cosine);
          best = { ref, cosine: c };
        } else second = Math.max(second, c);
      }
      if (!best || best.cosine < FACE_MATCH_MIN_COSINE) return null;
      if (second >= FACE_MATCH_MIN_COSINE && best.cosine - second < FACE_AMBIGUITY_MARGIN)
        return null;
      return best;
    },

    /** Guarda o gabarito (nunca sobrescreve). */
    enroll(ref, descriptorB64, nowIso) {
      if (typeof ref !== 'string' || !ref || !decodeDescriptor(descriptorB64)) return 'invalid';
      return store.putFaceTemplate(ref, descriptorB64, nowIso) ? 'stored' : 'exists';
    },

    /** Este rosto já está cadastrado em outro perfil? Impede o mesmo rosto sob duas identidades. */
    duplicateOf(descriptorB64, exceptRef) {
      const probeVec = decodeDescriptor(descriptorB64);
      if (!probeVec) return false;
      for (const ref of store.faceTemplateRefs()) {
        if (ref === exceptRef) continue;
        const tpl = template(ref);
        if (tpl && cosine(probeVec, tpl) >= FACE_MATCH_MIN_COSINE) return true;
      }
      return false;
    },

    /** Fila de eliminação (LGPD): apaga o gabarito local. Apagar o que já não existe é sucesso. */
    async erase(ref) {
      if (typeof ref !== 'string' || !ref) return { ok: false };
      store.deleteFaceTemplate(ref);
      return { ok: true };
    },
  };
}
