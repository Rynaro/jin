// @vitest-environment jsdom
/**
 * AC-CALX-027 / AC-CALX-058 — Calendar, Today, Capture, and full detail share
 * destination, scope, validation, and serialized mutation meaning through
 * shared EventDraft adapters.
 */

import { describe, expect, it } from 'vitest';
import {
  createInputFromDraft,
  draftFromCapture,
  draftFromEvent,
  draftFromSlot,
  editDeltaFromDraft,
  editPayloadFromDraft,
  routedCreateInputFromDraft,
  routedEditPayloadFromDraft,
  validateDraft,
} from '../lib/events/draft';
import type { EventDto } from '../types/dto';

function baseEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'evt-cross',
    title: 'Cross-entry meeting',
    description: null,
    location: 'Library',
    start: '2026-09-23T14:00:00',
    end: '2026-09-23T15:00:00',
    is_all_day: false,
    start_tzid: 'America/Sao_Paulo',
    end_tzid: 'America/New_York',
    floating: false,
    status: 'confirmed',
    source: 'jin',
    authority: 'jin',
    ical_uid: null,
    derived_from: null,
    recurrence_unexpanded: false,
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-01T00:00:00Z',
    backlinks: [],
    ...overrides,
  };
}

describe('EventDraft cross-entry contract (AC-CALX-027, AC-CALX-058)', () => {
  it('Calendar slot, Capture, and full-detail edit share destination/scope/validation meaning', () => {
    const slot = draftFromSlot({
      date: '2026-09-23',
      start_time: '14:00',
      end_time: '15:00',
      timezone: 'America/Sao_Paulo',
    });
    slot.title = 'Cross-entry meeting';
    slot.location = 'Library';

    const capture = draftFromCapture({
      title: 'Cross-entry meeting',
      date: '2026-09-23',
      start_time: '14:00',
      end_time: '15:00',
      location: 'Library',
      timezone: 'America/Sao_Paulo',
    });

    const detail = draftFromEvent(baseEvent(), 'tok-1');
    detail.title = 'Cross-entry meeting';
    detail.location = 'Library';

    expect(validateDraft(slot).valid).toBe(true);
    expect(validateDraft(capture).valid).toBe(true);
    expect(validateDraft(detail).valid).toBe(true);

    expect(createInputFromDraft(slot)).toMatchObject({
      title: 'Cross-entry meeting',
      start: '2026-09-23T14:00:00',
      end: '2026-09-23T15:00:00',
      location: 'Library',
    });
    expect(createInputFromDraft(capture)).toMatchObject(createInputFromDraft(slot));

    const route = { account_id: 'acct', calendar_id: 'cal' };
    expect(routedCreateInputFromDraft(slot, route, 'op-1')).toMatchObject({
      ...createInputFromDraft(slot),
      account_id: 'acct',
      calendar_id: 'cal',
      operation_id: 'op-1',
    });
  });

  it('title-only sparse edit omits temporal bundle across surfaces (AC-CALX-054)', () => {
    const draft = draftFromEvent(baseEvent(), 'tok-cross');
    draft.title = 'Renamed only';
    const delta = editDeltaFromDraft(draft);
    expect(delta).toEqual({ title: 'Renamed only' });
    expect(delta.temporal).toBeUndefined();
    expect(editPayloadFromDraft(draft, 'op-edit')).toMatchObject({
      event_id: 'evt-cross',
      edit_token: 'tok-cross',
      operation_id: 'op-edit',
      delta: { title: 'Renamed only' },
    });
    expect(routedEditPayloadFromDraft(draft, { account_id: 'a', calendar_id: 'c' }, 'op-r')).toMatchObject({
      account_id: 'a',
      calendar_id: 'c',
      delta: { title: 'Renamed only' },
    });
  });

  it('recurrence scope serializes identically for edit adapters', () => {
    const draft = draftFromEvent(
      baseEvent({ recurrence: ['RRULE:FREQ=DAILY'], recurring_event_id: 'master' }),
      'tok',
    );
    draft.title = 'Scoped rename';
    draft.recurrence_scope = 'entire_series';
    draft.recurrence_changed = true;
    const payload = editPayloadFromDraft(draft, 'op');
    expect(payload.recurrence_scope).toBe('entire_series');
    const routed = routedEditPayloadFromDraft(draft, { account_id: 'a', calendar_id: 'c' }, 'op');
    expect(routed.recurrence_scope).toBe('entire_series');
    expect(routed.guest_update_policy).toBe(draft.guest_update_policy);
  });
});
