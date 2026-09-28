// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCalendarColor,
  calendarKeyForEvent,
  calendarMembershipIdentity,
  calendarProvenanceLabel,
  googleCalendarKey,
  saveCalendarColor,
} from '../lib/calendar/colors';
import { renderEventPreview } from '../lib/events/preview';
import { renderEventComposer } from '../lib/events/composer';
import { draftFromSlot } from '../lib/events/draft';
import { renderEventDetail, type EventsTemplates, type EventsViewElements } from '../lib/events/render';
import { eventMessage } from '../lib/events/locale';
import type { EventDetailDto, EventDto } from '../types/dto';

function makeEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'event-1', title: 'Sync review', description: null,
    location: null, start: '2026-08-20T14:00:00', end: '2026-08-20T15:00:00',
    is_all_day: false, start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo',
    floating: false, status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: 'event-1@jin',
    derived_from: null, recurrence: [], recurring_event_id: null, original_start: null,
    master_id: null, recurrence_unexpanded: false, sequence: 1,
    created: '2026-08-01T10:00:00-03:00', updated: '2026-08-01T10:00:00-03:00', backlinks: [],
    sync_context: {
      provider: 'google', account_id: 'acct-work', account_alias: 'Work',
      calendar_id: 'team@example.com', calendar_name: 'Team', access_role: 'writer',
      writable: true, state: 'synced', allowed_conference_solution_types: ['hangoutsMeet'],
    },
    ...overrides,
  };
}

function makeDetail(event: EventDto): EventDetailDto {
  return {
    event,
    edit_token: 'token',
    capabilities: {
      display_kind: 'event',
      can_edit: true,
      can_delete: true,
      read_only_reason: null,
      can_return_task_to_flexible: false,
      originating_task: null,
      recurrence_scopes: [],
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('shared calendar identity fixture (AC-CALX-040)', () => {
  it('yields the same key, label, alias, and color across Preview, Composer, detail, and color application', () => {
    const key = googleCalendarKey('acct-work', 'team@example.com');
    saveCalendarColor(key, 'pink');
    const event = makeEvent();
    const jinLabel = eventMessage('jinCalendarName', 'en');
    const membership = calendarMembershipIdentity(event, jinLabel);

    expect(calendarKeyForEvent(event)).toBe(key);
    expect(membership).toMatchObject({
      key,
      label: 'Team',
      accountAlias: 'Work',
      color: 'pink',
      provider: 'google',
    });
    expect(calendarProvenanceLabel(event, {
      createdInJin: eventMessage('createdInJin', 'en'),
      sourceGoogle: eventMessage('sourceGoogle', 'en'),
      sourceJin: eventMessage('sourceJin', 'en'),
    })).toBe(eventMessage('createdInJin', 'en'));

    const preview = renderEventPreview(makeDetail(event), {}, { locale: 'en' });
    expect(preview.querySelector('.event-preview__calendar-name')?.textContent).toBe(membership.label);
    expect(preview.querySelector('.event-preview__account-alias')?.textContent).toBe(membership.accountAlias);
    expect(preview.querySelector('.event-preview__color')?.getAttribute('data-calendar-color')).toBe('pink');
    expect(preview.querySelector('.event-preview__provenance')?.textContent).toBe(eventMessage('createdInJin', 'en'));

    const draft = draftFromSlot({ date: '2026-08-20', start_time: '14:00', end_time: '15:00' });
    const composer = renderEventComposer({
      draft,
      locale: 'en',
      destination: {
        name: membership.label,
        alias: membership.accountAlias ?? undefined,
        color: membership.color,
      },
    });
    expect(composer.root.querySelector('.event-composer__calendar-name')?.textContent).toBe('Team');
    expect(composer.root.querySelector('.event-composer__account-alias')?.textContent).toBe('Work');
    expect(composer.root.querySelector('.event-composer__color')?.getAttribute('data-calendar-color')).toBe('pink');

    const host = {
      listPanel: document.createElement('div'),
      list: document.createElement('ul'),
      emptyState: document.createElement('div'),
      loadingState: document.createElement('div'),
      detailPanel: document.createElement('div'),
      detailLoadingState: document.createElement('div'),
      detailNotFoundState: document.createElement('div'),
      detailContent: document.createElement('div'),
    } satisfies EventsViewElements;
    const templates = {
      eventBrowseRow: document.createElement('template'),
      backlinkRow: document.createElement('template'),
    } satisfies EventsTemplates;
    renderEventDetail(host, templates, makeDetail(event), () => {});
    expect(host.detailContent.querySelector('.event-detail__source-label')?.textContent).toContain('Team');
    expect(host.detailContent.querySelector('.event-detail__destination')?.textContent).toContain('Work — Team');
    expect(host.detailContent.querySelector('.event-detail__destination')?.textContent).toContain(eventMessage('createdInJin', 'en'));

    const chip = document.createElement('button');
    applyCalendarColor(chip, membership.color);
    expect(chip.dataset.calendarColor).toBe('pink');
  });
});
