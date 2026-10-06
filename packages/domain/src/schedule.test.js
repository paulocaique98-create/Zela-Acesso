import { describe, expect, it } from 'vitest';
import { evaluateSchedule, localParts } from './schedule.js';

const SP = 'America/Sao_Paulo';
// Financeiro: seg-sex 07:30-18:30
const finance = {
  windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '07:30', end: '18:30:00' })),
};
// 2026-10-06 e terca. Sao Paulo = UTC-3 (sem horario de verao desde 2019).
const at = (iso) => new Date(iso);

describe('localParts', () => {
  it('converte para o fuso do sitio (virada de dia)', () => {
    // 01:00 UTC de terca = 22:00 de segunda em SP
    expect(localParts(at('2026-10-06T01:00:00Z'), SP)).toEqual({
      date: '2026-10-05',
      weekday: 1,
      minutes: 22 * 60,
    });
  });
  it('meia-noite local nao vira hora 24', () => {
    expect(localParts(at('2026-10-06T03:00:00Z'), SP).minutes).toBe(0);
  });
});

describe('evaluateSchedule', () => {
  it('permite dentro da janela', () => {
    expect(evaluateSchedule(finance, at('2026-10-06T13:00:00Z'), SP)).toEqual({
      allowed: true,
      reason: 'WITHIN_WINDOW',
    });
  });
  it('inicio inclusivo, fim exclusivo', () => {
    expect(evaluateSchedule(finance, at('2026-10-06T10:30:00Z'), SP).allowed).toBe(true); // 07:30
    expect(evaluateSchedule(finance, at('2026-10-06T21:29:00Z'), SP).allowed).toBe(true); // 18:29
    expect(evaluateSchedule(finance, at('2026-10-06T21:30:00Z'), SP)).toEqual({
      allowed: false,
      reason: 'OUTSIDE_SCHEDULE',
    }); // 18:30
    expect(evaluateSchedule(finance, at('2026-10-06T10:29:00Z'), SP).allowed).toBe(false); // 07:29
  });
  it('nega no fim de semana', () => {
    expect(evaluateSchedule(finance, at('2026-10-10T15:00:00Z'), SP).reason).toBe(
      'OUTSIDE_SCHEDULE',
    ); // sabado
  });
  it('usa o dia local, nao o UTC', () => {
    // 01:00 UTC de sabado = 22:00 de sexta em SP: fora do horario, mas e sexta
    expect(evaluateSchedule(finance, at('2026-10-10T01:00:00Z'), SP).reason).toBe(
      'OUTSIDE_SCHEDULE',
    );
    // 12:00 UTC de sabado = 09:00 sabado em SP
    expect(evaluateSchedule(finance, at('2026-10-10T12:00:00Z'), SP).allowed).toBe(false);
  });
  it('fuso diferente muda o resultado (Manaus UTC-4)', () => {
    const i = at('2026-10-06T21:45:00Z'); // 18:45 SP (fora) / 17:45 Manaus (dentro)
    expect(evaluateSchedule(finance, i, SP).allowed).toBe(false);
    expect(evaluateSchedule(finance, i, 'America/Manaus').allowed).toBe(true);
  });
  it('feriado nega por padrao, ignore libera', () => {
    const feriado = ['2026-10-12']; // segunda
    const i = at('2026-10-12T15:00:00Z');
    expect(evaluateSchedule(finance, i, SP, feriado)).toEqual({
      allowed: false,
      reason: 'HOLIDAY_DENIED',
    });
    expect(
      evaluateSchedule({ ...finance, holidayBehavior: 'ignore' }, i, SP, feriado).allowed,
    ).toBe(true);
    expect(evaluateSchedule(finance, i, SP, new Set(feriado)).reason).toBe('HOLIDAY_DENIED');
  });
  it('respeita inicio e fim de vigencia (inclusivos, data local)', () => {
    const s = { ...finance, validFrom: '2026-10-07', validUntil: '2026-10-08' };
    expect(evaluateSchedule(s, at('2026-10-06T15:00:00Z'), SP).reason).toBe('SCHEDULE_NOT_STARTED');
    expect(evaluateSchedule(s, at('2026-10-07T15:00:00Z'), SP).allowed).toBe(true);
    expect(evaluateSchedule(s, at('2026-10-08T15:00:00Z'), SP).allowed).toBe(true);
    expect(evaluateSchedule(s, at('2026-10-09T15:00:00Z'), SP).reason).toBe('SCHEDULE_EXPIRED');
  });
  it('sem janelas nunca permite (fail-closed)', () => {
    expect(evaluateSchedule({ windows: [] }, at('2026-10-06T15:00:00Z'), SP).allowed).toBe(false);
  });
  it('janelas multiplas no mesmo dia (turno partido)', () => {
    const s = {
      windows: [
        { weekday: 2, start: '08:00', end: '12:00' },
        { weekday: 2, start: '14:00', end: '18:00' },
      ],
    };
    expect(evaluateSchedule(s, at('2026-10-06T16:00:00Z'), SP).allowed).toBe(false); // 13:00
    expect(evaluateSchedule(s, at('2026-10-06T18:00:00Z'), SP).allowed).toBe(true); // 15:00
  });
});
