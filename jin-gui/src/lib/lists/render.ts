/**
 * lists/render.ts — DOM rendering functions for the Lists sidebar rail.
 *
 * No raw innerHTML string injection — only createElement + textContent/attribute assignment.
 * The controller (ListsController) calls these as a thin adapter.
 *
 * Tested by: src/__tests__/lists_controller.test.ts
 */

import type { ListDto } from '../../types/dto';
import { sortLists, listSelectOptions } from './transform';
import { between } from '../tasks/rank';
import type { TaskScope } from '../tasks/scopes';
import type { SidebarCounts } from './counts';
import { applyJinColor } from '../ui/color_picker';

let draggedListId: string | null = null;

// ── Callbacks ─────────────────────────────────────────────────────────────────

export interface ListRowCallbacks {
  /** Called when the list row is clicked (selects it as the active scope). */
  onSelect?: (listId: string) => void;
  /** Called when the edit button is clicked. */
  onEditRequest?: (list: ListDto) => void;
  /** Called when the delete button is clicked. */
  onDeleteRequest?: (list: ListDto) => void;
  /**
   * S5: called after a non-default list row is dropped onto another row —
   * `position` is a fresh fractional rank key computed by `between()`, ready
   * to pass straight to the `reorderList(id, position)` bridge call.
   */
  onReorder?: (listId: string, position: string) => void;
}

/** S5: render context that isn't a callback — counts + the active scope. */
export interface ListsRailRenderOptions extends ListRowCallbacks {
  /**
   * Client-side open-task count per list id (lib/lists/counts.ts,
   * `computeSidebarCounts`). ⚠️ Never fall back to `ListDto.task_count` here
   * — it counts `done` tasks too and would make the badge lie again.
   * A list id absent from this map renders a `0` badge.
   */
  counts?: Record<string, number>;
  /** The currently active scope — drives the `aria-current` indicator (AC-S5-02). */
  activeScope?: TaskScope | null;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

/**
 * renderListsSidebar — populate the lists sidebar rail.
 *
 * - Clears existing rows.
 * - Renders one <li> per list with: color swatch, icon, name, and a
 *   CLIENT-SIDE open-task count (never `ListDto.task_count` — S5).
 * - Inbox (is_default) is always first.
 * - Edit + delete buttons are shown for all non-default lists.
 *   (Inbox cannot be deleted — the backend enforces this; UI hides the button.)
 * - Exactly the row matching `options.activeScope` (a `{kind:'list'}` scope
 *   whose id matches this list) carries `aria-current="true"` (AC-S5-02).
 * - Non-default rows are drag-reorderable when `options.onReorder` is given
 *   (AC-S5-08); Inbox is pinned first by `sortLists` and never draggable.
 */
export function renderListsSidebar(
  container: HTMLElement,
  lists: ListDto[],
  options?: ListsRailRenderOptions
): void {
  container.innerHTML = '';

  const sorted = sortLists(lists);
  for (const list of sorted) {
    container.appendChild(buildListRow(list, options));
  }
}

// ── Smart views (S5 — Approach §4) ───────────────────────────────────────────

interface SmartViewSpec {
  id: 'inbox' | 'today' | 'upcoming' | 'flexible' | 'completed';
  label: string;
  icon: string;
}

/**
 * The four smart views, in the fixed rail order (AC-S5-01). Icon names are
 * all already registered in lib/icons/index.ts (inbox, sun, calendar-days,
 * check-circle) — no new icon-registry entries needed for this story.
 */
const SMART_VIEWS: readonly SmartViewSpec[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar-days' },
  { id: 'flexible', label: 'Flexible', icon: 'list-todo' },
  { id: 'completed', label: 'Completed', icon: 'check-circle' },
];

export interface SmartViewCallbacks {
  onSelect?: (id: 'inbox' | 'today' | 'upcoming' | 'flexible' | 'completed') => void;
}

/**
 * renderSmartViews — populate the Smart Views group above the Lists group
 * (S5 action plan item 3). Exactly four rows, fixed order, never draggable.
 * `Completed` renders no count badge (Approach §4 — "a badge that never
 * goes down is noise", doubly true for a view that IS all closed tasks).
 */
export function renderSmartViews(
  container: HTMLElement,
  counts: SidebarCounts,
  activeScope: TaskScope | null | undefined,
  callbacks?: SmartViewCallbacks,
): void {
  container.innerHTML = '';

  for (const view of SMART_VIEWS) {
    const li = document.createElement('li');
    li.className = 'lists-rail__row lists-rail__row--smart jin-navigation-row';
    li.dataset.smartView = view.id;

    const isActive = activeScope?.kind === 'smart' && activeScope.id === view.id;
    li.classList.toggle('lists-rail__row--active', isActive);
    if (isActive) {
      li.setAttribute('aria-current', 'page');
    } else {
      li.removeAttribute('aria-current');
    }

    const icon = document.createElement('i');
    icon.className = 'jin-navigation-row__icon';
    icon.setAttribute('data-lucide', view.icon);
    icon.setAttribute('aria-hidden', 'true');
    li.appendChild(icon);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lists-rail__row-btn tap-target';
    btn.dataset.smartView = view.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'lists-rail__name jin-navigation-row__label';
    nameEl.textContent = view.label;
    btn.appendChild(nameEl);

    if (view.id === 'completed') {
      btn.setAttribute('aria-label', view.label);
    } else {
      const count = counts.smartViews[view.id];
      const countEl = document.createElement('span');
      countEl.className = 'lists-rail__count jin-navigation-row__meta';
      countEl.textContent = String(count);
      btn.appendChild(countEl);
      btn.setAttribute('aria-label', `${view.label} — ${count} tasks`);
    }

    li.appendChild(btn);

    if (callbacks?.onSelect) {
      const onSelect = callbacks.onSelect;
      btn.addEventListener('click', () => onSelect(view.id));
    }

    container.appendChild(li);
  }
}

// ── Filter select ─────────────────────────────────────────────────────────────

/**
 * populateListFilter — populate a <select> with list options.
 *
 * Preserves the first "All Lists" <option value=""> if it exists, then
 * appends one <option> per list. Subsequent calls re-render the non-empty options
 * only (first option is kept intact).
 */
export function populateListFilter(select: HTMLSelectElement, lists: ListDto[]): void {
  // Remove all non-placeholder options
  const placeholder = select.querySelector('option[value=""]');
  select.innerHTML = '';
  if (placeholder) {
    select.appendChild(placeholder);
  }

  const options = listSelectOptions(lists);
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    el.dataset.color = opt.color;
    select.appendChild(el);
  }
}

// ── Tag chips (P4) ────────────────────────────────────────────────────────────

/**
 * buildTagChips — render a group of tag chips for a task item (row or card).
 *
 * Returns a container element if tags is non-empty, or null if empty.
 * The container carries `.task-item__tags` and each chip is a `.task-tag-chip`
 * span with `data-tag-slug` set. Shared verbatim by both `buildTaskItem`
 * variants (S2 — one item, two skins).
 */
export function buildTagChips(tags: string[] | undefined): HTMLElement | null {
  if (!tags || tags.length === 0) return null;

  const container = document.createElement('span');
  container.className = 'task-item__tags';
  container.setAttribute('aria-label', `Tags: ${tags.join(', ')}`);

  for (const slug of tags) {
    const chip = document.createElement('span');
    chip.className = 'task-tag-chip';
    chip.dataset.tagSlug = slug;
    chip.textContent = slug;
    chip.setAttribute('aria-hidden', 'true'); // container aria-label covers all
    container.appendChild(chip);
  }

  return container;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildListRow(list: ListDto, options?: ListsRailRenderOptions): HTMLElement {
  const li = document.createElement('li');
  li.className = 'lists-rail__row jin-navigation-row jin-navigation-row--actions';
  if (list.is_default) li.classList.add('lists-rail__row--default');
  li.dataset.listId = list.id;
  // S5: stashed for sibling-position lookups during drag-reorder (below).
  li.dataset.listPosition = list.position;

  // S5 (AC-S5-02): exactly the row matching the active {kind:'list'} scope
  // carries aria-current — the active-selection indicator this rail had none
  // of before.
  const isActive = options?.activeScope?.kind === 'list' && options.activeScope.id === list.id;
  li.classList.toggle('lists-rail__row--active', isActive);
  if (isActive) {
    li.setAttribute('aria-current', 'page');
  } else {
    li.removeAttribute('aria-current');
  }

  // The colour dot is the single leading identity cue for a user list. When
  // manual ordering is available, that same 28px target is the drag/keyboard
  // handle; a separate grip would make the narrow rail look like a toolbox.
  let dragGrip: HTMLButtonElement | null = null;
  const swatch = document.createElement('span');
  swatch.className = 'lists-rail__swatch';
  applyJinColor(swatch, list.color);
  swatch.setAttribute('aria-hidden', 'true');
  if (!list.is_default && options?.onReorder) {
    li.classList.add('lists-rail__row--reorderable');
    dragGrip = document.createElement('button');
    dragGrip.type = 'button';
    // Keep the established hook for DnD tests/integration; the visual is the
    // dot identity control, not a second, visible grip.
    dragGrip.className = 'lists-rail__identity-control lists-rail__drag-handle tap-target';
    dragGrip.draggable = true;
    dragGrip.setAttribute('aria-label', `Reorder list "${list.name}". Use Alt+Up or Alt+Down to move it.`);
    dragGrip.appendChild(swatch);
    li.appendChild(dragGrip);
  } else {
    li.appendChild(swatch);
  }

  // Main button (name + count)
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lists-rail__row-btn tap-target';
  btn.dataset.listId = list.id;

  // S5: the badge is a CLIENT-SIDE open-task count (computeSidebarCounts),
  // never `list.task_count` — that field counts `done` tasks too
  // (index/query.rs) and a badge sourced from it never goes down.
  const count = options?.counts?.[list.id] ?? 0;
  const displayName = list.is_default ? 'Inbox list' : list.name;
  btn.setAttribute('aria-label', `${displayName} — ${count} tasks`);

  const nameEl = document.createElement('span');
  nameEl.className = 'lists-rail__name jin-navigation-row__label';
  nameEl.textContent = displayName;
  btn.appendChild(nameEl);

  const countEl = document.createElement('span');
  countEl.className = 'lists-rail__count jin-navigation-row__meta';
  countEl.textContent = String(count);
  btn.appendChild(countEl);

  li.appendChild(btn);

  if (options?.onSelect) {
    const onSelect = options.onSelect;
    btn.addEventListener('click', () => onSelect(list.id));
  }

  // A compact Notes-style More menu avoids putting destructive controls in
  // the row itself. The menu owns the current Edit/Delete callbacks.
  if (!list.is_default) {
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'lists-rail__menu-btn jin-navigation-row__actions jin-control jin-control--icon tap-target';
    menuButton.setAttribute('aria-label', `Actions for list "${list.name}"`);
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');
    const menuIcon = document.createElement('i');
    menuIcon.setAttribute('data-lucide', 'ellipsis-vertical');
    menuIcon.setAttribute('aria-hidden', 'true');
    menuButton.appendChild(menuIcon);
    li.appendChild(menuButton);

    const menu = document.createElement('div');
    menu.className = 'lists-rail__menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('hidden', '');

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'lists-rail__edit-btn lists-rail__menuitem';
    editBtn.setAttribute('role', 'menuitem');
    editBtn.setAttribute('aria-label', `Edit list "${list.name}"`);
    const editIcon = document.createElement('i');
    editIcon.setAttribute('data-lucide', 'pencil');
    editIcon.setAttribute('aria-hidden', 'true');
    editBtn.appendChild(editIcon);
    editBtn.appendChild(document.createTextNode('Edit list'));
    menu.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'lists-rail__delete-btn lists-rail__menuitem';
    deleteBtn.setAttribute('role', 'menuitem');
    deleteBtn.setAttribute('aria-label', `Delete list "${list.name}"`);
    const deleteIcon = document.createElement('i');
    deleteIcon.setAttribute('data-lucide', 'trash-2');
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.appendChild(document.createTextNode('Delete list'));
    menu.appendChild(deleteBtn);
    li.appendChild(menu);

    const closeMenu = () => {
      menuButton.setAttribute('aria-expanded', 'false');
      menu.setAttribute('hidden', '');
      document.removeEventListener('pointerdown', onOutsidePointerDown);
    };
    const onOutsidePointerDown = (event: Event) => {
      if (!li.contains(event.target as Node)) closeMenu();
    };
    const openMenu = () => {
      menuButton.setAttribute('aria-expanded', 'true');
      menu.removeAttribute('hidden');
      document.addEventListener('pointerdown', onOutsidePointerDown);
    };
    const menuItems = [editBtn, deleteBtn];
    const focusMenuItem = (index: number) => {
      menuItems[(index + menuItems.length) % menuItems.length]?.focus();
    };

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (menuButton.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      } else {
        openMenu();
        // Native keyboard activation dispatches a click with detail 0. Move
        // directly into the menu so Tab continues through its real actions.
        if (event.detail === 0) focusMenuItem(0);
      }
    });
    menuButton.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu();
      focusMenuItem(event.key === 'ArrowDown' || event.key === 'Home' ? 0 : menuItems.length - 1);
    });
    li.addEventListener('keydown', (event) => {
      if (menuButton.getAttribute('aria-expanded') !== 'true') return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMenu();
        menuButton.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') {
        focusMenuItem(0);
        return;
      }
      if (event.key === 'End') {
        focusMenuItem(menuItems.length - 1);
        return;
      }
      const currentIndex = menuItems.indexOf(event.target as HTMLButtonElement);
      focusMenuItem((currentIndex === -1 ? 0 : currentIndex) + (event.key === 'ArrowDown' ? 1 : -1));
    });
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeMenu();
      options?.onEditRequest?.(list);
    });
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeMenu();
      options?.onDeleteRequest?.(list);
    });
  }

  // ── S5: drag-to-reorder (AC-S5-08) ────────────────────────────────────────
  // Non-default lists only — Inbox is pinned first by sortLists() and a
  // reorder that could move it would contradict that pin. Mirrors the task
  // item's own row-to-row DnD (lib/tasks/item.ts): dragstart stashes the
  // dragged list id; drop on a sibling computes `between()` from the
  // hover-half (top vs bottom) and calls back with a fresh rank key.
  if (dragGrip && options?.onReorder) {
    const onReorder = options.onReorder;
    const draggableLists = () => Array.from(li.parentElement?.children ?? []).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.dataset.listId !== undefined &&
        !child.classList.contains('lists-rail__row--default'),
    );

    const moveBy = (offset: -1 | 1) => {
      const siblings = draggableLists();
      const index = siblings.indexOf(li);
      const targetIndex = index + offset;
      if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) return;
      const above = offset < 0 ? siblings[targetIndex - 1] : siblings[index + 1];
      const below = offset < 0 ? siblings[targetIndex] : siblings[index + 2];
      onReorder(list.id, between(above?.dataset.listPosition ?? null, below?.dataset.listPosition ?? null));
    };

    dragGrip.addEventListener('dragstart', (e: DragEvent) => {
      draggedListId = list.id;
      if (e.dataTransfer) {
        e.dataTransfer.setData('application/x-jin-list-id', list.id);
        e.dataTransfer.setData('text/plain', list.id);
        e.dataTransfer.effectAllowed = 'move';
      }
      li.classList.add('lists-rail__row--dragging');
    });

    dragGrip.addEventListener('dragend', () => {
      draggedListId = null;
      li.classList.remove('lists-rail__row--dragging');
    });

    dragGrip.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      moveBy(event.key === 'ArrowUp' ? -1 : 1);
    });

    li.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    li.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      const draggedId =
        e.dataTransfer?.getData('application/x-jin-list-id') ||
        e.dataTransfer?.getData('text/plain') ||
        draggedListId || '';
      if (!draggedId || draggedId === list.id) return;

      // `text/plain` is only a fallback for native/WebView MIME loss. The id
      // still has to name a reorderable sibling in this rail.
      const sourceExists = draggableLists().some((row) => row.dataset.listId === draggedId);
      if (!sourceExists) return;

      const parentList = li.parentElement;
      const siblings = Array.from(parentList?.children ?? []).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.dataset.listId !== undefined && child.dataset.listId !== draggedId,
      );
      const idx = siblings.indexOf(li);

      const rect = li.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;

      let abovePos: string | null;
      let belowPos: string | null;
      if (isAbove) {
        const prevSibling = siblings[idx - 1];
        abovePos = prevSibling?.dataset.listPosition ?? null;
        belowPos = list.position;
      } else {
        abovePos = list.position;
        const nextSibling = siblings[idx + 1];
        belowPos = nextSibling?.dataset.listPosition ?? null;
      }

      const newPosition = between(abovePos, belowPos);
      onReorder(draggedId, newPosition);
    });
  }

  return li;
}
