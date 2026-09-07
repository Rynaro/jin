/**
 * lists/counts.ts — computeSidebarCounts: pure, client-side sidebar badge
 * counts (S5 — Approach §4).
 *
 * ⚠️ MUST NOT read `ListDto.task_count` for a badge. `task_count` is
 * computed server-side (`jin-core/src/index/query.rs`) and counts `done`
 * tasks too — a badge sourced from it never goes down when a task is
 * completed, which is precisely the "counts are stale/wrong" complaint this
 * story exists to fix. Every count here is derived from the fetched
 * `TaskDto[]` instead, open statuses only (`todo` | `doing`).
 *
 * Pure — no DOM access, no invoke calls. Tested by:
 * src/__tests__/lists_controller.test.ts (AC-S5-05).
 */

import type { TaskDto, ListDto } from '../../types/dto';
import { applyScope } from '../tasks/scopes';

export interface SidebarCounts {
  /**
   * Smart-view badge counts. `completed` intentionally has NO entry here —
   * the rail renders no badge for it (Approach §4: "a badge that never goes
   * down is noise" applies doubly to a view that is ALL closed tasks).
   */
  smartViews: {
    inbox: number;
    today: number;
    upcoming: number;
    flexible: number;
  };
  /** Open-task count per real list id — never `ListDto.task_count`. */
  lists: Record<string, number>;
}

/**
 * computeSidebarCounts — open-task counts for every smart view and every
 * real list, from one fetched `TaskDto[]` (Assumption A4: personal-scale
 * data makes this cheap to recompute on every `jin:tasks-changed`).
 *
 * The per-list counts are a STRICT id match (same contract as
 * `filterTasksList`) — they must agree with what clicking that list's rail
 * row actually renders. The `inbox` smart-view count is intentionally
 * WIDER (see `scopes.ts`'s ORPHAN HANDLING note): it also counts open tasks
 * whose `list` resolves to no known list id, so an orphaned task is not
 * silently dropped from every count in the sidebar.
 */
export function computeSidebarCounts(tasks: TaskDto[], lists: ListDto[]): SidebarCounts {
  const active = tasks.filter((t) => t.deleted_at == null);

  const inbox = applyScope(active, { kind: 'smart', id: 'inbox' }, lists).length;
  const today = applyScope(active, { kind: 'smart', id: 'today' }, lists).length;
  const upcoming = applyScope(active, { kind: 'smart', id: 'upcoming' }, lists).length;
  const flexible = applyScope(active, { kind: 'smart', id: 'flexible' }, lists).length;

  const listCounts: Record<string, number> = {};
  for (const list of lists) {
    listCounts[list.id] = active.filter(
      (t) => t.list === list.id && (t.status === 'todo' || t.status === 'doing'),
    ).length;
  }

  return { smartViews: { inbox, today, upcoming, flexible }, lists: listCounts };
}
