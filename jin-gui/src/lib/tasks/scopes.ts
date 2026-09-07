/**
 * tasks/scopes.ts — the sidebar's smart views, as pure functions over the
 * fetched TaskDto[] (S5 — Approach §4).
 *
 * `TaskScope` is the sidebar rail's single source of truth for "where the
 * user is": one of four smart views, or a specific list (by id, never a
 * name). The rail owns scope end to end: `ListsController` dispatches
 * `jin:scope-changed` on a rail click; `TasksController` consumes it and
 * reloads (S5 action plan item 1/4).
 *
 * All functions here are pure: no DOM access, no invoke calls.
 * Tested by: src/__tests__/tasks_controller.test.ts (AC-S5-06, AC-S6-10).
 *
 * Definitions (Approach §4):
 *   inbox     — open tasks (`todo` | `doing`) in the DEFAULT list, plus any
 *               open task whose `list` matches no known list id (see ORPHAN
 *               HANDLING below).
 *   today     — open tasks whose due date is today or earlier (an overdue
 *               task is "today or earlier" too — nothing overdue should be
 *               hideable behind "upcoming").
 *   upcoming  — open tasks whose due date is strictly later than today.
 *   completed — tasks whose status is `done` or `cancelled` (any list).
 *
 * ── ORPHAN HANDLING (owner-directed; D7 migration stays deferred) ───────────
 *
 * `task.list` can hold a stale list NAME instead of an id (ATLAS D7 / spec
 * Deferred §D7) — a historical bug this story does NOT fix.
 * `filterTasksList` (transform.ts) stays id-based and correct; it is not
 * touched here. Such an "orphaned" task matches no `{kind:'list'}` scope
 * (there is no rail row for a name that isn't a real list id) and would
 * otherwise vanish from every count and every scope — the owner asked that
 * the sidebar not lie by omission about this.
 *
 * Resolution: the INBOX SMART VIEW (this module's `'inbox'` case only — NOT
 * the literal Inbox LIST row, which stays a strict id match like every other
 * list) folds in every open task whose `list` id fails to resolve against
 * the known list set. This makes an orphan genuinely reachable (clicking
 * Inbox actually renders it, not just a count that never matches what's
 * shown) without inventing any new UI — Inbox already is the sidebar's
 * catch-all-ish smart view. `today` / `upcoming` / `completed` need no
 * special-casing: they already scan every task regardless of `list`
 * resolution, so an orphan with a due date or a closed status was already
 * reachable there.
 */

import type { TaskDto, ListDto } from '../../types/dto';

export type TaskScope =
  | { kind: 'smart'; id: 'inbox' | 'today' | 'upcoming' | 'flexible' | 'completed' }
  | { kind: 'list'; id: string };

const OPEN_STATUSES = new Set(['todo', 'doing']);

function isOpenTask(task: TaskDto): boolean {
  return OPEN_STATUSES.has(task.status);
}

/** The default (Inbox) list's id, or null if no list is marked default. */
function defaultListId(lists: ListDto[]): string | null {
  return lists.find((l) => l.is_default)?.id ?? null;
}

/** True when `id` matches a list actually present in `lists`. */
function isKnownListId(lists: ListDto[], id: string): boolean {
  return lists.some((l) => l.id === id);
}

/**
 * isDueTodayOrEarlier — mirrors the date-only vs. datetime split already
 * used by `isTaskOverdue` (calendar/transform.ts), but with an inclusive
 * (`<=`) bound: "today or earlier", not "strictly before now".
 */
function isDueTodayOrEarlier(due: string, now: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return due <= now.substring(0, 10);
  }
  const dueMs = new Date(due).getTime();
  const nowMs = new Date(now).getTime();
  if (isNaN(dueMs) || isNaN(nowMs)) return false;
  return dueMs <= nowMs;
}

/**
 * applyScope — narrow `tasks` down to the given scope. Pure; does not
 * mutate `tasks`. Soft-deleted tasks (`deleted_at != null`) are excluded
 * regardless of scope, mirroring `filterTasksList`'s own guard.
 *
 * `lists` is required to resolve the default list id and the known-id set
 * for the `'inbox'` smart view; it is unused by `'today'` / `'upcoming'` /
 * `'completed'` and by `{kind:'list'}` (which matches `task.list` against
 * `scope.id` directly — id-based, same contract as `filterTasksList`).
 */
export function applyScope(tasks: TaskDto[], scope: TaskScope, lists: ListDto[]): TaskDto[] {
  const active = tasks.filter((t) => t.deleted_at == null);

  if (scope.kind === 'list') {
    return active.filter((t) => t.list === scope.id);
  }

  const now = new Date().toISOString();

  switch (scope.id) {
    case 'inbox': {
      const defId = defaultListId(lists);
      return active.filter(
        (t) => isOpenTask(t) && (t.list === defId || !isKnownListId(lists, t.list)),
      );
    }
    case 'today':
      return active.filter(
        (t) => isOpenTask(t) && t.due != null && isDueTodayOrEarlier(t.due, now),
      );
    case 'upcoming':
      return active.filter(
        (t) => isOpenTask(t) && t.due != null && !isDueTodayOrEarlier(t.due, now),
      );
    case 'flexible':
      return active.filter(
        (t) => isOpenTask(t) && t.agenda_bucket === 'flexible',
      );
    case 'completed':
      return active.filter((t) => t.status === 'done' || t.status === 'cancelled');
    default:
      return [];
  }
}

export interface FlexibleTaskGroup {
  list: ListDto;
  tasks: TaskDto[];
}

/** Flexible collection order follows the existing list order and each list's manual ranks. */
export function groupFlexibleTasks(tasks: TaskDto[], lists: ListDto[]): FlexibleTaskGroup[] {
  const byList = new Map<string, TaskDto[]>();
  for (const task of applyScope(tasks, { kind: 'smart', id: 'flexible' }, lists)) {
    const bucket = byList.get(task.list) ?? [];
    bucket.push(task);
    byList.set(task.list, bucket);
  }
  const knownGroups = [...lists]
    .sort((a, b) => a.position.localeCompare(b.position))
    .flatMap((list) => {
      const grouped = byList.get(list.id);
      if (!grouped?.length) return [];
      return [{
        list,
        tasks: [...grouped].sort((a, b) => (a.position ?? '').localeCompare(b.position ?? '')),
      }];
    });
  const knownIds = new Set(lists.map(list => list.id));
  const unlisted = [...byList.entries()]
    .filter(([listId]) => !knownIds.has(listId))
    .flatMap(([, grouped]) => grouped)
    .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''));
  if (unlisted.length === 0) return knownGroups;
  return [...knownGroups, {
    list: {
      id: '__unavailable__',
      name: 'Other lists',
      color: 'secondary',
      icon: 'list',
      position: 'zzzz',
      parent_id: null,
      view: 'list',
      sort_mode: 'manual',
      is_default: false,
      task_count: unlisted.length,
      sections: [],
    },
    tasks: unlisted,
  }];
}
