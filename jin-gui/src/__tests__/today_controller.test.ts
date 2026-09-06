// @vitest-environment jsdom
/**
 * today_controller.test.ts — headless unit tests for the Today/Agenda hero view.
 *
 * Tests two layers:
 *   1. Pure logic from lib/agenda/transform.ts (no DOM, no mocking needed)
 *   2. DOM rendering from lib/agenda/render.ts (jsdom, no Stimulus runtime)
 *
 * The invoke function is NOT called in these tests — rendering is exercised
 * by calling renderTodayView() directly with injected fixture data.
 *
 * Headless gates verified here (spec §7.1 + GUI-S3 AC):
 *   ✓ Agenda grouping: all-day bucket vs timed schedule
 *   ✓ Time sort: timed events in UTC start ascending order
 *   ✓ Promoted event: originating_task rendered with id + title (reachable)
 *   ✓ Prep notes: each note rendered with id + title (reachable)
 *   ✓ Source badge: carries non-color text label (color-independence)
 *   ✓ Recurring flag: shown for recurrence_unexpanded events
 *   ✓ Empty state: renders when both buckets are empty
 *
 * Visual correctness (glass rendering, layout, motion) is owner-verified
 * via `cargo tauri dev` — never claimed by this test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import TodayController from '../controllers/today_controller';
import type { AgendaDto, AgendaEventDto } from '../types/dto';
import {
  groupAgenda,
  sortTimedEvents,
  sourceBadgeLabel,
  sourceBadgeIcon,
  isRecurring,
  projectTimedAgenda,
  prevDay,
  nextDay,
  formatDisplayDate,
  todayIsoDate,
  type GroupedAgenda,
} from '../lib/agenda/transform';
import {
  renderTodayView,
  showLoading,
  hideLoading,
  showEmptyState,
  type TodayViewElements,
  type TodayTemplates,
} from '../lib/agenda/render';

const invokeMocks = vi.hoisted(() => ({ todayAgenda: vi.fn() }));
vi.mock('../invoke', () => ({ todayAgenda: invokeMocks.todayAgenda }));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeAgendaEvent(overrides: Partial<AgendaEventDto> = {}): AgendaEventDto {
  return {
    id: 'evt-001',
    title: 'Test Event',
    start: '2026-06-27T09:00:00Z',
    end: '2026-06-27T10:00:00Z',
    is_all_day: false,
    start_tzid: 'UTC',
    floating: false,
    status: 'confirmed',
    source: 'jin',
    authority: 'jin',
    ical_uid: null,
    derived_from: null,
    recurrence_unexpanded: false,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    display_start: '09:00',
    originating_task: null,
    prep_notes: [],
    ...overrides,
  };
}

function makeAllDayEvent(overrides: Partial<AgendaEventDto> = {}): AgendaEventDto {
  return makeAgendaEvent({
    id: 'evt-allday',
    title: 'All Day Event',
    is_all_day: true,
    display_start: 'all-day',
    start: '2026-06-27T00:00:00Z',
    end: '2026-06-28T00:00:00Z',
    ...overrides,
  });
}

function makeAgendaDto(overrides: Partial<AgendaDto> = {}): AgendaDto {
  return {
    date: '2026-06-27',
    display_tz: 'UTC',
    all_day_events: [],
    timed_events: [],
    ...overrides,
  };
}

// ── jsdom DOM helpers ─────────────────────────────────────────────────────────

/** Build the TodayViewElements object using jsdom elements */
function makeTodayViewElements(): TodayViewElements {
  const allDaySection = document.createElement('section');
  allDaySection.classList.add('hidden');
  const allDayList = document.createElement('ul');
  allDaySection.appendChild(allDayList);

  const timedSection = document.createElement('section');
  timedSection.classList.add('hidden');
  const timedList = document.createElement('ul');
  timedSection.appendChild(timedList);

  const emptyState = document.createElement('div');
  emptyState.classList.add('hidden');

  const loadingState = document.createElement('div');
  loadingState.classList.add('hidden');

  document.body.appendChild(allDaySection);
  document.body.appendChild(timedSection);
  document.body.appendChild(emptyState);
  document.body.appendChild(loadingState);

  return { allDaySection, allDayList, timedSection, timedList, emptyState, loadingState };
}

/** Build minimal TodayTemplates matching the structure in index.html */
function makeTodayTemplates(): TodayTemplates {
  const eventRowTmpl = document.createElement('template');
  eventRowTmpl.innerHTML = `
    <li class="today-event-row">
      <div class="today-event-row__time">
        <span class="today-event-row__display-start" aria-label=""></span>
      </div>
      <div class="today-event-row__body">
        <div class="today-event-row__header">
          <span class="today-event-row__title"></span>
          <span class="today-event-row__overlap hidden" role="status" aria-label="">
            <span>Overlaps schedule</span>
          </span>
          <span class="today-event-row__source-badge" role="img" aria-label="">
            <i class="today-event-row__source-icon" aria-hidden="true"></i>
            <span class="today-event-row__source-label"></span>
          </span>
          <span class="today-event-row__recurring-badge hidden" aria-label="Recurring event (not expanded)">
            <span>Recurring</span>
          </span>
        </div>
        <div class="today-event-row__task hidden">
          <a href="#tasks" class="today-event-row__task-link" data-task-id="" aria-label="">
            <span class="today-event-row__task-title"></span>
            <span class="today-event-row__task-id"></span>
          </a>
        </div>
        <div class="today-event-row__notes hidden">
          <span class="today-event-row__notes-label">Prep notes:</span>
          <ul class="today-event-row__notes-list" role="list" aria-label="Prep notes"></ul>
        </div>
      </div>
    </li>
  `.trim();

  const prepNoteTmpl = document.createElement('template');
  prepNoteTmpl.innerHTML = `
    <li class="today-prep-note">
      <a href="#notes" class="today-prep-note__link" data-note-id="" aria-label="">
        <span class="today-prep-note__title"></span>
        <span class="today-prep-note__id"></span>
      </a>
    </li>
  `.trim();

  return { eventRow: eventRowTmpl, prepNote: prepNoteTmpl };
}

// ── Shared render setup ───────────────────────────────────────────────────────

let el: TodayViewElements;
let templates: TodayTemplates;
const noopNavigate = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '';
  noopNavigate.mockReset();
  el = makeTodayViewElements();
  templates = makeTodayTemplates();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. groupAgenda — separation of all-day vs timed buckets
// ─────────────────────────────────────────────────────────────────────────────

describe('groupAgenda', () => {
  it('separates all_day_events into the allDay bucket', () => {
    const dto = makeAgendaDto({ all_day_events: [makeAllDayEvent()] });
    const grouped = groupAgenda(dto);
    expect(grouped.allDay).toHaveLength(1);
    expect(grouped.allDay[0].is_all_day).toBe(true);
    expect(grouped.timed).toHaveLength(0);
  });

  it('separates timed_events into the timed bucket', () => {
    const dto = makeAgendaDto({ timed_events: [makeAgendaEvent()] });
    const grouped = groupAgenda(dto);
    expect(grouped.timed).toHaveLength(1);
    expect(grouped.allDay).toHaveLength(0);
  });

  it('correctly splits mixed all-day + timed events', () => {
    const dto = makeAgendaDto({
      all_day_events: [makeAllDayEvent()],
      timed_events: [makeAgendaEvent({ id: 'e1' }), makeAgendaEvent({ id: 'e2' })],
    });
    const grouped = groupAgenda(dto);
    expect(grouped.allDay).toHaveLength(1);
    expect(grouped.timed).toHaveLength(2);
  });

  it('isEmpty is true when both buckets are empty', () => {
    const grouped = groupAgenda(makeAgendaDto());
    expect(grouped.isEmpty).toBe(true);
  });

  it('isEmpty is false when allDay has events', () => {
    const grouped = groupAgenda(makeAgendaDto({ all_day_events: [makeAllDayEvent()] }));
    expect(grouped.isEmpty).toBe(false);
  });

  it('isEmpty is false when timed has events', () => {
    const grouped = groupAgenda(makeAgendaDto({ timed_events: [makeAgendaEvent()] }));
    expect(grouped.isEmpty).toBe(false);
  });

  it('carries date and displayTz from the DTO', () => {
    const dto = makeAgendaDto({ date: '2026-06-28', display_tz: 'America/New_York' });
    const grouped = groupAgenda(dto);
    expect(grouped.date).toBe('2026-06-28');
    expect(grouped.displayTz).toBe('America/New_York');
  });

  it('does not mutate the input DTO arrays', () => {
    const events = [makeAgendaEvent()];
    const dto = makeAgendaDto({ timed_events: events });
    const grouped = groupAgenda(dto);
    // Push to the grouped array; original must be unchanged
    grouped.timed.push(makeAgendaEvent({ id: 'injected' }));
    expect(dto.timed_events).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sortTimedEvents — time sort
// ─────────────────────────────────────────────────────────────────────────────

describe('sortTimedEvents', () => {
  it('returns an empty array unchanged', () => {
    expect(sortTimedEvents([])).toEqual([]);
  });

  it('returns a single-item array unchanged', () => {
    const events = [makeAgendaEvent({ start: '2026-06-27T09:00:00Z' })];
    expect(sortTimedEvents(events)).toHaveLength(1);
  });

  it('sorts events by start ascending', () => {
    const e1 = makeAgendaEvent({ id: 'e1', start: '2026-06-27T14:00:00Z' });
    const e2 = makeAgendaEvent({ id: 'e2', start: '2026-06-27T09:00:00Z' });
    const e3 = makeAgendaEvent({ id: 'e3', start: '2026-06-27T11:30:00Z' });
    const sorted = sortTimedEvents([e1, e2, e3]);
    expect(sorted.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('preserves already-sorted order', () => {
    const e1 = makeAgendaEvent({ id: 'e1', start: '2026-06-27T08:00:00Z' });
    const e2 = makeAgendaEvent({ id: 'e2', start: '2026-06-27T12:00:00Z' });
    const sorted = sortTimedEvents([e1, e2]);
    expect(sorted.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('does not mutate the input array', () => {
    const original = [
      makeAgendaEvent({ id: 'e1', start: '2026-06-27T14:00:00Z' }),
      makeAgendaEvent({ id: 'e2', start: '2026-06-27T09:00:00Z' }),
    ];
    const originalIds = original.map((e) => e.id);
    sortTimedEvents(original);
    expect(original.map((e) => e.id)).toEqual(originalIds);
  });

  it('handles events on different dates (multi-day range sort)', () => {
    const e1 = makeAgendaEvent({ id: 'e1', start: '2026-06-28T09:00:00Z' });
    const e2 = makeAgendaEvent({ id: 'e2', start: '2026-06-27T22:00:00Z' });
    const sorted = sortTimedEvents([e1, e2]);
    expect(sorted.map((e) => e.id)).toEqual(['e2', 'e1']);
  });
});

describe('projectTimedAgenda — display ranges and honest overlap groups', () => {
  it('uses the display timezone for anchored event ranges', () => {
    const projection = projectTimedAgenda(
      [makeAgendaEvent({ start: '2026-06-27T14:00:00Z', end: '2026-06-27T15:00:00Z' })],
      'America/New_York',
    );
    expect(projection.get('evt-001')?.timeRange).toContain('10:00');
  });

  it('marks both valid anchored intervals when they overlap', () => {
    const projection = projectTimedAgenda([
      makeAgendaEvent({ id: 'one', start: '2026-06-27T09:00:00Z', end: '2026-06-27T10:30:00Z' }),
      makeAgendaEvent({ id: 'two', start: '2026-06-27T10:00:00Z', end: '2026-06-27T11:00:00Z' }),
    ], 'UTC');
    expect(projection.get('one')?.overlaps).toBe(true);
    expect(projection.get('two')?.overlaps).toBe(true);
  });

  it('uses a max-end sweep so transitive overlap groups are all marked', () => {
    const projection = projectTimedAgenda([
      makeAgendaEvent({ id: 'one', start: '2026-06-27T09:00:00Z', end: '2026-06-27T11:00:00Z' }),
      makeAgendaEvent({ id: 'two', start: '2026-06-27T10:00:00Z', end: '2026-06-27T10:30:00Z' }),
      makeAgendaEvent({ id: 'three', start: '2026-06-27T10:45:00Z', end: '2026-06-27T12:00:00Z' }),
    ], 'UTC');
    expect([...projection.values()].every((row) => row.overlaps)).toBe(true);
  });

  it('does not claim a conflict for touching, all-day, invalid, or mixed-domain values', () => {
    const projection = projectTimedAgenda([
      makeAgendaEvent({ id: 'touch-a', start: '2026-06-27T09:00:00Z', end: '2026-06-27T10:00:00Z' }),
      makeAgendaEvent({ id: 'touch-b', start: '2026-06-27T10:00:00Z', end: '2026-06-27T11:00:00Z' }),
      makeAgendaEvent({ id: 'mixed', floating: true, start: '2026-06-27T09:30:00', end: '2026-06-27T10:30:00' }),
      makeAgendaEvent({ id: 'invalid', start: '2026-06-27T14:00:00Z', end: '2026-06-27T14:00:00Z' }),
      makeAllDayEvent({ id: 'all-day' }),
    ], 'UTC');
    expect([...projection.values()].every((row) => !row.overlaps)).toBe(true);
  });

  it('compares floating entries by their literal wall times', () => {
    const projection = projectTimedAgenda([
      makeAgendaEvent({ id: 'one', floating: true, start: '2026-06-27T09:00:00', end: '2026-06-27T10:30:00' }),
      makeAgendaEvent({ id: 'two', floating: true, start: '2026-06-27T10:00:00', end: '2026-06-27T11:00:00' }),
    ], 'UTC');
    expect(projection.get('one')?.overlaps).toBe(true);
    expect(projection.get('two')?.overlaps).toBe(true);
  });

  it('excludes zone-less anchored values from comparison', () => {
    const projection = projectTimedAgenda([
      makeAgendaEvent({ id: 'one', start: '2026-06-27T09:00:00', end: '2026-06-27T10:30:00' }),
      makeAgendaEvent({ id: 'two', start: '2026-06-27T10:00:00', end: '2026-06-27T11:00:00' }),
    ], 'UTC');
    expect(projection.get('one')?.overlaps).toBe(false);
    expect(projection.get('two')?.overlaps).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. sourceBadgeLabel — non-color text label (color-independence gate)
// ─────────────────────────────────────────────────────────────────────────────

describe('sourceBadgeLabel', () => {
  it('returns "Jin" for source "jin"', () => {
    expect(sourceBadgeLabel('jin')).toBe('Jin');
  });

  it('returns "Jin" for source "JIN" (case-insensitive)', () => {
    expect(sourceBadgeLabel('JIN')).toBe('Jin');
  });

  it('returns "Google" for source "google"', () => {
    expect(sourceBadgeLabel('google')).toBe('Google');
  });

  it('returns "Google" for source "Google" (mixed case)', () => {
    expect(sourceBadgeLabel('Google')).toBe('Google');
  });

  it('capitalizes unknown sources', () => {
    expect(sourceBadgeLabel('caldav')).toBe('Caldav');
  });

  it('never returns an empty string (color-independence: always has text)', () => {
    expect(sourceBadgeLabel('')).toBe('Unknown');
    expect(sourceBadgeLabel('   ')).not.toBe('');
  });
});

describe('sourceBadgeIcon', () => {
  it('returns "database" for jin', () => {
    expect(sourceBadgeIcon('jin')).toBe('database');
  });

  it('returns "cloud" for google', () => {
    expect(sourceBadgeIcon('google')).toBe('cloud');
  });

  it('returns "circle" for unknown source', () => {
    expect(sourceBadgeIcon('unknown')).toBe('circle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isRecurring
// ─────────────────────────────────────────────────────────────────────────────

describe('isRecurring', () => {
  it('returns true when recurrence_unexpanded is true', () => {
    expect(isRecurring(makeAgendaEvent({ recurrence_unexpanded: true }))).toBe(true);
  });

  it('returns false when recurrence_unexpanded is false', () => {
    expect(isRecurring(makeAgendaEvent({ recurrence_unexpanded: false }))).toBe(false);
  });

  it('returns false for a normal event', () => {
    expect(isRecurring(makeAgendaEvent())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. prevDay / nextDay
// ─────────────────────────────────────────────────────────────────────────────

describe('prevDay', () => {
  it('returns the previous calendar day', () => {
    expect(prevDay('2026-06-27')).toBe('2026-06-26');
  });

  it('correctly wraps across month boundary', () => {
    expect(prevDay('2026-07-01')).toBe('2026-06-30');
  });

  it('correctly wraps across year boundary', () => {
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
  });

  it('output is in YYYY-MM-DD format', () => {
    const result = prevDay('2026-06-10');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe('2026-06-09');
  });
});

describe('nextDay', () => {
  it('returns the next calendar day', () => {
    expect(nextDay('2026-06-27')).toBe('2026-06-28');
  });

  it('correctly wraps across month boundary', () => {
    expect(nextDay('2026-06-30')).toBe('2026-07-01');
  });

  it('correctly wraps across year boundary', () => {
    expect(nextDay('2025-12-31')).toBe('2026-01-01');
  });

  it('output is in YYYY-MM-DD format', () => {
    const result = nextDay('2026-06-27');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe('2026-06-28');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. formatDisplayDate
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDisplayDate', () => {
  it('returns "Today" when the date matches referenceToday', () => {
    expect(formatDisplayDate('2026-06-27', '2026-06-27')).toBe('Today');
  });

  it('returns a locale string for a different date', () => {
    const result = formatDisplayDate('2026-06-26', '2026-06-27');
    // Should be a non-empty string that is NOT "Today"
    expect(result).not.toBe('Today');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns "Today" using the live clock when referenceToday is omitted', () => {
    const live = todayIsoDate();
    expect(formatDisplayDate(live)).toBe('Today');
  });

  it('returns a non-empty string for yesterday', () => {
    const result = formatDisplayDate('2026-06-26', '2026-06-27');
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. showLoading / hideLoading / showEmptyState lifecycle helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('showLoading', () => {
  it('removes "hidden" from loadingState', () => {
    showLoading(el);
    expect(el.loadingState.classList.contains('hidden')).toBe(false);
  });

  it('adds "hidden" to allDaySection and timedSection', () => {
    el.allDaySection.classList.remove('hidden');
    el.timedSection.classList.remove('hidden');
    showLoading(el);
    expect(el.allDaySection.classList.contains('hidden')).toBe(true);
    expect(el.timedSection.classList.contains('hidden')).toBe(true);
  });

  it('adds "hidden" to emptyState', () => {
    el.emptyState.classList.remove('hidden');
    showLoading(el);
    expect(el.emptyState.classList.contains('hidden')).toBe(true);
  });
});

describe('hideLoading', () => {
  it('adds "hidden" to loadingState', () => {
    el.loadingState.classList.remove('hidden');
    hideLoading(el);
    expect(el.loadingState.classList.contains('hidden')).toBe(true);
  });
});

describe('showEmptyState', () => {
  it('removes "hidden" from emptyState', () => {
    showEmptyState(el);
    expect(el.emptyState.classList.contains('hidden')).toBe(false);
  });

  it('adds "hidden" to allDaySection and timedSection', () => {
    el.allDaySection.classList.remove('hidden');
    el.timedSection.classList.remove('hidden');
    showEmptyState(el);
    expect(el.allDaySection.classList.contains('hidden')).toBe(true);
    expect(el.timedSection.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. renderTodayView — DOM rendering gate (the critical hero-flow assertions)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTodayView — empty state', () => {
  it('shows the empty state when both buckets are empty', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [],
      isEmpty: true,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    expect(el.emptyState.classList.contains('hidden')).toBe(false);
  });

  it('hides allDaySection and timedSection when empty', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [],
      isEmpty: true,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    expect(el.allDaySection.classList.contains('hidden')).toBe(true);
    expect(el.timedSection.classList.contains('hidden')).toBe(true);
  });
});

describe('renderTodayView — all-day events', () => {
  it('renders all-day events into the allDayList', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [makeAllDayEvent({ id: 'ad-1', title: 'All Day Meeting' })],
      timed: [],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    expect(el.allDayList.querySelectorAll('.today-event-row')).toHaveLength(1);
  });

  it('shows allDaySection and hides emptyState when all-day events present', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [makeAllDayEvent()],
      timed: [],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    expect(el.allDaySection.classList.contains('hidden')).toBe(false);
    expect(el.emptyState.classList.contains('hidden')).toBe(true);
  });

  it('renders the event title in the row', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [makeAllDayEvent({ title: 'Company All Hands' })],
      timed: [],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const titleEl = el.allDayList.querySelector('.today-event-row__title');
    expect(titleEl?.textContent).toBe('Company All Hands');
  });
});

describe('renderTodayView — timed events', () => {
  it('renders timed events into the timedList', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [
        makeAgendaEvent({ id: 'e1', title: 'Standup' }),
        makeAgendaEvent({ id: 'e2', title: 'Retrospective' }),
      ],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    expect(el.timedList.querySelectorAll('.today-event-row')).toHaveLength(2);
  });

  it('renders display_start in the time column', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ display_start: '09:00' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const timeEl = el.timedList.querySelector('.today-event-row__display-start');
    expect(timeEl?.textContent).toBe('09:00');
  });

  it('sets data-event-id on the row', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ id: 'evt-xyz' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const row = el.timedList.querySelector('.today-event-row') as HTMLElement;
    expect(row.dataset.eventId).toBe('evt-xyz');
  });

  it('renders a visible and accessible overlap cue from the projection', () => {
    const event = makeAgendaEvent({ id: 'overlap-event' });
    const grouped: GroupedAgenda = {
      date: '2026-06-27', displayTz: 'UTC', allDay: [], timed: [event], isEmpty: false,
      presentationById: new Map([['overlap-event', { timeRange: '09:00 – 10:00', overlaps: true }]]),
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const row = el.timedList.querySelector('.today-event-row') as HTMLElement;
    const cue = row.querySelector('.today-event-row__overlap') as HTMLElement;
    expect(row.classList.contains('today-event-row--overlap')).toBe(true);
    expect(cue.classList.contains('hidden')).toBe(false);
    expect(cue.getAttribute('aria-label')).toBe('Overlaps another scheduled event');
    expect(row.querySelector('.today-event-row__display-start')?.textContent).toBe('09:00 – 10:00');
  });
});

describe('renderTodayView — source badge (color-independence gate)', () => {
  it('renders a non-empty text label on the source badge for "jin"', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ source: 'jin' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const labelEl = el.timedList.querySelector('.today-event-row__source-label');
    expect(labelEl?.textContent?.trim()).toBe('Jin');
  });

  it('renders a non-empty text label on the source badge for "google"', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ source: 'google' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const labelEl = el.timedList.querySelector('.today-event-row__source-label');
    expect(labelEl?.textContent?.trim()).toBe('Google');
  });

  it('sets aria-label on the source badge (not color-only: has accessible label)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ source: 'jin' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const badgeEl = el.timedList.querySelector('.today-event-row__source-badge');
    expect(badgeEl?.getAttribute('aria-label')).toBe('Source: Jin');
  });

  it('sets data-source on the badge element for supplementary CSS', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ source: 'google' })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const badgeEl = el.timedList.querySelector('.today-event-row__source-badge') as HTMLElement;
    expect(badgeEl?.dataset.source).toBe('google');
  });
});

describe('renderTodayView — recurring flag', () => {
  it('hides the recurring badge for non-recurring events', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ recurrence_unexpanded: false })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const recurEl = el.timedList.querySelector('.today-event-row__recurring-badge');
    expect(recurEl?.classList.contains('hidden')).toBe(true);
  });

  it('shows the recurring badge for recurrence_unexpanded events', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ recurrence_unexpanded: true })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const recurEl = el.timedList.querySelector('.today-event-row__recurring-badge');
    expect(recurEl?.classList.contains('hidden')).toBe(false);
  });

  it('recurring badge has an accessible label', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ recurrence_unexpanded: true })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const recurEl = el.timedList.querySelector('.today-event-row__recurring-badge');
    expect(recurEl?.getAttribute('aria-label')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. originating_task — THE hero-flow assertion (GUI-S3 AC)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTodayView — originating_task (hero-flow reachability)', () => {
  const TASK_ID = 'task-abc-123';
  const TASK_TITLE = 'Prepare Q3 Review';

  function makePromotedEvent(): AgendaEventDto {
    return makeAgendaEvent({
      id: 'evt-promoted',
      originating_task: { id: TASK_ID, title: TASK_TITLE },
    });
  }

  it('hides the task block when originating_task is null', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ originating_task: null })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskEl = el.timedList.querySelector('.today-event-row__task');
    expect(taskEl?.classList.contains('hidden')).toBe(true);
  });

  it('shows the task block when originating_task is present', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskEl = el.timedList.querySelector('.today-event-row__task');
    expect(taskEl?.classList.contains('hidden')).toBe(false);
  });

  it('renders the originating task TITLE in the DOM (title reachable)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskTitleEl = el.timedList.querySelector('.today-event-row__task-title');
    expect(taskTitleEl?.textContent).toBe(TASK_TITLE);
  });

  it('renders the originating task ID in the DOM (id reachable)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskIdEl = el.timedList.querySelector('.today-event-row__task-id');
    expect(taskIdEl?.textContent).toBe(TASK_ID);
  });

  it('sets data-task-id on the task link (machine-readable id)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskLinkEl = el.timedList.querySelector('.today-event-row__task-link') as HTMLElement;
    expect(taskLinkEl?.dataset.taskId).toBe(TASK_ID);
  });

  it('task link has aria-label that includes the task title', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const taskLinkEl = el.timedList.querySelector('.today-event-row__task-link');
    const ariaLabel = taskLinkEl?.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain(TASK_TITLE);
  });

  it('clicking the task link fires onNavigate with section="tasks" and the task id', () => {
    const navigate = vi.fn();
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makePromotedEvent()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, navigate);
    const taskLinkEl = el.timedList.querySelector('.today-event-row__task-link') as HTMLAnchorElement;
    taskLinkEl.click();
    expect(navigate).toHaveBeenCalledWith('tasks', TASK_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. prep_notes — THE hero-flow assertion (GUI-S3 AC)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTodayView — prep_notes (hero-flow reachability)', () => {
  const NOTE1_ID = 'note-aaa-111';
  const NOTE1_TITLE = 'Q3 Review Brief';
  const NOTE2_ID = 'note-bbb-222';
  const NOTE2_TITLE = 'Stakeholder List';

  function makeEventWithNotes(): AgendaEventDto {
    return makeAgendaEvent({
      id: 'evt-with-notes',
      prep_notes: [
        { id: NOTE1_ID, title: NOTE1_TITLE },
        { id: NOTE2_ID, title: NOTE2_TITLE },
      ],
    });
  }

  it('keeps long relationship titles and their exact task/note routes intact', () => {
    const longTask = 'Prepare a detailed cross-functional review with every decision and open question';
    const longNote = 'Stakeholder context and the complete preparation checklist for the planning conversation';
    const event = makeAgendaEvent({
      originating_task: { id: 'task-long', title: longTask },
      prep_notes: [{ id: 'note-long', title: longNote }],
    });
    const grouped: GroupedAgenda = {
      date: '2026-06-27', displayTz: 'UTC', allDay: [], timed: [event], isEmpty: false,
    };
    const navigate = vi.fn();
    renderTodayView(el, templates, grouped, navigate);
    expect(el.timedList.querySelector('.today-event-row__task-title')?.textContent).toBe(longTask);
    expect(el.timedList.querySelector('.today-prep-note__title')?.textContent).toBe(longNote);
    (el.timedList.querySelector('.today-event-row__task-link') as HTMLAnchorElement).click();
    (el.timedList.querySelector('.today-prep-note__link') as HTMLAnchorElement).click();
    expect(navigate).toHaveBeenNthCalledWith(1, 'tasks', 'task-long');
    expect(navigate).toHaveBeenNthCalledWith(2, 'notes', 'note-long');
  });

  it('hides the notes block when prep_notes is empty', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ prep_notes: [] })],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const notesEl = el.timedList.querySelector('.today-event-row__notes');
    expect(notesEl?.classList.contains('hidden')).toBe(true);
  });

  it('shows the notes block when prep_notes is non-empty', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const notesEl = el.timedList.querySelector('.today-event-row__notes');
    expect(notesEl?.classList.contains('hidden')).toBe(false);
  });

  it('renders the correct number of prep-note items', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const noteItems = el.timedList.querySelectorAll('.today-prep-note');
    expect(noteItems).toHaveLength(2);
  });

  it('renders note TITLES in the DOM (titles reachable)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const noteTitles = Array.from(
      el.timedList.querySelectorAll('.today-prep-note__title')
    ).map((el) => el.textContent);
    expect(noteTitles).toContain(NOTE1_TITLE);
    expect(noteTitles).toContain(NOTE2_TITLE);
  });

  it('renders note IDs in the DOM (ids reachable)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const noteIds = Array.from(
      el.timedList.querySelectorAll('.today-prep-note__id')
    ).map((el) => el.textContent);
    expect(noteIds).toContain(NOTE1_ID);
    expect(noteIds).toContain(NOTE2_ID);
  });

  it('sets data-note-id on each note link (machine-readable id)', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const noteLinks = Array.from(
      el.timedList.querySelectorAll('.today-prep-note__link')
    ) as HTMLElement[];
    const noteIdData = noteLinks.map((a) => a.dataset.noteId);
    expect(noteIdData).toContain(NOTE1_ID);
    expect(noteIdData).toContain(NOTE2_ID);
  });

  it('note links have aria-labels that include note titles', () => {
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeEventWithNotes()],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, noopNavigate);
    const noteLinks = el.timedList.querySelectorAll('.today-prep-note__link');
    noteLinks.forEach((link) => {
      expect(link.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('clicking a note link fires onNavigate with section="notes" and the note id', () => {
    const navigate = vi.fn();
    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [
        makeAgendaEvent({
          prep_notes: [{ id: NOTE1_ID, title: NOTE1_TITLE }],
        }),
      ],
      isEmpty: false,
    };
    renderTodayView(el, templates, grouped, navigate);
    const noteLink = el.timedList.querySelector('.today-prep-note__link') as HTMLAnchorElement;
    noteLink.click();
    expect(navigate).toHaveBeenCalledWith('notes', NOTE1_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Combined: promoted event WITH originating_task AND prep_notes
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTodayView — combined: promoted event with task + notes', () => {
  it('renders both the originating task AND prep notes for the same event', () => {
    const TASK_ID = 'task-combined';
    const NOTE_ID = 'note-combined';

    const event = makeAgendaEvent({
      originating_task: { id: TASK_ID, title: 'Combined Task' },
      prep_notes: [{ id: NOTE_ID, title: 'Combined Note' }],
    });

    const grouped: GroupedAgenda = {
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [event],
      isEmpty: false,
    };

    renderTodayView(el, templates, grouped, noopNavigate);

    // Task block visible + ids present
    const taskEl = el.timedList.querySelector('.today-event-row__task');
    expect(taskEl?.classList.contains('hidden')).toBe(false);
    const taskIdEl = el.timedList.querySelector('.today-event-row__task-id');
    expect(taskIdEl?.textContent).toBe(TASK_ID);

    // Notes block visible + ids present
    const notesEl = el.timedList.querySelector('.today-event-row__notes');
    expect(notesEl?.classList.contains('hidden')).toBe(false);
    const noteIdEl = el.timedList.querySelector('.today-prep-note__id');
    expect(noteIdEl?.textContent).toBe(NOTE_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. renderTodayView — clears stale rows on re-render
// ─────────────────────────────────────────────────────────────────────────────

describe('renderTodayView — re-render / stale-row clearing', () => {
  it('replaces previous rows when called a second time', () => {
    const makeGrouped = (title: string): GroupedAgenda => ({
      date: '2026-06-27',
      displayTz: 'UTC',
      allDay: [],
      timed: [makeAgendaEvent({ id: 'e1', title })],
      isEmpty: false,
    });

    renderTodayView(el, templates, makeGrouped('First Render'), noopNavigate);
    renderTodayView(el, templates, makeGrouped('Second Render'), noopNavigate);

    const rows = el.timedList.querySelectorAll('.today-event-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.today-event-row__title')?.textContent).toBe('Second Render');
  });
});

describe('TodayController — mutation refresh wiring', () => {
  let app: Application;

  beforeEach(async () => {
    const controllerTemplates = makeTodayTemplates();
    controllerTemplates.eventRow.id = 'tmpl-event-row';
    controllerTemplates.prepNote.id = 'tmpl-prep-note';
    document.body.append(controllerTemplates.eventRow, controllerTemplates.prepNote);
    document.body.insertAdjacentHTML('beforeend', `
      <section
        data-controller="today"
        data-action="jin:refresh-today@window->today#refreshAgenda"
        data-today-date-value="2026-06-27"
      >
        <input data-today-target="dateInput" type="date">
        <output data-today-target="dateLabel"></output>
        <section data-today-target="allDaySection"><ul data-today-target="allDayList"></ul></section>
        <section data-today-target="timedSection"><ul data-today-target="timedList"></ul></section>
        <div data-today-target="emptyState"></div>
        <div data-today-target="loadingState"></div>
      </section>
    `);
    invokeMocks.todayAgenda.mockReset().mockResolvedValue(makeAgendaDto());
    app = Application.start();
    app.register('today', TodayController);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  afterEach(() => app.stop());

  it('reloads the current date once when the real window mutation event fires', async () => {
    expect(invokeMocks.todayAgenda).toHaveBeenCalledTimes(1);
    invokeMocks.todayAgenda.mockClear();

    window.dispatchEvent(new CustomEvent('jin:refresh-today'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(invokeMocks.todayAgenda).toHaveBeenCalledTimes(1);
    expect(invokeMocks.todayAgenda).toHaveBeenCalledWith('2026-06-27');
    expect(invokeMocks.todayAgenda.mock.calls[0][0]).not.toBeInstanceOf(Event);
  });
});
