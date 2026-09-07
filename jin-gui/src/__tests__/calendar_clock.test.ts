import { describe, expect, it } from 'vitest';
import { normalizeClockInput } from '../lib/calendar/clock';

describe('normalizeClockInput', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['9', '09:00'],
    ['16', '16:00'],
    ['930', '09:30'],
    ['1600', '16:00'],
    ['9:30', '09:30'],
    ['16:20', '16:20'],
    [' 16:20 ', '16:20'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeClockInput(input)).toEqual({ ok: true, time: expected });
  });

  it.each(['24', '2360', '2400', '16:2', 'morning', '-9'])('rejects %j', input => {
    expect(normalizeClockInput(input)).toEqual({ ok: false });
  });
});
