// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { openLinkedCreation, openEventPrepNote } from '../lib/ui/linked_creation';
import { createEventPrepNote, listLists, newOperationId } from '../invoke';
import { mountEditor, type EditorHandle } from '../lib/notes/editor';
import type { EventDetailDto, NoteDto } from '../types/dto';

vi.mock('../invoke', async importOriginal => ({
  ...await importOriginal<typeof import('../invoke')>(),
  newOperationId: vi.fn(),
  listLists: vi.fn(),
  createEventPrepNote: vi.fn(),
}));
vi.mock('../lib/icons', () => ({ initIcons: vi.fn() }));

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let editor: EditorHandle | undefined;
beforeEach(() => {
  document.body.replaceChildren();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.mocked(listLists).mockResolvedValue([]);
  vi.mocked(newOperationId).mockReturnValue('linked-test-operation');
});
afterEach(() => { editor?.destroy(); editor = undefined; vi.clearAllMocks(); });

function submit(): void {
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('linked creation review', () => {
  it('preserves the same reviewed payload and operation across failure and retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Temporary storage error')).mockResolvedValueOnce({ id: 'task-new' });
    const created = vi.fn();
    openLinkedCreation({ title: 'Create task from selection', action: 'Create and open task', initialTitle: 'Follow up', explanation: 'Linked to source', excerpt: 'Follow up\nwith the team', submit: save, onCreated: created });
    submit(); submit();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role=status]')?.textContent).toBe('Temporary storage error');
    expect(document.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    submit();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
    expect(created).toHaveBeenCalledWith({ id: 'task-new' }, true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('allows correcting a definitive validation error with a new operation identity', async () => {
    vi.mocked(newOperationId).mockReturnValueOnce('invalid-intent').mockReturnValueOnce('corrected-intent');
    const save = vi.fn().mockRejectedValueOnce({ code: 2, message: 'Please choose a valid title' }).mockResolvedValueOnce({ id: 'new' });
    openLinkedCreation({ title: 'Create', action: 'Create', initialTitle: 'Draft', explanation: 'Linked', submit: save, onCreated: vi.fn() });
    submit(); await settle();
    const title = document.querySelector<HTMLInputElement>('input')!;
    expect(title.disabled).toBe(false);
    title.value = 'Corrected title';
    submit(); await settle();
    expect(save.mock.calls[0][0]).toMatchObject({ operationId: 'invalid-intent', title: 'Draft' });
    expect(save.mock.calls[1][0]).toMatchObject({ operationId: 'corrected-intent', title: 'Corrected title' });
  });

  it('cancels without creating and restores the invoking control', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const save = vi.fn();
    openLinkedCreation({ title: 'Create', action: 'Create', initialTitle: 'Draft', explanation: 'Linked', submit: save, onCreated: vi.fn() });
    document.querySelector<HTMLButtonElement>('.linked-creation__actions .btn-secondary')!.click();
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the review open and prevents dismissal while persistence is pending', async () => {
    let resolve!: (value: { id: string }) => void;
    const save = vi.fn(() => new Promise<{ id: string }>(done => { resolve = done; }));
    openLinkedCreation({ title: 'Create', action: 'Create', initialTitle: 'Draft', explanation: 'Linked', submit: save, onCreated: vi.fn() });
    submit();
    document.querySelector<HTMLDialogElement>('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    resolve({ id: 'new' }); await settle();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('creates a local prep note for the selected canonical event with reviewed content', async () => {
    const created = vi.fn();
    vi.mocked(createEventPrepNote).mockResolvedValue({ id: 'meeting-note' } as NoteDto);
    openEventPrepNote({ event: { id: 'series-id', title: 'Review', recurrence: ['RRULE:FREQ=WEEKLY'] } } as EventDetailDto, created, 'en');
    expect(document.querySelector('form')?.textContent).toContain('shared across this repeating event series');
    const body = document.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(body.value).toContain('## Action items');
    body.value = '## Agenda\n\nRoadmap';
    submit(); await settle();
    expect(createEventPrepNote).toHaveBeenCalledWith({ operation_id: 'linked-test-operation', event_id: 'series-id', title: 'Review — Meeting notes', body: '## Agenda\n\nRoadmap' });
    expect(created).toHaveBeenCalledWith({ id: 'meeting-note' });
  });

  it('captures exact selected prose and keeps the original note document intact', () => {
    const host = document.createElement('div'); document.body.append(host);
    const createTask = vi.fn();
    const body = 'Decisions\nSend revised brief\nto the studio';
    editor = mountEditor(host, { doc: body, onSave: async () => {}, onCreateTask: createTask });
    const action = host.querySelector<HTMLButtonElement>('[aria-label="Create task from selection"]')!;
    expect(action.disabled).toBe(true);
    editor.getView().dispatch({ selection: { anchor: 10, head: body.length } });
    expect(action.disabled).toBe(false);
    action.click();
    expect(createTask).toHaveBeenCalledWith('Send revised brief\nto the studio');
    expect(editor.getDoc()).toBe(body);
  });
});
