/**
 * transform.ts — pure agenda transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * The TodayController is a thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/today_controller.test.ts
 */

import type {
  AgendaDto, AgendaEventDto, AgendaTaskDto, TodayFocusEventDto, TodayProjectionDto,
} from '../../types/dto';
import { formatEventTime } from '../events/transform';

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
  /** Presentation derived from real event fields. Keys are stable event ids. */
  presentationById?: ReadonlyMap<string, AgendaRowPresentation>;
  /** True when both buckets are empty — drives the empty state. */
  isEmpty: boolean;
  currentDate?: string;
  isCurrentDate?: boolean;
  attentionTasks?: AgendaTaskDto[];
  dueTasks?: AgendaTaskDto[];
  flexibleTasks?: AgendaTaskDto[];
  activeFocus?: TodayFocusEventDto[];
  nextFocus?: TodayFocusEventDto | null;
}

/** Display-only metadata for a timed agenda row. It never changes the DTO. */
export interface AgendaRowPresentation {
  timeRange: string;
  overlaps: boolean;
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
  const timed = sortTimedEvents(dto.timed_events);
  return {
    date: dto.date,
    displayTz: dto.display_tz,
    allDay: [...dto.all_day_events],
    timed,
    presentationById: projectTimedAgenda(timed, dto.display_tz),
    isEmpty: dto.all_day_events.length === 0 && dto.timed_events.length === 0,
  };
}

/** Compose the dedicated Today projection without recreating time authority in the browser. */
export function groupTodayProjection(dto: TodayProjectionDto): GroupedAgenda {
  const grouped = groupAgenda(dto.agenda);
  return {
    ...grouped,
    currentDate: dto.current_date,
    isCurrentDate: dto.is_current_date,
    attentionTasks: [...dto.attention_tasks],
    dueTasks: [...dto.due_tasks],
    flexibleTasks: [...dto.flexible_tasks],
    activeFocus: [...dto.active_events],
    nextFocus: dto.next_event,
    isEmpty: grouped.isEmpty
      && dto.attention_tasks.length === 0
      && dto.due_tasks.length === 0
      && dto.flexible_tasks.length === 0,
  };
}

/**
 * projectTimedAgenda derives display ranges and honest overlap cues.
 *
 * Anchored events are compared as epoch intervals. Floating events are compared
 * as literal wall-time intervals. The two domains are deliberately never mixed:
 * doing so would turn a timezone conversion into a false scheduling conflict.
 * Invalid, zero-length, and all-day items are excluded from overlap detection.
 */
export function projectTimedAgenda(
  events: AgendaEventDto[],
  displayTz: string,
): ReadonlyMap<string, AgendaRowPresentation> {
  const presentation = new Map<string, AgendaRowPresentation>();
  const comparable: ComparableInterval[] = [];

  for (const event of events) {
    presentation.set(event.id, {
      timeRange: formatEventTime(
        event.start,
        event.end,
        event.is_all_day,
        event.floating,
        event.floating ? null : displayTz,
      ),
      overlaps: false,
    });

    if (event.is_all_day) continue;
    const interval = comparableInterval(event);
    if (interval) comparable.push(interval);
  }

  for (const domain of ['anchored', 'floating'] as const) {
    markOverlappingIntervals(comparable.filter((interval) => interval.domain === domain), presentation);
  }

  return presentation;
}

type IntervalDomain = 'anchored' | 'floating';

interface ComparableInterval {
  id: string;
  domain: IntervalDomain;
  start: number;
  end: number;
}

function comparableInterval(event: AgendaEventDto): ComparableInterval | null {
  const domain: IntervalDomain = event.floating ? 'floating' : 'anchored';
  const start = event.floating ? parseLiteralWallTime(event.start) : parseAnchoredTime(event.start);
  const end = event.floating ? parseLiteralWallTime(event.end) : parseAnchoredTime(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { id: event.id, domain, start, end };
}

/**
 * Anchored values must carry Z or an explicit offset. Date.parse accepts a
 * zone-less ISO timestamp using the host timezone, which would make conflict
 * cues vary by machine and is therefore intentionally excluded.
 */
function parseAnchoredTime(value: string): number {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return Number.NaN;
  return Date.parse(value);
}

/** Parses ISO-like wall times without applying the machine timezone or an offset. */
function parseLiteralWallTime(value: string): number {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match;
  const stamp = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    Number(second), Number(fraction.padEnd(3, '0')),
  );
  const date = new Date(stamp);
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    ? stamp
    : Number.NaN;
}

/**
 * Marks each member of a transitive overlap group using a max-end sweep.
 * Half-open boundaries mean an item beginning exactly when another ends is not
 * marked as conflicting.
 */
function markOverlappingIntervals(
  intervals: ComparableInterval[],
  presentation: Map<string, AgendaRowPresentation>,
): void {
  const ordered = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  let group: ComparableInterval[] = [];
  let maxEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (group.length > 1) {
      for (const interval of group) {
        const current = presentation.get(interval.id);
        if (current) presentation.set(interval.id, { ...current, overlaps: true });
      }
    }
    group = [];
    maxEnd = Number.NEGATIVE_INFINITY;
  };

  for (const interval of ordered) {
    if (group.length > 0 && interval.start >= maxEnd) flush();
    group.push(interval);
    maxEnd = Math.max(maxEnd, interval.end);
  }
  flush();
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
