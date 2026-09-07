/**
 * actions/transform.ts — pure validation + payload-builder logic for
 * promote / attach / link actions (GUI-S4).
 *
 * All functions are pure: no DOM, no side effects, no invoke calls.
 * ActionsController is the thin Stimulus adapter.
 *
 * Tested by: src/__tests__/actions_controller.test.ts
 */

import type { ValidationResult } from '../capture/transform';
export type { ValidationResult };

// ── Edge-type vocabulary ──────────────────────────────────────────────────────

/**
 * EDGE_TYPES — the three allowed edge types (vocabulary-validated by core).
 * The GUI surfaces these choices and passes core's rejection as an inline error
 * (never bypasses validation).
 *
 * Spec §4.2: link(source_id, target_id, edge_type: EdgeKind) — vocabulary-validated;
 * rejects edges outside the three allowed signatures (core enforces; GUI surfaces).
 */
export const EDGE_TYPES = ['derived-from', 'prep-for', 'references'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** isValidEdgeType — type-guard for the three-value vocabulary. */
export function isValidEdgeType(edge: string): edge is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(edge);
}

// ── Promote form ──────────────────────────────────────────────────────────────

export interface PromoteFormState {
  /** ISO datetime string, e.g. "2026-07-01T10:00" */
  when: string;
  /** IANA tz name, e.g. "America/New_York" or empty for floating */
  tzid: string;
}

/**
 * validatePromoteForm — required-field validation for the promote dialog.
 * Only `when` is required; `tzid` is optional (empty = floating event).
 */
export function validatePromoteForm(state: PromoteFormState): ValidationResult {
  if (!state.when.trim()) {
    return { valid: false, errors: { when: 'Date/time is required.' } };
  }
  return { valid: true, errors: {} };
}

/**
 * buildPromotePayload — construct the exact args for invoke('promote_task', ...).
 * Mirrors promoteTask(taskId, slot) in invoke.ts.
 *
 * Spec §4.2: promote_task(task_id, when: TemporalSlot) → EventDto
 */
export function buildPromotePayload(
  taskId: string,
  state: PromoteFormState
): { task_id: string; slot: { when: string; tzid?: string } } {
  return {
    task_id: taskId,
    slot: {
      when: state.when.trim(),
      tzid: state.tzid.trim() || undefined,
    },
  };
}

// ── Attach form ───────────────────────────────────────────────────────────────

export interface AttachFormState {
  noteId: string;
  targetId: string;
  /**
   * EdgeType or empty string.
   * Empty string = use core default: prep-for when target is an Event.
   */
  kind: string;
}

/**
 * validateAttachForm — required-field validation for the attach dialog.
 * Both noteId and targetId are required; kind is optional.
 */
export function validateAttachForm(state: AttachFormState): ValidationResult {
  const errors: Partial<Record<string, string>> = {};
  if (!state.noteId.trim()) errors['noteId'] = 'Note ID is required.';
  if (!state.targetId.trim()) errors['targetId'] = 'Target ID is required.';
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, errors: {} };
}

/**
 * buildAttachPayload — construct the exact args for invoke('attach_note', ...).
 * Mirrors attachNote(noteId, targetId, kind?) in invoke.ts.
 *
 * Spec §4.2: attach_note(note_id, target_id, kind?: EdgeKind)
 * Default kind: prep-for for Event, references for Task/Note (core decides).
 */
export function buildAttachPayload(state: AttachFormState): {
  note_id: string;
  target_id: string;
  kind?: string;
} {
  return {
    note_id: state.noteId.trim(),
    target_id: state.targetId.trim(),
    kind: state.kind.trim() || undefined,
  };
}

// ── Link form ─────────────────────────────────────────────────────────────────

export interface LinkFormState {
  sourceId: string;
  targetId: string;
  edgeType: string;
}

/**
 * validateLinkForm — required-field + vocabulary validation for the link dialog.
 * All three fields are required; edgeType must be in EDGE_TYPES vocabulary.
 *
 * Spec GUI-S6 AC: "GIVEN a Link request with an edge outside the vocabulary,
 * THEN the core rejection is surfaced as a clear error (the GUI does not invent
 * or bypass validation)."
 *
 * NOTE: we surface the vocabulary constraint in the UI (pre-check) AND rely on
 * the core to enforce it definitively. Any edge outside EDGE_TYPES is rejected
 * here with a clear message so the user sees it immediately.
 */
export function validateLinkForm(state: LinkFormState): ValidationResult {
  const errors: Partial<Record<string, string>> = {};
  if (!state.sourceId.trim()) errors['sourceId'] = 'Source ID is required.';
  if (!state.targetId.trim()) errors['targetId'] = 'Target ID is required.';
  if (!state.edgeType.trim()) {
    errors['edgeType'] = 'Edge type is required.';
  } else if (!isValidEdgeType(state.edgeType)) {
    errors['edgeType'] =
      `Invalid edge type "${state.edgeType}". ` +
      `Must be one of: ${EDGE_TYPES.join(', ')}.`;
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, errors: {} };
}

/**
 * buildLinkPayload — construct the exact args for invoke('link', ...).
 * Mirrors linkObjects(sourceId, targetId, edgeType) in invoke.ts.
 */
export function buildLinkPayload(state: LinkFormState): {
  source_id: string;
  target_id: string;
  edge_type: string;
} {
  return {
    source_id: state.sourceId.trim(),
    target_id: state.targetId.trim(),
    edge_type: state.edgeType.trim(),
  };
}
