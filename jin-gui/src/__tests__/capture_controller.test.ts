// @vitest-environment jsdom
/**
 * capture_controller.test.ts — headless unit tests for create forms (GUI-S4).
 *
 * Tests two layers:
 *   1. Pure logic from lib/capture/transform.ts (no DOM)
 *   2. DOM rendering from lib/capture/render.ts (jsdom)
 *
 * Headless gates verified here (spec GUI-S4 AC):
 *
 * validateCaptureForm:
 *   ✓ empty text rejected (required-field gate)
 *   ✓ non-empty text accepted
 *
 * buildCapturePayload — exact args for invoke('capture', ...):
 *   ✓ text trimmed; as_task omitted when false; list omitted when empty
 *   ✓ as_task=true forwarded; list forwarded
 *
 * validateNoteForm:
 *   ✓ empty title rejected
 *   ✓ non-empty title accepted
 *
 * buildCreateNotePayload — exact args for invoke('create_note', ...):
 *   ✓ title + body + parsed tags
 *   ✓ body and tags omitted when empty
 *
 * parseTags:
 *   ✓ splits comma-separated tags; trims whitespace; removes empties
 *
 * validateTaskForm:
 *   ✓ empty title rejected
 *   ✓ title accepted
 *
 * buildCreateTaskPayload — exact args for invoke('create_task', ...):
 *   ✓ all fields forwarded; optional fields omitted when empty
 *
 * validateEventForm:
 *   ✓ all required fields (title, start, end) rejected individually
 *   ✓ all three present → valid
 *
 * buildCreateEventPayload — exact args for invoke('create_event', ...):
 *   ✓ timed event: tzid forwarded, is_all_day omitted
 *   ✓ all-day event: tzid omitted, is_all_day=true set
 *   ✓ optional description + location forwarded / omitted
 *
 * renderFormError / clearFormError:
 *   ✓ JinErrorDto.message shown in error element, 'hidden' class removed (a11y)
 *   ✓ clearFormError hides and clears the element
 *
 * setFormBusy:
 *   ✓ disabled attribute set; aria-busy="true"
 *   ✓ disabled cleared; aria-busy="false"
 *
 * clearAllFormErrors:
 *   ✓ clears all [data-form-error] elements in a container
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@hotwired/stimulus';
import CaptureController from '../controllers/capture_controller';
import { listGoogleAccounts } from '../invoke';
import { draftFromCapture, createInputFromDraft } from '../lib/events/draft';
import type { JinErrorDto } from '../types/error';
import {
  validateCaptureForm,
  buildCapturePayload,
  validateNoteForm,
  buildCreateNotePayload,
  parseTags,
  validateTaskForm,
  buildCreateTaskPayload,
  validateEventForm,
  buildCreateEventPayload,
  splitNoteDocument,
  type CaptureFormState,
  type NoteFormState,
  type TaskFormState,
  type EventFormState,
} from '../lib/capture/transform';
import {
  renderFormError,
  clearFormError,
  setFormBusy,
  clearAllFormErrors,
} from '../lib/capture/render';

// ─────────────────────────────────────────────────────────────────────────────
// 1. validateCaptureForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCaptureForm', () => {
  it('rejects empty text (required field)', () => {
    const state: CaptureFormState = { text: '', asTask: false, list: '' };
    const result = validateCaptureForm(state);
    expect(result.valid).toBe(false);
    expect(result.errors['text']).toBeTruthy();
  });

  it('rejects whitespace-only text', () => {
    const state: CaptureFormState = { text: '   ', asTask: false, list: '' };
    expect(validateCaptureForm(state).valid).toBe(false);
  });

  it('accepts non-empty text', () => {
    const state: CaptureFormState = { text: 'Quick note', asTask: false, list: '' };
    expect(validateCaptureForm(state).valid).toBe(true);
  });

  it('accepts text with asTask=true', () => {
    const state: CaptureFormState = { text: 'Buy milk', asTask: true, list: 'inbox' };
    expect(validateCaptureForm(state).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. buildCapturePayload — exact args for invoke('capture', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCapturePayload', () => {
  it('trims text; as_task and list omitted when false/empty', () => {
    const state: CaptureFormState = { text: '  Quick note  ', asTask: false, list: '' };
    const payload = buildCapturePayload(state);
    expect(payload).toEqual({ text: 'Quick note', as_task: undefined, list: undefined });
  });

  it('includes as_task=true when checked', () => {
    const state: CaptureFormState = { text: 'Buy groceries', asTask: true, list: '' };
    const payload = buildCapturePayload(state);
    expect(payload.as_task).toBe(true);
  });

  it('forwards list when provided', () => {
    const state: CaptureFormState = { text: 'Do something', asTask: true, list: 'inbox' };
    const payload = buildCapturePayload(state);
    expect(payload.list).toBe('inbox');
  });

  it('exact args for note capture: { text, as_task: undefined, list: undefined }', () => {
    const payload = buildCapturePayload({ text: 'Hello world', asTask: false, list: '' });
    expect(payload).toEqual({ text: 'Hello world', as_task: undefined, list: undefined });
  });

  it('exact args for task capture: { text, as_task: true, list: "inbox" }', () => {
    const payload = buildCapturePayload({ text: 'Buy milk', asTask: true, list: 'inbox' });
    expect(payload).toEqual({ text: 'Buy milk', as_task: true, list: 'inbox' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateNoteForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateNoteForm', () => {
  it('rejects empty title', () => {
    const state: NoteFormState = { title: '', body: '', tags: '' };
    const result = validateNoteForm(state);
    expect(result.valid).toBe(false);
    expect(result.errors['title']).toBeTruthy();
  });

  it('rejects whitespace-only title', () => {
    expect(validateNoteForm({ title: '  ', body: '', tags: '' }).valid).toBe(false);
  });

  it('accepts title — body and tags optional', () => {
    expect(validateNoteForm({ title: 'My Note', body: '', tags: '' }).valid).toBe(true);
  });

  it('accepts title with body and tags', () => {
    expect(validateNoteForm({ title: 'My Note', body: 'Content', tags: 'work' }).valid).toBe(true);
  });
});

describe('splitNoteDocument', () => {
  it('derives the title from the trimmed first physical line', () => {
    expect(splitNoteDocument('  Project pulse  \nBody **markdown**')).toEqual({
      title: 'Project pulse',
      body: 'Body **markdown**',
    });
  });

  it('preserves body whitespace and internal markdown', () => {
    expect(splitNoteDocument('Title\n\n- one\n- two\n')).toEqual({
      title: 'Title',
      body: '\n- one\n- two\n',
    });
  });

  it('leaves a blank first line invalid instead of guessing a later title', () => {
    const state = { ...splitNoteDocument('\nBody'), tags: '' };
    expect(validateNoteForm(state).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parseTags
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTags', () => {
  it('splits comma-separated tags', () => {
    expect(parseTags('work, urgent, q3')).toEqual(['work', 'urgent', 'q3']);
  });

  it('trims whitespace from each tag', () => {
    expect(parseTags('  work  ,  urgent  ')).toEqual(['work', 'urgent']);
  });

  it('removes empty entries', () => {
    expect(parseTags('work,,urgent,')).toEqual(['work', 'urgent']);
  });

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseTags('   ')).toEqual([]);
  });

  it('handles single tag without comma', () => {
    expect(parseTags('work')).toEqual(['work']);
  });

  it('normalizes hashes and casing and removes duplicates', () => {
    expect(parseTags('#Work, work, #URGENT')).toEqual(['work', 'urgent']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. buildCreateNotePayload — exact args for invoke('create_note', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCreateNotePayload', () => {
  it('exact args: title + body + tags', () => {
    const payload = buildCreateNotePayload({ title: 'My Note', body: 'Body text', tags: 'work, urgent' });
    expect(payload).toEqual({
      input: {
        title: 'My Note',
        body: 'Body text',
        tags: ['work', 'urgent'],
      },
    });
  });

  it('omits body when empty', () => {
    const payload = buildCreateNotePayload({ title: 'My Note', body: '', tags: '' });
    expect(payload.input.body).toBeUndefined();
  });

  it('omits tags when empty', () => {
    const payload = buildCreateNotePayload({ title: 'My Note', body: '', tags: '' });
    expect(payload.input.tags).toBeUndefined();
  });

  it('trims title whitespace', () => {
    const payload = buildCreateNotePayload({ title: '  Trimmed  ', body: '', tags: '' });
    expect(payload.input.title).toBe('Trimmed');
  });

  it('exact args for minimal note: { input: { title } }', () => {
    const payload = buildCreateNotePayload({ title: 'Hello', body: '', tags: '' });
    expect(payload).toEqual({ input: { title: 'Hello', body: undefined, tags: undefined } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. validateTaskForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTaskForm', () => {
  it('rejects empty title', () => {
    const result = validateTaskForm({ title: '', priority: '', due: '', list: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['title']).toBeTruthy();
  });

  it('accepts title — priority, due, list optional', () => {
    expect(validateTaskForm({ title: 'Buy milk', priority: '', due: '', list: '' }).valid).toBe(true);
  });

  it('accepts title with all optional fields', () => {
    const state: TaskFormState = {
      title: 'Buy milk',
      priority: 'high',
      due: '2026-07-01',
      list: 'inbox',
    };
    expect(validateTaskForm(state).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. buildCreateTaskPayload — exact args for invoke('create_task', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCreateTaskPayload', () => {
  it('exact args: title + priority + due + list', () => {
    const state: TaskFormState = {
      title: 'Buy milk',
      priority: 'high',
      due: '2026-07-01',
      list: 'inbox',
    };
    expect(buildCreateTaskPayload(state)).toEqual({
      input: {
        title: 'Buy milk',
        priority: 'high',
        due: '2026-07-01',
        list: 'inbox',
      },
    });
  });

  it('omits priority, due, list when empty', () => {
    const payload = buildCreateTaskPayload({ title: 'Task', priority: '', due: '', list: '' });
    expect(payload.input.priority).toBeUndefined();
    expect(payload.input.due).toBeUndefined();
    expect(payload.input.list).toBeUndefined();
  });

  it('exact args for minimal task: { input: { title } }', () => {
    expect(buildCreateTaskPayload({ title: 'Simple', priority: '', due: '', list: '' })).toEqual({
      input: { title: 'Simple', priority: undefined, due: undefined, list: undefined },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. validateEventForm
// ─────────────────────────────────────────────────────────────────────────────

describe('validateEventForm', () => {
  const baseState: EventFormState = {
    title: 'Standup',
    start: '2026-07-01T09:00',
    end: '2026-07-01T09:30',
    tzid: 'UTC',
    isAllDay: false,
    description: '',
    location: '',
  };

  it('rejects empty title', () => {
    const result = validateEventForm({ ...baseState, title: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['title']).toBeTruthy();
  });

  it('rejects empty start', () => {
    const result = validateEventForm({ ...baseState, start: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['start']).toBeTruthy();
  });

  it('rejects empty end', () => {
    const result = validateEventForm({ ...baseState, end: '' });
    expect(result.valid).toBe(false);
    expect(result.errors['end']).toBeTruthy();
  });

  it('accepts all required fields present', () => {
    expect(validateEventForm(baseState).valid).toBe(true);
  });

  it('business logic (end < start) is NOT rejected by GUI — surfaced by core', () => {
    // Spec: "surfaces the core's validation rejection, no invented logic"
    const inverted = { ...baseState, start: '2026-07-01T10:00', end: '2026-07-01T09:00' };
    expect(validateEventForm(inverted).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. buildCreateEventPayload — exact args for invoke('create_event', ...)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCreateEventPayload', () => {
  it('timed event: tzid forwarded, is_all_day omitted', () => {
    const state: EventFormState = {
      title: 'Standup',
      start: '2026-07-01T09:00',
      end: '2026-07-01T09:30',
      tzid: 'America/New_York',
      isAllDay: false,
      description: '',
      location: '',
    };
    const payload = buildCreateEventPayload(state);
    expect(payload.input.tzid).toBe('America/New_York');
    expect(payload.input.is_all_day).toBeUndefined();
  });

  it('all-day event: is_all_day=true, tzid omitted regardless of tzid field', () => {
    const state: EventFormState = {
      title: 'Holiday',
      start: '2026-07-04',
      end: '2026-07-04',
      tzid: 'America/New_York', // should be omitted for all-day
      isAllDay: true,
      description: '',
      location: '',
    };
    const payload = buildCreateEventPayload(state);
    expect(payload.input.is_all_day).toBe(true);
    expect(payload.input.tzid).toBeUndefined();
  });

  it('omits tzid when empty for timed event', () => {
    const state: EventFormState = {
      title: 'Floating',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      tzid: '',
      isAllDay: false,
      description: '',
      location: '',
    };
    const payload = buildCreateEventPayload(state);
    expect(payload.input.tzid).toBeUndefined();
  });

  it('includes description and location when provided', () => {
    const state: EventFormState = {
      title: 'Meeting',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      tzid: '',
      isAllDay: false,
      description: 'Team sync',
      location: 'Room 3B',
    };
    const payload = buildCreateEventPayload(state);
    expect(payload.input.description).toBe('Team sync');
    expect(payload.input.location).toBe('Room 3B');
  });

  it('omits description and location when empty', () => {
    const state: EventFormState = {
      title: 'Meeting',
      start: '2026-07-01T10:00',
      end: '2026-07-01T11:00',
      tzid: '',
      isAllDay: false,
      description: '',
      location: '',
    };
    const payload = buildCreateEventPayload(state);
    expect(payload.input.description).toBeUndefined();
    expect(payload.input.location).toBeUndefined();
  });

  it('exact args for a full timed event', () => {
    const state: EventFormState = {
      title: 'Standup',
      start: '2026-07-01T09:00',
      end: '2026-07-01T09:30',
      tzid: 'UTC',
      isAllDay: false,
      description: 'Daily',
      location: 'Zoom',
    };
    expect(buildCreateEventPayload(state)).toEqual({
      input: {
        title: 'Standup',
        start: '2026-07-01T09:00',
        end: '2026-07-01T09:30',
        tzid: 'UTC',
        is_all_day: undefined,
        description: 'Daily',
        location: 'Zoom',
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. renderFormError — JinErrorDto.message → inline error displayed (DOM test)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderFormError', () => {
  it('shows the error message in the error element', () => {
    const errorEl = document.createElement('p');
    errorEl.classList.add('hidden');
    renderFormError(errorEl, 'Title is required.');
    expect(errorEl.textContent).toBe('Title is required.');
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('sets role="alert" for immediate screen-reader announcement', () => {
    const errorEl = document.createElement('p');
    renderFormError(errorEl, 'Some error');
    expect(errorEl.getAttribute('role')).toBe('alert');
  });

  it('sets aria-live="polite"', () => {
    const errorEl = document.createElement('p');
    renderFormError(errorEl, 'Some error');
    expect(errorEl.getAttribute('aria-live')).toBe('polite');
  });

  it('JinErrorDto.message surfaces as inline error — invalid-tz example', () => {
    // Spec: "JinErrorDto → inline error rendered (e.g. invalid-tz promote → error shown, no crash)"
    const errDto: JinErrorDto = {
      code: 2,
      kind: 'usage',
      message: 'Invalid timezone: Foo/Bar',
      retriable: false,
    };
    const errorEl = document.createElement('p');
    errorEl.classList.add('hidden');
    // The controller calls renderFormError(errorEl, err.message) on JinErrorDto
    renderFormError(errorEl, errDto.message);
    expect(errorEl.textContent).toContain('Invalid timezone: Foo/Bar');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    // No crash: test completes successfully
  });

  it('JinErrorDto code:3 (not-found) message surfaces inline', () => {
    const errDto: JinErrorDto = {
      code: 3,
      kind: 'not_found',
      message: 'Task not found: task-xyz',
      retriable: false,
    };
    const errorEl = document.createElement('p');
    renderFormError(errorEl, errDto.message);
    expect(errorEl.textContent).toContain('Task not found: task-xyz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. clearFormError
// ─────────────────────────────────────────────────────────────────────────────

describe('clearFormError', () => {
  it('clears text and adds hidden class', () => {
    const errorEl = document.createElement('p');
    errorEl.textContent = 'Some error';
    clearFormError(errorEl);
    expect(errorEl.textContent).toBe('');
    expect(errorEl.classList.contains('hidden')).toBe(true);
  });

  it('removes role attribute', () => {
    const errorEl = document.createElement('p');
    errorEl.setAttribute('role', 'alert');
    clearFormError(errorEl);
    expect(errorEl.getAttribute('role')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. setFormBusy
// ─────────────────────────────────────────────────────────────────────────────

describe('setFormBusy', () => {
  it('disables button and sets aria-busy="true" when busy', () => {
    const btn = document.createElement('button');
    setFormBusy(btn, true);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('re-enables button and sets aria-busy="false" when not busy', () => {
    const btn = document.createElement('button');
    btn.disabled = true;
    setFormBusy(btn, false);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. clearAllFormErrors
// ─────────────────────────────────────────────────────────────────────────────

describe('clearAllFormErrors', () => {
  it('clears all [data-form-error] elements in a container', () => {
    const form = document.createElement('div');
    const err1 = document.createElement('p');
    err1.setAttribute('data-form-error', '');
    err1.textContent = 'Error 1';
    const err2 = document.createElement('p');
    err2.setAttribute('data-form-error', '');
    err2.textContent = 'Error 2';
    form.appendChild(err1);
    form.appendChild(err2);

    clearAllFormErrors(form);
    expect(err1.textContent).toBe('');
    expect(err1.classList.contains('hidden')).toBe(true);
    expect(err2.textContent).toBe('');
    expect(err2.classList.contains('hidden')).toBe(true);
  });

  it('does not touch elements without [data-form-error]', () => {
    const form = document.createElement('div');
    const other = document.createElement('p');
    other.textContent = 'Unrelated';
    form.appendChild(other);
    clearAllFormErrors(form);
    expect(other.textContent).toBe('Unrelated');
  });
});


vi.mock('../invoke', () => ({
  capture: vi.fn(),
  createNote: vi.fn(),
  createTask: vi.fn(),
  createEvent: vi.fn(),
  createRoutedEvent: vi.fn(),
  listGoogleAccounts: vi.fn(async () => []),
  listLists: vi.fn(async () => []),
  newOperationId: vi.fn(() => 'create-op'),
  getEventDetailById: vi.fn(),
}));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));
vi.mock('../lib/notes/editor', () => ({
  mountCompactEditor: () => ({ setDoc: vi.fn(), getDoc: () => '', destroy: vi.fn() }),
}));

describe('CaptureController event_draft_handoff (AC-CALX-028)', () => {
  let app: Application;

  beforeEach(() => {
    vi.mocked(listGoogleAccounts).mockResolvedValue([]);
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value() { this.setAttribute('open', ''); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value() { this.removeAttribute('open'); },
    });
    document.body.innerHTML = `
      <div data-controller="capture">
        <dialog data-capture-target="modal" open>
          <h2 data-capture-target="modeTitle"></h2>
          <p data-capture-target="modeSubtitle"></p>
          <button data-capture-target="tabCapture"></button>
          <button data-capture-target="tabNote"></button>
          <button data-capture-target="tabTask"></button>
          <button data-capture-target="tabEvent"></button>
          <div data-capture-target="formCapture"></div>
          <div data-capture-target="formNote" class="hidden">
            <div data-capture-target="noteEditor"></div>
            <input data-capture-target="noteTags" />
            <p data-capture-target="noteError" data-form-error></p>
            <button data-capture-target="noteSubmit"></button>
          </div>
          <div data-capture-target="formTask" class="hidden">
            <input data-capture-target="taskTitle" />
            <select data-capture-target="taskPriority"><option value=""></option></select>
            <input data-capture-target="taskDue" />
            <button data-capture-target="taskDueTrigger"></button>
            <span data-capture-target="taskDueLabel"></span>
            <select data-capture-target="taskList"><option value="inbox">Inbox</option></select>
            <p data-capture-target="taskError" data-form-error></p>
            <button data-capture-target="taskSubmit"></button>
          </div>
          <div data-capture-target="formEvent" class="hidden">
            <input data-capture-target="eventTitle" />
            <input type="hidden" data-capture-target="eventWhen" value="2026-09-23T14:00" />
            <button data-capture-target="eventWhenTrigger"></button>
            <span data-capture-target="eventWhenLabel"></span>
            <select data-capture-target="eventDestination"><option value="local">Jin only</option></select>
            <input data-capture-target="eventLocation" />
            <p data-capture-target="eventError" data-form-error></p>
            <button data-capture-target="eventMoreOptions" data-action="click->capture#openMoreEventOptions">More event options</button>
            <div data-capture-target="eventDiscard" class="hidden" hidden></div>
            <button data-capture-target="eventSubmit"></button>
          </div>
          <textarea data-capture-target="captureText"></textarea>
          <input type="checkbox" data-capture-target="captureAsTask" />
          <select data-capture-target="captureList"><option value="inbox">Inbox</option></select>
          <p data-capture-target="captureError" data-form-error></p>
          <button data-capture-target="captureSubmit"></button>
        </dialog>
      </div>`;
    app = Application.start();
    app.register('capture', CaptureController);
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
  });

  it('More event options hands the same title/when/location/destination into Composer', async () => {
    await Promise.resolve();
    const host = document.querySelector<HTMLElement>('[data-controller="capture"]')!;
    const controller = app.getControllerForElementAndIdentifier(host, 'capture') as CaptureController;
    controller.selectEvent();
    const title = document.querySelector<HTMLInputElement>('[data-capture-target="eventTitle"]')!;
    const location = document.querySelector<HTMLInputElement>('[data-capture-target="eventLocation"]')!;
    title.value = 'Capture handoff';
    location.value = 'Studio';
    document.querySelector<HTMLInputElement>('[data-capture-target="eventWhen"]')!.value = '2026-09-23T14:00';

    controller.openMoreEventOptions();
    await Promise.resolve();

    const composerTitle = document.querySelector<HTMLInputElement>('#event-composer-title');
    expect(composerTitle?.value).toBe('Capture handoff');
    const draft = (controller as unknown as { handedOffDraft: ReturnType<typeof draftFromCapture> | null }).handedOffDraft;
    expect(draft).toBeTruthy();
    expect(draft!.title).toBe('Capture handoff');
    expect(draft!.location).toBe('Studio');
    expect(draft!.temporal.start_date).toBe('2026-09-23');
    expect(draft!.temporal.start_time).toBe('14:00');
    expect(createInputFromDraft(draft!)).toMatchObject({
      title: 'Capture handoff',
      location: 'Studio',
      start: '2026-09-23T14:00:00',
    });
  });

  it('carries the exact selected account/calendar through Capture and Composer', async () => {
    const calendar = (accountId: string) => ({
      account_id: accountId, calendar_id: 'team-primary', name: 'Team Calendar',
      primary: true, access_role: 'owner', writable: true, enabled: true, available: true,
      route_generation: 1, allowed_conference_solution_types: [],
    });
    vi.mocked(listGoogleAccounts).mockResolvedValue([
      { id: 'acct-home', alias: 'Home', principal: null, state: 'connected', auth_generation: 1, calendars: [calendar('acct-home')] },
      { id: 'acct-work', alias: 'Work', principal: null, state: 'connected', auth_generation: 1, calendars: [calendar('acct-work')] },
    ]);
    const host = document.querySelector<HTMLElement>('[data-controller="capture"]')!;
    const controller = app.getControllerForElementAndIdentifier(host, 'capture') as CaptureController;
    await (controller as unknown as { populateEventDestinations: () => Promise<void> }).populateEventDestinations();
    controller.selectEvent();
    document.querySelector<HTMLInputElement>('[data-capture-target="eventTitle"]')!.value = 'Capture handoff review';
    const native = document.querySelector<HTMLSelectElement>('[data-capture-target="eventDestination"]')!;
    const combobox = native.parentElement!.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    combobox.click();
    const work = Array.from(document.querySelectorAll<HTMLButtonElement>('.jin-select-field__option'))
      .find(option => option.textContent === 'Work · Team Calendar')!;
    work.click();
    expect(native.value).toBe('acct-work\u0000team-primary');

    controller.openMoreEventOptions();
    expect(document.querySelector<HTMLSelectElement>('#event-composer-destination')?.selectedOptions[0].text)
      .toBe('Work · Team Calendar');
  });
});
