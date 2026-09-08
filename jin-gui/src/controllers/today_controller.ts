/**
 * TodayController — Stimulus controller for the Today/Agenda hero view (GUI-S3).
 *
 * Data flow:
 *   today_agenda(date?) → AgendaDto → groupAgenda() → GroupedAgenda → renderTodayView()
 *
 * Navigation: prev/next/today buttons + date input → reload via today_agenda.
 *
 * Errors: JinErrorDto bubbles up to the sibling ErrorController (same <main>).
 *
 * Connect pattern: data-controller="today" on the <section> element.
 * Required <template> elements in the document:
 *   #tmpl-event-row  — event row shell
 *   #tmpl-prep-note  — prep-note row
 *
 * Targets:
 *   dateInput       — <input type="date"> for jump-to-date
 *   dateLabel       — <output> displaying the human-readable date
 *   allDaySection   — <section> wrapper for all-day events
 *   allDayList      — <ul> inside the all-day section
 *   timedSection    — <section> wrapper for timed events
 *   timedList       — <ul> inside the timed section
 *   emptyState      — element shown when agenda is empty
 *   loadingState    — element shown while today_agenda is in-flight
 *
 * Actions (bind via data-action in HTML):
 *   today#prevDay       — go to previous day
 *   today#nextDay       — go to next day
 *   today#goToday       — jump to current date
 *   today#dateChanged   — bound to date input's change event
 */

import { Controller } from '@hotwired/stimulus';
import {
  todayProjection,
  getTaskById,
  setTaskStatus,
  editTask,
  getEventDetailById,
  editEvent,
  editRoutedEvent,
  newOperationId,
} from '../invoke';
import { isJinErrorDto } from '../types/error';
import type { EventDetailDto, TaskDto } from '../types/dto';
import {
  groupTodayProjection,
  prevDay,
  nextDay,
  formatDisplayDate,
} from '../lib/agenda/transform';
import {
  type TodayViewElements,
  type TodayTemplates,
  showLoading,
  hideLoading,
  renderTodayView,
} from '../lib/agenda/render';
import { initIcons } from '../lib/icons';
import { JinModal } from '../lib/ui/modal';
import { draftFromEvent, inputFromDraft, isValidEventEditDraft, type EventEditDraft } from '../lib/events/edit';
import { formatEventDate, formatEventTime } from '../lib/events/transform';
import { formatTaskDue } from '../lib/tasks/transform';

class TodayPreviewModal extends JinModal {
  constructor(title: string, private readonly afterClose: () => void) {
    super({ title, ariaLabel: title });
  }

  protected override onClose(): void {
    this.afterClose();
  }
}

export default class TodayController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'dateInput',
    'dateLabel',
    'dateEyebrow',
    'allDaySection',
    'allDayList',
    'timedSection',
    'timedList',
    'emptyState',
    'loadingState',
    'focusSection',
    'focusList',
    'attentionSection',
    'attentionList',
    'dueSection',
    'dueList',
    'flexibleSection',
    'flexibleList',
    'contextSection',
    'contextList',
    'scheduleClear',
  ];

  declare dateInputTarget: HTMLInputElement;
  declare dateLabelTarget: HTMLOutputElement;
  declare dateEyebrowTarget: HTMLElement;
  declare allDaySectionTarget: HTMLElement;
  declare allDayListTarget: HTMLElement;
  declare timedSectionTarget: HTMLElement;
  declare timedListTarget: HTMLElement;
  declare emptyStateTarget: HTMLElement;
  declare loadingStateTarget: HTMLElement;
  declare focusSectionTarget: HTMLElement;
  declare focusListTarget: HTMLElement;
  declare attentionSectionTarget: HTMLElement;
  declare attentionListTarget: HTMLElement;
  declare dueSectionTarget: HTMLElement;
  declare dueListTarget: HTMLElement;
  declare flexibleSectionTarget: HTMLElement;
  declare flexibleListTarget: HTMLElement;
  declare contextSectionTarget: HTMLElement;
  declare contextListTarget: HTMLElement;
  declare scheduleClearTarget: HTMLElement;
  declare hasFocusSectionTarget: boolean;
  declare hasFocusListTarget: boolean;
  declare hasAttentionSectionTarget: boolean;
  declare hasAttentionListTarget: boolean;
  declare hasDueSectionTarget: boolean;
  declare hasDueListTarget: boolean;
  declare hasFlexibleSectionTarget: boolean;
  declare hasFlexibleListTarget: boolean;
  declare hasContextSectionTarget: boolean;
  declare hasContextListTarget: boolean;
  declare hasScheduleClearTarget: boolean;

  // ── Values ────────────────────────────────────────────────────────────────
  // dateValue: the currently-displayed date as "YYYY-MM-DD".
  // Empty string → resolved to today on first connect.
  static values = { date: String };
  declare dateValue: string;
  private refreshTimer: number | null = null;
  private requestSequence = 0;
  private lastProjectionIsCurrentDate = false;
  private hasSuccessfulProjection = false;
  private connected = false;
  private requestedDate: string | undefined;
  private sectionObserver: MutationObserver | null = null;
  private previewModal: TodayPreviewModal | null = null;
  private previewSequence = 0;
  private previewKind: 'events' | 'tasks' | null = null;
  private previewId: string | null = null;
  private previewTask: TaskDto | null = null;
  private previewEvent: EventDetailDto | null = null;
  private previewDraft: EventEditDraft | null = null;
  private previewPending = false;
  private previewMessage: string | null = null;
  private previewRestoreFocus = true;
  private previewReturnFocusName: string | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.connected = true;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.sectionObserver = new MutationObserver(() => {
      if (!this.isActiveSection()) {
        // Router visibility is class-based, so a controller stays connected
        // while another top-level section is active. Invalidate an in-flight
        // reply as well as the timer; neither may revive this hidden view.
        this.cancelMinuteRefresh();
        this.requestSequence += 1;
      }
    });
    this.sectionObserver.observe(this.element, { attributes: true, attributeFilter: ['class'] });
    // Let core establish the display-timezone current date on the first request.
    if (this.isActiveSection()) void this.loadAgenda(this.dateValue || undefined);
  }

  disconnect(): void {
    this.connected = false;
    this.requestSequence += 1;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.sectionObserver?.disconnect();
    this.sectionObserver = null;
    this.cancelMinuteRefresh();
    this.previewSequence += 1;
    this.previewRestoreFocus = false;
    this.previewModal?.destroy();
    this.previewModal = null;
  }

  // ── Date navigation actions ───────────────────────────────────────────────

  prevDay(): void {
    this.applyDate(prevDay(this.requestedDate ?? this.dateValue));
  }

  nextDay(): void {
    this.applyDate(nextDay(this.requestedDate ?? this.dateValue));
  }

  goToday(): void {
    // Omitting the date keeps the display-timezone authority in core.
    this.requestedDate = undefined;
    void this.loadAgenda(undefined);
  }

  /** dateChanged — bound to the <input type="date"> change event. */
  dateChanged(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.applyDate(input.value);
    }
  }

  /** Refresh the currently displayed day from mutation events or buttons. */
  refreshAgenda(_event?: Event): void {
    if (this.isActiveSection()) void this.loadAgenda((this.requestedDate ?? this.dateValue) || undefined);
  }

  /** Router emits this after making the named section visible. Its detail is
   * a route id, not the active section name, so visibility remains authority. */
  activateSection(_event?: Event): void {
    if (this.isActiveSection()) void this.loadAgenda((this.requestedDate ?? this.dateValue) || undefined);
  }

  // ── Core load ─────────────────────────────────────────────────────────────

  /**
 * loadAgenda — invoke today_projection, transform, and render.
   * Public for direct date loads; actions should call refreshAgenda so their
   * Event argument can never cross the typed invoke boundary as the date.
   */
  async loadAgenda(date?: string): Promise<void> {
    if (!this.connected || !this.isActiveSection()) return;
    const el = this.viewElements;
    // Preserve the last truthful projection during a refresh. A timer or
    // mutation failure must never turn a populated day into a blank page.
    if (!this.hasSuccessfulProjection) showLoading(el);
    this.cancelMinuteRefresh();
    const request = ++this.requestSequence;

    try {
      const dto = await todayProjection(date);
      if (request !== this.requestSequence || !this.connected || !this.isActiveSection()) return;
      hideLoading(el);

      this.dateValue = dto.agenda.date;
      this.requestedDate = dto.agenda.date;
      this.syncDateControl();
      const grouped = groupTodayProjection(dto);
      renderTodayView(el, this.viewTemplates, grouped, (section, id) => {
        this.navigate(section, id);
      });
      this.lastProjectionIsCurrentDate = dto.is_current_date;
      this.hasSuccessfulProjection = true;
      this.scheduleMinuteRefresh();

      // Refresh icons: newly-cloned template rows have data-lucide attrs
      // that need to be replaced with SVGs.
      initIcons();
    } catch (err: unknown) {
      if (request !== this.requestSequence || !this.connected || !this.isActiveSection()) return;
      hideLoading(el);

      // Do not relabel the last rendered projection after a failed date
      // navigation. The controls continue to describe the content on screen.
      this.requestedDate = this.dateValue || undefined;
      if (this.hasSuccessfulProjection) this.syncDateControl();

      if (isJinErrorDto(err)) {
        // Bubble to the ErrorController on the parent <main data-controller="error">.
        this.dispatch('error', { detail: err, prefix: '' });
      } else {
        // Unexpected errors: surface to console, keep the view stable.
        console.error('[TodayController] unexpected error loading agenda:', err);
      }

      // A failed refresh is transient. Keep the last successful current-day
      // projection visible and try again at the next boundary when eligible.
      this.scheduleMinuteRefresh();
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private applyDate(isoDate: string): void {
    this.requestedDate = isoDate;
    void this.loadAgenda(isoDate);
  }

  /** syncDateControl — keep the date input + label in sync with this.dateValue. */
  private syncDateControl(): void {
    // Sync the <input type="date"> value (YYYY-MM-DD — the input's native format)
    this.dateInputTarget.value = this.dateValue;
    // Sync the human-readable <output> label
    this.dateLabelTarget.textContent = formatDisplayDate(this.dateValue);
    const [year, month, day] = this.dateValue.split('-').map(Number);
    this.dateEyebrowTarget.textContent = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
      undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
    );
  }

  /** viewElements — builds the TodayViewElements map from Stimulus targets. */
  private get viewElements(): TodayViewElements {
    return {
      allDaySection: this.allDaySectionTarget,
      allDayList: this.allDayListTarget,
      timedSection: this.timedSectionTarget,
      timedList: this.timedListTarget,
      emptyState: this.emptyStateTarget,
      loadingState: this.loadingStateTarget,
      focusSection: this.hasFocusSectionTarget ? this.focusSectionTarget : undefined,
      focusList: this.hasFocusListTarget ? this.focusListTarget : undefined,
      attentionSection: this.hasAttentionSectionTarget ? this.attentionSectionTarget : undefined,
      attentionList: this.hasAttentionListTarget ? this.attentionListTarget : undefined,
      dueSection: this.hasDueSectionTarget ? this.dueSectionTarget : undefined,
      dueList: this.hasDueListTarget ? this.dueListTarget : undefined,
      flexibleSection: this.hasFlexibleSectionTarget ? this.flexibleSectionTarget : undefined,
      flexibleList: this.hasFlexibleListTarget ? this.flexibleListTarget : undefined,
      contextSection: this.hasContextSectionTarget ? this.contextSectionTarget : undefined,
      contextList: this.hasContextListTarget ? this.contextListTarget : undefined,
      scheduleClear: this.hasScheduleClearTarget ? this.scheduleClearTarget : undefined,
    };
  }

  /** viewTemplates — resolves the document-level <template> elements by id. */
  private get viewTemplates(): TodayTemplates {
    const eventRowEl = document.getElementById('tmpl-event-row') as HTMLTemplateElement | null;
    const prepNoteEl = document.getElementById('tmpl-prep-note') as HTMLTemplateElement | null;
    if (!eventRowEl || !prepNoteEl) {
      throw new Error(
        '[TodayController] required <template> elements not found. ' +
          'Ensure #tmpl-event-row and #tmpl-prep-note are present in the document.'
      );
    }
    return { eventRow: eventRowEl, prepNote: prepNoteEl };
  }

  /**
   * navigate — dispatch a custom navigation event that the shell router
   * (GUI-S2) can listen for to push the detail view.
   *
   * Event name: "today:navigate"
   * Event detail: { section: "tasks" | "notes", id: string }
   */
  private navigate(section: 'events' | 'tasks' | 'notes', id: string): void {
    if (section === 'events' || section === 'tasks') {
      this.openPreview(section, id);
      return;
    }
    this.dispatch('navigate', {
      detail: { section, id },
      prefix: 'today',
      bubbles: true,
    });
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.cancelMinuteRefresh();
      return;
    }
    if (this.isActiveSection() && this.lastProjectionIsCurrentDate) {
      void this.loadAgenda((this.requestedDate ?? this.dateValue) || undefined);
    }
  };

  private scheduleMinuteRefresh(): void {
    if (!this.isRefreshEligible()) return;
    const delay = 60_000 - (Date.now() % 60_000) + 25;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.isRefreshEligible()) void this.loadAgenda(this.dateValue || undefined);
    }, delay);
  }

  private cancelMinuteRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private isActiveSection(): boolean {
    return this.element.isConnected && !this.element.classList.contains('hidden');
  }

  private isRefreshEligible(): boolean {
    return this.connected
      && this.isActiveSection()
      && this.lastProjectionIsCurrentDate
      && document.visibilityState !== 'hidden';
  }

  private openPreview(kind: 'events' | 'tasks', id: string): void {
    this.closePreview();
    const request = ++this.previewSequence;
    this.previewKind = kind;
    this.previewId = id;
    this.previewTask = null;
    this.previewEvent = null;
    this.previewDraft = null;
    this.previewPending = false;
    this.previewMessage = null;
    this.previewRestoreFocus = true;
    this.previewReturnFocusName = null;
    this.previewModal = new TodayPreviewModal(
      kind === 'tasks' ? 'Task preview' : 'Event preview',
      () => this.afterPreviewClose(),
    );
    this.previewModal.setBody(this.previewLoading());
    this.previewModal.open();
    if (kind === 'tasks') void this.loadTaskPreview(id, request);
    else void this.loadEventPreview(id, request);
  }

  private closePreview(restoreFocus = true): void {
    if (!this.previewModal) return;
    this.previewRestoreFocus = restoreFocus;
    this.previewModal.close({ restoreFocus });
  }

  private afterPreviewClose(): void {
    const kind = this.previewKind;
    const id = this.previewId;
    const restoreFocus = this.previewRestoreFocus;
    const modal = this.previewModal;
    this.previewSequence += 1;
    this.previewModal = null;
    this.previewKind = null;
    this.previewId = null;
    this.previewTask = null;
    this.previewEvent = null;
    this.previewDraft = null;
    this.previewPending = false;
    this.previewMessage = null;
    this.previewReturnFocusName = null;
    // Agenda refreshes replace the original button. Restore focus to its current
    // equivalent after JinModal has attempted its normal prior-focus return.
    queueMicrotask(() => {
      modal?.destroy();
      if (!restoreFocus || !kind || !id || !this.connected) return;
      const opener = this.element.querySelector<HTMLElement>(`[data-today-preview-kind="${kind}"][data-today-preview-id="${id}"]`);
      if (opener) {
        opener.focus();
        return;
      }
      const heading = this.element.querySelector<HTMLElement>('.today-agenda-intro__title');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    });
  }

  private isCurrentPreview(request: number, kind: 'events' | 'tasks', id: string): boolean {
    return this.connected && request === this.previewSequence && this.previewKind === kind && this.previewId === id && this.previewModal !== null;
  }

  private previewLoading(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'today-preview';
    const message = document.createElement('p');
    message.className = 'today-preview__message';
    message.setAttribute('role', 'status');
    message.textContent = 'Loading preview…';
    container.appendChild(message);
    return container;
  }

  private previewError(message: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'today-preview';
    const feedback = document.createElement('p');
    feedback.className = 'today-preview__message';
    feedback.setAttribute('role', 'alert');
    feedback.textContent = message;
    container.appendChild(feedback);
    return container;
  }

  private async loadTaskPreview(id: string, request: number): Promise<void> {
    try {
      const task = await getTaskById(id);
      if (!this.isCurrentPreview(request, 'tasks', id)) return;
      this.previewTask = task;
      this.renderTaskPreview(task);
    } catch {
      if (this.isCurrentPreview(request, 'tasks', id)) this.previewModal?.setBody(this.previewError('Could not load this task.'));
    }
  }

  private renderTaskPreview(task: TaskDto): void {
    const restoreFocus = this.previewFocusName() ?? this.previewReturnFocusName;
    const container = document.createElement('article');
    container.className = 'today-preview';
    container.append(this.previewGoButton('tasks', task.id, 'Go to task'));
    const title = document.createElement('h3');
    title.className = 'today-preview__title';
    title.textContent = task.title;
    const metadata = document.createElement('p');
    metadata.className = 'today-preview__meta';
    metadata.textContent = `${task.status === 'doing' ? 'In progress' : task.status === 'done' ? 'Done' : 'To do'} · ${formatTaskDue(task.due)}`;
    container.append(title, metadata);
    const controls = document.createElement('div');
    controls.className = 'today-preview__controls';
    const status = document.createElement('button');
    status.type = 'button';
    status.name = 'task-status';
    status.className = 'btn-secondary';
    status.disabled = this.previewPending;
    status.textContent = task.status === 'done' ? 'Reopen task' : 'Mark complete';
    status.addEventListener('click', () => void this.saveTaskStatus(task, task.status === 'done' ? 'todo' : 'done'));
    const priorityLabel = document.createElement('label');
    priorityLabel.className = 'today-preview__priority';
    priorityLabel.textContent = 'Priority';
    const priority = document.createElement('select');
    priority.className = 'form-input';
    priority.name = 'task-priority';
    priority.disabled = this.previewPending;
    for (const value of ['none', 'low', 'medium', 'high']) priority.appendChild(new Option(value[0].toUpperCase() + value.slice(1), value));
    priority.value = task.priority;
    priority.addEventListener('change', () => void this.saveTaskPriority(task, priority.value));
    priorityLabel.appendChild(priority);
    controls.append(status, priorityLabel);
    container.appendChild(controls);
    if (this.previewMessage) container.appendChild(this.previewFeedback(this.previewMessage));
    this.previewModal?.setBody(container);
    this.restorePreviewFocus(restoreFocus);
  }

  private async saveTaskStatus(task: TaskDto, status: string): Promise<void> {
    if (this.previewPending || !this.previewModal) return;
    const request = this.previewSequence;
    this.previewReturnFocusName = this.previewFocusName();
    this.previewPending = true;
    this.previewMessage = null;
    this.renderTaskPreview(task);
    try {
      const updated = await setTaskStatus(task.id, status);
      this.dispatch('tasks-changed', { prefix: 'jin', bubbles: true });
      if (!this.isCurrentPreview(request, 'tasks', task.id)) return;
      this.previewTask = updated;
      this.previewMessage = null;
      this.renderTaskPreview(updated);
    } catch {
      if (this.isCurrentPreview(request, 'tasks', task.id)) {
        this.previewMessage = 'Could not update this task. Try again.';
        this.renderTaskPreview(task);
      }
    } finally {
      if (this.isCurrentPreview(request, 'tasks', task.id)) {
        this.previewPending = false;
        this.renderTaskPreview(this.previewTask ?? task);
      }
    }
  }

  private async saveTaskPriority(task: TaskDto, priority: string): Promise<void> {
    if (this.previewPending || !this.previewModal) return;
    const request = this.previewSequence;
    this.previewReturnFocusName = this.previewFocusName();
    this.previewPending = true;
    this.previewMessage = null;
    this.renderTaskPreview(task);
    try {
      const updated = await editTask(task.id, { priority });
      this.dispatch('tasks-changed', { prefix: 'jin', bubbles: true });
      if (!this.isCurrentPreview(request, 'tasks', task.id)) return;
      this.previewTask = updated;
      this.previewMessage = null;
      this.renderTaskPreview(updated);
    } catch {
      if (this.isCurrentPreview(request, 'tasks', task.id)) {
        this.previewMessage = 'Could not update this task. Try again.';
        this.renderTaskPreview(task);
      }
    } finally {
      if (this.isCurrentPreview(request, 'tasks', task.id)) {
        this.previewPending = false;
        this.renderTaskPreview(this.previewTask ?? task);
      }
    }
  }

  private async loadEventPreview(id: string, request: number): Promise<void> {
    try {
      const detail = await getEventDetailById(id);
      if (!this.isCurrentPreview(request, 'events', id)) return;
      this.previewEvent = detail;
      this.previewDraft = draftFromEvent(detail.event);
      this.setPreviewScope(detail);
      this.renderEventPreview();
    } catch {
      if (this.isCurrentPreview(request, 'events', id)) this.previewModal?.setBody(this.previewError('Could not load this event.'));
    }
  }

  private setPreviewScope(detail: EventDetailDto): void {
    const allowed = detail.capabilities.recurrence_scopes ?? [];
    if (!this.previewDraft || allowed.length === 0 || allowed.includes(this.previewDraft.recurrence_scope)) return;
    this.previewDraft.recurrence_scope = allowed[0];
  }

  private renderEventPreview(): void {
    const detail = this.previewEvent;
    const draft = this.previewDraft;
    if (!detail || !draft) return;
    const restoreFocus = this.previewFocusName() ?? this.previewReturnFocusName;
    const container = document.createElement('article');
    container.className = 'today-preview';
    container.append(this.previewGoButton('events', detail.event.id, 'Go to event'));
    const title = document.createElement('h3');
    title.className = 'today-preview__title';
    title.textContent = detail.event.title;
    const metadata = document.createElement('p');
    metadata.className = 'today-preview__meta';
    metadata.textContent = `${formatEventDate(detail.event.start, detail.event.is_all_day, detail.event.start_tzid)} · ${formatEventTime(detail.event.start, detail.event.end, detail.event.is_all_day, detail.event.floating, detail.event.start_tzid)}${detail.event.location ? ` · ${detail.event.location}` : ''}`;
    container.append(title, metadata);
    if (!detail.capabilities.can_edit) {
      const readOnly = document.createElement('p');
      readOnly.className = 'today-preview__message';
      readOnly.textContent = 'This event is read-only.';
      container.appendChild(readOnly);
      this.previewModal?.setBody(container);
      this.restorePreviewFocus(restoreFocus);
      return;
    }
    const form = document.createElement('form');
    form.className = 'today-preview__form';
    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    titleInput.className = 'form-input';
    titleInput.required = true;
    titleInput.value = draft.title;
    titleInput.disabled = this.previewPending;
    form.appendChild(this.previewField('Title', titleInput));
    const locationInput = document.createElement('input');
    locationInput.name = 'location';
    locationInput.className = 'form-input';
    locationInput.value = draft.location;
    locationInput.disabled = this.previewPending;
    form.appendChild(this.previewField('Location', locationInput));
    const allowed = detail.capabilities.recurrence_scopes ?? [];
    if (allowed.length > 0) {
      const scope = document.createElement('select');
      scope.name = 'recurrence_scope';
      scope.className = 'form-input';
      scope.disabled = this.previewPending;
      for (const value of allowed) scope.appendChild(new Option(value === 'entire_series' ? 'Entire series' : 'This occurrence', value));
      scope.value = draft.recurrence_scope;
      form.appendChild(this.previewField('Apply changes to', scope));
    }
    const save = document.createElement('button');
    save.type = 'submit';
    save.name = 'event-save';
    save.className = 'btn-primary';
    save.disabled = this.previewPending;
    save.textContent = this.previewPending ? 'Saving…' : 'Save changes';
    form.appendChild(save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      draft.title = titleInput.value;
      draft.location = locationInput.value;
      const scope = form.querySelector<HTMLSelectElement>('[name="recurrence_scope"]');
      if (scope && allowed.includes(scope.value as EventEditDraft['recurrence_scope'])) draft.recurrence_scope = scope.value as EventEditDraft['recurrence_scope'];
      void this.saveEventPreview();
    });
    container.appendChild(form);
    if (this.previewMessage) container.appendChild(this.previewFeedback(this.previewMessage));
    this.previewModal?.setBody(container);
    this.restorePreviewFocus(restoreFocus);
  }

  private async saveEventPreview(): Promise<void> {
    const detail = this.previewEvent;
    const draft = this.previewDraft;
    if (!detail || !draft || this.previewPending || !this.previewModal) return;
    if (!isValidEventEditDraft(draft)) {
      this.previewMessage = 'Enter a title and a valid event time.';
      this.renderEventPreview();
      return;
    }
    const request = this.previewSequence;
    this.previewReturnFocusName = 'event-save';
    this.previewPending = true;
    this.previewMessage = null;
    this.renderEventPreview();
    const patch = inputFromDraft(draft);
    try {
      const route = detail.event.sync_context;
      const operationId = newOperationId('edit');
      const allowed = detail.capabilities.recurrence_scopes ?? [];
      const recurrence_scope = allowed.includes(draft.recurrence_scope) ? draft.recurrence_scope : undefined;
      const result = route
        ? { event: await editRoutedEvent({ event_id: detail.event.id, edit_token: detail.edit_token, operation_id: operationId, ...patch, account_id: route.account_id, calendar_id: route.calendar_id, recurrence_scope }), no_op: false }
        : await editEvent({ event_id: detail.event.id, edit_token: detail.edit_token, operation_id: operationId, ...patch, recurrence_scope });
      if (!result.no_op) {
        this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
        this.dispatch('refresh-today', { prefix: 'jin', bubbles: true });
      }
      const canonical = await getEventDetailById(result.event.id);
      if (!this.isCurrentPreview(request, 'events', detail.event.id)) return;
      this.previewEvent = canonical;
      this.previewDraft = draftFromEvent(canonical.event);
      this.setPreviewScope(canonical);
      this.previewMessage = result.no_op ? null : 'Event saved.';
    } catch (error: unknown) {
      if (!this.isCurrentPreview(request, 'events', detail.event.id)) return;
      if (isJinErrorDto(error) && error.details?.type === 'stale_event') {
        try {
          const canonical = await getEventDetailById(detail.event.id);
          if (!this.isCurrentPreview(request, 'events', detail.event.id)) return;
          this.previewEvent = canonical;
          const refreshedDraft = draftFromEvent(canonical.event);
          // A stale retry can carry only the fields this compact preview owns.
          // Times and description must come from canonical detail, never an old token.
          refreshedDraft.title = draft.title;
          refreshedDraft.location = draft.location;
          this.previewDraft = refreshedDraft;
          this.setPreviewScope(canonical);
          this.previewMessage = 'This event changed. Review the current details and save again.';
        } catch {
          this.previewMessage = 'This event changed. Try again.';
        }
      } else {
        this.previewMessage = 'Could not save this event. Try again.';
      }
    } finally {
      if (this.isCurrentPreview(request, 'events', detail.event.id)) {
        this.previewPending = false;
        this.renderEventPreview();
      }
    }
  }

  private previewGoButton(kind: 'events' | 'tasks', id: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.name = 'preview-go';
    button.className = 'today-preview__go btn-secondary';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.closePreview(false);
      this.navigateDirect(kind, id);
    });
    return button;
  }

  private previewField(label: string, control: HTMLElement): HTMLLabelElement {
    const field = document.createElement('label');
    field.className = 'today-preview__field';
    const text = document.createElement('span');
    text.textContent = label;
    field.append(text, control);
    return field;
  }

  private previewFeedback(message: string): HTMLElement {
    const feedback = document.createElement('p');
    feedback.className = 'today-preview__message';
    feedback.setAttribute('role', 'status');
    feedback.textContent = message;
    return feedback;
  }

  private previewFocusName(): string | null {
    const active = document.activeElement as HTMLElement | null;
    return active?.closest('#jin-modal-root .today-preview') ? active.getAttribute('name') : null;
  }

  private restorePreviewFocus(name: string | null): void {
    if (!name) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('#jin-modal-root') && active.matches('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')) {
      this.previewReturnFocusName = null;
      return;
    }
    const control = this.previewModal
      ? document.querySelector<HTMLElement>(`#jin-modal-root .today-preview [name="${name}"]`)
      : null;
    if (control instanceof HTMLButtonElement && control.disabled) return;
    if (control instanceof HTMLInputElement && control.disabled) return;
    if (control instanceof HTMLSelectElement && control.disabled) return;
    control?.focus();
    if (control) this.previewReturnFocusName = null;
  }

  private navigateDirect(kind: 'events' | 'tasks', id: string): void {
    this.dispatch('navigate', { detail: { kind, id }, prefix: 'jin', bubbles: true });
  }
}
