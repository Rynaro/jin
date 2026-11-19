/** One navigation coordinator; contextual roots stay inside their route controllers. */
import { Controller } from '@hotwired/stimulus';
import { loadSidebarPrefs, saveSidebarPrefs } from '../lib/sidebar/state';
import { updateSidebarUtilities } from '../lib/sidebar/utilities';

type Section = 'today' | 'notes' | 'tasks' | 'events' | 'notifications' | 'settings';
const SECTION_LABEL: Record<Section, string> = {
  today: 'Today', notes: 'Notes', tasks: 'Tasks', events: 'Calendar',
  notifications: 'Notifications', settings: 'Settings',
};
const CONTEXT_SECTIONS = new Set<Section>(['notes', 'tasks', 'events', 'settings']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default class SidebarController extends Controller {
  static targets = ['root', 'toggle', 'reveal', 'routes', 'backdrop'];
  declare readonly rootTarget: HTMLElement;
  declare readonly toggleTarget: HTMLButtonElement;
  declare readonly revealTarget: HTMLButtonElement;
  declare readonly routesTarget: HTMLElement;

  private expanded = true;
  private drawerOpen = false;
  private presentation: 'desktop' | 'drawer' = 'desktop';
  private activeSection: Section = 'today';
  private resizeObserver: ResizeObserver | null = null;
  private rootObserver: MutationObserver | null = null;
  private headerObserver: ResizeObserver | null = null;
  private returnFocus: HTMLElement | null = null;
  private syncRevision = 0;

  connect(): void {
    const shell = this.element as HTMLElement;
    this.expanded = loadSidebarPrefs().expanded;
    this.activeSection = this.sectionFrom(shell.dataset.activeSection);
    this.updatePresentation();
    this.sync();
    window.addEventListener('resize', this.updatePresentation);
    document.addEventListener('keydown', this.onDocumentKeydown, true);
    document.addEventListener('click', this.onSkipClick, true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.updatePresentation);
      this.resizeObserver.observe(shell);
      this.headerObserver = new ResizeObserver(this.updateHeaderGeometry);
      for (const part of [this.rootTarget.querySelector('.jin-sidebar-header'), this.rootTarget.querySelector('.jin-sidebar-actions'), this.routesTarget]) {
        if (part) this.headerObserver.observe(part);
      }
    }
    this.rootObserver = new MutationObserver(this.updatePresentation);
    this.rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-scale'] });
    this.updateHeaderGeometry();
    this.updateUtilityLabels();
    window.addEventListener('jin:event-locale-changed', this.updateUtilityLabels);
  }

  disconnect(): void {
    window.removeEventListener('resize', this.updatePresentation);
    window.removeEventListener('jin:event-locale-changed', this.updateUtilityLabels);
    document.removeEventListener('keydown', this.onDocumentKeydown, true);
    document.removeEventListener('click', this.onSkipClick, true);
    this.resizeObserver?.disconnect();
    this.headerObserver?.disconnect();
    this.rootObserver?.disconnect();
    this.restoreInert();
  }

  /** Router sends this only after a navigation guard accepts the route. */
  routeCommitted(event: Event): void {
    const next = this.sectionFrom((event as CustomEvent<{ section: string }>).detail?.section);
    const priorContext = this.contextFor(this.activeSection);
    const focusInNavigation = this.navigationContainsFocus();
    const focusInPriorContext = !!priorContext?.contains(document.activeElement);
    this.activeSection = next;
    (this.element as HTMLElement).dataset.activeSection = next;
    if (this.presentation === 'drawer') this.drawerOpen = false;
    this.sync();
    if (focusInNavigation && this.presentation === 'drawer') {
      this.focusAfterReconcile(this.revealTarget, true);
    } else if (focusInPriorContext) {
      const destination = this.rootTarget.querySelector<HTMLElement>(`[data-section="${next}"]`);
      if (destination) this.focusAfterReconcile(destination, true);
    }
  }

  toggle(): void {
    if (this.presentation === 'drawer') {
      this.drawerOpen ? this.hide() : this.show();
      return;
    }
    this.expanded ? this.hide() : this.show();
  }

  selectionCommitted(): void {
    if (this.presentation === 'drawer' && this.drawerOpen) {
      this.hide();
      this.focusAfterReconcile(this.revealTarget, true);
    }
  }

  show(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : this.revealTarget;
    if (this.presentation === 'drawer') this.drawerOpen = true;
    else {
      this.expanded = true;
      saveSidebarPrefs({ version: 2, expanded: true });
    }
    this.sync();
    this.toggleTarget.focus({ preventScroll: true });
  }

  hide(): void {
    const focusInNavigation = this.navigationContainsFocus();
    if (this.presentation === 'drawer') this.drawerOpen = false;
    else {
      this.expanded = false;
      saveSidebarPrefs({ version: 2, expanded: false });
    }
    const returnTarget = this.presentation === 'drawer' && this.returnFocus?.isConnected
      ? this.returnFocus : this.revealTarget;
    this.returnFocus = null;
    this.sync();
    if (focusInNavigation) this.focusAfterReconcile(returnTarget, true);
  }

  private readonly updatePresentation = (): void => {
    const shell = this.element as HTMLElement;
    const width = shell.getBoundingClientRect().width || window.innerWidth;
    const next: 'desktop' | 'drawer' = width < 960 || document.documentElement.dataset.textScale === 'accessibility'
      ? 'drawer' : 'desktop';
    if (next === this.presentation && shell.dataset.navPresentation === next) return;
    const focusInNavigation = this.navigationContainsFocus();
    this.presentation = next;
    this.drawerOpen = false;
    this.sync();
    if (focusInNavigation) {
      this.focusAfterReconcile(next === 'drawer' || !this.expanded ? this.revealTarget : this.toggleTarget, true);
    }
  };

  private sync(): void {
    this.syncRevision += 1;
    const shell = this.element as HTMLElement;
    const visible = this.presentation === 'desktop' ? this.expanded : this.drawerOpen;
    shell.dataset.navPresentation = this.presentation;
    shell.dataset.navVisible = String(visible);
    shell.dataset.activeSection = this.activeSection;
    this.toggleTarget.setAttribute('aria-expanded', String(visible));
    this.toggleTarget.setAttribute('aria-label', this.presentation === 'drawer' ? 'Close navigation' : 'Hide navigation');
    this.rootTarget.toggleAttribute('inert', !visible);
    this.rootTarget.setAttribute('aria-hidden', String(!visible));
    this.revealTarget.setAttribute('aria-expanded', String(visible));
    this.routesTarget.toggleAttribute('inert', !visible);
    const context = this.contextFor(this.activeSection);
    for (const item of shell.querySelectorAll<HTMLElement>('[data-sidebar-context]')) {
      item.toggleAttribute('inert', item !== context || !visible);
    }
    this.syncWorkingContent();
    this.updateHeaderGeometry();
  }

  private readonly updateUtilityLabels = (): void => {
    updateSidebarUtilities(this.rootTarget);
  };

  private readonly updateHeaderGeometry = (): void => {
    const shell = this.element as HTMLElement;
    const shellBounds = shell.getBoundingClientRect();
    const top = Math.ceil(this.routesTarget.getBoundingClientRect().bottom - shellBounds.top);
    if (top > 0) shell.style.setProperty('--sidebar-body-top', `${top}px`);
    shell.style.setProperty('--sidebar-body-bottom', '0px');
  };

  private syncWorkingContent(): void {
    const shell = this.element as HTMLElement;
    const trap = this.presentation === 'drawer' && this.drawerOpen;
    const section = shell.querySelector<HTMLElement>(`[data-section-name="${this.activeSection}"]`);
    if (!section) return;
    if (CONTEXT_SECTIONS.has(this.activeSection)) {
      for (const pane of section.querySelectorAll<HTMLElement>('[data-sidebar-workspace]')) {
        pane.toggleAttribute('inert', trap);
      }
    } else section.toggleAttribute('inert', trap);
  }

  private restoreInert(): void {
    const shell = this.element as HTMLElement;
    for (const item of shell.querySelectorAll<HTMLElement>('[data-sidebar-context], [data-sidebar-workspace], [data-section-name], .jin-sidebar, .jin-nav')) {
      item.removeAttribute('inert');
    }
  }

  private contextFor(section: Section): HTMLElement | null {
    return this.element.querySelector<HTMLElement>(`[data-sidebar-context="${section}"]`);
  }

  private focusAfterReconcile(target: HTMLElement, force = false): void {
    const revision = this.syncRevision;
    const focus = (immediate: boolean): void => {
      if (revision !== this.syncRevision) return;
      if (!target.isConnected) return;
      const active = document.activeElement;
      if ((immediate && force) || active === document.body || active === document.documentElement || this.navigationContainsFocus()) {
        target.focus({ preventScroll: true });
      }
    };
    focus(true);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => focus(false));
    else queueMicrotask(() => focus(false));
  }

  private sectionFrom(value: string | undefined): Section {
    return value && value in SECTION_LABEL ? value as Section : 'today';
  }

  private navigationContainsFocus(): boolean {
    const focus = document.activeElement;
    return this.rootTarget.contains(focus) || !!this.contextFor(this.activeSection)?.contains(focus);
  }

  private readonly onSkipClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || !event.target.closest('.skip-to-content[href="#main-content"]')) return;
    const section = this.element.querySelector<HTMLElement>(`[data-section-name="${this.activeSection}"]`);
    if (!section) return; // Keep the anchor's ordinary fallback if no route is mounted.
    const workspace = Array.from(section.querySelectorAll<HTMLElement>('[data-sidebar-workspace]'))
      .find((pane) => !pane.hidden && !pane.classList.contains('hidden') && getComputedStyle(pane).display !== 'none');
    const destination = workspace ?? section;
    event.preventDefault();
    if (this.presentation === 'drawer' && this.drawerOpen) this.hide();
    destination.tabIndex = -1;
    destination.focus();
  };

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      if (document.querySelector('.folder-row__menu:not([hidden]), .lists-rail__menu:not([hidden]), .notes-collection-menu:not([hidden])')) return;
      if (this.presentation === 'drawer' && this.drawerOpen) {
        event.preventDefault();
        this.hide();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const drawerTrap = this.presentation === 'drawer' && this.drawerOpen;
    if (!drawerTrap && !this.navigationContainsFocus()) return;
    const primary = Array.from(this.rootTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const context = Array.from(this.contextFor(this.activeSection)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const items = [...primary, ...context]
      .filter(item => !item.closest('[inert], [hidden], .hidden, dialog:not([open])') && getComputedStyle(item).display !== 'none'
        && getComputedStyle(item).visibility === 'visible');
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      if (drawerTrap) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0].focus();
      }
      return;
    }
    const next = current + (event.shiftKey ? -1 : 1);
    if (!drawerTrap && (next < 0 || next >= items.length)) return;
    event.preventDefault();
    items[(next + items.length) % items.length].focus();
  };
}
