// @vitest-environment jsdom
/**
 * router.test.ts — headless unit tests for the view router (GUI-S3 open dependency).
 *
 * Tests the pure logic from lib/router.ts (no DOM, no mocking needed for state)
 * and the DOM mutation from applyRouterState() (jsdom).
 *
 * Headless gates verified here:
 *   ✓ createInitialState() → today section
 *   ✓ navigate() → correct state, preserves detailId
 *   ✓ applyRouterState() → shows correct section, hides others
 *   ✓ applyRouterState() → sets jin-nav-item--active + aria-current on active item
 *   ✓ applyRouterState() → removes active from non-matching nav items
 *   ✓ navigate(kind, id) → detailId is set in returned state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialState,
  createInitialStateFromHash,
  navigate,
  applyRouterState,
  type ViewKind,
  type RouterState,
} from '../lib/router';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSectionsMap(names: ViewKind[]): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const name of names) {
    const el = document.createElement('section');
    el.dataset.sectionName = name;
    // All sections start hidden (except 'today' in real HTML; test controls this)
    el.classList.add('hidden');
    document.body.appendChild(el);
    map.set(name, el);
  }
  return map;
}

function makeNavItems(sections: ViewKind[]): HTMLElement[] {
  return sections.map((name) => {
    const a = document.createElement('a');
    a.dataset.section = name;
    a.href = `#${name}`;
    document.body.appendChild(a);
    return a;
  });
}

const ALL_SECTIONS: ViewKind[] = ['today', 'notes', 'tasks', 'events', 'notifications', 'settings'];

let sections: Map<string, HTMLElement>;
let navItems: HTMLElement[];

beforeEach(() => {
  document.body.innerHTML = '';
  sections = makeSectionsMap(ALL_SECTIONS);
  navItems = makeNavItems(ALL_SECTIONS);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. createInitialState
// ─────────────────────────────────────────────────────────────────────────────

describe('createInitialState', () => {
  it('returns today as the initial section', () => {
    const state = createInitialState();
    expect(state.section).toBe('today');
  });

  it('returns null detailId in initial state', () => {
    const state = createInitialState();
    expect(state.detailId).toBeNull();
  });
});

describe('createInitialStateFromHash', () => {
  it('starts directly in Notification Center for #notifications', () => {
    expect(createInitialStateFromHash('#notifications')).toEqual({
      section: 'notifications',
      detailId: null,
    });
  });

  it('keeps the safe Today default for unknown hashes', () => {
    expect(createInitialStateFromHash('#not-a-route')).toEqual(createInitialState());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. navigate() — pure state transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('navigate', () => {
  it('returns the correct section for each ViewKind', () => {
    const kinds: ViewKind[] = ['today', 'notes', 'tasks', 'events', 'notifications', 'settings'];
    for (const kind of kinds) {
      const state = navigate(kind);
      expect(state.section).toBe(kind);
    }
  });

  it('returns null detailId when no id is provided', () => {
    const state = navigate('notes');
    expect(state.detailId).toBeNull();
  });

  it('returns the detailId when provided', () => {
    const state = navigate('tasks', 'task-abc-123');
    expect(state.detailId).toBe('task-abc-123');
  });

  it('returns a new state object (does not mutate anything)', () => {
    const s1 = navigate('today');
    const s2 = navigate('notes', 'n-xyz');
    expect(s1.section).toBe('today');
    expect(s2.section).toBe('notes');
    expect(s1.detailId).toBeNull();
    expect(s2.detailId).toBe('n-xyz');
  });

  it('navigate(events, id) → section=events, detailId=id', () => {
    const state = navigate('events', 'evt-999');
    expect(state.section).toBe('events');
    expect(state.detailId).toBe('evt-999');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. applyRouterState() — section visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('applyRouterState — section visibility', () => {
  it('removes "hidden" from the active section', () => {
    const state: RouterState = { section: 'notes', detailId: null };
    applyRouterState(state, sections, navItems);
    expect(sections.get('notes')!.classList.contains('hidden')).toBe(false);
  });

  it('adds "hidden" to all inactive sections', () => {
    const state: RouterState = { section: 'notes', detailId: null };
    applyRouterState(state, sections, navItems);
    for (const kind of ALL_SECTIONS) {
      if (kind === 'notes') continue;
      expect(sections.get(kind)!.classList.contains('hidden')).toBe(true);
    }
  });

  it('shows tasks section and hides all others when section=tasks', () => {
    const state: RouterState = { section: 'tasks', detailId: null };
    applyRouterState(state, sections, navItems);
    expect(sections.get('tasks')!.classList.contains('hidden')).toBe(false);
    expect(sections.get('today')!.classList.contains('hidden')).toBe(true);
    expect(sections.get('notes')!.classList.contains('hidden')).toBe(true);
    expect(sections.get('events')!.classList.contains('hidden')).toBe(true);
  });

  it('shows events section correctly', () => {
    applyRouterState({ section: 'events', detailId: null }, sections, navItems);
    expect(sections.get('events')!.classList.contains('hidden')).toBe(false);
  });

  it('shows today section correctly', () => {
    // First navigate away
    applyRouterState({ section: 'notes', detailId: null }, sections, navItems);
    // Then navigate back to today
    applyRouterState({ section: 'today', detailId: null }, sections, navItems);
    expect(sections.get('today')!.classList.contains('hidden')).toBe(false);
    expect(sections.get('notes')!.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyRouterState() — nav active state
// ─────────────────────────────────────────────────────────────────────────────

describe('applyRouterState — nav active state', () => {
  it('adds jin-nav-item--active to the matching nav item', () => {
    applyRouterState({ section: 'notes', detailId: null }, sections, navItems);
    const notesNav = navItems.find((el) => el.dataset.section === 'notes')!;
    expect(notesNav.classList.contains('jin-nav-item--active')).toBe(true);
  });

  it('sets aria-current="page" on the matching nav item', () => {
    applyRouterState({ section: 'tasks', detailId: null }, sections, navItems);
    const tasksNav = navItems.find((el) => el.dataset.section === 'tasks')!;
    expect(tasksNav.getAttribute('aria-current')).toBe('page');
  });

  it('removes jin-nav-item--active from non-matching nav items', () => {
    // First activate notes
    applyRouterState({ section: 'notes', detailId: null }, sections, navItems);
    // Then activate tasks
    applyRouterState({ section: 'tasks', detailId: null }, sections, navItems);
    const notesNav = navItems.find((el) => el.dataset.section === 'notes')!;
    expect(notesNav.classList.contains('jin-nav-item--active')).toBe(false);
  });

  it('removes aria-current from non-matching nav items', () => {
    applyRouterState({ section: 'notes', detailId: null }, sections, navItems);
    applyRouterState({ section: 'tasks', detailId: null }, sections, navItems);
    const notesNav = navItems.find((el) => el.dataset.section === 'notes')!;
    expect(notesNav.getAttribute('aria-current')).toBeNull();
  });

  it('only one nav item is active at a time', () => {
    applyRouterState({ section: 'events', detailId: null }, sections, navItems);
    const activeItems = navItems.filter((el) =>
      el.classList.contains('jin-nav-item--active')
    );
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].dataset.section).toBe('events');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. navigate(kind, id) → opens the correct detail (state verified)
// ─────────────────────────────────────────────────────────────────────────────

describe('navigate with detailId (router opens correct detail)', () => {
  it('navigate(notes, note-123) → state has section=notes, detailId=note-123', () => {
    const state = navigate('notes', 'note-123');
    expect(state.section).toBe('notes');
    expect(state.detailId).toBe('note-123');
  });

  it('navigate(tasks, task-abc) → state has section=tasks, detailId=task-abc', () => {
    const state = navigate('tasks', 'task-abc');
    expect(state.section).toBe('tasks');
    expect(state.detailId).toBe('task-abc');
  });

  it('navigate(events, evt-xyz) → state has section=events, detailId=evt-xyz', () => {
    const state = navigate('events', 'evt-xyz');
    expect(state.section).toBe('events');
    expect(state.detailId).toBe('evt-xyz');
  });

  it('applyRouterState with detailId shows the correct section', () => {
    const state = navigate('tasks', 'task-abc');
    applyRouterState(state, sections, navItems);
    expect(sections.get('tasks')!.classList.contains('hidden')).toBe(false);
    expect(sections.get('today')!.classList.contains('hidden')).toBe(true);
  });
});
