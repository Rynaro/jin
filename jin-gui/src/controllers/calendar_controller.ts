/**
 * CalendarController — Stimulus adapter for the reusable calendar widget (P7).
 *
 * Identifier: `calendar`
 *
 * This controller is GENERIC — it imports nothing task-specific.
 * TemporalEditorController consumes the selection event as draft state. Task
 * and capture consumers open that shared editor rather than orchestrating the
 * grid or attaching their own dialog listeners.
 *
 * Config via data-calendar-*-value Stimulus values:
 *   data-calendar-selected-value  — pre-selected ISO date (YYYY-MM-DD)
 *   data-calendar-min-value       — min ISO date (inclusive)
 *   data-calendar-max-value       — max ISO date (inclusive)
 *   data-calendar-mode-value      — "single" (default); "range"/"multi" reserved
 *   data-calendar-today-value     — override for "today" (defaults to actual today)
 *
 * Events dispatched (via Stimulus dispatch → prefix "calendar:"):
 *   calendar:selected  — { detail: { iso: string, year, month (1-12), day } }
 *   calendar:cancel    — { detail: {} }
 *
 * Keyboard map (APG Date Picker Grid pattern):
 *   ←/→             ∓/± 1 day
 *   ↑/↓             ∓/± 1 week
 *   Home / End      first / last day of current week
 *   PageUp / PageDown          ∓/± 1 month
 *   Shift+PageUp / Shift+PageDown  ∓/± 1 year
 *   Enter / Space   select focused day → emit calendar:selected
 *   Esc             prevent native fall-through, then emit calendar:cancel
 *
 * Roving tabindex: exactly ONE gridcell button has tabindex=0 at any time.
 *
 * Template: #tmpl-calendar must exist in the document.
 */

import { Controller } from '@hotwired/stimulus';
import {
  buildMonthGrid,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfWeek,
  endOfWeek,
  clampToBounds,
  parseIso,
  toIso,
} from '../lib/calendar/transform';
import {
  cloneCalendarTemplate,
  setMonthLabel,
  populateGrid,
  repopulateGrid,
  moveFocusToIso,
  setWeekdayLabels,
  type CalendarWidgetRefs,
} from '../lib/calendar/render';
import { initIcons } from '../lib/icons';

export type CalendarSelection =
  | { mode: 'single'; iso: string }
  | { mode: 'range'; start: string; end: string; complete: boolean };

export interface CalendarLabels {
  today?: string;
  clear?: string;
  commit?: string;
  chooseDate?: string;
  previousMonth?: string;
  nextMonth?: string;
  previousYear?: string;
  nextYear?: string;
}

function datePart(value: string | null | undefined): string {
  const candidate = value?.slice(0, 10) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
}

export default class CalendarController extends Controller {
  // ── Stimulus values ───────────────────────────────────────────────────────
  static values = {
    selected: { type: String, default: '' },
    min: { type: String, default: '' },
    max: { type: String, default: '' },
    mode: { type: String, default: 'single' },
    today: { type: String, default: '' },
    locale: { type: String, default: '' },
    commit: { type: Boolean, default: false },
    rangeStart: { type: String, default: '' },
    rangeEnd: { type: String, default: '' },
    rangeComplete: { type: Boolean, default: false },
    labels: { type: Object, default: {} },
  };

  declare selectedValue: string;
  declare minValue: string;
  declare maxValue: string;
  declare modeValue: string;
  declare todayValue: string;
  declare localeValue: string;
  declare commitValue: boolean;
  declare rangeStartValue: string;
  declare rangeEndValue: string;
  declare rangeCompleteValue: boolean;
  declare labelsValue: CalendarLabels;

  // ── Internal state ────────────────────────────────────────────────────────

  /** Currently focused ISO date (drives roving tabindex). */
  private focusedIso: string = '';
  /** Currently selected ISO date (may differ from selectedValue mid-session). */
  private currentSelected: string = '';
  private rangeStart: string = '';
  private rangeEnd: string = '';
  private rangeComplete = false;
  private labels: CalendarLabels = {};
  private fallbackLocale = '';
  /** Displayed month/year (may differ from the selected month). */
  private displayYear: number = 0;
  private displayMonth: number = 0; // 1-12

  /** DOM refs cloned from the template. */
  private refs: CalendarWidgetRefs | null = null;

  /** Bound keydown handler (stored for removal). EventListener type required for Element.add/removeEventListener. */
  private _keyHandler: EventListener | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(): void {
    const today = this.resolveToday();
    const normalized = datePart(this.selectedValue);
    const initial = normalized || today;

    this.fallbackLocale = navigator.language || 'en';
    this.currentSelected = normalized;
    this.rangeStart = datePart(this.rangeStartValue) || normalized;
    this.rangeEnd = datePart(this.rangeEndValue) || this.rangeStart;
    if (this.rangeStart && this.rangeEnd && this.rangeStart > this.rangeEnd) {
      [this.rangeStart, this.rangeEnd] = [this.rangeEnd, this.rangeStart];
    }
    this.rangeComplete = this.rangeCompleteValue;
    this.labels = { ...this.labelsValue };
    if (this.modeValue === 'range') this.currentSelected = this.rangeStart;
    const focused = this.modeValue === 'range' && this.rangeStart ? this.rangeStart : initial;
    this.focusedIso = focused;

    const { year, month } = parseIso(focused);
    this.displayYear = year;
    this.displayMonth = month;

    this.mountTemplate();
    this.render();

    this._keyHandler = (e: Event) => this.handleKeydown(e as KeyboardEvent);
    this.element.addEventListener('keydown', this._keyHandler);
  }

  disconnect(): void {
    if (this._keyHandler) {
      this.element.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    this.refs = null;
  }

  // ── Value change callbacks ─────────────────────────────────────────────────

  selectedValueChanged(): void {
    if (!this.refs) return; // not connected yet
    const val = datePart(this.selectedValue);
    this.currentSelected = val;
    if (this.modeValue === 'range') {
      this.rangeStart = val;
      this.rangeEnd = val;
      this.rangeComplete = false;
    }
    if (val) {
      const { year, month } = parseIso(val);
      this.displayYear = year;
      this.displayMonth = month;
      this.focusedIso = val;
    }
    this.render();
  }

  localeValueChanged(): void {
    if (this.refs) this.render();
  }

  commitValueChanged(): void {
    if (this.refs) this.render();
  }

  labelsValueChanged(): void {
    this.labels = { ...this.labelsValue };
    if (this.refs) this.render();
  }

  // ── Focus management ──────────────────────────────────────────────────────

  /**
   * focusSelected — move browser focus to the selected day (or today if none).
   * Called by the consumer when the calendar dialog opens.
   */
  focusSelected(): void {
    if (!this.refs) return;
    const target = this.currentSelected || this.resolveToday();
    this.focusedIso = target;
    this.render();
    moveFocusToIso(this.refs.grid, target);
  }

  // ── Public API for consumers ───────────────────────────────────────────────

  /**
   * setInitial — programmatically set the initial selected date and navigate
   * the display to that month. Call before opening the dialog.
   */
  setInitial(iso: string | null): void {
    const today = this.resolveToday();
    const normalized = datePart(iso);
    const target = normalized || today;
    this.currentSelected = normalized;
    this.rangeStart = normalized;
    this.rangeEnd = normalized;
    this.rangeComplete = false;
    const { year, month } = parseIso(target);
    this.displayYear = year;
    this.displayMonth = month;
    this.focusedIso = target;
    if (this.refs) this.render();
  }

  /** Return the currently selected ISO date (empty string = nothing selected). */
  get currentIso(): string {
    return this.currentSelected;
  }

  /** Programmatic projection is deliberately silent. */
  setSelection(selection: CalendarSelection): void {
    if (selection.mode !== this.modeValue) return;
    if (selection.mode === 'single') {
      this.setInitial(selection.iso);
      return;
    }
    const start = datePart(selection.start);
    const end = datePart(selection.end) || start;
    this.rangeStart = start && end && start > end ? end : start;
    this.rangeEnd = start && end && start > end ? start : end;
    this.rangeComplete = selection.complete;
    this.currentSelected = this.rangeStart;
    this.focusedIso = this.rangeStart || this.resolveToday();
    const { year, month } = parseIso(this.focusedIso);
    this.displayYear = year;
    this.displayMonth = month;
    if (this.refs) this.render();
  }

  getSelection(): CalendarSelection {
    return this.selectionDetail();
  }

  setPresentation(locale: string, labels: CalendarLabels): void {
    this.localeValue = locale;
    this.labels = { ...labels };
    if (this.refs) this.render();
  }

  // ── Template mount ────────────────────────────────────────────────────────

  private mountTemplate(): void {
    const tmpl = document.getElementById('tmpl-calendar') as HTMLTemplateElement | null;
    if (!tmpl) {
      console.error('[CalendarController] #tmpl-calendar template not found');
      return;
    }

    this.element.innerHTML = '';
    const refs = cloneCalendarTemplate(tmpl);
    this.element.appendChild(refs.root);
    this.refs = refs;

    // Wire navigation buttons
    refs.prevYearBtn.addEventListener('click', () => this.navigateYear(-1));
    refs.prevMonthBtn.addEventListener('click', () => this.navigateMonth(-1));
    refs.nextMonthBtn.addEventListener('click', () => this.navigateMonth(1));
    refs.nextYearBtn.addEventListener('click', () => this.navigateYear(1));

    if (refs.todayBtn) {
      refs.todayBtn.addEventListener('click', () => this.goToToday());
    }
    if (refs.clearBtn) {
      refs.clearBtn.addEventListener('click', () => this.clearSelection());
    }
    if (refs.commitBtn) refs.commitBtn.addEventListener('click', () => this.emitCommit());

    initIcons();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.refs) return;

    const { displayYear, displayMonth, focusedIso, currentSelected } = this;
    const today = this.resolveToday();

    const locale = this.localeValue || this.fallbackLocale;
    setMonthLabel(this.refs.monthLabel, displayYear, displayMonth, locale);
    setWeekdayLabels(this.refs.weekdays, locale);
    this.applyLabels();

    const cells = buildMonthGrid(displayYear, displayMonth, {
      selected: currentSelected || undefined,
      rangeStart: this.modeValue === 'range' ? this.rangeStart || undefined : undefined,
      rangeEnd: this.modeValue === 'range' ? this.rangeEnd || undefined : undefined,
      today,
      min: this.minValue || undefined,
      max: this.maxValue || undefined,
    });

    const hasCells = this.refs.grid.querySelectorAll('[role="gridcell"]').length === 42;
    if (hasCells) {
      repopulateGrid(this.refs.grid, cells, focusedIso, (iso) => this.selectDate(iso), {
        multiselectable: this.modeValue === 'range', locale,
      });
    } else {
      populateGrid(this.refs.grid, cells, focusedIso, (iso) => this.selectDate(iso), {
        multiselectable: this.modeValue === 'range', locale,
      });
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  private selectDate(iso: string, restoreFocus = false): void {
    if (this.modeValue === 'range') {
      if (!this.rangeStart || this.rangeComplete) {
        this.rangeStart = iso;
        this.rangeEnd = iso;
        this.rangeComplete = false;
      } else {
        this.rangeEnd = iso;
        if (this.rangeEnd < this.rangeStart) [this.rangeStart, this.rangeEnd] = [this.rangeEnd, this.rangeStart];
        this.rangeComplete = true;
      }
      this.currentSelected = this.rangeStart;
    } else {
      this.currentSelected = iso;
    }
    this.focusedIso = iso;

    // Navigate display to the selected month if needed
    const { year, month } = parseIso(iso);
    this.displayYear = year;
    this.displayMonth = month;

    this.render();
    if (restoreFocus && this.refs) moveFocusToIso(this.refs.grid, iso);
    if (this.modeValue === 'single') this.emitSelected(iso);
    else this.emitChange();
  }

  private emitSelected(iso: string): void {
    const { year, month, day } = parseIso(iso);
    this.dispatch('selected', { detail: { iso, year, month, day }, bubbles: true });
  }

  private clearSelection(): void {
    this.currentSelected = '';
    this.rangeStart = '';
    this.rangeEnd = '';
    this.rangeComplete = false;
    this.focusedIso = this.resolveToday();
    const { year, month } = parseIso(this.focusedIso);
    this.displayYear = year;
    this.displayMonth = month;
    this.render();
    if (this.modeValue === 'single') {
      this.dispatch('selected', { detail: { iso: '', year: 0, month: 0, day: 0 }, bubbles: true });
    } else {
      this.emitChange();
    }
  }

  private selectionDetail(): CalendarSelection {
    return this.modeValue === 'range'
      ? { mode: 'range', start: this.rangeStart, end: this.rangeEnd, complete: this.rangeComplete }
      : { mode: 'single', iso: this.currentSelected };
  }

  private emitChange(): void {
    this.dispatch('change', { detail: this.selectionDetail(), bubbles: true });
  }

  private emitCommit(): void {
    this.dispatch('commit', { detail: this.selectionDetail(), bubbles: true });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  private navigateMonth(delta: number): void {
    const newDisplay = addMonths(
      toIso(this.displayYear, this.displayMonth, 1),
      delta
    );
    const { year, month } = parseIso(newDisplay);
    this.displayYear = year;
    this.displayMonth = month;
    // Clamp focused date to bounds without changing selected
    this.focusedIso = clampToBounds(
      addMonths(this.focusedIso, delta),
      this.minValue || undefined,
      this.maxValue || undefined
    );
    this.render();
  }

  private navigateYear(delta: number): void {
    const newDisplay = addYears(
      toIso(this.displayYear, this.displayMonth, 1),
      delta
    );
    const { year, month } = parseIso(newDisplay);
    this.displayYear = year;
    this.displayMonth = month;
    this.focusedIso = clampToBounds(
      addYears(this.focusedIso, delta),
      this.minValue || undefined,
      this.maxValue || undefined
    );
    this.render();
  }

  private goToToday(): void {
    const today = this.resolveToday();
    const { year, month } = parseIso(today);
    this.displayYear = year;
    this.displayMonth = month;
    this.focusedIso = today;
    if (this.modeValue === 'range') {
      this.rangeStart = today;
      this.rangeEnd = today;
      this.rangeComplete = false;
      this.currentSelected = today;
    }
    this.render();
    if (this.refs) moveFocusToIso(this.refs.grid, today);
    if (this.modeValue === 'range') this.emitChange();
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────

  private handleKeydown(e: KeyboardEvent): void {
    // Only intercept keys on or inside the grid
    if (!this.refs) return;
    const activeEl = document.activeElement;
    const insideGrid = this.refs.grid.contains(activeEl);
    if (!insideGrid) return;

    const { focusedIso, minValue, maxValue } = this;

    switch (e.key) {
      case 'ArrowLeft': {
        e.preventDefault();
        this.moveFocus(addDays(focusedIso, -1));
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        this.moveFocus(addDays(focusedIso, 1));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this.moveFocus(addWeeks(focusedIso, -1));
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        this.moveFocus(addWeeks(focusedIso, 1));
        break;
      }
      case 'Home': {
        e.preventDefault();
        this.moveFocus(startOfWeek(focusedIso));
        break;
      }
      case 'End': {
        e.preventDefault();
        this.moveFocus(endOfWeek(focusedIso));
        break;
      }
      case 'PageUp': {
        e.preventDefault();
        if (e.shiftKey) {
          this.moveFocus(addYears(focusedIso, -1));
        } else {
          this.moveFocus(addMonths(focusedIso, -1));
        }
        break;
      }
      case 'PageDown': {
        e.preventDefault();
        if (e.shiftKey) {
          this.moveFocus(addYears(focusedIso, 1));
        } else {
          this.moveFocus(addMonths(focusedIso, 1));
        }
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        // Find the currently focused cell's iso
        const btn = activeEl as HTMLElement;
        const iso = btn.dataset.iso;
        if (iso) {
          this.selectDate(iso, true);
        }
        break;
      }
      case 'Escape': {
        // The owning editor closes explicitly. Prevent the same keypress from
        // falling through to an underlying modal after that synchronous close.
        e.preventDefault();
        this.dispatch('cancel', { detail: {}, bubbles: true });
        break;
      }
      default:
        break;
    }

    // Suppress unused variable warning
    void minValue;
    void maxValue;
  }

  /**
   * moveFocus — update focusedIso, navigate display month if needed, re-render,
   * then physically move browser focus to the new cell.
   */
  private moveFocus(targetIso: string): void {
    const clamped = clampToBounds(
      targetIso,
      this.minValue || undefined,
      this.maxValue || undefined
    );
    this.focusedIso = clamped;

    // Auto-navigate display if the focused date is outside the displayed month
    const { year, month } = parseIso(clamped);
    if (year !== this.displayYear || month !== this.displayMonth) {
      this.displayYear = year;
      this.displayMonth = month;
    }

    this.render();
    if (this.refs) moveFocusToIso(this.refs.grid, clamped);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveToday(): string {
    if (this.todayValue) return this.todayValue;
    const d = new Date();
    return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  private applyLabels(): void {
    if (!this.refs) return;
    const { todayBtn, clearBtn, commitBtn, grid, prevMonthBtn, nextMonthBtn, prevYearBtn, nextYearBtn } = this.refs;
    if (todayBtn && this.labels.today) todayBtn.textContent = this.labels.today;
    if (clearBtn && this.labels.clear) clearBtn.textContent = this.labels.clear;
    if (commitBtn) {
      commitBtn.hidden = !this.commitValue || this.modeValue === 'single';
      if (this.labels.commit) commitBtn.textContent = this.labels.commit;
    }
    if (this.labels.chooseDate) grid.setAttribute('aria-label', this.labels.chooseDate);
    if (this.labels.previousMonth) prevMonthBtn.setAttribute('aria-label', this.labels.previousMonth);
    if (this.labels.nextMonth) nextMonthBtn.setAttribute('aria-label', this.labels.nextMonth);
    if (this.labels.previousYear) prevYearBtn.setAttribute('aria-label', this.labels.previousYear);
    if (this.labels.nextYear) nextYearBtn.setAttribute('aria-label', this.labels.nextYear);
  }
}
