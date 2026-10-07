// Verificação biométrica no Edge (Fase 7D). Ordem fail-closed: política/perfil/retenção do cache (sem consultar o
// provedor se algo falhar) -> provedor (referência opaca, nunca imagem) -> evaluateBiometric. Erro do provedor = recusa.
// Devolve só { accepted, reasonCode }; nada biométrico é registrado.

import { evaluateBiometric, resolveBiometricPolicy } from '@zela/biometrics';
import { loadCache } from './snapshot.js';

/**
 * @param {{ store: object, personId: string, accessPointId: string, now: Date,
 *           provider?: import('@zela/biometrics').BiometricProvider | null }} input
 * @returns {Promise<{ accepted: boolean, reasonCode: string }>}
 */
export async function verifyBiometricAttempt({ store, personId, accessPointId, now, provider }) {
  const index = loadCache(store)?.index;
  if (!index) return { accepted: false, reasonCode: 'BIOMETRIC_POLICY_MISSING' };
  const profile = index.biometricProfileByPerson.get(personId) ?? null;
  const resolved = resolveBiometricPolicy(index.biometricSettings, profile, now);
  if (!resolved.allowed) return { accepted: false, reasonCode: resolved.reasonCode };
  if (!provider || typeof provider.verify !== 'function')
    return { accepted: false, reasonCode: 'BIOMETRIC_PROVIDER_UNAVAILABLE' };
  // O gabarito é do provedor que o cadastrou; provedor diferente não pode verificar essa referência.
  if (provider.kind !== profile.provider)
    return { accepted: false, reasonCode: 'BIOMETRIC_PROVIDER_UNAVAILABLE' };
  let result;
  try {
    result = await provider.verify({ subjectRef: profile.templateRef, deviceId: accessPointId });
  } catch {
    result = null;
  }
  return evaluateBiometric(result, resolved.policy, provider.capabilities);
}

/**
 * Fila de eliminação: pede ao provedor que apague cada gabarito pendente e devolve os perfis confirmados.
 * A confirmação à nuvem (`edge_confirm_biometric_erasure`) é feita pelo chamador com o resultado.
 * @param {{ store: object, provider?: { kind: string, erase?: (ref: string) => Promise<{ ok: boolean }> } | null }} input
 * @returns {Promise<{ erased: string[], failed: string[] }>}
 */
export async function processBiometricErasures({ store, provider }) {
  const index = loadCache(store)?.index;
  const out = { erased: [], failed: [] };
  if (!index) return out;
  for (const item of index.biometricPendingErasure) {
    let ok = false;
    if (provider?.kind === item.provider && typeof provider.erase === 'function') {
      try {
        ok = (await provider.erase(item.templateRef))?.ok === true;
      } catch {
        ok = false;
      }
    }
    (ok ? out.erased : out.failed).push(item.profileId);
  }
  return out;
}

/**
 * Apaga no provedor e confirma na nuvem cada perfil da fila. O que falhar (provedor, rede) segue na fila do
 * snapshot e é tentado de novo no próximo sync; apagar de novo é inócuo. 401 = agente revogado: apaga o cache.
 * @param {{ store: object, transport: { confirmBiometricErasure?: (id: string) => Promise<null | { confirmed: boolean }> },
 *           provider?: object | null }} input
 * @returns {Promise<{ status: 'done' | 'revoked', erased: string[], confirmed: string[], failed: string[] }>}
 */
export async function runBiometricErasures({ store, transport, provider }) {
  const { erased, failed } = await processBiometricErasures({ store, provider });
  const out = { status: /** @type {'done' | 'revoked'} */ ('done'), erased, confirmed: [], failed };
  for (const profileId of erased) {
    let res;
    try {
      res = await transport.confirmBiometricErasure(profileId);
    } catch {
      failed.push(profileId); // rede/5xx: o gabarito já foi apagado; a confirmação é repetida no próximo sync
      continue;
    }
    if (res === null) {
      store.wipeCache();
      return { ...out, status: 'revoked' };
    }
    if (res?.confirmed === true) out.confirmed.push(profileId);
    else failed.push(profileId);
  }
  return out;
}
