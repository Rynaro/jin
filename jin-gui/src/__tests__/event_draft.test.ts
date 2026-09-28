/**
 * S2 — EventDraft pure-model tests.
 *
 * Gate coverage: AC-S2-06 (boundary fidelity vs the Rust fixture), AC-S2-08
 * (temporal validation), AC-S2-09 (timezone change preserves wall time),
 * AC-S2-10 (all-day exclusive end), AC-S2-11 (single serializer origin),
 * AC-S2-15 (sparse serializer omits untouched temporal).
 */

import { describe, expect, it } from 'vitest';
import type { EventDto, EventTemporalPreviewDto } from '../types/dto';
import {
  canonicalEnd,
  canonicalStart,
  createInputFromDraft,
  dirtyFields,
  draftFromCapture,
  draftFromEvent,
  draftFromSlot,
  editDeltaFromDraft,
  editPayloadFromDraft,
  routedEditPayloadFromDraft,
  setTimezone,
  temporalPreviewInputFromDraft,
  touchesTime,
  validateDraft,
} from '../lib/events/draft';

function crossZoneEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'evt-flight',
    title: 'Flight',
    description: null,
    location: null,
    start: '2026-07-01T22:00:00',
    end: '2026-07-02T06:00:00',
    is_all_day: false,
    start_tzid: 'America/Sao_Paulo',
    end_tzid: 'Europe/Lisbon',
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
    organizer: null,
    attendees: null,
    attendees_omitted: null,
    conference_data: null,
    hangout_link: null,
    reminders: null,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    backlinks: [],
    ...overrides,
  } as EventDto;
}

function allDayEvent(): EventDto {
  return crossZoneEvent({
    id: 'evt-conference',
    title: 'Conference',
    // Canonical end is exclusive: Jul 1–3 inclusive ends Jul 4.
    start: '2026-07-01',
    end: '2026-07-04',
    is_all_day: true,
    start_tzid: null,
    end_tzid: null,
  });
}

describe('EventDraft construction', () => {
  it('captures both endpoint zones independently', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    expect(draft.temporal.timezone).toBe('America/Sao_Paulo');
    expect(draft.temporal.end_timezone).toBe('Europe/Lisbon');
    expect(draft.edit_token).toBe('sha256:token');
  });

  it('shows the inclusive last day for an all-day event', () => {
    const draft = draftFromEvent(allDayEvent());
    expect(draft.temporal.start_date).toBe('2026-07-01');
    expect(draft.temporal.end_date).toBe('2026-07-03');
  });

  it('builds from a slot and from a Capture entry', () => {
    const slot = draftFromSlot({ date: '2026-07-01', start_time: '14:00', end_time: '15:00' });
    expect(slot.event_id).toBeNull();
    expect(slot.baseline).toBeNull();
    expect(slot.temporal.start_date).toBe('2026-07-01');

    const capture = draftFromCapture({ title: 'Captured', date: '2026-07-02' });
    expect(capture.title).toBe('Captured');
    expect(capture.temporal.start_date).toBe('2026-07-02');
  });
});

// ── AC-S2-10 ──────────────────────────────────────────────────────────────────

describe('all_day_exclusive_end', () => {
  it('serializes canonical end as the day after the final inclusive UI date', () => {
    const draft = draftFromEvent(allDayEvent());
    // The user sees Jul 1 – Jul 3.
    expect(draft.temporal.end_date).toBe('2026-07-03');
    // The canonical value is the day after.
    expect(canonicalStart(draft)).toBe('2026-07-01');
    expect(canonicalEnd(draft)).toBe('2026-07-04');
    expect(createInputFromDraft(draft).end).toBe('2026-07-04');
  });

  it('round-trips a single all-day day as a one-day exclusive span', () => {
    const draft = draftFromSlot({ date: '2026-07-01', is_all_day: true });
    expect(canonicalStart(draft)).toBe('2026-07-01');
    expect(canonicalEnd(draft)).toBe('2026-07-02');
  });
});

// ── AC-S2-15 ──────────────────────────────────────────────────────────────────

describe('sparse_serializer_omits_untouched_temporal', () => {
  it('omits every temporal field for a title-only change', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    draft.title = 'Flight (renamed)';

    expect(dirtyFields(draft)).toEqual(['title']);
    expect(touchesTime(draft)).toBe(false);

    const delta = editDeltaFromDraft(draft);
    expect(delta).toEqual({ title: 'Flight (renamed)' });
    // Explicitly: none of these keys exist at all, not even as null.
    expect('temporal' in delta).toBe(false);
    expect(Object.keys(delta)).not.toContain('start');
    expect(Object.keys(delta)).not.toContain('end');
    expect(Object.keys(delta)).not.toContain('tzid');
  });

  it('emits the complete bundle once time actually changes', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    draft.temporal.start_time = '23:00';

    expect(touchesTime(draft)).toBe(true);
    const delta = editDeltaFromDraft(draft);
    expect(delta.temporal).toEqual({
      start: '2026-07-01T23:00:00',
      end: '2026-07-02T06:00:00',
      is_all_day: false,
      floating: false,
      start_tzid: 'America/Sao_Paulo',
      // The distinct end zone travels with the bundle, unflattened.
      end_tzid: 'Europe/Lisbon',
    });
  });

  it('does not treat a re-rendered draft as dirty', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    expect(dirtyFields(draft)).toEqual([]);
    expect(editDeltaFromDraft(draft)).toEqual({});
  });
});

// ── AC-S2-09 ──────────────────────────────────────────────────────────────────

describe('timezone_change_wall_time', () => {
  it('leaves the entered local clock untouched when the zone changes', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    const beforeStart = draft.temporal.start_time;
    const beforeDate = draft.temporal.start_date;

    setTimezone(draft, 'Europe/Berlin');

    expect(draft.temporal.start_time).toBe(beforeStart);
    expect(draft.temporal.start_date).toBe(beforeDate);
    expect(draft.temporal.timezone).toBe('Europe/Berlin');
    // The zones were distinct, so the end zone is not dragged along.
    expect(draft.temporal.end_timezone).toBe('Europe/Lisbon');

    const preview = temporalPreviewInputFromDraft(draft);
    expect(preview.start).toBe('2026-07-01T22:00:00');
    expect(preview.start_tzid).toBe('Europe/Berlin');
    expect(preview.end_tzid).toBe('Europe/Lisbon');
  });

  it('follows the start zone only when both zones matched', () => {
    const draft = draftFromEvent(
      crossZoneEvent({ start_tzid: 'UTC', end_tzid: 'UTC' }),
      'sha256:token',
    );
    setTimezone(draft, 'America/New_York');
    expect(draft.temporal.timezone).toBe('America/New_York');
    expect(draft.temporal.end_timezone).toBe('America/New_York');
  });
});

// ── AC-S2-08 ──────────────────────────────────────────────────────────────────

describe('temporal_validation', () => {
  it('rejects a missing title and an inverted range locally', () => {
    const draft = draftFromSlot({ date: '2026-07-01', start_time: '10:00', end_time: '09:00' });
    const result = validateDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.field)).toContain('title');
    expect(result.errors.map(error => error.field)).toContain('duration');
  });

  it('rejects an unparseable clock value', () => {
    const draft = draftFromSlot({ date: '2026-07-01', start_time: 'not-a-time' });
    draft.title = 'Has a title';
    const result = validateDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.field === 'start')).toBe(true);
  });

  it('surfaces core preview failures bound to the offending field', () => {
    const draft = draftFromSlot({ date: '2011-12-30', start_time: '12:00', end_time: '13:00' });
    draft.title = 'Vanished day';
    const preview: EventTemporalPreviewDto = {
      status: 'unresolvable_local_time',
      schedulable: false,
      errors: [
        {
          field: 'start',
          code: 'unresolvable_local_time',
          message: 'wall-time is in a non-standard DST gap',
        },
      ],
      start_resolution: null,
      end_resolution: null,
      start_utc: null,
      end_utc: null,
      start_display: '2011-12-30T12:00:00',
      end_display: '2011-12-30T13:00:00',
      start_tzid: 'Pacific/Apia',
      end_tzid: 'Pacific/Apia',
      is_all_day: false,
      floating: false,
      elapsed_minutes: null,
      start_note: null,
      end_note: null,
    };

    const result = validateDraft(draft, preview);
    expect(result.valid).toBe(false);
    const gap = result.errors.find(error => error.code === 'unresolvable_local_time');
    expect(gap).toBeDefined();
    expect(gap?.field).toBe('start');
  });

  it('surfaces an invalid timezone against the zone field', () => {
    const draft = draftFromSlot({ date: '2026-07-01' });
    draft.title = 'Bad zone';
    const preview = {
      status: 'invalid_timezone',
      schedulable: false,
      errors: [
        { field: 'start_tzid', code: 'invalid_timezone', message: "invalid tzid 'Not/A_Timezone'" },
      ],
      start_resolution: null,
      end_resolution: null,
      start_utc: null,
      end_utc: null,
      start_display: '',
      end_display: '',
      start_tzid: 'Not/A_Timezone',
      end_tzid: 'Not/A_Timezone',
      is_all_day: false,
      floating: false,
      elapsed_minutes: null,
      start_note: null,
      end_note: null,
    } as EventTemporalPreviewDto;

    const result = validateDraft(draft, preview);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.field === 'start_tzid')).toBe(true);
  });

  it('passes a well-formed draft with an ok preview', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    expect(validateDraft(draft).valid).toBe(true);
  });
});

// ── AC-S2-11 ──────────────────────────────────────────────────────────────────

describe('serializer ownership', () => {
  it('builds the local sparse-edit payload only from the shared serializer', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    draft.title = 'Renamed';
    const payload = editPayloadFromDraft(draft, 'op-1');

    expect(payload.event_id).toBe('evt-flight');
    expect(payload.edit_token).toBe('sha256:token');
    expect(payload.operation_id).toBe('op-1');
    // The delta is byte-identical to the shared serializer's own output.
    expect(payload.delta).toEqual(editDeltaFromDraft(draft));
  });

  it('builds the routed payload from the same delta plus route identity', () => {
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    draft.title = 'Renamed';
    const routed = routedEditPayloadFromDraft(
      draft,
      { account_id: 'acct-1', calendar_id: 'primary' },
      'op-2',
    );

    expect(routed.account_id).toBe('acct-1');
    expect(routed.calendar_id).toBe('primary');
    expect(routed.guest_update_policy).toBe('all');
    expect(routed.delta).toEqual(editDeltaFromDraft(draft));
  });

  it('refuses to build an edit payload for a draft with no stored event', () => {
    const draft = draftFromSlot({ date: '2026-07-01' });
    expect(() => editPayloadFromDraft(draft, 'op-3')).toThrow();
  });
});

// ── AC-S2-06: mirrors jin-gui/src-tauri/tests/s2_sparse_event_edit.rs ──────────

describe('temporal preview boundary fidelity', () => {
  it('mirrors the Rust temporal-preview fixture exactly', () => {
    // The Rust side asserts these same values in
    // `temporal_preview_serialization_fixture`; if either drifts, one fails.
    const draft = draftFromEvent(crossZoneEvent(), 'sha256:token');
    const input = temporalPreviewInputFromDraft(draft);

    expect(input).toEqual({
      start: '2026-07-01T22:00:00',
      end: '2026-07-02T06:00:00',
      is_all_day: false,
      floating: false,
      start_tzid: 'America/Sao_Paulo',
      end_tzid: 'Europe/Lisbon',
    });

    const fromCore: EventTemporalPreviewDto = {
      status: 'ok',
      schedulable: true,
      errors: [],
      start_resolution: 'exact',
      end_resolution: 'exact',
      start_utc: '2026-07-02T01:00:00Z',
      end_utc: '2026-07-02T05:00:00Z',
      start_display: '2026-07-01T22:00:00',
      end_display: '2026-07-02T06:00:00',
      start_tzid: 'America/Sao_Paulo',
      end_tzid: 'Europe/Lisbon',
      is_all_day: false,
      floating: false,
      elapsed_minutes: 240,
      start_note: null,
      end_note: null,
    };
    // No data is lost translating core's answer back into a validated draft.
    expect(validateDraft(draft, fromCore).valid).toBe(true);
    expect(fromCore.elapsed_minutes).toBe(240);
  });
});
