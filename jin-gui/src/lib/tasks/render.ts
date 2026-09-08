/**
 * tasks/render.ts — DOM rendering functions for the Tasks browse + detail view.
 *
 * All rendering uses <template> cloning (list rows) or createElement (detail panels).
 * No raw innerHTML string injection — only template cloning + textContent/attribute assignment.
 *
 * HIG mandate: status is shown by color AND glyph AND label (WCAG 1.4.1 color-independence).
 *
 * The controller (TasksController) calls these as a thin adapter.
 * Tested by: src/__tests__/tasks_controller.test.ts
 *
 * P1 additions:
 *   - Status circle is a standalone button (.task-item__status-btn) → toggle complete/reopen.
 *   - Hover action cluster (.task-item__actions) with edit + delete buttons.
 *   - Add-task row always rendered at bottom of list for rapid in-place creation.
 *   - Detail panel shows body + save/cancel for title+body edit.
 *
 * S2 (one item, two skins): the List row and Board card are both built by
 * `buildTaskItem` (item.ts) from ONE `<template id="tmpl-task-item">` — see
 * that module for the item builder and its callback contract
 * (`TaskRowCallbacks`, re-exported here for backward-compat imports).
 *
 * S4 (Kanban by status): `renderBoardView` groups by `TaskStatus` now, not
 * section — List and Board are genuinely different tools (List = planning
 * surface grouped by section; Board = pushing work forward through a fixed
 * Todo/Doing/Done pipeline). `renderListViewWithSections` is unaffected —
 * section grouping stays a LIST-view-only concern.
 */

import type { TaskDto, TaskBacklinkDto, SectionDto, ReminderDto } from '../../types/dto';
import { applyJinColor } from '../ui/color_picker';
import {
  taskStatusLabel,
  taskStatusGlyph,
  taskPriorityLabel,
  taskPriorityGlyph,
  formatTaskDue,
  formatReminderLabel,
  groupTasksBySection,
  sortTasksForMode,
  legalNextStatuses,
  computeSubtaskDisplayInfo,
  partitionParentsAndChildren,
  type TaskGroup,
  type SubtaskDisplayInfo,
} from './transform';
import { listNameById } from '../lists/transform';
import type { BrowseNavigateCallback } from '../notes/render';
import { buildTaskItem, createTaskDragPreview, wirePointerDrag, type TaskRowCallbacks } from './item';
import { configureTaskCompletion } from './completion';
import { between } from './rank';
import type { FlexibleTaskGroup } from './scopes';

// Re-exported for backward-compat call sites (S1-era imports of these symbols
// from render.ts): the item builder and its callback contract now live in
// item.ts (S2 — one item, two skins), alongside the item's own due-chip
// renderer (moved from here since it renders a task-item child, not a
// section/board/detail concern).
export { buildTaskItem, type TaskRowCallbacks };
export { buildDueChipGroup } from './item';

// ── Interface types ───────────────────────────────────────────────────────────

/** References to the named target elements managed by TasksController. */
export interface TasksViewElements {
  listPanel: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  loadingState: HTMLElement;
  detailPanel: HTMLElement;
  detailLoadingState: HTMLElement;
  detailNotFoundState: HTMLElement;
  detailContent: HTMLElement;
}

/**
 * References to the <template> elements used for dynamic rows.
 * S2: `taskRow` retired in favor of `taskItem` — the ONE template cloned for
 * both the List row and the Board card (`#tmpl-task-item`, item.ts).
 */
export interface TasksTemplates {
  taskItem: HTMLTemplateElement;
  backlinkRow: HTMLTemplateElement;
}

// TaskRowCallbacks now lives in item.ts (imported + re-exported above).

/**
 * Section-level callbacks (P5/P6 section management).
 */
export interface SectionCallbacks {
  /** Called when the rename field for a section header is confirmed. */
  onRenameSection?: (sectionId: string, newName: string) => void;
  /** Called when the delete button on a section header is clicked. */
  onDeleteSection?: (sectionId: string, sectionName: string) => void;
  /** Called when the "Add Section" button is clicked. */
  onAddSection?: () => void;
  /** Called when the section-assign dropdown changes on a task. */
  onAssignSection?: (taskId: string, sectionId: string | null) => void;
  /**
   * S8 (AC-S8-01): called after a NAMED section header is dropped onto a
   * sibling section — `position` is a fresh fractional rank key computed by
   * `between()`, ready to pass straight to the `reorderSection(listId,
   * sectionId, position)` bridge call. Mirrors `ListRowCallbacks.onReorder`
   * (lib/lists/render.ts, AC-S5-08) exactly. The "No Section" bucket
   * (`sectionId === null`) is never draggable — there is nothing to reorder
   * it against, the same way Inbox is pinned first in the lists rail.
   */
  onReorderSection?: (sectionId: string, position: string) => void;
}

/**
 * ITEM 5: Per-field callbacks for the task detail editor.
 * When provided to renderTaskPane, each attribute becomes editable in-place.
 * Omit the interface entirely (pass undefined) to get the existing read-only view.
 */
export interface TaskDetailCallbacks {
  /** Called on title blur / Enter. Should call edit_task({title}). */
  onSaveTitle?: (taskId: string, title: string) => Promise<void>;
  /** Called on body blur (only when content changed). Should call edit_task({body}). */
  onSaveBody?: (taskId: string, body: string) => Promise<void>;
  /** Called when the status selector changes. Should call set_task_status. */
  onSaveStatus?: (taskId: string, status: string) => Promise<void>;
  /** Called when the priority selector changes. Should call edit_task({priority}). */
  onSavePriority?: (taskId: string, priority: string) => Promise<void>;
  /**
   * Opens the shared calendar for due-date editing.
   * The controller calls onSelected(dueString) after persisting the change.
   * dueString is '' when the user cleared the date.
   */
  onPickDue?: (currentDue: string | null, onSelected: (dueString: string) => void) => void;
  /** Called when the inline "Clear" affordance is clicked. Should call edit_task({clear_due:true}). */
  onClearDue?: (taskId: string) => Promise<void>;
  /** Called when the list selector changes. Should call edit_task({list}). */
  onSaveList?: (taskId: string, listId: string) => Promise<void>;
  /** Called when section selector changes. sectionId null = clear. Should call edit_task({section_id}) / clear_section. */
  onSaveSection?: (taskId: string, sectionId: string | null) => Promise<void>;
  /** Called when tags change (remove or add). Full new slug array. Should call edit_task({tags}). */
  onSaveTags?: (taskId: string, tags: string[]) => Promise<void>;
  /**
   * S8 (AC-S8-02): slug -> color map for every known tag (from `listTags()`),
   * used to preselect the tag color picker's current swatch and to tint each
   * chip's own color dot. A slug absent from this map (e.g. a brand-new tag
   * not yet round-tripped through `listTags()`) falls back to 'accent'.
   */
  tagColors?: Record<string, string>;
  /**
   * S8 (AC-S8-02): called when the user clicks a chip's color dot to open the
   * tag color picker modal. The controller opens a `JinModal`-hosted picker
   * and, on a color pick, calls `setTagColor(slug, color)` (the dead bridge
   * function this story wires).
   */
  onPickTagColor?: (slug: string, currentColor: string) => void;
  /** All known lists (for the list selector). */
  availableLists?: Array<{ id: string; name: string }>;
  /** Sections of the task's current list (for the section selector). */
  availableSections?: SectionDto[];
  /** All known tag slugs (for datalist suggestions on the add-tag input). */
  allTagSlugs?: string[];
  // ── S6: Subtasks section ──────────────────────────────────────────────────
  /** This task's direct children (empty/omitted when it has none, or when `task` is itself a subtask — depth is capped at one). */
  subtasks?: TaskDto[];
  /** Creates a child. Resolve true only after persistence, so the composer can retain a failed draft. */
  onAddSubtask?: (parentId: string, title: string) => Promise<boolean>;
  /** Called when a subtask row's status checkbox is toggled. Should call set_task_status. */
  onToggleSubtaskStatus?: (subtaskId: string, currentStatus: string) => void;
  /** Called when a subtask row's delete button is activated. Controller opens the delete confirm dialog. */
  onDeleteSubtask?: (subtaskId: string, subtaskTitle: string) => void;
  /** Called when a subtask row's title is clicked. Selects that subtask in the pane. */
  onSelectSubtask?: (subtaskId: string) => void;
}

// ── S7: selection resolution (single-select fallback vs. bulk set) ──────────

/**
 * resolveItemSelected — is `taskId` selected, for aria-selected/highlight
 * purposes? When `selectedTaskIds` is provided AND non-empty (S7 bulk
 * multi-select is active — Approach: "click, shift-click range, cmd/ctrl-
 * click toggle"), membership in that set governs. Otherwise falls back to
 * the pre-S7 single-select comparison against `selectedTaskId` — every
 * existing call site that never passes `selectedTaskIds` (or passes an
 * empty one) keeps its EXACT pre-S7 behavior (AC-S3-03: exactly one item
 * selected at a time).
 */
function resolveItemSelected(
  taskId: string,
  selectedTaskId: string | null | undefined,
  selectedTaskIds: ReadonlySet<string> | undefined,
): boolean {
  if (selectedTaskIds && selectedTaskIds.size > 0) return selectedTaskIds.has(taskId);
  return taskId === selectedTaskId;
}

/**
 * ensureRovingTabStop — S7 roving-tabindex fallback: if NOTHING in
 * `container` ended up with `tabindex="0"` (no selection is active yet —
 * fresh render, or the pane was just closed), promote the FIRST rendered
 * item's body button to the default Tab stop so the list is never entirely
 * Tab-unreachable before the user has clicked or arrow-key-navigated
 * anything.
 */
function ensureRovingTabStop(container: HTMLElement): void {
  if (container.querySelector('[tabindex="0"]')) return;
  const first = container.querySelector<HTMLElement>('.task-item__body');
  if (first) first.tabIndex = 0;
}

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

export function showTasksListLoading(el: TasksViewElements): void {
  el.loadingState.classList.remove('hidden');
  el.list.classList.add('hidden');
  el.emptyState.classList.add('hidden');
}

export function hideTasksListLoading(el: TasksViewElements): void {
  el.loadingState.classList.add('hidden');
  el.list.classList.remove('hidden');
}

export function showTasksListEmptyState(el: TasksViewElements): void {
  el.list.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
}

// ── List rendering ────────────────────────────────────────────────────────────

/**
 * renderTasksList — populate the tasks list.
 *
 * - Clears existing rows.
 * - Clones the shared task-item <template> for each task (variant: 'row').
 * - Status is shown by glyph AND text label (never color-only — WCAG 1.4.1).
 * - Priority is shown by glyph AND text label.
 * - Fires onNavigate when a row's main area is activated.
 * - P1: wires status toggle, delete, edit, and create-in-place callbacks.
 *
 * `nestChildren` (S6, default `false`): when true (a single list is the
 * active scope — AC-S6-13), children render nested directly beneath their
 * parent, indented/collapsible, and are excluded from the top-level rows
 * (`.task-item--child`, no drag). When false ("All Lists" / no single list
 * scope), every task — including children — renders standalone: a parent
 * gets the `2/5` progress badge (AC-S6-11) and a child gets a parent
 * breadcrumb chip (Approach §6 action plan item 6).
 *
 * `subtaskDisplayInfo` (S5, optional): a pre-computed
 * `computeSubtaskDisplayInfo` map to use INSTEAD of deriving one from
 * `tasks`. A smart view's `tasks` here is already narrowed by `applyScope`
 * (e.g. Today = open + due today-or-earlier) — a parent with no due date of
 * its own would be filtered OUT of that narrowed set, which would silently
 * blank its child's breadcrumb chip if this function recomputed the map
 * from `tasks` alone (AC-S6-10). The caller (TasksController) resolves this
 * map against the FULL fetched task set, before scoping, and passes it
 * through. Omit it (the pre-S5 call shape) to fall back to deriving it from
 * `tasks` as before — unaffected for a list scope, where parent + child
 * always share the same fetched set already (Approach §6: "a subtask lives
 * with its parent").
 *
 * `onAddSection` (optional): renders the same "Add Section" affordance
 * `renderListViewWithSections` renders via `SectionCallbacks.onAddSection`.
 * A list with zero sections never reaches `renderListViewWithSections` (its
 * gate requires `currentSections.length > 0`), so without this hook here a
 * sectionless list could never create its first section — the only surviving
 * Add Section control lived behind a gate that required a section to already
 * exist. The caller passes this only when a specific list scope is active
 * (never for "All Lists").
 */
export function renderTasksList(
  el: TasksViewElements,
  templates: TasksTemplates,
  tasks: TaskDto[],
  onNavigate: BrowseNavigateCallback,
  callbacks?: TaskRowCallbacks,
  selectedTaskId?: string | null,
  nestChildren: boolean = false,
  subtaskDisplayInfo?: Map<string, SubtaskDisplayInfo>,
  selectedTaskIds?: ReadonlySet<string>,
  onAddSection?: () => void,
): void {
  el.list.innerHTML = '';

  if (tasks.length === 0) {
    showTasksListEmptyState(el);
  } else {
    el.emptyState.classList.add('hidden');
    el.list.classList.remove('hidden');
    if (nestChildren) {
      appendTasksWithNesting(el.list, tasks, templates, onNavigate, callbacks, selectedTaskId, selectedTaskIds);
    } else {
      const displayInfo = subtaskDisplayInfo ?? computeSubtaskDisplayInfo(tasks);
      for (const task of tasks) {
        el.list.appendChild(
          buildTaskItem(
            templates.taskItem,
            task,
            'row',
            onNavigate,
            callbacks,
            resolveItemSelected(task.id, selectedTaskId, selectedTaskIds),
            displayInfo.get(task.id),
          ),
        );
      }
    }
  }

  // P1 S1.4: always-visible add-task row at bottom of list.
  if (callbacks?.onCreateTask) {
    el.list.appendChild(buildAddTaskRow(callbacks.onCreateTask, callbacks.onPickDueForCreate));
    el.list.classList.remove('hidden');
  }

  // Bug B fix: bootstrap path for a sectionless list's first section (see
  // the `onAddSection` doc above).
  if (onAddSection) {
    el.list.appendChild(buildAddSectionRow(onAddSection));
    el.list.classList.remove('hidden');
  }

  ensureRovingTabStop(el.list);
}

/** Render Flexible as calm list groups, preserving list order and manual task ranks. */
export function renderFlexibleTaskGroups(
  el: TasksViewElements,
  templates: TasksTemplates,
  groups: FlexibleTaskGroup[],
  onNavigate: BrowseNavigateCallback,
  callbacks?: TaskRowCallbacks,
  selectedTaskId?: string | null,
  subtaskDisplayInfo?: Map<string, SubtaskDisplayInfo>,
  selectedTaskIds?: ReadonlySet<string>,
): void {
  el.list.innerHTML = '';
  if (groups.length === 0) {
    showTasksListEmptyState(el);
    return;
  }
  el.emptyState.classList.add('hidden');
  el.list.classList.remove('hidden');
  for (const group of groups) {
    const wrapper = document.createElement('li');
    wrapper.className = 'tasks-flexible-group';
    const heading = document.createElement('h3');
    heading.className = 'tasks-flexible-group__heading text-subheadline';
    heading.textContent = group.list.name;
    wrapper.appendChild(heading);
    const rows = document.createElement('ul');
    rows.className = 'tasks-flexible-group__tasks';
    rows.setAttribute('role', 'list');
    for (const task of group.tasks) {
      rows.appendChild(buildTaskItem(
        templates.taskItem,
        task,
        'row',
        onNavigate,
        callbacks,
        resolveItemSelected(task.id, selectedTaskId, selectedTaskIds),
        subtaskDisplayInfo?.get(task.id),
      ));
    }
    wrapper.appendChild(rows);
    el.list.appendChild(wrapper);
  }
  ensureRovingTabStop(el.list);
}

// ── S6 — nested children in list view (AC-S6-13/14/15) ───────────────────────

/**
 * appendTasksWithNesting — render `tasks` (already scoped to one list/group)
 * with each top-level task's children rendered as `.task-item--child` rows
 * directly beneath it (siblings in DOM order), never also as top-level items
 * (AC-S6-13). Each parent-with-children gets a collapse toggle (AC-S6-14) and
 * the `2/5` progress badge (AC-S6-11). Shared by `renderTasksList` (flat list,
 * a single list scope) and `buildSectionGroup` (list view WITH sections) —
 * nesting is a list-view-ONLY concern; the board and smart views render every
 * task standalone instead (Approach §6 action plan item 6).
 */
function appendTasksWithNesting(
  container: HTMLElement,
  tasks: TaskDto[],
  templates: TasksTemplates,
  onNavigate: BrowseNavigateCallback,
  callbacks: TaskRowCallbacks | undefined,
  selectedTaskId: string | null | undefined,
  selectedTaskIds?: ReadonlySet<string>,
): void {
  const { topLevel, childrenByParent } = partitionParentsAndChildren(tasks);

  for (const task of topLevel) {
    const children = childrenByParent.get(task.id) ?? [];
    const progress =
      children.length > 0
        ? { done: children.filter((c) => c.status === 'done').length, total: children.length }
        : undefined;

    const parentItem = buildTaskItem(
      templates.taskItem,
      task,
      'row',
      onNavigate,
      callbacks,
      resolveItemSelected(task.id, selectedTaskId, selectedTaskIds),
      progress ? { progress } : undefined,
    );
    container.appendChild(parentItem);

    if (children.length > 0) {
      const childItems = children.map((child) => {
        const childItem = buildTaskItem(
          templates.taskItem,
          child,
          'row',
          onNavigate,
          callbacks,
          resolveItemSelected(child.id, selectedTaskId, selectedTaskIds),
          { isChild: true },
        );
        childItem.dataset.parentId = task.id;
        return childItem;
      });
      for (const childItem of childItems) container.appendChild(childItem);
      appendCollapseToggle(parentItem, childItems);
    }
  }
}

/**
 * appendCollapseToggle — insert a collapse/expand caret into `parentItem`
 * (AC-S6-14). Collapsing REMOVES `childItems` from the DOM entirely (not
 * merely a CSS `hidden` class) — jsdom cannot see CSS visibility, and the
 * criterion is explicit that collapsed children "SHALL no longer be present
 * in the rendered list". Expanding re-inserts them directly after the parent,
 * in original order.
 */
function appendCollapseToggle(parentItem: HTMLElement, childItems: HTMLElement[]): void {
  parentItem.classList.add('task-item--has-children');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'task-item__collapse-toggle tap-target';
  toggle.setAttribute('aria-label', 'Collapse subtasks');
  toggle.setAttribute('aria-expanded', 'true');

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'chevron-down');
  icon.setAttribute('aria-hidden', 'true');
  toggle.appendChild(icon);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      for (const child of childItems) child.remove();
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Expand subtasks');
      icon.setAttribute('data-lucide', 'chevron-right');
    } else {
      let anchor: Element = parentItem;
      for (const child of childItems) {
        anchor.after(child);
        anchor = child;
      }
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Collapse subtasks');
      icon.setAttribute('data-lucide', 'chevron-down');
    }
  });

  parentItem.appendChild(toggle);
}

// ── P6 — List view with section groups ───────────────────────────────────────

/**
 * renderListViewWithSections — render tasks grouped by section in List view.
 *
 * Renders one collapsible <section> element per group (named sections in position
 * order, then "No Section" last). Within each group, tasks are sorted by sortMode.
 *
 * Section headers support:
 *   - Double-click to rename (contenteditable input, Enter/Esc to commit/cancel).
 *   - Delete button (fires onDeleteSection callback → controller opens confirm dialog).
 * An "Add Section" button is rendered at the bottom.
 *
 * No innerHTML: all DOM manipulation via createElement + textContent.
 */
export function renderListViewWithSections(
  container: HTMLElement,
  templates: TasksTemplates,
  tasks: TaskDto[],
  sections: SectionDto[],
  sortMode: string,
  onNavigate: BrowseNavigateCallback,
  taskCallbacks?: TaskRowCallbacks,
  sectionCallbacks?: SectionCallbacks,
  selectedTaskId?: string | null,
  selectedTaskIds?: ReadonlySet<string>,
): void {
  container.innerHTML = '';

  // A child belongs beside its parent in the list, even for legacy children
  // that were saved before section inheritance was introduced. Grouping them
  // by the child's own (often null) section would split a nested pair across
  // a named section and the No Section bucket. This projection is render-only:
  // the stored task keeps its own data and moving a parent is reflected on the
  // next render without a background migration.
  const parentsById = new Map(tasks.map((task) => [task.id, task]));
  const tasksInParentSections = tasks.map((task) => {
    const parent = task.parent ? parentsById.get(task.parent) : undefined;
    if (!parent || task.section_id === parent.section_id) return task;
    return { ...task, section_id: parent.section_id };
  });

  const groups = groupTasksBySection(tasksInParentSections, sections)
    // An empty No Section heading is never useful; named empty sections stay
    // visible because they are deliberate planning containers.
    .filter((group) => group.sectionId !== null || group.tasks.length > 0);

  for (const group of groups) {
    const groupEl = buildSectionGroup(
      group,
      templates,
      sortMode,
      onNavigate,
      taskCallbacks,
      sectionCallbacks,
      selectedTaskId,
      selectedTaskIds,
    );
    container.appendChild(groupEl);
  }

  // "Add Section" affordance at the bottom.
  if (sectionCallbacks?.onAddSection) {
    container.appendChild(buildAddSectionRow(sectionCallbacks.onAddSection));
  }

  ensureRovingTabStop(container);
}

/**
 * The board's fixed column set (S4 — Approach §3). Cancelled is deliberately
 * absent: it is a FILTER (and lives in the Completed smart view), never a
 * column — a draggable Cancelled column would invite `cancelled -> doing` /
 * `cancelled -> done`, both illegal per `TaskStatus::can_transition_to`.
 */
const BOARD_STATUS_COLUMNS: readonly string[] = ['todo', 'doing', 'done'];

/**
 * renderBoardView — render tasks as Kanban columns keyed by `TaskStatus`
 * (S4 — Approach §3, "Board = Kanban by status").
 *
 * Before S4 the board grouped by SECTION, making it a second, confusingly
 * similar grid to the list (owner complaint #1). S4 re-keys it: exactly
 * three fixed columns — Todo / Doing / Done (AC-S4-01) — never a per-list
 * section. Cancelled tasks are filtered out entirely (AC-S4-02); section
 * data is no longer consulted by the board at all.
 *
 * Each task is rendered via `buildTaskItem(..., 'card', ...)` — the SAME
 * item builder and callback wiring as the List row (S2 — one item, two
 * skins). A cross-column drop is a status transition
 * (`mutate(() => setTaskStatus(...))`, wired by the controller through
 * `onStatusDrop`); illegal columns refuse the drop entirely rather than
 * merely rejecting it after the fact (AC-S4-03/04/05) — see the
 * `dragstart`/`dragend` listeners below and each column's own `dragover`.
 * The dragged card's OWN source column is neither an illegal target NOR a
 * `legalNextStatuses` successor (the FSM has no self-transition arm) — a
 * drop back into it is a no-op cancel, not a transition request (AC-S4-09),
 * so it stays a neutral, enabled drop target rather than greyed out.
 *
 * The add-task row lives ONLY in the Todo column (AC-S4-08, retiring
 * AC-S2-04 — core always creates at `todo`; an add row under Done would be
 * a lie).
 *
 * `sortMode` is the list's ACTIVE sort mode (never a hardcoded `'manual'`,
 * AC-S2-05/06 carried forward) — cards within a column are ordered by
 * `sortTasksForMode(tasks, sortMode)`, exactly like the list view. Within a
 * column, dragging never reorders (Approach §3) — there is no `position`
 * semantics on a status axis.
 *
 * No innerHTML: all DOM manipulation via createElement + textContent (card
 * bodies come from template cloning via buildTaskItem).
 *
 * `subtaskDisplayInfo` (S5, optional): same escape hatch as
 * `renderTasksList` — a pre-computed `computeSubtaskDisplayInfo` map,
 * resolved against the FULL fetched task set rather than the (possibly
 * smart-view-narrowed) `tasks` passed here, so a parent filtered out of the
 * active scope doesn't blank its child's breadcrumb chip (AC-S6-10). Omit
 * it to fall back to deriving the map from `tasks` alone, as before.
 */
export function renderBoardView(
  container: HTMLElement,
  templates: TasksTemplates,
  tasks: TaskDto[],
  sortMode: string,
  onNavigate: BrowseNavigateCallback,
  taskCallbacks?: TaskRowCallbacks,
  selectedTaskId?: string | null,
  subtaskDisplayInfo?: Map<string, SubtaskDisplayInfo>,
  selectedTaskIds?: ReadonlySet<string>,
): void {
  container.innerHTML = '';

  const boardEl = document.createElement('div');
  boardEl.className = 'tasks-board';
  boardEl.setAttribute('role', 'list');
  boardEl.setAttribute('aria-label', 'Task board');

  // AC-S4-02: cancelled tasks never appear on the board — that status lives
  // in the status filter and the Completed smart view instead.
  const boardTasks = tasks.filter((t) => t.status !== 'cancelled');

  // S6: cards render standalone (never nested) — a parent gets the `2/5`
  // progress badge and a child gets a parent breadcrumb chip, computed over
  // the WHOLE board (before the per-column split), since a parent's children
  // may land in a different status column than the parent itself.
  const displayInfo = subtaskDisplayInfo ?? computeSubtaskDisplayInfo(boardTasks);

  const columnEls: HTMLElement[] = [];
  for (const status of BOARD_STATUS_COLUMNS) {
    const colTasks = boardTasks.filter((t) => t.status === status);
    const colEl = buildStatusColumn(
      status,
      colTasks,
      templates,
      sortMode,
      onNavigate,
      taskCallbacks,
      selectedTaskId,
      displayInfo,
      selectedTaskIds,
    );
    columnEls.push(colEl);
    boardEl.appendChild(colEl);
  }

  const resetBoardDrag = () => {
    for (const colEl of columnEls) {
      colEl.classList.remove('tasks-board__column--drop-disabled', 'tasks-board__column--pointer-drop-target');
      colEl.setAttribute('aria-disabled', 'false');
    }
  };

  // Board movement is pointer-captured from its grip. The source and legal
  // successor lanes remain available; dropping back into the source is a
  // safe no-op and within-lane ordering remains intentionally unchanged.
  for (const card of Array.from(boardEl.querySelectorAll<HTMLElement>('.task-item--card[data-task-id]'))) {
    const handle = card.querySelector<HTMLElement>('.task-item__drag-handle');
    const taskId = card.dataset.taskId;
    const sourceStatus = card.dataset.taskStatus;
    if (!handle || !taskId || !sourceStatus || !taskCallbacks?.onStatusDrop) continue;
    const legal = new Set(legalNextStatuses(sourceStatus));

    wirePointerDrag(handle, {
      onActivate: () => {
        card.classList.add('task-item--dragging');
        taskCallbacks.onDragStart?.(taskId);
        for (const colEl of columnEls) {
          const status = colEl.dataset.columnStatus ?? '';
          const available = status === sourceStatus || legal.has(status);
          colEl.classList.toggle('tasks-board__column--drop-disabled', !available);
          colEl.setAttribute('aria-disabled', available ? 'false' : 'true');
        }
      },
      createPreview: () => createTaskDragPreview(card),
      resolveTarget: (clientX, clientY) => {
        const hit = document.elementFromPoint?.(clientX, clientY) ?? null;
        const column = hit?.closest<HTMLElement>('.tasks-board__column') ?? null;
        return column && boardEl.contains(column) ? column : null;
      },
      onTargetChange: (_previous, next) => {
        for (const colEl of columnEls) colEl.classList.remove('tasks-board__column--pointer-drop-target');
        const status = next?.dataset.columnStatus ?? '';
        if (next && (status === sourceStatus || legal.has(status))) {
          next.classList.add('tasks-board__column--pointer-drop-target');
        }
      },
      onCommit: (target) => {
        const status = target.dataset.columnStatus ?? '';
        if (status !== sourceStatus && legal.has(status)) taskCallbacks.onStatusDrop?.(taskId, status);
      },
      onCleanup: () => {
        card.classList.remove('task-item--dragging');
        resetBoardDrag();
      },
    });
  }

  container.appendChild(boardEl);
  ensureRovingTabStop(boardEl);
}

/**
 * buildStatusColumn — one Kanban column for a single `TaskStatus` (S4).
 * Header is name + live count ONLY — no rename/delete/collapse, unlike the
 * retired section-keyed column: the three statuses are fixed by the core
 * FSM, not user data, so there is nothing here for the user to rename or
 * delete.
 */
function buildStatusColumn(
  status: string,
  colTasks: TaskDto[],
  templates: TasksTemplates,
  sortMode: string,
  onNavigate: BrowseNavigateCallback,
  taskCallbacks?: TaskRowCallbacks,
  selectedTaskId?: string | null,
  displayInfo?: Map<string, SubtaskDisplayInfo>,
  selectedTaskIds?: ReadonlySet<string>,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'tasks-board__column';
  col.dataset.columnStatus = status;
  col.setAttribute('role', 'listitem');
  col.setAttribute('aria-disabled', 'false');

  // ── Column header: name + live count ──────────────────────────────────
  const header = document.createElement('div');
  header.className = 'tasks-board__column-header';

  const label = taskStatusLabel(status);

  const nameEl = document.createElement('span');
  nameEl.className = 'tasks-board__column-name text-subheadline';
  nameEl.textContent = label;
  header.appendChild(nameEl);

  const countEl = document.createElement('span');
  countEl.className = 'tasks-board__column-count text-caption2';
  countEl.textContent = String(colTasks.length);
  countEl.setAttribute('aria-label', `${colTasks.length} tasks`);
  header.appendChild(countEl);

  col.appendChild(header);

  // ── Card list — ordered by the active sort mode (AC-S2-05/06) ──────────
  // S7: role="listbox" + aria-multiselectable pairs with buildTaskItem's
  // role="option" on each card.
  const cardList = document.createElement('ul');
  cardList.className = 'tasks-board__column-body';
  cardList.setAttribute('role', 'listbox');
  cardList.setAttribute('aria-multiselectable', 'true');
  cardList.setAttribute('aria-label', `${label} column`);

  const sorted = sortTasksForMode(colTasks, sortMode);
  for (const task of sorted) {
    cardList.appendChild(
      buildTaskItem(
        templates.taskItem,
        task,
        'card',
        onNavigate,
        taskCallbacks,
        resolveItemSelected(task.id, selectedTaskId, selectedTaskIds),
        displayInfo?.get(task.id),
      ),
    );
  }
  col.appendChild(cardList);

  // AC-S4-08 (RETIRES AC-S2-04): the add-task row lives ONLY in the Todo
  // column now that columns are status-keyed — core always creates at
  // `todo`, so an add row under any other column would be a lie.
  if (status === 'todo' && taskCallbacks?.onCreateTask) {
    cardList.appendChild(buildAddTaskRow(taskCallbacks.onCreateTask, taskCallbacks.onPickDueForCreate));
  }

  return col;
}

// ── Section group helpers ─────────────────────────────────────────────────────

function buildSectionGroup(
  group: TaskGroup,
  templates: TasksTemplates,
  sortMode: string,
  onNavigate: BrowseNavigateCallback,
  taskCallbacks?: TaskRowCallbacks,
  sectionCallbacks?: SectionCallbacks,
  selectedTaskId?: string | null,
  selectedTaskIds?: ReadonlySet<string>,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tasks-section-group';
  if (group.sectionId) {
    section.dataset.sectionId = group.sectionId;
    // S8 (AC-S8-01): stashed for sibling-position lookups during drag-reorder
    // (below) — mirrors `li.dataset.listPosition` in lib/lists/render.ts.
    section.dataset.sectionPosition = group.position;
  }

  // ── Header ──
  const header = buildSectionHeader(group, sectionCallbacks);
  section.appendChild(header);

  // ── S8: drag-to-reorder (AC-S8-01) ────────────────────────────────────────
  // Named sections only — the "No Section" bucket (sectionId === null) is
  // never draggable, the same way Inbox is pinned first in the lists rail.
  if (group.sectionId !== null && sectionCallbacks?.onReorderSection) {
    wireSectionReorderDrag(header, section, group.sectionId, group.position, sectionCallbacks.onReorderSection);
  }

  // ── Task list ──
  // S7: role="listbox" + aria-multiselectable pairs with buildTaskItem's
  // role="option" on each row (Approach: correct ARIA for a multi-selectable
  // list, not a fake click-handler-on-a-div).
  const ul = document.createElement('ul');
  ul.className = 'browse-list tasks-section-group__list';
  ul.setAttribute('role', 'listbox');
  ul.setAttribute('aria-multiselectable', 'true');
  ul.setAttribute('aria-label', `${group.sectionName} tasks`);

  // S6 (AC-S6-13): a section group is always a list-scope, list-view render —
  // children nest directly beneath their parent, never also as top-level rows.
  const sorted = sortTasksForMode(group.tasks, sortMode);
  appendTasksWithNesting(ul, sorted, templates, onNavigate, taskCallbacks, selectedTaskId, selectedTaskIds);

  // Add-task row at bottom of each section group.
  if (taskCallbacks?.onCreateTask) {
    ul.appendChild(buildAddTaskRow(taskCallbacks.onCreateTask, taskCallbacks.onPickDueForCreate));
  }

  section.appendChild(ul);
  return section;
}

/**
 * wireSectionReorderDrag — S8 (AC-S8-01): wire the previously-dead
 * `reorderSection(listId, sectionId, position)` bridge call. Drag starts from
 * the section HEADER only (not the whole `<section>`, which also contains
 * draggable task items — nesting two independently-draggable elements would
 * make the browser pick whichever is closest to the pointer, which is
 * already the task item when the drag starts on a row; scoping to the header
 * keeps the two DnD affordances from ever competing). Drop computes a fresh
 * `between()` rank key from the hover-half (top vs bottom) of the TARGET
 * section, exactly mirroring `buildListRow`'s drag-reorder in
 * lib/lists/render.ts (AC-S5-08).
 */
function wireSectionReorderDrag(
  header: HTMLElement,
  section: HTMLElement,
  sectionId: string,
  position: string,
  onReorderSection: (sectionId: string, position: string) => void,
): void {
  header.draggable = true;
  header.classList.add('tasks-section-group__header--draggable');

  header.addEventListener('dragstart', (e: DragEvent) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/x-jin-section-id', sectionId);
      e.dataTransfer.effectAllowed = 'move';
    }
    header.classList.add('tasks-section-group__header--dragging');
  });

  header.addEventListener('dragend', () => {
    header.classList.remove('tasks-section-group__header--dragging');
  });

  header.addEventListener('dragover', (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('application/x-jin-section-id')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  header.addEventListener('drop', (e: DragEvent) => {
    const draggedId = e.dataTransfer?.getData('application/x-jin-section-id') ?? '';
    if (!draggedId) return;
    e.preventDefault();
    if (draggedId === sectionId) return;

    const container = section.parentElement;
    const siblings = Array.from(
      container?.querySelectorAll<HTMLElement>('.tasks-section-group[data-section-id]') ?? [],
    );
    const idx = siblings.indexOf(section);

    const rect = section.getBoundingClientRect();
    const isAbove = e.clientY < rect.top + rect.height / 2;

    let abovePos: string | null;
    let belowPos: string | null;
    if (isAbove) {
      const prevSibling = siblings[idx - 1];
      abovePos = prevSibling?.dataset.sectionPosition ?? null;
      belowPos = position;
    } else {
      abovePos = position;
      const nextSibling = siblings[idx + 1];
      belowPos = nextSibling?.dataset.sectionPosition ?? null;
    }

    const newPosition = between(abovePos, belowPos);
    onReorderSection(draggedId, newPosition);
  });
}

/**
 * buildSectionHeader — the List view's section-group header (name, count,
 * collapse toggle, rename, delete). S4: the board no longer groups by
 * section at all (it is Kanban by TaskStatus now — see buildStatusColumn
 * above), so the retired `'board'` mode branch this function used to carry
 * is gone; this is a LIST-VIEW-ONLY helper now.
 */
function buildSectionHeader(
  group: TaskGroup,
  callbacks: SectionCallbacks | undefined,
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'tasks-section-group__header';

  // Collapse toggle.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tasks-section-group__toggle tap-target';
  toggleBtn.setAttribute('aria-label', `Collapse ${group.sectionName} section`);
  toggleBtn.setAttribute('aria-expanded', 'true');

  const chevron = document.createElement('i');
  chevron.setAttribute('data-lucide', 'chevron-down');
  chevron.setAttribute('aria-hidden', 'true');
  toggleBtn.appendChild(chevron);

  toggleBtn.addEventListener('click', () => {
    const sectionEl = header.closest('.tasks-section-group');
    const listEl = sectionEl?.querySelector('.tasks-section-group__list') as HTMLElement | null;
    if (listEl) {
      const collapsed = listEl.dataset.collapsed === 'true';
      listEl.dataset.collapsed = collapsed ? 'false' : 'true';
      listEl.classList.toggle('hidden', !collapsed ? true : false);
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    }
  });
  header.appendChild(toggleBtn);

  // Section name (double-click to rename).
  const nameEl = document.createElement('span');
  nameEl.className = 'tasks-section-group__name text-subheadline';
  nameEl.textContent = group.sectionName;

  if (group.sectionId !== null && callbacks?.onRenameSection) {
    const onRenameSection = callbacks.onRenameSection;
    const sectionId = group.sectionId;
    nameEl.setAttribute('title', 'Double-click to rename');

    nameEl.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tasks-section-group__rename-input';
      input.value = nameEl.textContent ?? '';
      input.setAttribute('aria-label', `Rename section ${group.sectionName}`);

      const commitRename = () => {
        const newName = input.value.trim();
        if (newName && newName !== group.sectionName) {
          onRenameSection(sectionId, newName);
        }
        if (input.parentNode) input.replaceWith(nameEl);
      };
      const cancelRename = () => {
        if (input.parentNode) input.replaceWith(nameEl);
      };

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
      });
      input.addEventListener('blur', commitRename);

      nameEl.replaceWith(input);
      input.focus();
      input.select();
    });
  }
  header.appendChild(nameEl);

  // Task count badge.
  const countEl = document.createElement('span');
  countEl.className = 'tasks-section-group__count text-caption2';
  countEl.textContent = String(group.tasks.length);
  countEl.setAttribute('aria-label', `${group.tasks.length} tasks`);
  header.appendChild(countEl);

  // Delete button (named sections only).
  if (group.sectionId !== null && callbacks?.onDeleteSection) {
    const onDeleteSection = callbacks.onDeleteSection;
    const sectionId = group.sectionId;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'tasks-section-group__delete-btn tap-target';
    deleteBtn.setAttribute('aria-label', `Delete section "${group.sectionName}"`);

    const deleteIcon = document.createElement('i');
    deleteIcon.setAttribute('data-lucide', 'trash-2');
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteBtn.appendChild(deleteIcon);

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeleteSection(sectionId, group.sectionName);
    });
    header.appendChild(deleteBtn);
  }

  return header;
}

export function buildAddSectionRow(onAddSection: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tasks-section-group__add-section-btn tap-target';
  btn.setAttribute('aria-label', 'Add section');

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'plus');
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = 'Add Section';
  btn.appendChild(label);

  btn.addEventListener('click', () => onAddSection());
  return btn;
}

// ── Detail rendering ──────────────────────────────────────────────────────────

/**
 * renderTaskPane — populate the task DETAIL PANE (S3: `renderTaskDetail` ->
 * `renderTaskPane`). This is now the ONLY task editor (Approach §2) — it
 * renders BESIDE the list (never a page swap, never a modal) and carries
 * every affordance the two retired editors had between them, plus the one
 * the old page-swap detail never had: Delete (AC-S3-07).
 *
 * Renders:
 *   - A pane header: Delete + Close (X) — AC-S3-07 / AC-S3-09.
 *   - Title (editable on click)
 *   - Body (textarea, editable)
 *   - Status (glyph + label + color — color is supplementary)
 *   - Priority (glyph + label)
 *   - Due date
 *   - List name
 *   - Backlinks (navigable) — AC-S3-10
 *   - Promote-to-event action — AC-S3-11
 */
export function renderTaskPane(
  el: TasksViewElements,
  templates: TasksTemplates,
  task: TaskDto,
  onNavigate: BrowseNavigateCallback,
  onPromote?: (taskId: string) => void,
  onSaveReminders?: (taskId: string, reminders: Array<{ kind: string; value: string }>) => void,
  detailCallbacks?: TaskDetailCallbacks,
  onClose?: () => void,
  onDeleteRequest?: (taskId: string, taskTitle: string) => void,
): void {
  el.detailContent.innerHTML = '';

  // ── Pane header: Delete + Close (S3) ────────────────────────────────────
  if (onClose || onDeleteRequest) {
    const header = document.createElement('div');
    header.className = 'tasks-detail-pane__header';

    const actions = document.createElement('div');
    actions.className = 'tasks-detail-pane__header-actions';

    if (onDeleteRequest) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'tasks-detail-pane__delete-btn jin-control jin-control--icon tap-target';
      deleteBtn.setAttribute('aria-label', `Delete "${task.title}"`);
      const deleteIcon = document.createElement('i');
      deleteIcon.setAttribute('data-lucide', 'trash-2');
      deleteIcon.setAttribute('aria-hidden', 'true');
      deleteBtn.appendChild(deleteIcon);
      deleteBtn.addEventListener('click', () => onDeleteRequest(task.id, task.title));
      actions.appendChild(deleteBtn);
    }

    if (onClose) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tasks-detail-pane__close-btn jin-control jin-control--icon tap-target';
      closeBtn.setAttribute('aria-label', 'Close task details');
      const closeIcon = document.createElement('i');
      closeIcon.setAttribute('data-lucide', 'x');
      closeIcon.setAttribute('aria-hidden', 'true');
      closeBtn.appendChild(closeIcon);
      closeBtn.addEventListener('click', () => onClose());
      actions.appendChild(closeBtn);
    }

    header.appendChild(actions);
    el.detailContent.appendChild(header);
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleEl = document.createElement('h2');
  titleEl.className = 'browse-detail__title text-title2';
  titleEl.textContent = task.title;

  // Wire title editability: blur/Enter auto-save (ITEM 5; S3 — the only editor)
  if (detailCallbacks?.onSaveTitle) {
    titleEl.setAttribute('contenteditable', 'true');
    titleEl.setAttribute('aria-label', 'Task title (editable)');
    titleEl.classList.add('task-detail__title-editable');

    if (detailCallbacks?.onSaveTitle) {
      const origTitle = task.title;
      const onSaveTitle = detailCallbacks.onSaveTitle;
      const commitTitle = () => {
        const newTitle = (titleEl.textContent ?? '').trim();
        if (newTitle && newTitle !== origTitle) {
          void onSaveTitle(task.id, newTitle);
        }
      };
      titleEl.addEventListener('blur', commitTitle);
      titleEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTitle(); titleEl.blur(); }
        if (e.key === 'Escape') { titleEl.textContent = origTitle; titleEl.blur(); }
      });
    }
  }

  el.detailContent.appendChild(titleEl);

  // ── Body (P1) ────────────────────────────────────────────────────────────
  const bodySection = document.createElement('div');
  bodySection.className = 'task-detail__body-section';

  const bodyLabel = document.createElement('label');
  bodyLabel.className = 'form-label';
  bodyLabel.setAttribute('for', `task-body-${task.id}`);
  bodyLabel.textContent = 'Notes';
  bodySection.appendChild(bodyLabel);

  const bodyEl = document.createElement('textarea');
  bodyEl.id = `task-body-${task.id}`;
  bodyEl.className = 'task-detail__body form-input';
  bodyEl.value = task.body ?? '';
  bodyEl.placeholder = 'Add a description…';
  bodyEl.setAttribute('aria-label', 'Task notes (body)');
  bodyEl.rows = 4;

  if (detailCallbacks?.onSaveBody) {
    const origBody = task.body ?? '';
    const onSaveBody = detailCallbacks.onSaveBody;
    bodyEl.addEventListener('blur', () => {
      if (bodyEl.value !== origBody) {
        void onSaveBody(task.id, bodyEl.value);
      }
    });
  }

  bodySection.appendChild(bodyEl);
  el.detailContent.appendChild(bodySection);

  // ── ITEM 5: Editable fields (status / priority / due / list / section / tags) ──
  // S6: extract resolver lists before the if/else so both branches can display names.
  // When detailCallbacks is undefined (read-only path), resolverLists is [] and
  // listNameById falls back to the raw id (acceptable — controller always provides callbacks).
  const resolverLists = detailCallbacks?.availableLists ?? [];

  if (detailCallbacks) {
    el.detailContent.appendChild(buildDetailFields(task, detailCallbacks));
  } else {
    // ── Read-only meta (status badge + priority badge) ─────────────────────
    const metaEl = document.createElement('div');
    metaEl.className = 'browse-detail__meta';

    const statusEl = document.createElement('span');
    statusEl.className = 'browse-status-badge task-detail__status jin-badge';
    statusEl.setAttribute('role', 'img');
    const sLabel = taskStatusLabel(task.status);
    statusEl.setAttribute('aria-label', `Status: ${sLabel}`);
    statusEl.dataset.taskStatus = task.status.toLowerCase();

    const statusIconEl = document.createElement('i');
    statusIconEl.className = 'task-detail__status-icon';
    statusIconEl.setAttribute('data-lucide', taskStatusGlyph(task.status));
    statusIconEl.setAttribute('aria-hidden', 'true');

    const statusLabelEl = document.createElement('span');
    statusLabelEl.className = 'task-detail__status-label';
    statusLabelEl.textContent = sLabel;

    statusEl.appendChild(statusIconEl);
    statusEl.appendChild(statusLabelEl);
    metaEl.appendChild(statusEl);

    const priorityEl = document.createElement('span');
    priorityEl.className = 'browse-status-badge task-detail__priority jin-badge';
    priorityEl.setAttribute('role', 'img');
    const pLabel = taskPriorityLabel(task.priority);
    priorityEl.setAttribute('aria-label', `Priority: ${pLabel}`);

    const priorityIconEl = document.createElement('i');
    priorityIconEl.className = 'task-detail__priority-icon';
    const pGlyph = taskPriorityGlyph(task.priority);
    if (pGlyph) {
      priorityIconEl.setAttribute('data-lucide', pGlyph);
      priorityIconEl.setAttribute('data-priority', task.priority.toLowerCase());
    } else {
      priorityIconEl.style.display = 'none';
    }
    priorityIconEl.setAttribute('aria-hidden', 'true');

    const priorityLabelEl = document.createElement('span');
    priorityLabelEl.className = 'task-detail__priority-label';
    priorityLabelEl.textContent = pLabel;

    priorityEl.appendChild(priorityIconEl);
    priorityEl.appendChild(priorityLabelEl);
    metaEl.appendChild(priorityEl);

    el.detailContent.appendChild(metaEl);

    // ── Read-only Due date + list ──────────────────────────────────────────
    const dueEl = document.createElement('p');
    dueEl.className = 'task-detail__due text-callout';
    dueEl.setAttribute('aria-label', `Due: ${formatTaskDue(task.due)}`);

    const dueLabelEl = document.createElement('span');
    dueLabelEl.className = 'task-detail__due-label';
    dueLabelEl.textContent = 'Due: ';

    const dueValueEl = document.createElement('span');
    dueValueEl.className = 'task-detail__due-value';
    dueValueEl.textContent = formatTaskDue(task.due);

    dueEl.appendChild(dueLabelEl);
    dueEl.appendChild(dueValueEl);
    el.detailContent.appendChild(dueEl);

    const listEl = document.createElement('p');
    listEl.className = 'task-detail__list text-callout';
    // S6: resolve id → display name; falls back to the id if unknown.
    listEl.setAttribute('aria-label', `List: ${listNameById(resolverLists, task.list)}`);

    const listLabelEl = document.createElement('span');
    listLabelEl.className = 'task-detail__list-label';
    listLabelEl.textContent = 'List: ';

    const listValueEl = document.createElement('span');
    listValueEl.className = 'task-detail__list-value';
    // S6: display name, not the raw id.
    listValueEl.textContent = listNameById(resolverLists, task.list);

    listEl.appendChild(listLabelEl);
    listEl.appendChild(listValueEl);
    el.detailContent.appendChild(listEl);
  } // end else (read-only path)

  // ── Promote to Event action ───────────────────────────────────────────────
  if (onPromote) {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'browse-detail__actions';

    const promoteBtn = document.createElement('button');
    promoteBtn.type = 'button';
    promoteBtn.className = 'task-promote-btn jin-control jin-control--secondary jin-control--icon-label tap-target';
    promoteBtn.setAttribute('aria-label', `Promote "${task.title}" to an event`);
    promoteBtn.dataset.taskId = task.id;

    const promoteIcon = document.createElement('i');
    promoteIcon.setAttribute('data-lucide', 'calendar-plus');
    promoteIcon.setAttribute('aria-hidden', 'true');

    const promoteLabelEl = document.createElement('span');
    promoteLabelEl.className = 'jin-control__label';
    promoteLabelEl.textContent = 'Promote to Event';

    promoteBtn.appendChild(promoteIcon);
    promoteBtn.appendChild(promoteLabelEl);
    promoteBtn.addEventListener('click', () => onPromote(task.id));

    actionsEl.appendChild(promoteBtn);
    el.detailContent.appendChild(actionsEl);
  }

  // ── P10 — Reminder chips / editor ────────────────────────────────────────
  if (onSaveReminders) {
    const reminders = task.reminders ?? [];
    const reminderEditorEl = buildReminderEditor(task.id, reminders, onSaveReminders);
    el.detailContent.appendChild(reminderEditorEl);
  } else if ((task.reminders ?? []).length > 0) {
    // Read-only view (no save callback): show chips without remove buttons.
    const chipsEl = buildReminderChips(task.reminders ?? []);
    if (chipsEl) el.detailContent.appendChild(chipsEl);
  }

  // ── S6 — Subtasks section (Approach §6 action plan item 6) ───────────────
  // Hidden when `task` is ITSELF a subtask — depth is capped at one, so a
  // subtask can never have children of its own.
  if (!task.parent && detailCallbacks) {
    const hasAnySubtaskAffordance =
      detailCallbacks.onAddSubtask || (detailCallbacks.subtasks ?? []).length > 0;
    if (hasAnySubtaskAffordance) {
      el.detailContent.appendChild(buildSubtasksSection(task, detailCallbacks, onNavigate));
    }
  }

  // ── Backlinks (e.g. derived event "has-event") ────────────────────────────
  if (task.backlinks.length > 0) {
    const backlinksSection = buildTaskBacklinksSection(task.backlinks, templates, onNavigate);
    el.detailContent.appendChild(backlinksSection);
  }

  // Compose the existing, fully wired controls into a task workspace. Keeping
  // the controls themselves intact preserves their save/reminder/calendar
  // behavior while making the task content primary and metadata companion.
  const existing = Array.from(el.detailContent.children);
  const layout = document.createElement('div');
  layout.className = 'task-detail__layout';
  const main = document.createElement('div');
  main.className = 'task-detail__main';
  const attributes = document.createElement('aside');
  attributes.className = 'task-detail__attributes';
  attributes.setAttribute('aria-label', 'Task attributes');

  const title = existing.find((node) => node.classList.contains('browse-detail__title'));
  if (title) {
    const titleRow = document.createElement('div');
    titleRow.className = 'task-detail__title-row';
    if (detailCallbacks?.onSaveStatus) {
      const completion = document.createElement('button');
      configureTaskCompletion(completion, task, (_taskId, currentStatus) => {
        void detailCallbacks.onSaveStatus?.(task.id, currentStatus === 'done' ? 'todo' : 'done');
      });
      titleRow.appendChild(completion);
    }
    titleRow.appendChild(title);
    main.appendChild(titleRow);
  }

  for (const node of existing) {
    if (node === title) continue;
    if (
      node.classList.contains('task-detail__body-section')
      || node.classList.contains('task-detail__subtasks')
      || node.classList.contains('browse-detail__backlinks')
      || node.classList.contains('tasks-detail-pane__header')
    ) {
      main.appendChild(node);
    } else {
      attributes.appendChild(node);
    }
  }

  layout.append(main, attributes);
  el.detailContent.replaceChildren(layout);
}

// ── S7 — bulk panel (Approach: "With ≥2 selected, the pane switches to a
// bulk panel") ────────────────────────────────────────────────────────────

/**
 * Callbacks for the S7 bulk panel. All optional; a callback's control is
 * simply not rendered when its callback is omitted (same "omit to skip"
 * convention as `TaskDetailCallbacks`).
 */
export interface BulkPanelCallbacks {
  /** Set status for every selected task. Only ever called with a value from `statusOptions` (AC-S7-02's intersection). */
  onSetStatus?: (status: string) => void;
  /** Move every selected task to a different list. */
  onMoveToList?: (listId: string) => void;
  /** Delete every selected task (controller opens its own confirm dialog first). */
  onDelete?: () => void;
  /** Clear the selection entirely (closes the bulk panel). */
  onClearSelection?: () => void;
}

/**
 * renderBulkPanel — populate the detail pane with the bulk-op panel instead
 * of a single task's fields (S7 action plan item 2). `statusOptions` MUST be
 * the INTERSECTION of `legalNextStatuses` across the whole selection
 * (`intersectLegalNextStatuses`, lib/tasks/bulk.ts) — this function does not
 * compute it; it only ever renders whatever it is given, so the honesty
 * guarantee lives entirely in the caller (AC-S7-02).
 *
 * No innerHTML — createElement + textContent only, same convention as the
 * rest of this module.
 */
export function renderBulkPanel(
  el: TasksViewElements,
  count: number,
  statusOptions: string[],
  availableLists: Array<{ id: string; name: string }>,
  callbacks: BulkPanelCallbacks,
): void {
  el.detailContent.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'tasks-bulk-panel';
  panel.setAttribute('aria-label', `${count} tasks selected`);

  // ── Header: "N tasks selected" + clear ────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'tasks-bulk-panel__header';

  const heading = document.createElement('h2');
  heading.className = 'tasks-bulk-panel__title text-title2';
  heading.textContent = `${count} tasks selected`;
  header.appendChild(heading);

  if (callbacks.onClearSelection) {
    const onClearSelection = callbacks.onClearSelection;
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tasks-bulk-panel__clear-btn tap-target';
    clearBtn.setAttribute('aria-label', 'Clear selection');
    const clearIcon = document.createElement('i');
    clearIcon.setAttribute('data-lucide', 'x');
    clearIcon.setAttribute('aria-hidden', 'true');
    clearBtn.appendChild(clearIcon);
    clearBtn.addEventListener('click', () => onClearSelection());
    header.appendChild(clearBtn);
  }
  panel.appendChild(header);

  // ── Set status — offers ONLY the intersection (AC-S7-02) ─────────────────
  if (callbacks.onSetStatus) {
    const onSetStatus = callbacks.onSetStatus;
    const row = buildFieldRow('Set status');
    if (statusOptions.length === 0) {
      const note = document.createElement('p');
      note.className = 'tasks-bulk-panel__note text-footnote';
      note.textContent = 'No status change is valid for every selected task.';
      row.appendChild(note);
    } else {
      const sel = document.createElement('select');
      sel.className = 'tasks-bulk-panel__status-select form-select';
      sel.setAttribute('aria-label', 'Set status for selected tasks');

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose…';
      placeholder.selected = true;
      placeholder.disabled = true;
      sel.appendChild(placeholder);

      for (const status of statusOptions) {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = taskStatusLabel(status);
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        if (sel.value) onSetStatus(sel.value);
      });
      row.appendChild(sel);
    }
    panel.appendChild(row);
  }

  // ── Move to list ───────────────────────────────────────────────────────────
  if (callbacks.onMoveToList && availableLists.length > 0) {
    const onMoveToList = callbacks.onMoveToList;
    const row = buildFieldRow('Move to list');
    const sel = document.createElement('select');
    sel.className = 'tasks-bulk-panel__list-select form-select';
    sel.setAttribute('aria-label', 'Move selected tasks to list');

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose…';
    placeholder.selected = true;
    placeholder.disabled = true;
    sel.appendChild(placeholder);

    for (const l of availableLists) {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      if (sel.value) onMoveToList(sel.value);
    });
    row.appendChild(sel);
    panel.appendChild(row);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  if (callbacks.onDelete) {
    const onDelete = callbacks.onDelete;
    const actions = document.createElement('div');
    actions.className = 'tasks-bulk-panel__actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'tasks-bulk-panel__delete-btn btn-danger tap-target';
    deleteBtn.setAttribute('aria-label', `Delete ${count} tasks`);
    const deleteIcon = document.createElement('i');
    deleteIcon.setAttribute('data-lucide', 'trash-2');
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteBtn.appendChild(deleteIcon);
    const deleteLabel = document.createElement('span');
    deleteLabel.textContent = 'Delete';
    deleteBtn.appendChild(deleteLabel);
    deleteBtn.addEventListener('click', () => onDelete());

    actions.appendChild(deleteBtn);
    panel.appendChild(actions);
  }

  el.detailContent.appendChild(panel);
}

/**
 * buildSubtasksSection — S6: the pane's Subtasks section (Approach §6 action
 * plan item 6). Renders each direct child as a compact row (status toggle,
 * title — click selects it in the pane, delete) plus a deliberate inline composer.
 * Not the shared `buildTaskItem` (that renderer is list/board-item shaped;
 * this is a lightweight, pane-scoped list) — no innerHTML, createElement +
 * textContent only.
 */
function buildSubtasksSection(
  task: TaskDto,
  cbs: TaskDetailCallbacks,
  onNavigate: BrowseNavigateCallback,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'task-detail__subtasks';
  section.setAttribute('aria-label', 'Subtasks');

  const heading = document.createElement('h3');
  heading.className = 'task-detail__subtasks-heading text-subheadline';
  heading.textContent = 'Subtasks';
  section.appendChild(heading);

  const subtasks = cbs.subtasks ?? [];
  if (subtasks.length > 0) {
    const list = document.createElement('ul');
    list.className = 'task-detail__subtasks-list';
    list.setAttribute('role', 'list');
    for (const sub of subtasks) {
      list.appendChild(buildSubtaskRow(sub, cbs, onNavigate));
    }
    section.appendChild(list);
  }

  if (cbs.onAddSubtask) {
    const onAddSubtask = cbs.onAddSubtask;
    const addTrigger = document.createElement('button');
    addTrigger.type = 'button';
    addTrigger.className = 'task-detail__subtask-add-trigger';
    addTrigger.textContent = 'Add subtask';

    const addRow = document.createElement('form');
    addRow.className = 'task-detail__subtask-add';
    addRow.noValidate = true;
    addRow.hidden = true;

    const error = document.createElement('p');
    error.className = 'task-detail__subtask-add-error';
    error.id = `subtask-add-error-${task.id}`;
    error.setAttribute('role', 'status');
    error.hidden = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-detail__subtask-add-input form-input';
    input.placeholder = 'Add subtask…';
    input.setAttribute('aria-label', 'New subtask title');
    input.setAttribute('aria-describedby', error.id);

    const actions = document.createElement('div');
    actions.className = 'task-detail__subtask-add-actions';
    const addButton = document.createElement('button');
    addButton.type = 'submit';
    addButton.className = 'task-detail__subtask-add-submit jin-control jin-control--primary';
    addButton.textContent = 'Add';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'task-detail__subtask-add-cancel jin-control jin-control--secondary';
    cancelButton.textContent = 'Cancel';

    const collapse = () => {
      if (addButton.disabled) return;
      input.value = '';
      error.hidden = true;
      error.textContent = '';
      addRow.hidden = true;
      addTrigger.hidden = false;
      addTrigger.focus();
    };
    addTrigger.addEventListener('click', () => {
      addTrigger.hidden = true;
      addRow.hidden = false;
      input.focus();
    });
    cancelButton.addEventListener('click', collapse);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        collapse();
      }
    });
    addRow.appendChild(input);
    actions.append(addButton, cancelButton);
    addRow.append(actions, error);
    addRow.addEventListener('submit', (event) => {
      event.preventDefault();
      if (addButton.disabled) return;
      const title = input.value.trim();
      if (!title) {
        error.textContent = 'Enter a subtask title.';
        error.hidden = false;
        input.focus();
        return;
      }
      void (async () => {
        let restoreFocus = false;
        addButton.disabled = true;
        cancelButton.disabled = true;
        input.disabled = true;
        error.hidden = true;
        try {
          const created = await onAddSubtask(task.id, title);
          if (created) {
            input.value = '';
          } else {
            error.textContent = 'Could not add subtask. Try again.';
            error.hidden = false;
            restoreFocus = true;
          }
        } catch {
          error.textContent = 'Could not add subtask. Try again.';
          error.hidden = false;
          restoreFocus = true;
        } finally {
          addButton.disabled = false;
          cancelButton.disabled = false;
          input.disabled = false;
          if (restoreFocus) input.focus();
        }
      })();
    });
    section.appendChild(addTrigger);
    section.appendChild(addRow);
  }

  return section;
}

/** buildSubtaskRow — one compact row inside the pane's Subtasks section. */
function buildSubtaskRow(
  subtask: TaskDto,
  cbs: TaskDetailCallbacks,
  onNavigate: BrowseNavigateCallback,
): HTMLElement {
  const row = document.createElement('li');
  row.className = 'task-detail__subtask-row';
  row.dataset.taskId = subtask.id;
  row.dataset.taskStatus = subtask.status.toLowerCase();

  const statusBtn = document.createElement('button');
  statusBtn.className = 'task-detail__subtask-status tap-target';
  configureTaskCompletion(statusBtn, subtask, cbs.onToggleSubtaskStatus);
  row.appendChild(statusBtn);

  const titleBtn = document.createElement('button');
  titleBtn.type = 'button';
  titleBtn.className = 'task-detail__subtask-title';
  titleBtn.textContent = subtask.title;
  titleBtn.addEventListener('click', () => {
    if (cbs.onSelectSubtask) cbs.onSelectSubtask(subtask.id);
    else onNavigate('tasks', subtask.id);
  });
  row.appendChild(titleBtn);

  if (cbs.onDeleteSubtask) {
    const onDeleteSubtask = cbs.onDeleteSubtask;
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'task-detail__subtask-delete tap-target';
    deleteBtn.setAttribute('aria-label', `Delete subtask "${subtask.title}"`);
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'trash-2');
    icon.setAttribute('aria-hidden', 'true');
    deleteBtn.appendChild(icon);
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeleteSubtask(subtask.id, subtask.title);
    });
    row.appendChild(deleteBtn);
  }

  return row;
}

// ── ITEM 5: Detail field editor helpers ───────────────────────────────────────

/**
 * buildDetailFields — build the editable metadata panel for the task detail view.
 * Renders: status select, priority select, due date, list, section, tags.
 * Each field saves immediately on change (no Save button).
 */
function buildDetailFields(task: TaskDto, cbs: TaskDetailCallbacks): HTMLElement {
  const fields = document.createElement('div');
  fields.className = 'task-detail__fields';

  // S6 (AC-S6-12): a subtask's list/section selects are disabled — "moves
  // with parent" (the core cascade in ops::tasks keeps them in sync whenever
  // the PARENT's list/section changes; editing them directly on the child
  // would fight that cascade).
  const isSubtask = Boolean(task.parent);

  // ── Status ──────────────────────────────────────────────────────────────────
  if (cbs.onSaveStatus) {
    const row = buildFieldRow('Status');
    const sel = document.createElement('select');
    sel.className = 'task-detail__status-select form-select';
    sel.setAttribute('aria-label', 'Task status');
    // S1 (AC-S1-02/03/04): offer only the current status plus its legal
    // successors per legalNextStatuses (pure mirror of core's FSM) — never the
    // full 4-status vocabulary. A `done` task must see exactly [done, todo].
    const STATUS_OPTIONS = [task.status, ...legalNextStatuses(task.status)];
    for (const s of STATUS_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = taskStatusLabel(s);
      if (s === task.status) opt.selected = true;
      sel.appendChild(opt);
    }
    const onSaveStatus = cbs.onSaveStatus;
    sel.addEventListener('change', () => {
      void onSaveStatus(task.id, sel.value);
    });
    row.appendChild(sel);
    fields.appendChild(row);
  }

  // ── Priority ─────────────────────────────────────────────────────────────────
  if (cbs.onSavePriority) {
    const row = buildFieldRow('Priority');
    const sel = document.createElement('select');
    sel.className = 'task-detail__priority-select form-select';
    sel.setAttribute('aria-label', 'Task priority');
    // S1 (AC-S1-01): the phantom 5th priority value is gone — it existed
    // nowhere in core and hard-errored at parse_priority (commands/tasks.rs:91-107).
    // Core has exactly 4 Priority values; offer only those.
    const PRIORITY_OPTIONS = ['none', 'low', 'medium', 'high'];
    for (const p of PRIORITY_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = taskPriorityLabel(p);
      if (p === (task.priority ?? 'none')) opt.selected = true;
      sel.appendChild(opt);
    }
    const onSavePriority = cbs.onSavePriority;
    sel.addEventListener('change', () => {
      void onSavePriority(task.id, sel.value);
    });
    row.appendChild(sel);
    fields.appendChild(row);
  }

  // ── Due date ─────────────────────────────────────────────────────────────────
  {
    const row = buildFieldRow('Due');
    const dueSection = document.createElement('span');
    dueSection.className = 'task-detail__due-section';

    const dueBtn = document.createElement('button');
    dueBtn.type = 'button';
    dueBtn.className = 'task-detail__due-btn jin-control jin-control--secondary jin-control--icon-label tap-target';
    dueBtn.setAttribute('aria-label', task.due ? `Due: ${formatTaskDue(task.due)}` : 'Set due date');
    const dueBtnText = document.createElement('span');
    dueBtnText.className = 'jin-control__label';
    dueBtnText.textContent = task.due ? formatTaskDue(task.due) : 'Set due date…';
    const calIcon2 = document.createElement('i');
    calIcon2.setAttribute('data-lucide', 'calendar');
    calIcon2.setAttribute('aria-hidden', 'true');
    dueBtn.appendChild(calIcon2);
    dueBtn.appendChild(dueBtnText);

    dueSection.appendChild(dueBtn);

    if (cbs.onClearDue && task.due) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'task-detail__due-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.setAttribute('aria-label', 'Clear due date');
      const onClearDue = cbs.onClearDue;
      clearBtn.addEventListener('click', () => {
        void onClearDue(task.id);
        dueBtnText.textContent = 'Set due date…';
        dueBtn.setAttribute('aria-label', 'Set due date');
        clearBtn.style.display = 'none';
      });
      dueSection.appendChild(clearBtn);
    }

    if (cbs.onPickDue) {
      const onPickDue = cbs.onPickDue;
      dueBtn.addEventListener('click', () => {
        onPickDue(task.due ?? null, (dueString) => {
          dueBtnText.textContent = dueString ? formatTaskDue(dueString) : 'Set due date…';
          dueBtn.setAttribute('aria-label', dueString ? `Due: ${formatTaskDue(dueString)}` : 'Set due date');
        });
      });
    }

    row.appendChild(dueSection);
    fields.appendChild(row);
  }

  // ── List ─────────────────────────────────────────────────────────────────────
  if (cbs.onSaveList && cbs.availableLists && cbs.availableLists.length > 0) {
    const row = buildFieldRow('List');
    const sel = document.createElement('select');
    sel.className = 'task-detail__list-select form-select';
    sel.setAttribute('aria-label', 'Task list');
    if (isSubtask) {
      sel.disabled = true;
      sel.title = 'Moves with parent';
    }
    for (const l of cbs.availableLists) {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      // S6: compare by id (option value is already l.id at the line above).
      // Comparing by name was wrong when id≠name (user lists have a ULID id).
      if (l.id === task.list) opt.selected = true;
      sel.appendChild(opt);
    }
    const onSaveList = cbs.onSaveList;
    sel.addEventListener('change', () => {
      void onSaveList(task.id, sel.value);
    });
    row.appendChild(sel);
    fields.appendChild(row);
  }

  // ── Section ───────────────────────────────────────────────────────────────────
  if (cbs.onSaveSection && cbs.availableSections) {
    const row = buildFieldRow('Section');
    const sel = document.createElement('select');
    sel.className = 'task-detail__section-select form-select';
    sel.setAttribute('aria-label', 'Task section');
    if (isSubtask) {
      sel.disabled = true;
      sel.title = 'Moves with parent';
    }
    const noSectOpt = document.createElement('option');
    noSectOpt.value = '';
    noSectOpt.textContent = 'No Section';
    if (!task.section_id) noSectOpt.selected = true;
    sel.appendChild(noSectOpt);
    for (const s of cbs.availableSections) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === task.section_id) opt.selected = true;
      sel.appendChild(opt);
    }
    const onSaveSection = cbs.onSaveSection;
    sel.addEventListener('change', () => {
      void onSaveSection(task.id, sel.value || null);
    });
    row.appendChild(sel);
    fields.appendChild(row);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────────
  if (cbs.onSaveTags) {
    const row = buildFieldRow('Tags');
    row.appendChild(buildDetailTagsEditor(task, cbs));
    fields.appendChild(row);
  }

  return fields;
}

/** Build a single label+content row for the detail fields panel. */
function buildFieldRow(label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'task-detail__field-row';
  const lbl = document.createElement('span');
  lbl.className = 'task-detail__field-label text-footnote';
  lbl.textContent = label;
  row.appendChild(lbl);
  return row;
}

/**
 * buildDetailTagsEditor — inline chip-based tags editor.
 * Tags are rendered as chips with × remove buttons; an input + datalist allow adding new ones.
 */
function buildDetailTagsEditor(task: TaskDto, cbs: TaskDetailCallbacks): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'task-detail__tags-editor';

  // Mutable copy of current tags
  const currentTags: string[] = [...(task.tags ?? [])];
  const onSaveTags = cbs.onSaveTags!;

  const chipsEl = document.createElement('div');
  chipsEl.className = 'task-detail__tags-chips';
  wrapper.appendChild(chipsEl);

  const renderChips = () => {
    chipsEl.innerHTML = '';
    for (const slug of currentTags) {
      const chip = document.createElement('span');
      chip.className = 'task-detail__tag-chip text-caption2';

      // ── S8 (AC-S8-02): color swatch — opens the tag color picker ────────
      // A slug absent from `cbs.tagColors` (e.g. a brand-new tag not yet
      // round-tripped through listTags()) falls back to 'accent'.
      if (cbs.onPickTagColor) {
        const onPickTagColor = cbs.onPickTagColor;
        const currentColor = cbs.tagColors?.[slug] ?? 'accent';
        const swatchBtn = document.createElement('button');
        swatchBtn.type = 'button';
        swatchBtn.className = 'task-detail__tag-swatch';
        const normalizedColor = applyJinColor(swatchBtn, currentColor);
        swatchBtn.dataset.tagColor = normalizedColor;
        swatchBtn.setAttribute('aria-label', `Change color for tag #${slug}`);
        swatchBtn.addEventListener('click', () => onPickTagColor(slug, currentColor));
        chip.appendChild(swatchBtn);
      }

      const chipText = document.createElement('span');
      chipText.textContent = slug;
      chip.appendChild(chipText);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'task-detail__tag-remove';
      removeBtn.setAttribute('aria-label', `Remove tag: ${slug}`);
      removeBtn.textContent = '×';
      const capturedSlug = slug;
      removeBtn.addEventListener('click', () => {
        const idx = currentTags.indexOf(capturedSlug);
        if (idx !== -1) currentTags.splice(idx, 1);
        void onSaveTags(task.id, [...currentTags]);
        renderChips();
      });
      chip.appendChild(removeBtn);
      chipsEl.appendChild(chip);
    }
  };

  renderChips();

  // Add-tag input + datalist
  const addRow = document.createElement('div');
  addRow.className = 'task-detail__tag-add';

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'task-detail__tag-input form-input';
  tagInput.placeholder = 'Add tag…';
  tagInput.setAttribute('aria-label', 'Add tag');

  if (cbs.allTagSlugs && cbs.allTagSlugs.length > 0) {
    const dl = document.createElement('datalist');
    dl.id = `task-tags-dl-${task.id}`;
    for (const slug of cbs.allTagSlugs) {
      const opt = document.createElement('option');
      opt.value = slug;
      dl.appendChild(opt);
    }
    tagInput.setAttribute('list', dl.id);
    wrapper.appendChild(dl);
  }

  const commitTag = () => {
    const slug = tagInput.value.trim().toLowerCase();
    if (slug && !currentTags.includes(slug)) {
      currentTags.push(slug);
      void onSaveTags(task.id, [...currentTags]);
      renderChips();
    }
    tagInput.value = '';
  };

  tagInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
  });
  tagInput.addEventListener('change', () => {
    // fires when user selects from datalist
    if (tagInput.value.trim()) commitTag();
  });

  addRow.appendChild(tagInput);
  wrapper.appendChild(addRow);

  return wrapper;
}

// ── Internal helpers ──────────────────────────────────────────────────────────
//
// S2: the two per-variant item builders that used to live here are RETIRED
// (AC-S2-01) — buildTaskItem (item.ts) is the only task-item builder now,
// cloning ONE <template id="tmpl-task-item"> for both variants. See item.ts
// for the implementation.

/**
 * buildAddTaskRow — always-visible "+ Add task" row for rapid in-place creation (P1 S1.4).
 * Pressing Enter in the input calls onCreateTask with the trimmed title (+ optional due).
 * ITEM 4: Calendar button opens the shared calendar via onPickDueForCreate.
 */
function buildAddTaskRow(
  onCreateTask: (title: string, due?: string) => void,
  onPickDueForCreate?: (
    currentDue: string | null,
    onSelected: (dueString: string) => void,
  ) => void,
): HTMLElement {
  const li = document.createElement('li');
  li.className = 'task-add-row';
  // S7: the containing <ul> is role="listbox" (multi-select); this row is an
  // input affordance, not a selectable option — excluded from that role.
  li.setAttribute('role', 'presentation');

  const plusSlot = document.createElement('span');
  plusSlot.className = 'task-add-row__plus';

  const plusIcon = document.createElement('i');
  plusIcon.setAttribute('data-lucide', 'plus');
  plusIcon.setAttribute('aria-hidden', 'true');
  plusSlot.appendChild(plusIcon);
  li.appendChild(plusSlot);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-add-input';
  input.placeholder = 'Add task…';
  input.setAttribute('aria-label', 'New task title');

  // ITEM 4: track pending due selected via calendar
  let pendingDue: string | undefined;

  const submitTask = () => {
    const title = input.value.trim();
    if (title) {
      if (pendingDue) {
        onCreateTask(title, pendingDue);
      } else {
        onCreateTask(title);
      }
      input.value = '';
      pendingDue = undefined;
      dueLabelEl.textContent = '';
      dueLabelEl.removeAttribute('data-has-due');
    }
  };

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submitTask(); }
  });
  li.appendChild(input);

  // ITEM 4: due-date label (shows chosen date, hidden until set)
  const dueLabelEl = document.createElement('span');
  dueLabelEl.className = 'task-add-row__due-label text-caption2';
  li.appendChild(dueLabelEl);

  // ITEM 4: calendar button (only when controller provides the handler)
  if (onPickDueForCreate) {
    const calBtn = document.createElement('button');
    calBtn.type = 'button';
    calBtn.className = 'task-add-row__cal-btn tap-target';
    calBtn.setAttribute('aria-label', 'Set due date for new task');

    const calIcon = document.createElement('i');
    calIcon.setAttribute('data-lucide', 'calendar');
    calIcon.setAttribute('aria-hidden', 'true');
    calBtn.appendChild(calIcon);

    calBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPickDueForCreate(pendingDue ?? null, (dueString) => {
        pendingDue = dueString || undefined;
        dueLabelEl.textContent = pendingDue ?? '';
        if (pendingDue) {
          dueLabelEl.setAttribute('data-has-due', 'true');
        } else {
          dueLabelEl.removeAttribute('data-has-due');
        }
      });
    });

    li.appendChild(calBtn);
  }

  return li;
}

function buildTaskBacklinksSection(
  backlinks: TaskBacklinkDto[],
  templates: TasksTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'browse-detail__links-section';
  section.setAttribute('aria-label', 'Backlinks');

  const h3 = document.createElement('h3');
  h3.className = 'browse-detail__links-heading text-subheadline';
  h3.textContent = 'Backlinks';
  section.appendChild(h3);

  const ul = document.createElement('ul');
  ul.className = 'browse-detail__links-list';
  ul.setAttribute('role', 'list');

  for (const backlink of backlinks) {
    ul.appendChild(buildTaskBacklinkItem(backlink, templates, onNavigate));
  }

  section.appendChild(ul);
  return section;
}

function buildTaskBacklinkItem(
  backlink: TaskBacklinkDto,
  templates: TasksTemplates,
  onNavigate: BrowseNavigateCallback
): HTMLElement {
  const frag = templates.backlinkRow.content.cloneNode(true) as DocumentFragment;
  const row = frag.firstElementChild as HTMLElement;

  const btnEl = row.querySelector('.browse-link-row__btn') as HTMLElement | null;
  const labelEl = row.querySelector('.browse-link-row__label');
  const idEl = row.querySelector('.browse-link-row__id');

  const displayLabel = backlink.label || backlink.source_id;

  if (btnEl) {
    btnEl.dataset.linkId = backlink.source_id;
    btnEl.dataset.linkKind = backlink.source_kind;
    btnEl.setAttribute('aria-label', `${backlink.source_kind}: ${displayLabel}`);
    btnEl.addEventListener('click', () => {
      const kind = resolveTaskKind(backlink.source_kind);
      onNavigate(kind, backlink.source_id);
    });
  }

  if (labelEl) labelEl.textContent = displayLabel;
  if (idEl) idEl.textContent = backlink.source_id;

  return row;
}

function resolveTaskKind(sourceKind: string): 'notes' | 'tasks' | 'events' {
  switch (sourceKind.toLowerCase()) {
    case 'event':
      return 'events';
    case 'note':
      return 'notes';
    default:
      return 'tasks';
  }
}

// ── P8 — Due chip with overdue styling + quick reschedule ─────────────────────
//
// S2: buildDueChipGroup (+ its reschedule-row helpers) moved to item.ts — it
// renders a task-item child, not a section/board/detail concern. Re-exported
// above for backward-compat import paths.

// ── P10 — Reminder chip builder ───────────────────────────────────────────────

/**
 * buildReminderChips — render a set of reminder chips for display.
 *
 * Each chip shows a Bell icon + human-readable label from `formatReminderLabel`.
 * If `onRemove` is provided each chip also gets an × button.
 *
 * Returns null when `reminders` is empty so callers can skip appending.
 * No innerHTML — createElement + textContent only.
 */
export function buildReminderChips(
  reminders: ReminderDto[],
  onRemove?: (index: number) => void,
): HTMLElement | null {
  if (reminders.length === 0) return null;

  const chipsEl = document.createElement('div');
  chipsEl.className = 'reminder-chips';
  chipsEl.setAttribute('aria-label', 'Reminders');

  reminders.forEach((r, idx) => {
    const chip = document.createElement('span');
    chip.className = 'reminder-chip text-caption2';

    const bellIcon = document.createElement('i');
    bellIcon.setAttribute('data-lucide', 'bell');
    bellIcon.setAttribute('aria-hidden', 'true');
    chip.appendChild(bellIcon);

    const label = document.createElement('span');
    label.textContent = formatReminderLabel(r);
    chip.appendChild(label);

    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'reminder-chip__remove';
      removeBtn.setAttribute('aria-label', `Remove reminder: ${formatReminderLabel(r)}`);
      removeBtn.textContent = '×';
      const capturedIdx = idx;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRemove(capturedIdx);
      });
      chip.appendChild(removeBtn);
    }

    chipsEl.appendChild(chip);
  });

  return chipsEl;
}

/**
 * buildReminderEditor — inline editor section for P10.
 *
 * Renders:
 *   - Current reminder chips (removable).
 *   - "+ Add reminder" button that reveals a dropdown with preset options.
 *
 * Calls `onSaveReminders(taskId, newList)` whenever the list changes.
 * No innerHTML — createElement + textContent only.
 */
export function buildReminderEditor(
  taskId: string,
  reminders: ReminderDto[],
  onSaveReminders: (taskId: string, reminders: Array<{ kind: string; value: string }>) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'task-detail__reminders';
  section.setAttribute('aria-label', 'Reminders');

  const heading = document.createElement('h3');
  heading.className = 'task-detail__reminders-heading text-subheadline';
  heading.textContent = 'Reminders';
  section.appendChild(heading);

  // Mutable copy of reminders — keeps local state until save.
  const current: Array<{ kind: string; value: string }> = reminders.map((r) => ({
    kind: r.kind,
    value: r.value,
  }));

  const refreshChips = () => {
    const existing = section.querySelector('.reminder-chips');
    if (existing) existing.remove();
    if (current.length > 0) {
      const chips = buildReminderChips(current as ReminderDto[], (idx) => {
        current.splice(idx, 1);
        refreshChips();
        onSaveReminders(taskId, [...current]);
      });
      if (chips) section.insertBefore(chips, addBtn);
    }
  };

  // Preset relative options.
  const RELATIVE_PRESETS = [
    { label: '30 minutes before', value: '-30m' },
    { label: '1 hour before', value: '-1h' },
    { label: '1 day before', value: '-1d' },
    { label: '2 days before', value: '-2d' },
    { label: '1 week before', value: '-1w' },
  ];

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'reminder-add-btn tap-target';
  addBtn.setAttribute('aria-label', 'Add reminder');
  addBtn.setAttribute('aria-expanded', 'false');
  addBtn.setAttribute('aria-haspopup', 'listbox');

  const bellPlusIcon = document.createElement('i');
  bellPlusIcon.setAttribute('data-lucide', 'bell-plus');
  bellPlusIcon.setAttribute('aria-hidden', 'true');
  addBtn.appendChild(bellPlusIcon);

  const addBtnLabel = document.createElement('span');
  addBtnLabel.textContent = 'Add reminder';
  addBtn.appendChild(addBtnLabel);

  // Dropdown list (hidden until addBtn is clicked).
  const dropdown = document.createElement('ul');
  dropdown.className = 'reminder-add-dropdown hidden';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Choose reminder time');

  for (const preset of RELATIVE_PRESETS) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'reminder-add-dropdown__option';
    optBtn.textContent = preset.label;
    optBtn.addEventListener('click', () => {
      current.push({ kind: 'relative', value: preset.value });
      dropdown.classList.add('hidden');
      addBtn.setAttribute('aria-expanded', 'false');
      refreshChips();
      onSaveReminders(taskId, [...current]);
    });
    li.appendChild(optBtn);
    dropdown.appendChild(li);
  }

  addBtn.addEventListener('click', () => {
    const expanded = addBtn.getAttribute('aria-expanded') === 'true';
    dropdown.classList.toggle('hidden', expanded);
    addBtn.setAttribute('aria-expanded', String(!expanded));
  });

  // Close dropdown when clicking outside.
  document.addEventListener('click', (e: Event) => {
    if (!section.contains(e.target as Node)) {
      dropdown.classList.add('hidden');
      addBtn.setAttribute('aria-expanded', 'false');
    }
  }, { once: false });

  section.appendChild(addBtn);
  section.appendChild(dropdown);

  // Render initial chips.
  refreshChips();

  return section;
}
