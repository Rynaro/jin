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
 *   openEventCreate() → EventCompanion Composer → createEvent() → refreshCalendar()
 *
 * Connect pattern: data-controller="calendar-view" on the calendar <section> element.
 *
 * Targets:
 *   monthView        — month grid container
 *   dayView          — day detail container (hidden by default)
 *   monthViewTarget  — where the month grid is rendered
 *   dayViewTarget    — where day events are listed
 *   createEventBtn   — button to create new event
 */

import { Controller } from '@hotwired/stimulus';
import {
  listEvents, createEvent, createRoutedEvent, deleteEvent, promoteTask, syncCalendarEvent,
  listGoogleAccounts, listTasks, newOperationId,
  calendarRangeProjection, getEventDetailById, editEventDelta, editRoutedEventDelta,
} from '../invoke';
import { isJinErrorDto } from '../types/error';
import type {
  CalendarRangeEntryDto, CalendarRangeProjectionDto, EventDetailDto, EventDto, GoogleAccountDto, TaskDto,
} from '../types/dto';
import { initIcons } from '../lib/icons';
import { beginMovementSelection } from '../lib/ui/movement';
import { eventMessage, eventMessageFormat, resolveEventLocale } from '../lib/events/locale';
import {
  deriveNightExpansion,
  buildTimeGrid,
  buildTimeGridFromProjection,
  buildDisplayDaySlots,
  occupancyFromModel,
  GRID_PX_PER_MINUTE,
  initialScrollMinute,
  projectedMinute,
  type NightBand,
  type NightExpansion,
} from '../lib/calendar/time_grid';
import { calendarEventSourceLabel, renderTimeGrid, type RenderedTimeGrid } from '../lib/calendar/time_grid_render';
import { monthChipCapacity } from '../lib/calendar/month_capacity';
import {
  abortPointerLayer,
  applyCursorKey,
  applyGeometryToDraft,
  applyTemporalKeyboard,
  beginMonthDrag,
  beginMoveDrag,
  beginResizeDrag,
  beginTimedDrag,
  emptySlotCreate,
  finalizeMonthDrag,
  finalizeMoveDrag,
  finalizeResizeDrag,
  finalizeTimedDrag,
  formatGeometryClock,
  geometryFromProjectionEntry,
  initTemporalCursor,
  monthAllDayDraftSlot,
  parseTemporalKeyboard,
  pointerCreatePolicy,
  rangeKey,
  temporalHandlesAllowed,
  updateMonthDrag,
  updateMoveDrag,
  updateResizeDrag,
  updateTimedDrag,
  type CursorMemory,
  type CursorMoveKey,
  type EventGeometry,
  type PointerLayer,
  type TemporalCursor,
} from '../lib/calendar/interaction';
import {
  eventsFromProjectionForDate,
  filterProjectionEntries,
  projectionWindow,
} from '../lib/calendar/projection_view';
import {
  applyCalendarColor,
  calendarColor,
  calendarMembershipIdentity,
  googleCalendarKey,
} from '../lib/calendar/colors';
import {
  areAllCalendarsHidden,
  collectCalendarFilterIdentities,
  filterEventsByVisibility,
  isCalendarVisible,
  loadCalendarVisibility,
  resetCalendarVisibility,
  setCalendarVisible,
  type CalendarVisibilityMap,
} from '../lib/calendar/visibility';
import {
  createInputFromDraft,
  draftFromEvent,
  draftFromSlot,
  editPayloadFromDraft,
  routedCreateInputFromDraft,
  routedEditPayloadFromDraft,
  type DraftSlot,
  type EventDraft,
} from '../lib/events/draft';
import { EventCompanion, type CompanionSaveResult } from '../lib/ui/companion';
import type { SupportedRecurrenceScope } from '../lib/events/recurrence_scope';
import type { ComposerDestination } from '../lib/events/composer';

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
    'workspace',
    'field',
    'monthView',
    'dayView',
    'monthViewContent',
    'dayViewContent',
    'createEventBtn',
  ];

  declare workspaceTarget: HTMLElement;
  declare hasWorkspaceTarget: boolean;
  declare fieldTarget: HTMLElement;
  declare hasFieldTarget: boolean;
  declare monthViewTarget: HTMLElement;
  declare dayViewTarget: HTMLElement;
  declare monthViewContentTarget: HTMLElement;
  declare dayViewContentTarget: HTMLElement;
  declare createEventBtnTarget: HTMLButtonElement;
  declare hasCreateEventBtnTarget: boolean;

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
  private writableDestinationCount = 0;
  private visibilityMap: CalendarVisibilityMap = {};
  private filterAccounts: GoogleAccountDto[] = [];
  private rangeProjection: CalendarRangeProjectionDto | null = null;
  private companion: EventCompanion | null = null;
  private addButton: HTMLButtonElement | null = null;
  private workspaceObserver: ResizeObserver | null = null;
  private monthGridObserver: ResizeObserver | null = null;
  private monthGridResizeCleanup: (() => void) | null = null;
  private temporalCursor: TemporalCursor | null = null;
  private cursorMemory: CursorMemory | null = null;
  private pointerLayer: PointerLayer | null = null;
  private lastWritableDestination: ComposerDestination | null = null;
  private pendingCreateDestination: ComposerDestination | null = null;
  private detailRequestRevision = 0;
  private loadGeneration = 0;
  private selectedDetail: EventDetailDto | null = null;
  private selectedDetailId: string | null = null;
  private lastDisplayTz: string | null = null;
  private interactionSelectable: ((date: string, minute: number) => boolean) | null = null;
  private affordanceCleanups: Array<() => void> = [];
  private static readonly LAST_DEST_KEY = 'jin:calendar-last-destination:v1';

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.connected = true;
    this.addButton = this.hasCreateEventBtnTarget ? this.createEventBtnTarget : null;
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1; // 1-12
    const savedMode = localStorage.getItem('jin:calendar-view');
    if (savedMode === 'month' || savedMode === 'week' || savedMode === 'day') this.viewMode = savedMode;
    this.selectedDate = this.toISODate(today);

    this.visibilityMap = loadCalendarVisibility();
    this.restoreLastDestination();
    this.ensureCompanion();
    this.localizeCalendarShell();
    void this.refreshWritableDestinationCount();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('jin:calendar-colors-changed', this.handleCalendarColorsChanged);
    void this.loadCalendar();
  }

  disconnect(): void {
    this.connected = false;
    this.invalidateDetailRequest();
    this.cancelNowTimer();
    this.cancelPendingTimelineScroll();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('jin:calendar-colors-changed', this.handleCalendarColorsChanged);
    this.workspaceObserver?.disconnect();
    this.workspaceObserver = null;
    this.stopMonthGridMeasurement();
    this.companion?.close(true);
    this.companion = null;
    this.timeline = null;
    this.timelineIdentity = null;
    this.nightManual = {};
    this.nightMonotonic = { early: false, late: false };
    this.selectedDetail = null;
    this.selectedDetailId = null;
  }

  private readonly handleCalendarColorsChanged = (): void => {
    if (this.connected) void this.renderCurrentView();
  };

  // ── Public actions ────────────────────────────────────────────────────────

  activateSection(): void {
    queueMicrotask(() => this.applyPendingTimelineScroll());
    this.schedulePendingTimelineScrollFrame();
  }

  async loadCalendar(): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      this.allEvents = await listEvents();
      if (!this.connected || generation !== this.loadGeneration) return;
      try {
        this.filterAccounts = await listGoogleAccounts();
      } catch {
        this.filterAccounts = [];
      }
      if (!this.connected || generation !== this.loadGeneration) return;
      this.allTasks = await listTasks();
      if (!this.connected || generation !== this.loadGeneration) return;
      // Refresh cached calendar data without navigating away from an event.
      // Check after the requests settle: detail may have opened in the meantime.
      if (!this.element.querySelector('[data-events-target="detailPanel"]:not(.hidden)')) {
        await this.renderCurrentView();
      }
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
    this.invalidateDetailRequest();
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1;
    this.selectedDate = this.toISODate(today);
    this.paintCurrentView();
    void this.renderCurrentView();
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
    this.invalidateDetailRequest();
    this.selectedDate = dateStr;
    this.viewMode = 'day';
    localStorage.setItem('jin:calendar-view', this.viewMode);
    this.monthViewTarget.classList.add('hidden');
    this.dayViewTarget.classList.remove('hidden');
    const before = this.projectionFingerprint();
    this.paintCurrentView();
    void this.refreshRangeProjection().then(() => {
      if (!this.connected || this.viewMode !== 'day' || this.selectedDate !== dateStr) return;
      if (this.projectionFingerprint() === before && this.timeline) return;
      this.paintCurrentView();
    });
  }

  backToMonthView(): void {
    this.resetTimelineIdentity();
    this.viewMode = this.previousBrowseMode;
    localStorage.setItem('jin:calendar-view', this.viewMode);
    void this.renderCurrentView();
  }

  restoreActiveView(event?: Event): void {
    const savedTimelineScroll = { ...this.timelineScroll };
    void this.renderCurrentView().then(() => {
      if (!this.connected) return;
      this.applyRestoredTimeline(savedTimelineScroll, event);
    });
  }

  private applyRestoredTimeline(
    savedTimelineScroll: { top: number; left: number; focusEventId: string | null; initialized: boolean },
    event?: Event,
  ): void {
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
      this.element.scrollTop = detail?.scrollTop ?? 0;
      if (detail?.focusEventId) {
        const panel = this.viewMode === 'day' ? this.dayViewTarget : this.monthViewTarget;
        Array.from(panel.querySelectorAll<HTMLElement>('[data-event-id]'))
          .find(control => control.dataset.eventId === detail.focusEventId)
          ?.focus({ preventScroll: true });
      }
    });
  }

  localeChanged(): void {
    this.invalidateDetailRequest();
    this.localizeCalendarShell();
    if (!this.element.querySelector('[data-events-target="detailPanel"]:not(.hidden)')) {
      this.paintCurrentView();
      void this.renderCurrentView();
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
    this.createEventBtnTarget.textContent = '+';
    this.createEventBtnTarget.setAttribute('aria-label', eventMessage('addEvent', locale));
  }

  async openEventCreate(): Promise<void> {
    // Companion already blocks Save while persisting; also refuse opening a new
    // create while a write is in flight so the + button cannot double-start.
    if (this.companion?.getOperationState() === 'persisting') return;
    const date = this.selectedDate || this.toISODate(new Date());
    const slot: DraftSlot = {
      date,
      end_date: date,
      start_time: '09:00',
      end_time: '10:00',
      is_all_day: false,
      timezone: this.rangeProjection?.display_tz,
    };
    await this.openCompanionCreate(slot, this.addButton);
  }

  // ── Internal rendering methods ────────────────────────────────────────────

  private renderMonthView(): void {
    this.stopMonthGridMeasurement();
    this.monthViewTarget.classList.remove('calendar-month-view--timeline');
    this.monthViewContentTarget.innerHTML = '';

    // Render header with navigation
    const header = this.createMonthHeader();
    this.monthViewContentTarget.appendChild(header);

    if (this.isFilterFullyHidden()) {
      this.monthViewContentTarget.appendChild(this.createFilterEmptyState());
      return;
    }

    const monthGrid = this.buildMonthGrid(this.currentYear, this.currentMonth);

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
    this.measureMonthGrid(grid, gridScroller);
  }

  private async renderCurrentView(): Promise<void> {
    await this.refreshRangeProjection();
    if (!this.connected) return;
    this.paintCurrentView();
  }

  private paintCurrentView(): void {
    if (this.viewMode !== 'month') this.stopMonthGridMeasurement();
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
    this.invalidateDetailRequest();
    if (mode !== this.viewMode) this.resetTimelineIdentity();
    if (mode === 'day' && (this.viewMode === 'month' || this.viewMode === 'week')) {
      this.previousBrowseMode = this.viewMode;
    }
    this.viewMode = mode;
    localStorage.setItem('jin:calendar-view', mode);
    this.paintCurrentView();
    void this.refreshRangeProjection().then(() => {
      if (!this.connected || this.viewMode !== mode) return;
      this.paintCurrentView();
    });
  }

  private navigateBy(direction: -1 | 1): void {
    this.invalidateDetailRequest();
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
    this.paintCurrentView();
    void this.renderCurrentView();
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
    this.monthViewTarget.classList.add('calendar-month-view--timeline');
    this.dayViewTarget.classList.add('hidden');
    this.monthViewContentTarget.innerHTML = '';
    const header = this.createMonthHeader();
    this.monthViewContentTarget.appendChild(header);
    if (this.isFilterFullyHidden()) {
      this.monthViewContentTarget.appendChild(this.createFilterEmptyState());
      return;
    }
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
    this.dayViewTarget.classList.add('calendar-day-view--timeline');
    this.dayViewContentTarget.innerHTML = '';

    this.dayViewContentTarget.appendChild(this.createMonthHeader());

    if (this.isFilterFullyHidden()) {
      this.dayViewContentTarget.appendChild(this.createFilterEmptyState());
      initIcons();
      return;
    }

    const timeline = this.createTimeline([dateStr], 'day');
    this.dayViewContentTarget.appendChild(timeline);

    // Due tasks follow the chronological surface inside its one scroll region.
    // They remain outside the time grid itself, so their cards never imply a
    // time they do not have.
    this.renderDayTasks(
      dateStr,
      timeline.querySelector<HTMLElement>('.calendar-timegrid__scroller') ?? this.dayViewContentTarget,
    );

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
      this.temporalCursor = initTemporalCursor({
        dates,
        todayDate: this.toISODate(new Date()),
        nowMinute: new Date().getHours() * 60 + new Date().getMinutes(),
        memory: this.cursorMemory,
      });
      this.cursorMemory = { rangeKey: rangeKey(dates), cursor: this.temporalCursor };
    }

    const now = new Date();
    const todayDate = this.toISODate(now);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const eventsById = new Map(this.allEvents.map(event => [event.id, event]));
    const entries = filterProjectionEntries(this.rangeProjection, this.allEvents, this.visibilityMap);
    const model = this.rangeProjection
      ? buildTimeGridFromProjection(entries, eventsById, dates)
      : buildTimeGrid(this.visibleEvents(), dates);
    const displayTz = this.rangeProjection?.display_tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const displaySlots = new Map(dates.map(date => [date, buildDisplayDaySlots(date, displayTz)]));
    const selectable = (date: string, minute: number): boolean => {
      const slot = displaySlots.get(date)?.find(item => item.minute === minute);
      return slot ? slot.selectable : true;
    };
    const derived = deriveNightExpansion(model, todayDate, nowMinute);
    this.nightMonotonic = {
      early: this.nightMonotonic.early || derived.early,
      late: this.nightMonotonic.late || derived.late,
    };
    const expansion = this.effectiveNightExpansion();
    const rendered = renderTimeGrid({
      model,
      dates,
      mode,
      locale: resolveEventLocale(),
      todayDate,
      nowMinute,
      expansion,
      displaySlots,
      cursor: this.temporalCursor,
      onEvent: (id, control) => {
        this.timelineScroll.focusEventId = id;
        this.captureTimelineState(true);
        control.dataset.eventId = id;
        this.openEventDetail(id, control);
      },
      onDate: date => this.selectDate(date),
      onNightToggle: band => this.toggleNightBand(band),
      onEmptySlot: (date, minute) => {
        const slot = emptySlotCreate(date, minute, selectable, displayTz);
        if (slot) this.openCompanionCreate(slot, rendered.root.querySelector<HTMLElement>(`.calendar-timegrid__day[data-date="${date}"]`));
      },
      onAgendaSelect: id => this.openEventDetail(id, document.activeElement instanceof HTMLElement ? document.activeElement : null),
    });
    this.interactionSelectable = selectable;
    this.wireTimelineInteraction(rendered, dates, mode, selectable, displayTz);
    this.cancelPendingTimelineScroll();
    this.timeline = rendered;
    if (this.selectedDetail && this.selectedDetailId === this.selectedDetail.event.id) {
      this.installTemporalAffordances(this.selectedDetail.event.id, this.selectedDetail);
    }
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

  private renderDayTasks(dateStr: string, container: HTMLElement = this.dayViewContentTarget): void {
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
    container.appendChild(section);
  }


  private visibleEvents(): EventDto[] {
    return filterEventsByVisibility(this.allEvents, this.visibilityMap);
  }

  private filterIdentities() {
    return collectCalendarFilterIdentities(
      this.allEvents,
      this.filterAccounts,
      eventMessage('jinCalendarName'),
    );
  }

  private isFilterFullyHidden(): boolean {
    const keys = this.filterIdentities().map(identity => identity.key);
    return areAllCalendarsHidden(keys, this.visibilityMap);
  }

  private createCalendarFilter(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'calendar-filter';
    const summary = document.createElement('summary');
    summary.className = 'calendar-filter__summary';
    summary.textContent = eventMessage('calendarsFilter');
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'calendar-filter__list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', eventMessage('calendarsFilter'));

    for (const identity of this.filterIdentities()) {
      const row = document.createElement('label');
      row.className = 'form-label jin-checkbox calendar-filter__row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isCalendarVisible(identity.key, this.visibilityMap);
      input.dataset.calendarKey = identity.key;
      input.addEventListener('change', () => {
        this.invalidateDetailRequest();
        this.visibilityMap = setCalendarVisible(identity.key, input.checked);
        this.paintCurrentView();
        void this.renderCurrentView();
      });

      const mark = document.createElement('span');
      mark.className = 'jin-checkbox__mark';
      mark.setAttribute('aria-hidden', 'true');

      const swatch = document.createElement('span');
      swatch.className = 'calendar-filter__swatch';
      swatch.setAttribute('aria-hidden', 'true');
      applyCalendarColor(swatch, identity.color);

      const name = document.createElement('span');
      name.className = 'calendar-filter__name';
      name.textContent = identity.accountAlias
        ? `${identity.label} · ${identity.accountAlias}`
        : identity.label;

      row.append(input, mark, swatch, name);
      list.appendChild(row);
    }

    details.appendChild(list);
    return details;
  }

  private createFilterEmptyState(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'calendar-filter-empty';
    empty.setAttribute('role', 'status');
    const copy = document.createElement('p');
    copy.className = 'calendar-filter-empty__copy';
    copy.textContent = eventMessage('allCalendarsHidden');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn-secondary calendar-filter-empty__reset tap-target';
    reset.textContent = eventMessage('resetFilter');
    reset.addEventListener('click', () => {
      this.invalidateDetailRequest();
      this.visibilityMap = resetCalendarVisibility();
      this.paintCurrentView();
      void this.renderCurrentView();
      void this.renderCurrentView();
    });
    empty.append(copy, reset);
    return empty;
  }

  private createMonthHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'calendar-month-header';

    const identity = document.createElement('div');
    identity.className = 'calendar-month-identity';
    const monthYearLabel = document.createElement('h2');
    monthYearLabel.className = 'calendar-month-label';
    const selected = new Date(`${this.selectedDate || this.toISODate(new Date())}T12:00:00`);
    monthYearLabel.textContent = this.viewMode === 'day'
      ? selected.toLocaleDateString(resolveEventLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : this.viewMode === 'week'
        ? selected.toLocaleDateString(resolveEventLocale(), { month: 'long', year: 'numeric' })
        : new Date(this.currentYear, this.currentMonth - 1, 1)
          .toLocaleDateString(resolveEventLocale(), { month: 'long', year: 'numeric' });
    identity.append(monthYearLabel);

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

    navContainer.appendChild(todayBtn);
    navContainer.appendChild(prevBtn);
    navContainer.appendChild(nextBtn);

    const controls = document.createElement('div');
    controls.className = 'calendar-month-controls';
    const leading = document.createElement('div');
    leading.className = 'calendar-month-leading';
    if (this.viewMode === 'day') {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'calendar-back-btn tap-target';
      back.setAttribute('aria-label', `${eventMessage('back')} ${eventMessage('calendar')}`);
      back.addEventListener('click', () => this.backToMonthView());
      back.innerHTML = '<i data-lucide="arrow-left" aria-hidden="true"></i>';
      leading.append(back);
    }
    leading.append(this.createCalendarFilter());
    if (this.addButton) leading.appendChild(this.addButton);
    controls.append(leading, this.createViewSwitch(), navContainer);
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
        if (day.isToday) dayButton.setAttribute('aria-current', 'date');
        const eventCount = `${day.events.length} ${eventMessage(day.events.length === 1 ? 'event' : 'events').toLocaleLowerCase(resolveEventLocale())}`;
        dayButton.setAttribute('aria-label', `${day.day} (${eventCount})`);
        dayButton.addEventListener('click', () => this.selectDate(day.date));

        dayCell.appendChild(dayButton);

        const addOnDate = document.createElement('button');
        addOnDate.type = 'button';
        addOnDate.className = 'calendar-day-add tap-target';
        const locale = resolveEventLocale();
        const localized = new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, {
          month: 'short', day: 'numeric',
        });
        addOnDate.textContent = '+';
        addOnDate.setAttribute('aria-label', eventMessageFormat('addOnDate', { date: localized }, locale));
        addOnDate.addEventListener('click', click => {
          click.stopPropagation();
          this.openCompanionCreate(monthAllDayDraftSlot(day.date, this.rangeProjection?.display_tz), addOnDate);
        });
        dayCell.appendChild(addOnDate);

        // Show event indicators
        const eventsList = document.createElement('div');
        eventsList.className = 'calendar-day-events';

        day.events.forEach(event => {
          const eventButton = document.createElement('button');
          eventButton.type = 'button';
          eventButton.className = 'calendar-event-chip';
          eventButton.classList.add(event.is_all_day ? 'calendar-event-chip--all-day' : 'calendar-event-chip--timed');
          eventButton.dataset.eventId = event.id;
          const membership = calendarMembershipIdentity(event, eventMessage('jinCalendarName'));
          eventButton.dataset.source = membership.provider;
          applyCalendarColor(eventButton, membership.color);
          const eventTitle = document.createElement('span');
          eventTitle.className = 'calendar-event-chip__title';
          eventTitle.textContent = event.title;
          eventButton.appendChild(eventTitle);
          const clock = !event.is_all_day ? this.monthStartClock(event.id, day.date) : null;
          if (clock) {
            const time = document.createElement('time');
            time.className = 'calendar-event-chip__time';
            time.textContent = clock;
            eventButton.appendChild(time);
          }
          const calendarLabel = calendarEventSourceLabel(event, resolveEventLocale());
          eventButton.title = `${event.title} · ${calendarLabel}`;
          eventButton.setAttribute('aria-label', `${eventMessage('view')} ${event.title}${clock ? `, ${clock}` : ''}, ${calendarLabel}`);
          eventButton.addEventListener('click', click => {
            click.stopPropagation();
            this.openEventDetail(event.id, eventButton);
          });
          eventsList.appendChild(eventButton);
        });

        if (day.events.length > 0) {
          const moreBtn = document.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'calendar-event-more tap-target';
          moreBtn.textContent = `+${Math.max(0, day.events.length - 3)}`;
          moreBtn.setAttribute('aria-label', `${Math.max(0, day.events.length - 3)} ${eventMessage('more')} ${eventMessage('events')}`);
          moreBtn.hidden = day.events.length <= 3;
          moreBtn.addEventListener('click', click => {
            click.stopPropagation();
            this.selectDate(day.date);
          });
          eventsList.appendChild(moreBtn);
        }

        dayCell.appendChild(eventsList);

        dayCell.addEventListener('click', click => {
          const target = click.target as HTMLElement;
          if (target.closest('.calendar-day-button, .calendar-event-chip, .calendar-day-add, .calendar-event-more')) {
            return;
          }
          this.openCompanionCreate(monthAllDayDraftSlot(day.date, this.rangeProjection?.display_tz), dayCell);
        });

        dayCell.addEventListener('pointerdown', event => {
          if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
          if ((event.target as HTMLElement).closest('.calendar-day-button, .calendar-event-chip, .calendar-day-add, .calendar-event-more')) {
            return;
          }
          if (pointerCreatePolicy('fine') !== 'tap-and-drag') return;
          this.pointerLayer = beginMonthDrag(day.date);
          let releaseSelection: (() => void) | null = null;
          const onMove = (move: PointerEvent): void => {
            const el = document.elementFromPoint(move.clientX, move.clientY) as HTMLElement | null;
            const cell = el?.closest('.calendar-day-cell') as HTMLElement | null;
            const dateBtn = cell?.querySelector<HTMLElement>('.calendar-day-button[data-date]');
            const nextDate = dateBtn?.getAttribute('data-date');
            if (nextDate && this.pointerLayer?.kind === 'month-range') {
              if (!releaseSelection) releaseSelection = beginMovementSelection(dayCell);
              this.pointerLayer = updateMonthDrag(this.pointerLayer, nextDate);
            }
          };
          const finish = (up: PointerEvent): void => {
            releaseSelection?.();
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            if (up.type === 'pointercancel' || !this.pointerLayer || this.pointerLayer.kind !== 'month-range') {
              abortPointerLayer(this.pointerLayer);
              this.pointerLayer = null;
              return;
            }
            const slot = finalizeMonthDrag(this.pointerLayer, this.rangeProjection?.display_tz);
            this.pointerLayer = null;
            this.openCompanionCreate(slot);
          };
          const cancel = (ev: PointerEvent): void => finish(ev);
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', finish);
          window.addEventListener('pointercancel', cancel);
        });

        weekRow.appendChild(dayCell);
      });

      grid.appendChild(weekRow);
    });

    return grid;
  }

  private monthStartClock(eventId: string, date: string): string | null {
    // Projection display values are already resolved in the chosen display timezone.
    const entry = this.rangeProjection?.entries.find(item => item.event_id === eventId && item.start_date === date);
    const wall = entry?.start_display.match(/T(\d{2}):(\d{2})/);
    if (!wall) return null;
    const hour = Number(wall[1]);
    const minute = Number(wall[2]);
    if (hour > 23 || minute > 59) return null;
    return new Intl.DateTimeFormat(resolveEventLocale(), { hour: 'numeric', minute: '2-digit' })
      .format(new Date(2026, 0, 1, hour, minute));
  }

  private stopMonthGridMeasurement(): void {
    this.monthGridObserver?.disconnect();
    this.monthGridObserver = null;
    this.monthGridResizeCleanup?.();
    this.monthGridResizeCleanup = null;
  }

  private measureMonthGrid(grid: HTMLElement, scroller: HTMLElement): void {
    const update = (): void => {
      if (!grid.isConnected) return;
      const cells = [...grid.querySelectorAll<HTMLElement>('.calendar-day-cell')];
      const maxEvents = Math.max(0, ...cells.map(cell => cell.querySelectorAll('.calendar-event-chip').length));
      if (maxEvents === 0) return;
      const sample = cells.find(cell => cell.querySelector('.calendar-event-chip'))!;
      const date = sample.querySelector<HTMLElement>('.calendar-day-button')!;
      const chip = sample.querySelector<HTMLElement>('.calendar-event-chip')!;
      const more = sample.querySelector<HTMLElement>('.calendar-event-more')!;
      const events = sample.querySelector<HTMLElement>('.calendar-day-events')!;
      const cellStyle = getComputedStyle(sample);
      const capacity = getComputedStyle(events).flexDirection === 'row'
        ? 3
        : monthChipCapacity({
          row: sample.getBoundingClientRect().height,
          date: date.getBoundingClientRect().height + (parseFloat(getComputedStyle(date).marginBottom) || 0),
          chip: chip.getBoundingClientRect().height || parseFloat(getComputedStyle(chip).minHeight) || 20,
          more: more.getBoundingClientRect().height || parseFloat(getComputedStyle(more).minHeight) || 28,
          gap: parseFloat(getComputedStyle(events).rowGap) || 2,
          padding: (parseFloat(cellStyle.paddingTop) || 0) + (parseFloat(cellStyle.paddingBottom) || 0),
          maxEvents,
        });
      if (grid.dataset.chipCapacity === String(capacity)) return;
      grid.dataset.chipCapacity = String(capacity);
      for (const cell of cells) {
        const chips = [...cell.querySelectorAll<HTMLButtonElement>('.calendar-event-chip')];
        const moreButton = cell.querySelector<HTMLButtonElement>('.calendar-event-more');
        const hiddenCount = Math.max(0, chips.length - capacity);
        if (hiddenCount === 0 && moreButton === document.activeElement) {
          cell.querySelector<HTMLButtonElement>('.calendar-day-button')?.focus({ preventScroll: true });
        }
        if (moreButton) moreButton.hidden = hiddenCount === 0;
        if (document.activeElement instanceof HTMLElement && chips.slice(capacity).includes(document.activeElement as HTMLButtonElement)) {
          moreButton?.focus({ preventScroll: true });
        }
        chips.forEach((button, index) => { button.hidden = index >= capacity; });
        if (moreButton) {
          moreButton.textContent = `+${hiddenCount}`;
          moreButton.setAttribute('aria-label', `${hiddenCount} ${eventMessage('more')} ${eventMessage('events')}`);
        }
      }
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      this.monthGridObserver = new ResizeObserver(update);
      this.monthGridObserver.observe(scroller);
      const firstDate = grid.querySelector<HTMLElement>('.calendar-day-button');
      if (firstDate) this.monthGridObserver.observe(firstDate);
    } else {
      window.addEventListener('resize', update);
      this.monthGridResizeCleanup = () => window.removeEventListener('resize', update);
    }
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

        const dayEvents = this.rangeProjection
          ? eventsFromProjectionForDate(this.rangeProjection, this.allEvents, this.visibilityMap, dateStr)
          : this.visibleEvents().filter(e => this.eventIntersectsDate(e, dateStr));

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

  private openEventDetail(id: string, anchor: HTMLElement | null = null): void {
    void this.openEventPreview(id, anchor);
  }

  private async openEventPreview(id: string, anchor: HTMLElement | null = null): Promise<void> {
    if (this.companion?.isOpen() && !await this.companion.prepareReplacement()) return;
    this.captureTimelineState(true);
    const fieldScroll = this.timeline?.scroller.scrollTop ?? 0;
    this.clearTemporalAffordances();
    this.selectedDetailId = id;
    this.selectedDetail = null;
    const revision = ++this.detailRequestRevision;
    try {
      const detail = await getEventDetailById(id);
      // AC-016: stale responses must not update Preview or install handles.
      if (!this.connected || revision !== this.detailRequestRevision) return;
      if (this.selectedDetailId !== id) return;
      this.selectedDetail = detail;
      const entry = this.projectionEntryFor(id);
      this.ensureCompanion();
      this.companion?.setAnchor(anchor);
      this.companion?.openPreview(detail, {
        temporalDisabledReason: entry?.temporal_editable === false
          ? entry.temporal_disabled_reason
          : null,
        recurrenceScopes: (detail.capabilities.recurrence_scopes ?? []).filter(
          (scope): scope is SupportedRecurrenceScope =>
            scope === 'this_occurrence' || scope === 'entire_series',
        ),
      });
      this.installTemporalAffordances(id, detail);
      if (this.timeline) {
        this.timeline.scroller.scrollTop = this.timelineScroll.top || fieldScroll;
        this.timeline.scroller.scrollLeft = this.timelineScroll.left;
      }
    } catch (err: unknown) {
      if (!this.connected || revision !== this.detailRequestRevision) return;
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      } else {
        this.dispatch('error', {
          detail: { message: err instanceof Error ? err.message : eventMessage('failedLoadEvent') },
          prefix: 'app',
          bubbles: true,
        });
      }
    }
  }

  private invalidateDetailRequest(): void {
    this.detailRequestRevision += 1;
    this.clearTemporalAffordances();
    this.selectedDetail = null;
    this.selectedDetailId = null;
  }

  private projectionEntryFor(eventId: string): CalendarRangeEntryDto | null {
    return this.rangeProjection?.entries.find(entry => entry.event_id === eventId) ?? null;
  }

  private clearTemporalAffordances(): void {
    for (const cleanup of this.affordanceCleanups) cleanup();
    this.affordanceCleanups = [];
    this.timeline?.root.querySelectorAll('.calendar-timegrid__event--temporal').forEach(el => {
      el.classList.remove('calendar-timegrid__event--temporal');
      el.querySelectorAll('.calendar-timegrid__resize-handle').forEach(handle => handle.remove());
    });
  }

  private installTemporalAffordances(eventId: string, detail: EventDetailDto): void {
    this.clearTemporalAffordances();
    const entry = this.projectionEntryFor(eventId);
    if (!temporalHandlesAllowed({ pointerKind: 'fine', detail, entry })) return;
    const geometry = entry ? geometryFromProjectionEntry(entry) : null;
    if (!geometry || !this.timeline) return;

    const buttons = this.timeline.root.querySelectorAll<HTMLButtonElement>(
      `.calendar-timegrid__event[data-event-id="${eventId.replace(/"/g, '')}"]`,
    );
    for (const button of buttons) {
      button.classList.add('calendar-timegrid__event--temporal');
      const handle = document.createElement('span');
      handle.className = 'calendar-timegrid__resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      button.appendChild(handle);

      const onMovePointer = (event: PointerEvent): void => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
        if ((event.target as HTMLElement).closest('.calendar-timegrid__resize-handle')) return;
        event.preventDefault();
        event.stopPropagation();
        this.beginEventMoveGesture(geometry, button, event);
      };
      const onResizePointer = (event: PointerEvent): void => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
        event.preventDefault();
        event.stopPropagation();
        this.beginEventResizeGesture(geometry, button, event);
      };
      const onKey = (event: KeyboardEvent): void => {
        const action = parseTemporalKeyboard(event);
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        this.commitTemporalKeyboard(geometry, action);
      };
      button.addEventListener('pointerdown', onMovePointer);
      handle.addEventListener('pointerdown', onResizePointer);
      button.addEventListener('keydown', onKey);
      this.affordanceCleanups.push(() => {
        button.removeEventListener('pointerdown', onMovePointer);
        handle.removeEventListener('pointerdown', onResizePointer);
        button.removeEventListener('keydown', onKey);
        handle.remove();
        button.classList.remove('calendar-timegrid__event--temporal');
      });
    }
  }

  private currentInteractionRange(
    dates: string[],
    mode: 'day' | 'week',
  ): {
    dates: string[];
    mode: 'day' | 'week';
    bandStart: number;
    bandEnd: number;
    occupancy: Map<string, Array<{ eventId: string; startMinute: number; endMinute: number }>>;
    isSelectable: (date: string, minute: number) => boolean;
  } {
    const selectable = this.interactionSelectable ?? (() => true);
    return {
      dates,
      mode,
      bandStart: 0,
      bandEnd: 24 * 60,
      occupancy: this.timeline ? occupancyFromModel(this.timeline.model) : new Map(),
      isSelectable: selectable,
    };
  }

  private minuteFromClientY(dayEl: HTMLElement, clientY: number): number {
    const rect = dayEl.getBoundingClientRect();
    const y = clientY - rect.top;
    let bestMinute = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    const expansion = this.effectiveNightExpansion();
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const projected = projectedMinute(minute, expansion) * GRID_PX_PER_MINUTE;
      const dist = Math.abs(projected - y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMinute = minute;
      }
    }
    return bestMinute;
  }

  private beginEventMoveGesture(
    origin: EventGeometry,
    button: HTMLButtonElement,
    down: PointerEvent,
  ): void {
    if (!this.timeline) return;
    const selectable = this.interactionSelectable ?? (() => true);
    const day = button.closest('.calendar-timegrid__day') as HTMLElement | null;
    if (!day?.dataset.date) return;
    this.pointerLayer = beginMoveDrag(origin);
    let moved = false;
    let releaseSelection: (() => void) | null = null;
    const onMove = (move: PointerEvent): void => {
      if (!this.pointerLayer || this.pointerLayer.kind !== 'move') return;
      if (!releaseSelection) releaseSelection = beginMovementSelection(button);
      const el = document.elementFromPoint(move.clientX, move.clientY) as HTMLElement | null;
      const targetDay = el?.closest('.calendar-timegrid__day') as HTMLElement | null;
      const date = targetDay?.dataset.date ?? day.dataset.date!;
      const minute = this.minuteFromClientY(targetDay ?? day, move.clientY);
      this.pointerLayer = updateMoveDrag(this.pointerLayer, date, minute, selectable);
      moved = true;
      const g = this.pointerLayer.current;
      this.timeline?.setGhostSelection(g.startDate, g.startMinute, g.startMinute + Math.min(g.elapsedMinutes, 24 * 60 - g.startMinute));
    };
    const finish = (up: PointerEvent): void => {
      releaseSelection?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      this.timeline?.clearGhostSelection();
      if (up.type === 'pointercancel' || !this.pointerLayer || this.pointerLayer.kind !== 'move') {
        abortPointerLayer(this.pointerLayer);
        this.pointerLayer = null;
        return;
      }
      if (!moved) {
        abortPointerLayer(this.pointerLayer);
        this.pointerLayer = null;
        return;
      }
      const geometry = finalizeMoveDrag(this.pointerLayer);
      this.pointerLayer = null;
      this.openCompanionGeometricEdit(origin, geometry);
    };
    const cancel = (ev: PointerEvent): void => finish(ev);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    void down;
  }

  private beginEventResizeGesture(
    origin: EventGeometry,
    button: HTMLButtonElement,
    down: PointerEvent,
  ): void {
    if (!this.timeline) return;
    const selectable = this.interactionSelectable ?? (() => true);
    const day = button.closest('.calendar-timegrid__day') as HTMLElement | null;
    if (!day?.dataset.date) return;
    this.pointerLayer = beginResizeDrag(origin);
    let moved = false;
    let releaseSelection: (() => void) | null = null;
    const onMove = (move: PointerEvent): void => {
      if (!this.pointerLayer || this.pointerLayer.kind !== 'resize-end') return;
      if (!releaseSelection) releaseSelection = beginMovementSelection(button);
      const el = document.elementFromPoint(move.clientX, move.clientY) as HTMLElement | null;
      const targetDay = el?.closest('.calendar-timegrid__day') as HTMLElement | null;
      const date = targetDay?.dataset.date ?? origin.endDate;
      const minute = this.minuteFromClientY(targetDay ?? day, move.clientY);
      this.pointerLayer = updateResizeDrag(this.pointerLayer, date, minute, selectable);
      moved = true;
      const g = this.pointerLayer.current;
      const ghostEnd = g.endDate === g.startDate ? g.endMinute : 24 * 60;
      this.timeline?.setGhostSelection(g.startDate, g.startMinute, ghostEnd);
    };
    const finish = (up: PointerEvent): void => {
      releaseSelection?.();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      this.timeline?.clearGhostSelection();
      if (up.type === 'pointercancel' || !this.pointerLayer || this.pointerLayer.kind !== 'resize-end') {
        abortPointerLayer(this.pointerLayer);
        this.pointerLayer = null;
        return;
      }
      if (!moved) {
        abortPointerLayer(this.pointerLayer);
        this.pointerLayer = null;
        return;
      }
      const geometry = finalizeResizeDrag(this.pointerLayer);
      this.pointerLayer = null;
      this.openCompanionGeometricEdit(origin, geometry);
    };
    const cancel = (ev: PointerEvent): void => finish(ev);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    void down;
  }

  private commitTemporalKeyboard(
    origin: EventGeometry,
    action: ReturnType<typeof parseTemporalKeyboard>,
  ): void {
    if (!action || !this.timeline) return;
    const dates = [...this.timeline.model.dates];
    const mode = dates.length === 1 ? 'day' : 'week';
    const result = applyTemporalKeyboard(origin, action, this.currentInteractionRange(dates, mode));
    if (result.kind === 'rejected' || result.kind === 'noop') {
      this.timeline.announce(result.kind === 'rejected' ? result.reason : result.announcement);
      return;
    }
    this.openCompanionGeometricEdit(origin, result.geometry);
  }

  private openCompanionGeometricEdit(before: EventGeometry, after: EventGeometry): void {
    const detail = this.selectedDetail;
    if (!detail || detail.event.id !== after.eventId) return;
    const draft = draftFromEvent(detail.event, detail.edit_token);
    applyGeometryToDraft(draft, after);
    // Recurring: leave scope unresolved when multiple supported scopes (AC-034).
    const scopes = (detail.capabilities.recurrence_scopes ?? []).filter(
      (scope): scope is SupportedRecurrenceScope =>
        scope === 'this_occurrence' || scope === 'entire_series',
    );
    this.ensureCompanion();
    this.companion?.openEdit(draft, detail, {
      changeSummary: {
        before: formatGeometryClock(before),
        after: formatGeometryClock(after),
      },
      recurrenceScopes: scopes,
      recurrencePatternSupported: detail.capabilities.recurrence_pattern_supported === true,
    });
  }

  private projectionFingerprint(): string {
    const projection = this.rangeProjection;
    if (!projection) return '';
    return `${projection.from}:${projection.to}:${projection.entries.map(entry => entry.event_id).join(',')}`;
  }

  private async refreshRangeProjection(): Promise<void> {
    const dates = this.visibleDatesForProjection();
    const window = projectionWindow(dates);
    if (!window) {
      this.rangeProjection = null;
      return;
    }
    try {
      const next = await calendarRangeProjection({ from: window.from, to: window.to });
      if (this.lastDisplayTz && this.lastDisplayTz !== next.display_tz) {
        this.invalidateDetailRequest();
      }
      this.lastDisplayTz = next.display_tz;
      this.rangeProjection = next;
    } catch (err: unknown) {
      this.rangeProjection = null;
      if (isJinErrorDto(err)) {
        this.dispatch('error', { detail: err, prefix: 'app', bubbles: true });
      }
    }
  }

  private visibleDatesForProjection(): string[] {
    if (this.viewMode === 'day') {
      const date = this.selectedDate || this.toISODate(new Date());
      return [date];
    }
    if (this.viewMode === 'week') {
      const anchor = new Date(`${this.selectedDate || this.toISODate(new Date())}T00:00:00`);
      anchor.setDate(anchor.getDate() - anchor.getDay());
      const dates: string[] = [];
      for (let index = 0; index < 7; index++) {
        const date = new Date(anchor);
        date.setDate(anchor.getDate() + index);
        dates.push(this.toISODate(date));
      }
      return dates;
    }
    const monthGrid = this.buildMonthGrid(this.currentYear, this.currentMonth);
    return monthGrid.weeks.flatMap(week => week.map(day => day.date));
  }

  private ensureCompanion(): void {
    if (this.companion) return;
    const field = this.hasFieldTarget ? this.fieldTarget : this.monthViewTarget;
    const workspace = (this.hasWorkspaceTarget ? this.workspaceTarget : this.element) as HTMLElement;
    this.companion = new EventCompanion({
      workspace,
      field,
      locale: resolveEventLocale(),
      destination: this.lastWritableDestination ?? undefined,
      onDestinationChange: destination => {
        this.pendingCreateDestination = destination;
      },
      onOpenFullDetails: (eventId) => {
        this.dispatch('navigate', { detail: { kind: 'events', id: eventId }, prefix: 'jin', bubbles: true });
      },
      onSave: async (draft) => this.saveCompanionDraft(draft),
      onClose: () => {
        this.pointerLayer = null;
        this.pendingCreateDestination = null;
        this.invalidateDetailRequest();
      },
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.workspaceObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width ?? this.element.getBoundingClientRect().width;
        this.companion?.setContentBox(width);
      });
      this.workspaceObserver.observe(workspace);
      this.companion.setContentBox(workspace.getBoundingClientRect().width || 1280);
    } else {
      this.companion.setContentBox(workspace.getBoundingClientRect().width || 1280);
    }
  }

  private async openCompanionCreate(slot: DraftSlot, anchor: HTMLElement | null = null): Promise<void> {
    if (this.companion?.isOpen() && !await this.companion.prepareReplacement()) return;
    this.ensureCompanion();
    this.companion?.setAnchor(anchor);
    const draft = draftFromSlot(slot);
    const destinations = this.createDestinations();
    const remembered = this.destinationForCreate();
    const destination = remembered
      ? destinations.find(choice => choice.accountId === remembered.accountId
        && choice.calendarId === remembered.calendarId)
      : undefined;
    this.pendingCreateDestination = destination ?? (!remembered && destinations.length === 1 ? destinations[0] : null);
    this.companion?.openCreate(draft, this.pendingCreateDestination ?? undefined, destinations);
  }

  private createDestinations(): ComposerDestination[] {
    const local: ComposerDestination = { name: eventMessage('jinCalendarName'), color: calendarColor('jin') };
    const routed = this.filterAccounts.flatMap(account => account.calendars
      .filter(calendar => account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable)
      .map(calendar => ({
        name: calendar.name,
        alias: account.alias,
        accountId: account.id,
        calendarId: calendar.calendar_id,
        allowedConferenceSolutionTypes: calendar.allowed_conference_solution_types,
        color: calendarColor(googleCalendarKey(account.id, calendar.calendar_id)),
      })));
    return [local, ...routed];
  }

  private destinationForCreate(): ComposerDestination | null {
    // Filter must not silently select a hidden destination.
    return this.lastWritableDestination;
  }

  private restoreLastDestination(): void {
    try {
      const raw = localStorage.getItem(CalendarViewController.LAST_DEST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ComposerDestination;
      if (parsed && typeof parsed.name === 'string') this.lastWritableDestination = parsed;
    } catch {
      this.lastWritableDestination = null;
    }
  }


  private async refreshWritableDestinationCount(): Promise<void> {
    try {
      const accounts = await listGoogleAccounts();
      this.writableDestinationCount = accounts.reduce((count, account) => (
        count + account.calendars.filter(calendar => (
          account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable
        )).length
      ), 0);
    } catch {
      this.writableDestinationCount = 0;
    }
  }

  private rememberDestination(destination: ComposerDestination): void {
    this.lastWritableDestination = destination;
    localStorage.setItem(CalendarViewController.LAST_DEST_KEY, JSON.stringify(destination));
  }

  private async saveCompanionDraft(draft: EventDraft): Promise<CompanionSaveResult> {
    if (draft.event_id && draft.edit_token) {
      const event = this.allEvents.find(item => item.id === draft.event_id) ?? this.selectedDetail?.event;
      const sync = event?.sync_context;
      const operationId = newOperationId('edit');
      if (sync?.provider === 'google' && sync.account_id && sync.calendar_id) {
        await editRoutedEventDelta(
          routedEditPayloadFromDraft(
            draft,
            { account_id: sync.account_id, calendar_id: sync.calendar_id },
            operationId,
          ),
        );
      } else {
        await editEventDelta(editPayloadFromDraft(draft, operationId));
      }
      this.allEvents = await listEvents();
      await this.refreshRangeProjection();
      void this.renderCurrentView();
      this.notifyMutation();
      const detail = await getEventDetailById(draft.event_id);
      return {
        detail,
        outcome: sync?.provider === 'google' ? 'sync_pending' : 'local',
      };
    }
    const destination = this.pendingCreateDestination;
    if (!destination) throw new Error(eventMessage('chooseExactDestination'));
    const emails = draft.attendees?.map(attendee => attendee.email ?? '').filter(Boolean) ?? [];
    const invalidEmail = emails.find(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidEmail) throw new Error(eventMessageFormat('invalidGuestEmail', { email: invalidEmail }));
    if (emails.length > 200) throw new Error(eventMessage('tooManyGuests'));
    if (!destination.accountId && (emails.length > 0 || draft.conference_intent.kind !== 'preserve' || Boolean(draft.recurrence))) {
      throw new Error(eventMessage('googleDestinationRequired'));
    }
    if (destination?.accountId || destination?.calendarId) {
      if (!destination.accountId || !destination.calendarId) {
        throw new Error(eventMessage('chooseExactDestination'));
      }
      const accounts = await listGoogleAccounts();
      const account = accounts.find(item => item.id === destination.accountId && item.state === 'connected');
      const calendar = account?.calendars.find(item => item.calendar_id === destination.calendarId);
      if (!calendar?.enabled || !calendar.available || !calendar.writable) {
        throw new Error(eventMessage('destinationNoLongerWritable'));
      }
      if (draft.conference_intent.kind === 'add'
        && calendar.allowed_conference_solution_types.length > 0
        && !calendar.allowed_conference_solution_types.includes('hangoutsMeet')) {
        throw new Error(eventMessage('destinationNoMeet'));
      }
    }
    const route = destination?.accountId && destination?.calendarId
      ? { account_id: destination.accountId, calendar_id: destination.calendarId }
      : null;
    const created = route
      ? await createRoutedEvent(
        routedCreateInputFromDraft(draft, route, newOperationId('create')),
      )
      : await createEvent(createInputFromDraft(draft));
    if (destination) this.rememberDestination(destination);
    else this.rememberDestination({ name: eventMessage('jinCalendarName') });
    if (route) {
      try {
        await syncCalendarEvent(created.id);
      } catch {
        // Outbox retains the request; detail exposes retry.
      } finally {
        window.dispatchEvent(new CustomEvent('jin:google-state-changed'));
      }
    }
    this.allEvents = await listEvents();
    await this.refreshRangeProjection();
    void this.renderCurrentView();
    this.notifyMutation();
    const detail = await getEventDetailById(created.id);
    return { detail, outcome: route ? 'sync_pending' : 'local' };
  }

  private wireTimelineInteraction(
    rendered: RenderedTimeGrid,
    dates: string[],
    mode: 'day' | 'week',
    selectable: (date: string, minute: number) => boolean,
    displayTz: string,
  ): void {
    const occupancy = occupancyFromModel(rendered.model);
    const range = {
      dates,
      mode,
      bandStart: 0,
      bandEnd: 24 * 60,
      occupancy,
      isSelectable: selectable,
    };

    rendered.scroller.addEventListener('keydown', event => {
      const key = event.key as CursorMoveKey;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'].includes(key)) {
        return;
      }
      event.preventDefault();
      if (key === 'Escape' && this.pointerLayer) {
        abortPointerLayer(this.pointerLayer);
        this.pointerLayer = null;
        rendered.clearGhostSelection();
        rendered.announce(eventMessage('cancel'));
        return;
      }
      const result = applyCursorKey(this.temporalCursor, key, range);
      if (result.kind === 'clear') {
        this.temporalCursor = null;
        rendered.setCursor(null);
        rendered.announce('');
        return;
      }
      if (result.kind === 'cursor') {
        this.temporalCursor = result.cursor;
        this.cursorMemory = { rangeKey: rangeKey(dates), cursor: result.cursor };
        rendered.setCursor(result.cursor);
        rendered.announce(result.announcement);
        return;
      }
      if (result.kind === 'noop') {
        rendered.announce(result.announcement);
        return;
      }
      if (result.kind === 'create') {
        this.openCompanionCreate({ ...result.slot, timezone: displayTz });
        return;
      }
      if (result.kind === 'open') {
        this.openEventDetail(result.eventId);
      }
    });

    // Fine-pointer drag on empty time — never install custom touch drag.
    rendered.scroller.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      if (pointerCreatePolicy('fine') !== 'tap-and-drag') return;
      const target = event.target as HTMLElement;
      if (target.closest('.calendar-timegrid__event, .calendar-timegrid__all-day-event, .calendar-timegrid__night-toggle, .calendar-timegrid__date')) {
        return;
      }
      const day = target.closest('.calendar-timegrid__day') as HTMLElement | null;
      const date = day?.dataset.date;
      if (!date || !day) return;
      const rect = day.getBoundingClientRect();
      const y = event.clientY - rect.top;
      let bestMinute = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      const expansion = this.effectiveNightExpansion();
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const projected = projectedMinute(minute, expansion) * GRID_PX_PER_MINUTE;
        const dist = Math.abs(projected - y);
        if (dist < bestDist) {
          bestDist = dist;
          bestMinute = minute;
        }
      }
      if (!selectable(date, bestMinute)) return;
      event.preventDefault();
      this.pointerLayer = beginTimedDrag(date, bestMinute);
      rendered.setGhostSelection(date, bestMinute, bestMinute + 15);
      let releaseSelection: (() => void) | null = null;
      const onMove = (move: PointerEvent): void => {
        if (!this.pointerLayer || this.pointerLayer.kind !== 'timed-range') return;
        if (!releaseSelection) releaseSelection = beginMovementSelection(rendered.scroller);
        const moveY = move.clientY - rect.top;
        let minute = bestMinute;
        let dist = Number.POSITIVE_INFINITY;
        for (let candidate = 0; candidate < 24 * 60; candidate += 15) {
          const projected = projectedMinute(candidate, expansion) * GRID_PX_PER_MINUTE;
          const nextDist = Math.abs(projected - moveY);
          if (nextDist < dist) {
            dist = nextDist;
            minute = candidate;
          }
        }
        this.pointerLayer = updateTimedDrag(this.pointerLayer, minute);
        rendered.setGhostSelection(
          this.pointerLayer.date,
          this.pointerLayer.originMinute,
          this.pointerLayer.currentMinute,
        );
      };
      const finish = (up: PointerEvent): void => {
        releaseSelection?.();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', cancel);
        rendered.clearGhostSelection();
        if (up.type === 'pointercancel' || !this.pointerLayer || this.pointerLayer.kind !== 'timed-range') {
          abortPointerLayer(this.pointerLayer);
          this.pointerLayer = null;
          return;
        }
        const slot = finalizeTimedDrag(this.pointerLayer, displayTz);
        this.pointerLayer = null;
        this.openCompanionCreate(slot);
      };
      const cancel = (ev: PointerEvent): void => finish(ev);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    });
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
