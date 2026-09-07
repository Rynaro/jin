export interface StaleNoteErrorDetails {
  type: 'stale_note';
  note_id: string;
  expected_revision: number;
  current_revision: number;
}

export interface ValidationErrorDetails {
  type: 'validation';
  field: string;
  reason: string;
}

export interface StaleEventErrorDetails {
  type: 'stale_event';
  event_id: string;
}

export interface OperationConflictErrorDetails {
  type: 'operation_conflict';
  operation_id: string;
  reason: string;
}

export interface OperationBlockedErrorDetails {
  type: 'operation_blocked';
  operation_id: string;
  reason: string;
}

export type JinErrorDetails =
  | StaleNoteErrorDetails
  | StaleEventErrorDetails
  | ValidationErrorDetails
  | OperationConflictErrorDetails
  | OperationBlockedErrorDetails;

/**
 * JinErrorDto — mirrors Rust `error::JinErrorDto` in jin-gui/src-tauri/src/error.rs.
 *
 * Exit-code taxonomy:
 *   1 = other
 *   2 = usage  (invalid args, edge type, state transition, timezone)
 *   3 = not_found
 *   4 = sync_conflict
 *   5 = auth   (re-authentication required)
 *   6 = offline (retriable — local writes succeed; sync queued)
 *   7 = integrity (index / not-initialized / dangling)
 */
export interface JinErrorDto {
  /** CLI exit-code equivalent: 1 | 2 | 3 | 4 | 5 | 6 | 7 */
  code: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Symbolic kind string */
  kind: 'not_found' | 'sync_conflict' | 'auth' | 'offline' | 'integrity' | 'usage' | 'other';
  /** Human-readable error message */
  message: string;
  /** true only for offline (code 6): local writes still work, retry sync later */
  retriable: boolean;
  /** Present for stale note writes; contains metadata only, never note content or paths. */
  details?: JinErrorDetails;
}

/** Type-guard: is this value a JinErrorDto? */
export function isJinErrorDto(v: unknown): v is JinErrorDto {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e['code'] === 'number' &&
    typeof e['kind'] === 'string' &&
    typeof e['message'] === 'string' &&
    typeof e['retriable'] === 'boolean'
  );
}

/**
 * Wrap a non-JinErrorDto rejection into a synthetic JinErrorDto so the toast
 * still fires with SOME message, instead of the caller having to guess.
 *
 * Tauri's `invoke()` rejects with the raw STRING the Rust side returned
 * (InvokeError serializes to a string, not an `Error` instance) whenever the
 * failure happens before the command body runs — e.g. argument
 * deserialization ("missing field `icon`"). `err instanceof Error` is false
 * for those, so a naive synthesizer discards the real cause and every
 * bridge-level failure in the app surfaces as an identical, useless
 * "<ctx> failed" toast. Preserve the string rejection's message first.
 */
export function toSyntheticErrorDto(err: unknown, ctx: string): JinErrorDto {
  return {
    code: 1,
    kind: 'other',
    message:
      typeof err === 'string' ? err : err instanceof Error ? err.message : `${ctx} failed`,
    retriable: false,
  };
}
