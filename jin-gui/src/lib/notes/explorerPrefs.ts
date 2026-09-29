export type NotesExplorerView = 'list' | 'cards';
export const NOTES_EXPLORER_VIEW_CHANGED = 'jin:notes-explorer-view-changed';

const STORAGE_KEY = 'jin_notes_explorer_view';

export function loadNotesExplorerView(): NotesExplorerView {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

export function saveNotesExplorerView(view: NotesExplorerView): void {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // The in-memory view remains usable when local storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<NotesExplorerView>(NOTES_EXPLORER_VIEW_CHANGED, { detail: view }));
}
