import { describe, expect, it } from 'vitest';
import { formatNaturalDateResult, parseNaturalDateTime } from '../lib/calendar/natural_language';

describe('parseNaturalDateTime', () => {
  const today = '2026-08-25';

  it.each([
    ['today', '2026-08-25', null],
    ['tomorrow at 2pm', '2026-08-26', '14:00'],
    ['yesterday midnight', '2026-08-24', '00:00'],
    ['this tuesday at noon', '2026-08-25', '12:00'],
    ['next tuesday 9:30 pm', '2026-09-01', '21:30'],
    ['in 3 days at 9', '2026-08-28', '09:00'],
    ['in 2 weeks 9am', '2026-09-08', '09:00'],
    ['2026-12-31 23:45', '2026-12-31', '23:45'],
  ])('parses English %s', (input, date, time) => {
    expect(parseNaturalDateTime({ input, today, locale: 'en' })).toEqual({ ok: true, date, time });
  });

  it.each([
    ['hoje', '2026-08-25', null],
    ['amanhã às 14h', '2026-08-26', '14:00'],
    ['amanha 9h30', '2026-08-26', '09:30'],
    ['ontem meia-noite', '2026-08-24', '00:00'],
    ['esta terça-feira meio-dia', '2026-08-25', '12:00'],
    ['próxima terça 9:30', '2026-09-01', '09:30'],
    ['em 3 dias às 9', '2026-08-28', '09:00'],
    ['daqui a 2 semanas 18h', '2026-09-08', '18:00'],
    ['2026-12-31 23:45', '2026-12-31', '23:45'],
  ])('parses Portuguese %s', (input, date, time) => {
    expect(parseNaturalDateTime({ input, today, locale: 'pt-BR' })).toEqual({ ok: true, date, time });
  });

  it.each([
    ['', 'empty'], ['soon', 'unsupported'], ['in 0 days', 'day_bounds'],
    ['in 366 days', 'day_bounds'], ['in 53 weeks', 'week_bounds'],
    ['2026-02-30', 'invalid_date'], ['tomorrow 25:00', 'invalid_time'],
  ])('returns stable English error for %s', (input, code) => {
    expect(parseNaturalDateTime({ input, today, locale: 'en' })).toEqual({ ok: false, code });
  });

  it('keeps grammar locale explicit and formatting locale-owned', () => {
    expect(parseNaturalDateTime({ input: 'tomorrow', today, locale: 'pt-BR' }).ok).toBe(false);
    expect(parseNaturalDateTime({ input: 'amanhã', today, locale: 'en' }).ok).toBe(false);
    const result = { ok: true as const, date: '2026-08-26', time: '14:00' };
    expect(formatNaturalDateResult(result, 'en')).toContain('at');
    expect(formatNaturalDateResult(result, 'pt-BR')).toContain('às');
  });
});
