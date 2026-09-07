/**
 * lib/notes/typewriter.ts — CM6 typewriter-scrolling extension.
 *
 * Typewriter scrolling: when ON, a transaction extender appends an
 * EditorView.scrollIntoView(head, {y:'center'}) effect to every transaction
 * that moves a COLLAPSED cursor (docChanged or explicit selection change).
 * A RANGE selection is NOT re-centered (iA-Writer jumpiness caveat).
 *
 * Mechanism: EditorState.transactionExtender (NOT an updateListener).
 * CM6 disallows dispatching a new transaction from inside an updateListener;
 * the transactionExtender appends the scroll effect to the SAME transaction
 * — no second dispatch, no flicker, caret-safe (D-TYPEWRITER-MECHANISM / R2).
 *
 * Imports: ONLY @codemirror/* — G-CHOKEPOINT-COZY enforced.
 * No markdown-it, no dompurify, no innerHTML.
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * typewriterTarget — PURE decision helper.
 *
 * Returns the head position to scroll to iff the selection is collapsed AND
 * changed (docChanged or explicit selection), else null.
 *
 * @param selectionChanged - true when tr.docChanged || tr.selection != null
 * @param collapsed        - true when tr.newSelection.main.empty
 * @param head             - tr.newSelection.main.head
 */
export function typewriterTarget({
  selectionChanged,
  collapsed,
  head,
}: {
  selectionChanged: boolean;
  collapsed: boolean;
  head: number;
}): number | null {
  return collapsed && selectionChanged ? head : null;
}

/**
 * typewriterExtender — returns a CM6 transactionExtender that appends a
 * scrollIntoView(head, {y:'center'}) effect to qualifying transactions.
 *
 * Guards:
 *  - collapsed check: skips range selections (iA-Writer caveat — R3)
 *  - selectionChanged check: skips no-op transactions (e.g. viewport redraws)
 *  - Reconfigure transactions: tr.docChanged=false && tr.selection=undefined
 *    → selectionChanged=false → returns null (no scroll on compartment toggle)
 */
export function typewriterExtender() {
  return EditorState.transactionExtender.of((tr) => {
    const pos = typewriterTarget({
      selectionChanged: tr.docChanged || tr.selection != null,
      collapsed: tr.newSelection.main.empty,
      head: tr.newSelection.main.head,
    });
    return pos == null ? null : { effects: EditorView.scrollIntoView(pos, { y: 'center' }) };
  });
}
