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
  splitNoteDocument,
  type CaptureFormState,
  type NoteFormState,
  type TaskFormState,
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
  listGoogleAccounts, listLists, newOperationId, getEventDetailById,
} from '../invoke';
import {
  createInputFromDraft,
  draftFromCapture,
  isDirty,
  routedCreateInputFromDraft,
  type EventDraft,
} from '../lib/events/draft';
import { EventCompanion, type CompanionSaveResult } from '../lib/ui/companion';
import type { ComposerDestination } from '../lib/events/composer';
import { eventMessage, resolveEventLocale } from '../lib/events/locale';
import { calendarColor, googleCalendarKey } from '../lib/calendar/colors';
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
    'eventMoreOptions',
    'eventDiscard',
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
  declare eventMoreOptionsTarget: HTMLButtonElement;
  declare hasEventMoreOptionsTarget: boolean;
  declare eventDiscardTarget: HTMLElement;
  declare hasEventDiscardTarget: boolean;
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
  private eventComposerDestinations: ComposerDestination[] = [];
  private eventDestinationInvalid = false;
  private readonly pendingSubmits = new Map<'capture' | 'note' | 'task' | 'event', number>();
  private modalSession = 0;
  private eventCompanion: EventCompanion | null = null;
  private handedOffDraft: EventDraft | null = null;
  private discardResolver: ((keep: boolean) => void) | null = null;
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
    this.eventCompanion?.close(true);
    this.eventCompanion = null;
    this.handedOffDraft = null;
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
    void this.requestClose();
  }

  private async requestClose(): Promise<void> {
    if (this.eventCompanion?.isOpen()) {
      // Companion owns its own dirty/dismiss policy.
      return;
    }
    if (this.isEventDraftDirty()) {
      const discard = await this.promptEventDiscard();
      if (!discard) return;
    }
    this.forceClose();
  }

  private forceClose(): void {
    this.eventCompanion?.close(true);
    this.eventCompanion = null;
    this.handedOffDraft = null;
    this.clearEventDiscard();
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
    const draft = this.currentEventDraft();
    if (!draft.title.trim()) {
      renderFormError(this.eventErrorTarget, 'A title is required.');
      this.eventTitleTarget.focus();
      return;
    }
    if (!draft.temporal.start_date) {
      renderFormError(this.eventErrorTarget, 'Choose a date and time.');
      this.eventWhenTriggerTarget.focus();
      return;
    }
    const session = this.modalSession;
    if (!this.beginSubmit('event', session)) return;
    setFormBusy(this.eventSubmitTarget, true);
    try {
      const destination = this.selectedEventDestination();
      if (draft.recurrence && !destination) {
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
        ? await createRoutedEvent(
          routedCreateInputFromDraft(
            draft,
            { account_id: destination.accountId, calendar_id: destination.calendarId },
            newOperationId('create'),
          ),
        )
        : await createEvent(createInputFromDraft(draft));
      if (!this.isCurrentSession(session)) return;
      this.forceClose();
      this.navigateAfterCreate('events', event.id);
    } catch (err: unknown) {
      if (!this.isCurrentSession(session)) return;
      if (isJinErrorDto(err)) {
        renderFormError(this.eventErrorTarget, err.message);
      } else {
        renderFormError(this.eventErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      this.finishSubmit('event', session, this.eventSubmitTarget);
    }
  }

  /** AC-CALX-028 — hand the same EventDraft into shared Composer without reparsing. */
  openMoreEventOptions(): void {
    clearAllFormErrors(this.formEventTarget);
    const draft = this.handedOffDraft ?? this.currentEventDraft();
    this.handedOffDraft = draft;
    const destination = this.composerDestination();
    this.ensureEventCompanion();
    this.eventCompanion?.setContentBox(Math.min(this.modalTarget.getBoundingClientRect().width || 720, 900));
    this.eventCompanion?.openCreate(draft, destination ?? undefined, this.eventComposerDestinations);
  }

  private currentEventDraft(): EventDraft {
    if (this.handedOffDraft) {
      // Keep title/location/when from compact fields when they still drive Capture.
      this.handedOffDraft.title = this.eventTitleTarget.value;
      this.handedOffDraft.location = this.eventLocationTarget.value;
      this.applyWhenToDraft(this.handedOffDraft, this.eventWhenTarget.value);
      return this.handedOffDraft;
    }
    return this.draftFromCaptureFields();
  }

  private draftFromCaptureFields(): EventDraft {
    const when = this.eventWhenTarget.value;
    const capture: Parameters<typeof draftFromCapture>[0] = {
      title: this.eventTitleTarget.value,
      location: this.eventLocationTarget.value,
      description: '',
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(when)) {
      capture.date = when;
      capture.is_all_day = true;
    } else {
      const match = when.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (match) {
        capture.date = match[1];
        capture.start_time = match[2];
        const end = addOneHour(`${match[1]}T${match[2]}`);
        const endMatch = end.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (endMatch) {
          capture.end_time = endMatch[2];
        }
        capture.is_all_day = false;
        capture.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } else if (when) {
        capture.date = when.slice(0, 10);
      }
    }
    return draftFromCapture(capture);
  }

  private applyWhenToDraft(draft: EventDraft, _when: string): void {
    const next = this.draftFromCaptureFields();
    draft.temporal = { ...next.temporal };
  }

  private composerDestination(): ComposerDestination | null {
    if (!this.hasEventDestinationTarget || this.eventDestinationTarget.value === '') return null;
    if (this.eventDestinationTarget.value === 'local') return this.eventComposerDestinations[0]
      ?? { name: eventMessage('jinCalendarName', resolveEventLocale()) };
    const selected = this.selectedEventDestination();
    return this.eventComposerDestinations.find(choice =>
      choice.accountId === selected?.accountId && choice.calendarId === selected?.calendarId,
    ) ?? null;
  }

  private ensureEventCompanion(): void {
    if (this.eventCompanion) return;
    this.eventCompanion = new EventCompanion({
      workspace: this.modalTarget,
      presentation: 'modal',
      field: this.formEventTarget,
      locale: resolveEventLocale(),
      onDestinationChange: destination => {
        const value = destination.accountId && destination.calendarId
          ? `${destination.accountId}\u0000${destination.calendarId}` : 'local';
        this.eventDestinationSelect?.setValue(value);
      },
      onSave: async (draft) => this.saveCompanionCreate(draft),
      onClose: () => {
        // Preserve handed-off draft values back into compact fields.
        if (this.handedOffDraft) this.syncCompactFieldsFromDraft(this.handedOffDraft);
        this.eventCompanion = null;
      },
    });
  }

  private async saveCompanionCreate(draft: EventDraft): Promise<CompanionSaveResult> {
    this.handedOffDraft = draft;
    if (this.eventDestinationTarget.value === '') {
      throw new Error(eventMessage('chooseExactDestination', resolveEventLocale()));
    }
    const destination = this.selectedEventDestination();
    const emails = draft.attendees?.map(attendee => attendee.email ?? '').filter(Boolean) ?? [];
    if (!destination && (emails.length > 0 || draft.conference_intent.kind !== 'preserve' || draft.recurrence)) {
      throw new Error(eventMessage('googleDestinationRequired', resolveEventLocale()));
    }
    if (destination) {
      const accounts = await listGoogleAccounts();
      const account = accounts.find(item => item.id === destination.accountId && item.state === 'connected');
      const calendar = account?.calendars.find(item => item.calendar_id === destination.calendarId);
      if (!calendar?.enabled || !calendar.available || !calendar.writable) {
        throw new Error(eventMessage('destinationNoLongerWritable', resolveEventLocale()));
      }
      if (draft.conference_intent.kind === 'add'
        && calendar.allowed_conference_solution_types.length > 0
        && !calendar.allowed_conference_solution_types.includes('hangoutsMeet')) {
        throw new Error(eventMessage('destinationNoMeet', resolveEventLocale()));
      }
    }
    const created = destination
      ? await createRoutedEvent(
        routedCreateInputFromDraft(
          draft,
          { account_id: destination.accountId, calendar_id: destination.calendarId },
          newOperationId('create'),
        ),
      )
      : await createEvent(createInputFromDraft(draft));
    const detail = await getEventDetailById(created.id);
    this.forceClose();
    this.navigateAfterCreate('events', created.id);
    return {
      detail,
      outcome: destination ? 'sync_pending' : 'local',
      closeAfterSave: true,
    };
  }

  private syncCompactFieldsFromDraft(draft: EventDraft): void {
    this.eventTitleTarget.value = draft.title;
    this.eventLocationTarget.value = draft.location;
    const t = draft.temporal;
    if (t.is_all_day) {
      this.eventWhenTarget.value = t.start_date;
      this.eventWhenLabelTarget.textContent = formatEventWhenLabel(t.start_date, '');
    } else {
      this.eventWhenTarget.value = `${t.start_date}T${t.start_time}`;
      this.eventWhenLabelTarget.textContent = formatEventWhenLabel(t.start_date, t.start_time);
    }
  }

  private isEventDraftDirty(): boolean {
    if (!this.formEventTarget.classList.contains('hidden')) {
      const draft = this.currentEventDraft();
      return isDirty(draft) || Boolean(draft.title.trim() || draft.location.trim());
    }
    return false;
  }

  private promptEventDiscard(): Promise<boolean> {
    if (!this.hasEventDiscardTarget) return Promise.resolve(true);
    if (this.discardResolver) {
      return new Promise((resolve) => {
        const prev = this.discardResolver!;
        this.discardResolver = (keep) => {
          prev(keep);
          resolve(keep);
        };
      });
    }
    return new Promise((resolve) => {
      this.discardResolver = resolve;
      const region = this.eventDiscardTarget;
      region.hidden = false;
      region.classList.remove('hidden');
      region.replaceChildren();
      const prompt = document.createElement('p');
      prompt.textContent = eventMessage('discardPrompt', resolveEventLocale());
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'btn-secondary';
      keep.textContent = eventMessage('keepEditing', resolveEventLocale());
      keep.addEventListener('click', () => {
        this.clearEventDiscard();
        resolve(false);
      });
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'btn-danger';
      discard.textContent = eventMessage('discardChanges', resolveEventLocale());
      discard.addEventListener('click', () => {
        this.clearEventDiscard();
        resolve(true);
      });
      region.append(prompt, keep, discard);
      keep.focus();
    });
  }

  private clearEventDiscard(): void {
    if (!this.hasEventDiscardTarget) {
      this.discardResolver = null;
      return;
    }
    this.eventDiscardTarget.hidden = true;
    this.eventDiscardTarget.classList.add('hidden');
    this.eventDiscardTarget.replaceChildren();
    this.discardResolver = null;
  }

  private async populateEventDestinations(): Promise<void> {
    if (!this.hasEventDestinationTarget) return;
    const select = this.eventDestinationTarget;
    select.replaceChildren();
    let destinations: ComposerDestination[] = [];
    try {
      const accounts = await listGoogleAccounts();
      destinations = accounts.flatMap(account => account.calendars
        .filter(calendar => account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable)
        .map(calendar => ({
          accountId: account.id,
          calendarId: calendar.calendar_id,
          name: calendar.name,
          alias: account.alias,
          color: calendarColor(googleCalendarKey(account.id, calendar.calendar_id)),
          allowedConferenceSolutionTypes: calendar.allowed_conference_solution_types,
        })));
    } catch {
      // The local-only destination remains available when account discovery fails.
    }
    if (destinations.length > 1) {
      select.append(new Option('Choose a destination', '', true, true));
    }
    this.eventComposerDestinations = [
      { name: eventMessage('jinCalendarName', resolveEventLocale()), color: calendarColor('jin') },
      ...destinations,
    ];
    select.append(new Option('Jin only', 'local', destinations.length === 0, destinations.length === 0));
    for (const destination of destinations) {
      const option = new Option(`${destination.alias} · ${destination.name}`, `${destination.accountId}\u0000${destination.calendarId}`);
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
    this.handedOffDraft = null;
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
