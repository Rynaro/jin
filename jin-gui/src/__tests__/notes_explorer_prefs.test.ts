// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNotesExplorerView, saveNotesExplorerView } from '../lib/notes/explorerPrefs';

describe('Notes explorer view preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to List and only accepts the exact Cards value', () => {
    expect(loadNotesExplorerView()).toBe('list');
    localStorage.setItem('jin_notes_explorer_view', 'board');
    expect(loadNotesExplorerView()).toBe('list');
    localStorage.setItem('jin_notes_explorer_view', 'cards');
    expect(loadNotesExplorerView()).toBe('cards');
  });

  it('persists a validated view and falls back safely when storage is unavailable', () => {
    saveNotesExplorerView('cards');
    expect(loadNotesExplorerView()).toBe('cards');
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadNotesExplorerView()).toBe('list');
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveNotesExplorerView('list')).not.toThrow();
    set.mockRestore();
  });
});
