/**
 * sidebar/state.ts — pure logic for the collapsible app sidebar (no Stimulus).
 *
 * Extracted so the collapse/persist contract is testable without a Tauri or
 * Stimulus runtime. The Stimulus SidebarController is a thin adapter that
 * delegates here. Mirrors lib/appearance/state.ts and lib/notes/folderTreePrefs.ts:
 *   - parse-safe load (try/catch → DEFAULTS on miss or parse error)
 *   - silent save (no-op if localStorage is unavailable)
 *
 * DOM contract (applySidebarCollapsed):
 *   .jin-sidebar.is-collapsed   → CSS collapses the panel to an icon rail
 *   toggle button aria-expanded = "false" when collapsed, "true" when expanded
 *   toggle button aria-label    = "Expand sidebar" / "Collapse sidebar"
 *
 * Key: 'jin_sidebar'  ·  Shape: { collapsed: boolean }
 */

export interface SidebarPrefs {
  /** Whether the app sidebar is collapsed to an icon-only rail. */
  collapsed: boolean;
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  collapsed: false,
};

export const SIDEBAR_STORAGE_KEY = 'jin_sidebar';

export const COLLAPSED_CLASS = 'is-collapsed';

/**
 * loadSidebarPrefs — reads from localStorage; returns DEFAULT_SIDEBAR_PREFS on
 * miss or any parse error. Unknown keys from future versions are dropped.
 */
export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_PREFS };
    const parsed: Partial<SidebarPrefs> = JSON.parse(raw);
    return { ...DEFAULT_SIDEBAR_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFS };
  }
}

/**
 * saveSidebarPrefs — writes to localStorage. Silently no-ops if unavailable
 * (e.g. private browsing, Tauri WebView with restricted storage).
 */
export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silent: localStorage unavailable is not a fatal error.
  }
}

/**
 * applySidebarCollapsed — applies the collapsed state to the DOM.
 *
 * @param sidebar  the <aside class="jin-sidebar"> element
 * @param collapsed whether to collapse to the icon rail
 * @param toggle   the toggle <button> (optional); aria state is synced when present
 */
export function applySidebarCollapsed(
  sidebar: HTMLElement,
  collapsed: boolean,
  toggle?: HTMLElement | null,
): void {
  sidebar.classList.toggle(COLLAPSED_CLASS, collapsed);
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
}
