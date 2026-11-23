// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Application, defaultSchema } from '@hotwired/stimulus';
import SidebarController from '../controllers/sidebar_controller';
import { SIDEBAR_STORAGE_KEY } from '../lib/sidebar/state';
import { updateSidebarUtilities } from '../lib/sidebar/utilities';
import { saveEventLocalePreference } from '../lib/events/locale';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = INDEX_HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const originalWidth = window.innerWidth;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const shell = () => document.querySelector<HTMLElement>('.jin-shell')!;
const sidebar = () => document.querySelector<HTMLElement>('[data-sidebar-target="root"]')!;
const reveal = () => document.querySelector<HTMLButtonElement>('[data-sidebar-target="reveal"]')!;
const contextReveal = () => document.querySelector<HTMLButtonElement>('[data-sidebar-target="contextReveal"]')!;
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
    for (const route of ['notes', 'tasks', 'events', 'settings']) {
      const context = document.querySelector(`[data-sidebar-context="${route}"]`)!;
      expect(context.closest(`[data-section-name="${route}"]`)).toBeTruthy();
    }
    expect(sidebar().contains(document.querySelector('[data-sidebar-context="notes"]'))).toBe(false);
    expect(shell().dataset.navPresentation).toBe('desktop');
    expect(shell().dataset.navVisible).toBe('true');
  });

  it('keeps each primary route and utility reachable without a section chooser', async () => {
    await mount();
    expect(Array.from(sidebar().querySelectorAll('[data-section]'),
      item => item.getAttribute('data-section'))).toEqual([
      'notifications', 'settings', 'today', 'tasks', 'notes', 'events',
    ]);
    expect(document.querySelector('[data-sidebar-target="switcher"]')).toBeNull();
    for (const route of ['today', 'tasks', 'notes', 'events', 'notifications', 'settings']) {
      window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: route } }));
      for (const link of sidebar().querySelectorAll<HTMLElement>('[data-section]')) {
        expect(link.closest('[inert]')).toBeNull();
      }
      expect(document.querySelector('.jin-nav')?.hasAttribute('inert')).toBe(false);
    }
    expect(sidebar().querySelector('[data-section="events"]')?.getAttribute('aria-label')).toBe('Calendar');
  });

  it('keeps one notification link and settings link beside the brand with the live badge hooks', async () => {
    await mount();
    const header = sidebar().querySelector('.jin-sidebar-header')!;
    const notification = header.querySelector<HTMLAnchorElement>('[data-notifications-nav]')!;
    const settings = header.querySelector<HTMLAnchorElement>('[data-section="settings"]')!;
    expect(notification.getAttribute('href')).toBe('#notifications');
    expect(settings.getAttribute('href')).toBe('#settings');
    expect(notification.querySelector('[data-notifications-badge]')).toBeTruthy();
    expect(sidebar().querySelectorAll('[data-section="notifications"]')).toHaveLength(1);
    expect(sidebar().querySelectorAll('[data-section="settings"]')).toHaveLength(1);
    expect(header.querySelector('[data-sidebar-target="toggle"]')).toBe(toggle());
    expect(shell().style.getPropertyValue('--sidebar-body-bottom')).toBe('0px');
  });

  it('commits either header utility through the same drawer navigation lifecycle', async () => {
    await mount(760);
    for (const section of ['notifications', 'settings']) {
      reveal().click();
      const link = sidebar().querySelector<HTMLAnchorElement>(`[data-section="${section}"]`)!;
      link.focus();
      link.click();
      expect(shell().dataset.navVisible).toBe('true');
      window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section } }));
      expect(shell().dataset.activeSection).toBe(section);
      expect(shell().dataset.navVisible).toBe('false');
      expect(document.activeElement).toBe(reveal());
    }
  });

  it('updates utility names in Portuguese without losing the live unread count', async () => {
    await mount();
    updateSidebarUtilities(sidebar(), 4);
    saveEventLocalePreference('pt-BR');
    const notification = sidebar().querySelector('[data-notifications-nav]')!;
    expect(notification.getAttribute('aria-label')).toBe('Notificações, 4 não lidas');
    expect(notification.getAttribute('title')).toBe('4 notificações não lidas');
    expect(sidebar().querySelector('[data-section="settings"]')?.getAttribute('aria-label')).toBe('Ajustes');
    updateSidebarUtilities(sidebar(), 1);
    expect(notification.getAttribute('aria-label')).toBe('Notificações, 1 não lida');
    updateSidebarUtilities(sidebar(), 120);
    expect(notification.querySelector('[data-notifications-badge]')?.textContent).toBe('99+');
    expect(notification.getAttribute('title')).toBe('120 notificações não lidas');
    saveEventLocalePreference('en');
    expect(notification.getAttribute('aria-label')).toBe('Notifications, 120 unread');
    updateSidebarUtilities(sidebar(), 0);
    expect(notification.querySelector('[data-notifications-badge]')?.hasAttribute('hidden')).toBe(true);
  });

  it('changes context only when the router publishes an accepted commit', async () => {
    await mount();
    document.querySelector<HTMLElement>('[data-section="notes"]')!.click();
    expect(shell().dataset.activeSection).toBe('today');
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notes' } }));
    expect(shell().dataset.activeSection).toBe('notes');
    expect(document.querySelector('[data-sidebar-context="notes"]')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.jin-nav')?.hasAttribute('inert')).toBe(false);
  });

  it('preserves the chosen destination focus after an accepted desktop route', async () => {
    await mount();
    const destination = sidebar().querySelector<HTMLAnchorElement>('[data-section="notes"]')!;
    destination.focus();
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notes' } }));
    expect(document.activeElement).toBe(destination);
  });

  it('wraps keyboard focus through the persistent routes and utilities in the drawer', async () => {
    await mount(760);
    shell().hidden = false;
    reveal().click();
    const last = sidebar().querySelector<HTMLAnchorElement>('[data-section="settings"]')!;
    toggle().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(toggle());
  });

  it('keeps Capture, Review captures, and Find ahead of direct routes in every rail state', async () => {
    await mount();
    const primaryBlocks = () => Array.from(sidebar().children)
      .filter((element) => element.matches('.jin-sidebar-actions, .jin-nav'))
      .map((element) => element.className);
    expect(primaryBlocks()).toEqual([
      expect.stringContaining('jin-sidebar-actions'), expect.stringContaining('jin-nav'),
    ]);
    expect(sidebar().querySelector('.jin-sidebar-header > .jin-sidebar-utilities')).toBeTruthy();
    toggle().click();
    expect(shell().dataset.navVisible).toBe('false');
    expect(sidebar().hasAttribute('inert')).toBe(false);
    expect(sidebar().querySelector('[data-section="tasks"]')?.closest('[inert]')).toBeNull();
    expect(sidebar().querySelector('.jin-capture-btn')?.closest('[inert]')).toBeNull();
    expect(sidebar().querySelector('.jin-find-trigger')?.closest('[inert]')).toBeNull();
    expect(primaryBlocks()).toEqual([
      expect.stringContaining('jin-sidebar-actions'), expect.stringContaining('jin-nav'),
    ]);
    expect(sidebar().lastElementChild?.classList.contains('jin-sidebar-utilities')).toBe(true);
    expect(toggle().getAttribute('title')).toBe('Expand navigation');
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"version":2,"expanded":false}');
    toggle().click();
    expect(shell().dataset.navVisible).toBe('true');
    expect(primaryBlocks()).toEqual([
      expect.stringContaining('jin-sidebar-actions'), expect.stringContaining('jin-nav'),
    ]);
    expect(sidebar().querySelector('.jin-sidebar-header > .jin-sidebar-utilities')).toBeTruthy();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"version":2,"expanded":true}');
  });

  it('imports the old collapsed preference into the compact route rail', async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"collapsed":true}');
    await mount();
    expect(shell().dataset.navVisible).toBe('false');
    expect(sidebar().hasAttribute('inert')).toBe(false);
    expect(sidebar().querySelector('[data-section="notes"]')?.closest('[inert]')).toBeNull();
  });

  it('opens and closes the active context as a temporary compact-rail flyout', async () => {
    await mount();
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'tasks' } }));
    toggle().click();
    expect(contextReveal().hidden).toBe(false);
    expect(contextReveal().parentElement?.classList.contains('tasks-context-trigger-host')).toBe(true);
    expect(contextReveal().getAttribute('aria-label')).toBe('Task lists');
    contextReveal().click();
    expect(shell().dataset.navVisible).toBe('false');
    expect(shell().dataset.contextVisible).toBe('true');
    expect(document.querySelector('[data-sidebar-context="tasks"]')?.hasAttribute('inert')).toBe(false);
    expect(contextReveal().getAttribute('aria-expanded')).toBe('true');
    contextReveal().click();
    expect(shell().dataset.contextVisible).toBe('false');
    expect(contextReveal().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(contextReveal());
    contextReveal().click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(shell().dataset.contextVisible).toBe('false');
    contextReveal().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(shell().dataset.contextVisible).toBe('false');
    expect(document.activeElement).toBe(contextReveal());
  });

  it('does not render a generic context action for Today or Notifications', async () => {
    await mount();
    toggle().click();
    expect(contextReveal().hidden).toBe(true);
    expect(contextReveal().parentElement?.matches('[data-sidebar-target="contextSlot"]')).toBe(true);
    expect(document.querySelector('.jin-content-navigation [data-sidebar-target="contextReveal"]')).toBeNull();
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'notifications' } }));
    expect(contextReveal().hidden).toBe(true);
    expect(shell().dataset.contextVisible).toBe('false');
  });

  it('places the Settings categories disclosure beside Settings in the compact utilities', async () => {
    await mount();
    toggle().click();
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'settings' } }));
    expect(contextReveal().getAttribute('aria-label')).toBe('Settings categories');
    expect(contextReveal().parentElement?.classList.contains('settings-context-trigger-host')).toBe(true);
  });

  it('uses the event locale for the Calendar disclosure', async () => {
    await mount();
    saveEventLocalePreference('pt-BR');
    window.dispatchEvent(new Event('jin:event-locale-changed'));
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'events' } }));
    toggle().click();
    expect(contextReveal().textContent).toContain('Calendários');
    expect(contextReveal().getAttribute('aria-label')).toBe('Calendários');
  });

  it('uses one transient drawer below 960px and returns focus after selection', async () => {
    await mount(760);
    expect(shell().dataset.navPresentation).toBe('drawer');
    expect(shell().dataset.navVisible).toBe('false');
    reveal().focus();
    reveal().click();
    expect(shell().dataset.navVisible).toBe('true');
    expect(document.activeElement).toBe(toggle());
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

  it('traps the Events drawer and skips to its visible workspace', async () => {
    await mount(959);
    shell().hidden = false;
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: 'events' } }));
    document.querySelector<HTMLElement>('[data-section-name="events"]')!.classList.remove('hidden');
    reveal().click();
    expect(document.querySelector('[data-sidebar-context="events"]')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('[data-section-name="events"] .calendar-workspace')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('[data-section-name="events"] .events-detail-pane')?.hasAttribute('inert')).toBe(true);
    document.querySelector<HTMLAnchorElement>('.skip-to-content')!.click();
    expect(document.activeElement).toBe(document.querySelector('[data-section-name="events"] .calendar-workspace'));
    expect(shell().dataset.navVisible).toBe('false');
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
    toggle().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(sidebar().contains(document.activeElement)).toBe(true);
    document.body.tabIndex = -1;
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(sidebar().querySelector('[data-section="notifications"]'));
  });
});
