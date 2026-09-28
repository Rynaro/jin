// @vitest-environment jsdom
/**
 * event_composer.test.ts — S6 recurrence composer rules (AC-CALX-030–033).
 */

import { describe, expect, it } from 'vitest';
import { draftFromEvent, draftFromSlot, setAttendees, setConferenceIntent, setRecurrence } from '../lib/events/draft';
import { renderEventComposer } from '../lib/events/composer';
import { recurrenceFromRepeatValue } from '../lib/events/recurrence';
import { renderRecurrenceScope } from '../lib/events/recurrence_scope';
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
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('event-composer-errors');
    expect(view.root.querySelector('.event-composer__errors')?.textContent).toContain('A title is required');
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
