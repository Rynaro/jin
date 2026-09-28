/**
 * S2 — operation_state reducer tests (AC-S2-18).
 *
 * The reducer must be pure and must reject illegal transitions rather than
 * silently absorbing them.
 */

import { describe, expect, it } from 'vitest';
import {
  INITIAL_OPERATION_STATE,
  canTransition,
  isBusy,
  isSettled,
  legalActions,
  needsAttention,
  reduceOperationState,
  runOperationSequence,
  type EventOperationState,
} from '../lib/events/operation_state';

describe('operation_state transitions', () => {
  it('starts as a pristine draft', () => {
    expect(INITIAL_OPERATION_STATE).toBe('draft');
  });

  it('walks the happy path from edit to a confirmed local save', () => {
    const result = runOperationSequence('draft', [
      { type: 'edit' },
      { type: 'validate' },
      { type: 'validation_passed' },
      { type: 'persist_confirmed' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.state).toBe('confirmed');
    expect(isSettled(result.state)).toBe(true);
  });

  it('distinguishes a queued provider write from a confirmed one', () => {
    const queued = runOperationSequence('draft', [
      { type: 'edit' },
      { type: 'validate' },
      { type: 'validation_passed' },
      { type: 'persist_queued' },
    ]);
    expect(queued.state).toBe('sync_pending');
    expect(isSettled(queued.state)).toBe(false);

    const confirmed = reduceOperationState(queued.state, { type: 'sync_confirmed' });
    expect(confirmed.state).toBe('confirmed');
    expect(isSettled(confirmed.state)).toBe(true);
  });

  it('routes a failed validation back to an editable draft', () => {
    const result = runOperationSequence('dirty', [
      { type: 'validate' },
      { type: 'validation_failed' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.state).toBe('dirty');
  });

  it('routes a stale token to conflict', () => {
    const result = runOperationSequence('dirty', [
      { type: 'validate' },
      { type: 'validation_passed' },
      { type: 'persist_conflict' },
    ]);
    expect(result.state).toBe('conflict');
    expect(needsAttention(result.state)).toBe(true);
  });

  it('can still conflict after the local write, from sync_pending', () => {
    const result = reduceOperationState('sync_pending', { type: 'persist_conflict' });
    expect(result.ok).toBe(true);
    expect(result.state).toBe('conflict');
  });

  it('resolves a conflict either way', () => {
    const useLatest = reduceOperationState('conflict', {
      type: 'resolve_conflict',
      resolution: 'use_latest',
    });
    expect(useLatest.state).toBe('draft');

    const keepDraft = reduceOperationState('conflict', {
      type: 'resolve_conflict',
      resolution: 'keep_draft',
    });
    expect(keepDraft.state).toBe('dirty');
  });

  it('sends a failed persist to needs_review and allows a retry', () => {
    const failed = reduceOperationState('persisting', { type: 'persist_failed' });
    expect(failed.state).toBe('needs_review');
    expect(needsAttention(failed.state)).toBe(true);

    const retried = reduceOperationState(failed.state, { type: 'persist' });
    expect(retried.ok).toBe(true);
    expect(retried.state).toBe('persisting');
  });

  it('sends a failed sync to needs_review', () => {
    const result = reduceOperationState('sync_pending', { type: 'sync_failed' });
    expect(result.state).toBe('needs_review');
  });

  it('allows editing again after a confirmed save', () => {
    const result = reduceOperationState('confirmed', { type: 'edit' });
    expect(result.state).toBe('dirty');
  });

  it('accepts edits made while validation is in flight', () => {
    const result = reduceOperationState('validating', { type: 'edit' });
    expect(result.ok).toBe(true);
    expect(result.state).toBe('dirty');
  });
});

describe('operation_state rejects invalid transitions', () => {
  it('refuses to confirm a save that was never started', () => {
    const result = reduceOperationState('draft', { type: 'persist_confirmed' });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('draft');
    expect(result.reason).toContain('persist_confirmed');
    expect(result.reason).toContain('draft');
  });

  it('refuses to validate while already persisting', () => {
    const result = reduceOperationState('persisting', { type: 'validate' });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('persisting');
  });

  it('refuses to resolve a conflict that does not exist', () => {
    const result = reduceOperationState('dirty', {
      type: 'resolve_conflict',
      resolution: 'use_latest',
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('dirty');
  });

  it('refuses a sync confirmation that was never queued', () => {
    expect(canTransition('confirmed', { type: 'sync_confirmed' })).toBe(false);
    expect(canTransition('draft', { type: 'sync_confirmed' })).toBe(false);
  });

  it('stops a sequence at the first illegal action and reports it', () => {
    const result = runOperationSequence('draft', [
      { type: 'edit' },
      { type: 'persist_confirmed' },
      { type: 'edit' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.state).toBe('dirty');
    expect(result.reason).toContain('persist_confirmed');
  });
});

describe('operation_state derived helpers', () => {
  it('reports busy only while a save is in flight', () => {
    expect(isBusy('validating')).toBe(true);
    expect(isBusy('persisting')).toBe(true);
    expect(isBusy('dirty')).toBe(false);
    expect(isBusy('sync_pending')).toBe(false);
  });

  it('lists only legal actions for a state', () => {
    expect(legalActions('draft').sort()).toEqual(['edit', 'validate']);
    expect(legalActions('conflict')).toContain('resolve_conflict');
    for (const action of legalActions('needs_review')) {
      expect(canTransition('needs_review', { type: action } as never)).toBe(true);
    }
  });

  it('is pure: reducing never mutates its inputs', () => {
    const state: EventOperationState = 'dirty';
    const action = { type: 'validate' } as const;
    const frozenAction = Object.freeze({ ...action });
    const first = reduceOperationState(state, frozenAction);
    const second = reduceOperationState(state, frozenAction);
    expect(first).toEqual(second);
    expect(state).toBe('dirty');
  });
});
