// @vitest-environment jsdom
/**
 * sidebar_controller.test.ts — Stimulus wiring integration test for the
 * collapsible app sidebar.
 *
 * Loads the ACTUAL index.html body into jsdom, starts a real Stimulus
 * Application, registers SidebarController, and asserts the full contract:
 *   - the toggle target resolves
 *   - connect() restores the persisted collapsed state
 *   - clicking the toggle collapses/expands, flips aria, and persists
 *   - the collapsed-mode tooltip markup (data-tooltip) is present on every item
 *
 * Mirrors router_controller_wiring.test.ts. SidebarController imports no Tauri
 * APIs, so no invoke/dialog/icon mocks are needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import SidebarController from '../controllers/sidebar_controller';
import { SIDEBAR_STORAGE_KEY } from '../lib/sidebar/state';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

function extractBodyInnerHTML(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Could not extract <body> from index.html');
  return match[1];
}

const BODY_CONTENT = extractBodyInnerHTML(INDEX_HTML);

function aside(): HTMLElement {
  return document.querySelector('[data-controller~="sidebar"]') as HTMLElement;
}

function toggleBtn(): HTMLButtonElement {
  return document.querySelector('[data-sidebar-target="toggle"]') as HTMLButtonElement;
}

describe('SidebarController Stimulus wiring — integration', () => {
  let app: Application;

  /**
   * Mount Stimulus + register the controller, then yield a macrotask so the
   * async Stimulus connect() runs before assertions (start() connects on a
   * tick after domReady, not synchronously).
   */
  async function mount(): Promise<void> {
    app = Application.start(document.documentElement, defaultSchema);
    app.register('sidebar', SidebarController);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = BODY_CONTENT;
  });

  afterEach(() => {
    app?.stop();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  // ── Markup wiring ───────────────────────────────────────────────────────────

  it('the sidebar <aside> hosts the controller and a resolvable toggle target', async () => {
    await mount();
    expect(aside()).toBeTruthy();
    expect(toggleBtn()).toBeTruthy();
    const ctrl = app.getControllerForElementAndIdentifier(aside(), 'sidebar');
    expect(ctrl, 'SidebarController must be connected').toBeTruthy();
  });

  it('every collapsible item carries a data-tooltip for icon-rail mode', async () => {
    await mount();
    const tips = Array.from(
      document.querySelectorAll('[data-tooltip]'),
      (el) => el.getAttribute('data-tooltip'),
    );
    expect(tips).toEqual(
      expect.arrayContaining(['Today', 'Notes', 'Tasks', 'Events', 'Settings', 'Capture']),
    );
  });

  // ── Layout reorg (Capture-to-top, Settings-as-gear) ─────────────────────────
  // These read the static markup (no mount needed; beforeEach injects the body).

  it('pins the cozy Capture action at the top, above the nav (not in the foot)', () => {
    const capture = document.querySelector('.jin-capture-btn') as HTMLElement;
    expect(capture).toBeTruthy();
    expect(capture.closest('.jin-sidebar-actions')).toBeTruthy();
    expect(capture.closest('.jin-sidebar-foot')).toBeNull();
    // Capture's actions block precedes the nav in document order.
    const actions = document.querySelector('.jin-sidebar-actions') as HTMLElement;
    const nav = document.querySelector('.jin-nav') as HTMLElement;
    expect(actions.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps Settings as a labeled rail row in the foot (out of the nav list)', () => {
    const settings = document.querySelector('[data-section="settings"]') as HTMLElement;
    expect(settings).toBeTruthy();
    expect(settings.closest('.jin-sidebar-foot')).toBeTruthy();
    expect(settings.closest('.jin-nav-list')).toBeNull();
    expect(settings.classList.contains('jin-settings-btn')).toBe(true);
    // Expanded rail keeps the label visible; collapsed CSS hides it and uses the tooltip.
    expect(settings.querySelector('span')?.textContent).toBe('Settings');
    expect(settings.getAttribute('data-tooltip')).toBe('Settings');
    expect(settings.getAttribute('aria-label')).toBe('Settings');
    // Still a router target so navigation + active state keep working.
    expect(settings.getAttribute('data-router-target')).toBe('navItem');
  });

  it('places Notifications first below Capture, before the primary sections', () => {
    const navSections = Array.from(
      document.querySelectorAll('.jin-nav-list [data-section]'),
      (el) => el.getAttribute('data-section'),
    );
    expect(navSections).toEqual(['notifications', 'today', 'notes', 'tasks', 'events']);
  });

  // ── Default state (nothing persisted) ───────────────────────────────────────

  it('starts expanded when no preference is stored', async () => {
    await mount();
    expect(aside().classList.contains('is-collapsed')).toBe(false);
    expect(toggleBtn().getAttribute('aria-expanded')).toBe('true');
  });

  // ── Toggle behaviour ────────────────────────────────────────────────────────

  it('clicking the toggle collapses the sidebar, flips aria, and persists', async () => {
    await mount();
    toggleBtn().click();

    expect(aside().classList.contains('is-collapsed')).toBe(true);
    expect(toggleBtn().getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn().getAttribute('aria-label')).toBe('Expand sidebar');
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"collapsed":true}');
  });

  it('clicking the toggle twice returns to expanded and persists false', async () => {
    await mount();
    toggleBtn().click();
    toggleBtn().click();

    expect(aside().classList.contains('is-collapsed')).toBe(false);
    expect(toggleBtn().getAttribute('aria-expanded')).toBe('true');
    expect(toggleBtn().getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"collapsed":false}');
  });

  // ── Persistence restore on connect ──────────────────────────────────────────

  it('restores the collapsed state from localStorage on connect', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed: true }));
    await mount();

    expect(aside().classList.contains('is-collapsed')).toBe(true);
    expect(toggleBtn().getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn().getAttribute('aria-label')).toBe('Expand sidebar');
  });
});
