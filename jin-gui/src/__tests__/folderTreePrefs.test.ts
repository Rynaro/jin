/**
 * folderTreePrefs.test.ts — pure unit tests for lib/notes/folderTreePrefs.ts.
 *
 * G-TREE-PERSIST (prefs layer):
 *   - loadFolderTreePrefs returns DEFAULTS on empty localStorage
 *   - loadFolderTreePrefs returns DEFAULTS on corrupt JSON (no throw)
 *   - saveFolderTreePrefs + loadFolderTreePrefs round-trip
 *   - Unknown keys in stored JSON are silently dropped
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadFolderTreePrefs,
  saveFolderTreePrefs,
  DEFAULT_PREFS,
  STORAGE_KEY,
} from '../lib/notes/folderTreePrefs';

// Use a simple in-memory localStorage mock (compatible with the jsdom-free vitest env).
const store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
};

// Inject the mock at the global level.
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

beforeEach(() => {
  localStorageMock.clear();
});

// ── G-TREE-PERSIST — localStorage ─────────────────────────────────────────────

describe('G-TREE-PERSIST — loadFolderTreePrefs', () => {
  it('returns DEFAULT_PREFS when localStorage key is absent', () => {
    const result = loadFolderTreePrefs();
    expect(result).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS on corrupt / non-JSON value (no throw)', () => {
    localStorageMock.setItem(STORAGE_KEY, '{ this is not json }');
    let result: ReturnType<typeof loadFolderTreePrefs> | undefined;
    expect(() => { result = loadFolderTreePrefs(); }).not.toThrow();
    expect(result).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS on null stored value', () => {
    // getItem returns null by default (key absent).
    const result = loadFolderTreePrefs();
    expect(result.expanded).toEqual([]);
    expect(result.paneCollapsed).toBe(false);
  });

  it('returns DEFAULT_PREFS on empty string stored value', () => {
    localStorageMock.setItem(STORAGE_KEY, '');
    // Empty string is falsy → treated as missing → DEFAULTS.
    const result = loadFolderTreePrefs();
    expect(result).toEqual(DEFAULT_PREFS);
  });
});

describe('G-TREE-PERSIST — saveFolderTreePrefs + loadFolderTreePrefs round-trip', () => {
  it('persisted expanded paths survive a reload (re-load)', () => {
    saveFolderTreePrefs({ expanded: ['Work', 'Personal/Notes'], paneCollapsed: false });
    const result = loadFolderTreePrefs();
    expect(result.expanded).toEqual(['Work', 'Personal/Notes']);
  });

  it('persisted paneCollapsed=true survives a reload', () => {
    saveFolderTreePrefs({ expanded: [], paneCollapsed: true });
    const result = loadFolderTreePrefs();
    expect(result.paneCollapsed).toBe(true);
  });

  it('persisted paneCollapsed=false survives a reload', () => {
    saveFolderTreePrefs({ expanded: [], paneCollapsed: false });
    const result = loadFolderTreePrefs();
    expect(result.paneCollapsed).toBe(false);
  });

  it('overwrites previous save on repeated saves', () => {
    saveFolderTreePrefs({ expanded: ['Work'], paneCollapsed: false });
    saveFolderTreePrefs({ expanded: ['Personal'], paneCollapsed: true });
    const result = loadFolderTreePrefs();
    expect(result.expanded).toEqual(['Personal']);
    expect(result.paneCollapsed).toBe(true);
  });
});

describe('G-TREE-PERSIST — unknown keys + defaults spread', () => {
  it('silently drops unknown future keys (does not throw)', () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({
      expanded: ['Work'],
      paneCollapsed: false,
      futureKey: 'ignored',
    }));
    let result: ReturnType<typeof loadFolderTreePrefs> | undefined;
    expect(() => { result = loadFolderTreePrefs(); }).not.toThrow();
    expect(result!.expanded).toEqual(['Work']);
    expect(result!.paneCollapsed).toBe(false);
  });

  it('fills in missing keys with DEFAULT_PREFS values', () => {
    // Only paneCollapsed stored, expanded missing.
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify({ paneCollapsed: true }));
    const result = loadFolderTreePrefs();
    expect(result.expanded).toEqual([]); // from DEFAULT_PREFS
    expect(result.paneCollapsed).toBe(true);
  });
});

describe('G-TREE-PERSIST — saveFolderTreePrefs silent no-op on error', () => {
  it('does not throw even if localStorage.setItem throws', () => {
    const origSetItem = localStorageMock.setItem;
    localStorageMock.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => {
      saveFolderTreePrefs({ expanded: [], paneCollapsed: false });
    }).not.toThrow();
    localStorageMock.setItem = origSetItem;
  });
});
