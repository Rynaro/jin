import { saveSettingsPane } from '../lib/settings/navigation';
/**
 * EventsController — Stimulus controller for the Events browse + detail view (GUI-S4).
 *
 * Data flow (list):
 *   listEvents() → EventDto[] → sortEventsList() → renderEventsList()
 *
 * Data flow (detail):
 *   getEventById(id) → EventDto → renderEventDetail()
 *
 * Cross-object navigation from detail:
 *   - derived_from task → dispatches jin:navigate { kind: 'tasks', id }
 *   - prep notes via backlinks → dispatches jin:navigate { kind: 'notes', id }
 *
 * Connect pattern: data-controller="events" on the events <section> element.
 * Required <template> elements in the document:
 *   #tmpl-event-browse-row  — event list row shell
 *   #tmpl-backlink-row      — link/backlink item shell (shared)
 *
 * Targets:
 *   listPanel           — wraps the list + empty/loading states
 *   list                — <ul> for event rows
 *   emptyState          — shown when list is empty
 *   loadingState        — shown while list invoke is in-flight
 *   detailPanel         — wraps the detail content area
 *   detailLoadingState  — shown while detail invoke is in-flight
 *   detailNotFoundState — shown when get_event returns not-found
 *   detailContent       — populated by renderEventDetail()
 *
 * Actions:
 *   events#showList    — back button in detail panel
 *   events#openDetail  — jin:open-detail event handler (from RouterController)
 */

import { Controller } from '@hotwired/stimulus';
import {
  listEvents,
  getEventDetailById,
  editEvent,
  editRoutedEvent,
  deleteEvent,
  deleteRoutedEvent,
  removeTimeBlock,
  newOperationId,
  respondCalendarInvitation,
  refreshGoogleEventDetails,
  syncCalendarEvent,
} from '../invoke';
import { isJinErrorDto, toSyntheticErrorDto } from '../types/error';
import type { EventDetailDto } from '../types/dto';
import type { JinErrorDetails } from '../types/error';
import { sortEventsList } from '../lib/events/transform';
import {
  type EventsViewElements,
  type EventsTemplates,
  showEventsListLoading,
  hideEventsListLoading,
  renderEventsList,
  renderEventDetail,
} from '../lib/events/render';
import type { InvitationResponseChoice } from '../lib/events/invitation';
import { initIcons } from '../lib/icons';
import { ConfirmDialog } from '../lib/ui/confirm_dialog';
import { eventMessage, resolveEventLocale } from '../lib/events/locale';
import {
  draftFromEvent,
  inputFromDraft,
  isValidEventEditDraft,
  renderEventEditor,
  type EventEditDraft,
} from '../lib/events/edit';

export default class EventsController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'listPanel',
    'list',
    'emptyState',
    'loadingState',
    'detailPanel',
    'detailLoadingState',
    'detailNotFoundState',
    'detailContent',
  ];

  declare listPanelTarget: HTMLElement;
  declare listTarget: HTMLElement;
  declare emptyStateTarget: HTMLElement;
  declare loadingStateTarget: HTMLElement;
  declare detailPanelTarget: HTMLElement;
  declare detailLoadingStateTarget: HTMLElement;
  declare detailNotFoundStateTarget: HTMLElement;
  declare detailContentTarget: HTMLElement;
  private currentDetail: EventDetailDto | null = null;
  private removalDialog: ConfirmDialog | null = null;
  private returnScrollTop = 0;
  private returnFocusId: string | null = null;
  private pendingContextSuccessId: string | null = null;
  private editDraft: EventEditDraft | null = null;
  private editLatest: EventDetailDto | null = null;
  private editMessage: string | undefined;
  private editPending = false;
  private editFocusTitle = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.localeChanged();
    void this.loadList();
  }

  disconnect(): void {
    this.removalDialog?.destroy();
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async loadList(): Promise<void> {
    const el = this.viewElements;
    showEventsListLoading(el);

    try {
      const events = await listEvents();
      hideEventsListLoading(el);

      const sorted = sortEventsList(events);

      renderEventsList(el, this.viewTemplates, sorted, (kind, id) => {
        if (kind === 'events') {
          void this.loadDetail(id);
        } else {
          this.navigateTo(kind, id);
        }
      });

      initIcons();
    } catch (err: unknown) {
      hideEventsListLoading(el);
      this.dispatch('error', {
        detail: { message: eventMessage('failedLoadEvents') }, prefix: 'app', bubbles: true,
      });
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  /**
   * openDetail — handle jin:open-detail event from RouterController.
   * data-action="jin:open-detail->events#openDetail" on the section element.
   */
  openDetail(event: Event): void {
    const ce = event as CustomEvent<{ id: string }>;
    if (!ce.detail?.id) return;
    void this.loadDetail(ce.detail.id);
  }

  activateSection(event: Event): void {
    const id = (event as CustomEvent<{ id?: string | null }>).detail?.id;
    if (!id) this.showList();
  }

  /**
   * showList — go back to the list view (back button).
   * data-action="click->events#showList" on the back button.
   */
  showList(): void {
    this.detailPanelTarget.classList.add('hidden');
    this.currentDetail = null;
    this.editDraft = null;
    this.editLatest = null;
    this.setGlobalAddHidden(false);
    this.dispatch('calendar-return', {
      detail: { scrollTop: this.returnScrollTop, focusEventId: this.returnFocusId },
      prefix: 'jin',
      bubbles: true,
    });
  }

  localeChanged(): void {
    const locale = resolveEventLocale();
    const back = this.detailPanelTarget.querySelector<HTMLElement>('.calendar-back-btn');
    back?.setAttribute('aria-label', `${eventMessage('back', locale)} ${eventMessage('calendar', locale)}`);
    const label = back?.querySelector('span');
    if (label) label.textContent = eventMessage('calendar', locale);
    this.detailLoadingStateTarget.textContent = eventMessage('loading', locale);
    this.detailNotFoundStateTarget.textContent = eventMessage('notFound', locale);
    if (this.currentDetail) {
      if (this.editDraft) this.renderEditor();
      else this.renderDetail(this.currentDetail);
    }
  }

  handleMutation(event?: Event): void {
    if ((event as CustomEvent<{ source?: string }> | undefined)?.detail?.source === 'events') return;
    if (this.currentDetail) void this.loadDetail(this.currentDetail.event.id);
    else void this.loadList();
  }

  contextAttached(event: Event): void {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (!id || id !== this.currentDetail?.event.id) return;
    if (this.currentDetail.event.source.toLowerCase() === 'google') this.pendingContextSuccessId = id;
    void this.loadDetail(id);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadDetail(id: string, successMessage?: string, background = false): Promise<void> {
    const el = this.viewElements;

    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.eventId) this.returnFocusId = active.dataset.eventId;
    // Month scroll belongs to the route section. Week and Day preserve their
    // own chronological scroll in CalendarViewController.
    this.returnScrollTop = this.element.scrollTop;

    this.element.querySelectorAll<HTMLElement>('.calendar-month-view, .calendar-day-view')
      .forEach(panel => panel.classList.add('hidden'));
    this.listPanelTarget.classList.add('hidden');
    this.detailPanelTarget.classList.remove('hidden');
    this.setGlobalAddHidden(true);

    el.detailLoadingState.classList.toggle('hidden', background);
    el.detailNotFoundState.classList.add('hidden');
    if (!background) el.detailContent.classList.add('hidden');

    try {
      const detail = await getEventDetailById(id);
      this.currentDetail = detail;
      this.editDraft = null;
      this.editLatest = null;

      el.detailLoadingState.classList.add('hidden');
      el.detailContent.classList.remove('hidden');

      this.renderDetail(detail);
      const contextualSuccess = this.pendingContextSuccessId === id
        ? eventMessage('attachedOnly')
        : undefined;
      if (contextualSuccess) this.pendingContextSuccessId = null;
      if (successMessage ?? contextualSuccess) this.showOperationStatus(successMessage ?? contextualSuccess ?? '');

      initIcons();
    } catch (err: unknown) {
      el.detailLoadingState.classList.add('hidden');
      if (isJinErrorDto(err) && err.code === 3) {
        el.detailNotFoundState.classList.remove('hidden');
      } else {
        this.dispatch('error', {
          detail: { message: eventMessage('failedLoadEvent') }, prefix: 'app', bubbles: true,
        });
      }
    }
  }

  private renderDetail(detail: EventDetailDto): void {
    renderEventDetail(
      this.viewElements,
      this.viewTemplates,
      detail,
      (kind, targetId) => { this.navigateTo(kind, targetId); },
      (noteId, targetId) => { this.openAttachDialog(noteId, targetId); },
      (sourceId, targetId) => { this.openLinkDialog(sourceId, targetId); },
      {
        locale: resolveEventLocale(),
        onEdit: (current) => this.beginEdit(current),
        onRemove: (current) => this.confirmRemoval(current),
        onRespondInvitation: (current, choice, control) => { void this.respondToInvitation(current, choice, control); },
        onManageMeet: (current, action) => { void this.manageMeet(current, action); },
        onRefreshGoogleDetails: (current) => { void this.refreshGoogleDetails(current); },
        onSyncEvent: (current) => { void this.syncEvent(current); },
        onReviewSync: () => {
          saveSettingsPane('calendars');
          this.dispatch('navigate', { prefix: 'jin', bubbles: true, detail: { kind: 'settings' } });
        },
      },
    );
    initIcons();
  }

  private async respondToInvitation(
    detail: EventDetailDto,
    choice: InvitationResponseChoice,
    _control: HTMLButtonElement,
  ): Promise<void> {
    const invitation = detail.capabilities.collaboration?.invitation;
    if (!invitation || !invitation.can_respond) return;
    const allControls = this.detailContentTarget.querySelectorAll<HTMLButtonElement>('[data-response]');
    const submit = async (scope: 'this_occurrence' | 'entire_series' | null): Promise<void> => {
      allControls.forEach(button => { button.disabled = true; });
      try {
        await respondCalendarInvitation({
          item_id: invitation.action_ref.notification_item_id,
          expected_item_version: invitation.action_ref.expected_item_version,
          operation_id: newOperationId('calendar-rsvp'),
          response: choice,
          recurrence_scope: scope,
        });
        await this.loadDetail(detail.event.id);
        this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
        this.showOperationStatus('Response queued.');
      } catch (error: unknown) {
        this.showOperationStatus(isJinErrorDto(error) ? error.message || 'Response needs review.' : 'Could not queue your response.');
        allControls.forEach(button => { button.disabled = false; });
      }
    };
    if (invitation.recurrence_scopes.length > 1) {
      const dialog = new ConfirmDialog({
        title: 'Respond to recurring invitation',
        message: 'Choose whether this response applies to this occurrence or the entire series.',
        confirmLabel: 'Respond',
        cancelLabel: eventMessage('cancel', resolveEventLocale()),
        checkboxLabel: eventMessage('entireSeries', resolveEventLocale()),
        onConfirm: (entireSeries) => { void submit(entireSeries ? 'entire_series' : 'this_occurrence'); },
      });
      dialog.open();
      return;
    }
    await submit(invitation.recurrence_scopes[0] ?? null);
  }

  private async manageMeet(
    detail: EventDetailDto,
    action: 'add' | 'retry' | 'remove',
  ): Promise<void> {
    const route = detail.event.sync_context;
    const capability = detail.capabilities.collaboration;
    if (!route || !capability || (action === 'remove' ? !capability.can_remove_conference : !capability.can_add_conference)) return;
    const conference_data = action === 'remove' ? undefined : {
      pendingCreateRequest: {
        // Core owns the durable request id. This sentinel is replaced before
        // validation, persistence, and any provider write.
        requestId: 'generated-by-jin-core',
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
    try {
      await editRoutedEvent({
        event_id: detail.event.id,
        edit_token: detail.edit_token,
        operation_id: newOperationId(`meet-${action}`),
        title: detail.event.title,
        start: detail.event.start,
        end: detail.event.end,
        tzid: detail.event.start_tzid ?? undefined,
        is_all_day: detail.event.is_all_day,
        description: detail.event.description ?? undefined,
        location: detail.event.location ?? undefined,
        conference_data,
        clear_conference_data: action === 'remove',
        account_id: route.account_id,
        calendar_id: route.calendar_id,
        guest_update_policy: 'all',
      });
      await this.loadDetail(detail.event.id);
      this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
      this.showOperationStatus(action === 'remove' ? 'Google Meet removal queued.' : 'Google Meet request queued.');
    } catch (error: unknown) {
      this.showOperationStatus(isJinErrorDto(error) ? error.message || 'Google Meet needs review.' : 'Could not update Google Meet.');
    }
  }

  private async syncEvent(detail: EventDetailDto): Promise<void> {
    this.showOperationStatus(eventMessage('syncingEvent'));
    let message = eventMessage('syncEventDone');
    try {
      await syncCalendarEvent(detail.event.id);
    } catch (error: unknown) {
      message = isJinErrorDto(error) ? error.message || eventMessage('syncEventFailed')
        : toSyntheticErrorDto(error, eventMessage('syncEventFailed')).message;
      if (this.currentDetail?.event.id === detail.event.id) {
        this.showOperationStatus(message);
        const button = this.detailContentTarget.querySelector<HTMLButtonElement>('.event-detail__sync');
        if (button) button.disabled = false;
      }
      return;
    } finally {
      window.dispatchEvent(new CustomEvent('jin:google-state-changed'));
    }
    // This controller refreshes the open detail once, including the result.
    // Other views still need the mutation notification, but must not navigate.
    if (this.currentDetail?.event.id === detail.event.id) {
      await this.loadDetail(detail.event.id, message, true);
    }
    this.dispatch('events-mutated', { detail: { source: 'events' }, prefix: 'jin', bubbles: true });
  }

  private async refreshGoogleDetails(detail: EventDetailDto): Promise<void> {
    const route = detail.event.sync_context;
    if (!route) return;
    try {
      await refreshGoogleEventDetails({ event_id: detail.event.id, account_id: route.account_id, calendar_id: route.calendar_id });
      await this.loadDetail(detail.event.id);
      this.showOperationStatus('Google event details refreshed.');
    } catch (error: unknown) {
      this.showOperationStatus(isJinErrorDto(error) ? error.message || 'Could not refresh Google event details.' : 'Could not refresh Google event details.');
    }
  }

  private beginEdit(detail: EventDetailDto): void {
    if (!detail.capabilities.can_edit || this.editPending) return;
    this.currentDetail = detail;
    this.editDraft = draftFromEvent(detail.event);
    this.editLatest = null;
    this.editMessage = undefined;
    this.editFocusTitle = true;
    this.renderEditor();
  }

  private renderEditor(): void {
    if (!this.currentDetail || !this.editDraft) return;
    renderEventEditor(this.detailContentTarget, this.currentDetail, this.editDraft, {
      locale: resolveEventLocale(),
      today: this.localToday(),
      pending: this.editPending,
      message: this.editMessage,
      latest: this.editLatest ?? undefined,
      focusTitle: this.editFocusTitle,
      onDraftChange: draft => {
        this.editDraft = draft;
        this.editMessage = undefined;
        this.renderEditor();
      },
      onSave: draft => { void this.saveEdit(draft); },
      onCancel: () => this.cancelEdit(),
      onUseLatest: () => this.useLatest(),
      onReviewDraft: () => {
        this.editLatest = null;
        this.editMessage = eventMessage('editRetry');
        this.renderEditor();
      },
    });
    this.editFocusTitle = false;
  }

  private cancelEdit(): void {
    if (!this.currentDetail || this.editPending) return;
    const detail = this.currentDetail;
    this.editDraft = null;
    this.editLatest = null;
    this.editMessage = undefined;
    this.editFocusTitle = false;
    this.renderDetail(detail);
    this.focusEdit();
  }

  private useLatest(): void {
    if (!this.editLatest) return;
    this.currentDetail = this.editLatest;
    this.editDraft = draftFromEvent(this.editLatest.event);
    this.editLatest = null;
    this.editMessage = undefined;
    this.editFocusTitle = false;
    this.renderEditor();
  }

  private async saveEdit(draft: EventEditDraft): Promise<void> {
    if (!this.currentDetail || this.editPending) return;
    this.editDraft = draft;
    const patch = inputFromDraft(draft);
    if (!isValidEventEditDraft(draft)) {
      this.editMessage = eventMessage('editValidation');
      this.renderEditor();
      return;
    }
    const eventId = this.currentDetail.event.id;
    const editToken = this.currentDetail.edit_token;
    this.editPending = true;
    this.editMessage = undefined;
    this.renderEditor();
    try {
      const route = this.currentDetail.event.sync_context;
      const operationId = newOperationId('edit');
      const result = route
        ? { event: await editRoutedEvent({
          event_id: eventId,
          edit_token: editToken,
          operation_id: operationId,
          ...patch,
          account_id: route.account_id,
          calendar_id: route.calendar_id,
          recurrence_scope: this.isRecurring(this.currentDetail.event) ? draft.recurrence_scope : undefined,
          guest_update_policy: draft.guest_update_policy,
        }), no_op: false }
        : await editEvent({
          event_id: eventId,
          edit_token: editToken,
          operation_id: operationId,
          ...patch,
        });
      // The mutation result is not the reading projection. Refetch canonical
      // detail (including capabilities/token/backlinks) before feedback.
      const canonical = await getEventDetailById(result.event.id);
      this.currentDetail = canonical;
      this.editDraft = null;
      this.editLatest = null;
      this.editMessage = undefined;
      this.renderDetail(canonical);
      if (!result.no_op) this.showOperationStatus(eventMessage('eventSaved'));
      if (!result.no_op) {
        this.dispatch('event-edited', { detail: { event: canonical.event }, prefix: 'jin', bubbles: true });
        this.dispatch('refresh-today', { prefix: 'jin', bubbles: true });
      }
      this.focusEdit();
    } catch (error: unknown) {
      const details: JinErrorDetails | undefined = isJinErrorDto(error) ? error.details : undefined;
      if (details?.type === 'stale_event') {
        try {
          const latest = await getEventDetailById(eventId);
          this.currentDetail = latest;
          this.editLatest = latest;
          this.editMessage = eventMessage('eventChangedCopy');
        } catch {
          this.editMessage = eventMessage('editRetry');
        }
      } else if (details?.type === 'validation') {
        this.editMessage = eventMessage('editValidation');
      } else if (details?.type === 'operation_blocked') {
        this.editMessage = eventMessage('editBlocked');
      } else {
        this.editMessage = eventMessage('editRetry');
      }
    } finally {
      this.editPending = false;
      if (this.editDraft) this.renderEditor();
    }
  }

  private focusEdit(): void {
    queueMicrotask(() => {
      this.detailContentTarget.querySelector<HTMLButtonElement>('.event-detail__edit')?.focus();
    });
  }

  private localToday(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private confirmRemoval(detail: EventDetailDto): void {
    this.removalDialog?.destroy();
    const locale = resolveEventLocale();
    const isTimeBlock = detail.capabilities.display_kind === 'time-block';
    const cancelsMeeting = detail.capabilities.collaboration?.can_cancel_meeting === true;
    const recurring = this.isRecurring(detail.event);
    this.removalDialog = new ConfirmDialog({
      title: isTimeBlock ? eventMessage('removeTitle', locale) : cancelsMeeting ? eventMessage('cancelMeetingTitle', locale) : eventMessage('delete', locale),
      message: isTimeBlock ? eventMessage('removeBody', locale) : cancelsMeeting ? eventMessage('cancelMeetingBody', locale) : detail.event.title,
      confirmLabel: isTimeBlock ? eventMessage('remove', locale) : cancelsMeeting ? eventMessage('cancelMeeting', locale) : eventMessage('delete', locale),
      cancelLabel: eventMessage('cancel', locale),
      checkboxLabel: recurring
        ? eventMessage('deleteEntireSeries', locale)
        : isTimeBlock && detail.capabilities.can_return_task_to_flexible
          ? eventMessage('returnFlexible', locale)
          : undefined,
      selectLabel: cancelsMeeting ? 'Notify guests' : undefined,
      selectOptions: cancelsMeeting ? [
        { value: 'all', label: 'All guests' },
        { value: 'external_only', label: 'External guests only' },
        { value: 'none', label: 'Do not notify guests' },
      ] : undefined,
      variant: 'danger',
      onConfirm: (checked, guestUpdatePolicy) => { void this.performRemoval(detail, checked, guestUpdatePolicy); },
    });
    this.removalDialog.open();
  }

  private async performRemoval(detail: EventDetailDto, checked: boolean, guestUpdatePolicy?: string): Promise<void> {
    try {
      if (detail.capabilities.display_kind === 'time-block') {
        await removeTimeBlock({
          event_id: detail.event.id,
          return_to_flexible: checked,
          operation_id: newOperationId('remove'),
        });
      } else {
        const route = detail.event.sync_context;
        if (route) {
          await deleteRoutedEvent({
            event_id: detail.event.id,
            account_id: route.account_id,
            calendar_id: route.calendar_id,
            recurrence_scope: this.isRecurring(detail.event)
              ? (checked ? 'entire_series' : 'this_occurrence')
              : undefined,
            operation_id: newOperationId('delete'),
            guest_update_policy: guestUpdatePolicy === 'external_only' || guestUpdatePolicy === 'none' ? guestUpdatePolicy : 'all',
          });
        } else {
          await deleteEvent(detail.event.id);
        }
      }
      await this.loadDetail(detail.event.id);
      this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
      this.dispatch('tasks-changed', { prefix: 'jin', bubbles: true });
      // A successful delete leaves no useful detail projection to reload. Go
      // back to the calendar list so the action has an immediate, visible
      // result instead of rendering a cancelled stale entry.
      this.showList();
      await this.loadList();
    } catch (error: unknown) {
      const details: JinErrorDetails | undefined = isJinErrorDto(error) ? error.details : undefined;
      if (details?.type === 'operation_conflict') {
        await this.loadDetail(detail.event.id);
        this.showOperationStatus(eventMessage('removalConflict'));
      } else if (details?.type === 'operation_blocked') {
        this.showOperationStatus(eventMessage('removalBlocked'));
      } else {
        this.showOperationStatus(eventMessage('failedRemoveEvent'));
      }
    }
  }

  private showOperationStatus(message: string): void {
    const status = this.detailContentTarget.querySelector<HTMLElement>('.event-detail__operation-status');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('hidden');
  }

  private isRecurring(event: EventDetailDto['event']): boolean {
    return (event.recurrence?.length ?? 0) > 0 || Boolean(
      event.recurring_event_id || event.original_start || event.master_id || event.recurrence_unexpanded,
    );
  }

  private setGlobalAddHidden(hidden: boolean): void {
    const button = this.element.querySelector<HTMLButtonElement>('.calendar-global-add');
    if (!button) return;
    button.classList.toggle('hidden', hidden);
    button.toggleAttribute('hidden', hidden);
    button.setAttribute('aria-hidden', String(hidden));
    button.disabled = hidden;
  }

  private navigateTo(kind: 'notes' | 'tasks' | 'events', id: string): void {
    this.dispatch('navigate', {
      detail: { kind, id },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private openAttachDialog(noteId: string, targetId: string): void {
    this.dispatch('open-attach', {
      detail: {
        noteId,
        targetId,
        targetTitle: this.currentDetail?.event.title,
        context: 'event-prep',
      },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private openLinkDialog(sourceId: string, targetId: string): void {
    this.dispatch('open-link', {
      detail: {
        sourceId,
        targetId,
        sourceTitle: this.currentDetail?.event.title,
        context: 'event-related',
      },
      prefix: 'jin',
      bubbles: true,
    });
  }

  private get viewElements(): EventsViewElements {
    return {
      listPanel: this.listPanelTarget,
      list: this.listTarget,
      emptyState: this.emptyStateTarget,
      loadingState: this.loadingStateTarget,
      detailPanel: this.detailPanelTarget,
      detailLoadingState: this.detailLoadingStateTarget,
      detailNotFoundState: this.detailNotFoundStateTarget,
      detailContent: this.detailContentTarget,
    };
  }

  private get viewTemplates(): EventsTemplates {
    const eventBrowseRowEl = document.getElementById(
      'tmpl-event-browse-row'
    ) as HTMLTemplateElement | null;
    const backlinkRowEl = document.getElementById(
      'tmpl-backlink-row'
    ) as HTMLTemplateElement | null;
    if (!eventBrowseRowEl || !backlinkRowEl) {
      throw new Error(
        '[EventsController] required <template> elements not found. ' +
          'Ensure #tmpl-event-browse-row and #tmpl-backlink-row are present in the document.'
      );
    }
    return { eventBrowseRow: eventBrowseRowEl, backlinkRow: backlinkRowEl };
  }
}
