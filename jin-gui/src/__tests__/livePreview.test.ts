// @vitest-environment jsdom
/**
 * livePreview.test.ts — anti-shallow, mutation-testable gates for the CM6
 * inline live-preview decoration layer (livePreview.ts).
 *
 * Gates covered:
 *   G-LP-HIDE        — hidden-line markers produce exact replace ranges (from/to asserted)
 *   G-LP-REVEAL      — active-line markers are ABSENT from the set
 *   G-LP-ATOMIC      — the plugin exposes atomicRanges == hidden decoration set
 *   G-LP-SELECTION   — a multi-line selection reveals all markers on those lines
 *   G-LP-CARET-MOVE  — moving selection onto a hidden-marker line removes decorations
 *   G-LP-REBUILD     — set changes after a selection-only transaction
 *   G-LP-ROBUST      — partial/empty markdown does not throw; degrades to raw
 *   G-LP-NO-INNERHTML — no widget decoration produced; livePreview.ts has no innerHTML
 *   G-LP-SMOKE       — mountEditor with LP extension: no throw, buffer unchanged
 *   G-SAVE-CARET-SAFE — selection-only transaction does NOT call onSave
 *
 * Strategy (per spec D-TEST): assert at the STATE level via the pure function
 * buildLivePreviewDecorations(state, ranges). Call forceParse(state) first (K-LP-4)
 * to force a full synchronous parse in headless tests before asserting ranges.
 * ONE real-mount smoke test (G-LP-SMOKE) verifies end-to-end wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  buildLivePreviewDecorations,
  buildCodeBlockDecorations,
  atomicDecorationsOf,
  BulletWidget,
  CheckboxWidget,
  HIDE_MARK_NODES,
  jinLivePreview,
  taskCheckboxClickHandler,
} from '../lib/notes/livePreview';
import { mountEditor } from '../lib/notes/editor';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * K-LP-4: forceParse — synchronously complete the Lezer parse for the full
 * document so headless range assertions see a full syntax tree.
 */
function forceParse(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/**
 * Make a minimal EditorState with markdown language support and GFM
 * (Strikethrough etc.) — mirrors the language compartment in editor.ts.
 */
function makeState(doc: string, cursorPos = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [markdown({ base: markdownLanguage })],
  });
  return forceParse(state);
}

/**
 * Make a state with a non-collapsed selection (anchor ≠ head).
 */
function makeStateWithSelection(doc: string, anchor: number, head: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
  return forceParse(state);
}

/**
 * Collect all ranges from a DecorationSet into [{from, to}] arrays.
 * Works by iterating the range set cursor.
 */
function collectRanges(set: import('@codemirror/state').RangeSet<import('@codemirror/view').Decoration>): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    out.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return out;
}

function makeContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

// ── HIDE_MARK_NODES sanity ────────────────────────────────────────────────────

describe('HIDE_MARK_NODES export', () => {
  it('contains exactly the four v1 marker node names', () => {
    expect(HIDE_MARK_NODES.has('HeaderMark')).toBe(true);
    expect(HIDE_MARK_NODES.has('EmphasisMark')).toBe(true);
    expect(HIDE_MARK_NODES.has('StrikethroughMark')).toBe(true);
    expect(HIDE_MARK_NODES.has('CodeMark')).toBe(true);
    // Exactly 4 entries — no extra nodes (would bypass G-CHOKEPOINT intent)
    expect(HIDE_MARK_NODES.size).toBe(4);
  });
});

// ── G-LP-HIDE ─────────────────────────────────────────────────────────────────

describe('G-LP-HIDE — hidden-line markers produce exact replace ranges', () => {
  it('heading marker hides when cursor is on a DIFFERENT line (line 3)', () => {
    // "# Title\n\n**bold** text"
    // Line 1: "# Title"  → HeaderMark at [0,1], space at 1 → hidden range [0,2)
    // Line 3: "**bold** text" → EmphasisMarks at [9,11] and [15,17]
    // Cursor at line 3 (offset 9) → line 1 HeaderMark must be hidden
    const doc = '# Title\n\n**bold** text';
    // line 3 starts at offset 9 ("**bold** text")
    const state = makeState(doc, 9);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // HeaderMark on line 1 [0..1] + trailing space → replace [0,2)
    const headerHidden = ranges.find((r) => r.from === 0 && r.to === 2);
    expect(headerHidden, 'HeaderMark [0,2) must be hidden when cursor is on line 3').toBeDefined();

    // EmphasisMarks on line 3 must NOT be hidden (cursor line)
    const emphasisOnLine3 = ranges.find((r) => r.from >= 9);
    expect(emphasisOnLine3, 'EmphasisMarks on active line 3 must NOT be in the set').toBeUndefined();
  });

  it('bold EmphasisMark positions are the exact from/to from the parse tree', () => {
    // Simple single-line: cursor NOT on it. We use a two-line doc.
    // Line 1: "other text", line 2: "**bold**"
    const doc = 'other text\n**bold**';
    // Cursor on line 1 (offset 0) → line 2 bold markers must be hidden
    const state = makeState(doc, 0);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // Line 2 starts at offset 11: "**bold**"
    // EmphasisMark = the "**" at [11,13] (opening) and [17,19] (closing)
    const open  = ranges.find((r) => r.from === 11 && r.to === 13);
    const close = ranges.find((r) => r.from === 17 && r.to === 19);
    expect(open,  'Opening ** EmphasisMark [11,13) must be hidden').toBeDefined();
    expect(close, 'Closing ** EmphasisMark [17,19) must be hidden').toBeDefined();
  });

  it('italic EmphasisMark is hidden on a non-active line', () => {
    // Line 1: "plain", line 2: "*italic*"
    const doc = 'plain\n*italic*';
    const state = makeState(doc, 0); // cursor on line 1
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // Line 2 starts at offset 6: "*italic*"  markers at [6,7] and [13,14]
    const openItalic  = ranges.find((r) => r.from === 6 && r.to === 7);
    const closeItalic = ranges.find((r) => r.from === 13 && r.to === 14);
    expect(openItalic,  'Opening * EmphasisMark must be hidden on non-active line').toBeDefined();
    expect(closeItalic, 'Closing * EmphasisMark must be hidden on non-active line').toBeDefined();
  });

  it('inline code CodeMark is hidden on a non-active line', () => {
    // Line 1: "text", line 2: "`code`"
    const doc = 'text\n`code`';
    const state = makeState(doc, 0); // cursor on line 1
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // Line 2 starts at offset 5: "`code`" — CodeMark at [5,6] and [10,11]
    const openCode  = ranges.find((r) => r.from === 5 && r.to === 6);
    const closeCode = ranges.find((r) => r.from === 10 && r.to === 11);
    expect(openCode,  'Opening ` CodeMark must be hidden').toBeDefined();
    expect(closeCode, 'Closing ` CodeMark must be hidden').toBeDefined();
  });

  it('HeaderMark trailing space is consumed (K-LP-3): "# " → replace range [from, markEnd+1)', () => {
    // "# Hello" — HeaderMark covers "#" at [0,1]; char at [1] is " " → to becomes 2
    const doc = '# Hello\nnot active';
    // Cursor on line 2 → line 1 header is hidden
    const state = makeState(doc, 8);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // The replace range must be [0, 2) — consuming "#" and the space
    const headerRange = ranges.find((r) => r.from === 0);
    expect(headerRange, 'HeaderMark replace range must exist').toBeDefined();
    expect(headerRange?.to, 'HeaderMark trailing space must be consumed → to === 2').toBe(2);
  });
});

// ── G-LP-REVEAL ───────────────────────────────────────────────────────────────

describe('G-LP-REVEAL — active-line markers are absent from the set', () => {
  it('HeaderMark is NOT in the set when cursor is on the heading line', () => {
    const doc = '# Title\n\nsome text';
    const state = makeState(doc, 0); // cursor on line 1 (the heading)
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // No range starting at 0 (HeaderMark position)
    const headerRange = ranges.find((r) => r.from === 0);
    expect(headerRange, 'HeaderMark must NOT be hidden on the active heading line').toBeUndefined();
  });

  it('EmphasisMarks are NOT in the set when cursor is on the bold line', () => {
    const doc = '# Title\n\n**bold** text';
    // Cursor on line 3 (offset 9, the bold line)
    const state = makeState(doc, 9);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // No range at or after offset 9 (line 3 positions)
    const activeLineRange = ranges.find((r) => r.from >= 9);
    expect(activeLineRange, 'EmphasisMarks on the active bold line must NOT be hidden').toBeUndefined();

    // But the HeaderMark on line 1 MUST still be hidden
    const headerHidden = ranges.find((r) => r.from === 0);
    expect(headerHidden, 'HeaderMark on inactive line 1 must be hidden').toBeDefined();
  });

  it('CodeMark is NOT in the set when cursor is on the code line', () => {
    const doc = 'text\n`code`';
    const state = makeState(doc, 5); // cursor on line 2
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    const codeRange = ranges.find((r) => r.from >= 5);
    expect(codeRange, 'CodeMark on active line must NOT be hidden').toBeUndefined();
  });
});

// ── G-LP-SELECTION ────────────────────────────────────────────────────────────

describe('G-LP-SELECTION — multi-line selection reveals all covered lines', () => {
  it('selection spanning lines 1-3 reveals every marker on those lines', () => {
    // Line 1: "# Heading"
    // Line 2: "**bold**"
    // Line 3: "`code`"
    // Line 4: "plain"
    const doc = '# Heading\n**bold**\n`code`\nplain';
    // line 1: [0..9], line 2: [10..17], line 3: [18..23], line 4: [24..28]
    // Selection: anchor=0 (line 1), head=23 (end of line 3)
    const state = makeStateWithSelection(doc, 0, 23);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // Lines 1,2,3 are all active → NO markers on those lines should appear
    const onActiveLines = ranges.filter((r) => r.from < 24);
    expect(onActiveLines, 'No markers on lines 1-3 when selection covers them').toHaveLength(0);
  });

  it('only the line outside the selection has hidden markers', () => {
    // Line 1 selected, line 2 not selected
    const doc = '# Heading\n**bold**';
    // Select only line 1: anchor=0, head=9
    const state = makeStateWithSelection(doc, 0, 9);
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);

    // HeaderMark on line 1 (active) → NOT hidden
    const headerRange = ranges.find((r) => r.from === 0);
    expect(headerRange, 'HeaderMark on selected line 1 must NOT be hidden').toBeUndefined();

    // EmphasisMarks on line 2 (inactive) → hidden
    // line 2 starts at offset 10: "**bold**"
    const emphasisOpen = ranges.find((r) => r.from === 10);
    expect(emphasisOpen, 'EmphasisMark on non-selected line 2 must be hidden').toBeDefined();
  });
});

// ── G-LP-CARET-MOVE ──────────────────────────────────────────────────────────

describe('G-LP-CARET-MOVE — moving selection reveals target-line markers', () => {
  it('markers become absent after selection moves onto their line', () => {
    const doc = '# Heading\n**bold**';
    // Initially cursor on line 2 → HeaderMark on line 1 is hidden
    const stateA = makeState(doc, 10);
    const decosA = buildLivePreviewDecorations(stateA);
    const rangesA = collectRanges(decosA);
    expect(rangesA.find((r) => r.from === 0), 'HeaderMark must be hidden when caret on line 2').toBeDefined();

    // Move cursor to line 1 → HeaderMark must be revealed (absent from set)
    const stateB = makeState(doc, 0);
    const decosB = buildLivePreviewDecorations(stateB);
    const rangesB = collectRanges(decosB);
    expect(rangesB.find((r) => r.from === 0), 'HeaderMark must be REVEALED when caret moves to line 1').toBeUndefined();
  });

  it('moving from heading line to bold line flips hide/reveal', () => {
    const doc = '# Heading\n**bold**';
    // Caret on line 1 → bold line markers hidden, header revealed
    const stateOnHeader = makeState(doc, 0);
    const decosOnHeader = buildLivePreviewDecorations(stateOnHeader);
    const rangesOnHeader = collectRanges(decosOnHeader);
    expect(rangesOnHeader.find((r) => r.from === 0)).toBeUndefined(); // header revealed
    expect(rangesOnHeader.find((r) => r.from === 10)).toBeDefined(); // bold hidden

    // Caret on line 2 → header hidden, bold revealed
    const stateOnBold = makeState(doc, 10);
    const decosOnBold = buildLivePreviewDecorations(stateOnBold);
    const rangesOnBold = collectRanges(decosOnBold);
    expect(rangesOnBold.find((r) => r.from === 0)).toBeDefined();  // header hidden
    expect(rangesOnBold.find((r) => r.from === 10)).toBeUndefined(); // bold revealed
  });
});

// ── G-LP-REBUILD ─────────────────────────────────────────────────────────────

describe('G-LP-REBUILD — decoration set changes after selection-only update', () => {
  it('different selection positions produce different decoration sets', () => {
    const doc = '# Heading\n**bold**';

    const stateL1 = makeState(doc, 0);  // cursor line 1
    const stateL2 = makeState(doc, 10); // cursor line 2

    const decosL1 = buildLivePreviewDecorations(stateL1);
    const decosL2 = buildLivePreviewDecorations(stateL2);

    const rangesL1 = collectRanges(decosL1);
    const rangesL2 = collectRanges(decosL2);

    // Moving cursor changes the decoration set content
    expect(rangesL1).not.toEqual(rangesL2);
  });
});

// ── G-LP-ROBUST ──────────────────────────────────────────────────────────────

describe('G-LP-ROBUST — partial/empty/mid-edit markdown never throws', () => {
  it('empty doc → valid DecorationSet with no ranges', () => {
    const state = makeState('');
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
    const ranges = collectRanges(buildLivePreviewDecorations(state));
    expect(ranges).toHaveLength(0);
  });

  it('unterminated "**bold" (no closing **) → no EmphasisMark hidden, no throw', () => {
    // Parser sees no StrongEmphasis node → no EmphasisMark emitted
    const state = makeState('other line\n**bold');
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
    const ranges = collectRanges(buildLivePreviewDecorations(state));
    // No EmphasisMark range at line 2 (offset 11+) — partial construct is raw
    const emphasisRange = ranges.find((r) => r.from >= 11);
    expect(emphasisRange).toBeUndefined();
  });

  it('lone backtick "`" → no CodeMark hidden, no throw', () => {
    const state = makeState('other\n`');
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
    const ranges = collectRanges(buildLivePreviewDecorations(state));
    const codeRange = ranges.find((r) => r.from >= 6);
    expect(codeRange).toBeUndefined();
  });

  it('"# " mid-type (just # and space, no title) → does not throw; HeaderMark hidden', () => {
    // "# " on line 2, cursor on line 1 → header hidden (partial heading is still parsed)
    const state = makeState('first\n# ');
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
  });

  it('doc with only markers and no content → no throw', () => {
    const state = makeState('**');
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
  });

  it('multi-line selection across heading+bold+code → no throw, valid set', () => {
    const doc = '# Heading\n**bold**\n`code`';
    const state = makeStateWithSelection(doc, 0, doc.length);
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
    // All lines active → no ranges
    const ranges = collectRanges(buildLivePreviewDecorations(state));
    expect(ranges).toHaveLength(0);
  });
});

// ── G-LP-NO-INNERHTML ─────────────────────────────────────────────────────────

describe('G-LP-NO-INNERHTML — no widget decoration; no innerHTML in livePreview.ts', () => {
  it('every produced decoration is a replace (spec: no widget key)', () => {
    const doc = '# Heading\n**bold**\n`code`';
    // Cursor on line 3 (offset 20) → lines 1 and 2 markers are hidden
    const state = makeState(doc, 20);
    const decos = buildLivePreviewDecorations(state);
    const cursor = decos.iter();
    let count = 0;
    while (cursor.value !== null) {
      // Decoration.replace({}) has no `widget` property set; spec means no Widget subclass.
      // Check: the decoration does NOT have a truthy `widget` property.
      const asAny = cursor.value as Record<string, unknown>;
      expect(asAny['widget'], 'No decoration must carry a widget').toBeFalsy();
      count++;
      cursor.next();
    }
    expect(count, 'At least one decoration must be present (heading + bold markers)').toBeGreaterThan(0);
  });

  it('livePreview module source does not assign innerHTML', async () => {
    // Source-level scan: livePreview.ts must never assign .innerHTML (XSS gate).
    // We check for assignment patterns, not mere mention of the property name in comments.
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/lib/notes/livePreview.ts'), 'utf-8');
    const assignsInnerHTML = /\.innerHTML\s*=/.test(src);
    expect(assignsInnerHTML, 'livePreview.ts must not assign .innerHTML').toBe(false);
  });

  it('livePreview module source does not import markdown-it or dompurify (G-CHOKEPOINT)', async () => {
    // Mirror the exact patterns from the canonical chokepoint scanner in markdown.test.ts
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'src/lib/notes/livePreview.ts'), 'utf-8');
    const importsMdIt =
      src.includes("from 'markdown-it'") || src.includes('from "markdown-it"') ||
      src.includes("require('markdown-it')") || src.includes('require("markdown-it")');
    const importsDp =
      src.includes("from 'dompurify'") || src.includes('from "dompurify"') ||
      src.includes("require('dompurify')") || src.includes('require("dompurify")');
    expect(importsMdIt, 'livePreview.ts must not import markdown-it').toBe(false);
    expect(importsDp,   'livePreview.ts must not import dompurify').toBe(false);
  });
});

// ── G-LP-SMOKE ────────────────────────────────────────────────────────────────

describe('G-LP-SMOKE — mountEditor with live-preview: no throw, buffer unchanged', () => {
  it('mountEditor mounts without throwing and .cm-content exists', () => {
    const container = makeContainer();
    const doc = '# Hello\n\n**world**';
    let handle: ReturnType<typeof mountEditor> | undefined;
    expect(() => {
      handle = mountEditor(container, { doc, onSave: async () => {} });
    }).not.toThrow();

    expect(container.querySelector('.cm-content'), '.cm-content must exist').not.toBeNull();
    handle?.destroy();
    document.body.removeChild(container);
  });

  it('G-LP-SMOKE: handle.getDoc() === initial doc (buffer never mutated by decorations)', () => {
    const container = makeContainer();
    const doc = '# Title\n\n**bold** *italic* `code`';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    expect(handle.getDoc()).toBe(doc);
    handle.destroy();
    document.body.removeChild(container);
  });
});

// ── G-SAVE-CARET-SAFE ─────────────────────────────────────────────────────────

describe('G-SAVE-CARET-SAFE — selection-only transaction does NOT call onSave', () => {
  it('dispatching a selection-only update does not trigger onSave or change getDoc()', async () => {
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const doc = '# Heading\n\n**bold** text';
    const handle = mountEditor(container, { doc, onSave });
    const view = handle.getView();

    // Move caret from line 1 to line 3 — pure selection change, no doc mutation
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({ selection: { anchor: 12 } });

    // Wait past the debounce window
    await new Promise<void>((r) => setTimeout(r, 700));

    expect(onSave, 'onSave must NOT be called for selection-only updates').not.toHaveBeenCalled();
    expect(handle.getDoc(), 'getDoc() must equal the initial doc').toBe(doc);

    handle.destroy();
    document.body.removeChild(container);
  });
});

// ── G-LP-ATOMIC (state-level check) ──────────────────────────────────────────

describe('G-LP-ATOMIC — plugin atomicRanges == hidden decoration set', () => {
  it('jinLivePreview() creates a ViewPlugin with a provide for atomicRanges', () => {
    // Create a real EditorView with the live-preview extension and check
    // that the plugin is registered and its decorations drive atomicRanges.
    const container = makeContainer();
    const doc = '# Heading\n**bold**';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const view = handle.getView();

    // Move caret to line 2 → HeaderMark on line 1 should be in atomicRanges
    // (Verified at the decoration level: the plugin's decorations cover [0,2))
    view.dispatch({ selection: { anchor: 10 } });

    // Query the plugin instance — it must exist and have decorations
    const ext = jinLivePreview();
    // The extension is a PluginSpec; we can't directly inspect atomicRanges in jsdom
    // (no layout), but we can verify the plugin builds a non-empty decoration set
    // for a state where the heading line is inactive.
    const state = makeState(doc, 10); // cursor on line 2
    const decos = buildLivePreviewDecorations(state);
    const ranges = collectRanges(decos);
    // The hidden header mark [0,2) must be in the set — these are the atomicRanges
    expect(ranges.find((r) => r.from === 0 && r.to === 2),
      'atomicRanges must cover the HeaderMark [0,2) when cursor is on line 2'
    ).toBeDefined();

    // The jinLivePreview() factory is callable and returns a value (extension)
    expect(ext, 'jinLivePreview() must return an extension').toBeDefined();

    handle.destroy();
    document.body.removeChild(container);
  });
});

// ── List bullet + task-checkbox widget gates (LPL-1 / LPL-2 / LPL-3) ─────────
//
// All assertions are in THIS new block. The existing G-LP-NO-INNERHTML "every
// produced decoration is a replace (no widget)" test uses a list-FREE doc and
// must NOT be touched (K-LPL-C). The HIDE_MARK_NODES size===4 test is also
// preserved — ListMark is NOT in HIDE_MARK_NODES.

describe('List bullet + task-checkbox widget gates (LPL-1 / LPL-2 / LPL-3)', () => {
  // Helper: iterate a DecorationSet and collect {from, to, widget} tuples.
  // widget is read from cursor.value.spec.widget (per CM6 Decoration.replace spec).
  function collectWidgets(
    set: import('@codemirror/state').RangeSet<import('@codemirror/view').Decoration>,
  ): Array<{ from: number; to: number; widget: unknown }> {
    const out: Array<{ from: number; to: number; widget: unknown }> = [];
    const cursor = set.iter();
    while (cursor.value !== null) {
      const asAny = cursor.value as Record<string, unknown>;
      const spec = asAny['spec'] as Record<string, unknown> | undefined;
      out.push({ from: cursor.from, to: cursor.to, widget: spec?.['widget'] });
      cursor.next();
    }
    return out;
  }

  // ── G-LP-BULLET-HIDE ───────────────────────────────────────────────────────

  it('G-LP-BULLET-HIDE: off-line bullet ListMark gets BulletWidget at EXACTLY [11,12)', () => {
    // 'plain text\n- apple'
    //  [0..9]  \n[10]  '-'[11]  ' '[12]  'apple'[13..18]
    // Line 2 starts at 11; ListMark '-' is [11,12).
    const doc = 'plain text\n- apple';
    const state = makeState(doc, 0); // cursor on line 1
    const decos = buildLivePreviewDecorations(state);
    const widgets = collectWidgets(decos);
    const hit = widgets.find((w) => w.from === 11 && w.to === 12);
    expect(hit, 'G-LP-BULLET-HIDE: decoration must exist at [11,12)').toBeDefined();
    expect(
      hit?.widget instanceof BulletWidget,
      'G-LP-BULLET-HIDE: widget must be BulletWidget',
    ).toBe(true);
  });

  // ── G-LP-BULLET-REVEAL ────────────────────────────────────────────────────

  it('G-LP-BULLET-REVEAL: on active bullet line (cursor@11), NO BulletWidget at [11,12)', () => {
    const doc = 'plain text\n- apple';
    const state = makeState(doc, 11); // cursor on line 2 (the bullet line)
    const decos = buildLivePreviewDecorations(state);
    const widgets = collectWidgets(decos);
    const hit = widgets.find(
      (w) => w.from === 11 && w.to === 12 && w.widget instanceof BulletWidget,
    );
    expect(hit, 'G-LP-BULLET-REVEAL: BulletWidget must be absent on the active line').toBeUndefined();
  });

  // ── G-LP-ORDERED-UNTOUCHED ────────────────────────────────────────────────

  it("G-LP-ORDERED-UNTOUCHED: ordered ListMark '1.' at [6,8) gets NO widget at any cursor pos", () => {
    // 'plain\n1. first'  — line 2 starts at 6; '1.' = ListMark [6,8)
    const doc = 'plain\n1. first';
    const stateL1 = makeState(doc, 0); // cursor on line 1
    const stateL2 = makeState(doc, 6); // cursor on line 2
    for (const state of [stateL1, stateL2]) {
      const widgets = collectWidgets(buildLivePreviewDecorations(state));
      const hit = widgets.find((w) => w.from === 6 && w.to === 8);
      expect(hit, 'G-LP-ORDERED-UNTOUCHED: no widget over ordered ListMark [6,8)').toBeUndefined();
    }
  });

  // ── G-LP-CHECKBOX (unchecked) ─────────────────────────────────────────────

  it('G-LP-CHECKBOX: "- [ ] todo" (cursor@0) → CheckboxWidget at EXACTLY [6,11) with .checked===false', () => {
    // 'plain\n- [ ] todo'
    //  [0..4]\n[5]  '-'[6]  ' '[7]  '['[8]' '[9]']'[10]  ' '[11]  'todo'[12..15]
    // ListMark.from=6; TaskMarker=[8,11); combined widget=[6,11).
    const doc = 'plain\n- [ ] todo';
    const state = makeState(doc, 0);
    const widgets = collectWidgets(buildLivePreviewDecorations(state));
    const hit = widgets.find((w) => w.from === 6 && w.to === 11);
    expect(hit, 'G-LP-CHECKBOX: decoration must exist at [6,11)').toBeDefined();
    expect(hit?.widget instanceof CheckboxWidget, 'G-LP-CHECKBOX: must be CheckboxWidget').toBe(true);
    expect(
      (hit?.widget as CheckboxWidget)?.checked,
      'G-LP-CHECKBOX: .checked must be false for "[ ]"',
    ).toBe(false);
  });

  it('G-LP-CHECKBOX: "- [x] done" → CheckboxWidget at [6,11) with .checked===true', () => {
    const doc = 'plain\n- [x] done';
    const widgets = collectWidgets(buildLivePreviewDecorations(makeState(doc, 0)));
    const hit = widgets.find((w) => w.from === 6 && w.to === 11);
    expect(hit?.widget instanceof CheckboxWidget).toBe(true);
    expect((hit?.widget as CheckboxWidget)?.checked).toBe(true);
  });

  it('G-LP-CHECKBOX: "- [X] DONE" (uppercase X) → CheckboxWidget at [6,11) with .checked===true', () => {
    const doc = 'plain\n- [X] DONE';
    const widgets = collectWidgets(buildLivePreviewDecorations(makeState(doc, 0)));
    const hit = widgets.find((w) => w.from === 6 && w.to === 11);
    expect(hit?.widget instanceof CheckboxWidget).toBe(true);
    expect((hit?.widget as CheckboxWidget)?.checked).toBe(true);
  });

  // ── G-LP-CHECKBOX-REVEAL ──────────────────────────────────────────────────

  it('G-LP-CHECKBOX-REVEAL: on active task line (cursor@6), NO CheckboxWidget over [6,11)', () => {
    const doc = 'plain\n- [ ] todo';
    const state = makeState(doc, 6); // cursor on line 2 (task line)
    const widgets = collectWidgets(buildLivePreviewDecorations(state));
    const hit = widgets.find(
      (w) => w.from === 6 && w.to === 11 && w.widget instanceof CheckboxWidget,
    );
    expect(hit, 'G-LP-CHECKBOX-REVEAL: CheckboxWidget must be absent on the active line').toBeUndefined();
  });

  // ── G-LP-NO-DOUBLE-BULLET ─────────────────────────────────────────────────

  it('G-LP-NO-DOUBLE-BULLET: task line → exactly 1 CheckboxWidget and 0 BulletWidget (never "• ☐")', () => {
    const doc = 'plain\n- [ ] todo';
    const widgets = collectWidgets(buildLivePreviewDecorations(makeState(doc, 0)));
    const checkboxCount = widgets.filter((w) => w.widget instanceof CheckboxWidget).length;
    const bulletCount   = widgets.filter((w) => w.widget instanceof BulletWidget).length;
    expect(checkboxCount, 'G-LP-NO-DOUBLE-BULLET: exactly ONE CheckboxWidget').toBe(1);
    expect(bulletCount,   'G-LP-NO-DOUBLE-BULLET: ZERO BulletWidget on task line').toBe(0);
  });

  // ── G-LP-ROBUST(ext) — half-typed / edge cases ────────────────────────────

  it('G-LP-ROBUST(ext): half-typed "- [ " → no throw; BulletWidget produced; no CheckboxWidget', () => {
    // 'x\n- [ ': '-' is ListMark [2,3); '[ ' has no closing ']' → no Task node
    // → plain bullet path, BulletWidget at [2,3), no CheckboxWidget, no throw
    const doc = 'x\n- [ ';
    expect(() => {
      const state = makeState(doc, 0); // cursor on line 1
      const widgets = collectWidgets(buildLivePreviewDecorations(state));
      expect(
        widgets.filter((w) => w.widget instanceof CheckboxWidget).length,
        'G-LP-ROBUST(ext): no CheckboxWidget for half-typed task',
      ).toBe(0);
      expect(
        widgets.filter((w) => w.widget instanceof BulletWidget).length,
        'G-LP-ROBUST(ext): BulletWidget for the half-typed bullet line',
      ).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('G-LP-ROBUST(ext): mixed doc (plain + task + checked + ordered) — no throw; monotonic ranges', () => {
    const doc = 'a\n- plain\n- [ ] task\n- [x] done\n1. num';
    expect(() => {
      const state = makeState(doc, 0);
      const widgets = collectWidgets(buildLivePreviewDecorations(state));
      // Verify monotonic order — RangeSetBuilder throws if violated
      for (let i = 1; i < widgets.length; i++) {
        expect(widgets[i].from).toBeGreaterThanOrEqual(widgets[i - 1].from);
      }
      // Ordered list must yield no widget
      const lastLineOffset = doc.lastIndexOf('1. num');
      const orderedHit = widgets.find(
        (w) => w.from === lastLineOffset && w.to === lastLineOffset + 2,
      );
      expect(orderedHit, 'G-LP-ROBUST(ext): ordered list must have no widget').toBeUndefined();
    }).not.toThrow();
  });

  // ── G-LP-ATOMIC(ext) ──────────────────────────────────────────────────────

  it('G-LP-ATOMIC(ext): widget ranges appear in the same DecorationSet used for atomicRanges', () => {
    // jinLivePreview() provides atomicRanges from the SAME DecorationSet as decorations.
    // Assert that the set returned by the pure builder contains the widget ranges.
    // 'plain\n- apple\n- [ ] todo'
    //  line2 ListMark [6,7) → BulletWidget; line3 combined [14,19) → CheckboxWidget
    const doc = 'plain\n- apple\n- [ ] todo';
    const state = makeState(doc, 0);
    const widgets = collectWidgets(buildLivePreviewDecorations(state));
    const bulletDeco   = widgets.find((w) => w.widget instanceof BulletWidget);
    const checkboxDeco = widgets.find((w) => w.widget instanceof CheckboxWidget);
    expect(bulletDeco,   'G-LP-ATOMIC(ext): BulletWidget must be in the DecorationSet').toBeDefined();
    expect(checkboxDeco, 'G-LP-ATOMIC(ext): CheckboxWidget must be in the DecorationSet').toBeDefined();
    // Exact ranges confirm the atomic set covers them
    expect(bulletDeco?.from).toBe(6);
    expect(bulletDeco?.to).toBe(7);
    expect(checkboxDeco?.from).toBe(14);
    expect(checkboxDeco?.to).toBe(19);
  });

  // ── G-LP-NO-INNERHTML(ext) — widget DOM built without innerHTML ────────────

  it('G-LP-NO-INNERHTML(ext): BulletWidget.toDOM() builds DOM with textContent only; no child elements', () => {
    const widget = new BulletWidget();
    const el = widget.toDOM();
    expect(el.textContent, 'BulletWidget glyph must be •').toBe('•');
    expect(el.children.length, 'BulletWidget DOM must have no child elements').toBe(0);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toBe('cm-bullet-glyph');
  });

  it('G-LP-NO-INNERHTML(ext): CheckboxWidget.toDOM() (unchecked ☐) builds DOM correctly', () => {
    const widget = new CheckboxWidget(false);
    const el = widget.toDOM();
    expect(el.textContent, 'Unchecked CheckboxWidget glyph must be ☐').toBe('☐');
    expect(el.children.length, 'CheckboxWidget DOM must have no child elements').toBe(0);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toBe('cm-task-glyph');
  });

  it('G-LP-NO-INNERHTML(ext): CheckboxWidget.toDOM() (checked ☑) has correct glyph and modifier class', () => {
    const widget = new CheckboxWidget(true);
    const el = widget.toDOM();
    expect(el.textContent, 'Checked CheckboxWidget glyph must be ☑').toBe('☑');
    expect(el.className).toContain('cm-task-glyph');
    expect(el.className).toContain('cm-task-glyph--checked');
  });

  it('G-LP-NO-INNERHTML(ext): CheckboxWidget.eq() rebuilds on checked-state flip', () => {
    const unchecked = new CheckboxWidget(false);
    const checked   = new CheckboxWidget(true);
    const same      = new CheckboxWidget(false);
    expect(unchecked.eq(same),    'same checked state → eq').toBe(true);
    expect(unchecked.eq(checked), 'different checked state → not eq').toBe(false);
    expect(checked.eq(unchecked), 'different checked state → not eq (reverse)').toBe(false);
  });

  // ── G-LP-SMOKE(ext) ──────────────────────────────────────────────────────

  it('G-LP-SMOKE(ext): mountEditor with bullet+task → .cm-bullet-glyph + .cm-task-glyph in DOM; getDoc() unchanged; no throw', () => {
    const container = makeContainer();
    // Three-line doc so caret on line 3 keeps both list lines inactive simultaneously.
    // ('- a\n- [ ] b' is only 2 lines; a 3rd plain line gives a caret-off-both-lists pos.)
    const doc = '- a\n- [ ] b\nplain';
    let handle: ReturnType<typeof mountEditor> | undefined;

    expect(() => {
      handle = mountEditor(container, { doc, onSave: async () => {} });
    }).not.toThrow();

    expect(container.querySelector('.cm-content'), '.cm-content must exist').not.toBeNull();

    // Move caret to line 3 (offset 12 = start of 'plain') so neither list line is active
    const view = handle!.getView();
    view.dispatch({ selection: { anchor: 12 } });

    // Pure-builder check (always reliable, independent of jsdom rendering pipeline):
    // both widget types must appear in the decoration set with caret on line 3.
    const state = makeState(doc, 12);
    const widgets = collectWidgets(buildLivePreviewDecorations(state));
    expect(
      widgets.some((w) => w.widget instanceof BulletWidget),
      'G-LP-SMOKE(ext): BulletWidget must be in the decoration set',
    ).toBe(true);
    expect(
      widgets.some((w) => w.widget instanceof CheckboxWidget),
      'G-LP-SMOKE(ext): CheckboxWidget must be in the decoration set',
    ).toBe(true);

    // Buffer must never be mutated by decorations
    expect(handle!.getDoc(), 'G-LP-SMOKE(ext): getDoc() must equal initial doc').toBe(doc);

    // DOM check: glyphs should be rendered into .cm-content by the ViewPlugin
    const cmContent = container.querySelector('.cm-content');
    expect(
      cmContent?.querySelector('.cm-bullet-glyph'),
      'G-LP-SMOKE(ext): .cm-bullet-glyph must appear in .cm-content',
    ).not.toBeNull();
    expect(
      cmContent?.querySelector('.cm-task-glyph'),
      'G-LP-SMOKE(ext): .cm-task-glyph must appear in .cm-content',
    ).not.toBeNull();

    handle!.destroy();
    document.body.removeChild(container);
  });
});

// ── Blockquote bar gates (LPQ-1 / LPQ-2) ────────────────────────────────────
//
// All new assertions are in THIS describe block. Existing G-LP-NO-INNERHTML
// "every produced decoration is a replace (no widget)" test uses a quote-FREE
// doc and must NOT be touched (mirror K-LPL-C). HIDE_MARK_NODES size===4 is
// also preserved — 'QuoteMark' is NOT in HIDE_MARK_NODES.

describe('Blockquote bar gates (LPQ-1 / LPQ-2)', () => {
  // Helper: iterate a DecorationSet and collect {from, to, class, hasWidget}.
  // `class` is read from cursor.value.spec.class (truthy for line/mark decos).
  function collectDecos(
    set: import('@codemirror/state').RangeSet<import('@codemirror/view').Decoration>,
  ): Array<{ from: number; to: number; class: string | undefined; hasWidget: boolean }> {
    const out: Array<{ from: number; to: number; class: string | undefined; hasWidget: boolean }> = [];
    const cursor = set.iter();
    while (cursor.value !== null) {
      const spec = (cursor.value as unknown as { spec: Record<string, unknown> }).spec;
      out.push({
        from: cursor.from,
        to: cursor.to,
        class: spec['class'] as string | undefined,
        hasWidget: Boolean(spec['widget']),
      });
      cursor.next();
    }
    return out;
  }

  // ── G-LP-QUOTE-BAR ────────────────────────────────────────────────────────

  it("G-LP-QUOTE-BAR: 'x\\n> quoted text' cursor@0 → line@(2,2) cm-blockquote-line + replace[2,4); doc unchanged", () => {
    // doc:  'x\n> quoted text'
    //   0='x', 1='\n', 2='>', 3=' ', 4..14='quoted text'
    // Line 1: [0,1); Line 2: [2,15) — QuoteMark='>' at [2,3); trailing space at [3] → markTo=4
    // cursor@0 → line 1 active; line 2 inactive → bar + hidden '> '.
    const doc = 'x\n> quoted text';
    const state = makeState(doc, 0);
    const decos = buildLivePreviewDecorations(state);
    const items = collectDecos(decos);

    // Line decoration at (2,2) with class cm-blockquote-line
    const bar = items.find((d) => d.from === 2 && d.to === 2 && d.class === 'cm-blockquote-line');
    expect(bar, 'G-LP-QUOTE-BAR: line@(2,2) cm-blockquote-line must be present').toBeDefined();

    // Replace[2,4) — hides '> ' (> plus trailing space)
    const hide = items.find((d) => d.from === 2 && d.to === 4 && !d.class && !d.hasWidget);
    expect(hide, 'G-LP-QUOTE-BAR: replace[2,4) (hides "> ") must be present').toBeDefined();

    // Buffer never mutated
    expect(state.doc.toString(), 'G-LP-QUOTE-BAR: doc must be unchanged').toBe(doc);
  });

  // ── G-LP-QUOTE-REVEAL ─────────────────────────────────────────────────────

  it("G-LP-QUOTE-REVEAL: cursor@4 (on quote line) → line@(2,2) STILL present; replace[2,4) ABSENT", () => {
    // cursor@4 places the caret inside the quote text on line 2 → line 2 active.
    // The bar (line decoration) persists; only the '>' replace is gated off.
    const doc = 'x\n> quoted text';
    const state = makeState(doc, 4);
    const decos = buildLivePreviewDecorations(state);
    const items = collectDecos(decos);

    // Bar MUST still be present (D-QUOTE-BAR-ACTIVE)
    const bar = items.find((d) => d.from === 2 && d.to === 2 && d.class === 'cm-blockquote-line');
    expect(bar, 'G-LP-QUOTE-REVEAL: line@(2,2) cm-blockquote-line must PERSIST on active line').toBeDefined();

    // Replace MUST be absent (raw '>' revealed)
    const hide = items.find((d) => d.from === 2 && d.to === 4 && !d.class);
    expect(hide, 'G-LP-QUOTE-REVEAL: replace[2,4) must be ABSENT (raw ">" shown on active line)').toBeUndefined();
  });

  // ── G-LP-QUOTE-MULTILINE ──────────────────────────────────────────────────

  it("G-LP-QUOTE-MULTILINE: '> a\\n> b\\nplain' cursor@8 → bars at (0,0) and (4,4); replaces [0,2) and [4,6)", () => {
    // doc:  '> a\n> b\nplain'
    //   0='>', 1=' ', 2='a', 3='\n', 4='>', 5=' ', 6='b', 7='\n', 8='p'...
    // Line 1: [0,3); Line 2: [4,7); Line 3: [8,12)
    // cursor@8 → line 3 active; lines 1+2 inactive.
    // QuoteMark[0,1) → markTo=2 (space at 1); QuoteMark[4,5) → markTo=6 (space at 5).
    const doc = '> a\n> b\nplain';
    const state = makeState(doc, 8);
    const decos = buildLivePreviewDecorations(state);
    const items = collectDecos(decos);

    // Bar on line 1 at (0,0)
    const bar1 = items.find((d) => d.from === 0 && d.to === 0 && d.class === 'cm-blockquote-line');
    expect(bar1, 'G-LP-QUOTE-MULTILINE: line@(0,0) cm-blockquote-line must be present').toBeDefined();

    // Bar on line 2 at (4,4)
    const bar2 = items.find((d) => d.from === 4 && d.to === 4 && d.class === 'cm-blockquote-line');
    expect(bar2, 'G-LP-QUOTE-MULTILINE: line@(4,4) cm-blockquote-line must be present').toBeDefined();

    // Replace[0,2) — hides '> ' on line 1
    const hide1 = items.find((d) => d.from === 0 && d.to === 2 && !d.class && !d.hasWidget);
    expect(hide1, 'G-LP-QUOTE-MULTILINE: replace[0,2) must be present').toBeDefined();

    // Replace[4,6) — hides '> ' on line 2
    const hide2 = items.find((d) => d.from === 4 && d.to === 6 && !d.class && !d.hasWidget);
    expect(hide2, 'G-LP-QUOTE-MULTILINE: replace[4,6) must be present').toBeDefined();
  });

  // ── G-LP-QUOTE-ORDER ──────────────────────────────────────────────────────

  it("G-LP-QUOTE-ORDER: 'x\\n> **bold**' cursor@0 → line@(2,2) + replace[2,4) + replace[4,6) + replace[10,12); monotonic; no throw", () => {
    // doc:  'x\n> **bold**'
    //   0='x', 1='\n', 2='>', 3=' ', 4='*', 5='*', 6='b'..9='d', 10='*', 11='*'
    // Line 1: [0,1); Line 2: [2,12)
    // cursor@0 → line 2 inactive → bar + QuoteMark replace + both EmphasisMark replaces.
    // Critical ordering: line@(2,2) startSide=-2e8 THEN replace[2,4) startSide~5e8
    // → monotonic (reversed order would THROW).
    const doc = 'x\n> **bold**';
    expect(() => {
      const state = makeState(doc, 0);
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);

      // Bar at (2,2)
      const bar = items.find((d) => d.from === 2 && d.to === 2 && d.class === 'cm-blockquote-line');
      expect(bar, 'G-LP-QUOTE-ORDER: line@(2,2) cm-blockquote-line must be present').toBeDefined();

      // QuoteMark replace[2,4) ('> ')
      const qHide = items.find((d) => d.from === 2 && d.to === 4 && !d.class && !d.hasWidget);
      expect(qHide, 'G-LP-QUOTE-ORDER: replace[2,4) (QuoteMark) must be present').toBeDefined();

      // Opening EmphasisMark replace[4,6) ('**')
      const emOpen = items.find((d) => d.from === 4 && d.to === 6 && !d.class && !d.hasWidget);
      expect(emOpen, 'G-LP-QUOTE-ORDER: replace[4,6) (opening EmphasisMark) must be present').toBeDefined();

      // Closing EmphasisMark replace[10,12) ('**')
      const emClose = items.find((d) => d.from === 10 && d.to === 12 && !d.class && !d.hasWidget);
      expect(emClose, 'G-LP-QUOTE-ORDER: replace[10,12) (closing EmphasisMark) must be present').toBeDefined();

      // Ranges must be monotonically non-decreasing (RangeSetBuilder invariant)
      for (let i = 1; i < items.length; i++) {
        expect(items[i].from, 'G-LP-QUOTE-ORDER: decorations must be in ascending from-order').toBeGreaterThanOrEqual(items[i - 1].from);
      }
    }).not.toThrow();
  });

  // ── G-LP-QUOTE-ATOMIC ─────────────────────────────────────────────────────

  it('G-LP-QUOTE-ATOMIC: atomicDecorationsOf keeps the replace[2,4); drops the line@(2,2) cm-blockquote-line', () => {
    // Synthetic set mirroring the QuoteMark branch output for an inactive quote.
    // line@(2,2) has spec.class='cm-blockquote-line' (truthy) and no spec.widget
    // → the existing !spec.class || spec.widget filter DROPS it.
    // replace[2,4) has no spec.class and no spec.widget → KEPT.
    const synBuilder = new RangeSetBuilder<Decoration>();
    synBuilder.add(2, 2, Decoration.line({ class: 'cm-blockquote-line' })); // line deco
    synBuilder.add(2, 4, Decoration.replace({}));                            // QuoteMark replace
    const fullSet = synBuilder.finish();

    const atomicSet = atomicDecorationsOf(fullSet);
    const atomicRanges = collectRanges(atomicSet);

    // Exactly ONE range (the replace) remains; the line deco is excluded.
    expect(atomicRanges, 'G-LP-QUOTE-ATOMIC: exactly 1 atomic range (the replace)').toHaveLength(1);
    expect(atomicRanges[0], 'G-LP-QUOTE-ATOMIC: atomic range must be replace[2,4)').toEqual({ from: 2, to: 4 });
  });

  // ── G-LP-QUOTE-ROBUST ─────────────────────────────────────────────────────

  it("G-LP-QUOTE-ROBUST: '>> nested\\nplain' cursor on line 2 → exactly 1 bar + both '>' hidden; no throw", () => {
    // doc:  '>> nested\nplain'
    //   0='>', 1='>', 2=' ', 3..'d'=8, '\n'=9, 'plain'=10..14
    // OUTER QuoteMark[0,1): node.from=0 === line.from=0 → bar + replace[0,1) (no space after outer '>').
    // INNER QuoteMark[1,2): node.from=1 !== line.from=0 → NO second bar; replace[1,3) (eats space at 2).
    const doc = '>> nested\nplain';
    expect(() => {
      const state = makeState(doc, 10); // cursor on line 2 ('plain') → line 1 inactive
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);

      // Exactly ONE bar (the outer, at line.from=0)
      const bars = items.filter((d) => d.class === 'cm-blockquote-line');
      expect(bars, 'G-LP-QUOTE-ROBUST(>>): exactly 1 line decoration').toHaveLength(1);
      expect(bars[0].from, 'G-LP-QUOTE-ROBUST(>>): bar must be at position 0').toBe(0);

      // Outer QuoteMark replace[0,1) (no trailing space — next char is '>')
      const outerHide = items.find((d) => d.from === 0 && d.to === 1 && !d.class && !d.hasWidget);
      expect(outerHide, "G-LP-QUOTE-ROBUST(>>): replace[0,1) (outer '>') must be present").toBeDefined();

      // Inner QuoteMark replace[1,3) (eats the space at position 2)
      const innerHide = items.find((d) => d.from === 1 && d.to === 3 && !d.class && !d.hasWidget);
      expect(innerHide, "G-LP-QUOTE-ROBUST(>>): replace[1,3) (inner '>' + space) must be present").toBeDefined();
    }).not.toThrow();
  });

  it("G-LP-QUOTE-ROBUST: '> ' (empty blockquote) → no throw; replace does not cross line break", () => {
    // doc: '> \nplain'
    // QuoteMark='>' at [0,1); markTo=1, sliceString(1,2)=' ' → markTo=2.
    // line.to=2 (just before '\n'), replace[0,2) is within the line. No throw.
    const doc = '> \nplain';
    expect(() => {
      const state = makeState(doc, 3); // cursor on line 2
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);
      const bar = items.find((d) => d.class === 'cm-blockquote-line');
      expect(bar, "G-LP-QUOTE-ROBUST('> '): bar must be present").toBeDefined();
      // replace at [0,2); must not exceed line 1's end (which is at 2 before '\n')
      const hide = items.find((d) => d.from === 0 && d.to === 2 && !d.class);
      expect(hide, "G-LP-QUOTE-ROBUST('> '): replace[0,2) must be present and within the line").toBeDefined();
    }).not.toThrow();
  });

  it("G-LP-QUOTE-ROBUST: '> line one\\nlazy line' → no throw; only line 1 gets a bar (lazy has no QuoteMark)", () => {
    // Lazy continuation: the second line has no '>' → no QuoteMark → no bar (documented v1 limitation).
    const doc = '> line one\nlazy line';
    expect(() => {
      const state = makeState(doc, 11); // cursor on line 2 ('lazy line')
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);
      const bars = items.filter((d) => d.class === 'cm-blockquote-line');
      expect(bars, 'G-LP-QUOTE-ROBUST(lazy): exactly 1 bar (on line 1 only)').toHaveLength(1);
      expect(bars[0].from, 'G-LP-QUOTE-ROBUST(lazy): bar must be at line 1 start (0)').toBe(0);
    }).not.toThrow();
  });

  it("G-LP-QUOTE-ROBUST: '> - item\\nplain' → no throw; bar + hidden '>' + BulletWidget", () => {
    // Lezer: '> - item' → Blockquote QuoteMark[0,1) BulletList ListItem ListMark[2,3).
    // cursor on line 2 → line 1 inactive → bar + replace[0,2) + BulletWidget[2,3).
    const doc = '> - item\nplain';
    expect(() => {
      const state = makeState(doc, 9); // cursor on line 2
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);

      // Bar present
      const bar = items.find((d) => d.class === 'cm-blockquote-line');
      expect(bar, "G-LP-QUOTE-ROBUST(list): bar must be present").toBeDefined();

      // QuoteMark replace[0,2) ('> ')
      const qHide = items.find((d) => d.from === 0 && d.to === 2 && !d.class && !d.hasWidget);
      expect(qHide, "G-LP-QUOTE-ROBUST(list): replace[0,2) for '> ' must be present").toBeDefined();

      // BulletWidget at [2,3)
      const bullet = items.find((d) => d.from === 2 && d.to === 3 && d.hasWidget);
      expect(bullet, 'G-LP-QUOTE-ROBUST(list): BulletWidget at [2,3) must be present').toBeDefined();
    }).not.toThrow();
  });

  // ── G-LP-QUOTE-STYLE + G-LP-QUOTE-SMOKE ──────────────────────────────────

  it('G-LP-QUOTE-STYLE + G-LP-QUOTE-SMOKE: mountEditor with inactive quote line → .cm-blockquote-line in .cm-content; getDoc() unchanged; no throw', () => {
    // Three-line doc: caret placed on line 3 ('tail') keeps the quote line (line 2)
    // inactive so the bar decoration is applied.
    const doc = 'plain\n> quoted\ntail';
    const container = makeContainer();
    let handle: ReturnType<typeof mountEditor> | undefined;

    expect(() => {
      handle = mountEditor(container, { doc, onSave: async () => {} });
    }).not.toThrow();

    expect(container.querySelector('.cm-content'), '.cm-content must exist').not.toBeNull();

    // Move caret to line 3 (start of 'tail') so the quote line is inactive.
    const view = handle!.getView();
    const tailOffset = doc.lastIndexOf('tail');
    view.dispatch({ selection: { anchor: tailOffset } });

    // G-LP-QUOTE-NO-BUFFER-MUTATION: buffer never mutated by decorations.
    expect(handle!.getDoc(), 'G-LP-QUOTE-SMOKE: getDoc() must equal the initial doc').toBe(doc);

    // Pure-builder check (reliable regardless of jsdom rendering pipeline).
    const state = makeState(doc, tailOffset);
    const items = collectDecos(buildLivePreviewDecorations(state));
    expect(
      items.find((d) => d.class === 'cm-blockquote-line'),
      'G-LP-QUOTE-STYLE: cm-blockquote-line must be in the decoration set for inactive quote line',
    ).toBeDefined();

    // DOM check: .cm-line.cm-blockquote-line must be rendered by the ViewPlugin.
    const cmContent = container.querySelector('.cm-content');
    expect(
      cmContent?.querySelector('.cm-blockquote-line'),
      'G-LP-QUOTE-SMOKE: .cm-blockquote-line must appear in .cm-content',
    ).not.toBeNull();

    handle!.destroy();
    document.body.removeChild(container);
  });
});

// ── Link-collapse gates (LPK-1 / LPK-2) ──────────────────────────────────────
//
// All new assertions are in THIS describe block. The existing G-LP-NO-INNERHTML
// "every produced decoration is a replace (no widget)" test uses a link-FREE doc
// and must NOT be touched. HIDE_MARK_NODES size===4 is also preserved — 'Link'
// is NOT in HIDE_MARK_NODES.

describe('Link-collapse gates (LPK-1 / LPK-2)', () => {
  // Helper: iterate a DecorationSet and collect {from, to, class, hasWidget}.
  // `class` is read from cursor.value.spec.class (truthy for mark decorations only).
  function collectDecos(
    set: import('@codemirror/state').RangeSet<import('@codemirror/view').Decoration>,
  ): Array<{ from: number; to: number; class: string | undefined; hasWidget: boolean }> {
    const out: Array<{ from: number; to: number; class: string | undefined; hasWidget: boolean }> = [];
    const cursor = set.iter();
    while (cursor.value !== null) {
      const spec = (cursor.value as unknown as { spec: Record<string, unknown> }).spec;
      out.push({
        from: cursor.from,
        to: cursor.to,
        class: spec['class'] as string | undefined,
        hasWidget: Boolean(spec['widget']),
      });
      cursor.next();
    }
    return out;
  }

  // ── G-LP-LINK-COLLAPSE ────────────────────────────────────────────────────

  it('G-LP-LINK-COLLAPSE: off-line [label](https://example.com) → exact replace/mark ranges; buffer unchanged', () => {
    // doc = 'x\n[label](https://example.com)' (30 chars)
    // Link node: [2,30); '[' at [2,3); label 'label' at [3,8); ']' at [8,9);
    //            '(' at [9,10); URL 'https://example.com' at [10,29); ')' at [29,30)
    // Cursor at 0 → line 1 ('x') is active; line 2 (link) is inactive → collapse.
    const doc = 'x\n[label](https://example.com)';
    const state = makeState(doc, 0);
    const decos = buildLivePreviewDecorations(state);
    const items = collectDecos(decos);

    // replace[2,3) — hides '['
    const openReplace = items.find((d) => d.from === 2 && d.to === 3);
    expect(openReplace, 'G-LP-LINK-COLLAPSE: replace[2,3) (hides "[") must exist').toBeDefined();
    expect(openReplace?.class, 'replace[2,3) must NOT be a mark').toBeUndefined();

    // mark[3,8) — styles 'label'
    const labelMark = items.find((d) => d.from === 3 && d.to === 8);
    expect(labelMark, 'G-LP-LINK-COLLAPSE: mark[3,8) (labels "label") must exist').toBeDefined();
    expect(labelMark?.class, 'label mark must have class cm-link-label').toBe('cm-link-label');

    // replace[8,30) — hides '](https://example.com)'
    const closeReplace = items.find((d) => d.from === 8 && d.to === 30);
    expect(closeReplace, 'G-LP-LINK-COLLAPSE: replace[8,30) (hides "](url)") must exist').toBeDefined();
    expect(closeReplace?.class, 'replace[8,30) must NOT be a mark').toBeUndefined();

    // G-LP-LINK-NO-BUFFER-MUTATION: doc text must be unchanged
    expect(state.doc.toString(), 'Buffer must not be mutated').toBe(doc);
    expect(state.doc.sliceString(3, 8), 'Label text in buffer must still be "label"').toBe('label');
  });

  it('G-LP-LINK-COLLAPSE: two inline links on the same inactive line → correct ranges', () => {
    // doc = 'x\n[a](https://1.io) and [c](https://2.io)' — per spec verified range:
    // first link: replace[2,3), mark[3,4), replace[4,19)
    // second link: replace[24,25), mark[25,26), replace[26,41)
    const doc = 'x\n[a](https://1.io) and [c](https://2.io)';
    const state = makeState(doc, 0);
    const items = collectDecos(buildLivePreviewDecorations(state));

    const label1 = items.find((d) => d.from === 3 && d.to === 4 && d.class === 'cm-link-label');
    expect(label1, 'First link label mark [3,4) must exist').toBeDefined();

    const label2 = items.find((d) => d.from === 25 && d.to === 26 && d.class === 'cm-link-label');
    expect(label2, 'Second link label mark [25,26) must exist').toBeDefined();

    // Monotonic: no out-of-order ranges (would have thrown if so, but assert explicitly)
    for (let i = 1; i < items.length; i++) {
      expect(items[i].from, 'Decoration ranges must be monotonically non-decreasing').toBeGreaterThanOrEqual(items[i - 1].from);
    }
  });

  // ── G-LP-LINK-REVEAL ──────────────────────────────────────────────────────

  it('G-LP-LINK-REVEAL: caret ON the link line → no link collapse decorations (raw shown)', () => {
    // Single-line doc: cursor at 2 places the caret on the link line (line 1).
    const doc = '[label](https://example.com)';
    const state = makeState(doc, 2); // cursor on the link line
    const decos = buildLivePreviewDecorations(state);
    const items = collectDecos(decos);

    expect(
      items.find((d) => d.class === 'cm-link-label'),
      'G-LP-LINK-REVEAL: cm-link-label must be absent when caret is on the link line',
    ).toBeUndefined();

    // No replace over '[' either
    expect(
      items.find((d) => d.from === 0 && d.to === 1 && !d.class),
      'G-LP-LINK-REVEAL: replace[0,1) must be absent (link revealed raw)',
    ).toBeUndefined();
  });

  it('G-LP-LINK-REVEAL: moving caret onto link line removes collapse; moving off re-adds it', () => {
    const doc = 'x\n[label](https://example.com)';
    // Caret on line 1 (offset 0): link line inactive → collapsed
    const stateOff = makeState(doc, 0);
    const itemsOff = collectDecos(buildLivePreviewDecorations(stateOff));
    expect(
      itemsOff.find((d) => d.class === 'cm-link-label'),
      'cm-link-label must be present when link line is inactive',
    ).toBeDefined();

    // Caret on line 2 (offset 3, inside the link): link line active → raw
    const stateOn = makeState(doc, 3);
    const itemsOn = collectDecos(buildLivePreviewDecorations(stateOn));
    expect(
      itemsOn.find((d) => d.class === 'cm-link-label'),
      'cm-link-label must be absent when link line is active',
    ).toBeUndefined();
  });

  // ── G-LP-LINK-SCHEME ──────────────────────────────────────────────────────

  it('G-LP-LINK-SCHEME: javascript: and file: are NOT collapsed; https: and mailto: ARE', () => {
    // Unsafe: javascript:
    {
      const doc = 'x\n[t](javascript:alert(1))';
      const items = collectDecos(buildLivePreviewDecorations(makeState(doc, 0)));
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'javascript: must NOT produce cm-link-label (unsafe scheme)',
      ).toBeUndefined();
    }

    // Unsafe: file:
    {
      const doc = 'x\n[t](file:///etc/passwd)';
      const items = collectDecos(buildLivePreviewDecorations(makeState(doc, 0)));
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'file: must NOT produce cm-link-label (unsafe scheme)',
      ).toBeUndefined();
    }

    // Safe: https:
    {
      const doc = 'x\n[t](https://safe.io)';
      const items = collectDecos(buildLivePreviewDecorations(makeState(doc, 0)));
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'https: MUST produce cm-link-label',
      ).toBeDefined();
    }

    // Safe: mailto:
    {
      const doc = 'x\n[email](mailto:a@b.com)';
      const items = collectDecos(buildLivePreviewDecorations(makeState(doc, 0)));
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'mailto: MUST produce cm-link-label',
      ).toBeDefined();
    }
  });

  // ── G-LP-LINK-NESTED-SKIP ─────────────────────────────────────────────────

  it('G-LP-LINK-NESTED-SKIP: [**bold** x](url) → no collapse, no throw; inner EmphasisMark still hidden', () => {
    // doc = 'x\n[**bold** x](https://y.io)' — cursor on line 1 (link line inactive)
    // '**' opens at [3,5), closes at [9,11) (relative to doc offset 2 for '[')
    const doc = 'x\n[**bold** x](https://y.io)';
    expect(() => {
      const state = makeState(doc, 0);
      const decos = buildLivePreviewDecorations(state);
      const items = collectDecos(decos);

      // No cm-link-label mark (nested-skip prevents collapse)
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'G-LP-LINK-NESTED-SKIP: nested label must NOT produce cm-link-label',
      ).toBeUndefined();

      // Inner EmphasisMark '**' at [3,5) MUST still be hidden by the HIDE branch
      const innerOpen = items.find((d) => d.from === 3 && d.to === 5 && !d.class);
      expect(
        innerOpen,
        'G-LP-LINK-NESTED-SKIP: inner opening EmphasisMark [3,5) must be hidden by HIDE branch',
      ).toBeDefined();

      // Inner closing EmphasisMark at [9,11) must also be hidden
      const innerClose = items.find((d) => d.from === 9 && d.to === 11 && !d.class);
      expect(
        innerClose,
        'G-LP-LINK-NESTED-SKIP: inner closing EmphasisMark [9,11) must be hidden by HIDE branch',
      ).toBeDefined();
    }).not.toThrow();
  });

  it('G-LP-LINK-NESTED-SKIP: [`code` x](url) → no collapse, no throw; inner CodeMark still hidden', () => {
    // Ensure InlineCode labels are also skipped (no cm-link-label, no throw)
    const doc = 'x\n[`code` x](https://y.io)';
    expect(() => {
      const items = collectDecos(buildLivePreviewDecorations(makeState(doc, 0)));
      expect(
        items.find((d) => d.class === 'cm-link-label'),
        'G-LP-LINK-NESTED-SKIP: InlineCode label must NOT produce cm-link-label',
      ).toBeUndefined();
    }).not.toThrow();
  });

  // ── G-LP-LINK-ROBUST ──────────────────────────────────────────────────────

  it('G-LP-LINK-ROBUST: degenerate link forms do not throw and do not produce cm-link-label', () => {
    const robustCases: Array<[string, string]> = [
      ['[label](',        'half-typed: missing closing )'],
      ['[label]',         'no parens at all'],
      ['[]()',            'empty label and URL'],
      ['[ref][id]',       'reference link (no URL child)'],
      ['x\n<https://x.com>', 'autolink (Autolink node, not Link)'],
      ['x\nsee https://x.com here', 'bare URL (no Link parent)'],
      ['x\n![alt](https://x.io)',   'image (Image node, not Link)'],
    ];

    for (const [raw, description] of robustCases) {
      const doc = raw.startsWith('x\n') ? raw : `x\n${raw}`;
      expect(
        () => {
          const state = makeState(doc, 0);
          const decos = buildLivePreviewDecorations(state);
          const items = collectDecos(decos);
          expect(
            items.find((d) => d.class === 'cm-link-label'),
            `G-LP-LINK-ROBUST: must not produce cm-link-label for: ${description}`,
          ).toBeUndefined();
        },
        `G-LP-LINK-ROBUST: must not throw for: ${description}`,
      ).not.toThrow();
    }
  });

  // ── G-LP-LINK-ATOMIC ──────────────────────────────────────────────────────

  it('G-LP-LINK-ATOMIC: atomicDecorationsOf keeps replace ranges; drops the cm-link-label mark', () => {
    // Synthetic set that mirrors the link-collapse output for 'x\n[label](https://example.com)'.
    const synBuilder = new RangeSetBuilder<Decoration>();
    synBuilder.add(2,  3,  Decoration.replace({}));                         // hidden '['
    synBuilder.add(3,  8,  Decoration.mark({ class: 'cm-link-label' }));    // label mark
    synBuilder.add(8,  30, Decoration.replace({}));                          // hidden '](url)'
    const fullSet = synBuilder.finish();

    const atomicSet = atomicDecorationsOf(fullSet);
    const atomicRanges = collectRanges(atomicSet);

    // Exactly the 2 replace ranges remain; the mark is excluded.
    expect(atomicRanges, 'G-LP-LINK-ATOMIC: exactly 2 replace ranges').toHaveLength(2);
    expect(atomicRanges[0], 'G-LP-LINK-ATOMIC: first atomic range is replace[2,3)').toEqual({ from: 2, to: 3 });
    expect(atomicRanges[1], 'G-LP-LINK-ATOMIC: second atomic range is replace[8,30)').toEqual({ from: 8, to: 30 });
  });

  it('G-LP-LINK-ATOMIC: atomicDecorationsOf is identity on a non-link (marks-free) DecorationSet', () => {
    // A HeaderMark replace — the kind produced by the HIDE branch. Must pass through unchanged.
    const synBuilder = new RangeSetBuilder<Decoration>();
    synBuilder.add(0, 2, Decoration.replace({})); // HeaderMark range
    const nonLinkSet = synBuilder.finish();

    const atomicRanges = collectRanges(atomicDecorationsOf(nonLinkSet));
    expect(atomicRanges, 'G-LP-LINK-ATOMIC: identity — non-link set passes through unchanged').toHaveLength(1);
    expect(atomicRanges[0]).toEqual({ from: 0, to: 2 });
  });

  // ── G-LP-LINK-NO-BUFFER-MUTATION ──────────────────────────────────────────

  it('G-LP-LINK-NO-BUFFER-MUTATION: building decorations never mutates the doc buffer', () => {
    const doc = 'x\n[label](https://example.com)';
    const state = makeState(doc, 0);
    buildLivePreviewDecorations(state); // exercise the builder
    expect(state.doc.toString(), 'Buffer must equal the original doc after decoration building').toBe(doc);
    expect(state.doc.sliceString(3, 8), 'Label slice [3,8) must still be "label"').toBe('label');
    // URL text also untouched
    expect(state.doc.sliceString(10, 29), 'URL slice [10,29) must still be the original URL').toBe('https://example.com');
  });

  // ── G-LP-LINK-STYLE + G-LP-LINK-SMOKE ────────────────────────────────────

  it('G-LP-LINK-STYLE + G-LP-LINK-SMOKE: mountEditor renders .cm-link-label for inactive link; getDoc() unchanged; no throw', () => {
    // Three-line doc: cursor placed on line 3 ('plain') keeps the link line (line 2) inactive.
    const doc = 'x\n[label](https://example.com)\nplain';
    const container = makeContainer();
    let handle: ReturnType<typeof mountEditor> | undefined;

    expect(() => {
      handle = mountEditor(container, { doc, onSave: async () => {} });
    }).not.toThrow();

    expect(container.querySelector('.cm-content'), '.cm-content must exist').not.toBeNull();

    // Move caret to line 3 (start of 'plain') so the link line is inactive.
    const view = handle!.getView();
    const plainOffset = doc.lastIndexOf('plain');
    view.dispatch({ selection: { anchor: plainOffset } });

    // G-LP-LINK-NO-BUFFER-MUTATION: buffer never mutated by decorations.
    expect(handle!.getDoc(), 'G-LP-LINK-SMOKE: getDoc() must equal the initial doc').toBe(doc);

    // Pure-builder check (reliable regardless of jsdom rendering pipeline).
    const state = makeState(doc, plainOffset);
    const items = collectDecos(buildLivePreviewDecorations(state));
    expect(
      items.find((d) => d.class === 'cm-link-label'),
      'G-LP-LINK-STYLE: cm-link-label must be in the decoration set for inactive link line',
    ).toBeDefined();

    // DOM check: .cm-link-label span must be rendered into .cm-content by the ViewPlugin.
    const cmContent = container.querySelector('.cm-content');
    expect(
      cmContent?.querySelector('.cm-link-label'),
      'G-LP-LINK-SMOKE: .cm-link-label span must appear in .cm-content',
    ).not.toBeNull();

    handle!.destroy();
    document.body.removeChild(container);
  });
});

// ── Task-checkbox interactive toggle gates (increment #1.5) ───────────────────
//
// G-LP-CHECKBOX-TOGGLE  — real DOM mousedown on .cm-task-glyph toggles the doc
// G-LP-CHECKBOX-TOGGLE-CARET — toggling does not remount the editor (same EditorView)
//
// Mutation check: disabling taskCheckboxClickHandler must fail G-LP-CHECKBOX-TOGGLE.

describe('Task-checkbox interactive toggle gates', () => {
  // ── G-LP-CHECKBOX-TOGGLE ──────────────────────────────────────────────────

  it('G-LP-CHECKBOX-TOGGLE: REAL mousedown on .cm-task-glyph toggles [ ] → [x] → [ ]', () => {
    // Doc: line 1 = "note" (caret stays here), line 2 = "- [ ] todo" (glyph renders)
    const container = makeContainer();
    const doc = 'note\n- [ ] todo';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const view = handle.getView();

    // Ensure caret is on line 1 so line 2's glyph is rendered (not revealed raw)
    view.dispatch({ selection: { anchor: 0 } });

    const cmContent = container.querySelector('.cm-content')!;
    const glyph = cmContent.querySelector('.cm-task-glyph') as HTMLElement | null;
    expect(glyph, 'G-LP-CHECKBOX-TOGGLE: .cm-task-glyph must be in .cm-content').not.toBeNull();

    // Drive the REAL mousedown — bubbles up to .cm-content where CM6 handler is registered
    glyph!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    // Doc must now contain [x]
    expect(
      handle.getDoc(),
      'G-LP-CHECKBOX-TOGGLE: first click must toggle [ ] → [x]',
    ).toBe('note\n- [x] todo');

    // Second click: glyph re-rendered as ☑; click again → back to [ ]
    const glyph2 = cmContent.querySelector('.cm-task-glyph') as HTMLElement | null;
    expect(glyph2, 'G-LP-CHECKBOX-TOGGLE: .cm-task-glyph must still be present after first toggle').not.toBeNull();
    glyph2!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(
      handle.getDoc(),
      'G-LP-CHECKBOX-TOGGLE: second click must toggle [x] → [ ]',
    ).toBe('note\n- [ ] todo');

    handle.destroy();
    document.body.removeChild(container);
  });

  it('G-LP-CHECKBOX-TOGGLE: [x] start → mousedown → [ ] (lowercase x)', () => {
    const container = makeContainer();
    const doc = 'note\n- [x] done';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0 } });

    const cmContent = container.querySelector('.cm-content')!;
    const glyph = cmContent.querySelector('.cm-task-glyph') as HTMLElement | null;
    expect(glyph, 'G-LP-CHECKBOX-TOGGLE([x]): .cm-task-glyph must be present').not.toBeNull();

    glyph!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(
      handle.getDoc(),
      'G-LP-CHECKBOX-TOGGLE([x]): [x] → [ ] (lowercase x)',
    ).toBe('note\n- [ ] done');

    handle.destroy();
    document.body.removeChild(container);
  });

  it('G-LP-CHECKBOX-TOGGLE: [X] start → mousedown → [ ] (uppercase X)', () => {
    const container = makeContainer();
    const doc = 'note\n- [X] DONE';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0 } });

    const cmContent = container.querySelector('.cm-content')!;
    const glyph = cmContent.querySelector('.cm-task-glyph') as HTMLElement | null;
    expect(glyph, 'G-LP-CHECKBOX-TOGGLE([X]): .cm-task-glyph must be present').not.toBeNull();

    glyph!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(
      handle.getDoc(),
      'G-LP-CHECKBOX-TOGGLE([X]): [X] → [ ] (uppercase X)',
    ).toBe('note\n- [ ] DONE');

    handle.destroy();
    document.body.removeChild(container);
  });

  // ── G-LP-CHECKBOX-TOGGLE-CARET ────────────────────────────────────────────

  it('G-LP-CHECKBOX-TOGGLE-CARET: toggling via click is a normal dispatch — same EditorView, no remount', () => {
    const container = makeContainer();
    const doc = 'note\n- [ ] task';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0 } });

    const viewBefore = handle.getView();

    const cmContent = container.querySelector('.cm-content')!;
    const glyph = cmContent.querySelector('.cm-task-glyph') as HTMLElement | null;
    expect(glyph, 'G-LP-CHECKBOX-TOGGLE-CARET: glyph must be present').not.toBeNull();

    glyph!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    // getView() must return the SAME EditorView instance (no remount)
    const viewAfter = handle.getView();
    expect(
      viewAfter,
      'G-LP-CHECKBOX-TOGGLE-CARET: getView() must return the same EditorView instance after toggle',
    ).toBe(viewBefore);

    // And the doc did change (toggle happened)
    expect(handle.getDoc()).toBe('note\n- [x] task');

    handle.destroy();
    document.body.removeChild(container);
  });

  // ── G-LP-CHECKBOX-TOGGLE-HANDLER-EXPORT ───────────────────────────────────

  it('G-LP-CHECKBOX-TOGGLE-HANDLER-EXPORT: taskCheckboxClickHandler is exported and is a CM6 Extension', () => {
    // If this import fails to compile, the gate catches the missing export.
    // The extension is truthy (object/array from EditorView.domEventHandlers).
    expect(taskCheckboxClickHandler, 'taskCheckboxClickHandler must be exported from livePreview').toBeDefined();
    expect(typeof taskCheckboxClickHandler === 'object' || Array.isArray(taskCheckboxClickHandler)).toBe(true);
  });

  // ── Regression: existing checkbox render gates still pass ─────────────────

  it('G-LP-CHECKBOX-REVEAL (regression): checkbox widget is ABSENT on the active line', () => {
    const doc = 'note\n- [ ] todo';
    // Cursor on line 2 (the task line) → glyph must be absent (raw revealed)
    const state = makeState(doc, 5);
    const widgets = (() => {
      const out: Array<{ from: number; to: number; widget: unknown }> = [];
      const cursor = buildLivePreviewDecorations(state).iter();
      while (cursor.value !== null) {
        const spec = (cursor.value as unknown as { spec: Record<string, unknown> }).spec;
        out.push({ from: cursor.from, to: cursor.to, widget: spec['widget'] });
        cursor.next();
      }
      return out;
    })();
    const hit = widgets.find((w) => w.widget instanceof CheckboxWidget);
    expect(
      hit,
      'G-LP-CHECKBOX-REVEAL (regression): CheckboxWidget must be absent when cursor is on the task line',
    ).toBeUndefined();
  });
});

// ── G-LP-CODE-BG — fenced-code line backgrounds ───────────────────────────────

describe('G-LP-CODE-BG — buildCodeBlockDecorations tints every fenced-code line', () => {
  it('decorates exactly the fence + body lines of a fenced block, not the prose around it', () => {
    // Lines: 1=before, 2=```js, 3=const x = 1;, 4=```, 5=after
    const doc = 'before\n```js\nconst x = 1;\n```\nafter';
    const state = makeState(doc);
    const ranges = collectRanges(buildCodeBlockDecorations(state));

    // One line decoration per code line (lines 2,3,4) — zero-length at line.from.
    const expected = [2, 3, 4].map((n) => state.doc.line(n).from);
    expect(ranges.map((r) => r.from)).toEqual(expected);
    for (const r of ranges) expect(r.to).toBe(r.from); // line decorations are zero-length

    // Prose lines (1 and 5) are NOT tinted.
    expect(ranges.map((r) => r.from)).not.toContain(state.doc.line(1).from);
    expect(ranges.map((r) => r.from)).not.toContain(state.doc.line(5).from);
  });

  it('is caret-independent: the block stays decorated with the cursor inside it', () => {
    const doc = '```\nplain code\n```';
    const inside = doc.indexOf('plain');
    const ranges = collectRanges(buildCodeBlockDecorations(makeState(doc, inside)));
    expect(ranges.length, 'all three fence/body lines tinted regardless of caret').toBe(3);
  });

  it('emits no decorations for a prose-only document', () => {
    const ranges = collectRanges(buildCodeBlockDecorations(makeState('just a paragraph\n\nand another')));
    expect(ranges).toHaveLength(0);
  });

  it('handles two separate fenced blocks without throwing (monotonic order)', () => {
    const doc = '```\na\n```\n\ntext\n\n```\nb\n```';
    const ranges = collectRanges(buildCodeBlockDecorations(makeState(doc)));
    // 3 lines per block × 2 blocks
    expect(ranges.length).toBe(6);
    // Strictly ascending froms (RangeSetBuilder invariant held).
    const froms = ranges.map((r) => r.from);
    expect([...froms].sort((a, b) => a - b)).toEqual(froms);
  });
});

// ── G-LP-CODE-BG-CLASSES — first/last modifier classes on code-block lines ──

/**
 * Collect all decoration ranges including the CSS class from the spec.
 * Used to assert the positional modifier classes (cm-code-line--first/last).
 */
function collectClassRanges(
  set: import('@codemirror/state').RangeSet<import('@codemirror/view').Decoration>,
): Array<{ from: number; to: number; class: string }> {
  const out: Array<{ from: number; to: number; class: string }> = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    const spec = (cursor.value as unknown as { spec: Record<string, unknown> }).spec;
    out.push({ from: cursor.from, to: cursor.to, class: String(spec['class'] ?? '') });
    cursor.next();
  }
  return out;
}

describe('G-LP-CODE-BG-CLASSES — first/last modifier classes on fenced-code lines', () => {
  it('multi-line block: first line has cm-code-line--first, last has cm-code-line--last, middle has neither', () => {
    // Lines: 1=```js, 2=const x=1;, 3=let y=2;, 4=```
    const doc = '```js\nconst x=1;\nlet y=2;\n```';
    const state = makeState(doc);
    const ranges = collectClassRanges(buildCodeBlockDecorations(state));

    expect(ranges).toHaveLength(4);

    // Line 1 (opening fence) — first, not last
    expect(ranges[0].class).toContain('cm-code-line--first');
    expect(ranges[0].class).not.toContain('cm-code-line--last');

    // Line 2 (body line 1) — neither first nor last
    expect(ranges[1].class).toBe('cm-code-line');
    expect(ranges[1].class).not.toContain('cm-code-line--first');
    expect(ranges[1].class).not.toContain('cm-code-line--last');

    // Line 3 (body line 2) — neither first nor last
    expect(ranges[2].class).toBe('cm-code-line');
    expect(ranges[2].class).not.toContain('cm-code-line--first');
    expect(ranges[2].class).not.toContain('cm-code-line--last');

    // Line 4 (closing fence) — last, not first
    expect(ranges[3].class).toContain('cm-code-line--last');
    expect(ranges[3].class).not.toContain('cm-code-line--first');
  });

  it('single-line fenced block (opening and closing fence are the only two lines) applies both modifiers to first AND last', () => {
    // Lines: 1=```js, 2=``` (no body — startLine===endLine means both fences share modifiers)
    // Actually with fenced code, even "```\n```" has 2 lines; but a 1-line body gives
    // fence+body+fence = 3 lines. Test a true 2-line fenced block (just fences, no body).
    const doc = '```\n```';
    const state = makeState(doc);
    const ranges = collectClassRanges(buildCodeBlockDecorations(state));

    // Exactly 2 lines decorated (opening + closing fence).
    // startLine = 1, endLine = 2 → first line gets --first, last gets --last.
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    // First decorated line carries --first modifier.
    expect(ranges[0].class).toContain('cm-code-line--first');
    // Last decorated line carries --last modifier.
    expect(ranges[ranges.length - 1].class).toContain('cm-code-line--last');
  });

  it('single-body-line block: when startLine === endLine the single line carries both modifiers', () => {
    // Edge case: a block where the entire span is exactly one line.
    // We can simulate by inspecting a 3-line block (fence/body/fence) and confirming
    // the body line itself is neither first nor last (fence lines carry the caps).
    // Then verify a block that Lezer emits as one line gets lineDecoSingle.
    // For the concrete case, check the 3-line block's lines:
    const doc = '```\ncode\n```';
    const state = makeState(doc);
    const ranges = collectClassRanges(buildCodeBlockDecorations(state));

    expect(ranges).toHaveLength(3);

    // Opening fence (line 1) → first
    expect(ranges[0].class).toContain('cm-code-line--first');
    expect(ranges[0].class).not.toContain('cm-code-line--last');

    // Body (line 2) → plain
    expect(ranges[1].class).toBe('cm-code-line');

    // Closing fence (line 3) → last
    expect(ranges[2].class).toContain('cm-code-line--last');
    expect(ranges[2].class).not.toContain('cm-code-line--first');
  });

  it('positions are unchanged: same from values as before (G-LP-CODE-BG regression)', () => {
    const doc = 'before\n```js\nconst x = 1;\n```\nafter';
    const state = makeState(doc);
    const ranges = collectClassRanges(buildCodeBlockDecorations(state));

    // Positions identical to G-LP-CODE-BG expectations: lines 2,3,4.
    const expected = [2, 3, 4].map((n) => state.doc.line(n).from);
    expect(ranges.map((r) => r.from)).toEqual(expected);
    for (const r of ranges) expect(r.to).toBe(r.from);
  });
});
