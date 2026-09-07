// @vitest-environment jsdom

import { Application, Controller, defaultSchema } from '@hotwired/stimulus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import NotificationsController, { validateNotificationDeferTime } from '../controllers/notifications_controller';
import type { TemporalEditorSession } from '../controllers/temporal_editor_controller';
import { composeDueString } from '../lib/calendar/transform';
import type { NotificationItemDto } from '../types/dto';
import { invitationFixture, taskReminderFixture } from './notifications_fixtures';

const mockInvoke = vi.mocked(invoke);
let temporalSession: TemporalEditorSession | null = null;

class TemporalEditorStub extends Controller {
  open(session: TemporalEditorSession): void {
    temporalSession = session;
  }
}

function controllerMarkup(): string {
  return `
    <a href="#notifications" data-notifications-nav aria-label="Notifications, 0 unread">
      Notifications
      <span data-notifications-badge hidden aria-hidden="true">0</span>
      <span data-notifications-badge-label>0 unread notifications</span>
    </a>
    <section
      data-controller="notifications"
      data-action="click->notifications#handleClick"
      aria-busy="false"
    >
      <button data-notifications-target="filter" data-notification-filter="all" aria-pressed="true" data-action="click->notifications#selectFilter">All</button>
      <button data-notifications-target="filter" data-notification-filter="unread" aria-pressed="false" data-action="click->notifications#selectFilter">Unread</button>
      <button data-notifications-target="filter" data-notification-filter="deferred" aria-pressed="false" data-action="click->notifications#selectFilter">Deferred</button>
      <button data-notifications-target="filter" data-notification-filter="history" aria-pressed="false" data-action="click->notifications#selectFilter">History</button>
      <div data-notifications-target="loading">Loading</div>
      <p data-notifications-target="error" class="hidden"></p>
      <div data-notifications-target="partialError" class="hidden" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="notifications-workspace" data-notifications-target="workspace">
        <div data-notifications-target="list" data-action="keydown->notifications#handleListKeydown"></div>
        <div data-notifications-target="detail"></div>
      </div>
      <p data-notifications-target="live" role="status" aria-live="polite" aria-atomic="true"></p>
      <dialog
        data-notifications-target="scopeDialog"
        data-action="keydown->notifications#trapScopeDialog cancel->notifications#cancelScope"
      >
        <h2 data-notifications-target="scopeTitle">Apply response to</h2>
        <label><input type="radio" name="scope" data-notifications-target="scopeThis" />This occurrence</label>
        <label><input type="radio" name="scope" data-notifications-target="scopeSeries" />Entire series</label>
        <button data-action="click->notifications#cancelScope">Cancel</button>
        <button data-notifications-target="scopeConfirm" data-action="click->notifications#confirmScope">Confirm</button>
      </dialog>
    </section>
    <dialog id="jin-due-date-dialog" data-controller="temporal-editor"></dialog>`;
}

function page(items: NotificationItemDto[]) {
  return { items, next_cursor: null, snapshot_watermark: '2026-09-02T12:00:00Z', partial_errors: [] };
}

function installMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: '(max-width: 700px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function activateNotifications(app: Application): void {
  const element = document.querySelector<HTMLElement>('[data-controller="notifications"]')!;
  const controller = app.getControllerForElementAndIdentifier(element, 'notifications') as NotificationsController | null;
  controller?.activate();
}

describe('NotificationsController', () => {
  let app: Application;
  const invite = invitationFixture();
  const reminder = taskReminderFixture();

  beforeEach(() => {
    document.body.innerHTML = controllerMarkup();
    temporalSession = null;
    installMatchMedia(false);
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_notification_items') return page([invite, reminder]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 2, visible_total: 2, pending: 0, errors: 0, partial_error_count: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    app = Application.start(document.documentElement, defaultSchema);
    app.register('temporal-editor', TemporalEditorStub);
    app.register('notifications', NotificationsController);
  });

  afterEach(() => {
    app.stop();
    vi.restoreAllMocks();
  });

  it('sidebar_badge_accessible_count', async () => {
    await settle();

    const badge = document.querySelector<HTMLElement>('[data-notifications-badge]')!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('2');
    expect(document.querySelector('[data-notifications-badge-label]')?.textContent).toBe('2 unread notifications');
    expect(document.querySelector('[data-notifications-nav]')?.getAttribute('aria-label')).toBe('Notifications, 2 unread');
  });

  it('desktop_list_detail', async () => {
    await settle();

    const rows = document.querySelectorAll<HTMLButtonElement>('[data-notification-select]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('role')).toBe('option');
    expect(document.querySelector('[data-notification-item-id="notification-invite-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Ari Organizer');

    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    expect(document.querySelector('.notifications-view--detail')).toBeNull();
    expect(document.querySelector('.notifications-workspace--empty')).toBeNull();
  });

  it('zero-item state explicitly spans the workspace without a redundant empty pane', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_notification_items') return page([]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 0, visible_total: 0, pending: 0, errors: 0, partial_error_count: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();

    const workspace = document.querySelector<HTMLElement>('[data-notifications-target="workspace"]')!;
    const detail = document.querySelector<HTMLElement>('[data-notifications-target="detail"]')!;
    expect(workspace.classList.contains('notifications-workspace--empty')).toBe(true);
    expect(document.querySelector('[data-notifications-target="empty"]')).toBeNull();
    expect(detail.querySelector('[role="status"]')?.textContent).toContain(
      'Choose a notification to review it.',
    );
  });

  it('mobile_back_restores_context', async () => {
    installMatchMedia(true);
    await settle();
    const section = document.querySelector<HTMLElement>('[data-controller="notifications"]')!;
    const list = document.querySelector<HTMLElement>('[data-notifications-target="list"]')!;
    const rows = document.querySelectorAll<HTMLButtonElement>('[data-notification-select]');
    list.scrollTop = 37;

    rows[1].click();
    await settle();
    expect(section.classList.contains('notifications-view--detail')).toBe(true);
    expect(document.activeElement?.hasAttribute('data-notification-detail-heading')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-notification-action="back"]')!.click();
    expect(section.classList.contains('notifications-view--detail')).toBe(false);
    expect(list.scrollTop).toBe(37);
    expect((document.activeElement as HTMLElement).dataset.notificationSelect).toBe(reminder.id);
  });

  it('mobile final-item mutation returns to the list and a reachable filter', async () => {
    installMatchMedia(true);
    let current: NotificationItemDto | null = invite;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_notification_items') {
        const filter = (args as { input?: { filter?: string } } | undefined)?.input?.filter;
        return page(filter === 'unread' && current?.read_at ? [] : current ? [current] : []);
      }
      if (command === 'notification_center_summary') {
        return {
          visible_unread: current?.read_at ? 0 : 1,
          visible_total: current ? 1 : 0,
          pending: 0,
          errors: 0,
          partial_error_count: 0,
        };
      }
      if (command === 'set_notification_read') {
        current = invitationFixture({ read_at: '2026-09-02T12:30:00Z', version: 5 });
        return current;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();

    const unread = document.querySelector<HTMLButtonElement>('[data-notification-filter="unread"]')!;
    unread.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-select]')!.click();
    await settle();
    const section = document.querySelector<HTMLElement>('[data-controller="notifications"]')!;
    expect(section.classList.contains('notifications-view--detail')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-notification-action="toggle-read"]')!.click();
    await settle();

    expect(section.classList.contains('notifications-view--detail')).toBe(false);
    expect(document.querySelectorAll('[data-notification-select]')).toHaveLength(0);
    expect(document.activeElement).toBe(unread);
  });

  it('rsvp_busy_and_live_region', async () => {
    const response = deferred<NotificationItemDto>();
    let current = invite;
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_notification_items') return page([current]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 1, visible_total: 1, pending: 0, errors: 0, partial_error_count: 0 };
      }
      if (command === 'respond_calendar_invitation') {
        current = await response.promise;
        return current;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();

    document.querySelector<HTMLButtonElement>('[data-notification-action="respond-allow"]')!.click();
    await Promise.resolve();

    const group = document.querySelector<HTMLElement>('[aria-label="Invitation response"]')!;
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(Array.from(group.querySelectorAll<HTMLButtonElement>('button')).every((button) => button.disabled)).toBe(true);
    expect(document.querySelector('[data-notifications-target="live"]')?.textContent).toBe('Working…');

    response.resolve(invitationFixture({
      status: 'action_pending',
      version: 5,
      requested_action: 'allow',
      action_state: 'queued',
    }));
    await settle();

    expect(document.querySelector('[data-notifications-target="live"]')?.textContent)
      .toBe('Invitation allowed. Pending provider confirmation.');
    expect(document.body.textContent).toContain('Pending sync: Allow');
  });

  it('successful mutation refetches and applies the active filter', async () => {
    let current = invite;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_notification_items') {
        const filter = (args as { input?: { filter?: string } } | undefined)?.input?.filter;
        return page(filter === 'unread' && current.read_at ? [] : [current]);
      }
      if (command === 'notification_center_summary') {
        return { visible_unread: current.read_at ? 0 : 1, visible_total: 1, pending: 0, errors: 0, partial_error_count: 0 };
      }
      if (command === 'set_notification_read') {
        current = invitationFixture({ read_at: '2026-09-02T12:30:00Z', version: 5 });
        return current;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-filter="unread"]')!.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-action="toggle-read"]')!.click();
    await settle();

    expect(document.querySelectorAll('[data-notification-select]')).toHaveLength(0);
    expect(document.querySelector('[data-notifications-badge]')?.hasAttribute('hidden')).toBe(true);
  });

  it('stale mutation response refetches and removes an item outside the active filter', async () => {
    let current = invite;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_notification_items') {
        const filter = (args as { input?: { filter?: string } } | undefined)?.input?.filter;
        return page(filter === 'unread' && current.read_at ? [] : [current]);
      }
      if (command === 'notification_center_summary') {
        return { visible_unread: current.read_at ? 0 : 1, visible_total: 1, pending: 0, errors: 0, partial_error_count: 0 };
      }
      if (command === 'set_notification_read') {
        current = invitationFixture({ read_at: '2026-09-02T12:30:00Z', version: 8 });
        throw { code: 'stale_item', message: 'Review the latest state.', retryable: true, item: current };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-filter="unread"]')!.click();
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-action="toggle-read"]')!.click();
    await settle();

    expect(document.querySelectorAll('[data-notification-select]')).toHaveLength(0);
    expect(document.querySelector('[data-notifications-target="live"]')?.textContent)
      .toBe('Action failed: Review the latest state.');
  });

  it('offers deferred and history views and requests their exact filters', async () => {
    await settle();
    for (const filter of ['deferred', 'history']) {
      document.querySelector<HTMLButtonElement>(`[data-notification-filter="${filter}"]`)!.click();
      await settle();
      expect(mockInvoke.mock.calls.some(([command, args]) => command === 'list_notification_items'
        && (args as { input?: { filter?: string } }).input?.filter === filter)).toBe(true);
    }
  });

  it('opens the shared temporal editor for a constrained custom defer time', async () => {
    const deferredAt: string[] = [];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_notification_items') return page([invite]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 1, visible_total: 1, pending: 0, errors: 0, partial_error_count: 0 };
      }
      if (command === 'defer_notification_item') {
        deferredAt.push((args as { input: { visible_after: string } }).input.visible_after);
        return invite;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    const trigger = document.querySelector<HTMLButtonElement>('[data-notification-action="defer-custom"]')!;
    expect(trigger.textContent).toContain('Defer until…');
    trigger.click();
    expect(temporalSession).toMatchObject({
      initialDue: null,
      presentation: 'notification',
      requireDate: true,
      requireTime: true,
      restoreFocusTo: trigger,
    });

    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const futureDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const futureTime = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const result = {
      kind: 'set' as const,
      due: future.toISOString(),
      date: futureDate,
      time: futureTime,
    };
    expect(temporalSession?.validate?.(result)).toBeNull();
    const past = new Date(Date.now() - 1_000);
    const pastResult = {
      ...result,
      due: past.toISOString(),
      date: `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`,
      time: `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`,
    };
    expect(temporalSession?.validate?.(pastResult))
      .toContain('future date and time within 30 days');
    temporalSession?.onCommit(result);
    await settle();
    expect(new Date(deferredAt[0]).valueOf()).toBe(future.valueOf());

    document.querySelector<HTMLButtonElement>('[data-notification-action="defer-tomorrow"]')!.click();
    await settle();
    const tomorrow = new Date(deferredAt[1]);
    expect(tomorrow.getHours()).toBe(9);
    expect(tomorrow.getMinutes()).toBe(0);
  });

  it('rejects a nonexistent DST wall time instead of submitting its normalized instant', () => {
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const result = {
        kind: 'set' as const,
        date: '2026-03-08',
        time: '02:30',
        due: composeDueString('2026-03-08', '02:30'),
      };

      expect(result.due).toContain('T03:30:00');
      expect(validateNotificationDeferTime(result, new Date('2026-03-01T12:00:00-05:00').valueOf()))
        .toBe('That time does not exist in your local time zone because the clocks change then. Choose another time.');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('aggregates and redacts persisted source failures in a nonfatal partial-error state', async () => {
    const secretSource = 'google/account-id/calendar-owner@example.com/event-id/' + 'x'.repeat(500);
    const providerInternal = 'provider body contained access_token=secret';
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_notification_items') return {
        ...page([invite]),
        partial_errors: [{
          source_kind: 'calendar_invitation', source_key: secretSource,
          code: 'canonical_event_invalid', message: providerInternal,
          updated_at: '2026-09-02T12:00:00Z',
        }],
      };
      if (command === 'notification_center_summary') {
        return { visible_unread: 1, visible_total: 1, pending: 0, errors: 0, partial_error_count: 204 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    const banner = document.querySelector<HTMLElement>('[data-notifications-target="partialError"]')!;
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(banner.textContent).toContain('204 Google Calendar events could not be checked');
    expect(banner.textContent).toContain('Sync Google Calendar');
    expect(banner.textContent).toContain('Other notifications are still available');
    expect(banner.textContent).not.toContain(secretSource);
    expect(banner.textContent).not.toContain('account-id');
    expect(banner.textContent).not.toContain('calendar-owner@example.com');
    expect(banner.textContent).not.toContain('event-id');
    expect(banner.textContent).not.toContain(providerInternal);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.getAttribute('aria-atomic')).toBe('true');
    expect(document.querySelectorAll('[data-notification-select]')).toHaveLength(1);
  });

  it('guards pending and historical controls even for synthetic stale clicks', async () => {
    const pending = invitationFixture({ status: 'action_pending', action_state: 'queued' });
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_notification_items') return page([pending]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 1, visible_total: 1, pending: 1, errors: 0, partial_error_count: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    const staleControl = document.createElement('span');
    staleControl.dataset.notificationAction = 'defer';
    document.querySelector('[data-controller="notifications"]')!.append(staleControl);
    staleControl.click();
    await settle();
    expect(mockInvoke.mock.calls.some(([command]) => command === 'defer_notification_item')).toBe(false);
  });

  it('retries only an active retryable invitation with a fresh operation', async () => {
    let current = invitationFixture({
      requested_action: 'refuse',
      action_state: 'failed_retryable',
      action_error: { code: 'provider_failed', message: 'Try later', retryable: true },
    });
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_notification_items') return page([current]);
      if (command === 'notification_center_summary') {
        return { visible_unread: 1, visible_total: 1, pending: current.status === 'action_pending' ? 1 : 0, errors: current.action_error ? 1 : 0, partial_error_count: 0 };
      }
      if (command === 'retry_calendar_invitation') {
        expect(args).toMatchObject({ input: {
          item_id: current.id,
          expected_item_version: current.version,
          operation_id: expect.stringContaining('calendar-rsvp-retry'),
        } });
        current = invitationFixture({
          status: 'action_pending', version: 5, requested_action: 'refuse',
          action_state: 'queued', action_error: null,
        });
        return current;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    activateNotifications(app);
    await settle();
    document.querySelector<HTMLButtonElement>('[data-notification-action="retry-rsvp"]')!.click();
    await settle();
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'retry_calendar_invitation')).toHaveLength(1);
    expect(document.body.textContent).toContain('Pending sync: Refuse');
  });
});
