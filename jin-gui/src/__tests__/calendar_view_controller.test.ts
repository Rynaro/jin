// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import CalendarViewController, { eventIntersectsDate } from '../controllers/calendar_view_controller';
import CalendarController from '../controllers/calendar_controller';
import { initIcons } from '../lib/icons';
import type { EventDto } from '../types/dto';

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(), createEvent: vi.fn(),
  deleteEvent: vi.fn(), promoteTask: vi.fn(), listTasks: vi.fn(),
  previewRecurrence: vi.fn(),
}));

vi.mock('../invoke', () => mocks);
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'event-1', title: 'Overnight workshop', description: 'Keep this description',
    location: 'Studio 4', start: '2026-08-20T23:30:00', end: '2026-08-22T01:15:00',
    is_all_day: false, start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo',
    floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: 'event-1@jin',
    derived_from: null, recurrence: [], recurring_event_id: null, original_start: null,
    master_id: null, recurrence_unexpanded: false, sequence: 3,
    created: '2026-08-01T10:00:00-03:00', updated: '2026-08-01T10:00:00-03:00', backlinks: [],
    ...overrides,
  };
}

function fixture(): string {
  return `
    <section data-controller="calendar-view" data-action="jin:events-mutated@window->calendar-view#handleMutation" aria-label="Calendar">
      <div data-calendar-view-target="monthView"><div data-calendar-view-target="monthViewContent"></div></div>
      <div data-calendar-view-target="dayView" class="hidden"><div data-calendar-view-target="dayViewContent"></div></div>
      <div data-events-target="detailPanel" class="hidden"></div>
      <button class="calendar-global-add" data-calendar-view-target="createEventBtn"></button>
      <dialog data-calendar-view-target="eventModal" aria-labelledby="event-dialog-title">
        <h2 id="event-dialog-title">New Event</h2>
        <input data-calendar-view-target="eventTitle">
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('CalendarViewController safety and mode invariants', () => {
  let app: Application;
  let controller: CalendarViewController;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-20T12:00:00'));
    localStorage.clear();
    document.body.innerHTML = fixture();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value() { this.setAttribute('open', ''); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value() { this.removeAttribute('open'); },
    });
    const event = makeEvent();
    mocks.listEvents.mockReset().mockResolvedValue([event]);
    mocks.listTasks.mockReset().mockResolvedValue([]);
    mocks.createEvent.mockReset().mockResolvedValue(event);
    mocks.deleteEvent.mockReset().mockResolvedValue(event);
    mocks.promoteTask.mockReset().mockResolvedValue(event);
    mocks.previewRecurrence.mockReset().mockResolvedValue({
      recurrence: ['RRULE:FREQ=WEEKLY'],
      occurrences: ['2026-08-20T12:00:00-03:00', '2026-08-27T12:00:00-03:00', '2026-09-03T12:00:00-03:00'],
    });
    app = Application.start();
    app.register('calendar', CalendarController);
    app.register('calendar-view', CalendarViewController);
    await flush();
    const host = document.querySelector<HTMLElement>('[data-controller="calendar-view"]')!;
    controller = app.getControllerForElementAndIdentifier(host, 'calendar-view') as CalendarViewController;
    vi.mocked(initIcons).mockClear();
  });

  afterEach(() => {
    controller.disconnect();
    app.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('day rows route to authoritative detail without GUI-local mutation affordances', async () => {
    controller.selectDate('2026-08-20');
    const detail = document.querySelector<HTMLButtonElement>('.calendar-timegrid__event')!;

    expect(detail.dataset.eventId).toBe('event-1');
    expect(detail.querySelector('.calendar-event-actions')).toBeNull();
    expect(document.querySelector('[aria-label^="Edit "]')).toBeNull();
    expect(document.querySelector('[aria-label^="Delete "]')).toBeNull();
  });

  it('reloads an initially empty calendar when sync announces imported events', async () => {
    mocks.listEvents.mockResolvedValue([]);
    await controller.loadCalendar();
    expect(document.querySelector('[data-event-id="imported-google-event"]')).toBeNull();

    mocks.listEvents.mockResolvedValue([
      makeEvent({
        id: 'imported-google-event',
        title: 'Imported from Google',
        source: 'google',
        authority: 'google',
        start: '2026-08-20T14:00:00',
        end: '2026-08-20T15:00:00',
      }),
    ]);
    window.dispatchEvent(new CustomEvent('jin:events-mutated'));
    await flush();

    controller.selectDate('2026-08-20');
    expect(document.querySelector('[data-event-id="imported-google-event"]')?.textContent)
      .toContain('Imported from Google');
  });

  it('does not reload twice for mutations it already refreshes locally', async () => {
    mocks.listEvents.mockClear();

    controller.handleMutation(new CustomEvent('jin:events-mutated', {
      detail: { source: 'calendar-view' },
    }));
    await flush();

    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('keeps the calendar modal create-only; detail owns all edit behavior', () => {
    expect((controller as unknown as { openEventEdit?: unknown }).openEventEdit).toBeUndefined();
    controller.openEventCreate();
    expect(document.querySelector<HTMLButtonElement>('[data-calendar-view-target="eventSubmit"]')?.textContent).toBe('Create');
    expect(document.querySelector('#event-dialog-title')?.textContent).toBe('New Event');
  });

  it('uses the shared range Calendar with no native date input and tranquil defaults', () => {
    controller.openEventCreate();
    expect(document.querySelector('[data-calendar-view-target="eventModal"] input[type="date"]')).toBeNull();
    expect(document.querySelector('[data-calendar-view-target="eventCalendar"] .calendar-widget')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventAllDay"]')?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')?.value).toBe('09:00');
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventEndTime"]')?.value).toBe('10:00');
    expect(document.activeElement).toBe(document.querySelector('[data-calendar-view-target="eventTitle"]'));
    expect(document.querySelector('.calendar-widget__commit-btn')?.hasAttribute('hidden')).toBe(true);
  });

  it('serializes an inclusive all-day range to an exclusive canonical end', async () => {
    controller.openEventCreate();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')!.value = 'Quiet retreat';
    document.querySelector<HTMLButtonElement>('.calendar-widget__day-btn[data-iso="2026-08-22"]')!.click();
    await controller.submitEvent();
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Quiet retreat', start: '2026-08-20', end: '2026-08-23', is_all_day: true,
    }));
  });

  it('builds a custom monthly recurrence and renders a next-three preview', async () => {
    controller.openEventCreate();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')!.value = 'Monthly review';
    const repeat = document.querySelector<HTMLSelectElement>('[data-calendar-view-target="eventRepeat"]')!;
    repeat.value = 'custom';
    document.querySelector<HTMLSelectElement>('[data-calendar-view-target="eventRepeatFrequency"]')!.value = 'monthly';
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventRepeatInterval"]')!.value = '2';
    document.querySelector<HTMLInputElement>('input[name="event-repeat-monthly"][value="nth_weekday"]')!.checked = true;
    document.querySelector<HTMLSelectElement>('[data-calendar-view-target="eventRepeatOrdinal"]')!.value = '-1';
    document.querySelector<HTMLSelectElement>('[data-calendar-view-target="eventRepeatOrdinalWeekday"]')!.value = 'th';
    document.querySelector<HTMLInputElement>('input[name="event-repeat-end"][value="count"]')!.checked = true;
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventRepeatCount"]')!.value = '6';
    controller.repeatChanged();
    await flush();

    expect(document.querySelector('[data-calendar-view-target="eventRepeatCustom"]')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-calendar-view-target="eventRepeatPreview"]')?.textContent).toContain('Next 3');
    await controller.submitEvent();
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(document.querySelector('[data-calendar-view-target="eventError"]')?.textContent).toContain('Google Calendar');
  });

  it('applies relative time with overnight rollover and preserves date-only time intent', () => {
    controller.openEventCreate();
    const input = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventWhenInput"]')!;
    input.value = 'tomorrow at 11:30 pm';
    controller.applyWhen();
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventAllDay"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')?.value).toBe('23:30');
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventEndTime"]')?.value).toBe('00:30');
    expect(document.querySelector<HTMLElement>('[data-calendar-view-target="eventCalendar"]')?.dataset.pendingEnd).toBe('2026-08-22');
    input.value = 'in 3 days';
    controller.applyWhen();
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventAllDay"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')?.value).toBe('23:30');
  });

  it('keeps invalid natural input from mutating the last valid range', () => {
    controller.openEventCreate();
    const input = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventWhenInput"]')!;
    input.value = 'tomorrow';
    controller.applyWhen();
    const calendar = document.querySelector<HTMLElement>('[data-calendar-view-target="eventCalendar"]')!;
    const before = { ...calendar.dataset };
    input.value = 'sometime soon';
    controller.applyWhen();
    expect(calendar.dataset.pendingStart).toBe(before.pendingStart);
    expect(calendar.dataset.pendingEnd).toBe(before.pendingEnd);
    expect(document.querySelector<HTMLElement>('[data-calendar-view-target="eventWhenPreview"]')?.dataset.state).toBe('error');
  });

  it('reformats a cached valid preview on locale change without reparsing or losing the draft', () => {
    controller.openEventCreate();
    const input = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventWhenInput"]')!;
    input.value = 'tomorrow at noon';
    controller.previewWhen();
    localStorage.setItem('jin:event-locale', 'pt-BR');
    controller.localeChanged();
    expect(input.value).toBe('tomorrow at noon');
    expect(document.querySelector('[data-event-copy="when"]')?.textContent).toContain('Quando');
    expect(document.querySelector<HTMLElement>('[data-calendar-view-target="eventWhenPreview"]')?.textContent).toContain('às');
    expect(document.querySelector('.calendar-widget__today-btn')?.textContent).toBe('Hoje');
    expect(document.querySelector('#event-dialog-title')?.textContent).toBe('Novo evento');
    const submit = document.querySelector<HTMLButtonElement>('[data-calendar-view-target="eventSubmit"]');
    expect(submit?.textContent).toBe('Criar');
    expect(submit?.getAttribute('aria-label')).toBe('Criar evento');
  });

  it('rejects malformed or backwards timed intervals locally and keeps the draft', async () => {
    controller.openEventCreate();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')!.value = 'Still here';
    const allDay = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventAllDay"]')!;
    allDay.checked = false;
    controller.toggleAllDay();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')!.value = '11:00';
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventEndTime"]')!.value = '10:00';
    await controller.submitEvent();
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')?.value).toBe('Still here');
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')!.value = 'bad';
    await controller.submitEvent();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it('normalizes compact clocks before creating a timed event', async () => {
    controller.openEventCreate();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')!.value = 'Afternoon review';
    const allDay = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventAllDay"]')!;
    allDay.checked = false;
    controller.toggleAllDay();
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventStartTime"]')!.value = '16';
    document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventEndTime"]')!.value = '1730';

    await controller.submitEvent();

    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      start: expect.stringContaining('T16:00:00'),
      end: expect.stringContaining('T17:30:00'),
      is_all_day: false,
    }));
  });

  it('allows at most one Create in flight and preserves the complete draft on failure', async () => {
    controller.openEventCreate();
    const title = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')!;
    const location = document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventLocation"]')!;
    title.value = 'Slow morning';
    location.value = 'Garden';
    let rejectCreate: (reason: Error) => void = () => {};
    mocks.createEvent.mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    const first = controller.submitEvent();
    const second = controller.submitEvent();
    expect(mocks.createEvent).toHaveBeenCalledTimes(1);
    rejectCreate(new Error('offline'));
    await Promise.all([first, second]);
    expect(title.value).toBe('Slow morning');
    expect(location.value).toBe('Garden');
    expect(document.querySelector('[data-calendar-view-target="eventModal"]')?.hasAttribute('open')).toBe(true);
  });

  it('locale rerender leaves calendar hidden while event detail is open', () => {
    const month = document.querySelector<HTMLElement>('[data-calendar-view-target="monthView"]')!;
    const detail = document.querySelector<HTMLElement>('[data-events-target="detailPanel"]')!;
    month.classList.add('hidden');
    detail.classList.remove('hidden');
    localStorage.setItem('jin:event-locale', 'pt-BR');

    controller.localeChanged();

    expect(month.classList.contains('hidden')).toBe(true);
    expect(detail.classList.contains('hidden')).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('.form-actions .btn-secondary')?.textContent).toBe('Cancelar');
    expect(document.querySelector<HTMLInputElement>('[data-calendar-view-target="eventTitle"]')?.placeholder).toBe('Título do evento');
    expect(document.querySelector('section')?.getAttribute('aria-label')).toBe('Calendário');
    expect(document.querySelector<HTMLButtonElement>('.calendar-global-add')?.textContent).toBe('+ Adicionar evento');
    expect(document.querySelector<HTMLButtonElement>('.calendar-global-add')?.getAttribute('aria-label')).toBe('Adicionar evento');
  });

  it('localizes month grid event counts and event actions', () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    controller.localeChanged();

    expect(document.querySelector<HTMLButtonElement>('[data-date="2026-08-20"]')?.getAttribute('aria-label')).toBe('20 (1 evento)');
    expect(document.querySelector<HTMLButtonElement>('.calendar-event-chip')?.getAttribute('aria-label')).toBe('Ver Overnight workshop');
  });

  it('keeps month dates on the existing Day-view activation path', () => {
    const date = document.querySelector<HTMLButtonElement>('[data-date="2026-08-20"]')!;
    date.click();

    expect(localStorage.getItem('jin:calendar-view')).toBe('day');
    expect(document.querySelector('[data-calendar-view-target="monthView"]')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-calendar-view-target="dayView"]')?.classList.contains('hidden')).toBe(false);
  });

  it('keeps month event chips on the authoritative detail path', () => {
    const navigations: unknown[] = [];
    document.querySelector('section')?.addEventListener('jin:navigate', event => navigations.push((event as CustomEvent).detail));
    const chip = document.querySelector<HTMLButtonElement>('.calendar-event-chip')!;

    chip.click();

    expect(chip.dataset.eventId).toBe('event-1');
    expect(navigations).toEqual([{ kind: 'events', id: 'event-1' }]);
    expect(document.querySelector('[data-calendar-view-target="monthView"]')?.classList.contains('hidden')).toBe(false);
  });

  it('keeps the first three real month event controls and truthful overflow', async () => {
    mocks.listEvents.mockResolvedValue([
      makeEvent({ id: 'event-1', title: 'First', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' }),
      makeEvent({ id: 'event-2', title: 'Second', start: '2026-08-20T10:00:00', end: '2026-08-20T11:00:00' }),
      makeEvent({ id: 'event-3', title: 'Third', start: '2026-08-20T11:00:00', end: '2026-08-20T12:00:00' }),
      makeEvent({ id: 'event-4', title: 'Fourth', start: '2026-08-20T12:00:00', end: '2026-08-20T13:00:00' }),
    ]);
    await controller.loadCalendar();
    const cell = document.querySelector<HTMLButtonElement>('[data-date="2026-08-20"]')!.closest('.calendar-day-cell')!;
    const chips = [...cell.querySelectorAll<HTMLButtonElement>('.calendar-event-chip')];

    expect(chips.map(chip => chip.dataset.eventId)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(chips.every(chip => chip.getAttribute('aria-label')?.startsWith('View '))).toBe(true);
    expect(cell.querySelector('.calendar-event-more')?.textContent).toBe('+1');
  });

  it('keeps Week active for Today and week navigation', () => {
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    controller.goToToday();

    expect(localStorage.getItem('jin:calendar-view')).toBe('week');
    expect(document.querySelector<HTMLButtonElement>('.calendar-view-switch__button[aria-pressed="true"]')?.textContent).toBe('Week');
    const before = document.querySelector<HTMLButtonElement>('.calendar-timegrid__date')?.textContent;
    controller.navigateNextMonth();
    const after = document.querySelector<HTMLButtonElement>('.calendar-timegrid__date')?.textContent;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('jin:calendar-view')).toBe('week');
    expect(document.querySelector('.calendar-timegrid--week')).not.toBeNull();
  });

  it('hydrates dynamic icons after switching from Month to Week', () => {
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });

    expect(initIcons).toHaveBeenCalledTimes(1);
  });

  it('hydrates dynamic icons after navigating within Week', () => {
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    vi.mocked(initIcons).mockClear();

    controller.navigateNextMonth();

    expect(initIcons).toHaveBeenCalledTimes(1);
  });

  it('hydrates dynamic icons after switching from Week to Month', () => {
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    vi.mocked(initIcons).mockClear();

    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Month') button.click(); });

    expect(initIcons).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['external source', { source: 'google' }],
    ['external authority', { authority: 'google' }],
    ['recurrence', { recurrence: ['RRULE:FREQ=DAILY'] }],
    ['recurring_event_id', { recurring_event_id: 'master-1' }],
    ['original_start', { original_start: '2026-08-20T23:30:00' }],
    ['master_id', { master_id: 'master-1' }],
    ['recurrence_unexpanded', { recurrence_unexpanded: true }],
  ] satisfies Array<[string, Partial<EventDto>]>)('hides mutation controls for %s events',
    async (_condition, overrides) => {
      mocks.listEvents.mockResolvedValue([makeEvent(overrides)]);
      await controller.loadCalendar();
      controller.selectDate('2026-08-20');
      expect(document.querySelector('[aria-label^="Edit "]')).toBeNull();
      expect(document.querySelector('[aria-label^="Delete "]')).toBeNull();
    });

  it('renders Day as one chronological column and Week as seven columns on the same rail', () => {
    controller.selectDate('2026-08-20');
    expect(document.querySelector('.calendar-timegrid--day')).not.toBeNull();
    expect(document.querySelectorAll('.calendar-timegrid--day .calendar-timegrid__day')).toHaveLength(1);
    expect(document.querySelectorAll('.calendar-timegrid--day .calendar-timegrid__gutter')).toHaveLength(1);
    expect(document.querySelector('.calendar-events-list')).toBeNull();

    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    expect(document.querySelectorAll('.calendar-timegrid--week .calendar-timegrid__day')).toHaveLength(7);
    expect(document.querySelectorAll('.calendar-timegrid--week .calendar-timegrid__gutter')).toHaveLength(1);
  });

  it('keeps chronological controls focusable and routes activation to authoritative detail', async () => {
    mocks.listEvents.mockResolvedValue([
      makeEvent({ id: 'later', start: '2026-08-20T10:00:00', end: '2026-08-20T11:00:00' }),
      makeEvent({ id: 'earlier', start: '2026-08-20T09:00:00', end: '2026-08-20T10:30:00' }),
    ]);
    await controller.loadCalendar();
    controller.selectDate('2026-08-20');
    const controls = [...document.querySelectorAll<HTMLButtonElement>('.calendar-timegrid__event')];
    expect(controls.map(control => control.dataset.eventId)).toEqual(['earlier', 'later']);
    expect(controls.every(control => control.tabIndex === 0)).toBe(true);
    const navigations: unknown[] = [];
    document.querySelector('section')?.addEventListener('jin:navigate', event => navigations.push((event as CustomEvent).detail));
    controls[0].click();
    expect(navigations).toEqual([{ kind: 'events', id: 'earlier' }]);
  });

  it('renders exact source and Time block meaning beyond color in visible and accessible text', async () => {
    mocks.listEvents.mockResolvedValue([
      makeEvent({ id: 'jin', title: 'Jin event', start: '2026-08-20T09:00:00', end: '2026-08-20T10:00:00' }),
      makeEvent({ id: 'google', title: 'Google event', source: 'google', authority: 'google', start: '2026-08-20T10:00:00', end: '2026-08-20T11:00:00' }),
      makeEvent({ id: 'block', title: 'Block', derived_from: 'missing-task', start: '2026-08-20T11:00:00', end: '2026-08-20T12:00:00' }),
    ]);
    await controller.loadCalendar();
    controller.selectDate('2026-08-20');
    const jin = document.querySelector<HTMLButtonElement>('.calendar-timegrid [data-event-id="jin"]')!;
    const google = document.querySelector<HTMLButtonElement>('.calendar-timegrid [data-event-id="google"]')!;
    const block = document.querySelector<HTMLButtonElement>('.calendar-timegrid [data-event-id="block"]')!;
    expect(jin.textContent).toContain('Jin');
    expect(jin.getAttribute('aria-label')).toContain('Source: Jin');
    expect(google.textContent).toContain('Google');
    expect(google.getAttribute('aria-label')).toContain('Source: Google');
    expect(block.textContent).toContain('Time block');
    expect(block.getAttribute('aria-label')).toContain('Time block');
    expect(document.querySelector('.calendar-timegrid__source-glyph')).toBeNull();
  });

  it('keeps a long month-event title inside one of seven equal-width columns', async () => {
    const title = 'A deliberately very long calendar title that must never widen its day column';
    mocks.listEvents.mockResolvedValue([makeEvent({ title })]);
    await controller.loadCalendar();
    const chip = document.querySelector<HTMLButtonElement>('.calendar-event-chip')!;
    expect(chip.textContent).toBe(title);
    expect(chip.closest('.calendar-week-row')?.children).toHaveLength(7);
    expect(chip.dataset.calendarColor).toBe('accent');
  });

  it('keeps due Tasks after and outside the chronological Event grid', async () => {
    mocks.listTasks.mockResolvedValue([{ id: 'task-1', title: 'Due task', due: '2026-08-20', body: '', status: 'todo' }]);
    await controller.loadCalendar();
    controller.selectDate('2026-08-20');
    const timeline = document.querySelector('.calendar-timegrid')!;
    const task = document.querySelector('.calendar-task-item')!;
    expect(timeline.querySelector('.calendar-timegrid__surface')?.contains(task)).toBe(false);
    expect(task.closest('.calendar-timegrid__scroller')).toBe(timeline.querySelector('.calendar-timegrid__scroller'));
  });

  it('preserves internal vertical/horizontal scroll and Event focus across detail Back', async () => {
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    const scroller = document.querySelector<HTMLElement>('.calendar-timegrid__scroller')!;
    const event = document.querySelector<HTMLButtonElement>('.calendar-timegrid__event')!;
    scroller.scrollTop = 321;
    scroller.scrollLeft = 87;
    event.focus();
    event.click();
    expect((controller as unknown as { timelineScroll: { top: number; left: number } }).timelineScroll)
      .toMatchObject({ top: 321, left: 87 });
    controller.restoreActiveView(new CustomEvent('return', { detail: { focusEventId: event.dataset.eventId } }));
    expect((controller as unknown as { timelineScroll: { top: number; left: number } }).timelineScroll)
      .toMatchObject({ top: 321, left: 87 });
    await vi.advanceTimersByTimeAsync(20);
    const restored = document.querySelector<HTMLElement>('.calendar-timegrid__scroller')!;
    expect([restored.scrollTop, restored.scrollLeft]).toEqual([321, 87]);
    expect(document.activeElement?.getAttribute('data-event-id')).toBe(event.dataset.eventId);
  });

  it('keeps active-view-local nighttime choices across rerender and resets them on identity change', () => {
    controller.selectDate('2026-08-20');
    const early = document.querySelector<HTMLButtonElement>('.calendar-timegrid__night-toggle[data-band="early"]')!;
    expect(early.getAttribute('aria-expanded')).toBe('false');
    early.click();
    expect(early.getAttribute('aria-expanded')).toBe('true');
    controller.localeChanged();
    expect(document.querySelector('.calendar-timegrid__night-toggle[data-band="early"]')?.getAttribute('aria-expanded')).toBe('true');
    controller.restoreActiveView();
    expect(document.querySelector('.calendar-timegrid__night-toggle[data-band="early"]')?.getAttribute('aria-expanded')).toBe('true');
    controller.selectDate('2026-08-24');
    expect(document.querySelector('.calendar-timegrid__night-toggle[data-band="early"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('auto-expands occupied nighttime with an accurate summary and shared Week state', async () => {
    mocks.listEvents.mockResolvedValue([
      makeEvent({ id: 'early', start: '2026-08-17T02:00:00', end: '2026-08-17T03:00:00' }),
      makeEvent({ id: 'late', start: '2026-08-20T22:30:00', end: '2026-08-20T23:30:00' }),
    ]);
    await controller.loadCalendar();
    document.querySelectorAll<HTMLButtonElement>('.calendar-view-switch__button')
      .forEach(button => { if (button.textContent === 'Week') button.click(); });
    const early = document.querySelector<HTMLButtonElement>('.calendar-timegrid__night-toggle[data-band="early"]')!;
    const late = document.querySelector<HTMLButtonElement>('.calendar-timegrid__night-toggle[data-band="late"]')!;
    expect([early.getAttribute('aria-expanded'), late.getAttribute('aria-expanded')]).toEqual(['true', 'true']);
    expect(early.textContent).toContain('1 event');
    expect(early.textContent).toContain('2:00 AM');
    expect(early.title).toBe(early.textContent);
    expect(early.getAttribute('aria-label')).toContain(early.textContent);
    early.click();
    expect(early.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-event-id="early"]')).not.toBeNull();
    expect(document.querySelectorAll('.calendar-timegrid__day')).toHaveLength(7);
  });

  it('updates one today marker in place and keeps one timer without rebuilding or moving focus', async () => {
    controller.selectDate('2026-08-20');
    const scroller = document.querySelector<HTMLElement>('.calendar-timegrid__scroller')!;
    const event = document.querySelector<HTMLButtonElement>('.calendar-timegrid__event')!;
    const beforeMarker = document.querySelector<HTMLElement>('.calendar-timegrid__now')!;
    const beforePosition = beforeMarker.style.getPropertyValue('--calendar-now');
    await vi.advanceTimersByTimeAsync(20);
    scroller.scrollTop = 222;
    event.focus();
    expect(document.querySelectorAll('.calendar-timegrid__now')).toHaveLength(1);
    const timerBefore = (controller as unknown as { nowTimer: ReturnType<typeof setTimeout> | null }).nowTimer;
    expect(timerBefore).not.toBeNull();
    (controller as unknown as { scheduleNowRefresh: () => void }).scheduleNowRefresh();
    expect((controller as unknown as { nowTimer: ReturnType<typeof setTimeout> | null }).nowTimer).toBe(timerBefore);
    await vi.advanceTimersByTimeAsync(60_000);
    const afterEvent = document.querySelector<HTMLButtonElement>('.calendar-timegrid__event')!;
    const afterMarker = document.querySelector<HTMLElement>('.calendar-timegrid__now')!;
    expect(afterEvent).toBe(event);
    expect(afterMarker).toBe(beforeMarker);
    expect(afterMarker.style.getPropertyValue('--calendar-now')).not.toBe(beforePosition);
    expect(scroller.scrollTop).toBe(222);
    expect(document.activeElement).toBe(event);
    controller.localeChanged();
    expect((controller as unknown as { nowTimer: ReturnType<typeof setTimeout> | null }).nowTimer).not.toBeNull();
    controller.disconnect();
    expect((controller as unknown as { nowTimer: ReturnType<typeof setTimeout> | null }).nowTimer).toBeNull();
  });

  it('defers initial scroll until a hidden route activates and never overrides later user scroll', async () => {
    const positions = new WeakMap<HTMLElement, number>();
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() { return positions.get(this) ?? 0; },
      set(value: number) { positions.set(this, this.isConnected ? value : 0); },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() { return this.closest('.hidden') ? 0 : 400; },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return this.closest('.hidden') ? 0 : 1200; },
    });
    try {
      mocks.listEvents.mockResolvedValue([
        makeEvent({ start: '2026-08-20T02:00:00', end: '2026-08-20T03:00:00' }),
      ]);
      await controller.loadCalendar();
      const route = document.querySelector<HTMLElement>('[data-controller="calendar-view"]')!;
      route.classList.add('hidden');
      controller.selectDate('2026-08-20');
      await vi.advanceTimersByTimeAsync(20);
      expect(document.querySelector<HTMLElement>('.calendar-timegrid__scroller')?.scrollTop).toBe(0);
      expect((controller as unknown as { timelineScroll: { initialized: boolean } }).timelineScroll.initialized).toBe(false);

      route.classList.remove('hidden');
      controller.activateSection();
      await vi.advanceTimersByTimeAsync(20);
      expect(document.querySelector<HTMLElement>('.calendar-timegrid__scroller')?.scrollTop).toBeCloseTo(54);

      controller.selectDate('2026-08-24');
      await vi.advanceTimersByTimeAsync(20);
      expect(document.querySelector<HTMLElement>('.calendar-timegrid__scroller')?.scrollTop).toBeCloseTo(156.6);

      route.classList.add('hidden');
      controller.selectDate('2026-08-25');
      route.classList.remove('hidden');
      const manuallyScrolled = document.querySelector<HTMLElement>('.calendar-timegrid__scroller')!;
      manuallyScrolled.scrollTop = 211;
      manuallyScrolled.dispatchEvent(new Event('scroll'));
      controller.activateSection();
      await vi.advanceTimersByTimeAsync(20);
      expect(manuallyScrolled.scrollTop).toBe(211);
    } finally {
      if (scrollTopDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
      if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
  });

  it('uses locale-native hour cycles and localized timeline accessibility copy', () => {
    localStorage.setItem('jin:event-locale', 'pt-BR');
    controller.localeChanged();
    controller.selectDate('2026-08-20');
    expect(document.querySelector('.calendar-timegrid')?.getAttribute('aria-label')).toBe('Linha do tempo do dia');
    expect(document.querySelector<HTMLElement>('.calendar-timegrid__hour-label[data-minute="0"]')?.textContent).toBe('0:00');
    expect(document.querySelector('.calendar-timegrid__all-day-label')?.textContent).toBe('Dia inteiro');
  });
});

describe('half-open calendar projection', () => {
  it.each([
    ['single-day all-day start', makeEvent({ start: '2026-08-20', end: '2026-08-21', is_all_day: true }), '2026-08-20', true],
    ['single-day all-day exclusive end', makeEvent({ start: '2026-08-20', end: '2026-08-21', is_all_day: true }), '2026-08-21', false],
    ['multi-day all-day first day', makeEvent({ start: '2026-08-20', end: '2026-08-23', is_all_day: true }), '2026-08-20', true],
    ['multi-day all-day middle day', makeEvent({ start: '2026-08-20', end: '2026-08-23', is_all_day: true }), '2026-08-22', true],
    ['multi-day all-day exclusive end', makeEvent({ start: '2026-08-20', end: '2026-08-23', is_all_day: true }), '2026-08-23', false],
    ['multi-day timed start day', makeEvent(), '2026-08-20', true],
    ['multi-day timed middle day', makeEvent(), '2026-08-21', true],
    ['multi-day timed end day before end time', makeEvent(), '2026-08-22', true],
    ['timed exclusive midnight end', makeEvent({ end: '2026-08-22T00:00:00' }), '2026-08-22', false],
    ['timed day after interval', makeEvent(), '2026-08-23', false],
  ])('%s', (_case, event, date, expected) => {
    expect(eventIntersectsDate(event, date)).toBe(expected);
  });
});
