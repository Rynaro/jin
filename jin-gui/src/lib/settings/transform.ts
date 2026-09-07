/**
 * settings/transform.ts — pure Settings logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * SettingsController is the thin Stimulus adapter that calls these functions.
 *
 * Covers GUI-S7 (Sync & Settings):
 *   - Auth status formatting (connected / disconnected / needs_reauth + backend)
 *   - GCP setup wizard guidance (mirrors the CLI print_oauth_wizard_guidance)
 *   - Sync result formatting (pulled / pushed / conflicts / resolved + status)
 *   - Sync error formatting (exit-code-5 → "Connect Google first")
 *   - Export result formatting (dest + file_count + audit inclusion)
 *   - Export error formatting (dest-collision → friendly message)
 *
 * Tested by: src/__tests__/settings_controller.test.ts
 */

import type { AuthStatusDto, SyncSummary, ExportResultDto } from '../../types/dto';
import type { JinErrorDto } from '../../types/error';

// ── GCP wizard guidance (mirrors CLI print_oauth_wizard_guidance) ─────────────
//
// Source: jin/src/main.rs fn print_oauth_wizard_guidance()
// These constants are the load-bearing mirror of the CLI wizard.
// The "In production" / 7-day caveat MUST remain present; tests gate on it.

export interface GcpWizardStep {
  step: number;
  title: string;
  instructions: string[];
  warning?: string;
}

/**
 * GCP_WIZARD_STEPS — the four-step GCP OAuth setup guide, mirroring the CLI wizard.
 *
 * CRITICAL: Step 2 contains the "In production" / 7-day caveat that MUST be
 * present for the tests and owner guidance to be correct.
 */
export const GCP_WIZARD_STEPS: GcpWizardStep[] = [
  {
    step: 1,
    title: 'Create a Google Cloud project',
    instructions: [
      'Go to https://console.cloud.google.com/',
      'Create a new project (or select an existing one).',
      'Enable the Google Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    ],
  },
  {
    step: 2,
    title: 'Configure the OAuth consent screen',
    instructions: [
      'Go to https://console.cloud.google.com/apis/credentials/consent',
      'Choose "External" user type (or "Internal" if this is a Workspace account).',
      'Fill in the App name and your email address.',
    ],
    warning:
      'IMPORTANT — Publish to "In production": Under "Publishing status", publish the app to ' +
      '"In production" when leaving development. A personal/few-known-users app may qualify ' +
      'for an exception from verification, but can still show an unverified warning and user cap. ' +
      'If you leave the app in "Testing" status, refresh tokens for sensitive OAuth scopes ' +
      '(including Calendar) expire after ~7 days, forcing you to re-authenticate every week. ' +
      'A public app requesting sensitive Calendar scopes requires Google verification; ' +
      'publishing to production is not the same as being verified.',
  },
  {
    step: 3,
    title: 'Create OAuth credentials',
    instructions: [
      'Go to https://console.cloud.google.com/apis/credentials',
      'Click "Create Credentials" → "OAuth client ID".',
      'Choose "Desktop app" as the application type.',
      'Note the Client ID and Client Secret.',
    ],
  },
  {
    step: 4,
    title: 'Configure Jin',
    instructions: [
      'Add to your .jin/config.toml:\n\n[google]\nclient_id = "YOUR_CLIENT_ID.apps.googleusercontent.com"\nclient_secret = "YOUR_CLIENT_SECRET"',
      'Or set environment variables:\nexport JIN_GOOGLE_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"\nexport JIN_GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"',
    ],
  },
];

/**
 * Full concatenated wizard guidance text (for searching / snapshot testing).
 * Tests gate on the presence of "In production" and "7 days" in this string.
 */
export const GCP_WIZARD_GUIDANCE: string = [
  'Jin — Google Calendar OAuth Setup',
  ...GCP_WIZARD_STEPS.flatMap((s) => [
    `STEP ${s.step} — ${s.title}`,
    ...s.instructions,
    ...(s.warning ? [s.warning] : []),
  ]),
].join('\n');

// ── Auth status view ───────────────────────────────────────────────────────────

export interface AuthStatusView {
  /** The raw state from the DTO. */
  state: 'connected' | 'disconnected' | 'needs_reauth';
  /** Human-readable status label for display. */
  statusLabel: string;
  /** CSS modifier class suffix ('connected' | 'disconnected' | 'needs-reauth'). */
  statusClass: string;
  /** Google account email, or null when disconnected. */
  account: string | null;
  /** Storage backend label (e.g. "keyring", "file"). */
  backend: string;
  /** Formatted expiry string, or null when not available. */
  expiresAt: string | null;
  /**
   * Whether to show the GCP setup panel.
   * True when the owner needs to connect (disconnected or needs_reauth).
   */
  showGcpPanel: boolean;
}

/**
 * formatAuthStatus — converts AuthStatusDto into a flat view-ready structure.
 * Pure: no DOM access, no side effects.
 */
export function formatAuthStatus(dto: AuthStatusDto): AuthStatusView {
  const statusLabels: Record<AuthStatusDto['state'], string> = {
    connected: 'Connected',
    disconnected: 'Not connected',
    needs_reauth: 'Re-authentication required',
  };
  const statusClasses: Record<AuthStatusDto['state'], string> = {
    connected: 'connected',
    disconnected: 'disconnected',
    needs_reauth: 'needs-reauth',
  };

  let expiresAt: string | null = null;
  if (dto.expires_at != null) {
    try {
      expiresAt = new Date(dto.expires_at * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      expiresAt = null;
    }
  }

  return {
    state: dto.state,
    statusLabel: statusLabels[dto.state] ?? dto.state,
    statusClass: statusClasses[dto.state] ?? dto.state,
    account: dto.account,
    backend: dto.backend || 'unknown',
    expiresAt,
    showGcpPanel: dto.state !== 'connected',
  };
}

// ── Sync result view ───────────────────────────────────────────────────────────

export interface SyncResultView {
  status: string;
  pulled: number;
  pushed: number;
  conflicts: number;
  resolved: number;
  auditLogPath: string | null;
  hasConflicts: boolean;
  hasResolved: boolean;
  /**
   * statusLabel — human-readable sync outcome.
   * Derived from the `status` field of SyncSummary.
   */
  statusLabel: string;
}

/**
 * formatSyncResult — converts SyncSummary into a view-ready structure.
 * Pure: no DOM access, no side effects.
 */
export function formatSyncResult(dto: SyncSummary): SyncResultView {
  const statusLabels: Record<string, string> = {
    ok: 'Sync complete',
    queued: 'Changes queued — sync when online',
    conflict: 'Sync complete with conflicts',
    error: 'Sync encountered errors',
  };

  return {
    status: dto.status,
    pulled: dto.pulled,
    pushed: dto.pushed,
    conflicts: dto.conflicts,
    resolved: dto.resolved,
    auditLogPath: dto.audit_log_path,
    hasConflicts: dto.conflicts > 0,
    hasResolved: dto.resolved > 0,
    statusLabel: statusLabels[dto.status] ?? dto.status,
  };
}

// ── Sync error formatting ──────────────────────────────────────────────────────

/**
 * formatSyncError — maps a JinErrorDto from run_sync to a user-readable message.
 *
 * Key cases:
 *   code:5 (auth)    → "Connect Google first — go to Settings to sign in."
 *   code:6 (offline) → "Offline — changes queued and will sync when reconnected."
 *   other            → the DTO message
 */
export function formatSyncError(err: JinErrorDto): string {
  if (err.code === 5) {
    return 'Connect Google first — use the Google Account section above to sign in.';
  }
  if (err.code === 6) {
    return 'Offline — local changes are queued and will sync automatically when reconnected.';
  }
  return err.message || `Sync failed (${err.kind})`;
}

/**
 * isSyncAuthError — true when the error is an authentication gate (code:5).
 * Used to gate the Sync button and show the re-auth prompt.
 */
export function isSyncAuthError(err: JinErrorDto): boolean {
  return err.code === 5;
}

/**
 * isSyncOfflineError — true when the error is an offline error (code:6).
 * Local writes are unaffected; sync is queued.
 */
export function isSyncOfflineError(err: JinErrorDto): boolean {
  return err.code === 6;
}

// ── Export result view ─────────────────────────────────────────────────────────

export interface ExportResultView {
  dest: string;
  fileCount: number;
  includedAudit: boolean;
  /** First 3 files for display summary (full list can be long). */
  previewFiles: string[];
}

/**
 * formatExportResult — converts ExportResultDto into a view-ready structure.
 * Pure: no DOM access, no side effects.
 */
export function formatExportResult(dto: ExportResultDto): ExportResultView {
  return {
    dest: dto.dest,
    fileCount: dto.file_count,
    includedAudit: dto.included_audit,
    previewFiles: dto.files.slice(0, 3),
  };
}

/**
 * formatExportError — maps a JinErrorDto from export_files to a user-readable message.
 *
 * Key cases:
 *   code:2 (usage) — likely a dest-collision or invalid path
 *   code:5 (auth)  — should not happen for export; surface gracefully
 *   other          → the DTO message
 */
export function formatExportError(err: JinErrorDto): string {
  if (err.code === 2) {
    // Dest-collision or invalid path: the core message is the most useful hint.
    // Prepend a friendly label so the owner knows to pick a different destination.
    const hint = err.message.toLowerCase().includes('exist')
      ? 'Destination already exists — choose a different path or use Force.'
      : `Export failed: ${err.message}`;
    return hint;
  }
  return err.message || `Export failed (${err.kind})`;
}

/**
 * isExportDestCollision — true when the error is a destination-path collision (code:2).
 * Lets the render layer show a "use force" affordance.
 */
export function isExportDestCollision(err: JinErrorDto): boolean {
  return err.code === 2;
}

// ── Appearance prefs initializer ───────────────────────────────────────────────

/**
 * AppearanceControlsState — current state of the appearance controls, read
 * from localStorage prefs so the Settings UI can initialize checkboxes/sliders.
 *
 * The actual toggling is delegated to AppearanceController (data-action wiring).
 * SettingsController only READS this to initialize the control states on connect.
 */
export interface AppearanceControlsState {
  appearance: 'light' | 'dark' | 'auto';
  reduceTransparency: boolean;
  increaseContrast: boolean;
  reduceMotion: boolean;
  textSizeScale: number;
}
