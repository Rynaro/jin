// @vitest-environment jsdom
/**
 * settings_controller.test.ts — headless unit tests for Sync & Settings (GUI-S7).
 *
 * Tests three layers:
 *   1. Pure logic from lib/settings/transform.ts (no DOM)
 *   2. DOM rendering from lib/settings/render.ts (jsdom)
 *   3. Mock-invoke integration: the invoke functions receive the correct args
 *
 * Headless gates verified here (spec GUI-S7 AC):
 *
 * GCP wizard guidance:
 *   ✓ GCP_WIZARD_GUIDANCE contains "In production" (the critical caveat)
 *   ✓ GCP_WIZARD_GUIDANCE contains "7 days" (the token-expiry period)
 *   ✓ GCP_WIZARD_GUIDANCE contains "Testing" (the status to avoid)
 *   ✓ GCP_WIZARD_STEPS has exactly 4 steps
 *   ✓ Step 2 warning contains "In production" and "7 days"
 *   ✓ renderGcpWizardSteps populates the container with 4 step sections
 *   ✓ renderGcpWizardSteps marks the production warning with data-gcp-warning="production"
 *
 * formatAuthStatus:
 *   ✓ connected → statusLabel "Connected", showGcpPanel false
 *   ✓ disconnected → statusLabel "Not connected", showGcpPanel true
 *   ✓ needs_reauth → statusLabel "Re-authentication required", showGcpPanel true
 *   ✓ account email forwarded when present
 *   ✓ backend forwarded (the storage backend)
 *   ✓ expiresAt formatted from unix timestamp
 *   ✓ expiresAt null when expires_at is null
 *
 * renderAuthStatus:
 *   ✓ connected: statusDisplay text set, connectBtn hidden, disconnectBtn visible, gcpPanel hidden
 *   ✓ disconnected: statusDisplay text set, connectBtn visible, disconnectBtn hidden, gcpPanel visible
 *   ✓ needs_reauth: connectBtn visible, gcpPanel visible
 *   ✓ backend value shown in authBackendDisplay
 *
 * auth_login / auth_logout invoked correctly:
 *   ✓ authLogin() calls invoke('auth_login', {})
 *   ✓ authLogout() calls invoke('auth_logout', {})
 *   ✓ authStatus() calls invoke('auth_status', {})
 *
 * formatSyncResult:
 *   ✓ pulled, pushed, conflicts, resolved counts carried through
 *   ✓ status "ok" → statusLabel "Sync complete"
 *   ✓ status "queued" → statusLabel contains "queued"
 *   ✓ hasConflicts true when conflicts > 0
 *   ✓ hasResolved true when resolved > 0
 *   ✓ auditLogPath forwarded when present
 *
 * renderSyncResult:
 *   ✓ pulled / pushed / conflicts / resolved counts shown in correct elements
 *   ✓ status label shown
 *   ✓ syncResultDisplay visible, syncError hidden
 *   ✓ auditLink shown with data-audit-path when auditLogPath non-null
 *   ✓ auditLink hidden when auditLogPath null
 *   ✓ resolvedNotice shown when resolved > 0 (auto-resolved conflicts)
 *
 * formatSyncError (exit-code-5 gate):
 *   ✓ code:5 → message includes "Connect Google"
 *   ✓ code:6 → message includes "queued" / "Offline"
 *   ✓ other codes → DTO message forwarded
 *
 * renderSyncError:
 *   ✓ error message set in syncError element
 *   ✓ syncError visible, syncResultDisplay hidden
 *
 * run_sync invoked correctly:
 *   ✓ runSync() calls invoke('run_sync', {})
 *
 * formatExportResult:
 *   ✓ fileCount, dest, includedAudit forwarded
 *   ✓ previewFiles sliced to first 3
 *
 * renderExportResult:
 *   ✓ fileCount set in exportFileCount
 *   ✓ dest set in exportDestDisplay
 *   ✓ exportAuditIncluded visible when includedAudit true
 *   ✓ exportAuditIncluded hidden when includedAudit false
 *
 * formatExportError (dest-collision gate):
 *   ✓ code:2 with "exist" in message → includes "Destination already exists"
 *   ✓ code:2 without "exist" → includes "Export failed"
 *   ✓ other codes → DTO message forwarded
 *
 * isExportDestCollision:
 *   ✓ true for code:2
 *   ✓ false for other codes
 *
 * renderExportError:
 *   ✓ error message set, exportError visible
 *
 * Appearance/a11y controls (wiring to existing appearance state):
 *   ✓ initAppearanceControls sets reduceTransparencyToggle.checked from prefs
 *   ✓ initAppearanceControls sets increaseContrastToggle.checked from prefs
 *   ✓ initAppearanceControls sets reduceMotionToggle.checked from prefs
 *   ✓ initAppearanceControls sets textSizeRange.valueAsNumber from prefs
 *   ✓ initAppearanceControls sets aria-pressed on appearance mode buttons
 *   ✓ togglePref + applyToRoot sets root data-reduce-transparency to "1"
 *   ✓ togglePref + applyToRoot sets root data-increase-contrast to "1"
 *   ✓ togglePref + applyToRoot sets root data-reduce-motion to "1"
 *   (The latter three confirm the existing appearance controller stays operative.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JinErrorDto } from '../types/error';
import type { AuthStatusDto, SyncSummary, ExportResultDto, GoogleAccountDto } from '../types/dto';

// ── Mock @tauri-apps/api/core ─────────────────────────────────────────────────
// Required so invoke calls don't fail in jsdom (no Tauri runtime).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { authStatus, authLogin, authLogout, runSync, exportFiles } from '../invoke';
import SettingsController from '../controllers/settings_controller';
import {
  DEFAULT_SETTINGS_PANE,
  SETTINGS_PANE_STORAGE_KEY,
  applySettingsPane,
  isSettingsPaneKey,
  loadSettingsPane,
  saveSettingsPane,
} from '../lib/settings/navigation';

import {
  GCP_WIZARD_STEPS,
  GCP_WIZARD_GUIDANCE,
  formatAuthStatus,
  formatSyncResult,
  formatSyncError,
  isSyncAuthError,
  isSyncOfflineError,
  formatExportResult,
  formatExportError,
  isExportDestCollision,
} from '../lib/settings/transform';

import {
  type SettingsAuthElements,
  type SettingsSyncElements,
  type SettingsExportElements,
  type SettingsAppearanceElements,
  renderAuthStatus,
  setAuthLoading,
  renderAuthError,
  renderGcpWizardSteps,
  renderSyncIdle,
  renderSyncLoading,
  renderSyncResult,
  renderSyncError,
  renderExportIdle,
  renderExportLoading,
  renderExportResult,
  renderExportError,
  initAppearanceControls,
} from '../lib/settings/render';

import {
  applyToRoot,
  togglePref,
  DEFAULT_PREFS,
  type AppearancePrefs,
} from '../lib/appearance/state';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('settings pane navigation', () => {
  const makeNavigation = () => {
    const keys = ['general', 'calendars', 'notifications', 'data-storage'];
    const navItems = keys.map((key) => {
      const item = document.createElement('button');
      item.dataset.settingsPaneKey = key;
      return item;
    });
    const panes = keys.map((key) => {
      const pane = document.createElement('section');
      pane.dataset.settingsPaneKey = key;
      return pane;
    });
    return { navItems, panes };
  };

  it('accepts only the closed settings pane key set', () => {
    expect(isSettingsPaneKey('general')).toBe(true);
    expect(isSettingsPaneKey('data-storage')).toBe(true);
    expect(isSettingsPaneKey('unknown')).toBe(false);
    expect(isSettingsPaneKey(null)).toBe(false);
  });

  it('restores a valid saved pane and falls back for an unknown pane', () => {
    const validStorage = { getItem: vi.fn(() => 'notifications'), setItem: vi.fn() };
    const invalidStorage = { getItem: vi.fn(() => 'other'), setItem: vi.fn() };
    expect(loadSettingsPane(validStorage)).toBe('notifications');
    expect(loadSettingsPane(invalidStorage)).toBe(DEFAULT_SETTINGS_PANE);
  });

  it('falls back without throwing when storage reads fail', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(),
    };
    expect(loadSettingsPane(storage)).toBe(DEFAULT_SETTINGS_PANE);
  });

  it('persists with the narrow storage key and ignores write failures', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    saveSettingsPane('calendars', storage);
    expect(storage.setItem).toHaveBeenCalledWith(SETTINGS_PANE_STORAGE_KEY, 'calendars');

    expect(() => saveSettingsPane('general', {
      getItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    })).not.toThrow();
  });

  it('exposes exactly one pane and exactly one current navigation item', () => {
    const { navItems, panes } = makeNavigation();
    applySettingsPane(navItems, panes, 'notifications');

    expect(panes.filter(pane => !pane.hidden)).toHaveLength(1);
    expect(panes.find(pane => !pane.hidden)?.dataset.settingsPaneKey).toBe('notifications');
    expect(navItems.filter(item => item.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(navItems[2].classList.contains('is-active')).toBe(true);
  });

  it('uses General when the DOM applicator receives an invalid key', () => {
    const { navItems, panes } = makeNavigation();
    expect(applySettingsPane(navItems, panes, 'bad')).toBe('general');
    expect(panes[0].hidden).toBe(false);
  });

  it('switches panes, resets only workspace scroll, and retains button focus', () => {
    const { navItems, panes } = makeNavigation();
    const workspace = document.createElement('div');
    workspace.scrollTop = 240;
    document.body.append(...navItems, ...panes);
    navItems[1].focus();

    SettingsController.prototype.selectPane.call({
      settingsNavItemTargets: navItems,
      settingsPaneTargets: panes,
      settingsWorkspaceTarget: workspace,
    } as unknown as SettingsController, { currentTarget: navItems[1] } as unknown as Event);

    expect(document.activeElement).toBe(navItems[1]);
    expect(panes[1].hidden).toBe(false);
    expect(workspace.scrollTop).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('keeps dynamically rendered Google account cards in the Calendars pane', () => {
    const pane = document.createElement('section');
    pane.dataset.settingsPaneKey = 'calendars';
    const list = document.createElement('div');
    pane.appendChild(list);
    const account: GoogleAccountDto = {
      id: 'work',
      alias: 'Work',
      principal: 'work@example.com',
      state: 'connected',
      auth_generation: 1,
      calendars: [],
    };
    const renderGoogleAccounts = (SettingsController.prototype as unknown as {
      renderGoogleAccounts(accounts: GoogleAccountDto[]): void;
    }).renderGoogleAccounts;

    renderGoogleAccounts.call({
      hasGoogleAccountsListTarget: true,
      googleAccountsListTarget: list,
      colorPickers: new Map(),
    }, [account]);

    expect(list.querySelector('.google-account-card')?.closest('[data-settings-pane-key]')).toBe(pane);
  });

  it('restores notification action focus while Notifications remains selected', () => {
    const pane = document.createElement('section');
    pane.dataset.settingsPaneKey = 'notifications';
    const action = document.createElement('button');
    const fallback = document.createElement('button');
    pane.append(action, fallback);
    document.body.appendChild(pane);
    const restoreNotificationFocus = (SettingsController.prototype as unknown as {
      restoreNotificationFocus(): void;
    }).restoreNotificationFocus;
    const context = {
      notificationFocusTarget: action,
      notificationCheckBtnTarget: fallback,
    };

    restoreNotificationFocus.call(context);

    expect(document.activeElement).toBe(action);
    expect(context.notificationFocusTarget).toBeNull();
  });
});

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeAuthStatusDto(
  overrides: Partial<AuthStatusDto> = {}
): AuthStatusDto {
  return {
    state: 'connected',
    account: 'user@example.com',
    expires_at: 1767225600, // some future unix timestamp
    backend: 'keyring',
    ...overrides,
  };
}

function makeSyncSummary(overrides: Partial<SyncSummary> = {}): SyncSummary {
  return {
    status: 'ok',
    pulled: 3,
    pushed: 1,
    conflicts: 0,
    resolved: 0,
    audit_log_path: '/home/user/.jin/audit.jsonl',
    errors: [],
    ...overrides,
  };
}

function makeExportResultDto(
  overrides: Partial<ExportResultDto> = {}
): ExportResultDto {
  return {
    dest: '/home/user/jin-export',
    file_count: 42,
    included_audit: true,
    files: ['notes/', 'tasks/', 'events/', 'calendar.ics'],
    ...overrides,
  };
}

function makeJinErrorDto(overrides: Partial<JinErrorDto> = {}): JinErrorDto {
  return {
    code: 1,
    kind: 'other',
    message: 'Something went wrong',
    retriable: false,
    ...overrides,
  };
}

// ── DOM element factories ─────────────────────────────────────────────────────

function makeAuthElements(): SettingsAuthElements {
  const authStatusDisplay = document.createElement('span');
  const authAccountDisplay = document.createElement('span');
  const authBackendDisplay = document.createElement('span');
  const authExpiryDisplay = document.createElement('span');
  const connectBtn = document.createElement('button');
  const disconnectBtn = document.createElement('button');
  disconnectBtn.classList.add('hidden');
  const gcpPanel = document.createElement('div');
  const authLoadingState = document.createElement('div');
  authLoadingState.classList.add('hidden');
  const authError = document.createElement('p');
  authError.classList.add('hidden');

  return {
    authStatusDisplay,
    authAccountDisplay,
    authBackendDisplay,
    authExpiryDisplay,
    connectBtn: connectBtn as HTMLButtonElement,
    disconnectBtn: disconnectBtn as HTMLButtonElement,
    gcpPanel,
    authLoadingState,
    authError,
  };
}

function makeSyncElements(): SettingsSyncElements {
  const syncBtn = document.createElement('button');
  const syncLoadingState = document.createElement('div');
  syncLoadingState.classList.add('hidden');
  const syncResultDisplay = document.createElement('div');
  syncResultDisplay.classList.add('hidden');
  const syncPulled = document.createElement('span');
  const syncPushed = document.createElement('span');
  const syncConflicts = document.createElement('span');
  const syncResolved = document.createElement('span');
  const syncStatus = document.createElement('p');
  const syncAuditLink = document.createElement('a');
  syncAuditLink.classList.add('hidden');
  const syncResolvedNotice = document.createElement('p');
  syncResolvedNotice.classList.add('hidden');
  const syncError = document.createElement('p');
  syncError.classList.add('hidden');

  return {
    syncBtn: syncBtn as HTMLButtonElement,
    syncLoadingState,
    syncResultDisplay,
    syncPulled,
    syncPushed,
    syncConflicts,
    syncResolved,
    syncStatus,
    syncAuditLink: syncAuditLink as HTMLAnchorElement,
    syncResolvedNotice,
    syncError,
  };
}

function makeExportElements(): SettingsExportElements {
  const exportDestInput = document.createElement('input');
  exportDestInput.type = 'text';
  const exportForceToggle = document.createElement('input');
  exportForceToggle.type = 'checkbox';
  const exportBtn = document.createElement('button');
  const exportLoadingState = document.createElement('div');
  exportLoadingState.classList.add('hidden');
  const exportResultDisplay = document.createElement('div');
  exportResultDisplay.classList.add('hidden');
  const exportFileCount = document.createElement('span');
  const exportDestDisplay = document.createElement('span');
  const exportAuditIncluded = document.createElement('span');
  exportAuditIncluded.classList.add('hidden');
  const exportError = document.createElement('p');
  exportError.classList.add('hidden');

  return {
    exportDestInput: exportDestInput as HTMLInputElement,
    exportForceToggle: exportForceToggle as HTMLInputElement,
    exportBtn: exportBtn as HTMLButtonElement,
    exportLoadingState,
    exportResultDisplay,
    exportFileCount,
    exportDestDisplay,
    exportAuditIncluded,
    exportError,
  };
}

function makeAppearanceElements(): SettingsAppearanceElements {
  const appearanceLight = document.createElement('button');
  appearanceLight.setAttribute('aria-pressed', 'false');
  const appearanceDark = document.createElement('button');
  appearanceDark.setAttribute('aria-pressed', 'false');
  const appearanceAuto = document.createElement('button');
  appearanceAuto.setAttribute('aria-pressed', 'true');
  const reduceTransparencyToggle = document.createElement('input');
  reduceTransparencyToggle.type = 'checkbox';
  const increaseContrastToggle = document.createElement('input');
  increaseContrastToggle.type = 'checkbox';
  const reduceMotionToggle = document.createElement('input');
  reduceMotionToggle.type = 'checkbox';
  const textSizeRange = document.createElement('input');
  textSizeRange.type = 'range';

  return {
    appearanceLight,
    appearanceDark,
    appearanceAuto,
    reduceTransparencyToggle: reduceTransparencyToggle as HTMLInputElement,
    increaseContrastToggle: increaseContrastToggle as HTMLInputElement,
    reduceMotionToggle: reduceMotionToggle as HTMLInputElement,
    textSizeRange: textSizeRange as HTMLInputElement,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GCP wizard guidance (the CLI-mirror gate)
// ─────────────────────────────────────────────────────────────────────────────

describe('GCP_WIZARD_GUIDANCE — mirrors CLI print_oauth_wizard_guidance', () => {
  it('contains "In production" — the critical publishing-status instruction', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('In production');
  });

  it('contains "Testing" — the status to AVOID', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('Testing');
  });

  it('contains "7 days" — the token-expiry caveat', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('7 days');
  });

  it('distinguishes production publishing from public sensitive-scope verification', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('public app');
    expect(GCP_WIZARD_GUIDANCE).toContain('requires Google verification');
    expect(GCP_WIZARD_GUIDANCE).toContain('not the same as being verified');
  });

  it('contains "Desktop app" — the required OAuth client type', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('Desktop app');
  });

  it('contains "config.toml" — the Jin configuration file reference', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain('config.toml');
  });

  it('contains the GCP console URL for credentials/consent', () => {
    expect(GCP_WIZARD_GUIDANCE).toContain(
      'https://console.cloud.google.com/apis/credentials/consent'
    );
  });
});

describe('GCP_WIZARD_STEPS', () => {
  it('has exactly 4 steps', () => {
    expect(GCP_WIZARD_STEPS).toHaveLength(4);
  });

  it('step 1 is about creating a GCP project', () => {
    expect(GCP_WIZARD_STEPS[0].step).toBe(1);
    expect(GCP_WIZARD_STEPS[0].title).toContain('Google Cloud project');
  });

  it('step 2 is about the OAuth consent screen', () => {
    expect(GCP_WIZARD_STEPS[1].step).toBe(2);
    expect(GCP_WIZARD_STEPS[1].title.toLowerCase()).toContain('consent');
  });

  it('step 2 warning contains "In production" — the critical caveat', () => {
    expect(GCP_WIZARD_STEPS[1].warning).toBeDefined();
    expect(GCP_WIZARD_STEPS[1].warning).toContain('In production');
  });

  it('step 2 warning contains "7 days" — the token-expiry duration', () => {
    expect(GCP_WIZARD_STEPS[1].warning).toContain('7 days');
  });

  it('step 3 is about creating OAuth credentials (Desktop app)', () => {
    expect(GCP_WIZARD_STEPS[2].step).toBe(3);
    expect(GCP_WIZARD_STEPS[2].instructions.join(' ')).toContain('Desktop app');
  });

  it('step 4 covers Jin configuration (config.toml)', () => {
    expect(GCP_WIZARD_STEPS[3].step).toBe(4);
    expect(GCP_WIZARD_STEPS[3].instructions.join(' ')).toContain('config.toml');
  });
});

describe('renderGcpWizardSteps', () => {
  it('populates the container with 4 step sections', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    const steps = container.querySelectorAll('.gcp-wizard-step');
    expect(steps).toHaveLength(4);
  });

  it('marks step 2 warning with data-gcp-warning="production"', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    const warning = container.querySelector('[data-gcp-warning="production"]');
    expect(warning).not.toBeNull();
  });

  it('warning element contains "In production"', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    const warning = container.querySelector('[data-gcp-warning="production"]');
    expect(warning?.textContent).toContain('In production');
  });

  it('warning element contains "7 days"', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    const warning = container.querySelector('[data-gcp-warning="production"]');
    expect(warning?.textContent).toContain('7 days');
  });

  it('each step has a data-step attribute matching the step number', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    const steps = Array.from(container.querySelectorAll('.gcp-wizard-step')) as HTMLElement[];
    expect(steps.map((s) => s.dataset.step)).toEqual(['1', '2', '3', '4']);
  });

  it('clears existing content on each call (idempotent repopulation)', () => {
    const container = document.createElement('div');
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    renderGcpWizardSteps(container, GCP_WIZARD_STEPS);
    expect(container.querySelectorAll('.gcp-wizard-step')).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. formatAuthStatus — authenticated vs not + backend
// ─────────────────────────────────────────────────────────────────────────────

describe('formatAuthStatus', () => {
  it('connected → statusLabel "Connected"', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'connected' }));
    expect(view.statusLabel).toBe('Connected');
  });

  it('connected → showGcpPanel false', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'connected' }));
    expect(view.showGcpPanel).toBe(false);
  });

  it('disconnected → statusLabel "Not connected"', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }));
    expect(view.statusLabel).toBe('Not connected');
  });

  it('disconnected → showGcpPanel true (show setup wizard)', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'disconnected' }));
    expect(view.showGcpPanel).toBe(true);
  });

  it('needs_reauth → statusLabel "Re-authentication required"', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'needs_reauth' }));
    expect(view.statusLabel).toBe('Re-authentication required');
  });

  it('needs_reauth → showGcpPanel true', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'needs_reauth' }));
    expect(view.showGcpPanel).toBe(true);
  });

  it('account email forwarded when present', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ account: 'owner@example.com' }));
    expect(view.account).toBe('owner@example.com');
  });

  it('account is null when not connected', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }));
    expect(view.account).toBeNull();
  });

  it('backend forwarded (keyring, file, etc.)', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ backend: 'keyring' }));
    expect(view.backend).toBe('keyring');
  });

  it('expiresAt is a non-empty string when expires_at is a valid timestamp', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ expires_at: 1767225600 }));
    expect(view.expiresAt).not.toBeNull();
    expect(view.expiresAt!.length).toBeGreaterThan(0);
  });

  it('expiresAt is null when expires_at is null', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ expires_at: null }));
    expect(view.expiresAt).toBeNull();
  });

  it('statusClass is "connected" when connected', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'connected' }));
    expect(view.statusClass).toBe('connected');
  });

  it('statusClass is "disconnected" when disconnected', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'disconnected' }));
    expect(view.statusClass).toBe('disconnected');
  });

  it('statusClass is "needs-reauth" when needs_reauth', () => {
    const view = formatAuthStatus(makeAuthStatusDto({ state: 'needs_reauth' }));
    expect(view.statusClass).toBe('needs-reauth');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. renderAuthStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('renderAuthStatus — connected', () => {
  it('sets statusDisplay text content to "Connected"', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'connected' })));
    expect(el.authStatusDisplay.textContent).toBe('Connected');
  });

  it('hides connectBtn when connected', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'connected' })));
    expect(el.connectBtn.classList.contains('hidden')).toBe(true);
  });

  it('shows disconnectBtn when connected', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'connected' })));
    expect(el.disconnectBtn.classList.contains('hidden')).toBe(false);
  });

  it('hides gcpPanel when connected (setup not needed)', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'connected' })));
    expect(el.gcpPanel.classList.contains('hidden')).toBe(true);
  });

  it('sets backend display text', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ backend: 'keyring' })));
    expect(el.authBackendDisplay.textContent).toBe('keyring');
  });

  it('sets account display text', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ account: 'test@example.com' })));
    expect(el.authAccountDisplay.textContent).toBe('test@example.com');
  });
});

describe('renderAuthStatus — disconnected', () => {
  it('shows connectBtn when disconnected', () => {
    const el = makeAuthElements();
    renderAuthStatus(
      el,
      formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }))
    );
    expect(el.connectBtn.classList.contains('hidden')).toBe(false);
  });

  it('hides disconnectBtn when disconnected', () => {
    const el = makeAuthElements();
    renderAuthStatus(
      el,
      formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }))
    );
    expect(el.disconnectBtn.classList.contains('hidden')).toBe(true);
  });

  it('shows gcpPanel when disconnected (setup wizard needed)', () => {
    const el = makeAuthElements();
    renderAuthStatus(
      el,
      formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }))
    );
    expect(el.gcpPanel.classList.contains('hidden')).toBe(false);
  });

  it('sets statusDisplay data-auth-state attribute', () => {
    const el = makeAuthElements();
    renderAuthStatus(
      el,
      formatAuthStatus(makeAuthStatusDto({ state: 'disconnected', account: null }))
    );
    expect(el.authStatusDisplay.getAttribute('data-auth-state')).toBe('disconnected');
  });
});

describe('renderAuthStatus — needs_reauth', () => {
  it('shows connectBtn when needs_reauth', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'needs_reauth' })));
    expect(el.connectBtn.classList.contains('hidden')).toBe(false);
  });

  it('shows gcpPanel when needs_reauth', () => {
    const el = makeAuthElements();
    renderAuthStatus(el, formatAuthStatus(makeAuthStatusDto({ state: 'needs_reauth' })));
    expect(el.gcpPanel.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. setAuthLoading / renderAuthError
// ─────────────────────────────────────────────────────────────────────────────

describe('setAuthLoading', () => {
  it('shows authLoadingState when loading=true', () => {
    const el = makeAuthElements();
    setAuthLoading(el, true);
    expect(el.authLoadingState.classList.contains('hidden')).toBe(false);
  });

  it('disables connectBtn when loading=true', () => {
    const el = makeAuthElements();
    setAuthLoading(el, true);
    expect(el.connectBtn.disabled).toBe(true);
  });

  it('disables disconnectBtn when loading=true', () => {
    const el = makeAuthElements();
    setAuthLoading(el, true);
    expect(el.disconnectBtn.disabled).toBe(true);
  });

  it('hides authLoadingState when loading=false', () => {
    const el = makeAuthElements();
    setAuthLoading(el, true);
    setAuthLoading(el, false);
    expect(el.authLoadingState.classList.contains('hidden')).toBe(true);
  });

  it('re-enables buttons when loading=false', () => {
    const el = makeAuthElements();
    setAuthLoading(el, true);
    setAuthLoading(el, false);
    expect(el.connectBtn.disabled).toBe(false);
    expect(el.disconnectBtn.disabled).toBe(false);
  });
});

describe('renderAuthError', () => {
  it('sets the error message text', () => {
    const el = makeAuthElements();
    renderAuthError(el, 'Sign-in failed');
    expect(el.authError.textContent).toBe('Sign-in failed');
  });

  it('makes the error element visible', () => {
    const el = makeAuthElements();
    renderAuthError(el, 'Error');
    expect(el.authError.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. auth_login / auth_logout / auth_status invoked correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('authLogin() — invoke args', () => {
  it('calls invoke("auth_login", {})', async () => {
    mockInvoke.mockResolvedValue(makeAuthStatusDto());
    await authLogin();
    expect(mockInvoke).toHaveBeenCalledWith('auth_login', {});
  });
});

describe('authLogout() — invoke args', () => {
  it('calls invoke("auth_logout", {})', async () => {
    mockInvoke.mockResolvedValue(makeAuthStatusDto({ state: 'disconnected', account: null }));
    await authLogout();
    expect(mockInvoke).toHaveBeenCalledWith('auth_logout', {});
  });
});

describe('authStatus() — invoke args', () => {
  it('calls invoke("auth_status", {})', async () => {
    mockInvoke.mockResolvedValue(makeAuthStatusDto());
    await authStatus();
    expect(mockInvoke).toHaveBeenCalledWith('auth_status', {});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. formatSyncResult — sync summary
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSyncResult', () => {
  it('forwards pulled count', () => {
    expect(formatSyncResult(makeSyncSummary({ pulled: 5 })).pulled).toBe(5);
  });

  it('forwards pushed count', () => {
    expect(formatSyncResult(makeSyncSummary({ pushed: 2 })).pushed).toBe(2);
  });

  it('forwards conflicts count', () => {
    expect(formatSyncResult(makeSyncSummary({ conflicts: 3 })).conflicts).toBe(3);
  });

  it('forwards resolved count', () => {
    expect(formatSyncResult(makeSyncSummary({ resolved: 1 })).resolved).toBe(1);
  });

  it('status "ok" → statusLabel "Sync complete"', () => {
    expect(formatSyncResult(makeSyncSummary({ status: 'ok' })).statusLabel).toBe('Sync complete');
  });

  it('status "queued" → statusLabel contains "queued"', () => {
    expect(
      formatSyncResult(makeSyncSummary({ status: 'queued' })).statusLabel.toLowerCase()
    ).toContain('queued');
  });

  it('hasConflicts true when conflicts > 0', () => {
    expect(formatSyncResult(makeSyncSummary({ conflicts: 1 })).hasConflicts).toBe(true);
  });

  it('hasConflicts false when conflicts === 0', () => {
    expect(formatSyncResult(makeSyncSummary({ conflicts: 0 })).hasConflicts).toBe(false);
  });

  it('hasResolved true when resolved > 0', () => {
    expect(formatSyncResult(makeSyncSummary({ resolved: 2 })).hasResolved).toBe(true);
  });

  it('hasResolved false when resolved === 0', () => {
    expect(formatSyncResult(makeSyncSummary({ resolved: 0 })).hasResolved).toBe(false);
  });

  it('forwards auditLogPath when present', () => {
    const view = formatSyncResult(
      makeSyncSummary({ audit_log_path: '/path/to/audit.jsonl' })
    );
    expect(view.auditLogPath).toBe('/path/to/audit.jsonl');
  });

  it('auditLogPath null when absent', () => {
    const view = formatSyncResult(makeSyncSummary({ audit_log_path: null }));
    expect(view.auditLogPath).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. renderSyncResult
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSyncResult', () => {
  it('sets pulled count in syncPulled element', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ pulled: 7 })));
    expect(el.syncPulled.textContent).toBe('7');
  });

  it('sets pushed count in syncPushed element', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ pushed: 3 })));
    expect(el.syncPushed.textContent).toBe('3');
  });

  it('sets conflicts count in syncConflicts element', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ conflicts: 2 })));
    expect(el.syncConflicts.textContent).toBe('2');
  });

  it('sets resolved count in syncResolved element', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ resolved: 1 })));
    expect(el.syncResolved.textContent).toBe('1');
  });

  it('sets statusLabel in syncStatus element', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ status: 'ok' })));
    expect(el.syncStatus.textContent).toBe('Sync complete');
  });

  it('sets data-sync-status attribute on syncStatus', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ status: 'ok' })));
    expect(el.syncStatus.getAttribute('data-sync-status')).toBe('ok');
  });

  it('makes syncResultDisplay visible', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary()));
    expect(el.syncResultDisplay.classList.contains('hidden')).toBe(false);
  });

  it('hides syncError after a successful result', () => {
    const el = makeSyncElements();
    el.syncError.classList.remove('hidden');
    renderSyncResult(el, formatSyncResult(makeSyncSummary()));
    expect(el.syncError.classList.contains('hidden')).toBe(true);
  });

  it('shows syncAuditLink with data-audit-path when auditLogPath is present', () => {
    const el = makeSyncElements();
    renderSyncResult(
      el,
      formatSyncResult(makeSyncSummary({ audit_log_path: '/home/user/.jin/audit.jsonl' }))
    );
    expect(el.syncAuditLink.classList.contains('hidden')).toBe(false);
    expect(el.syncAuditLink.getAttribute('data-audit-path')).toBe(
      '/home/user/.jin/audit.jsonl'
    );
  });

  it('hides syncAuditLink when auditLogPath is null', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ audit_log_path: null })));
    expect(el.syncAuditLink.classList.contains('hidden')).toBe(true);
  });

  it('shows syncResolvedNotice when resolved > 0 (auto-resolved conflicts)', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ resolved: 2 })));
    expect(el.syncResolvedNotice.classList.contains('hidden')).toBe(false);
  });

  it('hides syncResolvedNotice when resolved === 0', () => {
    const el = makeSyncElements();
    renderSyncResult(el, formatSyncResult(makeSyncSummary({ resolved: 0 })));
    expect(el.syncResolvedNotice.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. formatSyncError — exit-code-5 gate (auth error → "Connect Google first")
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSyncError', () => {
  it('code:5 → message includes "Connect Google"', () => {
    const err = makeJinErrorDto({ code: 5, kind: 'auth', message: 'Not authenticated' });
    expect(formatSyncError(err)).toContain('Connect Google');
  });

  it('code:5 → message instructs user to use Google Account section', () => {
    const err = makeJinErrorDto({ code: 5, kind: 'auth', message: 'Token expired' });
    const msg = formatSyncError(err);
    expect(msg.toLowerCase()).toContain('sign in');
  });

  it('code:6 → message includes "queued" or "Offline"', () => {
    const err = makeJinErrorDto({ code: 6, kind: 'offline', message: 'Network unreachable' });
    const msg = formatSyncError(err).toLowerCase();
    expect(msg.includes('queued') || msg.includes('offline')).toBe(true);
  });

  it('code:6 → message reassures that local writes are unaffected', () => {
    const err = makeJinErrorDto({ code: 6, kind: 'offline', message: 'offline' });
    // Should NOT say "failed" without qualification — local writes succeed
    const msg = formatSyncError(err);
    expect(msg).toContain('queued');
  });

  it('other codes → forwards the DTO message', () => {
    const err = makeJinErrorDto({ code: 1, kind: 'other', message: 'Internal error X' });
    expect(formatSyncError(err)).toBe('Internal error X');
  });
});

describe('isSyncAuthError', () => {
  it('returns true for code:5 (auth)', () => {
    expect(isSyncAuthError(makeJinErrorDto({ code: 5 }))).toBe(true);
  });

  it('returns false for code:6 (offline)', () => {
    expect(isSyncAuthError(makeJinErrorDto({ code: 6 }))).toBe(false);
  });
});

describe('isSyncOfflineError', () => {
  it('returns true for code:6 (offline)', () => {
    expect(isSyncOfflineError(makeJinErrorDto({ code: 6 }))).toBe(true);
  });

  it('returns false for code:5 (auth)', () => {
    expect(isSyncOfflineError(makeJinErrorDto({ code: 5 }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. renderSyncError
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSyncError', () => {
  it('sets the message in syncError element', () => {
    const el = makeSyncElements();
    renderSyncError(el, 'Connect Google first — go to Google Account section.');
    expect(el.syncError.textContent).toBe(
      'Connect Google first — go to Google Account section.'
    );
  });

  it('makes syncError visible', () => {
    const el = makeSyncElements();
    renderSyncError(el, 'Connect Google first');
    expect(el.syncError.classList.contains('hidden')).toBe(false);
  });

  it('hides syncResultDisplay on error', () => {
    const el = makeSyncElements();
    el.syncResultDisplay.classList.remove('hidden');
    renderSyncError(el, 'Error');
    expect(el.syncResultDisplay.classList.contains('hidden')).toBe(true);
  });

  it('re-enables syncBtn on error', () => {
    const el = makeSyncElements();
    el.syncBtn.disabled = true;
    renderSyncError(el, 'Error');
    expect(el.syncBtn.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. renderSyncLoading
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSyncLoading', () => {
  it('shows syncLoadingState', () => {
    const el = makeSyncElements();
    renderSyncLoading(el);
    expect(el.syncLoadingState.classList.contains('hidden')).toBe(false);
  });

  it('disables syncBtn while loading', () => {
    const el = makeSyncElements();
    renderSyncLoading(el);
    expect(el.syncBtn.disabled).toBe(true);
  });

  it('hides syncResultDisplay while loading', () => {
    const el = makeSyncElements();
    el.syncResultDisplay.classList.remove('hidden');
    renderSyncLoading(el);
    expect(el.syncResultDisplay.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. run_sync invoked correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('runSync() — invoke args', () => {
  it('calls invoke("run_sync", {})', async () => {
    mockInvoke.mockResolvedValue(makeSyncSummary());
    await runSync();
    expect(mockInvoke).toHaveBeenCalledWith('run_sync', {});
  });

  it('dispatches the shared events mutation only after a successful sync', async () => {
    mockInvoke.mockResolvedValue(makeSyncSummary({ pulled: 1 }));
    const dispatch = vi.fn();
    const context = { syncElements: makeSyncElements(), dispatch };

    await SettingsController.prototype.runSync.call(
      context as unknown as SettingsController,
    );

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('events-mutated', {
      prefix: 'jin',
      bubbles: true,
    });
  });

  it('does not dispatch an events mutation when sync fails', async () => {
    mockInvoke.mockRejectedValue(makeJinErrorDto({ code: 6, kind: 'offline' }));
    const dispatch = vi.fn();
    const context = { syncElements: makeSyncElements(), dispatch };

    await SettingsController.prototype.runSync.call(
      context as unknown as SettingsController,
    );

    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. formatExportResult
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExportResult', () => {
  it('forwards fileCount', () => {
    expect(formatExportResult(makeExportResultDto({ file_count: 99 })).fileCount).toBe(99);
  });

  it('forwards dest', () => {
    expect(
      formatExportResult(makeExportResultDto({ dest: '/tmp/out' })).dest
    ).toBe('/tmp/out');
  });

  it('forwards includedAudit', () => {
    expect(
      formatExportResult(makeExportResultDto({ included_audit: true })).includedAudit
    ).toBe(true);
  });

  it('includedAudit false when not present', () => {
    expect(
      formatExportResult(makeExportResultDto({ included_audit: false })).includedAudit
    ).toBe(false);
  });

  it('previewFiles is the first 3 files', () => {
    const files = ['a', 'b', 'c', 'd', 'e'];
    const view = formatExportResult(makeExportResultDto({ files }));
    expect(view.previewFiles).toEqual(['a', 'b', 'c']);
  });

  it('previewFiles contains all files when fewer than 3', () => {
    const files = ['x', 'y'];
    const view = formatExportResult(makeExportResultDto({ files }));
    expect(view.previewFiles).toEqual(['x', 'y']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. renderExportResult
// ─────────────────────────────────────────────────────────────────────────────

describe('renderExportResult', () => {
  it('sets file count in exportFileCount', () => {
    const el = makeExportElements();
    renderExportResult(el, formatExportResult(makeExportResultDto({ file_count: 42 })));
    expect(el.exportFileCount.textContent).toBe('42');
  });

  it('sets destination in exportDestDisplay', () => {
    const el = makeExportElements();
    renderExportResult(
      el,
      formatExportResult(makeExportResultDto({ dest: '/home/user/out' }))
    );
    expect(el.exportDestDisplay.textContent).toBe('/home/user/out');
  });

  it('shows exportAuditIncluded when includedAudit is true', () => {
    const el = makeExportElements();
    renderExportResult(el, formatExportResult(makeExportResultDto({ included_audit: true })));
    expect(el.exportAuditIncluded.classList.contains('hidden')).toBe(false);
  });

  it('hides exportAuditIncluded when includedAudit is false', () => {
    const el = makeExportElements();
    renderExportResult(el, formatExportResult(makeExportResultDto({ included_audit: false })));
    expect(el.exportAuditIncluded.classList.contains('hidden')).toBe(true);
  });

  it('makes exportResultDisplay visible', () => {
    const el = makeExportElements();
    renderExportResult(el, formatExportResult(makeExportResultDto()));
    expect(el.exportResultDisplay.classList.contains('hidden')).toBe(false);
  });

  it('hides exportError after a successful result', () => {
    const el = makeExportElements();
    el.exportError.classList.remove('hidden');
    renderExportResult(el, formatExportResult(makeExportResultDto()));
    expect(el.exportError.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. formatExportError — dest-collision gate
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExportError', () => {
  it('code:2 with "exist" in message → "Destination already exists"', () => {
    const err = makeJinErrorDto({
      code: 2,
      kind: 'usage',
      message: 'destination already exists',
    });
    expect(formatExportError(err)).toContain('Destination already exists');
  });

  it('code:2 without "exist" → "Export failed: <message>"', () => {
    const err = makeJinErrorDto({
      code: 2,
      kind: 'usage',
      message: 'invalid path',
    });
    expect(formatExportError(err)).toContain('Export failed');
  });

  it('other codes → forwards the DTO message', () => {
    const err = makeJinErrorDto({ code: 1, kind: 'other', message: 'disk full' });
    expect(formatExportError(err)).toBe('disk full');
  });
});

describe('isExportDestCollision', () => {
  it('returns true for code:2', () => {
    expect(isExportDestCollision(makeJinErrorDto({ code: 2 }))).toBe(true);
  });

  it('returns false for code:1', () => {
    expect(isExportDestCollision(makeJinErrorDto({ code: 1 }))).toBe(false);
  });

  it('returns false for code:5 (auth)', () => {
    expect(isExportDestCollision(makeJinErrorDto({ code: 5 }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. renderExportError
// ─────────────────────────────────────────────────────────────────────────────

describe('renderExportError', () => {
  it('sets the error message', () => {
    const el = makeExportElements();
    renderExportError(el, 'Destination already exists — choose a different path.');
    expect(el.exportError.textContent).toBe(
      'Destination already exists — choose a different path.'
    );
  });

  it('makes exportError visible', () => {
    const el = makeExportElements();
    renderExportError(el, 'Error');
    expect(el.exportError.classList.contains('hidden')).toBe(false);
  });

  it('hides exportResultDisplay on error', () => {
    const el = makeExportElements();
    el.exportResultDisplay.classList.remove('hidden');
    renderExportError(el, 'Error');
    expect(el.exportResultDisplay.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. export_files invoked correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('exportFiles() — invoke args', () => {
  it('calls invoke("export_files", { dest, force }) with the given dest', async () => {
    mockInvoke.mockResolvedValue(makeExportResultDto());
    await exportFiles('/home/user/out', false);
    expect(mockInvoke).toHaveBeenCalledWith('export_files', {
      dest: '/home/user/out',
      force: false,
    });
  });

  it('passes force=true when the force flag is set', async () => {
    mockInvoke.mockResolvedValue(makeExportResultDto());
    await exportFiles('/tmp/out', true);
    expect(mockInvoke).toHaveBeenCalledWith('export_files', {
      dest: '/tmp/out',
      force: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. initAppearanceControls — wires to existing AppearanceController
// ─────────────────────────────────────────────────────────────────────────────

describe('initAppearanceControls', () => {
  it('sets reduceTransparencyToggle.checked from prefs (true)', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, reduceTransparency: true });
    expect(el.reduceTransparencyToggle.checked).toBe(true);
  });

  it('sets reduceTransparencyToggle.checked from prefs (false)', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, reduceTransparency: false });
    expect(el.reduceTransparencyToggle.checked).toBe(false);
  });

  it('sets increaseContrastToggle.checked from prefs (true)', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, increaseContrast: true });
    expect(el.increaseContrastToggle.checked).toBe(true);
  });

  it('sets reduceMotionToggle.checked from prefs (true)', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, reduceMotion: true });
    expect(el.reduceMotionToggle.checked).toBe(true);
  });

  it('sets textSizeRange.valueAsNumber from prefs', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, textSizeScale: 1.24 });
    expect(el.textSizeRange.valueAsNumber).toBeCloseTo(1.24);
  });

  it('sets aria-pressed="true" on the active appearance mode button (auto)', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, appearance: 'auto' });
    expect(el.appearanceAuto.getAttribute('aria-pressed')).toBe('true');
    expect(el.appearanceLight.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceDark.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceAuto.getAttribute('aria-checked')).toBe('true');
    expect(el.appearanceLight.getAttribute('aria-checked')).toBe('false');
    expect(el.appearanceDark.getAttribute('aria-checked')).toBe('false');
  });

  it('sets aria-pressed="true" on light when appearance is "light"', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, appearance: 'light' });
    expect(el.appearanceLight.getAttribute('aria-pressed')).toBe('true');
    expect(el.appearanceDark.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceAuto.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceLight.getAttribute('aria-checked')).toBe('true');
    expect(el.appearanceDark.getAttribute('aria-checked')).toBe('false');
    expect(el.appearanceAuto.getAttribute('aria-checked')).toBe('false');
  });

  it('sets aria-pressed="true" on dark when appearance is "dark"', () => {
    const el = makeAppearanceElements();
    initAppearanceControls(el, { ...DEFAULT_PREFS, appearance: 'dark' });
    expect(el.appearanceDark.getAttribute('aria-pressed')).toBe('true');
    expect(el.appearanceLight.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceAuto.getAttribute('aria-pressed')).toBe('false');
    expect(el.appearanceDark.getAttribute('aria-checked')).toBe('true');
    expect(el.appearanceLight.getAttribute('aria-checked')).toBe('false');
    expect(el.appearanceAuto.getAttribute('aria-checked')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Appearance/a11y controls → root data-attributes change
//     (confirms the existing AppearanceController stays operative)
// ─────────────────────────────────────────────────────────────────────────────

describe('appearance toggles via applyToRoot + togglePref (VG-GUI-6 gate)', () => {
  function makeRoot(): HTMLElement {
    return document.createElement('html');
  }

  it('togglePref + applyToRoot sets data-reduce-transparency to "1"', () => {
    const root = makeRoot();
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceTransparency: false };
    const toggled = togglePref(prefs, 'reduceTransparency');
    applyToRoot(root, toggled);
    expect(root.dataset.reduceTransparency).toBe('1');
  });

  it('togglePref + applyToRoot sets data-increase-contrast to "1"', () => {
    const root = makeRoot();
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, increaseContrast: false };
    const toggled = togglePref(prefs, 'increaseContrast');
    applyToRoot(root, toggled);
    expect(root.dataset.increaseContrast).toBe('1');
  });

  it('togglePref + applyToRoot sets data-reduce-motion to "1"', () => {
    const root = makeRoot();
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceMotion: false };
    const toggled = togglePref(prefs, 'reduceMotion');
    applyToRoot(root, toggled);
    expect(root.dataset.reduceMotion).toBe('1');
  });

  it('toggling back sets data-reduce-transparency to "0"', () => {
    const root = makeRoot();
    const prefs: AppearancePrefs = { ...DEFAULT_PREFS, reduceTransparency: true };
    const toggled = togglePref(prefs, 'reduceTransparency');
    applyToRoot(root, toggled);
    expect(root.dataset.reduceTransparency).toBe('0');
  });

  it('setLight → applyToRoot sets data-appearance to "light"', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'light' });
    expect(root.dataset.appearance).toBe('light');
  });

  it('setDark → applyToRoot sets data-appearance to "dark"', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'dark' });
    expect(root.dataset.appearance).toBe('dark');
  });

  it('setAuto → applyToRoot sets data-appearance to "auto"', () => {
    const root = makeRoot();
    applyToRoot(root, { ...DEFAULT_PREFS, appearance: 'auto' });
    expect(root.dataset.appearance).toBe('auto');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. renderSyncIdle / renderExportIdle
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSyncIdle', () => {
  it('hides syncLoadingState', () => {
    const el = makeSyncElements();
    el.syncLoadingState.classList.remove('hidden');
    renderSyncIdle(el);
    expect(el.syncLoadingState.classList.contains('hidden')).toBe(true);
  });

  it('hides syncResultDisplay', () => {
    const el = makeSyncElements();
    el.syncResultDisplay.classList.remove('hidden');
    renderSyncIdle(el);
    expect(el.syncResultDisplay.classList.contains('hidden')).toBe(true);
  });

  it('re-enables syncBtn', () => {
    const el = makeSyncElements();
    el.syncBtn.disabled = true;
    renderSyncIdle(el);
    expect(el.syncBtn.disabled).toBe(false);
  });
});

describe('renderExportIdle', () => {
  it('hides exportLoadingState', () => {
    const el = makeExportElements();
    el.exportLoadingState.classList.remove('hidden');
    renderExportIdle(el);
    expect(el.exportLoadingState.classList.contains('hidden')).toBe(true);
  });

  it('re-enables exportBtn', () => {
    const el = makeExportElements();
    el.exportBtn.disabled = true;
    renderExportIdle(el);
    expect(el.exportBtn.disabled).toBe(false);
  });
});
