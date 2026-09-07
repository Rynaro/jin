import type { EventDto } from '../../types/dto';

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
