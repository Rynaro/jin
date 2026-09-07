// @vitest-environment jsdom
/**
 * router_controller_wiring.test.ts — Stimulus wiring integration test (GUI-S4 regression guard).
 *
 * Loads the ACTUAL index.html body into jsdom, starts a real Stimulus Application,
 * registers RouterController, and asserts that:
 *   - sectionTargets and navItemTargets resolve to the correct element counts
 *   - Clicking a nav item actually switches the visible section (end-to-end wiring)
 *
 * Why this test exists:
 *   The malformed boolean attribute form (data-router-section-target, data-router-nav-item-target)
 *   causes sectionTargets and navItemTargets to resolve to empty arrays — silently, with no
 *   console error — so navigateTo / activateSection / applyRouterState do nothing.
 *   The correct Stimulus 3 format is data-router-target="section" / data-router-target="navItem".
 *
 * Fails on the pre-fix HTML:
 *   sectionTargets.length === 0, navItemTargets.length === 0 → assertions fail (0 !== 5).
 *   A nav click has no visible effect.
 *
 * Passes after the fix:
 *   Both target arrays have length 5; clicking Notes switches the DOM state correctly.
 *
 * Mock strategy:
 *   - @tauri-apps/api/core: mocked so any transitive invoke import never hits Tauri runtime.
 *   - ../lib/icons: initIcons() mocked to a no-op — we test wiring, not icon rendering.
 *   - Only RouterController is registered; other controllers silently skip connect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import RouterController from '../controllers/router_controller';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Prevent any invoke calls from reaching the Tauri runtime (offline guard).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));

// Prevent @tauri-apps/plugin-dialog from erroring if imported transitively.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// initIcons calls createIcons (lucide) which does SVG DOM work — not relevant here.
vi.mock('../lib/icons', () => ({
  initIcons: vi.fn(),
}));

// ── HTML fixture ──────────────────────────────────────────────────────────────

/** Read the actual index.html once at module load time. */
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

/**
 * Extract the innerHTML of <body> from the full HTML string.
 * We inject this into jsdom's document.body rather than replacing the entire document
 * so that Stimulus's Application (bound to document.documentElement) works normally.
 */
function extractBodyInnerHTML(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Could not extract <body> from index.html');
  return match[1];
}

const BODY_CONTENT = extractBodyInnerHTML(INDEX_HTML);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the connected RouterController instance from the live jsdom document. */
function getController(app: Application): RouterController {
  // .jin-shell carries data-controller="router capture actions" — [~=] matches space-separated
  const el = document.querySelector('[data-controller~="router"]') as HTMLElement;
  return app.getControllerForElementAndIdentifier(el, 'router') as RouterController;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RouterController Stimulus wiring — integration', () => {
  let app: Application;

  beforeEach(() => {
    window.location.hash = '';
    // 1. Inject the real index.html body so the DOM matches production HTML exactly.
    document.body.innerHTML = BODY_CONTENT;

    // 2. Create the Stimulus Application.  start() scans the existing DOM synchronously,
    //    storing discovered scopes keyed by controller identifier.
    app = Application.start(document.documentElement, defaultSchema);

    // 3. Register RouterController.  loadDefinition() calls connectModule() which
    //    looks up pre-discovered scopes and connects them — all synchronous.
    app.register('router', RouterController);
  });

  afterEach(() => {
    app.stop();
    document.body.innerHTML = '';
  });

  // ── Target resolution ─────────────────────────────────────────────────────
  // These two tests are the primary regression guard: they FAIL on the pre-fix HTML
  // (malformed boolean attrs → empty arrays) and PASS after the fix.

  it('sectionTargets resolves to 6 elements — one per content view', () => {
    const ctrl = getController(app);
    expect(ctrl, 'RouterController must be connected').toBeTruthy();
    // Pre-fix: 0 (malformed data-router-section-target boolean attrs)
    // Current shell: 6 (including the Notification Center route).
    expect(ctrl.sectionTargets).toHaveLength(6);
  });

  it('navItemTargets resolves to 6 elements — one per sidebar nav item', () => {
    const ctrl = getController(app);
    expect(ctrl, 'RouterController must be connected').toBeTruthy();
    // Pre-fix: 0 (malformed data-router-nav-item-target boolean attrs)
    // Current shell: 6 (including the Notification Center bell).
    expect(ctrl.navItemTargets).toHaveLength(6);
  });

  it('routes Events activation to the calendar layout-readiness hook', () => {
    const events = document.querySelector<HTMLElement>('[data-section-name="events"]')!;
    expect(events.dataset.action).toContain('jin:section-activated->calendar-view#activateSection');
  });

  it('honors #notifications on direct application startup', async () => {
    app.stop();
    document.body.innerHTML = BODY_CONTENT;
    window.location.hash = '#notifications';
    app = Application.start(document.documentElement, defaultSchema);
    app.register('router', RouterController);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const notifications = document.querySelector<HTMLElement>('[data-section-name="notifications"]')!;
    const today = document.querySelector<HTMLElement>('[data-section-name="today"]')!;
    const notificationsNav = document.querySelector<HTMLElement>('a[data-section="notifications"]')!;
    expect(notifications.classList.contains('hidden')).toBe(false);
    expect(today.classList.contains('hidden')).toBe(true);
    expect(notificationsNav.getAttribute('aria-current')).toBe('page');
  });

  // ── Nav click switches sections ───────────────────────────────────────────
  // These tests assert the full end-to-end wiring: click → navigateTo → activateSection
  // → buildSectionsMap → applyRouterState → DOM update.
  // They FAIL on the pre-fix HTML (empty maps → applyRouterState is a no-op).

  it('clicking the Notes nav item removes hidden from the notes section', () => {
    const notesSection = document.querySelector('[data-section-name="notes"]') as HTMLElement;
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;

    // Precondition: notes section starts hidden
    expect(notesSection.classList.contains('hidden')).toBe(true);

    notesNav.click();

    // After click: notes section is visible
    expect(notesSection.classList.contains('hidden')).toBe(false);
  });

  it('clicking the Notes nav item adds hidden to the today section', () => {
    const todaySection = document.querySelector('[data-section-name="today"]') as HTMLElement;
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;

    // Precondition: today section starts visible (active launch destination in HTML)
    expect(todaySection.classList.contains('hidden')).toBe(false);

    notesNav.click();

    // After click: today section is hidden
    expect(todaySection.classList.contains('hidden')).toBe(true);
  });

  it('clicking the Notes nav item sets aria-current="page" on the notes nav item', () => {
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;
    notesNav.click();
    expect(notesNav.getAttribute('aria-current')).toBe('page');
  });

  it('clicking the Notes nav item adds jin-nav-item--active to the notes nav item', () => {
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;
    notesNav.click();
    expect(notesNav.classList.contains('jin-nav-item--active')).toBe(true);
  });

  it('clicking the Notes nav item removes active state from the today nav item', () => {
    const todayNav = document.querySelector('a[data-section="today"]') as HTMLElement;
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;

    // Precondition: today nav is active on launch
    expect(todayNav.classList.contains('jin-nav-item--active')).toBe(true);
    expect(todayNav.getAttribute('aria-current')).toBe('page');

    notesNav.click();

    // Today nav must lose its active state
    expect(todayNav.classList.contains('jin-nav-item--active')).toBe(false);
    expect(todayNav.getAttribute('aria-current')).toBeNull();
  });

  it('only one section is visible after any nav click', () => {
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;
    notesNav.click();

    const allSections = document.querySelectorAll('[data-section-name]');
    const visibleSections = Array.from(allSections).filter(
      (el) => !el.classList.contains('hidden')
    );
    expect(visibleSections).toHaveLength(1);
    expect((visibleSections[0] as HTMLElement).dataset.sectionName).toBe('notes');
  });

  it('only one nav item is active after any nav click', () => {
    const notesNav = document.querySelector('a[data-section="notes"]') as HTMLElement;
    notesNav.click();

    const allNavItems = document.querySelectorAll('a[data-section]');
    const activeItems = Array.from(allNavItems).filter((el) =>
      el.classList.contains('jin-nav-item--active')
    );
    expect(activeItems).toHaveLength(1);
    expect((activeItems[0] as HTMLElement).dataset.section).toBe('notes');
  });
});
