/**
 * ActionsController — Stimulus controller for promote / attach / link actions (GUI-S4).
 *
 * Listens for bubbling custom events dispatched by Notes/Tasks/Events controllers
 * when the user clicks an action button in a detail panel:
 *   jin:open-promote  { taskId: string }
 *   jin:open-attach   { noteId?: string, targetId?: string }
 *   jin:open-link     { sourceId?: string, targetId?: string }
 *
 * Each action opens a <dialog> with a focused minimal form. On submit:
 *   - Validates form state (pure lib/actions/transform.ts)
 *   - Calls the appropriate invoke wrapper (promoteTask / attachNote / linkObjects)
 *   - On success: dispatches jin:navigate to re-fetch via core (SP3 single source of truth)
 *   - On JinErrorDto: renders message as inline form error (no crash)
 *
 * Connect pattern: data-controller="actions" on the .jin-shell element.
 *
 * Targets (in HTML action dialogs):
 *   promoteDialog / promoteWhen / promoteTzid / promoteError / promoteSubmit
 *   attachDialog  / attachNoteId / attachTargetId / attachKind / attachError / attachSubmit
 *   linkDialog    / linkSourceId / linkTargetId / linkEdgeType / linkError / linkSubmit
 *
 * Actions wired in HTML:
 *   jin:open-promote->actions#openPromote
 *   jin:open-attach->actions#openAttach
 *   jin:open-link->actions#openLink
 *   actions#closePromote / closeAttach / closeLink   — cancel/close buttons
 *   actions#submitPromote / submitAttach / submitLink — submit buttons
 */

import { Controller } from '@hotwired/stimulus';
import {
  validatePromoteForm,
  buildPromotePayload,
  validateAttachForm,
  buildAttachPayload,
  validateLinkForm,
  buildLinkPayload,
  type PromoteFormState,
  type AttachFormState,
  type LinkFormState,
} from '../lib/actions/transform';
import {
  renderFormError,
  clearFormError,
  setFormBusy,
  clearAllFormErrors,
} from '../lib/capture/render';
import { isJinErrorDto } from '../types/error';
import { promoteTask, attachNote, linkObjects, newOperationId, listGoogleAccounts, listNotes, listTasks, listEvents } from '../invoke';
import { initIcons } from '../lib/icons';
import { eventMessage, resolveEventLocale } from '../lib/events/locale';
import type { NoteDto } from '../types/dto';

export default class ActionsController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'promoteDialog',
    'promoteWhen',
    'promoteTzid',
    'promoteDestination',
    'promoteError',
    'promoteSubmit',
    'attachDialog',
    'attachNoteId',
    'attachTargetId',
    'attachKind',
    'attachError',
    'attachSubmit',
    'attachContextGroup',
    'attachContextSearch',
    'attachContextOptions',
    'attachLegacyGroup',
    'linkDialog',
    'linkSourceId',
    'linkTargetId',
    'linkEdgeType',
    'linkError',
    'linkSubmit',
    'linkContextGroup',
    'linkContextSearch',
    'linkContextOptions',
    'linkLegacyGroup',
  ];

  declare promoteDialogTarget: HTMLDialogElement;
  declare promoteWhenTarget: HTMLInputElement;
  declare promoteTzidTarget: HTMLInputElement;
  declare promoteDestinationTarget: HTMLSelectElement;
  declare readonly hasPromoteDestinationTarget: boolean;
  declare promoteErrorTarget: HTMLElement;
  declare promoteSubmitTarget: HTMLButtonElement;

  declare attachDialogTarget: HTMLDialogElement;
  declare attachNoteIdTarget: HTMLInputElement;
  declare attachTargetIdTarget: HTMLInputElement;
  declare attachKindTarget: HTMLSelectElement;
  declare attachErrorTarget: HTMLElement;
  declare attachSubmitTarget: HTMLButtonElement;
  declare attachContextGroupTarget: HTMLElement;
  declare attachContextSearchTarget: HTMLInputElement;
  declare attachContextOptionsTarget: HTMLDataListElement;
  declare attachLegacyGroupTargets: HTMLElement[];

  declare linkDialogTarget: HTMLDialogElement;
  declare linkSourceIdTarget: HTMLInputElement;
  declare linkTargetIdTarget: HTMLInputElement;
  declare linkEdgeTypeTarget: HTMLSelectElement;
  declare linkErrorTarget: HTMLElement;
  declare linkSubmitTarget: HTMLButtonElement;
  declare linkContextGroupTarget: HTMLElement;
  declare linkContextSearchTarget: HTMLInputElement;
  declare linkContextOptionsTarget: HTMLDataListElement;
  declare linkLegacyGroupTargets: HTMLElement[];

  // Current task id for the promote action
  private currentTaskId = '';
  private attachContextual = false;
  private linkContextual = false;
  private linkNoteConnect = false;
  private linkRequestId = 0;
  private contextualNotes = new Map<string, string>();
  private contextualRelated = new Map<string, string>();
  private contextualRelatedEventId = '';

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    initIcons();
    if (this.hasPromoteDestinationTarget) void this.populatePromoteDestinations();
  }

  // ── Promote ───────────────────────────────────────────────────────────────

  /**
   * openPromote — receive jin:open-promote from TasksController.
   * data-action="jin:open-promote->actions#openPromote" on .jin-shell.
   */
  openPromote(event: Event): void {
    const ce = event as CustomEvent<{ taskId: string }>;
    if (!ce.detail?.taskId) return;
    this.currentTaskId = ce.detail.taskId;

    // Reset form
    this.promoteWhenTarget.value = '';
    this.promoteTzidTarget.value = '';
    clearFormError(this.promoteErrorTarget);
    if (this.hasPromoteDestinationTarget) void this.populatePromoteDestinations();

    this.promoteDialogTarget.showModal();
    this.promoteWhenTarget.focus();
    initIcons();
  }

  closePromote(): void {
    this.promoteDialogTarget.close();
  }

  async submitPromote(): Promise<void> {
    const state: PromoteFormState = {
      when: this.promoteWhenTarget.value,
      tzid: this.promoteTzidTarget.value,
    };
    const validation = validatePromoteForm(state);
    if (!validation.valid) {
      renderFormError(this.promoteErrorTarget, validation.errors['when'] ?? 'Invalid input.');
      return;
    }
    clearAllFormErrors(this.promoteDialogTarget);
    if (this.hasPromoteDestinationTarget) {
      if (this.promoteDestinationTarget.value === '') {
        renderFormError(this.promoteErrorTarget, 'ambiguous_destination: Choose an exact account and calendar.');
        this.promoteDestinationTarget.focus();
        return;
      }
    }
    setFormBusy(this.promoteSubmitTarget, true);
    try {
      const payload = buildPromotePayload(this.currentTaskId, state);
      const selectedDestination = this.hasPromoteDestinationTarget
        ? this.promoteDestinationTarget.selectedOptions[0]
        : undefined;
      const destination = !selectedDestination
        ? undefined
        : selectedDestination.value === 'local'
          ? 'local' as const
          : {
            accountId: selectedDestination.dataset.accountId ?? '',
            calendarId: selectedDestination.dataset.calendarId ?? '',
            };
      const newEvent = await promoteTask(
        payload.task_id,
        payload.slot,
        newOperationId('promote'),
        destination,
      );
      this.promoteDialogTarget.close();
      // Re-fetch: navigate to the new event (core is source of truth — SP3)
      this.navigateAfterAction('events', newEvent.id);
      // Signal Today to re-fetch (the newly promoted event now has originating_task)
      this.dispatch('refresh-today', { prefix: 'jin', bubbles: true });
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        // e.g. code 2 = invalid timezone "Foo/Bar" → surfaced as inline error, no crash
        renderFormError(this.promoteErrorTarget, err.message);
      } else {
        renderFormError(this.promoteErrorTarget, 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setFormBusy(this.promoteSubmitTarget, false);
    }
  }

  private async populatePromoteDestinations(): Promise<void> {
    if (!this.hasPromoteDestinationTarget) return;
    const select = this.promoteDestinationTarget;
    select.replaceChildren();
    let destinations: Array<{ accountId: string; calendarId: string; label: string }> = [];
    try {
      const accounts = await listGoogleAccounts();
      destinations = accounts.flatMap(account => account.calendars
        .filter(calendar => account.state === 'connected' && calendar.enabled && calendar.available && calendar.writable)
        .map(calendar => ({ accountId: account.id, calendarId: calendar.calendar_id, label: `${account.alias} · ${calendar.name}` })));
    } catch {
      // Keep local-only promotion available when account discovery fails.
    }
    if (destinations.length > 1) select.append(new Option('Choose a destination', '', true, true));
    select.append(new Option('Jin only', 'local', destinations.length <= 1, destinations.length <= 1));
    for (const destination of destinations) {
      const option = new Option(destination.label, `${destination.accountId}\u0000${destination.calendarId}`);
      option.dataset.accountId = destination.accountId;
      option.dataset.calendarId = destination.calendarId;
      select.append(option);
    }
  }

  // ── Attach ────────────────────────────────────────────────────────────────

  /**
   * openAttach — receive jin:open-attach from Notes/Events controllers.
   * data-action="jin:open-attach->actions#openAttach" on .jin-shell.
   */
  openAttach(event: Event): void {
    const ce = event as CustomEvent<{ noteId?: string; targetId?: string; context?: string }>;
    this.attachContextual = ce.detail?.context === 'event-prep';

    this.attachNoteIdTarget.value = ce.detail?.noteId ?? '';
    this.attachTargetIdTarget.value = ce.detail?.targetId ?? '';
    this.attachKindTarget.value = this.attachContextual ? 'prep-for' : '';
    this.attachContextGroupTarget.classList.toggle('hidden', !this.attachContextual);
    this.attachLegacyGroupTargets.forEach(group => group.classList.toggle('hidden', this.attachContextual));
    this.attachContextSearchTarget.value = '';
    clearFormError(this.attachErrorTarget);

    this.attachDialogTarget.showModal();
    if (this.attachContextual) {
      this.localizeContextDialog(this.attachDialogTarget, 'attachNote', 'noteTitle', this.attachContextSearchTarget);
      this.attachContextSearchTarget.focus();
      void this.loadContextNotes();
      initIcons();
      return;
    }
    // Focus the first empty required field
    if (!this.attachNoteIdTarget.value) {
      this.attachNoteIdTarget.focus();
    } else if (!this.attachTargetIdTarget.value) {
      this.attachTargetIdTarget.focus();
    } else {
      this.attachKindTarget.focus();
    }
    initIcons();
  }

  closeAttach(): void {
    this.attachDialogTarget.close();
  }

  async submitAttach(): Promise<void> {
    if (this.attachContextual) {
      const noteId = this.contextualNotes.get(this.attachContextSearchTarget.value.trim().toLocaleLowerCase());
      if (!noteId) {
        renderFormError(this.attachErrorTarget, eventMessage('noTitleMatch'));
        return;
      }
      this.attachNoteIdTarget.value = noteId;
    }
    const state: AttachFormState = {
      noteId: this.attachNoteIdTarget.value,
      targetId: this.attachTargetIdTarget.value,
      kind: this.attachKindTarget.value,
    };
    const validation = validateAttachForm(state);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0] ?? 'Invalid input.';
      renderFormError(this.attachErrorTarget, firstError);
      return;
    }
    clearAllFormErrors(this.attachDialogTarget);
    setFormBusy(this.attachSubmitTarget, true);
    try {
      const payload = buildAttachPayload(state);
      await attachNote(payload.note_id, payload.target_id, payload.kind);
      this.attachDialogTarget.close();
      window.dispatchEvent(new CustomEvent('jin:event-context-attached', {
        detail: { id: state.targetId },
      }));
      // Re-fetch the target (events/tasks) so the prep-for backlink appears (SP3)
      this.navigateAfterAction('events', state.targetId);
    } catch (err: unknown) {
      if (this.attachContextual) {
        renderFormError(this.attachErrorTarget, eventMessage('failedAttachNote'));
      } else if (isJinErrorDto(err)) {
        renderFormError(this.attachErrorTarget, err.message);
      } else {
        renderFormError(this.attachErrorTarget, eventMessage('unexpectedError'));
      }
    } finally {
      setFormBusy(this.attachSubmitTarget, false);
    }
  }

  // ── Link ──────────────────────────────────────────────────────────────────

  /**
   * openLink — receive jin:open-link from Notes/Events/Tasks controllers.
   * data-action="jin:open-link->actions#openLink" on .jin-shell.
   */
  openLink(event: Event): void {
    const ce = event as CustomEvent<{ sourceId?: string; targetId?: string; context?: string }>;
    const requestId = ++this.linkRequestId;
    this.linkContextual = ce.detail?.context === 'event-related';
    this.linkNoteConnect = ce.detail?.context === 'note-connect';

    // Every mode starts from the production template's neutral copy. Contextual
    // modes may then replace it without leaking labels into the next opening.
    this.linkDialogTarget.querySelector('.action-dialog__title')!.textContent = 'Create Link';
    this.linkDialogTarget.setAttribute('aria-label', 'Create typed link');
    this.linkDialogTarget.querySelector<HTMLLabelElement>('label[for="link-context-title"]')!.textContent = 'Related item title';
    this.linkSubmitTarget.textContent = 'Link';
    this.linkSubmitTarget.setAttribute('aria-label', 'Create link');
    this.linkContextSearchTarget.placeholder = 'Search by title';

    this.linkSourceIdTarget.value = ce.detail?.sourceId ?? '';
    this.linkTargetIdTarget.value = ce.detail?.targetId ?? '';
    this.linkEdgeTypeTarget.value = this.linkContextual ? 'references' : '';
    const contextual = this.linkContextual || this.linkNoteConnect;
    this.linkContextGroupTarget.classList.toggle('hidden', !contextual);
    this.linkLegacyGroupTargets.forEach(group => group.classList.toggle('hidden', contextual));
    this.linkContextSearchTarget.value = '';
    this.contextualRelated.clear();
    this.populateTitleOptions(this.linkContextOptionsTarget, []);
    setFormBusy(this.linkSubmitTarget, false);
    clearFormError(this.linkErrorTarget);

    this.linkDialogTarget.showModal();
    if (this.linkContextual) {
      this.contextualRelatedEventId = ce.detail?.sourceId ?? '';
      this.localizeContextDialog(this.linkDialogTarget, 'addRelated', 'relatedTitle', this.linkContextSearchTarget);
      this.linkContextSearchTarget.focus();
      void this.loadContextRelated(requestId);
      initIcons();
      return;
    }
    if (this.linkNoteConnect) {
      this.linkEdgeTypeTarget.value = 'references';
      this.localizeContextDialog(this.linkDialogTarget, 'addRelated', 'relatedTitle', this.linkContextSearchTarget);
      this.linkDialogTarget.querySelector('.action-dialog__title')!.textContent = 'Connect this note';
      this.linkDialogTarget.setAttribute('aria-label', 'Connect this note');
      this.linkDialogTarget.querySelector<HTMLLabelElement>('label[for="link-context-title"]')!.textContent = 'Find a note, task, or event';
      this.linkSubmitTarget.textContent = 'Connect';
      this.linkSubmitTarget.setAttribute('aria-label', 'Connect this note');
      this.linkContextSearchTarget.placeholder = 'Search notes, tasks, and events';
      this.linkContextSearchTarget.focus();
      void this.loadConnectCandidates(ce.detail?.sourceId ?? '', requestId);
      initIcons();
      return;
    }
    if (!this.linkSourceIdTarget.value) {
      this.linkSourceIdTarget.focus();
    } else if (!this.linkTargetIdTarget.value) {
      this.linkTargetIdTarget.focus();
    } else {
      this.linkEdgeTypeTarget.focus();
    }
    initIcons();
  }

  closeLink(): void {
    this.linkRequestId += 1;
    this.linkDialogTarget.close();
  }

  async submitLink(): Promise<void> {
    if (this.linkContextual) {
      const selectedNoteId = this.contextualRelated.get(this.linkContextSearchTarget.value.trim().toLocaleLowerCase());
      if (!selectedNoteId) {
        renderFormError(this.linkErrorTarget, eventMessage('noTitleMatch'));
        return;
      }
      this.linkSourceIdTarget.value = selectedNoteId;
      this.linkTargetIdTarget.value = this.contextualRelatedEventId;
    }
    if (this.linkNoteConnect) {
      const targetId = this.contextualRelated.get(this.linkContextSearchTarget.value.trim().toLocaleLowerCase());
      if (!targetId) {
        renderFormError(this.linkErrorTarget, 'Choose an item from the matching results.');
        return;
      }
      this.linkTargetIdTarget.value = targetId;
      this.linkEdgeTypeTarget.value = 'references';
    }
    const state: LinkFormState = {
      sourceId: this.linkSourceIdTarget.value,
      targetId: this.linkTargetIdTarget.value,
      edgeType: this.linkEdgeTypeTarget.value,
    };
    const validation = validateLinkForm(state);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0] ?? 'Invalid input.';
      renderFormError(this.linkErrorTarget, firstError);
      return;
    }
    clearAllFormErrors(this.linkDialogTarget);
    const requestId = this.linkRequestId;
    setFormBusy(this.linkSubmitTarget, true);
    try {
      const payload = buildLinkPayload(state);
      await linkObjects(payload.source_id, payload.target_id, payload.edge_type);
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open) return;
      this.closeLink();
      window.dispatchEvent(new CustomEvent('jin:event-context-attached', {
        detail: { id: this.linkContextual ? state.targetId : state.sourceId },
      }));
      // Re-fetch the affected objects so backlinks appear from canonical state (SP3).
      this.dispatch('refresh', {
        prefix: 'jin',
        bubbles: true,
        detail: { sourceId: state.sourceId, targetId: state.targetId },
      });
    } catch (err: unknown) {
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open) return;
      if (this.linkContextual) {
        renderFormError(this.linkErrorTarget, eventMessage('failedAddRelated'));
      } else if (isJinErrorDto(err)) {
        // e.g. code 2 = edge type outside vocabulary — surfaced as inline error
        renderFormError(this.linkErrorTarget, err.message);
      } else {
        renderFormError(this.linkErrorTarget, eventMessage('unexpectedError'));
      }
    } finally {
      if (requestId === this.linkRequestId) setFormBusy(this.linkSubmitTarget, false);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * navigateAfterAction — dispatch jin:navigate to re-fetch the affected view.
   * This is the SP3 "re-fetch via core" pattern: navigation triggers openDetail
   * which re-fetches from jin-core rather than optimistically mutating state.
   */
  private navigateAfterAction(kind: 'notes' | 'tasks' | 'events', id: string): void {
    this.dispatch('navigate', {
      detail: { kind, id },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private async loadContextNotes(): Promise<void> {
    try {
      const notes = await listNotes();
      const choices = this.buildNoteChoices(notes);
      this.contextualNotes = new Map(choices.map(choice => [choice.label.toLocaleLowerCase(), choice.id]));
      this.populateTitleOptions(this.attachContextOptionsTarget, choices.map(choice => choice.label));
    } catch {
      renderFormError(this.attachErrorTarget, eventMessage('noTitleMatch'));
    }
  }

  private async loadContextRelated(requestId: number): Promise<void> {
    try {
      const choices = this.buildNoteChoices(await listNotes());
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open || !this.linkContextual) return;
      this.contextualRelated = new Map(choices.map(choice => [choice.label.toLocaleLowerCase(), choice.id]));
      this.populateTitleOptions(this.linkContextOptionsTarget, choices.map(choice => choice.label));
    } catch {
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open || !this.linkContextual) return;
      renderFormError(this.linkErrorTarget, eventMessage('noTitleMatch'));
    }
  }

  /** Real, identity-backed choices for Note → entity connections. */
  private async loadConnectCandidates(sourceId: string, requestId: number): Promise<void> {
    try {
      const [notes, tasks, events] = await Promise.all([listNotes(), listTasks(), listEvents()]);
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open || !this.linkNoteConnect) return;
      const rows: Array<{ id: string; label: string }> = [];
      for (const note of notes) if (note.id !== sourceId) rows.push({ id: note.id, label: `Note · ${note.title || 'Untitled'}${note.folder_path ? ` — ${note.folder_path}` : ''}` });
      for (const task of tasks) rows.push({ id: task.id, label: `Task · ${task.title}` });
      for (const event of events) rows.push({ id: event.id, label: `Event · ${event.title}` });
      const used = new Set<string>();
      this.contextualRelated = new Map();
      const labels: string[] = [];
      for (const row of rows) {
        let label = row.label;
        let ordinal = 2;
        while (used.has(label.toLocaleLowerCase())) label = `${row.label} (${ordinal++})`;
        used.add(label.toLocaleLowerCase());
        this.contextualRelated.set(label.toLocaleLowerCase(), row.id);
        labels.push(label);
      }
      this.populateTitleOptions(this.linkContextOptionsTarget, labels);
    } catch {
      if (requestId !== this.linkRequestId || !this.linkDialogTarget.open || !this.linkNoteConnect) return;
      renderFormError(this.linkErrorTarget, 'Could not load items to connect.');
    }
  }

  private buildNoteChoices(notes: NoteDto[]): Array<{ label: string; id: string }> {
    const titleCounts = new Map<string, number>();
    for (const note of notes) {
      const key = note.title.trim().toLocaleLowerCase();
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    }
    const usedLabels = new Set<string>();
    return notes.map(note => {
      const title = note.title.trim();
      const key = title.toLocaleLowerCase();
      const baseLabel = (titleCounts.get(key) ?? 0) > 1
        ? `${title} — ${note.folder_path || 'Notes'}`
        : title;
      let label = baseLabel;
      let ordinal = 2;
      while (usedLabels.has(label.toLocaleLowerCase())) label = `${baseLabel} (${ordinal++})`;
      usedLabels.add(label.toLocaleLowerCase());
      return { label, id: note.id };
    });
  }

  private populateTitleOptions(target: HTMLDataListElement, titles: string[]): void {
    target.replaceChildren(...titles.map(title => {
      const option = document.createElement('option');
      option.value = title;
      return option;
    }));
  }

  private localizeContextDialog(
    dialog: HTMLDialogElement,
    titleKey: 'attachNote' | 'addRelated',
    fieldKey: 'noteTitle' | 'relatedTitle',
    search: HTMLInputElement,
  ): void {
    const locale = resolveEventLocale();
    dialog.setAttribute('aria-label', eventMessage(titleKey, locale));
    const heading = dialog.querySelector<HTMLElement>('.action-dialog__title');
    if (heading) heading.textContent = eventMessage(titleKey, locale);
    const label = search.closest('.form-group')?.querySelector<HTMLLabelElement>('label');
    if (label) label.textContent = eventMessage(fieldKey, locale);
    search.placeholder = eventMessage('searchByTitle', locale);
    dialog.querySelector<HTMLButtonElement>('.modal-close-btn')?.setAttribute('aria-label', eventMessage('close', locale));
    const [cancel, submit] = dialog.querySelectorAll<HTMLButtonElement>('.form-actions button');
    if (cancel) {
      cancel.textContent = eventMessage('cancel', locale);
      cancel.setAttribute('aria-label', eventMessage('cancel', locale));
    }
    if (submit) {
      submit.textContent = eventMessage(titleKey, locale);
      submit.setAttribute('aria-label', eventMessage(titleKey, locale));
    }
  }
}
