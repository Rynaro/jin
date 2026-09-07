// @vitest-environment jsdom
/**
 * focusMode.test.ts — anti-shallow, mutation-testable gates for the CM6
 * focus-mode decoration layer (focusMode.ts).
 *
 * Gates covered:
 *   G-FOCUS-DIM       — buildFocusDecorations emits exact cm-dim line decos for
 *                        non-active lines; active lines absent; single-line → empty
 *   G-CHOKEPOINT-COZY — focusMode.ts imports only @codemirror/*; no innerHTML
 *
 * Doc layout used in G-FOCUS-DIM tests: 'line1\nline2\nline3' (length 17)
 *   line1: from=0, to=5  (text "line1"); '\n'@5
 *   line2: from=6, to=11 (text "line2"); '\n'@11
 *   line3: from=12, to=16 (text "line3")
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { type Decoration } from '@codemirror/view';
import { buildFocusDecorations } from '../lib/notes/focusMode';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Make a minimal EditorState with a cursor at cursorPos.
 * No markdown extension needed — buildFocusDecorations only uses
 * state.doc.lineAt / state.doc.line / state.selection.ranges.
 */
function makeState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
  });
}

/**
 * Make a state with a non-collapsed selection (anchor ≠ head).
 */
function makeStateWithSelection(doc: string, anchor: number, head: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
  });
}

/**
 * Collect all decoration from/to ranges from a DecorationSet.
 * Mirrors livePreview.test.ts collectRanges for assertion parity.
 */
function collectRanges(
  set: import('@codemirror/state').RangeSet<Decoration>,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    out.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return out;
}

// ── G-FOCUS-DIM ───────────────────────────────────────────────────────────────

describe('G-FOCUS-DIM — buildFocusDecorations pure builder', () => {
  it('AC-COZY1.1: cursor on line 2 (offset 8) → cm-dim EXACTLY at (0,0) and (12,12); NONE at from=6', () => {
    // Doc: 'line1\nline2\nline3'
    // cursor@8 is inside line2 → activeLines={2}
    // Expected: line1@(0,0) dimmed, line3@(12,12) dimmed; line2 (from=6) not dimmed
    const state = makeState('line1\nline2\nline3', 8);
    const decos = buildFocusDecorations(state);
    const ranges = collectRanges(decos);

    // Exactly 2 decorations
    expect(ranges).toHaveLength(2);
    // line1 dimmed at line.from=0 (Decoration.line → from===to===line.from)
    expect(ranges[0]).toEqual({ from: 0, to: 0 });
    // line3 dimmed at line.from=12
    expect(ranges[1]).toEqual({ from: 12, to: 12 });
    // Active line2 (from=6) must NOT appear in the set
    expect(ranges.some((r) => r.from === 6)).toBe(false);
  });

  it('AC-COZY1.2: selection spanning lines 1-2 (anchor=0, head=8) → EXACTLY one cm-dim at (12,12)', () => {
    // anchor=0 (line1), head=8 (line2) → activeLines={1,2}
    // Only line3 is non-active → one dim at (12,12)
    const state = makeStateWithSelection('line1\nline2\nline3', 0, 8);
    const decos = buildFocusDecorations(state);
    const ranges = collectRanges(decos);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ from: 12, to: 12 });
  });

  it('AC-COZY1.3: single-line doc "solo" cursor@0 → EMPTY set (only line is active)', () => {
    const state = makeState('solo', 0);
    const decos = buildFocusDecorations(state);
    const ranges = collectRanges(decos);

    expect(ranges).toHaveLength(0);
  });

  it('doc text is NOT mutated after buildFocusDecorations runs', () => {
    const doc = 'line1\nline2\nline3';
    const state = makeState(doc, 8);
    buildFocusDecorations(state);
    expect(state.doc.toString()).toBe(doc);
  });

  it('explicit ranges: range covering only lines 1-2 → only line1 dimmed (line2 active at cursor@8)', () => {
    // cursor at line2 (offset 8), explicit range [{from:0, to:11}] covers lines 1 and 2 only
    // activeLines = {2} so line1 dim, line2 skip; line3 not in range → not considered
    const state = makeState('line1\nline2\nline3', 8);
    const decos = buildFocusDecorations(state, [{ from: 0, to: 11 }]);
    const ranges = collectRanges(decos);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ from: 0, to: 0 });
  });

  it('empty doc ("") → EMPTY set (no lines to dim)', () => {
    const state = makeState('', 0);
    const decos = buildFocusDecorations(state);
    const ranges = collectRanges(decos);
    expect(ranges).toHaveLength(0);
  });

  it('cursor at end of doc → active line is last line → all other lines dimmed', () => {
    // 'line1\nline2\nline3', cursor at end (offset 17)
    // lineAt(17) = line3 → activeLines={3}
    // line1 and line2 dimmed
    const state = makeState('line1\nline2\nline3', 17);
    const decos = buildFocusDecorations(state);
    const ranges = collectRanges(decos);

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ from: 0, to: 0 }); // line1
    expect(ranges[1]).toEqual({ from: 6, to: 6 });  // line2
  });
});

// ── G-CHOKEPOINT-COZY ─────────────────────────────────────────────────────────

describe('G-CHOKEPOINT-COZY — focusMode.ts imports only @codemirror/*', () => {
  it('focusMode.ts has no innerHTML and no forbidden imports (markdown-it / dompurify)', () => {
    const src = readFileSync(
      resolve(__dirname, '../lib/notes/focusMode.ts'),
      'utf8',
    );

    // No .innerHTML assignment (same regex as G-LP-NO-INNERHTML in livePreview.test.ts)
    expect(/\.innerHTML\s*=/.test(src), 'focusMode.ts must not assign .innerHTML').toBe(false);

    // Every import statement must come from @codemirror/* (covers the markdown-it / dompurify check)
    const importedModules = [...src.matchAll(/^import .+ from ['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(importedModules.length, 'focusMode.ts must have at least one import').toBeGreaterThan(0);
    for (const mod of importedModules) {
      expect(mod, `unexpected import in focusMode.ts: "${mod}"`).toMatch(/^@codemirror\//);
    }
    // Belt-and-suspenders: no actual import() call for forbidden packages
    expect(/from ['"]markdown-it['"]/.test(src)).toBe(false);
    expect(/from ['"]dompurify['"]/.test(src)).toBe(false);
  });
});
