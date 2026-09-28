import type { EventDto } from '../../types/dto';
import { eventMessage, type EventLocaleKey } from '../events/locale';
import {
  buildTimeGrid,
  EARLY_NIGHT_END,
  GRID_PX_PER_MINUTE,
  LATE_NIGHT_START,
  MINUTES_PER_DAY,
  nighttimeContent,
  projectedMinute,
  projectedTotalMinutes,
  projectSegment,
  type DisplayTimeSlot,
  type NightBand,
  type NightExpansion,
  type TimeGridModel,
  type TimedSegment,
} from './time_grid';
import type { TemporalCursor } from './interaction';
import {
  applyCalendarColor,
  calendarMembershipIdentity,
  calendarProviderForEvent,
  formatCalendarMembershipShort,
} from './colors';

export interface TimeGridRenderOptions {
  events?: EventDto[];
  /** When provided, skips client-side wall-time build in favor of projection geometry. */
  model?: TimeGridModel;
  dates: string[];
  mode: 'day' | 'week';
  locale: EventLocaleKey;
  todayDate: string;
  nowMinute: number;
  expansion: NightExpansion;
  displaySlots?: ReadonlyMap<string, readonly DisplayTimeSlot[]>;
  cursor?: TemporalCursor | null;
  onEvent: (eventId: string, control: HTMLButtonElement) => void;
  onDate: (date: string) => void;
  onNightToggle: (band: NightBand) => void;
  onEmptySlot?: (date: string, minute: number) => void;
  onAgendaSelect?: (eventId: string) => void;
}

export interface RenderedTimeGrid {
  root: HTMLElement;
  scroller: HTMLElement;
  model: TimeGridModel;
  liveRegion: HTMLElement;
  agenda: HTMLElement;
  setExpansion: (expansion: NightExpansion) => void;
  updateNowMarker: (todayDate: string, nowMinute: number) => void;
  setCursor: (cursor: TemporalCursor | null) => void;
  announce: (message: string) => void;
  setGhostSelection: (date: string, startMinute: number, endMinute: number) => void;
  clearGhostSelection: () => void;
}

function minuteLabel(minute: number, locale: EventLocaleKey): string {
  const bounded = Math.max(0, Math.min(MINUTES_PER_DAY, minute));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(2020, 0, 1, Math.floor(bounded / 60), bounded % 60)));
}

export function calendarEventSourceLabel(event: EventDto, locale: EventLocaleKey): string {
  const jinLabel = eventMessage('jinCalendarName', locale);
  const membership = calendarMembershipIdentity(event, jinLabel);
  if (event.sync_context?.provider === 'google') {
    return `${eventMessage('sourceGoogle', locale)}, ${membership.accountAlias}, ${membership.label}`;
  }
  return membership.provider === 'google'
    ? eventMessage('sourceGoogle', locale)
    : eventMessage('sourceJin', locale);
}

function sourceShort(event: EventDto, locale: EventLocaleKey): string {
  const jinLabel = eventMessage('jinCalendarName', locale);
  const membership = calendarMembershipIdentity(event, jinLabel);
  if (event.sync_context?.provider === 'google') {
    return formatCalendarMembershipShort(membership);
  }
  return membership.provider === 'google' ? 'Google' : jinLabel;
}

function eventRangeLabel(segment: TimedSegment, locale: EventLocaleKey): string {
  const range = `${minuteLabel(segment.semanticStartMinute, locale)}–${minuteLabel(segment.semanticEndMinute, locale)}`;
  const parts = [range];
  if (segment.continuesBefore) parts.unshift(eventMessage('continuedFromBefore', locale));
  if (segment.continuesAfter) parts.push(eventMessage('continuesAfter', locale));
  return parts.join(' · ');
}

function eventAccessibleName(event: EventDto, time: string, locale: EventLocaleKey): string {
  const parts = [event.title, time, calendarEventSourceLabel(event, locale)];
  if (event.derived_from) parts.push(eventMessage('timeBlock', locale));
  return parts.join(', ');
}

function addIdentity(target: HTMLElement, event: EventDto, locale: EventLocaleKey): void {
  const source = document.createElement('span');
  source.className = 'calendar-timegrid__source jin-badge';
  source.dataset.source = calendarProviderForEvent(event);
  const text = document.createElement('span');
  text.textContent = sourceShort(event, locale);
  source.appendChild(text);
  target.appendChild(source);
  if (event.derived_from) {
    const kind = document.createElement('span');
    kind.className = 'calendar-timegrid__kind jin-badge';
    kind.textContent = eventMessage('timeBlock', locale);
    target.appendChild(kind);
  }
}

function nightSummary(
  model: TimeGridModel,
  band: NightBand,
  locale: EventLocaleKey,
  todayDate: string,
  nowMinute: number,
): string {
  const content = nighttimeContent(model, band, todayDate, nowMinute);
  const bandLabel = eventMessage(band === 'early' ? 'earlyNight' : 'lateNight', locale);
  const count = content.eventCount === 0
    ? eventMessage('noNightEvents', locale)
    : `${content.eventCount} ${eventMessage(content.eventCount === 1 ? 'event' : 'events', locale).toLocaleLowerCase(locale)}`;
  const range = content.firstMinute === null || content.lastMinute === null
    ? ''
    : `, ${minuteLabel(content.firstMinute, locale)}–${minuteLabel(content.lastMinute, locale)}`;
  const now = content.containsCurrentTime ? `, ${eventMessage('currentTime', locale)}` : '';
  return `${bandLabel}: ${count}${range}${now}`;
}

function buildEventButton(
  segment: TimedSegment,
  locale: EventLocaleKey,
  onEvent: TimeGridRenderOptions['onEvent'],
): HTMLButtonElement {
  const event = segment.event;
  const time = eventRangeLabel(segment, locale);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'calendar-timegrid__event';
  button.dataset.eventId = event.id;
  const membership = calendarMembershipIdentity(event, eventMessage('jinCalendarName', locale));
  button.dataset.source = membership.provider;
  applyCalendarColor(button, membership.color);
  button.setAttribute('aria-label', eventAccessibleName(event, time, locale));
  const title = document.createElement('span');
  title.className = 'calendar-timegrid__event-title';
  title.textContent = event.title;
  const range = document.createElement('span');
  range.className = 'calendar-timegrid__event-time';
  range.textContent = time;
  const identity = document.createElement('span');
  identity.className = 'calendar-timegrid__identity';
  addIdentity(identity, event, locale);
  button.append(title, range, identity);
  button.addEventListener('click', () => onEvent(event.id, button));
  return button;
}

function buildAllDayButton(
  span: TimeGridModel['allDaySpans'][number],
  locale: EventLocaleKey,
  onEvent: TimeGridRenderOptions['onEvent'],
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'calendar-timegrid__all-day-event';
  button.dataset.eventId = span.event.id;
  {
    const membership = calendarMembershipIdentity(span.event, eventMessage('jinCalendarName', locale));
    button.dataset.source = membership.provider;
    applyCalendarColor(button, membership.color);
  }
  button.style.gridColumn = `${span.startDateIndex + 1} / ${span.endDateIndexExclusive + 1}`;
  button.style.gridRow = String(span.lane + 1);
  const continuation = [
    span.continuesBefore ? eventMessage('continuedFromBefore', locale) : '',
    span.continuesAfter ? eventMessage('continuesAfter', locale) : '',
  ].filter(Boolean).join(' · ');
  button.setAttribute('aria-label', eventAccessibleName(
    span.event,
    `${eventMessage('allDay', locale)}${continuation ? `, ${continuation}` : ''}`,
    locale,
  ));
  const title = document.createElement('span');
  title.className = 'calendar-timegrid__all-day-title';
  title.textContent = `${span.continuesBefore ? '← ' : ''}${span.event.title}${span.continuesAfter ? ' →' : ''}`;
  const identity = document.createElement('span');
  identity.className = 'calendar-timegrid__identity';
  addIdentity(identity, span.event, locale);
  button.append(title, identity);
  button.addEventListener('click', () => onEvent(span.event.id, button));
  return button;
}

function slotStateAt(
  slots: ReadonlyMap<string, readonly DisplayTimeSlot[]> | undefined,
  date: string,
  minute: number,
): DisplayTimeSlot | null {
  const day = slots?.get(date);
  if (!day) return null;
  return day.find(slot => slot.minute === minute) ?? null;
}

/** Render one shared chronological surface for either one Day or exactly seven Week dates. */
export function renderTimeGrid(options: TimeGridRenderOptions): RenderedTimeGrid {
  const model = options.model ?? buildTimeGrid(options.events ?? [], options.dates);
  let currentExpansion = options.expansion;
  const root = document.createElement('section');
  root.className = `calendar-timegrid calendar-timegrid--${options.mode}`;
  root.setAttribute('aria-label', eventMessage(options.mode === 'day' ? 'dayTimeline' : 'weekTimeline', options.locale));
  root.dataset.mode = options.mode;
  root.style.setProperty('--calendar-px-per-minute', `${GRID_PX_PER_MINUTE}px`);

  const liveRegion = document.createElement('div');
  liveRegion.className = 'calendar-timegrid__live sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  root.appendChild(liveRegion);

  const layout = document.createElement('div');
  layout.className = 'calendar-timegrid__layout';

  const scroller = document.createElement('div');
  scroller.className = 'calendar-timegrid__scroller';
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'grid');
  scroller.setAttribute('aria-label', eventMessage(options.mode === 'day' ? 'dayTimeline' : 'weekTimeline', options.locale));

  const surface = document.createElement('div');
  surface.className = 'calendar-timegrid__surface';
  surface.style.setProperty('--calendar-grid-days', String(model.dates.length));

  const header = document.createElement('div');
  header.className = 'calendar-timegrid__header';
  const headerCorner = document.createElement('div');
  headerCorner.className = 'calendar-timegrid__corner';
  header.appendChild(headerCorner);
  model.dates.forEach(date => {
    const dateButton = document.createElement('button');
    dateButton.type = 'button';
    dateButton.className = 'calendar-timegrid__date';
    dateButton.dataset.date = date;
    if (date === options.todayDate) {
      dateButton.dataset.today = 'true';
      dateButton.setAttribute('aria-current', 'date');
    }
    const [year, month, day] = date.split('-').map(Number);
    const dateObject = new Date(Date.UTC(year, month - 1, day));
    const weekday = document.createElement('span');
    weekday.className = 'calendar-timegrid__date-weekday';
    weekday.textContent = new Intl.DateTimeFormat(options.locale, {
      weekday: options.mode === 'day' ? 'long' : 'short', timeZone: 'UTC',
    }).format(dateObject);
    const number = document.createElement('span');
    number.className = 'calendar-timegrid__date-number';
    number.textContent = String(day);
    dateButton.append(weekday, number);
    dateButton.setAttribute('aria-label', new Intl.DateTimeFormat(options.locale, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(dateObject));
    dateButton.addEventListener('click', () => options.onDate(date));
    header.appendChild(dateButton);
  });
  surface.appendChild(header);

  const allDay = document.createElement('div');
  allDay.className = 'calendar-timegrid__all-day';
  const allDayLabel = document.createElement('div');
  allDayLabel.className = 'calendar-timegrid__all-day-label';
  allDayLabel.textContent = eventMessage('allDay', options.locale);
  const allDayTrack = document.createElement('div');
  allDayTrack.className = 'calendar-timegrid__all-day-track';
  allDayTrack.setAttribute('aria-label', eventMessage('allDayLane', options.locale));
  allDayTrack.style.setProperty('--calendar-all-day-lanes', String(Math.max(1, ...model.allDaySpans.map(span => span.laneCount), 1)));
  model.allDaySpans.forEach(span => allDayTrack.appendChild(buildAllDayButton(span, options.locale, options.onEvent)));
  allDay.append(allDayLabel, allDayTrack);
  surface.appendChild(allDay);

  const body = document.createElement('div');
  body.className = 'calendar-timegrid__body';
  const gutter = document.createElement('div');
  gutter.className = 'calendar-timegrid__gutter';
  const hourItems: HTMLElement[] = [];
  for (let hour = 0; hour <= 24; hour++) {
    const label = document.createElement('span');
    label.className = 'calendar-timegrid__hour-label';
    label.dataset.minute = String(hour * 60);
    label.dataset.band = hour < 6 ? 'early' : hour >= 22 ? 'late' : 'daytime';
    label.textContent = new Intl.DateTimeFormat(options.locale, {
      hour: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(2020, 0, 1, hour === 24 ? 0 : hour)));
    gutter.appendChild(label);
    hourItems.push(label);
  }
  const toggles = new Map<NightBand, HTMLButtonElement>();
  (['early', 'late'] as const).forEach(band => {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calendar-timegrid__night-toggle';
    toggle.dataset.band = band;
    toggle.addEventListener('click', () => options.onNightToggle(band));
    gutter.appendChild(toggle);
    toggles.set(band, toggle);
  });
  body.appendChild(gutter);

  const dayColumns: HTMLElement[] = [];
  const segmentElements: Array<{ segment: TimedSegment; element: HTMLButtonElement }> = [];
  const cursorEl = document.createElement('span');
  cursorEl.className = 'calendar-timegrid__cursor hidden';
  cursorEl.setAttribute('aria-hidden', 'true');
  const ghostEl = document.createElement('span');
  ghostEl.className = 'calendar-timegrid__ghost hidden';
  ghostEl.setAttribute('aria-hidden', 'true');

  model.dates.forEach(date => {
    const day = document.createElement('section');
    day.className = 'calendar-timegrid__day';
    day.dataset.date = date;
    day.setAttribute('aria-label', header.querySelector<HTMLElement>(`[data-date="${date}"]`)?.textContent ?? date);

    const slots = options.displaySlots?.get(date) ?? [];
    for (const slot of slots) {
      if (slot.state === 'exact') continue;
      const marker = document.createElement('span');
      marker.className = 'calendar-timegrid__slot-state';
      marker.dataset.state = slot.state;
      marker.dataset.minute = String(slot.minute);
      marker.setAttribute('aria-hidden', 'true');
      if (slot.state === 'nonexistent') {
        marker.classList.add('calendar-timegrid__slot-state--unavailable');
      } else {
        marker.classList.add('calendar-timegrid__slot-state--ambiguous');
        marker.title = options.locale === 'pt-BR' ? 'Ocorrência anterior' : 'Earlier occurrence';
      }
      day.appendChild(marker);
      hourItems.push(marker);
    }

    for (let hour = 0; hour <= 24; hour++) {
      const rule = document.createElement('span');
      rule.className = 'calendar-timegrid__hour-rule';
      rule.dataset.minute = String(hour * 60);
      rule.dataset.band = hour < 6 ? 'early' : hour >= 22 ? 'late' : 'daytime';
      rule.setAttribute('aria-hidden', 'true');
      day.appendChild(rule);
      hourItems.push(rule);
    }
    model.timedByDate.get(date)?.forEach(segment => {
      const element = buildEventButton(segment, options.locale, options.onEvent);
      element.style.setProperty('--calendar-event-column', String(segment.overlapColumn));
      element.style.setProperty('--calendar-event-columns', String(segment.overlapColumnCount));
      day.appendChild(element);
      segmentElements.push({ segment, element });
    });

    if (options.onEmptySlot) {
      day.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        if (target.closest('.calendar-timegrid__event, .calendar-timegrid__all-day-event, .calendar-timegrid__night-toggle')) {
          return;
        }
        const rect = day.getBoundingClientRect();
        const y = event.clientY - rect.top + (day.parentElement?.scrollTop ?? 0);
        const pxPerMinute = GRID_PX_PER_MINUTE;
        const projected = y / pxPerMinute;
        // Find nearest semantic minute by scanning projectedMinute — coarse approx for create.
        let bestMinute = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let minute = 0; minute < MINUTES_PER_DAY; minute += 15) {
          const projectedAt = projectedMinute(minute, currentExpansion);
          const dist = Math.abs(projectedAt - projected);
          if (dist < bestDist) {
            bestDist = dist;
            bestMinute = minute;
          }
        }
        const slot = slotStateAt(options.displaySlots, date, bestMinute);
        if (slot && !slot.selectable) return;
        options.onEmptySlot?.(date, bestMinute);
      });
    }

    body.appendChild(day);
    dayColumns.push(day);
  });
  body.appendChild(cursorEl);
  body.appendChild(ghostEl);
  surface.appendChild(body);
  scroller.appendChild(surface);

  const agenda = document.createElement('div');
  agenda.className = 'calendar-timegrid__agenda';
  agenda.setAttribute('role', 'list');
  const agendaLabel = options.locale === 'pt-BR' ? 'Agenda' : 'Agenda';
  agenda.setAttribute('aria-label', agendaLabel);
  const chronological: TimedSegment[] = [];
  model.dates.forEach(date => {
    model.timedByDate.get(date)?.forEach(segment => chronological.push(segment));
  });
  chronological.sort((a, b) => a.date.localeCompare(b.date)
    || a.semanticStartMinute - b.semanticStartMinute
    || a.event.id.localeCompare(b.event.id));
  chronological.forEach(segment => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'calendar-timegrid__agenda-item tap-target';
    item.setAttribute('role', 'listitem');
    item.dataset.eventId = segment.event.id;
    item.textContent = `${segment.date} ${minuteLabel(segment.semanticStartMinute, options.locale)} · ${segment.event.title}`;
    item.addEventListener('click', () => {
      (options.onAgendaSelect ?? ((id: string) => options.onEvent(id, item)))(segment.event.id);
    });
    agenda.appendChild(item);
  });

  layout.appendChild(scroller);
  if (chronological.length) {
    const disclosure = document.createElement('details');
    disclosure.className = 'calendar-timegrid__agenda-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = agendaLabel;
    disclosure.append(summary, agenda);
    layout.appendChild(disclosure);
  }
  root.appendChild(layout);

  let currentTodayDate = options.todayDate;
  let currentNowMinute = options.nowMinute;
  let currentCursor: TemporalCursor | null = options.cursor ?? null;

  const updateToggleCopy = (): void => {
    (['early', 'late'] as const).forEach(band => {
      const toggle = toggles.get(band)!;
      const summary = nightSummary(model, band, options.locale, currentTodayDate, currentNowMinute);
      toggle.setAttribute('aria-label', `${currentExpansion[band] ? eventMessage('hide', options.locale) : eventMessage('show', options.locale)} ${summary}`);
      toggle.title = summary;
      toggle.textContent = currentExpansion[band]
        ? eventMessage('hide', options.locale)
        : band === 'early' ? '0–6' : '22–24';
    });
  };

  const placeCursor = (): void => {
    if (!currentCursor) {
      cursorEl.classList.add('hidden');
      return;
    }
    const day = dayColumns.find(column => column.dataset.date === currentCursor!.date);
    if (!day) {
      cursorEl.classList.add('hidden');
      return;
    }
    cursorEl.classList.remove('hidden');
    cursorEl.style.setProperty('--calendar-cursor-minute', String(projectedMinute(currentCursor.minute, currentExpansion)));
    if (cursorEl.parentElement !== day) day.appendChild(cursorEl);
  };

  const updateNowMarker = (todayDate: string, nowMinute: number): void => {
    currentTodayDate = todayDate;
    currentNowMinute = nowMinute;
    const existingMarker = body.querySelector<HTMLElement>('.calendar-timegrid__now');
    const today = dayColumns.find(column => column.dataset.date === todayDate);
    if (today) {
      const marker = existingMarker ?? document.createElement('span');
      if (!existingMarker) {
        marker.className = 'calendar-timegrid__now';
        marker.setAttribute('aria-hidden', 'true');
      }
      marker.style.setProperty('--calendar-now', String(projectedMinute(nowMinute, currentExpansion)));
      if (marker.parentElement !== today) today.appendChild(marker);
    } else {
      existingMarker?.remove();
    }
    updateToggleCopy();
    placeCursor();
  };

  const setExpansion = (expansion: NightExpansion): void => {
    currentExpansion = expansion;
    root.dataset.earlyExpanded = String(expansion.early);
    root.dataset.lateExpanded = String(expansion.late);
    const total = projectedTotalMinutes(expansion);
    body.style.setProperty('--calendar-grid-total', String(total));
    hourItems.forEach(item => {
      const minute = Number(item.dataset.minute);
      item.style.setProperty('--calendar-grid-minute', String(projectedMinute(minute, expansion)));
    });
    segmentElements.forEach(({ segment, element }) => {
      const geometry = projectSegment(segment, expansion);
      element.style.setProperty('--calendar-event-start', String(geometry.start));
      element.style.setProperty('--calendar-event-duration', String(geometry.end - geometry.start));
    });
    (['early', 'late'] as const).forEach(band => {
      const toggle = toggles.get(band)!;
      const expanded = expansion[band];
      const startMinute = band === 'early' ? 0 : LATE_NIGHT_START;
      const endMinute = band === 'early' ? EARLY_NIGHT_END : MINUTES_PER_DAY;
      const start = projectedMinute(startMinute, expansion);
      const end = projectedMinute(endMinute, expansion);
      toggle.style.setProperty('--calendar-night-start', String(start));
      toggle.style.setProperty('--calendar-night-height', String(end - start));
      toggle.setAttribute('aria-expanded', String(expanded));
    });
    updateToggleCopy();
    updateNowMarker(currentTodayDate, currentNowMinute);
  };
  setExpansion(currentExpansion);

  const setCursor = (cursor: TemporalCursor | null): void => {
    currentCursor = cursor;
    placeCursor();
  };

  const announce = (message: string): void => {
    liveRegion.textContent = message;
  };

  const setGhostSelection = (date: string, startMinute: number, endMinute: number): void => {
    const day = dayColumns.find(column => column.dataset.date === date);
    if (!day) {
      ghostEl.classList.add('hidden');
      return;
    }
    ghostEl.classList.remove('hidden');
    const start = projectedMinute(Math.min(startMinute, endMinute), currentExpansion);
    const end = projectedMinute(Math.max(startMinute, endMinute), currentExpansion);
    ghostEl.style.setProperty('--calendar-ghost-start', String(start));
    ghostEl.style.setProperty('--calendar-ghost-duration', String(Math.max(end - start, 15)));
    if (ghostEl.parentElement !== day) day.appendChild(ghostEl);
  };

  const clearGhostSelection = (): void => {
    ghostEl.classList.add('hidden');
  };

  placeCursor();

  return {
    root,
    scroller,
    model,
    liveRegion,
    agenda,
    setExpansion,
    updateNowMarker,
    setCursor,
    announce,
    setGhostSelection,
    clearGhostSelection,
  };
}

export function formatGridMinute(minute: number, locale: EventLocaleKey): string {
  return minuteLabel(minute, locale);
}
