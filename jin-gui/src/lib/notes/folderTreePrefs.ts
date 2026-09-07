/**
 * notes/folderTreePrefs.ts — localStorage persistence for the folder tree pane.
 *
 * Mirrors lib/appearance/state.ts exactly:
 *   - try/catch → DEFAULTS on miss or parse-error (parse-safe load).
 *   - silent try/catch save (no-op if localStorage unavailable, e.g. private browsing).
 *
 * Key: 'jin_notes_folder_tree'
 * Shape: { expanded: string[], paneCollapsed: boolean }
 */

export interface FolderTreePrefs {
  /** Paths currently expanded in the folder tree (as a serializable string[]). */
  expanded: string[];
  /** Whether the folder-rail sidebar pane is collapsed. */
  paneCollapsed: boolean;
}

export const DEFAULT_PREFS: FolderTreePrefs = {
  expanded: [],
  paneCollapsed: false,
};

export const STORAGE_KEY = 'jin_notes_folder_tree';

/**
 * loadFolderTreePrefs — reads from localStorage; returns DEFAULT_PREFS on
 * miss or any parse error. Unknown keys from future versions are silently dropped
 * (spread into defaults).
 */
export function loadFolderTreePrefs(): FolderTreePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed: Partial<FolderTreePrefs> = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * saveFolderTreePrefs — writes to localStorage. Silently no-ops if unavailable
 * (e.g. private browsing, Tauri WebView with restricted storage).
 */
export function saveFolderTreePrefs(prefs: FolderTreePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silent: localStorage unavailable is not a fatal error.
  }
}
