// @vitest-environment jsdom
/**
 * lists_controller.test.ts — headless unit tests for the P3 Lists feature.
 *
 * Tests three layers:
 *   1. Pure logic from lib/lists/transform.ts (no DOM)
 *   2. DOM rendering from lib/lists/render.ts (jsdom, no Stimulus)
 *   3. Tag chip rendering from lib/lists/render.ts (buildTagChips)
 *
 * VG-P3 gates verified here:
 *   ✓ sortLists: default (inbox) first, then lexicographic by position
 *   ✓ listLabel: includes name and task count
 *   ✓ listSelectOptions: returns sorted options with value/label/color
 *   ✓ isPaletteColor: type guard for JIN_PALETTE tokens
 *   ✓ renderListsSidebar: renders rows with name, count, swatch
 *   ✓ renderListsSidebar: inbox row is marked as default
 *   ✓ renderListsSidebar: non-default rows have edit + delete buttons
 *   ✓ renderListsSidebar: inbox row has no delete button (cannot delete default)
 *   ✓ renderListsSidebar: clicking a row fires onSelect callback with list id
 *   ✓ renderListsSidebar: edit button fires onEditRequest with ListDto
 *   ✓ renderListsSidebar: delete button fires onDeleteRequest with ListDto
 *   ✓ populateListFilter: populates select with one option per list
 *   ✓ populateListFilter: preserves placeholder option (value="")
 *   ✓ buildTagChips: returns null when tags is empty
 *   ✓ buildTagChips: renders one chip per tag slug
 *   ✓ buildTagChips: chips carry data-tag-slug attribute
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ListDto, TaskDto } from '../types/dto';
import {
  sortLists,
  listLabel,
  listSelectOptions,
  isPaletteColor,
  JIN_PALETTE,
} from '../lib/lists/transform';
import {
  renderListsSidebar,
  renderSmartViews,
  populateListFilter,
  buildTagChips,
} from '../lib/lists/render';
import { computeSidebarCounts } from '../lib/lists/counts';
import type { TaskScope } from '../lib/tasks/scopes';

// ── S5 — real Stimulus-mounted harness (AC-S5-03) ────────────────────────────
//
// Everything above the "S5 — smart views" section is pure (no DOM/no
// Stimulus). AC-S5-03's CONSTRAINT is explicit: a count-refresh test that
// calls loadLists() directly proves nothing — it must mutate a task THROUGH
// THE CONTROLLER. vi.mock calls are hoisted by Vitest regardless of source
// position, so they take effect for the imports below even though they're
// declared mid-file (same pattern tasks_controller.test.ts already uses).

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

// eslint-disable-next-line import/first -- must follow the vi.mock calls above.
import { Application, defaultSchema } from '@hotwired/stimulus';
// eslint-disable-next-line import/first
import TasksController from '../controllers/tasks_controller';
// eslint-disable-next-line import/first
import ListsController from '../controllers/lists_controller';
// eslint-disable-next-line import/first
import * as InvokeModule from '../invoke';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

function extractBodyInnerHTML(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Could not extract <body> from index.html');
  return match[1];
}

const BODY_CONTENT = extractBodyInnerHTML(INDEX_HTML);

function stubDialogPrototype(): void {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
    writable: true,
    configurable: true,
  });
}

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeList(overrides: Partial<ListDto> = {}): ListDto {
  return {
    id: 'inbox',
    name: 'Inbox',
    color: 'accent',
    icon: 'inbox',
    position: 'A',
    parent_id: null,
    view: 'list',
    sort_mode: 'manual',
    is_default: true,
    task_count: 0,
    sections: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-001',
    title: 'Test Task',
    status: 'todo',
    priority: 'none',
    due: null,
    list: 'inbox',
    completed_at: null,
    deleted_at: null,
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-27T12:00:00Z',
    backlinks: [],
    body: '',
    ...overrides,
  };
}

// ── Shared setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. sortLists — default first, then lexicographic by position
// ─────────────────────────────────────────────────────────────────────────────

describe('sortLists', () => {
  it('places the default (inbox) list first', () => {
    const lists = [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
      makeList({ id: 'inbox', name: 'Inbox', is_default: true, position: 'A' }),
    ];
    const sorted = sortLists(lists);
    expect(sorted[0].id).toBe('inbox');
    expect(sorted[1].id).toBe('work');
  });

  it('sorts non-default lists by position (lexicographic)', () => {
    const lists = [
      makeList({ id: 'b', name: 'B', is_default: false, position: 'Z' }),
      makeList({ id: 'a', name: 'A', is_default: false, position: 'M' }),
    ];
    const sorted = sortLists(lists);
    expect(sorted[0].id).toBe('a');
    expect(sorted[1].id).toBe('b');
  });

  it('does not mutate the input array', () => {
    const lists = [
      makeList({ id: 'work', is_default: false, position: 'B' }),
      makeList({ id: 'inbox', is_default: true, position: 'A' }),
    ];
    sortLists(lists);
    expect(lists[0].id).toBe('work');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. listLabel — name + task count
// ─────────────────────────────────────────────────────────────────────────────

describe('listLabel', () => {
  it('includes the list name and task count', () => {
    const list = makeList({ name: 'Inbox', task_count: 5 });
    expect(listLabel(list)).toBe('Inbox (5)');
  });

  it('shows zero count correctly', () => {
    const list = makeList({ name: 'Work', task_count: 0 });
    expect(listLabel(list)).toBe('Work (0)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. listSelectOptions — sorted, correct shape
// ─────────────────────────────────────────────────────────────────────────────

describe('listSelectOptions', () => {
  it('returns one option per list, sorted with default first', () => {
    const lists = [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
      makeList({ id: 'inbox', name: 'Inbox', is_default: true, position: 'A' }),
    ];
    const opts = listSelectOptions(lists);
    expect(opts).toHaveLength(2);
    expect(opts[0].value).toBe('inbox');
    expect(opts[1].value).toBe('work');
  });

  it('each option has value, label (with count), and color', () => {
    const list = makeList({ id: 'inbox', name: 'Inbox', task_count: 3, color: 'accent' });
    const opts = listSelectOptions([list]);
    expect(opts[0]).toMatchObject({ value: 'inbox', label: 'Inbox (3)', color: 'accent' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isPaletteColor — type guard
// ─────────────────────────────────────────────────────────────────────────────

describe('isPaletteColor', () => {
  it('returns true for every JIN_PALETTE entry', () => {
    for (const color of JIN_PALETTE) {
      expect(isPaletteColor(color)).toBe(true);
    }
  });

  it('returns false for an unknown color token', () => {
    expect(isPaletteColor('neon-banana')).toBe(false);
    expect(isPaletteColor('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. renderListsSidebar — DOM rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('renderListsSidebar', () => {
  function makeContainer(): HTMLElement {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    return ul;
  }

  it('renders one row per list', () => {
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'inbox', is_default: true }),
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
    ]);
    expect(container.querySelectorAll('.lists-rail__row')).toHaveLength(2);
  });

  it('renders inbox row first and marks it as default', () => {
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
      makeList({ id: 'inbox', name: 'Inbox', is_default: true, position: 'A' }),
    ]);
    const rows = container.querySelectorAll('.lists-rail__row');
    expect(rows[0].classList.contains('lists-rail__row--default')).toBe(true);
    expect(rows[0].getAttribute('data-list-id')).toBe('inbox');
  });

  it('shows the CLIENT-SIDE open-task count in the row, never ListDto.task_count', () => {
    // S5 (AC-S5-03/04 CONSTRAINT): the badge must come from computeSidebarCounts,
    // never from `list.task_count` (which counts `done` tasks too, per
    // jin-core/src/index/query.rs — a badge sourced from it never goes down).
    // `task_count: 99` here is a deliberate decoy: if the render layer ever
    // regresses to reading it, this assertion catches it immediately.
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', task_count: 99 })], {
      counts: { inbox: 7 },
    });
    const count = container.querySelector('.lists-rail__count');
    expect(count?.textContent).toBe('7');
  });

  it('renders a 0 badge for a list absent from the counts map (never task_count)', () => {
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', task_count: 42 })]);
    const count = container.querySelector('.lists-rail__count');
    expect(count?.textContent).toBe('0');
  });

  it('inbox row has no delete button (non-deletable)', () => {
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', is_default: true })]);
    const deleteBtn = container.querySelector('.lists-rail__delete-btn');
    expect(deleteBtn).toBeNull();
  });

  it('non-default rows put edit + delete in one compact actions menu', () => {
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
    ]);
    expect(container.querySelector('.lists-rail__edit-btn')).not.toBeNull();
    expect(container.querySelector('.lists-rail__delete-btn')).not.toBeNull();
    expect(container.querySelector('.lists-rail__edit-btn')?.textContent).toContain('Edit list');
    expect(container.querySelector('.lists-rail__delete-btn')?.textContent).toContain('Delete list');
    const row = container.querySelector('.lists-rail__row')!;
    const actions = container.querySelector('.lists-rail__menu-btn')!;
    const menu = container.querySelector('.lists-rail__menu')!;
    expect(row.classList.contains('jin-navigation-row--actions')).toBe(true);
    expect(actions.classList.contains('jin-navigation-row__actions')).toBe(true);
    expect(actions.getAttribute('aria-haspopup')).toBe('menu');
    expect(actions.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the actions menu keyboard focusable through the reserved shared slot', () => {
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
    ]);
    const menuBtn = container.querySelector<HTMLButtonElement>('.lists-rail__menu-btn')!;
    menuBtn.focus();
    expect(document.activeElement).toBe(menuBtn);
    expect(menuBtn.closest('.jin-navigation-row--actions')).not.toBeNull();
  });

  it('clicking a row fires onSelect with the list id', () => {
    const onSelect = vi.fn();
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', name: 'Inbox', is_default: true })], {
      onSelect,
    });
    const btn = container.querySelector('.lists-rail__row-btn') as HTMLElement;
    btn.click();
    expect(onSelect).toHaveBeenCalledWith('inbox');
  });

  it('edit button fires onEditRequest with the ListDto', () => {
    const onEditRequest = vi.fn();
    const list = makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' });
    const container = makeContainer();
    renderListsSidebar(container, [list], { onEditRequest });
    (container.querySelector('.lists-rail__menu-btn') as HTMLButtonElement).click();
    const editBtn = container.querySelector('.lists-rail__edit-btn') as HTMLElement;
    editBtn.click();
    expect(onEditRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'work' }));
  });

  it('delete button fires onDeleteRequest with the ListDto', () => {
    const onDeleteRequest = vi.fn();
    const list = makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' });
    const container = makeContainer();
    renderListsSidebar(container, [list], { onDeleteRequest });
    (container.querySelector('.lists-rail__menu-btn') as HTMLButtonElement).click();
    const deleteBtn = container.querySelector('.lists-rail__delete-btn') as HTMLElement;
    deleteBtn.click();
    expect(onDeleteRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'work' }));
  });

  it('opens and escapes the actions menu without selecting the list', () => {
    const onSelect = vi.fn();
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'work', name: 'Work', is_default: false })], { onSelect });
    const row = container.querySelector<HTMLElement>('.lists-rail__row')!;
    const menuBtn = container.querySelector<HTMLButtonElement>('.lists-rail__menu-btn')!;
    const menu = container.querySelector<HTMLElement>('.lists-rail__menu')!;

    menuBtn.click();
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hasAttribute('hidden')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(menuBtn);
  });

  it('moves keyboard activation into the actions menu and contains its arrow keys', () => {
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'work', name: 'Work', is_default: false })]);
    const menuBtn = container.querySelector<HTMLButtonElement>('.lists-rail__menu-btn')!;
    const edit = container.querySelector<HTMLButtonElement>('.lists-rail__edit-btn')!;
    const remove = container.querySelector<HTMLButtonElement>('.lists-rail__delete-btn')!;

    menuBtn.focus();
    menuBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(edit);

    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(remove);
    remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(edit);

    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuBtn);
  });

  it('clears existing rows on re-render', () => {
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', is_default: true })]);
    renderListsSidebar(container, [makeList({ id: 'inbox', is_default: true })]);
    expect(container.querySelectorAll('.lists-rail__row')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. populateListFilter — select population
// ─────────────────────────────────────────────────────────────────────────────

describe('populateListFilter', () => {
  function makeSelect(withPlaceholder = true): HTMLSelectElement {
    const select = document.createElement('select');
    if (withPlaceholder) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'All Lists';
      select.appendChild(placeholder);
    }
    document.body.appendChild(select);
    return select;
  }

  it('adds one option per list', () => {
    const select = makeSelect();
    populateListFilter(select, [
      makeList({ id: 'inbox', name: 'Inbox', is_default: true }),
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
    ]);
    // placeholder + 2 list options
    expect(select.options).toHaveLength(3);
  });

  it('preserves the placeholder option (value="")', () => {
    const select = makeSelect();
    populateListFilter(select, [makeList({ id: 'inbox', name: 'Inbox', is_default: true })]);
    expect(select.options[0].value).toBe('');
    expect(select.options[0].textContent).toBe('All Lists');
  });

  it('option values match list ids', () => {
    const select = makeSelect(false);
    populateListFilter(select, [makeList({ id: 'inbox', name: 'Inbox', is_default: true })]);
    expect(select.options[0].value).toBe('inbox');
  });

  it('default list option appears first after placeholder', () => {
    const select = makeSelect();
    populateListFilter(select, [
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'B' }),
      makeList({ id: 'inbox', name: 'Inbox', is_default: true }),
    ]);
    expect(select.options[1].value).toBe('inbox');
    expect(select.options[2].value).toBe('work');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. buildTagChips — P4 tag chip rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildTagChips', () => {
  it('returns null for undefined tags', () => {
    expect(buildTagChips(undefined)).toBeNull();
  });

  it('returns null for an empty tags array', () => {
    expect(buildTagChips([])).toBeNull();
  });

  it('returns a container with one chip per tag', () => {
    const chips = buildTagChips(['email', 'urgent']);
    expect(chips).not.toBeNull();
    expect(chips!.querySelectorAll('.task-tag-chip')).toHaveLength(2);
  });

  it('each chip carries data-tag-slug attribute', () => {
    const chips = buildTagChips(['email', 'urgent']);
    const chipEls = chips!.querySelectorAll('.task-tag-chip');
    expect((chipEls[0] as HTMLElement).dataset.tagSlug).toBe('email');
    expect((chipEls[1] as HTMLElement).dataset.tagSlug).toBe('urgent');
  });

  it('container has aria-label listing all tags', () => {
    const chips = buildTagChips(['email', 'urgent']);
    expect(chips!.getAttribute('aria-label')).toBe('Tags: email, urgent');
  });

  it('chip text content matches the slug', () => {
    const chips = buildTagChips(['email']);
    const chip = chips!.querySelector('.task-tag-chip') as HTMLElement;
    expect(chip.textContent).toBe('email');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// S5 — A sidebar that actually works (AC-S5-01..09)
// ═════════════════════════════════════════════════════════════════════════

const EMPTY_COUNTS = { smartViews: { inbox: 0, today: 0, upcoming: 0 }, lists: {} };

function makeContainer(): HTMLElement {
  const ul = document.createElement('ul');
  document.body.appendChild(ul);
  return ul;
}

// ── AC-S5-01 — four smart views, above the user lists ──────────────────────

describe('renderSmartViews', () => {
  it('sidebar_renders_flexible_with_the_existing_smart_views', () => {
    const container = makeContainer();
    renderSmartViews(container, EMPTY_COUNTS, null);
    const rows = container.querySelectorAll('.lists-rail__row--smart');
    expect(rows).toHaveLength(5);
    const labels = Array.from(rows).map((r) => r.querySelector('.lists-rail__name')?.textContent);
    expect(labels).toEqual(['Inbox', 'Today', 'Upcoming', 'Flexible', 'Completed']);
  });

  it('Completed renders no count badge (a badge that never goes down is noise)', () => {
    const container = makeContainer();
    renderSmartViews(container, { smartViews: { inbox: 3, today: 1, upcoming: 2 }, lists: {} }, null);
    const completedRow = container.querySelector('[data-smart-view="completed"]');
    expect(completedRow?.querySelector('.lists-rail__count')).toBeNull();
  });

  it('Inbox/Today/Upcoming show their computed counts', () => {
    const container = makeContainer();
    renderSmartViews(container, { smartViews: { inbox: 3, today: 1, upcoming: 2 }, lists: {} }, null);
    const countOf = (id: string) =>
      container.querySelector(`[data-smart-view="${id}"] .lists-rail__count`)?.textContent;
    expect(countOf('inbox')).toBe('3');
    expect(countOf('today')).toBe('1');
    expect(countOf('upcoming')).toBe('2');
  });

  it('clicking a smart-view row fires onSelect with its id', () => {
    const onSelect = vi.fn();
    const container = makeContainer();
    renderSmartViews(container, EMPTY_COUNTS, null, { onSelect });
    const todayBtn = container.querySelector(
      '[data-smart-view="today"] .lists-rail__row-btn',
    ) as HTMLElement;
    todayBtn.click();
    expect(onSelect).toHaveBeenCalledWith('today');
  });
});

// ── AC-S5-02 — exactly one row is aria-current at a time ───────────────────

describe('active-selection indicator (AC-S5-02)', () => {
  it('exactly_one_row_is_aria_current — a smart-view scope', () => {
    const parent = document.createElement('div');
    const smartUl = document.createElement('ul');
    const listsUl = document.createElement('ul');
    parent.appendChild(smartUl);
    parent.appendChild(listsUl);
    document.body.appendChild(parent);

    const scope: TaskScope = { kind: 'smart', id: 'today' };
    renderSmartViews(smartUl, EMPTY_COUNTS, scope);
    renderListsSidebar(listsUl, [makeList({ id: 'inbox' }), makeList({ id: 'work', is_default: false, position: 'B' })], {
      activeScope: scope,
    });

    const current = parent.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect((current[0] as HTMLElement).dataset.smartView).toBe('today');
    expect(parent.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('exactly_one_row_is_aria_current — a list scope', () => {
    const parent = document.createElement('div');
    const smartUl = document.createElement('ul');
    const listsUl = document.createElement('ul');
    parent.appendChild(smartUl);
    parent.appendChild(listsUl);
    document.body.appendChild(parent);

    const scope: TaskScope = { kind: 'list', id: 'work' };
    renderSmartViews(smartUl, EMPTY_COUNTS, scope);
    renderListsSidebar(listsUl, [makeList({ id: 'inbox' }), makeList({ id: 'work', is_default: false, position: 'B' })], {
      activeScope: scope,
    });

    const current = parent.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect((current[0] as HTMLElement).dataset.listId).toBe('work');
    expect(parent.querySelector('[aria-current="true"]')).toBeNull();
  });
});

// ── AC-S5-05 — computeSidebarCounts counts only open tasks ──────────────────

describe('computeSidebarCounts', () => {
  it('counts_exclude_done_and_cancelled', () => {
    const lists = [makeList({ id: 'inbox', is_default: true })];
    const tasks = [
      makeTask({ id: 't-todo', status: 'todo', list: 'inbox' }),
      makeTask({ id: 't-doing', status: 'doing', list: 'inbox' }),
      makeTask({ id: 't-done', status: 'done', list: 'inbox' }),
      makeTask({ id: 't-cancelled', status: 'cancelled', list: 'inbox' }),
    ];
    const counts = computeSidebarCounts(tasks, lists);
    // Only the todo + doing tasks count — done/cancelled are excluded.
    expect(counts.smartViews.inbox).toBe(2);
    expect(counts.lists['inbox']).toBe(2);
  });

  it('excludes soft-deleted tasks from every count', () => {
    const lists = [makeList({ id: 'inbox', is_default: true })];
    const tasks = [
      makeTask({ id: 't1', status: 'todo', list: 'inbox' }),
      makeTask({ id: 't2', status: 'todo', list: 'inbox', deleted_at: '2026-07-01T00:00:00Z' }),
    ];
    const counts = computeSidebarCounts(tasks, lists);
    expect(counts.lists['inbox']).toBe(1);
  });

  it('never reads ListDto.task_count — computes from the fetched tasks only', () => {
    // A decoy task_count that would be WRONG if it leaked into the result.
    const lists = [makeList({ id: 'inbox', is_default: true, task_count: 999 })];
    const counts = computeSidebarCounts([], lists);
    expect(counts.lists['inbox']).toBe(0);
  });
});

// ── AC-S5-08 — list drag-reorder wires the dead reorderList() bridge call ───

describe('list drag-to-reorder (AC-S5-08)', () => {
  it('list_drag_reorder_calls_reorder_list', () => {
    const onReorder = vi.fn();
    const container = makeContainer();
    const list1 = makeList({ id: 'list-1', name: 'List One', is_default: false, position: 'B' });
    const list2 = makeList({ id: 'list-2', name: 'List Two', is_default: false, position: 'D' });
    renderListsSidebar(container, [list1, list2], { onReorder });

    const row1 = container.querySelector('[data-list-id="list-1"]') as HTMLElement;
    const row2 = container.querySelector('[data-list-id="list-2"]') as HTMLElement;
    const grip2 = row2.querySelector('.lists-rail__drag-handle') as HTMLElement;
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();

    // Drag list2, drop it ABOVE list1 (negative clientY selects the top half
    // of row1's zero-height jsdom bounding rect — same technique the task
    // item's own DnD tests use).
    const dragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
    const dragData = { setData: vi.fn(), effectAllowed: '' };
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: dragData,
    });
    grip2.dispatchEvent(dragStart);

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => 'list-2' },
    });
    Object.defineProperty(drop, 'clientY', { value: -1 });
    row1.dispatchEvent(drop);

    expect(onReorder).toHaveBeenCalledTimes(1);
    const [reorderedId, newPosition] = onReorder.mock.calls[0];
    expect(reorderedId).toBe('list-2');
    // Strictly less than list1's position ('B') — the rank sorts BEFORE it.
    expect(newPosition < 'B').toBe(true);
    expect(dragData.setData).toHaveBeenCalledWith('text/plain', 'list-2');
  });

  it('supports Alt+Arrow reordering from the grip', () => {
    const onReorder = vi.fn();
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'list-1', is_default: false, position: 'B' }),
      makeList({ id: 'list-2', is_default: false, position: 'D' }),
      makeList({ id: 'list-3', is_default: false, position: 'F' }),
    ], { onReorder });
    const grip = container.querySelector('[data-list-id="list-2"] .lists-rail__drag-handle') as HTMLElement;
    grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 'ArrowUp' }));
    expect(onReorder).toHaveBeenCalledWith('list-2', expect.stringMatching(/^[0-9A-Za-z]+$/));
    const rank = onReorder.mock.calls[0][1] as string;
    expect(rank < 'B').toBe(true);
    expect(rank < 'D').toBe(true);
  });

  it('rejects foreign text/plain drops', () => {
    const onReorder = vi.fn();
    const container = makeContainer();
    renderListsSidebar(container, [
      makeList({ id: 'list-1', is_default: false, position: 'B' }),
      makeList({ id: 'list-2', is_default: false, position: 'D' }),
    ], { onReorder });
    const row = container.querySelector('[data-list-id="list-1"]') as HTMLElement;
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'foreign-id' } });
    Object.defineProperty(drop, 'clientY', { value: -1 });
    row.dispatchEvent(drop);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('the default (Inbox) list is never draggable — it is pinned first', () => {
    const onReorder = vi.fn();
    const container = makeContainer();
    renderListsSidebar(container, [makeList({ id: 'inbox', is_default: true })], { onReorder });
    const row = container.querySelector('[data-list-id="inbox"]') as HTMLElement;
    expect(row.draggable).toBe(false);
  });

  it('drops nothing when onReorder is not provided (no crash, no drag wiring)', () => {
    const container = makeContainer();
    const list1 = makeList({ id: 'list-1', is_default: false, position: 'B' });
    renderListsSidebar(container, [list1]);
    const row = container.querySelector('[data-list-id="list-1"]') as HTMLElement;
    expect(row.draggable).toBe(false);
  });
});

// ── AC-S5-03 — live counts refresh through the REAL controller ─────────────
//
// Green-but-shallow watch (spec CONSTRAINT): a test that calls loadLists()
// directly proves nothing — it tests the function that already worked. This
// mutates a task by calling TasksController's OWN mutate()-wrapped method
// (the same legitimacy tasks_error_surfacing.test.ts's white-box style
// already established for AC-X-08) so the REAL `jin:tasks-changed` event
// fires and ListsController's `@window` listener reacts to it — never a
// hand-fired synthetic event and never a direct loadLists() call.

type TasksControllerInternals = TasksController & {
  handleCreateTask: (title: string, due?: string) => Promise<void>;
};

describe('S5 — live counts refresh (AC-S5-03)', () => {
  let app: Application;

  beforeEach(async () => {
    stubDialogPrototype();
    document.body.innerHTML = '';

    // A mutable backing store so listTasks() reflects createTask()'s effect —
    // the real shape of "the count changed because the data changed", not a
    // canned before/after pair.
    const store: TaskDto[] = [makeTask({ id: 'seed-1', status: 'todo', list: 'inbox' })];

    vi.spyOn(InvokeModule, 'listLists').mockResolvedValue([
      makeList({ id: 'inbox', is_default: true, position: 'A' }),
      makeList({ id: 'work', name: 'Work', is_default: false, position: 'C' }),
      makeList({ id: 'archive', name: 'Archive', is_default: false, position: 'E' }),
    ]);
    vi.spyOn(InvokeModule, 'listTasks').mockImplementation(async () => [...store]);
    vi.spyOn(InvokeModule, 'listTags').mockResolvedValue([]);
    vi.spyOn(InvokeModule, 'createTask').mockImplementation(async (input) => {
      const created = makeTask({ id: `new-${store.length}`, title: input.title, list: input.list ?? 'inbox' });
      store.push(created);
      return created;
    });
    vi.spyOn(InvokeModule, 'deleteTask').mockResolvedValue(makeTask({ id: 'seed-1' }));
    vi.spyOn(InvokeModule, 'reorderList').mockResolvedValue(makeList({ id: 'work' }));

    document.body.innerHTML = BODY_CONTENT;
    app = Application.start(document.documentElement, defaultSchema);
    app.register('tasks', TasksController);
    app.register('lists', ListsController);

    await new Promise<void>((res) => setTimeout(res, 250));
  });

  afterEach(() => {
    app?.stop();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function getTasksController(): TasksControllerInternals {
    const el = document.querySelector('[data-controller~="tasks"]') as HTMLElement;
    return app.getControllerForElementAndIdentifier(el, 'tasks') as TasksControllerInternals;
  }

  function inboxBadge(): string | null | undefined {
    return document.querySelector('[data-smart-view="inbox"] .lists-rail__count')?.textContent;
  }

  it('counts_refresh_after_task_create', async () => {
    // Given the Inbox scope shows a badge count of N...
    expect(inboxBadge()).toBe('1');

    // ...when the user creates a task in Inbox through the controller...
    await getTasksController().handleCreateTask('A brand new task');
    await new Promise<void>((res) => setTimeout(res, 100));

    // ...the badge SHALL read N+1 without a page reload.
    expect(inboxBadge()).toBe('2');
  });

  // ── AC-S5-08, controller-level: reorderList is the REAL bridge call ──────
  //
  // The pure render-level test above (`list drag-to-reorder`) proves the
  // render layer's onReorder callback wiring; this proves the OTHER half —
  // that ListsController's handleReorder() actually invokes the real
  // `reorderList` bridge function (not just an internal callback) when a
  // real drag/drop sequence plays out on the REAL mounted rail.
  it('list_drag_reorder_calls_reorder_list — through the real bridge call', async () => {
    // Inbox is pinned first and never draggable (no drag/drop listeners at
    // all on its row) — drag "archive" and drop it onto "work" (both
    // non-default) for a genuine, legal reorder.
    const workRow = document.querySelector('[data-list-id="work"]') as HTMLElement;
    const archiveRow = document.querySelector('[data-list-id="archive"]') as HTMLElement;
    const archiveGrip = archiveRow.querySelector('.lists-rail__drag-handle') as HTMLElement;
    expect(workRow, 'work row must be rendered').not.toBeNull();
    expect(archiveRow, 'archive row must be rendered').not.toBeNull();

    const dragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: { setData: vi.fn(), effectAllowed: '' },
    });
    archiveGrip.dispatchEvent(dragStart);

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'archive' } });
    Object.defineProperty(drop, 'clientY', { value: -1 });
    workRow.dispatchEvent(drop);

    await new Promise<void>((res) => setTimeout(res, 100));

    expect(InvokeModule.reorderList).toHaveBeenCalledTimes(1);
    const [reorderedId] = vi.mocked(InvokeModule.reorderList).mock.calls[0];
    expect(reorderedId).toBe('archive');
  });
});
