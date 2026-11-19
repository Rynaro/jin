/**
 * events/transform.ts — pure events transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * EventsController is the thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/events_controller.test.ts
 */

import type { EventDto } from '../../types/dto';
import { eventMessage, resolveEventLocale, type EventLocaleKey } from './locale';

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * sortEventsList — sort events by ISO start string ascending.
 * Returns a new array; does NOT mutate the input.
 */
export function sortEventsList(events: EventDto[]): EventDto[] {
  return [...events].sort((a, b) => a.start.localeCompare(b.start));
}

// ── Source badge helpers ──────────────────────────────────────────────────────

/**
 * sourceBadgeLabel — human-readable text label for the source badge.
 *
 * ALWAYS returns a non-empty string so no event is identified by color alone.
 * Required by HIG color-independence + WCAG SC 1.4.1 (use of color).
 */
export function sourceBadgeLabel(source: string): string {
  switch (source.toLowerCase()) {
    case 'jin':
      return 'Jin';
    case 'google':
      return 'Google';
    default:
      return source.length > 0 ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown';
  }
}

/**
 * sourceBadgeIcon — Lucide icon name for the source badge.
 * Supplementary to the text label; never the sole visual identifier.
 */
export function sourceBadgeIcon(source: string): string {
  switch (source.toLowerCase()) {
    case 'jin':
      return 'database';
    case 'google':
      return 'cloud';
    default:
      return 'circle';
  }
}

// ── Time / date formatters ────────────────────────────────────────────────────

/**
 * formatEventTime — returns a human-readable time range string.
 *
 * - All-day events → "all-day"
 * - Floating events (no timezone anchor) → time extracted directly from ISO string
 * - Timed events → localized time range with optional tzid
 */
export function formatEventTime(
  start: string,
  end: string,
  isAllDay: boolean,
  floating: boolean,
  tzid?: string | null,
  locale: EventLocaleKey = resolveEventLocale(),
): string {
  if (isAllDay) return eventMessage('allDay', locale);

  if (floating) {
    // Extract HH:MM directly from ISO string to avoid TZ conversion for floating times
    const startTime = extractTime(start);
    const endTime = extractTime(end);
    return endTime ? `${startTime} – ${endTime}` : startTime;
  }

  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
    };
    const startValue = eventDisplayValue(start, tzid);
    const endValue = eventDisplayValue(end, tzid);
    const startStr = startValue.date.toLocaleTimeString(locale, { ...opts, timeZone: startValue.timeZone });
    const endStr = endValue.date.toLocaleTimeString(locale, { ...opts, timeZone: endValue.timeZone });
    return `${startStr} – ${endStr}`;
  } catch {
    // Fallback: extract from ISO string if locale/tz conversion fails
    const startTime = extractTime(start);
    const endTime = extractTime(end);
    return endTime ? `${startTime} – ${endTime}` : startTime;
  }
}

/**
 * formatEventDate — returns a human-readable date string for the event start.
 * Uses tzid when provided (for timed events).
 */
export function formatEventDate(
  start: string,
  isAllDay: boolean,
  tzid?: string | null,
  locale: EventLocaleKey = resolveEventLocale(),
): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  };

  const value = eventDisplayValue(start, isAllDay ? 'UTC' : tzid);
  opts.timeZone = isAllDay ? 'UTC' : value.timeZone;

  try {
    return value.date.toLocaleDateString(locale, opts);
  } catch {
    return value.date.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: isWallDateTime(start) ? 'UTC' : undefined,
    });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isWallDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value);
}

/** Canonical offsetless values are wall time in their own declared zone.
 * UTC here is a formatting carrier, so the host zone cannot shift the value.
 * Offset-bearing values remain real instants and convert into the requested zone.
 */
function eventDisplayValue(value: string, timeZone?: string | null): { date: Date; timeZone?: string } {
  return isWallDateTime(value)
    ? { date: new Date(`${value}Z`), timeZone: 'UTC' }
    : { date: new Date(value), timeZone: timeZone || undefined };
}

/** extractTime — extracts "HH:MM" from an ISO datetime string. */
function extractTime(iso: string): string {
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return '';
  return iso.slice(tIdx + 1, tIdx + 6);
}
