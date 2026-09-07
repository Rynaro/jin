/**
 * calendar_transform.test.ts — VG-P7 pure transform tests.
 *
 * Tests the headless-pure layer: buildMonthGrid, nav helpers, overdue, compose-due.
 * No DOM, no Stimulus, no async — fully synchronous.
 *
 * VG-P7 coverage:
 *   ✓ buildMonthGrid: known month produces exactly 42 cells
 *   ✓ buildMonthGrid: leap-year February (Feb 2024 — 29 days)
 *   ✓ buildMonthGrid: non-leap February (Feb 2025 — 28 days)
 *   ✓ buildMonthGrid: outside-month cells marked inMonth:false
 *   ✓ buildMonthGrid: today/selected/disabled flags correct
 *   ✓ buildMonthGrid: min/max disabling
 *   ✓ buildMonthGrid: grid starts on Sunday
 *   ✓ addDays / addWeeks / addMonths / addYears
 *   ✓ startOfWeek / endOfWeek / clampToBounds
 *   ✓ composeDueString: date-only returns YYYY-MM-DD
 *   ✓ composeDueString: date+time returns valid RFC-3339
 *   ✓ isTaskOverdue: past-due → true; future-due → false; null → false
 *
 * VG-P8 overdue gate (co-located here — pure-layer tests, no DOM needed):
 *   ✓ isTaskOverdue: danger class logic (past vs future)
 */

import { describe, it, expect } from 'vitest';
import {
  buildMonthGrid,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfWeek,
  endOfWeek,
  clampToBounds,
  composeDueString,
  decomposeDueString,
  isTaskOverdue,
  parseIso,
  toIso,
  daysInMonth,
} from '../lib/calendar/transform';

// ── buildMonthGrid ────────────────────────────────────────────────────────────

describe('buildMonthGrid', () => {
  it('returns exactly 42 cells (6 weeks × 7 days)', () => {
    const cells = buildMonthGrid(2026, 6);
    expect(cells).toHaveLength(42);
  });

  it('June 2026: first cell is Sunday 2026-05-31 (outside month)', () => {
    // June 1 2026 is a Monday → grid starts on the previous Sunday (May 31)
    const cells = buildMonthGrid(2026, 6);
    expect(cells[0].iso).toBe('2026-05-31');
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].day).toBe(31);
  });

  it('June 2026: cell for June 1 is inMonth=true', () => {
    const cells = buildMonthGrid(2026, 6);
    const june1 = cells.find((c) => c.iso === '2026-06-01');
    expect(june1).toBeDefined();
    expect(june1!.inMonth).toBe(true);
    expect(june1!.day).toBe(1);
  });

  it('June 2026: last in-month cell is June 30', () => {
    const cells = buildMonthGrid(2026, 6);
    const june30 = cells.find((c) => c.iso === '2026-06-30');
    expect(june30).toBeDefined();
    expect(june30!.inMonth).toBe(true);
  });

  it('June 2026: trailing cells from July are inMonth=false', () => {
    const cells = buildMonthGrid(2026, 6);
    const julyCell = cells.find((c) => c.iso === '2026-07-01');
    expect(julyCell).toBeDefined();
    expect(julyCell!.inMonth).toBe(false);
  });

  it('June 2026: all cells have unique iso values', () => {
    const cells = buildMonthGrid(2026, 6);
    const isos = cells.map((c) => c.iso);
    const unique = new Set(isos);
    expect(unique.size).toBe(42);
  });

  it('June 2026: cells are in ascending date order', () => {
    const cells = buildMonthGrid(2026, 6);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].iso > cells[i - 1].iso).toBe(true);
    }
  });

  it('February 2024 (leap year): has 29 in-month cells', () => {
    const cells = buildMonthGrid(2024, 2);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[inMonth.length - 1].day).toBe(29);
  });

  it('February 2025 (non-leap): has 28 in-month cells', () => {
    const cells = buildMonthGrid(2025, 2);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[inMonth.length - 1].day).toBe(28);
  });

  it('today flag: correct cell is marked isToday=true', () => {
    const today = '2026-06-15';
    const cells = buildMonthGrid(2026, 6, { today });
    const todayCell = cells.find((c) => c.iso === today);
    expect(todayCell!.isToday).toBe(true);
    // All others are false
    const notToday = cells.filter((c) => c.iso !== today);
    expect(notToday.every((c) => !c.isToday)).toBe(true);
  });

  it('selected flag: correct cell is marked isSelected=true', () => {
    const selected = '2026-06-20';
    const cells = buildMonthGrid(2026, 6, { selected });
    const selCell = cells.find((c) => c.iso === selected);
    expect(selCell!.isSelected).toBe(true);
    const others = cells.filter((c) => c.iso !== selected);
    expect(others.every((c) => !c.isSelected)).toBe(true);
  });

  it('marks inclusive range endpoints and interior across a month boundary', () => {
    const cells = buildMonthGrid(2026, 6, { rangeStart: '2026-06-29', rangeEnd: '2026-07-02' });
    expect(cells.find(cell => cell.iso === '2026-06-29')).toMatchObject({ isRangeStart: true, isInRange: true });
    expect(cells.find(cell => cell.iso === '2026-07-01')).toMatchObject({ isSelected: false, isInRange: true });
    expect(cells.find(cell => cell.iso === '2026-07-02')).toMatchObject({ isRangeEnd: true, isInRange: true });
  });

  it('min bound: cells before min are disabled', () => {
    const min = '2026-06-15';
    const cells = buildMonthGrid(2026, 6, { min });
    const beforeMin = cells.filter((c) => c.iso < min && c.inMonth);
    expect(beforeMin.every((c) => c.isDisabled)).toBe(true);
    const afterMin = cells.filter((c) => c.iso >= min && c.inMonth);
    expect(afterMin.every((c) => !c.isDisabled)).toBe(true);
  });

  it('max bound: cells after max are disabled', () => {
    const max = '2026-06-15';
    const cells = buildMonthGrid(2026, 6, { max });
    const afterMax = cells.filter((c) => c.iso > max && c.inMonth);
    expect(afterMax.every((c) => c.isDisabled)).toBe(true);
    const beforeMax = cells.filter((c) => c.iso <= max && c.inMonth);
    expect(beforeMax.every((c) => !c.isDisabled)).toBe(true);
  });

  it('both min and max: only cells in range are enabled', () => {
    const min = '2026-06-10';
    const max = '2026-06-20';
    const cells = buildMonthGrid(2026, 6, { min, max });
    const inRange = cells.filter((c) => c.iso >= min && c.iso <= max && c.inMonth);
    expect(inRange.every((c) => !c.isDisabled)).toBe(true);
    const outOfRange = cells.filter((c) => (c.iso < min || c.iso > max) && c.inMonth);
    expect(outOfRange.every((c) => c.isDisabled)).toBe(true);
  });

  it('grid always starts on Sunday (day 0)', () => {
    // Test multiple months
    const months = [
      [2026, 1], [2026, 3], [2026, 6], [2026, 12],
      [2024, 2], [2025, 2], // leap and non-leap
    ] as const;
    for (const [year, month] of months) {
      const cells = buildMonthGrid(year, month);
      const { year: cy, month: cm, day: cd } = parseIso(cells[0].iso);
      const d = new Date(cy, cm - 1, cd);
      expect(d.getDay()).toBe(0); // Sunday
    }
  });

  it('January 2025: 31 in-month cells', () => {
    const cells = buildMonthGrid(2025, 1);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
  });
});

// ── daysInMonth ───────────────────────────────────────────────────────────────

describe('daysInMonth', () => {
  it('January = 31', () => expect(daysInMonth(2026, 1)).toBe(31));
  it('February 2024 (leap) = 29', () => expect(daysInMonth(2024, 2)).toBe(29));
  it('February 2025 (non-leap) = 28', () => expect(daysInMonth(2025, 2)).toBe(28));
  it('April = 30', () => expect(daysInMonth(2026, 4)).toBe(30));
  it('December = 31', () => expect(daysInMonth(2026, 12)).toBe(31));
});

// ── addDays ───────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-06-28', 2)).toBe('2026-06-30');
  });

  it('subtracts negative days', () => {
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('wraps month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('wraps year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('handles leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });
});

// ── addWeeks ──────────────────────────────────────────────────────────────────

describe('addWeeks', () => {
  it('adds 1 week = 7 days', () => {
    expect(addWeeks('2026-06-01', 1)).toBe('2026-06-08');
  });

  it('subtracts 1 week', () => {
    expect(addWeeks('2026-06-08', -1)).toBe('2026-06-01');
  });
});

// ── addMonths ─────────────────────────────────────────────────────────────────

describe('addMonths', () => {
  it('adds months within year', () => {
    expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
  });

  it('wraps year boundary', () => {
    expect(addMonths('2025-11-15', 3)).toBe('2026-02-15');
  });

  it('clamps day to month length (Jan 31 + 1 month)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps to leap February (Jan 31 2024 + 1 month)', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('subtracts months', () => {
    expect(addMonths('2026-03-15', -2)).toBe('2026-01-15');
  });
});

// ── addYears ──────────────────────────────────────────────────────────────────

describe('addYears', () => {
  it('adds years', () => {
    expect(addYears('2024-06-15', 2)).toBe('2026-06-15');
  });

  it('clamps Feb 29 on non-leap year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('keeps Feb 29 on leap year', () => {
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });
});

// ── startOfWeek / endOfWeek ───────────────────────────────────────────────────

describe('startOfWeek', () => {
  it('Sunday → same day', () => {
    // 2026-06-07 is a Sunday — use local-time constructor to verify day-of-week
    // (ISO string constructor interprets as UTC midnight, which differs in -offset zones)
    const d = new Date(2026, 5, 7); // June 7 2026 in LOCAL time
    expect(d.getDay()).toBe(0); // verify it IS Sunday
    expect(startOfWeek('2026-06-07')).toBe('2026-06-07');
  });

  it('Wednesday → preceding Sunday', () => {
    expect(startOfWeek('2026-06-10')).toBe('2026-06-07');
  });

  it('Saturday → preceding Sunday', () => {
    expect(startOfWeek('2026-06-13')).toBe('2026-06-07');
  });
});

describe('endOfWeek', () => {
  it('Sunday → Saturday of that week', () => {
    expect(endOfWeek('2026-06-07')).toBe('2026-06-13');
  });

  it('Wednesday → Saturday of that week', () => {
    expect(endOfWeek('2026-06-10')).toBe('2026-06-13');
  });

  it('Saturday → same day', () => {
    expect(endOfWeek('2026-06-13')).toBe('2026-06-13');
  });
});

// ── clampToBounds ─────────────────────────────────────────────────────────────

describe('clampToBounds', () => {
  it('returns iso when within bounds', () => {
    expect(clampToBounds('2026-06-15', '2026-06-01', '2026-06-30')).toBe('2026-06-15');
  });

  it('clamps to min when below', () => {
    expect(clampToBounds('2026-05-31', '2026-06-01', '2026-06-30')).toBe('2026-06-01');
  });

  it('clamps to max when above', () => {
    expect(clampToBounds('2026-07-01', '2026-06-01', '2026-06-30')).toBe('2026-06-30');
  });

  it('works with open min bound', () => {
    expect(clampToBounds('2026-05-01', undefined, '2026-06-30')).toBe('2026-05-01');
  });

  it('works with open max bound', () => {
    expect(clampToBounds('2026-12-31', '2026-06-01', undefined)).toBe('2026-12-31');
  });
});

// ── parseIso / toIso ──────────────────────────────────────────────────────────

describe('parseIso / toIso roundtrip', () => {
  it('roundtrip preserves date', () => {
    const original = '2026-06-30';
    const { year, month, day } = parseIso(original);
    expect(toIso(year, month, day)).toBe(original);
  });

  it('zero-pads single-digit month and day', () => {
    expect(toIso(2026, 1, 5)).toBe('2026-01-05');
  });
});

// ── composeDueString (P8) ─────────────────────────────────────────────────────

describe('composeDueString', () => {
  it('returns YYYY-MM-DD when no time given', () => {
    expect(composeDueString('2026-06-30', '')).toBe('2026-06-30');
  });

  it('returns YYYY-MM-DD when time is whitespace only', () => {
    expect(composeDueString('2026-06-30', '  ')).toBe('2026-06-30');
  });

  it('returns RFC-3339 string when time is given', () => {
    const result = composeDueString('2026-06-30', '09:00');
    // Must match RFC-3339 datetime pattern
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    // Must contain the date and time portions
    expect(result).toContain('2026-06-30');
    expect(result).toContain('09:00:00');
  });

  it('RFC-3339 result contains a timezone offset (not Z)', () => {
    const result = composeDueString('2026-06-30', '14:30');
    // Should have ±HH:MM offset
    expect(result).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('RFC-3339 result parses to a valid Date', () => {
    const result = composeDueString('2026-06-30', '10:00');
    const d = new Date(result);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('composed RFC-3339 has the correct local date', () => {
    const result = composeDueString('2026-06-30', '12:00');
    const d = new Date(result);
    // Local date (not UTC) should be 2026-06-30
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth() + 1).toBe(6);
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('decomposeDueString', () => {
  it('hydrates a date-only due without inventing a time', () => {
    expect(decomposeDueString('2026-06-30')).toEqual({ date: '2026-06-30', time: '' });
  });

  it('hydrates RFC-3339 wall-clock fields without applying its offset', () => {
    expect(decomposeDueString('2026-06-30T23:45:00-10:00')).toEqual({
      date: '2026-06-30',
      time: '23:45',
    });
  });

  it('returns an empty draft for absent or malformed values', () => {
    expect(decomposeDueString(null)).toEqual({ date: '', time: '' });
    expect(decomposeDueString('tomorrow')).toEqual({ date: '', time: '' });
  });

  it('roundtrips an existing timed due through the editor fields', () => {
    const draft = decomposeDueString('2026-06-30T09:15:00+05:30');
    const recomposed = composeDueString(draft.date, draft.time);
    expect(recomposed).toContain('2026-06-30T09:15:00');
  });
});

// ── isTaskOverdue (VG-P8) ─────────────────────────────────────────────────────

describe('isTaskOverdue', () => {
  const NOW = '2026-06-30T10:00:00.000Z';

  it('null due → false', () => {
    expect(isTaskOverdue(null, NOW)).toBe(false);
  });

  it('past date → true', () => {
    expect(isTaskOverdue('2026-06-01', NOW)).toBe(true);
  });

  it('yesterday → true', () => {
    // NOW is 2026-06-30; yesterday is 2026-06-29
    expect(isTaskOverdue('2026-06-29', NOW)).toBe(true);
  });

  it('today date → false (due date = today is NOT overdue)', () => {
    // 2026-06-30 < "2026-06-30" is false
    expect(isTaskOverdue('2026-06-30', NOW)).toBe(false);
  });

  it('future date → false', () => {
    // 2026-07-15 > 2026-06-30 → NOT overdue
    expect(isTaskOverdue('2026-07-15', NOW)).toBe(false);
  });

  it('past RFC-3339 datetime → true', () => {
    const pastDue = '2026-06-29T09:00:00+00:00';
    expect(isTaskOverdue(pastDue, NOW)).toBe(true);
  });

  it('future RFC-3339 datetime → false', () => {
    const futureDue = '2026-07-01T09:00:00+00:00';
    expect(isTaskOverdue(futureDue, NOW)).toBe(false);
  });

  it('omitting now → false (no "now" available in pure layer)', () => {
    // When now is undefined, the function returns false (safe default)
    expect(isTaskOverdue('2020-01-01', undefined)).toBe(false);
  });
});
