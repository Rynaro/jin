import { describe, expect, it } from 'vitest';
import { monthChipCapacity } from '../lib/calendar/month_capacity';

describe('Month row chip capacity', () => {
  it('reserves a named overflow control within the same row height', () => {
    expect(monthChipCapacity({ row: 112, date: 27, chip: 20, more: 28, gap: 2, padding: 8, maxEvents: 10 })).toBe(2);
    expect(monthChipCapacity({ row: 160, date: 27, chip: 20, more: 28, gap: 2, padding: 8, maxEvents: 10 })).toBe(4);
    expect(monthChipCapacity({ row: 100, date: 26, chip: 18, more: 24, gap: 1, padding: 8, maxEvents: 10 })).toBe(2);
  });

  it('uses all available slots when no date needs overflow and falls back before layout', () => {
    expect(monthChipCapacity({ row: 112, date: 27, chip: 20, more: 28, gap: 2, padding: 8, maxEvents: 3 })).toBe(3);
    expect(monthChipCapacity({ row: 0, date: 0, chip: 0, more: 0, gap: 0, padding: 0, maxEvents: 10 })).toBe(3);
  });

  it('fits mixed single-line and two-line chips in their visual order across resizes', () => {
    const geometry = { row: 122, date: 26, chip: [22, 22, 22, 36, 36], more: 24, gap: 3, padding: 16, maxEvents: 5 };
    expect(monthChipCapacity(geometry)).toBe(2);
    expect(monthChipCapacity({ ...geometry, row: 147 })).toBe(3);
    expect(monthChipCapacity({ ...geometry, row: 185 })).toBe(4);
    expect(monthChipCapacity({ ...geometry, row: 110 })).toBe(1);
    expect(monthChipCapacity({ ...geometry, row: 147 })).toBe(3);
  });

  it('shows the final chip when it fits in the space otherwise reserved for overflow', () => {
    expect(monthChipCapacity({ row: 88, date: 26, chip: [22, 22], more: 28, gap: 2, padding: 16, maxEvents: 2 })).toBe(2);
  });

});
