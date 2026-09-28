import type { CalendarRangeEntryDto, EventDto } from '../../types/dto';

export const MINUTES_PER_DAY = 24 * 60;
export const MIN_EVENT_VISUAL_MINUTES = 44;
export const GRID_PX_PER_MINUTE = 0.9;
export const EARLY_NIGHT_END = 6 * 60;
export const LATE_NIGHT_START = 22 * 60;
export const COMPRESSED_NIGHT_MINUTES = 54;

export type NightBand = 'early' | 'late';

export interface TimedSegment {
  event: EventDto;
  date: string;
  semanticStartMinute: number;
  semanticEndMinute: number;
  visualStartMinute: number;
  visualEndMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  overlapColumn: number;
  overlapColumnCount: number;
}

export interface AllDaySpan {
  event: EventDto;
  startDateIndex: number;
  endDateIndexExclusive: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
  laneCount: number;
}

export interface TimeGridModel {
  dates: string[];
  timedByDate: Map<string, TimedSegment[]>;
  allDaySpans: AllDaySpan[];
}

export interface NightBandContent {
  band: NightBand;
  eventCount: number;
  firstMinute: number | null;
  lastMinute: number | null;
  containsCurrentTime: boolean;
  occupied: boolean;
}

export interface NightExpansion {
  early: boolean;
  late: boolean;
}

export interface ProjectedTimeGeometry {
  start: number;
  end: number;
  total: number;
}

interface WallTime {
  date: string;
  minute: number;
  ordinal: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WALL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function dateOrdinal(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / 86_400_000);
}

export function parseStoredWallTime(value: string): WallTime | null {
  const match = ISO_WALL_TIME.exec(value);
  if (!match) return null;
  const ordinal = dateOrdinal(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (ordinal === null || hour > 23 || minute > 59) return null;
  return { date: match[1], minute: hour * 60 + minute, ordinal };
}

export function formatStoredStartTime(event: EventDto): string | null {
  if (event.is_all_day) return null;
  const start = parseStoredWallTime(event.start);
  if (!start) return null;
  return `${String(Math.floor(start.minute / 60)).padStart(2, '0')}:${String(start.minute % 60).padStart(2, '0')}`;
}

function absoluteMinute(value: WallTime): number {
  return value.ordinal * MINUTES_PER_DAY + value.minute;
}

function assignTimedColumns(segments: TimedSegment[]): void {
  segments.sort((left, right) => left.semanticStartMinute - right.semanticStartMinute
    || left.semanticEndMinute - right.semanticEndMinute
    || left.event.id.localeCompare(right.event.id));

  let cluster: TimedSegment[] = [];
  let clusterEnd = -1;
  const finish = (): void => {
    if (cluster.length === 0) return;
    const active: Array<{ end: number; column: number }> = [];
    let columnCount = 1;
    for (const segment of cluster) {
      for (let index = active.length - 1; index >= 0; index--) {
        if (active[index].end <= segment.semanticStartMinute) active.splice(index, 1);
      }
      const occupied = new Set(active.map(item => item.column));
      let column = 0;
      while (occupied.has(column)) column++;
      segment.overlapColumn = column;
      active.push({ end: segment.semanticEndMinute, column });
      columnCount = Math.max(columnCount, column + 1);
    }
    cluster.forEach(segment => { segment.overlapColumnCount = columnCount; });
    cluster = [];
    clusterEnd = -1;
  };

  for (const segment of segments) {
    if (cluster.length > 0 && segment.semanticStartMinute >= clusterEnd) finish();
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.semanticEndMinute);
  }
  finish();
}

function buildAllDaySpans(events: EventDto[], dates: string[], ordinals: number[]): AllDaySpan[] {
  if (dates.length === 0) return [];
  const windowStart = ordinals[0];
  const windowEnd = ordinals[ordinals.length - 1] + 1;
  const spans: AllDaySpan[] = [];

  for (const event of events) {
    if (!event.is_all_day) continue;
    const start = dateOrdinal(event.start);
    const end = dateOrdinal(event.end);
    if (start === null || end === null || end <= start || end <= windowStart || start >= windowEnd) continue;
    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    const startDateIndex = ordinals.findIndex(ordinal => ordinal >= clippedStart);
    let endDateIndexExclusive = startDateIndex;
    while (endDateIndexExclusive < ordinals.length && ordinals[endDateIndexExclusive] < clippedEnd) {
      endDateIndexExclusive++;
    }
    if (startDateIndex < 0 || endDateIndexExclusive <= startDateIndex) continue;
    spans.push({
      event,
      startDateIndex,
      endDateIndexExclusive,
      continuesBefore: start < windowStart,
      continuesAfter: end > windowEnd,
      lane: 0,
      laneCount: 1,
    });
  }

  spans.sort((left, right) => left.startDateIndex - right.startDateIndex
    || right.endDateIndexExclusive - left.endDateIndexExclusive
    || left.event.id.localeCompare(right.event.id));
  const laneEnds: number[] = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex(end => end <= span.startDateIndex);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = span.endDateIndexExclusive;
    span.lane = lane;
  }
  const laneCount = Math.max(1, laneEnds.length);
  spans.forEach(span => { span.laneCount = laneCount; });
  return spans;
}

/** Build deterministic calendar geometry from stored wall-clock components. */
export function buildTimeGrid(events: EventDto[], requestedDates: string[]): TimeGridModel {
  const dates: string[] = [];
  const ordinals: number[] = [];
  for (const date of requestedDates) {
    const ordinal = dateOrdinal(date);
    if (ordinal === null || dates.includes(date)) continue;
    dates.push(date);
    ordinals.push(ordinal);
  }
  const timedByDate = new Map<string, TimedSegment[]>(dates.map(date => [date, []]));

  for (const event of events) {
    if (event.is_all_day) continue;
    const start = parseStoredWallTime(event.start);
    const end = parseStoredWallTime(event.end);
    if (!start || !end || absoluteMinute(end) <= absoluteMinute(start)) continue;
    const absoluteStart = absoluteMinute(start);
    const absoluteEnd = absoluteMinute(end);

    dates.forEach((date, index) => {
      const dayStart = ordinals[index] * MINUTES_PER_DAY;
      const dayEnd = dayStart + MINUTES_PER_DAY;
      const clippedStart = Math.max(absoluteStart, dayStart);
      const clippedEnd = Math.min(absoluteEnd, dayEnd);
      if (clippedEnd <= clippedStart) return;
      const semanticStartMinute = clippedStart - dayStart;
      const semanticEndMinute = clippedEnd - dayStart;
      timedByDate.get(date)?.push({
        event,
        date,
        semanticStartMinute,
        semanticEndMinute,
        visualStartMinute: semanticStartMinute,
        visualEndMinute: Math.max(semanticEndMinute, semanticStartMinute + MIN_EVENT_VISUAL_MINUTES),
        continuesBefore: absoluteStart < dayStart,
        continuesAfter: absoluteEnd > dayEnd,
        overlapColumn: 0,
        overlapColumnCount: 1,
      });
    });
  }

  timedByDate.forEach(assignTimedColumns);
  return { dates, timedByDate, allDaySpans: buildAllDaySpans(events, dates, ordinals) };
}

function bandBounds(band: NightBand): [number, number] {
  return band === 'early' ? [0, EARLY_NIGHT_END] : [LATE_NIGHT_START, MINUTES_PER_DAY];
}

export function nighttimeContent(
  model: TimeGridModel,
  band: NightBand,
  todayDate?: string,
  nowMinute?: number,
): NightBandContent {
  const [bandStart, bandEnd] = bandBounds(band);
  const ids = new Set<string>();
  let firstMinute: number | null = null;
  let lastMinute: number | null = null;
  model.timedByDate.forEach(segments => {
    segments.forEach(segment => {
      const start = Math.max(segment.semanticStartMinute, bandStart);
      const end = Math.min(segment.semanticEndMinute, bandEnd);
      if (end <= start) return;
      ids.add(segment.event.id);
      firstMinute = firstMinute === null ? start : Math.min(firstMinute, start);
      lastMinute = lastMinute === null ? end : Math.max(lastMinute, end);
    });
  });
  const containsCurrentTime = Boolean(
    todayDate && model.dates.includes(todayDate) && nowMinute !== undefined
      && nowMinute >= bandStart && nowMinute < bandEnd,
  );
  return {
    band,
    eventCount: ids.size,
    firstMinute,
    lastMinute,
    containsCurrentTime,
    occupied: ids.size > 0,
  };
}

export function deriveNightExpansion(
  model: TimeGridModel,
  todayDate?: string,
  nowMinute?: number,
): NightExpansion {
  const early = nighttimeContent(model, 'early', todayDate, nowMinute);
  const late = nighttimeContent(model, 'late', todayDate, nowMinute);
  return {
    early: early.occupied || early.containsCurrentTime,
    late: late.occupied || late.containsCurrentTime,
  };
}

export function projectedMinute(minute: number, expansion: NightExpansion): number {
  const bounded = Math.max(0, Math.min(MINUTES_PER_DAY, minute));
  const earlyHeight = expansion.early ? EARLY_NIGHT_END : COMPRESSED_NIGHT_MINUTES;
  const lateScale = expansion.late ? 1 : COMPRESSED_NIGHT_MINUTES / (MINUTES_PER_DAY - LATE_NIGHT_START);
  if (bounded <= EARLY_NIGHT_END) {
    return bounded * (expansion.early ? 1 : COMPRESSED_NIGHT_MINUTES / EARLY_NIGHT_END);
  }
  if (bounded <= LATE_NIGHT_START) return earlyHeight + bounded - EARLY_NIGHT_END;
  return earlyHeight + (LATE_NIGHT_START - EARLY_NIGHT_END) + (bounded - LATE_NIGHT_START) * lateScale;
}

export function projectedTotalMinutes(expansion: NightExpansion): number {
  return projectedMinute(MINUTES_PER_DAY, expansion);
}

export function projectSegment(segment: TimedSegment, expansion: NightExpansion): ProjectedTimeGeometry {
  const total = projectedTotalMinutes(expansion);
  let start = projectedMinute(segment.semanticStartMinute, expansion);
  let end = projectedMinute(segment.semanticEndMinute, expansion);
  if (end - start < MIN_EVENT_VISUAL_MINUTES) {
    end = Math.min(total, start + MIN_EVENT_VISUAL_MINUTES);
    if (end - start < MIN_EVENT_VISUAL_MINUTES) start = Math.max(0, end - MIN_EVENT_VISUAL_MINUTES);
  }
  return { start, end, total };
}

export function initialScrollMinute(model: TimeGridModel): number {
  let earliest: number | null = null;
  model.timedByDate.forEach(segments => {
    segments.forEach(segment => {
      earliest = earliest === null
        ? segment.semanticStartMinute
        : Math.min(earliest, segment.semanticStartMinute);
    });
  });
  return earliest === null ? 8 * 60 : Math.max(0, earliest - 60);
}


// ── Display-time slots (DST / projection) ─────────────────────────────────────

export type DisplaySlotState = 'exact' | 'nonexistent' | 'ambiguous_earlier';

export interface DisplayTimeSlot {
  date: string;
  minute: number;
  state: DisplaySlotState;
  /** Nonexistent spring-forward slots are not selectable for create. */
  selectable: boolean;
}

interface ZoneParts {
  date: string;
  minute: number;
}

function zoneParts(utcMs: number, timeZone: string): ZoneParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));
    const map = Object.fromEntries(
      parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
    );
    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    return {
      date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      minute: hour * 60 + minute,
    };
  } catch {
    return null;
  }
}

function zoneOffsetMs(utcMs: number, timeZone: string): number | null {
  const parts = zoneParts(utcMs, timeZone);
  if (!parts) return null;
  const [y, m, d] = parts.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(parts.minute / 60), parts.minute % 60, 0);
  return asUtc - utcMs;
}

/**
 * Classify a display-timezone wall slot.
 * Fall-back overlaps are earlier-only (selectable once); spring gaps are not.
 */
export function classifyDisplaySlot(
  date: string,
  minute: number,
  timeZone: string,
): DisplaySlotState {
  const [y, m, d] = date.split('-').map(Number);
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  if (!Number.isFinite(y) || hour > 23 || min > 59) return 'nonexistent';

  const localAsUtc = Date.UTC(y, m - 1, d, hour, min, 0);
  let offset = zoneOffsetMs(localAsUtc, timeZone);
  if (offset === null) return 'exact';
  let utc = localAsUtc - offset;
  offset = zoneOffsetMs(utc, timeZone);
  if (offset === null) return 'exact';
  utc = localAsUtc - offset;

  const roundTrip = zoneParts(utc, timeZone);
  if (!roundTrip || roundTrip.date !== date || roundTrip.minute !== minute) {
    return 'nonexistent';
  }

  for (const candidate of [utc - 3_600_000, utc + 3_600_000]) {
    const alt = zoneParts(candidate, timeZone);
    if (alt && alt.date === date && alt.minute === minute && candidate !== utc) {
      return 'ambiguous_earlier';
    }
  }
  return 'exact';
}

export function buildDisplayDaySlots(
  date: string,
  timeZone: string,
  stepMinutes = 15,
): DisplayTimeSlot[] {
  const slots: DisplayTimeSlot[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += stepMinutes) {
    const state = classifyDisplaySlot(date, minute, timeZone);
    slots.push({
      date,
      minute,
      state,
      selectable: state !== 'nonexistent',
    });
  }
  return slots;
}

function synthesizeEvent(entry: CalendarRangeEntryDto): EventDto {
  return {
    id: entry.event_id,
    title: entry.title,
    description: null,
    location: null,
    start: entry.is_all_day ? entry.start_date : entry.start_display,
    end: entry.is_all_day
      ? (() => {
          const ordinal = dateOrdinal(entry.end_date);
          if (ordinal === null) return entry.end_date;
          const next = new Date((ordinal + 1) * 86_400_000);
          return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
        })()
      : entry.end_display,
    is_all_day: entry.is_all_day,
    start_tzid: entry.start_tzid,
    end_tzid: entry.end_tzid,
    floating: entry.floating,
    status: 'confirmed',
    source: 'jin',
    authority: 'jin',
    ical_uid: `${entry.event_id}@jin`,
    derived_from: null,
    recurrence: [],
    recurring_event_id: null,
    original_start: null,
    master_id: null,
    recurrence_unexpanded: false,
    sequence: 0,
    created: '',
    updated: '',
    backlinks: [],
  };
}

function eventForEntry(
  entry: CalendarRangeEntryDto,
  eventsById: ReadonlyMap<string, EventDto>,
): EventDto {
  return eventsById.get(entry.event_id) ?? synthesizeEvent(entry);
}

/**
 * Build Day/Week geometry from core's display-timezone projection entries.
 * Timed placement uses start_display/end_display — not raw list_events walls.
 */
export function buildTimeGridFromProjection(
  entries: readonly CalendarRangeEntryDto[],
  eventsById: ReadonlyMap<string, EventDto>,
  requestedDates: string[],
): TimeGridModel {
  const dates: string[] = [];
  const ordinals: number[] = [];
  for (const date of requestedDates) {
    const ordinal = dateOrdinal(date);
    if (ordinal === null || dates.includes(date)) continue;
    dates.push(date);
    ordinals.push(ordinal);
  }
  const timedByDate = new Map<string, TimedSegment[]>(dates.map(date => [date, []]));
  const allDayEvents: EventDto[] = [];

  for (const entry of entries) {
    const event = eventForEntry(entry, eventsById);
    if (entry.is_all_day || entry.slot_state === 'all_day') {
      // Projection end_date is inclusive; all-day spans expect exclusive end.
      const exclusiveEndOrdinal = dateOrdinal(entry.end_date);
      const exclusiveEnd = exclusiveEndOrdinal === null
        ? entry.end_date
        : (() => {
            const next = new Date((exclusiveEndOrdinal + 1) * 86_400_000);
            return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
          })();
      allDayEvents.push({
        ...event,
        is_all_day: true,
        start: entry.start_date,
        end: exclusiveEnd,
      });
      continue;
    }

    const start = parseStoredWallTime(entry.start_display);
    const end = parseStoredWallTime(entry.end_display);
    if (!start || !end || absoluteMinute(end) <= absoluteMinute(start)) continue;
    const absoluteStart = absoluteMinute(start);
    const absoluteEnd = absoluteMinute(end);

    dates.forEach((date, index) => {
      const dayStart = ordinals[index] * MINUTES_PER_DAY;
      const dayEnd = dayStart + MINUTES_PER_DAY;
      const clippedStart = Math.max(absoluteStart, dayStart);
      const clippedEnd = Math.min(absoluteEnd, dayEnd);
      if (clippedEnd <= clippedStart) return;
      const semanticStartMinute = clippedStart - dayStart;
      const semanticEndMinute = clippedEnd - dayStart;
      timedByDate.get(date)?.push({
        event,
        date,
        semanticStartMinute,
        semanticEndMinute,
        visualStartMinute: semanticStartMinute,
        visualEndMinute: Math.max(semanticEndMinute, semanticStartMinute + MIN_EVENT_VISUAL_MINUTES),
        continuesBefore: absoluteStart < dayStart,
        continuesAfter: absoluteEnd > dayEnd,
        overlapColumn: 0,
        overlapColumnCount: 1,
      });
    });
  }

  timedByDate.forEach(assignTimedColumns);
  return { dates, timedByDate, allDaySpans: buildAllDaySpans(allDayEvents, dates, ordinals) };
}

/** Occupancy list for temporal cursor Enter / agenda bypass. */
export function occupancyFromModel(model: TimeGridModel): Map<string, Array<{ eventId: string; startMinute: number; endMinute: number }>> {
  const map = new Map<string, Array<{ eventId: string; startMinute: number; endMinute: number }>>();
  model.timedByDate.forEach((segments, date) => {
    map.set(
      date,
      segments.map(segment => ({
        eventId: segment.event.id,
        startMinute: segment.semanticStartMinute,
        endMinute: segment.semanticEndMinute,
      })),
    );
  });
  return map;
}
