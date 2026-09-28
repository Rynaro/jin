/**
 * operation_state — a pure reducer for the lifecycle of one event save.
 *
 * Every event surface currently invents its own ad-hoc booleans (`pending`,
 * `saving`, a nullable `latest` that doubles as "there was a conflict"). Those
 * flags can contradict each other: a surface can be `pending` *and* showing a
 * conflict, or stop being `pending` while a provider write is still in flight.
 * This reducer replaces them with one explicit state machine.
 *
 * It is deliberately pure — no network, no DOM, no timers, no clock reads. It
 * maps `(state, action) -> state` and nothing else, so it is exhaustively
 * testable and can be driven identically from any surface.
 *
 * The distinction that matters most is **confirmed vs sync_pending**: a local
 * write that succeeded is not the same as a provider that accepted it. Collapsing
 * the two is what makes a UI claim an event is saved when it is still queued.
 */

export type EventOperationState =
  | 'draft'
  | 'dirty'
  | 'validating'
  | 'persisting'
  | 'sync_pending'
  | 'confirmed'
  | 'needs_review'
  | 'conflict';

export type EventOperationAction =
  /** The user changed a field. */
  | { type: 'edit' }
  /** Discard local changes and return to a pristine draft. */
  | { type: 'reset' }
  /** Save was requested; validation begins. */
  | { type: 'validate' }
  | { type: 'validation_passed' }
  | { type: 'validation_failed' }
  /** Retry a write from a reviewable failure without re-validating. */
  | { type: 'persist' }
  /** The local write landed but a provider write is still queued. */
  | { type: 'persist_queued' }
  /** The write is fully durable. */
  | { type: 'persist_confirmed' }
  /** The edit token was stale — the event moved underneath the draft. */
  | { type: 'persist_conflict' }
  | { type: 'persist_failed' }
  | { type: 'sync_confirmed' }
  | { type: 'sync_failed' }
  /** Return a reviewable failure to an editable draft. */
  | { type: 'review' }
  | { type: 'resolve_conflict'; resolution: 'use_latest' | 'keep_draft' };

export type EventOperationActionType = EventOperationAction['type'];

/**
 * The transition table. Anything not listed here is invalid *by construction*,
 * which is the point: an unlisted pair is rejected rather than silently ignored.
 */
const TRANSITIONS: Record<
  EventOperationState,
  Partial<Record<EventOperationActionType, EventOperationState>>
> = {
  draft: {
    edit: 'dirty',
    validate: 'validating',
  },
  dirty: {
    edit: 'dirty',
    reset: 'draft',
    validate: 'validating',
  },
  validating: {
    validation_passed: 'persisting',
    validation_failed: 'dirty',
    // The user can keep typing while validation is in flight.
    edit: 'dirty',
  },
  persisting: {
    persist_queued: 'sync_pending',
    persist_confirmed: 'confirmed',
    persist_conflict: 'conflict',
    persist_failed: 'needs_review',
  },
  sync_pending: {
    sync_confirmed: 'confirmed',
    sync_failed: 'needs_review',
    // A provider can still reject on a stale revision after the local write.
    persist_conflict: 'conflict',
  },
  confirmed: {
    edit: 'dirty',
    reset: 'draft',
  },
  needs_review: {
    edit: 'dirty',
    review: 'dirty',
    reset: 'draft',
    persist: 'persisting',
  },
  conflict: {
    reset: 'draft',
    // resolve_conflict is resolution-dependent; handled explicitly below.
  },
};

export interface EventOperationTransition {
  ok: boolean;
  state: EventOperationState;
  /** Present only when the transition was rejected. */
  reason?: string;
}

/** The state a fresh draft starts in. */
export const INITIAL_OPERATION_STATE: EventOperationState = 'draft';

/**
 * Apply `action` to `state`.
 *
 * On an illegal pair the current state is returned unchanged with `ok: false`
 * and a reason — the reducer never throws and never invents a state.
 */
export function reduceOperationState(
  state: EventOperationState,
  action: EventOperationAction,
): EventOperationTransition {
  if (state === 'conflict' && action.type === 'resolve_conflict') {
    // Taking the latest server truth discards the draft; keeping the draft
    // returns to an editable dirty state so the user can re-save deliberately.
    return {
      ok: true,
      state: action.resolution === 'use_latest' ? 'draft' : 'dirty',
    };
  }

  const next = TRANSITIONS[state][action.type];
  if (!next) {
    return {
      ok: false,
      state,
      reason: `'${action.type}' is not a legal action in '${state}'`,
    };
  }
  return { ok: true, state: next };
}

/** Whether `action` would be accepted in `state`, without applying it. */
export function canTransition(
  state: EventOperationState,
  action: EventOperationAction,
): boolean {
  return reduceOperationState(state, action).ok;
}

/** Every action legal in `state`, for driving disabled/enabled affordances. */
export function legalActions(state: EventOperationState): EventOperationActionType[] {
  const actions = Object.keys(TRANSITIONS[state]) as EventOperationActionType[];
  if (state === 'conflict') return [...actions, 'resolve_conflict'];
  return actions;
}

/** Whether a write is in flight, so a surface can disable Save. */
export function isBusy(state: EventOperationState): boolean {
  return state === 'validating' || state === 'persisting';
}

/**
 * Whether the event's changes are fully durable.
 *
 * `sync_pending` deliberately reports `false`: the local write landed, but the
 * provider has not confirmed it yet.
 */
export function isSettled(state: EventOperationState): boolean {
  return state === 'confirmed';
}

/** Whether the state needs the user to make a decision before progressing. */
export function needsAttention(state: EventOperationState): boolean {
  return state === 'needs_review' || state === 'conflict';
}

/**
 * Fold a sequence of actions, stopping at the first rejection.
 *
 * Useful for replaying a save attempt in a test or reproducing a sequence from
 * a log without hand-threading intermediate states.
 */
export function runOperationSequence(
  state: EventOperationState,
  actions: EventOperationAction[],
): EventOperationTransition {
  let current: EventOperationTransition = { ok: true, state };
  for (const action of actions) {
    current = reduceOperationState(current.state, action);
    if (!current.ok) return current;
  }
  return current;
}
