/**
 * SettingsController — Stimulus controller for the Sync & Settings view (GUI-S7).
 *
 * Data flow:
 *   connect() → list_google_accounts() + app_config()
 *   runSync() → run_sync() → renderSyncResult() | renderSyncError()
 *   submitExport() → export_files(dest, force) → renderExportResult() | renderExportError()
 *
 * Appearance & accessibility:
 *   Controls in this section dispatch directly to AppearanceController (data-action
 *   "click->appearance#setLight" etc. on <body>). SettingsController only READS
 *   persisted prefs to initialize the control states on connect — it never
 *   reimplements appearance logic.
 *
 * Connect pattern: data-controller="settings" on the Settings <section>.
 *
 * Targets:
 *   (Google Calendar accounts)
 *   googleAccountsList, googleAccountAliasInput, googleAccountsError
 *   (sync)
 *   syncBtn, syncLoadingState, syncResultDisplay
 *   syncPulled, syncPushed, syncConflicts, syncResolved, syncStatus
 *   syncAuditLink, syncResolvedNotice, syncError
 *   (export)
 *   exportDestInput, exportForceToggle, exportBtn
 *   exportLoadingState, exportResultDisplay
 *   exportFileCount, exportDestDisplay, exportAuditIncluded, exportError
 *   (app info)
 *   infoRootPath, infoDisplayTz, infoCalendarId, infoSchemaVersion
 *   (appearance — for initialization only; actions go to AppearanceController)
 *   appearanceLight, appearanceDark, appearanceAuto
 *   reduceTransparencyToggle, increaseContrastToggle, reduceMotionToggle
 *   textSizeRange
 *
 * Actions wired in HTML:
 *   settings#addGoogleAccount — "Add account" button
 *   settings#runSync          — "Sync Now" button
 *   settings#submitExport     — "Export" button
 */

import { Controller } from '@hotwired/stimulus';
import {
  runSync, exportFiles, appConfig, setStoreRoot,
  listGoogleAccounts, addGoogleAccount, renameGoogleAccount,
  connectGoogleAccount, disconnectGoogleAccount, refreshGoogleCalendars, setGoogleCalendarEnabled,
  listQuarantinedSyncOperations, reviewQuarantinedSyncOperation,
  notificationStatus, requestNotificationPermission,
  openNotificationSettings, sendTestNotification,
} from '../invoke';
import type { GoogleAccountDto, NotificationStatusDto, QuarantinedSyncOperationDto } from '../types/dto';
import { isJinErrorDto } from '../types/error';
import {
  formatSyncResult,
  formatSyncError,
  formatExportResult,
  formatExportError,
  isExportDestCollision,
} from '../lib/settings/transform';
import {
  type SettingsSyncElements,
  type SettingsExportElements,
  type SettingsInfoElements,
  type SettingsAppearanceElements,
  renderSyncLoading,
  renderSyncResult,
  renderSyncError,
  renderExportLoading,
  renderExportResult,
  renderExportError,
  renderAppInfo,
  initAppearanceControls,
} from '../lib/settings/render';
import { loadPrefs } from '../lib/appearance/state';
import { initIcons } from '../lib/icons';
import {
  eventLocaleOptions,
  loadEventLocalePreference,
  resolveEventLocale,
  saveEventLocalePreference,
} from '../lib/events/locale';
import { createJinColorPicker, type JinColorPicker } from '../lib/ui/color_picker';
import {
  calendarColor,
  googleCalendarKey,
  JIN_CALENDAR_KEY,
  loadCalendarColors,
  saveCalendarColor,
} from '../lib/calendar/colors';
import {
  applySettingsPane,
  isSettingsPaneKey,
  loadSettingsPane,
  saveSettingsPane,
} from '../lib/settings/navigation';

export default class SettingsController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────

  static targets = [
    'settingsNavItem',
    'settingsPane',
    'settingsWorkspace',
    // Sync
    'syncBtn',
    'syncLoadingState',
    'syncResultDisplay',
    'syncPulled',
    'syncPushed',
    'syncConflicts',
    'syncResolved',
    'syncStatus',
    'syncAuditLink',
    'syncResolvedNotice',
    'syncError',
    // Export
    'exportDestInput',
    'exportForceToggle',
    'exportBtn',
    'exportLoadingState',
    'exportResultDisplay',
    'exportFileCount',
    'exportDestDisplay',
    'exportAuditIncluded',
    'exportError',
    // App info
    'infoRootPath',
    'infoDisplayTz',
    'infoCalendarId',
    'infoSchemaVersion',
    // Store root (P1 sovereignty)
    'changeStoreFolderBtn',
    'changeStoreFolderStatus',
    // Appearance (init-only)
    'appearanceLight',
    'appearanceDark',
    'appearanceAuto',
    'reduceTransparencyToggle',
    'increaseContrastToggle',
    'reduceMotionToggle',
    'textSizeRange',
    'eventLocaleSelect',
    'jinCalendarColorPicker',
    'googleAccountsList',
    'googleAccountAliasInput',
    'googleAccountsError',
    'quarantinedOperationsList',
    'quarantinedOperationsError',
    'notificationLoading', 'notificationStatus', 'notificationReason',
    'notificationAllowBtn', 'notificationSettingsBtn', 'notificationTestBtn', 'notificationCheckBtn',
    'notificationResult', 'notificationError',
  ];

  declare settingsNavItemTargets: HTMLElement[];
  declare settingsPaneTargets: HTMLElement[];
  declare settingsWorkspaceTarget: HTMLElement;

  declare syncBtnTarget: HTMLButtonElement;
  declare syncLoadingStateTarget: HTMLElement;
  declare syncResultDisplayTarget: HTMLElement;
  declare syncPulledTarget: HTMLElement;
  declare syncPushedTarget: HTMLElement;
  declare syncConflictsTarget: HTMLElement;
  declare syncResolvedTarget: HTMLElement;
  declare syncStatusTarget: HTMLElement;
  declare syncAuditLinkTarget: HTMLAnchorElement;
  declare syncResolvedNoticeTarget: HTMLElement;
  declare syncErrorTarget: HTMLElement;

  declare exportDestInputTarget: HTMLInputElement;
  declare exportForceToggleTarget: HTMLInputElement;
  declare exportBtnTarget: HTMLButtonElement;
  declare exportLoadingStateTarget: HTMLElement;
  declare exportResultDisplayTarget: HTMLElement;
  declare exportFileCountTarget: HTMLElement;
  declare exportDestDisplayTarget: HTMLElement;
  declare exportAuditIncludedTarget: HTMLElement;
  declare exportErrorTarget: HTMLElement;

  declare infoRootPathTarget: HTMLElement;
  declare infoDisplayTzTarget: HTMLElement;
  declare infoCalendarIdTarget: HTMLElement;
  declare infoSchemaVersionTarget: HTMLElement;

  declare changeStoreFolderBtnTarget: HTMLButtonElement;
  declare changeStoreFolderStatusTarget: HTMLElement;

  declare appearanceLightTarget: HTMLElement;
  declare appearanceDarkTarget: HTMLElement;
  declare appearanceAutoTarget: HTMLElement;
  declare reduceTransparencyToggleTarget: HTMLInputElement;
  declare increaseContrastToggleTarget: HTMLInputElement;
  declare reduceMotionToggleTarget: HTMLInputElement;
  declare textSizeRangeTarget: HTMLInputElement;
  declare eventLocaleSelectTarget: HTMLSelectElement;
  declare readonly hasEventLocaleSelectTarget: boolean;
  declare jinCalendarColorPickerTarget: HTMLElement;
  declare readonly hasJinCalendarColorPickerTarget: boolean;
  declare googleAccountsListTarget: HTMLElement;
  declare googleAccountAliasInputTarget: HTMLInputElement;
  declare googleAccountsErrorTarget: HTMLElement;
  declare readonly hasGoogleAccountsListTarget: boolean;
  declare readonly hasGoogleAccountAliasInputTarget: boolean;
  declare readonly hasGoogleAccountsErrorTarget: boolean;
  declare quarantinedOperationsListTarget: HTMLElement;
  declare quarantinedOperationsErrorTarget: HTMLElement;
  declare readonly hasQuarantinedOperationsListTarget: boolean;
  declare readonly hasQuarantinedOperationsErrorTarget: boolean;
  declare notificationLoadingTarget: HTMLElement;
  declare notificationStatusTarget: HTMLElement;
  declare notificationReasonTarget: HTMLElement;
  declare notificationAllowBtnTarget: HTMLButtonElement;
  declare notificationSettingsBtnTarget: HTMLButtonElement;
  declare notificationTestBtnTarget: HTMLButtonElement;
  declare notificationCheckBtnTarget: HTMLButtonElement;
  declare notificationResultTarget: HTMLElement;
  declare notificationErrorTarget: HTMLElement;

  private readonly refreshNotificationsOnFocus = (): void => { this.requestNotificationRefresh(); };
  private lastNotificationStatus: NotificationStatusDto | null = null;
  private notificationOperationGeneration = 0;
  private notificationActiveOperations = 0;
  private notificationRefreshQueued = false;
  private hasSuccessfulNotificationStatus = false;
  private notificationFocusTarget: HTMLButtonElement | null = null;
  private readonly colorPickers = new Map<string, JinColorPicker>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    applySettingsPane(
      this.settingsNavItemTargets,
      this.settingsPaneTargets,
      loadSettingsPane(),
    );

    void this.loadAppConfig();
    if (this.hasGoogleAccountsListTarget) void this.loadGoogleAccounts();
    if (this.hasQuarantinedOperationsListTarget) void this.loadQuarantinedOperations();
    void this.loadNotificationStatus();
    window.addEventListener('focus', this.refreshNotificationsOnFocus);

    // Initialize appearance controls from persisted prefs
    const prefs = loadPrefs();
    initAppearanceControls(this.appearanceElements, prefs);
    this.renderEventLocaleSelect();
    this.renderJinCalendarColorPicker();

    initIcons();
  }

  selectPane(event: Event): void {
    const item = event.currentTarget as HTMLElement | null;
    const pane = item?.dataset.settingsPaneKey;
    if (!isSettingsPaneKey(pane)) return;

    applySettingsPane(this.settingsNavItemTargets, this.settingsPaneTargets, pane);
    this.settingsWorkspaceTarget.scrollTop = 0;
    saveSettingsPane(pane);
  }

  disconnect(): void {
    window.removeEventListener('focus', this.refreshNotificationsOnFocus);
    this.colorPickers.forEach(picker => picker.destroy());
    this.colorPickers.clear();
  }

  async allowNotifications(): Promise<void> {
    if (this.notificationActiveOperations > 0) return;
    await this.runNotificationAction(() => requestNotificationPermission(), true);
  }

  async openNotificationSettings(): Promise<void> {
    if (this.notificationActiveOperations > 0) return;
    await this.runNotificationAction(async () => {
      await openNotificationSettings();
      return notificationStatus();
    }, false, 'Notification Settings opened. Return to Jin and choose Check Again.');
  }

  async sendTestNotification(): Promise<void> {
    if (this.notificationActiveOperations > 0) return;
    const generation = this.beginNotificationOperation();
    this.showNotificationError('');
    try {
      const result = await sendTestNotification();
      if (this.isCurrentNotificationOperation(generation)) {
        this.notificationResultTarget.textContent = result.message;
      }
    } catch (error: unknown) {
      if (this.isCurrentNotificationOperation(generation)) {
        this.showNotificationError(this.notificationErrorMessage(error));
      }
    } finally { this.endNotificationOperation(); }
  }

  async checkNotificationStatus(): Promise<void> {
    if (this.notificationActiveOperations > 0) return;
    await this.loadNotificationStatus();
  }

  private async loadNotificationStatus(): Promise<void> {
    const generation = this.beginNotificationOperation();
    this.showNotificationError('');
    try {
      const status = await notificationStatus();
      if (this.isCurrentNotificationOperation(generation)) {
        this.renderNotificationStatus(status);
      }
    } catch (error: unknown) {
      if (this.isCurrentNotificationOperation(generation)) {
        this.renderNotificationStatusUnavailable();
        this.showNotificationError(this.notificationErrorMessage(error));
      }
    } finally { this.endNotificationOperation(); }
  }

  private async runNotificationAction(
    action: () => Promise<NotificationStatusDto>,
    clearResult: boolean,
    result?: string,
  ): Promise<void> {
    const generation = this.beginNotificationOperation();
    this.showNotificationError('');
    if (clearResult) this.notificationResultTarget.textContent = '';
    try {
      const status = await action();
      if (this.isCurrentNotificationOperation(generation)) {
        this.renderNotificationStatus(status);
        if (result) this.notificationResultTarget.textContent = result;
      }
    } catch (error: unknown) {
      if (this.isCurrentNotificationOperation(generation)) {
        this.showNotificationError(this.notificationErrorMessage(error));
      }
    } finally { this.endNotificationOperation(); }
  }

  private renderNotificationStatus(dto: NotificationStatusDto): void {
    this.lastNotificationStatus = dto;
    this.hasSuccessfulNotificationStatus = true;
    const labels: Record<NotificationStatusDto['permission'], string> = {
      granted: 'Allowed', denied: 'Blocked', prompt: 'Permission needed',
      restricted: 'Restricted', not_applicable: 'Managed by desktop',
      unavailable: 'Unavailable', unknown: 'Unknown',
    };
    this.notificationStatusTarget.textContent = labels[dto.permission];
    this.notificationStatusTarget.dataset.permission = dto.permission;
    this.notificationReasonTarget.textContent = dto.reason;
    this.updateNotificationVisibility();
    this.updateNotificationControls();
  }

  private renderNotificationStatusUnavailable(): void {
    this.lastNotificationStatus = null;
    this.hasSuccessfulNotificationStatus = false;
    this.notificationStatusTarget.textContent = 'Check failed';
    this.notificationStatusTarget.dataset.permission = 'unavailable';
    this.notificationReasonTarget.textContent = 'Notification status is unavailable. Choose Check Again to retry.';
    this.updateNotificationVisibility();
    this.updateNotificationControls();
  }

  private beginNotificationOperation(): number {
    if (this.notificationActiveOperations === 0) {
      const active = document.activeElement;
      const controls = this.notificationControls();
      this.notificationFocusTarget = active instanceof HTMLButtonElement && controls.includes(active)
        ? active
        : null;
    }
    const generation = ++this.notificationOperationGeneration;
    this.notificationActiveOperations += 1;
    this.updateNotificationControls();
    return generation;
  }

  private endNotificationOperation(): void {
    this.notificationActiveOperations = Math.max(0, this.notificationActiveOperations - 1);
    if (this.notificationActiveOperations === 0 && this.notificationRefreshQueued) {
      this.notificationRefreshQueued = false;
      void this.loadNotificationStatus();
      return;
    }
    this.updateNotificationVisibility();
    this.updateNotificationControls();
    this.restoreNotificationFocus();
  }

  private isCurrentNotificationOperation(generation: number): boolean {
    return generation === this.notificationOperationGeneration;
  }

  private requestNotificationRefresh(): void {
    if (this.notificationActiveOperations > 0) {
      this.notificationRefreshQueued = true;
      return;
    }
    void this.loadNotificationStatus();
  }

  private updateNotificationControls(): void {
    const busy = this.notificationActiveOperations > 0;
    this.notificationLoadingTarget.classList.toggle('hidden', !busy);
    const status = this.lastNotificationStatus;
    this.setNotificationControlDisabled(
      this.notificationAllowBtnTarget,
      busy || !this.hasSuccessfulNotificationStatus,
      busy,
    );
    this.setNotificationControlDisabled(
      this.notificationSettingsBtnTarget,
      busy || !this.hasSuccessfulNotificationStatus,
      busy,
    );
    this.setNotificationControlDisabled(this.notificationTestBtnTarget, busy
      || !this.hasSuccessfulNotificationStatus
      || !status
      || !['granted', 'not_applicable'].includes(status.permission), busy);
    this.setNotificationControlDisabled(this.notificationCheckBtnTarget, busy, busy);
  }

  private updateNotificationVisibility(): void {
    const status = this.lastNotificationStatus;
    const allowHidden = !status || !(status.permission === 'prompt' && status.can_request);
    const settingsHidden = !status || !status.can_open_settings;
    const preserveBusyFocus = this.notificationActiveOperations > 0;
    this.notificationAllowBtnTarget.hidden = allowHidden
      && !(preserveBusyFocus && this.notificationFocusTarget === this.notificationAllowBtnTarget);
    this.notificationSettingsBtnTarget.hidden = settingsHidden
      && !(preserveBusyFocus && this.notificationFocusTarget === this.notificationSettingsBtnTarget);
  }

  private notificationControls(): HTMLButtonElement[] {
    return [
      this.notificationAllowBtnTarget,
      this.notificationSettingsBtnTarget,
      this.notificationTestBtnTarget,
      this.notificationCheckBtnTarget,
    ];
  }

  private setNotificationControlDisabled(
    control: HTMLButtonElement,
    disabled: boolean,
    busy: boolean,
  ): void {
    const preserveFocusedControl = busy && control === this.notificationFocusTarget;
    control.disabled = disabled && !preserveFocusedControl;
    if (preserveFocusedControl) control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
  }

  private restoreNotificationFocus(): void {
    const target = this.notificationFocusTarget;
    this.notificationFocusTarget = null;
    if (!target?.isConnected) return;
    if (!target.hidden && !target.disabled) {
      target.focus({ preventScroll: true });
      return;
    }
    if (!this.notificationCheckBtnTarget.hidden && !this.notificationCheckBtnTarget.disabled) {
      this.notificationCheckBtnTarget.focus({ preventScroll: true });
    }
  }

  private showNotificationError(message: string): void {
    this.notificationErrorTarget.textContent = message;
    this.notificationErrorTarget.classList.toggle('hidden', !message);
  }

  private notificationErrorMessage(error: unknown): string {
    if (isJinErrorDto(error)) return error.message;
    if (typeof error === 'string') return error;
    return 'Could not update notification settings.';
  }

  async addGoogleAccount(): Promise<void> {
    if (!this.hasGoogleAccountAliasInputTarget) return;
    const alias = this.googleAccountAliasInputTarget.value.trim();
    if (!alias) return this.showGoogleAccountsError('Enter an account alias.');
    try {
      await addGoogleAccount(alias);
      this.googleAccountAliasInputTarget.value = '';
      await this.loadGoogleAccounts();
    } catch (error: unknown) {
      this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not add account.');
    }
  }

  private async loadGoogleAccounts(): Promise<void> {
    try {
      this.renderGoogleAccounts(await listGoogleAccounts());
      this.showGoogleAccountsError('');
    } catch (error: unknown) {
      this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not load accounts.');
    }
  }

  private showGoogleAccountsError(message: string): void {
    if (!this.hasGoogleAccountsErrorTarget) return;
    this.googleAccountsErrorTarget.textContent = message;
    this.googleAccountsErrorTarget.classList.toggle('hidden', !message);
  }

  private renderGoogleAccounts(accounts: GoogleAccountDto[]): void {
    if (!this.hasGoogleAccountsListTarget) return;
    const list = this.googleAccountsListTarget;
    for (const [key, picker] of this.colorPickers) {
      if (key.startsWith('google:')) { picker.destroy(); this.colorPickers.delete(key); }
    }
    list.replaceChildren();
    if (accounts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'color-secondary text-callout';
      empty.textContent = 'No Google accounts configured.';
      list.appendChild(empty);
      return;
    }
    for (const account of accounts) {
      const card = document.createElement('article');
      card.className = 'google-account-card';
      card.setAttribute('aria-label', `${account.alias} Google account`);

      const heading = document.createElement('div');
      heading.className = 'google-account-card__heading';
      const alias = document.createElement('input');
      alias.className = 'settings-input';
      alias.value = account.alias;
      alias.setAttribute('aria-label', `Alias for ${account.alias}`);
      alias.addEventListener('change', () => void this.updateGoogleAlias(account.id, alias.value));
      heading.appendChild(alias);
      const state = document.createElement('span');
      state.className = 'auth-status-pill jin-badge';
      state.textContent = account.state.replace('_', ' ');
      heading.appendChild(state);
      card.appendChild(heading);

      const principal = document.createElement('p');
      principal.className = 'color-secondary text-footnote';
      principal.textContent = account.principal ?? 'Authentication pending';
      card.appendChild(principal);

      const calendars = document.createElement('div');
      calendars.className = 'google-calendar-list';
      for (const calendar of account.calendars) {
        const row = document.createElement('div');
        row.className = 'settings-row settings-calendar-row';
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'settings-calendar-row__toggle';
        const label = document.createElement('span');
        label.textContent = `${calendar.name} · ${calendar.access_role}${calendar.available ? '' : ' · unavailable'}`;
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = calendar.enabled;
        toggle.disabled = !calendar.available;
        toggle.setAttribute('aria-label', `Sync ${calendar.name}`);
        toggle.addEventListener('change', () => void this.toggleGoogleCalendar(account.id, calendar.calendar_id, toggle.checked));
        toggleLabel.append(label, toggle);
        const key = googleCalendarKey(account.id, calendar.calendar_id);
        const picker = createJinColorPicker({
          value: calendarColor(key, loadCalendarColors()),
          label: `Color for ${account.alias} ${calendar.name}`,
          onPick: color => this.updateCalendarColor(key, color),
        });
        this.colorPickers.set(key, picker);
        row.append(toggleLabel, picker.element);
        calendars.appendChild(row);
      }
      card.appendChild(calendars);

      const actions = document.createElement('div');
      actions.className = 'settings-section__actions';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'btn-secondary tap-target';
      refresh.textContent = 'Refresh calendars';
      refresh.disabled = account.state !== 'connected';
      refresh.addEventListener('click', () => void this.refreshGoogleAccount(account.id));
      const connect = document.createElement('button');
      connect.type = 'button';
      connect.className = 'btn-primary tap-target';
      connect.textContent = account.state === 'needs_reauth' ? 'Reconnect' : 'Connect';
      connect.hidden = account.state === 'connected';
      connect.addEventListener('click', () => void this.connectGoogleAccount(account.id));
      const disconnect = document.createElement('button');
      disconnect.type = 'button';
      disconnect.className = 'btn-secondary tap-target';
      disconnect.textContent = 'Disconnect';
      disconnect.disabled = account.state === 'disconnected';
      disconnect.addEventListener('click', () => void this.disconnectGoogleAccount(account.id));
      actions.append(connect, refresh, disconnect);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  private renderJinCalendarColorPicker(): void {
    if (!this.hasJinCalendarColorPickerTarget) return;
    this.colorPickers.get(JIN_CALENDAR_KEY)?.destroy();
    const picker = createJinColorPicker({
      value: calendarColor(JIN_CALENDAR_KEY, loadCalendarColors()),
      label: 'Color for Jin calendar',
      onPick: color => this.updateCalendarColor(JIN_CALENDAR_KEY, color),
    });
    this.colorPickers.set(JIN_CALENDAR_KEY, picker);
    this.jinCalendarColorPickerTarget.replaceChildren(picker.element);
  }

  private updateCalendarColor(key: string, color: Parameters<typeof saveCalendarColor>[1]): void {
    saveCalendarColor(key, color);
    window.dispatchEvent(new CustomEvent('jin:calendar-colors-changed'));
  }

  private async updateGoogleAlias(accountId: string, alias: string): Promise<void> {
    try { this.renderGoogleAccounts(await renameGoogleAccount(accountId, alias)); }
    catch (error: unknown) { this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not rename account.'); }
  }

  private async refreshGoogleAccount(accountId: string): Promise<void> {
    try { this.renderGoogleAccounts(await refreshGoogleCalendars(accountId)); }
    catch (error: unknown) { this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not refresh calendars.'); }
  }

  private async connectGoogleAccount(accountId: string): Promise<void> {
    try {
      this.renderGoogleAccounts(await connectGoogleAccount(accountId));
      this.showGoogleAccountsError('');
    } catch (error: unknown) {
      // Core persists successful auth before CalendarList discovery. Reload so
      // that a partial discovery failure still displays the connected account.
      await this.loadGoogleAccounts();
      this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not connect account.');
    }
  }

  private async toggleGoogleCalendar(accountId: string, calendarId: string, enabled: boolean): Promise<void> {
    try { this.renderGoogleAccounts(await setGoogleCalendarEnabled(accountId, calendarId, enabled)); }
    catch (error: unknown) { this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not update calendar.'); }
  }

  private async disconnectGoogleAccount(accountId: string): Promise<void> {
    try {
      this.renderGoogleAccounts(await disconnectGoogleAccount(accountId));
      await this.loadQuarantinedOperations();
    }
    catch (error: unknown) { this.showGoogleAccountsError(isJinErrorDto(error) ? error.message : 'Could not disconnect account.'); }
  }

  private async loadQuarantinedOperations(): Promise<void> {
    if (!this.hasQuarantinedOperationsListTarget) return;
    try {
      this.renderQuarantinedOperations(await listQuarantinedSyncOperations());
      this.showQuarantinedOperationsError('');
    } catch (error: unknown) {
      this.showQuarantinedOperationsError(isJinErrorDto(error) ? error.message : 'Could not load changes awaiting review.');
    }
  }

  private renderQuarantinedOperations(operations: QuarantinedSyncOperationDto[]): void {
    if (!this.hasQuarantinedOperationsListTarget) return;
    const list = this.quarantinedOperationsListTarget;
    list.replaceChildren();
    if (operations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'color-secondary text-callout';
      empty.textContent = 'No changes are awaiting review.';
      list.appendChild(empty);
      return;
    }
    for (const operation of operations) {
      const card = document.createElement('article');
      card.className = 'quarantined-operation-card';
      card.setAttribute('aria-label', `${operation.operation} ${operation.jin_id} awaiting review`);
      const title = document.createElement('strong');
      title.textContent = `${operation.operation} · ${operation.jin_id}`;
      const route = document.createElement('p');
      route.className = 'color-secondary text-footnote';
      route.textContent = `${operation.account_alias} · ${operation.calendar_name} · ${operation.pause_reason}`;
      const actions = document.createElement('div');
      actions.className = 'settings-section__actions';
      const resume = document.createElement('button');
      resume.type = 'button'; resume.className = 'btn-primary tap-target'; resume.textContent = 'Resume original destination';
      resume.addEventListener('click', () => void this.reviewQuarantinedOperation(operation, true));
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn-secondary tap-target'; cancel.textContent = 'Cancel change';
      cancel.addEventListener('click', () => void this.reviewQuarantinedOperation(operation, false));
      actions.append(resume, cancel);
      card.append(title, route, actions);
      list.appendChild(card);
    }
  }

  private async reviewQuarantinedOperation(operation: QuarantinedSyncOperationDto, resume: boolean): Promise<void> {
    try {
      this.renderQuarantinedOperations(await reviewQuarantinedSyncOperation(operation, resume));
      this.showQuarantinedOperationsError('');
    } catch (error: unknown) {
      this.showQuarantinedOperationsError(isJinErrorDto(error) ? error.message : 'Could not review this change.');
    }
  }

  private showQuarantinedOperationsError(message: string): void {
    if (!this.hasQuarantinedOperationsErrorTarget) return;
    this.quarantinedOperationsErrorTarget.textContent = message;
    this.quarantinedOperationsErrorTarget.classList.toggle('hidden', !message);
  }

  changeEventLocale(): void {
    if (!this.hasEventLocaleSelectTarget) return;
    saveEventLocalePreference(this.eventLocaleSelectTarget.value);
    this.renderEventLocaleSelect();
  }

  private renderEventLocaleSelect(): void {
    if (!this.hasEventLocaleSelectTarget) return;
    const selected = loadEventLocalePreference();
    this.eventLocaleSelectTarget.innerHTML = '';
    for (const option of eventLocaleOptions(resolveEventLocale(selected))) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.value === selected;
      this.eventLocaleSelectTarget.appendChild(element);
    }
  }

  // ── Sync action ───────────────────────────────────────────────────────────

  /**
   * runSync — triggers run_sync().
   *
   * On success: renders pulled/pushed/conflicts/resolved + status.
   * On code:5 (auth): shows "Connect Google first" message.
   * On code:6 (offline): shows "queued" message; does not block.
   */
  async runSync(): Promise<void> {
    const el = this.syncElements;
    renderSyncLoading(el);

    try {
      const dto = await runSync();
      renderSyncResult(el, formatSyncResult(dto));
      this.dispatch('events-mutated', { prefix: 'jin', bubbles: true });
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        renderSyncError(el, formatSyncError(err));
      } else {
        renderSyncError(el, 'Unexpected error during sync.');
      }
    }
  }

  // ── Export action ─────────────────────────────────────────────────────────

  /**
   * submitExport — triggers export_files(dest, force).
   * Reads the dest path from exportDestInput and force flag from exportForceToggle.
   *
   * On code:2 (dest-collision): surfaces "Destination already exists" message.
   */
  async submitExport(): Promise<void> {
    const dest = this.exportDestInputTarget.value.trim();
    if (!dest) {
      const el = this.exportElements;
      renderExportError(el, 'Destination path is required.');
      return;
    }

    const force = this.exportForceToggleTarget.checked;
    const el = this.exportElements;
    renderExportLoading(el);

    try {
      const dto = await exportFiles(dest, force);
      renderExportResult(el, formatExportResult(dto));
    } catch (err: unknown) {
      if (isJinErrorDto(err)) {
        const message = formatExportError(err);
        renderExportError(el, message);
        // Surface the dest-collision affordance (force toggle hint)
        if (isExportDestCollision(err)) {
          this.exportForceToggleTarget.parentElement?.classList.remove('hidden');
        }
      } else {
        renderExportError(el, 'Unexpected error during export.');
      }
    }
  }

  // ── Store root (P1 sovereignty) ───────────────────────────────────────────

  /**
   * changeStoreFolder — opens a native folder picker (tauri-plugin-dialog),
   * persists the selected path via set_store_root, and displays a confirmation.
   *
   * The change takes effect on the next application launch (restart required).
   */
  async changeStoreFolder(): Promise<void> {
    const btn = this.changeStoreFolderBtnTarget;
    const status = this.changeStoreFolderStatusTarget;
    btn.disabled = true;
    status.textContent = '';
    status.removeAttribute('data-store-status');

    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose Jin store folder',
      });

      if (!selected) {
        // User cancelled — restore button.
        btn.disabled = false;
        return;
      }

      const path = typeof selected === 'string' ? selected : (selected as string[])[0];
      await setStoreRoot(path);
      status.textContent = `Store folder set to "${path}". Restart the app to apply.`;
      status.setAttribute('data-store-status', 'saved');
    } catch (err: unknown) {
      const message = isJinErrorDto(err) ? err.message : 'Could not change store folder.';
      status.textContent = message;
      status.setAttribute('data-store-status', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadAppConfig(): Promise<void> {
    try {
      const dto = await appConfig();
      renderAppInfo(this.infoElements, dto);
    } catch (err: unknown) {
      // App config is non-critical; log only (don't block the settings view).
      console.warn('[SettingsController] could not load app config:', err);
    }
  }

  // ── Target getters ────────────────────────────────────────────────────────

  private get syncElements(): SettingsSyncElements {
    return {
      syncBtn: this.syncBtnTarget,
      syncLoadingState: this.syncLoadingStateTarget,
      syncResultDisplay: this.syncResultDisplayTarget,
      syncPulled: this.syncPulledTarget,
      syncPushed: this.syncPushedTarget,
      syncConflicts: this.syncConflictsTarget,
      syncResolved: this.syncResolvedTarget,
      syncStatus: this.syncStatusTarget,
      syncAuditLink: this.syncAuditLinkTarget,
      syncResolvedNotice: this.syncResolvedNoticeTarget,
      syncError: this.syncErrorTarget,
    };
  }

  private get exportElements(): SettingsExportElements {
    return {
      exportDestInput: this.exportDestInputTarget,
      exportForceToggle: this.exportForceToggleTarget,
      exportBtn: this.exportBtnTarget,
      exportLoadingState: this.exportLoadingStateTarget,
      exportResultDisplay: this.exportResultDisplayTarget,
      exportFileCount: this.exportFileCountTarget,
      exportDestDisplay: this.exportDestDisplayTarget,
      exportAuditIncluded: this.exportAuditIncludedTarget,
      exportError: this.exportErrorTarget,
    };
  }

  private get infoElements(): SettingsInfoElements {
    return {
      infoRootPath: this.infoRootPathTarget,
      infoDisplayTz: this.infoDisplayTzTarget,
      infoCalendarId: this.infoCalendarIdTarget,
      infoSchemaVersion: this.infoSchemaVersionTarget,
    };
  }

  private get appearanceElements(): SettingsAppearanceElements {
    return {
      appearanceLight: this.appearanceLightTarget,
      appearanceDark: this.appearanceDarkTarget,
      appearanceAuto: this.appearanceAutoTarget,
      reduceTransparencyToggle: this.reduceTransparencyToggleTarget,
      increaseContrastToggle: this.increaseContrastToggleTarget,
      reduceMotionToggle: this.reduceMotionToggleTarget,
      textSizeRange: this.textSizeRangeTarget,
    };
  }
}
