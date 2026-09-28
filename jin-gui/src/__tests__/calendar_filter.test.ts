// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import CalendarViewController from '../controllers/calendar_view_controller';
import CalendarController from '../controllers/calendar_controller';
import {
  CALENDAR_VISIBILITY_STORAGE_KEY,
  loadCalendarVisibility,
} from '../lib/calendar/visibility';
import { googleCalendarKey, JIN_CALENDAR_KEY } from '../lib/calendar/colors';
import type { EventDto } from '../types/dto';
import * as invoke from '../invoke';

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(), createEvent: vi.fn(), createRoutedEvent: vi.fn(), listGoogleAccounts: vi.fn(),
  newOperationId: vi.fn(() => 'create-test-operation'),
  deleteEvent: vi.fn(), promoteTask: vi.fn(), listTasks: vi.fn(),
  previewRecurrence: vi.fn(),
  syncCalendarEvent: vi.fn(),
  calendarRangeProjection: vi.fn(async (input) => {
    const events = await mocks.listEvents();
    return {
      from: input.from,
      to: input.to,
      display_tz: 'UTC',
      entries: events.map((event) => ({
        event_id: event.id,
        title: event.title,
        slot_state: event.is_all_day ? 'all_day' : event.floating ? 'floating' : 'anchored',
        start_date: event.start.slice(0, 10),
        end_date: event.end.slice(0, 10),
        start_display: event.is_all_day ? event.start.slice(0, 10) : event.start.slice(0, 19),
        end_display: event.is_all_day ? event.end.slice(0, 10) : event.end.slice(0, 19),
        start_utc: null,
        end_utc: null,
        continuation_dates: [],
        elapsed_minutes: 60,
        start_tzid: event.start_tzid,
        end_tzid: event.end_tzid,
        is_all_day: event.is_all_day,
        floating: event.floating,
        start_resolution: 'exact',
        end_resolution: 'exact',
        temporal_editable: true,
        temporal_disabled_reason: null,
      })),
    };
  }),
  getEventDetailById: vi.fn(),
  setGoogleCalendarEnabled: vi.fn(),
  connectGoogleAccount: vi.fn(),
  disconnectGoogleAccount: vi.fn(),
  runSync: vi.fn(),
  addGoogleAccount: vi.fn(),
}));

vi.mock('../invoke', () => mocks);
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'event-1', title: 'Team sync', description: '',
    location: '', start: '2026-09-23T14:00:00', end: '2026-09-23T15:00:00',
    is_all_day: false, start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo',
    floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: 'event-1@jin',
    derived_from: null, recurrence: [], recurring_event_id: null, original_start: null,
    master_id: null, recurrence_unexpanded: false, sequence: 1,
    created: '2026-08-01T10:00:00-03:00', updated: '2026-08-01T10:00:00-03:00', backlinks: [],
    ...overrides,
  };
}

function fixture(): string {
  return `
    <section data-controller="calendar-view" data-action="jin:events-mutated@window->calendar-view#handleMutation" aria-label="Calendar">
      <div data-calendar-view-target="workspace"><div data-calendar-view-target="field">
      <div data-calendar-view-target="monthView"><div data-calendar-view-target="monthViewContent"></div></div>
      <div data-calendar-view-target="dayView" class="hidden"><div data-calendar-view-target="dayViewContent"></div></div>
      </div></div>
      <div data-events-target="detailPanel" class="hidden"></div>
      <button class="calendar-global-add" data-calendar-view-target="createEventBtn"></button>
      <dialog data-calendar-view-target="eventModal" aria-labelledby="event-dialog-title">
        <h2 id="event-dialog-title">New Event</h2>
        <input data-calendar-view-target="eventTitle">
        <select data-calendar-view-target="eventDestination"></select>
        <input data-calendar-view-target="eventGuests" type="email" multiple>
        <select data-calendar-view-target="eventGuestUpdates"><option value="all">All</option><option value="external_only">External</option><option value="none">None</option></select>
        <input data-calendar-view-target="eventGoogleMeet" type="checkbox">
        <fieldset class="event-when">
          <legend data-event-copy="when">When *</legend>
          <label data-event-copy="dateTime">Date and time</label>
          <input data-calendar-view-target="eventWhenInput">
          <button type="button" data-event-copy="use">Use</button>
          <p data-calendar-view-target="eventWhenPreview"></p>
          <div data-controller="calendar" data-calendar-mode-value="range" data-calendar-view-target="eventCalendar"></div>
          <p data-calendar-view-target="eventWhenSummary"></p>
        </fieldset>
        <input data-calendar-view-target="eventAllDay" type="checkbox">
        <div class="event-repeat-row">
          <label data-recurrence-copy="repeat">Repeat</label>
          <select data-calendar-view-target="eventRepeat"><option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom</option></select>
          <div class="event-repeat-custom hidden" data-calendar-view-target="eventRepeatCustom">
            <span data-recurrence-copy="every">Every</span><input data-calendar-view-target="eventRepeatInterval" value="1"><select data-calendar-view-target="eventRepeatFrequency"><option value="daily">day</option><option value="weekly">week</option><option value="monthly">month</option><option value="yearly">year</option></select>
            <fieldset data-calendar-view-target="eventRepeatWeekdays"><legend data-recurrence-copy="onDays">On days</legend><div class="event-repeat-weekdays">${['mo','tu','we','th','fr','sa','su'].map(day => `<label><input type="checkbox" value="${day}"><span>${day}</span></label>`).join('')}</div></fieldset>
            <fieldset data-calendar-view-target="eventRepeatMonthlyMode"><legend data-recurrence-copy="monthlyOn">Monthly on</legend><label><input type="radio" name="event-repeat-monthly" value="day_of_month" checked><span data-recurrence-copy="dayOfMonth">Day</span><input data-calendar-view-target="eventRepeatMonthDay" value="1"></label><label><input type="radio" name="event-repeat-monthly" value="nth_weekday"><select data-calendar-view-target="eventRepeatOrdinal"><option value="1">First</option><option value="-1">Last</option></select><select data-calendar-view-target="eventRepeatOrdinalWeekday"><option value="mo">Monday</option><option value="th">Thursday</option></select></label></fieldset>
            <fieldset><legend data-recurrence-copy="ends">Ends</legend><label><input type="radio" name="event-repeat-end" value="never" checked data-calendar-view-target="eventRepeatEndKind"><span data-recurrence-copy="never">Never</span></label><label><input type="radio" name="event-repeat-end" value="until" data-calendar-view-target="eventRepeatEndKind"><span data-recurrence-copy="onDate">On date</span><input data-calendar-view-target="eventRepeatUntil"></label><label><input type="radio" name="event-repeat-end" value="count" data-calendar-view-target="eventRepeatEndKind"><span data-recurrence-copy="after">After</span><input data-calendar-view-target="eventRepeatCount" value="10"><span data-recurrence-copy="occurrences">occurrences</span></label></fieldset>
          </div>
          <p class="hidden" data-calendar-view-target="eventRepeatPreview"></p>
        </div>
        <div data-calendar-view-target="timeGroup">
          <input data-calendar-view-target="eventStartTime" type="text" inputmode="numeric">
          <input data-calendar-view-target="eventEndTime" type="text" inputmode="numeric">
        </div>
        <input data-calendar-view-target="eventLocation">
        <textarea data-calendar-view-target="eventDescription"></textarea>
        <div data-calendar-view-target="eventError" class="hidden"></div>
        <div class="form-actions"><button class="btn-secondary"></button><button data-calendar-view-target="eventSubmit"></button></div>
      </dialog>
    </section>
    <template id="tmpl-calendar">
      <div class="calendar-widget">
        <div class="calendar-widget__header">
          <button class="calendar-widget__year-prev"></button><button class="calendar-widget__month-prev"></button>
          <span class="calendar-widget__month-label"></span>
          <button class="calendar-widget__month-next"></button><button class="calendar-widget__year-next"></button>
        </div>
        <div class="calendar-widget__weekdays">${Array.from({ length: 7 }, () => '<abbr class="calendar-widget__weekday"></abbr>').join('')}</div>
        <div class="calendar-widget__grid" role="grid"></div>
        <div class="calendar-widget__footer"><button class="calendar-widget__today-btn">Today</button><button class="calendar-widget__clear-btn">Clear</button><button class="calendar-widget__commit-btn" hidden>Use dates</button></div>
      </div>
    </template>`;
}

describe('calendar route display filter (AC-CALX-041/042)', () => {
  let app: Application;
  let controller: CalendarViewController;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-23T12:00:00'));
    localStorage.clear();
    document.body.innerHTML = fixture();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value() { this.setAttribute('open', ''); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value() { this.removeAttribute('open'); },
    });
    mocks.listEvents.mockResolvedValue([
      makeEvent({
        id: 'google-1',
        sync_context: {
          provider: 'google', account_id: 'personal', account_alias: 'Personal',
          calendar_id: 'primary', calendar_name: 'Personal calendar', access_role: 'owner',
          writable: true, state: 'synced', allowed_conference_solution_types: [],
        },
      }),
      makeEvent({ id: 'jin-1', title: 'Local only' }),
    ]);
    mocks.listTasks.mockResolvedValue([]);
    mocks.listGoogleAccounts.mockResolvedValue([{
      id: 'personal', alias: 'Personal', principal: null, state: 'connected', auth_generation: 1,
      calendars: [{
        account_id: 'personal', calendar_id: 'primary', name: 'Personal calendar', primary: true,
        access_role: 'owner', writable: true, enabled: true, available: true, route_generation: 1,
        allowed_conference_solution_types: [],
      }],
    }]);
    app = Application.start();
    app.register('calendar-view', CalendarViewController);
    app.register('calendar', CalendarController);
    await flush();
    controller = app.getControllerForElementAndIdentifier(
      document.querySelector('section')!,
      'calendar-view',
    ) as CalendarViewController;
    await controller.loadCalendar();
    await flush();
  });

  afterEach(() => {
    controller?.disconnect();
    app?.stop();
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('toggles visibility without Settings/sync enablement bridge writes', async () => {
    const googleKey = googleCalendarKey('personal', 'primary');
    const row = document.querySelector<HTMLInputElement>(`.calendar-filter input[data-calendar-key="${googleKey}"]`)!;
    expect(row).toBeTruthy();
    expect(row.checked).toBe(true);
    expect(document.querySelector('[data-event-id="google-1"]')).toBeTruthy();

    row.checked = false;
    row.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(document.querySelector('[data-event-id="google-1"]')).toBeNull();
    expect(document.querySelector('[data-event-id="jin-1"]')).toBeTruthy();
    expect(loadCalendarVisibility()[googleKey]).toBe(false);
    expect(localStorage.getItem(CALENDAR_VISIBILITY_STORAGE_KEY)).toContain(googleKey);

    expect(invoke.setGoogleCalendarEnabled).not.toHaveBeenCalled();
    expect(invoke.connectGoogleAccount).not.toHaveBeenCalled();
    expect(invoke.disconnectGoogleAccount).not.toHaveBeenCalled();
    expect(invoke.runSync).not.toHaveBeenCalled();
    expect(invoke.addGoogleAccount).not.toHaveBeenCalled();
  });

  it('shows all-hidden empty state and Reset restores visibility', async () => {
    for (const key of [JIN_CALENDAR_KEY, googleCalendarKey('personal', 'primary')]) {
      const input = document.querySelector<HTMLInputElement>(`.calendar-filter input[data-calendar-key="${key}"]`)!;
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await flush();

    const empty = document.querySelector('.calendar-filter-empty')!;
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/All calendars are hidden|Reset/i);
    expect(document.querySelector('.calendar-day-grid')).toBeNull();

    document.querySelector<HTMLButtonElement>('.calendar-filter-empty__reset')!.click();
    expect(document.querySelector('.calendar-filter-empty')).toBeNull();
    expect(document.querySelector('.calendar-day-grid')).toBeTruthy();
    expect(document.querySelector('[data-event-id="google-1"]')).toBeTruthy();
    expect(document.querySelector('[data-event-id="jin-1"]')).toBeTruthy();
    expect(loadCalendarVisibility()).toEqual({});
  });
});
