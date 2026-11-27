// @vitest-environment jsdom
/**
 * event_composer.test.ts — S6 recurrence composer rules (AC-CALX-030–033).
 */

import { describe, expect, it, vi } from 'vitest';
import { draftFromEvent, draftFromSlot, setAttendees, setConferenceIntent, setRecurrence } from '../lib/events/draft';
import { renderEventComposer } from '../lib/events/composer';
import { recurrenceFromRepeatValue } from '../lib/events/recurrence';
import { renderRecurrenceScope } from '../lib/events/recurrence_scope';
import { eventMessage } from '../lib/events/locale';
import type { EventDto } from '../types/dto';

function baseEvent(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'evt-1',
    title: 'Standup',
    description: null,
    location: null,
    start: '2026-09-23T14:00:00',
    end: '2026-09-23T15:00:00',
    is_all_day: false,
    start_tzid: 'UTC',
    end_tzid: 'UTC',
    floating: false,
    status: 'confirmed',
    source: 'jin',
    authority: 'jin',
    ical_uid: null,
    derived_from: null,
    recurrence: ['RRULE:FREQ=DAILY'],
    recurring_event_id: 'master-1',
    original_start: null,
    master_id: null,
    recurrence_unexpanded: false,
    sequence: 0,
    created: '2026-09-01T00:00:00Z',
    updated: '2026-09-01T00:00:00Z',
    backlinks: [],
    ...overrides,
  };
}

describe('event_composer recurrence (S6)', () => {
  it('recurrence_scope_required: Save disabled until one of multiple scopes is selected', () => {
    const draft = draftFromEvent(baseEvent(), 'tok');
    draft.title = 'Standup renamed';
    const view = renderEventComposer({
      draft,
      recurrenceScopes: ['this_occurrence', 'entire_series'],
      recurrencePatternSupported: true,
    });
    document.body.appendChild(view.root);
    const save = view.root.querySelector<HTMLButtonElement>('.event-composer__save')!;
    expect(view.scopeResolved()).toBe(false);
    expect(save.disabled).toBe(true);

    const series = view.root.querySelector<HTMLInputElement>('input[value="entire_series"]')!;
    series.checked = true;
    series.dispatchEvent(new Event('change', { bubbles: true }));
    expect(view.scopeResolved()).toBe(true);
    expect(save.disabled).toBe(false);
  });

  it('occurrence_rule_immutable: this_occurrence hides master pattern controls', () => {
    const draft = draftFromEvent(baseEvent(), 'tok');
    const view = renderEventComposer({
      draft,
      recurrenceScopes: ['this_occurrence', 'entire_series'],
      recurrencePatternSupported: true,
    });
    document.body.appendChild(view.root);
    const occurrence = view.root.querySelector<HTMLInputElement>('input[value="this_occurrence"]')!;
    occurrence.checked = true;
    occurrence.dispatchEvent(new Event('change', { bubbles: true }));
    const repeat = view.root.querySelector<HTMLSelectElement>('[data-companion-focus="composer-repeat"]');
    const section = repeat?.closest('details') as HTMLDetailsElement | null;
    expect(section?.hidden).toBe(true);
    expect(repeat?.disabled).toBe(true);
  });

  it('series_rule_editor: entire_series + pattern support exposes normalized editor', () => {
    const draft = draftFromEvent(baseEvent(), 'tok');
    const view = renderEventComposer({
      draft,
      recurrenceScopes: ['entire_series'],
      recurrencePatternSupported: true,
    });
    document.body.appendChild(view.root);
    const repeat = view.root.querySelector<HTMLSelectElement>('[data-companion-focus="composer-repeat"]')!;
    const section = repeat.closest('details') as HTMLDetailsElement;
    expect(section.hidden).toBe(false);
    expect(repeat.disabled).toBe(false);
    expect([...repeat.options].map(o => o.value)).toEqual(
      expect.arrayContaining(['none', 'daily', 'weekly', 'monthly', 'yearly']),
    );
  });

  it('this_and_following never appears in Composer or recurrence_scope', () => {
    const draft = draftFromSlot({ date: '2026-09-23' });
    const view = renderEventComposer({
      draft,
      recurrenceScopes: ['this_occurrence', 'entire_series'],
    });
    document.body.appendChild(view.root);
    expect(view.root.innerHTML).not.toContain('this_and_following');
    expect(view.root.textContent?.toLowerCase()).not.toContain('following');

    const fieldset = renderRecurrenceScope({
      scopes: ['this_occurrence', 'entire_series'],
      name: 'x',
    });
    const values = [...fieldset.querySelectorAll('input')].map(i => i.value);
    expect(values).toEqual(['this_occurrence', 'entire_series']);
    expect(values).not.toContain('this_and_following');
  });
});

describe('event_composer restoration', () => {
  it('shows the chosen Google update delivery policy for real guests', () => {
    const draft = draftFromEvent(baseEvent({
      attendees: [{ email: 'person@example.com' }],
    }), 'tok');
    draft.title = 'Updated title';
    const view = renderEventComposer({
      draft,
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: true,
    });
    document.body.replaceChildren(view.root, view.footer);

    const updates = view.root.querySelector<HTMLSelectElement>('#event-composer-guest-updates')!;
    expect(updates.labels?.[0]?.textContent).toContain('Send Google updates');
    expect([...updates.options].map(option => option.textContent)).toEqual([
      'All guests',
      'Guests who do not use Google Calendar',
      'Do not notify guests',
    ]);
    updates.value = 'none';
    updates.dispatchEvent(new Event('change', { bubbles: true }));
    expect(draft.guest_update_policy).toBe('none');
  });

  it('opens the delivery choice when core knows an attendee is affected', () => {
    const view = renderEventComposer({
      draft: draftFromEvent(baseEvent({ attendees: null }), 'tok'),
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: true,
    });
    document.body.appendChild(view.root);

    const updates = view.root.querySelector('#event-composer-guest-updates')!;
    expect((updates.closest('details') as HTMLDetailsElement).open).toBe(true);
  });

  it('uses the recurrence-master delivery capability for an entire-series edit', () => {
    const draft = draftFromEvent(baseEvent({
      attendees: [{ email: 'occurrence@example.com' }],
    }), 'tok');
    const view = renderEventComposer({
      draft,
      guestUpdateAvailable: true,
      seriesGuestUpdateAvailable: false,
      recurrenceScopes: ['this_occurrence', 'entire_series'],
    });
    document.body.appendChild(view.root);

    const entireSeries = view.root.querySelector<HTMLInputElement>('input[value="entire_series"]')!;
    entireSeries.click();
    expect(draft.recurrence_scope).toBe('entire_series');
    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(true);
  });

  it('falls back to occurrence eligibility for a recurrence master whose series signal is unavailable', () => {
    const draft = draftFromEvent(baseEvent({ attendees: [{ email: 'guest@example.com' }] }), 'tok');
    draft.recurrence_scope = 'entire_series';
    const view = renderEventComposer({
      draft,
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: true,
      eventIsSeriesMaster: true,
    });
    document.body.appendChild(view.root);

    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(false);
  });

  it('does not infer delivery from an attendee list when core explicitly says no guests are affected', () => {
    const draft = draftFromEvent(baseEvent({
      attendees: [{ email: 'unverified@example.com' }],
    }), 'tok');
    const view = renderEventComposer({ draft, guestUpdateAvailable: false });
    document.body.appendChild(view.root);

    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(true);
    expect(view.root.querySelector('#event-composer-guests')?.closest('details')
      ?.querySelector('.event-composer__section-hint')?.textContent).toBe('1 guests');
  });

  it('never offers delivery controls for a local route with historical attendees', () => {
    const draft = draftFromEvent(baseEvent({ attendees: [{ email: 'guest@example.com' }] }), 'tok');
    const view = renderEventComposer({
      draft,
      destination: { name: 'Jin' },
      guestUpdateAvailable: true,
    });
    document.body.appendChild(view.root);

    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(true);
  });

  it('enables a writable Jin-origin Google event to add its first guest and choose delivery', () => {
    const draft = draftFromEvent(baseEvent(), 'tok');
    const view = renderEventComposer({
      draft,
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: false,
      guestUpdateEditable: true,
      attendeeEditingAllowed: true,
    });
    document.body.appendChild(view.root);

    const guests = view.root.querySelector<HTMLTextAreaElement>('#event-composer-guests')!;
    expect(guests.disabled).toBe(false);
    guests.value = 'first@example.com';
    guests.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(false);
  });

  it('keeps attendee editing unavailable to a schedule-only guest editor', () => {
    const draft = draftFromEvent(baseEvent({ attendees: [{ email: 'host@example.com' }] }), 'tok');
    const view = renderEventComposer({
      draft,
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: true,
      guestUpdateEditable: true,
      attendeeEditingAllowed: false,
    });
    document.body.appendChild(view.root);

    expect(view.root.querySelector<HTMLTextAreaElement>('#event-composer-guests')?.disabled).toBe(true);
    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(false);
  });

  it('prepopulates guests and retains matching RSVP metadata plus protected provider entries', () => {
    const draft = draftFromEvent(baseEvent({
      attendees: [
        { email: 'person@example.com', responseStatus: 'accepted', optional: true },
        { email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { email: 'room@example.com', resource: true },
      ],
    }), 'tok');
    const view = renderEventComposer({
      draft,
      destination: { name: 'Team', accountId: 'account', calendarId: 'calendar' },
      guestUpdateAvailable: true,
      attendeeEditingAllowed: true,
    });
    document.body.appendChild(view.root);

    const guests = view.root.querySelector<HTMLTextAreaElement>('#event-composer-guests')!;
    expect(guests.value).toBe('person@example.com');
    guests.value = 'person@example.com, new@example.com';
    guests.dispatchEvent(new Event('input', { bubbles: true }));

    expect(draft.attendees).toEqual([
      { email: 'person@example.com', responseStatus: 'accepted', optional: true },
      { email: 'new@example.com' },
      { email: 'me@example.com', self: true, responseStatus: 'accepted' },
      { email: 'room@example.com', resource: true },
    ]);
  });

  it('does not expose the Google delivery choice for a solo event', () => {
    const view = renderEventComposer({ draft: draftFromEvent(baseEvent(), 'tok') });
    document.body.appendChild(view.root);
    expect(view.root.querySelector<HTMLElement>('#event-composer-guest-updates')?.closest('label')?.hidden).toBe(true);
  });

  it('keeps a long Portuguese calendar source in the native destination control', () => {
    const personal = { name: 'Calendário do Jin' };
    const google = {
      name: 'Agenda Pessoal da Família e compromissos compartilhados',
      alias: 'Conta pessoal',
      accountId: 'account-personal',
      calendarId: 'calendar-family',
      color: 'sky' as const,
    };
    const draft = draftFromSlot({ date: '2026-09-23' });
    const changed = vi.fn();
    const view = renderEventComposer({
      draft,
      locale: 'pt-BR',
      destinations: [personal, google],
      onDestinationChange: changed,
    });
    document.body.replaceChildren(view.root, view.footer);

    const select = view.root.querySelector<HTMLSelectElement>('#event-composer-destination')!;
    const swatch = view.root.querySelector<HTMLElement>('.event-composer__calendar-row .event-composer__color')!;
    expect(select.labels?.[0]?.textContent).toContain('Calendário');
    expect([...select.options].map(option => option.textContent)).toContain(
      'Conta pessoal · Agenda Pessoal da Família e compromissos compartilhados',
    );
    expect(swatch.getAttribute('aria-hidden')).toBe('true');

    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(select.selectedOptions[0]?.textContent).toBe(
      'Conta pessoal · Agenda Pessoal da Família e compromissos compartilhados',
    );
    expect(changed).toHaveBeenCalledWith(google);
  });

  it('uses a labeled native radio group to choose how a recurring edit applies', () => {
    const draft = draftFromEvent(baseEvent(), 'tok');
    draft.title = 'Standup renamed';
    const view = renderEventComposer({
      draft,
      locale: 'pt-BR',
      recurrenceScopes: ['this_occurrence', 'entire_series'],
      recurrencePatternSupported: true,
    });
    document.body.replaceChildren(view.root, view.footer);

    const fieldset = view.root.querySelector<HTMLFieldSetElement>('.event-composer__apply-to')!;
    const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const save = view.footer.querySelector<HTMLButtonElement>('.event-composer__save')!;
    expect(fieldset.querySelector('legend')?.textContent).toBe(eventMessage('applyTo', 'pt-BR'));
    expect(radios.map(radio => radio.name)).toEqual([
      'event-composer-recurrence-scope',
      'event-composer-recurrence-scope',
    ]);
    expect(radios.map(radio => radio.labels?.[0]?.textContent?.trim())).toEqual([
      'Esta ocorrência',
      'Série inteira',
    ]);
    expect(save.disabled).toBe(true);

    radios[1].click();

    expect(draft.recurrence_scope).toBe('entire_series');
    expect(view.scopeResolved()).toBe(true);
    expect(save.disabled).toBe(false);
    expect(view.root.querySelector<HTMLSelectElement>('[data-companion-focus="composer-repeat"]')?.disabled).toBe(false);
  });

  it('names every editable field and keeps pristine validation hidden while Save is gated', () => {
    const view = renderEventComposer({ draft: draftFromSlot({ date: '2026-09-23' }), locale: 'en' });
    document.body.replaceChildren(view.root, view.footer);
    const controls = [...view.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')];
    for (const control of controls) {
      expect(control.labels?.length, control.outerHTML).toBeGreaterThan(0);
      expect(control.labels?.[0]?.textContent?.trim(), control.outerHTML).not.toBe('');
    }
    expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe('');
    expect(view.footer.querySelector<HTMLButtonElement>('.event-composer__save')?.disabled).toBe(true);
    const title = view.root.querySelector<HTMLInputElement>('#event-composer-title')!;
    title.focus();
    title.blur();
    expect(title.hasAttribute('aria-invalid')).toBe(false);
    expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe('');
    view.showValidation();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('event-composer-errors');
    expect(view.root.querySelector('.event-composer__errors')?.textContent).toContain('A title is required');
  });

  it('keeps a cleared title quiet on blur and validates explicit Enter in either language', () => {
    for (const [locale, required] of [['en', 'A title is required.'], ['pt-BR', 'Adicione um título.']] as const) {
      const saved = vi.fn();
      const draft = draftFromSlot({ date: '2026-09-23' });
      const view = renderEventComposer({ draft, locale, onSave: saved });
      document.body.replaceChildren(view.root, view.footer);
      const title = view.root.querySelector<HTMLInputElement>('#event-composer-title')!;
      title.value = 'Planning';
      title.dispatchEvent(new Event('input'));
      title.value = '';
      title.dispatchEvent(new Event('input'));
      title.focus();
      title.blur();
      expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe('');
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe('');
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe(required);
      expect(saved).not.toHaveBeenCalled();
      title.value = 'Planning';
      title.dispatchEvent(new Event('input'));
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(saved).toHaveBeenCalledTimes(1);
      expect(view.root.querySelector('.event-composer__errors')?.textContent).toBe('');
    }
  });

  it('shows Meet intent truthfully in English and Portuguese without claiming pending work', () => {
    for (const [locale, none, requested] of [
      ['en', 'No video meeting', 'Meet will be added on save'],
      ['pt-BR', 'Sem reunião por vídeo', 'Meet será adicionado ao salvar'],
    ] as const) {
      const draft = draftFromSlot({ date: '2026-09-23' });
      const view = renderEventComposer({ draft, locale, destination: { name: 'Team', accountId: 'a', calendarId: 'c' } });
      const section = [...view.root.querySelectorAll('details')].find(el => el.querySelector('#event-composer-meet'))!;
      expect(section.querySelector('.event-composer__section-hint')?.textContent).toBe(none);
      const select = section.querySelector<HTMLSelectElement>('select')!;
      select.value = 'add';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      section.open = false;
      section.dispatchEvent(new Event('toggle'));
      expect(section.querySelector('.event-composer__section-hint')?.textContent).toBe(requested);
    }
  });

  it('gates remote-only guests, Meet, and repeat intent on an exact Google destination', () => {
    for (const intent of ['guests', 'meet', 'repeat'] as const) {
      const draft = draftFromSlot({ date: '2026-09-23' });
      draft.title = 'Review';
      if (intent === 'guests') setAttendees(draft, [{ email: 'guest@example.com' }]);
      if (intent === 'meet') setConferenceIntent(draft, { kind: 'add', solution_type: 'hangoutsMeet' });
      if (intent === 'repeat') setRecurrence(draft, recurrenceFromRepeatValue('weekly'));
      const route = { name: 'Team', alias: 'Work', accountId: 'a', calendarId: 'c' };
      const view = renderEventComposer({
        draft, locale: 'en', destination: { name: 'Jin' }, destinations: [{ name: 'Jin' }, route],
      });
      document.body.replaceChildren(view.root, view.footer);
      const save = view.footer.querySelector<HTMLButtonElement>('.event-composer__save')!;
      expect(save.disabled, intent).toBe(true);
      expect(view.root.querySelector('.event-composer__destination-help')?.textContent).toContain('exact Google calendar');
      const select = view.root.querySelector<HTMLSelectElement>('#event-composer-destination')!;
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(save.disabled, intent).toBe(false);
    }
  });
});
