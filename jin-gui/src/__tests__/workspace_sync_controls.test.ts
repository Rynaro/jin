// @vitest-environment jsdom
/**
 * Regression anchors for the provider-neutral Files & backups controls.
 *
 * The controls present only facts that Jin can check inside the workspace.
 * These tests deliberately avoid inventing a remote-provider upload state.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import SettingsController from '../controllers/settings_controller';
import { exportFiles, refreshWorkspaceProjection, workspaceStatus } from '../invoke';
import { formatExportResult } from '../lib/settings/transform';
import { renderExportResult, type SettingsExportElements } from '../lib/settings/render';
import type { ExportResultDto, WorkspaceStatusDto } from '../types/dto';

const mockInvoke = vi.mocked(invoke);
const mockOpenDialog = vi.mocked(openDialog);

function readyStatus(overrides: Partial<WorkspaceStatusDto> = {}): WorkspaceStatusDto {
  return {
    status: 'ready',
    portable: true,
    root_path: '/Users/fixture/Jin shared folder',
    recovery_path: '/Users/fixture/Library/Application Support/Jin/history',
    checked_at: '2026-07-01T10:00:00Z',
    canonical_file_count: 14,
    conflicts: [],
    message: null,
    ...overrides,
  };
}

function workspaceController(): SettingsController {
  const controller = Object.create(SettingsController.prototype) as SettingsController;
  const status = document.createElement('output');
  const checkedAt = document.createElement('time');
  const fileCount = document.createElement('span');
  const mode = document.createElement('span');
  const message = document.createElement('p');
  const conflicts = document.createElement('ul');
  const conflictGuidance = document.createElement('p');
  const check = document.createElement('button');
  const refresh = document.createElement('button');
  const open = document.createElement('button');
  const activity = document.createElement('ol');
  const activitySection = document.createElement('section');
  activitySection.hidden = true;
  const pane = document.createElement('section');
  pane.dataset.settingsPaneKey = 'data-storage';
  pane.hidden = false;
  pane.append(status);
  document.body.append(pane);

  Object.assign(controller, {
    hasWorkspaceStatusTarget: true,
    workspaceStatusTarget: status,
    workspaceCheckedAtTarget: checkedAt,
    workspaceFileCountTarget: fileCount,
    workspaceModeTarget: mode,
    workspaceMessageTarget: message,
    workspaceConflictsTarget: conflicts,
    workspaceConflictGuidanceTarget: conflictGuidance,
    workspaceCheckBtnTarget: check,
    workspaceRefreshBtnTarget: refresh,
    workspaceOpenBtnTarget: open,
    workspaceActivityTarget: activity,
    workspaceActivitySectionTarget: activitySection,
    workspaceOperationGeneration: 0,
  });
  return controller;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function exportElements(): SettingsExportElements {
  return {
    exportDestInput: document.createElement('input'),
    exportForceToggle: document.createElement('input'),
    exportBtn: document.createElement('button'),
    exportLoadingState: document.createElement('div'),
    exportResultDisplay: document.createElement('div'),
    exportFileCount: document.createElement('span'),
    exportDestDisplay: document.createElement('span'),
    exportAuditIncluded: document.createElement('span'),
    exportVerified: document.createElement('span'),
    exportError: document.createElement('p'),
  };
}

interface FixtureBridge {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function fixture(scenario?: string): FixtureBridge {
  const source = readFileSync(resolve(process.cwd(), 'tools/tauri-fixture-init.js'), 'utf8');
  const dom = new JSDOM('', { url: 'http://127.0.0.1:1420', runScripts: 'outside-only' });
  if (scenario) dom.window.localStorage.setItem('jin.fixture.workspaceScenario', scenario);
  dom.window.eval(source);
  return (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockOpenDialog.mockReset();
  document.body.replaceChildren();
});

describe('workspace invoke boundary', () => {
  it('uses no provider-specific arguments for a local status check or projection refresh', async () => {
    mockInvoke.mockResolvedValue(readyStatus());
    await workspaceStatus();
    await refreshWorkspaceProjection();
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'workspace_status', {});
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'refresh_workspace_projection', {});
  });

  it('keeps the verified export receipt returned by the native boundary', async () => {
    const receipt = { dest: '/tmp/Jin export', file_count: 14, included_audit: true, files: [], verified: true };
    mockInvoke.mockResolvedValue(receipt);
    await expect(exportFiles('/tmp/Jin export')).resolves.toEqual(receipt);
    expect(mockInvoke).toHaveBeenCalledWith('export_files', { dest: '/tmp/Jin export', force: undefined });
  });

  it('does not claim verification for an incomplete export receipt', () => {
    const elements = exportElements();
    const incomplete = {
      dest: '/tmp/Jin export', file_count: 14, included_audit: true, files: [], verified: false,
    } satisfies ExportResultDto;

    renderExportResult(elements, formatExportResult(incomplete));

    expect(elements.exportVerified.classList.contains('hidden')).toBe(true);
    expect(elements.exportVerified.textContent).not.toMatch(/verified/i);
  });
});

describe('Files & backups workspace controls', () => {
  it('leaves the chosen export destination unchanged when the folder picker is cancelled', async () => {
    const controller = Object.create(SettingsController.prototype) as SettingsController;
    const destination = document.createElement('input');
    destination.value = '/Users/fixture/previous export';
    Object.assign(controller, { exportDestInputTarget: destination });
    mockOpenDialog.mockResolvedValue(null);

    await controller.chooseExportDestination();

    expect(destination.value).toBe('/Users/fixture/previous export');
    expect(mockOpenDialog).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Choose export folder' });
  });

  it('renders a local-ready result, timestamp, count, and activity after an explicit check', async () => {
    const controller = workspaceController();
    mockInvoke.mockResolvedValue(readyStatus());

    await controller.checkWorkspace();

    expect(controller.workspaceStatusTarget.textContent).toBe('Local files checked');
    expect(controller.workspaceStatusTarget.dataset.status).toBe('ready');
    expect(controller.workspaceFileCountTarget.textContent).toBe('14');
    expect(controller.workspaceModeTarget.textContent).toBe('Portable workspace');
    expect(controller.workspaceMessageTarget.textContent).toBe('');
    expect(controller.workspaceRefreshBtnTarget.disabled).toBe(false);
    expect(controller.workspaceActivityTarget.textContent).toMatch(/Workspace checked/);
    expect(controller.workspaceActivitySectionTarget.hidden).toBe(false);
  });

  it('shows both preserved duplicate paths and holds local refresh for owner review', async () => {
    const controller = workspaceController();
    mockInvoke.mockResolvedValue(readyStatus({
      status: 'attention',
      canonical_file_count: 16,
      conflicts: [{
        kind: 'note', id: '01JINFIXTURECONFLICT',
        paths: ['notes/Travel plans.md', 'notes/Travel plans (conflicted copy).md'],
      }],
      message: 'Both versions are preserved. Review the listed files in your workspace, then check again.',
    }));

    await controller.checkWorkspace();

    expect(controller.workspaceStatusTarget.textContent).toBe('Needs attention');
    expect(controller.workspaceConflictsTarget.hidden).toBe(false);
    expect(controller.workspaceConflictGuidanceTarget.hidden).toBe(false);
    expect(controller.workspaceConflictsTarget.textContent).toContain('Travel plans (conflicted copy).md');
    expect(controller.workspaceRefreshBtnTarget.disabled).toBe(true);
    expect(controller.workspaceActivityTarget.textContent).toMatch(/needs attention/i);
  });

  it('keeps the workspace untouched and gives a retryable check failure a visible explanation', async () => {
    const controller = workspaceController();
    mockInvoke.mockRejectedValue({ code: 1, kind: 'other', message: 'Permission denied.', retriable: true });

    await controller.checkWorkspace();

    expect(controller.workspaceStatusTarget.textContent).toBe('Check failed');
    expect(controller.workspaceStatusTarget.dataset.status).toBe('attention');
    expect(controller.workspaceMessageTarget.textContent).toBe('Permission denied.');
    expect(controller.workspaceActivityTarget.textContent).toMatch(/check failed/i);
  });

  it('uses the explicit projection refresh action after a ready check', async () => {
    const controller = workspaceController();
    mockInvoke.mockResolvedValue(readyStatus({ canonical_file_count: 15 }));

    await controller.refreshWorkspaceProjection();

    expect(mockInvoke).toHaveBeenCalledWith('refresh_workspace_projection', {});
    expect(controller.workspaceFileCountTarget.textContent).toBe('15');
    expect(controller.workspaceActivityTarget.textContent).toMatch(/Local index refreshed/);
  });

  it('keeps a newer check result when an earlier focus check finishes afterwards', async () => {
    const controller = workspaceController();
    const older = deferred<WorkspaceStatusDto>();
    const newer = deferred<WorkspaceStatusDto>();
    mockInvoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const first = controller.checkWorkspace(false);
    const second = controller.checkWorkspace(true);
    newer.resolve(readyStatus({ canonical_file_count: 15 }));
    await second;
    older.resolve(readyStatus({
      status: 'attention', canonical_file_count: 0,
      conflicts: [{ kind: 'note', id: 'older', paths: ['notes/Older.md', 'notes/Older conflicted.md'] }],
      message: 'Older result',
    }));
    await first;

    expect(controller.workspaceStatusTarget.dataset.status).toBe('ready');
    expect(controller.workspaceFileCountTarget.textContent).toBe('15');
  });
});

describe('deterministic workspace fixture', () => {
  it('exposes ready, attention, stale, and failed checks without claiming provider upload state', async () => {
    await expect(fixture().invoke('workspace_status')).resolves.toMatchObject({
      status: 'ready', portable: true, canonical_file_count: 14, conflicts: [],
    });
    await expect(fixture('attention').invoke('workspace_status')).resolves.toMatchObject({
      status: 'attention', conflicts: [{ paths: expect.arrayContaining(['notes/Travel plans (conflicted copy).md']) }],
    });
    await expect(fixture('stale').invoke('workspace_status')).resolves.toMatchObject({ checked_at: '2026-06-29T10:00:00Z' });
    await expect(fixture('error').invoke('workspace_status')).rejects.toMatchObject({ retriable: true });
  });

  it('returns a verified export receipt and honors a directory-picker cancellation', async () => {
    const bridge = fixture();
    await expect(bridge.invoke('export_files', { dest: '/Users/fixture/Jin export' })).resolves.toMatchObject({
      verified: true, included_audit: true, file_count: 14,
    });

    const source = readFileSync(resolve(process.cwd(), 'tools/tauri-fixture-init.js'), 'utf8');
    const dom = new JSDOM('', { url: 'http://127.0.0.1:1420', runScripts: 'outside-only' });
    dom.window.localStorage.setItem('jin.fixture.exportPicker', 'cancel');
    dom.window.eval(source);
    const cancelled = (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
    await expect(cancelled.invoke('plugin:dialog|open', { options: { directory: true, multiple: false } })).resolves.toBeNull();
  });

  it('uses the same workspace path in Settings configuration and the local check', async () => {
    const bridge = fixture();
    const [config, status] = await Promise.all([
      bridge.invoke('app_config') as Promise<{ root_path: string }>,
      bridge.invoke('workspace_status') as Promise<{ root_path: string }>,
    ]);
    expect(config.root_path).toBe(status.root_path);
  });
});
