/**
 * lib/notes/focusMode.ts — CM6 focus-mode decoration layer.
 *
 * Focus mode: every line the caret/selection does NOT touch gets a
 * Decoration.line({class:'cm-dim'}) so it visually recedes; the active
 * line(s) stay full opacity.
 *
 * Imports: ONLY @codemirror/* — G-CHOKEPOINT-COZY enforced.
 * No markdown-it, no dompurify, no innerHTML.
 */

import { type EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * buildFocusDecorations — pure, state-testable decoration builder.
 *
 * @param state   - Current EditorState (provides doc + selection).
 * @param ranges  - Optional viewport ranges to iterate (default: full doc).
 * @returns       A DecorationSet of Decoration.line({class:'cm-dim'}) at each
 *                non-active line's line.from. Active lines are absent from the set.
 *
 * Single-line doc with caret → returns empty set (the only line is active → nothing to dim).
 * Lines are emitted in ascending order → RangeSetBuilder-safe.
 *
 * The active-line computation is duplicated from livePreview.ts:124-132 — NOT imported
 * so that this module stays chokepoint-clean (mirrors the SAFE_LINK_SCHEME duplication).
 */
export function buildFocusDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  // Build the active-line set: union over ALL selection ranges.
  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const fromLine = state.doc.lineAt(r.from).number;
    const toLine   = state.doc.lineAt(r.to).number;
    for (let ln = fromLine; ln <= toLine; ln++) {
      activeLines.add(ln);
    }
  }

  const builder = new RangeSetBuilder<Decoration>();
  const dimDecoration = Decoration.line({ class: 'cm-dim' });

  for (const range of ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine   = state.doc.lineAt(range.to).number;
    // Iterate in ascending line number order (RangeSetBuilder requires non-decreasing from).
    for (let ln = fromLine; ln <= toLine; ln++) {
      if (!activeLines.has(ln)) {
        const line = state.doc.line(ln);
        builder.add(line.from, line.from, dimDecoration);
      }
    }
  }

  return builder.finish();
}

/**
 * jinFocusMode() — returns the CM6 Extension for the focus-mode dim layer.
 *
 * Decorations are rebuilt on docChanged | viewportChanged | selectionSet.
 * Only view.visibleRanges are iterated (perf), mirroring jinLivePreview().
 * No atomicRanges provide — line decorations are never atomic (D-FOCUS-BUILDER).
 */
export function jinFocusMode() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildFocusDecorations(view.state, view.visibleRanges);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildFocusDecorations(
            update.view.state,
            update.view.visibleRanges,
          );
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
