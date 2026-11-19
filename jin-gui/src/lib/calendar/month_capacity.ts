/** Fit Month chips in visual order, reserving the overflow control when needed. */
export function monthChipCapacity(geometry: {
  row: number;
  date: number;
  chip: number | readonly number[];
  more: number;
  gap: number;
  padding: number;
  maxEvents: number;
}): number {
  const { row, date, chip, more, gap, padding, maxEvents } = geometry;
  const heights = typeof chip === 'number' ? Array<number>(maxEvents).fill(chip) : chip;
  if (row <= 0 || date <= 0 || more <= 0 || heights.some(height => height <= 0)) return 3;
  const available = Math.max(0, row - date - padding);
  const total = heights.reduce((sum, height) => sum + height, 0) + Math.max(0, heights.length - 1) * gap;
  if (total <= available) return heights.length;

  let used = 0;
  let visible = 0;
  for (const height of heights) {
    used += height + (visible > 0 ? gap : 0);
    if (used + gap + more > available) break;
    visible += 1;
  }
  return visible;
}
