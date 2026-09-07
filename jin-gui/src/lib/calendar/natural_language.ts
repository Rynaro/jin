import { addDays, parseIso } from './transform';
import { eventMessage, type EventLocaleKey, type EventMessageKey } from '../events/locale';

export type NaturalDateErrorCode =
  | 'empty'
  | 'unsupported'
  | 'invalid_date'
  | 'invalid_time'
  | 'day_bounds'
  | 'week_bounds'
  | 'invalid_today';

export type NaturalDateResult =
  | { ok: true; date: string; time: string | null }
  | { ok: false; code: NaturalDateErrorCode };

const EN_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PT_WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1, 'segunda-feira': 1,
  terca: 2, 'terca-feira': 2,
  quarta: 3, 'quarta-feira': 3,
  quinta: 4, 'quinta-feira': 4,
  sexta: 5, 'sexta-feira': 5,
  sabado: 6,
};

function normalize(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function validIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseIso(value);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function weekdayNumber(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return new Date(year, month - 1, day).getDay();
}

function weekdayOffset(today: string, target: number, next: boolean): number {
  const withinWeek = (target - weekdayNumber(today) + 7) % 7;
  return next ? withinWeek + 7 : withinWeek;
}

function parseTime(raw: string, locale: EventLocaleKey): string | null | undefined {
  let value = normalize(raw);
  if (!value) return null;
  if (locale === 'pt-BR') {
    value = value.replace(/^as\s+/, '');
    if (value === 'meio-dia') return '12:00';
    if (value === 'meia-noite') return '00:00';
    const hourForm = /^(\d{1,2})h(?:(\d{2}))?$/.exec(value);
    if (hourForm) value = `${hourForm[1]}:${hourForm[2] ?? '00'}`;
  } else {
    value = value.replace(/^at\s+/, '');
    if (value === 'noon') return '12:00';
    if (value === 'midnight') return '00:00';
  }
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3];
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return undefined;
  if (meridiem) {
    hour %= 12;
    if (meridiem === 'pm') hour += 12;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Pure, bounded parser. It never resolves locale or current time implicitly. */
export function parseNaturalDateTime(args: {
  input: string;
  today: string;
  locale: EventLocaleKey;
}): NaturalDateResult {
  const { today, locale } = args;
  if (!validIso(today)) return { ok: false, code: 'invalid_today' };
  const value = normalize(args.input);
  if (!value) return { ok: false, code: 'empty' };

  let date = '';
  let tail = '';
  const iso = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/.exec(value);
  if (iso) {
    if (!validIso(iso[1])) return { ok: false, code: 'invalid_date' };
    date = iso[1];
    tail = iso[2] ?? '';
  } else if (locale === 'en') {
    const relative = /^(today|tomorrow|yesterday)(?:\s+(.*))?$/.exec(value);
    const weekday = /^(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.*))?$/.exec(value);
    const amount = /^in\s+(\d+)\s+(day|days|week|weeks)(?:\s+(.*))?$/.exec(value);
    if (relative) {
      date = addDays(today, relative[1] === 'tomorrow' ? 1 : relative[1] === 'yesterday' ? -1 : 0);
      tail = relative[2] ?? '';
    } else if (weekday) {
      date = addDays(today, weekdayOffset(today, EN_WEEKDAYS.indexOf(weekday[2]), weekday[1] === 'next'));
      tail = weekday[3] ?? '';
    } else if (amount) {
      const count = Number(amount[1]);
      const weeks = amount[2].startsWith('week');
      if (count < 1 || count > (weeks ? 52 : 365)) return { ok: false, code: weeks ? 'week_bounds' : 'day_bounds' };
      date = addDays(today, count * (weeks ? 7 : 1));
      tail = amount[3] ?? '';
    }
  } else {
    const relative = /^(hoje|amanha|ontem)(?:\s+(.*))?$/.exec(value);
    const weekday = /^(esta|este|proxima|proximo)\s+([a-z-]+)(?:\s+(.*))?$/.exec(value);
    const amount = /^(?:em|daqui a)\s+(\d+)\s+(dia|dias|semana|semanas)(?:\s+(.*))?$/.exec(value);
    if (relative) {
      date = addDays(today, relative[1] === 'amanha' ? 1 : relative[1] === 'ontem' ? -1 : 0);
      tail = relative[2] ?? '';
    } else if (weekday && PT_WEEKDAYS[weekday[2]] !== undefined) {
      date = addDays(today, weekdayOffset(today, PT_WEEKDAYS[weekday[2]], weekday[1].startsWith('proxim')));
      tail = weekday[3] ?? '';
    } else if (amount) {
      const count = Number(amount[1]);
      const weeks = amount[2].startsWith('semana');
      if (count < 1 || count > (weeks ? 52 : 365)) return { ok: false, code: weeks ? 'week_bounds' : 'day_bounds' };
      date = addDays(today, count * (weeks ? 7 : 1));
      tail = amount[3] ?? '';
    }
  }

  if (!date) return { ok: false, code: 'unsupported' };
  const time = parseTime(tail, locale);
  if (time === undefined) return { ok: false, code: 'invalid_time' };
  return { ok: true, date, time };
}

export function formatNaturalDateResult(
  result: Extract<NaturalDateResult, { ok: true }>,
  locale: EventLocaleKey,
): string {
  const { year, month, day } = parseIso(result.date);
  const date = new Date(year, month - 1, day);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).format(date);
  if (!result.time) return dateLabel;
  const [hours, minutes] = result.time.split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  return locale === 'pt-BR' ? `${dateLabel}, às ${timeLabel}` : `${dateLabel} at ${timeLabel}`;
}

export function naturalDateErrorMessage(code: NaturalDateErrorCode, locale: EventLocaleKey): string {
  const keys: Record<NaturalDateErrorCode, EventMessageKey> = {
    empty: 'naturalEmpty',
    unsupported: 'naturalUnsupported',
    invalid_date: 'naturalInvalidDate',
    invalid_time: 'naturalInvalidTime',
    day_bounds: 'naturalDayBounds',
    week_bounds: 'naturalWeekBounds',
    invalid_today: 'naturalInvalidToday',
  };
  return eventMessage(keys[code], locale);
}
