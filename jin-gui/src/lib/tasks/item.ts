/**
 * tasks/item.ts — buildTaskItem: the ONE task-item renderer (S2).
 *
 * Before S2, the list row was a template-clone builder (`task-row__*` classes)
 * and the board card was a second, imperative `createElement` builder
 * (`task-card__*` classes) — two components pretending to be two views. That
 * is why the board silently lost create/edit/delete and why it ignored
 * `sort_mode` (Approach §1). `buildTaskItem` replaces both retired builders:
 * ONE `<template id="tmpl-task-item">` (see index.html) is cloned for both the
 * List row and the Board card. The two variants differ ONLY in a root
 * modifier class (`.task-item--row` / `.task-item--card`) — CSS does the
 * layout. A drift can no longer be expressed in TypeScript.
 *
 * AC-S2-02 (parity, [R1]): for every corresponding action (select, status
 * toggle, delete, drag start) both variants MUST fire the identical
 * callback with identical arguments. This module wires every affordance
 * exactly once, from the same code path, for both variants — there is no
 * per-variant branch in the callback wiring below (only in which CSS
 * modifier class is applied to the root element).
 *
 * S3 (the detail pane): the row pencil button and its edit-request callback
 * are RETIRED — selection (the body button click, wired below) opens the
 * detail pane beside the list; there is no second, disjoint editor anymore
 * (AC-S3-04). `buildTaskItem` also takes a `selected` flag
 * (Approach §2) so exactly one item at a time can carry `aria-selected` and
 * the `.task-item--selected` modifier class.
 *
 * S4 (Kanban by status): the board is a genuinely different tool from the
 * list now, not a second grid — per-card DnD DIVERGES on purpose past
 * `dragstart`. Item-to-item reorder (dragover/drop straight onto another
 * item) is wired for the `row` variant only; the `card` variant still fires
 * `onDragStart` (parity + so the board can compute `legalNextStatuses` and
 * mark illegal columns, AC-S4-05) but accepts its drop at the COLUMN level
 * (render.ts), never per-card — within-column drag does not reorder
 * (Approach §3). `done` cards also render an explicit Reopen action
 * (AC-S4-06), card-variant only.
 *
 * No innerHTML — template cloning + textContent/attribute assignment only.
 */

import type { TaskDto } from '../../types/dto';
import {
  taskStatusLabel,
  taskStatusGlyph,
  taskPriorityLabel,
  taskPriorityGlyph,
  formatTaskDue,
  isTaskOverdue,
  type SubtaskDisplayInfo,
  type ParentBreadcrumb,
} from './transform';
import { buildTagChips } from '../lists/render';
import type { BrowseNavigateCallback } from '../notes/render';
import { configureTaskCompletion } from './completion';

/**
 * Pointer-driven task dragging keeps reordering inside the app rather than
 * relying on the host WebView's HTML5 drag session. `elementFromPoint` is
 * deliberately used for targeting: pointer capture means `event.target`
 * remains the grip during a drag.
 */
export interface PointerDragHooks<T extends HTMLElement> {
  onActivate: () => void;
  createPreview?: () => HTMLElement;
  resolveTarget: (clientX: number, clientY: number) => T | null;
  onTargetChange: (previous: T | null, next: T | null, point: { x: number; y: number }) => void;
  onCommit: (target: T, point: { x: number; y: number }) => void;
  onCleanup: () => void;
}

export function wirePointerDrag<T extends HTMLElement>(
  handle: HTMLElement,
  hooks: PointerDragHooks<T>,
): void {
  let session: {
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    target: T | null;
    preview: HTMLElement | null;
    previewPoint: { x: number; y: number } | null;
    previewFrame: number | null;
  } | null = null;
  let suppressClick = false;
  let cleaning = false;

  const cleanup = () => {
    if (!session || cleaning) return;
    cleaning = true;
    const pointerId = session.pointerId;
    const preview = session.preview;
    const previewFrame = session.previewFrame;
    session = null;
    if (previewFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(previewFrame);
    preview?.remove();
    hooks.onCleanup();
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', cleanup);
    cleaning = false;
  };

  const updateTarget = (clientX: number, clientY: number) => {
    if (!session?.active) return;
    const next = hooks.resolveTarget(clientX, clientY);
    hooks.onTargetChange(session.target, next, { x: clientX, y: clientY });
    session.target = next;
  };

  const updatePreview = (clientX: number, clientY: number) => {
    if (!session?.preview) return;
    session.previewPoint = { x: clientX, y: clientY };
    if (session.previewFrame !== null) return;
    const paint = () => {
      if (!session?.preview || !session.previewPoint) return;
      session.previewFrame = null;
      const { x, y } = session.previewPoint;
      const rect = session.preview.getBoundingClientRect();
      const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
      const maxX = Math.max(8, viewportWidth - rect.width - 8);
      const maxY = Math.max(8, viewportHeight - rect.height - 8);
      session.preview.style.transform = `translate3d(${Math.min(Math.max(8, x + 10), maxX)}px, ${Math.min(Math.max(8, y + 10), maxY)}px, 0)`;
      session.preview.style.visibility = 'visible';
    };
    if (typeof requestAnimationFrame === 'function') {
      session.previewFrame = requestAnimationFrame(paint);
    } else {
      paint();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    cleanup();
  };

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || session) return;
    event.preventDefault();
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      preview: null,
      previewPoint: null,
      previewFrame: null,
    };
    handle.setPointerCapture?.(event.pointerId);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cleanup);
  });

  handle.addEventListener('pointermove', (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.active) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < 6) return;
      session.active = true;
      suppressClick = true;
      hooks.onActivate();
      const preview = hooks.createPreview?.();
      if (preview) {
        preview.style.transform = 'translate3d(-9999px, -9999px, 0)';
        preview.style.visibility = 'hidden';
        session.preview = preview;
        document.body.appendChild(preview);
      }
    }
    updatePreview(event.clientX, event.clientY);
    updateTarget(event.clientX, event.clientY);
  });

  handle.addEventListener('pointerup', (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return;
    const target = session.active ? hooks.resolveTarget(event.clientX, event.clientY) : null;
    if (session.active && target) hooks.onCommit(target, { x: event.clientX, y: event.clientY });
    cleanup();
  });

  handle.addEventListener('pointercancel', cleanup);
  handle.addEventListener('lostpointercapture', cleanup);
  handle.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

/** Build a non-interactive visual proxy without duplicating any task controls. */
export function createTaskDragPreview(source: HTMLElement): HTMLElement {
  const preview = document.createElement('div');
  const content = source.cloneNode(true) as HTMLElement;
  const sourceWidth = source.getBoundingClientRect().width;
  const isCard = source.classList.contains('task-item--card');
  preview.classList.add('task-drag-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.setAttribute('inert', '');
  preview.style.inlineSize = `${isCard
    ? Math.min(Math.max(sourceWidth, 180), 300)
    : Math.min(Math.max(sourceWidth, 240), 360)}px`;
  content.classList.remove('task-item--dragging', 'task-item--drop-above', 'task-item--drop-below');
  content.removeAttribute('id');
  content.removeAttribute('role');
  content.removeAttribute('aria-selected');
  for (const attribute of Array.from(content.attributes)) {
    if (attribute.name.startsWith('data-')) content.removeAttribute(attribute.name);
  }
  content.querySelectorAll('.task-item__actions, .task-item__collapse-toggle').forEach((node) => node.remove());
  content.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.removeAttribute('id');
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
    }
  });
  content.querySelectorAll<HTMLElement>('button, a, input, select, textarea').forEach((control) => {
    const replacement = document.createElement('span');
    replacement.className = control.className;
    while (control.firstChild) replacement.appendChild(control.firstChild);
    control.replaceWith(replacement);
  });
  preview.appendChild(content);
  return preview;
}

export type TaskItemVariant = 'row' | 'card';

/**
 * S6 — nesting/subtask info for a single item render. Passed as a distinct
 * trailing param (rather than folded into `TaskDto`) because it is derived
 * from the CURRENT dataset (`computeSubtaskDisplayInfo`, transform.ts), not a
 * static property of the task itself.
 */
export interface TaskItemNestingInfo extends SubtaskDisplayInfo {
  /**
   * true when this item is rendered NESTED directly beneath its parent (list
   * view, a list scope — AC-S6-13). Forces `.task-item--child`, suppresses
   * the drag handle regardless of DnD callbacks (AC-S6-15 — child reorder is
   * out of scope for v1), and skips the parent-breadcrumb chip (redundant —
   * the nesting itself already shows the relationship).
   */
  isChild?: boolean;
}

/**
 * Action callbacks for task-item interactive mutations.
 * All are optional; missing callbacks mean that action is not wired (no-op render).
 * Shared verbatim by both variants — see the module doc above (AC-S2-02).
 */
export interface TaskRowCallbacks {
  /** Called when the status circle is clicked. Controller decides the next status. */
  onStatusToggle?: (taskId: string, currentStatus: string) => void;
  /** True while this task's optimistic completion mutation is in flight. */
  isStatusPending?: (taskId: string) => boolean;
  /** Called when the delete button is clicked. Controller opens confirm dialog. */
  onDeleteRequest?: (taskId: string, taskTitle: string) => void;
  /** Called when Enter is pressed in the add-task input. Optional due passed when set via the inline calendar. */
  onCreateTask?: (title: string, due?: string) => void;
  /**
   * Called when the calendar button in the add-task row is clicked.
   * Controller opens the shared calendar dialog and calls onSelected with the chosen due string.
   */
  onPickDueForCreate?: (
    currentDue: string | null,
    onSelected: (dueString: string) => void,
  ) => void;
  /**
   * Called when a quick-reschedule option is clicked on an overdue due chip.
   * @param taskId  - task to reschedule
   * @param newDue  - new ISO date string (or empty to clear)
   */
  onReschedule?: (taskId: string, newDue: string) => void;
  /**
   * Called when "Pick date…" is clicked on the overdue chip.
   * Controller opens the calendar dialog.
   */
  onPickDate?: (taskId: string, currentDue: string | null) => void;
  /**
   * Called when a drag starts on a task item. Controller decides whether to
   * flip the list to manual mode before accepting the drop.
   */
  onDragStart?: (taskId: string) => void;
  /**
   * Called on a successful drop. The controller receives the task id being
   * dragged plus the task ids immediately above and below the drop point so it
   * can compute the new fractional position via `between(abovePos, belowPos)`.
   * aboveId null  → insert at top of the group.
   * belowId null  → insert at bottom of the group.
   */
  onDrop?: (
    draggedId: string,
    sectionId: string | null,
    aboveId: string | null,
    belowId: string | null,
  ) => void;
  /**
   * Called when the reminder list is saved from the detail-panel chip editor.
   * `reminders` is the new full list (empty array = clear all reminders).
   */
  onSaveReminders?: (taskId: string, reminders: Array<{ kind: string; value: string }>) => void;
  /**
   * S4 (AC-S4-06): called when a `done` card's explicit Reopen action is
   * activated. The FSM's only legal successor for `done` is `todo` — this is
   * the one-click, always-honest way back, independent of drag-and-drop.
   * Rendered only for the card variant (the list row already exposes the
   * same transition via the status-toggle checkbox).
   */
  onReopen?: (taskId: string) => void;
  /**
   * S4: called when a card is dropped on a board COLUMN (never on another
   * card — within-column drag does not reorder, Approach §3). `targetStatus`
   * is the column's status key ('todo' | 'doing' | 'done'). The column
   * itself (render.ts) never accepts a drop for a status that is not a
   * legal successor of the dragged task, so this callback only ever
   * receives a legal transition (AC-S4-03/04).
   */
  onStatusDrop?: (taskId: string, targetStatus: string) => void;
  /**
   * S7: called instead of `onNavigate('tasks', taskId)` when the item's main
   * body button is clicked, IF provided. Receives the raw `MouseEvent` so the
   * controller can read `ctrlKey`/`metaKey`/`shiftKey` and decide plain
   * single-select vs. ctrl/cmd-click toggle vs. shift-click range — the
   * three multi-select interactions the bulk panel drives (Approach: "click,
   * shift-click range, cmd/ctrl-click toggle"). Omit (leave undefined) to
   * fall back to the pre-S7 unconditional `onNavigate` call — every render.ts
   * call site that does not wire this keeps its exact pre-S7 behavior.
   */
  onItemClick?: (taskId: string, event: MouseEvent) => void;
}

/**
 * buildTaskItem — clone `#tmpl-task-item`, populate it for `task`, and wire
 * every affordance identically regardless of `variant`.
 *
 * Identical children in both variants (Approach §1 / S2 action plan #2):
 * drag handle, status toggle, title, due chip group, priority badge, tag
 * chips, action cluster (delete), subtask-progress slot (populated in
 * S6 — rendered empty/inert here, ready for that story to fill in).
 *
 * `selected` (S3, Approach §2): when true, marks the item `aria-selected`
 * and applies `.task-item--selected` so the list can show exactly one
 * selected item while the detail pane is open (AC-S3-03).
 *
 * `nesting` (S6): optional subtask display info — a `2/5` progress badge when
 * `task` itself has children in the current dataset (AC-S6-11), a parent
 * breadcrumb chip when `task` IS a child rendered standalone (board, smart
 * views, "All Lists"), or `{isChild: true}` when `task` is rendered NESTED
 * beneath its parent in list view (AC-S6-13/14/15 — `.task-item--child`, no
 * drag handle, no breadcrumb).
 */
export function buildTaskItem(
  templateEl: HTMLTemplateElement,
  task: TaskDto,
  variant: TaskItemVariant,
  onNavigate: BrowseNavigateCallback,
  callbacks?: TaskRowCallbacks,
  selected: boolean = false,
  nesting?: TaskItemNestingInfo,
): HTMLElement {
  const frag = templateEl.content.cloneNode(true) as DocumentFragment;
  const item = frag.firstElementChild as HTMLElement;

  item.classList.add(`task-item--${variant}`);
  if (variant === 'row') item.classList.add('jin-list-row');
  item.dataset.taskId = task.id;
  item.dataset.taskStatus = task.status.toLowerCase();
  // S7: `role="option"` pairs with the containing list/column's
  // `role="listbox"` + `aria-multiselectable="true"` (render.ts) — correct
  // ARIA for a multi-selectable list, not a fake click-handler-on-a-div.
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', selected ? 'true' : 'false');
  item.classList.toggle('task-item--selected', selected);

  // ── S6: nested-child modifier (AC-S6-13) ──────────────────────────────────
  const isChild = nesting?.isChild === true;
  item.classList.toggle('task-item--child', isChild);

  // ── Dedicated pointer drag grip ───────────────────────────────────────────
  // Native HTML5 DnD is intercepted inconsistently by host WebViews. Task
  // movement therefore begins only from this grip and commits through the
  // existing callbacks. List rows calculate insertion neighbors here; Board
  // cards delegate lane targeting to render.ts.
  //
  // S6: nested children are never independent drag sources.
  const dragHandleEl = item.querySelector('.task-item__drag-handle');
  const wantsDrag =
    !isChild &&
    (variant === 'row'
      ? callbacks?.onDrop !== undefined
      : callbacks?.onStatusDrop !== undefined);
  if (wantsDrag) {
    if (dragHandleEl instanceof HTMLElement) {
      dragHandleEl.removeAttribute('aria-hidden');
      dragHandleEl.setAttribute('aria-label', `Reorder "${task.title}"`);
      dragHandleEl.addEventListener('click', (event) => event.stopPropagation());
      if (variant === 'row' && callbacks?.onDrop) {
        const onDrop = callbacks.onDrop;
        let dropIndicator: HTMLElement | null = null;

        const clearIndicator = () => {
          dropIndicator?.classList.remove('task-item--drop-above', 'task-item--drop-below');
          dropIndicator = null;
        };

        const resolveRowTarget = (clientX: number, clientY: number): HTMLElement | null => {
          const hit = document.elementFromPoint?.(clientX, clientY) ?? null;
          const row = hit?.closest<HTMLElement>('.task-item--row[data-task-id]') ?? null;
          if (!row || row === item) return row;
          return row.parentElement === item.parentElement ? row : null;
        };

        const parentOfChild = (row: HTMLElement): HTMLElement | null => {
          if (!row.classList.contains('task-item--child')) return row;
          const parentId = row.dataset.parentId;
          return parentId
            ? Array.from(row.parentElement?.children ?? []).find(
              (candidate): candidate is HTMLElement =>
                candidate instanceof HTMLElement && candidate.dataset.taskId === parentId,
            ) ?? null
            : null;
        };

        const lastChildOf = (parent: HTMLElement): HTMLElement => {
          let boundary = parent;
          for (let sibling = parent.nextElementSibling as HTMLElement | null;
            sibling?.classList.contains('task-item--child') && sibling.dataset.parentId === parent.dataset.taskId;
            sibling = sibling.nextElementSibling as HTMLElement | null) {
            boundary = sibling;
          }
          return boundary;
        };

        wirePointerDrag(dragHandleEl, {
          onActivate: () => {
            item.classList.add('task-item--dragging');
            callbacks.onDragStart?.(task.id);
          },
          createPreview: () => createTaskDragPreview(item),
          resolveTarget: resolveRowTarget,
          onTargetChange: (_previous, next, point) => {
            clearIndicator();
            if (!next || next === item) return;
            const parent = parentOfChild(next);
            if (!parent) return;
            const rect = next.getBoundingClientRect();
            const isAbove = point.y < rect.top + rect.height / 2;
            dropIndicator = next.classList.contains('task-item--child') && !isAbove
              ? lastChildOf(parent)
              : parent;
            dropIndicator.classList.add(isAbove ? 'task-item--drop-above' : 'task-item--drop-below');
          },
          onCommit: (target, point) => {
            if (target === item) return;
            const parent = parentOfChild(target);
            if (!parent) return;
            const parentList = parent.parentElement;
            if (parentList !== item.parentElement) return;
            const topLevelRows = Array.from(parentList?.children ?? []).filter(
              (child): child is HTMLElement =>
                child instanceof HTMLElement &&
                child.matches('.task-item--row[data-task-id]:not(.task-item--child)') &&
                child.dataset.taskId !== task.id,
            );
            const targetIndex = topLevelRows.indexOf(parent);
            if (targetIndex < 0) return;
            const rect = target.getBoundingClientRect();
            const isAbove = point.y < rect.top + rect.height / 2;
            const aboveId = isAbove
              ? topLevelRows[targetIndex - 1]?.dataset.taskId ?? null
              : parent.dataset.taskId ?? null;
            const belowId = isAbove
              ? parent.dataset.taskId ?? null
              : topLevelRows[targetIndex + 1]?.dataset.taskId ?? null;
            const sectionId = parent.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId ?? null;
            if (aboveId === task.id || belowId === task.id) return;
            onDrop(task.id, sectionId, aboveId, belowId);
          },
          onCleanup: () => {
            clearIndicator();
            item.classList.remove('task-item--dragging');
          },
        });
      }
    }
  } else {
    // No DnD wiring at all — remove the (otherwise inert) handle rather than
    // show a grip icon that does nothing, matching the pre-S2 behavior.
    dragHandleEl?.remove();
    item.classList.add('task-item--without-drag');
  }

  // ── Status toggle (checkbox) ──────────────────────────────────────────────
  const statusBtnEl = item.querySelector('.task-item__status-btn') as HTMLElement | null;
  const statusBadgeEl = item.querySelector('.task-item__status-badge') as HTMLElement | null;
  const statusIconEl = item.querySelector('.task-item__status-icon');
  const statusLabelEl = item.querySelector('.task-item__status-label');

  const sLabel = taskStatusLabel(task.status);
  if (statusBadgeEl) {
    statusBadgeEl.setAttribute('aria-label', `Status: ${sLabel}`);
    statusBadgeEl.dataset.taskStatus = task.status.toLowerCase();
  }
  if (statusIconEl) statusIconEl.setAttribute('data-lucide', taskStatusGlyph(task.status));
  if (statusLabelEl) statusLabelEl.textContent = sLabel;

  if (statusBtnEl) {
    configureTaskCompletion(statusBtnEl as HTMLButtonElement, task, callbacks?.onStatusToggle);
    const isPending = callbacks?.isStatusPending?.(task.id) === true;
    (statusBtnEl as HTMLButtonElement).disabled = isPending;
    statusBtnEl.setAttribute('aria-busy', String(isPending));
  }

  // ── Main body button (select / navigate) ──────────────────────────────────
  const bodyEl = item.querySelector('.task-item__body') as HTMLElement | null;
  const titleEl = item.querySelector('.task-item__title');

  if (bodyEl) {
    bodyEl.dataset.taskId = task.id;
    bodyEl.setAttribute(
      'aria-label',
      `${task.title} — ${sLabel}, ${taskPriorityLabel(task.priority)} priority`,
    );
    // S7 (roving tabindex, Approach: "genuinely accessible... real focus
    // management"): the selected item's body is the one Tab stop; every
    // other item is reachable only via arrow-key nav (TasksController) or
    // programmatic .focus() — never removed from the accessibility tree,
    // just out of the default Tab sequence. renderTasksList/renderBoardView/
    // renderListViewWithSections fall back to tabIndex 0 on the first item
    // when nothing is selected yet, so the list is never Tab-unreachable.
    bodyEl.tabIndex = selected ? 0 : -1;
    bodyEl.addEventListener('click', (e: MouseEvent) => {
      if (callbacks?.onItemClick) {
        callbacks.onItemClick(task.id, e);
      } else {
        onNavigate('tasks', task.id);
      }
    });
  }
  if (titleEl) titleEl.textContent = task.title;

  // ── S6: subtask progress badge (AC-S6-11) ─────────────────────────────────
  // Populated ONLY when `task` itself has children in the current dataset;
  // left empty otherwise (`.task-item__subtask-progress:empty` hides it —
  // browse.css). A nested child never shows its own progress badge redundant
  // with the parent's, but a subtask could itself carry the badge if depth
  // allowed grandchildren — it never does (depth capped at one), so this is
  // simply "does `nesting.progress` exist for this task".
  const progressEl = item.querySelector('.task-item__subtask-progress');
  if (progressEl) {
    if (nesting?.progress) {
      const { done, total } = nesting.progress;
      progressEl.textContent = `${done}/${total}`;
      progressEl.setAttribute('aria-label', `${done} of ${total} subtasks complete`);
      progressEl.removeAttribute('aria-hidden');
    } else {
      progressEl.textContent = '';
    }
  }

  // ── Due chip group (identical child in both variants) ────────────────────
  const metaEl = item.querySelector('.task-item__meta');
  if (task.due && metaEl) {
    metaEl.insertBefore(buildDueChipGroup(task, callbacks), metaEl.firstChild);
  }

  // ── S6: parent breadcrumb chip (Approach §6 action plan item 6) ──────────
  // Only for a child rendered STANDALONE (board, smart views, "All Lists") —
  // never for a nested child (isChild), where the nesting itself already
  // shows the relationship.
  if (!isChild && nesting?.parentBreadcrumb && metaEl) {
    metaEl.insertBefore(buildParentBreadcrumbChip(nesting.parentBreadcrumb, onNavigate), metaEl.firstChild);
  }

  // ── Tag chips ──────────────────────────────────────────────────────────────
  const tagsSlotEl = item.querySelector('.task-item__tags');
  const tagChips = buildTagChips(task.tags);
  if (tagChips && tagsSlotEl) {
    tagsSlotEl.replaceWith(tagChips);
  } else {
    // No tags — remove the empty placeholder rather than leave a ruleless
    // container in the DOM (matches the pre-S2 behavior: no tags element at
    // all when the task has none).
    tagsSlotEl?.remove();
  }

  // ── Priority badge ────────────────────────────────────────────────────────
  const priorityBadgeEl = item.querySelector('.task-item__priority') as HTMLElement | null;
  const priorityIconEl = item.querySelector('.task-item__priority-icon') as HTMLElement | null;
  const priorityLabelEl = item.querySelector('.task-item__priority-label');

  const pLabel = taskPriorityLabel(task.priority);
  if (priorityBadgeEl) priorityBadgeEl.setAttribute('aria-label', `Priority: ${pLabel}`);

  const pGlyph = taskPriorityGlyph(task.priority);
  if (priorityIconEl) {
    if (pGlyph) {
      priorityIconEl.setAttribute('data-lucide', pGlyph);
      priorityIconEl.setAttribute('data-priority', task.priority.toLowerCase());
    } else {
      priorityIconEl.style.display = 'none';
    }
  }
  if (priorityLabelEl) priorityLabelEl.textContent = pLabel;

  // ── Action cluster: delete (identical in both variants) ──────────────────
  // S3: the pencil/edit button is RETIRED — selection (the body button
  // click above) opens the detail pane; there is no second editor anymore
  // (AC-S3-04). Only the delete affordance remains in the hover cluster.
  const deleteBtnEl = item.querySelector('.task-item__delete-btn') as HTMLElement | null;

  if (deleteBtnEl && callbacks?.onDeleteRequest) {
    const onDeleteRequest = callbacks.onDeleteRequest;
    deleteBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeleteRequest(task.id, task.title);
    });
  }

  // ── S4: explicit Reopen action for a `done` board CARD (AC-S4-06) ────────
  // `done`'s only legal successor is `todo`. Rendered ONLY for the card
  // variant, always visible (not hover-gated like the delete cluster) — a
  // done card is otherwise inert on the board (Approach §3: "two honest
  // clicks beat one lying one"), so the one legal way back must not be
  // hidden behind a hover affordance.
  if (variant === 'card' && task.status === 'done' && callbacks?.onReopen) {
    const onReopen = callbacks.onReopen;
    const reopenBtn = document.createElement('button');
    reopenBtn.type = 'button';
    reopenBtn.className = 'task-item__reopen-btn jin-control tap-target';
    reopenBtn.setAttribute('aria-label', `Reopen "${task.title}"`);

    const reopenIcon = document.createElement('i');
    reopenIcon.setAttribute('data-lucide', 'rotate-ccw');
    reopenIcon.setAttribute('aria-hidden', 'true');
    reopenBtn.appendChild(reopenIcon);

    const reopenLabel = document.createElement('span');
    reopenLabel.textContent = 'Reopen';
    reopenBtn.appendChild(reopenLabel);

    reopenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onReopen(task.id);
    });
    item.appendChild(reopenBtn);
  }

  // ── S6 subtask-progress slot — inert placeholder until S6 populates it ───
  // (No `parent`/children fields exist on TaskDto yet; left empty on purpose.)

  return item;
}

// ── Due chip (P8 — moved from render.ts in S2; item-scoped rendering) ───────

/**
 * buildDueChipGroup — render a due-date chip + optional quick-reschedule affordance.
 *
 * If the task is overdue (due < now) AND not done/cancelled, the chip gets
 * `data-overdue="true"` which triggers the danger-token color via CSS.
 * Below the chip, a reschedule affordance row (Today / Tomorrow / Next week /
 * Pick date…) is rendered so the user can quickly re-assign a new due date.
 *
 * No innerHTML — createElement + textContent only.
 */
export function buildDueChipGroup(
  task: TaskDto,
  callbacks?: TaskRowCallbacks,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'due-chip-group';

  // Derive overdue: only for active tasks (todo/doing)
  const isActive = task.status === 'todo' || task.status === 'doing';
  const now = new Date().toISOString();
  const overdue = isActive && isTaskOverdue(task.due, now);
  const hasQuickActions = overdue && Boolean(callbacks?.onReschedule || callbacks?.onPickDate);

  // The date is a real button: pointer users own the hover target here, while
  // keyboard and touch users can explicitly disclose the same actions.
  const chipEl = document.createElement(hasQuickActions ? 'button' : 'span');
  if (chipEl instanceof HTMLButtonElement) chipEl.type = 'button';
  chipEl.className = 'task-due-chip text-caption2';
  chipEl.setAttribute('aria-label', `Due: ${formatTaskDue(task.due)}`);
  if (overdue) {
    chipEl.setAttribute('data-overdue', 'true');
    chipEl.setAttribute('aria-label', `Overdue: ${formatTaskDue(task.due)}`);
  }

  const calIcon = document.createElement('i');
  calIcon.setAttribute('data-lucide', 'calendar-days');
  calIcon.setAttribute('aria-hidden', 'true');
  chipEl.appendChild(calIcon);

  const chipText = document.createElement('span');
  chipText.textContent = formatTaskDue(task.due);
  chipEl.appendChild(chipText);

  wrapper.appendChild(chipEl);

  // Quick-reschedule affordance (only for overdue active tasks)
  if (hasQuickActions && callbacks) {
    const close = (restoreFocus = false, suppressHover = false) => {
      wrapper.removeAttribute('data-open');
      if (suppressHover) wrapper.setAttribute('data-dismissed', 'true');
      else wrapper.removeAttribute('data-dismissed');
      chipEl.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      if (restoreFocus) chipEl.focus();
    };
    const handleOutsidePointerDown = (event: Event) => {
      if (!wrapper.contains(event.target as Node)) close();
    };
    const rescheduleEl = buildRescheduleRow(task, callbacks, () => close());
    rescheduleEl.id = `due-reschedule-${task.id}`;
    chipEl.setAttribute('aria-controls', rescheduleEl.id);
    chipEl.setAttribute('aria-expanded', 'false');
    chipEl.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !wrapper.hasAttribute('data-open');
      if (!willOpen) {
        close();
        return;
      }
      wrapper.removeAttribute('data-dismissed');
      wrapper.setAttribute('data-open', 'true');
      chipEl.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', handleOutsidePointerDown);
    });
    wrapper.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true, true);
    });
    wrapper.addEventListener('pointerleave', () => {
      wrapper.removeAttribute('data-dismissed');
    });
    wrapper.appendChild(rescheduleEl);
  }

  return wrapper;
}

// ── S6 — parent breadcrumb chip (standalone child items) ─────────────────────

/**
 * buildParentBreadcrumbChip — a small chip naming the parent task, shown on a
 * child item rendered standalone (board, smart views, "All Lists" — Approach
 * §6 action plan item 6). Plain text (no icon glyph) so it needs no icon
 * registration; clicking it selects the parent, same as clicking any item.
 *
 * No innerHTML — createElement + textContent only.
 */
function buildParentBreadcrumbChip(
  breadcrumb: ParentBreadcrumb,
  onNavigate: BrowseNavigateCallback,
): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'task-item__parent-chip text-caption2';
  chip.setAttribute('aria-label', `Subtask of "${breadcrumb.parentTitle}" — open parent`);
  chip.textContent = `↳ ${breadcrumb.parentTitle}`;
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    onNavigate('tasks', breadcrumb.parentId);
  });
  return chip;
}

function buildRescheduleRow(
  task: TaskDto,
  callbacks: TaskRowCallbacks,
  onAction: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'due-reschedule';

  const options: Array<{ label: string; getDue: () => string }> = [
    { label: 'Today', getDue: () => todayIso() },
    { label: 'Tomorrow', getDue: () => tomorrowIso() },
    { label: 'Next week', getDue: () => nextWeekIso() },
  ];

  for (const opt of options) {
    if (!callbacks.onReschedule) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'due-reschedule__btn jin-control jin-control--secondary';
    btn.textContent = opt.label;
    const newDue = opt.getDue();
    const onReschedule = callbacks.onReschedule;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onReschedule(task.id, newDue);
      onAction();
    });
    row.appendChild(btn);
  }

  if (callbacks.onPickDate) {
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'due-reschedule__btn jin-control jin-control--secondary';
    pickBtn.textContent = 'Pick date…';
    const onPickDate = callbacks.onPickDate;
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPickDate(task.id, task.due ?? null);
      onAction();
    });
    row.appendChild(pickBtn);
  }

  return row;
}

function todayIso(): string {
  const d = new Date();
  return isoDate(d);
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function nextWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return isoDate(d);
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
