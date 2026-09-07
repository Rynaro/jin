/**
 * tasks/bulk.ts — pure helpers for S7 (bulk multi-select + keyboard flow).
 *
 * Everything here is pure (no DOM, no bridge/invoke calls, no Stimulus) so it
 * is headless-unit-testable in isolation. `TasksController` is the thin
 * adapter that wires these into `guarded()`-wrapped bridge calls and the ONE
 * deliberate `jin:tasks-changed` batch dispatch (Approach §8 / AC-S7-08).
 */

import type { TaskDto } from '../../types/dto';
import { legalNextStatuses } from './transform';

// ── AC-S7-02: the INTERSECTION of legal transitions, never the union ────────

/**
 * intersectLegalNextStatuses — the set of statuses that are a legal next
 * status for EVERY task in `tasks` (AC-S7-01's CONSTRAINT). A bulk status
 * control that offered a transition legal for only SOME of the selection
 * would half-succeed a bulk op the user never asked for — this is the pure
 * function that keeps that impossible.
 *
 * Built from S1's `legalNextStatuses` (never a second, hand-rolled FSM table
 * — that table is parity-tested against the Rust source; a duplicate here
 * would drift and nothing would catch it).
 *
 * Empty selection -> []. A single-task selection reduces to that task's own
 * `legalNextStatuses` (the intersection of one set is itself).
 */
export function intersectLegalNextStatuses(tasks: TaskDto[]): string[] {
  if (tasks.length === 0) return [];
  const sets = tasks.map((t) => new Set(legalNextStatuses(t.status)));
  const [first, ...rest] = sets;
  const result: string[] = [];
  for (const status of first) {
    if (rest.every((s) => s.has(status))) result.push(status);
  }
  return result;
}

// ── S6 interaction: bulk-selecting a parent AND its child ────────────────────

/**
 * partitionCascadingChildren — split `ids` into `{ toApply, cascaded }`.
 *
 * A task is "cascaded" when its `parent` is ALSO present in `ids` — i.e. the
 * selection contains both a parent and (at least) one of its direct
 * children. Core already propagates a parent-level done/cancelled status
 * change, a list/section move, and a soft-delete down to every child
 * (Approach §6 rollup table in the spec). Re-issuing the SAME mutation
 * against the child directly on top of that would either:
 *
 *   - double-apply a side effect that already happened, or
 *   - outright FAIL for a status change (`done -> done` is not a legal
 *     self-transition per `TaskStatus::can_transition_to`), which would
 *     surface the cascaded child as a false "failure" and corrupt the
 *     honest "N of M" partial-failure report the user is relying on
 *     (AC-S7-03/06).
 *
 * `cascaded` ids are therefore never given their own bridge call — the
 * parent's call already covers them — but they ARE counted as succeeded by
 * the caller (the cascade did apply correctly), never silently dropped from
 * the count and never re-applied. See the S7 report for the explicit
 * judgement call this encodes.
 */
export function partitionCascadingChildren(
  ids: string[],
  tasksById: Map<string, TaskDto>,
): { toApply: string[]; cascaded: string[] } {
  const idSet = new Set(ids);
  const toApply: string[] = [];
  const cascaded: string[] = [];
  for (const id of ids) {
    const parentId = tasksById.get(id)?.parent ?? null;
    if (parentId && idSet.has(parentId)) {
      cascaded.push(id);
    } else {
      toApply.push(id);
    }
  }
  return { toApply, cascaded };
}

// ── Shift-click range select ─────────────────────────────────────────────────

/**
 * computeSelectionRange — the contiguous run of ids between `fromId`
 * (the shift-click anchor) and `toId` (the just-clicked item), inclusive,
 * in `order`'s (the currently rendered, flat) order. Direction-agnostic —
 * shift-clicking upward or downward from the anchor both work.
 *
 * Falls back to `[toId]` alone when either endpoint is not present in
 * `order` (e.g. the anchor scrolled out of the currently loaded/filtered
 * set) — a single-item selection is the safe, honest fallback rather than
 * guessing a range across data that isn't there.
 */
export function computeSelectionRange(order: string[], fromId: string, toId: string): string[] {
  const start = order.indexOf(fromId);
  const end = order.indexOf(toId);
  if (start === -1 || end === -1) return [toId];
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return order.slice(lo, hi + 1);
}

// ── Sequential bulk execution — honest partial failure (AC-S7-03/05/06) ─────

export interface BulkOpResult {
  /** ids the operation was attempted+succeeded for. */
  succeeded: string[];
  /** ids the operation was attempted for but rejected. */
  failed: string[];
}

/**
 * runBulkOperation — sequentially attempt `op(id)` for every id in `ids`,
 * in order, continuing PAST a rejection rather than aborting the batch
 * (AC-S7-03/05/06: item 3 of 5 failing must not stop items 4 and 5 from
 * being attempted). `op` is expected to be the controller's `guarded()`-
 * wrapped bridge call, so an individual rejection is already caught and
 * surfaced via `app:error` there and resolves to `undefined` rather than
 * throwing — this helper treats a resolved `undefined` as "this item
 * failed" and keeps going; the `catch` below is defense in depth for a
 * caller that passes a raw (non-guarded) op.
 */
export async function runBulkOperation(
  ids: string[],
  op: (id: string) => Promise<unknown>,
): Promise<BulkOpResult> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const result = await op(id);
      if (result === undefined) {
        failed.push(id);
      } else {
        succeeded.push(id);
      }
    } catch {
      failed.push(id);
    }
  }
  return { succeeded, failed };
}
