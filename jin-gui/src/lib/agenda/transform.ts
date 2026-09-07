/**
 * transform.ts — pure agenda transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * The TodayController is a thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/today_controller.test.ts
 */

import type { AgendaDto, AgendaEventDto } from '../../types/dto';

// ── Output types ──────────────────────────────────────────────────────────────

export interface GroupedAgenda {
  /** Target date as "YYYY-MM-DD". */
  date: string;
  /** IANA timezone name used for display. */
  displayTz: string;
  /**
   * All-day events (is_all_day === true).
   * Core delivers them sorted by title; carried as-is.
   */
  allDay: AgendaEventDto[];
  /**
   * Timed and floating events sorted by UTC start ascending.
   * Core delivers them pre-sorted; we re-verify defensively.
   */
  timed: AgendaEventDto[];
  /** True when both buckets are empty — drives the empty state. */
  isEmpty: boolean;
}

// ── Core transforms ───────────────────────────────────────────────────────────

/**
 * groupAgenda — produce the view-ready GroupedAgenda from the core AgendaDto.
 *
 * The core already delivers `all_day_events` and `timed_events` as separate
 * sorted arrays. We wrap them and defensively re-verify the timed sort so
 * this function is self-contained (safe if core order ever changes).
 */
export function groupAgenda(dto: AgendaDto): GroupedAgenda {
  return {
    date: dto.date,
    displayTz: dto.display_tz,
    allDay: [...dto.all_day_events],
    timed: sortTimedEvents(dto.timed_events),
    isEmpty: dto.all_day_events.length === 0 && dto.timed_events.length === 0,
  };
}

/**
 * sortTimedEvents — sort by ISO start string ascending.
 *
 * ISO strings in UTC ("2026-06-27T14:00:00Z") sort correctly lexicographically.
 * Returns a new array; does NOT mutate the input.
 */
export function sortTimedEvents(events: AgendaEventDto[]): AgendaEventDto[] {
  return [...events].sort((a, b) => a.start.localeCompare(b.start));
}

// ── Source badge helpers ──────────────────────────────────────────────────────

/**
 * sourceBadgeLabel — human-readable text label for the source badge.
 *
 * ALWAYS returns a non-empty string so no event is identified by color alone.
 * Required by HIG color-independence + WCAG SC 1.4.1 (use of color).
 *
 *   "jin"    → "Jin"
 *   "google" → "Google"
 *   other   → first-char-uppercased source, or "Unknown" for empty strings
 */
export function sourceBadgeLabel(source: string): string {
  switch (source.toLowerCase()) {
    case 'jin':
      return 'Jin';
    case 'google':
      return 'Google';
    default:
      return source.length > 0
        ? source.charAt(0).toUpperCase() + source.slice(1)
        : 'Unknown';
  }
}

/**
 * sourceBadgeIcon — Lucide icon name for the source badge.
 *
 * Supplementary to the text label; never the sole visual identifier.
 *
 *   "jin"    → "database" (local/sovereign)
 *   "google" → "cloud"   (remote/synced)
 *   other   → "circle"
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

// ── Event attribute helpers ───────────────────────────────────────────────────

/**
 * isRecurring — true when the event is a recurring series placeholder that
 * the core could not expand. The GUI must label these and never offer an edit
 * affordance (recurrence editing is deferred — spec §1.5).
 */
export function isRecurring(event: AgendaEventDto): boolean {
  return event.recurrence_unexpanded === true;
}

// ── Date navigation helpers ───────────────────────────────────────────────────

/**
 * prevDay — returns the ISO date string for the previous calendar day.
 * Input/output: "YYYY-MM-DD". Uses UTC arithmetic to avoid DST edge cases.
 */
export function prevDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * nextDay — returns the ISO date string for the next calendar day.
 * Input/output: "YYYY-MM-DD". Uses UTC arithmetic to avoid DST edge cases.
 */
export function nextDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * todayIsoDate — returns the current local date as "YYYY-MM-DD".
 * Side-effectful (reads the clock); isolated here so callers can stub it.
 */
export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * formatDisplayDate — formats a "YYYY-MM-DD" ISO date for human display.
 *
 * Returns "Today" when the date equals referenceToday (default: todayIsoDate()).
 * Pass referenceToday in tests to freeze the reference clock.
 *
 * Uses browser locale for weekday/month/day format.
 */
export function formatDisplayDate(isoDate: string, referenceToday?: string): string {
  const today = referenceToday ?? todayIsoDate();
  if (isoDate === today) return 'Today';

  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
