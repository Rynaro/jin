/** Stimulus adapter for Jin's durable in-app Notification Center. */

import { Controller } from '@hotwired/stimulus';
import {
  completeNotificationTask,
  deferNotificationItem,
  dismissNotificationItem,
  listNotificationItems,
  newOperationId,
  notificationCenterSummary,
  respondCalendarInvitation,
  retryCalendarInvitation,
  setNotificationRead,
} from '../invoke';
import { initIcons } from '../lib/icons';
import {
  notificationSourceErrorSummary,
  renderNotificationDetail,
  renderNotificationList,
} from '../lib/notifications/render';
import {
  announceNotification,
  restoreNotificationFocus,
  trapDialogFocus,
} from '../lib/notifications/accessibility';
import type {
  InvitationRecurrenceScope,
  NotificationCommandErrorDto,
  NotificationFilter,
  NotificationItemDto,
} from '../types/dto';
import type TemporalEditorController from './temporal_editor_controller';
import type { TemporalEditorCommit } from './temporal_editor_controller';

type InvitationChoice = 'allow' | 'maybe' | 'refuse';

function isNotificationError(value: unknown): value is NotificationCommandErrorDto {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NotificationCommandErrorDto>;
  return typeof candidate.code === 'string'
    && typeof candidate.message === 'string'
    && typeof candidate.retryable === 'boolean';
}

/** Reject local wall-clock times normalized by Date across a DST gap. */
export function validateNotificationDeferTime(
  result: Extract<TemporalEditorCommit, { kind: 'set' }>,
  now = Date.now(),
): string | null {
  const instant = new Date(result.due);
  const selected = instant.valueOf();
  if (Number.isNaN(selected)) return 'Choose a future date and time within 30 days.';

  const localDate = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
  const localTime = `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
  if (localDate !== result.date || localTime !== result.time) {
    return 'That time does not exist in your local time zone because the clocks change then. Choose another time.';
  }

  const maximum = now + 30 * 24 * 60 * 60 * 1000;
  return selected <= now || selected > maximum
    ? 'Choose a future date and time within 30 days.'
    : null;
}

export default class NotificationsController extends Controller {
  static targets = [
    'loading',
    'error',
    'partialError',
    'workspace',
    'list',
    'detail',
    'filter',
    'live',
    'scopeDialog',
    'scopeTitle',
    'scopeThis',
    'scopeSeries',
    'scopeConfirm',
  ];

  declare loadingTarget: HTMLElement;
  declare errorTarget: HTMLElement;
  declare partialErrorTarget: HTMLElement;
  declare workspaceTarget: HTMLElement;
  declare listTarget: HTMLElement;
  declare detailTarget: HTMLElement;
  declare filterTargets: HTMLButtonElement[];
  declare liveTarget: HTMLElement;
  declare scopeDialogTarget: HTMLDialogElement;
  declare scopeTitleTarget: HTMLElement;
  declare scopeThisTarget: HTMLInputElement;
  declare scopeSeriesTarget: HTMLInputElement;
  declare scopeConfirmTarget: HTMLButtonElement;

  private items: NotificationItemDto[] = [];
  private selectedId: string | null = null;
  private busyItemId: string | null = null;
  private filter: NotificationFilter = 'all';
  private loadGeneration = 0;
  private listScrollTop = 0;
  private returnRowId: string | null = null;
  private pendingResponse: InvitationChoice | null = null;
  private pendingResponseButton: HTMLButtonElement | null = null;

  connect(): void {
    void this.refresh();
  }

  disconnect(): void {
    this.loadGeneration += 1;
    this.closeScopeDialog(false);
  }

  activate(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const generation = ++this.loadGeneration;
    const selectedBeforeRefresh = this.selectedId;
    this.setLoading(true);
    this.renderError(null);
    try {
      const [page, summary] = await Promise.all([
        listNotificationItems({ filter: this.filter, limit: 100 }),
        notificationCenterSummary(),
      ]);
      if (generation !== this.loadGeneration) return;
      this.items = page.items;
      if (!this.selectedId || !this.items.some((item) => item.id === this.selectedId)) {
        this.selectedId = this.items[0]?.id ?? null;
      }
      this.updateBadge(summary.visible_unread);
      this.renderPartialErrors(page.partial_errors, summary.partial_error_count);
      this.render();
      if (
        this.isMobile()
        && selectedBeforeRefresh !== null
        && !this.items.some((item) => item.id === selectedBeforeRefresh)
        && this.items.length === 0
      ) {
        this.element.classList.remove('notifications-view--detail');
        this.activeFilterControl()?.focus();
      }
    } catch (error: unknown) {
      if (generation !== this.loadGeneration) return;
      this.renderError(isNotificationError(error) ? error.message : 'Notification Center could not be loaded.');
    } finally {
      if (generation === this.loadGeneration) this.setLoading(false);
    }
  }

  selectFilter(event: Event): void {
    const button = event.currentTarget as HTMLButtonElement;
    const filter = button.dataset.notificationFilter as NotificationFilter | undefined;
    if (!filter || filter === this.filter) return;
    this.filter = filter;
    this.selectedId = null;
    this.filterTargets.forEach((target) => {
      const selected = target === button;
      target.setAttribute('aria-pressed', String(selected));
      target.classList.toggle('notifications-filter--active', selected);
    });
    void this.refresh();
  }

  handleClick(event: Event): void {
    const target = event.target as Element | null;
    const action = target?.closest<HTMLElement>('[data-notification-action]');
    if (action) {
      event.preventDefault();
      void this.handleAction(action);
      return;
    }
    const row = target?.closest<HTMLButtonElement>('[data-notification-select]');
    if (row?.dataset.notificationSelect) this.selectItem(row.dataset.notificationSelect, row);
  }

  handleListKeydown(event: KeyboardEvent): void {
    const row = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-notification-select]');
    if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(this.listTarget.querySelectorAll<HTMLButtonElement>('[data-notification-select]'));
    if (rows.length === 0) return;
    event.preventDefault();
    const current = Math.max(0, rows.indexOf(row));
    const index = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, current + 1)
          : Math.max(0, current - 1);
    rows[index]?.focus();
  }

  confirmScope(): void {
    if (!this.pendingResponse) return;
    const scope: InvitationRecurrenceScope = this.scopeSeriesTarget.checked
      ? 'entire_series'
      : 'this_occurrence';
    const response = this.pendingResponse;
    const focus = this.pendingResponseButton;
    this.closeScopeDialog(false);
    void this.submitInvitationResponse(response, scope, focus);
  }

  cancelScope(): void {
    this.closeScopeDialog(true);
  }

  trapScopeDialog(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeScopeDialog(true);
      return;
    }
    trapDialogFocus(this.scopeDialogTarget, event);
  }

  private selectedItem(): NotificationItemDto | null {
    return this.items.find((item) => item.id === this.selectedId) ?? null;
  }

  private selectItem(id: string, row: HTMLButtonElement): void {
    this.selectedId = id;
    this.returnRowId = id;
    this.listScrollTop = this.listTarget.scrollTop;
    this.render();
    if (this.isMobile()) {
      this.element.classList.add('notifications-view--detail');
      this.detailTarget.querySelector<HTMLElement>('[data-notification-detail-heading]')?.focus();
    }
    row.setAttribute('aria-selected', 'true');
  }

  private async handleAction(control: HTMLElement): Promise<void> {
    const action = control.dataset.notificationAction;
    const item = this.selectedItem();
    if (action === 'back') {
      this.showMobileList();
      return;
    }
    if (!item || this.busyItemId) return;

    if (action === 'open-event' && item.kind === 'calendar_invitation') {
      this.navigateToSource('events', item.canonical_event_id);
      return;
    }
    if (action === 'open-task' && item.kind === 'task_reminder') {
      this.navigateToSource('tasks', item.task_id);
      return;
    }
    if (
      action?.startsWith('respond-')
      && item.kind === 'calendar_invitation'
      && item.status === 'active'
      && item.capabilities.can_respond
    ) {
      const response = action.slice('respond-'.length) as InvitationChoice;
      if (!['allow', 'maybe', 'refuse'].includes(response)) return;
      const button = control as HTMLButtonElement;
      if (item.capabilities.recurrence_scopes.length > 1) {
        this.openScopeDialog(response, button);
      } else {
        const scope = item.capabilities.recurrence_scopes[0] ?? null;
        await this.submitInvitationResponse(response, scope, button);
      }
      return;
    }
    if (
      action === 'retry-rsvp'
      && item.kind === 'calendar_invitation'
      && item.status === 'active'
      && item.capabilities.can_respond
      && item.action_error?.retryable === true
      && item.requested_action !== null
      && ['allow', 'maybe', 'refuse'].includes(item.requested_action)
    ) {
      await this.runMutation(
        () => retryCalendarInvitation({
          item_id: item.id,
          expected_item_version: item.version,
          operation_id: newOperationId('calendar-rsvp-retry'),
        }),
        'Invitation response queued for retry.',
        control,
      );
      return;
    }
    if (
      action === 'complete-task'
      && item.kind === 'task_reminder'
      && item.status === 'active'
      && item.capabilities.can_complete_task
    ) {
      await this.runMutation(
        () => completeNotificationTask({
          item_id: item.id,
          expected_item_version: item.version,
          operation_id: newOperationId('complete-notification-task'),
        }),
        'Task marked done.',
        control as HTMLElement,
      );
      return;
    }
    if (action === 'toggle-read' && item.capabilities.can_mark_read) {
      const read = !item.read_at;
      await this.runMutation(
        () => setNotificationRead({ item_id: item.id, read, expected_version: item.version }),
        read ? 'Notification marked read.' : 'Notification marked unread.',
        control as HTMLElement,
      );
      return;
    }
    if (
      action === 'defer-custom'
      && item.status === 'active'
      && item.capabilities.can_defer
    ) {
      this.openCustomDefer(item, control);
      return;
    }
    if (
      ['defer', 'defer-tomorrow'].includes(action ?? '')
      && item.status === 'active'
      && item.capabilities.can_defer
    ) {
      let visibleAfter: Date;
      let message = 'Notification deferred for one hour.';
      if (action === 'defer-tomorrow') {
        visibleAfter = new Date();
        visibleAfter.setDate(visibleAfter.getDate() + 1);
        visibleAfter.setHours(9, 0, 0, 0);
        message = 'Notification deferred until tomorrow morning.';
      } else {
        visibleAfter = new Date(Date.now() + 60 * 60 * 1000);
      }
      await this.runMutation(
        () => deferNotificationItem({
          item_id: item.id,
          visible_after: visibleAfter.toISOString(),
          expected_version: item.version,
        }),
        message,
        control,
      );
      return;
    }
    if (action === 'dismiss' && item.status === 'active' && item.capabilities.can_dismiss) {
      await this.runMutation(
        () => dismissNotificationItem({ item_id: item.id, expected_version: item.version }),
        'Notification dismissed.',
        control as HTMLElement,
      );
    }
  }

  private openCustomDefer(item: NotificationItemDto, control: HTMLElement): void {
    const dialog = document.querySelector<HTMLDialogElement>('#jin-due-date-dialog');
    if (!dialog) {
      this.announce('The date and time picker is unavailable.');
      return;
    }
    const editor = this.application.getControllerForElementAndIdentifier(
      dialog,
      'temporal-editor',
    ) as TemporalEditorController | null;
    if (!editor) {
      this.announce('The date and time picker is unavailable.');
      return;
    }
    editor.open({
      initialDue: null,
      presentation: 'notification',
      requireDate: true,
      requireTime: true,
      restoreFocusTo: control,
      validate: validateNotificationDeferTime,
      onCommit: (result) => {
        if (result.kind !== 'set') return;
        const visibleAfter = new Date(result.due);
        void this.runMutation(
          () => deferNotificationItem({
            item_id: item.id,
            visible_after: visibleAfter.toISOString(),
            expected_version: item.version,
          }),
          'Notification deferred until the selected time.',
          control,
        );
      },
    });
  }

  private async submitInvitationResponse(
    response: InvitationChoice,
    scope: InvitationRecurrenceScope | null,
    focus: HTMLElement | null,
  ): Promise<void> {
    const item = this.selectedItem();
    if (
      !item
      || item.kind !== 'calendar_invitation'
      || item.status !== 'active'
      || !item.capabilities.can_respond
    ) return;
    const label = response === 'allow' ? 'allowed' : response === 'maybe' ? 'marked maybe' : 'refused';
    await this.runMutation(
      () => respondCalendarInvitation({
        item_id: item.id,
        expected_item_version: item.version,
        operation_id: newOperationId('calendar-rsvp'),
        response,
        recurrence_scope: scope,
      }),
      `Invitation ${label}. Pending provider confirmation.`,
      focus,
    );
  }

  private async runMutation(
    mutate: () => Promise<NotificationItemDto>,
    successMessage: string,
    focus: HTMLElement | null,
  ): Promise<void> {
    const item = this.selectedItem();
    if (!item) return;
    this.busyItemId = item.id;
    this.render();
    this.announce('Working…');
    try {
      const updated = await mutate();
      this.replaceItem(updated);
      await this.refresh();
      this.announce(successMessage);
    } catch (error: unknown) {
      if (isNotificationError(error) && error.item) this.replaceItem(error.item);
      await this.refresh();
      const message = isNotificationError(error) ? error.message : 'The action could not be completed.';
      this.announce(`Action failed: ${message}`);
    } finally {
      this.busyItemId = null;
      this.render();
      const action = focus?.dataset.notificationAction;
      restoreNotificationFocus(this.detailTarget, action ?? null);
    }
  }

  private replaceItem(updated: NotificationItemDto): void {
    const index = this.items.findIndex((item) => item.id === updated.id);
    if (index >= 0) this.items[index] = updated;
    else this.items.unshift(updated);
    this.selectedId = updated.id;
  }

  private render(): void {
    const empty = this.items.length === 0;
    this.workspaceTarget.classList.toggle('notifications-workspace--empty', empty);
    renderNotificationList(this.listTarget, this.items, {
      selectedId: this.selectedId,
      busyItemId: this.busyItemId,
    });
    renderNotificationDetail(this.detailTarget, this.selectedItem(), {
      selectedId: this.selectedId,
      busyItemId: this.busyItemId,
    });
    initIcons(this.element);
  }

  private setLoading(loading: boolean): void {
    this.loadingTarget.classList.toggle('hidden', !loading);
    this.element.setAttribute('aria-busy', String(loading));
  }

  private renderError(message: string | null): void {
    this.errorTarget.textContent = message ?? '';
    this.errorTarget.classList.toggle('hidden', !message);
  }

  private renderPartialErrors(
    errors: Array<{
      source_kind: 'calendar_invitation' | 'task_reminder';
      source_key: string;
      code: string;
      message: string;
      updated_at: string;
    }>,
    total: number,
  ): void {
    if (total === 0) {
      this.partialErrorTarget.replaceChildren();
      this.partialErrorTarget.classList.add('hidden');
      return;
    }
    const summary = notificationSourceErrorSummary(errors, total);
    const heading = document.createElement('strong');
    heading.textContent = summary.heading;
    const detail = document.createElement('span');
    detail.textContent = ` ${summary.detail}`;
    this.partialErrorTarget.replaceChildren(heading, detail);
    this.partialErrorTarget.classList.remove('hidden');
  }

  private announce(message: string): void {
    announceNotification(this.liveTarget, message);
  }

  private updateBadge(count: number): void {
    const badge = document.querySelector<HTMLElement>('[data-notifications-badge]');
    const label = document.querySelector<HTMLElement>('[data-notifications-badge-label]');
    const nav = document.querySelector<HTMLElement>('[data-notifications-nav]');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    }
    if (label) label.textContent = `${count} unread notification${count === 1 ? '' : 's'}`;
    if (nav) nav.setAttribute('aria-label', `Notifications, ${count} unread`);
  }

  private navigateToSource(kind: 'events' | 'tasks', id: string): void {
    this.element.dispatchEvent(new CustomEvent('jin:navigate', {
      bubbles: true,
      detail: { kind, id },
    }));
  }

  private isMobile(): boolean {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 700px)').matches;
    }
    return window.innerWidth <= 700;
  }

  private showMobileList(): void {
    this.element.classList.remove('notifications-view--detail');
    this.listTarget.scrollTop = this.listScrollTop;
    const row = this.returnRowId
      ? Array.from(this.listTarget.querySelectorAll<HTMLElement>('[data-notification-select]'))
        .find((candidate) => candidate.dataset.notificationSelect === this.returnRowId) ?? null
      : null;
    row?.focus();
  }

  private activeFilterControl(): HTMLButtonElement | null {
    return this.filterTargets.find(
      (target) => target.dataset.notificationFilter === this.filter,
    ) ?? this.filterTargets[0] ?? null;
  }

  private openScopeDialog(response: InvitationChoice, button: HTMLButtonElement): void {
    this.pendingResponse = response;
    this.pendingResponseButton = button;
    this.scopeTitleTarget.textContent = `Apply ${response === 'allow' ? 'Allow' : response === 'maybe' ? 'Maybe' : 'Refuse'} to`;
    this.scopeThisTarget.checked = true;
    this.scopeSeriesTarget.checked = false;
    if (typeof this.scopeDialogTarget.showModal === 'function') this.scopeDialogTarget.showModal();
    else this.scopeDialogTarget.setAttribute('open', '');
    this.scopeThisTarget.focus();
  }

  private closeScopeDialog(restoreFocus: boolean): void {
    if (this.scopeDialogTarget.hasAttribute('open')) {
      if (typeof this.scopeDialogTarget.close === 'function') this.scopeDialogTarget.close();
      else this.scopeDialogTarget.removeAttribute('open');
    }
    const focus = this.pendingResponseButton;
    this.pendingResponse = null;
    this.pendingResponseButton = null;
    if (restoreFocus) focus?.focus();
  }
}
