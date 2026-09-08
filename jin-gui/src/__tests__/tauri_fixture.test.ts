import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

interface FixtureBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function loadFixture(): FixtureBridge {
  const source = readFileSync(
    fileURLToPath(new URL('../../tools/tauri-fixture-init.js', import.meta.url)),
    'utf8',
  );
  const dom = new JSDOM('', {
    url: 'http://127.0.0.1:1420',
    runScripts: 'outside-only',
  });
  dom.window.eval(source);
  const bridge = (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
  return bridge;
}

describe('deterministic Tauri visual-QA fixture', () => {
  it('loads the local fixture before the application entrypoint in the real index', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../index.html', import.meta.url)),
      'utf8',
    );
    const dom = new JSDOM(source);
    const moduleSources = Array.from(dom.window.document.querySelectorAll('script[type="module"][src]'))
      .map((script) => script.getAttribute('src'));

    expect(moduleSources).toContain('/tools/tauri-fixture-init.js');
    expect(moduleSources.indexOf('/tools/tauri-fixture-init.js'))
      .toBeLessThan(moduleSources.indexOf('/src/main.ts'));
  });

  it('isolates Work tasks and preserves list/status/priority/tag filters', async () => {
    const bridge = loadFixture();
    const work = await bridge.invoke('list_tasks', { list: 'work' }) as Array<Record<string, unknown>>;
    expect(work).toHaveLength(3);
    expect(new Set(work.map((task) => task.list))).toEqual(new Set(['work']));

    const urgent = await bridge.invoke('list_tasks', {
      list: 'work',
      status: 'todo',
      priority: 'high',
      tag: 'urgent',
      include_deleted: false,
    }) as Array<Record<string, unknown>>;
    expect(urgent.map((task) => task.id)).toEqual(['t1']);
  });

  it('persists list and task reorder commands used by drag and drop', async () => {
    const bridge = loadFixture();
    const reorderedList = await bridge.invoke('reorder_list', { id: 'home', position: 'Q' }) as Record<string, unknown>;
    expect(reorderedList.position).toBe('Q');
    const lists = await bridge.invoke('list_lists') as Array<Record<string, unknown>>;
    expect(lists.find((list) => list.id === 'home')?.position).toBe('Q');

    const movedTask = await bridge.invoke('move_task', {
      id: 't2', input: { list_id: 'work', section_id: 's1', position: 'VV' },
    }) as Record<string, unknown>;
    expect(movedTask.position).toBe('VV');
    const work = await bridge.invoke('list_tasks', { list: 'work' }) as Array<Record<string, unknown>>;
    expect(work.find((task) => task.id === 't2')?.position).toBe('VV');
  });

  it('creates a deterministic subtask with the submitted parent and list', async () => {
    const bridge = loadFixture();
    const created = await bridge.invoke('create_task', {
      input: { title: 'Verify the new composer', list: 'work', parent: 't1' },
    }) as Record<string, unknown>;
    expect(created).toMatchObject({
      id: 'fixture-task-007', title: 'Verify the new composer', list: 'work', parent: 't1', status: 'todo',
    });
    const work = await bridge.invoke('list_tasks', { list: 'work' }) as Array<Record<string, unknown>>;
    expect(work.find((item) => item.id === created.id)).toMatchObject({ parent: 't1', list: 'work' });
  });

  it('isolates exact note folders and tags', async () => {
    const bridge = loadFixture();
    const fieldNotes = await bridge.invoke('list_notes', {
      folder: 'Field Notes',
      include_deleted: false,
    }) as Array<Record<string, unknown>>;
    expect(fieldNotes.map((note) => note.id)).toEqual(['n1', 'n2']);
    expect(new Set(fieldNotes.map((note) => note.folder_path))).toEqual(new Set(['Field Notes']));

    const studioInk = await bridge.invoke('list_notes', {
      folder: 'Studio',
      tag: 'ink',
    }) as Array<Record<string, unknown>>;
    expect(studioInk.map((note) => note.id)).toEqual(['n3']);
  });

  it('uses args.id for note detail and exposes a genuinely empty folder', async () => {
    const bridge = loadFixture();
    const detail = await bridge.invoke('get_note', { id: 'n3' }) as Record<string, unknown>;
    expect(detail.id).toBe('n3');
    expect(detail.body_markdown).toContain('Nanquim studies');

    const empty = await bridge.invoke('list_notes', { folder: 'Empty' }) as unknown[];
    expect(empty).toEqual([]);
  });

  it('hydrates task detail by id and only changes it through an explicit edit_task', async () => {
    const bridge = loadFixture();
    const before = await bridge.invoke('get_task', { id: 't1' }) as Record<string, unknown>;
    expect(before.id).toBe('t1');
    expect(before.body).toContain('continuous workspace rationale');

    const unchanged = await bridge.invoke('get_task', { id: 't1' }) as Record<string, unknown>;
    expect(unchanged).toEqual(before);

    const edited = await bridge.invoke('edit_task', {
      id: 't1',
      input: { title: 'Updated by deterministic fixture', clear_due: true },
    }) as Record<string, unknown>;
    expect(edited.title).toBe('Updated by deterministic fixture');
    expect(edited.due).toBeNull();

    const persisted = await bridge.invoke('get_task', { id: 't1' }) as Record<string, unknown>;
    expect(persisted.title).toBe('Updated by deterministic fixture');
    expect(persisted.body).toBe(before.body);

    const listProjection = await bridge.invoke('list_tasks', { list: 'work' }) as Array<Record<string, unknown>>;
    expect(listProjection.find((task) => task.id === 't1')?.body).toBe('');
  });

  it('provides deterministic Notification Center invitations, reminders, and guarded mutations', async () => {
    const bridge = loadFixture();
    const page = await bridge.invoke('list_notification_items', {
      input: { filter: 'all', include_deferred: false, include_terminal: false, cursor: null, limit: 100 },
    }) as { items: Array<Record<string, any>> };
    expect(page.items.map((item) => item.kind)).toEqual([
      'calendar_invitation', 'task_reminder', 'calendar_invitation', 'calendar_invitation',
    ]);
    expect(page.items[0]).toMatchObject({
      title: 'Partner roadmap review',
      recurrence: { type: 'instance' },
      capabilities: { recurrence_scopes: ['this_occurrence', 'entire_series'] },
    });

    const summary = await bridge.invoke('notification_center_summary') as Record<string, number>;
    expect(summary).toMatchObject({
      visible_unread: 4, visible_total: 4, pending: 1, errors: 1, partial_error_count: 1,
    });

    const deferred = await bridge.invoke('list_notification_items', {
      input: { filter: 'deferred' },
    }) as { items: Array<Record<string, unknown>> };
    expect(deferred.items.map((item) => item.id)).toEqual(['notification-deferred-reminder']);
    const history = await bridge.invoke('list_notification_items', {
      input: { filter: 'history' },
    }) as { items: Array<Record<string, unknown>> };
    expect(history.items.map((item) => item.id)).toEqual(['notification-history-dismissed']);

    const retried = await bridge.invoke('retry_calendar_invitation', {
      input: {
        item_id: page.items[3].id,
        expected_item_version: page.items[3].version,
        operation_id: 'fixture-retry-1',
      },
    }) as Record<string, unknown>;
    expect(retried).toMatchObject({
      status: 'action_pending', requested_action: 'refuse', action_state: 'queued',
      action_error: null,
    });

    const responded = await bridge.invoke('respond_calendar_invitation', {
      input: {
        item_id: page.items[0].id,
        expected_item_version: page.items[0].version,
        operation_id: 'fixture-rsvp-1',
        response: 'allow',
        recurrence_scope: 'this_occurrence',
      },
    }) as Record<string, unknown>;
    expect(responded).toMatchObject({
      status: 'action_pending', requested_action: 'allow', action_state: 'queued',
      provider_response_status: 'needsAction',
    });

    await expect(bridge.invoke('set_notification_read', {
      input: { item_id: page.items[0].id, read: true, expected_version: page.items[0].version },
    })).rejects.toMatchObject({ code: 'stale_item', retryable: true });
  });

  it('rejects unknown task detail/edit ids deterministically', async () => {
    const bridge = loadFixture();
    await expect(bridge.invoke('get_task', { id: 'missing' })).rejects.toThrow('Task not found: missing');
    await expect(bridge.invoke('edit_task', { id: 'missing', input: { title: 'Nope' } }))
      .rejects.toThrow('Task not found: missing');
  });

  it('provides deterministic chronological-grid states for source, Time block, and nighttime QA', async () => {
    const events = await loadFixture().invoke('list_events', {}) as Array<Record<string, unknown>>;
    expect(events.find(event => event.id === 'e8')).toMatchObject({ source: 'google', authority: 'google' });
    expect(events.find(event => event.id === 'e9')).toMatchObject({ source: 'jin', derived_from: 't3' });
    expect(events.find(event => event.id === 'e10')).toMatchObject({ start: '2026-08-20T02:00:00' });
    expect(events.find(event => event.id === 'e11')).toMatchObject({ start: '2026-08-20T22:45:00' });
  });

  it('provides rich, default, and explicit-none Google meeting metadata states', async () => {
    const bridge = loadFixture();
    const rich = await bridge.invoke('get_event_detail', { id: 'e8' }) as Record<string, any>;
    expect(rich.event.organizer).toMatchObject({ displayName: 'Morgan Chen', email: 'host@partner.example' });
    expect(rich.event.attendees).toHaveLength(3);
    expect(rich.event.attendees_omitted).toBe(true);
    expect(rich.event.hangout_link).toBe('https://meet.google.com/abc-defg-hij');
    expect(rich.event.conference_data.entryPoints).toHaveLength(3);
    expect(rich.event.reminders.overrides).toHaveLength(2);

    const defaults = await bridge.invoke('get_event_detail', { id: 'e7' }) as Record<string, any>;
    expect(defaults.event.reminders).toEqual({ useDefault: true });
    const explicitNone = await bridge.invoke('get_event_detail', { id: 'e12' }) as Record<string, any>;
    expect(explicitNone.event.reminders).toEqual({ useDefault: false });
    expect(explicitNone.capabilities.read_only_reason).toBe('external_authority_or_source');
  });

  it('matches production event guards, cancellation, and canonical intervals', async () => {
    const bridge = loadFixture();
    const allHands = await bridge.invoke('get_event', { id: 'e6' }) as Record<string, unknown>;
    expect(allHands.start).toBe('2026-08-25');
    expect(allHands.end).toBe('2026-08-27');

    await expect(bridge.invoke('edit_event', {
      input: {
        event_id: 'e7', edit_token: 'fixture-event:e7:0', operation_id: 'external-edit',
        title: 'Nope', start: '2026-09-10T09:00:00', end: '2026-09-10T10:00:00', is_all_day: false,
      },
    })).rejects.toThrow('read-only');
    await expect(bridge.invoke('delete_event', { id: 'e7' })).rejects.toThrow('read-only');

    const cancelled = await bridge.invoke('delete_event', { id: 'e2' }) as Record<string, unknown>;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.sequence).toBe(1);
    const visible = await bridge.invoke('list_events', {}) as Array<Record<string, unknown>>;
    expect(visible.some(event => event.id === 'e2')).toBe(false);
    const includingCancelled = await bridge.invoke('list_events', { include_deleted: true }) as Array<Record<string, unknown>>;
    expect(includingCancelled.some(event => event.id === 'e2')).toBe(true);
  });

  it('models conflict-safe event edit tokens, no-op saves, and semantic retries', async () => {
    const bridge = loadFixture();
    const before = await bridge.invoke('get_event_detail', { id: 'e1' }) as Record<string, any>;
    expect(before.edit_token).toBe('fixture-event:e1:0');
    const baseInput = {
      event_id: 'e1', edit_token: before.edit_token,
      title: before.event.title, start: before.event.start, end: before.event.end,
      is_all_day: false, location: before.event.location, description: before.event.description,
    };
    const noOp = await bridge.invoke('edit_event', {
      input: { ...baseInput, operation_id: 'fixture-no-op' },
    }) as Record<string, any>;
    expect(noOp.no_op).toBe(true);
    expect(noOp.event.sequence).toBe(0);

    const first = await bridge.invoke('edit_event', {
      input: { ...baseInput, operation_id: 'fixture-edit', title: 'Quiet planning' },
    }) as Record<string, any>;
    const retry = await bridge.invoke('edit_event', {
      input: { ...baseInput, operation_id: 'fixture-edit', title: 'Quiet planning' },
    }) as Record<string, any>;
    expect(first).toEqual(retry);
    expect(first).toMatchObject({ no_op: false, event: { title: 'Quiet planning', sequence: 1 } });

    await expect(bridge.invoke('edit_event', {
      input: { ...baseInput, operation_id: 'fixture-stale', title: 'Stale draft' },
    })).rejects.toMatchObject({
      code: 4,
      kind: 'sync_conflict',
      retriable: false,
      details: { type: 'stale_event', event_id: 'e1' },
    });
  });

  it('promotes tasks idempotently to a valid one-hour event', async () => {
    const bridge = loadFixture();
    const first = await bridge.invoke('promote_task', {
      task_id: 't6', slot: { when: '2026-08-28T09:00:00', tzid: 'America/Sao_Paulo' },
      operation_id: 'fixture-promote-t6',
    }) as Record<string, unknown>;
    const second = await bridge.invoke('promote_task', {
      task_id: 't6', slot: { when: '2026-08-29T11:00:00' },
      operation_id: 'fixture-promote-t6-retry',
    }) as Record<string, unknown>;
    expect(second.id).toBe(first.id);
    expect(first.start).toBe('2026-08-28T09:00:00');
    expect(first.end).toBe('2026-08-28T10:00:00');
    expect(first.is_all_day).toBe(false);
    expect(first.id).toBe('promoted-t6-fixture-promote-t6');
  });

  it('requires an operation id for deterministic task promotion', async () => {
    const bridge = loadFixture();
    await expect(bridge.invoke('promote_task', {
      task_id: 't6', slot: { when: '2026-08-28T09:00:00' },
    })).rejects.toThrow('operation_id is required');
  });

  it('creates deterministic event ids without wall-clock input', async () => {
    const bridge = loadFixture();
    const input = { title: 'Fixture event', start: '2026-08-30T09:00:00', end: '2026-08-30T10:00:00' };
    const first = await bridge.invoke('create_event', { input }) as Record<string, unknown>;
    const second = await bridge.invoke('create_event', { input }) as Record<string, unknown>;
    const fresh = await loadFixture().invoke('create_event', { input }) as Record<string, unknown>;

    expect([first.id, second.id]).toEqual(['fixture-event-012', 'fixture-event-013']);
    expect(fresh.id).toBe(first.id);
  });

  it('attaches Prep notes idempotently and exposes the human title in event detail', async () => {
    const bridge = loadFixture();
    const payload = { note_id: 'n3', target_id: 'e1', kind: 'prep-for' };
    const first = await bridge.invoke('attach_note', payload) as Record<string, unknown>;
    await bridge.invoke('attach_note', payload);
    const detail = await bridge.invoke('get_event_detail', { id: 'e1' }) as Record<string, any>;
    const matches = detail.event.backlinks.filter((link: Record<string, unknown>) =>
      link.source_id === 'n3' && link.edge_type === 'prep-for');

    expect(first).toEqual({ edge_type: 'prep-for', source_id: 'n3', target_id: 'e1' });
    expect(matches).toEqual([{ source_id: 'n3', source_kind: 'note', edge_type: 'prep-for', label: 'Nanquim studies' }]);
    const google = await bridge.invoke('get_event_detail', { id: 'e7' }) as Record<string, any>;
    expect(google.event.backlinks).toEqual([]);
  });

  it('links Related notes as Note-to-Event references with deterministic deduplication', async () => {
    const bridge = loadFixture();
    const payload = { source_id: 'n4', target_id: 'e1', edge_type: 'references' };
    const first = await bridge.invoke('link', payload) as Record<string, unknown>;
    await bridge.invoke('link', payload);
    const detail = await bridge.invoke('get_event_detail', { id: 'e1' }) as Record<string, any>;
    const matches = detail.event.backlinks.filter((link: Record<string, unknown>) =>
      link.source_id === 'n4' && link.edge_type === 'references');

    expect(first).toEqual({ edge_type: 'references', source_id: 'n4', target_id: 'e1' });
    expect(matches).toEqual([{ source_id: 'n4', source_kind: 'note', edge_type: 'references', label: 'Small rituals' }]);
    const google = await bridge.invoke('get_event_detail', { id: 'e7' }) as Record<string, any>;
    expect(google.event.backlinks).toEqual([]);
    await expect(bridge.invoke('link', { source_id: 'e1', target_id: 'n4', edge_type: 'references' }))
      .rejects.toThrow('Note not found: e1');
  });

  it('projects detail capabilities and removes a Time block with an atomic Flexible return', async () => {
    const bridge = loadFixture();
    const promoted = await bridge.invoke('promote_task', {
      task_id: 't2', slot: { when: '2026-08-28T09:00:00', tzid: 'America/Sao_Paulo' },
      operation_id: 'fixture-promote-t2',
    }) as Record<string, unknown>;
    const detail = await bridge.invoke('get_event_detail', { id: promoted.id }) as Record<string, any>;
    expect(detail.capabilities.display_kind).toBe('time-block');
    expect(detail.capabilities.originating_task.title).toBe('Draft Q3 planning doc');

    const removed = await bridge.invoke('remove_time_block', {
      input: { event_id: promoted.id, return_to_flexible: true, operation_id: 'fixture-remove-t2' },
    }) as Record<string, any>;
    expect(removed.event.status).toBe('cancelled');
    expect(removed.originating_task.agenda_bucket).toBe('flexible');
    const flexible = await bridge.invoke('list_tasks', {}) as Array<Record<string, unknown>>;
    expect(flexible.find(task => task.id === 't2')?.agenda_bucket).toBe('flexible');
  });
});
