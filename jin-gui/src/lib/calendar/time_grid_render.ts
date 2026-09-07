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
  type NightBand,
  type NightExpansion,
  type TimeGridModel,
  type TimedSegment,
} from './time_grid';
import { applyCalendarColor, calendarColorForEvent } from './colors';

export interface TimeGridRenderOptions {
  events: EventDto[];
  dates: string[];
  mode: 'day' | 'week';
  locale: EventLocaleKey;
  todayDate: string;
  nowMinute: number;
  expansion: NightExpansion;
  onEvent: (eventId: string, control: HTMLButtonElement) => void;
  onDate: (date: string) => void;
  onNightToggle: (band: NightBand) => void;
}

export interface RenderedTimeGrid {
  root: HTMLElement;
  scroller: HTMLElement;
  model: TimeGridModel;
  setExpansion: (expansion: NightExpansion) => void;
  updateNowMarker: (todayDate: string, nowMinute: number) => void;
}

function minuteLabel(minute: number, locale: EventLocaleKey): string {
  const bounded = Math.max(0, Math.min(MINUTES_PER_DAY, minute));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(2020, 0, 1, Math.floor(bounded / 60), bounded % 60)));
}

function sourceLabel(event: EventDto, locale: EventLocaleKey): string {
  if (event.source.toLowerCase() !== 'google') return eventMessage('sourceJin', locale);
  const context = event.sync_context;
  return context
    ? `${eventMessage('sourceGoogle', locale)}, ${context.account_alias}, ${context.calendar_name}`
    : eventMessage('sourceGoogle', locale);
}

function sourceShort(event: EventDto): string {
  if (event.source.toLowerCase() !== 'google') return 'Jin';
  return event.sync_context
    ? `${event.sync_context.account_alias} · ${event.sync_context.calendar_name}`
    : 'Google';
}

function eventRangeLabel(segment: TimedSegment, locale: EventLocaleKey): string {
  const range = `${minuteLabel(segment.semanticStartMinute, locale)}–${minuteLabel(segment.semanticEndMinute, locale)}`;
  const parts = [range];
  if (segment.continuesBefore) parts.unshift(eventMessage('continuedFromBefore', locale));
  if (segment.continuesAfter) parts.push(eventMessage('continuesAfter', locale));
  return parts.join(' · ');
}

function eventAccessibleName(event: EventDto, time: string, locale: EventLocaleKey): string {
  const parts = [event.title, time, sourceLabel(event, locale)];
  if (event.derived_from) parts.push(eventMessage('timeBlock', locale));
  return parts.join(', ');
}

function addIdentity(target: HTMLElement, event: EventDto, locale: EventLocaleKey): void {
  const source = document.createElement('span');
  source.className = 'calendar-timegrid__source jin-badge';
  source.dataset.source = event.source.toLowerCase();
  const text = document.createElement('span');
  text.textContent = sourceShort(event);
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
  button.dataset.source = event.source.toLowerCase();
  applyCalendarColor(button, calendarColorForEvent(event));
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
  button.dataset.source = span.event.source.toLowerCase();
  applyCalendarColor(button, calendarColorForEvent(span.event));
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

/** Render one shared chronological surface for either one Day or exactly seven Week dates. */
export function renderTimeGrid(options: TimeGridRenderOptions): RenderedTimeGrid {
  const model = buildTimeGrid(options.events, options.dates);
  const root = document.createElement('section');
  root.className = `calendar-timegrid calendar-timegrid--${options.mode}`;
  root.setAttribute('aria-label', eventMessage(options.mode === 'day' ? 'dayTimeline' : 'weekTimeline', options.locale));
  root.dataset.mode = options.mode;
  root.style.setProperty('--calendar-px-per-minute', `${GRID_PX_PER_MINUTE}px`);

  const scroller = document.createElement('div');
  scroller.className = 'calendar-timegrid__scroller';
  scroller.tabIndex = 0;
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
    if (date === options.todayDate) dateButton.dataset.today = 'true';
    const [year, month, day] = date.split('-').map(Number);
    dateButton.textContent = new Intl.DateTimeFormat(options.locale, {
      weekday: options.mode === 'day' ? 'long' : 'short', month: 'short', day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
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
  allDayTrack.style.setProperty('--calendar-all-day-lanes', String(Math.max(1, ...model.allDaySpans.map(span => span.laneCount))));
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
    label.textContent = minuteLabel(hour === 24 ? 0 : hour * 60, options.locale);
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
  model.dates.forEach(date => {
    const day = document.createElement('section');
    day.className = 'calendar-timegrid__day';
    day.dataset.date = date;
    day.setAttribute('aria-label', header.querySelector<HTMLElement>(`[data-date="${date}"]`)?.textContent ?? date);
    for (let hour = 0; hour <= 24; hour++) {
      const rule = document.createElement('span');
      rule.className = 'calendar-timegrid__hour-rule';
      rule.dataset.minute = String(hour * 60);
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
    body.appendChild(day);
    dayColumns.push(day);
  });
  surface.appendChild(body);
  scroller.appendChild(surface);
  root.appendChild(scroller);

  let currentExpansion = options.expansion;
  let currentTodayDate = options.todayDate;
  let currentNowMinute = options.nowMinute;
  const updateToggleCopy = (): void => {
    (['early', 'late'] as const).forEach(band => {
      const toggle = toggles.get(band)!;
      const summary = nightSummary(model, band, options.locale, currentTodayDate, currentNowMinute);
      toggle.setAttribute('aria-label', `${currentExpansion[band] ? eventMessage('hide', options.locale) : eventMessage('show', options.locale)} ${summary}`);
      toggle.title = summary;
      toggle.textContent = summary;
    });
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

  return { root, scroller, model, setExpansion, updateNowMarker };
}

export function formatGridMinute(minute: number, locale: EventLocaleKey): string {
  return minuteLabel(minute, locale);
}
