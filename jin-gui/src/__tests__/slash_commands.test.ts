// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Transaction } from '@codemirror/state';
import { CompletionContext, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { undo } from '@codemirror/commands';
import { mountEditor, type EditorHandle } from '../lib/notes/editor';
import { dismissSlashCommands, noteSlashCompletions } from '../lib/notes/slashCommands';

function mount(doc = ''): EditorHandle {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return mountEditor(parent, { doc, onSave: async () => {} });
}

function typeSlashQuery(handle: EditorHandle, text: string): void {
  const view = handle.getView();
  const from = view.state.selection.main.head;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
    annotations: Transaction.userEvent.of('input.type'),
  });
}

function slashResult(handle: EditorHandle) {
  const view = handle.getView();
  return noteSlashCompletions(new CompletionContext(view.state, view.state.selection.main.head, true));
}

afterEach(() => { document.body.replaceChildren(); });

describe('G-NOTE-SLASH-COMMANDS — structured Markdown from an empty paragraph', () => {
  it('recognizes a slash query as a standalone completion source', () => {
    const handle = mount('/che');
    const view = handle.getView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const result = slashResult(handle);
    expect(result?.from).toBe(1);
    expect(result?.options.map(option => option.label)).toContain('Checklist');
    handle.destroy();
  });

  it('replaces a typed /che once with a checklist in one undo step', () => {
    const handle = mount();
    typeSlashQuery(handle, '/che');
    const view = handle.getView();

    const result = slashResult(handle)!;
    const checklist = result.options.find(option => option.label === 'Checklist')!;
    checklist.apply!(view, checklist, result.from, result.to!);
    expect(handle.getDoc()).toBe('- [ ] ');
    expect(view.state.selection.main.head).toBe(6);
    expect(undo(view)).toBe(true);
    expect(handle.getDoc()).toBe('/che');
    handle.destroy();
  });

  it('preserves allowed indentation and places a code-block caret inside its fence', () => {
    const handle = mount('  ');
    const view = handle.getView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    typeSlashQuery(handle, '/code');
    const result = slashResult(handle)!;
    const code = result.options.find(option => option.label === 'Code block')!;
    code.apply!(view, code, result.from, result.to!);
    expect(handle.getDoc()).toBe('  ```\n\n```');
    expect(view.state.selection.main.head).toBe(6);
    handle.destroy();
  });

  it('uses an unambiguous thematic break below prose', () => {
    const handle = mount('A paragraph\n');
    const view = handle.getView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    typeSlashQuery(handle, '/divider');
    const result = slashResult(handle)!;
    const divider = result.options.find(option => option.label === 'Divider')!;
    divider.apply!(view, divider, result.from, result.to!);
    expect(handle.getDoc()).toBe('A paragraph\n***\n');
    handle.destroy();
  });

  it.each([
    'prose /check',
    '/check suffix',
    '    /check',
    '```md\n/check\n```',
    '`/check`',
  ])('does not offer blocks outside an otherwise empty editable paragraph: %s', (doc) => {
    const handle = mount(doc);
    const view = handle.getView();
    view.dispatch({ selection: { anchor: doc.indexOf('/check') + '/check'.length } });
    expect(slashResult(handle)).toBeNull();
    handle.destroy();
  });

  it('leaves the source document unchanged until a command is accepted', () => {
    const handle = mount();
    typeSlashQuery(handle, '/');
    expect(slashResult(handle)).not.toBeNull();
    expect(handle.getDoc()).toBe('/');
    handle.destroy();
  });

  it('keeps an escaped query literal until deletion or a fresh slash clears the dismissal', () => {
    const handle = mount();
    const view = handle.getView();
    typeSlashQuery(handle, '/');
    view.dispatch({ effects: dismissSlashCommands.of(true) });
    typeSlashQuery(handle, 'che');
    expect(slashResult(handle)).toBeNull();

    const caret = view.state.selection.main.head;
    view.dispatch({
      changes: { from: caret - 1, to: caret },
      selection: { anchor: caret - 1 },
      annotations: Transaction.userEvent.of('delete.backward'),
    });
    expect(slashResult(handle)).not.toBeNull();

    view.dispatch({ effects: dismissSlashCommands.of(true) });
    typeSlashQuery(handle, '\n/check');
    expect(slashResult(handle)).not.toBeNull();
    handle.destroy();
  });

  it('does not expose slash commands through explicit completion in read-only mode', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const handle = mountEditor(parent, { doc: '/check', readOnly: true, onSave: async () => {} });
    const view = handle.getView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    expect(completionStatus(view.state)).toBeNull();
    expect(parent.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    handle.destroy();
  });
});
