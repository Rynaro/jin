import type { EventDto } from '../../types/dto';
import { JIN_PALETTE, isJinPaletteColor, normalizeJinColor, type JinColor, type JinPaletteColor } from '../ui/color_picker';

export const CALENDAR_COLOR_STORAGE_KEY = 'jin:calendar-colors:v1';
export const JIN_CALENDAR_KEY = 'jin';
export type CalendarColorPreferences = Record<string, JinColor>;

/** Shared membership fields — every surface must derive label/color/key from these. */
export interface CalendarMembershipIdentity {
  key: string;
  /** Calendar name (Google calendar_name) or the Jin calendar label — never provenance. */
  label: string;
  accountAlias: string | null;
  color: JinColor;
  provider: string;
}

export function googleCalendarKey(accountId: string, calendarId: string): string {
  return `google:${encodeURIComponent(accountId)}:${encodeURIComponent(calendarId)}`;
}

export function calendarKeyForEvent(event: Pick<EventDto, 'source' | 'sync_context'>): string {
  if (event.sync_context?.provider === 'google') {
    return googleCalendarKey(event.sync_context.account_id, event.sync_context.calendar_id);
  }
  return calendarProviderForEvent(event) === 'google' ? 'google' : JIN_CALENDAR_KEY;
}

/** Calendar membership is independent of where the event was first created. */
export function calendarProviderForEvent(event: Pick<EventDto, 'source' | 'sync_context'>): string {
  return event.sync_context?.provider === 'google' ? 'google' : event.source.toLowerCase();
}

/**
 * Membership label only. Pass the localized Jin calendar name for local events.
 * Never use "Created in Jin" / source badges here — those are provenance.
 */
export function calendarLabelForEvent(
  event: Pick<EventDto, 'source' | 'sync_context'>,
  jinLabel: string,
): string {
  if (event.sync_context?.provider === 'google') {
    return event.sync_context.calendar_name;
  }
  return jinLabel;
}

export function calendarAccountAliasForEvent(
  event: Pick<EventDto, 'sync_context'>,
): string | null {
  return event.sync_context?.provider === 'google'
    ? event.sync_context.account_alias
    : null;
}

/** Compact chip/badge line: `alias · label` when an account alias is present. */
export function formatCalendarMembershipShort(
  identity: Pick<CalendarMembershipIdentity, 'label' | 'accountAlias'>,
): string {
  return identity.accountAlias
    ? `${identity.accountAlias} · ${identity.label}`
    : identity.label;
}

/**
 * Provenance is secondary metadata. It must never replace calendar membership.
 */
export function calendarProvenanceLabel(
  event: Pick<EventDto, 'source' | 'sync_context'>,
  copy: { createdInJin: string; sourceGoogle: string; sourceJin: string },
): string {
  if (event.sync_context?.provider === 'google') {
    return event.source === 'jin' ? copy.createdInJin : copy.sourceGoogle;
  }
  return event.source.toLowerCase() === 'google' ? copy.sourceGoogle : copy.sourceJin;
}

export function calendarMembershipIdentity(
  event: Pick<EventDto, 'source' | 'sync_context'>,
  jinLabel: string,
  preferences: CalendarColorPreferences = loadCalendarColors(),
): CalendarMembershipIdentity {
  const key = calendarKeyForEvent(event);
  return {
    key,
    label: calendarLabelForEvent(event, jinLabel),
    accountAlias: calendarAccountAliasForEvent(event),
    color: calendarColor(key, preferences),
    provider: calendarProviderForEvent(event),
  };
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
