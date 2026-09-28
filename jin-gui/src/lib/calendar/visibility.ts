/**
 * Route-local Calendar display filter.
 *
 * Visibility is a GUI preference only. It never calls Settings, account
 * connect/disconnect, sync enablement, or any Tauri bridge that mutates
 * provider sync. Hidden calendars remain synced per Settings.
 */

import type { EventDto, GoogleAccountDto } from '../../types/dto';
import type { JinColor } from '../ui/color_picker';
import {
  calendarColor,
  calendarKeyForEvent,
  googleCalendarKey,
  JIN_CALENDAR_KEY,
  loadCalendarColors,
} from './colors';

export const CALENDAR_VISIBILITY_STORAGE_KEY = 'jin:calendar-visibility:v1';

/** Explicit false = hidden; missing or true = visible. */
export type CalendarVisibilityMap = Record<string, boolean>;

export interface CalendarFilterIdentity {
  key: string;
  label: string;
  accountAlias: string | null;
  color: JinColor;
}

export function loadCalendarVisibility(
  storage: Pick<Storage, 'getItem'> = localStorage,
): CalendarVisibilityMap {
  try {
    const parsed = JSON.parse(storage.getItem(CALENDAR_VISIBILITY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => (
        typeof value === 'boolean' ? [[key, value]] : []
      )),
    );
  } catch {
    return {};
  }
}

export function saveCalendarVisibility(
  map: CalendarVisibilityMap,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(CALENDAR_VISIBILITY_STORAGE_KEY, JSON.stringify(map));
}

export function isCalendarVisible(
  key: string,
  map: CalendarVisibilityMap = loadCalendarVisibility(),
): boolean {
  return map[key] !== false;
}

export function setCalendarVisible(
  key: string,
  visible: boolean,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): CalendarVisibilityMap {
  const next = { ...loadCalendarVisibility(storage), [key]: visible };
  saveCalendarVisibility(next, storage);
  return next;
}

/** Empty map = every calendar visible (default). */
export function resetCalendarVisibility(
  storage: Pick<Storage, 'setItem'> = localStorage,
): CalendarVisibilityMap {
  const empty: CalendarVisibilityMap = {};
  saveCalendarVisibility(empty, storage);
  return empty;
}

export function areAllCalendarsHidden(
  keys: readonly string[],
  map: CalendarVisibilityMap,
): boolean {
  return keys.length > 0 && keys.every(key => !isCalendarVisible(key, map));
}

export function filterEventsByVisibility(
  events: readonly EventDto[],
  map: CalendarVisibilityMap = loadCalendarVisibility(),
): EventDto[] {
  return events.filter(event => isCalendarVisible(calendarKeyForEvent(event), map));
}

/**
 * Identities the Calendar route already knows: Jin + Google calendars from
 * listed events and from connected-account discovery used for destinations.
 */
export function collectCalendarFilterIdentities(
  events: readonly EventDto[],
  accounts: readonly GoogleAccountDto[] | null | undefined,
  jinLabel: string,
): CalendarFilterIdentity[] {
  const preferences = loadCalendarColors();
  const byKey = new Map<string, CalendarFilterIdentity>();

  byKey.set(JIN_CALENDAR_KEY, {
    key: JIN_CALENDAR_KEY,
    label: jinLabel,
    accountAlias: null,
    color: calendarColor(JIN_CALENDAR_KEY, preferences),
  });

  for (const event of events) {
    const key = calendarKeyForEvent(event);
    if (byKey.has(key)) continue;
    if (event.sync_context?.provider === 'google') {
      byKey.set(key, {
        key,
        label: event.sync_context.calendar_name,
        accountAlias: event.sync_context.account_alias,
        color: calendarColor(key, preferences),
      });
    }
  }

  for (const account of accounts ?? []) {
    for (const calendar of account.calendars) {
      if (!calendar.available && !calendar.enabled) continue;
      const key = googleCalendarKey(account.id, calendar.calendar_id);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        label: calendar.name,
        accountAlias: account.alias,
        color: calendarColor(key, preferences),
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.key === JIN_CALENDAR_KEY) return -1;
    if (b.key === JIN_CALENDAR_KEY) return 1;
    return a.label.localeCompare(b.label);
  });
}
