/**
 * CalendarViewController — Main calendar browse + detail view (GUI-S4).
 *
 * This is the calendar section controller that displays events in a month view
 * inspired by Apple Calendar and Hey Calendar. Users can:
 * - View events in a monthly grid
 * - Click on a date to see that day's events
 * - Create new events from the calendar
 * - Edit and delete existing events
 * - Link events to tasks and notes
 *
 * Data flow (month view):
 *   loadCalendar() → listEvents() → transformToMonthGrid() → renderCalendarMonth()
 *
 * Data flow (day view):
 *   selectDate() → getEventsForDate() → renderDayEvents()
 *
 * Data flow (create event):
 *   openEventCreate() → showEventModal() → createEvent() → refreshCalendar()
 *
 * Connect pattern: data-controller="calendar-view" on the calendar <section> element.
 *
 * Targets:
 *   monthView        — month grid container
 *   dayView          — day detail container (hidden by default)
 *   monthViewTarget  — where the month grid is rendered
 *   dayViewTarget    — where day events are listed
 *   createEventBtn   — button to create new event
 *   eventModal       — modal for creating/editing events
 */

import { Controller } from '@hotwired/stimulus';
import {
  listEvents, createEvent, createRoutedEvent, deleteEvent, promoteTask,
  listGoogleAccounts, listTasks, newOperationId, previewRecurrence,
} from '../invoke';
import type { MonthlyRecurrence, RecurrenceDraft, RecurrenceEnd, RecurrenceWeekday } from '../invoke';
import { isJinErrorDto } from '../types/error';
import type { EventDto, TaskDto } from '../types/dto';
import { initIcons } from '../lib/icons';
import { eventMessage, resolveEventLocale } from '../lib/events/locale';
import { normalizeClockInput } from '../lib/calendar/clock';
import CalendarController, { type CalendarSelection } from './calendar_controller';
import {
  formatNaturalDateResult,
  naturalDateErrorMessage,
  parseNaturalDateTime,
  type NaturalDateErrorCode,
  type NaturalDateResult,
} from '../lib/calendar/natural_language';
import {
  deriveNightExpansion,
  buildTimeGrid,
  GRID_PX_PER_MINUTE,
  initialScrollMinute,
  projectedMinute,
  type NightBand,
  type NightExpansion,
} from '../lib/calendar/time_grid';
import { renderTimeGrid, type RenderedTimeGrid } from '../lib/calendar/time_grid_render';
import { normalizeRecurrenceDraft, recurrenceFromRepeatValue, recurrenceUiCopy } from '../lib/events/recurrence';
import { applyCalendarColor, calendarColorForEvent } from '../lib/calendar/colors';

/** Half-open projection of an event interval onto one local calendar day. */
export function eventIntersectsDate(event: EventDto, dateStr: string): boolean {
  const dayStart = `${dateStr}T00:00:00`;
  const next = new Date(`${dateStr}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const dayEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}T00:00:00`;
  const start = event.start.length === 10 ? `${event.start}T00:00:00` : event.start;
  const end = event.end.length === 10 ? `${event.end}T00:00:00` : event.end;
  return start < dayEnd && end > dayStart;
}

interface CalendarDay {
  date: string; // ISO date (YYYY-MM-DD)
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: EventDto[];
}

interface CalendarMonth {
  year: number;
  month: number; // 1-12
  weeks: CalendarDay[][];
}

export default class CalendarViewController extends Controller {
  static targets = [
    'monthView',
    'dayView',
    'monthViewContent',
    'dayViewContent',
    'createEventBtn',
    'eventModal',
    'eventTitle',
    'eventDestination',
    'eventCalendar',
    'eventWhenInput',
    'eventWhenPreview',
    'eventWhenSummary',
    'eventAllDay',
    'eventStartTime',
    'eventEndTime',
    'eventLocation',
    'eventDescription',
    'eventRepeat',
    'eventRepeatCustom',
    'eventRepeatInterval',
    'eventRepeatFrequency',
    'eventRepeatWeekdays',
    'eventRepeatMonthlyMode',
    'eventRepeatMonthDay',
    'eventRepeatOrdinal',
    'eventRepeatOrdinalWeekday',
    'eventRepeatEndKind',
    'eventRepeatUntil',
    'eventRepeatCount',
    'eventRepeatPreview',
    'eventError',
    'eventSubmit',
    'timeGroup',
  ];

  declare monthViewTarget: HTMLElement;
  declare dayViewTarget: HTMLElement;
  declare monthViewContentTarget: HTMLElement;
  declare dayViewContentTarget: HTMLElement;
  declare createEventBtnTarget: HTMLButtonElement;
  declare eventModalTarget: HTMLDialogElement;
  declare eventTitleTarget: HTMLInputElement;
  declare eventDestinationTarget: HTMLSelectElement;
  declare readonly hasEventDestinationTarget: boolean;
  declare eventCalendarTarget: HTMLElement;
  declare eventWhenInputTarget: HTMLInputElement;
  declare eventWhenPreviewTarget: HTMLElement;
  declare eventWhenSummaryTarget: HTMLElement;
  declare eventAllDayTarget: HTMLInputElement;
  declare eventStartTimeTarget: HTMLInputElement;
  declare eventEndTimeTarget: HTMLInputElement;
  declare eventLocationTarget: HTMLInputElement;
  declare eventDescriptionTarget: HTMLTextAreaElement;
  declare eventRepeatTarget: HTMLSelectElement;
  declare readonly hasEventRepeatTarget: boolean;
  declare eventRepeatCustomTarget: HTMLElement;
  declare eventRepeatIntervalTarget: HTMLInputElement;
  declare eventRepeatFrequencyTarget: HTMLSelectElement;
  declare eventRepeatWeekdaysTarget: HTMLFieldSetElement;
  declare eventRepeatMonthlyModeTarget: HTMLFieldSetElement;
  declare eventRepeatMonthDayTarget: HTMLInputElement;
  declare eventRepeatOrdinalTarget: HTMLSelectElement;
  declare eventRepeatOrdinalWeekdayTarget: HTMLSelectElement;
  declare eventRepeatEndKindTargets: HTMLInputElement[];
  declare eventRepeatUntilTarget: HTMLInputElement;
  declare eventRepeatCountTarget: HTMLInputElement;
  declare eventRepeatPreviewTarget: HTMLElement;
  declare eventErrorTarget: HTMLElement;
  declare eventSubmitTarget: HTMLButtonElement;
  declare timeGroupTarget: HTMLElement;

  // Current calendar state
  private currentMonth: number = 0;
  private currentYear: number = 0;
  private allEvents: EventDto[] = [];
  private allTasks: TaskDto[] = [];
  private selectedDate: string | null = null;
  private viewMode: 'month' | 'week' | 'day' = 'month';
  private previousBrowseMode: 'month' | 'week' = 'month';
  private timeline: RenderedTimeGrid | null = null;
  private timelineIdentity: string | null = null;
  private nightManual: Partial<Record<NightBand, boolean>> = {};
  private nightMonotonic: NightExpansion = { early: false, late: false };
  private timelineScroll = { top: 0, left: 0, focusEventId: null as string | null, initialized: false };
  private pendingTimelineScroll: { rendered: RenderedTimeGrid; identity: string; top: number; left: number } | null = null;
  private timelineLayoutObserver: ResizeObserver | null = null;
  private timelineScrollFrame: number | null = null;
  private nowTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private submitPending = false;
  private cachedNaturalResult: Extract<NaturalDateResult, { ok: true }> | null = null;
  private cachedNaturalError: NaturalDateErrorCode | null = null;
  private writableDestinationCount = 0;
  private recurrencePreviewRevision = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.connected = true;
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1; // 1-12
    const savedMode = localStorage.getItem('jin:calendar-view');
    if (savedMode === 'month' || savedMode === 'week' || savedMode === 'day') this.viewMode = savedMode;
    this.selectedDate = this.toISODate(today);

    this.localizeCalendarShell();
    this.localizeEventEditor();
    if (this.hasEventDestinationTarget) void this.populateEventDestinations();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('jin:calendar-colors-changed', this.handleCalendarColorsChanged);
    void this.loadCalendar();
  }

  disconnect(): void {
    this.connected = false;
    this.cancelNowTimer();
    this.cancelPendingTimelineScroll();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('jin:calendar-colors-changed', this.handleCalendarColorsChanged);
    this.timeline = null;
    this.timelineIdentity = null;
    this.nightManual = {};
    this.nightMonotonic = { early: false, late: false };
  }

  private readonly handleCalendarColorsChanged = (): void => {
    if (this.connected) this.renderCurrentView();
  };

  // ── Public actions ────────────────────────────────────────────────────────

  activateSection(): void {
    queueMicrotask(() => this.applyPendingTimelineScroll());
    this.schedulePendingTimelineScrollFrame();
  }

  async loadCalendar(): Promise<void> {
    try {
      this.allEvents = await listEvents();
      if (!this.connected) return;
      this.allTasks = await listTasks();
      if (!this.connected) return;
      this.renderCurrentView();
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        this.dispatch('error', { detail: { message: err instanceof Error ? err.message : eventMessage('failedLoadCalendar') }, prefix: 'app', bubbles: true });
      }
    }
  }

  navigatePrevMonth(): void {
    this.navigateBy(-1);
  }

  navigateNextMonth(): void {
    this.navigateBy(1);
  }

  goToToday(): void {
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1;
    this.selectedDate = this.toISODate(today);
    this.renderCurrentView();
  }

  handleDateClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest('.calendar-day-button') as HTMLButtonElement;
    if (button) {
      const dateStr = button.getAttribute('data-date');
      if (dateStr) {
        this.selectDate(dateStr);
      }
    }
  }

  selectDate(dateStr: string): void {
    if (this.viewMode === 'month' || this.viewMode === 'week') this.previousBrowseMode = this.viewMode;
    this.selectedDate = dateStr;
    this.viewMode = 'day';
    localStorage.setItem('jin:calendar-view', this.viewMode);
    this.renderDayView(dateStr);

    // Switch to day view
    this.monthViewTarget.classList.add('hidden');
    this.dayViewTarget.classList.remove('hidden');
  }

  backToMonthView(): void {
    this.resetTimelineIdentity();
    this.viewMode = this.previousBrowseMode;
    localStorage.setItem('jin:calendar-view', this.viewMode);
    this.renderCurrentView();
  }

  restoreActiveView(event?: Event): void {
    const savedTimelineScroll = { ...this.timelineScroll };
    this.renderCurrentView();
    const detail = (event as CustomEvent<{ scrollTop?: number; focusEventId?: string }> | undefined)?.detail;
    if (this.timeline) {
      this.timelineScroll = savedTimelineScroll;
      const focusId = detail?.focusEventId ?? savedTimelineScroll.focusEventId;
      if (focusId) {
        Array.from(this.timeline.root.querySelectorAll<HTMLButtonElement>('[data-event-id]'))
          .find(control => control.dataset.eventId === focusId)
          ?.focus({ preventScroll: true });
      }
      this.timeline.scroller.scrollTop = savedTimelineScroll.top;
      this.timeline.scroller.scrollLeft = savedTimelineScroll.left;
    }
    requestAnimationFrame(() => {
      if (this.timeline) {
        const focusId = detail?.focusEventId ?? savedTimelineScroll.focusEventId;
        if (focusId) {
          Array.from(this.timeline.root.querySelectorAll<HTMLButtonElement>('[data-event-id]'))
            .find(control => control.dataset.eventId === focusId)
            ?.focus({ preventScroll: true });
        }
        this.timeline.scroller.scrollTop = savedTimelineScroll.top;
        this.timeline.scroller.scrollLeft = savedTimelineScroll.left;
        return;
      }
      const panel = this.viewMode === 'day' ? this.dayViewTarget : this.monthViewTarget;
      panel.scrollTop = detail?.scrollTop ?? 0;
      if (detail?.focusEventId) {
        Array.from(panel.querySelectorAll<HTMLElement>('[data-event-id]'))
          .find(control => control.dataset.eventId === detail.focusEventId)
          ?.focus();
      }
    });
  }

  localeChanged(): void {
    this.localizeCalendarShell();
    this.localizeEventEditor();
    if (!this.element.querySelector('[data-events-target="detailPanel"]:not(.hidden)')) {
      this.renderCurrentView();
    }
  }

  handleEventEdited(event: Event): void {
    const edited = (event as CustomEvent<{ event?: EventDto }>).detail?.event;
    if (!edited) return;
    const index = this.allEvents.findIndex(candidate => candidate.id === edited.id);
    if (index >= 0) this.allEvents[index] = edited;
    else this.allEvents.push(edited);
  }

  handleMutation(event: Event): void {
    const source = (event as CustomEvent<{ source?: string }>).detail?.source;
    if (source === 'calendar-view') return;
    void this.loadCalendar();
  }

  private localizeCalendarShell(locale = resolveEventLocale()): void {
    this.element.setAttribute('aria-label', eventMessage('calendar', locale));
    this.createEventBtnTarget.textContent = `+ ${eventMessage('addEvent', locale)}`;
    this.createEventBtnTarget.setAttribute('aria-label', eventMessage('addEvent', locale));
  }

  openEventCreate(): void {
    if (this.submitPending) return;
    this.resetEventForm();
    this.eventModalTarget.showModal();
    this.eventTitleTarget.focus();
  }

  toggleAllDay(): void {
    const isAllDay = this.eventAllDayTarget.checked;
    if (isAllDay) {
      this.timeGroupTarget.classList.add('hidden');
    } else {
      this.timeGroupTarget.classList.remove('hidden');
    }
    void this.updateRecurrencePreview();
  }

  closeEventDialog(): void {
    this.eventModalTarget.close();
    this.resetEventForm();
  }

  previewWhen(): void {
    const locale = resolveEventLocale();
    const result = parseNaturalDateTime({
      input: this.eventWhenInputTarget.value,
      today: this.toISODate(new Date()),
      locale,
    });
    if (result.ok) {
      this.cachedNaturalResult = result;
      this.cachedNaturalError = null;
      this.eventWhenPreviewTarget.textContent = formatNaturalDateResult(result, locale);
      this.eventWhenPreviewTarget.dataset.state = 'valid';
    } else {
      this.cachedNaturalResult = null;
      this.cachedNaturalError = result.code;
      this.eventWhenPreviewTarget.textContent = naturalDateErrorMessage(result.code, locale);
      this.eventWhenPreviewTarget.dataset.state = 'error';
    }
  }

  applyWhen(event?: Event): void {
    event?.preventDefault();
    this.previewWhen();
    const result = this.cachedNaturalResult;
    if (!result) return;
    let endDate = result.date;
    if (result.time) {
      const [hours, minutes] = result.time.split(':').map(Number);
      const endMinutes = hours * 60 + minutes + 60;
      this.eventAllDayTarget.checked = false;
      this.eventStartTimeTarget.value = result.time;
      this.eventEndTimeTarget.value = `${String(Math.floor((endMinutes % 1440) / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      if (endMinutes >= 1440) endDate = this.addDays(result.date, 1);
      this.toggleAllDay();
    }
    this.setEventRange(result.date, endDate, endDate !== result.date);
  }

  calendarSelectionChanged(event: Event): void {
    const selection = (event as CustomEvent<CalendarSelection>).detail;
    if (selection.mode !== 'range') return;
    this.eventCalendarTarget.dataset.pendingStart = selection.start;
    this.eventCalendarTarget.dataset.pendingEnd = selection.end;
    this.updateWhenSummary(selection.start, selection.end);
    this.clearEventError();
    if (this.hasEventRepeatTarget && this.eventRepeatTarget.value !== 'none') void this.updateRecurrencePreview();
  }

  repeatChanged(): void {
    if (!this.hasEventRepeatTarget) return;
    const custom = this.eventRepeatTarget.value === 'custom';
    this.eventRepeatCustomTarget.classList.toggle('hidden', !custom);
    if (custom) {
      const frequency = this.eventRepeatFrequencyTarget.value;
      this.eventRepeatWeekdaysTarget.classList.toggle('hidden', frequency !== 'weekly');
      this.eventRepeatMonthlyModeTarget.classList.toggle('hidden', frequency !== 'monthly');
    }
    const enabled = this.eventRepeatTarget.value !== 'none';
    this.eventRepeatPreviewTarget.classList.toggle('hidden', !enabled);
    if (enabled) void this.updateRecurrencePreview();
    else this.eventRepeatPreviewTarget.textContent = '';
  }

  normalizeEventTime(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const normalized = normalizeClockInput(input.value);
    if (normalized.ok && normalized.time) {
      input.value = normalized.time;
      this.clearEventError();
      this.repeatChanged();
    }
  }

  async submitEvent(): Promise<void> {
    if (this.submitPending) return;
    const title = this.eventTitleTarget.value.trim();
    const { start: dateStr, end: endDateStr } = this.getEventSelection();
    const isAllDay = this.eventAllDayTarget.checked;
    const location = this.eventLocationTarget.value.trim();
    const description = this.eventDescriptionTarget.value.trim();

    if (!title || !dateStr || !endDateStr) {
      this.showEventError(eventMessage('titleDateRequired'));
      return;
    }

    const normalizedStart = normalizeClockInput(this.eventStartTimeTarget.value);
    const normalizedEnd = normalizeClockInput(this.eventEndTimeTarget.value);
    if (!isAllDay && (!normalizedStart.ok || !normalizedStart.time || !normalizedEnd.ok || !normalizedEnd.time)) {
      this.showEventError(eventMessage('invalidTime'));
      return;
    }
    const startTime = normalizedStart.ok ? normalizedStart.time ?? '' : '';
    const endTime = normalizedEnd.ok ? normalizedEnd.time ?? '' : '';
    if (!isAllDay) {
      this.eventStartTimeTarget.value = startTime;
      this.eventEndTimeTarget.value = endTime;
    }

    try {
      this.submitPending = true;
      this.eventSubmitTarget.disabled = true;
      let start = dateStr;
      let end = endDateStr;

      if (isAllDay) {
        end = this.addDays(endDateStr, 1);
      } else {
        start = `${dateStr}T${startTime}:00`;
        end = `${endDateStr}T${endTime}:00`;
      }

      if (end <= start) {
        this.showEventError(eventMessage('endAfterStart'));
        return;
      }

      const recurrence = this.buildRecurrenceDraft();
      const destination = this.selectedEventDestination();
      if (recurrence && !destination) {
        this.showEventError(recurrenceUiCopy(resolveEventLocale()).googleRequired);
        if (this.hasEventDestinationTarget) this.eventDestinationTarget.focus();
        return;
      }
      const input = {
        title, start, end, is_all_day: isAllDay,
        tzid: !isAllDay && recurrence ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
        location: location || undefined, description: description || undefined,
        recurrence,
      };
      if (this.hasEventDestinationTarget && this.eventDestinationTarget.value === '') {
        this.showEventError('ambiguous_destination: Choose an exact account and calendar.');
        this.eventDestinationTarget.focus();
        return;
      }
      if (destination) {
        await createRoutedEvent({
          ...input,
          account_id: destination.accountId,
          calendar_id: destination.calendarId,
          operation_id: newOperationId('create'),
        });
      } else {
        await createEvent(input);
      }
      this.notifyMutation();

      // Refresh calendar data and views
      await this.loadCalendar();

      // Re-render day view if we were viewing a specific day
      if (this.selectedDate) {
        this.renderDayView(this.selectedDate);
      }

      // Close modal and reset form
      this.closeEventDialog();
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.showEventError(err.message || eventMessage('failedSaveEvent'));
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        this.showEventError(err instanceof Error ? err.message : eventMessage('failedSaveEvent'));
      }
    } finally {
      this.submitPending = false;
      this.eventSubmitTarget.disabled = false;
    }
  }

  private resetEventForm(): void {
    const locale = resolveEventLocale();
    this.eventTitleTarget.value = '';
    const date = this.selectedDate || this.toISODate(new Date());
    this.setEventRange(date, date, false);
    this.eventWhenInputTarget.value = '';
    this.cachedNaturalResult = null;
    this.cachedNaturalError = null;
    this.eventWhenPreviewTarget.textContent = eventMessage('relativeHint', locale);
    this.eventWhenPreviewTarget.dataset.state = '';
    this.eventAllDayTarget.checked = true;
    this.eventStartTimeTarget.value = '09:00';
    this.eventEndTimeTarget.value = '10:00';
    this.eventLocationTarget.value = '';
    this.eventDescriptionTarget.value = '';
    if (this.hasEventRepeatTarget) {
      this.eventRepeatTarget.value = 'none';
      this.eventRepeatIntervalTarget.value = '1';
      this.eventRepeatFrequencyTarget.value = 'weekly';
      this.eventRepeatMonthDayTarget.value = String(Number(date.slice(8, 10)));
      this.eventRepeatUntilTarget.value = this.addDays(date, 30);
      this.eventRepeatCountTarget.value = '10';
      this.eventRepeatEndKindTargets.forEach(input => { input.checked = input.value === 'never'; });
      const dayIndex = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
      this.eventRepeatWeekdaysTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input, index) => { input.checked = index === dayIndex; });
      this.eventRepeatOrdinalWeekdayTarget.value = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'][dayIndex];
      this.repeatChanged();
    }
    this.eventErrorTarget.classList.add('hidden');
    this.eventErrorTarget.textContent = '';
    this.timeGroupTarget.classList.add('hidden');

    // Reset modal to create mode
    const title = document.getElementById('event-dialog-title');
    if (title) title.textContent = eventMessage('newEvent', locale);
    this.eventSubmitTarget.textContent = eventMessage('create', locale);
    this.eventSubmitTarget.setAttribute('aria-label', eventMessage('createEvent', locale));
    this.localizeEventEditor(locale);
    this.eventModalTarget.removeAttribute('data-event-id');
    delete this.eventModalTarget.dataset.originalStart;
    delete this.eventModalTarget.dataset.originalEnd;
    delete this.eventModalTarget.dataset.originalTzid;
    delete this.eventModalTarget.dataset.originalAllDay;
  }

  private async populateEventDestinations(): Promise<void> {
    if (!this.hasEventDestinationTarget) return;
    const select = this.eventDestinationTarget;
    select.replaceChildren();
    let destinations: Array<{ accountId: string; calendarId: string; label: string }> = [];
    try {
      const accounts = await listGoogleAccounts();
      destinations = accounts.flatMap(account => account.calendars
        .filter(calendar => account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable)
        .map(calendar => ({
          accountId: account.id,
          calendarId: calendar.calendar_id,
          label: `${account.alias} · ${calendar.name}`,
        })));
    } catch {
      // Account discovery errors must not make local-only event creation unavailable.
    }
    this.writableDestinationCount = destinations.length;
    if (destinations.length > 1) select.append(new Option('Choose a destination', '', true, true));
    select.append(new Option('Jin only', 'local', destinations.length === 0, destinations.length === 0));
    for (const destination of destinations) {
      const option = new Option(destination.label, `${destination.accountId}\u0000${destination.calendarId}`);
      option.dataset.accountId = destination.accountId;
      option.dataset.calendarId = destination.calendarId;
      if (destinations.length === 1) option.selected = true;
      select.append(option);
    }
  }

  private buildRecurrenceDraft(): RecurrenceDraft | undefined {
    if (!this.hasEventRepeatTarget || this.eventRepeatTarget.value === 'none') return undefined;
    if (this.eventRepeatTarget.value !== 'custom') {
      return recurrenceFromRepeatValue(this.eventRepeatTarget.value);
    }
    const frequency = this.eventRepeatFrequencyTarget.value as RecurrenceDraft['frequency'];
    const weekly_days = Array.from(
      this.eventRepeatWeekdaysTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
      input => input.value as RecurrenceWeekday,
    );
    let monthly: MonthlyRecurrence | undefined;
    if (frequency === 'monthly') {
      const mode = this.eventRepeatMonthlyModeTarget.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value;
      monthly = mode === 'nth_weekday'
        ? {
            kind: 'nth_weekday',
            ordinal: Number(this.eventRepeatOrdinalTarget.value),
            weekday: this.eventRepeatOrdinalWeekdayTarget.value as RecurrenceWeekday,
          }
        : { kind: 'day_of_month', day: Number(this.eventRepeatMonthDayTarget.value) };
    }
    const endKind = this.eventRepeatEndKindTargets.find(input => input.checked)?.value;
    let end: RecurrenceEnd = { kind: 'never' };
    if (endKind === 'until' && this.eventRepeatUntilTarget.value) {
      end = { kind: 'until', date: this.eventRepeatUntilTarget.value };
    } else if (endKind === 'count') {
      end = { kind: 'count', count: Number(this.eventRepeatCountTarget.value) };
    }
    return normalizeRecurrenceDraft({
      frequency,
      interval: Number(this.eventRepeatIntervalTarget.value),
      weekly_days,
      monthly,
      end,
    });
  }

  private async updateRecurrencePreview(): Promise<void> {
    const recurrence = this.buildRecurrenceDraft();
    if (!recurrence) return;
    const revision = ++this.recurrencePreviewRevision;
    const { start: date } = this.getEventSelection();
    const isAllDay = this.eventAllDayTarget.checked;
    const start = isAllDay ? date : `${date}T${this.eventStartTimeTarget.value || '09:00'}:00`;
    try {
      const result = await previewRecurrence({
        start,
        tzid: isAllDay ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone,
        is_all_day: isAllDay,
        recurrence,
      });
      if (revision !== this.recurrencePreviewRevision) return;
      const locale = resolveEventLocale();
      const dates = result.occurrences.slice(0, 3).map(value => new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium', ...(!isAllDay ? { timeStyle: 'short' as const } : {}),
      }).format(new Date(isAllDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)));
      this.eventRepeatPreviewTarget.textContent = `${recurrenceUiCopy(locale).preview}: ${dates.join(' · ')}`;
    } catch {
      if (revision === this.recurrencePreviewRevision) this.eventRepeatPreviewTarget.textContent = '';
    }
  }

  private selectedEventDestination(): { accountId: string; calendarId: string } | null {
    if (!this.hasEventDestinationTarget) return null;
    const option = this.eventDestinationTarget.selectedOptions[0];
    if (!option || option.value === '' || option.value === 'local') return null;
    const accountId = option.dataset.accountId;
    const calendarId = option.dataset.calendarId;
    return accountId && calendarId ? { accountId, calendarId } : null;
  }

  private showEventError(message: string): void {
    this.eventErrorTarget.textContent = message;
    this.eventErrorTarget.classList.remove('hidden');
  }

  private clearEventError(): void {
    this.eventErrorTarget.textContent = '';
    this.eventErrorTarget.classList.add('hidden');
  }

  private localizeEventEditor(locale = resolveEventLocale()): void {
    const setLabel = (forId: string, key: Parameters<typeof eventMessage>[0]): void => {
      const label = this.eventModalTarget.querySelector<HTMLLabelElement>(`label[for="${forId}"]`);
      if (label) label.childNodes[0].textContent = `${eventMessage(key, locale)} `;
    };
    setLabel('event-title', 'title');
    setLabel('event-start-time', 'startTime');
    setLabel('event-end-time', 'endTime');
    setLabel('event-location', 'location');
    setLabel('event-description', 'description');
    const dialogTitle = this.eventModalTarget.querySelector<HTMLElement>('#event-dialog-title');
    if (dialogTitle) dialogTitle.textContent = eventMessage('newEvent', locale);
    this.eventSubmitTarget.textContent = eventMessage('create', locale);
    this.eventSubmitTarget.setAttribute('aria-label', eventMessage('createEvent', locale));
    const allDay = this.eventAllDayTarget.closest('label')?.querySelector<HTMLSpanElement>('span');
    if (allDay) allDay.textContent = eventMessage('allDay', locale);
    if (this.hasEventRepeatTarget) {
      const copy = recurrenceUiCopy(locale);
      const keys = ['repeat', 'every', 'onDays', 'monthlyOn', 'dayOfMonth', 'ends', 'never', 'onDate', 'after', 'occurrences'] as const;
      for (const key of keys) {
        const node = this.eventModalTarget.querySelector<HTMLElement>(`[data-recurrence-copy="${key}"]`);
        if (node) node.textContent = copy[key];
      }
      const options = this.eventRepeatTarget.options;
      [copy.none, copy.daily, copy.weekly, copy.monthly, copy.yearly, copy.custom].forEach((label, index) => {
        if (options[index]) options[index].textContent = label;
      });
      Array.from(this.eventRepeatFrequencyTarget.options).forEach((option, index) => { option.textContent = copy.units[index]; });
      this.eventRepeatWeekdaysTarget.querySelectorAll<HTMLSpanElement>('.event-repeat-weekdays span').forEach((node, index) => { node.textContent = copy.weekdays[index]; });
      this.eventRepeatIntervalTarget.setAttribute('aria-label', copy.intervalLabel);
      this.eventRepeatFrequencyTarget.setAttribute('aria-label', copy.unitLabel);
      this.eventRepeatWeekdaysTarget.querySelector<HTMLElement>('.event-repeat-weekdays')?.setAttribute('aria-label', copy.weekdaysLabel);
      this.eventRepeatMonthDayTarget.setAttribute('aria-label', copy.monthDayLabel);
      this.eventRepeatOrdinalTarget.setAttribute('aria-label', copy.weekOfMonthLabel);
      this.eventRepeatOrdinalWeekdayTarget.setAttribute('aria-label', copy.weekdayLabel);
      this.eventRepeatCountTarget.setAttribute('aria-label', copy.countLabel);
      Array.from(this.eventRepeatOrdinalTarget.options).forEach((option, index) => { option.textContent = copy.ordinals[index]; });
      Array.from(this.eventRepeatOrdinalWeekdayTarget.options).forEach((option, index) => { option.textContent = copy.weekdayNames[index]; });
    }
    this.eventTitleTarget.placeholder = eventMessage('eventTitle', locale);
    this.eventLocationTarget.placeholder = eventMessage('location', locale);
    this.eventDescriptionTarget.placeholder = eventMessage('eventDescription', locale);
    this.eventWhenInputTarget.placeholder = eventMessage('relativePlaceholder', locale);
    this.eventModalTarget.querySelector<HTMLElement>('[data-event-copy="when"]')!.childNodes[0].textContent = `${eventMessage('when', locale)} `;
    const dateTime = this.eventModalTarget.querySelector<HTMLElement>('[data-event-copy="dateTime"]');
    if (dateTime) dateTime.textContent = eventMessage('dateTime', locale);
    const use = this.eventModalTarget.querySelector<HTMLButtonElement>('[data-event-copy="use"]');
    if (use) use.textContent = eventMessage('use', locale);
    this.getEventCalendar()?.setPresentation(locale, {
      today: eventMessage('today', locale), clear: eventMessage('clear', locale),
      commit: eventMessage('useDates', locale), chooseDate: eventMessage('chooseDate', locale),
      previousMonth: eventMessage('previousMonth', locale), nextMonth: eventMessage('nextMonth', locale),
      previousYear: eventMessage('previousYear', locale), nextYear: eventMessage('nextYear', locale),
    });
    const range = this.getEventSelection();
    this.updateWhenSummary(range.start, range.end);
    if (this.cachedNaturalResult) {
      this.eventWhenPreviewTarget.textContent = formatNaturalDateResult(this.cachedNaturalResult, locale);
      this.eventWhenPreviewTarget.dataset.state = 'valid';
    } else if (this.cachedNaturalError) {
      this.eventWhenPreviewTarget.textContent = naturalDateErrorMessage(this.cachedNaturalError, locale);
      this.eventWhenPreviewTarget.dataset.state = 'error';
    } else if (!this.eventWhenInputTarget.value) {
      this.eventWhenPreviewTarget.textContent = eventMessage('relativeHint', locale);
    }
    const cancel = this.eventModalTarget.querySelector<HTMLButtonElement>('.form-actions .btn-secondary');
    if (cancel) {
      cancel.textContent = eventMessage('cancel', locale);
      cancel.setAttribute('aria-label', eventMessage('cancel', locale));
    }
    this.eventModalTarget.querySelector<HTMLButtonElement>('.modal-close-btn')
      ?.setAttribute('aria-label', eventMessage('close', locale));
  }

  // ── Internal rendering methods ────────────────────────────────────────────

  private renderMonthView(): void {
    const monthGrid = this.buildMonthGrid(this.currentYear, this.currentMonth);
    this.monthViewContentTarget.innerHTML = '';

    // Render header with navigation
    const header = this.createMonthHeader();
    this.monthViewContentTarget.appendChild(header);

    // One presentational region keeps large-text calendar columns readable
    // without putting navigation controls inside the horizontal scroll surface.
    const gridScroller = document.createElement('div');
    gridScroller.className = 'calendar-month-grid-scroller';
    gridScroller.tabIndex = 0;
    gridScroller.setAttribute('role', 'region');
    gridScroller.setAttribute('aria-label', eventMessage('calendar'));

    // Render weekday labels
    const weekdayRow = this.createWeekdayRow();
    gridScroller.appendChild(weekdayRow);

    // Render day cells
    const grid = this.createDayGrid(monthGrid);
    gridScroller.appendChild(grid);
    this.monthViewContentTarget.appendChild(gridScroller);
  }

  private renderCurrentView(): void {
    if (this.viewMode === 'day') {
      this.monthViewTarget.classList.add('hidden');
      this.dayViewTarget.classList.remove('hidden');
      this.renderDayView(this.selectedDate || this.toISODate(new Date()));
      return;
    }
    if (this.viewMode === 'week') {
      this.renderWeekView();
    } else {
      this.captureTimelineState();
      this.cancelPendingTimelineScroll();
      this.timeline = null;
      this.cancelNowTimer();
      this.monthViewTarget.classList.remove('hidden');
      this.dayViewTarget.classList.add('hidden');
      this.renderMonthView();
    }
    initIcons();
  }

  private setViewMode(mode: 'month' | 'week' | 'day'): void {
    if (mode !== this.viewMode) this.resetTimelineIdentity();
    if (mode === 'day' && (this.viewMode === 'month' || this.viewMode === 'week')) {
      this.previousBrowseMode = this.viewMode;
    }
    this.viewMode = mode;
    localStorage.setItem('jin:calendar-view', mode);
    this.renderCurrentView();
  }

  private navigateBy(direction: -1 | 1): void {
    if (this.viewMode === 'month') {
      const month = new Date(this.currentYear, this.currentMonth - 1 + direction, 1);
      this.currentYear = month.getFullYear();
      this.currentMonth = month.getMonth() + 1;
      this.selectedDate = this.toISODate(month);
    } else {
      const selected = new Date(`${this.selectedDate || this.toISODate(new Date())}T00:00:00`);
      selected.setDate(selected.getDate() + direction * (this.viewMode === 'week' ? 7 : 1));
      this.selectedDate = this.toISODate(selected);
      this.currentYear = selected.getFullYear();
      this.currentMonth = selected.getMonth() + 1;
    }
    this.renderCurrentView();
  }

  private createViewSwitch(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'calendar-view-switch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', eventMessage('calendar'));
    (['month', 'week', 'day'] as const).forEach(mode => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-view-switch__button';
      const labels = resolveEventLocale() === 'pt-BR'
        ? { month: 'Mês', week: 'Semana', day: 'Dia' }
        : { month: 'Month', week: 'Week', day: 'Day' };
      button.textContent = labels[mode];
      button.setAttribute('aria-pressed', String(this.viewMode === mode));
      button.addEventListener('click', () => this.setViewMode(mode));
      group.appendChild(button);
    });
    return group;
  }

  private renderWeekView(): void {
    this.captureTimelineState();
    this.monthViewTarget.classList.remove('hidden');
    this.dayViewTarget.classList.add('hidden');
    this.monthViewContentTarget.innerHTML = '';
    const header = this.createMonthHeader();
    this.monthViewContentTarget.appendChild(header);
    const anchor = new Date(`${this.selectedDate || this.toISODate(new Date())}T00:00:00`);
    anchor.setDate(anchor.getDate() - anchor.getDay());
    const dates: string[] = [];
    for (let index = 0; index < 7; index++) {
      const date = new Date(anchor);
      date.setDate(anchor.getDate() + index);
      dates.push(this.toISODate(date));
    }
    this.monthViewContentTarget.appendChild(this.createTimeline(dates, 'week'));
  }

  private renderDayView(dateStr: string): void {
    this.captureTimelineState();
    this.dayViewContentTarget.innerHTML = '';

    // Render back button
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'calendar-back-btn tap-target';
    backBtn.setAttribute('aria-label', `${eventMessage('back')} ${eventMessage('calendar')}`);
    backBtn.addEventListener('click', () => this.backToMonthView());
    backBtn.innerHTML = `<i data-lucide="arrow-left" aria-hidden="true"></i><span>${eventMessage('calendar')}</span>`;
    this.dayViewContentTarget.appendChild(backBtn);
    this.dayViewContentTarget.appendChild(this.createViewSwitch());

    // Render date heading
    const dateHeading = document.createElement('h2');
    dateHeading.className = 'calendar-day-heading calendar-day-heading--editorial';
    const dateObj = new Date(dateStr + 'T00:00:00');
    dateHeading.textContent = dateObj.toLocaleDateString(resolveEventLocale(), {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    this.dayViewContentTarget.appendChild(dateHeading);

    this.dayViewContentTarget.appendChild(this.createTimeline([dateStr], 'day'));

    // Render upcoming tasks for this date
    this.renderDayTasks(dateStr);

    // Re-initialize lucide icons
    initIcons();
  }

  private createTimeline(dates: string[], mode: 'day' | 'week'): HTMLElement {
    const identity = `${mode}:${dates[0] ?? ''}`;
    const isNewIdentity = this.timelineIdentity !== identity;
    if (isNewIdentity) {
      this.timelineIdentity = identity;
      this.nightManual = {};
      this.nightMonotonic = { early: false, late: false };
      this.timelineScroll = { top: 0, left: 0, focusEventId: null, initialized: false };
    }

    const now = new Date();
    const todayDate = this.toISODate(now);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const model = buildTimeGrid(this.allEvents, dates);
    const derived = deriveNightExpansion(model, todayDate, nowMinute);
    this.nightMonotonic = {
      early: this.nightMonotonic.early || derived.early,
      late: this.nightMonotonic.late || derived.late,
    };
    const expansion = this.effectiveNightExpansion();
    const rendered = renderTimeGrid({
      events: this.allEvents,
      dates,
      mode,
      locale: resolveEventLocale(),
      todayDate,
      nowMinute,
      expansion,
      onEvent: (id, control) => {
        this.timelineScroll.focusEventId = id;
        this.captureTimelineState(true);
        control.dataset.eventId = id;
        this.openEventDetail(id);
      },
      onDate: date => this.selectDate(date),
      onNightToggle: band => this.toggleNightBand(band),
    });
    this.cancelPendingTimelineScroll();
    this.timeline = rendered;
    const restoreExistingScroll = this.timelineScroll.initialized;
    const targetScrollTop = restoreExistingScroll
      ? this.timelineScroll.top
      : projectedMinute(initialScrollMinute(rendered.model), expansion) * GRID_PX_PER_MINUTE;
    const targetScrollLeft = restoreExistingScroll ? this.timelineScroll.left : 0;
    rendered.scroller.addEventListener('scroll', () => {
      if (this.timeline === rendered) this.captureTimelineState(true);
    }, { passive: true });
    this.cancelNowTimer();
    this.scheduleNowRefresh();

    this.pendingTimelineScroll = { rendered, identity, top: targetScrollTop, left: targetScrollLeft };
    if (typeof ResizeObserver !== 'undefined') {
      this.timelineLayoutObserver = new ResizeObserver(() => this.applyPendingTimelineScroll());
      this.timelineLayoutObserver.observe(rendered.scroller);
    }
    queueMicrotask(() => this.applyPendingTimelineScroll());
    this.schedulePendingTimelineScrollFrame();
    return rendered.root;
  }

  private effectiveNightExpansion(): NightExpansion {
    return {
      early: this.nightManual.early ?? this.nightMonotonic.early,
      late: this.nightManual.late ?? this.nightMonotonic.late,
    };
  }

  private toggleNightBand(band: NightBand): void {
    if (!this.timeline) return;
    const expansion = this.effectiveNightExpansion();
    this.nightManual[band] = !expansion[band];
    this.timeline.setExpansion(this.effectiveNightExpansion());
    this.captureTimelineState(true);
  }

  private captureTimelineState(userInitiated = false): void {
    if (!this.timeline) return;
    if (this.pendingTimelineScroll) {
      if (!userInitiated) return;
      this.cancelPendingTimelineScroll();
    }
    this.timelineScroll.top = this.timeline.scroller.scrollTop;
    this.timelineScroll.left = this.timeline.scroller.scrollLeft;
    this.timelineScroll.initialized = true;
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.eventId) this.timelineScroll.focusEventId = active.dataset.eventId;
  }

  private resetTimelineIdentity(): void {
    this.captureTimelineState();
    this.cancelPendingTimelineScroll();
    this.timeline = null;
    this.timelineIdentity = null;
    this.nightManual = {};
    this.nightMonotonic = { early: false, late: false };
    this.timelineScroll = { top: 0, left: 0, focusEventId: null, initialized: false };
    this.cancelNowTimer();
  }

  private schedulePendingTimelineScrollFrame(): void {
    if (!this.pendingTimelineScroll || this.timelineScrollFrame !== null) return;
    this.timelineScrollFrame = requestAnimationFrame(() => {
      this.timelineScrollFrame = null;
      this.applyPendingTimelineScroll();
    });
  }

  private applyPendingTimelineScroll(): void {
    const pending = this.pendingTimelineScroll;
    if (!pending || this.timeline !== pending.rendered || this.timelineIdentity !== pending.identity) return;
    const { root, scroller } = pending.rendered;
    if (!root.isConnected || root.closest('.hidden') || scroller.clientHeight <= 0 || scroller.scrollHeight <= scroller.clientHeight) return;
    scroller.scrollTop = pending.top;
    scroller.scrollLeft = pending.left;
    if (pending.top > 0 && scroller.scrollTop <= 0) return;
    this.timelineScroll.top = scroller.scrollTop;
    this.timelineScroll.left = scroller.scrollLeft;
    this.timelineScroll.initialized = true;
    this.cancelPendingTimelineScroll();
  }

  private cancelPendingTimelineScroll(): void {
    this.pendingTimelineScroll = null;
    this.timelineLayoutObserver?.disconnect();
    this.timelineLayoutObserver = null;
    if (this.timelineScrollFrame !== null) cancelAnimationFrame(this.timelineScrollFrame);
    this.timelineScrollFrame = null;
  }

  private refreshNowMarker(): void {
    if (!this.timeline || !this.connected || document.hidden || this.element.classList.contains('hidden')) return;
    const now = new Date();
    const todayDate = this.toISODate(now);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const derived = deriveNightExpansion(this.timeline.model, todayDate, nowMinute);
    let expansionChanged = false;
    (['early', 'late'] as const).forEach(band => {
      if (derived[band] && !this.nightMonotonic[band]) {
        this.nightMonotonic[band] = true;
        if (this.nightManual[band] === undefined) expansionChanged = true;
      }
    });
    if (expansionChanged) this.timeline.setExpansion(this.effectiveNightExpansion());
    this.timeline.updateNowMarker(todayDate, nowMinute);
  }

  private scheduleNowRefresh(): void {
    if (!this.connected || document.hidden || this.nowTimer) return;
    const now = new Date();
    const delay = Math.max(50, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    this.nowTimer = setTimeout(() => {
      this.nowTimer = null;
      this.refreshNowMarker();
      this.scheduleNowRefresh();
    }, delay);
  }

  private cancelNowTimer(): void {
    if (this.nowTimer !== null) clearTimeout(this.nowTimer);
    this.nowTimer = null;
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.cancelNowTimer();
      return;
    }
    this.refreshNowMarker();
    this.scheduleNowRefresh();
  };

  private renderDayTasks(dateStr: string): void {
    // Find tasks that have a due date matching this day
    const dayTasks = this.allTasks.filter(task => {
      if (!task.due) return false;
      return task.due.startsWith(dateStr);
    });

    if (dayTasks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'calendar-day-section';

    const heading = document.createElement('h3');
    heading.className = 'calendar-section-heading';
    heading.textContent = eventMessage('tasks');
    section.appendChild(heading);

    const tasksList = document.createElement('ul');
    tasksList.className = 'calendar-tasks-list';
    tasksList.setAttribute('role', 'list');

    dayTasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'calendar-task-item';
      li.setAttribute('data-task-id', task.id);

      const content = document.createElement('div');
      content.className = 'calendar-task-content';
      content.innerHTML = `
        <div class="calendar-task-title">${this.escapeHtml(task.title)}</div>
        ${task.body ? `<div class="calendar-task-desc">${this.escapeHtml(task.body.substring(0, 100))}</div>` : ''}
      `;
      li.appendChild(content);

      // Add promote button
      const promoteBtn = document.createElement('button');
      promoteBtn.type = 'button';
      promoteBtn.className = 'btn-icon calendar-task-btn';
      promoteBtn.setAttribute('aria-label', eventMessage('promoteEvent'));
      promoteBtn.setAttribute('title', eventMessage('promoteEventTitle'));
      if (this.writableDestinationCount > 1) {
        promoteBtn.disabled = true;
        promoteBtn.setAttribute('aria-label', 'Choose an exact calendar in the Promote dialog');
        promoteBtn.setAttribute('title', 'Multiple writable calendars are available; use Promote to Event and choose a destination.');
      }
      promoteBtn.innerHTML = '<i data-lucide="calendar-plus" aria-hidden="true"></i>';
      promoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.promoteTaskToEvent(task.id, dateStr);
      });
      li.appendChild(promoteBtn);

      tasksList.appendChild(li);
    });

    section.appendChild(tasksList);
    this.dayViewContentTarget.appendChild(section);
  }

  private createMonthHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'calendar-month-header';

    const identity = document.createElement('div');
    identity.className = 'calendar-month-identity';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'calendar-month-eyebrow';
    eyebrow.textContent = eventMessage('calendar');
    const monthYearLabel = document.createElement('h2');
    monthYearLabel.className = 'calendar-month-label';
    monthYearLabel.textContent = new Date(this.currentYear, this.currentMonth - 1, 1)
      .toLocaleDateString(resolveEventLocale(), { month: 'long', year: 'numeric' });
    identity.append(eyebrow, monthYearLabel);

    const navContainer = document.createElement('div');
    navContainer.className = 'calendar-month-nav';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'calendar-nav-btn tap-target';
    const modeLabel = eventMessage(this.viewMode, resolveEventLocale());
    prevBtn.setAttribute('aria-label', `${eventMessage('previous')} ${modeLabel}`);
    prevBtn.setAttribute('data-action', 'click->calendar-view#navigatePrevMonth');
    prevBtn.innerHTML = '<i data-lucide="chevron-left" aria-hidden="true"></i>';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'calendar-today-btn tap-target';
    todayBtn.setAttribute('aria-label', eventMessage('goToday'));
    todayBtn.setAttribute('data-action', 'click->calendar-view#goToToday');
    todayBtn.textContent = eventMessage('today');

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'calendar-nav-btn tap-target';
    nextBtn.setAttribute('aria-label', `${eventMessage('next')} ${modeLabel}`);
    nextBtn.setAttribute('data-action', 'click->calendar-view#navigateNextMonth');
    nextBtn.innerHTML = '<i data-lucide="chevron-right" aria-hidden="true"></i>';

    navContainer.appendChild(prevBtn);
    navContainer.appendChild(nextBtn);
    navContainer.appendChild(todayBtn);

    const controls = document.createElement('div');
    controls.className = 'calendar-month-controls';
    controls.append(navContainer, this.createViewSwitch());
    header.append(identity, controls);
    return header;
  }

  private createWeekdayRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'calendar-weekday-row';
    row.setAttribute('role', 'row');
    row.setAttribute('aria-hidden', 'true');

    const weekdays = Array.from({ length: 7 }, (_, index) =>
      new Date(2026, 0, 4 + index).toLocaleDateString(resolveEventLocale(), { weekday: 'short' }),
    );
    weekdays.forEach(day => {
      const cell = document.createElement('div');
      cell.className = 'calendar-weekday-cell';
      cell.textContent = day;
      row.appendChild(cell);
    });

    return row;
  }

  private createDayGrid(monthGrid: CalendarMonth): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'calendar-day-grid';
    grid.setAttribute('role', 'grid');

    monthGrid.weeks.forEach(week => {
      const weekRow = document.createElement('div');
      weekRow.className = 'calendar-week-row';
      weekRow.setAttribute('role', 'row');

      week.forEach(day => {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day-cell';
        if (!day.isCurrentMonth) dayCell.classList.add('calendar-day-cell--other-month');
        if (day.isToday) dayCell.classList.add('calendar-day-cell--today');
        dayCell.setAttribute('role', 'gridcell');

        const dayButton = document.createElement('button');
        dayButton.className = 'calendar-day-button';
        dayButton.textContent = String(day.day);
        dayButton.setAttribute('type', 'button');
        dayButton.setAttribute('data-date', day.date);
        const eventCount = `${day.events.length} ${eventMessage(day.events.length === 1 ? 'event' : 'events').toLocaleLowerCase(resolveEventLocale())}`;
        dayButton.setAttribute('aria-label', `${day.day} (${eventCount})`);
        dayButton.addEventListener('click', () => this.selectDate(day.date));

        dayCell.appendChild(dayButton);

        // Show event indicators
        const eventsList = document.createElement('div');
        eventsList.className = 'calendar-day-events';

        day.events.slice(0, 3).forEach(event => {
          const eventButton = document.createElement('button');
          eventButton.type = 'button';
          eventButton.className = 'calendar-event-chip';
          eventButton.dataset.eventId = event.id;
          eventButton.dataset.source = event.source.toLowerCase();
          applyCalendarColor(eventButton, calendarColorForEvent(event));
          eventButton.textContent = event.title;
          eventButton.setAttribute('aria-label', `${eventMessage('view')} ${event.title}`);
          eventButton.addEventListener('click', click => {
            click.stopPropagation();
            this.openEventDetail(event.id);
          });
          eventsList.appendChild(eventButton);
        });

        if (day.events.length > 3) {
          const more = document.createElement('div');
          more.className = 'calendar-event-more';
          more.textContent = `+${day.events.length - 3}`;
          eventsList.appendChild(more);
        }

        dayCell.appendChild(eventsList);
        weekRow.appendChild(dayCell);
      });

      grid.appendChild(weekRow);
    });

    return grid;
  }

  private buildMonthGrid(year: number, month: number): CalendarMonth {
    const firstDay = new Date(year, month - 1, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weeks: CalendarDay[][] = [];
    let currentDate = new Date(startDate);

    // Build 6 weeks (42 days)
    for (let i = 0; i < 6; i++) {
      const week: CalendarDay[] = [];
      for (let j = 0; j < 7; j++) {
        const dateStr = this.toISODate(currentDate);
        const isCurrentMonth = currentDate.getMonth() + 1 === month;
        const isToday = currentDate.getTime() === today.getTime();

        const dayEvents = this.allEvents.filter(e => this.eventIntersectsDate(e, dateStr));

        week.push({
          date: dateStr,
          day: currentDate.getDate(),
          isCurrentMonth,
          isToday,
          events: dayEvents,
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }
      weeks.push(week);
    }

    return { year, month, weeks };
  }

  private toISODate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(dateStr: string, days: number): string {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + days);
    return this.toISODate(date);
  }

  private getEventCalendar(): CalendarController | null {
    return this.application.getControllerForElementAndIdentifier(
      this.eventCalendarTarget, 'calendar',
    ) as CalendarController | null;
  }

  private setEventRange(start: string, end: string, complete: boolean): void {
    const normalizedEnd = end || start;
    this.eventCalendarTarget.dataset.pendingStart = start;
    this.eventCalendarTarget.dataset.pendingEnd = normalizedEnd;
    this.getEventCalendar()?.setSelection({ mode: 'range', start, end: normalizedEnd, complete });
    this.updateWhenSummary(start, normalizedEnd);
  }

  private getEventSelection(): { start: string; end: string } {
    const selection = this.getEventCalendar()?.getSelection();
    if (selection?.mode === 'range') return { start: selection.start, end: selection.end };
    const start = this.eventCalendarTarget.dataset.pendingStart ?? '';
    return { start, end: this.eventCalendarTarget.dataset.pendingEnd || start };
  }

  private updateWhenSummary(start: string, end: string): void {
    const locale = resolveEventLocale();
    if (!start) {
      this.eventWhenSummaryTarget.textContent = eventMessage('chooseAtLeastOneDay', locale);
      return;
    }
    const format = (iso: string): string => {
      const [year, month, day] = iso.split('-').map(Number);
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      }).format(new Date(year, month - 1, day));
    };
    this.eventWhenSummaryTarget.textContent = end && end !== start
      ? `${format(start)} – ${format(end)}`
      : format(start);
  }

  private eventIntersectsDate(event: EventDto, dateStr: string): boolean {
    return eventIntersectsDate(event, dateStr);
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await deleteEvent(eventId);
      this.notifyMutation();
      await this.loadCalendar();
      if (this.selectedDate) {
        this.renderDayView(this.selectedDate);
      }
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        this.dispatch('error', { detail: { message: err instanceof Error ? err.message : eventMessage('failedDeleteEvent') }, prefix: 'app', bubbles: true });
      }
    }
  }

  async promoteTaskToEvent(taskId: string, dateStr?: string): Promise<void> {
    try {
      if (this.writableDestinationCount > 1) {
        throw new Error('ambiguous_destination: Choose an exact calendar in the Promote to Event dialog.');
      }
      const selected = dateStr || this.selectedDate || this.toISODate(new Date());
      const when = selected.includes('T') ? selected : `${selected}T09:00:00`;
      await promoteTask(taskId, { when }, newOperationId('promote'));
      this.notifyMutation();
      await this.loadCalendar();
      if (this.selectedDate) {
        this.renderDayView(this.selectedDate);
      }
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        this.dispatch('error', { detail: { message: err instanceof Error ? err.message : eventMessage('failedPromoteTask') }, prefix: 'app', bubbles: true });
      }
    }
  }

  private openEventDetail(id: string): void {
    this.dispatch('navigate', { detail: { kind: 'events', id }, prefix: 'jin', bubbles: true });
  }

  private notifyMutation(): void {
    this.dispatch('events-mutated', {
      detail: { source: 'calendar-view' },
      prefix: 'jin',
      bubbles: true,
    });
    this.dispatch('refresh-today', { prefix: 'jin', bubbles: true });
  }
}
