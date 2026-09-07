/**
 * TodayController — Stimulus controller for the Today/Agenda hero view (GUI-S3).
 *
 * Data flow:
 *   today_agenda(date?) → AgendaDto → groupAgenda() → GroupedAgenda → renderTodayView()
 *
 * Navigation: prev/next/today buttons + date input → reload via today_agenda.
 *
 * Errors: JinErrorDto bubbles up to the sibling ErrorController (same <main>).
 *
 * Connect pattern: data-controller="today" on the <section> element.
 * Required <template> elements in the document:
 *   #tmpl-event-row  — event row shell
 *   #tmpl-prep-note  — prep-note row
 *
 * Targets:
 *   dateInput       — <input type="date"> for jump-to-date
 *   dateLabel       — <output> displaying the human-readable date
 *   allDaySection   — <section> wrapper for all-day events
 *   allDayList      — <ul> inside the all-day section
 *   timedSection    — <section> wrapper for timed events
 *   timedList       — <ul> inside the timed section
 *   emptyState      — element shown when agenda is empty
 *   loadingState    — element shown while today_agenda is in-flight
 *
 * Actions (bind via data-action in HTML):
 *   today#prevDay       — go to previous day
 *   today#nextDay       — go to next day
 *   today#goToday       — jump to current date
 *   today#dateChanged   — bound to date input's change event
 */

import { Controller } from '@hotwired/stimulus';
import { todayAgenda } from '../invoke';
import { isJinErrorDto } from '../types/error';
import {
  groupAgenda,
  prevDay,
  nextDay,
  todayIsoDate,
  formatDisplayDate,
} from '../lib/agenda/transform';
import {
  type TodayViewElements,
  type TodayTemplates,
  showLoading,
  hideLoading,
  renderTodayView,
} from '../lib/agenda/render';
import { initIcons } from '../lib/icons';

export default class TodayController extends Controller {
  // ── Targets ───────────────────────────────────────────────────────────────
  static targets = [
    'dateInput',
    'dateLabel',
    'allDaySection',
    'allDayList',
    'timedSection',
    'timedList',
    'emptyState',
    'loadingState',
  ];

  declare dateInputTarget: HTMLInputElement;
  declare dateLabelTarget: HTMLOutputElement;
  declare allDaySectionTarget: HTMLElement;
  declare allDayListTarget: HTMLElement;
  declare timedSectionTarget: HTMLElement;
  declare timedListTarget: HTMLElement;
  declare emptyStateTarget: HTMLElement;
  declare loadingStateTarget: HTMLElement;

  // ── Values ────────────────────────────────────────────────────────────────
  // dateValue: the currently-displayed date as "YYYY-MM-DD".
  // Empty string → resolved to today on first connect.
  static values = { date: String };
  declare dateValue: string;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    // Resolve active date on first connect; avoids a flash of the wrong date.
    if (!this.dateValue) {
      this.dateValue = todayIsoDate();
    }
    this.syncDateControl();
    void this.loadAgenda(this.dateValue);
  }

  // ── Date navigation actions ───────────────────────────────────────────────

  prevDay(): void {
    this.applyDate(prevDay(this.dateValue));
  }

  nextDay(): void {
    this.applyDate(nextDay(this.dateValue));
  }

  goToday(): void {
    this.applyDate(todayIsoDate());
  }

  /** dateChanged — bound to the <input type="date"> change event. */
  dateChanged(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.applyDate(input.value);
    }
  }

  /** Refresh the currently displayed day from mutation events or buttons. */
  refreshAgenda(_event?: Event): void {
    void this.loadAgenda(this.dateValue);
  }

  // ── Core load ─────────────────────────────────────────────────────────────

  /**
   * loadAgenda — invoke today_agenda, transform, and render.
   * Public for direct date loads; actions should call refreshAgenda so their
   * Event argument can never cross the typed invoke boundary as the date.
   */
  async loadAgenda(date: string): Promise<void> {
    const el = this.viewElements;
    showLoading(el);

    try {
      const dto = await todayAgenda(date);
      hideLoading(el);

      const grouped = groupAgenda(dto);
      renderTodayView(el, this.viewTemplates, grouped, (section, id) => {
        this.navigate(section, id);
      });

      // Refresh icons: newly-cloned template rows have data-lucide attrs
      // that need to be replaced with SVGs.
      initIcons();
    } catch (err: unknown) {
      hideLoading(el);

      if (isJinErrorDto(err)) {
        // Bubble to the ErrorController on the parent <main data-controller="error">.
        this.dispatch('error', { detail: err, prefix: '' });
      } else {
        // Unexpected errors: surface to console, keep the view stable.
        console.error('[TodayController] unexpected error loading agenda:', err);
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private applyDate(isoDate: string): void {
    this.dateValue = isoDate;
    this.syncDateControl();
    void this.loadAgenda(isoDate);
  }

  /** syncDateControl — keep the date input + label in sync with this.dateValue. */
  private syncDateControl(): void {
    // Sync the <input type="date"> value (YYYY-MM-DD — the input's native format)
    this.dateInputTarget.value = this.dateValue;
    // Sync the human-readable <output> label
    this.dateLabelTarget.textContent = formatDisplayDate(this.dateValue);
  }

  /** viewElements — builds the TodayViewElements map from Stimulus targets. */
  private get viewElements(): TodayViewElements {
    return {
      allDaySection: this.allDaySectionTarget,
      allDayList: this.allDayListTarget,
      timedSection: this.timedSectionTarget,
      timedList: this.timedListTarget,
      emptyState: this.emptyStateTarget,
      loadingState: this.loadingStateTarget,
    };
  }

  /** viewTemplates — resolves the document-level <template> elements by id. */
  private get viewTemplates(): TodayTemplates {
    const eventRowEl = document.getElementById('tmpl-event-row') as HTMLTemplateElement | null;
    const prepNoteEl = document.getElementById('tmpl-prep-note') as HTMLTemplateElement | null;
    if (!eventRowEl || !prepNoteEl) {
      throw new Error(
        '[TodayController] required <template> elements not found. ' +
          'Ensure #tmpl-event-row and #tmpl-prep-note are present in the document.'
      );
    }
    return { eventRow: eventRowEl, prepNote: prepNoteEl };
  }

  /**
   * navigate — dispatch a custom navigation event that the shell router
   * (GUI-S2) can listen for to push the detail view.
   *
   * Event name: "today:navigate"
   * Event detail: { section: "tasks" | "notes", id: string }
   */
  private navigate(section: 'tasks' | 'notes', id: string): void {
    this.dispatch('navigate', {
      detail: { section, id },
      prefix: 'today',
      bubbles: true,
    });
  }
}
