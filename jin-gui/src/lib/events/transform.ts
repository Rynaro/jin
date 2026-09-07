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
    if (tzid) opts.timeZone = tzid;

    const startDate = new Date(start);
    const endDate = new Date(end);
    const startStr = startDate.toLocaleTimeString(locale, opts);
    const endStr = endDate.toLocaleTimeString(locale, opts);
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

  if (isAllDay) {
    // All-day events: use UTC to avoid off-by-one date from TZ conversion
    opts.timeZone = 'UTC';
  } else if (tzid) {
    try {
      opts.timeZone = tzid;
    } catch {
      // Invalid tzid: omit timeZone (use system tz)
    }
  }

  try {
    return new Date(start).toLocaleDateString(locale, opts);
  } catch {
    return new Date(start).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** extractTime — extracts "HH:MM" from an ISO datetime string. */
function extractTime(iso: string): string {
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return '';
  return iso.slice(tIdx + 1, tIdx + 6);
}
