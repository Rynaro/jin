/**
 * RouterController — Stimulus controller for in-memory view routing (GUI-S3+).
 *
 * Manages which content section is visible and handles cross-object navigation
 * events from Today, Notes, Tasks, and Events controllers.
 *
 * Connect pattern: data-controller="router" on the <main> element.
 *
 * Targets:
 *   section  — content section elements (each has data-section-name="today|notes|...")
 *   navItem  — sidebar nav anchor elements (each has data-section="today|notes|...")
 *
 * Actions (bind via data-action in HTML):
 *   router#navigateTo        — bound to sidebar nav link click events
 *   router#handleTodayNavigate — bound to today:navigate custom events (from TodayController)
 *   router#handleNavigate    — bound to jin:navigate custom events (from Notes/Tasks/Events)
 */

import { Controller } from '@hotwired/stimulus';
import {
  navigate,
  applyRouterState,
  createInitialState,
  createInitialStateFromHash,
  type ViewKind,
  type RouterState,
} from '../lib/router';
import { initIcons } from '../lib/icons';
import { consultNavigationGuard } from '../lib/ui/navigation_guard';

export default class RouterController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = ['section', 'navItem'];

  declare sectionTargets: HTMLElement[];
  declare navItemTargets: HTMLElement[];

  // ── State ─────────────────────────────────────────────────────────────────
  private state: RouterState = createInitialState();
  /** Latest intent while a guard promise is unresolved. */
  private pendingIntent: { kind: ViewKind; detailId?: string } | null = null;
  private guardDecisionOpen = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    this.state = createInitialStateFromHash(window.location.hash);
    if (this.state.section !== 'today') this.activateSection(this.state.section);
    else this.publishCommittedSection('today');
  }

  // ── Sidebar navigation ────────────────────────────────────────────────────

  /**
   * navigateTo — handle sidebar nav link click.
   * data-action="click->router#navigateTo" on each nav <a>.
   */
  navigateTo(event: Event): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const section = target.dataset.section as ViewKind | undefined;
    if (!section) return;
    this.activateSection(section);
  }

  // ── today:navigate event (from TodayController) ───────────────────────────

  /**
   * handleTodayNavigate — handles `today:navigate` events dispatched by TodayController.
   * data-action="today:navigate->router#handleTodayNavigate" on <main>.
   *
   * Event detail: { section: 'tasks' | 'notes', id: string }
   */
  handleTodayNavigate(event: Event): void {
    const ce = event as CustomEvent<{ section: string; id: string }>;
    if (!ce.detail) return;
    const { section, id } = ce.detail;
    if (section === 'tasks' || section === 'notes') {
      this.activateSection(section, id);
    }
  }

  // ── jin:navigate event (from Notes/Tasks/Events controllers) ──────────────

  /**
   * handleNavigate — handles `jin:navigate` events from Notes/Tasks/Events controllers.
   * data-action="jin:navigate->router#handleNavigate" on <main>.
   *
   * Event detail: { kind: ViewKind, id: string }
   */
  handleNavigate(event: Event): void {
    const ce = event as CustomEvent<{ kind: string; id: string }>;
    if (!ce.detail) return;
    const { kind, id } = ce.detail;
    const validKinds: ViewKind[] = ['today', 'notes', 'tasks', 'events', 'notifications', 'settings'];
    if (validKinds.includes(kind as ViewKind)) {
      this.activateSection(kind as ViewKind, id);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private activateSection(kind: ViewKind, detailId?: string): void {
    const intent = { kind, detailId };
    const decision = consultNavigationGuard(intent);

    if (decision === true) {
      this.commitActivation(kind, detailId);
      return;
    }
    if (decision === false) {
      return;
    }

    // Promise: pause; remember the latest intent if another navigation arrives.
    this.pendingIntent = intent;
    if (this.guardDecisionOpen) return;
    this.guardDecisionOpen = true;
    Promise.resolve(decision).then((ok) => {
      this.guardDecisionOpen = false;
      const latest = this.pendingIntent;
      this.pendingIntent = null;
      if (ok && latest) this.commitActivation(latest.kind, latest.detailId);
    });
  }

  private commitActivation(kind: ViewKind, detailId?: string): void {
    this.state = navigate(kind, detailId);

    const sectionsMap = this.buildSectionsMap();
    applyRouterState(this.state, sectionsMap, this.navItemTargets);
    this.publishCommittedSection(kind);

    const targetSection = sectionsMap.get(kind);
    targetSection?.dispatchEvent(
      new CustomEvent('jin:section-activated', {
        bubbles: false,
        detail: { id: detailId ?? null },
      }),
    );

    // If there's a detail to open, fire jin:open-detail on the target section element
    if (detailId) {
      if (targetSection) {
        targetSection.dispatchEvent(
          new CustomEvent('jin:open-detail', {
            bubbles: false,
            detail: { id: detailId },
          })
        );
      }
    }

    // Re-initialize icons in the newly-visible section
    initIcons();
  }

  private publishCommittedSection(kind: ViewKind): void {
    (this.element as HTMLElement).dataset.activeSection = kind;
    window.dispatchEvent(new CustomEvent('jin:route-committed', { detail: { section: kind } }));
  }

  private buildSectionsMap(): Map<string, HTMLElement> {
    const map = new Map<string, HTMLElement>();
    for (const el of this.sectionTargets) {
      const name = el.dataset.sectionName;
      if (name) map.set(name, el);
    }
    return map;
  }
}
