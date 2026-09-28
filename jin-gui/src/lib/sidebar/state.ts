/** The sole persisted preference for the adaptive navigation host. */
export interface SidebarPrefs {
  version: 2;
  expanded: boolean;
}

export const SIDEBAR_STORAGE_KEY = 'jin_sidebar';
export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = { version: 2, expanded: true };
export const COLLAPSED_CLASS = 'is-collapsed';

/** Accept the old {collapsed} shape without ever persisting a second store. */
export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_PREFS };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return { ...DEFAULT_SIDEBAR_PREFS };
    const saved = value as Record<string, unknown>;
    if (saved.version === 2 && typeof saved.expanded === 'boolean') {
      return { version: 2, expanded: saved.expanded };
    }
    if (typeof saved.collapsed === 'boolean') {
      return { version: 2, expanded: !saved.collapsed };
    }
  } catch {
    // Storage may be unavailable or corrupt during startup.
  }
  return { ...DEFAULT_SIDEBAR_PREFS };
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ version: 2, expanded: prefs.expanded }));
  } catch {
    // A storage failure must not prevent local navigation.
  }
}

/** Keep the legacy class as a compatibility hook while the host owns width. */
export function applySidebarCollapsed(sidebar: HTMLElement, collapsed: boolean, toggle?: HTMLElement | null): void {
  sidebar.classList.toggle(COLLAPSED_CLASS, collapsed);
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Show navigation' : 'Hide navigation');
  }
}
