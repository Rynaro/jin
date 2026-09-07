export const SETTINGS_PANES = [
  'general',
  'calendars',
  'notifications',
  'data-storage',
] as const;

export type SettingsPaneKey = typeof SETTINGS_PANES[number];

export const DEFAULT_SETTINGS_PANE: SettingsPaneKey = 'general';
export const SETTINGS_PANE_STORAGE_KEY = 'jin.settings.pane';

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function isSettingsPaneKey(value: unknown): value is SettingsPaneKey {
  return typeof value === 'string'
    && (SETTINGS_PANES as readonly string[]).includes(value);
}

function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettingsPane(storage = browserStorage()): SettingsPaneKey {
  try {
    const saved = storage?.getItem(SETTINGS_PANE_STORAGE_KEY);
    return isSettingsPaneKey(saved) ? saved : DEFAULT_SETTINGS_PANE;
  } catch {
    return DEFAULT_SETTINGS_PANE;
  }
}

export function saveSettingsPane(
  pane: SettingsPaneKey,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_PANE_STORAGE_KEY, pane);
  } catch {
    // Preferences remain usable when storage is unavailable.
  }
}

export function applySettingsPane(
  navItems: readonly HTMLElement[],
  panes: readonly HTMLElement[],
  requestedPane: unknown,
): SettingsPaneKey {
  const activePane = isSettingsPaneKey(requestedPane)
    ? requestedPane
    : DEFAULT_SETTINGS_PANE;

  navItems.forEach((item) => {
    const isActive = item.dataset.settingsPaneKey === activePane;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  panes.forEach((pane) => {
    pane.hidden = pane.dataset.settingsPaneKey !== activePane;
  });

  return activePane;
}
