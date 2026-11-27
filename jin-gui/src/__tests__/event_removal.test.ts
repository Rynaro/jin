// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventRemovalDialog } from '../lib/events/removal';
import type { EventDetailDto, EventDto } from '../types/dto';

function eventFixture(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'pilates', title: '🧘 Pilates', description: null, location: null,
    start: '2026-11-30T08:00:00', end: '2026-11-30T09:00:00',
    is_all_day: false, start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo',
    floating: false, status: 'confirmed', source: 'google', authority: 'google',
    ical_uid: null, derived_from: null, recurrence: ['RRULE:FREQ=WEEKLY'],
    recurring_event_id: 'series-pilates', original_start: null, master_id: 'series-pilates',
    recurrence_unexpanded: false, sequence: 1, created: '2026-11-20T00:00:00Z',
    updated: '2026-11-20T00:00:00Z', backlinks: [],
    sync_context: {
      provider: 'google', account_id: 'personal', account_alias: 'Pessoal',
      calendar_id: 'family', calendar_name: 'Família', access_role: 'owner',
      writable: true, state: 'synced', allowed_conference_solution_types: [],
    },
    ...overrides,
  };
}

function detailFixture(scopes: Array<'this_occurrence' | 'entire_series'>): EventDetailDto {
  return {
    event: eventFixture(), edit_token: 'token',
    capabilities: {
      display_kind: 'event', can_edit: true, can_delete: true, read_only_reason: null,
      can_return_task_to_flexible: false, originating_task: null, recurrence_scopes: scopes,
      collaboration: {
        has_notifiable_guests: true, series_has_notifiable_guests: true,
        can_edit_schedule: true, can_append_attendees: true, can_remove_attendees: true,
        can_change_attendee_roles: true, can_cancel_meeting: true,
        can_add_conference: false, can_remove_conference: false,
        allowed_conference_solution_types: [], disabled_reasons: {},
      },
    },
  };
}

beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

describe('event cancellation confirmation', () => {
  it('separates the event identity, selected occurrence, series scope, and guest updates', () => {
    const dialog = createEventRemovalDialog({
      detail: detailFixture(['this_occurrence', 'entire_series']), locale: 'pt-BR',
      onRemoved: () => undefined, onFailure: () => undefined,
    });
    dialog.open();

    const root = document.querySelector<HTMLDialogElement>('.event-removal-dialog')!;
    expect(root.textContent).toContain('🧘 Pilates');
    expect(root.textContent).toContain('America/Sao_Paulo');
    expect(root.textContent).toContain('Família · Pessoal');
    expect(root.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(root.textContent).toContain('Somente a ocorrência de');
    expect(root.textContent).toContain('Todas as ocorrências desta série serão removidas');
    expect(root.querySelector<HTMLLabelElement>('.confirm-dialog__select')?.hidden).toBe(false);

    const series = root.querySelector<HTMLInputElement>('input[value="entire_series"]')!;
    series.checked = true;
    series.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector<HTMLLabelElement>('.confirm-dialog__select')?.hidden).toBe(false);
    dialog.destroy();
  });

  it('does not invent an occurrence choice when only the series master is actionable', () => {
    const dialog = createEventRemovalDialog({
      detail: detailFixture(['entire_series']), locale: 'pt-BR',
      onRemoved: () => undefined, onFailure: () => undefined,
    });
    dialog.open();

    const root = document.querySelector<HTMLDialogElement>('.event-removal-dialog')!;
    expect(root.querySelector('.confirm-dialog__choices')).toBeNull();
    expect(root.textContent).not.toContain('Esta ocorrência');
    expect(root.querySelector('.event-removal__scope-note')?.textContent)
      .toBe('Todas as ocorrências desta série serão removidas do calendário.');
    expect(root.querySelector<HTMLLabelElement>('.confirm-dialog__select')?.hidden).toBe(false);
    dialog.destroy();
  });

  it('shows the inclusive end date for a multi-day all-day event', () => {
    const detail = detailFixture(['this_occurrence']);
    detail.event = eventFixture({
      start: '2026-11-30', end: '2026-12-03', is_all_day: true,
      start_tzid: null, end_tzid: null, floating: true,
    });
    const dialog = createEventRemovalDialog({
      detail, locale: 'pt-BR', onRemoved: () => undefined, onFailure: () => undefined,
    });
    dialog.open();

    expect(document.querySelector('.event-removal__when')?.textContent).toContain('2 de dezembro');
    dialog.destroy();
  });
});
