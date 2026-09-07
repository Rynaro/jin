// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { EventDetailDto, EventDto } from '../types/dto';
import {
  applyCalendarSelection,
  applyRelativeResult,
  changedEditableFields,
  draftFromEvent,
  inputFromDraft,
  isValidEventEditDraft,
  renderEventEditor,
} from '../lib/events/edit';

function event(overrides: Partial<EventDto> = {}): EventDto {
  return {
    id: 'event-1', title: 'Planning', description: 'Keep\nnewlines', location: 'Studio',
    start: '2026-08-20T23:30:17', end: '2026-08-22T01:15:17', is_all_day: false,
    start_tzid: 'America/Sao_Paulo', end_tzid: 'America/Sao_Paulo', floating: false,
    status: 'confirmed', source: 'jin', authority: 'jin', ical_uid: 'event-1@jin',
    derived_from: null, recurrence: [], recurring_event_id: null, original_start: null,
    master_id: null, recurrence_unexpanded: false, sequence: 1,
    created: '2026-08-01T00:00:00-03:00', updated: '2026-08-01T00:00:00-03:00', backlinks: [],
    ...overrides,
  };
}

function detail(value = event()): EventDetailDto {
  return { event: value, edit_token: 'sha256:token', capabilities: {
    display_kind: value.derived_from ? 'time-block' : 'event', can_edit: true, can_delete: true,
    read_only_reason: null, can_return_task_to_flexible: false, originating_task: null,
  } };
}

const renderOptions = () => ({
  locale: 'en' as const, today: '2026-08-20', pending: false, focusTitle: true,
  onDraftChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onUseLatest: vi.fn(), onReviewDraft: vi.fn(),
});

describe('detail-resident Event edit temporal helpers', () => {
  it('initializes timed multi-day endpoints and retains an exact baseline', () => {
    const draft = draftFromEvent(event());
    expect(draft).toMatchObject({ start_date: '2026-08-20', end_date: '2026-08-22', start_time: '23:30', end_time: '01:15' });
    expect(inputFromDraft(draft)).toMatchObject({ start: '2026-08-20T23:30:17', end: '2026-08-22T01:15:17', tzid: 'America/Sao_Paulo' });
  });

  it('initializes an all-day half-open interval as an inclusive range with hidden defaults', () => {
    const draft = draftFromEvent(event({ start: '2026-08-20', end: '2026-08-23', is_all_day: true, start_tzid: null, end_tzid: null }));
    expect(draft).toMatchObject({ start_date: '2026-08-20', end_date: '2026-08-22', start_time: '09:00', end_time: '10:00' });
    expect(inputFromDraft(draft)).toMatchObject({ start: '2026-08-20', end: '2026-08-23', tzid: undefined });
  });

  it('passes exact seconds through title-only and semantic change-then-revert', () => {
    const original = event();
    const draft = draftFromEvent(original);
    draft.title = 'Renamed';
    draft.start_time = '10:00';
    draft.start_time = '23:30';
    applyCalendarSelection(draft, { mode: 'range', start: '2026-08-25', end: '2026-08-26', complete: true });
    applyCalendarSelection(draft, { mode: 'range', start: '2026-08-20', end: '2026-08-22', complete: true });
    expect(inputFromDraft(draft)).toMatchObject({ title: 'Renamed', start: original.start, end: original.end });
  });

  it('Calendar selection literally resizes dates and leaves overnight clocks temporarily invalid', () => {
    const draft = draftFromEvent(event());
    applyCalendarSelection(draft, { mode: 'range', start: '2026-09-01', end: '2026-09-01', complete: false });
    expect(draft).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-01', start_time: '23:30', end_time: '01:15' });
    expect(isValidEventEditDraft(draft)).toBe(false);
  });

  it('date-only relative input relocates both endpoints without changing shape', () => {
    const draft = draftFromEvent(event());
    applyRelativeResult(draft, { ok: true, date: '2026-08-25', time: null });
    expect(draft).toMatchObject({ start_date: '2026-08-25', end_date: '2026-08-27', start_time: '23:30', end_time: '01:15', is_all_day: false });
  });

  it('timed relative input preserves naive multi-day wall duration', () => {
    const draft = draftFromEvent(event());
    applyRelativeResult(draft, { ok: true, date: '2026-09-10', time: '08:00' });
    expect(draft).toMatchObject({ start_date: '2026-09-10', start_time: '08:00', end_date: '2026-09-11', end_time: '09:45' });
  });

  it('an explicit 23:30 time converts all-day to a one-hour overnight draft', () => {
    const draft = draftFromEvent(event({ start: '2026-08-20', end: '2026-08-23', is_all_day: true, start_tzid: null, end_tzid: null }));
    applyRelativeResult(draft, { ok: true, date: '2026-12-31', time: '23:30' });
    expect(draft).toMatchObject({ is_all_day: false, start_date: '2026-12-31', start_time: '23:30', end_date: '2027-01-01', end_time: '00:30' });
  });

  it('serializes changed inclusive all-day ranges across leap and year boundaries', () => {
    const draft = draftFromEvent(event());
    draft.is_all_day = true; draft.start_date = '2028-02-29'; draft.end_date = '2028-03-01';
    const leap = inputFromDraft(draft);
    expect(leap).toMatchObject({ start: '2028-02-29', end: '2028-03-02' });
    expect('tzid' in leap).toBe(false);
    draft.start_date = '2026-12-31'; draft.end_date = '2027-01-01';
    expect(inputFromDraft(draft)).toMatchObject({ start: '2026-12-31', end: '2027-01-02' });
  });

  it('retains prior times across timed to all-day to timed toggles and keeps TZID', () => {
    const draft = draftFromEvent(event());
    draft.is_all_day = true;
    expect(inputFromDraft(draft).tzid).toBeUndefined();
    draft.is_all_day = false;
    expect(inputFromDraft(draft)).toMatchObject({ start: event().start, end: event().end, tzid: 'America/Sao_Paulo' });
  });

  it('validates malformed, zero/backwards, overnight, and later-date intervals', () => {
    const draft = draftFromEvent(event());
    draft.start_date = draft.end_date = '2026-08-20'; draft.start_time = draft.end_time = '09:00';
    expect(isValidEventEditDraft(draft)).toBe(false);
    draft.end_time = 'bad'; expect(isValidEventEditDraft(draft)).toBe(false);
    draft.end_time = '10:00'; expect(isValidEventEditDraft(draft)).toBe(true);
    draft.start_time = '23:30'; draft.end_time = '01:00'; expect(isValidEventEditDraft(draft)).toBe(false);
    draft.end_date = '2026-08-21'; expect(isValidEventEditDraft(draft)).toBe(true);
  });

  it('detects either exact endpoint changing once as Date, including same-minute seconds', () => {
    const draft = draftFromEvent(event());
    expect(changedEditableFields(draft, event({ end: '2026-08-22T01:15:18' }))).toEqual(['date']);
    expect(changedEditableFields(draft, event({ title: 'Latest', start: '2026-08-20T23:31:17', location: 'Room B' })))
      .toEqual(['title', 'date', 'location']);
  });

  it('renders the shared When contract with no native date input and preserves Description Enter', () => {
    const target = document.createElement('div'); document.body.appendChild(target);
    const options = renderOptions();
    renderEventEditor(target, detail(), draftFromEvent(event()), options);
    expect(target.querySelector('input[type="date"]')).toBeNull();
    expect(target.querySelector('[data-controller="calendar"][data-calendar-mode-value="range"]')).not.toBeNull();
    expect(target.querySelector('.calendar-widget__commit-btn')).toBeNull();
    expect(target.querySelector('[name="start_time"]')?.getAttribute('type')).toBe('text');
    const description = target.querySelector<HTMLTextAreaElement>('[name="description"]')!;
    description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(options.onSave).not.toHaveBeenCalled();
  });

  it('normalizes compact clocks on blur and submit in event detail', () => {
    const target = document.createElement('div'); document.body.appendChild(target);
    const draft = draftFromEvent(event());
    const options = renderOptions();
    renderEventEditor(target, detail(), draft, options);
    const start = target.querySelector<HTMLInputElement>('[name="start_time"]')!;
    const end = target.querySelector<HTMLInputElement>('[name="end_time"]')!;
    start.value = '16';
    start.dispatchEvent(new Event('blur'));
    expect(start.value).toBe('16:00');
    end.value = '1730';

    target.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(options.onSave).toHaveBeenCalledOnce();
    expect(draft).toMatchObject({ start_time: '16:00', end_time: '17:30' });
  });

  it('shows localized invalid relative guidance without mutating the valid draft', () => {
    const target = document.createElement('div'); document.body.appendChild(target);
    const draft = draftFromEvent(event()); const options = renderOptions();
    const before = { start: draft.start_date, end: draft.end_date, startTime: draft.start_time, endTime: draft.end_time };
    renderEventEditor(target, detail(), draft, options);
    const relative = target.querySelector<HTMLInputElement>('[name="relative_when"]')!;
    relative.value = 'sometime soon'; relative.dispatchEvent(new Event('input'));
    target.querySelector<HTMLButtonElement>('.event-when__use')!.click();
    expect(target.querySelector('.event-when__preview')?.textContent).toContain('Use today');
    expect({ start: draft.start_date, end: draft.end_date, startTime: draft.start_time, endTime: draft.end_time }).toEqual(before);
    expect(options.onDraftChange).not.toHaveBeenCalled();
  });
});
