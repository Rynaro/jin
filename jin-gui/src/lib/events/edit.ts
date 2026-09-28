/**
 * Legacy event-edit surface — **migration-only** as of S2.
 *
 * The pure draft model that used to live here (`EventEditDraft`,
 * `EventEditInput`, `draftFromEvent`, `inputFromDraft`) has been extracted and
 * generalized into `./draft.ts`, which is where new work belongs. The exports
 * below are kept verbatim so the controllers still consuming them keep working
 * unchanged; S7 migrates those surfaces and this file's model half then goes
 * away.
 *
 * The one thing the legacy model cannot express is an event whose endpoints
 * live in different timezones: `EventEditDraft` has a single `timezone` field.
 * `toEventDraft` below is the bridge, and it takes the original `EventDto` so
 * the true end zone is recovered rather than guessed.
 */

import type { EventDetailDto, EventDto } from '../../types/dto';
import type { CalendarSelection } from '../../controllers/calendar_controller';
import type { EventDraft } from './draft';
import { draftFromEvent as eventDraftFromEvent } from './draft';
import { addDays, parseIso } from '../calendar/transform';
import { normalizeClockInput } from '../calendar/clock';
import { formatNaturalDateResult, naturalDateErrorMessage, parseNaturalDateTime, type NaturalDateErrorCode, type NaturalDateResult } from '../calendar/natural_language';
import { eventMessage, type EventLocaleKey } from './locale';
import type { RecurrenceDraft } from '../../invoke';
import { recurrenceDraftFromRrule } from './recurrence';

export interface EventTemporalProjection {
  start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string;
}
export interface EventTemporalBaseline extends EventTemporalProjection {
  start: string; end: string; tzid?: string; floating: boolean;
}
export interface EventEditDraft extends EventTemporalProjection {
  title: string; location: string; description: string; baseline: EventTemporalBaseline;
  timezone: string;
  range_complete: boolean; relative_input: string;
  recurrence_scope: 'this_occurrence' | 'entire_series';
  guest_update_policy: 'all' | 'external_only' | 'none';
  recurrence?: RecurrenceDraft;
  clear_recurrence: boolean;
  recurrence_changed: boolean;
  relative_result: Extract<NaturalDateResult, { ok: true }> | null;
  relative_error: NaturalDateErrorCode | null;
}
export interface EventEditInput {
  title: string; start: string; end: string; tzid?: string; is_all_day: boolean;
  location?: string; description?: string;
  recurrence?: RecurrenceDraft;
  clear_recurrence?: boolean;
}

function eventProjection(event: EventDto): EventTemporalProjection {
  return {
    start_date: event.start.slice(0, 10),
    end_date: event.is_all_day ? addDays(event.end.slice(0, 10), -1) : event.end.slice(0, 10),
    is_all_day: event.is_all_day,
    start_time: event.start.includes('T') ? event.start.split('T')[1].slice(0, 5) : '09:00',
    end_time: event.end.includes('T') ? event.end.split('T')[1].slice(0, 5) : '10:00',
  };
}

export function draftFromEvent(event: EventDto): EventEditDraft {
  const projection = eventProjection(event);
  return {
    title: event.title, ...projection, location: event.location ?? '', description: event.description ?? '', timezone: event.start_tzid ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    baseline: { ...projection, start: event.start, end: event.end, tzid: event.start_tzid ?? undefined, floating: event.floating },
    range_complete: true, relative_input: '', recurrence_scope: 'this_occurrence', guest_update_policy: 'all', recurrence: recurrenceDraftFromRrule(event.recurrence ?? []), clear_recurrence: false, recurrence_changed: false, relative_result: null, relative_error: null,
  };
}

function projectionMatchesBaseline(draft: EventEditDraft): boolean {
  const b = draft.baseline;
  return draft.start_date === b.start_date && draft.end_date === b.end_date
    && draft.is_all_day === b.is_all_day && draft.start_time === b.start_time && draft.end_time === b.end_time
    && (draft.is_all_day || draft.timezone === (b.tzid ?? ''));
}

export function inputFromDraft(draft: EventEditDraft, _original?: EventDto): EventEditInput {
  const location = draft.location === '' ? undefined : draft.location;
  const description = draft.description === '' ? undefined : draft.description;
  if (projectionMatchesBaseline(draft)) {
    return { title: draft.title.trim(), start: draft.baseline.start, end: draft.baseline.end,
      tzid: draft.baseline.is_all_day ? undefined : draft.timezone || undefined,
      is_all_day: draft.is_all_day, location, description, recurrence: draft.recurrence_changed && !draft.clear_recurrence ? draft.recurrence : undefined, clear_recurrence: draft.recurrence_changed && draft.clear_recurrence };
  }
  if (draft.is_all_day) {
    return { title: draft.title.trim(), start: draft.start_date, end: addDays(draft.end_date, 1),
      is_all_day: true, location, description, recurrence: draft.recurrence_changed && !draft.clear_recurrence ? draft.recurrence : undefined, clear_recurrence: draft.recurrence_changed && draft.clear_recurrence };
  }
  return { title: draft.title.trim(), start: `${draft.start_date}T${draft.start_time}:00`,
    end: `${draft.end_date}T${draft.end_time}:00`, tzid: draft.timezone || undefined,
    is_all_day: false, location, description, recurrence: draft.recurrence_changed && !draft.clear_recurrence ? draft.recurrence : undefined, clear_recurrence: draft.recurrence_changed && draft.clear_recurrence };
}

/**
 * Bridge a legacy `EventEditDraft` onto the shared `EventDraft` model.
 *
 * Pass the `EventDto` the legacy draft came from whenever it is available: the
 * legacy shape carries one `timezone`, so without the original event a distinct
 * end zone cannot be recovered and would be flattened onto the start zone —
 * precisely the data loss S2 exists to stop.
 */
export function toEventDraft(
  legacy: EventEditDraft,
  origin?: { event: EventDto; edit_token?: string },
): EventDraft {
  const draft: EventDraft = origin
    ? eventDraftFromEvent(origin.event, origin.edit_token)
    : {
        event_id: null,
        edit_token: null,
        title: legacy.title,
        location: legacy.location,
        description: legacy.description,
        temporal: {
          start_date: legacy.start_date,
          end_date: legacy.end_date,
          start_time: legacy.start_time,
          end_time: legacy.end_time,
          is_all_day: legacy.is_all_day,
          floating: legacy.baseline.floating,
          timezone: legacy.timezone,
          end_timezone: legacy.timezone,
        },
        baseline: null,
        recurrence_scope: legacy.recurrence_scope,
        recurrence: legacy.recurrence,
        clear_recurrence: legacy.clear_recurrence,
        recurrence_changed: legacy.recurrence_changed,
        guest_update_policy: legacy.guest_update_policy,
        conference_intent: { kind: 'preserve' },
        relative_input: legacy.relative_input,
        range_complete: legacy.range_complete,
      };

  // Overlay the live legacy values on top of the reconstructed draft.
  draft.title = legacy.title;
  draft.location = legacy.location;
  draft.description = legacy.description;
  draft.temporal.start_date = legacy.start_date;
  draft.temporal.end_date = legacy.end_date;
  draft.temporal.start_time = legacy.start_time;
  draft.temporal.end_time = legacy.end_time;
  draft.temporal.is_all_day = legacy.is_all_day;
  if (draft.temporal.timezone !== legacy.timezone) {
    // The user changed the zone in the legacy editor, which pre-S2 meant both
    // endpoints move. Honour that intent explicitly rather than silently.
    draft.temporal.timezone = legacy.timezone;
    draft.temporal.end_timezone = legacy.timezone;
  }
  draft.recurrence_scope = legacy.recurrence_scope;
  draft.recurrence = legacy.recurrence;
  draft.clear_recurrence = legacy.clear_recurrence;
  draft.recurrence_changed = legacy.recurrence_changed;
  draft.guest_update_policy = legacy.guest_update_policy;
  draft.relative_input = legacy.relative_input;
  draft.range_complete = legacy.range_complete;
  return draft;
}

function wallDayNumber(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}
function daysBetween(from: string, to: string): number { return wallDayNumber(to) - wallDayNumber(from); }
function clockMinutes(value: string): number { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function addWallMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = clockMinutes(time) + minutes;
  const dayDelta = Math.floor(total / 1440);
  const minute = ((total % 1440) + 1440) % 1440;
  return { date: addDays(date, dayDelta), time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` };
}

export function applyCalendarSelection(draft: EventEditDraft, selection: CalendarSelection): void {
  if (selection.mode !== 'range') return;
  draft.start_date = selection.start; draft.end_date = selection.end; draft.range_complete = selection.complete;
}

export function applyRelativeResult(draft: EventEditDraft, result: Extract<NaturalDateResult, { ok: true }>): void {
  if (!result.time) {
    const delta = daysBetween(draft.start_date, result.date);
    draft.start_date = result.date; draft.end_date = addDays(draft.end_date, delta); draft.range_complete = true;
    return;
  }
  if (draft.is_all_day) {
    const end = addWallMinutes(result.date, result.time, 60);
    draft.start_date = result.date; draft.start_time = result.time; draft.end_date = end.date; draft.end_time = end.time;
    draft.is_all_day = false; draft.range_complete = end.date !== result.date;
    return;
  }
  const duration = daysBetween(draft.start_date, draft.end_date) * 1440 + clockMinutes(draft.end_time) - clockMinutes(draft.start_time);
  const end = addWallMinutes(result.date, result.time, duration);
  draft.start_date = result.date; draft.start_time = result.time; draft.end_date = end.date; draft.end_time = end.time;
  draft.range_complete = end.date !== result.date;
}

export function isValidEventEditDraft(draft: EventEditDraft): boolean {
  if (!draft.title.trim() || !draft.start_date || !draft.end_date) return false;
  if (draft.is_all_day) return draft.end_date >= draft.start_date;
  const start = normalizeClockInput(draft.start_time);
  const end = normalizeClockInput(draft.end_time);
  if (!start.ok || !start.time || !end.ok || !end.time) return false;
  return `${draft.end_date}T${end.time}` > `${draft.start_date}T${start.time}`;
}

export function changedEditableFields(draft: EventEditDraft, latest: EventDto): Array<'title' | 'date' | 'location' | 'description'> {
  const composed = inputFromDraft(draft);
  const changed: Array<'title' | 'date' | 'location' | 'description'> = [];
  if (composed.title !== latest.title) changed.push('title');
  if (composed.start !== latest.start || composed.end !== latest.end || composed.is_all_day !== latest.is_all_day
    || (composed.tzid ?? null) !== (latest.start_tzid ?? null)) changed.push('date');
  if ((composed.location ?? null) !== (latest.location ?? null)) changed.push('location');
  if ((composed.description ?? null) !== (latest.description ?? null)) changed.push('description');
  return changed;
}

interface RenderOptions {
  locale: EventLocaleKey; today: string; pending: boolean; message?: string; latest?: EventDetailDto; focusTitle?: boolean;
  onDraftChange: (draft: EventEditDraft) => void; onSave: (draft: EventEditDraft) => void; onCancel: () => void;
  onUseLatest: () => void; onReviewDraft: () => void;
}
function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement('label'); wrapper.className = 'event-edit__field';
  const text = document.createElement('span'); text.className = 'event-edit__label'; text.textContent = label;
  wrapper.append(text, control); return wrapper;
}
function rangeSummary(draft: EventEditDraft, locale: EventLocaleKey): string {
  if (!draft.start_date) return eventMessage('chooseAtLeastOneDay', locale);
  const format = (iso: string): string => { const { year, month, day } = parseIso(iso); return new Intl.DateTimeFormat(locale,
    { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day)); };
  return draft.end_date && draft.end_date !== draft.start_date ? `${format(draft.start_date)} – ${format(draft.end_date)}` : format(draft.start_date);
}
function calendarLabels(locale: EventLocaleKey): Record<string, string> {
  return { today: eventMessage('today', locale), clear: eventMessage('clear', locale), commit: eventMessage('useDates', locale),
    chooseDate: eventMessage('chooseDate', locale), previousMonth: eventMessage('previousMonth', locale), nextMonth: eventMessage('nextMonth', locale),
    previousYear: eventMessage('previousYear', locale), nextYear: eventMessage('nextYear', locale) };
}

export function renderEventEditor(target: HTMLElement, detail: EventDetailDto, draft: EventEditDraft, options: RenderOptions): void {
  const active = document.activeElement as HTMLElement | null;
  const restoreName = active && target.contains(active) ? active.getAttribute('name') : null;
  const restoreIso = active && target.contains(active) ? active.dataset.iso : undefined;
  target.innerHTML = '';
  const { locale } = options;
  const article = document.createElement('article'); article.className = 'event-detail event-detail--editing';
  article.setAttribute('aria-label', eventMessage('editEvent', locale));
  const form = document.createElement('form'); form.className = 'event-edit'; form.noValidate = true;
  const header = document.createElement('header'); header.className = 'event-detail__header event-edit__header';
  const heading = document.createElement('h2'); heading.className = 'text-title2'; heading.textContent = eventMessage('editEvent', locale);
  const actions = document.createElement('div'); actions.className = 'event-detail__header-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary';
  cancel.textContent = eventMessage('cancel', locale); cancel.disabled = options.pending; cancel.addEventListener('click', options.onCancel);
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn-primary event-edit__save';
  save.textContent = options.pending ? eventMessage('saving', locale) : eventMessage('save', locale); save.disabled = options.pending;
  actions.append(cancel, save); header.append(heading, actions); form.appendChild(header);

  const identity = document.createElement('div'); identity.className = 'browse-detail__meta';
  const source = document.createElement('span'); source.className = 'event-detail__source-badge jin-badge'; source.dataset.source = detail.event.source.toLowerCase();
  source.textContent = detail.event.sync_context?.provider === 'google'
    ? `${eventMessage('googleDestination', locale)} · ${detail.event.sync_context.calendar_name}`
    : detail.event.source.toLowerCase() === 'google' ? eventMessage('sourceGoogle', locale) : eventMessage('sourceJin', locale);
  if (detail.event.sync_context?.provider === 'google') source.dataset.source = 'google';
  identity.appendChild(source);
  if (detail.capabilities.display_kind === 'time-block') { const kind = document.createElement('span'); kind.className = 'event-detail__kind-badge jin-badge';
    kind.textContent = eventMessage('timeBlock', locale); identity.appendChild(kind); }
  form.appendChild(identity);

  const title = document.createElement('input'); title.name = 'title'; title.value = draft.title; title.required = true; title.autocomplete = 'off';
  title.className = 'form-input event-edit__title'; title.setAttribute('aria-describedby', 'event-edit-feedback');
  title.addEventListener('input', () => { draft.title = title.value; }); form.appendChild(field(eventMessage('title', locale), title));

  const recurring = (detail.event.recurrence?.length ?? 0) > 0 || Boolean(
    detail.event.recurring_event_id || detail.event.original_start || detail.event.master_id || detail.event.recurrence_unexpanded,
  );
  if (recurring) {
    const recurrenceDetails = document.createElement('details'); recurrenceDetails.className = 'event-edit__disclosure event-options';
    const recurrenceSummary = document.createElement('summary'); recurrenceSummary.textContent = 'Repeat & series'; recurrenceDetails.appendChild(recurrenceSummary);
    const recurrenceBody = document.createElement('div'); recurrenceBody.className = 'event-edit__disclosure-body'; recurrenceDetails.appendChild(recurrenceBody);
    const scope = document.createElement('select');
    scope.name = 'recurrence_scope';
    scope.className = 'form-input';
    scope.append(
      new Option(eventMessage('thisOccurrence', locale), 'this_occurrence'),
      new Option(eventMessage('entireSeries', locale), 'entire_series'),
    );
    scope.value = draft.recurrence_scope;
    scope.addEventListener('change', () => { draft.recurrence_scope = scope.value as EventEditDraft['recurrence_scope']; });
    recurrenceBody.appendChild(field(eventMessage('recurrenceScope', locale), scope));
    if (detail.capabilities.recurrence_pattern_supported) {
      const repeat = document.createElement('select');
      repeat.name = 'recurrence'; repeat.className = 'form-input';
      repeat.append(
        new Option('Keep current pattern', 'preserve'),
        new Option('Does not repeat', 'none'),
        new Option('Daily', 'daily'),
        new Option('Weekly', 'weekly'),
        new Option('Monthly', 'monthly'),
        new Option('Yearly', 'yearly'),
      );
      // "Keep current" means no provider mutation; the adjacent controls
      // still mirror the supported baseline and become a replacement only
      // after the user changes one of them.
      repeat.value = draft.recurrence?.frequency ?? 'preserve';
      repeat.addEventListener('change', () => {
        const value = repeat.value;
        draft.recurrence_changed = value !== 'preserve';
        draft.clear_recurrence = value === 'none';
        draft.recurrence = value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'
          ? { frequency: value, interval: 1, weekly_days: [], end: { kind: 'never' } }
          : undefined;
        if (value !== 'preserve') draft.recurrence_scope = 'entire_series';
        options.onDraftChange(draft);
      });
      recurrenceBody.appendChild(field('Repeat', repeat));
      const optionsRow = document.createElement('div'); optionsRow.className = 'event-edit__recurrence-options';
      const interval = document.createElement('input'); interval.type = 'number'; interval.min = '1'; interval.max = '999'; interval.name = 'recurrence_interval';
      interval.className = 'form-input'; interval.value = String(draft.recurrence?.interval ?? 1);
      interval.addEventListener('input', () => {
        if (!draft.recurrence) return;
        draft.recurrence_changed = true;
        draft.recurrence.interval = Math.max(1, Number(interval.value) || 1);
      });
      optionsRow.appendChild(field('Every', interval));
      const weekdays = document.createElement('div'); weekdays.className = 'event-edit__weekdays'; weekdays.setAttribute('role', 'group'); weekdays.setAttribute('aria-label', 'Repeat on days');
      const dayValues = [['mo', 'Mon'], ['tu', 'Tue'], ['we', 'Wed'], ['th', 'Thu'], ['fr', 'Fri'], ['sa', 'Sat'], ['su', 'Sun']] as const;
      for (const [value, label] of dayValues) {
        const check = document.createElement('input'); check.type = 'checkbox'; check.value = value; check.checked = draft.recurrence?.weekly_days.includes(value) ?? false;
        check.addEventListener('change', () => {
          if (!draft.recurrence) return;
          draft.recurrence_changed = true;
          draft.recurrence.weekly_days = Array.from(weekdays.querySelectorAll<HTMLInputElement>('input:checked'), input => input.value as typeof value);
        });
        const day = document.createElement('label'); day.className = 'jin-checkbox';
        const mark = document.createElement('span'); mark.className = 'jin-checkbox__mark'; mark.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.textContent = label;
        day.append(check, mark, text); weekdays.appendChild(day);
      }
      if (draft.recurrence?.frequency === 'weekly') optionsRow.appendChild(weekdays);
      const ending = document.createElement('select'); ending.name = 'recurrence_end'; ending.className = 'form-input';
      ending.append(new Option('Never ends', 'never'), new Option('After a number of occurrences', 'count'), new Option('On a date', 'until'));
      ending.value = draft.recurrence?.end.kind ?? 'never';
      const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.max = '999'; count.name = 'recurrence_count';
      count.className = 'form-input'; count.value = String(draft.recurrence?.end.kind === 'count' ? draft.recurrence.end.count : 10);
      const until = document.createElement('input'); until.type = 'date'; until.name = 'recurrence_until'; until.className = 'form-input';
      until.value = draft.recurrence?.end.kind === 'until' ? draft.recurrence.end.date : '';
      const syncEnd = (): void => {
        if (!draft.recurrence) return;
        draft.recurrence_changed = true;
        draft.recurrence.end = ending.value === 'count'
          ? { kind: 'count', count: Math.max(1, Number(count.value) || 1) }
          : ending.value === 'until' && until.value
            ? { kind: 'until', date: until.value }
            : { kind: 'never' };
      };
      ending.addEventListener('change', () => {
        syncEnd();
        options.onDraftChange(draft);
      });
      count.addEventListener('input', syncEnd); until.addEventListener('change', syncEnd);
      optionsRow.appendChild(field('Ends', ending));
      if (ending.value === 'count') optionsRow.appendChild(field('Occurrences', count));
      if (ending.value === 'until') optionsRow.appendChild(field('Until', until));
      recurrenceBody.appendChild(optionsRow);
    }
    form.appendChild(recurrenceDetails);
  }

  if (detail.capabilities.collaboration?.can_edit_schedule) {
    const updates = document.createElement('select');
    updates.name = 'guest_update_policy';
    updates.className = 'form-input';
    updates.append(
      new Option('All guests', 'all'),
      new Option('External guests only', 'external_only'),
      new Option('Do not notify guests', 'none'),
    );
    updates.value = draft.guest_update_policy;
    updates.addEventListener('change', () => {
      const value = updates.value;
      draft.guest_update_policy = value === 'external_only' || value === 'none' ? value : 'all';
    });
    form.appendChild(field('Notify guests', updates));
  }

  const whenDetails = document.createElement('details'); whenDetails.className = 'event-edit__disclosure event-options event-edit__when-disclosure event-when__calendar-disclosure';
  const whenSummary = document.createElement('summary'); whenSummary.className = 'event-when__summary'; whenSummary.textContent = rangeSummary(draft, locale); whenDetails.appendChild(whenSummary);
  const whenBody = document.createElement('div'); whenBody.className = 'event-edit__disclosure-body'; whenDetails.appendChild(whenBody);
  const when = document.createElement('fieldset'); when.className = 'event-when event-edit__when';
  const legend = document.createElement('legend'); legend.className = 'event-edit__label'; legend.textContent = eventMessage('when', locale); when.appendChild(legend);
  const relativeLabel = document.createElement('label'); relativeLabel.className = 'event-edit__label'; relativeLabel.htmlFor = 'event-edit-when-natural';
  relativeLabel.textContent = eventMessage('dateTime', locale); when.appendChild(relativeLabel);
  const quickRow = document.createElement('div'); quickRow.className = 'event-when__quick-row';
  const relative = document.createElement('input'); relative.id = 'event-edit-when-natural'; relative.name = 'relative_when'; relative.type = 'text';
  relative.className = 'form-input event-when__natural'; relative.autocomplete = 'off'; relative.placeholder = eventMessage('relativePlaceholder', locale);
  relative.value = draft.relative_input; relative.setAttribute('aria-describedby', 'event-edit-when-preview event-edit-when-summary');
  const use = document.createElement('button'); use.type = 'button'; use.className = 'btn-secondary event-when__use'; use.textContent = eventMessage('use', locale);
  quickRow.append(relative, use); when.appendChild(quickRow);
  const preview = document.createElement('p'); preview.id = 'event-edit-when-preview'; preview.className = 'event-when__preview'; preview.setAttribute('aria-live', 'polite');
  if (draft.relative_result) { preview.textContent = formatNaturalDateResult(draft.relative_result, locale); preview.dataset.state = 'valid'; }
  else if (draft.relative_error) { preview.textContent = naturalDateErrorMessage(draft.relative_error, locale); preview.dataset.state = 'error'; }
  else preview.textContent = eventMessage('relativeHint', locale);
  when.appendChild(preview);
  const calendar = document.createElement('div'); calendar.className = 'event-when__calendar event-edit__calendar'; calendar.dataset.controller = 'calendar';
  calendar.dataset.calendarModeValue = 'range'; calendar.dataset.calendarRangeStartValue = draft.start_date;
  calendar.dataset.calendarRangeEndValue = draft.end_date; calendar.dataset.calendarRangeCompleteValue = String(draft.range_complete);
  calendar.dataset.calendarLocaleValue = locale; calendar.dataset.calendarLabelsValue = JSON.stringify(calendarLabels(locale));
  calendar.addEventListener('calendar:change', event => { applyCalendarSelection(draft, (event as CustomEvent<CalendarSelection>).detail); options.onDraftChange(draft); });
  when.appendChild(calendar);
  const summary = document.createElement('p'); summary.id = 'event-edit-when-summary'; summary.className = 'event-when__summary'; summary.setAttribute('aria-live', 'polite');
  summary.textContent = rangeSummary(draft, locale); when.appendChild(summary);
  const allDay = document.createElement('input'); allDay.type = 'checkbox'; allDay.name = 'all_day'; allDay.checked = draft.is_all_day;
  const allDayField = document.createElement('label'); allDayField.className = 'jin-checkbox event-edit__all-day';
  const allDayMark = document.createElement('span'); allDayMark.className = 'jin-checkbox__mark'; allDayMark.setAttribute('aria-hidden', 'true');
  const allDayText = document.createElement('span'); allDayText.textContent = eventMessage('allDay', locale);
  allDayField.append(allDay, allDayMark, allDayText); when.appendChild(allDayField);
  const times = document.createElement('div'); times.className = `event-edit__row event-edit__times${draft.is_all_day ? ' hidden' : ''}`;
  const start = document.createElement('input'); start.type = 'text'; start.inputMode = 'numeric'; start.name = 'start_time'; start.value = draft.start_time;
  start.placeholder = '09:00'; start.className = 'form-input'; start.setAttribute('aria-describedby', 'event-edit-feedback');
  const end = document.createElement('input'); end.type = 'text'; end.inputMode = 'numeric'; end.name = 'end_time'; end.value = draft.end_time;
  end.placeholder = '10:00'; end.className = 'form-input'; end.setAttribute('aria-describedby', 'event-edit-feedback');
  start.addEventListener('input', () => { draft.start_time = start.value; }); end.addEventListener('input', () => { draft.end_time = end.value; });
  const normalizeTime = (input: HTMLInputElement, key: 'start_time' | 'end_time'): void => {
    const normalized = normalizeClockInput(input.value);
    if (!normalized.ok || !normalized.time) return;
    input.value = normalized.time;
    draft[key] = normalized.time;
  };
  start.addEventListener('blur', () => normalizeTime(start, 'start_time'));
  end.addEventListener('blur', () => normalizeTime(end, 'end_time'));
  times.append(field(eventMessage('startTime', locale), start), field(eventMessage('endTime', locale), end)); when.appendChild(times); whenBody.appendChild(when); form.appendChild(whenDetails);
  const timezone = document.createElement('input'); timezone.type = 'text'; timezone.name = 'timezone'; timezone.className = 'form-input'; timezone.value = draft.timezone;
  timezone.autocomplete = 'off'; timezone.spellcheck = false; timezone.setAttribute('aria-describedby', 'event-edit-feedback');
  timezone.addEventListener('input', () => { draft.timezone = timezone.value; });
  const timezoneField = field('Time zone', timezone); timezoneField.classList.add('event-edit__timezone');
  if (draft.is_all_day) timezoneField.classList.add('hidden');
  whenBody.appendChild(timezoneField);
  // Keep the concise date line and clocks in view. The disclosure contains
  // the natural-language helper and calendar grid, which are useful on demand.
  whenDetails.after(allDayField, times, timezoneField);
  const recurrenceDisclosure = form.querySelector<HTMLDetailsElement>('details.event-edit__disclosure:not(.event-edit__when-disclosure)');
  if (recurrenceDisclosure) timezoneField.after(recurrenceDisclosure);
  allDay.addEventListener('change', () => { draft.is_all_day = allDay.checked; options.onDraftChange(draft); });

  const previewInput = (): void => {
    draft.relative_input = relative.value;
    const result = parseNaturalDateTime({ input: relative.value, today: options.today, locale });
    if (result.ok) { draft.relative_result = result; draft.relative_error = null; preview.textContent = formatNaturalDateResult(result, locale); preview.dataset.state = 'valid'; }
    else { draft.relative_result = null; draft.relative_error = result.code; preview.textContent = naturalDateErrorMessage(result.code, locale); preview.dataset.state = 'error'; }
  };
  relative.addEventListener('input', previewInput);
  const applyRelative = (event?: Event): void => { event?.preventDefault(); previewInput(); if (!draft.relative_result) return;
    applyRelativeResult(draft, draft.relative_result); options.onDraftChange(draft); };
  use.addEventListener('click', applyRelative); relative.addEventListener('keydown', event => { if (event.key === 'Enter') applyRelative(event); });

  const extraDetails = document.createElement('details'); extraDetails.className = 'event-edit__disclosure event-options';
  const extraSummary = document.createElement('summary'); extraSummary.textContent = 'Location & notes'; extraDetails.appendChild(extraSummary);
  const extraBody = document.createElement('div'); extraBody.className = 'event-edit__disclosure-body'; extraDetails.appendChild(extraBody);
  const location = document.createElement('input'); location.name = 'location'; location.value = draft.location; location.className = 'form-input';
  location.addEventListener('input', () => { draft.location = location.value; }); extraBody.appendChild(field(eventMessage('location', locale), location));
  const description = document.createElement('textarea'); description.name = 'description'; description.value = draft.description; description.className = 'form-textarea';
  description.rows = 5; description.addEventListener('input', () => { draft.description = description.value; }); extraBody.appendChild(field(eventMessage('description', locale), description)); form.appendChild(extraDetails);
  if (detail.capabilities.originating_task) { const linkage = document.createElement('p'); linkage.className = 'event-edit__linkage';
    linkage.textContent = `${eventMessage('originTask', locale)}: ${detail.capabilities.originating_task.title}`; form.appendChild(linkage); }
  const feedback = document.createElement('div'); feedback.id = 'event-edit-feedback'; feedback.className = `event-edit__feedback${options.message ? '' : ' hidden'}`;
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.textContent = options.message ?? ''; form.appendChild(feedback);
  if (options.latest) {
    const conflict = document.createElement('section'); conflict.className = 'event-edit__conflict';
    const conflictTitle = document.createElement('h3'); conflictTitle.textContent = eventMessage('eventChanged', locale);
    const changed = changedEditableFields(draft, options.latest.event); const copy = document.createElement('p');
    copy.textContent = changed.length ? `${eventMessage('changedFields', locale)}: ${changed.map(key => eventMessage(key, locale)).join(', ')}.` : eventMessage('eventChangedCopy', locale);
    const conflictActions = document.createElement('div'); conflictActions.className = 'event-edit__conflict-actions';
    const useLatest = document.createElement('button'); useLatest.type = 'button'; useLatest.className = 'btn-secondary'; useLatest.textContent = eventMessage('useLatest', locale);
    useLatest.addEventListener('click', options.onUseLatest); const review = document.createElement('button'); review.type = 'button'; review.className = 'btn-secondary';
    review.textContent = eventMessage('reviewDraft', locale); review.addEventListener('click', options.onReviewDraft);
    conflictActions.append(useLatest, review); conflict.append(conflictTitle, copy, conflictActions); form.appendChild(conflict);
  }
  const syncControls = (): void => { draft.title = title.value; draft.relative_input = relative.value; draft.is_all_day = allDay.checked;
    normalizeTime(start, 'start_time'); normalizeTime(end, 'end_time');
    draft.start_time = start.value; draft.end_time = end.value; draft.location = location.value; draft.description = description.value; };
  form.addEventListener('submit', event => { event.preventDefault(); syncControls(); if (!options.pending) options.onSave(draft); });
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!options.pending) options.onCancel(); }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); syncControls(); if (!options.pending) options.onSave(draft); }
  });
  article.appendChild(form); target.appendChild(article);
  const restoreFocus = (): void => {
    if (options.focusTitle) title.focus();
    else if (restoreIso) target.querySelector<HTMLButtonElement>(`button[data-iso="${restoreIso}"]`)?.focus();
    else if (restoreName) target.querySelector<HTMLElement>(`[name="${restoreName}"]`)?.focus();
  };
  queueMicrotask(() => { queueMicrotask(restoreFocus); });
}
