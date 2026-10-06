// Avaliacao deterministica de janela de acesso (Schedule). Funcao pura: mesma entrada, mesma saida;
// sem relogio nem rede. O motor de acesso (Fase 3) a chama com o instante e o fuso do SITIO do ponto.
// Convencoes (iguais as do banco): weekday ISO 1=segunda..7=domingo; janela [inicio, fim) no mesmo dia.

/**
 * @typedef {{ weekday: number, start: string, end: string }} ScheduleWindow  // start/end "HH:MM" ou "HH:MM:SS"
 * @typedef {{
 *   windows: readonly ScheduleWindow[],
 *   validFrom?: string | null, validUntil?: string | null,   // datas locais "YYYY-MM-DD", inclusivas
 *   holidayBehavior?: 'deny' | 'ignore',
 * }} Schedule
 * @typedef {'WITHIN_WINDOW' | 'OUTSIDE_SCHEDULE' | 'HOLIDAY_DENIED' | 'SCHEDULE_NOT_STARTED' | 'SCHEDULE_EXPIRED'} ScheduleReason
 */

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Data, dia da semana e minutos locais de um instante num fuso IANA.
 * @param {Date} instant @param {string} timeZone
 */
export function localParts(instant, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of f.formatToParts(instant)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (p.weekday)],
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** @param {string} t "HH:MM[:SS]" */
function toMinutes(t) {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * @param {Schedule} schedule
 * @param {Date} instant
 * @param {string} timeZone fuso IANA do sitio
 * @param {ReadonlySet<string> | readonly string[]} [holidayDates] datas locais "YYYY-MM-DD" do calendario vinculado
 * @returns {{ allowed: boolean, reason: ScheduleReason }}
 */
export function evaluateSchedule(schedule, instant, timeZone, holidayDates = []) {
  const local = localParts(instant, timeZone);
  if (schedule.validFrom && local.date < schedule.validFrom) {
    return { allowed: false, reason: 'SCHEDULE_NOT_STARTED' };
  }
  if (schedule.validUntil && local.date > schedule.validUntil) {
    return { allowed: false, reason: 'SCHEDULE_EXPIRED' };
  }
  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  if ((schedule.holidayBehavior ?? 'deny') === 'deny' && holidays.has(local.date)) {
    return { allowed: false, reason: 'HOLIDAY_DENIED' };
  }
  const inside = schedule.windows.some(
    (w) =>
      w.weekday === local.weekday &&
      local.minutes >= toMinutes(w.start) &&
      local.minutes < toMinutes(w.end),
  );
  return inside
    ? { allowed: true, reason: 'WITHIN_WINDOW' }
    : { allowed: false, reason: 'OUTSIDE_SCHEDULE' };
}
