/**
 * tasks/transform.ts — pure tasks transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * TasksController is the thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/tasks_controller.test.ts
 */

import type { TaskDto, SectionDto, ReminderDto } from '../../types/dto';
// Re-export overdue helper from the calendar pure layer so callers only need one import.
export { isTaskOverdue } from '../calendar/transform';

// ── Filter ────────────────────────────────────────────────────────────────────

export interface TasksFilter {
  /** Filter by status. Empty string = no filter. */
  status?: string;
  /** Filter by list name. Empty string = no filter. */
  list?: string;
  /** Filter by priority. Empty string = no filter. */
  priority?: string;
  /** P4: filter by tag slug. Empty string = no filter. */
  tag?: string;
}

/**
 * filterTasksList — exclude soft-deleted tasks; apply optional status/list/priority filters.
 *
 * The filter values are also passed directly through to listTasks() in the invoke call
 * (core does authoritative filtering). This pure function is for local re-filter after
 * data is loaded.
 *
 * Returns a new array; does NOT mutate the input.
 */
export function filterTasksList(tasks: TaskDto[], filter: TasksFilter): TaskDto[] {
  return tasks.filter((task) => {
    if (task.deleted_at != null) return false;
    if (filter.status != null && filter.status !== '' && task.status !== filter.status) return false;
    if (filter.list != null && filter.list !== '' && task.list !== filter.list) return false;
    if (filter.priority != null && filter.priority !== '' && task.priority !== filter.priority)
      return false;
    // P4: tag filter — the core already post-filters; this is a local safety net.
    if (filter.tag != null && filter.tag !== '') {
      const tags = task.tags ?? [];
      if (!tags.includes(filter.tag)) return false;
    }
    return true;
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * Priority sort weights: high=3 > medium=2 > low=1 > none=0.
 * Canonical vocabulary: none | low | medium | high (core Priority enum).
 * Any unknown value sorts as none (weight 0).
 */
const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

/**
 * sortTasksList — deterministic sort: high priority first (descending weight),
 * then most-recently-updated.
 * Returns a new array; does NOT mutate the input.
 */
export function sortTasksList(tasks: TaskDto[]): TaskDto[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority.toLowerCase()] ?? 0;
    const pb = PRIORITY_ORDER[b.priority.toLowerCase()] ?? 0;
    if (pa !== pb) return pb - pa; // descending: high first
    return b.updated.localeCompare(a.updated);
  });
}

// ── Status FSM (S1: honest controls) ─────────────────────────────────────────

/**
 * legalNextStatuses — pure mirror of `TaskStatus::can_transition_to`
 * (jin-core/src/model/task.rs:49-61). Returns the legal *successor* set for a
 * given current status — never includes the current status itself.
 *
 *   todo      -> [doing, done, cancelled]
 *   doing     -> [todo, done, cancelled]
 *   done      -> [todo]                    (reopen only)
 *   cancelled -> [todo]                    (reopen only)
 *   deleted   -> []                        (tombstone; no legal transition out)
 *
 * This table is the GUI's half of the FSM parity contract. IMPORTANT: this
 * table is itself just a TypeScript literal — restating it back at itself in
 * a test would be a tautology (it would pass even if core's
 * `can_transition_to` changed underneath it). The real guarantee lives in
 * AC-S1-04's test (`tasks_controller.test.ts#legal_next_statuses_mirrors_core_fsm`),
 * which PARSES `jin-core/src/model/task.rs` directly at test time (the enum
 * variants + the `matches!` arm pairs) and compares that parsed table against
 * this one — including for any new TaskStatus variant added to core, which
 * that test will catch until this table (and this fn) accounts for it. If you
 * change an arm in `can_transition_to`, update this table to match or that
 * test fails; changing only this table without updating core is equally
 * unprotected against by design (core is the source of truth here — this
 * table follows it, not the other way around).
 */
const LEGAL_NEXT_STATUSES: Record<string, string[]> = {
  todo: ['doing', 'done', 'cancelled'],
  doing: ['todo', 'done', 'cancelled'],
  done: ['todo'],
  cancelled: ['todo'],
  deleted: [],
};

export function legalNextStatuses(current: string): string[] {
  return LEGAL_NEXT_STATUSES[current.toLowerCase()] ?? [];
}

// ── Status label / glyph ─────────────────────────────────────────────────────

/**
 * taskStatusLabel — human-readable status label (text identifier, color-independent).
 * HIG mandate: status is shown by color AND glyph AND label (WCAG 1.4.1).
 */
export function taskStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'todo':
      return 'To Do';
    case 'doing':
      return 'In Progress';
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.length > 0 ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  }
}

/**
 * taskStatusGlyph — Lucide icon name for the status.
 * Supplementary to the text label; never the sole visual identifier.
 */
export function taskStatusGlyph(status: string): string {
  switch (status.toLowerCase()) {
    case 'todo':
      return 'circle';
    case 'doing':
      return 'circle-dot';
    case 'done':
      return 'check-circle';
    case 'cancelled':
      return 'x-circle';
    default:
      return 'circle';
  }
}

// ── Priority label / glyph ────────────────────────────────────────────────────

/**
 * taskPriorityLabel — human-readable priority label (color-independent text identifier).
 * Canonical vocabulary: none | low | medium | high.
 */
export function taskPriorityLabel(priority: string): string {
  switch (priority.toLowerCase()) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    case 'none':
      return 'None';
    default:
      return priority.length > 0 ? priority.charAt(0).toUpperCase() + priority.slice(1) : 'None';
  }
}

/**
 * taskPriorityGlyph — Lucide icon name for the priority.
 * All non-none priorities use a Flag glyph (tinted via CSS data-priority attribute).
 * none → '' (no glyph; the priority icon element should be hidden by render.ts).
 * Supplementary to the text label; never the sole visual identifier.
 * CSS tinting: data-priority="high" → --color-danger; "medium" → --color-warning/accent;
 *              "low" → --color-label-secondary (muted); "" / "none" → no icon.
 */
export function taskPriorityGlyph(priority: string): string {
  switch (priority.toLowerCase()) {
    case 'high':
    case 'medium':
    case 'low':
      return 'flag';
    default:
      return ''; // none and unknown → no flag
  }
}

// ── Section grouping (P6) ─────────────────────────────────────────────────────

/**
 * A group of tasks belonging to one section (or "No Section").
 * Used by both list-view and board-view renderers.
 */
export interface TaskGroup {
  /** null = "No Section" bucket (tasks with section_id null or unresolved). */
  sectionId: string | null;
  sectionName: string;
  /** Fractional position key; "0" for the "No Section" bucket so it sorts first (before named sections). */
  position: string;
  tasks: TaskDto[];
}

/**
 * groupTasksBySection — bucket tasks into groups by section_id.
 *
 * Group order: named sections sorted by `position` ascending, then "No Section" last.
 * (Spec: sections in `position` order, plus a "No Section" group for null section_id.)
 * Tasks that reference a section_id not in `sections` are bucketed into "No Section".
 *
 * Pure function — does NOT mutate either input array.
 */
export function groupTasksBySection(tasks: TaskDto[], sections: SectionDto[]): TaskGroup[] {
  // Build a map of sectionId → group.
  const groupMap = new Map<string, TaskGroup>();

  // Seed one group per named section.
  for (const sec of sections) {
    groupMap.set(sec.id, {
      sectionId: sec.id,
      sectionName: sec.name,
      position: sec.position,
      tasks: [],
    });
  }

  // Build a "No Section" bucket (position "" sorts lexicographically before real positions,
  // but we render named sections first and no-section last per spec).
  const noSectionGroup: TaskGroup = {
    sectionId: null,
    sectionName: 'No Section',
    position: '',
    tasks: [],
  };

  // Distribute tasks.
  for (const task of tasks) {
    const sid = task.section_id ?? null;
    if (sid != null && groupMap.has(sid)) {
      groupMap.get(sid)!.tasks.push(task);
    } else {
      noSectionGroup.tasks.push(task);
    }
  }

  // Sort named sections by position ascending.
  const namedGroups = [...groupMap.values()].sort((a, b) => a.position.localeCompare(b.position));

  // "No Section" always last.
  return [...namedGroups, noSectionGroup];
}

/**
 * sortTasksForMode — sort a flat array of tasks within a section.
 *
 * Modes:
 *   manual   — by task.position ascending (fractional rank key; "" sorts first).
 *   due      — by due date ascending, null last.
 *   priority — by priority descending: high=3 > medium=2 > low=1 > none=0.
 *   title    — alphabetically ascending (case-insensitive).
 *   created  — by created ascending.
 *
 * Returns a new array; does NOT mutate the input.
 */
export function sortTasksForMode(tasks: TaskDto[], sortMode: string): TaskDto[] {
  return [...tasks].sort((a, b) => {
    switch (sortMode) {
      case 'manual': {
        const pa = a.position ?? '';
        const pb = b.position ?? '';
        return pa.localeCompare(pb);
      }
      case 'due': {
        // null due → treat as far future (sorts last).
        const da = a.due ?? '￿';
        const db = b.due ?? '￿';
        return da.localeCompare(db);
      }
      case 'priority': {
        const pw = (p: string) => PRIORITY_ORDER[p.toLowerCase()] ?? 0;
        const diff = pw(b.priority) - pw(a.priority);
        if (diff !== 0) return diff;
        return b.updated.localeCompare(a.updated);
      }
      case 'title': {
        return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      }
      case 'created': {
        return a.created.localeCompare(b.created);
      }
      default:
        return 0;
    }
  });
}

// ── S6: subtasks ──────────────────────────────────────────────────────────────

/** `2/5`-style progress for a parent task, derived from its children's statuses. */
export interface SubtaskProgress {
  done: number;
  total: number;
}

/** A parent breadcrumb chip's data for a subtask rendered standalone. */
export interface ParentBreadcrumb {
  parentId: string;
  parentTitle: string;
}

/**
 * partitionParentsAndChildren — split a flat task array into "top-level"
 * tasks and a lookup of direct children keyed by parent id (S6 — depth is
 * capped at one, so a child never has children of its own).
 *
 * A task whose `parent` id is NOT present in `tasks` (e.g. filtered out of
 * the current scope) is treated as top-level here — there is nothing in this
 * dataset to nest it under (AC-S6-13's "list scope in list view" — a subtask
 * outside the loaded set can't be rendered nested regardless).
 *
 * Pure — does not mutate `tasks`.
 */
export function partitionParentsAndChildren(tasks: TaskDto[]): {
  topLevel: TaskDto[];
  childrenByParent: Map<string, TaskDto[]>;
} {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const childrenByParent = new Map<string, TaskDto[]>();
  const topLevel: TaskDto[] = [];
  for (const task of tasks) {
    const parentId = task.parent ?? null;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(task);
      childrenByParent.set(parentId, list);
    } else {
      topLevel.push(task);
    }
  }
  return { topLevel, childrenByParent };
}

/** Per-task S6 display info: a parent's subtask progress, a child's breadcrumb. */
export interface SubtaskDisplayInfo {
  /** Set when this task HAS children in the given dataset (AC-S6-11 — `2/5` badge). */
  progress?: SubtaskProgress;
  /** Set when this task IS a child whose parent is present in the given dataset. */
  parentBreadcrumb?: ParentBreadcrumb;
}

/**
 * computeSubtaskDisplayInfo — derive, per task id, the `2/5` progress badge
 * info (for a parent) and the parent-breadcrumb info (for a child), from one
 * flat `TaskDto[]`. Pure; a task absent from the returned map has neither.
 *
 * Used by BOTH the nested list-view rendering (progress only — children
 * render nested, not as a breadcrumb) and the standalone board/smart-view/
 * "All Lists" rendering (both — Approach §6 action plan item 6: "board and
 * smart views show children as standalone items with a parent breadcrumb chip").
 */
export function computeSubtaskDisplayInfo(tasks: TaskDto[]): Map<string, SubtaskDisplayInfo> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const info = new Map<string, SubtaskDisplayInfo>();

  const { childrenByParent } = partitionParentsAndChildren(tasks);
  for (const [parentId, children] of childrenByParent) {
    const parentTask = byId.get(parentId);
    if (!parentTask) continue; // partitionParentsAndChildren already excludes this case
    const done = children.filter((c) => c.status === 'done').length;
    info.set(parentId, { ...info.get(parentId), progress: { done, total: children.length } });
    for (const child of children) {
      info.set(child.id, {
        ...info.get(child.id),
        parentBreadcrumb: { parentId, parentTitle: parentTask.title },
      });
    }
  }

  return info;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * formatTaskDue — formats an ISO due date for display.
 * Returns "No due date" when due is null.
 */
export function formatTaskDue(due: string | null): string {
  if (due == null) return 'No due date';
  const d = new Date(due);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ── Reminder label formatter (P10) ────────────────────────────────────────────

/**
 * Relative offset labels — maps stored value → human string.
 * Keeping these as a static table means no math, no i18n library required.
 */
const RELATIVE_LABELS: Record<string, string> = {
  '-5m': '5 minutes before',
  '-10m': '10 minutes before',
  '-15m': '15 minutes before',
  '-30m': '30 minutes before',
  '-1h': '1 hour before',
  '-2h': '2 hours before',
  '-1d': '1 day before',
  '-2d': '2 days before',
  '-1w': '1 week before',
};

/**
 * formatReminderLabel — pure: returns a human-readable label for a reminder chip.
 *
 * Relative reminder (kind="relative"): value is a signed offset like "-30m", "-1h", "-1d".
 * Absolute reminder (kind="absolute"): value is an RFC-3339 timestamp.
 * Unknown kind or unrecognized relative value → returns the raw value.
 *
 * Pure function — no DOM access, no side effects.
 */
export function formatReminderLabel(reminder: ReminderDto): string {
  if (reminder.kind === 'relative') {
    return RELATIVE_LABELS[reminder.value] ?? reminder.value;
  }
  if (reminder.kind === 'absolute') {
    const d = new Date(reminder.value);
    if (isNaN(d.getTime())) return reminder.value;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return reminder.value;
}
