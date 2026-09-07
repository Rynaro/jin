/**
 * lists/transform.ts — pure list transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * ListsController is the thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/lists_controller.test.ts
 */

import type { ListDto } from '../../types/dto';
import { JIN_PALETTE, isJinPaletteColor } from '../ui/color_picker';

export { JIN_PALETTE } from '../ui/color_picker';

// ── Palette ───────────────────────────────────────────────────────────────────

/**
 * JIN_PALETTE — canonical list of accent color tokens.
 * Mirrors JIN_PALETTE in jin-core/src/ops/lists.rs (and tags.rs).
 * Order is meaningful: it is used for default color assignment and for the
 * recolor picker in the UI.
 */
export type PaletteColor = (typeof JIN_PALETTE)[number];

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * sortLists — default list first (inbox), then by fractional position key.
 * Returns a new array; does NOT mutate the input.
 */
export function sortLists(lists: ListDto[]): ListDto[] {
  return [...lists].sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    return a.position.localeCompare(b.position);
  });
}

// ── Label helpers ─────────────────────────────────────────────────────────────

/**
 * listLabel — human-readable label for a list (used in sidebar rows and selects).
 * Format: "<name> (<task_count>)" — count helps users see which list has work.
 */
export function listLabel(list: ListDto): string {
  return `${list.name} (${list.task_count})`;
}

/**
 * listSelectOptions — map a sorted list array to select <option> data objects.
 * Callers pass these to populateListFilter() in render.ts.
 */
export function listSelectOptions(
  lists: ListDto[]
): Array<{ value: string; label: string; color: string }> {
  return sortLists(lists).map((l) => ({
    value: l.id,
    label: listLabel(l),
    color: l.color,
  }));
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/**
 * isPaletteColor — type guard: returns true if the given string is a JIN_PALETTE token.
 */
export function isPaletteColor(color: string): color is PaletteColor {
  return isJinPaletteColor(color);
}

// ── Id/name resolver (S6 canonicalization) ────────────────────────────────────

/**
 * listNameById — resolve a list id to its display name.
 *
 * Pure function: no DOM access, no side effects.
 * Returns the list's `name` when found; falls back to the raw `id` string when
 * the list is not in the provided array (e.g. stale on-disk data, RISK-2).
 *
 * Used by render.ts to display the human-readable name instead of the raw id.
 * The filter (transform.ts:filterTasksList) uses the id directly and is NEVER
 * modified — this helper is display-only.
 */
export function listNameById(lists: Array<{ id: string; name: string }>, id: string): string {
  return lists.find((l) => l.id === id)?.name ?? id;
}
