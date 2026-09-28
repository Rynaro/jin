/**
 * Pure Calendar interaction model (S5 + S6).
 *
 * Cursor movement, empty-slot create drafts, fine-pointer range selection,
 * Month all-day create, and capability-gated move/resize geometry — no DOM,
 * no network, no timers.
 */

import type { EventDraft } from '../events/draft';
import type { DraftSlot } from '../events/draft';
import type { CalendarRangeEntryDto, EventDetailDto } from '../../types/dto';

export const CURSOR_STEP_MINUTES = 15;
export const DEFAULT_TIMED_DURATION_MINUTES = 60;
export const MIN_TIMED_DURATION_MINUTES = 15;
export const DEFAULT_CURSOR_MINUTE = 9 * 60;

export type PointerKind = 'fine' | 'coarse';

export interface TemporalCursor {
  date: string;
  minute: number;
}

export interface CursorMemory {
  rangeKey: string;
  cursor: TemporalCursor;
}

export interface OccupancyEntry {
  eventId: string;
  startMinute: number;
  endMinute: number;
}

export interface InteractionRange {
  dates: readonly string[];
  mode: 'day' | 'week';
  /** Inclusive start of the configured visible day band (minutes). */
  bandStart: number;
  /** Exclusive end of the configured visible day band (minutes). */
  bandEnd: number;
  /** Events overlapping each date's minute range. */
  occupancy: ReadonlyMap<string, readonly OccupancyEntry[]>;
  /** Whether a display-time slot may start a create/move/resize draft. */
  isSelectable: (date: string, minute: number) => boolean;
}

/** Display-timezone wall geometry for a timed event (S6). */
export interface EventGeometry {
  eventId: string;
  startDate: string;
  startMinute: number;
  endDate: string;
  endMinute: number;
  elapsedMinutes: number;
}

export interface MoveDragState {
  kind: 'move';
  eventId: string;
  origin: EventGeometry;
  current: EventGeometry;
}

export interface ResizeDragState {
  kind: 'resize-end';
  eventId: string;
  origin: EventGeometry;
  current: EventGeometry;
}

export type CursorMoveKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'Enter'
  | 'Escape';

export type CursorMoveResult =
  | { kind: 'cursor'; cursor: TemporalCursor; announcement: string }
  | { kind: 'clear' }
  | { kind: 'noop'; announcement: string }
  | { kind: 'create'; slot: DraftSlot }
  | { kind: 'open'; eventId: string };

export type PointerCreatePolicy = 'tap-only' | 'tap-and-drag';

export interface TimedDragState {
  kind: 'timed-range';
  date: string;
  originMinute: number;
  currentMinute: number;
}

export interface MonthDragState {
  kind: 'month-range';
  originDate: string;
  currentDate: string;
}

export type PointerLayer = TimedDragState | MonthDragState | MoveDragState | ResizeDragState;

export type TemporalKeyboardAction =
  | { kind: 'move'; deltaDays: number; deltaMinutes: number }
  | { kind: 'resize'; deltaMinutes: number };

export type TemporalKeyboardResult =
  | { kind: 'geometry'; geometry: EventGeometry }
  | { kind: 'rejected'; reason: string }
  | { kind: 'noop'; announcement: string };

export function rangeKey(dates: readonly string[]): string {
  if (dates.length === 0) return '';
  return `${dates[0]}:${dates[dates.length - 1]}:${dates.length}`;
}

export function snapMinuteFloor(minute: number, step = CURSOR_STEP_MINUTES): number {
  const bounded = Math.max(0, Math.min(24 * 60 - step, minute));
  return Math.floor(bounded / step) * step;
}

export function formatMinuteClock(minute: number): string {
  const bounded = Math.max(0, Math.min(24 * 60, minute));
  const h = Math.floor(bounded / 60);
  const m = bounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function wallElapsedMinutes(
  startDate: string,
  startMinute: number,
  endDate: string,
  endMinute: number,
): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startDays = Math.floor(Date.UTC(sy, sm - 1, sd) / 86_400_000);
  const endDays = Math.floor(Date.UTC(ey, em - 1, ed) / 86_400_000);
  return (endDays - startDays) * 24 * 60 + (endMinute - startMinute);
}

export function addMinutesToWall(
  date: string,
  minute: number,
  addMinutes: number,
): { date: string; minute: number } {
  let total = minute + addMinutes;
  let d = date;
  while (total >= 24 * 60) {
    total -= 24 * 60;
    d = addDaysIso(d, 1);
  }
  while (total < 0) {
    total += 24 * 60;
    d = addDaysIso(d, -1);
  }
  return { date: d, minute: total };
}

function parseDisplayWall(value: string): { date: string; minute: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/.exec(value);
  if (!match) return null;
  if (!match[2]) return { date: match[1], minute: 0 };
  return { date: match[1], minute: Number(match[2]) * 60 + Number(match[3]) };
}

/** Build geometry from a projection entry. Returns null for all-day rows. */
export function geometryFromProjectionEntry(entry: CalendarRangeEntryDto): EventGeometry | null {
  if (entry.is_all_day) return null;
  const start = parseDisplayWall(entry.start_display);
  const end = parseDisplayWall(entry.end_display);
  if (!start || !end) return null;
  const elapsed = entry.elapsed_minutes > 0
    ? entry.elapsed_minutes
    : wallElapsedMinutes(start.date, start.minute, end.date, end.minute);
  if (elapsed < MIN_TIMED_DURATION_MINUTES) return null;
  return {
    eventId: entry.event_id,
    startDate: start.date,
    startMinute: start.minute,
    endDate: end.date,
    endMinute: end.minute,
    elapsedMinutes: elapsed,
  };
}

/**
 * Fine-pointer temporal handles require current capabilities AND a temporally
 * editable projection entry. Coarse pointer never shows drag handles.
 */
export function temporalHandlesAllowed(options: {
  pointerKind: PointerKind;
  detail: EventDetailDto | null | undefined;
  entry: CalendarRangeEntryDto | null | undefined;
}): boolean {
  if (options.pointerKind !== 'fine') return false;
  if (!options.detail || !options.entry) return false;
  if (options.entry.is_all_day) return false;
  if (options.entry.temporal_editable === false) return false;
  return options.detail.capabilities.collaboration?.can_edit_schedule === true;
}

/**
 * Initialize the temporal cursor for a visible range.
 * Restores memory when the same range is re-entered; otherwise today→now
 * floored to 15 minutes, else 09:00 on the first visible date.
 */
export function initTemporalCursor(options: {
  dates: readonly string[];
  todayDate: string;
  nowMinute: number;
  memory?: CursorMemory | null;
}): TemporalCursor {
  const { dates, todayDate, nowMinute, memory } = options;
  if (dates.length === 0) {
    return { date: todayDate, minute: DEFAULT_CURSOR_MINUTE };
  }
  const key = rangeKey(dates);
  if (memory && memory.rangeKey === key) {
    const stillVisible = dates.includes(memory.cursor.date);
    if (stillVisible) return { ...memory.cursor };
  }
  if (dates.includes(todayDate)) {
    return { date: todayDate, minute: snapMinuteFloor(nowMinute) };
  }
  return { date: dates[0], minute: DEFAULT_CURSOR_MINUTE };
}

export function pointerCreatePolicy(kind: PointerKind): PointerCreatePolicy {
  return kind === 'coarse' ? 'tap-only' : 'tap-and-drag';
}

export function defaultTimedDraftSlot(
  date: string,
  startMinute: number,
  timezone?: string,
): DraftSlot {
  const start = snapMinuteFloor(startMinute);
  const end = start + DEFAULT_TIMED_DURATION_MINUTES;
  const crossesMidnight = end >= 24 * 60;
  return {
    date,
    end_date: crossesMidnight ? addDaysIso(date, 1) : date,
    start_time: formatMinuteClock(start),
    end_time: formatMinuteClock(crossesMidnight ? end - 24 * 60 : end),
    is_all_day: false,
    timezone,
  };
}

export function timedRangeDraftSlot(
  date: string,
  originMinute: number,
  currentMinute: number,
  timezone?: string,
): DraftSlot {
  const a = snapMinuteFloor(originMinute);
  const b = snapMinuteFloor(currentMinute);
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  if (end - start < MIN_TIMED_DURATION_MINUTES) {
    end = start + MIN_TIMED_DURATION_MINUTES;
  }
  if (end > 24 * 60) {
    end = 24 * 60;
    start = Math.min(start, end - MIN_TIMED_DURATION_MINUTES);
  }
  const crossesMidnight = end >= 24 * 60;
  return {
    date,
    end_date: crossesMidnight ? addDaysIso(date, 1) : date,
    start_time: formatMinuteClock(start),
    end_time: formatMinuteClock(crossesMidnight ? 0 : end),
    is_all_day: false,
    timezone,
  };
}

export function monthAllDayDraftSlot(date: string, timezone?: string): DraftSlot {
  return {
    date,
    end_date: date,
    is_all_day: true,
    timezone,
  };
}

/** Inclusive UI date range → DraftSlot (canonical exclusive end applied by serializer). */
export function monthAllDayRangeDraftSlot(
  startDate: string,
  endDate: string,
  timezone?: string,
): DraftSlot {
  const ordered = compareIsoDates(startDate, endDate) <= 0
    ? [startDate, endDate]
    : [endDate, startDate];
  return {
    date: ordered[0],
    end_date: ordered[1],
    is_all_day: true,
    timezone,
  };
}

export function eventsAtCursor(
  range: InteractionRange,
  cursor: TemporalCursor,
): OccupancyEntry[] {
  const day = range.occupancy.get(cursor.date) ?? [];
  return day.filter(entry => entry.startMinute <= cursor.minute && cursor.minute < entry.endMinute);
}

function announceCursor(cursor: TemporalCursor, occupied: number): string {
  const occ = occupied === 0
    ? 'empty'
    : occupied === 1
      ? '1 event'
      : `${occupied} events`;
  return `${cursor.date} ${formatMinuteClock(cursor.minute)}, ${occ}`;
}

function shiftCursorDay(
  cursor: TemporalCursor,
  dates: readonly string[],
  delta: number,
): TemporalCursor | null {
  const index = dates.indexOf(cursor.date);
  if (index < 0) return null;
  const next = index + delta;
  if (next < 0 || next >= dates.length) return null;
  return { date: dates[next], minute: cursor.minute };
}

/**
 * Apply a keyboard command to the temporal cursor.
 * Enter on empty → 60-minute draft; Enter on occupied → first event at slot.
 */
export function applyCursorKey(
  cursor: TemporalCursor | null,
  key: CursorMoveKey,
  range: InteractionRange,
): CursorMoveResult {
  if (key === 'Escape') return { kind: 'clear' };

  if (!cursor) {
    return { kind: 'noop', announcement: 'No temporal cursor' };
  }

  if (key === 'Enter') {
    const occupied = eventsAtCursor(range, cursor);
    if (occupied.length > 0) {
      return { kind: 'open', eventId: occupied[0].eventId };
    }
    if (!range.isSelectable(cursor.date, cursor.minute)) {
      return { kind: 'noop', announcement: 'Time unavailable' };
    }
    return { kind: 'create', slot: defaultTimedDraftSlot(cursor.date, cursor.minute) };
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const delta = key === 'ArrowUp' ? -CURSOR_STEP_MINUTES : CURSOR_STEP_MINUTES;
    let nextMinute = cursor.minute + delta;
    if (nextMinute < range.bandStart) nextMinute = range.bandStart;
    if (nextMinute >= range.bandEnd) nextMinute = range.bandEnd - CURSOR_STEP_MINUTES;
    nextMinute = snapMinuteFloor(nextMinute);
    const next = { date: cursor.date, minute: nextMinute };
    const occupied = eventsAtCursor(range, next).length;
    return { kind: 'cursor', cursor: next, announcement: announceCursor(next, occupied) };
  }

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (range.mode === 'day') {
      return { kind: 'noop', announcement: 'Day view stays on one date' };
    }
    const shifted = shiftCursorDay(cursor, range.dates, key === 'ArrowLeft' ? -1 : 1);
    if (!shifted) {
      return { kind: 'noop', announcement: 'At edge of visible week' };
    }
    const occupied = eventsAtCursor(range, shifted).length;
    return { kind: 'cursor', cursor: shifted, announcement: announceCursor(shifted, occupied) };
  }

  if (key === 'Home' || key === 'End') {
    const minute = key === 'Home'
      ? snapMinuteFloor(range.bandStart)
      : snapMinuteFloor(range.bandEnd - CURSOR_STEP_MINUTES);
    const next = { date: cursor.date, minute };
    const occupied = eventsAtCursor(range, next).length;
    return { kind: 'cursor', cursor: next, announcement: announceCursor(next, occupied) };
  }

  return { kind: 'noop', announcement: '' };
}

/** Click/tap empty Day/Week time → default 60-minute draft. */
export function emptySlotCreate(
  date: string,
  minute: number,
  isSelectable: (date: string, minute: number) => boolean,
  timezone?: string,
): DraftSlot | null {
  const snapped = snapMinuteFloor(minute);
  if (!isSelectable(date, snapped)) return null;
  return defaultTimedDraftSlot(date, snapped, timezone);
}

export function beginTimedDrag(date: string, minute: number): TimedDragState {
  const snapped = snapMinuteFloor(minute);
  return { kind: 'timed-range', date, originMinute: snapped, currentMinute: snapped };
}

export function updateTimedDrag(state: TimedDragState, minute: number): TimedDragState {
  return { ...state, currentMinute: snapMinuteFloor(minute) };
}

/**
 * Finalize a fine-pointer timed drag. Returns a min-15-minute draft.
 */
export function finalizeTimedDrag(
  state: TimedDragState,
  timezone?: string,
): DraftSlot {
  return timedRangeDraftSlot(state.date, state.originMinute, state.currentMinute, timezone);
}

export function beginMonthDrag(date: string): MonthDragState {
  return { kind: 'month-range', originDate: date, currentDate: date };
}

export function updateMonthDrag(state: MonthDragState, date: string): MonthDragState {
  return { ...state, currentDate: date };
}

export function finalizeMonthDrag(state: MonthDragState, timezone?: string): DraftSlot {
  return monthAllDayRangeDraftSlot(state.originDate, state.currentDate, timezone);
}

/**
 * Abort an in-progress pointer layer. Create drafts have no persisted geometry;
 * move/resize aborts restore original persisted geometry with zero mutation.
 */
export function abortPointerLayer(_layer: PointerLayer | null): { mutated: false } {
  return { mutated: false };
}

// ── S6 move / resize ──────────────────────────────────────────────────────────

/**
 * Move: choose a target start; preserve elapsed duration; snap 15; reject
 * nonexistent / later-ambiguous slots via isSelectable.
 */
export function movePreservingElapsed(
  origin: EventGeometry,
  targetStartDate: string,
  targetStartMinute: number,
  isSelectable: (date: string, minute: number) => boolean,
): EventGeometry | null {
  const startMinute = snapMinuteFloor(targetStartMinute);
  if (!isSelectable(targetStartDate, startMinute)) return null;
  const end = addMinutesToWall(targetStartDate, startMinute, origin.elapsedMinutes);
  return {
    eventId: origin.eventId,
    startDate: targetStartDate,
    startMinute,
    endDate: end.date,
    endMinute: end.minute,
    elapsedMinutes: origin.elapsedMinutes,
  };
}

/**
 * Resize: change end only; enforce minimum 15 minutes; crossing midnight
 * updates end date. Rejects unselectable end slots when a checker is provided.
 */
export function resizeEndGeometry(
  origin: EventGeometry,
  targetEndDate: string,
  targetEndMinute: number,
  isSelectable?: (date: string, minute: number) => boolean,
): EventGeometry | null {
  let endDate = targetEndDate;
  let endMinute = targetEndMinute;
  // Snap within the day; midnight (24:00) becomes 00:00 next day.
  if (endMinute >= 24 * 60) {
    const overflow = Math.floor(endMinute / (24 * 60));
    endMinute = endMinute % (24 * 60);
    endDate = addDaysIso(endDate, overflow);
  }
  if (endMinute < 0) {
    const under = Math.ceil((-endMinute) / (24 * 60));
    endMinute = endMinute + under * 24 * 60;
    endDate = addDaysIso(endDate, -under);
  }
  endMinute = snapMinuteFloor(endMinute === 0 && compareIsoDates(endDate, origin.startDate) > 0
    ? 0
    : endMinute === 0 && compareIsoDates(endDate, origin.startDate) === 0
      ? MIN_TIMED_DURATION_MINUTES
      : endMinute);
  // Special-case: allow exact midnight on a later day (minute 0).
  if (
    endMinute === 0
    && compareIsoDates(endDate, origin.startDate) > 0
  ) {
    // keep midnight
  } else if (endMinute === 0 && compareIsoDates(endDate, origin.startDate) === 0) {
    endMinute = MIN_TIMED_DURATION_MINUTES;
  } else {
    endMinute = snapMinuteFloor(endMinute);
  }

  if (isSelectable && !isSelectable(endDate, endMinute === 0 ? 0 : endMinute)) {
    // Midnight end (00:00) is the boundary of the previous day; treat as selectable
    // when the prior day's last slot is selectable OR when endMinute is 0 on next day.
    if (!(endMinute === 0 && compareIsoDates(endDate, origin.startDate) > 0)) {
      return null;
    }
  }

  const elapsed = wallElapsedMinutes(origin.startDate, origin.startMinute, endDate, endMinute);
  if (elapsed < MIN_TIMED_DURATION_MINUTES) return null;

  return {
    eventId: origin.eventId,
    startDate: origin.startDate,
    startMinute: origin.startMinute,
    endDate,
    endMinute,
    elapsedMinutes: elapsed,
  };
}

export function beginMoveDrag(origin: EventGeometry): MoveDragState {
  return { kind: 'move', eventId: origin.eventId, origin: { ...origin }, current: { ...origin } };
}

export function updateMoveDrag(
  state: MoveDragState,
  targetStartDate: string,
  targetStartMinute: number,
  isSelectable: (date: string, minute: number) => boolean,
): MoveDragState {
  const next = movePreservingElapsed(state.origin, targetStartDate, targetStartMinute, isSelectable);
  return { ...state, current: next ?? state.current };
}

export function finalizeMoveDrag(state: MoveDragState): EventGeometry {
  return { ...state.current };
}

export function beginResizeDrag(origin: EventGeometry): ResizeDragState {
  return {
    kind: 'resize-end',
    eventId: origin.eventId,
    origin: { ...origin },
    current: { ...origin },
  };
}

export function updateResizeDrag(
  state: ResizeDragState,
  targetEndDate: string,
  targetEndMinute: number,
  isSelectable?: (date: string, minute: number) => boolean,
): ResizeDragState {
  const next = resizeEndGeometry(state.origin, targetEndDate, targetEndMinute, isSelectable);
  return { ...state, current: next ?? state.current };
}

export function finalizeResizeDrag(state: ResizeDragState): EventGeometry {
  return { ...state.current };
}

/**
 * Keyboard parity with pointer snap/validation (AC-020).
 * Alt+Arrow moves; Alt+Shift+Up/Down resizes end.
 */
export function parseTemporalKeyboard(event: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
}): TemporalKeyboardAction | null {
  if (!event.altKey) return null;
  if (event.shiftKey) {
    if (event.key === 'ArrowUp') return { kind: 'resize', deltaMinutes: -CURSOR_STEP_MINUTES };
    if (event.key === 'ArrowDown') return { kind: 'resize', deltaMinutes: CURSOR_STEP_MINUTES };
    return null;
  }
  if (event.key === 'ArrowUp') return { kind: 'move', deltaDays: 0, deltaMinutes: -CURSOR_STEP_MINUTES };
  if (event.key === 'ArrowDown') return { kind: 'move', deltaDays: 0, deltaMinutes: CURSOR_STEP_MINUTES };
  if (event.key === 'ArrowLeft') return { kind: 'move', deltaDays: -1, deltaMinutes: 0 };
  if (event.key === 'ArrowRight') return { kind: 'move', deltaDays: 1, deltaMinutes: 0 };
  return null;
}

export function applyTemporalKeyboard(
  geometry: EventGeometry,
  action: TemporalKeyboardAction,
  range: InteractionRange,
): TemporalKeyboardResult {
  if (action.kind === 'move') {
    if (action.deltaDays !== 0 && range.mode === 'day') {
      return { kind: 'noop', announcement: 'Day view stays on one date' };
    }
    let targetDate = geometry.startDate;
    if (action.deltaDays !== 0) {
      const shifted = shiftCursorDay(
        { date: geometry.startDate, minute: geometry.startMinute },
        range.dates,
        action.deltaDays,
      );
      if (!shifted) return { kind: 'noop', announcement: 'At edge of visible week' };
      targetDate = shifted.date;
    }
    const targetMinute = geometry.startMinute + action.deltaMinutes;
    if (targetMinute < range.bandStart || targetMinute >= range.bandEnd) {
      return { kind: 'noop', announcement: 'At edge of day band' };
    }
    const next = movePreservingElapsed(geometry, targetDate, targetMinute, range.isSelectable);
    if (!next) return { kind: 'rejected', reason: 'Time unavailable' };
    return { kind: 'geometry', geometry: next };
  }

  const end = addMinutesToWall(geometry.endDate, geometry.endMinute, action.deltaMinutes);
  const next = resizeEndGeometry(geometry, end.date, end.minute, range.isSelectable);
  if (!next) return { kind: 'rejected', reason: 'Time unavailable' };
  return { kind: 'geometry', geometry: next };
}

/** Mutate a draft's temporal fields from display-timezone geometry. */
export function applyGeometryToDraft(draft: EventDraft, geometry: EventGeometry): void {
  draft.temporal.start_date = geometry.startDate;
  draft.temporal.end_date = geometry.endDate;
  draft.temporal.start_time = formatMinuteClock(geometry.startMinute);
  draft.temporal.end_time = formatMinuteClock(geometry.endMinute);
  draft.temporal.is_all_day = false;
}

export function geometryEquals(a: EventGeometry, b: EventGeometry): boolean {
  return (
    a.eventId === b.eventId
    && a.startDate === b.startDate
    && a.startMinute === b.startMinute
    && a.endDate === b.endDate
    && a.endMinute === b.endMinute
    && a.elapsedMinutes === b.elapsedMinutes
  );
}

export function formatGeometryClock(geometry: EventGeometry): string {
  const start = `${geometry.startDate} ${formatMinuteClock(geometry.startMinute)}`;
  const endSameDay = geometry.endDate === geometry.startDate;
  const end = endSameDay
    ? formatMinuteClock(geometry.endMinute)
    : `${geometry.endDate} ${formatMinuteClock(geometry.endMinute)}`;
  return `${start} → ${end}`;
}
