/**
 * lib/notes/livePreview.ts — CM6 inline live-preview decoration layer.
 *
 * Obsidian "Live Preview" behaviour: markdown markers (HeaderMark, EmphasisMark,
 * StrikethroughMark, CodeMark) are hidden via Decoration.replace({}) on every
 * line the cursor/selection does NOT touch; the active line(s) are revealed raw
 * for editing. The on-disk source is NEVER mutated — this is a pure decoration
 * layer over the same text buffer.
 *
 * Imports: ONLY @codemirror/* and @lezer/* — G-CHOKEPOINT enforced.
 * No markdown-it, no dompurify, no innerHTML.
 */

import { type EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// ── Exported constants ────────────────────────────────────────────────────────

/**
 * The lezer node names whose text ranges are hidden (replaced with an empty
 * atomic decoration) when the containing line is not active.
 *
 * Size MUST remain 4 — ListMark is handled in the widget branch below and is
 * intentionally NOT added here (G-LP-HIDE_MARK_NODES-SIZE-4 gate).
 */
export const HIDE_MARK_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
]);

/**
 * Scheme allow-list for link collapse (D-SCHEME / R1).
 * Mirrors markdown.ts:42 ALLOWED_URI_REGEXP — deliberately NOT imported from
 * there because markdown.ts pulls markdown-it + dompurify (G-CHOKEPOINT).
 * Only http/https/mailto links are collapsed; javascript:/file:/data:/relative
 * links stay raw so the #2.5 clickable-open seam is safe by construction.
 */
const SAFE_LINK_SCHEME = /^(?:https?|mailto):/i;

// ── Widget classes ────────────────────────────────────────────────────────────

/**
 * BulletWidget — renders an unordered-list marker (-, *, +) as a "•" glyph
 * when the containing line is not active. The raw marker is never mutated —
 * this is a pure decoration.
 *
 * DOM built with createElement/textContent ONLY — no innerHTML (G-CHOKEPOINT).
 */
export class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-bullet-glyph';
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * CheckboxWidget — renders a GFM task-list marker ([ ]/[x]/[X]) as ☐ or ☑.
 * Covers the whole "- [ ]" range (ListMark.from → TaskMarker.to) so there is
 * never a "• ☐" double — exactly ONE glyph per task item.
 *
 * eq() compares .checked so a [ ]↔[x] edit rebuilds the glyph correctly.
 * DOM built with createElement/textContent ONLY — no innerHTML (G-CHOKEPOINT).
 */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-task-glyph' + (this.checked ? ' cm-task-glyph--checked' : '');
    span.textContent = this.checked ? '☑' : '☐';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  eq(other: WidgetType): boolean {
    return other instanceof CheckboxWidget && other.checked === this.checked;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ── Core pure function ────────────────────────────────────────────────────────

/**
 * buildLivePreviewDecorations — pure, state-testable decoration builder.
 *
 * @param state   - Current EditorState (provides doc + selection + syntax tree).
 * @param ranges  - Optional viewport ranges to iterate (default: full doc).
 * @returns       A DecorationSet of Decoration.replace({}) over every hidden
 *                marker range. Active-line markers are absent from the set.
 *
 * Never throws — partial / unterminated markdown has no completed parent node
 * in the tree and is simply left raw (no decoration emitted).
 */
export function buildLivePreviewDecorations(
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
  const replaceDecoration = Decoration.replace({});

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to:   range.to,
      enter(node) {
        // ── Link-collapse branch: [label](url) on inactive lines ──────────────
        // Hides the link syntax and styles the label text as a link.
        // Spec: 2026-06-28-jin-notes-lp-links.yaml stories LPK-1/LPK-2.
        if (node.name === 'Link') {
          const lineNo = state.doc.lineAt(node.from).number;
          if (activeLines.has(lineNo)) return; // D-REVEAL: show raw on active line

          const n = node.node; // materialize SyntaxNode

          // Collect LinkMark children and URL child; detect nested markup (D-NESTED).
          // The label is NOT a node — computed as [open.to, closeB.from).
          const linkMarks: Array<{ from: number; to: number }> = [];
          let urlNode: { from: number; to: number } | null = null;
          let hasNested = false;

          let child = n.firstChild;
          while (child) {
            if (child.name === 'LinkMark') {
              linkMarks.push(child);
            } else if (child.name === 'URL') {
              urlNode = child;
            } else if (child.name !== 'LinkTitle') {
              // Any child name ∉ {LinkMark, URL, LinkTitle} ⇒ nested markup (R2).
              hasNested = true;
            }
            child = child.nextSibling;
          }

          // Guards (D-COLLAPSE-RULE): need a URL, >=4 LinkMarks, no nested markup.
          // Return void (not false) so the HIDE branch still sees any inner marks.
          if (!urlNode || linkMarks.length < 4 || hasNested) return;

          const open  = linkMarks[0]; // LinkMark '[' (first child)
          const closeB = linkMarks[1]; // LinkMark ']' (second child)
          const lf = open.to;          // label from (char after '[')
          const lt = closeB.from;      // label to (char before ']')

          if (lt <= lf) return; // empty label — degrade to raw

          // Scheme guard (R1 / D-SCHEME) — local const to avoid markdown.ts import.
          const urlText = state.doc.sliceString(urlNode.from, urlNode.to);
          if (!SAFE_LINK_SCHEME.test(urlText)) return; // unsafe scheme → raw

          // Emit 3 decorations in strictly ascending from-order (critical for
          // RangeSetBuilder — any out-of-order add throws).
          builder.add(node.from, open.to, Decoration.replace({}));           // hide '['
          builder.add(lf, lt, Decoration.mark({ class: 'cm-link-label' })); // style label
          builder.add(closeB.from, node.to, Decoration.replace({}));         // hide '](url)'

          return false; // skip children: link syntax fully handled by the 3 decorations
        }

        // ── ListMark branch: widget-replace (NOT in HIDE_MARK_NODES) ──────────
        // Handles BulletList markers as "•" glyphs and GFM task markers as ☐/☑.
        // Ordered-list numbers and active-line markers are always left raw.
        if (node.name === 'ListMark') {
          const lineNo = state.doc.lineAt(node.from).number;
          if (activeLines.has(lineNo)) return; // D-REVEAL: show raw on active line

          const n = node.node; // materialize SyntaxNode
          const listItem = n.parent;
          const list = listItem?.parent;

          if (list?.name === 'OrderedList') return; // ordered numbers — untouched
          if (list?.name !== 'BulletList') return;   // defensive: bullet lists only

          const task = listItem!.getChild('Task');
          if (task) {
            // Task item: ONE checkbox widget over [ListMark.from, TaskMarker.to).
            // This SUBSUMES the bullet — never "• ☐" (G-LP-NO-DOUBLE-BULLET).
            const taskMarker = task.getChild('TaskMarker');
            if (!taskMarker) return; // half-typed: degrade to plain bullet
            const checked = /^\[[xX]\]$/.test(
              state.doc.sliceString(taskMarker.from, taskMarker.to),
            );
            builder.add(
              node.from,
              taskMarker.to,
              Decoration.replace({ widget: new CheckboxWidget(checked) }),
            );
            return;
          }

          // Plain unordered bullet: "•" glyph over the 1-char ListMark only.
          builder.add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
          return;
        }

        // ── QuoteMark branch: blockquote bar + > hide (NOT in HIDE_MARK_NODES) ─
        // Emits a Decoration.line (left bar via CSS) on EVERY blockquote line
        // unconditionally, and hides the '>' marker via Decoration.replace({}) on
        // inactive lines only (bar persists on the active line — D-QUOTE-BAR-ACTIVE).
        // Spec: 2026-06-28-jin-notes-lp-blockquote.yaml stories LPQ-1/LPQ-2.
        //
        // ORDERING: Decoration.line startSide=-2e8 < Decoration.replace startSide~5e8.
        // QuoteMark is the leading token of its line (lezer-verified), so line.from is
        // the smallest `from` on this line. Emitting line@line.from FIRST, then the
        // QuoteMark replace, keeps the shared RangeSetBuilder monotonic with no
        // collect-and-sort (D-QUOTE-ORDER / R1).
        if (node.name === 'QuoteMark') {
          const line = state.doc.lineAt(node.from);
          const lineNo = line.number;
          // D-QUOTE-LINE-START-GUARD: only emit the line decoration when this
          // QuoteMark is the first character of the line. This gives exactly one
          // bar per top-level quote line and prevents a throw for nested '>>'
          // (the inner QuoteMark is not at line.from) and list-wrapped quotes
          // '- > q' where the QuoteMark is mid-line (D-QUOTE-NESTED / R2).
          if (node.from === line.from) {
            builder.add(line.from, line.from, Decoration.line({ class: 'cm-blockquote-line' }));
          }
          // D-QUOTE-BAR-ACTIVE: bar already added; skip the '>' hide on the active
          // line so the raw '>' is revealed for editing while the bar persists.
          if (activeLines.has(lineNo)) return;
          // D-QUOTE-TRAILING-SPACE: eat one trailing space (mirrors HeaderMark rule
          // at :236-240) so '> ' disappears fully. Conditional: never eats '\n'
          // (CM6 plugin constraint — replace must not cross a line break).
          let markTo = node.to;
          if (state.doc.sliceString(markTo, markTo + 1) === ' ') markTo += 1;
          builder.add(node.from, markTo, Decoration.replace({}));
          return; // QuoteMark fully handled; do not fall through to HIDE_MARK_NODES
        }

        // ── Existing HIDE_MARK_NODES branch (unchanged) ───────────────────────
        if (!HIDE_MARK_NODES.has(node.name)) return;
        const lineNo = state.doc.lineAt(node.from).number;
        if (activeLines.has(lineNo)) return; // revealed — skip

        let markTo = node.to;
        // K-LP-3: HeaderMark trailing-space eat — eat one space so "# " hides fully
        // and heading text goes flush-left.
        if (node.name === 'HeaderMark' && state.doc.sliceString(markTo, markTo + 1) === ' ') {
          markTo += 1;
        }
        builder.add(node.from, markTo, replaceDecoration);
      },
    });
  }

  return builder.finish();
}

// ── Fenced-code background ──────────────────────────────────────────────────────

/**
 * buildCodeBlockDecorations — line-background decorations for fenced/indented code.
 *
 * Adds Decoration.line({ class: 'cm-code-line' }) to every line inside a FencedCode
 * (or indented CodeBlock) node so the editor can tint the block and stop code from
 * blending into the surrounding prose (D-CODE-BG). Pure + position-only; unlike the
 * marker-hiding builder there is NO active-line logic — the tint is always on, so a
 * code block keeps its background even while the caret is inside it.
 *
 * Separate from buildLivePreviewDecorations (and its own RangeSetBuilder) on purpose:
 * this set contains ONLY line decorations, so it stays trivially monotonic and never
 * interleaves with the replace/mark ranges the live-preview builder emits.
 */
// Memoized decoration variants for the four positional cases of a code-block
// line. Built once outside the function so repeated calls share the same objects.
const lineDecoBase = Decoration.line({ class: 'cm-code-line' });
const lineDecoFirst = Decoration.line({ class: 'cm-code-line cm-code-line--first' });
const lineDecoLast = Decoration.line({ class: 'cm-code-line cm-code-line--last' });
const lineDecoSingle = Decoration.line({ class: 'cm-code-line cm-code-line--first cm-code-line--last' });

export function buildCodeBlockDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;

        const startLine = state.doc.lineAt(node.from).number;
        // node.to can sit at the start of the line AFTER the closing fence; clamp
        // with (node.to - 1) so we never tint the following prose line.
        const endLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let ln = startLine; ln <= endLine; ln++) {
          const line = state.doc.line(ln);
          const isFirst = ln === startLine;
          const isLast = ln === endLine;
          let deco: Decoration;
          if (isFirst && isLast) deco = lineDecoSingle;
          else if (isFirst) deco = lineDecoFirst;
          else if (isLast) deco = lineDecoLast;
          else deco = lineDecoBase;
          builder.add(line.from, line.from, deco);
        }
        return false; // children (CodeMark/CodeInfo/CodeText) need no per-line bg
      },
    });
  }

  return builder.finish();
}

/**
 * jinCodeBlockBackground() — CM6 Extension that tints fenced/indented code lines.
 * Rebuilds on docChanged | viewportChanged (no selection dependency — the tint is
 * caret-independent). Always-on; not compartmented.
 */
export function jinCodeBlockBackground() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildCodeBlockDecorations(view.state, view.visibleRanges);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildCodeBlockDecorations(update.view.state, update.view.visibleRanges);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// ── Atomic projection ─────────────────────────────────────────────────────────

/**
 * atomicDecorationsOf — pure projection that filters a DecorationSet to only
 * replace/widget decorations, dropping mark decorations.
 *
 * Mark decorations have `spec.class` truthy and no `spec.widget`. They must
 * NOT be atomic so the cm-link-label text stays normally selectable/clickable
 * (D-ATOMIC). Replace/widget decorations (hidden link syntax, bullet/checkbox
 * glyphs) remain atomic to prevent the caret from becoming trapped inside a
 * hidden range.
 *
 * This is identity for non-link docs (all existing decorations are
 * replace/widget) — regression-safe. Exported for unit testing (G-LP-LINK-ATOMIC).
 */
export function atomicDecorationsOf(set: DecorationSet): DecorationSet {
  const out = new RangeSetBuilder<Decoration>();
  const cursor = set.iter();
  while (cursor.value !== null) {
    const spec = (cursor.value as unknown as { spec: Record<string, unknown> }).spec;
    // Drop mark decorations (spec.class truthy, no spec.widget); keep all others.
    if (!spec['class'] || spec['widget']) {
      out.add(cursor.from, cursor.to, cursor.value);
    }
    cursor.next();
  }
  return out.finish();
}

// ── Task-checkbox click handler ───────────────────────────────────────────────

/**
 * taskCheckboxClickHandler — CM6 extension that toggles GFM task-list checkboxes
 * on `mousedown` without moving the caret or re-mounting the editor.
 *
 * Intercepts `mousedown` on `.cm-task-glyph` elements (rendered by CheckboxWidget
 * on inactive task lines). Resolves the clicked line via `view.posAtDOM`, which
 * returns the widget's start position (ListMark.from) — always on the task line.
 * `doc.lineAt(pos)` corrects any imprecision to the exact line object. The task-
 * marker regex then finds the bracket-state character's absolute position, and a
 * single-character replacement toggles `' '` ↔ `'x'`.
 *
 * This is a normal doc change → triggers the existing debounced autosave and
 * rebuilds live-preview decorations so the glyph flips ☐ ↔ ☑. Caret-safe
 * (does not touch the selection or the autosave-reconcile path).
 *
 * Import boundary: @codemirror/* only — G-CHOKEPOINT enforced.
 * `buildLivePreviewDecorations` and `CheckboxWidget` are kept pure/position-free
 * (no doc position baked into the widget — position is resolved here at click time).
 */
export const taskCheckboxClickHandler = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView): boolean {
    const target = event.target as HTMLElement | null;
    const glyph = target?.closest('.cm-task-glyph') as HTMLElement | null;
    if (!glyph) return false;

    // Resolve the doc position of the clicked widget.
    // posAtDOM returns the widget boundary position (ListMark.from), which is
    // always on the task line. lineAt corrects any rounding to the exact line.
    let pos: number;
    try {
      pos = view.posAtDOM(glyph);
    } catch {
      return false; // defensive: widget not yet in the view DOM
    }

    const line = view.state.doc.lineAt(pos);

    // Match the task-marker prefix: group 1 = indent + bullet + ' [', group 2 = ' '|'x'|'X', group 3 = ']'
    const match = /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/.exec(line.text);
    if (!match) return false;

    // Absolute position of the bracket-state character (the ' ', 'x', or 'X')
    const boxPos = line.from + match[1].length;
    const next = match[2] === ' ' ? 'x' : ' ';

    view.dispatch({ changes: { from: boxPos, to: boxPos + 1, insert: next } });
    event.preventDefault();
    return true; // consume — do NOT move the caret or reveal raw markdown
  },
});

// ── ViewPlugin wrapper ────────────────────────────────────────────────────────

/**
 * jinLivePreview() — returns the CM6 Extension that wires the decoration layer
 * and the atomicRanges facet.
 *
 * Decorations are rebuilt on docChanged | viewportChanged | selectionSet.
 * Only view.visibleRanges are iterated (perf).
 *
 * atomicRanges == the SAME replace DecorationSet (single source of truth).
 * Active-line markers are absent from the set → never atomic → no caret trap.
 */
export function jinLivePreview() {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view.state, view.visibleRanges);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildLivePreviewDecorations(
            update.view.state,
            update.view.visibleRanges,
          );
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) =>
          atomicDecorationsOf(view.plugin(p)?.decorations ?? Decoration.none),
        ),
    },
  );

  return plugin;
}
