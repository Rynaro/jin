/** One navigation coordinator; contextual roots stay inside their route controllers. */
import { Controller } from '@hotwired/stimulus';
import { loadSidebarPrefs, saveSidebarPrefs } from '../lib/sidebar/state';
import { updateSidebarUtilities } from '../lib/sidebar/utilities';
import { eventMessage } from '../lib/events/locale';

type Section = 'today' | 'notes' | 'tasks' | 'events' | 'notifications' | 'settings';
const SECTION_LABEL: Record<Section, string> = {
  today: 'Today', notes: 'Notes', tasks: 'Tasks', events: 'Calendar',
  notifications: 'Notifications', settings: 'Settings',
};
const SECTION_CONTEXT_LABEL: Partial<Record<Section, string>> = {
  notes: 'Folders', tasks: 'Task lists', events: 'Calendars', settings: 'Settings categories',
};
const CONTEXT_SECTIONS = new Set<Section>(['notes', 'tasks', 'events', 'settings']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default class SidebarController extends Controller {
  static targets = ['root', 'toggle', 'reveal', 'contextReveal', 'contextSlot', 'routes', 'backdrop'];
  declare readonly rootTarget: HTMLElement;
  declare readonly toggleTarget: HTMLButtonElement;
  declare readonly revealTarget: HTMLButtonElement;
  declare readonly contextRevealTarget: HTMLButtonElement;
  declare readonly contextSlotTarget: HTMLElement;
  declare readonly routesTarget: HTMLElement;

  private expanded = true;
  private drawerOpen = false;
  private contextOpen = false;
  private compactLayout = false;
  private presentation: 'desktop' | 'drawer' = 'desktop';
  private activeSection: Section = 'today';
  private contextTrigger!: HTMLButtonElement;
  private resizeObserver: ResizeObserver | null = null;
  private rootObserver: MutationObserver | null = null;
  private headerObserver: ResizeObserver | null = null;
  private contextObserver: ResizeObserver | null = null;
  private contextAnchorObserver: MutationObserver | null = null;
  private taskDetailObserver: MutationObserver | null = null;
  private contextAnchorFrame: number | null = null;
  private returnFocus: HTMLElement | null = null;
  private syncRevision = 0;

  connect(): void {
    const shell = this.element as HTMLElement;
    this.contextTrigger = this.contextRevealTarget;
    this.expanded = loadSidebarPrefs().expanded;
    this.activeSection = this.sectionFrom(shell.dataset.activeSection);
    this.updatePresentation();
    this.sync();
    window.addEventListener('resize', this.updatePresentation);
    document.addEventListener('keydown', this.onDocumentKeydown, true);
    document.addEventListener('click', this.onSkipClick, true);
    document.addEventListener('pointerdown', this.onContextPointerDown, true);
    this.rootTarget.addEventListener('scroll', this.updateContextGeometry, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.updatePresentation);
      this.resizeObserver.observe(shell);
      this.headerObserver = new ResizeObserver(this.updateHeaderGeometry);
      for (const part of [this.rootTarget.querySelector('.jin-sidebar-header'), this.rootTarget.querySelector('.jin-sidebar-actions'), this.routesTarget]) {
        if (part) this.headerObserver.observe(part);
      }
      this.contextObserver = new ResizeObserver(this.updateContextGeometry);
      for (const context of shell.querySelectorAll<HTMLElement>('[data-sidebar-context]')) this.contextObserver.observe(context);
    }
    this.rootObserver = new MutationObserver(this.updatePresentation);
    this.rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-scale'] });
    this.updateHeaderGeometry();
    this.updateUtilityLabels();
    window.addEventListener('jin:event-locale-changed', this.updateUtilityLabels);
    window.addEventListener('jin:calendar-header-rendered', this.onCalendarHeaderRendered);
  }

  disconnect(): void {
    window.removeEventListener('resize', this.updatePresentation);
    window.removeEventListener('jin:event-locale-changed', this.updateUtilityLabels);
    window.removeEventListener('jin:calendar-header-rendered', this.onCalendarHeaderRendered);
    document.removeEventListener('keydown', this.onDocumentKeydown, true);
    document.removeEventListener('click', this.onSkipClick, true);
    document.removeEventListener('pointerdown', this.onContextPointerDown, true);
    this.rootTarget.removeEventListener('scroll', this.updateContextGeometry);
    this.resizeObserver?.disconnect();
    this.headerObserver?.disconnect();
    this.contextObserver?.disconnect();
    this.contextAnchorObserver?.disconnect();
    this.taskDetailObserver?.disconnect();
    if (this.contextAnchorFrame !== null) cancelAnimationFrame(this.contextAnchorFrame);
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
    this.contextOpen = false;
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
    } else if (this.presentation === 'desktop' && this.contextOpen) {
      this.closeContext(true);
    }
  }

  show(): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : this.revealTarget;
    if (this.presentation === 'drawer') this.drawerOpen = true;
    else {
      this.expanded = true;
      this.contextOpen = false;
      saveSidebarPrefs({ version: 2, expanded: true });
    }
    this.sync();
    this.toggleTarget.focus({ preventScroll: true });
  }

  /** Toggle the active route's existing context from the compact desktop rail. */
  showContext(): void {
    if (this.presentation !== 'desktop' || this.expanded) return;
    if (this.contextOpen) {
      this.closeContext(true);
      return;
    }
    this.contextOpen = true;
    this.sync();
    const context = this.contextFor(this.activeSection);
    const firstControl = context?.querySelector<HTMLElement>(FOCUSABLE);
    this.focusAfterReconcile(firstControl ?? this.toggleTarget, true);
  }

  backdropClick(): void {
    if (this.presentation === 'desktop' && this.contextOpen) {
      this.closeContext(true);
      return;
    }
    this.hide();
  }

  private readonly onContextPointerDown = (event: PointerEvent): void => {
    if (!this.contextOpen || !(event.target instanceof Node)) return;
    const context = this.contextFor(this.activeSection);
    if (context?.contains(event.target) || this.contextTrigger.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('[data-router-target="navItem"]')) return;
    this.closeContext(false);
  };

  hide(): void {
    const focusInNavigation = this.navigationContainsFocus();
    const compact = this.presentation === 'desktop';
    if (this.presentation === 'drawer') this.drawerOpen = false;
    else {
      this.expanded = false;
      saveSidebarPrefs({ version: 2, expanded: false });
    }
    this.contextOpen = false;
    const returnTarget = this.presentation === 'drawer' && this.returnFocus?.isConnected
      ? this.returnFocus : compact ? this.toggleTarget : this.revealTarget;
    this.returnFocus = null;
    this.sync();
    if (focusInNavigation) this.focusAfterReconcile(returnTarget, true);
  }

  private readonly updatePresentation = (): void => {
    const shell = this.element as HTMLElement;
    const width = shell.getBoundingClientRect().width || window.innerWidth;
    const next: 'desktop' | 'drawer' = width < 960 || document.documentElement.dataset.textScale === 'accessibility'
      ? 'drawer' : 'desktop';
    if (next === this.presentation && shell.dataset.navPresentation === next) {
      this.updateContextGeometry();
      return;
    }
    const focusInNavigation = this.navigationContainsFocus();
    this.presentation = next;
    this.drawerOpen = false;
    this.contextOpen = false;
    this.sync();
    if (focusInNavigation) {
      this.focusAfterReconcile(next === 'drawer' ? this.revealTarget : this.toggleTarget, true);
    }
  };

  private sync(): void {
    this.syncRevision += 1;
    const shell = this.element as HTMLElement;
    const visible = this.presentation === 'desktop' ? this.expanded : this.drawerOpen;
    const compact = this.presentation === 'desktop' && !this.expanded;
    const contextVisible = visible || (compact && this.contextOpen);
    shell.dataset.navPresentation = this.presentation;
    shell.dataset.navVisible = String(visible);
    shell.dataset.contextVisible = String(contextVisible);
    shell.dataset.activeSection = this.activeSection;
    this.toggleTarget.setAttribute('aria-expanded', String(visible));
    this.toggleTarget.setAttribute('aria-label', this.presentation === 'drawer' ? 'Close navigation' : compact ? 'Expand navigation' : 'Collapse navigation');
    this.toggleTarget.title = this.toggleTarget.getAttribute('aria-label') ?? '';
    this.rootTarget.toggleAttribute('inert', !visible && !compact);
    this.rootTarget.setAttribute('aria-hidden', String(!visible && !compact));
    this.revealTarget.setAttribute('aria-expanded', String(visible));
    this.contextSlotTarget.hidden = true;
    this.contextTrigger.hidden = !compact || !CONTEXT_SECTIONS.has(this.activeSection);
    this.contextTrigger.setAttribute('aria-expanded', String(compact && this.contextOpen));
    this.updateContextRevealLabel();
    this.updateCompactControlTitles();
    this.routesTarget.toggleAttribute('inert', !visible && !compact);
    for (const item of this.rootTarget.querySelectorAll<HTMLElement>('.jin-app-name')) {
      item.toggleAttribute('inert', compact || !visible);
    }
    const context = this.contextFor(this.activeSection);
    if (context) {
      context.id ||= `jin-context-${this.activeSection}`;
      this.contextTrigger.setAttribute('aria-controls', context.id);
    } else this.contextTrigger.removeAttribute('aria-controls');
    for (const item of shell.querySelectorAll<HTMLElement>('[data-sidebar-context]')) {
      item.toggleAttribute('inert', item !== context || !contextVisible);
    }
    this.syncCompactLayout(compact);
    this.updateContextAnchor();
    this.observeContextAnchor(compact);
    this.syncWorkingContent();
    this.updateHeaderGeometry();
    this.updateContextGeometry();
  }

  private readonly updateUtilityLabels = (): void => {
    updateSidebarUtilities(this.rootTarget);
    this.updateContextRevealLabel();
  };

  private readonly onCalendarHeaderRendered = (): void => {
    // Calendar replaces its live header for every Month, Week, and Day paint.
    // Keep the singleton available while the next frame moves it into that new host.
    if (this.presentation === 'desktop' && !this.expanded && this.activeSection === 'events') {
      this.contextTrigger.hidden = false;
    }
    this.scheduleContextAnchorUpdate();
  };

  private scheduleContextAnchorUpdate(): void {
    if (this.contextAnchorFrame !== null) cancelAnimationFrame(this.contextAnchorFrame);
    this.contextAnchorFrame = requestAnimationFrame(() => {
      this.contextAnchorFrame = null;
      this.updateContextAnchor();
      this.updateContextGeometry();
    });
  }

  private updateContextRevealLabel(): void {
    const contextLabel = this.activeSection === 'events'
      ? eventMessage('calendarsFilter')
      : SECTION_CONTEXT_LABEL[this.activeSection];
    this.contextTrigger.setAttribute('aria-label', contextLabel ?? '');
    this.contextTrigger.title = contextLabel ?? '';
    const label = this.contextTrigger.querySelector<HTMLElement>('span');
    if (label && contextLabel) label.textContent = contextLabel;
  }

  private updateCompactControlTitles(): void {
    for (const control of this.rootTarget.querySelectorAll<HTMLElement>(
      '.jin-sidebar-toggle, .jin-capture-btn, .jin-review-captures-btn, .jin-find-trigger, .jin-navigation-row',
    )) {
      const label = control.getAttribute('aria-label');
      if (label) control.title = label;
    }
  }

  private closeContext(restoreFocus: boolean): void {
    this.contextOpen = false;
    this.sync();
    if (restoreFocus) this.focusAfterReconcile(this.contextTrigger, true);
  }

  private readonly updateHeaderGeometry = (): void => {
    const shell = this.element as HTMLElement;
    const shellBounds = shell.getBoundingClientRect();
    const top = Math.ceil(this.routesTarget.getBoundingClientRect().bottom - shellBounds.top);
    if (top > 0) shell.style.setProperty('--sidebar-body-top', `${top}px`);
    shell.style.setProperty('--sidebar-body-bottom', '0px');
  };

  private readonly updateContextGeometry = (): void => {
    if (this.contextTrigger.hidden || !this.contextOpen) return;
    const context = this.contextFor(this.activeSection);
    if (!context) return;
    const bounds = this.contextTrigger.getBoundingClientRect();
    const nativeTop = document.documentElement.dataset.nativeMacosOverlay === 'true' ? 52 : 8;
    const gap = 8;
    const viewportHeight = window.innerHeight;
    const availableAbove = Math.max(0, bounds.top - nativeTop - gap);
    const availableBelow = Math.max(0, viewportHeight - bounds.bottom - gap);
    const naturalHeight = Math.max(context.scrollHeight, context.getBoundingClientRect().height);
    const openBelow = availableBelow >= naturalHeight || availableBelow >= availableAbove;
    const maxHeight = openBelow ? availableBelow : availableAbove;
    const top = openBelow
      ? Math.min(viewportHeight - gap, bounds.bottom + gap)
      : Math.max(nativeTop, bounds.top - Math.min(naturalHeight, maxHeight) - gap);
    const shell = this.element as HTMLElement;
    const compactWidth = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-compact-width')) || 56;
    const panelWidth = Math.max(236, context.getBoundingClientRect().width);
    const left = Math.max(compactWidth, Math.min(bounds.left, window.innerWidth - panelWidth - gap));
    shell.style.setProperty('--sidebar-context-top', `${Math.round(top)}px`);
    shell.style.setProperty('--sidebar-context-max-height', `${Math.max(0, Math.floor(maxHeight))}px`);
    shell.style.setProperty('--sidebar-context-left', `${Math.round(left)}px`);
  };

  private updateContextAnchor(): void {
    const compact = this.presentation === 'desktop' && !this.expanded;
    if (!compact || this.contextTrigger.hidden) {
      if (this.contextTrigger.parentElement !== this.contextSlotTarget) this.contextSlotTarget.append(this.contextTrigger);
      this.observeTaskDetailAnchor(false);
      return;
    }
    const anchor = this.contextAnchorFor(this.activeSection);
    if (anchor && this.contextTrigger.parentElement !== anchor) anchor.append(this.contextTrigger);
    this.observeTaskDetailAnchor(this.activeSection === 'tasks' && !!this.element.querySelector('.tasks-main--detail-open'));
    this.updateContextGeometry();
  }

  private contextAnchorFor(section: Section): HTMLElement | null {
    const find = (selector: string): HTMLElement | null => this.element.querySelector<HTMLElement>(selector);
    const findVisible = (selector: string): HTMLElement | null => Array.from(this.element.querySelectorAll<HTMLElement>(selector))
      .find((anchor) => !anchor.closest('.hidden, [hidden], [inert], [aria-hidden="true"]')) ?? null;
    if (section === 'notes') {
      return findVisible('[data-sidebar-context-anchor="notes-list"]')
        ?? findVisible('.notes-detail-pane:not(.hidden) [data-sidebar-context-anchor="notes-detail"]')
        ?? find('[data-sidebar-context-anchor="notes-list"]');
    }
    if (section === 'tasks') {
      return findVisible('[data-sidebar-context-anchor="tasks-list"]')
        ?? findVisible('.tasks-main--detail-open [data-sidebar-context-anchor="tasks-detail"]')
        ?? find('[data-sidebar-context-anchor="tasks-list"]');
    }
    if (section === 'events') {
      const detail = find('.events-detail-pane:not(.hidden) [data-sidebar-context-anchor="events-detail"]');
      if (detail) return detail;
      return Array.from(this.element.querySelectorAll<HTMLElement>('[data-sidebar-context-anchor="events"]'))
        .find(anchor => !anchor.closest('.hidden, [hidden]')) ?? null;
    }
    if (section === 'settings') return find('.settings-pane:not([hidden]) [data-sidebar-context-anchor="settings"]');
    return null;
  }

  private observeTaskDetailAnchor(shouldObserve: boolean): void {
    this.taskDetailObserver?.disconnect();
    this.taskDetailObserver = null;
    if (!shouldObserve) return;
    const detail = this.element.querySelector<HTMLElement>('[data-tasks-target="detailContent"]');
    if (!detail) return;
    this.taskDetailObserver = new MutationObserver(() => this.scheduleContextAnchorUpdate());
    this.taskDetailObserver.observe(detail, { childList: true });
  }

  private observeContextAnchor(compact: boolean): void {
    this.contextAnchorObserver?.disconnect();
    this.contextAnchorObserver = null;
    if (!compact || !CONTEXT_SECTIONS.has(this.activeSection)) return;
    const section = this.element.querySelector<HTMLElement>(`[data-section-name="${this.activeSection}"]`);
    if (!section) return;
    const roots = this.activeSection === 'notes'
      ? [section, section.querySelector('.notes-list-pane'), section.querySelector('.notes-detail-pane')]
      : this.activeSection === 'tasks'
        ? [section.querySelector('.tasks-main'), section.querySelector('[data-tasks-target="listPanel"]')]
        : this.activeSection === 'events'
          ? [section.querySelector('[data-events-target="detailPanel"]'), section.querySelector('[data-calendar-view-target="monthView"]'), section.querySelector('[data-calendar-view-target="dayView"]')]
          : [section.querySelector('.settings-workspace')];
    this.contextAnchorObserver = new MutationObserver(() => this.scheduleContextAnchorUpdate());
    for (const root of roots) {
      if (root instanceof HTMLElement) this.contextAnchorObserver.observe(root, { subtree: false, attributes: true, attributeFilter: ['class', 'hidden', 'inert', 'aria-hidden'] });
    }
  }

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

  private syncCompactLayout(compact: boolean): void {
    const header = this.rootTarget.querySelector<HTMLElement>('.jin-sidebar-header');
    const utilities = this.rootTarget.querySelector<HTMLElement>('.jin-sidebar-utilities');
    if (!header || !utilities) return;
    if (compact) {
      if (!this.compactLayout) this.rootTarget.append(utilities);
    } else if (this.compactLayout) {
      header.insertBefore(utilities, this.toggleTarget);
    }
    if (!compact) {
      this.contextSlotTarget.append(this.contextTrigger);
    }
    this.compactLayout = compact;
    this.updateCompactControlTitles();
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
      } else if (this.presentation === 'desktop' && this.contextOpen) {
        event.preventDefault();
        this.closeContext(true);
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
