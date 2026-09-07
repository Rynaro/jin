// @vitest-environment jsdom

import { Application } from '@hotwired/stimulus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarController from '../controllers/calendar_controller';
import TemporalEditorController, { type TemporalEditorCommit } from '../controllers/temporal_editor_controller';

vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

function installDialogStubs(): void {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
}

describe('TemporalEditorController', () => {
  let app: Application;
  let editor: TemporalEditorController;
  let dialog: HTMLDialogElement;
  let commits: TemporalEditorCommit[];

  beforeEach(async () => {
    installDialogStubs();
    document.body.innerHTML = `
      <template id="tmpl-calendar">
        <div class="calendar-widget">
          <button class="calendar-widget__year-prev"></button>
          <button class="calendar-widget__month-prev"></button>
          <span class="calendar-widget__month-label"></span>
          <button class="calendar-widget__month-next"></button>
          <button class="calendar-widget__year-next"></button>
          <div class="calendar-widget__weekdays"></div>
          <div class="calendar-widget__grid"></div>
          <button class="calendar-widget__today-btn"></button>
          <button class="calendar-widget__clear-btn"></button>
          <button class="calendar-widget__commit-btn" hidden></button>
        </div>
      </template>
      <button id="opener">Open</button>
      <dialog data-controller="temporal-editor"
        data-action="calendar:selected->temporal-editor#select calendar:cancel->temporal-editor#cancelDraft cancel->temporal-editor#cancelDraft">
        <h2 data-temporal-editor-target="title">Set Due Date</h2>
        <label data-temporal-editor-target="naturalLabel"></label>
        <input type="text" data-temporal-editor-target="natural" data-action="input->temporal-editor#naturalChanged keydown.enter->temporal-editor#applyNatural">
        <button data-temporal-editor-target="naturalUse" data-action="click->temporal-editor#applyNatural">Use</button>
        <p data-temporal-editor-target="naturalPreview"></p>
        <div data-controller="calendar" data-calendar-mode-value="single" data-temporal-editor-target="calendar"></div>
        <label><span data-temporal-editor-target="timeLabel">Time (optional)</span>
          <input type="text" data-temporal-editor-target="time" data-action="input->temporal-editor#timeChanged blur->temporal-editor#normalizeTime">
        </label>
        <p data-temporal-editor-target="summary"></p>
        <p class="hidden" data-temporal-editor-target="error"></p>
        <button data-action="click->temporal-editor#cancelDraft">Cancel</button>
        <button data-temporal-editor-target="confirm" data-action="click->temporal-editor#confirm">Set Date</button>
      </dialog>`;
    app = Application.start();
    app.handleError = (error) => { throw error; };
    app.register('calendar', CalendarController);
    app.register('temporal-editor', TemporalEditorController);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    dialog = document.querySelector('dialog')!;
    editor = app.getControllerForElementAndIdentifier(dialog, 'temporal-editor') as TemporalEditorController;
    commits = [];
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps date selection as a draft until time is entered and confirmed', () => {
    editor.open({ initialDue: null, onCommit: (result) => commits.push(result) });
    dialog.dispatchEvent(new CustomEvent('calendar:selected', {
      bubbles: true,
      detail: { iso: '2026-07-15' },
    }));

    expect(dialog.open).toBe(true);
    expect(commits).toEqual([]);

    const time = dialog.querySelector('[data-temporal-editor-target="time"]') as HTMLInputElement;
    time.value = '14:30';
    time.dispatchEvent(new Event('input', { bubbles: true }));
    editor.confirm();

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      kind: 'set',
      date: '2026-07-15',
      time: '14:30',
    });
    expect((commits[0] as Extract<TemporalEditorCommit, { kind: 'set' }>).due)
      .toContain('2026-07-15T14:30:00');
  });

  it('rehydrates an existing RFC-3339 value into its encoded HH:mm fields', () => {
    editor.open({
      initialDue: '2026-07-15T23:45:00-10:00',
      onCommit: (result) => commits.push(result),
    });

    expect((dialog.querySelector('[data-temporal-editor-target="time"]') as HTMLInputElement).value).toBe('23:45');
    expect(dialog.querySelector('[data-temporal-editor-target="summary"]')?.textContent)
      .toBe('Due 2026-07-15 at 23:45');
  });

  it('emits an explicit clear only after confirmation', () => {
    editor.open({ initialDue: '2026-07-15', onCommit: (result) => commits.push(result) });
    dialog.dispatchEvent(new CustomEvent('calendar:selected', {
      bubbles: true,
      detail: { iso: '' },
    }));
    expect(commits).toEqual([]);
    editor.confirm();
    expect(commits).toEqual([{ kind: 'clear' }]);
  });

  it('cancels without mutation and restores focus', () => {
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    editor.open({ initialDue: '2026-07-15', onCommit: (result) => commits.push(result) });
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(commits).toEqual([]);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('replaces an active session without committing its abandoned draft', () => {
    const firstCommit = vi.fn();
    editor.open({ initialDue: '2026-07-15', onCommit: firstCommit });
    editor.open({ initialDue: '2026-08-20', onCommit: (result) => commits.push(result) });
    editor.confirm();

    expect(firstCommit).not.toHaveBeenCalled();
    expect(commits).toEqual([{
      kind: 'set',
      due: '2026-08-20',
      date: '2026-08-20',
      time: '',
    }]);
  });

  it('normalizes compact hour input on confirm instead of letting the browser reinterpret it', () => {
    editor.open({ initialDue: '2026-07-15', onCommit: (result) => commits.push(result) });
    const time = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="time"]')!;
    time.value = '16';
    editor.confirm();

    expect(commits[0]).toMatchObject({ kind: 'set', date: '2026-07-15', time: '16:00' });
    expect((commits[0] as Extract<TemporalEditorCommit, { kind: 'set' }>).due)
      .toContain('2026-07-15T16:00:00');
  });

  it('keeps an invalid clock draft open, explains it, and focuses the field', () => {
    editor.open({ initialDue: '2026-07-15', onCommit: (result) => commits.push(result) });
    const time = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="time"]')!;
    time.value = '16:2';
    editor.confirm();

    expect(commits).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(time);
    expect(dialog.querySelector('[data-temporal-editor-target="error"]')?.textContent).toContain('9:30');
  });

  it('previews natural text without mutation, then applies date-only text while preserving time', () => {
    editor.open({ initialDue: '2026-07-15T16:20:00-03:00', onCommit: (result) => commits.push(result) });
    const natural = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="natural"]')!;
    natural.value = '2026-08-28';
    natural.dispatchEvent(new Event('input', { bubbles: true }));

    expect(dialog.querySelector('[data-temporal-editor-target="summary"]')?.textContent).toBe('Due 2026-07-15 at 16:20');
    expect(dialog.querySelector('[data-temporal-editor-target="naturalPreview"]')?.dataset.state).toBe('valid');

    editor.applyNatural();
    editor.confirm();
    expect(commits[0]).toMatchObject({ kind: 'set', date: '2026-08-28', time: '16:20' });
  });

  it('applies natural date and time together', () => {
    editor.open({ initialDue: null, onCommit: (result) => commits.push(result) });
    const natural = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="natural"]')!;
    natural.value = '2026-08-28 09:30';
    editor.applyNatural();
    editor.confirm();

    expect(commits[0]).toMatchObject({ kind: 'set', date: '2026-08-28', time: '09:30' });
  });

  it('uses event presentation, requires a date, and keeps natural-language entry', () => {
    editor.open({
      initialDue: null,
      presentation: 'event',
      requireDate: true,
      onCommit: (result) => commits.push(result),
    });

    expect(dialog.getAttribute('aria-label')).toBe('Set event date and time');
    expect(dialog.querySelector('[data-temporal-editor-target="title"]')?.textContent).toBe('When');
    expect(dialog.querySelector('[data-temporal-editor-target="confirm"]')?.textContent).toBe('Set When');
    editor.confirm();
    expect(commits).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-temporal-editor-target="error"]')?.textContent).toContain('Choose a date');

    const natural = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="natural"]')!;
    natural.value = '2026-08-28 09:30';
    editor.applyNatural();
    editor.confirm();
    expect(commits[0]).toMatchObject({ kind: 'set', date: '2026-08-28', time: '09:30' });
  });

  it('restores Task presentation after an Event session', () => {
    editor.open({ initialDue: '2026-08-28', presentation: 'event', requireDate: true, onCommit: vi.fn() });
    editor.cancelDraft();
    editor.open({ initialDue: null, onCommit: vi.fn() });

    expect(dialog.getAttribute('aria-label')).toBe('Set due date');
    expect(dialog.querySelector('[data-temporal-editor-target="title"]')?.textContent).toBe('Set Due Date');
    expect(dialog.querySelector('[data-temporal-editor-target="confirm"]')?.textContent).toBe('Set Date');
    expect(dialog.querySelector('[data-temporal-editor-target="summary"]')?.textContent).toBe('No due date selected');
  });

  it('uses notification presentation, requires time, and keeps custom validation in the dialog', () => {
    const validate = vi.fn((result: Extract<TemporalEditorCommit, { kind: 'set' }>) => (
      result.date === '2026-08-28' ? 'Choose a future date and time within 30 days.' : null
    ));
    editor.open({
      initialDue: null,
      presentation: 'notification',
      requireDate: true,
      requireTime: true,
      validate,
      onCommit: (result) => commits.push(result),
    });

    expect(dialog.getAttribute('aria-label')).toBe('Choose custom defer date and time');
    expect(dialog.querySelector('[data-temporal-editor-target="title"]')?.textContent).toBe('Custom defer time');
    expect(dialog.querySelector('[data-temporal-editor-target="confirm"]')?.textContent).toBe('Defer notification');
    expect(dialog.querySelector('[data-temporal-editor-target="summary"]')?.textContent).toBe('Choose a date and time');

    dialog.dispatchEvent(new CustomEvent('calendar:selected', {
      bubbles: true,
      detail: { iso: '2026-08-28' },
    }));
    editor.confirm();
    expect(commits).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-temporal-editor-target="error"]')?.textContent)
      .toBe('Choose a time to defer this notification.');

    const time = dialog.querySelector<HTMLInputElement>('[data-temporal-editor-target="time"]')!;
    time.value = '09:30';
    editor.confirm();
    expect(validate).toHaveBeenCalled();
    expect(commits).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-temporal-editor-target="error"]')?.textContent)
      .toBe('Choose a future date and time within 30 days.');

    dialog.dispatchEvent(new CustomEvent('calendar:selected', {
      bubbles: true,
      detail: { iso: '2026-08-29' },
    }));
    editor.confirm();
    expect(commits[0]).toMatchObject({ kind: 'set', date: '2026-08-29', time: '09:30' });
    expect(dialog.open).toBe(false);
  });
});
