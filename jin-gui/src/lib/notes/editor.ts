/**
 * lib/notes/editor.ts — CM6 single full-pane source editor.
 *
 * API: mountEditor(parent, opts) → EditorHandle
 *
 * Architecture (H2 from spec §6): module owns the CM6 surface, toolbar, debounce, and UI
 * chrome; the controller owns persistence and the caret-safe out-of-band reconcile (via
 * the onSave callback). Extensions are composed in Compartments for live-preview fast-follow
 * (no on-disk-format or save-flow change needed to add decorations later — §7 D-MODULE).
 *
 * Apple-Notes-style layout (post-restyle):
 *   - Formatting toolbar (flex-shrink:0) directly below the note title
 *   - Scroll region (flex:1; overflow-y:auto) containing the CM6 editor canvas and
 *     reading-view wrapper; callers prepend meta and append links/actions to it via
 *     the '.cm-scroll-region' element inside parent
 *   - Stats footer (flex-shrink:0) showing live word/char counts + save status
 *
 * Reading-view toggle (S2): button inside the formatting toolbar switches the scroll region
 * between the CM6 editor and a read-only rendered view via renderMarkdownFragment (the
 * chokepoint). Flush is called before toggling so no edit is lost. The reading view NEVER
 * uses innerHTML of raw markdown.
 *
 * Autosave (S3): debounced 600 ms after the last doc change; flush on blur / note-switch /
 * reading-view toggle / destroy. onSave is provided by the controller and handles editNote +
 * out-of-band metadata reconcile without re-mounting the editor (caret-safe).
 *
 * This module imports renderMarkdownFragment from markdown.ts (the chokepoint) and NEVER
 * imports markdown-it or dompurify directly (enforced by G-CHOKEPOINT).
 */

import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, type ViewUpdate } from '@codemirror/view';
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentMore,
  indentLess,
} from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, indentUnit, LanguageDescription } from '@codemirror/language';
import {
  markdown,
  markdownLanguage,
  insertNewlineContinueMarkup,
  deleteMarkupBackward,
} from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { renderMarkdownFragment, hydrateManagedImages } from './markdown';
import { resolveImageAttachment } from '../../invoke';
import { jinLivePreview, jinCodeBlockBackground, jinTablePreview, jinManagedImagePreview, taskCheckboxClickHandler } from './livePreview';
import { jinFocusMode } from './focusMode';
import { typewriterExtender } from './typewriter';
import { initIcons } from '../icons';

// ── Public types ──────────────────────────────────────────────────────────────

/** Handle returned by mountEditor; exposes the editor lifecycle + test seam. */
export interface EditorHandle {
  /** Get the current document text. */
  getDoc(): string;
  /** Replace the document text. Call on note-switch only — NEVER on the autosave path. */
  setDoc(next: string): void;
  /** Insert text at the current selection and leave the caret after it. */
  insertText(text: string): void;
  /** Focus the CM6 editor surface. */
  focus(): void;
  /** Pause or resume autosave without destroying the editor or altering its document. */
  setAutosavePaused(paused: boolean): void;
  /**
   * Cancel the debounce timer and save NOW if there are pending changes.
   * Called on: editor blur, note switch, reading-view toggle, destroy.
   */
  flush(): Promise<void>;
  /** Destroy the editor and release resources. */
  destroy(): void;
  /** Test seam: get the EditorView instance for caret / identity assertions. */
  getView(): EditorView;
}

export interface MountEditorOptions {
  /** Initial document text. */
  doc: string;
  /**
   * Controller-provided persistence callback. Called debounced (600 ms) or on flush.
   * Must NOT call renderNoteDetail / setDoc — the caret-safe contract (§5 of spec).
   * Should throw on error so the module can show "Save failed".
   */
  onSave: (doc: string) => Promise<void>;
  /** If true, disable editing (read-only mode). Defaults to false. */
  readOnly?: boolean;
  /** Opens the app-owned attachment picker. The caller owns the async bridge. */
  onAddAttachment?: () => void;
}

export interface CompactEditorHandle {
  getDoc(): string;
  setDoc(next: string): void;
  focus(): void;
  destroy(): void;
}

export interface MountCompactEditorOptions {
  doc?: string;
  placeholder?: string;
  onChange?: (doc: string) => void;
}

// ── Code language descriptors (lazy-loaded grammars via @codemirror/language-data) ─
// Exported for testing: assert NOTE_CODE_LANGUAGES is non-empty and that
// LanguageDescription.matchLanguageName resolves known languages (e.g. 'js', 'python').
// Removing codeLanguages wiring causes the G-CODE-EDITOR-LANGS gate to fail.
export const NOTE_CODE_LANGUAGES = languages;

// Re-export LanguageDescription so tests can call matchLanguageName without
// importing @codemirror/language directly in the test file.
export { LanguageDescription };

// ── Hand-rolled HighlightStyle (no theme dependency, uses CSS custom props) ──
// Exported for testing (assert the extension is defined and has entries).

export const jinHighlightStyle = HighlightStyle.define([
  // Heading content — larger + bold, scaling from h1 → h6
  { tag: tags.heading1, fontFamily: 'var(--font-display)', fontSize: 'var(--prose-h1-size)', fontWeight: '700', color: 'var(--notes-writing-ink)' },
  { tag: tags.heading2, fontFamily: 'var(--font-display)', fontSize: 'var(--prose-h2-size)', fontWeight: '700', color: 'var(--notes-writing-ink)' },
  { tag: tags.heading3, fontFamily: 'var(--font-display)', fontSize: 'var(--prose-h3-size)', fontWeight: '700', color: 'var(--notes-writing-ink)' },
  { tag: tags.heading4, fontSize: '1.2em', fontWeight: '600', color: 'var(--label)' },
  { tag: tags.heading5, fontSize: '1.1em', fontWeight: '600', color: 'var(--label)' },
  { tag: tags.heading6, fontSize: '1.0em', fontWeight: '600', color: 'var(--label)' },
  // Inline formatting
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  // Inline code / monospace — tinted bg
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--label-secondary)' },
  // Blockquote content
  { tag: tags.quote, color: 'var(--label-secondary)', fontStyle: 'italic' },
  // Markup markers (**, *, #, >, etc.) — subtle, visually recessive
  { tag: tags.meta, color: 'var(--label-tertiary)' },
  { tag: tags.processingInstruction, color: 'var(--label-tertiary)' },
  // Links and URLs
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--accent)' },
  // (tags.code does not exist in @lezer/highlight; inline code uses tags.monospace above)

  // ── Code-token entries (fenced code blocks via codeLanguages grammars) ──────
  // Palette mirrors the reading-view hljs-* CSS (D-THEME-CONSISTENCY) so both
  // surfaces show the same colors from the same var(--*) tokens.

  // Keywords / control flow / module / definition keywords → --system-pink
  { tag: tags.keyword, color: 'var(--system-pink)' },
  { tag: tags.controlKeyword, color: 'var(--system-pink)' },
  { tag: tags.moduleKeyword, color: 'var(--system-pink)' },
  { tag: tags.operatorKeyword, color: 'var(--system-pink)' },
  { tag: tags.definitionKeyword, color: 'var(--system-pink)' },
  { tag: tags.modifier, color: 'var(--system-pink)' },

  // Strings → --system-green
  { tag: tags.string, color: 'var(--system-green)' },
  { tag: tags.special(tags.string), color: 'var(--system-green)' },
  { tag: tags.docString, color: 'var(--system-green)' },

  // Numbers, booleans, atoms, null → --system-orange
  { tag: tags.number, color: 'var(--system-orange)' },
  { tag: tags.bool, color: 'var(--system-orange)' },
  { tag: tags.atom, color: 'var(--system-orange)' },
  { tag: tags.null, color: 'var(--system-orange)' },

  // Comments → --label-tertiary (italic for readability)
  { tag: tags.comment, color: 'var(--label-tertiary)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--label-tertiary)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--label-tertiary)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--label-tertiary)', fontStyle: 'italic' },

  // Types, class names, namespaces → --system-teal
  { tag: tags.typeName, color: 'var(--system-teal)' },
  { tag: tags.className, color: 'var(--system-teal)' },
  { tag: tags.namespace, color: 'var(--system-teal)' },
  { tag: tags.standard(tags.typeName), color: 'var(--system-teal)' },

  // Function names → --accent
  { tag: tags.function(tags.variableName), color: 'var(--accent)' },
  { tag: tags.function(tags.propertyName), color: 'var(--accent)' },
  { tag: tags.labelName, color: 'var(--accent)' },

  // Variables and properties → --label
  { tag: tags.variableName, color: 'var(--label)' },
  { tag: tags.propertyName, color: 'var(--label)' },

  // Attribute names → --system-indigo
  { tag: tags.attributeName, color: 'var(--system-indigo)' },

  // Operators, punctuation, brackets → --label-secondary
  { tag: tags.operator, color: 'var(--label-secondary)' },
  { tag: tags.punctuation, color: 'var(--label-secondary)' },
  { tag: tags.bracket, color: 'var(--label-secondary)' },
  { tag: tags.separator, color: 'var(--label-secondary)' },
  { tag: tags.derefOperator, color: 'var(--label-secondary)' },

  // Regular expressions, escape sequences → --system-red
  { tag: tags.regexp, color: 'var(--system-red)' },
  { tag: tags.escape, color: 'var(--system-red)' },
]);

// ── Calm-typography EditorView.theme (references token vars, never raw hex) ──
// Full-width: no maxWidth / margin:auto. Outer scroll region handles scrolling.

const jinEditorTheme = EditorView.theme({
  '&': {
    // No fixed height — editor grows with content inside the scroll region
    background: 'var(--notes-writing-paper)',
    fontFamily: 'var(--font-text)',
    fontSize: 'var(--notes-prose-size)',
  },
  '.cm-scroller': {
    // outer .cm-scroll-region handles scrolling — no double-scroll
    overflow: 'visible',
  },
  '.cm-content': {
    caretColor: 'var(--agenda-indigo)',
    fontFamily: 'var(--font-text)',
    fontSize: 'var(--notes-prose-size)',
    lineHeight: 'var(--notes-prose-line)',
    maxWidth: 'var(--notes-prose-measure)',
    margin: '0 auto',
    padding: '1.5rem clamp(16px, 4vw, 40px)',
    minHeight: 'calc(100vh - 200px)',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--notes-selection-tint)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--notes-selection-tint)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--agenda-indigo)',
  },
  '.cm-placeholder': {
    color: 'var(--label-tertiary)',
    fontStyle: 'italic',
  },
  // ── Live-preview list glyphs (K-LPL-A) ─────────────────────────────────
  // Glyph baseline and color aligned with surrounding text using token vars only.
  '.cm-bullet-glyph': {
    color: 'var(--label-tertiary)',
    lineHeight: 'inherit',
    verticalAlign: 'baseline',
  },
  '.cm-task-glyph': {
    color: 'var(--label-tertiary)',
    cursor: 'pointer',
    lineHeight: 'inherit',
    verticalAlign: 'baseline',
  },
  '.cm-task-glyph--checked': {
    color: 'var(--accent)',
  },
  // ── Live-preview link label (LPK-2) ─────────────────────────────────────
  // Collapsed [label](url) shows the label styled as a link. No cursor:pointer
  // in v1 — click positions the caret (edit-on-click), not open-on-click.
  // Clickable-open is increment #2.5 (D-CLICKABLE / fast_follow_2_5_plumbing).
  '.cm-link-label': {
    color: 'var(--accent)',
    textDecoration: 'underline',
  },
  // ── Live-preview blockquote bar (LPQ-2) ─────────────────────────────────
  // Left vertical rule + inline indent. Mirrors the reading-view blockquote bar
  // (browse.css:516-521) for visual parity. Uses logical properties for RTL
  // safety. NO color: tags.quote (editor.ts:104) already styles the text italic
  // + var(--label-secondary); .cm-blockquote-line must not re-set color to
  // avoid double-muting (D-QUOTE-STYLE). Token vars only — never raw hex.
  '.cm-blockquote-line': {
    borderInlineStart: '3px solid var(--notes-quote-rule)',
    paddingInlineStart: 'var(--space-2)',
  },
  // ── Fenced-code contained block (D-CODE-BG) ──────────────────────────────
  // Renders fenced/indented code blocks as a contained, rounded, monospace
  // card that matches Read-mode's .cm-reading-wrapper pre surface.
  //
  // Background token decision: --fill-quaternary is kept rather than
  // --bg-secondary (Read mode's value) because in dark mode both
  // --editor-canvas and --bg-secondary resolve to #1c1c1e, making a
  // --bg-secondary block invisible against the canvas. --fill-quaternary is
  // always a relative translucent fill (rgba(116,116,128,0.18) dark /
  // 0.08 light), so it stays visible in both appearances without per-mode
  // overrides. This is a deliberate divergence from the Read-mode token;
  // surface parity (shape, mono, padding) is achieved; exact bg parity is not.
  //
  // Font-size: not reduced (no fontSize rule). Read mode uses
  // --text-caption1-size (0.75rem) which is too small to comfortably edit;
  // the editor inherits 1.125rem from .cm-content, giving a legible edit size.
  '.cm-code-line': {
    backgroundColor: 'var(--notes-code-wash)',
    fontFamily: 'var(--font-mono)',
    paddingInline: 'var(--space-2)',
  },
  // Top radius + padding on the first line of each block.
  '.cm-code-line.cm-code-line--first': {
    borderTopLeftRadius: 'var(--radius-sm)',
    borderTopRightRadius: 'var(--radius-sm)',
    paddingTop: 'var(--space-1)',
  },
  // Bottom radius + padding on the last line of each block.
  '.cm-code-line.cm-code-line--last': {
    borderBottomLeftRadius: 'var(--radius-sm)',
    borderBottomRightRadius: 'var(--radius-sm)',
    paddingBottom: 'var(--space-1)',
  },
  // ── Focus mode dim (COZY-1) ─────────────────────────────────────────────
  // Dims non-active lines. opacity 0.4 keeps text legible; transition softens
  // the shift as the caret moves between lines. Active line has NO class → full opacity.
  '.cm-dim': {
    opacity: '0.4',
    transition: 'opacity 120ms var(--ease-standard)',
  },
  // ── Typewriter scrolling bottom padding (COZY-2) ─────────────────────────
  // Adds 50vh bottom space so the last line can reach center when typewriter is ON.
  // Keyed on '.cm-content.cm-typewriter' (specificity > base '.cm-content') so the
  // rule wins and adds no dead space when typewriter is OFF (class absent).
  '.cm-content.cm-typewriter': {
    paddingBottom: '50vh',
  },
});

const jinCompactEditorTheme = EditorView.theme({
  '&': {
    background: 'transparent',
    color: 'var(--label)',
    fontFamily: 'var(--font-text)',
    fontSize: 'var(--text-body-size)',
  },
  '.cm-scroller': { overflow: 'auto', maxHeight: '240px' },
  '.cm-content': {
    minHeight: '150px',
    padding: 'var(--space-2) var(--space-3)',
    caretColor: 'var(--accent)',
    lineHeight: 'var(--text-body-line)',
  },
  '.cm-line:first-child': {
    color: 'var(--ink-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--text-title3-size)',
    fontWeight: 'var(--display-title-weight)',
    lineHeight: 'var(--text-title3-line)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--label-tertiary)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--fill-secondary)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});

/**
 * A deliberately small, manual-save CodeMirror surface for quick note entry.
 * It shares Jin's Markdown language, highlighting, editing keys, and first-line
 * title treatment without bringing the full note screen's toolbar/autosave UI.
 */
export function mountCompactEditor(parent: HTMLElement, options: MountCompactEditorOptions = {}): CompactEditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc ?? '',
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: NOTE_CODE_LANGUAGES }),
        syntaxHighlighting(jinHighlightStyle),
        history(),
        closeBrackets(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Note editor; first line becomes the title' }),
        placeholderExt(options.placeholder ?? 'Title\nStart writing…'),
        keymap.of([
          { key: 'Tab', run: indentMore, shift: indentLess },
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
          ...closeBracketsKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        jinCompactEditorTheme,
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) options.onChange?.(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    getDoc: () => view.state.doc.toString(),
    setDoc: (next: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

// ── Formatting commands (exported for unit testing) ───────────────────────────

/**
 * toggleInlineWrap — wrap / unwrap the current selection with a delimiter string.
 * If the selection is already wrapped (delimiter before AND after), unwraps.
 * Otherwise wraps. Used for bold (**), italic (*), strikethrough (~~), code (`).
 */
export function toggleInlineWrap(delimiter: string) {
  return (view: EditorView): boolean => {
    const { state, dispatch } = view;
    const sel = state.selection.main;
    const n = delimiter.length;
    const before = state.sliceDoc(Math.max(0, sel.from - n), sel.from);
    const after = state.sliceDoc(sel.to, Math.min(state.doc.length, sel.to + n));

    if (before === delimiter && after === delimiter) {
      // Unwrap: remove delimiters on both sides
      dispatch(
        state.update({
          changes: [
            { from: sel.from - n, to: sel.from, insert: '' },
            { from: sel.to, to: sel.to + n, insert: '' },
          ],
          selection: { anchor: sel.from - n, head: sel.to - n },
          scrollIntoView: true,
        })
      );
    } else {
      // Wrap: insert delimiters around selection
      dispatch(
        state.update({
          changes: [
            { from: sel.from, insert: delimiter },
            { from: sel.to, insert: delimiter },
          ],
          selection: { anchor: sel.from + n, head: sel.to + n },
          scrollIntoView: true,
        })
      );
    }
    return true;
  };
}

/**
 * toggleLink — insert [selection]() with caret in the url slot.
 * If there's already a selection it becomes the link label.
 */
export function toggleLink(view: EditorView): boolean {
  const { state, dispatch } = view;
  const sel = state.selection.main;
  const selectedText = state.sliceDoc(sel.from, sel.to);
  const insert = `[${selectedText}]()`;

  dispatch(
    state.update({
      changes: { from: sel.from, to: sel.to, insert },
      // Caret lands inside the () — after the closing ]( and before )
      selection: { anchor: sel.from + selectedText.length + 3 },
      scrollIntoView: true,
    })
  );
  return true;
}

/** Insert a small, useful GFM table and place the selection in its first header. */
export function insertTable(view: EditorView): boolean {
  const { state, dispatch } = view;
  const sel = state.selection.main;
  const prefix = sel.from > 0 && state.sliceDoc(sel.from - 1, sel.from) !== '\n' ? '\n\n' : '';
  // A table is a block.  Preserve the text after the selection as a new block
  // too, otherwise inserting at BOF or in the middle of prose makes that prose
  // part of the final table row.
  const suffix = sel.to < state.doc.length && state.sliceDoc(sel.to, sel.to + 1) !== '\n' ? '\n\n' : '';
  const table = '| Heading 1 | Heading 2 |\n| --- | --- |\n| Cell | Cell |';
  dispatch(state.update({
    changes: { from: sel.from, to: sel.to, insert: `${prefix}${table}${suffix}` },
    selection: { anchor: sel.from + prefix.length + 2, head: sel.from + prefix.length + 11 },
    scrollIntoView: true,
  }));
  return true;
}

/**
 * setHeading — set an ATX heading level on the current line.
 * Running the same level twice toggles the heading off (removes the markers).
 * Never stacks heading markers.
 */
export function setHeading(level: number) {
  return (view: EditorView): boolean => {
    const { state, dispatch } = view;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const lineText = line.text;

    // Detect existing heading level and strip it
    const existingMatch = /^(#{1,6})\s+/.exec(lineText);
    const existingLevel = existingMatch ? existingMatch[1].length : 0;
    const contentWithoutHeading = lineText.replace(/^#{1,6}\s+/, '');

    let newText: string;
    if (existingLevel === level) {
      // Same level: toggle off (plain text)
      newText = contentWithoutHeading;
    } else {
      // Set or change heading level
      newText = `${'#'.repeat(level)} ${contentWithoutHeading}`;
    }

    // Preserve relative caret position within the line content
    const oldPrefixLen = existingLevel > 0 ? existingLevel + 1 : 0; // '# ' = level + 1 char
    const newPrefixLen = existingLevel === level ? 0 : level + 1;
    const contentOffset = Math.max(0, sel.head - line.from - oldPrefixLen);
    const newAnchor = Math.min(line.from + newPrefixLen + contentOffset, line.from + newText.length);

    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: newText },
        selection: { anchor: newAnchor },
        scrollIntoView: true,
      })
    );
    return true;
  };
}

/**
 * toggleLinePrefix — toggle a block-level prefix ('- ', '1. ', '- [ ] ', '> ')
 * on the current line or all lines covered by the selection.
 *
 * If ALL covered lines already start with the prefix, the prefix is removed.
 * Otherwise the prefix is added to lines that don't yet have it.
 * Exported so the toolbar buttons and future keybindings can reuse it.
 */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state, dispatch } = view;
  const sel = state.selection.main;

  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);

  const lines: Array<{ from: number; text: string }> = [];
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i);
    lines.push({ from: line.from, text: line.text });
  }

  const allHavePrefix = lines.every((l) => l.text.startsWith(prefix));

  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  for (const l of lines) {
    if (allHavePrefix) {
      // Remove prefix
      changes.push({ from: l.from, to: l.from + prefix.length, insert: '' });
    } else if (!l.text.startsWith(prefix)) {
      // Add prefix to lines that don't have it
      changes.push({ from: l.from, insert: prefix });
    }
  }

  if (changes.length > 0) {
    const changeSet = state.changes(changes);
    // Associate the selection with inserted prefixes so typing continues after
    // a newly-created list/checklist marker instead of before it.
    dispatch(state.update({
      changes: changeSet,
      selection: state.selection.map(changeSet, 1),
      scrollIntoView: true,
    }));
  }
  return true;
}

// ── mountEditor — the primary export ─────────────────────────────────────────

/**
 * mountEditor — mount a CM6 source editor inside parent.
 *
 * Renders inside parent (parent is expected to be a flex column, e.g. .note-detail__body):
 *   1. A formatting toolbar (.cm-toolbar) with Lucide icon-buttons for headings, inline
 *      styles, lists, blocks, and the Reading-view toggle (.cm-toolbar__toggle).
 *   2. A scroll region (.cm-scroll-region; flex:1; overflow-y:auto) that the caller
 *      may prepend meta content and append links/actions to. Inside it:
 *        - .cm-editor-wrapper — the CM6 EditorView host
 *        - .cm-reading-wrapper — sanitized reading view (initially hidden)
 *   3. A stats footer (.cm-footer) with live word/char counts and the save-status
 *      indicator (.cm-toolbar__status — class kept for test compatibility).
 *
 * Autosave: triggered 600 ms after the last doc change (module-internal debounce).
 * onSave is the controller-provided callback; it handles editNote + metadata reconcile
 * WITHOUT re-mounting the editor (caret-safe per §5 of spec).
 *
 * A test seam attaches the handle to parent._cmHandle for controller-level tests.
 */
export function mountEditor(parent: HTMLElement, opts: MountEditorOptions): EditorHandle {
  const { doc, onSave, readOnly = false, onAddAttachment } = opts;

  // ── Internal state ────────────────────────────────────────────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;
  let saveInFlight: Promise<void> | null = null;
  let isReadingView = false;
  let destroyed = false;
  let autosavePaused = false;
  let revokeReadingMedia: (() => void) | null = null;
  let readingHydrationGeneration = 0;
  let revokeLiveMedia: (() => void) | null = null;
  let liveHydrationGeneration = 0;
  // Mode-toggle flags (per-mount, default OFF — D-PERSIST)
  let focusOn = false;
  let typewriterOn = false;

  // ── Local DOM helpers ─────────────────────────────────────────────────────
  /** Create a ghost icon button for the formatting toolbar. */
  const mkBtn = (iconName: string, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-toolbar__btn';
    btn.setAttribute('aria-label', label);
    // Native hover tooltip. The formatting toolbar is horizontally scrollable
    // (overflow-x:auto forces overflow-y:auto), which would clip a CSS balloon
    // tooltip — the native title escapes the overflow box and never clips.
    btn.title = label;
    const i = document.createElement('i');
    i.setAttribute('data-lucide', iconName);
    i.setAttribute('aria-hidden', 'true');
    btn.appendChild(i);
    return btn;
  };

  /** Keep related commands discoverable without changing their behavior. */
  const mkGroup = (label: string, controls: HTMLElement[]): HTMLDivElement => {
    const group = document.createElement('div');
    group.className = 'cm-toolbar__group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    group.append(...controls);
    return group;
  };

  // ── Toolbar DOM ───────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'cm-toolbar';
  toolbar.setAttribute('aria-label', 'Formatting toolbar');
  toolbar.setAttribute('role', 'toolbar');

  // Heading group
  const h1Btn = mkBtn('heading-1', 'Heading 1');
  const h2Btn = mkBtn('heading-2', 'Heading 2');
  const h3Btn = mkBtn('heading-3', 'Heading 3');
  const tableBtn = mkBtn('table-2', 'Insert table');

  // Inline group
  const boldBtn   = mkBtn('bold',          'Bold');
  const italicBtn = mkBtn('italic',        'Italic');
  const strikeBtn = mkBtn('strikethrough', 'Strikethrough');
  const codeBtn   = mkBtn('code',          'Inline code');

  // List group
  const bulletBtn    = mkBtn('list',         'Bulleted list');
  const numberedBtn  = mkBtn('list-ordered', 'Numbered list');
  const checklistBtn = mkBtn('list-todo',    'Checklist');

  // Block group
  const quoteBtn   = mkBtn('quote', 'Blockquote');
  const linkFmtBtn = mkBtn('link',  'Insert link');
  const attachmentBtn = mkBtn('paperclip', 'Add image or attachment');
  attachmentBtn.dataset.tooltip = 'Add Attachment';

  // Spacer keeps the real mode controls visually distinct on wide screens.
  const toolbarSpacer = document.createElement('div');
  toolbarSpacer.className = 'cm-toolbar__spacer';
  toolbarSpacer.setAttribute('aria-hidden', 'true');

  // Mode toggles (right cluster — focus + typewriter; before Read toggle — D-TOGGLE)
  const focusBtn = mkBtn('focus', 'Focus mode');
  focusBtn.setAttribute('aria-pressed', 'false');
  const typewriterBtn = mkBtn('align-center-vertical', 'Typewriter scrolling');
  typewriterBtn.setAttribute('aria-pressed', 'false');

  // Reading-view toggle (right-aligned; class preserved for test compat)
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'cm-toolbar__toggle';
  toggleBtn.textContent = 'Read';
  toggleBtn.setAttribute('aria-label', 'Switch to reading mode');
  toggleBtn.title = 'Switch to reading mode';

  toolbar.appendChild(mkGroup('Structure', [h1Btn, h2Btn, h3Btn, tableBtn]));
  toolbar.appendChild(mkGroup('Inline formatting', [boldBtn, italicBtn, strikeBtn, codeBtn]));
  toolbar.appendChild(mkGroup('Lists', [bulletBtn, numberedBtn, checklistBtn]));
  toolbar.appendChild(mkGroup('Blocks', [quoteBtn, linkFmtBtn]));
  toolbar.appendChild(mkGroup('Media', [attachmentBtn]));
  toolbar.appendChild(toolbarSpacer);
  toolbar.appendChild(mkGroup('Writing modes', [focusBtn, typewriterBtn, toggleBtn]));

  // ── Scroll region (flex:1; overflow-y:auto) — callers prepend/append into this ─
  const scrollRegion = document.createElement('div');
  scrollRegion.className = 'cm-scroll-region';

  // ── Editor wrapper ────────────────────────────────────────────────────────
  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'cm-editor-wrapper';

  // ── Reading wrapper ───────────────────────────────────────────────────────
  const readingWrapper = document.createElement('div');
  readingWrapper.className = 'cm-reading-wrapper';
  readingWrapper.setAttribute('role', 'region');
  readingWrapper.setAttribute('aria-label', 'Reading view');
  readingWrapper.style.display = 'none';

  scrollRegion.appendChild(editorWrapper);
  scrollRegion.appendChild(readingWrapper);

  // ── Stats footer ──────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'cm-footer';

  const footerStatsEl = document.createElement('span');
  footerStatsEl.className = 'cm-footer__stats';

  const footerRight = document.createElement('div');
  footerRight.className = 'cm-footer__right';

  const footerReadTimeEl = document.createElement('span');
  footerReadTimeEl.className = 'cm-footer__read-time';

  // Save status — class .cm-toolbar__status PRESERVED for test compat
  const statusEl = document.createElement('span');
  statusEl.className = 'cm-toolbar__status';
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');

  footerRight.appendChild(footerReadTimeEl);
  footerRight.appendChild(statusEl);
  footer.appendChild(footerStatsEl);
  footer.appendChild(footerRight);

  // ── Assemble into parent ──────────────────────────────────────────────────
  parent.appendChild(toolbar);
  parent.appendChild(scrollRegion);
  parent.appendChild(footer);

  // ── Internal save wrapper (manages status indicator text) ─────────────────
  const setSaveStatus = (state: 'saving' | 'saved' | 'failed' | 'paused', text: string): void => {
    statusEl.dataset.saveState = state;
    statusEl.textContent = text;
  };

  const callOnSave = async (docText: string): Promise<void> => {
    setSaveStatus('saving', 'Saving…');
    try {
      await onSave(docText);
      setSaveStatus('saved', 'Saved');
    } catch (err) {
      setSaveStatus(
        autosavePaused ? 'paused' : 'failed',
        autosavePaused ? 'Saving paused — resolve conflict' : 'Save failed',
      );
      throw err;
    }
  };

  const drainSaves = (): Promise<void> => {
    if (saveInFlight) return saveInFlight;
    saveInFlight = (async () => {
      while (pendingSave && !destroyed && !autosavePaused) {
        pendingSave = false;
        try {
          await callOnSave(view.state.doc.toString());
        } catch (err) {
          // Keep the current document pending for an explicit retry after the
          // caller resolves the error or conflict.
          pendingSave = true;
          throw err;
        }
      }
    })();
    return saveInFlight.finally(() => {
      saveInFlight = null;
    });
  };

  // ── Debounce logic ────────────────────────────────────────────────────────
  const scheduleSave = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (pendingSave && !destroyed && !autosavePaused) {
        void drainSaves().catch(() => {});
      }
    }, 600);
  };

  // ── Stats recompute (late-binding: reassigned after view is created) ───────
  // Initially a no-op; replaced with the real implementation once `view` exists.
  let recomputeStats: () => void = () => {};

  // ── Compartments (live-preview fast-follow: reconfigure without format change) ─
  const languageCompartment = new Compartment();
  const highlightCompartment = new Compartment();
  const keymapCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const livePreviewCompartment = new Compartment();
  // Cozy-extras compartments (default OFF; reconfigure on toggle — D-COMPARTMENT)
  const focusCompartment = new Compartment();
  const typewriterCompartment = new Compartment();

  // ── Jin note keymaps (must precede defaultKeymap so jin keys win) ─────────
  const jinNoteKeys = [
    // Tab / Shift-Tab: indent / outdent (consumes Tab → focus stays in editor)
    { key: 'Tab', run: indentMore, shift: indentLess },
    // Enter: continue list marker / blockquote; exit on empty list item
    { key: 'Enter', run: insertNewlineContinueMarkup },
    // Backspace: delete markup character (e.g. empty list marker on Backspace)
    { key: 'Backspace', run: deleteMarkupBackward },
    // Mod+B: toggle bold (**word**)
    { key: 'Mod-b', run: toggleInlineWrap('**') },
    // Mod+I: toggle italic (*word*)
    { key: 'Mod-i', run: toggleInlineWrap('*') },
    // Mod+K: insert link ([label](url))
    { key: 'Mod-k', run: toggleLink },
    // Mod+1..6: ATX heading levels (set / toggle off)
    { key: 'Mod-1', run: setHeading(1) },
    { key: 'Mod-2', run: setHeading(2) },
    { key: 'Mod-3', run: setHeading(3) },
    { key: 'Mod-4', run: setHeading(4) },
    { key: 'Mod-5', run: setHeading(5) },
    { key: 'Mod-6', run: setHeading(6) },
  ];

  // ── EditorView construction ───────────────────────────────────────────────
  const view = new EditorView({
    parent: editorWrapper,
    state: EditorState.create({
      doc,
      extensions: [
        // Language + indent unit (compartmented for live-preview fast-follow)
        languageCompartment.of([
          markdown({ base: markdownLanguage, codeLanguages: NOTE_CODE_LANGUAGES }),
          indentUnit.of('  '),
        ]),
        // Syntax highlighting (compartmented)
        highlightCompartment.of(syntaxHighlighting(jinHighlightStyle)),
        // Live-preview: hide/reveal markdown markers on inactive lines (default-on)
        livePreviewCompartment.of(jinLivePreview()),
        jinTablePreview(),
        jinManagedImagePreview(),
        // Fenced-code background: tint code-block lines so code stands out from prose
        jinCodeBlockBackground(),
        // Task-checkbox click handler: toggle [ ]/[x] on .cm-task-glyph mousedown
        taskCheckboxClickHandler,
        // Focus mode: dim non-active lines (default-off; opt-in toggle — COZY-1)
        focusCompartment.of([]),
        // Typewriter scrolling: center active line (default-off; opt-in toggle — COZY-2)
        typewriterCompartment.of([]),
        // Theme (compartmented)
        themeCompartment.of(jinEditorTheme),
        // History (undo/redo)
        history(),
        // Smart bracket / quote pairs (wrap selection on open, skip close, delete pair)
        closeBrackets(),
        // Soft line wrapping so long lines don't overflow
        EditorView.lineWrapping,
        // Empty-doc placeholder
        placeholderExt('Start writing…'),
        // Read-only guard
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        // Keymap: jin keys FIRST so they override defaults
        keymapCompartment.of(
          keymap.of([
            ...jinNoteKeys,
            ...closeBracketsKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ])
        ),
        // Doc-change listener → schedule debounced save + update footer stats
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged || update.selectionSet || update.viewportChanged) scheduleLiveImageHydration();
          if (update.docChanged && !readOnly) {
            if (autosavePaused) {
              setSaveStatus('paused', 'Saving paused — resolve conflict');
            } else {
              pendingSave = true;
              setSaveStatus('saving', 'Saving…');
              scheduleSave();
            }
            recomputeStats();
          }
        }),
        // Blur → flush (caret-safe; no re-render)
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            const preview = (event.target as HTMLElement).closest<HTMLElement>('.cm-table-widget[data-cm-table-focus], .cm-managed-image-placeholder[data-cm-image-focus]');
            if (!preview) return false;
            const from = Number(preview.dataset.cmTableFocus ?? preview.dataset.cmImageFocus);
            if (!Number.isFinite(from)) return false;
            event.preventDefault();
            view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            view.focus();
            return true;
          },
          keydown: (event, view) => {
            if (event.key !== 'Enter' && event.key !== ' ') return false;
            const preview = (event.target as HTMLElement).closest<HTMLElement>('.cm-table-widget[data-cm-table-focus], .cm-managed-image-placeholder[data-cm-image-focus]');
            if (!preview) return false;
            const from = Number(preview.dataset.cmTableFocus ?? preview.dataset.cmImageFocus);
            if (!Number.isFinite(from)) return false;
            event.preventDefault();
            view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            view.focus();
            return true;
          },
          blur: () => {
            if (!destroyed) void handle.flush();
            return false; // don't suppress the event
          },
        }),
      ],
    }),
  });

  /** Hydrate only parser-created managed-image widgets via verified local bytes. */
  const scheduleLiveImageHydration = (): void => {
    const generation = ++liveHydrationGeneration;
    revokeLiveMedia?.();
    revokeLiveMedia = null;
    queueMicrotask(async () => {
      const urls: string[] = [];
      const widgets = Array.from(editorWrapper.querySelectorAll<HTMLElement>('.cm-managed-image-placeholder[data-jin-asset-hash]'));
      await Promise.all(widgets.map(async (widget) => {
        const hash = widget.dataset.jinAssetHash ?? '';
        if (!/^[a-f0-9]{64}$/.test(hash)) return;
        try {
          const asset = await resolveImageAttachment(hash);
          if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mime) || !Array.isArray(asset.bytes)) return;
          const url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }));
          if (destroyed || generation !== liveHydrationGeneration || !editorWrapper.contains(widget)) { URL.revokeObjectURL(url); return; }
          urls.push(url);
          const image = document.createElement('img');
          image.className = 'cm-managed-image';
          image.src = url;
          image.alt = widget.dataset.jinAssetLabel || 'Managed image';
          widget.replaceChildren(image);
        } catch { /* leave a readable inert placeholder */ }
      }));
      if (destroyed || generation !== liveHydrationGeneration) urls.forEach((url) => URL.revokeObjectURL(url));
      else revokeLiveMedia = () => urls.forEach((url) => URL.revokeObjectURL(url));
    });
  };
  scheduleLiveImageHydration();

  // Link insertion is intentionally explicit: all three choices persist as
  // portable Markdown and never fetch page metadata. The card title sentinel
  // opts into card presentation without changing ordinary standalone links.
  const linkDialog = document.createElement('dialog');
  linkDialog.className = 'notes-link-composer';
  linkDialog.setAttribute('aria-label', 'Insert web link');
  const linkForm = document.createElement('form');
  linkForm.method = 'dialog';
  const linkHeading = document.createElement('h2'); linkHeading.textContent = 'Insert link';
  const formatLabel = document.createElement('label'); formatLabel.textContent = 'Format';
  const formatSelect = document.createElement('select');
  for (const [value, label] of [['plain', 'Plain URL'], ['inline', 'Inline decorated link'], ['card', 'Link card']] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; formatSelect.appendChild(option);
  }
  formatLabel.appendChild(formatSelect);
  const urlLabel = document.createElement('label'); urlLabel.textContent = 'Web address';
  const urlInput = document.createElement('input'); urlInput.type = 'url'; urlInput.required = true; urlInput.placeholder = 'https://example.com'; urlLabel.appendChild(urlInput);
  const labelLabel = document.createElement('label'); labelLabel.textContent = 'Label';
  const labelInput = document.createElement('input'); labelInput.type = 'text'; labelInput.placeholder = 'Optional for a plain URL'; labelLabel.appendChild(labelInput);
  const hint = document.createElement('p'); hint.className = 'notes-link-composer__hint'; hint.textContent = 'Choose how the link should appear.';
  const error = document.createElement('p'); error.className = 'notes-link-composer__error'; error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'form-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Cancel';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn-primary jin-control jin-control--primary'; submit.textContent = 'Insert link'; actions.append(cancel, submit);
  linkForm.append(linkHeading, formatLabel, urlLabel, labelLabel, hint, error, actions);
  linkDialog.appendChild(linkForm); document.body.appendChild(linkDialog);
  let linkSelection: { from: number; to: number; label: string } | null = null;
  const updateLinkFields = (): void => {
    const plain = formatSelect.value === 'plain';
    labelLabel.hidden = plain;
    labelInput.required = !plain;
    hint.textContent = plain ? 'Shows the web address.' : formatSelect.value === 'card'
      ? 'Shows a full-width card with your label and address.'
      : 'Shows your label inside the sentence.';
  };
  formatSelect.addEventListener('change', updateLinkFields);
  cancel.addEventListener('click', () => linkDialog.close());
  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (destroyed) return;
    const selected = linkSelection;
    if (!selected) return;
    let url: URL;
    try { url = new URL(urlInput.value.trim()); } catch { error.textContent = 'Enter a valid http or https address.'; return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { error.textContent = 'Only http and https links can be inserted.'; return; }
    const label = (labelInput.value.trim() || selected.label || url.href).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const href = url.href;
    const format = formatSelect.value;
    const from = Math.min(selected.from, view.state.doc.length);
    const to = Math.min(selected.to, view.state.doc.length);
    let inserted: string;
    if (format === 'plain') {
      inserted = href;
    } else if (format === 'card') {
      const before = view.state.sliceDoc(0, from);
      const after = view.state.sliceDoc(to);
      const prefix = from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const suffix = to === view.state.doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      inserted = `${prefix}[${label}](${href} "jin-card")${suffix}`;
    } else {
      inserted = `[${label}](${href})`;
    }
    view.dispatch({ changes: { from, to, insert: inserted }, selection: { anchor: from + inserted.length }, scrollIntoView: true });
    linkDialog.close(); view.focus();
  });
  const openLinkComposer = (): void => {
    const selection = view.state.selection.main;
    linkSelection = { from: selection.from, to: selection.to, label: view.state.sliceDoc(selection.from, selection.to) };
    formatSelect.value = 'inline'; urlInput.value = ''; labelInput.value = linkSelection.label; error.textContent = ''; updateLinkFields();
    linkDialog.showModal(); urlInput.focus();
  };

  // ── Wire toolbar button click handlers (view is now available) ────────────
  h1Btn.addEventListener('click', () => { setHeading(1)(view); });
  h2Btn.addEventListener('click', () => { setHeading(2)(view); });
  h3Btn.addEventListener('click', () => { setHeading(3)(view); });
  tableBtn.addEventListener('click', () => { insertTable(view); });
  boldBtn.addEventListener('click',   () => { toggleInlineWrap('**')(view); });
  italicBtn.addEventListener('click', () => { toggleInlineWrap('*')(view); });
  strikeBtn.addEventListener('click', () => { toggleInlineWrap('~~')(view); });
  codeBtn.addEventListener('click',   () => { toggleInlineWrap('`')(view); });
  bulletBtn.addEventListener('click',    () => { toggleLinePrefix(view, '- '); });
  numberedBtn.addEventListener('click',  () => { toggleLinePrefix(view, '1. '); });
  checklistBtn.addEventListener('click', () => { toggleLinePrefix(view, '- [ ] '); });
  quoteBtn.addEventListener('click',   () => { toggleLinePrefix(view, '> '); });
  linkFmtBtn.addEventListener('click', openLinkComposer);
  attachmentBtn.addEventListener('click', () => { onAddAttachment?.(); });

  // Focus mode toggle (COZY-1) — reconfigure compartment; no remount, caret-safe
  focusBtn.addEventListener('click', () => {
    focusOn = !focusOn;
    view.dispatch({ effects: focusCompartment.reconfigure(focusOn ? jinFocusMode() : []) });
    focusBtn.setAttribute('aria-pressed', String(focusOn));
    view.focus();
  });

  // Typewriter scrolling toggle (COZY-2) — reconfigure compartment; no remount, caret-safe
  typewriterBtn.addEventListener('click', () => {
    typewriterOn = !typewriterOn;
    view.dispatch({
      effects: typewriterCompartment.reconfigure(
        typewriterOn
          ? [typewriterExtender(), EditorView.contentAttributes.of({ class: 'cm-typewriter' })]
          : [],
      ),
    });
    typewriterBtn.setAttribute('aria-pressed', String(typewriterOn));
    view.focus();
  });

  // ── Real stats implementation (view is now available; replaces the no-op) ──
  recomputeStats = (): void => {
    const text = view.state.doc.toString();
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const chars = view.state.doc.length;
    footerStatsEl.textContent = `${words} words · ${chars} chars`;
    footerReadTimeEl.textContent = `~${Math.max(1, Math.round(words / 200))} min read`;
  };

  // Initial stats paint (after view is built with the initial doc)
  recomputeStats();

  // ── Reading-view toggle handler (S2) ──────────────────────────────────────
  // Toggles between the CM6 editor surface and a read-only rendered view.
  // Flushes unsaved edits BEFORE rendering the reading view so no edit is lost.
  toggleBtn.addEventListener('click', () => {
    void (async () => {
      if (!isReadingView) {
        // → reading view: flush first, then render via chokepoint
        await handle.flush();
        isReadingView = true;
        editorWrapper.style.display = 'none';
        readingWrapper.style.display = '';
        // Render via renderMarkdownFragment — NEVER innerHTML of raw markdown
        revokeReadingMedia?.();
        revokeReadingMedia = null;
        const generation = ++readingHydrationGeneration;
        readingWrapper.replaceChildren(renderMarkdownFragment(view.state.doc.toString()));
        void hydrateManagedImages(readingWrapper, resolveImageAttachment).then((revoke) => {
          if (generation === readingHydrationGeneration && isReadingView && !destroyed && readingWrapper.isConnected) revokeReadingMedia = revoke;
          else revoke();
        });
        // Hydrate Lucide <i data-lucide> icons added by codeChrome decorateCodeBlocks
        initIcons();
        toggleBtn.textContent = 'Edit';
        toggleBtn.setAttribute('aria-label', 'Switch to edit mode');
        toggleBtn.title = 'Switch to edit mode';
      } else {
        // → edit view: restore CM6 surface
        isReadingView = false;
        editorWrapper.style.display = '';
        readingWrapper.style.display = 'none';
        readingWrapper.replaceChildren(); // clear reading view DOM
        readingHydrationGeneration += 1;
        revokeReadingMedia?.();
        revokeReadingMedia = null;
        toggleBtn.textContent = 'Read';
        toggleBtn.setAttribute('aria-label', 'Switch to reading mode');
        toggleBtn.title = 'Switch to reading mode';
        view.focus();
      }
    })();
  });

  // ── EditorHandle ──────────────────────────────────────────────────────────
  const handle: EditorHandle = {
    getDoc(): string {
      return view.state.doc.toString();
    },

    setDoc(next: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    },

    insertText(text: string): void {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
      });
      view.focus();
    },

    focus(): void {
      view.focus();
    },

    setAutosavePaused(paused: boolean): void {
      autosavePaused = paused;
      if (paused) {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        pendingSave = false;
        setSaveStatus('paused', 'Saving paused — resolve conflict');
      } else if (!destroyed) {
        delete statusEl.dataset.saveState;
        statusEl.textContent = '';
      }
    },

    async flush(): Promise<void> {
      if (autosavePaused) return;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pendingSave && !destroyed) {
        await drainSaves();
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      view.destroy();
      liveHydrationGeneration += 1;
      revokeLiveMedia?.();
      revokeLiveMedia = null;
      readingHydrationGeneration += 1;
      revokeReadingMedia?.();
      revokeReadingMedia = null;
      linkDialog.remove();
    },

    getView(): EditorView {
      return view;
    },
  };

  // Attach handle to parent for controller-level test seam access (§7 D-TEST-STRATEGY).
  Object.defineProperty(parent, '_cmHandle', {
    value: handle,
    configurable: true,
    enumerable: false,
    writable: true,
  });

  return handle;
}
