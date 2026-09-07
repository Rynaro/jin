import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EventDto } from '../types/dto';
import {
  buildTimeGrid,
  deriveNightExpansion,
  formatStoredStartTime,
  initialScrollMinute,
  MIN_EVENT_VISUAL_MINUTES,
  nighttimeContent,
  parseStoredWallTime,
  projectedMinute,
  projectedTotalMinutes,
  projectSegment,
} from '../lib/calendar/time_grid';

function event(id: string, start: string, end: string, overrides: Partial<EventDto> = {}): EventDto {
  return {
    id, title: id, description: null, location: null, start, end, is_all_day: false,
    start_tzid: null, end_tzid: null, floating: true, status: 'confirmed', source: 'jin',
    authority: 'jin', ical_uid: `${id}@jin`, derived_from: null, recurrence: [],
    recurring_event_id: null, original_start: null, master_id: null,
    recurrence_unexpanded: false, sequence: 0, created: '', updated: '', backlinks: [],
    ...overrides,
  };
}

describe('shared calendar wall-time geometry', () => {
  it('projects identical Day and Week semantic geometry', () => {
    const item = event('overnight', '2026-08-20T23:30:00', '2026-08-22T01:15:00');
    const day = buildTimeGrid([item], ['2026-08-21']).timedByDate.get('2026-08-21')![0];
    const week = buildTimeGrid([item], [
      '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19',
      '2026-08-20', '2026-08-21', '2026-08-22',
    ]).timedByDate.get('2026-08-21')![0];
    expect(day).toMatchObject({
      semanticStartMinute: week.semanticStartMinute,
      semanticEndMinute: week.semanticEndMinute,
      continuesBefore: week.continuesBefore,
      continuesAfter: week.continuesAfter,
    });
  });

  it('clips multi-day timed intervals half-open with continuation flags and omits midnight end', () => {
    const model = buildTimeGrid([
      event('long', '2026-08-20T23:30:00', '2026-08-22T01:15:00'),
      event('midnight', '2026-08-20T22:00:00', '2026-08-21T00:00:00'),
    ], ['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(model.timedByDate.get('2026-08-20')?.find(item => item.event.id === 'long')).toMatchObject({
      semanticStartMinute: 1410, semanticEndMinute: 1440, continuesBefore: false, continuesAfter: true,
    });
    expect(model.timedByDate.get('2026-08-21')?.find(item => item.event.id === 'long')).toMatchObject({
      semanticStartMinute: 0, semanticEndMinute: 1440, continuesBefore: true, continuesAfter: true,
    });
    expect(model.timedByDate.get('2026-08-22')?.find(item => item.event.id === 'long')).toMatchObject({
      semanticStartMinute: 0, semanticEndMinute: 75, continuesBefore: true, continuesAfter: false,
    });
    expect(model.timedByDate.get('2026-08-21')?.some(item => item.event.id === 'midnight')).toBe(false);
  });

  it('assigns lowest-free deterministic overlap columns independent of input order', () => {
    const input = [
      event('a', '2026-08-20T09:00:00', '2026-08-20T10:00:00'),
      event('b', '2026-08-20T09:30:00', '2026-08-20T10:30:00'),
      event('c', '2026-08-20T10:00:00', '2026-08-20T11:00:00'),
      event('d', '2026-08-20T12:00:00', '2026-08-20T12:30:00'),
    ];
    const shape = (events: EventDto[]) => buildTimeGrid(events, ['2026-08-20'])
      .timedByDate.get('2026-08-20')!.map(item => [item.event.id, item.overlapColumn, item.overlapColumnCount]);
    expect(shape(input)).toEqual([
      ['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1],
    ]);
    expect(shape([input[2], input[0], input[3], input[1]])).toEqual(shape(input));
  });

  it('keeps short semantic duration and overlap truth while supplying a visual minimum', () => {
    const model = buildTimeGrid([
      event('short', '2026-08-20T09:00:00', '2026-08-20T09:05:00'),
      event('touch', '2026-08-20T09:05:00', '2026-08-20T09:10:00'),
    ], ['2026-08-20']);
    const [short, touch] = model.timedByDate.get('2026-08-20')!;
    expect(short.semanticEndMinute - short.semanticStartMinute).toBe(5);
    expect(short.visualEndMinute - short.visualStartMinute).toBe(MIN_EVENT_VISUAL_MINUTES);
    expect([short.overlapColumnCount, touch.overlapColumnCount]).toEqual([1, 1]);
  });

  it('packs clipped all-day spans into deterministic reusable lanes', () => {
    const model = buildTimeGrid([
      event('wide', '2026-08-18', '2026-08-23', { is_all_day: true }),
      event('inner', '2026-08-20', '2026-08-22', { is_all_day: true }),
      event('touch', '2026-08-23', '2026-08-25', { is_all_day: true }),
    ], ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']);
    expect(model.allDaySpans.map(span => ({
      id: span.event.id, start: span.startDateIndex, end: span.endDateIndexExclusive,
      lane: span.lane, count: span.laneCount, before: span.continuesBefore, after: span.continuesAfter,
    }))).toEqual([
      { id: 'wide', start: 0, end: 3, lane: 0, count: 2, before: true, after: false },
      { id: 'inner', start: 0, end: 2, lane: 1, count: 2, before: false, after: false },
      { id: 'touch', start: 3, end: 4, lane: 0, count: 2, before: false, after: true },
    ]);
  });

  it('fails closed for malformed dates, invalid clocks, zero and backwards intervals', () => {
    const model = buildTimeGrid([
      event('bad-date', '2026-02-30T09:00:00', '2026-02-30T10:00:00'),
      event('bad-time', '2026-08-20T29:00:00', '2026-08-20T30:00:00'),
      event('zero', '2026-08-20T10:00:00', '2026-08-20T10:00:00'),
      event('back', '2026-08-20T11:00:00', '2026-08-20T10:00:00'),
      event('bad-all-day', '2026-08-20', '2026-08-20', { is_all_day: true }),
    ], ['nope', '2026-02-30', '2026-08-20']);
    expect(model.dates).toEqual(['2026-08-20']);
    expect(model.timedByDate.get('2026-08-20')).toEqual([]);
    expect(model.allDaySpans).toEqual([]);
  });

  it.each([
    ['floating', '2026-03-08T01:30:00', { floating: true }],
    ['tzid', '2026-11-01T01:30:00', { floating: false, start_tzid: 'America/New_York' }],
    ['offset west', '2026-08-20T09:05:00-07:00', { floating: false }],
    ['offset east', '2026-08-20T23:45:00+14:00', { floating: false }],
  ])('preserves stored wall clock for %s', (_name, start, overrides) => {
    const item = event('wall', start, start.replace(/(\d{2}):(\d{2})/, (_all, hour, minute) => `${hour}:${String(Number(minute) + 5).padStart(2, '0')}`), overrides);
    expect(formatStoredStartTime(item)).toBe(start.slice(11, 16));
    expect(parseStoredWallTime(start)?.minute).toBe(Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)));
  });

  it('derives independent shared nighttime content and compression projection', () => {
    const model = buildTimeGrid([
      event('early-a', '2026-08-20T02:00:00', '2026-08-20T03:00:00'),
      event('early-a', '2026-08-21T04:00:00', '2026-08-21T05:00:00'),
      event('late', '2026-08-21T22:30:00', '2026-08-21T23:30:00'),
    ], ['2026-08-20', '2026-08-21']);
    expect(nighttimeContent(model, 'early')).toMatchObject({ eventCount: 1, firstMinute: 120, lastMinute: 300, occupied: true });
    expect(deriveNightExpansion(model)).toEqual({ early: true, late: true });
    expect(deriveNightExpansion(buildTimeGrid([], ['2026-08-20']), '2026-08-20', 120))
      .toEqual({ early: true, late: false });
    expect(projectedTotalMinutes({ early: false, late: false })).toBeLessThan(24 * 60);
    expect(projectedMinute(12 * 60, { early: false, late: false }))
      .toBe(projectedMinute(12 * 60, { early: true, late: false }) - (6 * 60 - 54));
  });

  it('keeps compact nighttime events visually present and computes deterministic initial scroll', () => {
    const model = buildTimeGrid([
      event('night-short', '2026-08-20T23:55:00', '2026-08-20T23:59:00'),
      event('morning', '2026-08-20T09:15:00', '2026-08-20T10:00:00'),
    ], ['2026-08-20']);
    const segment = model.timedByDate.get('2026-08-20')!.find(item => item.event.id === 'night-short')!;
    const geometry = projectSegment(segment, { early: false, late: false });
    expect(geometry.end - geometry.start).toBe(MIN_EVENT_VISUAL_MINUTES);
    expect(initialScrollMinute(model)).toBe(8 * 60 + 15);
    expect(initialScrollMinute(buildTimeGrid([], ['2026-08-20']))).toBe(8 * 60);
  });

  it('keeps the expanded nighttime toggle compact and clear of the hour-label rail', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/calendar.css', import.meta.url)), 'utf8');
    const expandedRule = css.match(/\.calendar-timegrid__night-toggle\[aria-expanded='true'\]\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(expandedRule).toContain('inset-inline-end: auto');
    expect(expandedRule).toContain('inline-size: 2.75rem');
    expect(expandedRule).toContain('block-size: 2.75rem');
    expect(expandedRule).not.toContain('--calendar-night-height');
  });

  it('keeps title and time as the primary narrow-card rows and has one gutter background', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/calendar.css', import.meta.url)), 'utf8');
    const eventRule = css.match(/\.calendar-timegrid__event\s*\{([^}]*)\}/s)?.[1] ?? '';
    const identityRule = css.match(/\.calendar-timegrid__identity\s*\{([^}]*)\}/s)?.[1] ?? '';
    const gutterRule = css.match(/\.calendar-timegrid__gutter\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(eventRule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(eventRule).not.toContain('minmax(0, 1fr) auto');
    expect(identityRule).toContain('grid-row: 3');
    expect(identityRule).toContain('overflow: hidden');
    expect(gutterRule.match(/background:/g)).toHaveLength(1);
  });
});
