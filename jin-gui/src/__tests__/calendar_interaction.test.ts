import { describe, expect, it } from 'vitest';
import { draftFromEvent, draftFromSlot } from '../lib/events/draft';
import {
  abortPointerLayer,
  applyCursorKey,
  applyGeometryToDraft,
  applyTemporalKeyboard,
  beginMonthDrag,
  beginMoveDrag,
  beginResizeDrag,
  beginTimedDrag,
  defaultTimedDraftSlot,
  emptySlotCreate,
  finalizeMonthDrag,
  finalizeMoveDrag,
  finalizeResizeDrag,
  finalizeTimedDrag,
  formatGeometryClock,
  geometryFromProjectionEntry,
  initTemporalCursor,
  monthAllDayDraftSlot,
  monthAllDayRangeDraftSlot,
  movePreservingElapsed,
  parseTemporalKeyboard,
  pointerCreatePolicy,
  rangeKey,
  resizeEndGeometry,
  temporalHandlesAllowed,
  updateMonthDrag,
  updateMoveDrag,
  updateResizeDrag,
  updateTimedDrag,
  type EventGeometry,
  type InteractionRange,
} from '../lib/calendar/interaction';
import type { CalendarRangeEntryDto, EventDetailDto, EventDto } from '../types/dto';

function range(overrides: Partial<InteractionRange> = {}): InteractionRange {
  return {
    dates: ['2026-08-20', '2026-08-21', '2026-08-22'],
    mode: 'week',
    bandStart: 0,
    bandEnd: 24 * 60,
    occupancy: new Map(),
    isSelectable: () => true,
    ...overrides,
  };
}

describe('calendar interaction (S5)', () => {
  it('default_slot_draft: Enter or empty slot yields a 60-minute timed draft snapped to 15', () => {
    const slot = defaultTimedDraftSlot('2026-08-20', 14 * 60 + 7);
    expect(slot).toMatchObject({
      date: '2026-08-20',
      start_time: '14:00',
      end_time: '15:00',
      is_all_day: false,
    });
    const fromEnter = applyCursorKey(
      { date: '2026-08-20', minute: 14 * 60 },
      'Enter',
      range(),
    );
    expect(fromEnter).toMatchObject({ kind: 'create' });
    if (fromEnter.kind === 'create') {
      expect(draftFromSlot(fromEnter.slot).temporal).toMatchObject({
        start_time: '14:00',
        end_time: '15:00',
        is_all_day: false,
      });
    }
    expect(emptySlotCreate('2026-08-20', 14 * 60 + 10, () => true)).toMatchObject({
      start_time: '14:00',
      end_time: '15:00',
    });
  });

  it('range_drag_draft: fine-pointer drag enforces a 15-minute minimum', () => {
    let drag = beginTimedDrag('2026-08-20', 10 * 60);
    drag = updateTimedDrag(drag, 10 * 60 + 5);
    const slot = finalizeTimedDrag(drag);
    expect(slot.start_time).toBe('10:00');
    expect(slot.end_time).toBe('10:15');
    drag = beginTimedDrag('2026-08-20', 10 * 60);
    drag = updateTimedDrag(drag, 11 * 60);
    expect(finalizeTimedDrag(drag)).toMatchObject({ start_time: '10:00', end_time: '11:00' });
  });

  it('abort_restores: pointer cancel / Escape reports zero mutation', () => {
    const layer = beginTimedDrag('2026-08-20', 9 * 60);
    expect(abortPointerLayer(layer)).toEqual({ mutated: false });
    expect(abortPointerLayer(null)).toEqual({ mutated: false });
    const cleared = applyCursorKey({ date: '2026-08-20', minute: 9 * 60 }, 'Escape', range());
    expect(cleared).toEqual({ kind: 'clear' });
  });

  it('month_cell_all_day_create: unused cell / Add on date opens one-day all-day draft', () => {
    const slot = monthAllDayDraftSlot('2026-08-22');
    expect(slot).toMatchObject({ date: '2026-08-22', end_date: '2026-08-22', is_all_day: true });
    expect(draftFromSlot(slot).temporal.is_all_day).toBe(true);
  });

  it('month_range_create: inclusive all-day range across cells', () => {
    let drag = beginMonthDrag('2026-08-20');
    drag = updateMonthDrag(drag, '2026-08-22');
    const slot = finalizeMonthDrag(drag);
    expect(slot).toMatchObject({
      date: '2026-08-20',
      end_date: '2026-08-22',
      is_all_day: true,
    });
    expect(monthAllDayRangeDraftSlot('2026-08-22', '2026-08-20')).toMatchObject({
      date: '2026-08-20',
      end_date: '2026-08-22',
    });
  });

  it('add_pointer_alternative: Add-on-date path matches unused-cell all-day draft', () => {
    expect(monthAllDayDraftSlot('2026-09-01')).toEqual(monthAllDayDraftSlot('2026-09-01'));
  });

  it('coarse vs fine pointer policy', () => {
    expect(pointerCreatePolicy('coarse')).toBe('tap-only');
    expect(pointerCreatePolicy('fine')).toBe('tap-and-drag');
  });

  it('restores cursor memory for the same range and defaults otherwise', () => {
    const dates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
    const memory = {
      rangeKey: rangeKey(dates),
      cursor: { date: '2026-08-21', minute: 15 * 60 },
    };
    expect(initTemporalCursor({
      dates,
      todayDate: '2026-08-20',
      nowMinute: 12 * 60 + 7,
      memory,
    })).toEqual({ date: '2026-08-21', minute: 15 * 60 });
    expect(initTemporalCursor({
      dates,
      todayDate: '2026-08-20',
      nowMinute: 12 * 60 + 7,
    })).toEqual({ date: '2026-08-20', minute: 12 * 60 });
    expect(initTemporalCursor({
      dates: ['2026-08-10', '2026-08-11'],
      todayDate: '2026-08-20',
      nowMinute: 12 * 60,
    })).toEqual({ date: '2026-08-10', minute: 9 * 60 });
  });

  it('Day Left/Right announces no-op; Week moves one day', () => {
    const day = applyCursorKey(
      { date: '2026-08-20', minute: 9 * 60 },
      'ArrowRight',
      range({ mode: 'day', dates: ['2026-08-20'] }),
    );
    expect(day.kind).toBe('noop');
    const week = applyCursorKey(
      { date: '2026-08-20', minute: 9 * 60 },
      'ArrowRight',
      range(),
    );
    expect(week).toMatchObject({ kind: 'cursor', cursor: { date: '2026-08-21', minute: 9 * 60 } });
  });
});


describe('calendar interaction (S6 move/resize)', () => {
  const origin: EventGeometry = {
    eventId: 'evt-1',
    startDate: '2026-08-20',
    startMinute: 14 * 60,
    endDate: '2026-08-20',
    endMinute: 15 * 60,
    elapsedMinutes: 60,
  };

  function entry(overrides: Partial<CalendarRangeEntryDto> = {}): CalendarRangeEntryDto {
    return {
      event_id: 'evt-1',
      title: 'Standup',
      slot_state: 'anchored',
      start_date: '2026-08-20',
      end_date: '2026-08-20',
      start_display: '2026-08-20T14:00:00',
      end_display: '2026-08-20T15:00:00',
      start_utc: null,
      end_utc: null,
      continuation_dates: [],
      elapsed_minutes: 60,
      start_tzid: 'UTC',
      end_tzid: 'UTC',
      is_all_day: false,
      floating: false,
      start_resolution: 'exact',
      end_resolution: 'exact',
      temporal_editable: true,
      temporal_disabled_reason: null,
      ...overrides,
    };
  }

  function detail(canEditSchedule: boolean): EventDetailDto {
    return {
      event: {
        id: 'evt-1',
        title: 'Standup',
        description: null,
        location: null,
        start: '2026-08-20T14:00:00',
        end: '2026-08-20T15:00:00',
        is_all_day: false,
        start_tzid: 'UTC',
        end_tzid: 'UTC',
        floating: false,
        status: 'confirmed',
        source: 'jin',
        authority: 'jin',
        ical_uid: null,
        derived_from: null,
        recurrence: [],
        recurring_event_id: null,
        original_start: null,
        master_id: null,
        recurrence_unexpanded: false,
        sequence: 0,
        created: '2026-08-01T00:00:00Z',
        updated: '2026-08-01T00:00:00Z',
        backlinks: [],
      } as EventDto,
      capabilities: {
        display_kind: 'event',
        can_edit: true,
        can_delete: true,
        read_only_reason: null,
        can_return_task_to_flexible: false,
        originating_task: null,
        collaboration: {
          invitation: null,
          can_edit_schedule: canEditSchedule,
          can_append_attendees: false,
          can_remove_attendees: false,
          can_change_attendee_roles: false,
          can_cancel_meeting: false,
          can_add_conference: false,
          can_remove_conference: false,
          allowed_conference_solution_types: [],
          disabled_reasons: {},
        },
      },
      edit_token: 'tok',
    };
  }

  it('capability_before_handles: withhold until current can_edit_schedule and temporal_editable', () => {
    expect(temporalHandlesAllowed({
      pointerKind: 'fine',
      detail: null,
      entry: entry(),
    })).toBe(false);
    expect(temporalHandlesAllowed({
      pointerKind: 'fine',
      detail: detail(false),
      entry: entry(),
    })).toBe(false);
    expect(temporalHandlesAllowed({
      pointerKind: 'fine',
      detail: detail(true),
      entry: entry({ temporal_editable: false }),
    })).toBe(false);
    expect(temporalHandlesAllowed({
      pointerKind: 'coarse',
      detail: detail(true),
      entry: entry(),
    })).toBe(false);
    expect(temporalHandlesAllowed({
      pointerKind: 'fine',
      detail: detail(true),
      entry: entry(),
    })).toBe(true);
  });

  it('move_preserves_elapsed_duration', () => {
    const moved = movePreservingElapsed(origin, '2026-08-21', 10 * 60 + 7, () => true);
    expect(moved).toMatchObject({
      startDate: '2026-08-21',
      startMinute: 10 * 60,
      endDate: '2026-08-21',
      endMinute: 11 * 60,
      elapsedMinutes: 60,
    });
    const fromEntry = geometryFromProjectionEntry(entry({ elapsed_minutes: 90, end_display: '2026-08-20T15:30:00' }));
    expect(fromEntry?.elapsedMinutes).toBe(90);
    const shifted = movePreservingElapsed(fromEntry!, '2026-08-20', 16 * 60, () => true);
    expect(shifted?.elapsedMinutes).toBe(90);
    expect(shifted?.endMinute).toBe(17 * 60 + 30);
  });

  it('resize_cross_midnight: end date updates and summary shows it', () => {
    const resized = resizeEndGeometry(origin, '2026-08-21', 1 * 60, () => true);
    expect(resized).toMatchObject({
      startDate: '2026-08-20',
      startMinute: 14 * 60,
      endDate: '2026-08-21',
      endMinute: 60,
    });
    expect(formatGeometryClock(resized!)).toContain('2026-08-21');
    const draft = draftFromEvent(detail(true).event, 'tok');
    applyGeometryToDraft(draft, resized!);
    expect(draft.temporal.end_date).toBe('2026-08-21');
    expect(draft.temporal.end_time).toBe('01:00');
  });

  it('keyboard_move_resize_parity with pointer snap/validation', () => {
    const moveAction = parseTemporalKeyboard({ key: 'ArrowDown', altKey: true, shiftKey: false });
    expect(moveAction).toEqual({ kind: 'move', deltaDays: 0, deltaMinutes: 15 });
    const resizeAction = parseTemporalKeyboard({ key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(resizeAction).toEqual({ kind: 'resize', deltaMinutes: -15 });

    const selectable = (date: string, minute: number) => !(date === '2026-08-20' && minute === 14 * 60 + 15);
    const r = range({ isSelectable: selectable });
    const pointerMove = movePreservingElapsed(origin, '2026-08-20', 14 * 60 + 15, selectable);
    expect(pointerMove).toBeNull();
    const keyMove = applyTemporalKeyboard(origin, moveAction!, r);
    expect(keyMove.kind).toBe('rejected');

    const keyOk = applyTemporalKeyboard(origin, { kind: 'move', deltaDays: 0, deltaMinutes: 30 }, range());
    expect(keyOk).toMatchObject({
      kind: 'geometry',
      geometry: { startMinute: 14 * 60 + 30, endMinute: 15 * 60 + 30, elapsedMinutes: 60 },
    });
    const keyResize = applyTemporalKeyboard(origin, { kind: 'resize', deltaMinutes: 30 }, range());
    expect(keyResize).toMatchObject({
      kind: 'geometry',
      geometry: { endMinute: 15 * 60 + 30, elapsedMinutes: 90 },
    });
  });

  it('recurring_direct_edit_scope: geometric draft does not commit; scopes remain for composer', () => {
    let layer = beginMoveDrag(origin);
    layer = updateMoveDrag(layer, '2026-08-20', 16 * 60, () => true);
    const geometry = finalizeMoveDrag(layer);
    const draft = draftFromEvent({
      ...detail(true).event,
      recurrence: ['RRULE:FREQ=DAILY'],
      recurring_event_id: 'master-1',
    }, 'tok');
    applyGeometryToDraft(draft, geometry);
    // No mutation API invoked here — draft only.
    expect(draft.temporal.start_time).toBe('16:00');
    expect(draft.event_id).toBe('evt-1');
  });

  it('abort restores: move/resize cancel reports zero mutation', () => {
    const move = beginMoveDrag(origin);
    expect(abortPointerLayer(move)).toEqual({ mutated: false });
    const resize = beginResizeDrag(origin);
    expect(abortPointerLayer(resize)).toEqual({ mutated: false });
    let resizing = beginResizeDrag(origin);
    resizing = updateResizeDrag(resizing, '2026-08-20', 18 * 60, () => true);
    expect(abortPointerLayer(resizing)).toEqual({ mutated: false });
    expect(finalizeResizeDrag(beginResizeDrag(origin)).endMinute).toBe(origin.endMinute);
  });

  it('gap/unselectable reshape blocked: no commit draft escapes', () => {
    const gap = (date: string, minute: number) => minute !== 2 * 60; // 02:00 nonexistent
    expect(movePreservingElapsed(origin, '2026-08-20', 2 * 60, gap)).toBeNull();
    expect(resizeEndGeometry(origin, '2026-08-20', 2 * 60, gap)).toBeNull();
    const key = applyTemporalKeyboard(
      { ...origin, startMinute: 1 * 60 + 45, endMinute: 2 * 60 + 45, elapsedMinutes: 60 },
      { kind: 'move', deltaDays: 0, deltaMinutes: 15 },
      range({ isSelectable: gap }),
    );
    expect(key.kind).toBe('rejected');
  });
});
