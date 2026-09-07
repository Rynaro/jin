/**
 * CaptureController — Stimulus controller for the quick-capture sheet and
 * full create forms for note / task / event (GUI-S4).
 *
 * The controller is a thin Stimulus adapter: all validation and payload
 * construction is delegated to lib/capture/transform.ts; DOM error rendering
 * is delegated to lib/capture/render.ts.
 *
 * Connect pattern: data-controller="capture" on the .jin-shell element.
 *
 * Targets (all inside #jin-capture-modal <dialog>):
 *   modal           — the <dialog> element itself
 *   captureText     — <textarea> for quick-capture text
 *   captureAsTask   — <input type="checkbox"> for task toggle
 *   captureList     — <select> for list (id-valued, populated from listLists)
 *   captureError    — <p data-form-error> for capture error display
 *   captureSubmit   — <button type="submit"> for capture form
 *   noteEditor / noteTags / noteError / noteSubmit
 *   taskTitle / taskPriority / taskDue / taskList / taskError / taskSubmit
 *   eventTitle / eventWhen / eventWhenTrigger / eventWhenLabel
 *   eventDestination / eventLocation / eventError / eventSubmit
 *   tabCapture / tabNote / tabTask / tabEvent — tab selector buttons
 *   formCapture / formNote / formTask / formEvent — form panels (shown/hidden)
 *
 * Actions wired in HTML:
 *   capture#open         — sidebar capture button click
 *   capture#close        — modal close button / backdrop click
 *   capture#selectNote / selectTask / selectEvent / selectCapture — tab buttons
 *   capture#tabKeydown  — roving arrow/Home/End keyboard navigation
 *   capture#submitCapture / submitNote / submitTask / submitEvent — form submits
 *
 * After successful create:
 *   Dispatches jin:navigate { kind, id } which RouterController handles to open
 *   the new item's detail (this is the post-mutation refresh: detail re-fetch via core).
 */

import { Controller } from '@hotwired/stimulus';
import {
  validateCaptureForm,
  buildCapturePayload,
  validateNoteForm,
  buildCreateNotePayload,
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
import type TemporalEditorController from './temporal_editor_controller';
import {
  renderFormError,
  clearFormError,
  setFormBusy,
  clearAllFormErrors,
} from '../lib/capture/render';
import { isJinErrorDto } from '../types/error';
import {
  capture, createNote, createTask, createEvent, createRoutedEvent,
  listGoogleAccounts, listLists, newOperationId,
} from '../invoke';
import { populateListFilter } from '../lib/lists/render';
import { initIcons } from '../lib/icons';
import { mountCompactEditor, type CompactEditorHandle } from '../lib/notes/editor';
import { JinSelectField } from '../lib/ui/select';
import { TagInput } from '../lib/ui/tag_input';

export default class CaptureController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'modal',
    'modeTitle',
    'modeSubtitle',
    'captureText',
    'captureAsTask',
    'captureList',
    'captureError',
    'captureSubmit',
    'noteEditor',
    'noteTags',
    'noteError',
    'noteSubmit',
    'taskTitle',
    'taskPriority',
    'taskDue',
    'taskDueTrigger',
    'taskDueLabel',
    'taskList',
    'taskError',
    'taskSubmit',
    'eventTitle',
    'eventWhen',
    'eventWhenTrigger',
    'eventWhenLabel',
    'eventDestination',
    'eventLocation',
    'eventError',
    'eventSubmit',
    'tabCapture',
    'tabNote',
    'tabTask',
    'tabEvent',
    'formCapture',
    'formNote',
    'formTask',
    'formEvent',
    // P8: due date picker
    'dueDateDialog',
  ];

  declare modalTarget: HTMLDialogElement;
  declare modeTitleTarget: HTMLElement;
  declare modeSubtitleTarget: HTMLElement;
  declare captureTextTarget: HTMLTextAreaElement;
  declare captureAsTaskTarget: HTMLInputElement;
  // S6: converted from HTMLInputElement (free text) to HTMLSelectElement (id-valued).
  declare captureListTarget: HTMLSelectElement;
  declare captureErrorTarget: HTMLElement;
  declare captureSubmitTarget: HTMLButtonElement;
  declare noteEditorTarget: HTMLElement;
  declare noteTagsTarget: HTMLInputElement;
  declare noteErrorTarget: HTMLElement;
  declare noteSubmitTarget: HTMLButtonElement;
  declare taskTitleTarget: HTMLInputElement;
  declare taskPriorityTarget: HTMLSelectElement;
  declare taskDueTarget: HTMLInputElement;
  declare taskDueTriggerTarget: HTMLButtonElement;
  declare hasTaskDueTriggerTarget: boolean;
  declare taskDueLabelTarget: HTMLElement;
  declare hasTaskDueLabelTarget: boolean;
  // S6: converted from HTMLInputElement (free text) to HTMLSelectElement (id-valued).
  declare taskListTarget: HTMLSelectElement;
  declare taskErrorTarget: HTMLElement;
  declare taskSubmitTarget: HTMLButtonElement;
  // P8: due date picker
  declare dueDateDialogTarget: HTMLDialogElement;
  declare hasDueDateDialogTarget: boolean;
  declare eventTitleTarget: HTMLInputElement;
  declare eventWhenTarget: HTMLInputElement;
  declare eventWhenTriggerTarget: HTMLButtonElement;
  declare eventWhenLabelTarget: HTMLElement;
  declare eventDestinationTarget: HTMLSelectElement;
  declare readonly hasEventDestinationTarget: boolean;
  declare eventLocationTarget: HTMLInputElement;
  declare eventErrorTarget: HTMLElement;
  declare eventSubmitTarget: HTMLButtonElement;
  declare tabCaptureTarget: HTMLButtonElement;
  declare tabNoteTarget: HTMLButtonElement;
  declare tabTaskTarget: HTMLButtonElement;
  declare tabEventTarget: HTMLButtonElement;
  declare formCaptureTarget: HTMLElement;
  declare formNoteTarget: HTMLElement;
  declare formTaskTarget: HTMLElement;
  declare formEventTarget: HTMLElement;
  private noteEditor: CompactEditorHandle | null = null;
  private noteTagInput: TagInput | null = null;
  private captureListSelect: JinSelectField | null = null;
  private taskPrioritySelect: JinSelectField | null = null;
  private taskListSelect: JinSelectField | null = null;
  private eventDestinationSelect: JinSelectField | null = null;
  private eventDestinationInvalid = false;
  private readonly pendingSubmits = new Map<'capture' | 'note' | 'task' | 'event', number>();
  private modalSession = 0;
  private readonly handleModalClick = (event: MouseEvent): void => {
    if (event.target === this.modalTarget) this.close();
  };
  private readonly handleModalCancel = (event: Event): void => {
    event.preventDefault();
    this.close();
  };
  private readonly handleEventDestinationChange = (): void => {
    if (!this.eventDestinationInvalid || !this.eventDestinationTarget.value) return;
    this.eventDestinationInvalid = false;
    this.eventDestinationSelect?.setInvalid(false);
    clearFormError(this.eventErrorTarget);
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    // Close on backdrop click (clicking the <dialog> element itself, outside the inner panel)
    this.modalTarget.addEventListener('click', this.handleModalClick);
    this.modalTarget.addEventListener('cancel', this.handleModalCancel);
    initIcons();
    this.noteEditor = mountCompactEditor(this.noteEditorTarget, {
      placeholder: 'Title\nStart writing in Markdown…',
    });
    this.noteTagInput = new TagInput(this.noteTagsTarget);
    this.captureListSelect = JinSelectField.enhance(this.captureListTarget);
    this.taskPrioritySelect = JinSelectField.enhance(this.taskPriorityTarget);
    this.taskListSelect = JinSelectField.enhance(this.taskListTarget);
    this.eventDestinationSelect = JinSelectField.enhance(this.eventDestinationTarget);
    this.eventDestinationTarget.addEventListener('change', this.handleEventDestinationChange);
    // S6: populate the list selects with id-valued options on connect.
    void this.populateCaptureListSelects();
    if (this.hasEventDestinationTarget) void this.populateEventDestinations();
  }

  disconnect(): void {
    this.modalTarget.removeEventListener('click', this.handleModalClick);
    this.modalTarget.removeEventListener('cancel', this.handleModalCancel);
    this.noteEditor?.destroy();
    this.noteEditor = null;
    this.noteTagInput?.destroy();
    this.noteTagInput = null;
    this.captureListSelect?.destroy();
    this.taskPrioritySelect?.destroy();
    this.taskListSelect?.destroy();
    this.eventDestinationSelect?.destroy();
    this.eventDestinationTarget.removeEventListener('change', this.handleEventDestinationChange);
    this.captureListSelect = null;
    this.taskPrioritySelect = null;
    this.taskListSelect = null;
    this.eventDestinationSelect = null;
    this.pendingSubmits.clear();
    this.eventDestinationInvalid = false;
    this.modalSession += 1;
  }

  /**
   * S6: populate captureList + taskList selects with lists from the backend.
   * option.value = list.id (never a display name). Called on connect and on open.
   * Non-fatal — if the API fails, the selects keep their HTML-default Inbox option.
   */
  private async populateCaptureListSelects(): Promise<void> {
    try {
      const lists = await listLists();
      populateListFilter(this.captureListTarget, lists);
      populateListFilter(this.taskListTarget, lists);
      this.captureListSelect?.refresh();
      this.taskListSelect?.refresh();
    } catch {
      // non-fatal: selects keep the static Inbox fallback from index.html
    }
  }

  // ── Modal open / close ────────────────────────────────────────────────────

  /** open — show the capture modal. Bound to the sidebar capture button. */
  open(): void {
    this.modalSession += 1;
    this.switchTab('capture');
    if (!this.eventWhenTarget.dataset.start) this.setDefaultEventWhen();
    this.modalTarget.showModal();
    this.captureTextTarget.focus();
    initIcons();
  }

  /** close — hide the capture modal and reset all forms. */
  close(): void {
    this.modalTarget.close();
    this.modalSession += 1;
    this.pendingSubmits.clear();
    this.resetBusyButtons();
    this.resetAllForms();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  switchTab(tab: 'capture' | 'note' | 'task' | 'event'): void {
    const map: Record<string, { tabEl: HTMLElement; formEl: HTMLElement }> = {
      capture: { tabEl: this.tabCaptureTarget, formEl: this.formCaptureTarget },
      note: { tabEl: this.tabNoteTarget, formEl: this.formNoteTarget },
      task: { tabEl: this.tabTaskTarget, formEl: this.formTaskTarget },
      event: { tabEl: this.tabEventTarget, formEl: this.formEventTarget },
    };
    for (const [name, { tabEl, formEl }] of Object.entries(map)) {
      const active = name === tab;
      tabEl.setAttribute('aria-selected', String(active));
      tabEl.setAttribute('aria-current', active ? 'true' : 'false');
      tabEl.tabIndex = active ? 0 : -1;
      formEl.classList.toggle('hidden', !active);
    }
    const copy = {
      capture: ['Quick capture', 'Get the thought down now. You can shape it later.'],
      note: ['New note', 'The first line becomes the title. Markdown is welcome.'],
      task: ['New task', 'Add a clear next action, then place it where it belongs.'],
      event: ['New event', 'Describe when it happens in your own words.'],
    } as const;
    this.modeTitleTarget.textContent = copy[tab][0];
    this.modeSubtitleTarget.textContent = copy[tab][1];
  }

  selectCapture(): void { this.switchTab('capture'); this.captureTextTarget.focus(); }
  selectNote(): void { this.switchTab('note'); this.noteEditor?.focus(); }
  selectTask(): void { this.switchTab('task'); this.taskTitleTarget.focus(); }
  selectEvent(): void { this.switchTab('event'); this.eventTitleTarget.focus(); }

  tabKeydown(event: KeyboardEvent): void {
    const tabs = [this.tabCaptureTarget, this.tabNoteTarget, this.tabTaskTarget, this.tabEventTarget];
    const current = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  }

  // ── Submit: quick capture ─────────────────────────────────────────────────

  async submitCapture(): Promise<void> {
    const state: CaptureFormState = {
      text: this.captureTextTarget.value,
      asTask: this.captureAsTaskTarget.checked,
      list: this.captureListTarget.value,
    };
    const validation = validateCaptureForm(state);
    if (!validation.valid) {
      renderFormError(this.captureErrorTarget, validation.errors['text'] ?? 'Invalid input.');
      return;
    }
    const session = this.modalSession;
    if (!this.beginSubmit('capture', session)) return;
    clearFormError(this.captureErrorTarget);
    setFormBusy(this.captureSubmitTarget, true);
    try {
      const payload = buildCapturePayload(state);
      const result = await capture(payload.text, {
        as_task: payload.as_task,
        list: payload.list,
      });
      if (!this.isCurrentSession(session)) return;
      this.close();
      // Re-fetch the new item by navigating to it (post-mutation refresh via core)
      this.navigateAfterCreate(result.kind === 'note' ? 'notes' : 'tasks', result.id);
    } catch (err: unknown) {
      if (!this.isCurrentSession(session)) return;
      if (isJinErrorDto(err)) {
        renderFormError(this.captureErrorTarget, err.message);
      } else {
        renderFormError(this.captureErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      this.finishSubmit('capture', session, this.captureSubmitTarget);
    }
  }

  // ── Submit: create note ───────────────────────────────────────────────────

  async submitNote(): Promise<void> {
    clearAllFormErrors(this.formNoteTarget);
    const document = this.noteEditor?.getDoc() ?? '';
    const { title, body } = splitNoteDocument(document);
    const state: NoteFormState = {
      title,
      body,
      tags: this.noteTagInput?.getTags().join(',') ?? this.noteTagsTarget.value,
    };
    const validation = validateNoteForm(state);
    if (!validation.valid) {
      renderFormError(this.noteErrorTarget, validation.errors['title'] ?? 'Invalid input.');
      this.noteEditor?.focus();
      return;
    }
    const session = this.modalSession;
    if (!this.beginSubmit('note', session)) return;
    setFormBusy(this.noteSubmitTarget, true);
    try {
      const { input } = buildCreateNotePayload(state);
      const note = await createNote(input);
      if (!this.isCurrentSession(session)) return;
      this.close();
      this.navigateAfterCreate('notes', note.id);
    } catch (err: unknown) {
      if (!this.isCurrentSession(session)) return;
      if (isJinErrorDto(err)) {
        renderFormError(this.noteErrorTarget, err.message);
      } else {
        renderFormError(this.noteErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      this.finishSubmit('note', session, this.noteSubmitTarget);
    }
  }

  // ── Submit: create task ───────────────────────────────────────────────────

  async submitTask(): Promise<void> {
    clearAllFormErrors(this.formTaskTarget);
    const state: TaskFormState = {
      title: this.taskTitleTarget.value,
      priority: this.taskPriorityTarget.value,
      due: this.taskDueTarget.value,
      list: this.taskListTarget.value,
    };
    const validation = validateTaskForm(state);
    if (!validation.valid) {
      renderFormError(this.taskErrorTarget, validation.errors['title'] ?? 'Invalid input.');
      this.taskTitleTarget.focus();
      return;
    }
    const session = this.modalSession;
    if (!this.beginSubmit('task', session)) return;
    setFormBusy(this.taskSubmitTarget, true);
    try {
      const { input } = buildCreateTaskPayload(state);
      const task = await createTask(input);
      if (!this.isCurrentSession(session)) return;
      this.close();
      this.navigateAfterCreate('tasks', task.id);
    } catch (err: unknown) {
      if (!this.isCurrentSession(session)) return;
      if (isJinErrorDto(err)) {
        renderFormError(this.taskErrorTarget, err.message);
      } else {
        renderFormError(this.taskErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      this.finishSubmit('task', session, this.taskSubmitTarget);
    }
  }

  // ── Submit: create event ──────────────────────────────────────────────────

  async submitEvent(): Promise<void> {
    clearAllFormErrors(this.formEventTarget);
    this.eventDestinationInvalid = false;
    this.eventDestinationSelect?.setInvalid(false);
    const timing = eventTimingFromDue(this.eventWhenTarget.value);
    const state: EventFormState = {
      title: this.eventTitleTarget.value,
      ...timing,
      description: '',
      location: this.eventLocationTarget.value,
    };
    const validation = validateEventForm(state);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0] ?? 'Invalid input.';
      renderFormError(this.eventErrorTarget, firstError);
      // Focus the first invalid field
      if (validation.errors['title']) this.eventTitleTarget.focus();
      else this.eventWhenTriggerTarget.focus();
      return;
    }
    const session = this.modalSession;
    if (!this.beginSubmit('event', session)) return;
    setFormBusy(this.eventSubmitTarget, true);
    try {
      const { input } = buildCreateEventPayload(state);
      const destination = this.selectedEventDestination();
      if (state.recurrence && !destination) {
        renderFormError(this.eventErrorTarget, 'Choose a writable Google Calendar to create a recurring event.');
        this.eventDestinationInvalid = true;
        this.eventDestinationSelect?.setInvalid(true, this.eventErrorTarget.id);
        this.eventDestinationSelect?.focus();
        return;
      }
      if (this.hasEventDestinationTarget && this.eventDestinationTarget.value === '') {
        renderFormError(this.eventErrorTarget, 'ambiguous_destination: Choose an exact account and calendar.');
        this.eventDestinationInvalid = true;
        this.eventDestinationSelect?.setInvalid(true, this.eventErrorTarget.id);
        this.eventDestinationSelect?.focus();
        return;
      }
      const event = destination
        ? await createRoutedEvent({
          ...input,
          account_id: destination.accountId,
          calendar_id: destination.calendarId,
          operation_id: newOperationId('create'),
        })
        : await createEvent(input);
      if (!this.isCurrentSession(session)) return;
      this.close();
      this.navigateAfterCreate('events', event.id);
    } catch (err: unknown) {
      if (!this.isCurrentSession(session)) return;
      if (isJinErrorDto(err)) {
        // Maps JinErrorDto (e.g. invalid tz = code 2, invalid time range = code 2)
        // to inline form error — spec: "surface the core's validation rejection"
        renderFormError(this.eventErrorTarget, err.message);
      } else {
        renderFormError(this.eventErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      this.finishSubmit('event', session, this.eventSubmitTarget);
    }
  }

  private async populateEventDestinations(): Promise<void> {
    if (!this.hasEventDestinationTarget) return;
    const select = this.eventDestinationTarget;
    select.replaceChildren();
    let destinations: Array<{ accountId: string; calendarId: string; label: string }> = [];
    try {
      const accounts = await listGoogleAccounts();
      destinations = accounts.flatMap(account => account.calendars
        .filter(calendar => account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable)
        .map(calendar => ({
          accountId: account.id,
          calendarId: calendar.calendar_id,
          label: `${account.alias} · ${calendar.name}`,
        })));
    } catch {
      // The local-only destination remains available when account discovery fails.
    }
    if (destinations.length > 1) {
      select.append(new Option('Choose a destination', '', true, true));
    }
    select.append(new Option('Jin only', 'local', destinations.length === 0, destinations.length === 0));
    for (const destination of destinations) {
      const option = new Option(destination.label, `${destination.accountId}\u0000${destination.calendarId}`);
      option.dataset.accountId = destination.accountId;
      option.dataset.calendarId = destination.calendarId;
      if (destinations.length === 1) option.selected = true;
      select.append(option);
    }
    this.eventDestinationSelect?.refresh();
  }

  private selectedEventDestination(): { accountId: string; calendarId: string } | null {
    if (!this.hasEventDestinationTarget) return null;
    const option = this.eventDestinationTarget.selectedOptions[0];
    if (!option || option.value === 'local' || option.value === '') return null;
    const accountId = option.dataset.accountId;
    const calendarId = option.dataset.calendarId;
    return accountId && calendarId ? { accountId, calendarId } : null;
  }

  // ── P8: Due date picker ───────────────────────────────────────────────────

  /**
   * openDuePicker — action handler for "Pick due date" in the task create form.
   * data-action="click->capture#openDuePicker"
   */
  openDuePicker(): void {
    if (!this.hasDueDateDialogTarget) return;
    const dialog = this.dueDateDialogTarget;
    const currentDue = this.taskDueTarget.value || null;
    const editor = this.application.getControllerForElementAndIdentifier(
      dialog,
      'temporal-editor',
    ) as TemporalEditorController | null;
    editor?.open({
      initialDue: currentDue,
      onCommit: (result) => {
        if (result.kind === 'clear') this.applyDueDate('', '');
        else this.applyDueDate(result.due, result.date);
      },
    });
  }

  /** Open the same temporal editor used by Task, with event-specific copy. */
  openEventWhenPicker(): void {
    if (!this.hasDueDateDialogTarget) return;
    const editor = this.application.getControllerForElementAndIdentifier(
      this.dueDateDialogTarget,
      'temporal-editor',
    ) as TemporalEditorController | null;
    editor?.open({
      initialDue: this.eventWhenTarget.value || null,
      presentation: 'event',
      requireDate: true,
      restoreFocusTo: this.eventWhenTriggerTarget,
      onCommit: (result) => {
        if (result.kind !== 'set') return;
        this.eventWhenTarget.value = result.due;
        this.eventWhenLabelTarget.textContent = formatEventWhenLabel(result.date, result.time);
      },
    });
  }

  private applyDueDate(dueString: string, isoDate: string): void {
    this.taskDueTarget.value = dueString;
    if (this.hasTaskDueLabelTarget) {
      this.taskDueLabelTarget.textContent = isoDate ? formatCaptureDueLabel(isoDate) : 'No due date';
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * navigateAfterCreate — dispatch jin:navigate so RouterController opens the
   * new item's detail. This triggers openDetail → re-fetch from core (SP3:
   * re-fetch rather than optimistic mutation).
   */
  private navigateAfterCreate(kind: 'notes' | 'tasks' | 'events', id: string): void {
    this.dispatch('navigate', {
      detail: { kind, id },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private resetAllForms(): void {
    // Quick capture
    this.captureTextTarget.value = '';
    this.captureAsTaskTarget.checked = false;
    // S6: reset to 'inbox' (the id) so the select stays valid after a submit.
    this.captureListSelect?.setValue('inbox');
    clearFormError(this.captureErrorTarget);

    // Note form
    this.noteEditor?.setDoc('');
    this.noteTagInput?.setTags([]);
    clearFormError(this.noteErrorTarget);

    // Task form
    this.taskTitleTarget.value = '';
    this.taskPrioritySelect?.setValue('');
    this.taskDueTarget.value = '';
    if (this.hasTaskDueLabelTarget) this.taskDueLabelTarget.textContent = 'No due date';
    // S6: reset to 'inbox' (the id).
    this.taskListSelect?.setValue('inbox');
    clearFormError(this.taskErrorTarget);

    // Event form
    this.eventTitleTarget.value = '';
    this.eventWhenTarget.value = '';
    this.setDefaultEventWhen();
    this.eventLocationTarget.value = '';
    this.resetEventDestination();
    this.eventDestinationInvalid = false;
    this.eventDestinationSelect?.setInvalid(false);
    clearFormError(this.eventErrorTarget);
  }

  private setDefaultEventWhen(): void {
    const today = localIsoDate(new Date());
    this.eventWhenTarget.value = today;
    this.eventWhenLabelTarget.textContent = formatEventWhenLabel(today, '');
  }

  private resetEventDestination(): void {
    const options = Array.from(this.eventDestinationTarget.options);
    const initial = options.some(option => option.value === '')
      ? ''
      : options.find(option => option.value !== 'local')?.value ?? 'local';
    this.eventDestinationSelect?.setValue(initial);
  }

  private beginSubmit(kind: 'capture' | 'note' | 'task' | 'event', session: number): boolean {
    if (this.pendingSubmits.has(kind)) return false;
    this.pendingSubmits.set(kind, session);
    return true;
  }

  private finishSubmit(
    kind: 'capture' | 'note' | 'task' | 'event',
    session: number,
    button: HTMLButtonElement,
  ): void {
    // A stale completion must not alter controls owned by a newer submission.
    if (this.pendingSubmits.get(kind) !== session) return;
    this.pendingSubmits.delete(kind);
    setFormBusy(button, false);
  }

  private isCurrentSession(session: number): boolean {
    return this.modalSession === session && this.modalTarget.open;
  }

  private resetBusyButtons(): void {
    [this.captureSubmitTarget, this.noteSubmitTarget, this.taskSubmitTarget, this.eventSubmitTarget]
      .forEach(button => setFormBusy(button, false));
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function formatCaptureDueLabel(due: string): string {
  if (!due) return 'No due date';
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  }
  return new Date(due).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addOneHour(start: string): string {
  const date = new Date(start);
  date.setHours(date.getHours() + 1);
  return `${localIsoDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function nextIsoDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return localIsoDate(date);
}

function eventTimingFromDue(due: string): Pick<EventFormState, 'start' | 'end' | 'tzid' | 'isAllDay'> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { start: due, end: nextIsoDate(due), tzid: '', isAllDay: true };
  }
  const match = due.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return { start: '', end: '', tzid: '', isAllDay: false };
  const start = `${match[1]}T${match[2]}`;
  return {
    start,
    end: addOneHour(start),
    tzid: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isAllDay: false,
  };
}

function formatEventWhenLabel(date: string, time: string): string {
  const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  if (!time) return `${label} · All day`;
  const start = `${date}T${time}`;
  const end = addOneHour(start);
  const formatTime = (value: string) => new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  });
  return `${label} · ${formatTime(start)}–${formatTime(end)}`;
}
