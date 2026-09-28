// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import SidebarController from '../controllers/sidebar_controller';
import { SIDEBAR_STORAGE_KEY } from '../lib/sidebar/state';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = INDEX_HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const originalWidth = window.innerWidth;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const shell = () => document.querySelector<HTMLElement>('.jin-shell')!;
const sidebar = () => document.querySelector<HTMLElement>('[data-sidebar-target="root"]')!;
const switcher = () => document.querySelector<HTMLButtonElement>('[data-sidebar-target="switcher"]')!;
const reveal = () => document.querySelector<HTMLButtonElement>('[data-sidebar-target="reveal"]')!;
const toggle = () => document.querySelector<HTMLButtonElement>('[data-sidebar-target="toggle"]')!;

describe('one adaptive SidebarController', () => {
  let app: Application;

  async function mount(width = 1280): Promise<void> {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    app = Application.start(document.documentElement, defaultSchema);
    app.register('sidebar', SidebarController);
    await tick();
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = BODY;
  });

  afterEach(async () => {
    app?.stop();
    await tick();
    document.body.innerHTML = '';
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  });

  it('keeps one shared host while contextual navigation remains under route owners', async () => {
    await mount();
    expect(app.getControllerForElementAndIdentifier(shell(), 'sidebar')).toBeTruthy();
    for (const route of ['notes', 'tasks', 'settings']) {
      const context = document.querySelector(`[data-sidebar-context="${route}"]`)!;
      expect(context.closest(`[data-section-name="${route}"]`)).toBeTruthy();
    }
    expect(sidebar().contains(document.querySelector('[data-sidebar-context="notes"]'))).toBe(false);
    expect(shell().dataset.navPresentation).toBe('desktop');
    expect(shell().dataset.navVisible).toBe('true');
  });

  it('exposes all six routes through one switcher without duplicating links', async () => {
    await mount();
    expect(Array.from(document.querySelectorAll('.jin-nav-list [data-section]'),
      item => item.getAttribute('data-section'))).toEqual([
      'notifications', 'today', 'notes', 'tasks', 'events', 'settings',
    ]);
    switcher().click();
    expect(switcher().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-section="today"]')).toBe(document.activeElement);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(switcher().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(switcher());
  });

  it('changes context only when the router publishes an accepted commit', async () => {
    await mount();
    document.querySelector<HTMLElement>('[data-section="notes"]')!.click();
    expect(shell().dataset.activeSection).toBe('today');
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notes' } }));
    expect(shell().dataset.activeSection).toBe('notes');
    expect(switcher().textContent).toContain('Notes');
    expect(document.querySelector('[data-sidebar-context="notes"]')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.jin-nav')?.hasAttribute('inert')).toBe(true);
  });

  it('fully releases desktop width, persists v2 state, and leaves a reachable reopen', async () => {
    await mount();
    toggle().click();
    expect(shell().dataset.navVisible).toBe('false');
    expect(sidebar().hasAttribute('inert')).toBe(true);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"version":2,"expanded":false}');
    expect(reveal().getAttribute('aria-expanded')).toBe('false');
    reveal().click();
    expect(shell().dataset.navVisible).toBe('true');
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"version":2,"expanded":true}');
  });

  it('imports the old collapsed preference without restoring an icon strip', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"collapsed":true}');
    await mount();
    expect(shell().dataset.navVisible).toBe('false');
    expect(sidebar().classList.contains('is-collapsed')).toBe(false);
    expect(sidebar().hasAttribute('inert')).toBe(true);
    reveal().click();
    expect(shell().dataset.navVisible).toBe('true');
  });

  it('uses one transient drawer below 960px and returns focus after selection', async () => {
    await mount(760);
    expect(shell().dataset.navPresentation).toBe('drawer');
    expect(shell().dataset.navVisible).toBe('false');
    reveal().focus();
    reveal().click();
    expect(shell().dataset.navVisible).toBe('true');
    expect(document.activeElement).toBe(switcher());
    window.dispatchEvent(new CustomEvent('jin:sidebar-selection'));
    expect(shell().dataset.navVisible).toBe('false');
    expect(document.activeElement).toBe(reveal());
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it('does not close the drawer for a folder chevron or a rejected route intent', async () => {
    await mount(760);
    reveal().click();
    document.querySelector<HTMLElement>('[data-section="tasks"]')!.click();
    expect(shell().dataset.activeSection).toBe('today');
    expect(shell().dataset.navVisible).toBe('true');
    document.querySelector<HTMLElement>('.folder-row__chevron')?.click();
    expect(shell().dataset.navVisible).toBe('true');
  });

  it('lets an open folder action menu handle the first Escape before closing the drawer', async () => {
    await mount(760);
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notes' } }));
    reveal().focus();
    reveal().click();
    const menu = document.createElement('div');
    menu.className = 'folder-row__menu';
    document.querySelector('[data-sidebar-context="notes"]')!.append(menu);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shell().dataset.navVisible).toBe('true');
    menu.hidden = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shell().dataset.navVisible).toBe('false');
    expect(document.activeElement).toBe(reveal());
  });

  it('skips past route context into working content and dismisses an open drawer', async () => {
    await mount(760);
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notes' } }));
    reveal().focus();
    reveal().click();
    expect(document.querySelector('[data-sidebar-workspace]')?.hasAttribute('inert')).toBe(true);
    document.querySelector<HTMLAnchorElement>('.skip-to-content')!.click();
    expect(shell().dataset.navVisible).toBe('false');
    expect(document.activeElement).toBe(document.querySelector('[data-section-name="notes"] [data-sidebar-workspace]'));
    expect(document.activeElement?.closest('[data-sidebar-context]')).toBeNull();
  });

  it('keeps the first rapid Tab in the reopened drawer while context visibility settles', async () => {
    await mount(760);
    shell().hidden = false; // App boot normally reveals the shell.
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'settings' } }));
    document.querySelector<HTMLElement>('[data-section-name="settings"]')!.hidden = false;
    reveal().focus();
    reveal().click();
    const context = document.querySelector<HTMLElement>('[data-sidebar-context="settings"]')!;
    context.style.visibility = 'hidden';
    switcher().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(sidebar().contains(document.activeElement)).toBe(true);
    document.body.tabIndex = -1;
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(switcher());
  });
});
