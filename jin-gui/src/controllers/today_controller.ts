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
  editEventDelta,
  editRoutedEventDelta,
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
import {
  editPayloadFromDraft,
  routedEditPayloadFromDraft,
  validateDraft,
  type EventDraft,
} from '../lib/events/draft';
import { EventCompanion, type CompanionSaveResult } from '../lib/ui/companion';
import type { SupportedRecurrenceScope } from '../lib/events/recurrence_scope';
import { formatTaskDue } from '../lib/tasks/transform';
import { resolveEventLocale } from '../lib/events/locale';

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
    'errorState',
    'errorMessage',
    'refreshState',
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
  declare errorStateTarget: HTMLElement;
  declare errorMessageTarget: HTMLElement;
  declare refreshStateTarget: HTMLElement;
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
  declare hasErrorStateTarget: boolean;
  declare hasErrorMessageTarget: boolean;
  declare hasRefreshStateTarget: boolean;

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
  /** True only while Today follows core's moving display-timezone current day. */
  private followsCurrentDay = true;
  private agendaRequestPending = false;
  private sectionObserver: MutationObserver | null = null;
  private previewModal: TodayPreviewModal | null = null;
  private previewSequence = 0;
  private previewKind: 'events' | 'tasks' | null = null;
  private previewId: string | null = null;
  private previewTask: TaskDto | null = null;
  private previewEvent: EventDetailDto | null = null;
  private previewPending = false;
  private previewMessage: string | null = null;
  private previewRestoreFocus = true;
  private previewReturnFocusName: string | null = null;
  private previewOpener: HTMLElement | null = null;
  private previewFocusRestoreSequence = 0;
  private eventCompanion: EventCompanion | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.connected = true;
    // A startup date from markup is an explicit selection; the blank production
    // value asks core to resolve its authoritative current date.
    this.followsCurrentDay = !this.dateValue;
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
    this.previewOpener = null;
    this.previewFocusRestoreSequence += 1;
    this.previewModal?.destroy();
    this.previewModal = null;
    this.eventCompanion?.close(true);
    this.eventCompanion = null;
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
    this.followsCurrentDay = true;
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

  /** Retry a failed initial agenda request without inventing a replacement date. */
  retryAgenda(): void {
    if (this.agendaRequestPending || !this.isActiveSection()) return;
    void this.loadAgenda(this.requestedDate || undefined);
  }

  /** Router emits this after making the named section visible. Its detail is
   * a route id, not the active section name, so visibility remains authority. */
  activateSection(_event?: Event): void {
    if (this.isActiveSection()) void this.loadAgenda(this.reentryAgendaDate());
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
    if (!this.hasSuccessfulProjection) this.beginInitialAgendaRequest();
    this.element.setAttribute('aria-busy', 'true');
    if (date !== undefined) this.requestedDate = date;
    this.cancelMinuteRefresh();
    const request = ++this.requestSequence;
    this.agendaRequestPending = true;

    try {
      const dto = await todayProjection(date);
      if (request !== this.requestSequence || !this.connected || !this.isActiveSection()) return;
      hideLoading(el);
      this.element.setAttribute('aria-busy', 'false');
      this.agendaRequestPending = false;

      this.dateValue = dto.agenda.date;
      this.requestedDate = dto.agenda.date;
      this.syncDateControl();
      const grouped = groupTodayProjection(dto);
      renderTodayView(el, this.viewTemplates, grouped, (section, id) => {
        this.navigate(section, id);
      });
      this.lastProjectionIsCurrentDate = dto.is_current_date;
      this.hasSuccessfulProjection = true;
      this.clearAgendaFailureState();
      this.scheduleMinuteRefresh();

      // Refresh icons: newly-cloned template rows have data-lucide attrs
      // that need to be replaced with SVGs.
      initIcons();
    } catch (err: unknown) {
      if (request !== this.requestSequence || !this.connected || !this.isActiveSection()) return;
      hideLoading(el);
      this.element.setAttribute('aria-busy', 'false');
      this.agendaRequestPending = false;

      // Do not relabel the last rendered projection after a failed date
      // navigation. The controls continue to describe the content on screen.
      if (this.hasSuccessfulProjection) {
        this.requestedDate = this.dateValue || undefined;
        this.syncDateControl();
        this.showStaleRefreshState();
      } else {
        this.showInitialAgendaFailure();
      }

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
    this.followsCurrentDay = false;
    void this.loadAgenda(isoDate);
  }

  /** Dates for automatic lifecycle refreshes only; core owns rolling “today”. */
  private automaticAgendaDate(): string | undefined {
    return this.followsCurrentDay ? undefined : (this.requestedDate ?? this.dateValue) || undefined;
  }

  private reentryAgendaDate(): string | undefined {
    return this.automaticAgendaDate();
  }

  private beginInitialAgendaRequest(): void {
    this.errorStateTargetOrNull()?.classList.add('hidden');
    const retry = this.errorRetryControl();
    if (retry) retry.disabled = true;
  }

  private clearAgendaFailureState(): void {
    this.errorStateTargetOrNull()?.classList.add('hidden');
    const retry = this.errorRetryControl();
    if (retry) retry.disabled = false;
    const refreshState = this.refreshStateTargetOrNull();
    if (refreshState) {
      refreshState.textContent = '';
      refreshState.classList.add('hidden');
    }
  }

  private showInitialAgendaFailure(): void {
    const errorState = this.errorStateTargetOrNull();
    if (!errorState) return;
    const message = this.errorMessageTargetOrNull();
    if (message) message.textContent = 'Couldn’t load this day. Try again.';
    errorState.classList.remove('hidden');
    const retry = this.errorRetryControl();
    if (retry) retry.disabled = false;
    this.refreshStateTargetOrNull()?.classList.add('hidden');
  }

  private showStaleRefreshState(): void {
    const refreshState = this.refreshStateTargetOrNull();
    if (!refreshState) return;
    refreshState.textContent = 'Showing your last loaded plan. Couldn’t refresh it.';
    refreshState.classList.remove('hidden');
    this.errorStateTargetOrNull()?.classList.add('hidden');
  }

  private errorStateTargetOrNull(): HTMLElement | null {
    return this.hasErrorStateTarget ? this.errorStateTarget : null;
  }

  private errorMessageTargetOrNull(): HTMLElement | null {
    return this.hasErrorMessageTarget ? this.errorMessageTarget : null;
  }

  private errorRetryControl(): HTMLButtonElement | null {
    return this.errorStateTargetOrNull()?.querySelector<HTMLButtonElement>('[data-action~="click->today#retryAgenda"]') ?? null;
  }

  private refreshStateTargetOrNull(): HTMLElement | null {
    return this.hasRefreshStateTarget ? this.refreshStateTarget : null;
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
      this.openPreview(section, id, this.capturePreviewOpener(section, id));
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
      void this.loadAgenda(this.automaticAgendaDate());
    }
  };

  private scheduleMinuteRefresh(): void {
    if (!this.isRefreshEligible()) return;
    const delay = 60_000 - (Date.now() % 60_000) + 25;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.isRefreshEligible()) void this.loadAgenda(this.automaticAgendaDate());
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
      && this.followsCurrentDay
      && document.visibilityState !== 'hidden';
  }

  private openPreview(kind: 'events' | 'tasks', id: string, opener: HTMLElement | null = null): void {
    this.closePreview(false);
    this.previewFocusRestoreSequence += 1;
    const request = ++this.previewSequence;
    this.previewKind = kind;
    this.previewId = id;
    this.previewTask = null;
    this.previewEvent = null;
    this.previewPending = false;
    this.previewMessage = null;
    this.previewRestoreFocus = true;
    this.previewReturnFocusName = null;
    this.previewOpener = opener;
    if (kind === 'tasks') {
      this.previewModal = new TodayPreviewModal(
        'Task preview',
        () => this.afterPreviewClose(),
      );
      this.previewModal.setBody(this.previewLoading());
      this.previewModal.open();
      void this.loadTaskPreview(id, request);
      return;
    }
    void this.openEventCompanion(id, request);
  }

  private closePreview(restoreFocus = true): void {
    if (this.eventCompanion?.isOpen()) {
      this.previewRestoreFocus = restoreFocus;
      this.eventCompanion.close(true);
      this.eventCompanion = null;
      this.afterEventCompanionClose();
      return;
    }
    if (!this.previewModal) return;
    this.previewRestoreFocus = restoreFocus;
    this.previewModal.close({ restoreFocus });
  }

  private afterPreviewClose(): void {
    const kind = this.previewKind;
    const id = this.previewId;
    const restoreFocus = this.previewRestoreFocus;
    const modal = this.previewModal;
    const opener = this.previewOpener;
    this.previewSequence += 1;
    this.previewModal = null;
    this.previewKind = null;
    this.previewId = null;
    this.previewTask = null;
    this.previewEvent = null;
    this.previewPending = false;
    this.previewMessage = null;
    this.previewReturnFocusName = null;
    this.previewOpener = null;
    queueMicrotask(() => {
      modal?.destroy();
      if (!restoreFocus || !kind || !id || !this.connected) return;
      this.schedulePreviewOpenerRestore(kind, id, opener);
    });
  }

  private afterEventCompanionClose(): void {
    const kind = this.previewKind;
    const id = this.previewId;
    const restoreFocus = this.previewRestoreFocus;
    const opener = this.previewOpener;
    this.previewSequence += 1;
    this.previewKind = null;
    this.previewId = null;
    this.previewEvent = null;
    this.previewPending = false;
    this.previewMessage = null;
    this.previewOpener = null;
    queueMicrotask(() => {
      if (!restoreFocus || !kind || !id || !this.connected) return;
      this.schedulePreviewOpenerRestore(kind, id, opener);
    });
  }

  private capturePreviewOpener(kind: 'events' | 'tasks', id: string): HTMLElement | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    return this.element.contains(active)
      && active.matches(`[data-today-preview-kind="${kind}"][data-today-preview-id="${id}"]`)
      ? active
      : null;
  }

  private restorePreviewOpener(kind: 'events' | 'tasks', id: string, opener: HTMLElement | null): void {
    if (opener?.isConnected && this.element.contains(opener)) {
      opener.focus();
      return;
    }
    const sameEntity = this.element.querySelector<HTMLElement>(`[data-today-preview-kind="${kind}"][data-today-preview-id="${id}"]`);
    if (sameEntity) {
      sameEntity.focus();
      return;
    }
    const heading = this.element.querySelector<HTMLElement>('.today-agenda-intro__title');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  /**
   * Native dialog hosts may reconcile focus after their close call returns.
   * Restore immediately, then reconcile on the next frame only if focus fell
   * back to the document or a detached/modal node. A newer preview cancels it.
   */
  private schedulePreviewOpenerRestore(kind: 'events' | 'tasks', id: string, opener: HTMLElement | null): void {
    const restoreRequest = ++this.previewFocusRestoreSequence;
    const restore = (force: boolean): void => {
      if (restoreRequest !== this.previewFocusRestoreSequence || !this.connected) return;
      const active = document.activeElement;
      const focusEscaped = active === document.body
        || active === document.documentElement
        || !(active instanceof HTMLElement)
        || active.closest('#jin-modal-root') !== null
        || !this.element.contains(active);
      if (force || focusEscaped) this.restorePreviewOpener(kind, id, opener);
    };
    restore(true);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => restore(false));
    else queueMicrotask(() => restore(false));
  }

  private isCurrentPreview(request: number, kind: 'events' | 'tasks', id: string): boolean {
    if (!(this.connected && request === this.previewSequence && this.previewKind === kind && this.previewId === id)) {
      return false;
    }
    if (kind === 'events') return this.eventCompanion?.isOpen() === true;
    return this.previewModal !== null;
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

  private previewError(message: string, onRetry?: () => void): HTMLElement {
    const container = document.createElement('div');
    container.className = 'today-preview';
    const feedback = document.createElement('p');
    feedback.className = 'today-preview__message';
    feedback.setAttribute('role', 'alert');
    feedback.textContent = message;
    container.appendChild(feedback);
    if (onRetry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'today-preview__retry btn-secondary';
      retry.textContent = 'Try again';
      retry.addEventListener('click', onRetry);
      container.appendChild(retry);
    }
    return container;
  }

  private async loadTaskPreview(id: string, request: number): Promise<void> {
    try {
      const task = await getTaskById(id);
      if (!this.isCurrentPreview(request, 'tasks', id)) return;
      this.previewTask = task;
      this.renderTaskPreview(task);
    } catch {
      if (this.isCurrentPreview(request, 'tasks', id)) {
        this.previewModal?.setBody(this.previewError('Could not load this task.', () => {
          this.previewModal?.setBody(this.previewLoading());
          void this.loadTaskPreview(id, request);
        }));
      }
    }
  }

  private renderTaskPreview(task: TaskDto): void {
    const restoreFocus = this.previewFocusName() ?? this.previewReturnFocusName;
    const container = document.createElement('article');
    container.className = 'today-preview';
    const title = document.createElement('h3');
    title.className = 'today-preview__title';
    title.textContent = task.title;
    const metadata = document.createElement('p');
    metadata.className = 'today-preview__meta';
    metadata.textContent = `${task.status === 'doing' ? 'In progress' : task.status === 'done' ? 'Done' : 'To do'} · ${formatTaskDue(task.due)}`;
    container.append(title, metadata);
    if (task.list.trim()) {
      const list = document.createElement('p');
      list.className = 'today-preview__list';
      list.textContent = task.list;
      container.appendChild(list);
    }
    if (task.body?.trim()) {
      const body = document.createElement('p');
      body.className = 'today-preview__body';
      body.textContent = task.body;
      container.appendChild(body);
    }
    const tags = task.tags?.map(tag => tag.trim()).filter(Boolean) ?? [];
    if (tags.length) {
      const tagList = document.createElement('ul');
      tagList.className = 'today-preview__tags';
      tagList.setAttribute('aria-label', 'Tags');
      for (const tag of tags) {
        const tagItem = document.createElement('li');
        tagItem.textContent = tag;
        tagList.appendChild(tagItem);
      }
      container.appendChild(tagList);
    }
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
    container.appendChild(this.previewGoButton('tasks', task.id, 'Go to task'));
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

  private async openEventCompanion(id: string, request: number): Promise<void> {
    try {
      const detail = await getEventDetailById(id);
      if (!(this.connected && request === this.previewSequence && this.previewKind === 'events' && this.previewId === id)) {
        return;
      }
      this.previewEvent = detail;
      this.ensureEventCompanion();
      const scopes = (detail.capabilities.recurrence_scopes ?? []).filter(
        (scope): scope is SupportedRecurrenceScope =>
          scope === 'this_occurrence' || scope === 'entire_series',
      );
      this.eventCompanion?.setContentBox(Math.min(this.element.getBoundingClientRect().width || 720, 900));
      this.eventCompanion?.openPreview(detail, {
        recurrenceScopes: scopes,
        recurrencePatternSupported: detail.capabilities.recurrence_pattern_supported === true,
      });
    } catch {
      // Surface load failure via a short-lived modal so Today stays usable.
      if (!(this.connected && request === this.previewSequence && this.previewKind === 'events' && this.previewId === id)) {
        return;
      }
      this.previewModal = new TodayPreviewModal('Event preview', () => this.afterPreviewClose());
      this.previewModal.setBody(this.previewError('Could not load this event.', () => {
        const opener = this.previewOpener;
        this.closePreview(false);
        queueMicrotask(() => this.openPreview('events', id, opener));
      }));
      this.previewModal.open();
    }
  }

  private ensureEventCompanion(): void {
    if (this.eventCompanion) return;
    this.eventCompanion = new EventCompanion({
      workspace: this.element as HTMLElement,
      presentation: 'modal',
      field: this.element as HTMLElement,
      locale: resolveEventLocale(),
      onOpenFullDetails: (eventId) => {
        this.previewRestoreFocus = false;
        this.eventCompanion?.close(true);
        this.eventCompanion = null;
        this.afterEventCompanionClose();
        this.navigateDirect('events', eventId);
      },
      onSave: async (draft) => this.saveEventCompanionDraft(draft),
      onClose: () => {
        this.afterEventCompanionClose();
        this.eventCompanion = null;
      },
    });
  }

  private async saveEventCompanionDraft(draft: EventDraft): Promise<CompanionSaveResult> {
    const validation = validateDraft(draft);
    if (!validation.valid) {
      throw new Error('Enter a title and a valid event time.');
    }
    const operationId = newOperationId('edit');
    const route = this.previewEvent?.event.sync_context;
    if (route?.provider === 'google' && route.account_id && route.calendar_id) {
      await editRoutedEventDelta(
        routedEditPayloadFromDraft(
          draft,
          { account_id: route.account_id, calendar_id: route.calendar_id },
          operationId,
        ),
      );
    } else {
      await editEventDelta(editPayloadFromDraft(draft, operationId));
    }
    if (!draft.event_id) throw new Error('Could not save this event. Try again.');
    this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
    const canonical = await getEventDetailById(draft.event_id);
    this.previewEvent = canonical;
    // Refresh Today lanes through the existing mutation signal path.
    if (this.isActiveSection()) void this.loadAgenda((this.requestedDate ?? this.dateValue) || undefined);
    return {
      detail: canonical,
      outcome: route?.provider === 'google' ? 'sync_pending' : 'local',
    };
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
