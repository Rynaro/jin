/**
 * EventDraft — the one shared, pure model of "an event the user is composing".
 *
 * Extracted from `edit.ts` in S2. Every surface that creates or edits an event
 * (full detail, Today, Capture, Notifications) is meant to build one of these
 * and serialize it through the adapters at the bottom of this file, rather than
 * hand-rolling its own invoke payload. S7 completes that migration; S2
 * establishes the single adapter they will all consume.
 *
 * Two invariants carry most of the weight here:
 *
 *  1. **The UI end date is inclusive; the canonical end is exclusive.** A user
 *     who picks Jul 1 – Jul 3 means three days, which canonically ends Jul 4.
 *     Only `createInputFromDraft`/`temporalBundleFromDraft` perform that
 *     conversion, so it cannot be applied twice or forgotten.
 *
 *  2. **Untouched time is omitted, never re-sent.** `editDeltaFromDraft`
 *     compares against the draft's baseline and emits the temporal bundle only
 *     when the user actually changed time. Re-sending "previous" values is how
 *     an event with two distinct endpoint zones loses one of them.
 *
 * This module is pure: no DOM, no network, no timers.
 */

import type { EventDto, EventTemporalPreviewDto, EventTemporalPreviewInput } from '../../types/dto';
import type {
  EventAttendeeDto,
  EventConferenceDataDto,
  EventReminderSettingsDto,
} from '../../types/dto';
import type {
  EventEditDeltaInput,
  EventTemporalDeltaInput,
  RecurrenceDraft,
  RecurrenceMutationScope,
} from '../../invoke';
import { addDays, parseIso } from '../calendar/transform';
import { normalizeClockInput } from '../calendar/clock';
import { recurrenceDraftFromRrule } from './recurrence';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GuestUpdatePolicy = 'all' | 'external_only' | 'none';

/**
 * What the user wants to happen to the meeting's conferencing.
 *
 * `preserve` is deliberately the default and serializes to *nothing*: the
 * provider request id belongs to core, and a client that re-sends conference
 * data it did not change risks replaying a consumed request.
 */
export type ConferenceIntent =
  | { kind: 'preserve' }
  | { kind: 'add'; solution_type: string }
  | { kind: 'remove' };

/** The temporal fields as the user edits them (UI-shaped, end date inclusive). */
export interface EventDraftTemporal {
  start_date: string;
  /** Inclusive last date as shown in the UI, not the canonical exclusive end. */
  end_date: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  floating: boolean;
  /** IANA zone for the start endpoint. */
  timezone: string;
  /** IANA zone for the end endpoint, tracked separately so it survives edits. */
  end_timezone: string;
}

/** The canonical values the draft started from, used to compute dirtiness. */
export interface EventDraftBaseline extends EventDraftTemporal {
  start: string;
  end: string;
  start_tzid: string | null;
  end_tzid: string | null;
  title: string;
  location: string;
  description: string;
}

export interface EventDraft {
  event_id: string | null;
  edit_token: string | null;
  title: string;
  location: string;
  description: string;
  temporal: EventDraftTemporal;
  /** `null` for a brand-new event; there is nothing to preserve yet. */
  baseline: EventDraftBaseline | null;
  recurrence_scope: RecurrenceMutationScope;
  recurrence?: RecurrenceDraft;
  clear_recurrence: boolean;
  recurrence_changed: boolean;
  guest_update_policy: GuestUpdatePolicy;
  attendees?: EventAttendeeDto[];
  attendees_omitted?: boolean;
  conference_intent: ConferenceIntent;
  reminders?: EventReminderSettingsDto;
  /** Free-text natural-language entry; never serialized. */
  relative_input: string;
  range_complete: boolean;
}

export type EventDraftField =
  | 'title'
  | 'location'
  | 'description'
  | 'temporal'
  | 'recurrence'
  | 'attendees'
  | 'conference'
  | 'reminders';

export interface EventDraftFieldError {
  field: string;
  code: string;
  message: string;
}

export interface EventDraftValidation {
  valid: boolean;
  errors: EventDraftFieldError[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '10:00';

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function timePart(value: string, fallback: string): string {
  return value.includes('T') ? value.split('T')[1].slice(0, 5) : fallback;
}

function clockMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function wallDayNumber(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function temporalEqual(a: EventDraftTemporal, b: EventDraftTemporal): boolean {
  if (a.is_all_day !== b.is_all_day) return false;
  if (a.start_date !== b.start_date || a.end_date !== b.end_date) return false;
  if (a.is_all_day) return true;
  if (a.start_time !== b.start_time || a.end_time !== b.end_time) return false;
  if (a.floating !== b.floating) return false;
  if (a.floating) return true;
  return a.timezone === b.timezone && a.end_timezone === b.end_timezone;
}

function blankOrUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

// ── Constructors ──────────────────────────────────────────────────────────────

/**
 * Build a draft from a stored event.
 *
 * The event's own two zones are captured separately; when an event carries only
 * one, the end zone mirrors it — but that mirroring is recorded in the baseline
 * too, so a later serializer can tell "unchanged" from "the user set them equal".
 */
export function draftFromEvent(event: EventDto, editToken?: string): EventDraft {
  const startZone = event.start_tzid ?? localZone();
  const endZone = event.end_tzid ?? startZone;
  const temporal: EventDraftTemporal = {
    start_date: datePart(event.start),
    // Canonical all-day end is exclusive; the UI shows the inclusive last day.
    end_date: event.is_all_day ? addDays(datePart(event.end), -1) : datePart(event.end),
    start_time: timePart(event.start, DEFAULT_START_TIME),
    end_time: timePart(event.end, DEFAULT_END_TIME),
    is_all_day: event.is_all_day,
    floating: event.floating,
    timezone: startZone,
    end_timezone: endZone,
  };
  return {
    event_id: event.id,
    edit_token: editToken ?? null,
    title: event.title,
    location: event.location ?? '',
    description: event.description ?? '',
    temporal: { ...temporal },
    baseline: {
      ...temporal,
      start: event.start,
      end: event.end,
      start_tzid: event.start_tzid ?? null,
      end_tzid: event.end_tzid ?? null,
      title: event.title,
      location: event.location ?? '',
      description: event.description ?? '',
    },
    recurrence_scope: 'this_occurrence',
    recurrence: recurrenceDraftFromRrule(event.recurrence ?? []),
    clear_recurrence: false,
    recurrence_changed: false,
    guest_update_policy: 'all',
    attendees: undefined,
    attendees_omitted: undefined,
    conference_intent: { kind: 'preserve' },
    reminders: undefined,
    relative_input: '',
    range_complete: true,
  };
}

export interface DraftSlot {
  date: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  timezone?: string;
}

/** Build a draft from a calendar slot the user clicked or dragged. */
export function draftFromSlot(slot: DraftSlot): EventDraft {
  const zone = slot.timezone ?? localZone();
  const isAllDay = slot.is_all_day ?? false;
  return {
    event_id: null,
    edit_token: null,
    title: '',
    location: '',
    description: '',
    temporal: {
      start_date: slot.date,
      end_date: slot.end_date ?? slot.date,
      start_time: slot.start_time ?? DEFAULT_START_TIME,
      end_time: slot.end_time ?? DEFAULT_END_TIME,
      is_all_day: isAllDay,
      floating: false,
      timezone: zone,
      end_timezone: zone,
    },
    baseline: null,
    recurrence_scope: 'this_occurrence',
    recurrence: undefined,
    clear_recurrence: false,
    recurrence_changed: false,
    guest_update_policy: 'all',
    conference_intent: { kind: 'preserve' },
    relative_input: '',
    range_complete: true,
  };
}

export interface DraftCapture {
  title: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  location?: string;
  description?: string;
  timezone?: string;
}

/** Build a draft from a Capture entry. */
export function draftFromCapture(capture: DraftCapture): EventDraft {
  const draft = draftFromSlot({
    date: capture.date ?? new Date().toISOString().slice(0, 10),
    start_time: capture.start_time,
    end_time: capture.end_time,
    is_all_day: capture.is_all_day,
    timezone: capture.timezone,
  });
  draft.title = capture.title;
  draft.location = capture.location ?? '';
  draft.description = capture.description ?? '';
  return draft;
}

// ── Dirty tracking ────────────────────────────────────────────────────────────

/**
 * Which fields the user actually changed.
 *
 * A draft with no baseline (a brand-new event) reports every populated field as
 * dirty, because there is nothing to preserve.
 */
export function dirtyFields(draft: EventDraft): EventDraftField[] {
  const dirty: EventDraftField[] = [];
  const baseline = draft.baseline;
  if (!baseline) {
    dirty.push('temporal');
    if (draft.title.trim()) dirty.push('title');
    if (draft.location) dirty.push('location');
    if (draft.description) dirty.push('description');
  } else {
    if (draft.title.trim() !== baseline.title.trim()) dirty.push('title');
    if (draft.location !== baseline.location) dirty.push('location');
    if (draft.description !== baseline.description) dirty.push('description');
    if (!temporalEqual(draft.temporal, baseline)) dirty.push('temporal');
  }
  if (draft.recurrence_changed) dirty.push('recurrence');
  if (draft.attendees !== undefined) dirty.push('attendees');
  if (draft.conference_intent.kind !== 'preserve') dirty.push('conference');
  if (draft.reminders !== undefined) dirty.push('reminders');
  return dirty;
}

export function isDirty(draft: EventDraft): boolean {
  return dirtyFields(draft).length > 0;
}

/** Whether the user changed anything about the event's time. */
export function touchesTime(draft: EventDraft): boolean {
  return dirtyFields(draft).includes('temporal');
}

// ── Canonical temporal serialization ──────────────────────────────────────────

/**
 * The canonical start value for this draft.
 *
 * All-day drafts are date-valued; timed drafts carry seconds so they match the
 * `YYYY-MM-DDTHH:MM:SS` core expects.
 */
export function canonicalStart(draft: EventDraft): string {
  const t = draft.temporal;
  return t.is_all_day ? t.start_date : `${t.start_date}T${t.start_time}:00`;
}

/**
 * The canonical end value for this draft.
 *
 * For an all-day draft this is **the day after** the final inclusive UI date —
 * the single place that conversion happens.
 */
export function canonicalEnd(draft: EventDraft): string {
  const t = draft.temporal;
  return t.is_all_day ? addDays(t.end_date, 1) : `${t.end_date}T${t.end_time}:00`;
}

/** The complete, all-or-nothing temporal bundle for this draft. */
export function temporalBundleFromDraft(draft: EventDraft): EventTemporalDeltaInput {
  const t = draft.temporal;
  const zoneless = t.is_all_day || t.floating;
  return {
    start: canonicalStart(draft),
    end: canonicalEnd(draft),
    is_all_day: t.is_all_day,
    floating: !t.is_all_day && t.floating,
    start_tzid: zoneless ? null : t.timezone,
    // The end zone is carried independently; it is never inferred from the
    // start zone at serialization time.
    end_tzid: zoneless ? null : t.end_timezone,
  };
}

/** The input a Composer sends to core to resolve this draft's time. */
export function temporalPreviewInputFromDraft(draft: EventDraft): EventTemporalPreviewInput {
  const t = draft.temporal;
  const zoneless = t.is_all_day || t.floating;
  return {
    start: canonicalStart(draft),
    end: canonicalEnd(draft),
    is_all_day: t.is_all_day,
    floating: !t.is_all_day && t.floating,
    start_tzid: zoneless ? null : t.timezone,
    end_tzid: zoneless ? null : t.end_timezone,
  };
}

// ── Serializer adapters (the single origin of every event payload) ────────────

export interface CreateEventPayload {
  title: string;
  start: string;
  end: string;
  tzid?: string;
  is_all_day: boolean;
  location?: string;
  description?: string;
  recurrence?: RecurrenceDraft;
  attendees?: EventAttendeeDto[];
  attendees_omitted?: boolean;
  conference_data?: EventConferenceDataDto;
  clear_conference_data?: boolean;
  reminders?: EventReminderSettingsDto;
}

function conferenceFields(
  draft: EventDraft,
): Pick<CreateEventPayload, 'conference_data' | 'clear_conference_data'> {
  switch (draft.conference_intent.kind) {
    case 'add':
      return {
        conference_data: {
          pendingCreateRequest: {
            // Core replaces this with its own provider request id at the
            // semantic-mutation boundary; a browser value is never trusted.
            requestId: 'client-requested',
            conferenceSolutionKey: { type: draft.conference_intent.solution_type },
          },
        } as unknown as EventConferenceDataDto,
      };
    case 'remove':
      return { clear_conference_data: true };
    case 'preserve':
    default:
      return {};
  }
}

/** Build the create payload. The one origin for create across every surface. */
export function createInputFromDraft(draft: EventDraft): CreateEventPayload {
  const t = draft.temporal;
  const zoneless = t.is_all_day || t.floating;
  return {
    title: draft.title.trim(),
    start: canonicalStart(draft),
    end: canonicalEnd(draft),
    tzid: zoneless ? undefined : t.timezone,
    is_all_day: t.is_all_day,
    location: blankOrUndefined(draft.location),
    description: blankOrUndefined(draft.description),
    recurrence: draft.recurrence_changed && !draft.clear_recurrence ? draft.recurrence : undefined,
    attendees: draft.attendees,
    attendees_omitted: draft.attendees_omitted,
    reminders: draft.reminders,
    ...conferenceFields(draft),
  };
}

/**
 * Build the **sparse** edit delta.
 *
 * Only dirty fields appear. In particular, when the user did not touch time,
 * `temporal` is absent entirely — not a re-send of the previous values, and not
 * a normalized reconstruction. That omission is what preserves an event's two
 * distinct endpoint zones through a title-only edit.
 */
export function editDeltaFromDraft(draft: EventDraft): EventEditDeltaInput {
  const dirty = dirtyFields(draft);
  const delta: EventEditDeltaInput = {};
  if (dirty.includes('title')) delta.title = draft.title.trim();
  if (dirty.includes('location')) delta.location = draft.location === '' ? null : draft.location;
  if (dirty.includes('description')) {
    delta.description = draft.description === '' ? null : draft.description;
  }
  if (dirty.includes('temporal')) delta.temporal = temporalBundleFromDraft(draft);
  if (dirty.includes('recurrence')) {
    if (draft.clear_recurrence) delta.clear_recurrence = true;
    else if (draft.recurrence) delta.recurrence = draft.recurrence;
  }
  if (dirty.includes('attendees')) {
    delta.attendees = draft.attendees;
    if (draft.attendees_omitted !== undefined) delta.attendees_omitted = draft.attendees_omitted;
  }
  if (dirty.includes('conference')) Object.assign(delta, conferenceFields(draft));
  if (dirty.includes('reminders')) delta.reminders = draft.reminders;
  return delta;
}

export interface SparseEditPayload {
  event_id: string;
  edit_token: string;
  operation_id: string;
  delta: EventEditDeltaInput;
  recurrence_scope?: RecurrenceMutationScope;
}

/** Build the full local sparse-edit invoke payload. */
export function editPayloadFromDraft(draft: EventDraft, operationId: string): SparseEditPayload {
  if (!draft.event_id || !draft.edit_token) {
    throw new Error('editPayloadFromDraft requires a draft built from a stored event');
  }
  const payload: SparseEditPayload = {
    event_id: draft.event_id,
    edit_token: draft.edit_token,
    operation_id: operationId,
    delta: editDeltaFromDraft(draft),
  };
  if (draft.recurrence_changed || draft.recurrence_scope === 'entire_series') {
    payload.recurrence_scope = draft.recurrence_scope;
  }
  return payload;
}

export interface EventRoute {
  account_id: string;
  calendar_id: string;
}

export interface RoutedSparseEditPayload extends SparseEditPayload, EventRoute {
  guest_update_policy: GuestUpdatePolicy;
}

/** Build the routed sparse-edit invoke payload. */
export function routedEditPayloadFromDraft(
  draft: EventDraft,
  route: EventRoute,
  operationId: string,
): RoutedSparseEditPayload {
  return {
    ...editPayloadFromDraft(draft, operationId),
    account_id: route.account_id,
    calendar_id: route.calendar_id,
    guest_update_policy: draft.guest_update_policy,
  };
}

/** Build the routed create payload. */
export function routedCreateInputFromDraft(
  draft: EventDraft,
  route: EventRoute,
  operationId: string,
): CreateEventPayload & EventRoute & { operation_id: string; guest_update_policy: GuestUpdatePolicy } {
  return {
    ...createInputFromDraft(draft),
    account_id: route.account_id,
    calendar_id: route.calendar_id,
    operation_id: operationId,
    guest_update_policy: draft.guest_update_policy,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a draft, optionally against core's temporal preview.
 *
 * Local checks cover what the browser can know on its own (a missing title, a
 * malformed clock, an inverted range). Anything that depends on real timezone
 * data — an unknown zone, a DST gap — is core's answer, surfaced here verbatim
 * and bound to the field that caused it so a Composer can block Save and point
 * at the right control.
 */
export function validateDraft(
  draft: EventDraft,
  preview?: EventTemporalPreviewDto,
): EventDraftValidation {
  const errors: EventDraftFieldError[] = [];
  const t = draft.temporal;

  if (!draft.title.trim()) {
    errors.push({ field: 'title', code: 'required', message: 'A title is required.' });
  }
  if (!t.start_date) {
    errors.push({ field: 'start', code: 'required', message: 'A start date is required.' });
  }
  if (!t.end_date) {
    errors.push({ field: 'end', code: 'required', message: 'An end date is required.' });
  }

  if (t.is_all_day) {
    if (t.start_date && t.end_date && t.end_date < t.start_date) {
      errors.push({
        field: 'duration',
        code: 'non_positive_duration',
        message: 'The last day cannot be before the first day.',
      });
    }
  } else {
    const start = normalizeClockInput(t.start_time);
    const end = normalizeClockInput(t.end_time);
    if (!start.ok || !start.time) {
      errors.push({ field: 'start', code: 'invalid_value', message: 'Enter a valid start time.' });
    }
    if (!end.ok || !end.time) {
      errors.push({ field: 'end', code: 'invalid_value', message: 'Enter a valid end time.' });
    }
    if (start.ok && start.time && end.ok && end.time && t.start_date && t.end_date) {
      const minutes =
        (wallDayNumber(t.end_date) - wallDayNumber(t.start_date)) * 1440 +
        clockMinutes(end.time) -
        clockMinutes(start.time);
      if (minutes <= 0) {
        errors.push({
          field: 'duration',
          code: 'non_positive_duration',
          message: 'The end must be after the start.',
        });
      }
    }
  }

  if (preview && preview.status !== 'ok') {
    for (const error of preview.errors) {
      errors.push({ field: error.field, code: error.code, message: error.message });
    }
    if (preview.errors.length === 0) {
      errors.push({ field: 'start', code: preview.status, message: 'This time cannot be scheduled.' });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Summaries and mutation helpers ────────────────────────────────────────────

/** A concise, locale-formatted description of the draft's date range. */
export function draftRangeSummary(draft: EventDraft, locale: 'en' | 'pt-BR'): string {
  const t = draft.temporal;
  if (!t.start_date) return '';
  const format = (iso: string): string => {
    const { year, month, day } = parseIso(iso);
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(year, month - 1, day));
  };
  return t.end_date && t.end_date !== t.start_date
    ? `${format(t.start_date)} – ${format(t.end_date)}`
    : format(t.start_date);
}

export interface DraftRangeSelection {
  mode: string;
  start: string;
  end: string;
  complete: boolean;
}

/** Apply a calendar range selection to the draft's dates. */
export function applyRangeSelection(draft: EventDraft, selection: DraftRangeSelection): void {
  if (selection.mode !== 'range') return;
  draft.temporal.start_date = selection.start;
  draft.temporal.end_date = selection.end;
  draft.range_complete = selection.complete;
}

/**
 * Change the draft's timezone.
 *
 * The entered wall-clock values are deliberately left untouched — "3pm" stays
 * "3pm" and the resolved instant moves instead, which is what a user means when
 * they correct an event's zone.
 */
export function setTimezone(draft: EventDraft, timezone: string, options?: { endOnly?: boolean }): void {
  if (options?.endOnly) {
    draft.temporal.end_timezone = timezone;
    return;
  }
  const hadMatchingZones = draft.temporal.timezone === draft.temporal.end_timezone;
  draft.temporal.timezone = timezone;
  // Only follow the start zone when the two were not independently set.
  if (hadMatchingZones) draft.temporal.end_timezone = timezone;
}

/** Set the recurrence scope, which also governs how a series edit is applied. */
export function setRecurrenceScope(draft: EventDraft, scope: RecurrenceMutationScope): void {
  draft.recurrence_scope = scope;
}

/** Replace the recurrence pattern, marking the draft's recurrence as changed. */
export function setRecurrence(draft: EventDraft, recurrence: RecurrenceDraft | undefined): void {
  draft.recurrence = recurrence;
  draft.recurrence_changed = true;
  draft.clear_recurrence = recurrence === undefined;
  if (recurrence !== undefined) draft.recurrence_scope = 'entire_series';
}

/** Record the user's conferencing intent. */
export function setConferenceIntent(draft: EventDraft, intent: ConferenceIntent): void {
  draft.conference_intent = intent;
}

/** Replace the attendee set. `undefined` leaves attendees untouched. */
export function setAttendees(draft: EventDraft, attendees: EventAttendeeDto[] | undefined): void {
  draft.attendees = attendees;
}
