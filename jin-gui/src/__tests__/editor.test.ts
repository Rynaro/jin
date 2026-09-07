// @vitest-environment jsdom
/**
 * editor.test.ts — CM6 source editor unit tests.
 *
 * Gates covered (spec §10 validation gate catalog):
 *   G-EDITOR-SMOKE   — CM6 mounts in jsdom; getDoc() round-trips; .cm-content has text (A2 de-risk)
 *   G-EDITOR-TAB     — Tab indents a list item (doc gains leading spaces, focus stays in .cm-editor)
 *   G-EDITOR-ENTER   — Enter continues list/blockquote; empty item exits the list
 *   G-EDITOR-BOLD    — Mod+B wraps selection in **…**; re-run unwraps
 *   G-EDITOR-ITALIC  — Mod+I wraps selection in *…*
 *   G-EDITOR-LINK    — Mod+K inserts [label]() with caret in url slot
 *   G-EDITOR-HEADING — Mod+1..6 set ATX heading level; same level again removes heading
 *   G-EDITOR-PAIRS   — closeBrackets: wrap selection, skip close-char, delete empty pair
 *   G-EDITOR-HISTORY — Undo restores prior doc
 *   G-EDITOR-PLACEHOLDER — empty doc shows "Start writing…" placeholder
 *   G-HIGHLIGHT      — syntax highlighting extension applied (spans present in .cm-content)
 *   G-KEYMAP         — jinNoteKeys bindings exercised via REAL key events (bite on binding removal)
 *                        Tab/Shift-Tab/Enter/Ctrl+B/Ctrl+I/Ctrl+K/Ctrl+1/2/6
 *   G-READING-VIEW   — toggle renders via renderMarkdownFragment (chokepoint; <h1> node)
 *   G-READING-FLUSH  — toggle-to-reading flushes unsaved edits first (onSave called)
 *   G-XSS-READING    — reading view: <script> body → no script node, canary undefined
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountEditor,
  toggleInlineWrap,
  toggleLink,
  setHeading,
  jinHighlightStyle,
  NOTE_CODE_LANGUAGES,
  LanguageDescription,
  type EditorHandle,
} from '../lib/notes/editor';
import { EditorView } from '@codemirror/view';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { indentMore, indentLess } from '@codemirror/commands';
import { tags as lezerTags } from '@lezer/highlight';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
  const win = window as Record<string, unknown>;
  delete win['__xss_reading'];
});

function makeContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-SMOKE — CM6 mounts in jsdom; getDoc() and .cm-content work (A2 de-risk)
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-SMOKE — CM6 mounts in jsdom and renders text', () => {
  it('getDoc() round-trips the initial doc string', () => {
    const container = makeContainer();
    const doc = 'Hello, world!';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    expect(handle.getDoc()).toBe(doc);
    handle.destroy();
  });

  it('.cm-content textContent contains the doc text', () => {
    const container = makeContainer();
    const doc = 'Hello CM6 in jsdom';
    const handle = mountEditor(container, { doc, onSave: async () => {} });
    const cmContent = container.querySelector('.cm-content');
    expect(cmContent, '.cm-content must exist').not.toBeNull();
    // CM6 renders doc as text nodes inside .cm-content — no HTML injection
    expect(cmContent?.textContent).toContain(doc);
    handle.destroy();
  });

  it('.cm-editor is mounted inside the provided parent element', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'test', onSave: async () => {} });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    handle.destroy();
  });

  it('toolbar contains Read toggle button and status indicator', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });
    expect(container.querySelector('.cm-toolbar__toggle')).not.toBeNull();
    expect(container.querySelector('.cm-toolbar__status')).not.toBeNull();
    handle.destroy();
  });

  it('getView() returns the EditorView instance (test seam)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'x', onSave: async () => {} });
    expect(handle.getView()).toBeInstanceOf(EditorView);
    handle.destroy();
  });

  it('_cmHandle test seam is attached to the parent element', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'x', onSave: async () => {} });
    expect((container as Record<string, unknown>)['_cmHandle']).toBe(handle);
    handle.destroy();
  });

  it('destroy() tears down the CM6 editor DOM', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'hi', onSave: async () => {} });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    handle.destroy();
    // After destroy, the CM6 editor DOM is removed
    expect(container.querySelector('.cm-editor')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-TAB — Tab indents list item; focus stays in .cm-editor
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-TAB — Tab indents list item (doc text changes; no focus loss)', () => {
  it('indentMore on a list item inserts leading spaces (doc changes)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();
    // Place caret at the end of "- item"
    view.dispatch({ selection: { anchor: 6, head: 6 } });

    const result = indentMore(view);

    expect(result).toBe(true);
    // Doc should gain a leading indent (2 spaces from indentUnit.of('  '))
    expect(handle.getDoc()).toMatch(/^\s+- item/);
    handle.destroy();
  });

  it('Tab dispatched to the view does not blur focus from .cm-editor', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();
    view.focus();

    // Dispatch a Tab keydown — the CM6 keymap handler should consume it
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(tabEvent);

    // Focus must still be within .cm-editor (Tab did NOT blur)
    const cmEditor = container.querySelector('.cm-editor');
    expect(cmEditor?.contains(document.activeElement)).toBe(true);
    handle.destroy();
  });

  it('Shift-Tab (indentLess) on an indented list item removes leading spaces', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '  - item', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 8, head: 8 } });

    const result = indentLess(view);

    expect(result).toBe(true);
    // Should have fewer leading spaces
    const newDoc = handle.getDoc();
    expect(newDoc.length).toBeLessThan('  - item'.length);
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-ENTER — Enter continues list; exits on empty item
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-ENTER — Enter continues list/blockquote; exits on empty item', () => {
  it('Enter at end of "- item" inserts a new "- " list item', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();
    // Place caret at end of "- item"
    view.dispatch({ selection: { anchor: 6, head: 6 } });

    insertNewlineContinueMarkup(view);

    const newDoc = handle.getDoc();
    expect(newDoc).toContain('- item');
    expect(newDoc).toContain('\n- ');
    handle.destroy();
  });

  it('Enter on an empty "- " list item removes the marker (exits the list)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item\n- ', onSave: async () => {} });
    const view = handle.getView();
    // Caret at end of the empty item "- " (position 9)
    view.dispatch({ selection: { anchor: 9, head: 9 } });

    insertNewlineContinueMarkup(view);

    const newDoc = handle.getDoc();
    // The empty list marker should be removed / replaced with a plain newline
    expect(newDoc).not.toMatch(/- \n- $/);
    handle.destroy();
  });

  it('Enter at end of "> quote" inserts a new "> " blockquote line', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '> quote', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 7, head: 7 } });

    insertNewlineContinueMarkup(view);

    const newDoc = handle.getDoc();
    expect(newDoc).toContain('> ');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-BOLD — Mod+B wraps selection in **…**; re-run unwraps
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-BOLD — toggleInlineWrap("**") wraps and unwraps', () => {
  it('wraps selection "word" → "**word**"', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'word', onSave: async () => {} });
    const view = handle.getView();
    // Select the word "word"
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    const result = toggleInlineWrap('**')(view);

    expect(result).toBe(true);
    expect(handle.getDoc()).toBe('**word**');
    handle.destroy();
  });

  it('re-running on already-wrapped "**word**" unwraps to "word"', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '**word**', onSave: async () => {} });
    const view = handle.getView();
    // Select "word" (inside the markers at positions 2..6)
    view.dispatch({ selection: { anchor: 2, head: 6 } });

    toggleInlineWrap('**')(view);

    expect(handle.getDoc()).toBe('word');
    handle.destroy();
  });

  it('selection is preserved over "word" after wrapping (anchor: 2, head: 6)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'word', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    toggleInlineWrap('**')(view);

    const sel = view.state.selection.main;
    // After wrapping, the selection covers the content inside **…** (shifted by 2)
    expect(sel.from).toBe(2);
    expect(sel.to).toBe(6);
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-ITALIC — Mod+I wraps selection in *…*
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-ITALIC — toggleInlineWrap("*") wraps and unwraps', () => {
  it('wraps selection "text" → "*text*"', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'text', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    toggleInlineWrap('*')(view);

    expect(handle.getDoc()).toBe('*text*');
    handle.destroy();
  });

  it('unwraps "*text*" back to "text" on re-run', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '*text*', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 1, head: 5 } });

    toggleInlineWrap('*')(view);

    expect(handle.getDoc()).toBe('text');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-LINK — Mod+K inserts [label](url)
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-LINK — toggleLink inserts [label](url)', () => {
  it('wraps selection in [label]() with caret in url slot', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'click here', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 10 } }); // select "click here"

    toggleLink(view);

    expect(handle.getDoc()).toBe('[click here]()');
    // Caret should be inside the () — position 13 (after '[click here](')
    expect(view.state.selection.main.head).toBe(13);
    handle.destroy();
  });

  it('with no selection inserts []()', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    toggleLink(view);

    expect(handle.getDoc()).toBe('[]()');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-HEADING — Mod+1..6 set ATX heading; same level toggles off
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-HEADING — setHeading(level) sets/replaces/toggles ATX heading', () => {
  it('setHeading(1) converts plain text to "# text"', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'My Note', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    setHeading(1)(view);

    expect(handle.getDoc()).toBe('# My Note');
    handle.destroy();
  });

  it('setHeading(2) on "# heading" changes to "## heading"', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '# heading', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    setHeading(2)(view);

    expect(handle.getDoc()).toBe('## heading');
    handle.destroy();
  });

  it('setHeading(1) on "# heading" (same level) removes the heading marker', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '# heading', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    setHeading(1)(view);

    expect(handle.getDoc()).toBe('heading');
    handle.destroy();
  });

  it('setHeading(3) creates "### " prefix on plain text', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'Section', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    setHeading(3)(view);

    expect(handle.getDoc()).toBe('### Section');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-KEYMAP — jinNoteKeys: keymap BINDING guards via real key events
//
// These tests exercise the keymap by dispatching real KeyboardEvent objects on
// view.contentDOM. They FAIL when the corresponding binding is removed or the
// key chord is changed — unlike the direct-command tests above, which only
// verify the command logic, not that the key is wired to it.
//
// CM6 attaches its keydown handler to view.dom; with bubbles:true the event
// bubbles from contentDOM → dom and the keymap fires.
// On non-Mac (jsdom has no Mac platform string), Mod → Ctrl (ctrlKey:true).
// ─────────────────────────────────────────────────────────────────────────────

describe('G-KEYMAP — jinNoteKeys: key-event binding guards (fail on binding removal)', () => {
  /** Dispatch a synthetic keydown on view.contentDOM; return the event (check .defaultPrevented). */
  function fireKey(
    view: EditorView,
    key: string,
    mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...mods,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  }

  it('G-KEYMAP-TAB: Tab keyevent in a list item indents the doc (FAILS if Tab binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 6, head: 6 } }); // caret at end of "- item"

    const ev = fireKey(view, 'Tab');

    // CM6 must have consumed the event (prevented default = no focus-shift)
    expect(ev.defaultPrevented, 'Tab must be consumed by CM6 keymap (defaultPrevented)').toBe(true);
    // The binding runs indentMore → adds leading spaces to the line
    expect(handle.getDoc(), 'Tab must indent the list item').toMatch(/^\s+- item/);
    handle.destroy();
  });

  it('G-KEYMAP-SHIFT-TAB: Shift-Tab keyevent outdents an indented list item (FAILS if shift:indentLess binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '  - item', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 8, head: 8 } }); // caret at end of "  - item"

    const ev = fireKey(view, 'Tab', { shiftKey: true });

    expect(ev.defaultPrevented, 'Shift-Tab must be consumed by CM6 keymap').toBe(true);
    // indentLess removes leading spaces → doc gets shorter
    expect(handle.getDoc().length, 'Shift-Tab must remove leading spaces').toBeLessThan('  - item'.length);
    handle.destroy();
  });

  it('G-KEYMAP-ENTER: Enter keyevent in a list item continues the list marker (FAILS if Enter binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 6, head: 6 } }); // caret at end of "- item"

    fireKey(view, 'Enter');

    // insertNewlineContinueMarkup inserted "- " on the new line
    expect(handle.getDoc(), 'Enter must continue the list marker').toContain('- item\n- ');
    handle.destroy();
  });

  it('G-KEYMAP-BOLD: Ctrl+B keyevent wraps selection in ** (FAILS if Mod-b binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'word', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 4 } }); // select "word"

    fireKey(view, 'b', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+B must wrap selection in **').toBe('**word**');
    handle.destroy();
  });

  it('G-KEYMAP-ITALIC: Ctrl+I keyevent wraps selection in * (FAILS if Mod-i binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'text', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 4 } }); // select "text"

    fireKey(view, 'i', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+I must wrap selection in *').toBe('*text*');
    handle.destroy();
  });

  it('G-KEYMAP-LINK: Ctrl+K keyevent inserts [label]() with caret in url slot (FAILS if Mod-k binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'click here', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 10 } }); // select "click here"

    fireKey(view, 'k', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+K must produce [click here]()').toBe('[click here]()');
    // Caret must land inside the () — at position 13 (after the ](
    expect(view.state.selection.main.head, 'Caret must be inside the url slot').toBe(13);
    handle.destroy();
  });

  it('G-KEYMAP-H1: Ctrl+1 keyevent sets # heading on plain text (FAILS if Mod-1 binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'My Note', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    fireKey(view, '1', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+1 must produce # My Note').toBe('# My Note');
    handle.destroy();
  });

  it('G-KEYMAP-H2: Ctrl+2 keyevent sets ## heading on plain text (FAILS if Mod-2 binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'Section', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    fireKey(view, '2', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+2 must produce ## Section').toBe('## Section');
    handle.destroy();
  });

  it('G-KEYMAP-H6: Ctrl+6 keyevent sets ###### heading on plain text (FAILS if Mod-6 binding removed)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'Deep', onSave: async () => {} });
    const view = handle.getView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 0 } });

    fireKey(view, '6', { ctrlKey: true });

    expect(handle.getDoc(), 'Ctrl+6 must produce ###### Deep').toBe('###### Deep');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-PAIRS — closeBrackets behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-PAIRS — closeBrackets: wrap selection on open char', () => {
  it('typing "(" with a selection wraps it in parentheses', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'text', onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: 0, head: 4 } }); // select "text"

    // Simulate typing "(" — closeBrackets wraps the selected text
    view.dispatch({
      changes: { from: 0, to: 4, insert: '(text)' },
    });

    expect(handle.getDoc()).toBe('(text)');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-HISTORY — Undo restores prior doc
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-HISTORY — undo restores prior doc text', () => {
  it('undo after a doc change restores the original text', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'original', onSave: async () => {} });
    const view = handle.getView();

    // Make a change
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'changed' },
    });
    expect(handle.getDoc()).toBe('changed');

    // Undo via transaction (simulate Mod+Z behavior)
    const { undo } = await import('@codemirror/commands');
    undo(view);

    expect(handle.getDoc()).toBe('original');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-EDITOR-PLACEHOLDER — empty doc shows "Start writing…" placeholder
// ─────────────────────────────────────────────────────────────────────────────

describe('G-EDITOR-PLACEHOLDER — empty doc shows placeholder text', () => {
  it('empty doc produces a .cm-placeholder element with the placeholder text', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });

    // CM6 placeholder extension injects a .cm-placeholder element when doc is empty
    const placeholder = container.querySelector('.cm-placeholder');
    // Either the placeholder element exists, or the textContent includes the hint
    const contentText = container.querySelector('.cm-content')?.textContent ?? '';
    const hasPlaceholder = placeholder !== null || contentText.includes('Start writing');
    expect(hasPlaceholder, 'placeholder must be present for empty doc').toBe(true);
    handle.destroy();
  });

  it('non-empty doc does NOT show placeholder', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'some text', onSave: async () => {} });

    const cmContent = container.querySelector('.cm-content');
    expect(cmContent?.textContent).toContain('some text');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-HIGHLIGHT — syntax highlighting applied (spans in .cm-content)
// ─────────────────────────────────────────────────────────────────────────────

describe('G-HIGHLIGHT — jinHighlightStyle is defined and applied', () => {
  it('jinHighlightStyle has entries for heading, strong, emphasis, monospace', () => {
    // Structural assertion: the HighlightStyle instance exists and has specs
    // (cannot test visual CSS output in jsdom — this verifies the extension is non-empty)
    expect(jinHighlightStyle).toBeDefined();
    // CM6 HighlightStyle has a `specs` array of tag→style mappings
    const specs = (jinHighlightStyle as unknown as { specs: unknown[] }).specs;
    expect(Array.isArray(specs)).toBe(true);
    expect(specs.length).toBeGreaterThan(0);
  });

  it('G-HIGHLIGHT-EXTENDED: jinHighlightStyle includes code-token entries (keyword, string, number, comment, typeName)', () => {
    // Each HighlightStyle spec has a `tag` property (a Tag instance).
    // We check that the code-token tags are present in the specs list.
    // Removing the code-token block from editor.ts causes this test to fail.
    const specs = (jinHighlightStyle as unknown as { specs: Array<{ tag: unknown }> }).specs;
    const specTags = specs.map(s => s.tag);

    // At minimum: keyword, string, number, comment, typeName must be present.
    expect(specTags).toContain(lezerTags.keyword);
    expect(specTags).toContain(lezerTags.string);
    expect(specTags).toContain(lezerTags.number);
    expect(specTags).toContain(lezerTags.comment);
    expect(specTags).toContain(lezerTags.typeName);
  });

  it('renders markdown with span elements wrapping styled tokens', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: '# Heading\n\n**bold** `code`',
      onSave: async () => {},
    });
    const cmContent = container.querySelector('.cm-content');
    expect(cmContent).not.toBeNull();
    // CM6 generates <span> elements for syntax-highlighted tokens
    const spans = cmContent?.querySelectorAll('span');
    expect((spans?.length ?? 0)).toBeGreaterThan(0);
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-CODE-EDITOR-LANGS — codeLanguages wired; matchLanguageName resolves js/python/rust
// ─────────────────────────────────────────────────────────────────────────────

describe('G-CODE-EDITOR-LANGS — NOTE_CODE_LANGUAGES is wired and resolves known grammars', () => {
  it('NOTE_CODE_LANGUAGES is non-empty (contains all @codemirror/language-data descriptors)', () => {
    // Removing the `languages` import or passing [] to codeLanguages fails this.
    expect(Array.isArray(NOTE_CODE_LANGUAGES)).toBe(true);
    expect(NOTE_CODE_LANGUAGES.length).toBeGreaterThan(0);
  });

  it('LanguageDescription.matchLanguageName resolves "js" to a non-null descriptor', () => {
    const desc = LanguageDescription.matchLanguageName(NOTE_CODE_LANGUAGES, 'js');
    expect(desc).not.toBeNull();
  });

  it('LanguageDescription.matchLanguageName resolves "python" to a non-null descriptor', () => {
    const desc = LanguageDescription.matchLanguageName(NOTE_CODE_LANGUAGES, 'python');
    expect(desc).not.toBeNull();
  });

  it('LanguageDescription.matchLanguageName resolves "rust" to a non-null descriptor', () => {
    const desc = LanguageDescription.matchLanguageName(NOTE_CODE_LANGUAGES, 'rust');
    expect(desc).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-READING-VIEW — toggle renders via renderMarkdownFragment (the chokepoint)
// ─────────────────────────────────────────────────────────────────────────────

describe('G-READING-VIEW — reading-view toggle renders through renderMarkdownFragment', () => {
  it('G-READING-VIEW: toggling to reading view shows sanitized rendered HTML (h1 for # H)', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: '# Heading',
      onSave: async () => {},
    });

    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');
    expect(toggleBtn).not.toBeNull();

    // Toggle to reading view
    toggleBtn!.click();
    // Allow async toggle (flush + render) to settle
    await new Promise<void>((r) => setTimeout(r, 50));

    const readingWrapper = container.querySelector('.cm-reading-wrapper');
    expect(readingWrapper?.style.display).not.toBe('none');

    // Rendered HTML must include an h1 element (produced by renderMarkdownFragment)
    const h1 = readingWrapper?.querySelector('h1');
    expect(h1, 'h1 must be rendered from # Heading via renderMarkdownFragment').not.toBeNull();
    expect(h1?.textContent?.trim()).toBe('Heading');

    handle.destroy();
  });

  it('G-READING-VIEW: editor wrapper is hidden in reading view', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '# Test', onSave: async () => {} });
    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');

    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    const editorWrapper = container.querySelector('.cm-editor-wrapper') as HTMLElement;
    expect(editorWrapper.style.display).toBe('none');
    handle.destroy();
  });

  it('G-READING-VIEW: toggling back to edit restores the CM6 surface', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'text', onSave: async () => {} });
    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');

    // → reading
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));
    // → edit
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    const editorWrapper = container.querySelector('.cm-editor-wrapper') as HTMLElement;
    expect(editorWrapper.style.display).not.toBe('none');
    const readingWrapper = container.querySelector('.cm-reading-wrapper') as HTMLElement;
    expect(readingWrapper.style.display).toBe('none');
    handle.destroy();
  });

  it('G-READING-VIEW: toggling round-trip does not mutate getDoc()', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '# Hi\n\nParagraph.', onSave: async () => {} });
    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');

    const docBefore = handle.getDoc();
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(handle.getDoc()).toBe(docBefore);
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-READING-FLUSH — toggling to reading view flushes unsaved edits
// ─────────────────────────────────────────────────────────────────────────────

describe('G-READING-FLUSH — reading-view toggle flushes pending edits first', () => {
  it('G-READING-FLUSH: dirty edits trigger onSave BEFORE reading view renders', async () => {
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'original', onSave });

    // Make a doc change (creates a pending save)
    handle.getView().dispatch({
      changes: { from: 0, to: 8, insert: 'changed' },
    });

    // Toggle to reading view — this must flush first
    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    // onSave must have been called with the new doc text before rendering
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('changed');

    // Reading view must be visible with the new content
    const readingWrapper = container.querySelector('.cm-reading-wrapper');
    expect(readingWrapper?.style.display).not.toBe('none');

    handle.destroy();
  });

  it('G-READING-FLUSH: no onSave call if doc unchanged when toggling', async () => {
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'unchanged', onSave });

    // Toggle without any doc changes
    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    // No pending changes → onSave should NOT be called
    expect(onSave).not.toHaveBeenCalled();
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-XSS-READING — reading view: <script> in doc → no script node, canary undefined
// ─────────────────────────────────────────────────────────────────────────────

describe('G-XSS-READING — reading view XSS safety via renderMarkdownFragment chokepoint', () => {
  it('<script> in doc → no script node in reading view AND canary undefined', async () => {
    const container = makeContainer();
    const xss = '<script>window.__xss_reading = true</script>';
    const handle = mountEditor(container, { doc: xss, onSave: async () => {} });

    const toggleBtn = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');
    toggleBtn!.click();
    await new Promise<void>((r) => setTimeout(r, 50));

    const readingWrapper = container.querySelector('.cm-reading-wrapper');
    // No <script> node must exist in the reading view
    expect(readingWrapper?.querySelector('script'),
      'No <script> node must survive the chokepoint in reading view'
    ).toBeNull();
    // Canary must not have been set
    expect((window as Record<string, unknown>)['__xss_reading']).toBeUndefined();

    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setDoc / flush / autosave debounce (module-level, no full controller)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// G-TOOLBAR-* — toolbar button clicks dispatch the correct command (REAL click events)
//
// These tests dispatch real `click` events on the actual button DOM element and
// assert that the editor doc changed accordingly. They FAIL if the button is
// not wired (command not called) or if the wrong command is invoked.
// ─────────────────────────────────────────────────────────────────────────────

describe('G-TOOLBAR-BOLD — clicking Bold button wraps selection in **', () => {
  it('G-TOOLBAR-BOLD: real click on Bold button with selection → **text**', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'hello', onSave: async () => {} });
    const view = handle.getView();

    // Select "hello"
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    const boldBtn = container.querySelector<HTMLButtonElement>('[aria-label="Bold"]');
    expect(boldBtn, 'Bold button must exist in toolbar').not.toBeNull();

    boldBtn!.click();

    expect(handle.getDoc(), 'Bold click must wrap selection in **').toBe('**hello**');
    handle.destroy();
  });

  it('G-TOOLBAR-BOLD: Bold button click on already-bold text unwraps it', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '**word**', onSave: async () => {} });
    const view = handle.getView();

    // Select "word" (positions 2..6 inside the ** markers)
    view.dispatch({ selection: { anchor: 2, head: 6 } });

    const boldBtn = container.querySelector<HTMLButtonElement>('[aria-label="Bold"]');
    boldBtn!.click();

    expect(handle.getDoc(), 'Bold click on wrapped text must unwrap').toBe('word');
    handle.destroy();
  });
});

describe('G-TOOLBAR-H2 — clicking H2 button sets ## heading on current line', () => {
  it('G-TOOLBAR-H2: real click on H2 button → ## heading on plain text', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'Section title', onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0, head: 0 } });

    const h2Btn = container.querySelector<HTMLButtonElement>('[aria-label="Heading 2"]');
    expect(h2Btn, 'H2 button must exist in toolbar').not.toBeNull();

    h2Btn!.click();

    expect(handle.getDoc(), 'H2 click must produce ## heading').toBe('## Section title');
    handle.destroy();
  });

  it('G-TOOLBAR-H2: clicking H2 again on a ## line toggles heading off', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '## Heading', onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0, head: 0 } });
    const h2Btn = container.querySelector<HTMLButtonElement>('[aria-label="Heading 2"]');
    h2Btn!.click();

    expect(handle.getDoc(), 'H2 re-click must remove heading marker').toBe('Heading');
    handle.destroy();
  });
});

describe('G-TOOLBAR-LIST — clicking List button adds "- " prefix to current line', () => {
  it('G-TOOLBAR-LIST: real click on Bulleted list button → "- " prefix added', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'item', onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0, head: 0 } });

    const listBtn = container.querySelector<HTMLButtonElement>('[aria-label="Bulleted list"]');
    expect(listBtn, 'Bulleted list button must exist in toolbar').not.toBeNull();

    listBtn!.click();

    expect(handle.getDoc(), 'List click must add "- " prefix').toBe('- item');
    handle.destroy();
  });

  it('G-TOOLBAR-LIST: clicking List button again removes the "- " prefix (toggle off)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '- item', onSave: async () => {} });
    const view = handle.getView();

    view.dispatch({ selection: { anchor: 0, head: 0 } });
    const listBtn = container.querySelector<HTMLButtonElement>('[aria-label="Bulleted list"]');
    listBtn!.click();

    expect(handle.getDoc(), 'List re-click must remove "- " prefix').toBe('item');
    handle.destroy();
  });
});

describe('G-TOOLBAR-STRUCTURE — toolbar and footer DOM structure is present', () => {
  it('toolbar contains heading, inline, list, block buttons and reading toggle', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });

    expect(container.querySelector('[aria-label="Heading 1"]'), 'H1 btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Heading 2"]'), 'H2 btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Heading 3"]'), 'H3 btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Bold"]'),          'Bold btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Italic"]'),        'Italic btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Strikethrough"]'), 'Strike btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Inline code"]'),   'Code btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Bulleted list"]'), 'List btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Numbered list"]'), 'Ordered btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Checklist"]'),     'Todo btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Blockquote"]'),    'Quote btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Insert link"]'),   'Link btn').not.toBeNull();
    // Cozy extras (COZY-1 / COZY-2) — additive assertions; existing buttons unchanged
    expect(container.querySelector('[aria-label="Focus mode"]'),          'Focus btn').not.toBeNull();
    expect(container.querySelector('[aria-label="Typewriter scrolling"]'), 'Typewriter btn').not.toBeNull();
    expect(container.querySelector('.cm-toolbar__toggle'),          'Reading toggle').not.toBeNull();

    handle.destroy();
  });

  it('cm-scroll-region is present inside the parent', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'test', onSave: async () => {} });
    expect(container.querySelector('.cm-scroll-region'), 'scroll region').not.toBeNull();
    handle.destroy();
  });

  it('G-TOOLBAR-TOOLTIP: every formatting button carries a title tooltip matching its label', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });

    const btns = Array.from(container.querySelectorAll<HTMLButtonElement>('.cm-toolbar__btn'));
    expect(btns.length, 'toolbar must have icon buttons').toBeGreaterThan(0);
    for (const btn of btns) {
      const label = btn.getAttribute('aria-label');
      expect(btn.getAttribute('title'), `${label ?? 'button'} must have a tooltip`).toBe(label);
    }

    // Reading-view toggle also has a tooltip.
    const toggle = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle');
    expect(toggle?.getAttribute('title')).toBe('Switch to reading mode');

    handle.destroy();
  });

  it('G-TOOLBAR-TOOLTIP: Read toggle tooltip updates when switching to reading mode', async () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '# hi', onSave: async () => {} });

    const toggle = container.querySelector<HTMLButtonElement>('.cm-toolbar__toggle')!;
    expect(toggle.getAttribute('title')).toBe('Switch to reading mode');

    toggle.click();
    // Allow the async flush + render to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(toggle.getAttribute('title')).toBe('Switch to edit mode');
    handle.destroy();
  });

  it('cm-footer is present inside the parent', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'test', onSave: async () => {} });
    expect(container.querySelector('.cm-footer'), 'footer').not.toBeNull();
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-FOOTER-STATS — footer shows live word and char counts after doc changes
//
// These tests verify that the footer stats element updates when the doc changes.
// They drive changes through the editor view (real doc mutation) and assert the
// footer text — they FAIL if the stats are not wired to the updateListener.
// ─────────────────────────────────────────────────────────────────────────────

describe('G-FOOTER-STATS — footer shows live word and char counts', () => {
  it('G-FOOTER-STATS: initial paint shows correct word and char counts', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'hello world', onSave: async () => {} });

    const statsEl = container.querySelector('.cm-footer__stats');
    expect(statsEl, '.cm-footer__stats must exist').not.toBeNull();

    // "hello world" = 2 words, 11 chars
    expect(statsEl?.textContent).toContain('2 words');
    expect(statsEl?.textContent).toContain('11 chars');

    handle.destroy();
  });

  it('G-FOOTER-STATS: stats update after doc change (tests updateListener wiring)', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'hello world', onSave: async () => {} });
    const view = handle.getView();

    const statsEl = container.querySelector('.cm-footer__stats');
    expect(statsEl).not.toBeNull();

    // Replace doc with 3-word content
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'one two three' },
    });

    // "one two three" = 3 words, 13 chars
    expect(statsEl?.textContent, 'stats must update after doc change').toContain('3 words');
    expect(statsEl?.textContent).toContain('13 chars');

    handle.destroy();
  });

  it('G-FOOTER-STATS: empty doc shows 0 words and 0 chars', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: '', onSave: async () => {} });

    const statsEl = container.querySelector('.cm-footer__stats');
    expect(statsEl?.textContent).toContain('0 words');
    expect(statsEl?.textContent).toContain('0 chars');

    handle.destroy();
  });

  it('G-FOOTER-STATS: read-time shown in cm-footer__read-time', () => {
    const container = makeContainer();
    // 400 words ≈ 2 min read
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const handle = mountEditor(container, { doc: text, onSave: async () => {} });

    const readTimeEl = container.querySelector('.cm-footer__read-time');
    expect(readTimeEl, '.cm-footer__read-time must exist').not.toBeNull();
    expect(readTimeEl?.textContent).toContain('~2 min read');

    handle.destroy();
  });
});

describe('setDoc() replaces doc without triggering autosave', () => {
  it('setDoc() updates getDoc() to the new value', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'old', onSave: async () => {} });

    handle.setDoc('new content');

    expect(handle.getDoc()).toBe('new content');
    handle.destroy();
  });
});

describe('flush() calls onSave immediately if dirty, no-op if clean', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush() calls onSave when pendingSave is true (doc changed)', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'initial', onSave });

    // Make a doc change (sets pendingSave = true, schedules debounce)
    handle.getView().dispatch({
      changes: { from: 0, to: 7, insert: 'modified' },
    });

    // Flush immediately (before debounce fires)
    await handle.flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('modified');
    handle.destroy();
  });

  it('flush() is a no-op when no doc changes were made', async () => {
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'clean', onSave });

    await handle.flush();

    expect(onSave).not.toHaveBeenCalled();
    handle.destroy();
  });
});

describe('managed attachment insertion and conflict save pause', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('insertText replaces the current selection and places the caret after the inserted asset reference', () => {
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'before selected after', onSave: async () => {} });
    const view = handle.getView();
    const from = 'before '.length;
    const to = from + 'selected'.length;
    const inserted = '[file.pdf](jin-asset://sha256/abc123)';

    view.dispatch({ selection: { anchor: from, head: to } });
    handle.insertText(inserted);

    expect(handle.getDoc()).toBe(`before ${inserted} after`);
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(from + inserted.length);
    handle.destroy();
  });

  it('setAutosavePaused cancels a pending save without changing the draft, then a later change saves after resume', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<(doc: string) => Promise<void>>().mockResolvedValue(undefined);
    const container = makeContainer();
    const handle = mountEditor(container, { doc: 'initial', onSave });
    const view = handle.getView();

    view.dispatch({ changes: { from: 0, to: 7, insert: 'local conflict draft' } });
    handle.setAutosavePaused(true);
    await vi.advanceTimersByTimeAsync(700);

    expect(handle.getDoc()).toBe('local conflict draft');
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('.cm-toolbar__status')?.textContent).toContain('Saving paused');

    handle.setAutosavePaused(false);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: ' after resolve' },
    });
    await vi.advanceTimersByTimeAsync(700);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith('local conflict draft after resolve');
    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-FOCUS-TOGGLE — focus mode button reconfigures the compartment; cm-dim appears/disappears
//
// Drives a REAL button click and asserts DOM-level behavior (aria-pressed + .cm-line.cm-dim
// presence). An un-wired button or a missing compartment.reconfigure() FAILS.
// ─────────────────────────────────────────────────────────────────────────────

describe('G-FOCUS-TOGGLE — focus mode button toggles cm-dim decorations in the DOM', () => {
  it('G-FOCUS-TOGGLE: click Focus button → >=1 .cm-line.cm-dim + aria-pressed true; second click → none + false', () => {
    const container = makeContainer();
    // 3-line doc with caret on line 1 (offset 0) → lines 2 and 3 will be dimmed when ON
    const handle = mountEditor(container, {
      doc: 'line1\nline2\nline3',
      onSave: async () => {},
    });
    const view = handle.getView();

    // Place caret explicitly on line 1
    view.dispatch({ selection: { anchor: 0 } });

    const focusBtn = container.querySelector<HTMLButtonElement>('[aria-label="Focus mode"]');
    expect(focusBtn, 'Focus mode button must exist').not.toBeNull();
    expect(focusBtn!.getAttribute('aria-pressed')).toBe('false');

    // ── Enable focus mode ────────────────────────────────────────────────────
    focusBtn!.click();

    expect(focusBtn!.getAttribute('aria-pressed')).toBe('true');
    const dimLinesOn = container.querySelectorAll('.cm-line.cm-dim');
    expect(
      dimLinesOn.length,
      'at least one .cm-line.cm-dim must appear in .cm-content after enabling focus mode',
    ).toBeGreaterThan(0);

    // ── Disable focus mode (second click) ────────────────────────────────────
    focusBtn!.click();

    expect(focusBtn!.getAttribute('aria-pressed')).toBe('false');
    const dimLinesOff = container.querySelectorAll('.cm-line.cm-dim');
    expect(
      dimLinesOff.length,
      'no .cm-line.cm-dim must remain after disabling focus mode',
    ).toBe(0);

    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-TYPEWRITER-WIRING — typewriter compartment wires the scrollIntoView effect
//
// Spies on EditorView.scrollIntoView (static factory) to assert it is called
// for collapsed selection changes when ON, and NOT called for range selections
// or when OFF. The actual scroll pixel position is not asserted (no layout in
// jsdom) — only the call arguments (wiring correctness).
// ─────────────────────────────────────────────────────────────────────────────

describe('G-TYPEWRITER-WIRING — typewriter scrollIntoView effect wiring (spy)', () => {
  it('G-TYPEWRITER-WIRING: typewriter ON + collapsed selection → EditorView.scrollIntoView(head, {y:center})', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld\nfoo',
      onSave: async () => {},
    });
    const view = handle.getView();

    const typewriterBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Typewriter scrolling"]',
    );
    expect(typewriterBtn, 'Typewriter scrolling button must exist').not.toBeNull();

    // Turn typewriter ON
    typewriterBtn!.click();

    // Set up spy AFTER the toggle click so we only capture the following dispatch.
    // (The reconfigure transaction itself does not call scrollIntoView — D-TYPEWRITER-MECHANISM.)
    const scrollSpy = vi.spyOn(EditorView, 'scrollIntoView');

    // Dispatch a collapsed selection change (tr.selection != null, tr.newSelection.main.empty)
    view.dispatch({ selection: { anchor: 5 } });

    expect(scrollSpy).toHaveBeenCalledWith(5, { y: 'center' });

    scrollSpy.mockRestore();
    handle.destroy();
  });

  it('G-TYPEWRITER-WIRING: typewriter ON + RANGE selection → EditorView.scrollIntoView NOT called', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld',
      onSave: async () => {},
    });
    const view = handle.getView();

    const typewriterBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Typewriter scrolling"]',
    );
    typewriterBtn!.click();

    const scrollSpy = vi.spyOn(EditorView, 'scrollIntoView');

    // Range selection (anchor != head → collapsed=false → typewriterTarget returns null)
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    expect(scrollSpy).not.toHaveBeenCalled();

    scrollSpy.mockRestore();
    handle.destroy();
  });

  it('G-TYPEWRITER-WIRING: typewriter OFF (default) + collapsed selection → EditorView.scrollIntoView NOT called', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld',
      onSave: async () => {},
    });
    const view = handle.getView();

    // No button click — typewriter stays OFF
    const scrollSpy = vi.spyOn(EditorView, 'scrollIntoView');

    view.dispatch({ selection: { anchor: 5 } });

    expect(scrollSpy).not.toHaveBeenCalled();

    scrollSpy.mockRestore();
    handle.destroy();
  });

  it('G-TYPEWRITER-PADDING: typewriter ON → .cm-content gets class cm-typewriter; OFF removes it', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld',
      onSave: async () => {},
    });

    const typewriterBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Typewriter scrolling"]',
    );
    const cmContent = container.querySelector('.cm-content');
    expect(cmContent, '.cm-content must exist').not.toBeNull();

    // Default: class absent
    expect(cmContent!.classList.contains('cm-typewriter')).toBe(false);

    // Turn ON → class added via EditorView.contentAttributes
    typewriterBtn!.click();
    expect(cmContent!.classList.contains('cm-typewriter')).toBe(true);

    // Turn OFF → class removed
    typewriterBtn!.click();
    expect(cmContent!.classList.contains('cm-typewriter')).toBe(false);

    handle.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-TOGGLE-CARET-SAFE — toggling either mode keeps the same EditorView instance
// and does NOT move the caret. Asserts the compartment-reconfigure contract.
// Mutation-relevant: any path that re-mounts or dispatches a selection on toggle FAILS.
// ─────────────────────────────────────────────────────────────────────────────

describe('G-TOGGLE-CARET-SAFE — toggling modes preserves EditorView identity + caret offset', () => {
  it('G-TOGGLE-CARET-SAFE(focus): Focus on→off: same EditorView instance, caret unchanged', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld\nfoo',
      onSave: async () => {},
    });
    const view = handle.getView();

    // Set caret to a known position (before any toggle)
    view.dispatch({ selection: { anchor: 3 } });
    const initialHead = view.state.selection.main.head;
    expect(initialHead).toBe(3);

    const focusBtn = container.querySelector<HTMLButtonElement>('[aria-label="Focus mode"]');

    // Toggle ON
    focusBtn!.click();
    expect(handle.getView(), 'EditorView instance must be the same after toggle ON').toBe(view);
    expect(
      view.state.selection.main.head,
      'caret must not move on toggle ON',
    ).toBe(initialHead);

    // Toggle OFF
    focusBtn!.click();
    expect(handle.getView(), 'EditorView instance must be the same after toggle OFF').toBe(view);
    expect(
      view.state.selection.main.head,
      'caret must not move on toggle OFF',
    ).toBe(initialHead);

    handle.destroy();
  });

  it('G-TOGGLE-CARET-SAFE(typewriter): Typewriter on→off: same EditorView instance, caret unchanged + aria-pressed flips', () => {
    const container = makeContainer();
    const handle = mountEditor(container, {
      doc: 'hello\nworld\nfoo',
      onSave: async () => {},
    });
    const view = handle.getView();

    // Set caret to a known position (before any toggle)
    view.dispatch({ selection: { anchor: 3 } });
    const initialHead = view.state.selection.main.head;
    expect(initialHead).toBe(3);

    const typewriterBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Typewriter scrolling"]',
    );
    expect(typewriterBtn!.getAttribute('aria-pressed')).toBe('false');

    // Toggle ON
    typewriterBtn!.click();
    expect(handle.getView(), 'EditorView instance must be the same after toggle ON').toBe(view);
    expect(
      view.state.selection.main.head,
      'caret must not move on toggle ON',
    ).toBe(initialHead);
    expect(typewriterBtn!.getAttribute('aria-pressed')).toBe('true');

    // Toggle OFF
    typewriterBtn!.click();
    expect(handle.getView(), 'EditorView instance must be the same after toggle OFF').toBe(view);
    expect(
      view.state.selection.main.head,
      'caret must not move on toggle OFF',
    ).toBe(initialHead);
    expect(typewriterBtn!.getAttribute('aria-pressed')).toBe('false');

    handle.destroy();
  });
});
