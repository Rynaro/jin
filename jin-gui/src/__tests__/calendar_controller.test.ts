// @vitest-environment jsdom
/**
 * calendar_controller.test.ts — VG-P7 controller + render tests.
 *
 * Two test layers:
 *   1. Render functions (no Stimulus, pure DOM): cloneCalendarTemplate,
 *      setMonthLabel, populateGrid, repopulateGrid, moveFocusToIso.
 *   2. Stimulus CalendarController (keyboard map, roving tabindex, events).
 *
 * VG-P7 gates:
 *   ✓ keyboard: each APG key moves roving focus to expected iso date
 *   ✓ roving tabindex: exactly ONE gridcell button has tabindex=0 after nav
 *   ✓ calendar:selected event: correct {iso, year, month, day} detail on click+Enter
 *   ✓ calendar:cancel emitted on Escape
 *   ✓ setMonthLabel sets correct text
 *   ✓ populateGrid: 42 cells, data-state, aria-pressed, tabindex
 *   ✓ repopulateGrid: updates in-place without full clone
 *   ✓ focusSelected: moves focus to selected/today
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application, defaultSchema } from '@hotwired/stimulus';
import CalendarController from '../controllers/calendar_controller';
import {
  cloneCalendarTemplate,
  setMonthLabel,
  populateGrid,
  repopulateGrid,
  moveFocusToIso,
} from '../lib/calendar/render';
import { buildMonthGrid } from '../lib/calendar/transform';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }));
// initIcons is a no-op in unit tests (no Lucide SVG rendering needed).
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

// ── Minimal HTML fixture ───────────────────────────────────────────────────────

/** Build the minimal HTML needed: a #tmpl-calendar template + a host element. */
function buildFixture(today = '2026-06-15', selected = '', mode: 'single' | 'range' = 'single'): string {
  const selectedAttr = selected ? ` data-calendar-selected-value="${selected}"` : '';
  return `
    <template id="tmpl-calendar">
      <div class="calendar-widget">
        <div class="calendar-widget__header">
          <button type="button" class="calendar-widget__year-prev" aria-label="Previous year"></button>
          <button type="button" class="calendar-widget__month-prev" aria-label="Previous month"></button>
          <span class="calendar-widget__month-label" aria-live="polite"></span>
          <button type="button" class="calendar-widget__month-next" aria-label="Next month"></button>
          <button type="button" class="calendar-widget__year-next" aria-label="Next year"></button>
        </div>
        <div class="calendar-widget__grid" role="grid" aria-label="Choose a date"></div>
        <div class="calendar-widget__footer">
          <button type="button" class="calendar-widget__today-btn">Today</button>
          <button type="button" class="calendar-widget__clear-btn">Clear</button>
          <button type="button" class="calendar-widget__commit-btn" hidden>Use dates</button>
        </div>
      </div>
    </template>
    <div
      data-controller="calendar"
      data-calendar-today-value="${today}"
      data-calendar-mode-value="${mode}"${selectedAttr}
    ></div>
  `;
}

// ── Helper: get CalendarController instance ────────────────────────────────────

function getCalCtrl(app: Application): CalendarController {
  const el = document.querySelector('[data-controller="calendar"]') as HTMLElement;
  return app.getControllerForElementAndIdentifier(el, 'calendar') as CalendarController;
}

/** Return the ISO of the button currently having tabindex=0. */
function getFocusedIso(): string | undefined {
  const btn = document.querySelector<HTMLButtonElement>(
    '.calendar-widget__grid button[tabindex="0"]'
  );
  return btn?.dataset.iso;
}

/** Return all buttons in the grid with tabindex=0. */
function tabzeroButtons(): NodeListOf<HTMLButtonElement> {
  return document.querySelectorAll<HTMLButtonElement>(
    '.calendar-widget__grid button[tabindex="0"]'
  );
}

/** Fire a keydown event on the grid button with the given iso (focuses it first). */
function fireKey(
  controllerEl: HTMLElement,
  gridEl: HTMLElement,
  key: string,
  options: { shiftKey?: boolean } = {}
): void {
  // Focus the currently-tabzero button so handleKeydown sees insideGrid=true
  const btn = gridEl.querySelector<HTMLButtonElement>('button[tabindex="0"]');
  btn?.focus();
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: options.shiftKey ?? false,
  });
  controllerEl.dispatchEvent(event);
}

// ── Render layer tests (no Stimulus) ──────────────────────────────────────────

describe('render.ts: setMonthLabel', () => {
  it('sets correct text for a known month', () => {
    const el = document.createElement('span');
    setMonthLabel(el, 2026, 6);
    expect(el.textContent).toBe('June 2026');
  });

  it('sets correct text for January', () => {
    const el = document.createElement('span');
    setMonthLabel(el, 2025, 1);
    expect(el.textContent).toBe('January 2025');
  });

  it('sets correct text for December', () => {
    const el = document.createElement('span');
    setMonthLabel(el, 2024, 12);
    expect(el.textContent).toBe('December 2024');
  });
});

describe('render.ts: populateGrid', () => {
  let gridEl: HTMLElement;

  beforeEach(() => {
    gridEl = document.createElement('div');
    gridEl.setAttribute('role', 'grid');
  });

  it('creates exactly 42 gridcell elements', () => {
    const cells = buildMonthGrid(2026, 6, { today: '2026-06-15' });
    populateGrid(gridEl, cells, '2026-06-15', vi.fn());
    expect(gridEl.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
  });

  it('exactly one button has tabindex=0', () => {
    const cells = buildMonthGrid(2026, 6, { today: '2026-06-15' });
    populateGrid(gridEl, cells, '2026-06-15', vi.fn());
    const tabzero = gridEl.querySelectorAll('button[tabindex="0"]');
    expect(tabzero).toHaveLength(1);
    expect((tabzero[0] as HTMLButtonElement).dataset.iso).toBe('2026-06-15');
  });

  it('selected cell has aria-pressed=true', () => {
    const cells = buildMonthGrid(2026, 6, { selected: '2026-06-20' });
    populateGrid(gridEl, cells, '2026-06-15', vi.fn());
    const selBtn = gridEl.querySelector<HTMLButtonElement>('button[data-iso="2026-06-20"]');
    expect(selBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(selBtn?.getAttribute('data-state')).toBe('selected');
  });

  it('today cell has data-state=today', () => {
    const cells = buildMonthGrid(2026, 6, { today: '2026-06-30' });
    populateGrid(gridEl, cells, '2026-06-01', vi.fn());
    const todayBtn = gridEl.querySelector<HTMLButtonElement>('button[data-iso="2026-06-30"]');
    expect(todayBtn?.getAttribute('data-state')).toBe('today');
  });

  it('outside-month cells have data-state=outside-month', () => {
    const cells = buildMonthGrid(2026, 6);
    populateGrid(gridEl, cells, '2026-06-01', vi.fn());
    // May 31 is outside June
    const outsideBtn = gridEl.querySelector<HTMLButtonElement>('button[data-iso="2026-05-31"]');
    expect(outsideBtn?.getAttribute('data-state')).toBe('outside-month');
  });

  it('disabled cells have aria-disabled=true and tabindex=-1', () => {
    const cells = buildMonthGrid(2026, 6, { min: '2026-06-15' });
    populateGrid(gridEl, cells, '2026-06-15', vi.fn());
    // June 01 is before min → disabled
    const disabledBtn = gridEl.querySelector<HTMLButtonElement>('button[data-iso="2026-06-01"]');
    expect(disabledBtn?.getAttribute('aria-disabled')).toBe('true');
    expect(disabledBtn?.getAttribute('tabindex')).toBe('-1');
  });

  it('click on enabled button fires onSelect with correct iso', () => {
    const onSelect = vi.fn();
    const cells = buildMonthGrid(2026, 6);
    populateGrid(gridEl, cells, '2026-06-01', onSelect);
    const btn = gridEl.querySelector<HTMLButtonElement>('button[data-iso="2026-06-20"]');
    btn?.click();
    expect(onSelect).toHaveBeenCalledWith('2026-06-20');
  });
});

describe('render.ts: repopulateGrid', () => {
  it('updates existing cells in-place without discarding the container', () => {
    const gridEl = document.createElement('div');
    // Populate first
    const cells1 = buildMonthGrid(2026, 6);
    populateGrid(gridEl, cells1, '2026-06-01', vi.fn());
    const firstGridcell = gridEl.querySelector('[role="gridcell"]') as HTMLElement;

    // Repopulate with same month but different focused iso
    const cells2 = buildMonthGrid(2026, 6);
    repopulateGrid(gridEl, cells2, '2026-06-15', vi.fn());

    // Same container element
    expect(gridEl.querySelector('[role="gridcell"]')).toBe(firstGridcell);
    // New focused cell
    const tabzero = gridEl.querySelectorAll('button[tabindex="0"]');
    expect(tabzero).toHaveLength(1);
    expect((tabzero[0] as HTMLButtonElement).dataset.iso).toBe('2026-06-15');
  });
});

describe('render.ts: moveFocusToIso', () => {
  it('focuses the button matching the given iso', () => {
    const gridEl = document.createElement('div');
    document.body.appendChild(gridEl);
    const cells = buildMonthGrid(2026, 6);
    populateGrid(gridEl, cells, '2026-06-01', vi.fn());
    moveFocusToIso(gridEl, '2026-06-20');
    expect(document.activeElement?.getAttribute('data-iso')).toBe('2026-06-20');
    document.body.removeChild(gridEl);
  });
});

describe('render.ts: cloneCalendarTemplate', () => {
  it('returns all required refs', () => {
    const tmpl = document.createElement('template');
    tmpl.innerHTML = `
      <div class="calendar-widget">
        <div class="calendar-widget__header">
          <button class="calendar-widget__year-prev"></button>
          <button class="calendar-widget__month-prev"></button>
          <span class="calendar-widget__month-label"></span>
          <button class="calendar-widget__month-next"></button>
          <button class="calendar-widget__year-next"></button>
        </div>
        <div class="calendar-widget__grid" role="grid"></div>
        <div class="calendar-widget__footer">
          <button class="calendar-widget__today-btn"></button>
          <button class="calendar-widget__clear-btn"></button>
        </div>
      </div>
    `;
    const refs = cloneCalendarTemplate(tmpl);
    expect(refs.root).toBeInstanceOf(HTMLElement);
    expect(refs.monthLabel).toBeInstanceOf(HTMLElement);
    expect(refs.grid).toBeInstanceOf(HTMLElement);
    expect(refs.prevYearBtn).toBeInstanceOf(HTMLButtonElement);
    expect(refs.prevMonthBtn).toBeInstanceOf(HTMLButtonElement);
    expect(refs.nextMonthBtn).toBeInstanceOf(HTMLButtonElement);
    expect(refs.nextYearBtn).toBeInstanceOf(HTMLButtonElement);
    expect(refs.todayBtn).toBeInstanceOf(HTMLButtonElement);
    expect(refs.clearBtn).toBeInstanceOf(HTMLButtonElement);
  });
});

// ── CalendarController — Stimulus wiring tests ────────────────────────────────

describe('CalendarController (Stimulus)', () => {
  let app: Application;

  async function mount(today = '2026-06-15', selected = '', mode: 'single' | 'range' = 'single'): Promise<void> {
    document.body.innerHTML = buildFixture(today, selected, mode);
    app = Application.start(document.documentElement, defaultSchema);
    app.register('calendar', CalendarController);
    // Stimulus connects asynchronously — yield macrotask
    await new Promise((r) => setTimeout(r, 0));
  }

  afterEach(() => {
    app?.stop();
    document.body.innerHTML = '';
  });

  // ── Connect / initial state ───────────────────────────────────────────────

  it('connects and renders 42 gridcell buttons', async () => {
    await mount();
    const cells = document.querySelectorAll('.calendar-widget__grid [role="gridcell"]');
    expect(cells).toHaveLength(42);
  });

  it('month label shows the display month', async () => {
    await mount('2026-06-15');
    const label = document.querySelector('.calendar-widget__month-label');
    expect(label?.textContent).toBe('June 2026');
  });

  it('sets tabindex=0 on the today cell when no selection', async () => {
    await mount('2026-06-15');
    expect(getFocusedIso()).toBe('2026-06-15');
  });

  it('sets tabindex=0 on the selected cell when given', async () => {
    await mount('2026-06-15', '2026-06-20');
    expect(getFocusedIso()).toBe('2026-06-20');
  });

  it('exactly ONE button has tabindex=0 on connect', async () => {
    await mount('2026-06-15');
    expect(tabzeroButtons()).toHaveLength(1);
  });

  // ── Keyboard map (APG) ────────────────────────────────────────────────────

  it('ArrowRight moves focus +1 day', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowRight');
    expect(getFocusedIso()).toBe('2026-06-16');
    expect(tabzeroButtons()).toHaveLength(1);
  });

  it('ArrowLeft moves focus -1 day', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowLeft');
    expect(getFocusedIso()).toBe('2026-06-14');
  });

  it('ArrowDown moves focus +1 week', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowDown');
    expect(getFocusedIso()).toBe('2026-06-22');
  });

  it('ArrowUp moves focus -1 week', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowUp');
    expect(getFocusedIso()).toBe('2026-06-08');
  });

  it('Home moves focus to Sunday of current week', async () => {
    // 2026-06-15 is a Monday → Home → 2026-06-14 (Sunday)
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'Home');
    expect(getFocusedIso()).toBe('2026-06-14');
  });

  it('End moves focus to Saturday of current week', async () => {
    // 2026-06-15 is a Monday → End → 2026-06-20 (Saturday)
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'End');
    expect(getFocusedIso()).toBe('2026-06-20');
  });

  it('PageUp moves focus -1 month', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'PageUp');
    expect(getFocusedIso()).toBe('2026-05-15');
  });

  it('PageDown moves focus +1 month', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'PageDown');
    expect(getFocusedIso()).toBe('2026-07-15');
  });

  it('Shift+PageUp moves focus -1 year', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'PageUp', { shiftKey: true });
    expect(getFocusedIso()).toBe('2025-06-15');
  });

  it('Shift+PageDown moves focus +1 year', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'PageDown', { shiftKey: true });
    expect(getFocusedIso()).toBe('2027-06-15');
  });

  it('roving tabindex: exactly ONE button has tabindex=0 after ArrowRight', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowRight');
    expect(tabzeroButtons()).toHaveLength(1);
    expect(getFocusedIso()).toBe('2026-06-16');
  });

  it('roving tabindex: exactly ONE button has tabindex=0 after PageDown', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'PageDown');
    expect(tabzeroButtons()).toHaveLength(1);
  });

  // ── calendar:selected event ───────────────────────────────────────────────

  it('Enter on focused cell emits calendar:selected with correct detail', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;

    const received: CustomEvent[] = [];
    el.addEventListener('calendar:selected', (e) => received.push(e as CustomEvent));

    // Focus the tabzero button (2026-06-15)
    const btn = grid.querySelector<HTMLButtonElement>('button[tabindex="0"]');
    btn?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0].detail.iso).toBe('2026-06-15');
    expect(received[0].detail.year).toBe(2026);
    expect(received[0].detail.month).toBe(6);
    expect(received[0].detail.day).toBe(15);
  });

  it('Space on focused cell emits calendar:selected', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;

    const received: CustomEvent[] = [];
    el.addEventListener('calendar:selected', (e) => received.push(e as CustomEvent));

    const btn = grid.querySelector<HTMLButtonElement>('button[tabindex="0"]');
    btn?.focus();

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0].detail.iso).toBe('2026-06-15');
  });

  it('clicking a day button emits calendar:selected with the clicked iso', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;

    const received: CustomEvent[] = [];
    el.addEventListener('calendar:selected', (e) => received.push(e as CustomEvent));

    const btn = grid.querySelector<HTMLButtonElement>('button[data-iso="2026-06-25"]');
    btn?.click();

    expect(received).toHaveLength(1);
    expect(received[0].detail.iso).toBe('2026-06-25');
    expect(received[0].detail.year).toBe(2026);
    expect(received[0].detail.month).toBe(6);
    expect(received[0].detail.day).toBe(25);
  });

  it('range mode emits live normalized selections and restarts on the third activation', async () => {
    await mount('2026-06-15', '', 'range');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const received: unknown[] = [];
    el.addEventListener('calendar:change', event => received.push((event as CustomEvent).detail));
    document.querySelector<HTMLButtonElement>('button[data-iso="2026-06-20"]')!.click();
    document.querySelector<HTMLButtonElement>('button[data-iso="2026-06-10"]')!.click();
    document.querySelector<HTMLButtonElement>('button[data-iso="2026-06-25"]')!.click();
    expect(received).toEqual([
      { mode: 'range', start: '2026-06-20', end: '2026-06-20', complete: false },
      { mode: 'range', start: '2026-06-10', end: '2026-06-20', complete: true },
      { mode: 'range', start: '2026-06-25', end: '2026-06-25', complete: false },
    ]);
    expect(el.querySelector('[role="grid"]')?.getAttribute('aria-multiselectable')).toBe('true');
    expect(el.querySelector('[role="gridcell"][data-iso="2026-06-25"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('setSelection is silent and range keyboard activation restores focus', async () => {
    await mount('2026-06-15', '', 'range');
    const ctrl = getCalCtrl(app);
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const received: unknown[] = [];
    el.addEventListener('calendar:change', event => received.push((event as CustomEvent).detail));
    ctrl.setSelection({ mode: 'range', start: '2026-06-30', end: '2026-07-02', complete: true });
    expect(received).toHaveLength(0);
    ctrl.setSelection({ mode: 'range', start: '2026-06-30', end: '2026-06-30', complete: false });
    const grid = el.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'Enter');
    expect(document.activeElement?.getAttribute('data-iso')).toBe('2026-06-30');
    expect(received).toHaveLength(1);
  });

  it('keeps commit opt-in and emits the current immutable range when enabled', async () => {
    await mount('2026-06-15', '', 'range');
    const ctrl = getCalCtrl(app);
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    ctrl.setSelection({ mode: 'range', start: '2026-06-10', end: '2026-06-12', complete: true });
    ctrl.commitValue = true;
    ctrl.setPresentation('en', { commit: 'Use dates' });
    const commit = el.querySelector<HTMLButtonElement>('.calendar-widget__commit-btn')!;
    expect(commit.hidden).toBe(false);
    const received: unknown[] = [];
    el.addEventListener('calendar:commit', event => received.push((event as CustomEvent).detail));
    commit.click();
    expect(received).toEqual([{ mode: 'range', start: '2026-06-10', end: '2026-06-12', complete: true }]);
  });

  it('keeps single mode selected event count unchanged', async () => {
    await mount();
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const selected: unknown[] = [];
    const changed: unknown[] = [];
    el.addEventListener('calendar:selected', event => selected.push((event as CustomEvent).detail));
    el.addEventListener('calendar:change', event => changed.push((event as CustomEvent).detail));
    document.querySelector<HTMLButtonElement>('button[data-iso="2026-06-20"]')!.click();
    expect(selected).toHaveLength(1);
    expect(changed).toHaveLength(0);
  });

  it('Escape emits calendar:cancel', async () => {
    await mount('2026-06-15');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;

    const cancelled: Event[] = [];
    el.addEventListener('calendar:cancel', (e) => cancelled.push(e));

    const btn = grid.querySelector<HTMLButtonElement>('button[tabindex="0"]');
    btn?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);

    expect(cancelled).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // ── setInitial / focusSelected ────────────────────────────────────────────

  it('setInitial navigates display to the given month', async () => {
    await mount('2026-06-15');
    const ctrl = getCalCtrl(app);
    ctrl.setInitial('2026-09-01');
    // Month label should now show September
    const label = document.querySelector('.calendar-widget__month-label');
    expect(label?.textContent).toBe('September 2026');
  });

  it('setInitial with null falls back to today', async () => {
    await mount('2026-06-15');
    const ctrl = getCalCtrl(app);
    ctrl.setInitial(null);
    // Should show June (today's month)
    const label = document.querySelector('.calendar-widget__month-label');
    expect(label?.textContent).toBe('June 2026');
  });

  it('focusSelected moves tabindex=0 to selected cell', async () => {
    await mount('2026-06-15', '2026-06-20');
    const ctrl = getCalCtrl(app);
    ctrl.focusSelected();
    expect(getFocusedIso()).toBe('2026-06-20');
  });

  // ── Auto-navigate on keyboard crossing month ──────────────────────────────

  it('ArrowRight on last day of month navigates to next month', async () => {
    // June 30 → July 1
    await mount('2026-06-30', '2026-06-30');
    const el = document.querySelector<HTMLElement>('[data-controller="calendar"]')!;
    const grid = document.querySelector<HTMLElement>('.calendar-widget__grid')!;
    fireKey(el, grid, 'ArrowRight');
    // Focused cell should be July 1
    expect(getFocusedIso()).toBe('2026-07-01');
    // Month label should switch
    const label = document.querySelector('.calendar-widget__month-label');
    expect(label?.textContent).toBe('July 2026');
  });
});
