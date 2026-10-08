// Cliente do protocolo Zela Pass: assina, envia, corrige o relógio do aparelho e reenvia com segurança.
// O leitor nunca decide nada: devolve o que o Edge respondeu. Sem resposta do Edge = UNAVAILABLE (nada é registrado
// no aparelho nem enfileirado: senha e credencial não ficam guardadas aqui).
import { parseEnrollBody } from '@zela/domain';
import { randomHex } from './crypto.js';
import { buildEnvelope } from './protocol.js';
import { TransportError } from './transport.js';

/**
 * @param {{
 *   transport: { send: (envelope: object) => Promise<any> },
 *   now?: () => number,
 *   identity?: { readerId: string, privateKey: CryptoKey } | null,
 * }} cfg
 */
export function createReaderClient({ transport, now = Date.now, identity = null }) {
  let who = identity;
  let offset = 0; // hora do Edge menos hora do aparelho (ms)

  const learnClock = (res, t0, t1) => {
    if (Number.isFinite(res?.serverTime)) offset = res.serverTime - Math.round((t0 + t1) / 2);
  };

  /** Assina e envia; refaz o envelope (novo nonce) se o relógio estava fora ou se o Edge já viu a mesma mensagem. */
  async function send(type, body) {
    const readerId = type === 'enroll' ? 'enroll' : who?.readerId;
    if (!readerId || !who?.privateKey) throw new Error('leitor sem identidade');
    let res;
    for (let tryNo = 0; tryNo < 3; tryNo++) {
      const t0 = now();
      const env = await buildEnvelope({
        type,
        readerId,
        body,
        privateKey: who.privateKey,
        ts: t0 + offset,
      });
      res = await transport.send(env);
      learnClock(res, t0, now());
      if (res?.code !== 'CLOCK_SKEW' && res?.code !== 'REPLAY') return res;
    }
    return res;
  }

  return {
    setIdentity: (i) => {
      who = i;
    },
    clockOffsetMs: () => offset,
    /** Hora do Edge (ms) a partir do relógio do aparelho. */
    edgeNow: () => now() + offset,

    /**
     * Ativação: código de uso único + chave pública do aparelho (a privada não sai daqui).
     * @param {{ code: string, label: string, publicKeyHex: string, privateKey: CryptoKey }} p
     */
    async enroll({ code, label, publicKeyHex, privateKey }) {
      const body = { code, publicKey: publicKeyHex, label };
      if (!parseEnrollBody(body).ok) return { ok: false, code: 'MALFORMED' };
      const prev = who;
      who = { readerId: 'enroll', privateKey };
      try {
        return await send('enroll', body);
      } finally {
        who = prev;
      }
    },

    status: () => send('status', '{}'),

    /**
     * Cadastro do gabarito facial (só o operador, tela protegida pelo PIN do aparelho). `d` é o vetor em base64.
     * Sem reenvio automático: o Edge só aceita uma captura por código e uma segunda tentativa seria recusada.
     * @param {{ code: string, d: string, lv: 'PASSED' | 'FAILED' | 'UNSUPPORTED' }} p
     */
    async faceEnroll(p) {
      try {
        return await send('face_enroll', { code: p.code, d: p.d, lv: p.lv });
      } catch (e) {
        if (!(e instanceof TransportError)) throw e;
        return { ok: false, code: 'UNAVAILABLE' };
      }
    },

    /**
     * Uma leitura. `deviceEventId` é gerado UMA vez por ação do usuário: se a resposta se perder, o reenvio devolve o
     * mesmo resultado (o Edge deduplica) em vez de registrar duas vezes.
     * @param {{ method: 'pin', identifier: string, pin: string } | { method: 'qr' | 'barcode', value: string }} reading
     * @returns {Promise<{ ok: boolean, code: string, outcome?: string, label?: string, direction?: string, duplicate?: boolean }>}
     */
    async attempt(reading) {
      const body = { ...reading, deviceEventId: `evt-${randomHex(12)}` };
      for (let i = 0; i < 2; i++) {
        try {
          return await send('attempt', body);
        } catch (e) {
          if (!(e instanceof TransportError)) throw e;
        }
      }
      return { ok: false, code: 'UNAVAILABLE', outcome: 'UNAVAILABLE' };
    },
  };
}
