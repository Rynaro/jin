// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySidebarCollapsed, DEFAULT_SIDEBAR_PREFS, loadSidebarPrefs,
  saveSidebarPrefs, SIDEBAR_STORAGE_KEY,
} from '../lib/sidebar/state';

beforeEach(() => localStorage.clear());

describe('versioned sidebar preference', () => {
  it('defaults to an expanded navigation and returns a fresh object', () => {
    expect(loadSidebarPrefs()).toEqual(DEFAULT_SIDEBAR_PREFS);
    loadSidebarPrefs().expanded = false;
    expect(loadSidebarPrefs().expanded).toBe(true);
  });

  it('imports the old collapsed preference and persists only the v2 shape', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"collapsed":true}');
    expect(loadSidebarPrefs()).toEqual({ version: 2, expanded: false });
    saveSidebarPrefs({ version: 2, expanded: true });
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"version":2,"expanded":true}');
    expect(loadSidebarPrefs().expanded).toBe(true);
  });

  it('ignores corrupt and unrecognized saved values', () => {
    for (const raw of ['{oops', '{}', '{"version":2,"expanded":"false"}', 'null']) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, raw);
      expect(loadSidebarPrefs()).toEqual(DEFAULT_SIDEBAR_PREFS);
    }
  });
});

describe('legacy collapsed class compatibility', () => {
  it('keeps the host class and accessible toggle state in sync', () => {
    const aside = document.createElement('aside');
    const button = document.createElement('button');
    applySidebarCollapsed(aside, true, button);
    expect(aside.classList.contains('is-collapsed')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Show navigation');
    applySidebarCollapsed(aside, false, button);
    expect(aside.classList.contains('is-collapsed')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
