/**
 * router.ts — pure in-memory view-router logic (headless-unit-testable).
 *
 * No DOM access, no side effects, no invoke calls.
 * RouterController is the thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/router.test.ts
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** The named content sections (sidebar nav items). */
export type ViewKind = 'today' | 'notes' | 'tasks' | 'events' | 'notifications' | 'settings';

export interface RouterState {
  /** Currently active top-level section. */
  section: ViewKind;
  /**
   * When non-null, the detail for this id should be opened in the active section.
   * Cleared after the detail controller receives and handles it.
   */
  detailId: string | null;
}

// ── State constructors ────────────────────────────────────────────────────────

/** createInitialState — today is the launch destination (spec §3.1). */
export function createInitialState(): RouterState {
  return { section: 'today', detailId: null };
}

/** Resolve a direct-start URL hash without admitting routes outside ViewKind. */
export function createInitialStateFromHash(hash: string): RouterState {
  const candidate = hash.replace(/^#/, '');
  const views: ViewKind[] = ['today', 'notes', 'tasks', 'events', 'notifications', 'settings'];
  return views.includes(candidate as ViewKind)
    ? { section: candidate as ViewKind, detailId: null }
    : createInitialState();
}

/**
 * navigate — returns a new RouterState for the given section + optional detail id.
 * Pure: does not touch the DOM.
 *
 * navigate('notes')          → show notes list
 * navigate('tasks', 'abc')   → show tasks section + open task detail 'abc'
 */
export function navigate(kind: ViewKind, detailId?: string): RouterState {
  return { section: kind, detailId: detailId ?? null };
}

// ── DOM application ───────────────────────────────────────────────────────────

/**
 * applyRouterState — update the DOM to reflect the given RouterState.
 *
 * - Shows the active section (removes "hidden"), hides others (adds "hidden").
 * - Sets jin-nav-item--active + aria-current="page" on the matching nav item.
 * - Removes both from non-matching items.
 *
 * sections: Map of section-name → HTMLElement (each section has data-section-name="...")
 * navItems: all nav anchor/button elements with data-section="..." attribute
 */
export function applyRouterState(
  state: RouterState,
  sections: Map<string, HTMLElement>,
  navItems: HTMLElement[]
): void {
  // Show / hide content sections
  for (const [key, el] of sections.entries()) {
    if (key === state.section) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // Update nav active state (color + aria — color-independent: item also has icon + label)
  for (const item of navItems) {
    const section = item.dataset.section;
    if (section === state.section) {
      item.classList.add('jin-nav-item--active');
      item.setAttribute('aria-current', 'page');
    } else {
      item.classList.remove('jin-nav-item--active');
      item.removeAttribute('aria-current');
    }
  }
}
