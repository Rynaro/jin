// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEventPreview } from '../lib/events/preview';
import type { EventDetailDto, EventDto } from '../types/dto';

function eventFixture(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'preview-event', title: 'Pilates', description: null, location: null,
    start: '2026-11-30T08:00:00', end: '2026-11-30T09:00:00',
    is_all_day: false, start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo',
    floating: false, status: 'confirmed', source: 'google', authority: 'google',
    ical_uid: null, derived_from: null, recurrence: [], recurring_event_id: null,
    original_start: null, master_id: null, recurrence_unexpanded: false, sequence: 1,
    created: '2026-11-20T00:00:00Z', updated: '2026-11-20T00:00:00Z', backlinks: [],
    sync_context: {
      provider: 'google', account_id: 'personal', account_alias: 'Pessoal',
      calendar_id: 'family', calendar_name: 'Família', access_role: 'owner',
      writable: true, state: 'synced', allowed_conference_solution_types: [],
    },
    ...overrides,
  };
}

function detailFixture(event: EventDto, overrides: Partial<EventDetailDto['capabilities']> = {}): EventDetailDto {
  return {
    event,
    edit_token: 'token',
    capabilities: {
      display_kind: 'event', can_edit: true, can_delete: true, read_only_reason: null,
      can_return_task_to_flexible: false, originating_task: null, recurrence_scopes: [],
      ...overrides,
    },
  };
}

beforeEach(() => document.body.replaceChildren());

describe('event quick preview', () => {
  it('offers a localized direct cancellation for a writable solo Google event', () => {
    const remove = vi.fn();
    const preview = renderEventPreview(detailFixture(eventFixture()), { onRemove: remove }, { locale: 'pt-BR' });
    document.body.appendChild(preview);

    const action = preview.querySelector<HTMLButtonElement>('.event-preview__remove')!;
    expect(action.textContent).toBe('Cancelar evento');
    expect(action.dataset.companionFocus).toBe('preview-remove');
    action.click();
    expect(remove).toHaveBeenCalledWith(action);
  });

  it('uses the meeting label when a routed Google event has another person to notify', () => {
    const preview = renderEventPreview(detailFixture(eventFixture(), {
      collaboration: {
        has_notifiable_guests: true,
        can_edit_schedule: true,
        can_append_attendees: true,
        can_remove_attendees: true,
        can_change_attendee_roles: true,
        can_cancel_meeting: true,
        can_add_conference: false,
        can_remove_conference: false,
        allowed_conference_solution_types: [],
        disabled_reasons: {},
      },
    }), { onRemove: vi.fn() }, { locale: 'en' });

    expect(preview.querySelector('.event-preview__remove')?.textContent).toBe('Cancel meeting');
  });

  it('does not show an empty participant section when the calendar is the organizer', () => {
    const preview = renderEventPreview(detailFixture(eventFixture({
      organizer: { displayName: 'Família', email: 'family@example.test' },
      attendees: [{ displayName: 'Família', organizer: true }],
    })), {}, { locale: 'pt-BR' });

    expect(preview.querySelector('.event-preview__guests')).toBeNull();
    expect(preview.textContent).toContain('Origem: Google');
  });

  it('mutes only the routine synced status, leaving an active operation status prominent', () => {
    const routine = renderEventPreview(detailFixture(eventFixture()), {}, { locale: 'pt-BR' });
    expect(routine.querySelector('.event-preview__sync--routine')?.textContent).toContain('Google Agenda');

    const pending = renderEventPreview(
      detailFixture(eventFixture()),
      {},
      { locale: 'pt-BR', operationState: 'sync_pending' },
    );
    expect(pending.querySelector('.event-preview__sync--routine')).toBeNull();
  });
});
