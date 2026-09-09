// @vitest-environment jsdom
/**
 * events_controller.test.ts — headless unit tests for the Events browse + detail view (GUI-S4).
 *
 * Tests two layers:
 *   1. Pure logic from lib/events/transform.ts (no DOM)
 *   2. DOM rendering from lib/events/render.ts (jsdom, no Stimulus)
 *
 * Headless gates verified here (spec GUI-S4 AC):
 *   ✓ sortEventsList: ascending by start
 *   ✓ sourceBadgeLabel: non-empty text label (color-independence gate)
 *   ✓ sourceBadgeIcon: supplementary icon names
 *   ✓ formatEventTime: all-day → "all-day"; floating → extracted time; timed → range
 *   ✓ formatEventDate: formats correctly with timezone awareness
 *   ✓ renderEventsList: renders title, time, source badge (text not color-only)
 *   ✓ renderEventsList: clicking row fires onNavigate
 *   ✓ renderEventsList: empty state
 *   ✓ renderEventDetail: temporal display (start/end, tz, all-day, floating handled)
 *   ✓ renderEventDetail: source badge is text-labelled (not color-only)
 *   ✓ renderEventDetail: derived_from task is reachable (click → navigate to 'tasks')
 *   ✓ renderEventDetail: prep-for notes from backlinks are reachable (click → navigate to 'notes')
 *   ✓ renderEventDetail: recurring flag shown for recurrence_unexpanded events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';
import EventsController from '../controllers/events_controller';
import CalendarController from '../controllers/calendar_controller';
import type { EventDto, EventBacklinkDto, EventDetailDto } from '../types/dto';
import {
  sortEventsList,
  sourceBadgeLabel,
  sourceBadgeIcon,
  formatEventTime,
  formatEventDate,
} from '../lib/events/transform';
import {
  renderEventsList,
  renderEventDetail,
  type EventsViewElements,
  type EventsTemplates,
} from '../lib/events/render';

const invokeMocks = vi.hoisted(() => ({
  listEvents: vi.fn(),
  getEventDetailById: vi.fn(),
  editEvent: vi.fn(),
  deleteEvent: vi.fn(),
  removeTimeBlock: vi.fn(),
  newOperationId: vi.fn((prefix: string) => `${prefix}-test-operation`),
}));

vi.mock('../invoke', () => invokeMocks);
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

interface FixtureBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function loadEventFixture(): FixtureBridge {
  const source = readFileSync(
    resolve(process.cwd(), 'tools/tauri-fixture-init.js'),
    'utf8',
  );
  const dom = new JSDOM('', { url: 'http://127.0.0.1:1420', runScripts: 'outside-only' });
  dom.window.eval(source);
  return (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
}

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'evt-001',
    title: 'Test Event',
    description: null,
    location: null,
    start: '2026-06-27T09:00:00Z',
    end: '2026-06-27T10:00:00Z',
    is_all_day: false,
    start_tzid: 'UTC',
    end_tzid: 'UTC',
    floating: false,
    status: 'confirmed',
    source: 'jin',
    authority: 'jin',
    ical_uid: null,
    derived_from: null,
    recurrence_unexpanded: false,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-27T00:00:00Z',
    backlinks: [],
    ...overrides,
  };
}

function makeEventBacklink(overrides: Partial<EventBacklinkDto> = {}): EventBacklinkDto {
  return {
    source_id: 'note-prep-001',
    source_kind: 'note',
    edge_type: 'prep-for',
    label: 'Prep Note Title',
    ...overrides,
  };
}

function makeDetail(
  eventOverrides: Partial<EventDto> = {},
  capabilityOverrides: Partial<EventDetailDto['capabilities']> = {},
): EventDetailDto {
  const event = makeEvent(eventOverrides);
  return {
    event,
    edit_token: 'sha256:test-token',
    capabilities: {
      display_kind: event.derived_from ? 'time-block' : 'event',
      can_edit: true,
      can_delete: true,
      read_only_reason: null,
      can_return_task_to_flexible: false,
      originating_task: event.derived_from
        ? { id: event.derived_from, title: 'Plan quarterly review', status: 'todo' }
        : null,
      ...capabilityOverrides,
    },
  };
}

// ── jsdom helpers ─────────────────────────────────────────────────────────────

function makeEventsViewElements(): EventsViewElements {
  const listPanel = document.createElement('div');
  const list = document.createElement('ul');
  listPanel.appendChild(list);
  const emptyState = document.createElement('div');
  emptyState.classList.add('hidden');
  const loadingState = document.createElement('div');
  loadingState.classList.add('hidden');

  const detailPanel = document.createElement('div');
  detailPanel.classList.add('hidden');
  const detailLoadingState = document.createElement('div');
  detailLoadingState.classList.add('hidden');
  const detailNotFoundState = document.createElement('div');
  detailNotFoundState.classList.add('hidden');
  const detailContent = document.createElement('div');

  document.body.appendChild(listPanel);
  document.body.appendChild(emptyState);
  document.body.appendChild(loadingState);
  document.body.appendChild(detailPanel);

  return {
    listPanel,
    list,
    emptyState,
    loadingState,
    detailPanel,
    detailLoadingState,
    detailNotFoundState,
    detailContent,
  };
}

function makeEventsTemplates(): EventsTemplates {
  const eventBrowseRowTmpl = document.createElement('template');
  eventBrowseRowTmpl.innerHTML = `
    <li class="browse-row event-row">
      <button class="browse-row__inner tap-target" aria-label="" data-event-id="">
        <span class="event-browse-row__time text-subheadline" aria-label=""></span>
        <span class="browse-row__title text-headline"></span>
        <span class="event-browse-row__source-badge" role="img" aria-label="">
          <i class="event-browse-row__source-icon" aria-hidden="true"></i>
          <span class="event-browse-row__source-label"></span>
        </span>
      </button>
    </li>
  `.trim();

  const backlinkRowTmpl = document.createElement('template');
  backlinkRowTmpl.innerHTML = `
    <li class="browse-link-row">
      <button class="browse-link-row__btn tap-target" aria-label="" data-link-id="" data-link-kind="">
        <i class="browse-link-row__icon" aria-hidden="true"></i>
        <span class="browse-link-row__label text-callout"></span>
        <span class="browse-link-row__id text-caption2"></span>
      </button>
    </li>
  `.trim();

  return { eventBrowseRow: eventBrowseRowTmpl, backlinkRow: backlinkRowTmpl };
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let el: EventsViewElements;
let templates: EventsTemplates;
const noopNavigate = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '';
  noopNavigate.mockReset();
  el = makeEventsViewElements();
  templates = makeEventsTemplates();
});

async function flushController(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. sortEventsList
// ─────────────────────────────────────────────────────────────────────────────

describe('sortEventsList', () => {
  it('sorts by start ascending', () => {
    const events = [
      makeEvent({ id: 'e1', start: '2026-06-27T14:00:00Z' }),
      makeEvent({ id: 'e2', start: '2026-06-27T09:00:00Z' }),
      makeEvent({ id: 'e3', start: '2026-06-27T11:00:00Z' }),
    ];
    const sorted = sortEventsList(events);
    expect(sorted.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('does not mutate the input array', () => {
    const events = [
      makeEvent({ id: 'e1', start: '2026-06-27T14:00:00Z' }),
      makeEvent({ id: 'e2', start: '2026-06-27T09:00:00Z' }),
    ];
    const originalFirst = events[0].id;
    sortEventsList(events);
    expect(events[0].id).toBe(originalFirst);
  });

  it('returns empty array unchanged', () => {
    expect(sortEventsList([])).toEqual([]);
  });

  it('preserves already-sorted order', () => {
    const events = [
      makeEvent({ id: 'e1', start: '2026-06-27T09:00:00Z' }),
      makeEvent({ id: 'e2', start: '2026-06-27T14:00:00Z' }),
    ];
    const sorted = sortEventsList(events);
    expect(sorted.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sourceBadgeLabel — color-independence gate
// ─────────────────────────────────────────────────────────────────────────────

describe('sourceBadgeLabel', () => {
  it('returns "Jin" for source "jin"', () => {
    expect(sourceBadgeLabel('jin')).toBe('Jin');
  });

  it('returns "Google" for source "google"', () => {
    expect(sourceBadgeLabel('google')).toBe('Google');
  });

  it('capitalizes unknown sources', () => {
    expect(sourceBadgeLabel('caldav')).toBe('Caldav');
  });

  it('never returns empty string (color-independence: always has text)', () => {
    expect(sourceBadgeLabel('')).toBe('Unknown');
  });

  it('is case-insensitive', () => {
    expect(sourceBadgeLabel('JIN')).toBe('Jin');
    expect(sourceBadgeLabel('Google')).toBe('Google');
  });
});

describe('sourceBadgeIcon', () => {
  it('returns "database" for jin', () => {
    expect(sourceBadgeIcon('jin')).toBe('database');
  });

  it('returns "cloud" for google', () => {
    expect(sourceBadgeIcon('google')).toBe('cloud');
  });

  it('returns "circle" for unknown', () => {
    expect(sourceBadgeIcon('unknown')).toBe('circle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. formatEventTime — timezone-aware temporal display
// ─────────────────────────────────────────────────────────────────────────────

describe('formatEventTime', () => {
  it('returns "all-day" for all-day events', () => {
    const result = formatEventTime(
      '2026-06-27T00:00:00Z',
      '2026-06-28T00:00:00Z',
      true,
      false,
      null
    );
    expect(result).toBe('All day');
  });

  it('returns extracted time for floating events (no tz conversion)', () => {
    const result = formatEventTime(
      '2026-06-27T09:00:00',
      '2026-06-27T10:30:00',
      false,
      true,
      null
    );
    expect(result).toBe('09:00 – 10:30');
  });

  it('returns a time range string for timed events', () => {
    const result = formatEventTime(
      '2026-06-27T09:00:00Z',
      '2026-06-27T10:00:00Z',
      false,
      false,
      'UTC'
    );
    expect(result).toContain('–');
    expect(result.length).toBeGreaterThan(0);
  });

  it('all-day takes priority over floating flag', () => {
    const result = formatEventTime(
      '2026-06-27T00:00:00Z',
      '2026-06-28T00:00:00Z',
      true,
      true,
      null
    );
    expect(result).toBe('All day');
  });

  it('handles null tzid gracefully (no exception)', () => {
    expect(() =>
      formatEventTime('2026-06-27T09:00:00Z', '2026-06-27T10:00:00Z', false, false, null)
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. formatEventDate
// ─────────────────────────────────────────────────────────────────────────────

describe('formatEventDate', () => {
  it('returns a non-empty string for a valid date', () => {
    const result = formatEventDate('2026-06-27T09:00:00Z', false, 'UTC');
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles all-day events (uses UTC to avoid off-by-one)', () => {
    const result = formatEventDate('2026-06-27T00:00:00Z', true, null);
    expect(result).toBeTruthy();
  });

  it('handles null tzid gracefully', () => {
    expect(() => formatEventDate('2026-06-27T09:00:00Z', false, null)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. renderEventsList — list rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('renderEventsList — empty state', () => {
  it('shows empty state when events array is empty', () => {
    renderEventsList(el, templates, [], noopNavigate);
    expect(el.emptyState.classList.contains('hidden')).toBe(false);
  });

  it('hides list when events array is empty', () => {
    renderEventsList(el, templates, [], noopNavigate);
    expect(el.list.classList.contains('hidden')).toBe(true);
  });
});

describe('renderEventsList — row rendering', () => {
  it('renders the correct number of rows', () => {
    const events = [makeEvent({ id: 'e1' }), makeEvent({ id: 'e2' })];
    renderEventsList(el, templates, events, noopNavigate);
    expect(el.list.querySelectorAll('.event-row')).toHaveLength(2);
  });

  it('renders the event title', () => {
    renderEventsList(el, templates, [makeEvent({ title: 'Team Standup' })], noopNavigate);
    expect(el.list.querySelector('.browse-row__title')?.textContent).toBe('Team Standup');
  });

  it('renders the time display in the row', () => {
    renderEventsList(
      el,
      templates,
      [makeEvent({ start: '2026-06-27T09:00:00Z', end: '2026-06-27T10:00:00Z', start_tzid: 'UTC' })],
      noopNavigate
    );
    const timeEl = el.list.querySelector('.event-browse-row__time');
    expect(timeEl?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders source badge text label (color-independence gate)', () => {
    renderEventsList(el, templates, [makeEvent({ source: 'jin' })], noopNavigate);
    const labelEl = el.list.querySelector('.event-browse-row__source-label');
    expect(labelEl?.textContent?.trim()).toBe('Jin');
  });

  it('renders Google source badge text label', () => {
    renderEventsList(el, templates, [makeEvent({ source: 'google' })], noopNavigate);
    const labelEl = el.list.querySelector('.event-browse-row__source-label');
    expect(labelEl?.textContent?.trim()).toBe('Google');
  });

  it('source badge has aria-label (not color-only: accessible)', () => {
    renderEventsList(el, templates, [makeEvent({ source: 'jin' })], noopNavigate);
    const badgeEl = el.list.querySelector('.event-browse-row__source-badge');
    expect(badgeEl?.getAttribute('aria-label')).toContain('Jin');
  });

  it('renders "all-day" time for all-day events', () => {
    renderEventsList(
      el,
      templates,
      [makeEvent({ is_all_day: true, start: '2026-06-27T00:00:00Z' })],
      noopNavigate
    );
    const timeEl = el.list.querySelector('.event-browse-row__time');
    expect(timeEl?.textContent?.trim()).toBe('All day');
  });
});

describe('renderEventsList — navigation (reachability gate)', () => {
  it('clicking an event row fires onNavigate with kind="events" and the event id', () => {
    const navigate = vi.fn();
    renderEventsList(el, templates, [makeEvent({ id: 'evt-abc' })], navigate);
    const btn = el.list.querySelector('.browse-row__inner') as HTMLButtonElement;
    btn.click();
    expect(navigate).toHaveBeenCalledWith('events', 'evt-abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. renderEventDetail — detail rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('renderEventDetail — title and meta', () => {
  it('renders the event title', () => {
    renderEventDetail(el, templates, makeEvent({ title: 'Q3 Review' }), noopNavigate);
    expect(el.detailContent.querySelector('.browse-detail__title')?.textContent).toBe('Q3 Review');
  });

  it('renders source badge text label (not color-only)', () => {
    renderEventDetail(el, templates, makeEvent({ source: 'google' }), noopNavigate);
    const labelEl = el.detailContent.querySelector('.event-detail__source-label');
    expect(labelEl?.textContent).toBe('Source: Google');
  });

  it('source badge has aria-label (accessible)', () => {
    renderEventDetail(el, templates, makeEvent({ source: 'jin' }), noopNavigate);
    const badgeEl = el.detailContent.querySelector('.event-detail__source-badge');
    expect(badgeEl?.getAttribute('aria-label')).toContain('Jin');
  });
});

describe('renderEventDetail — temporal display', () => {
  it('renders the date string', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ start: '2026-06-27T09:00:00Z', start_tzid: 'UTC' }),
      noopNavigate
    );
    const dateEl = el.detailContent.querySelector('.event-detail__date');
    expect(dateEl?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders the time range string', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ start: '2026-06-27T09:00:00Z', end: '2026-06-27T10:00:00Z', start_tzid: 'UTC' }),
      noopNavigate
    );
    const timeEl = el.detailContent.querySelector('.event-detail__time');
    expect(timeEl?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders "all-day" for all-day events', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ is_all_day: true, start: '2026-06-27T00:00:00Z', end: '2026-06-28T00:00:00Z' }),
      noopNavigate
    );
    const timeEl = el.detailContent.querySelector('.event-detail__time');
    expect(timeEl?.textContent).toBe('All day');
  });

  it('renders timezone label when not all-day and not floating', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ start_tzid: 'America/New_York', is_all_day: false, floating: false }),
      noopNavigate
    );
    const tzEl = el.detailContent.querySelector('.event-detail__tz');
    expect(tzEl?.textContent).toBe('America/New_York');
  });

  it('does not render tz label for all-day events', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ is_all_day: true, start_tzid: 'UTC' }),
      noopNavigate
    );
    expect(el.detailContent.querySelector('.event-detail__tz')).toBeNull();
  });
});

describe('renderEventDetail — Google meeting metadata', () => {
  it('renders dedicated organizer, attendee, conference, and reminder sections', () => {
    renderEventDetail(el, templates, makeEvent({
      source: 'google',
      authority: 'google',
      organizer: { displayName: 'Morgan Chen', email: 'host@example.com' },
      attendees: [
        { displayName: 'Alex Rivera', email: 'alex@example.com', responseStatus: 'accepted' },
        { email: 'sam@example.com', responseStatus: 'tentative', optional: true },
      ],
      attendees_omitted: true,
      hangout_link: 'https://meet.google.com/abc-defg-hij',
      conference_data: {
        conferenceSolution: { name: 'Google Meet' },
        conferenceId: 'abc-defg-hij',
        entryPoints: [{ entryPointType: 'phone', uri: 'tel:+15550199', label: '+1 555 0199' }],
        notes: 'Wait for the host.',
      },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }],
      },
    }), noopNavigate);

    expect(el.detailContent.querySelector('.event-detail__organizer')?.textContent).toContain('Morgan Chen');
    expect(el.detailContent.querySelectorAll('.event-detail__attendee')).toHaveLength(2);
    expect(el.detailContent.querySelector('.event-detail__attendees')?.textContent).toContain('Accepted');
    expect(el.detailContent.querySelector('.event-detail__attendee-limited')?.textContent).toContain('limited attendee list');
    expect(el.detailContent.querySelector('.event-detail__conference')?.textContent).toContain('Google Meet');
    expect(el.detailContent.querySelector('.event-detail__event-reminders')?.textContent).toContain('10 minutes before');
  });

  it('uses safe external conference links and ignores unsafe provider URLs and extras', () => {
    renderEventDetail(el, templates, makeEvent({
      conference_data: {
        entryPoints: [
          { entryPointType: 'video', uri: 'javascript:alert(1)', label: 'Unsafe provider URL' },
          {
            entryPointType: 'phone', uri: 'tel:+15550199', label: '+1 555 0199',
            pin: '1234', accessCode: '5678', meetingCode: 'meeting-9', passcode: '2468', password: 'secret',
            providerCredential: 'must-not-render',
          },
        ],
        providerOnly: '<script>provider extra</script>',
      },
      hangout_link: 'https://meet.google.com/abc-defg-hij',
      organizer: { email: 'host@example.com', providerOnly: '<img src=x onerror=alert(1)>' },
    }), noopNavigate);

    const join = el.detailContent.querySelector<HTMLAnchorElement>('.event-detail__join-link')!;
    expect(join.href).toBe('https://meet.google.com/abc-defg-hij');
    expect(join.target).toBe('_blank');
    expect(join.rel).toContain('noopener');
    const links = [...el.detailContent.querySelectorAll<HTMLAnchorElement>('.event-detail__conference-link')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('tel:+15550199');
    expect(links[0].getAttribute('href')).not.toContain('1234');
    const credentials = el.detailContent.querySelector('.event-detail__conference-credentials')!;
    expect(credentials.getAttribute('aria-label')).toContain('credentials');
    expect(credentials.textContent).toContain('PIN1234');
    expect(credentials.textContent).toContain('Access code5678');
    expect(credentials.textContent).toContain('Meeting codemeeting-9');
    expect(credentials.textContent).toContain('Passcode2468');
    expect(credentials.textContent).toContain('Passwordsecret');
    expect(credentials.textContent).not.toContain('must-not-render');
    expect(el.detailContent.textContent).not.toContain('Unsafe provider URL');
    expect(el.detailContent.textContent).not.toContain('provider extra');
    expect(el.detailContent.querySelector('script, img')).toBeNull();
  });

  it('renders a warning-only attendees section when Google omitted the attendee list', () => {
    renderEventDetail(el, templates, makeEvent({
      attendees: [],
      attendees_omitted: true,
    }), noopNavigate);

    const section = el.detailContent.querySelector('.event-detail__attendees');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-label')).toBe('Attendees');
    expect(section?.querySelector('.event-detail__attendee-list')).toBeNull();
    expect(section?.querySelector('.event-detail__attendee-limited')?.textContent).toContain('limited attendee list');
  });

  it('distinguishes calendar defaults, explicit no reminders, and absent metadata', () => {
    renderEventDetail(el, templates, makeEvent({ reminders: { useDefault: true } }), noopNavigate);
    expect(el.detailContent.querySelector('.event-detail__event-reminders')?.textContent).toContain('Calendar default');

    renderEventDetail(el, templates, makeEvent({ reminders: { useDefault: false } }), noopNavigate);
    expect(el.detailContent.querySelector('.event-detail__event-reminders')?.textContent).toContain('No reminders');

    renderEventDetail(el, templates, makeEvent({
      organizer: null,
      attendees: [],
      conference_data: null,
      hangout_link: null,
      reminders: null,
    }), noopNavigate);
    expect(el.detailContent.querySelector('.event-detail__google-metadata')).toBeNull();
  });

  it('labels every metadata section for assistive technology', () => {
    renderEventDetail(el, templates, makeEvent({
      organizer: { email: 'host@example.com' },
      attendees: [{ email: 'guest@example.com', responseStatus: 'needsAction' }],
      hangout_link: 'https://meet.google.com/abc-defg-hij',
      reminders: { useDefault: false },
    }), noopNavigate);
    const sections = [...el.detailContent.querySelectorAll<HTMLElement>('.event-detail__metadata-section')];
    expect(sections).toHaveLength(4);
    expect(sections.every((section) => Boolean(section.getAttribute('aria-label')))).toBe(true);
    expect(sections.every((section) => section.querySelector('h3') !== null)).toBe(true);
  });
});

describe('renderEventDetail — recurring flag', () => {
  it('shows recurring badge for recurrence_unexpanded events', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ recurrence_unexpanded: true }),
      noopNavigate
    );
    const recurEl = el.detailContent.querySelector('.event-detail__recurring-badge');
    expect(recurEl).not.toBeNull();
    expect(recurEl?.getAttribute('aria-label')).toContain('Recurring');
  });

  it('does not show recurring badge for normal events', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ recurrence_unexpanded: false }),
      noopNavigate
    );
    expect(el.detailContent.querySelector('.event-detail__recurring-badge')).toBeNull();
  });
});

describe('renderEventDetail — derived_from task (reachability gate)', () => {
  const TASK_ID = 'task-origin-123';

  it('renders the originating task section when derived_from is non-null', () => {
    renderEventDetail(
      el,
      templates,
      makeDetail({ derived_from: TASK_ID }),
      noopNavigate
    );
    expect(el.detailContent.querySelector('.event-detail__derived-from')).not.toBeNull();
  });

  it('renders the human task title without exposing its raw id', () => {
    renderEventDetail(
      el,
      templates,
      makeDetail({ derived_from: TASK_ID }),
      noopNavigate
    );
    expect(el.detailContent.textContent).toContain('Plan quarterly review');
    expect(el.detailContent.textContent).not.toContain(TASK_ID);
  });

  it('derived-from task button has data-link-id set', () => {
    renderEventDetail(
      el,
      templates,
      makeDetail({ derived_from: TASK_ID }),
      noopNavigate
    );
    const btn = el.detailContent.querySelector(
      '.event-detail__derived-from .browse-link-row__btn'
    ) as HTMLElement | null;
    expect(btn?.dataset.linkId).toBe(TASK_ID);
  });

  it('clicking the derived-from task fires onNavigate with kind="tasks"', () => {
    const navigate = vi.fn();
    renderEventDetail(
      el,
      templates,
      makeDetail({ derived_from: TASK_ID }),
      navigate
    );
    const btn = el.detailContent.querySelector(
      '.event-detail__derived-from .browse-link-row__btn'
    ) as HTMLButtonElement | null;
    btn?.click();
    expect(navigate).toHaveBeenCalledWith('tasks', TASK_ID);
  });

  it('does not render derived-from section when derived_from is null', () => {
    renderEventDetail(el, templates, makeEvent({ derived_from: null }), noopNavigate);
    expect(el.detailContent.querySelector('.event-detail__derived-from')).toBeNull();
  });
});

describe('renderEventDetail — prep notes from backlinks (reachability gate)', () => {
  const NOTE_ID = 'note-prep-abc';
  const NOTE_TITLE = 'Pre-read Document';

  it('renders prep notes section when backlinks contain prep-for notes', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({
        backlinks: [makeEventBacklink({ source_id: NOTE_ID, label: NOTE_TITLE, source_kind: 'note', edge_type: 'prep-for' })],
      }),
      noopNavigate
    );
    expect(el.detailContent.querySelector('.event-detail__prep-notes')).not.toBeNull();
  });

  it('renders prep note label in the DOM (label visible)', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({
        backlinks: [makeEventBacklink({ source_id: NOTE_ID, label: NOTE_TITLE })],
      }),
      noopNavigate
    );
    const labelEl = el.detailContent.querySelector(
      '.event-detail__prep-notes .browse-link-row__label'
    );
    expect(labelEl?.textContent).toBe(NOTE_TITLE);
  });

  it('does not expose the prep note raw id in visible copy', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({
        backlinks: [makeEventBacklink({ source_id: NOTE_ID })],
      }),
      noopNavigate
    );
    expect(el.detailContent.textContent).not.toContain(NOTE_ID);
  });

  it('clicking a prep note fires onNavigate with kind="notes" (prep note reachable)', () => {
    const navigate = vi.fn();
    renderEventDetail(
      el,
      templates,
      makeEvent({
        backlinks: [makeEventBacklink({ source_id: NOTE_ID, source_kind: 'note', edge_type: 'prep-for' })],
      }),
      navigate
    );
    const btn = el.detailContent.querySelector(
      '.event-detail__prep-notes .browse-link-row__btn'
    ) as HTMLButtonElement | null;
    btn?.click();
    expect(navigate).toHaveBeenCalledWith('notes', NOTE_ID);
  });

  it('does not render prep notes section when no prep-for backlinks', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({ backlinks: [] }),
      noopNavigate
    );
    expect(el.detailContent.querySelector('.event-detail__prep-notes')).toBeNull();
  });

  it('renders multiple prep notes as separate items', () => {
    renderEventDetail(
      el,
      templates,
      makeEvent({
        backlinks: [
          makeEventBacklink({ source_id: 'note-1', label: 'Note 1' }),
          makeEventBacklink({ source_id: 'note-2', label: 'Note 2' }),
        ],
      }),
      noopNavigate
    );
    const prepItems = el.detailContent.querySelectorAll(
      '.event-detail__prep-notes .browse-link-row'
    );
    expect(prepItems).toHaveLength(2);
  });
});

describe('Event detail capability controller gates (AC-022–AC-028)', () => {
  let app: Application;

  function controllerFixture(): void {
    document.body.innerHTML = `
      <div id="modal-root"></div>
      <template id="tmpl-event-browse-row">
        <li><button class="browse-row__inner"><span class="event-browse-row__time"></span><span class="browse-row__title"></span><span class="event-browse-row__source-badge"><i class="event-browse-row__source-icon"></i><span class="event-browse-row__source-label"></span></span></button></li>
      </template>
      <template id="tmpl-backlink-row">
        <li class="browse-link-row"><button class="browse-link-row__btn"><i class="browse-link-row__icon"></i><span class="browse-link-row__label"></span><span class="browse-link-row__id"></span></button></li>
      </template>
      <template id="tmpl-calendar">
        <div class="calendar-widget">
          <div class="calendar-widget__header"><button class="calendar-widget__year-prev"></button><button class="calendar-widget__month-prev"></button><span class="calendar-widget__month-label"></span><button class="calendar-widget__month-next"></button><button class="calendar-widget__year-next"></button></div>
          <div class="calendar-widget__weekdays">${Array.from({ length: 7 }, () => '<abbr class="calendar-widget__weekday"></abbr>').join('')}</div>
          <div class="calendar-widget__grid" role="grid"></div>
          <div class="calendar-widget__footer"><button class="calendar-widget__today-btn">Today</button><button class="calendar-widget__clear-btn">Clear</button><button class="calendar-widget__commit-btn" hidden>Use dates</button></div>
        </div>
      </template>
      <section data-controller="events" data-action="jin:section-activated->events#activateSection jin:open-detail->events#openDetail">
        <button class="calendar-global-add">Add Event</button>
        <div data-events-target="listPanel"><ul data-events-target="list"></ul><p data-events-target="emptyState"></p><p data-events-target="loadingState"></p></div>
        <div data-events-target="detailPanel" class="events-detail-pane hidden">
          <button class="calendar-back-btn"><span>Calendar</span></button>
          <p data-events-target="detailLoadingState"></p>
          <p data-events-target="detailNotFoundState" class="hidden"></p>
          <div data-events-target="detailContent"></div>
        </div>
      </section>`;
  }

  async function start(detail: EventDetailDto, beforeOpen?: (host: HTMLElement) => void): Promise<void> {
    controllerFixture();
    invokeMocks.listEvents.mockReset().mockResolvedValue([detail.event]);
    invokeMocks.getEventDetailById.mockReset().mockResolvedValue(detail);
    invokeMocks.editEvent.mockReset().mockResolvedValue({ event: detail.event, no_op: false });
    invokeMocks.deleteEvent.mockReset().mockResolvedValue(detail.event);
    invokeMocks.removeTimeBlock.mockReset().mockResolvedValue({ event: detail.event, originating_task: null });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value() { this.setAttribute('open', ''); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value() { this.removeAttribute('open'); },
    });
    app = Application.start();
    app.register('calendar', CalendarController);
    app.register('events', EventsController);
    await flushController();
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    beforeOpen?.(host);
    host.dispatchEvent(new CustomEvent('jin:open-detail', { bubbles: true, detail: { id: detail.event.id } }));
    await flushController();
  }

  afterEach(() => {
    app?.stop();
    localStorage.clear();
  });

  it('hides global Add from layout and the accessibility tree while detail is visible', async () => {
    await start(makeDetail());
    const add = document.querySelector<HTMLButtonElement>('.calendar-global-add')!;
    expect(add.hidden).toBe(true);
    expect(add.getAttribute('aria-hidden')).toBe('true');
    expect(add.disabled).toBe(true);
  });

  it('returns the calendar route scroll position after detail closes', async () => {
    let route!: HTMLElement;
    await start(makeDetail(), host => {
      route = host;
      host.scrollTop = 187;
      const obsoletePanel = document.createElement('div');
      obsoletePanel.className = 'calendar-month-view';
      obsoletePanel.scrollTop = 23;
      host.appendChild(obsoletePanel);
    });
    const returned = vi.fn();
    route.addEventListener('jin:calendar-return', returned);
    const controller = app.getControllerForElementAndIdentifier(route, 'events') as EventsController;

    controller.showList();

    expect(returned).toHaveBeenCalledOnce();
    expect((returned.mock.calls[0][0] as CustomEvent<{ scrollTop: number }>).detail.scrollTop).toBe(187);
  });

  it('resets stale detail state when Events is activated without a detail id', async () => {
    await start(makeDetail());
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    const restored = vi.fn();
    host.addEventListener('jin:calendar-return', restored);

    host.dispatchEvent(new CustomEvent('jin:section-activated', {
      bubbles: false, detail: { id: null },
    }));

    expect(document.querySelector('[data-events-target="detailPanel"]')?.classList.contains('hidden')).toBe(true);
    const add = document.querySelector<HTMLButtonElement>('.calendar-global-add')!;
    expect(add.hidden).toBe(false);
    expect(add.getAttribute('aria-hidden')).toBe('false');
    expect(restored).toHaveBeenCalledOnce();
  });

  it('preserves explicit detail navigation when section activation carries an id', async () => {
    await start(makeDetail());
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    host.dispatchEvent(new CustomEvent('jin:section-activated', {
      bubbles: false, detail: { id: 'evt-001' },
    }));

    expect(document.querySelector('[data-events-target="detailPanel"]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.event-detail')).not.toBeNull();
  });

  it('shows Edit and Delete for a mutable plain event', async () => {
    await start(makeDetail());
    expect(document.querySelector('.event-detail__edit')?.textContent).toBe('Edit');
    expect(document.querySelector('.event-detail__destructive')?.textContent).toBe('Delete');
  });

  it('labels the Time block destructive action Remove', async () => {
    await start(makeDetail({ derived_from: 'task-1' }));
    expect(document.querySelector('.event-detail__kind-badge')?.textContent).toBe('Time block');
    expect(document.querySelector('.event-detail__destructive')?.textContent).toBe('Remove');
  });

  it('shows an eligible return checkbox unchecked by default and passes its choice atomically', async () => {
    await start(makeDetail({ derived_from: 'task-1' }, { can_return_task_to_flexible: true }));
    document.querySelector<HTMLButtonElement>('.event-detail__destructive')!.click();
    const checkbox = document.querySelector<HTMLInputElement>('.confirm-dialog__checkbox input')!;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.parentElement?.textContent).toContain('Return task to flexible agenda');
    checkbox.checked = true;
    document.querySelector<HTMLButtonElement>('#jin-modal-root .btn-danger')!.click();
    await flushController();
    expect(invokeMocks.removeTimeBlock).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt-001', return_to_flexible: true, operation_id: 'remove-test-operation',
    }));
  });

  it('contains no return checkbox when the Time block is ineligible', async () => {
    await start(makeDetail({ derived_from: 'task-1' }, { can_return_task_to_flexible: false }));
    document.querySelector<HTMLButtonElement>('.event-detail__destructive')!.click();
    expect(document.querySelector('.confirm-dialog__checkbox')).toBeNull();
  });

  it('refetches canonical detail after a successful mutation before showing it', async () => {
    const detail = makeDetail();
    await start(detail);
    document.querySelector<HTMLButtonElement>('.event-detail__destructive')!.click();
    document.querySelector<HTMLButtonElement>('#jin-modal-root .btn-danger')!.click();
    await flushController();
    expect(invokeMocks.deleteEvent).toHaveBeenCalledWith(detail.event.id);
    expect(invokeMocks.getEventDetailById.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Google privacy copy and suppresses all mutation controls for read-only detail', async () => {
    await start(makeDetail(
      { source: 'google', authority: 'google' },
      { can_edit: false, can_delete: false, read_only_reason: 'external_authority_or_source' },
    ));
    expect(document.body.textContent).toContain('Private to Jin');
    expect(document.body.textContent).toContain('They aren’t shared with Google or event guests.');
    expect(document.querySelector('.event-detail__edit')).toBeNull();
    expect(document.querySelector('.event-detail__destructive')).toBeNull();
  });

  it('opens Prep and Related actions in human-title contextual mode', async () => {
    await start(makeDetail());
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    const attach = vi.fn();
    const link = vi.fn();
    host.addEventListener('jin:open-attach', attach);
    host.addEventListener('jin:open-link', link);
    const actions = [...document.querySelectorAll<HTMLButtonElement>('.event-detail__context-search')];
    actions.find(button => button.textContent === 'Find prep note')?.click();
    actions.find(button => button.textContent === 'Find related note')?.click();
    expect((attach.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      context: 'event-prep', targetId: 'evt-001', targetTitle: 'Test Event',
    });
    expect((link.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      context: 'event-related', sourceId: 'evt-001', sourceTitle: 'Test Event',
    });
  });

  it('localizes list and detail bridge failures without passing through English messages', async () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    await start(makeDetail());
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    const errors: string[] = [];
    host.addEventListener('app:error', event => {
      errors.push((event as CustomEvent<{ message: string }>).detail.message);
    });
    const englishError = { code: 1, kind: 'other', message: 'English bridge detail', retriable: false };
    const controller = app.getControllerForElementAndIdentifier(host, 'events') as EventsController;

    invokeMocks.listEvents.mockRejectedValueOnce(englishError);
    await controller.loadList();
    invokeMocks.getEventDetailById.mockRejectedValueOnce(englishError);
    host.dispatchEvent(new CustomEvent('jin:open-detail', { bubbles: true, detail: { id: 'evt-001' } }));
    await flushController();

    expect(errors).toEqual([
      'Não foi possível carregar os eventos',
      'Não foi possível carregar o evento completo',
    ]);
    expect(errors.join(' ')).not.toContain('English bridge detail');
  });

  it('localizes non-conflict removal failures instead of exposing Jin DTO messages', async () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    await start(makeDetail());
    invokeMocks.deleteEvent.mockRejectedValueOnce({
      code: 1, kind: 'other', message: 'English delete detail', retriable: false,
    });
    document.querySelector<HTMLButtonElement>('.event-detail__destructive')!.click();
    document.querySelector<HTMLButtonElement>('#jin-modal-root .btn-danger')!.click();
    await flushController();

    const status = document.querySelector<HTMLElement>('.event-detail__operation-status')!;
    expect(status.textContent).toBe('Não foi possível remover o evento');
    expect(status.textContent).not.toContain('English delete detail');
  });

  it('edits in the same bounded detail surface and preserves source and Time block identity', async () => {
    await start(makeDetail({ derived_from: 'task-1' }));
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    await flushController();

    expect(document.querySelector('.event-detail--editing')).not.toBeNull();
    expect(document.querySelector('.events-detail-pane')).not.toBeNull();
    expect(document.body.textContent).toContain('Source: Jin');
    expect(document.body.textContent).toContain('Time block');
    expect(document.body.textContent).toContain('Originating task: Plan quarterly review');
    expect(document.querySelector<HTMLDialogElement>('dialog[open]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.event-edit__title'));
  });

  it('uses the shared compound When surface with exact timed endpoints and no native date picker', async () => {
    await start(makeDetail({ start: '2026-06-27T23:30:17', end: '2026-06-29T01:15:17' }));
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    await flushController();
    expect(document.querySelector('.event-edit input[type="date"]')).toBeNull();
    expect(document.querySelector('.event-edit [data-controller="calendar"] .calendar-widget')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[name="start_time"]')?.value).toBe('23:30');
    expect(document.querySelector<HTMLInputElement>('[name="end_time"]')?.value).toBe('01:15');
    expect(document.querySelector('.event-edit .calendar-widget__commit-btn')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('[role="grid"]')?.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('projects all-day exclusive end to an inclusive Calendar range', async () => {
    await start(makeDetail({ start: '2026-06-27', end: '2026-06-30', is_all_day: true, start_tzid: null, end_tzid: null }));
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    await flushController();
    expect(document.querySelector('[role="gridcell"][data-iso="2026-06-27"]')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="gridcell"][data-iso="2026-06-29"]')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="gridcell"][data-iso="2026-06-30"]')?.getAttribute('aria-selected')).toBe('false');
    expect(document.querySelector('.event-when__summary')?.textContent).toContain('Jun 29');
  });

  it('localizes the complete edit When surface without losing unsubmitted DOM state', async () => {
    await start(makeDetail());
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    await flushController();
    const title = document.querySelector<HTMLInputElement>('.event-edit__title')!;
    const relative = document.querySelector<HTMLInputElement>('[name="relative_when"]')!;
    title.value = 'Meu rascunho'; title.dispatchEvent(new Event('input'));
    relative.value = 'tomorrow at noon'; relative.dispatchEvent(new Event('input'));
    localStorage.setItem('jin:event-locale', 'pt-BR');
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    const controller = app.getControllerForElementAndIdentifier(host, 'events') as EventsController;
    controller.localeChanged();
    await flushController();
    expect(document.querySelector<HTMLInputElement>('.event-edit__title')?.value).toBe('Meu rascunho');
    expect(document.querySelector<HTMLInputElement>('[name="relative_when"]')?.value).toBe('tomorrow at noon');
    expect(document.querySelector('.event-edit__when legend')?.textContent).toBe('Quando');
    expect(document.querySelector('.calendar-widget__today-btn')?.textContent).toBe('Hoje');
    expect(document.querySelector('.event-when__preview')?.textContent).toContain('às');
    expect(document.querySelector('.event-edit__header')?.textContent).toContain('Salvar');
  });

  it('Cancel and Escape discard only the draft and restore focus to Edit', async () => {
    await start(makeDetail());
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    const title = document.querySelector<HTMLInputElement>('.event-edit__title')!;
    title.value = 'Unsaved';
    document.querySelector<HTMLButtonElement>('.event-edit__header .btn-secondary')!.click();
    await flushController();
    expect(invokeMocks.editEvent).not.toHaveBeenCalled();
    expect(document.querySelector('.browse-detail__title')?.textContent).toBe('Test Event');
    expect(document.activeElement).toBe(document.querySelector('.event-detail__edit'));

    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    document.querySelector<HTMLFormElement>('.event-edit')!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    await flushController();
    expect(document.querySelector('.event-detail--editing')).toBeNull();
    expect(invokeMocks.editEvent).not.toHaveBeenCalled();
  });

  it('Description Enter inserts text without saving while Mod+Enter saves once under the pending guard', async () => {
    await start(makeDetail());
    let resolveEdit!: (value: unknown) => void;
    invokeMocks.editEvent.mockImplementationOnce(() => new Promise(resolve => { resolveEdit = resolve; }));
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    const description = document.querySelector<HTMLTextAreaElement>('[name="description"]')!;
    description.value = 'First\nSecond';
    description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(invokeMocks.editEvent).not.toHaveBeenCalled();

    const form = document.querySelector<HTMLFormElement>('.event-edit')!;
    form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    expect(invokeMocks.editEvent).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLButtonElement>('.event-edit__save')?.disabled).toBe(true);
    resolveEdit({ event: makeEvent({ description: 'First\nSecond' }), no_op: false });
    await flushController();
    expect(invokeMocks.getEventDetailById.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.event-detail--editing')).toBeNull();
  });

  it('keeps exact canonical strings on unchanged Save and emits no mutation refresh for a no-op', async () => {
    const initial = makeDetail({ start: '2026-06-27T09:00:17Z', end: '2026-06-27T10:00:17Z' });
    await start(initial);
    invokeMocks.editEvent.mockResolvedValueOnce({ event: initial.event, no_op: true });
    invokeMocks.getEventDetailById.mockResolvedValueOnce(initial);
    const host = document.querySelector<HTMLElement>('[data-controller="events"]')!;
    const edited = vi.fn(); const refreshed = vi.fn();
    host.addEventListener('jin:event-edited', edited); host.addEventListener('jin:refresh-today', refreshed);
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();
    expect(invokeMocks.editEvent.mock.calls[0][0]).toMatchObject({ start: initial.event.start, end: initial.event.end, tzid: 'UTC' });
    expect(edited).not.toHaveBeenCalled(); expect(refreshed).not.toHaveBeenCalled();
  });

  it('preserves a stale draft, refetches latest for comparison, and conflict choices never write', async () => {
    const initial = makeDetail();
    const latest = makeDetail({ title: 'Changed elsewhere', location: 'Room B' });
    await start(initial);
    invokeMocks.editEvent.mockRejectedValueOnce({
      code: 4, kind: 'sync_conflict', message: 'opaque core text', retriable: false,
      details: { type: 'stale_event', event_id: initial.event.id },
    });
    invokeMocks.getEventDetailById.mockResolvedValueOnce(latest);
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    document.querySelector<HTMLInputElement>('.event-edit__title')!.value = 'My careful draft';
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();

    expect(document.querySelector<HTMLInputElement>('.event-edit__title')?.value).toBe('My careful draft');
    expect(document.querySelector('.event-edit__conflict')?.textContent).toContain('This event changed');
    expect(document.querySelector('.event-edit__conflict')?.textContent).toContain('Title');
    expect(invokeMocks.editEvent).toHaveBeenCalledOnce();
    const review = [...document.querySelectorAll<HTMLButtonElement>('.event-edit__conflict button')]
      .find(button => button.textContent === 'Review my draft')!;
    review.click();
    expect(invokeMocks.editEvent).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>('.event-edit__title')?.value).toBe('My careful draft');
  });

  it('recognizes the deterministic fixture stale DTO and enters draft-preserving comparison actions', async () => {
    const bridge = loadEventFixture();
    const initial = await bridge.invoke('get_event_detail', { id: 'e1' }) as EventDetailDto;
    const baseInput = {
      event_id: initial.event.id,
      edit_token: initial.edit_token,
      title: initial.event.title,
      start: initial.event.start,
      end: initial.event.end,
      is_all_day: initial.event.is_all_day,
      location: initial.event.location ?? undefined,
      description: initial.event.description ?? undefined,
    };
    await bridge.invoke('edit_event', {
      input: { ...baseInput, operation_id: 'fixture-external-change', title: 'Changed elsewhere' },
    });
    let staleError: unknown;
    try {
      await bridge.invoke('edit_event', {
        input: { ...baseInput, operation_id: 'fixture-stale-controller', title: 'Stale draft' },
      });
    } catch (error: unknown) {
      staleError = error;
    }
    expect(staleError).toMatchObject({
      code: 4,
      kind: 'sync_conflict',
      retriable: false,
      details: { type: 'stale_event', event_id: 'e1' },
    });

    const latest = await bridge.invoke('get_event_detail', { id: 'e1' }) as EventDetailDto;
    await start(initial);
    invokeMocks.editEvent.mockRejectedValueOnce(staleError);
    invokeMocks.getEventDetailById.mockResolvedValueOnce(latest);
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    document.querySelector<HTMLInputElement>('.event-edit__title')!.value = 'My preserved fixture draft';
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();

    expect(document.querySelector<HTMLInputElement>('.event-edit__title')?.value)
      .toBe('My preserved fixture draft');
    const actions = [...document.querySelectorAll<HTMLButtonElement>('.event-edit__conflict button')]
      .map(button => button.textContent);
    expect(actions).toEqual(['Use latest', 'Review my draft']);
  });

  it('Use latest replaces the complete When draft and baseline without writing', async () => {
    const initial = makeDetail({ start: '2026-06-27T23:30:17', end: '2026-06-29T01:15:17' });
    const latest = { ...makeDetail({ start: '2026-07-04T08:15:29', end: '2026-07-04T09:45:29' }), edit_token: 'sha256:fresh' };
    await start(initial);
    invokeMocks.editEvent.mockRejectedValueOnce({
      code: 4, kind: 'sync_conflict', message: 'stale', retriable: false,
      details: { type: 'stale_event', event_id: initial.event.id },
    });
    invokeMocks.getEventDetailById.mockResolvedValueOnce(latest);
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    const relative = document.querySelector<HTMLInputElement>('[name="relative_when"]')!;
    relative.value = 'tomorrow at noon'; relative.dispatchEvent(new Event('input'));
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();
    [...document.querySelectorAll<HTMLButtonElement>('.event-edit__conflict button')]
      .find(button => button.textContent === 'Use latest')!.click();
    await flushController();
    expect(invokeMocks.editEvent).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>('[name="relative_when"]')?.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('[name="start_time"]')?.value).toBe('08:15');
    expect(document.querySelector<HTMLInputElement>('[name="end_time"]')?.value).toBe('09:45');
    expect(document.querySelector('[role="gridcell"][data-iso="2026-07-04"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('uses the latest edit token for an explicit post-conflict Save and localizes safe-action feedback', async () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    const initial = makeDetail();
    const latest = { ...makeDetail({ title: 'Mudou fora', start: '2026-06-27T09:00:30Z', end: '2026-06-27T10:00:30Z' }), edit_token: 'sha256:fresh' };
    await start(initial);
    invokeMocks.editEvent.mockRejectedValueOnce({
      code: 4, kind: 'sync_conflict', message: 'English', retriable: false,
      details: { type: 'stale_event', event_id: initial.event.id },
    });
    invokeMocks.getEventDetailById.mockResolvedValueOnce(latest);
    document.querySelector<HTMLButtonElement>('.event-detail__edit')!.click();
    document.querySelector<HTMLInputElement>('.event-edit__title')!.value = 'Meu rascunho';
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();
    expect(document.body.textContent).toContain('Este evento mudou');
    expect(document.body.textContent).toContain('Data');
    expect(document.body.textContent).not.toContain('English');

    [...document.querySelectorAll<HTMLButtonElement>('.event-edit__conflict button')]
      .find(button => button.textContent === 'Revisar meu rascunho')!.click();
    invokeMocks.editEvent.mockResolvedValueOnce({ event: latest.event, no_op: true });
    invokeMocks.getEventDetailById.mockResolvedValueOnce(latest);
    document.querySelector<HTMLFormElement>('.event-edit')!.requestSubmit();
    await flushController();
    expect(invokeMocks.editEvent.mock.calls[1][0]).toMatchObject({
      event_id: 'evt-001', edit_token: 'sha256:fresh', title: 'Meu rascunho',
      start: initial.event.start, end: initial.event.end,
    });
    expect(document.querySelector('.event-detail--editing')).toBeNull();
  });
});
