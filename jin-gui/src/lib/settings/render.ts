/**
 * settings/render.ts — DOM rendering for the Settings view (GUI-S7).
 *
 * All functions accept element references (not selectors) so they are
 * testable in jsdom without needing a full Stimulus runtime.
 *
 * Responsibilities:
 *   - Auth status display (state, account, backend, expiry, GCP panel toggle)
 *   - Auth loading state
 *   - Sync result display (pulled/pushed/conflicts/resolved/status/auditPath)
 *   - Sync loading/error states (incl. code:5 → "connect" message)
 *   - Export result display (dest, fileCount, auditIncluded)
 *   - Export loading/error states (incl. dest-collision message)
 *   - App info display (read-only config)
 *   - Appearance controls initialization from persisted prefs
 *
 * Tested by: src/__tests__/settings_controller.test.ts
 */

import type { AppConfigDto } from '../../types/dto';
import type {
  AuthStatusView,
  SyncResultView,
  ExportResultView,
  AppearanceControlsState,
  GcpWizardStep,
} from './transform';

// ── Auth section elements ──────────────────────────────────────────────────────

export interface SettingsAuthElements {
  /** Container showing state label ("Connected", "Not connected", etc.). */
  authStatusDisplay: HTMLElement;
  /** Shows the account email when connected. */
  authAccountDisplay: HTMLElement;
  /** Shows the backend type ("keyring", "file", etc.). */
  authBackendDisplay: HTMLElement;
  /** Shows the token expiry date when connected. */
  authExpiryDisplay: HTMLElement;
  /** "Connect Google" button — visible when disconnected / needs_reauth. */
  connectBtn: HTMLButtonElement;
  /** "Disconnect" button — visible when connected. */
  disconnectBtn: HTMLButtonElement;
  /** GCP setup panel — shown when the owner needs to configure credentials. */
  gcpPanel: HTMLElement;
  /** Loading indicator shown during auth_login / auth_logout. */
  authLoadingState: HTMLElement;
  /** Error display for auth errors. */
  authError: HTMLElement;
}

/**
 * renderAuthStatus — updates all auth-section DOM elements to match view state.
 * Manages visibility of connect/disconnect buttons and the GCP setup panel.
 */
export function renderAuthStatus(
  el: SettingsAuthElements,
  view: AuthStatusView
): void {
  // Status label + CSS modifier class
  el.authStatusDisplay.textContent = view.statusLabel;
  el.authStatusDisplay.className = el.authStatusDisplay.className.replace(
    /\bstatus--\S+/g,
    ''
  );
  el.authStatusDisplay.classList.add(`status--${view.statusClass}`);
  el.authStatusDisplay.setAttribute('data-auth-state', view.state);

  // Account / backend / expiry
  el.authAccountDisplay.textContent = view.account ?? '—';
  el.authBackendDisplay.textContent = view.backend;
  el.authExpiryDisplay.textContent = view.expiresAt ?? '—';

  // Button visibility: connect ↔ disconnect
  if (view.state === 'connected') {
    el.connectBtn.classList.add('hidden');
    el.disconnectBtn.classList.remove('hidden');
  } else {
    el.connectBtn.classList.remove('hidden');
    el.disconnectBtn.classList.add('hidden');
  }

  // GCP setup panel visibility
  if (view.showGcpPanel) {
    el.gcpPanel.classList.remove('hidden');
  } else {
    el.gcpPanel.classList.add('hidden');
  }

  // Clear any previous errors
  el.authError.textContent = '';
  el.authError.classList.add('hidden');
}

/**
 * setAuthLoading — shows or hides the auth loading indicator.
 * Disables/enables the connect and disconnect buttons during the async flow.
 */
export function setAuthLoading(
  el: SettingsAuthElements,
  loading: boolean
): void {
  if (loading) {
    el.authLoadingState.classList.remove('hidden');
    el.connectBtn.disabled = true;
    el.disconnectBtn.disabled = true;
  } else {
    el.authLoadingState.classList.add('hidden');
    el.connectBtn.disabled = false;
    el.disconnectBtn.disabled = false;
  }
}

/**
 * renderAuthError — shows an error message in the auth section.
 */
export function renderAuthError(el: SettingsAuthElements, message: string): void {
  el.authError.textContent = message;
  el.authError.classList.remove('hidden');
}

// ── GCP wizard panel ───────────────────────────────────────────────────────────

/**
 * renderGcpWizardSteps — populates the GCP panel with the setup steps.
 * Called once on connect (static content; steps don't change at runtime).
 *
 * Accepts a <div> container; clears and repopulates it with structured steps.
 */
export function renderGcpWizardSteps(
  container: HTMLElement,
  steps: GcpWizardStep[]
): void {
  container.innerHTML = '';
  for (const step of steps) {
    const section = document.createElement('div');
    section.className = 'gcp-wizard-step';
    section.setAttribute('data-step', String(step.step));

    const heading = document.createElement('h4');
    heading.className = 'gcp-wizard-step__title text-subheadline';
    heading.textContent = `Step ${step.step} — ${step.title}`;
    section.appendChild(heading);

    const list = document.createElement('ol');
    list.className = 'gcp-wizard-step__instructions';
    for (const instruction of step.instructions) {
      const item = document.createElement('li');
      item.textContent = instruction;
      list.appendChild(item);
    }
    section.appendChild(list);

    if (step.warning) {
      const warn = document.createElement('p');
      warn.className = 'gcp-wizard-step__warning settings-callout--warning';
      warn.setAttribute('data-gcp-warning', 'production');
      warn.textContent = step.warning;
      section.appendChild(warn);
    }

    container.appendChild(section);
  }
}

// ── Sync section elements ──────────────────────────────────────────────────────

export interface SettingsSyncElements {
  /** "Sync Now" button. */
  syncBtn: HTMLButtonElement;
  /** Loading spinner shown while run_sync is in-flight. */
  syncLoadingState: HTMLElement;
  /** Container for the sync result summary. Hidden when idle. */
  syncResultDisplay: HTMLElement;
  /** Pulled count text node. */
  syncPulled: HTMLElement;
  /** Pushed count text node. */
  syncPushed: HTMLElement;
  /** Conflicts count text node. */
  syncConflicts: HTMLElement;
  /** Resolved count text node. */
  syncResolved: HTMLElement;
  /** Status label text node. */
  syncStatus: HTMLElement;
  /** "View audit log" anchor — shown when auditLogPath is non-null. */
  syncAuditLink: HTMLAnchorElement;
  /** Container for the conflict-resolved notice. Hidden when no resolved. */
  syncResolvedNotice: HTMLElement;
  /** Error display (especially for code:5 → "connect" message). */
  syncError: HTMLElement;
}

/**
 * renderSyncIdle — resets the sync section to its idle state.
 */
export function renderSyncIdle(el: SettingsSyncElements): void {
  el.syncLoadingState.classList.add('hidden');
  el.syncResultDisplay.classList.add('hidden');
  el.syncError.classList.add('hidden');
  el.syncError.textContent = '';
  el.syncBtn.disabled = false;
}

/**
 * renderSyncLoading — shows the progress indicator, disables the button.
 */
export function renderSyncLoading(el: SettingsSyncElements): void {
  el.syncLoadingState.classList.remove('hidden');
  el.syncResultDisplay.classList.add('hidden');
  el.syncError.classList.add('hidden');
  el.syncBtn.disabled = true;
}

/**
 * renderSyncResult — populates the sync summary after a successful run_sync.
 */
export function renderSyncResult(
  el: SettingsSyncElements,
  view: SyncResultView
): void {
  el.syncLoadingState.classList.add('hidden');
  el.syncBtn.disabled = false;

  // Counts
  el.syncPulled.textContent = String(view.pulled);
  el.syncPushed.textContent = String(view.pushed);
  el.syncConflicts.textContent = String(view.conflicts);
  el.syncResolved.textContent = String(view.resolved);
  el.syncStatus.textContent = view.statusLabel;
  el.syncStatus.setAttribute('data-sync-status', view.status);

  // Audit log link
  if (view.auditLogPath) {
    el.syncAuditLink.textContent = 'View audit log';
    el.syncAuditLink.setAttribute('data-audit-path', view.auditLogPath);
    el.syncAuditLink.classList.remove('hidden');
  } else {
    el.syncAuditLink.classList.add('hidden');
  }

  // Conflict-resolved notice
  if (view.hasResolved) {
    el.syncResolvedNotice.classList.remove('hidden');
    el.syncResolvedNotice.textContent =
      `${view.resolved} conflict(s) were automatically resolved by core. ` +
      (view.auditLogPath ? 'See the audit log for details.' : '');
  } else {
    el.syncResolvedNotice.classList.add('hidden');
  }

  el.syncResultDisplay.classList.remove('hidden');
  el.syncError.classList.add('hidden');
}

/**
 * renderSyncError — shows a sync error message.
 * For code:5 (auth), the message is "Connect Google first …"
 */
export function renderSyncError(
  el: SettingsSyncElements,
  message: string
): void {
  el.syncLoadingState.classList.add('hidden');
  el.syncBtn.disabled = false;
  el.syncError.textContent = message;
  el.syncError.classList.remove('hidden');
  el.syncResultDisplay.classList.add('hidden');
}

// ── Export section elements ────────────────────────────────────────────────────

export interface SettingsExportElements {
  /** Destination path text input. */
  exportDestInput: HTMLInputElement;
  /** Force-overwrite checkbox. */
  exportForceToggle: HTMLInputElement;
  /** "Export" button. */
  exportBtn: HTMLButtonElement;
  /** Loading indicator. */
  exportLoadingState: HTMLElement;
  /** Container for export result summary. Hidden when idle. */
  exportResultDisplay: HTMLElement;
  /** File count text node. */
  exportFileCount: HTMLElement;
  /** Destination path display node. */
  exportDestDisplay: HTMLElement;
  /** Audit-included indicator (shown/hidden). */
  exportAuditIncluded: HTMLElement;
  /** Error display (including dest-collision message). */
  exportError: HTMLElement;
}

/**
 * renderExportIdle — resets the export section to its idle state.
 */
export function renderExportIdle(el: SettingsExportElements): void {
  el.exportLoadingState.classList.add('hidden');
  el.exportResultDisplay.classList.add('hidden');
  el.exportError.classList.add('hidden');
  el.exportError.textContent = '';
  el.exportBtn.disabled = false;
}

/**
 * renderExportLoading — shows progress, disables button.
 */
export function renderExportLoading(el: SettingsExportElements): void {
  el.exportLoadingState.classList.remove('hidden');
  el.exportResultDisplay.classList.add('hidden');
  el.exportError.classList.add('hidden');
  el.exportBtn.disabled = true;
}

/**
 * renderExportResult — populates the export summary.
 */
export function renderExportResult(
  el: SettingsExportElements,
  view: ExportResultView
): void {
  el.exportLoadingState.classList.add('hidden');
  el.exportBtn.disabled = false;

  el.exportFileCount.textContent = String(view.fileCount);
  el.exportDestDisplay.textContent = view.dest;

  if (view.includedAudit) {
    el.exportAuditIncluded.classList.remove('hidden');
    el.exportAuditIncluded.textContent = 'Audit log included';
  } else {
    el.exportAuditIncluded.classList.add('hidden');
  }

  el.exportResultDisplay.classList.remove('hidden');
  el.exportError.classList.add('hidden');
}

/**
 * renderExportError — shows an export error (including dest-collision).
 */
export function renderExportError(
  el: SettingsExportElements,
  message: string
): void {
  el.exportLoadingState.classList.add('hidden');
  el.exportBtn.disabled = false;
  el.exportError.textContent = message;
  el.exportError.classList.remove('hidden');
  el.exportResultDisplay.classList.add('hidden');
}

// ── App info section ───────────────────────────────────────────────────────────

export interface SettingsInfoElements {
  infoRootPath: HTMLElement;
  infoDisplayTz: HTMLElement;
  infoCalendarId: HTMLElement;
  infoSchemaVersion: HTMLElement;
}

/**
 * renderAppInfo — populates the read-only app config display.
 */
export function renderAppInfo(el: SettingsInfoElements, dto: AppConfigDto): void {
  el.infoRootPath.textContent = dto.root_path;
  el.infoDisplayTz.textContent = dto.display_tz;
  el.infoCalendarId.textContent = dto.calendar_id ?? 'not configured';
  el.infoSchemaVersion.textContent = String(dto.schema_version);
}

// ── Appearance controls initialization ────────────────────────────────────────

export interface SettingsAppearanceElements {
  /** Light mode button/radio. */
  appearanceLight: HTMLElement;
  /** Dark mode button/radio. */
  appearanceDark: HTMLElement;
  /** Auto (system) mode button/radio. */
  appearanceAuto: HTMLElement;
  /** Reduce-transparency checkbox. */
  reduceTransparencyToggle: HTMLInputElement;
  /** Increase-contrast checkbox. */
  increaseContrastToggle: HTMLInputElement;
  /** Reduce-motion checkbox. */
  reduceMotionToggle: HTMLInputElement;
  /** Text-size range slider. */
  textSizeRange: HTMLInputElement;
}

/**
 * initAppearanceControls — initializes the Settings appearance controls to
 * reflect the currently-persisted preferences.
 *
 * Does NOT apply prefs to the root (that is AppearanceController's job).
 * This function only sets the control states so they show the current values.
 */
export function initAppearanceControls(
  el: SettingsAppearanceElements,
  prefs: AppearanceControlsState
): void {
  // The controls intentionally expose both radio and pressed semantics for
  // compatibility with the existing segmented-button styling and AT output.
  const modes = [
    [el.appearanceLight, 'light'],
    [el.appearanceDark, 'dark'],
    [el.appearanceAuto, 'auto'],
  ] as const;
  for (const [button, mode] of modes) {
    const active = prefs.appearance === mode ? 'true' : 'false';
    button.setAttribute('aria-checked', active);
    button.setAttribute('aria-pressed', active);
  }

  // A11y toggles
  el.reduceTransparencyToggle.checked = prefs.reduceTransparency;
  el.increaseContrastToggle.checked = prefs.increaseContrast;
  el.reduceMotionToggle.checked = prefs.reduceMotion;

  // Text size slider
  el.textSizeRange.valueAsNumber = prefs.textSizeScale;
}
