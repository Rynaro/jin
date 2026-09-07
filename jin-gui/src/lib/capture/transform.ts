/**
 * capture/transform.ts — pure validation + payload-builder logic for
 * capture and create note/task/event forms (GUI-S4).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * CaptureController is the thin Stimulus adapter that calls these.
 *
 * Tested by: src/__tests__/capture_controller.test.ts
 */

// ── Shared validation result ──────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<string, string>>;
}

const OK: ValidationResult = { valid: true, errors: {} };

function fail(field: string, msg: string): ValidationResult {
  return { valid: false, errors: { [field]: msg } };
}

// ── Quick Capture form ────────────────────────────────────────────────────────

export interface CaptureFormState {
  text: string;
  asTask: boolean;
  list: string;
}

/**
 * validateCaptureForm — required-field validation for the quick-capture input.
 * The only required field is text; all else is optional.
 */
export function validateCaptureForm(state: CaptureFormState): ValidationResult {
  if (!state.text.trim()) {
    return fail('text', 'Text is required.');
  }
  return OK;
}

/**
 * buildCapturePayload — construct the exact args for invoke('capture', ...).
 * Mirrors capture(text, { as_task, list }) in invoke.ts.
 */
export function buildCapturePayload(state: CaptureFormState): {
  text: string;
  as_task?: boolean;
  list?: string;
} {
  return {
    text: state.text.trim(),
    as_task: state.asTask ? true : undefined,
    list: state.list.trim() || undefined,
  };
}

// ── Note create form ──────────────────────────────────────────────────────────

export interface NoteFormState {
  title: string;
  body: string;
  tags: string; // comma-separated raw input
}

/** Split the compact note document at its first physical line. */
export function splitNoteDocument(document: string): { title: string; body: string } {
  const newline = document.indexOf('\n');
  return newline < 0
    ? { title: document.trim(), body: '' }
    : { title: document.slice(0, newline).trim(), body: document.slice(newline + 1) };
}

/**
 * validateNoteForm — required-field validation for the note create form.
 * Only title is required; body and tags are optional.
 */
export function validateNoteForm(state: NoteFormState): ValidationResult {
  if (!state.title.trim()) {
    return fail('title', 'Title is required.');
  }
  return OK;
}

/**
 * parseTags — split and trim a comma-separated tag string.
 * Empty strings and whitespace-only entries are removed.
 */
export function parseTags(tagsStr: string): string[] {
  return Array.from(new Set(tagsStr
    .split(',')
    .map((t) => t.trim().replace(/^#+/, '').trim().toLocaleLowerCase())
    .filter((t) => t.length > 0)));
}

/**
 * buildCreateNotePayload — construct the exact args for invoke('create_note', ...).
 * Mirrors createNote(input) in invoke.ts.
 */
export function buildCreateNotePayload(state: NoteFormState): {
  input: { title: string; body?: string; tags?: string[] };
} {
  const tags = parseTags(state.tags);
  return {
    input: {
      title: state.title.trim(),
      body: state.body.trim() ? state.body : undefined,
      tags: tags.length > 0 ? tags : undefined,
    },
  };
}

// ── Task create form ──────────────────────────────────────────────────────────

export interface TaskFormState {
  title: string;
  priority: string;
  due: string; // ISO date or datetime, or empty
  list: string;
}

/**
 * validateTaskForm — required-field validation for the task create form.
 * Only title is required.
 */
export function validateTaskForm(state: TaskFormState): ValidationResult {
  if (!state.title.trim()) {
    return fail('title', 'Title is required.');
  }
  return OK;
}

/**
 * buildCreateTaskPayload — construct the exact args for invoke('create_task', ...).
 * Mirrors createTask(input) in invoke.ts.
 */
export function buildCreateTaskPayload(state: TaskFormState): {
  input: { title: string; priority?: string; due?: string; list?: string };
} {
  return {
    input: {
      title: state.title.trim(),
      priority: state.priority.trim() || undefined,
      due: state.due.trim() || undefined,
      list: state.list.trim() || undefined,
    },
  };
}

// ── Event create form ─────────────────────────────────────────────────────────

export interface EventFormState {
  title: string;
  start: string; // ISO datetime or date
  end: string;   // ISO datetime or date
  tzid: string;  // IANA tz name or empty (empty = floating)
  isAllDay: boolean;
  description: string;
  location: string;
  recurrence?: import('../../invoke').RecurrenceDraft;
}

/**
 * validateEventForm — required-field validation for the event create form.
 * title, start, and end are required.
 * Business logic (e.g. end < start) is NOT validated here — core enforces it
 * and surfaces a JinErrorDto{code:2} which the controller renders as an inline error.
 */
export function validateEventForm(state: EventFormState): ValidationResult {
  const errors: Partial<Record<string, string>> = {};
  if (!state.title.trim()) errors['title'] = 'Title is required.';
  if (!state.start.trim()) errors['start'] = 'Start date/time is required.';
  if (!state.end.trim()) errors['end'] = 'End date/time is required.';
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return OK;
}

/**
 * buildCreateEventPayload — construct the exact args for invoke('create_event', ...).
 * Mirrors createEvent(input) in invoke.ts.
 *
 * Spec SP3: for all-day events, tzid is omitted; is_all_day is set to true.
 */
export function buildCreateEventPayload(state: EventFormState): {
  input: {
    title: string;
    start: string;
    end: string;
    tzid?: string;
    is_all_day?: boolean;
    description?: string;
    location?: string;
    recurrence?: import('../../invoke').RecurrenceDraft;
  };
} {
  return {
    input: {
      title: state.title.trim(),
      start: state.start.trim(),
      end: state.end.trim(),
      // For all-day events, omit tzid entirely (no time zone concept)
      tzid: !state.isAllDay && state.tzid.trim() ? state.tzid.trim() : undefined,
      is_all_day: state.isAllDay ? true : undefined,
      description: state.description.trim() || undefined,
      location: state.location.trim() || undefined,
      recurrence: state.recurrence,
    },
  };
}
