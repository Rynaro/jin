// @vitest-environment jsdom
/**
 * sidebar_state.test.ts — unit tests for the collapsible-sidebar state logic.
 *
 * Tests the pure lib/sidebar/state.ts module (load/save/applySidebarCollapsed).
 * The Stimulus SidebarController is a thin adapter that delegates here; the
 * end-to-end wiring is covered separately in sidebar_controller.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
  applySidebarCollapsed,
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_STORAGE_KEY,
  COLLAPSED_CLASS,
} from '../lib/sidebar/state';

beforeEach(() => {
  localStorage.clear();
});

describe('loadSidebarPrefs', () => {
  it('returns DEFAULT_SIDEBAR_PREFS (not collapsed) when nothing is stored', () => {
    expect(loadSidebarPrefs()).toEqual(DEFAULT_SIDEBAR_PREFS);
    expect(loadSidebarPrefs().collapsed).toBe(false);
  });

  it('returns the persisted collapsed state', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed: true }));
    expect(loadSidebarPrefs().collapsed).toBe(true);
  });

  it('is parse-safe — returns defaults on malformed JSON', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, '{ not json');
    expect(loadSidebarPrefs()).toEqual(DEFAULT_SIDEBAR_PREFS);
  });

  it('falls back to the default collapsed value when the key is absent from a partial shape', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ future: 'x' }));
    expect(loadSidebarPrefs().collapsed).toBe(false);
  });

  it('does not share the default object reference between calls', () => {
    const a = loadSidebarPrefs();
    a.collapsed = true;
    expect(loadSidebarPrefs().collapsed).toBe(false);
  });
});

describe('saveSidebarPrefs', () => {
  it('round-trips through localStorage', () => {
    saveSidebarPrefs({ collapsed: true });
    expect(loadSidebarPrefs().collapsed).toBe(true);
    saveSidebarPrefs({ collapsed: false });
    expect(loadSidebarPrefs().collapsed).toBe(false);
  });

  it('writes under the documented storage key', () => {
    saveSidebarPrefs({ collapsed: true });
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"collapsed":true}');
  });
});

describe('applySidebarCollapsed', () => {
  let sidebar: HTMLElement;
  let toggle: HTMLButtonElement;

  beforeEach(() => {
    sidebar = document.createElement('aside');
    sidebar.className = 'jin-sidebar';
    toggle = document.createElement('button');
  });

  it('adds the collapsed class and syncs toggle aria when collapsing', () => {
    applySidebarCollapsed(sidebar, true, toggle);
    expect(sidebar.classList.contains(COLLAPSED_CLASS)).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
  });

  it('removes the collapsed class and syncs toggle aria when expanding', () => {
    sidebar.classList.add(COLLAPSED_CLASS);
    applySidebarCollapsed(sidebar, false, toggle);
    expect(sidebar.classList.contains(COLLAPSED_CLASS)).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
  });

  it('is a no-op on aria when no toggle is supplied (null/undefined safe)', () => {
    expect(() => applySidebarCollapsed(sidebar, true, null)).not.toThrow();
    expect(sidebar.classList.contains(COLLAPSED_CLASS)).toBe(true);
    expect(() => applySidebarCollapsed(sidebar, false)).not.toThrow();
    expect(sidebar.classList.contains(COLLAPSED_CLASS)).toBe(false);
  });
});
