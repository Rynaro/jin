/**
 * error_dto.test.ts — Bug A2 (VIGIL): `toSyntheticErrorDto` must not discard a
 * STRING rejection's real message.
 *
 * Tauri's `invoke()` rejects with the raw STRING the Rust side returned
 * (InvokeError serializes to a string, not an `Error` instance) whenever the
 * failure happens before a command body ever runs — e.g. argument
 * deserialization ("missing field `icon`", the exact Bug A failure mode).
 * The pre-fix synthesizer was:
 *
 *   err instanceof Error ? err.message : `${ctx} failed`
 *
 * `typeof 'missing field icon' === 'string'` but `'missing field icon'
 * instanceof Error` is `false` — so the real cause was discarded and every
 * bridge-level failure in the app surfaced as an identical, useless
 * "<ctx> failed" toast. That is why Bug A presented as "nothing happens"
 * instead of a message naming the actual problem.
 *
 * `toSyntheticErrorDto` used to be duplicated (byte-for-byte) in
 * lists_controller.ts and tasks_controller.ts; it now lives once in
 * types/error.ts and both controllers import it.
 */
import { describe, it, expect } from 'vitest';
import { toSyntheticErrorDto } from '../types/error';

describe('toSyntheticErrorDto — Bug A2 (VIGIL)', () => {
  it('preserves a STRING rejection verbatim (the real Tauri InvokeError shape)', () => {
    const dto = toSyntheticErrorDto('missing field `icon`', 'saveCreate');
    expect(dto.message).toBe('missing field `icon`');
    expect(dto.code).toBe(1);
    expect(dto.kind).toBe('other');
    expect(dto.retriable).toBe(false);
  });

  it('still preserves an Error instance message (pre-existing, unregressed behavior)', () => {
    const dto = toSyntheticErrorDto(new Error('boom'), 'saveCreate');
    expect(dto.message).toBe('boom');
  });

  it('falls back to "<ctx> failed" only for a genuinely unrecognized rejection shape', () => {
    const dto = toSyntheticErrorDto({ some: 'object' }, 'saveCreate');
    expect(dto.message).toBe('saveCreate failed');
  });
});
