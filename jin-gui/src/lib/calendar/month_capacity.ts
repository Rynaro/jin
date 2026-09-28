/** Shared visible-chip count for every Month cell in one measured week track. */
export function monthChipCapacity(geometry: {
  row: number;
  date: number;
  chip: number;
  more: number;
  gap: number;
  padding: number;
  maxEvents: number;
}): number {
  const { row, date, chip, more, gap, padding, maxEvents } = geometry;
  if (row <= 0 || date <= 0 || chip <= 0 || more <= 0) return 3;
  const available = Math.max(0, row - date - padding);
  const slots = Math.max(0, Math.floor((available + gap) / (chip + gap)));
  if (maxEvents <= slots) return slots;
  return Math.max(0, Math.floor((available - more) / (chip + gap)));
}
