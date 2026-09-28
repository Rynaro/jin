// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { composedLinkPaste } from '../lib/notes/editor';
import { LinkCardWidget } from '../lib/notes/livePreview';
import { renderMarkdownFragment } from '../lib/notes/markdown';

const state = (doc: string, anchor: number, head = anchor) => {
  const value = EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ base: markdownLanguage }), history()] });
  ensureSyntaxTree(value, value.doc.length, 5000);
  return value;
};

describe('Notes link composition', () => {
  it('pastes one safe URL over selected prose as one undoable inline link', () => {
    const host = document.createElement('div'); document.body.append(host);
    const view = new EditorView({ parent: host, state: state('A [plan] draft', 2, 8) });
    const paste = composedLinkPaste(view.state, 'https://example.com/a?x=1&y=2')!;
    expect(paste.insert).toBe('[\\[plan\\]](https://example.com/a?x=1&y=2)');
    view.dispatch({ changes: paste, annotations: Transaction.userEvent.of('input.paste') });
    expect(view.state.doc.toString()).toContain('https://example.com/a?x=1&y=2');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('A [plan] draft');
    view.destroy(); host.remove();
  });

  it('turns a URL on an empty paragraph into one canonical authored card', () => {
    const current = state('Before\n\nAfter', 7);
    expect(composedLinkPaste(current, 'https://example.com/path')?.insert)
      .toBe('[example.com](https://example.com/path "jin-card")');
    const markup = renderMarkdownFragment('[https://example.com](https://example.com "jin-card")');
    expect(markup.querySelector('.jin-link-card')?.textContent).toBe('https://example.com');
  });

  it('leaves code, multiline, unsafe, and multi-selection paste unchanged', () => {
    expect(composedLinkPaste(state('```\n\n```', 4), 'https://example.com')).toBeNull();
    expect(composedLinkPaste(state('a `code` b', 0, 10), 'https://example.com')).toBeNull();
    expect(composedLinkPaste(state('text', 2), 'https://example.com\nmore')).toBeNull();
    expect(composedLinkPaste(state('', 0), 'mailto:person@example.com')).toBeNull();
    const multi = EditorState.create({ doc: 'one two', selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]), extensions: [markdown({ base: markdownLanguage })] });
    expect(composedLinkPaste(multi, 'https://example.com')).toBeNull();
  });

  it('edits a focused card with Enter without inserting a newline', () => {
    const doc = '[Project](https://example.com "jin-card")';
    const host = document.createElement('div'); document.body.append(host);
    const view = new EditorView({ parent: host, state: state(doc, doc.length) });
    const widget = new LinkCardWidget('Project', 'https://example.com', 0).toDOM(view);
    host.append(widget);
    const edit = widget.querySelector<HTMLButtonElement>('.cm-link-card-widget__edit')!;
    edit.focus();
    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    edit.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(view.state.selection.main.head).toBe(1);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy(); host.remove();
  });
});
