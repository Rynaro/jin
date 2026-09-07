// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  announceNotification,
  restoreNotificationFocus,
  trapDialogFocus,
} from '../lib/notifications/accessibility';
import {
  renderNotificationDetail,
  renderNotificationList,
} from '../lib/notifications/render';
import { invitationFixture, taskReminderFixture } from './notifications_fixtures';

describe('Notification Center accessibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keyboard_order_and_dialog_trap', () => {
    const detail = document.createElement('div');
    document.body.append(detail);
    renderNotificationDetail(detail, invitationFixture({
      capabilities: {
        ...invitationFixture().capabilities,
        recurrence_scopes: ['this_occurrence', 'entire_series'],
      },
    }));

    const actionOrder = Array.from(detail.querySelectorAll<HTMLButtonElement>('button'))
      .map((button) => button.textContent?.trim());
    expect(actionOrder).toEqual([
      'Back to notifications',
      'View event',
      'Allow',
      'Maybe',
      'Refuse',
      'Mark read',
      'Defer 1 hour',
      'Defer until tomorrow morning',
      'Defer until…',
      'Dismiss',
    ]);

    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <input type="radio" aria-label="This occurrence" />
      <input type="radio" aria-label="Entire series" />
      <button type="button">Cancel</button>
      <button type="button">Confirm</button>`;
    document.body.append(dialog);
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, button'));

    controls[controls.length - 1].focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    expect(trapDialogFocus(dialog, forward)).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(trapDialogFocus(dialog, backward)).toBe(true);
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });

  it('focus_and_single_announcement', () => {
    const live = document.createElement('p');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const detail = document.createElement('div');
    document.body.append(live, detail);

    expect(announceNotification(live, 'Invitation allowed. Pending provider confirmation.')).toBe(true);
    expect(announceNotification(live, 'Invitation allowed. Pending provider confirmation.')).toBe(false);
    expect(live.textContent).toBe('Invitation allowed. Pending provider confirmation.');

    renderNotificationDetail(detail, invitationFixture());
    const original = detail.querySelector<HTMLButtonElement>('[data-notification-action="toggle-read"]')!;
    original.focus();
    renderNotificationDetail(detail, invitationFixture({ read_at: '2026-09-02T12:10:00Z', version: 5 }));
    const restored = restoreNotificationFocus(detail, 'toggle-read');
    expect(restored?.textContent).toBe('Mark unread');
    expect(document.activeElement).toBe(restored);

    renderNotificationDetail(detail, invitationFixture({
      status: 'superseded',
      capabilities: {
        ...invitationFixture().capabilities,
        can_respond: false,
        disabled_reason: 'Response changed elsewhere',
      },
    }));
    const fallback = restoreNotificationFocus(detail, 'respond-allow');
    expect(fallback?.hasAttribute('data-notification-detail-heading')).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it('state_cues_do_not_require_color', () => {
    const list = document.createElement('div');
    document.body.append(list);
    const pending = invitationFixture({
      id: 'pending',
      status: 'action_pending',
      requested_action: 'maybe',
      action_state: 'queued',
      action_error: { code: 'provider_failed', message: 'Offline', retryable: true },
    });
    const superseded = invitationFixture({
      id: 'superseded',
      status: 'superseded',
      read_at: '2026-09-02T12:10:00Z',
      capabilities: {
        ...invitationFixture().capabilities,
        can_respond: false,
        disabled_reason: 'Account route changed',
      },
    });
    renderNotificationList(list, [pending, superseded, taskReminderFixture()], {
      selectedId: 'pending',
    });

    expect(list.textContent).toContain('Unread');
    expect(list.textContent).toContain('Selected');
    expect(list.textContent).toContain('Pending sync: Maybe');
    expect(list.textContent).toContain('Failed: Offline');
    expect(list.textContent).toContain('Superseded by a newer response');
    expect(list.textContent).toContain('Disabled: Account route changed');
    expect(list.querySelector('[aria-selected="true"]')).not.toBeNull();
  });

  it('listbox directly owns options through presentation-only wrappers', () => {
    const container = document.createElement('div');
    renderNotificationList(container, [invitationFixture(), taskReminderFixture()]);

    const listbox = container.querySelector<HTMLElement>('[role="listbox"]')!;
    const wrappers = Array.from(listbox.children);
    expect(wrappers).toHaveLength(2);
    expect(wrappers.every((wrapper) => wrapper.getAttribute('role') === 'presentation')).toBe(true);
    expect(wrappers.every((wrapper) => wrapper.firstElementChild?.getAttribute('role') === 'option')).toBe(true);
  });

  it('partial-error banner safely wraps pathological unbroken content', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/styles/notifications.css'),
      'utf8',
    );
    const rule = css.match(/\.notifications-partial-error\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('max-width: 100%');
    expect(rule).toContain('overflow-wrap: anywhere');
    expect(rule).toContain('word-break: break-word');
    expect(rule).toMatch(/line-height:\s*var\(--text-footnote-line\)/);
  });

  it('empty workspace spans both columns and centers its single status group', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/styles/notifications.css'),
      'utf8',
    );
    const workspaceRule = css.match(/\.notifications-workspace--empty\s*\{([^}]+)\}/)?.[1] ?? '';
    const listRule = css.match(
      /\.notifications-workspace--empty \.notifications-list-pane\s*\{([^}]+)\}/,
    )?.[1] ?? '';
    const detailRule = css.match(
      /\.notifications-workspace--empty \.notifications-detail-pane\s*\{([^}]+)\}/,
    )?.[1] ?? '';
    const emptyRule = css.match(/\.notifications-detail-empty\s*\{([^}]+)\}/)?.[1] ?? '';

    expect(workspaceRule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(listRule).toContain('display: none');
    expect(detailRule).toContain('grid-column: 1 / -1');
    expect(detailRule).toContain('display: block');
    expect(emptyRule).toContain('place-content: center');
    expect(emptyRule).toContain('justify-items: center');
    expect(emptyRule).toContain('min-height: 100%');
    expect(emptyRule).toContain('text-align: center');
  });
});
