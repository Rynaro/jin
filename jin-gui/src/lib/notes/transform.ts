/**
 * notes/transform.ts — pure notes transformation logic (headless-unit-testable).
 *
 * All functions are pure: no DOM access, no side effects, no invoke calls.
 * NotesController is the thin Stimulus adapter that calls these functions.
 *
 * Tested by: src/__tests__/notes_controller.test.ts
 */

import type { NoteDto } from '../../types/dto';

// ── Filter ────────────────────────────────────────────────────────────────────

export interface NotesFilter {
  /** Optional tag to include (exact match). Empty string = no filter. */
  tag?: string;
  /**
   * Wave 2A: optional folder path to include (exact match).
   * `""` = Notes root. `undefined` = all folders (no filter).
   */
  folder?: string;
}

/**
 * filterNotesList — exclude soft-deleted notes; optionally filter by tag and folder.
 * Returns a new array; does NOT mutate the input.
 *
 * Note: `folder` filtering is advisory on the frontend (the backend already filters
 * by folder in list_notes). This ensures the local in-memory filter stays consistent.
 */
export function filterNotesList(notes: NoteDto[], filter: NotesFilter): NoteDto[] {
  return notes.filter((note) => {
    if (note.deleted_at != null) return false;
    if (filter.tag != null && filter.tag !== '' && !note.tags.includes(filter.tag)) return false;
    if (filter.folder != null) {
      // folder_path may be undefined on legacy DTOs; treat as "" (root)
      const noteFolderPath = note.folder_path ?? '';
      if (noteFolderPath !== filter.folder) return false;
    }
    return true;
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * sortNotesList — deterministic sort: most-recently-updated first.
 * Returns a new array; does NOT mutate the input.
 */
export function sortNotesList(notes: NoteDto[]): NoteDto[] {
  return [...notes].sort((a, b) => b.updated.localeCompare(a.updated));
}

// ── Status label / glyph ─────────────────────────────────────────────────────

/**
 * noteStatusLabel — human-readable status label.
 * Always returns a non-empty string (WCAG 1.4.1 — color-independence: text label required).
 */
export function noteStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
      return 'Active';
    case 'archived':
      return 'Archived';
    default:
      return status.length > 0 ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  }
}

/**
 * noteStatusGlyph — Lucide icon name for the status badge.
 * Supplementary to the text label; never the sole visual identifier.
 */
export function noteStatusGlyph(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
      return 'file-text';
    case 'archived':
      return 'archive';
    default:
      return 'file';
  }
}

/**
 * noteStatusTooltip — helper tooltip text for the status badge (item 4).
 * Provides additional context on hover/focus; purely supplementary to the badge label.
 */
export function noteStatusTooltip(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
      return "Active — this note isn’t archived";
    case 'archived':
      return 'Archived — this note is in the archive';
    default:
      return `Status: ${noteStatusLabel(status)}`;
  }
}

// ── Display title ─────────────────────────────────────────────────────────────

/**
 * noteDisplayTitle — fallback display label when a note's title is empty.
 *
 * Returns "Untitled" when the title is blank (empty or whitespace-only);
 * otherwise returns the title as-is. Used for list rows and aria-labels.
 * The detail input always shows the RAW value (with placeholder="Untitled").
 */
export function noteDisplayTitle(title: string): string {
  return title.trim() === '' ? 'Untitled' : title;
}

// ── Date formatting ───────────────────────────────────────────────────────────

/** Month abbreviations (Jan-indexed). */
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * formatNoteDate — Apple-Notes-style date label for the note list (D4).
 *
 * Rules (local timezone):
 *   - Same calendar day as `now`  → "Today"
 *   - Previous calendar day       → "Yesterday"
 *   - Same calendar year          → "MMM D"  (e.g. "Jun 12")
 *   - Different year              → "MMM D, YYYY" (e.g. "Dec 3, 2025")
 *
 * @param iso  ISO 8601 date-time string (e.g. "2026-06-27T12:00:00Z")
 * @param now  Optional reference timestamp in ms (default: Date.now()).
 *             Inject for deterministic tests.
 */
export function formatNoteDate(iso: string, now: number = Date.now()): string {
  const noteDate = new Date(iso);
  const refDate = new Date(now);

  // Work in local calendar dates (year/month/day).
  const noteYear = noteDate.getFullYear();
  const noteMonth = noteDate.getMonth();
  const noteDay = noteDate.getDate();

  const refYear = refDate.getFullYear();
  const refMonth = refDate.getMonth();
  const refDay = refDate.getDate();

  if (noteYear === refYear && noteMonth === refMonth && noteDay === refDay) {
    return 'Today';
  }

  // Build yesterday's local date.
  const yesterday = new Date(refDate);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    noteYear === yesterday.getFullYear() &&
    noteMonth === yesterday.getMonth() &&
    noteDay === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  const monthAbbr = MONTH_ABBR[noteMonth];
  if (noteYear === refYear) {
    return `${monthAbbr} ${noteDay}`;
  }

  return `${monthAbbr} ${noteDay}, ${noteYear}`;
}
