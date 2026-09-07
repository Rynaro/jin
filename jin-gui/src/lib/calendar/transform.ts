/**
 * calendar/transform.ts — pure calendar grid logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no Date.now() calls, no side effects.
 * The controller passes `today` as a parameter to keep this layer fully pure.
 *
 * Grid spec: 6 weeks × 7 days (42 cells), Sunday-first (Su Mo Tu We Th Fr Sa).
 * Tested by: src/__tests__/calendar_transform.test.ts (VG-P7).
 */

// ── Cell types ────────────────────────────────────────────────────────────────

export interface CalendarCell {
  /** ISO date string: YYYY-MM-DD */
  iso: string;
  /** Day-of-month number (1–31) */
  day: number;
  /** false = leading/trailing day from an adjacent month */
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isInRange: boolean;
  isRangeStart: boolean;
  isRangeEnd: boolean;
  /** Disabled by min/max bounds */
  isDisabled: boolean;
}

export interface MonthGridOptions {
  /** Currently selected ISO date, or undefined. */
  selected?: string;
  rangeStart?: string;
  rangeEnd?: string;
  /** Today's ISO date. Must be supplied by the caller (no Date.now in pure layer). */
  today?: string;
  /** Lower bound (inclusive). ISO date. */
  min?: string;
  /** Upper bound (inclusive). ISO date. */
  max?: string;
}

/** Calendar mode — v1 implements 'single' only; range/multi reserved. */
export type CalendarMode = 'single' | 'range' | 'multi';

// ── Low-level ISO helpers ─────────────────────────────────────────────────────

/**
 * toIso — format year/month/day as YYYY-MM-DD.
 * All integers; month is 1-based.
 */
export function toIso(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const y = String(year).padStart(4, '0');
  return `${y}-${m}-${d}`;
}

/**
 * parseIso — split YYYY-MM-DD into year/month/day (all integers, 1-based month).
 * Does NOT use Date constructor (avoids UTC/local ambiguity).
 */
export function parseIso(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/**
 * daysInMonth — number of days in the given month (handles leap years correctly).
 * month is 1-based (1 = January … 12 = December).
 * Uses the "day 0 of next month" trick which is built-in JavaScript.
 */
export function daysInMonth(year: number, month: number): number {
  // new Date(year, month, 0) → last day of month `month` (since month is 1-based,
  // passing month directly to the Date constructor gives the next month, and day 0
  // steps back to the last day of the requested month).
  return new Date(year, month, 0).getDate();
}

// ── Navigation helpers ────────────────────────────────────────────────────────

/**
 * addDays — add (or subtract) n days to an ISO date string.
 * Handles month/year wrap-around correctly via Date arithmetic.
 */
export function addDays(iso: string, n: number): string {
  const { year, month, day } = parseIso(iso);
  // Use Date for arithmetic (handles rollover — day can be out-of-range)
  const d = new Date(year, month - 1, day + n);
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** addWeeks — add n weeks (7 × n days). */
export function addWeeks(iso: string, n: number): string {
  return addDays(iso, n * 7);
}

/**
 * addMonths — add n months, clamping the day to the target month's length.
 * E.g. Jan 31 + 1 month → Feb 28/29 (not Mar 2/3).
 */
export function addMonths(iso: string, n: number): string {
  const { year, month, day } = parseIso(iso);
  // Compute new month/year without overflow
  let newMonth = month + n;
  let newYear = year;
  // Normalise — JavaScript's Date handles this but let's be explicit
  while (newMonth > 12) { newMonth -= 12; newYear++; }
  while (newMonth < 1) { newMonth += 12; newYear--; }
  const clampedDay = Math.min(day, daysInMonth(newYear, newMonth));
  return toIso(newYear, newMonth, clampedDay);
}

/**
 * addYears — add n years, clamping Feb 29 on non-leap years.
 */
export function addYears(iso: string, n: number): string {
  const { year, month, day } = parseIso(iso);
  const newYear = year + n;
  const clampedDay = Math.min(day, daysInMonth(newYear, month));
  return toIso(newYear, month, clampedDay);
}

/**
 * startOfWeek — ISO date of the Sunday of the week containing iso.
 */
export function startOfWeek(iso: string): string {
  const { year, month, day } = parseIso(iso);
  const d = new Date(year, month - 1, day);
  return addDays(iso, -d.getDay()); // getDay() = 0 for Sunday
}

/**
 * endOfWeek — ISO date of the Saturday of the week containing iso.
 */
export function endOfWeek(iso: string): string {
  const { year, month, day } = parseIso(iso);
  const d = new Date(year, month - 1, day);
  return addDays(iso, 6 - d.getDay());
}

/**
 * clampToBounds — clamp iso to [min, max] (lexicographic ISO comparison is date order).
 * Either bound may be undefined (open).
 */
export function clampToBounds(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

// ── Grid builder ──────────────────────────────────────────────────────────────

/**
 * buildMonthGrid — generate exactly 42 CalendarCell objects (6 weeks × 7 days)
 * for a given year+month, starting on the Sunday of the first week.
 *
 * Cells from adjacent months have `inMonth: false`.
 * `isToday`, `isSelected`, and `isDisabled` are computed from the options.
 *
 * @param year  - Calendar year (e.g. 2026)
 * @param month - 1-based month (1 = January … 12 = December)
 * @param options - selected, today, min, max
 */
export function buildMonthGrid(
  year: number,
  month: number,
  options: MonthGridOptions = {}
): CalendarCell[] {
  const { selected, rangeStart, rangeEnd, today, min, max } = options;

  // Find the ISO date of the first cell (Sunday of the first week of the month)
  const firstOfMonth = toIso(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);

  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i++) {
    const iso = addDays(gridStart, i);
    const { year: cy, month: cm, day: cd } = parseIso(iso);

    cells.push({
      iso,
      day: cd,
      inMonth: cy === year && cm === month,
      isToday: today ? iso === today : false,
      isSelected: (selected ? iso === selected : false) || iso === rangeStart || iso === rangeEnd,
      isInRange: Boolean(rangeStart && rangeEnd && iso >= rangeStart && iso <= rangeEnd),
      isRangeStart: Boolean(rangeStart && iso === rangeStart),
      isRangeEnd: Boolean(rangeEnd && iso === rangeEnd),
      isDisabled: (min ? iso < min : false) || (max ? iso > max : false),
    });
  }

  return cells;
}

// ── Due-string composer (P8, pure) ────────────────────────────────────────────

/**
 * composeDueString — compose a due field value from a date ISO and an optional
 * time string.
 *
 * - date only  → returns `YYYY-MM-DD`
 * - date+time  → returns a local-offset RFC-3339 string, e.g.
 *                `2026-06-30T09:00:00+03:00`
 *
 * The resulting string is accepted by core's `parse_due` for both variants:
 *   DueDate::Date    ← "YYYY-MM-DD"
 *   DueDate::DateTime ← RFC-3339
 *
 * @param dateIso  - YYYY-MM-DD (from the calendar selection)
 * @param timeStr  - HH:MM or empty string
 */
export function composeDueString(dateIso: string, timeStr: string): string {
  if (!timeStr || !timeStr.trim()) return dateIso;

  const { year, month, day } = parseIso(dateIso);
  const timeParts = timeStr.split(':');
  const hours = parseInt(timeParts[0] ?? '0', 10);
  const minutes = parseInt(timeParts[1] ?? '0', 10);

  // Build a local Date at the chosen date + time
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);

  // Compute local UTC offset in ±HH:MM
  const off = -d.getTimezoneOffset(); // getTimezoneOffset() returns negative for + offset
  const sign = off >= 0 ? '+' : '-';
  const absOff = Math.abs(off);
  const offH = String(Math.floor(absOff / 60)).padStart(2, '0');
  const offM = String(absOff % 60).padStart(2, '0');

  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00${sign}${offH}:${offM}`;
}

export interface DueStringParts {
  date: string;
  time: string;
}

/**
 * Split a persisted due value into the wall-clock fields shown by the editor.
 *
 * This deliberately does not construct a Date for RFC-3339 values: doing so
 * would apply the encoded offset and could move either the date or time before
 * the user has edited anything.
 */
export function decomposeDueString(due: string | null | undefined): DueStringParts {
  if (!due) return { date: '', time: '' };

  const match = due.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2}))?$/,
  );
  if (!match) return { date: '', time: '' };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = match[4] === undefined ? null : Number(match[4]);
  const minutes = match[5] === undefined ? null : Number(match[5]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const validDate = candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
  const validTime = hours === null || (hours >= 0 && hours <= 23 && minutes !== null && minutes >= 0 && minutes <= 59);
  if (!validDate || !validTime) return { date: '', time: '' };

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: hours === null ? '' : `${match[4]}:${match[5]}`,
  };
}

// ── Overdue detection (P8, pure) ──────────────────────────────────────────────

/**
 * isTaskOverdue — derive overdue status from the due field.
 *
 * Overdue = due date/time is strictly before `now`.
 * - Date-only due (`YYYY-MM-DD`): overdue if due date < today's date portion.
 * - DateTime due (RFC-3339): overdue if due < now.
 *
 * `now` is accepted as a parameter for full testability (no Date.now in pure layer).
 * The controller passes `new Date().toISOString()`.
 *
 * @param due - ISO date or RFC-3339 string, or null.
 * @param now - ISO datetime string for "now". If omitted, falls through to null check only.
 */
export function isTaskOverdue(due: string | null, now?: string): boolean {
  if (due == null || !now) return false;
  // Date-only: compare YYYY-MM-DD portions
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const todayDate = now.substring(0, 10);
    return due < todayDate;
  }
  // DateTime: lexicographic ISO comparison works for RFC-3339 with the same offset
  // For cross-offset safety, compare as Date objects.
  const dueMs = new Date(due).getTime();
  const nowMs = new Date(now).getTime();
  if (isNaN(dueMs) || isNaN(nowMs)) return false;
  return dueMs < nowMs;
}

/**
 * MONTH_NAMES — long English month names for the calendar header.
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
