import type { EventDto } from '../../types/dto';
import { JIN_PALETTE, isJinPaletteColor, normalizeJinColor, type JinColor, type JinPaletteColor } from '../ui/color_picker';

export const CALENDAR_COLOR_STORAGE_KEY = 'jin:calendar-colors:v1';
export const JIN_CALENDAR_KEY = 'jin';
export type CalendarColorPreferences = Record<string, JinColor>;

export function googleCalendarKey(accountId: string, calendarId: string): string {
  return `google:${encodeURIComponent(accountId)}:${encodeURIComponent(calendarId)}`;
}

export function calendarKeyForEvent(event: Pick<EventDto, 'source' | 'sync_context'>): string {
  if (event.source.toLowerCase() !== 'google') return JIN_CALENDAR_KEY;
  if (!event.sync_context) return 'google';
  return googleCalendarKey(event.sync_context.account_id, event.sync_context.calendar_id);
}

export function loadCalendarColors(storage: Pick<Storage, 'getItem'> = localStorage): CalendarColorPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(CALENDAR_COLOR_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      const normalized = typeof value === 'string' ? normalizeJinColor(value) : null;
      return normalized ? [[key, normalized]] : [];
    }));
  } catch {
    return {};
  }
}

export function saveCalendarColor(
  calendarKey: string,
  color: JinColor,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): CalendarColorPreferences {
  const next = { ...loadCalendarColors(storage), [calendarKey]: color };
  storage.setItem(CALENDAR_COLOR_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function defaultCalendarColor(calendarKey: string): JinPaletteColor {
  if (calendarKey === JIN_CALENDAR_KEY) return 'accent';
  const alternatives = JIN_PALETTE.filter(color => color !== 'accent');
  let hash = 0;
  for (const char of calendarKey) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return alternatives[hash % alternatives.length];
}

export function calendarColor(calendarKey: string, preferences = loadCalendarColors()): JinColor {
  return preferences[calendarKey] ?? defaultCalendarColor(calendarKey);
}

export function calendarColorForEvent(event: Pick<EventDto, 'source' | 'sync_context'>): JinColor {
  return calendarColor(calendarKeyForEvent(event));
}

export function applyCalendarColor(element: HTMLElement, color: JinColor): void {
  if (isJinPaletteColor(color)) {
    element.dataset.calendarColor = color;
    element.style.removeProperty('--calendar-color-value');
  } else {
    element.dataset.calendarColor = 'custom';
    element.style.setProperty('--calendar-color-value', color);
  }
}
