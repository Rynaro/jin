/**
 * invoke.test.ts — offline unit tests for the typed invoke wrapper.
 *
 * All tests mock @tauri-apps/api/core so no Tauri runtime is required.
 * The tests exercise:
 *   1. That invoke is called with the correct command name.
 *   2. That parameters are forwarded faithfully.
 *   3. That errors propagate as-is (JinErrorDto pass-through).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri invoke before importing the module under test.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  todayAgenda,
  listNotes,
  createNote,
  editNote,
  deleteNote,
  getNoteById,
  searchNotes,
  listNoteRevisions,
  previewNoteRevision,
  restoreNoteRevision,
  importAttachment,
  listCollections,
  createCollection,
  renameCollection,
  updateCollectionQuery,
  deleteCollection,
  evaluateCollection,
  listTasks,
  createTask,
  setTaskStatus,
  deleteTask,
  listEvents,
  getEventDetailById,
  removeTimeBlock,
  createEvent,
  promoteTask,
  attachNote,
  linkObjects,
  capture,
  runSync,
  authStatus,
  exportFiles,
  appConfig,
  setStoreRoot,
  getStoreRoot,
  listLists,
  createList,
  editList,
  reorderList,
  deleteList,
  listTags,
  setTagColor,
} from '../invoke';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

// ── Agenda ───────────────────────────────────────────────────────────────────

describe('todayAgenda', () => {
  it('calls today_agenda with no date when omitted', async () => {
    mockInvoke.mockResolvedValueOnce({ date: '2026-06-27', timed_events: [], all_day_events: [] });
    await todayAgenda();
    expect(mockInvoke).toHaveBeenCalledWith('today_agenda', { date: undefined });
  });

  it('forwards a date string to today_agenda', async () => {
    mockInvoke.mockResolvedValueOnce({ date: '2026-06-27', timed_events: [], all_day_events: [] });
    await todayAgenda('2026-06-27');
    expect(mockInvoke).toHaveBeenCalledWith('today_agenda', { date: '2026-06-27' });
  });

  it('propagates errors from the bridge', async () => {
    const err = { code: 7, kind: 'integrity', message: 'not initialized', retriable: false };
    mockInvoke.mockRejectedValueOnce(err);
    await expect(todayAgenda()).rejects.toMatchObject({ code: 7, kind: 'integrity' });
  });
});

// ── Notes ────────────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('calls list_notes with no args when omitted', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listNotes();
    expect(mockInvoke).toHaveBeenCalledWith('list_notes', {
      include_deleted: undefined,
      tag: undefined,
    });
  });

  it('forwards tag filter', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listNotes({ tag: 'work' });
    expect(mockInvoke).toHaveBeenCalledWith('list_notes', {
      include_deleted: undefined,
      tag: 'work',
    });
  });
});

describe('createNote', () => {
  it('calls create_note with the input object', async () => {
    const note = { id: 'n1', title: 'Hello' };
    mockInvoke.mockResolvedValueOnce(note);
    const result = await createNote({ title: 'Hello', body: 'World' });
    expect(mockInvoke).toHaveBeenCalledWith('create_note', {
      input: { title: 'Hello', body: 'World' },
    });
    expect(result).toMatchObject({ id: 'n1', title: 'Hello' });
  });
});

describe('editNote', () => {
  it('calls edit_note with id and input', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await editNote('n1', { title: 'Updated' });
    expect(mockInvoke).toHaveBeenCalledWith('edit_note', {
      id: 'n1',
      input: { title: 'Updated' },
    });
  });
});

describe('deleteNote', () => {
  it('calls delete_note with the id', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await deleteNote('n1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_note', { id: 'n1' });
  });
});

describe('getNoteById', () => {
  it('calls get_note with the id', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await getNoteById('n1');
    expect(mockInvoke).toHaveBeenCalledWith('get_note', { id: 'n1' });
  });
});

describe('Notes search, recovery, attachments, and declarative collections', () => {
  const query = {
    version: 1 as const,
    filter: { op: 'tag' as const, value: 'work' },
    sort: [{ field: 'updated' as const, direction: 'desc' as const }],
    limit: null,
  };

  it('uses the literal search command without adding query syntax', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await searchNotes('plain words');
    expect(mockInvoke).toHaveBeenCalledWith('search_notes', { text: 'plain words' });
  });

  it('uses path-free recovery preview and revision-aware restore commands', async () => {
    mockInvoke.mockResolvedValueOnce([1, 2]);
    await listNoteRevisions('n1');
    expect(mockInvoke).toHaveBeenCalledWith('list_note_revisions', { id: 'n1' });

    mockInvoke.mockResolvedValueOnce({ revision: 1, title: 'Old', body_markdown: 'body', updated: 'now' });
    await previewNoteRevision('n1', 1);
    expect(mockInvoke).toHaveBeenCalledWith('preview_note_revision', { id: 'n1', revision: 1 });

    mockInvoke.mockResolvedValueOnce({});
    await restoreNoteRevision('n1', 1, 4);
    expect(mockInvoke).toHaveBeenCalledWith('restore_note_revision', {
      id: 'n1',
      revision: 1,
      expected_revision: 4,
    });
  });

  it('imports a managed attachment using only its selected source path', async () => {
    mockInvoke.mockResolvedValueOnce({ sha256: 'abc', original_names: ['file.pdf'] });
    await importAttachment('/picked/file.pdf');
    expect(mockInvoke).toHaveBeenCalledWith('import_attachment', { source: '/picked/file.pdf' });
  });

  it('forwards only typed declarative collection inputs and lifecycle identifiers', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listCollections();
    expect(mockInvoke).toHaveBeenCalledWith('list_collections', {});

    mockInvoke.mockResolvedValueOnce({ id: 'c1', name: 'Work', query });
    await createCollection({ name: 'Work', query });
    expect(mockInvoke).toHaveBeenCalledWith('create_collection', { input: { name: 'Work', query } });

    mockInvoke.mockResolvedValueOnce({});
    await renameCollection('c1', 'Renamed');
    expect(mockInvoke).toHaveBeenCalledWith('rename_collection', { id: 'c1', name: 'Renamed' });

    mockInvoke.mockResolvedValueOnce({});
    await updateCollectionQuery('c1', query);
    expect(mockInvoke).toHaveBeenCalledWith('update_collection_query', {
      id: 'c1',
      input: { query },
    });

    mockInvoke.mockResolvedValueOnce([]);
    await evaluateCollection('c1');
    expect(mockInvoke).toHaveBeenCalledWith('evaluate_collection', { id: 'c1' });

    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteCollection('c1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_collection', { id: 'c1' });
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

describe('listTasks', () => {
  it('calls list_tasks with no args when omitted', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listTasks();
    expect(mockInvoke).toHaveBeenCalledWith('list_tasks', {
      list: undefined,
      status: undefined,
      priority: undefined,
      tag: undefined,
      include_deleted: undefined,
    });
  });

  it('forwards tag filter (P4)', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listTasks({ tag: 'email' });
    expect(mockInvoke).toHaveBeenCalledWith('list_tasks', {
      list: undefined,
      status: undefined,
      priority: undefined,
      tag: 'email',
      include_deleted: undefined,
    });
  });
});

describe('createTask', () => {
  it('calls create_task with the input', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 't1' });
    await createTask({ title: 'Buy milk', priority: 'high' });
    expect(mockInvoke).toHaveBeenCalledWith('create_task', {
      input: { title: 'Buy milk', priority: 'high' },
    });
  });
});

describe('setTaskStatus', () => {
  it('calls set_task_status with id and status', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await setTaskStatus('t1', 'done');
    expect(mockInvoke).toHaveBeenCalledWith('set_task_status', { id: 't1', status: 'done' });
  });
});

describe('deleteTask', () => {
  it('calls delete_task with the id', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await deleteTask('t1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_task', { id: 't1' });
  });
});

// ── Events ───────────────────────────────────────────────────────────────────

describe('listEvents', () => {
  it('calls list_events with no args when omitted', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listEvents();
    expect(mockInvoke).toHaveBeenCalledWith('list_events', { include_deleted: undefined });
  });
});

describe('createEvent', () => {
  it('calls create_event with the input', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'e1' });
    await createEvent({
      title: 'Standup',
      start: '2026-06-27T09:00:00',
      end: '2026-06-27T09:30:00',
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_event', {
      input: { title: 'Standup', start: '2026-06-27T09:00:00', end: '2026-06-27T09:30:00' },
    });
  });
});

// ── Promote / attach / link ───────────────────────────────────────────────────

describe('promoteTask', () => {
  it('calls promote_task with task_id and slot', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'e1' });
    await promoteTask('t1', { when: '2026-06-27T10:00:00', tzid: 'UTC' }, 'promote-op-1');
    expect(mockInvoke).toHaveBeenCalledWith('promote_task', {
      task_id: 't1',
      slot: { when: '2026-06-27T10:00:00', tzid: 'UTC' },
      operation_id: 'promote-op-1',
    });
  });
});

describe('event detail and compound Time block removal', () => {
  it('loads detail capabilities without changing list EventDto', async () => {
    mockInvoke.mockResolvedValueOnce({ event: { id: 'e1' }, capabilities: { display_kind: 'event' } });
    await getEventDetailById('e1');
    expect(mockInvoke).toHaveBeenCalledWith('get_event_detail', { id: 'e1' });
  });

  it('passes the required operation id to one compound remove command', async () => {
    mockInvoke.mockResolvedValueOnce({ event: { id: 'e1' }, originating_task: null });
    await removeTimeBlock({
      event_id: 'e1',
      return_to_flexible: true,
      operation_id: 'remove-op-1',
    });
    expect(mockInvoke).toHaveBeenCalledWith('remove_time_block', {
      input: {
        event_id: 'e1',
        return_to_flexible: true,
        operation_id: 'remove-op-1',
      },
    });
  });
});

describe('attachNote', () => {
  it('calls attach_note with note_id, target_id and optional kind', async () => {
    mockInvoke.mockResolvedValueOnce({ edge_type: 'prep_for', source_id: 'n1', target_id: 'e1' });
    await attachNote('n1', 'e1', 'prep_for');
    expect(mockInvoke).toHaveBeenCalledWith('attach_note', {
      note_id: 'n1',
      target_id: 'e1',
      kind: 'prep_for',
    });
  });
});

describe('linkObjects', () => {
  it('calls link with source_id, target_id and edge_type', async () => {
    mockInvoke.mockResolvedValueOnce({});
    await linkObjects('n1', 't1', 'references');
    expect(mockInvoke).toHaveBeenCalledWith('link', {
      source_id: 'n1',
      target_id: 't1',
      edge_type: 'references',
    });
  });
});

// ── Capture ──────────────────────────────────────────────────────────────────

describe('capture', () => {
  it('calls capture with text as note by default', async () => {
    mockInvoke.mockResolvedValueOnce({ kind: 'note', id: 'n1', data: {} });
    await capture('Quick note');
    expect(mockInvoke).toHaveBeenCalledWith('capture', {
      text: 'Quick note',
      as_task: undefined,
      list: undefined,
    });
  });

  it('forwards as_task flag for task capture', async () => {
    mockInvoke.mockResolvedValueOnce({ kind: 'task', id: 't1', data: {} });
    await capture('Buy groceries', { as_task: true, list: 'inbox' });
    expect(mockInvoke).toHaveBeenCalledWith('capture', {
      text: 'Buy groceries',
      as_task: true,
      list: 'inbox',
    });
  });
});

// ── Sync / auth / export ─────────────────────────────────────────────────────

describe('runSync', () => {
  it('calls run_sync with empty args', async () => {
    mockInvoke.mockResolvedValueOnce({ status: 'ok', pulled: 0, pushed: 0 });
    await runSync();
    expect(mockInvoke).toHaveBeenCalledWith('run_sync', {});
  });
});

describe('authStatus', () => {
  it('calls auth_status with empty args', async () => {
    mockInvoke.mockResolvedValueOnce({ state: 'disconnected', account: null });
    await authStatus();
    expect(mockInvoke).toHaveBeenCalledWith('auth_status', {});
  });
});

describe('exportFiles', () => {
  it('calls export_files with dest and optional force', async () => {
    mockInvoke.mockResolvedValueOnce({ dest: '/tmp/out', file_count: 3 });
    await exportFiles('/tmp/out', true);
    expect(mockInvoke).toHaveBeenCalledWith('export_files', { dest: '/tmp/out', force: true });
  });
});

describe('appConfig', () => {
  it('calls app_config with empty args', async () => {
    mockInvoke.mockResolvedValueOnce({ root_path: '/home/user/.jin', display_tz: 'UTC' });
    await appConfig();
    expect(mockInvoke).toHaveBeenCalledWith('app_config', {});
  });
});

// ── Store root ────────────────────────────────────────────────────────────────

describe('setStoreRoot', () => {
  it('calls set_store_root with the given path', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await setStoreRoot('/home/user/Documents/MyJin');
    expect(mockInvoke).toHaveBeenCalledWith('set_store_root', {
      path: '/home/user/Documents/MyJin',
    });
  });

  it('propagates errors from the bridge', async () => {
    const err = { code: 1, kind: 'other', message: 'cannot save store path', retriable: false };
    mockInvoke.mockRejectedValueOnce(err);
    await expect(setStoreRoot('/bad/path')).rejects.toMatchObject({ code: 1 });
  });
});

describe('getStoreRoot', () => {
  it('calls get_store_root with empty args', async () => {
    mockInvoke.mockResolvedValueOnce('/home/user/Jin');
    const result = await getStoreRoot();
    expect(mockInvoke).toHaveBeenCalledWith('get_store_root', {});
    expect(result).toBe('/home/user/Jin');
  });
});

// ── Lists (P3) ────────────────────────────────────────────────────────────────

describe('listLists', () => {
  it('calls list_lists with empty args', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listLists();
    expect(mockInvoke).toHaveBeenCalledWith('list_lists', {});
  });
});

describe('createList', () => {
  // Rust `CreateListInput` (src-tauri/src/commands/lists.rs) declares `color`
  // and `icon` as required `String` fields — no `#[serde(default)]`. There is
  // no way to call `createList()` here without supplying all three fields
  // (the TS param type is non-optional on `color`/`icon` to match), so this
  // test can no longer pass while silently omitting a field the bridge
  // requires — the old version asserted the payload against itself
  // (`createList({ name, color })` vs. `toHaveBeenCalledWith({ name, color })`)
  // and could never have caught the missing-`icon` regression that shipped.
  it('forwards name, color, AND icon — every field the bridge requires', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'work', name: 'Work' });
    await createList({ name: 'Work', color: 'sky', icon: 'briefcase' });
    expect(mockInvoke).toHaveBeenCalledWith('create_list', {
      input: { name: 'Work', color: 'sky', icon: 'briefcase' },
    });
  });
});

describe('editList', () => {
  it('calls edit_list with id and input', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'work', name: 'Work Updated' });
    await editList('work', { name: 'Work Updated', color: 'accent' });
    expect(mockInvoke).toHaveBeenCalledWith('edit_list', {
      id: 'work',
      input: { name: 'Work Updated', color: 'accent' },
    });
  });
});

describe('reorderList', () => {
  it('calls reorder_list with id and position', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'work' });
    await reorderList('work', 'M');
    expect(mockInvoke).toHaveBeenCalledWith('reorder_list', { id: 'work', position: 'M' });
  });
});

describe('deleteList', () => {
  it('calls delete_list with the id', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteList('work');
    expect(mockInvoke).toHaveBeenCalledWith('delete_list', { id: 'work' });
  });
});

// ── Tags (P4) ─────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('calls list_tags with empty args', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await listTags();
    expect(mockInvoke).toHaveBeenCalledWith('list_tags', {});
  });
});

describe('setTagColor', () => {
  it('calls set_tag_color with slug and color', async () => {
    mockInvoke.mockResolvedValueOnce({ slug: 'email', color: 'sky' });
    await setTagColor('email', 'sky');
    expect(mockInvoke).toHaveBeenCalledWith('set_tag_color', { slug: 'email', color: 'sky' });
  });
});
