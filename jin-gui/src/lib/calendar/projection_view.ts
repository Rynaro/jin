/**
 * Helpers for applying CalendarRangeProjectionDto to Calendar views (S5).
 */

import type { CalendarRangeEntryDto, CalendarRangeProjectionDto, EventDto } from '../../types/dto';
import { calendarKeyForEvent } from './colors';
import { isCalendarVisible, type CalendarVisibilityMap } from './visibility';

export function entryOccupiesDate(entry: CalendarRangeEntryDto, date: string): boolean {
  if (date >= entry.start_date && date <= entry.end_date) return true;
  return entry.continuation_dates.includes(date);
}

export function filterProjectionEntries(
  projection: CalendarRangeProjectionDto | null | undefined,
  events: readonly EventDto[],
  visibility: CalendarVisibilityMap,
): CalendarRangeEntryDto[] {
  if (!projection) return [];
  const byId = new Map(events.map(event => [event.id, event]));
  return projection.entries.filter(entry => {
    const event = byId.get(entry.event_id);
    if (!event) return false;
    return isCalendarVisible(calendarKeyForEvent(event), visibility);
  });
}

export function eventsFromProjectionForDate(
  projection: CalendarRangeProjectionDto | null | undefined,
  events: readonly EventDto[],
  visibility: CalendarVisibilityMap,
  date: string,
): EventDto[] {
  const byId = new Map(events.map(event => [event.id, event]));
  return filterProjectionEntries(projection, events, visibility)
    .filter(entry => entryOccupiesDate(entry, date))
    .map(entry => byId.get(entry.event_id)!)
    .filter(Boolean);
}

export function projectionWindow(
  dates: readonly string[],
): { from: string; to: string } | null {
  if (dates.length === 0) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}
