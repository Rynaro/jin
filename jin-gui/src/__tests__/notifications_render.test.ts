// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatInstant,
  notificationStateLabels,
  notificationSourceErrorSummary,
  renderNotificationDetail,
  renderNotificationList,
} from '../lib/notifications/render';
import { invitationFixture, taskReminderFixture } from './notifications_fixtures';

describe('Notification Center rendering', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.append(container);
  });

  it('invitation_content_and_actions', () => {
    const invitation = invitationFixture();
    renderNotificationDetail(container, invitation);

    expect(container.textContent).toContain('Ari Organizer');
    expect(container.textContent).toContain('ari@example.test');
    expect(container.textContent).toContain('Work · Primary calendar');
    expect(container.textContent).toContain('Studio 4');
    expect(container.querySelector('[data-notification-action="open-event"]')?.textContent).toBe('View event');
    expect(container.querySelector('[data-notification-action="respond-allow"]')?.textContent).toBe('Allow');
    expect(container.querySelector('[data-notification-action="respond-maybe"]')?.textContent).toBe('Maybe');
    expect(container.querySelector('[data-notification-action="respond-refuse"]')?.textContent).toBe('Refuse');
    expect(container.querySelector('[aria-label="Invitation response"]')).not.toBeNull();
  });

  it('renders an all-day calendar date without negative-offset UTC drift in list and detail', () => {
    const allDay = invitationFixture({
      start: '2026-01-15',
      end: '2026-01-16',
      all_day: true,
      timezone: null,
    });
    const expectedStart = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date('2026-01-15T00:00:00Z'));
    const negativeOffsetDrift = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeZone: 'America/Los_Angeles',
    }).format(new Date('2026-01-15T00:00:00Z'));
    expect(expectedStart).not.toBe(negativeOffsetDrift);
    expect(formatInstant(allDay.start, true)).toBe(expectedStart);

    renderNotificationList(container, [allDay]);
    expect(container.textContent).toContain(expectedStart);
    expect(container.textContent).not.toContain(negativeOffsetDrift);

    renderNotificationDetail(container, allDay);
    expect(container.textContent).toContain(expectedStart);
    expect(container.textContent).not.toContain(negativeOffsetDrift);
  });

  it('task_controls', () => {
    renderNotificationDetail(container, taskReminderFixture());

    expect(container.textContent).toContain('Scheduled');
    expect(container.textContent).toContain('Work');
    expect(container.textContent).toContain('Launch');
    expect(container.querySelector('[data-notification-action="open-task"]')?.textContent).toBe('Open task');
    expect(container.querySelector('[data-notification-action="complete-task"]')?.textContent).toBe('Mark done');
    expect(container.querySelector('[data-notification-action="toggle-read"]')?.textContent).toBe('Mark read');
    expect(container.querySelector('[data-notification-action="defer"]')?.textContent).toBe('Defer 1 hour');
    const customDefer = container.querySelector<HTMLButtonElement>('[data-notification-action="defer-custom"]')!;
    expect(customDefer.textContent).toBe('Defer until…');
    expect(customDefer.classList.contains('jin-control--icon-label')).toBe(true);
    expect(customDefer.querySelector('.jin-control__label')?.textContent).toBe('Defer until…');
    expect(customDefer.querySelector('[data-lucide="calendar-days"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-notification-action="dismiss"]')?.textContent).toBe('Dismiss');
    expect(container.textContent).not.toContain('Current response');
  });

  it('renders one centered-workspace-compatible accessible empty detail group', () => {
    renderNotificationDetail(container, null);

    const empty = container.querySelector<HTMLElement>('.notifications-detail-empty')!;
    expect(container.children).toHaveLength(1);
    expect(empty.getAttribute('role')).toBe('status');
    expect(empty.getAttribute('aria-live')).toBe('polite');
    expect(empty.querySelector('[data-lucide="inbox"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(empty.textContent).toContain('Choose a notification to review it.');
  });

  it('renders native keyboard-operable list rows with selected text cues', () => {
    const items = [invitationFixture(), taskReminderFixture()];
    renderNotificationList(container, items, { selectedId: items[0].id });

    const rows = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].tagName).toBe('BUTTON');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[0].textContent).toContain('Unread');
    expect(rows[0].textContent).toContain('Selected');
  });

  it('summarizes partial errors by safe provider category without diagnostic data', () => {
    const secret = 'google/private-account/private-calendar/private-event/master';
    const summary = notificationSourceErrorSummary([{
      source_kind: 'calendar_invitation',
      source_key: secret,
      code: 'self_attendee_missing',
      message: 'provider payload: private@example.test',
      updated_at: '2026-09-02T12:00:00Z',
    }], 204);

    expect(summary.heading).toBe('204 Google Calendar events could not be checked.');
    expect(summary.detail).toContain('Sync Google Calendar');
    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(JSON.stringify(summary)).not.toContain('private@example.test');
  });

  it('keeps provider truth visible beneath a pending-choice overlay', () => {
    const pending = invitationFixture({
      status: 'action_pending',
      requested_action: 'allow',
      action_state: 'queued',
      provider_response_status: 'needsAction',
    });
    renderNotificationDetail(container, pending);

    expect(container.textContent).toContain('Pending sync: Allow');
    expect(container.textContent).toContain('Google’s confirmed response remains Awaiting your response');
    expect(container.querySelector('[aria-label="Invitation response"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="defer"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="dismiss"]')?.disabled).toBe(true);
  });

  it('offers Retry only for an active retryable invitation failure', () => {
    const retryable = invitationFixture({
      requested_action: 'refuse',
      action_state: 'failed_retryable',
      action_error: { code: 'provider_failed', message: 'Try later', retryable: true },
    });
    renderNotificationDetail(container, retryable);
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="retry-rsvp"]')?.disabled).toBe(false);

    renderNotificationDetail(container, invitationFixture({
      requested_action: 'refuse',
      action_state: 'failed_terminal',
      action_error: { code: 'permission_denied', message: 'Reconnect', retryable: false },
    }));
    expect(container.querySelector('[data-notification-action="retry-rsvp"]')).toBeNull();
  });

  it('disables invalid historical and busy mutations', () => {
    renderNotificationDetail(container, taskReminderFixture({ status: 'acted' }));
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="complete-task"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="defer"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-notification-action="dismiss"]')?.disabled).toBe(true);

    const active = invitationFixture({
      requested_action: 'allow',
      action_state: 'failed_retryable',
      action_error: { code: 'provider_failed', message: 'Try later', retryable: true },
    });
    renderNotificationDetail(container, active, { busyItemId: active.id });
    const mutationActions = ['respond-allow', 'retry-rsvp', 'toggle-read', 'defer', 'dismiss'];
    for (const action of mutationActions) {
      expect(container.querySelector<HTMLButtonElement>(`[data-notification-action="${action}"]`)?.disabled).toBe(true);
    }
  });

  it('state labels carry failed superseded disabled and selected meaning in text', () => {
    const item = invitationFixture({
      status: 'superseded',
      action_error: { code: 'provider_failed', message: 'Try again later', retryable: true },
      capabilities: {
        ...invitationFixture().capabilities,
        can_respond: false,
        disabled_reason: 'Account changed',
      },
    });
    expect(notificationStateLabels(item, true)).toEqual(expect.arrayContaining([
      'Unread',
      'Selected',
      'Failed: Try again later',
      'Superseded by a newer response',
      'Disabled: Account changed',
    ]));
  });
});
