/**
 * calendar/render.ts — DOM rendering functions for the calendar widget.
 *
 * Contract:
 *   - Clones #tmpl-calendar to build the initial DOM.
 *   - Populates day cells by creating elements + setting textContent / data-state
 *     / tabindex. No innerHTML string injection.
 *   - Exposes a `repopulateGrid` function to update cells in-place for fast
 *     re-renders on navigation (avoids re-cloning the full template).
 *   - Updates the month/year label via textContent.
 *
 * CalendarController is the only caller; render.ts imports nothing task-specific.
 *
 * Cell data-state values (CSS hooks):
 *   default       — normal cell in the current month
 *   today         — today's date (ring/dot marker)
 *   selected      — selected date (filled accent)
 *   outside-month — cell from adjacent month (muted)
 *   disabled      — outside min/max bounds
 * (Focus is tracked via tabindex=0 + CSS :focus-visible; no explicit data-state.)
 */

import type { CalendarCell } from './transform';

// ── Template clone ────────────────────────────────────────────────────────────

export interface CalendarWidgetRefs {
  root: HTMLElement;
  monthLabel: HTMLElement;
  grid: HTMLElement;
  prevYearBtn: HTMLButtonElement;
  prevMonthBtn: HTMLButtonElement;
  nextMonthBtn: HTMLButtonElement;
  nextYearBtn: HTMLButtonElement;
  todayBtn: HTMLButtonElement | null;
  clearBtn: HTMLButtonElement | null;
  commitBtn: HTMLButtonElement | null;
  weekdays: HTMLElement[];
}

/**
 * cloneCalendarTemplate — clone #tmpl-calendar and return typed refs to named
 * sub-elements. The caller (CalendarController) appends `refs.root` to its element.
 */
export function cloneCalendarTemplate(template: HTMLTemplateElement): CalendarWidgetRefs {
  const frag = template.content.cloneNode(true) as DocumentFragment;
  const root = frag.firstElementChild as HTMLElement;

  const monthLabel = root.querySelector('.calendar-widget__month-label') as HTMLElement;
  const grid = root.querySelector('.calendar-widget__grid') as HTMLElement;
  const prevYearBtn = root.querySelector('.calendar-widget__year-prev') as HTMLButtonElement;
  const prevMonthBtn = root.querySelector('.calendar-widget__month-prev') as HTMLButtonElement;
  const nextMonthBtn = root.querySelector('.calendar-widget__month-next') as HTMLButtonElement;
  const nextYearBtn = root.querySelector('.calendar-widget__year-next') as HTMLButtonElement;
  const todayBtn = root.querySelector('.calendar-widget__today-btn') as HTMLButtonElement | null;
  const clearBtn = root.querySelector('.calendar-widget__clear-btn') as HTMLButtonElement | null;
  const commitBtn = root.querySelector('.calendar-widget__commit-btn') as HTMLButtonElement | null;
  const weekdays = Array.from(root.querySelectorAll<HTMLElement>('.calendar-widget__weekday'));

  return { root, monthLabel, grid, prevYearBtn, prevMonthBtn, nextMonthBtn, nextYearBtn, todayBtn, clearBtn, commitBtn, weekdays };
}

// ── Month label ───────────────────────────────────────────────────────────────

/**
 * setMonthLabel — update the aria-live month/year label text.
 * Month is 1-based.
 */
export function setMonthLabel(labelEl: HTMLElement, year: number, month: number, locale?: string): void {
  labelEl.textContent = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

export function setWeekdayLabels(elements: HTMLElement[], locale?: string): void {
  elements.forEach((element, index) => {
    const date = new Date(2026, 0, 4 + index);
    element.textContent = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
    element.setAttribute('title', new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date));
  });
}

// ── Grid population ───────────────────────────────────────────────────────────

/**
 * populateGrid — fill the grid element with 42 gridcell/button pairs.
 *
 * Each gridcell contains one <button> whose:
 *   - textContent is the day number
 *   - data-iso is the ISO date
 *   - data-state reflects the visual state
 *   - tabindex is 0 for exactly the focused cell, -1 for all others
 *   - aria-disabled="true" for disabled cells
 *   - aria-label is the full readable date
 *   - aria-pressed="true" for the selected cell
 *
 * No innerHTML — only createElement + textContent / setAttribute.
 */
export function populateGrid(
  gridEl: HTMLElement,
  cells: CalendarCell[],
  focusedIso: string,
  onSelect: (iso: string) => void,
  options: { multiselectable?: boolean; locale?: string } = {},
): void {
  gridEl.innerHTML = '';
  if (options.multiselectable) gridEl.setAttribute('aria-multiselectable', 'true');
  else gridEl.removeAttribute('aria-multiselectable');

  for (const cell of cells) {
    const cellEl = document.createElement('div');
    cellEl.setAttribute('role', 'gridcell');
    cellEl.dataset.iso = cell.iso;

    cellEl.setAttribute('aria-selected', String(cell.isSelected || cell.isInRange));
    const btn = buildDayButton(cell, focusedIso, onSelect, options.locale);
    cellEl.appendChild(btn);
    gridEl.appendChild(cellEl);
  }
}

/**
 * repopulateGrid — update cells in-place (no re-clone).
 * Used for fast re-renders on keyboard navigation or month change when the grid
 * already has 42 cells.
 */
export function repopulateGrid(
  gridEl: HTMLElement,
  cells: CalendarCell[],
  focusedIso: string,
  onSelect: (iso: string) => void,
  options: { multiselectable?: boolean; locale?: string } = {},
): void {
  const existing = gridEl.querySelectorAll('[role="gridcell"]');
  if (existing.length !== 42) {
    // Fall back to full repopulate if cell count doesn't match
    populateGrid(gridEl, cells, focusedIso, onSelect, options);
    return;
  }
  if (options.multiselectable) gridEl.setAttribute('aria-multiselectable', 'true');
  else gridEl.removeAttribute('aria-multiselectable');

  cells.forEach((cell, i) => {
    const cellEl = existing[i] as HTMLElement;
    cellEl.dataset.iso = cell.iso;
    cellEl.setAttribute('aria-selected', String(cell.isSelected || cell.isInRange));

    // Replace the button (simpler than diffing every attribute)
    const oldBtn = cellEl.firstElementChild;
    const newBtn = buildDayButton(cell, focusedIso, onSelect, options.locale);
    if (oldBtn) cellEl.replaceChild(newBtn, oldBtn);
    else cellEl.appendChild(newBtn);
  });
}

// ── Cell builder ──────────────────────────────────────────────────────────────

function buildDayButton(
  cell: CalendarCell,
  focusedIso: string,
  onSelect: (iso: string) => void,
  locale?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'calendar-widget__day-btn';
  btn.textContent = String(cell.day);
  btn.dataset.iso = cell.iso;

  // aria-label: full readable date (e.g. "June 30, 2026")
  const [y, m, d] = cell.iso.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  btn.setAttribute('aria-label', label);

  // data-state (single value — primary visual state)
  let state: string;
  if (cell.isDisabled) {
    state = 'disabled';
  } else if (!cell.inMonth) {
    state = 'outside-month';
  } else if (cell.isSelected) {
    state = 'selected';
  } else if (cell.isToday) {
    state = 'today';
  } else {
    state = 'default';
  }
  btn.setAttribute('data-state', state);
  if (cell.isInRange) btn.dataset.inRange = 'true';
  if (cell.isRangeStart) btn.dataset.rangeStart = 'true';
  if (cell.isRangeEnd) btn.dataset.rangeEnd = 'true';

  if (cell.isSelected) {
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.setAttribute('aria-pressed', 'false');
  }

  if (cell.isDisabled) {
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('tabindex', '-1');
  } else {
    btn.setAttribute('tabindex', cell.iso === focusedIso ? '0' : '-1');
    btn.addEventListener('click', () => {
      if (!cell.isDisabled) onSelect(cell.iso);
    });
  }

  return btn;
}

// ── Focus helper ──────────────────────────────────────────────────────────────

/**
 * moveFocusToIso — programmatically focus the button matching the given iso.
 * Used after keyboard navigation to set browser focus.
 */
export function moveFocusToIso(gridEl: HTMLElement, iso: string): void {
  const btn = gridEl.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`);
  if (btn) btn.focus();
}
