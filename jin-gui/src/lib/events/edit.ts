import type { EventDetailDto, EventDto } from '../../types/dto';
import type { CalendarSelection } from '../../controllers/calendar_controller';
import { addDays, parseIso } from '../calendar/transform';
import { normalizeClockInput } from '../calendar/clock';
import { formatNaturalDateResult, naturalDateErrorMessage, parseNaturalDateTime, type NaturalDateErrorCode, type NaturalDateResult } from '../calendar/natural_language';
import { eventMessage, type EventLocaleKey } from './locale';

export interface EventTemporalProjection {
  start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string;
}
export interface EventTemporalBaseline extends EventTemporalProjection {
  start: string; end: string; tzid?: string; floating: boolean;
}
export interface EventEditDraft extends EventTemporalProjection {
  title: string; location: string; description: string; baseline: EventTemporalBaseline;
  range_complete: boolean; relative_input: string;
  recurrence_scope: 'this_occurrence' | 'entire_series';
  relative_result: Extract<NaturalDateResult, { ok: true }> | null;
  relative_error: NaturalDateErrorCode | null;
}
export interface EventEditInput {
  title: string; start: string; end: string; tzid?: string; is_all_day: boolean;
  location?: string; description?: string;
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
    title: event.title, ...projection, location: event.location ?? '', description: event.description ?? '',
    baseline: { ...projection, start: event.start, end: event.end, tzid: event.start_tzid ?? undefined, floating: event.floating },
    range_complete: true, relative_input: '', recurrence_scope: 'this_occurrence', relative_result: null, relative_error: null,
  };
}

function projectionMatchesBaseline(draft: EventEditDraft): boolean {
  const b = draft.baseline;
  return draft.start_date === b.start_date && draft.end_date === b.end_date
    && draft.is_all_day === b.is_all_day && draft.start_time === b.start_time && draft.end_time === b.end_time;
}

export function inputFromDraft(draft: EventEditDraft, _original?: EventDto): EventEditInput {
  const location = draft.location === '' ? undefined : draft.location;
  const description = draft.description === '' ? undefined : draft.description;
  if (projectionMatchesBaseline(draft)) {
    return { title: draft.title.trim(), start: draft.baseline.start, end: draft.baseline.end,
      tzid: draft.baseline.is_all_day ? undefined : draft.baseline.tzid,
      is_all_day: draft.is_all_day, location, description };
  }
  if (draft.is_all_day) {
    return { title: draft.title.trim(), start: draft.start_date, end: addDays(draft.end_date, 1),
      is_all_day: true, location, description };
  }
  return { title: draft.title.trim(), start: `${draft.start_date}T${draft.start_time}:00`,
    end: `${draft.end_date}T${draft.end_time}:00`, tzid: draft.baseline.tzid,
    is_all_day: false, location, description };
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
  source.textContent = detail.event.source.toLowerCase() === 'google' ? eventMessage('sourceGoogle', locale) : eventMessage('sourceJin', locale);
  identity.appendChild(source);
  if (detail.capabilities.display_kind === 'time-block') { const kind = document.createElement('span'); kind.className = 'event-detail__kind-badge jin-badge';
    kind.textContent = eventMessage('timeBlock', locale); identity.appendChild(kind); }
  form.appendChild(identity);

  const recurring = (detail.event.recurrence?.length ?? 0) > 0 || Boolean(
    detail.event.recurring_event_id || detail.event.original_start || detail.event.master_id || detail.event.recurrence_unexpanded,
  );
  if (recurring) {
    const scope = document.createElement('select');
    scope.name = 'recurrence_scope';
    scope.className = 'form-input';
    scope.append(
      new Option(eventMessage('thisOccurrence', locale), 'this_occurrence'),
      new Option(eventMessage('entireSeries', locale), 'entire_series'),
    );
    scope.value = draft.recurrence_scope;
    scope.addEventListener('change', () => { draft.recurrence_scope = scope.value as EventEditDraft['recurrence_scope']; });
    form.appendChild(field(eventMessage('recurrenceScope', locale), scope));
  }

  const title = document.createElement('input'); title.name = 'title'; title.value = draft.title; title.required = true; title.autocomplete = 'off';
  title.className = 'form-input event-edit__title'; title.setAttribute('aria-describedby', 'event-edit-feedback');
  title.addEventListener('input', () => { draft.title = title.value; }); form.appendChild(field(eventMessage('title', locale), title));

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
  const allDayField = field(eventMessage('allDay', locale), allDay); allDayField.classList.add('event-edit__all-day'); when.appendChild(allDayField);
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
  times.append(field(eventMessage('startTime', locale), start), field(eventMessage('endTime', locale), end)); when.appendChild(times); form.appendChild(when);
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

  const location = document.createElement('input'); location.name = 'location'; location.value = draft.location; location.className = 'form-input';
  location.addEventListener('input', () => { draft.location = location.value; }); form.appendChild(field(eventMessage('location', locale), location));
  const description = document.createElement('textarea'); description.name = 'description'; description.value = draft.description; description.className = 'form-textarea';
  description.rows = 5; description.addEventListener('input', () => { draft.description = description.value; }); form.appendChild(field(eventMessage('description', locale), description));
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
