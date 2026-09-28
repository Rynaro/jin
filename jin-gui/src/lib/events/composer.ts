/**
 * Shared Event Composer — DOM around EventDraft with progressive sections.
 * Does not own submit routing or create a second role=status live region.
 */

import type { EventConferenceDataDto } from '../../types/dto';
import type { JinColor } from '../ui/color_picker';
import { applyCalendarColor } from '../calendar/colors';
import {
  dirtyFields,
  draftRangeSummary,
  isDirty,
  setAttendees,
  setConferenceIntent,
  setRecurrence,
  setRecurrenceScope,
  validateDraft,
  type EventDraft,
  type GuestUpdatePolicy,
} from './draft';
import {
  eventMessage,
  eventMessageFormat,
  resolveEventLocale,
  type EventLocaleKey,
} from './locale';
import { recurrenceFromRepeatValue, recurrenceLabel, recurrenceUiCopy } from './recurrence';
import {
  renderRecurrenceScope,
  type SupportedRecurrenceScope,
} from './recurrence_scope';
import type { EventOperationState } from './operation_state';
import { isBusy } from './operation_state';

export interface ComposerDestination {
  name: string;
  alias?: string;
  color?: JinColor;
  /** Exact Google route when creating into a writable connected calendar. */
  accountId?: string;
  calendarId?: string;
  /** Empty means the provider did not advertise types; provider still decides. */
  allowedConferenceSolutionTypes?: readonly string[];
}

export interface ComposerChangeSummary {
  before: string;
  after: string;
}

export interface ComposerRenderOptions {
  draft: EventDraft;
  destination?: ComposerDestination;
  destinations?: readonly ComposerDestination[];
  onDestinationChange?: (destination: ComposerDestination) => void;
  conferenceData?: EventConferenceDataDto | null;
  existingMeetingHref?: string | null;
  conferenceCapabilities?: { can_add_conference: boolean; can_remove_conference: boolean };
  recurrenceScopes?: readonly SupportedRecurrenceScope[];
  /** When true and entire_series is selected, expose series-pattern editor (AC-032). */
  recurrencePatternSupported?: boolean;
  /** Before → after schedule summary for move/resize (AC-019). */
  changeSummary?: ComposerChangeSummary | null;
  operationState?: EventOperationState;
  locale?: EventLocaleKey;
  onCancel?: () => void;
  onSave?: () => void;
  onDraftChange?: () => void;
}

export interface ComposerView {
  root: HTMLElement;
  footer: HTMLElement;
  refresh(): void;
  setOperationState(state: EventOperationState): void;
  /** True when multi-scope Apply-to still needs an explicit choice. */
  scopeResolved(): boolean;
  showValidation(): void;
  requireDestinationChoice(): void;
  setInteractionSuspended(suspended: boolean): void;
}

function clockSummary(draft: EventDraft, locale: EventLocaleKey): string {
  const range = draftRangeSummary(draft, locale);
  const t = draft.temporal;
  if (!range) return '';
  if (t.is_all_day) {
    return `${range} · ${eventMessage('allDay', locale)}`;
  }
  const zone = t.floating ? '' : ` · ${t.timezone}`;
  return `${range} · ${t.start_time} → ${t.end_time}${zone}`;
}

function guestPolicyLabel(policy: GuestUpdatePolicy, locale: EventLocaleKey): string {
  if (locale === 'pt-BR') {
    if (policy === 'none') return 'Não notificar';
    if (policy === 'external_only') return 'Notificar externos';
    return 'Notificar todos';
  }
  if (policy === 'none') return 'Notify none';
  if (policy === 'external_only') return 'Notify external';
  return 'Notify all';
}

function primaryLabel(draft: EventDraft, locale: EventLocaleKey): string {
  const dirty = dirtyFields(draft);
  if (!draft.event_id) {
    const hasGuests = (draft.attendees?.length ?? 0) > 0;
    return eventMessage(hasGuests ? 'createInvitation' : 'createEvent', locale);
  }
  if (dirty.length === 1 && dirty[0] === 'attendees') {
    return eventMessage('updateGuests', locale);
  }
  return eventMessage('saveChanges', locale);
}

function syncDetailsAria(details: HTMLDetailsElement): void {
  const summary = details.querySelector('summary');
  if (summary) summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
}

function makeSection(
  title: string,
  open: boolean,
  collapsedSummary: () => string,
  bodyBuild: (body: HTMLElement) => void,
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'event-composer__section';
  details.open = open;

  const summary = document.createElement('summary');
  summary.className = 'event-composer__section-summary tap-target';
  summary.dataset.companionFocus = `section-${title}`;

  const titleEl = document.createElement('span');
  titleEl.className = 'event-composer__section-title';
  titleEl.textContent = title;

  const hint = document.createElement('span');
  hint.className = 'event-composer__section-hint text-footnote';
  hint.textContent = open ? '' : collapsedSummary();

  summary.appendChild(titleEl);
  summary.appendChild(hint);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'event-composer__section-body';
  bodyBuild(body);
  details.appendChild(body);

  const refreshHint = (): void => {
    hint.textContent = details.open ? '' : collapsedSummary();
    syncDetailsAria(details);
  };
  details.addEventListener('toggle', refreshHint);
  details.addEventListener('composer-refresh', refreshHint);
  syncDetailsAria(details);

  return details;
}

/** Render shared Composer around an existing EventDraft object (identity preserved). */
export function renderEventComposer(options: ComposerRenderOptions): ComposerView {
  const locale = options.locale ?? resolveEventLocale();
  const draft = options.draft;
  const operationRef = { state: options.operationState ?? ('draft' as EventOperationState) };
  const copy = recurrenceUiCopy(locale);
  const scopes = [...(options.recurrenceScopes ?? [])].filter(
    (s): s is SupportedRecurrenceScope =>
      s === 'this_occurrence' || s === 'entire_series',
  );

  let scopeChosen = scopes.length <= 1;
  if (scopes.length === 1) {
    draft.recurrence_scope = scopes[0];
  }

  const root = document.createElement('div');
  root.className = 'event-composer';
  let selectedDestination = options.destination;
  let destinationResolved = Boolean(options.destination) || !options.destinations?.length;
  let destinationSelect: HTMLSelectElement | null = null;
  const destinationHelp = document.createElement('p');
  destinationHelp.className = 'event-composer__destination-help';
  const touched = new Set<string>();
  let submitted = false;
  let interactionSuspended = false;
  const markTouched = (field: string): void => {
    if (interactionSuspended || !root.isConnected) return;
    touched.add(field);
    refresh();
  };
  const labeled = (label: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, id: string): HTMLLabelElement => {
    control.id = id;
    const wrapper = document.createElement('label');
    wrapper.className = 'event-composer__field';
    wrapper.htmlFor = id;
    const caption = document.createElement('span');
    caption.className = 'form-label';
    caption.textContent = label;
    wrapper.append(caption, control);
    return wrapper;
  };

  // The title is the visual anchor; calendar identity is one compact row.
  const header = document.createElement('header');
  header.className = 'event-composer__header';

  const destination = document.createElement('div');
  destination.className = 'event-composer__destination';
  const swatch = document.createElement('span');
  swatch.className = 'event-composer__color';
  swatch.setAttribute('aria-hidden', 'true');
  swatch.hidden = !options.destination;
  if (options.destination?.color) applyCalendarColor(swatch, options.destination.color);
  destination.appendChild(swatch);

  const destText = document.createElement('div');
  const destName = document.createElement('p');
  destName.className = 'event-composer__calendar-name';
  destName.textContent = options.destination?.name ?? eventMessage('calendar', locale);
  destText.appendChild(destName);
  if (options.destination?.alias && options.destination.alias !== destName.textContent) {
    const alias = document.createElement('p');
    alias.className = 'event-composer__account-alias text-footnote';
    alias.textContent = options.destination.alias;
    destText.appendChild(alias);
  }
  destination.appendChild(destText);
  if (!draft.event_id && options.destinations && (options.destinations.length > 1 || !options.destination)) {
    const select = document.createElement('select');
    select.className = 'form-select event-composer__destination-select';
    select.dataset.companionFocus = 'composer-destination';
    destinationSelect = select;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = eventMessage('chooseCalendar', locale);
    placeholder.disabled = true;
    select.appendChild(placeholder);
    options.destinations.forEach((choice, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = choice.alias ? `${choice.alias} · ${choice.name}` : choice.name;
      select.appendChild(option);
    });
    const selected = options.destinations.findIndex(choice =>
      choice.accountId === options.destination?.accountId
      && choice.calendarId === options.destination?.calendarId,
    );
    select.value = selected >= 0 && options.destination ? String(selected) : '';
    select.addEventListener('change', () => {
      const choice = options.destinations?.[Number(select.value)];
      if (!choice) return;
      destName.textContent = choice.name;
      const aliasEl = destText.querySelector('.event-composer__account-alias');
      if (choice.alias && choice.alias !== choice.name) {
        if (aliasEl) aliasEl.textContent = choice.alias;
        else {
          const p = document.createElement('p');
          p.className = 'event-composer__account-alias text-footnote';
          p.textContent = choice.alias;
          destText.appendChild(p);
        }
      } else aliasEl?.remove();
      applyCalendarColor(swatch, choice.color ?? 'accent');
      swatch.hidden = false;
      selectedDestination = choice;
      destinationResolved = true;
      options.onDestinationChange?.(choice);
      refresh();
    });
    const calendarRow = labeled(eventMessage('calendar', locale), select, 'event-composer-destination');
    calendarRow.classList.add('event-composer__calendar-row');
    calendarRow.prepend(swatch);
    header.appendChild(calendarRow);
    destination.hidden = true;
  }

  const titleField = document.createElement('div');
  titleField.className = 'event-composer__field';
  const titleLabel = document.createElement('label');
  titleLabel.htmlFor = 'event-composer-title';
  titleLabel.className = 'form-label';
  titleLabel.textContent = eventMessage('title', locale);
  const titleInput = document.createElement('input');
  titleInput.id = 'event-composer-title';
  titleInput.type = 'text';
  titleInput.className = 'form-input event-composer__title-input';
  titleInput.placeholder = eventMessage('eventTitle', locale);
  titleInput.value = draft.title;
  titleInput.dataset.companionFocus = 'composer-title';
  titleInput.addEventListener('input', () => {
    draft.title = titleInput.value;
    options.onDraftChange?.();
    refresh();
  });
  titleInput.addEventListener('blur', () => markTouched('title'));
  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInput);
  header.prepend(titleField);
  if (!destination.hidden) {
    const calendarRow = document.createElement('div');
    calendarRow.className = 'event-composer__calendar-row';
    const label = document.createElement('span');
    label.className = 'form-label';
    label.textContent = eventMessage('calendar', locale);
    calendarRow.append(label, destination);
    header.appendChild(calendarRow);
  }
  header.appendChild(destinationHelp);

  const rangeSummary = document.createElement('p');
  rangeSummary.className = 'event-composer__range-summary';
  rangeSummary.dataset.companionFocus = 'composer-range';

  let changeSummaryEl: HTMLElement | null = null;
  if (options.changeSummary) {
    changeSummaryEl = document.createElement('div');
    changeSummaryEl.className = 'event-composer__change-summary';
    changeSummaryEl.dataset.companionFocus = 'composer-change-summary';
    const heading = document.createElement('p');
    heading.className = 'event-composer__change-summary-title';
    heading.textContent = eventMessage('changeSummary', locale);
    const before = document.createElement('p');
    before.className = 'event-composer__change-before text-footnote';
    before.textContent = `${eventMessage('changeBefore', locale)}: ${options.changeSummary.before}`;
    const after = document.createElement('p');
    after.className = 'event-composer__change-after';
    after.textContent = `${eventMessage('changeAfter', locale)}: ${options.changeSummary.after}`;
    changeSummaryEl.append(heading, before, after);
    header.appendChild(changeSummaryEl);
  }

  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'event-composer__body';

  // When (open by default)
  const startDate = document.createElement('input');
  startDate.type = 'date';
  startDate.className = 'form-input';
  startDate.value = draft.temporal.start_date;
  startDate.dataset.companionFocus = 'composer-start-date';
  const endDate = document.createElement('input');
  endDate.type = 'date';
  endDate.className = 'form-input';
  endDate.value = draft.temporal.end_date;
  endDate.dataset.companionFocus = 'composer-end-date';
  const startTime = document.createElement('input');
  startTime.type = 'time';
  startTime.className = 'form-input';
  startTime.value = draft.temporal.start_time;
  startTime.dataset.companionFocus = 'composer-start-time';
  const endTime = document.createElement('input');
  endTime.type = 'time';
  endTime.className = 'form-input';
  endTime.value = draft.temporal.end_time;
  endTime.dataset.companionFocus = 'composer-end-time';
  const allDay = document.createElement('input');
  allDay.type = 'checkbox';
  allDay.checked = draft.temporal.is_all_day;
  const timezone = document.createElement('input');
  timezone.type = 'text';
  timezone.className = 'form-input';
  timezone.value = draft.temporal.timezone;
  timezone.dataset.companionFocus = 'composer-timezone';

  const syncTemporal = (): void => {
    draft.temporal.start_date = startDate.value;
    draft.temporal.end_date = endDate.value;
    draft.temporal.start_time = startTime.value || draft.temporal.start_time;
    draft.temporal.end_time = endTime.value || draft.temporal.end_time;
    draft.temporal.is_all_day = allDay.checked;
    draft.temporal.timezone = timezone.value || draft.temporal.timezone;
    if (draft.temporal.timezone === draft.temporal.end_timezone || !draft.temporal.end_timezone) {
      draft.temporal.end_timezone = draft.temporal.timezone;
    }
    options.onDraftChange?.();
    refresh();
  };
  for (const el of [startDate, endDate, startTime, endTime, timezone]) {
    el.addEventListener('input', syncTemporal);
  }
  for (const el of [startDate, startTime]) el.addEventListener('blur', () => markTouched('start'));
  for (const el of [endDate, endTime]) el.addEventListener('blur', () => markTouched('end'));
  timezone.addEventListener('blur', () => markTouched('start'));
  allDay.addEventListener('change', syncTemporal);

  const temporal = document.createElement('div');
  temporal.className = 'event-composer__temporal';
  const allDayLabel = document.createElement('label');
  allDayLabel.className = 'jin-checkbox event-composer__all-day';
  allDayLabel.appendChild(allDay);
  const checkMark = document.createElement('span');
  checkMark.className = 'jin-checkbox__mark';
  checkMark.setAttribute('aria-hidden', 'true');
  allDayLabel.appendChild(checkMark);
  allDayLabel.appendChild(document.createTextNode(eventMessage('allDay', locale)));
  temporal.appendChild(allDayLabel);
  const timeRow = (label: string, date: HTMLInputElement, time: HTMLInputElement, dateLabel: string, timeLabel: string, id: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'event-composer__time-row';
    const title = document.createElement('span');
    title.className = 'event-composer__time-row-label';
    title.textContent = label;
    const dateField = labeled(dateLabel, date, `event-composer-${id}-date`);
    const timeField = labeled(timeLabel, time, `event-composer-${id}-time`);
    dateField.classList.add('event-composer__temporal-field');
    timeField.classList.add('event-composer__temporal-field');
    row.append(title, dateField, timeField);
    return row;
  };
  temporal.append(
    timeRow(eventMessage('start', locale), startDate, startTime, eventMessage('startDate', locale), eventMessage('startTime', locale), 'start'),
    timeRow(eventMessage('end', locale), endDate, endTime, eventMessage('endDate', locale), eventMessage('endTime', locale), 'end'),
  );
  const zoneSection = makeSection(eventMessage('timeZone', locale), false, () => draft.temporal.timezone, section => {
    section.appendChild(labeled(eventMessage('timeZone', locale), timezone, 'event-composer-timezone'));
  });
  zoneSection.classList.add('event-composer__zone');
  temporal.appendChild(zoneSection);
  body.appendChild(temporal);

  // Guests
  const guestsText = document.createElement('textarea');
  guestsText.className = 'form-textarea event-composer__guests-input';
  guestsText.dataset.companionFocus = 'composer-guests';
  guestsText.placeholder = 'a@example.com, b@example.com';
  if (draft.attendees) {
    guestsText.value = draft.attendees.map((a) => a.email ?? '').filter(Boolean).join(', ');
  }
  guestsText.addEventListener('input', () => {
    const emails = guestsText.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Only mark attendees dirty when the user edits this control.
    setAttendees(
      draft,
      emails.map((email) => ({ email })),
    );
    options.onDraftChange?.();
    refresh();
  });
  guestsText.addEventListener('blur', () => markTouched('attendees'));

  const guestCount = (): number => draft.attendees?.length ?? 0;
  const guestsOpen = guestCount() > 0;
  body.appendChild(
    makeSection(
      eventMessage('guestsAndUpdates', locale),
      guestsOpen,
      () => {
        const count = guestCount();
        const summary = eventMessageFormat('guestSummary', { count }, locale);
        return `${summary} · ${guestPolicyLabel(draft.guest_update_policy, locale)}`;
      },
      (section) => {
        section.appendChild(labeled(eventMessage('attendees', locale), guestsText, 'event-composer-guests'));
      },
    ),
  );

  // Google Meet
  const meetSelect = document.createElement('select');
  meetSelect.className = 'form-select';
  meetSelect.dataset.companionFocus = 'composer-meet';
  const hasMeeting = Boolean(options.conferenceData || options.existingMeetingHref);
  const canAddMeet = (): boolean => {
    if (options.conferenceCapabilities) return options.conferenceCapabilities.can_add_conference;
    const types = selectedDestination?.allowedConferenceSolutionTypes;
    return Boolean(selectedDestination?.accountId) && (!types?.length || types.includes('hangoutsMeet'));
  };
  const canRemove = options.conferenceCapabilities?.can_remove_conference ?? hasMeeting;
  for (const [value, label, enabled] of [
    ['preserve', hasMeeting ? eventMessage('keepMeeting', locale) : eventMessage('noVideoMeeting', locale), true],
    ['add', eventMessage('requestMeet', locale), canAddMeet()],
    ['remove', eventMessage('removeMeeting', locale), canRemove],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.disabled = !enabled && draft.conference_intent.kind !== value;
    meetSelect.appendChild(opt);
  }
  meetSelect.value = draft.conference_intent.kind;
  meetSelect.addEventListener('change', () => {
    if (meetSelect.value === 'add') setConferenceIntent(draft, { kind: 'add', solution_type: 'hangoutsMeet' });
    else if (meetSelect.value === 'remove') setConferenceIntent(draft, { kind: 'remove' });
    else setConferenceIntent(draft, { kind: 'preserve' });
    options.onDraftChange?.();
    refresh();
  });

  const meetSummary = (): string => {
    if (draft.conference_intent.kind === 'add') return eventMessage('meetRequested', locale);
    if (draft.conference_intent.kind === 'remove') return eventMessage('meetRemovalRequested', locale);
    if (options.conferenceData?.pendingCreateRequest || options.conferenceData?.createRequest?.status?.statusCode === 'pending') {
      return eventMessage('creatingMeet', locale);
    }
    return eventMessage(hasMeeting ? 'existingMeeting' : 'noVideoMeeting', locale);
  };
  const meetOpen =
    draft.conference_intent.kind !== 'preserve';
  body.appendChild(
    makeSection(eventMessage('googleMeet', locale), meetOpen, meetSummary, (section) => {
      section.appendChild(labeled(eventMessage('googleMeet', locale), meetSelect, 'event-composer-meet'));
    }),
  );

  // Repeat — gated by recurrence scope + pattern support (AC-031/032)
  const patternSupported = options.recurrencePatternSupported === true;
  const isCreate = !draft.event_id;
  const repeatSelect = document.createElement('select');
  repeatSelect.className = 'form-select';
  repeatSelect.dataset.companionFocus = 'composer-repeat';
  for (const [value, label] of [
    ['none', copy.none],
    ['daily', copy.daily],
    ['weekly', copy.weekly],
    ['monthly', copy.monthly],
    ['yearly', copy.yearly],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    repeatSelect.appendChild(opt);
  }
  if (draft.recurrence) {
    repeatSelect.value = draft.recurrence.frequency;
  } else {
    repeatSelect.value = 'none';
  }
  repeatSelect.addEventListener('change', () => {
    setRecurrence(draft, recurrenceFromRepeatValue(repeatSelect.value));
    options.onDraftChange?.();
    refresh();
  });
  const repeatSection = makeSection(
    isCreate ? copy.repeat : eventMessage('seriesPattern', locale),
    Boolean(draft.recurrence) || draft.recurrence_changed,
    () => (draft.recurrence ? recurrenceLabel(draft.recurrence, locale) : copy.none),
    (section) => {
      section.appendChild(labeled(copy.repeat, repeatSelect, 'event-composer-repeat'));
    },
  );
  body.appendChild(repeatSection);

  function syncPatternAvailability(): void {
    if (isCreate) {
      repeatSection.hidden = false;
      repeatSelect.disabled = false;
      return;
    }
    // Existing event without recurrence scopes: keep ordinary repeat controls.
    if (scopes.length === 0) {
      repeatSection.hidden = false;
      repeatSelect.disabled = false;
      return;
    }
    // AC-031: this_occurrence → master pattern unavailable.
    const scope = scopeChosen ? draft.recurrence_scope : null;
    if (!scopeChosen || scope === 'this_occurrence') {
      repeatSection.hidden = true;
      repeatSelect.disabled = true;
      return;
    }
    // AC-032: entire_series + recurrence_pattern_supported → expose editor.
    if (scope === 'entire_series' && patternSupported) {
      repeatSection.hidden = false;
      repeatSelect.disabled = false;
      return;
    }
    repeatSection.hidden = true;
    repeatSelect.disabled = true;
  }

  // Location & notes
  const locationInput = document.createElement('input');
  locationInput.type = 'text';
  locationInput.className = 'form-input';
  locationInput.value = draft.location;
  locationInput.dataset.companionFocus = 'composer-location';
  locationInput.addEventListener('input', () => {
    draft.location = locationInput.value;
    options.onDraftChange?.();
    refresh();
  });
  const notesInput = document.createElement('textarea');
  notesInput.className = 'form-textarea';
  notesInput.value = draft.description;
  notesInput.dataset.companionFocus = 'composer-notes';
  notesInput.addEventListener('input', () => {
    draft.description = notesInput.value;
    options.onDraftChange?.();
    refresh();
  });
  const locationOpen = Boolean(draft.location || draft.description);
  body.appendChild(
    makeSection(
      eventMessage('locationAndNotes', locale),
      locationOpen,
      () => {
        const parts: string[] = [];
        if (draft.location) parts.push(draft.location);
        if (draft.description) parts.push(eventMessage('notesAdded', locale));
        return parts.join(' · ') || eventMessage('location', locale);
      },
      (section) => {
        section.appendChild(labeled(eventMessage('location', locale), locationInput, 'event-composer-location'));
        section.appendChild(labeled(eventMessage('description', locale), notesInput, 'event-composer-notes'));
      },
    ),
  );

  // Apply-to when more than one scope
  let scopeField: HTMLElement | null = null;
  if (scopes.length > 1) {
    scopeField = renderRecurrenceScope({
      scopes,
      value: scopeChosen ? draft.recurrence_scope : null,
      name: 'event-composer-recurrence-scope',
      legend: eventMessage('applyTo', locale),
      className: 'event-composer__apply-to',
      locale,
      onChange: (scope) => {
        setRecurrenceScope(draft, scope);
        scopeChosen = true;
        options.onDraftChange?.();
        refresh();
      },
    });
    body.appendChild(scopeField);
  }

  root.appendChild(body);

  // Field errors
  const errorsEl = document.createElement('ul');
  errorsEl.className = 'event-composer__errors';
  errorsEl.id = 'event-composer-errors';
  root.appendChild(errorsEl);

  // Footer: Cancel + primary (status owned by companion shell)
  const footer = document.createElement('footer');
  footer.className = 'event-composer__footer';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary tap-target event-composer__cancel';
  cancel.textContent = eventMessage('cancel', locale);
  cancel.dataset.companionFocus = 'composer-cancel';
  cancel.addEventListener('click', () => options.onCancel?.());
  footer.appendChild(cancel);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary tap-target event-composer__save';
  save.dataset.companionFocus = 'composer-save';
  save.addEventListener('click', () => {
    submitted = true;
    refresh();
    if (!save.disabled) options.onSave?.();
  });
  footer.appendChild(save);

  root.appendChild(footer);

  function refresh(): void {
    rangeSummary.textContent = clockSummary(draft, locale);
    syncPatternAvailability();
    startTime.disabled = draft.temporal.is_all_day;
    endTime.disabled = draft.temporal.is_all_day;
    timezone.disabled = draft.temporal.is_all_day || draft.temporal.floating;
    const addOption = meetSelect.querySelector<HTMLOptionElement>('option[value="add"]');
    if (addOption) addOption.disabled = !canAddMeet() && draft.conference_intent.kind !== 'add';

    const busy = isBusy(operationRef.state);
    cancel.disabled = busy || operationRef.state === 'persisting';
    save.textContent = primaryLabel(draft, locale);

    const validation = validateDraft(draft);
    const emails = draft.attendees?.map(attendee => attendee.email ?? '').filter(Boolean) ?? [];
    const invalidEmail = emails.find(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const guestError = invalidEmail
      ? eventMessageFormat('invalidGuestEmail', { email: invalidEmail }, locale)
      : emails.length > 200 ? eventMessage('tooManyGuests', locale) : null;
    const requiresGoogle = !draft.event_id && (
      emails.length > 0 || draft.conference_intent.kind !== 'preserve' || Boolean(draft.recurrence)
    );
    const destinationError = requiresGoogle && !selectedDestination?.accountId
      ? eventMessage('googleDestinationRequired', locale) : null;
    destinationHelp.textContent = destinationError ?? '';
    errorsEl.replaceChildren();
    titleInput.removeAttribute('aria-invalid');
    titleInput.removeAttribute('aria-describedby');
    for (const control of [startDate, startTime, endDate, endTime]) {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
    for (const error of validation.errors) {
      const relevant = error.field === 'duration' ? ['start', 'end'] : [error.field];
      if (!submitted && !relevant.some(field => touched.has(field))) continue;
      const item = document.createElement('li');
      item.textContent = error.message;
      item.dataset.field = error.field;
      errorsEl.appendChild(item);
      const controls = error.field === 'title' ? [titleInput]
        : error.field === 'start' ? [startDate, startTime]
          : error.field === 'end' ? [endDate, endTime]
            : error.field === 'duration' ? [endDate, endTime] : [];
      for (const control of controls) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', errorsEl.id);
      }
    }
    if (guestError && (submitted || touched.has('attendees'))) {
      const item = document.createElement('li');
      item.textContent = guestError;
      errorsEl.appendChild(item);
      guestsText.setAttribute('aria-invalid', 'true');
      guestsText.setAttribute('aria-describedby', errorsEl.id);
    } else {
      guestsText.removeAttribute('aria-invalid');
      guestsText.removeAttribute('aria-describedby');
    }
    root.querySelectorAll<HTMLDetailsElement>('.event-composer__section').forEach(section => {
      section.dispatchEvent(new Event('composer-refresh'));
    });

    const scopeOk = scopes.length <= 1 || scopeChosen;
    save.disabled =
      busy
      || !validation.valid
      || Boolean(guestError)
      || Boolean(destinationError)
      || !scopeOk
      || !destinationResolved
      || (!isDirty(draft) && Boolean(draft.event_id));
  }

  refresh();

  return {
    root,
    footer,
    refresh,
    setOperationState(state: EventOperationState) {
      operationRef.state = state;
      refresh();
    },
    scopeResolved: () => scopes.length <= 1 || scopeChosen,
    showValidation: () => { submitted = true; refresh(); },
    requireDestinationChoice: () => {
      destinationResolved = false;
      if (destinationSelect) {
        destinationSelect.selectedOptions[0].disabled = true;
        destinationSelect.value = '';
        destinationSelect.focus({ preventScroll: true });
      }
      refresh();
    },
    setInteractionSuspended: (suspended: boolean) => { interactionSuspended = suspended; },
  };
}
