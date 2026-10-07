// Anti-passback (Fase 3D): cálculo puro do estado de presença por (pessoa, zona).
// Quem MANTÉM o estado é o backend/Edge (tabela presence_states); o frontend nunca decide (§25).
// Aqui só a regra: dado modo, sentido do ponto e estado atual, diz se há violação e qual o próximo estado.

export const ANTI_PASSBACK_MODES = ['off', 'soft', 'hard'];
export const PRESENCE_STATES = ['present', 'absent', 'unknown'];

/** @typedef {'off' | 'soft' | 'hard'} AntiPassbackMode */
/** @typedef {'present' | 'absent' | 'unknown'} PresenceState */
/** @typedef {'entry' | 'exit' | 'bidirectional'} PointDirection */

/**
 * @param {{
 *   mode: AntiPassbackMode, direction: PointDirection,
 *   state?: PresenceState | null, since?: Date | string | null, now: Date, resetMinutes?: number | null,
 * }} input
 * @returns {{ mode: AntiPassbackMode, violated: boolean, effectiveState: PresenceState, nextState: PresenceState | null }}
 *   nextState = estado a gravar SE a passagem for confirmada (null = não altera).
 */
export function evaluateAntiPassback(input) {
  const mode = ANTI_PASSBACK_MODES.includes(input?.mode) ? input.mode : 'off';
  const state = PRESENCE_STATES.includes(input?.state) ? input.state : 'unknown';
  const effectiveState = isExpired(state, input?.since, input?.now, input?.resetMinutes)
    ? 'unknown'
    : state;

  // Sem modo ou ponto bidirecional não há como inferir o sentido: nada a verificar nem a gravar.
  if (mode === 'off' || (input.direction !== 'entry' && input.direction !== 'exit')) {
    return { mode, violated: false, effectiveState, nextState: null };
  }
  // UNKNOWN nunca viola (evita trancar todos na implantação ou após reset); só estado conhecido e contrário viola.
  const violated =
    input.direction === 'entry' ? effectiveState === 'present' : effectiveState === 'absent';
  return {
    mode,
    violated,
    effectiveState,
    nextState: input.direction === 'entry' ? 'present' : 'absent',
  };
}

/**
 * Decide se o estado deve ser gravado após a decisão: só quando a porta realmente liberou.
 * Soft grava mesmo com violação (a violação fica na evidência); hard nega e não grava.
 * @param {{ decision: string, mode: AntiPassbackMode, violated: boolean, nextState: PresenceState | null }} r
 * @returns {PresenceState | null}
 */
export function presenceToCommit(r) {
  if (!r.nextState) return null;
  if (r.decision !== 'ALLOW' && r.decision !== 'DEGRADED_ALLOW') return null;
  if (r.mode === 'hard' && r.violated) return null;
  return r.nextState;
}

function isExpired(state, since, now, resetMinutes) {
  if (state === 'unknown' || !resetMinutes || !since || !(now instanceof Date)) return false;
  const t = since instanceof Date ? since.getTime() : Date.parse(since);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t >= resetMinutes * 60_000;
}
