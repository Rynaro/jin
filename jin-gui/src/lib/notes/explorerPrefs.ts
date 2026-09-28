export type NotesExplorerView = 'list' | 'cards';

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
}
