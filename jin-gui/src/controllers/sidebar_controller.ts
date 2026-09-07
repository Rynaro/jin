/**
 * SidebarController — collapses the app sidebar to an icon-only rail.
 *
 * When collapsed, the wordmark, nav labels, and capture label are hidden and
 * each item shows a hover/focus tooltip (CSS, gated on .is-collapsed). The
 * collapsed state persists in localStorage via lib/sidebar/state.ts so it
 * survives app restarts.
 *
 * Wiring (in index.html):
 *   <aside class="jin-sidebar" data-controller="sidebar"> … </aside>
 *   <button data-sidebar-target="toggle" data-action="click->sidebar#toggle">
 *
 * The controller element IS the <aside>, so this.element carries the
 * .jin-sidebar / .is-collapsed class the CSS keys off.
 */

import { Controller } from '@hotwired/stimulus';
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
  applySidebarCollapsed,
} from '../lib/sidebar/state';

export default class SidebarController extends Controller {
  static targets = ['toggle'];

  declare readonly toggleTarget: HTMLElement;
  declare readonly hasToggleTarget: boolean;

  private collapsed = false;

  connect(): void {
    const el = this.element as HTMLElement;
    this.collapsed = loadSidebarPrefs().collapsed;
    applySidebarCollapsed(el, this.collapsed, this.toggleEl);

    // Enable the width animation only AFTER the initial (possibly collapsed)
    // state has painted, so a persisted-collapsed sidebar does not animate
    // open→closed on every launch. Subsequent toggles animate.
    const enable = (): void => el.classList.add('sidebar-animated');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(enable));
    } else {
      enable();
    }
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    applySidebarCollapsed(this.element as HTMLElement, this.collapsed, this.toggleEl);
    saveSidebarPrefs({ collapsed: this.collapsed });
  }

  private get toggleEl(): HTMLElement | null {
    return this.hasToggleTarget ? this.toggleTarget : null;
  }
}
