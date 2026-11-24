import { type EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
} from '@codemirror/autocomplete';

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText']);

export const dismissSlashCommands = StateEffect.define<boolean>();

function insertedSlash(transaction: Transaction): boolean {
  let found = false;
  transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, insert) => {
    if (insert.toString().includes('/')) found = true;
  });
  return found;
}

function selectionChangedLine(transaction: Transaction): boolean {
  const before = transaction.startState.selection.main.head;
  const after = transaction.state.selection.main.head;
  return transaction.startState.doc.lineAt(before).number !== transaction.state.doc.lineAt(after).number;
}

/** Keeps an escaped slash query literal until the writer starts a fresh command. */
export const slashCommandDismissal = StateField.define<boolean>({
  create: () => false,
  update(dismissed, transaction) {
    if (transaction.effects.some(effect => effect.is(dismissSlashCommands))) return true;
    if (!dismissed) return false;
    if (transaction.isUserEvent('delete') || selectionChangedLine(transaction)) return false;
    return transaction.isUserEvent('input.type') && insertedSlash(transaction) ? false : dismissed;
  },
});

type SlashTemplate = {
  label: string;
  detail: string;
  insert: string;
  selection?: (from: number) => { anchor: number; head?: number };
};

const TABLE = '| Heading 1 | Heading 2 |\n| --- | --- |\n| Cell | Cell |';

const COMMANDS: readonly SlashTemplate[] = [
  { label: 'Heading 1', detail: '# Heading', insert: '# ' },
  { label: 'Heading 2', detail: '## Heading', insert: '## ' },
  { label: 'Heading 3', detail: '### Heading', insert: '### ' },
  { label: 'Bulleted list', detail: '- Item', insert: '- ' },
  { label: 'Numbered list', detail: '1. Item', insert: '1. ' },
  { label: 'Checklist', detail: '- [ ] Task', insert: '- [ ] ' },
  { label: 'Quote', detail: '> Quote', insert: '> ' },
  { label: 'Code block', detail: '```', insert: '```\n\n```', selection: from => ({ anchor: from + 4 }) },
  {
    label: 'Table',
    detail: '| Column |',
    insert: TABLE,
    selection: from => ({ anchor: from + 2, head: from + 11 }),
  },
  { label: 'Divider', detail: '***', insert: '***\n', selection: from => ({ anchor: from + 4 }) },
];

function isCodePosition(state: EditorState, position: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
  while (node) {
    if (CODE_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

function slashRange(state: EditorState, position: number): { from: number; to: number } | null {
  const selection = state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;
  const line = state.doc.lineAt(position);
  const before = state.sliceDoc(line.from, position);
  const after = state.sliceDoc(position, line.to);
  if (!/^ {0,3}\/[^\s/]*$/.test(before) || after.trim() !== '') return null;
  if (isCodePosition(state, position)) return null;
  return { from: line.from + before.indexOf('/') + 1, to: position };
}

function completionFor(template: SlashTemplate): Completion {
  return {
    label: template.label,
    detail: template.detail,
    type: 'keyword',
    apply(view, completion, from, to) {
      const slash = from - 1;
      const selection = template.selection?.(slash) ?? { anchor: slash + template.insert.length };
      view.dispatch(view.state.update({
        changes: { from: slash, to, insert: template.insert },
        selection,
        scrollIntoView: true,
        annotations: [Transaction.userEvent.of('input.complete'), pickedCompletion.of(completion)],
      }));
    },
  };
}

const OPTIONS = COMMANDS.map(completionFor);

/** Completion source for Markdown blocks at an otherwise empty paragraph. */
export function noteSlashCompletions(context: CompletionContext): CompletionResult | null {
  if (context.state.field(slashCommandDismissal, false)) return null;
  const range = slashRange(context.state, context.pos);
  if (!range) return null;
  return {
    ...range,
    options: OPTIONS,
    validFor: (_text, _from, _to, state) => slashRange(state, state.selection.main.head) !== null,
  };
}
