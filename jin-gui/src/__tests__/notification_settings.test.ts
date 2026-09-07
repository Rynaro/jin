// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  notificationStatus,
  openNotificationSettings,
  requestNotificationPermission,
  sendTestNotification,
} from '../invoke';
import SettingsController from '../controllers/settings_controller';

const mockInvoke = vi.mocked(invoke);
const root = process.cwd();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeController(): any {
  const controller = Object.create(SettingsController.prototype) as any;
  controller.notificationLoadingTarget = document.createElement('div');
  controller.notificationStatusTarget = document.createElement('span');
  controller.notificationReasonTarget = document.createElement('p');
  controller.notificationAllowBtnTarget = document.createElement('button');
  controller.notificationSettingsBtnTarget = document.createElement('button');
  controller.notificationTestBtnTarget = document.createElement('button');
  controller.notificationCheckBtnTarget = document.createElement('button');
  controller.notificationResultTarget = document.createElement('p');
  controller.notificationErrorTarget = document.createElement('p');
  controller.notificationOperationGeneration = 0;
  controller.notificationActiveOperations = 0;
  controller.notificationRefreshQueued = false;
  controller.hasSuccessfulNotificationStatus = false;
  controller.lastNotificationStatus = null;
  controller.notificationFocusTarget = null;
  return controller;
}

function attachNotificationControls(controller: any): void {
  document.body.append(
    controller.notificationAllowBtnTarget,
    controller.notificationSettingsBtnTarget,
    controller.notificationTestBtnTarget,
    controller.notificationCheckBtnTarget,
  );
}

const promptStatus = {
  platform: 'macos', permission: 'prompt' as const,
  reason: 'Permission has not been requested.', can_request: true,
  can_open_settings: true, settings_scope: 'notification_center',
};
const grantedStatus = {
  ...promptStatus, permission: 'granted' as const, reason: 'Allowed.', can_request: false,
};

beforeEach(() => {
  mockInvoke.mockReset();
  document.body.replaceChildren();
});

describe('notification settings bridge and UI', () => {
  it('uses the four fixed, argument-free Tauri commands', async () => {
    mockInvoke.mockResolvedValue({});
    await notificationStatus();
    await requestNotificationPermission();
    await openNotificationSettings();
    await sendTestNotification();
    expect(mockInvoke.mock.calls).toEqual([
      ['notification_status', {}],
      ['request_notification_permission', {}],
      ['open_notification_settings', {}],
      ['send_test_notification', {}],
    ]);
  });

  it('renders backend permission state and only offers Allow for prompt', () => {
    const controller = makeController();
    controller.renderNotificationStatus(promptStatus);
    expect(controller.notificationStatusTarget.textContent).toBe('Permission needed');
    expect(controller.notificationAllowBtnTarget.hidden).toBe(false);
    expect(controller.notificationTestBtnTarget.disabled).toBe(true);
    controller.renderNotificationStatus(grantedStatus);
    expect(controller.notificationAllowBtnTarget.hidden).toBe(true);
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
  });

  it('fails closed after the initial status check rejects and leaves retry available', async () => {
    const controller = makeController();
    mockInvoke.mockRejectedValueOnce('status timed out');
    await controller.loadNotificationStatus();
    expect(controller.notificationLoadingTarget.classList.contains('hidden')).toBe(true);
    expect(controller.notificationStatusTarget.textContent).toBe('Check failed');
    expect(controller.notificationReasonTarget.textContent).toContain('Check Again');
    expect(controller.notificationErrorTarget.textContent).toBe('status timed out');
    expect(controller.notificationErrorTarget.classList.contains('hidden')).toBe(false);
    expect(controller.notificationCheckBtnTarget.disabled).toBe(false);
    expect(controller.notificationAllowBtnTarget.disabled).toBe(true);
    expect(controller.notificationSettingsBtnTarget.disabled).toBe(true);
    expect(controller.notificationTestBtnTarget.disabled).toBe(true);
  });

  it('coalesces focus during Allow and keeps controls disabled through the queued refresh', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(promptStatus);
    const allow = deferred<typeof grantedStatus>();
    const refresh = deferred<typeof grantedStatus>();
    mockInvoke.mockImplementationOnce(() => allow.promise)
      .mockImplementationOnce(() => refresh.promise);
    const action = controller.allowNotifications();
    controller.requestNotificationRefresh();
    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual(['request_notification_permission']);
    allow.resolve(grantedStatus);
    await action;
    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      'request_notification_permission', 'notification_status',
    ]);
    expect(controller.notificationTestBtnTarget.disabled).toBe(true);
    refresh.resolve(grantedStatus);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.notificationStatusTarget.textContent).toBe('Allowed');
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
  });

  it('coalesces focus across Open Settings and its status follow-up', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(grantedStatus);
    const opened = deferred<void>();
    const followUp = deferred<typeof grantedStatus>();
    const queued = deferred<typeof grantedStatus>();
    let statusCalls = 0;
    mockInvoke.mockImplementationOnce(() => opened.promise)
      .mockImplementationOnce(() => { statusCalls += 1; return followUp.promise; })
      .mockImplementationOnce(() => { statusCalls += 1; return queued.promise; });
    const action = controller.openNotificationSettings();
    opened.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(statusCalls).toBe(1);
    controller.requestNotificationRefresh();
    expect(controller.notificationCheckBtnTarget.disabled).toBe(true);
    followUp.resolve(grantedStatus);
    await action;
    expect(statusCalls).toBe(2);
    expect(controller.notificationResultTarget.textContent).toContain('Notification Settings opened');
    expect(controller.notificationTestBtnTarget.disabled).toBe(true);
    queued.resolve(grantedStatus);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
  });

  it('ignores a stale status response that resolves after a newer check', async () => {
    const controller = makeController();
    const older = deferred<typeof promptStatus>();
    const newer = deferred<typeof grantedStatus>();
    mockInvoke.mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const first = controller.loadNotificationStatus();
    const second = controller.loadNotificationStatus();
    newer.resolve(grantedStatus);
    await second;
    older.resolve(promptStatus);
    await first;
    expect(controller.notificationStatusTarget.textContent).toBe('Allowed');
    expect(controller.notificationReasonTarget.textContent).toBe('Allowed.');
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
  });

  it('coalesces focus during Send Test without losing the newer test result', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(grantedStatus);
    const submitted = deferred<{ submitted: boolean; message: string }>();
    const refresh = deferred<typeof grantedStatus>();
    mockInvoke.mockImplementationOnce(() => submitted.promise)
      .mockImplementationOnce(() => refresh.promise);
    const action = controller.sendTestNotification();
    controller.requestNotificationRefresh();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    submitted.resolve({ submitted: true, message: 'Submitted; check Focus or Do Not Disturb.' });
    await action;
    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      'send_test_notification', 'notification_status',
    ]);
    expect(controller.notificationResultTarget.textContent).toContain('Focus or Do Not Disturb');
    expect(controller.notificationTestBtnTarget.disabled).toBe(true);
    refresh.resolve(grantedStatus);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.notificationResultTarget.textContent).toContain('Focus or Do Not Disturb');
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
  });

  it('preserves Check Again focus without allowing a duplicate while pending', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(grantedStatus);
    attachNotificationControls(controller);
    const status = deferred<typeof grantedStatus>();
    mockInvoke.mockImplementationOnce(() => status.promise);
    controller.notificationCheckBtnTarget.focus();
    const focus = vi.spyOn(controller.notificationCheckBtnTarget, 'focus');

    const action = controller.checkNotificationStatus();
    void controller.checkNotificationStatus();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(controller.notificationCheckBtnTarget.disabled).toBe(false);
    expect(controller.notificationCheckBtnTarget.getAttribute('aria-disabled')).toBe('true');
    status.resolve(grantedStatus);
    await action;

    expect(document.activeElement).toBe(controller.notificationCheckBtnTarget);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(controller.notificationCheckBtnTarget.hasAttribute('aria-disabled')).toBe(false);
  });

  it('preserves Send Test focus without allowing a duplicate while pending', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(grantedStatus);
    attachNotificationControls(controller);
    const submitted = deferred<{ submitted: boolean; message: string }>();
    mockInvoke.mockImplementationOnce(() => submitted.promise);
    controller.notificationTestBtnTarget.focus();
    const focus = vi.spyOn(controller.notificationTestBtnTarget, 'focus');

    const action = controller.sendTestNotification();
    void controller.sendTestNotification();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(controller.notificationTestBtnTarget.disabled).toBe(false);
    submitted.resolve({ submitted: true, message: 'Submitted.' });
    await action;

    expect(document.activeElement).toBe(controller.notificationTestBtnTarget);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('preserves Allow focus while a permission request remains actionable', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(promptStatus);
    attachNotificationControls(controller);
    const requested = deferred<typeof promptStatus>();
    mockInvoke.mockImplementationOnce(() => requested.promise);
    controller.notificationAllowBtnTarget.focus();
    const focus = vi.spyOn(controller.notificationAllowBtnTarget, 'focus');

    const action = controller.allowNotifications();
    void controller.allowNotifications();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(controller.notificationAllowBtnTarget.disabled).toBe(false);
    requested.resolve(promptStatus);
    await action;

    expect(document.activeElement).toBe(controller.notificationAllowBtnTarget);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('preserves Open Settings focus through its status follow-up', async () => {
    const controller = makeController();
    controller.renderNotificationStatus(grantedStatus);
    attachNotificationControls(controller);
    const opened = deferred<void>();
    const refreshed = deferred<typeof grantedStatus>();
    mockInvoke.mockImplementationOnce(() => opened.promise)
      .mockImplementationOnce(() => refreshed.promise);
    controller.notificationSettingsBtnTarget.focus();
    const focus = vi.spyOn(controller.notificationSettingsBtnTarget, 'focus');

    const action = controller.openNotificationSettings();
    void controller.openNotificationSettings();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(controller.notificationSettingsBtnTarget.disabled).toBe(false);
    opened.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    refreshed.resolve(grantedStatus);
    await action;

    expect(document.activeElement).toBe(controller.notificationSettingsBtnTarget);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('keeps the section after Sync and before Export with accessible result regions', () => {
    const html = readFileSync(`${root}/index.html`, 'utf8');
    const sync = html.indexOf('aria-label="Sync"');
    const notifications = html.indexOf('aria-label="Notifications"');
    const exportSection = html.indexOf('aria-label="Export"');
    expect(sync).toBeLessThan(notifications);
    expect(notifications).toBeLessThan(exportSection);
    expect(html).toContain('data-settings-target="notificationResult"');
    expect(html).toMatch(/notificationError[^>]*><\/p>/);
  });

  it('styles distinct permission pills and fixture results stay truthful', () => {
    const css = readFileSync(`${root}/src/styles/settings.css`, 'utf8');
    const typography = readFileSync(`${root}/src/styles/typography.css`, 'utf8');
    const fixture = readFileSync(`${root}/tools/tauri-fixture-init.js`, 'utf8');
    expect(css).toContain('.notification-status-pill[data-permission="granted"]');
    expect(css).toMatch(/\.notification-busy-row\s*\{[^}]*min-block-size:\s*calc\(var\(--text-callout-line\) \+ 2 \* var\(--space-1\)\)/s);
    expect(css).toMatch(/\.settings-loading\s*\{[^}]*line-height:\s*var\(--text-callout-line\)[^}]*padding-block:\s*var\(--space-1\)/s);
    expect(css).toContain('.notification-reason');
    expect(typography).toContain(':where(a[href], button, input, select, textarea, summary, [tabindex]');
    expect(typography).not.toMatch(/\n:focus-visible\s*\{/);
    expect(fixture).toContain("cmd === 'notification_status'");
    expect(fixture).toContain('Focus or Do Not Disturb');
    expect(fixture).not.toContain('notification delivered');
  });
});
