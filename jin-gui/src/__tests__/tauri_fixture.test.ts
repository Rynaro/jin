import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import type { TaskDto, TaskRecurrence } from '../types/dto';

interface FixtureBridge {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  reload: () => FixtureBridge;
}

function loadFixture(scenarios: { today?: string; calendar?: string; notifications?: string } = {}): FixtureBridge {
  const source = readFileSync(
    fileURLToPath(new URL('../../tools/tauri-fixture-init.js', import.meta.url)),
    'utf8',
  );
  const dom = new JSDOM('', {
    url: 'http://127.0.0.1:1420',
    runScripts: 'outside-only',
  });
  if (scenarios.today !== undefined) dom.window.localStorage.setItem('jin.fixture.todayScenario', scenarios.today);
  if (scenarios.calendar !== undefined) dom.window.localStorage.setItem('jin.fixture.calendarScenario', scenarios.calendar);
  if (scenarios.notifications !== undefined) dom.window.localStorage.setItem('jin.fixture.notificationsScenario', scenarios.notifications);
  dom.window.eval(source);
  const bridge = (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__;
  bridge.reload = () => { dom.window.eval(source); return (dom.window as unknown as { __TAURI_INTERNALS__: FixtureBridge }).__TAURI_INTERNALS__; };
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

  it('handles section creation, editing and deletion with real list and task state', async () => {
    const bridge = loadFixture();
    const created = await bridge.invoke('create_section', {
      list_id: 'work', input: { name: 'Waiting' },
    }) as Record<string, unknown>;
    expect(created).toMatchObject({ list_id: 'work', name: 'Waiting' });
    const renamed = await bridge.invoke('rename_section', {
      list_id: 'work', section_id: created.id, input: { name: 'Review' },
    }) as Record<string, unknown>;
    expect(renamed.name).toBe('Review');
    const ordered = await bridge.invoke('reorder_section', {
      list_id: 'work', section_id: created.id, input: { position: 'A' },
    }) as Record<string, unknown>;
    expect(ordered.position).toBe('A');
    await bridge.invoke('delete_section', { list_id: 'work', section_id: created.id });
    await bridge.invoke('delete_section', { list_id: 'work', section_id: 's1' });
    const lists = await bridge.invoke('list_lists') as Array<Record<string, unknown>>;
    const work = lists.find((list) => list.id === 'work')!;
    expect((work.sections as Array<Record<string, unknown>>).some((section) => section.id === created.id || section.id === 's1')).toBe(false);
    expect(await bridge.invoke('get_task', { id: 't1' })).toMatchObject({ section_id: null });
  });

  it('requires confirmation before a Board Doing task becomes an unchecked List task', async () => {
    const bridge = loadFixture();
    const input = { list_id: 'home', section_id: null, position: 'V' };
    await expect(bridge.invoke('move_task', { id: 't8', input })).rejects.toThrow(/confirm/i);
    expect(await bridge.invoke('get_task', { id: 't8' })).toMatchObject({
      list: 'project', status: 'doing', board_column_id: 'project-review',
    });
    const moved = await bridge.invoke('move_task', {
      id: 't8', input: { ...input, confirm_doing_to_checklist: true },
    }) as Record<string, unknown>;
    expect(moved).toMatchObject({ list: 'home', status: 'todo', board_column_id: null, completed_at: null });
    expect(await bridge.invoke('get_task', { id: 't8' })).toMatchObject({
      list: 'home', status: 'todo', board_column_id: null,
    });
  });

  it('creates a deterministic subtask with the submitted parent and list', async () => {
    const bridge = loadFixture();
    const created = await bridge.invoke('create_task', {
      input: { title: 'Verify the new composer', list: 'work', parent: 't1' },
    }) as Record<string, unknown>;
    expect(created).toMatchObject({
      id: expect.stringMatching(/^fixture-task-\d+$/), title: 'Verify the new composer', list: 'work', parent: 't1', status: 'todo',
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

  it('exposes the explicit notification recovery scenario with failed and queued actions', async () => {
    const bridge = loadFixture({ notifications: 'recovery' });
    const page = await bridge.invoke('list_notification_items', { input: { filter: 'all' } }) as { items: Array<Record<string, any>> };
    expect(page.items.find((item) => item.id === 'notification-invite-pending')).toMatchObject({
      status: 'action_pending', action_state: 'queued', requested_action: 'maybe',
    });
    expect(page.items.find((item) => item.id === 'notification-invite-retryable')).toMatchObject({
      status: 'active', action_state: 'failed_retryable', action_error: { retryable: true },
    });
    expect(() => loadFixture({ notifications: 'unknown' }).invoke('list_notification_items', { input: { filter: 'all' } }))
      .toThrow('Unsupported Jin notifications scenario: unknown');
  });

  it('provides deterministic chronological-grid states for source, Time block, and nighttime QA', async () => {
    const events = await loadFixture().invoke('list_events', {}) as Array<Record<string, unknown>>;
    expect(events.find(event => event.id === 'e8')).toMatchObject({ source: 'google', authority: 'google' });
    expect(events.find(event => event.id === 'e9')).toMatchObject({ source: 'jin', derived_from: 't3' });
    expect(events.find(event => event.id === 'e10')).toMatchObject({ start: '2026-08-20T02:00:00' });
    expect(events.find(event => event.id === 'e11')).toMatchObject({ start: '2026-08-20T22:45:00' });
  });

  it('supports a sparse Today projection scenario for bounded layout QA', async () => {
    const bridge = loadFixture({ today: 'sparse' });
    const projection = await bridge.invoke('today_projection', { date: '2026-08-20' }) as Record<string, any>;

    expect(projection.current_date).toBe('2026-08-20');
    expect(projection.is_current_date).toBe(true);
    expect(projection.agenda).toMatchObject({ date: '2026-08-20', display_tz: 'UTC' });
    expect(projection.agenda.all_day_events).toEqual([]);
    expect(projection.agenda.timed_events).toHaveLength(1);
    expect(projection.agenda.timed_events[0]).toMatchObject({
      id: 'e8', source: 'google', authority: 'google', originating_task: null, prep_notes: [],
    });
    expect(projection.attention_tasks.map((task: Record<string, unknown>) => task.id)).toEqual(['t1']);
    expect(projection.due_tasks).toEqual([]);
    expect(projection.flexible_tasks).toEqual([]);
    expect(projection.active_events).toEqual([]);
    expect(projection.next_event).toBeNull();
  });

  it('supports dense Calendar and Today scenarios without changing their defaults', async () => {
    const calendar = await loadFixture({ calendar: 'dense' }).invoke('calendar_range_projection', {
      input: { from: '2026-08-01', to: '2026-08-31' },
    }) as { entries: Array<Record<string, unknown>> };
    const denseCalendar = calendar.entries.filter((entry) => String(entry.event_id).startsWith('fixture-dense-calendar-'));
    expect(denseCalendar).toHaveLength(8);
    expect(denseCalendar.map((entry) => entry.event_id)).toEqual([
      'fixture-dense-calendar-all-day-1', 'fixture-dense-calendar-all-day-2',
      'fixture-dense-calendar-01', 'fixture-dense-calendar-02', 'fixture-dense-calendar-03',
      'fixture-dense-calendar-04', 'fixture-dense-calendar-05', 'fixture-dense-calendar-06',
    ]);
    expect(denseCalendar.every((entry) => entry.start_date === '2026-08-20')).toBe(true);
    const denseBridge = loadFixture({ calendar: 'dense' });
    await expect(denseBridge.invoke('get_event', { id: 'fixture-dense-calendar-04' }))
      .resolves.toMatchObject({ id: 'fixture-dense-calendar-04', source: 'google', authority: 'google' });
    await expect(denseBridge.invoke('get_event_detail', { id: 'fixture-dense-calendar-04' }))
      .resolves.toMatchObject({ event: { id: 'fixture-dense-calendar-04' } });
    const today = await loadFixture({ today: 'dense' }).invoke('today_projection', { date: '2026-08-20' }) as Record<string, any>;
    expect(today.agenda.all_day_events.some((event: Record<string, unknown>) => event.id === 'fixture-dense-today-all-day')).toBe(true);
    expect(today.agenda.timed_events.filter((event: Record<string, unknown>) => String(event.id).startsWith('fixture-dense-today-'))).toHaveLength(8);
    const defaultToday = await loadFixture().invoke('today_projection', { date: '2026-08-20' }) as Record<string, any>;
    expect(defaultToday.agenda.timed_events.some((event: Record<string, unknown>) => String(event.id).startsWith('fixture-dense-today-'))).toBe(false);
    expect(() => loadFixture({ calendar: 'unknown' }).invoke('calendar_range_projection', {
      input: { from: '2026-08-01', to: '2026-08-31' },
    })).toThrow('Unsupported Jin calendar scenario: unknown');
  });

  it('rejects unknown Today fixture scenarios explicitly', async () => {
    const bridge = loadFixture({ today: 'unrecognized' });
    await expect(bridge.invoke('today_projection', { date: '2026-08-20' }))
      .rejects.toThrow('Unsupported Jin today scenario: unrecognized');
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
      is_all_day: false, tzid: before.event.start_tzid,
      location: before.event.location, description: before.event.description,
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


describe('persistent recurring task fixture contract', () => {
  const rule = (overrides: Partial<TaskRecurrence> = {}): TaskRecurrence => ({
    series_id: '', frequency: 'daily', interval: 1, weekdays: [], mode: 'scheduled',
    end: { kind: 'count', count: 3 }, anchor_due: '2026-08-20', sequence: 1, ...overrides,
  });
  const rows = async (bridge: FixtureBridge) => await bridge.invoke('list_tasks') as TaskDto[];
  const get = async (bridge: FixtureBridge, id: string) => await bridge.invoke('get_task', { id }) as TaskDto;
  const enable = async (bridge: FixtureBridge, recurrence = rule()) => await bridge.invoke('edit_task', {
    id: 't2', input: { due: '2026-08-20', recurrence, recurrence_scope: 'this_and_following' },
  }) as TaskDto;

  it('saves real distinct future IDs immediately and preserves them across fixture reload', async () => {
    let bridge = loadFixture();
    await enable(bridge);
    const before = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(before.map(task => task.due)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(new Set(before.map(task => task.id)).size).toBe(3);
    expect(before.filter(task => task.recurrence_series)).toHaveLength(1);
    bridge = bridge.reload();
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toEqual(before);
  });

  it('keeps the completed original ID and due, and does not duplicate slots on maintenance or retry', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const done = await bridge.invoke('set_task_status', { id: 't2', status: 'done' }) as TaskDto;
    expect(done).toMatchObject({ id: 't2', status: 'done', due: '2026-08-20' });
    expect(done.recurrence_effect?.next_occurrence_id).not.toBe('t2');
    await bridge.invoke('maintain_task_recurrences');
    await bridge.invoke('set_task_status', { id: 't2', status: 'done' });
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toHaveLength(3);
    expect(await get(bridge, 't2')).toMatchObject({ status: 'done', due: '2026-08-20' });
  });

  it('keeps ten upcoming entries independent of cadence', async () => {
    const bridge = loadFixture(); await enable(bridge, rule({ end: { kind: 'never' } }));
    const daily = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(daily).toHaveLength(10);
    expect(daily.at(-1)?.due).toBe('2026-08-29');
    const yearly = loadFixture(); await enable(yearly, rule({ frequency: 'yearly', end: { kind: 'never' } }));
    expect((await rows(yearly)).filter(task => task.recurrence_instance)).toHaveLength(10);
    expect((await rows(yearly)).filter(task => task.recurrence_instance).at(-1)?.due).toBe('2035-08-20');
  });

  it('persists configurable targets and refills without replacing previously saved IDs', async () => {
    const bridge = loadFixture();
    const owner = await bridge.invoke('edit_task', { id: 't2', input: { due: '2026-08-20', recurrence: rule({ end: { kind: 'never' } }), recurrence_upcoming_count: 3 } }) as TaskDto;
    const initial = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(initial).toHaveLength(3);
    const authority = owner.recurrence_series!;
    await bridge.invoke('edit_task', { id: 't2', input: { recurrence_upcoming_count: 5, recurrence_scope: 'this_and_following' } });
    const expanded = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(expanded).toHaveLength(5); expect(initial.every(task => expanded.some(candidate => candidate.id === task.id))).toBe(true);
    expect((await get(bridge, 't2')).recurrence_series?.revision).toBe(authority.revision);
    await bridge.invoke('edit_task', { id: 't2', input: { recurrence_upcoming_count: 2, recurrence_scope: 'this_and_following' } });
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toHaveLength(5);
    const restored = bridge.reload(); expect((await get(restored, 't2')).recurrence_series?.upcoming_count).toBe(2);
  });

  it('immediately replenishes the configured open target when a scheduled occurrence is completed', async () => {
    const bridge = loadFixture();
    await bridge.invoke('edit_task', { id: 't2', input: { due: '2026-08-20', recurrence: rule({ end: { kind: 'never' } }), recurrence_upcoming_count: 3 } });
    const before = (await rows(bridge)).filter(task => task.recurrence_instance);
    await bridge.invoke('set_task_status', { id: 't2', status: 'done' });
    const after = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(after).toHaveLength(4); expect(after.filter(task => task.status === 'todo')).toHaveLength(3);
    expect(before.every(task => after.some(candidate => candidate.id === task.id))).toBe(true);
  });

  it('honors inclusive Until and anchored month-end arithmetic', async () => {
    const bridge = loadFixture();
    await enable(bridge, rule({ end: { kind: 'until', date: '2026-08-21' } }));
    expect((await rows(bridge)).filter(task => task.recurrence_instance).map(task => task.due)).toEqual(['2026-08-20', '2026-08-21']);
    const monthly = loadFixture();
    await monthly.invoke('edit_task', { id: 't2', input: { due: '2026-01-31', recurrence: rule({ frequency: 'monthly', end: { kind: 'count', count: 12 } }) } });
    const dates = (await rows(monthly)).filter(task => task.recurrence_instance).map(task => task.due);
    expect(dates).toContain('2026-08-31'); expect(dates).toContain('2026-09-30'); expect(dates).toContain('2026-10-31');
  });

  it('preserves an edited future as a detached exception when Stop retires untouched futures', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const future = (await rows(bridge)).filter(task => task.id !== 't2' && task.recurrence_instance);
    await bridge.invoke('edit_task', { id: future[0].id, input: { body: 'Keep my edits', due: '2026-09-01', recurrence_scope: 'this_occurrence' } });
    const stopped = await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } }) as TaskDto;
    expect(stopped.recurrence_effect).toMatchObject({ retired_count: 1, preserved_exception_count: 1 });
    expect(await get(bridge, future[0].id)).toMatchObject({ body: 'Keep my edits', due: '2026-09-01', deleted_at: null, recurrence_instance: { detached: true } });
    expect(await get(bridge, future[1].id)).toMatchObject({ status: 'deleted' });
    await bridge.invoke('maintain_task_recurrences');
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toHaveLength(2);
  });

  it('requires explicit rule scope, changes only the current revision, and allows owner Stop', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const future = (await rows(bridge)).filter(task => task.id !== 't2' && task.recurrence_instance);
    await expect(bridge.invoke('edit_task', { id: future[0].id, input: { recurrence: rule() } })).rejects.toThrow(/scope/i);
    await bridge.invoke('edit_task', { id: future[0].id, input: { recurrence: rule({ frequency: 'weekly' }), recurrence_scope: 'this_and_following' } });
    expect((await get(bridge, 't2')).recurrence_series?.revision).toBe(2);
    await expect(bridge.invoke('edit_task', { id: 't2', input: { recurrence: rule(), recurrence_scope: 'this_and_following' } })).rejects.toThrow(/current recurrence revision/i);
    await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } });
    expect((await get(bridge, 't2')).recurrence_series?.enabled).toBe(false);
  });

  it('creates completion-relative successors once, using actual completion, with count one boundary', async () => {
    const bridge = loadFixture(); await enable(bridge, rule({ mode: 'completion', end: { kind: 'count', count: 2 } }));
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toHaveLength(1);
    await bridge.invoke('set_task_status', { id: 't2', status: 'done' });
    let instances = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(instances).toHaveLength(2);
    expect(instances[1]).toMatchObject({ due: '2026-07-02', recurrence_instance: { completion_predecessor_id: 't2' } });
    await bridge.invoke('set_task_status', { id: 't2', status: 'todo' });
    await bridge.invoke('set_task_status', { id: 't2', status: 'done' });
    instances = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(instances).toHaveLength(2);
    const only = loadFixture(); await enable(only, rule({ mode: 'completion', end: { kind: 'count', count: 1 } }));
    await only.invoke('set_task_status', { id: 't2', status: 'done' });
    expect((await rows(only)).filter(task => task.recurrence_instance)).toHaveLength(1);
  });

  it('clones checklist content to new IDs without child dates, reminders or completion', async () => {
    const bridge = loadFixture();
    const child = await bridge.invoke('create_task', { input: { title: 'Checklist', parent: 't2', list: 'work', due: '2026-08-25', reminders: [{ kind: 'relative', value: '-1h' }] } }) as TaskDto;
    await enable(bridge);
    const all = await rows(bridge); const next = all.find(task => task.recurrence_instance?.sequence === 2)!;
    const newChild = all.find(task => task.parent === next.id)!;
    expect(newChild).toMatchObject({ title: 'Checklist', status: 'todo', due: null, reminders: [] });
    expect(newChild.id).not.toBe(child.id);
    expect(await get(bridge, child.id)).toMatchObject({ due: '2026-08-25', reminders: [{ kind: 'relative', value: '-1h' }] });
  });

  it('uses fresh unique task IDs after Stop and restart and keeps owner Stop available', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const old = (await rows(bridge)).filter(task => task.recurrence_instance).map(task => task.id);
    await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } });
    await enable(bridge);
    const active = (await rows(bridge)).filter(task => task.recurrence_instance);
    expect(active).toHaveLength(3);
    expect(active.filter(task => task.id !== 't2').every(task => !old.includes(task.id))).toBe(true);
    for (const task of active) expect(await get(bridge, task.id)).toMatchObject({ id: task.id, deleted_at: null });
    const selected = active.find(task => task.id !== 't2')!;
    await bridge.invoke('edit_task', { id: selected.id, input: { body: 'Keep active for restart' } });
    await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } });
    await bridge.invoke('edit_task', { id: selected.id, input: { recurrence: rule(), recurrence_scope: 'this_and_following' } });
    await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } });
    expect((await get(bridge, 't2')).recurrence_series?.enabled).toBe(false);
  });

  it('keeps child touch markers sticky across Done and reopen so Stop preserves the family', async () => {
    const bridge = loadFixture();
    await bridge.invoke('create_task', { input: { title: 'Checklist', parent: 't2', list: 'work' } });
    await enable(bridge);
    const all = await rows(bridge); const next = all.find(task => task.recurrence_instance?.sequence === 2)!;
    const child = all.find(task => task.parent === next.id)!;
    await bridge.invoke('set_task_status', { id: child.id, status: 'done' });
    await bridge.invoke('set_task_status', { id: child.id, status: 'todo' });
    const stopped = await bridge.invoke('edit_task', { id: 't2', input: { clear_recurrence: true } }) as TaskDto;
    expect(stopped.recurrence_effect?.preserved_exception_count).toBe(1);
    expect(await get(bridge, next.id)).toMatchObject({ deleted_at: null, recurrence_instance: { detached: true } });
    expect(await get(bridge, child.id)).toMatchObject({ deleted_at: null, recurrence_exception: true });
  });

  it('preserves revision retirement and exception counts in the mutation effect', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const future = (await rows(bridge)).filter(task => task.id !== 't2' && task.recurrence_instance);
    await bridge.invoke('edit_task', { id: future[0].id, input: { title: 'My exception' } });
    const revised = await bridge.invoke('edit_task', { id: 't2', input: { recurrence: rule({ frequency: 'weekly' }), recurrence_scope: 'this_and_following' } }) as TaskDto;
    expect(revised.recurrence_effect).toMatchObject({ preserved_exception_count: 1, retired_count: 1 });
  });

  it('runs completion recurrence on board move and persists both records across reload', async () => {
    let bridge = loadFixture();
    await bridge.invoke('edit_task', { id: 't7', input: { due: '2026-08-20', recurrence: rule({ mode: 'completion', end: { kind: 'count', count: 2 } }) } });
    const result = await bridge.invoke('move_task', { id: 't7', input: { list_id: 'project', board_column_id: 'project-done', position: 'W' } }) as TaskDto;
    expect(result).toMatchObject({ id: 't7', status: 'done', due: '2026-08-20', board_column_id: 'project-done' });
    expect(result.recurrence_effect?.next_occurrence_id).toBeTruthy();
    bridge = bridge.reload();
    expect(await get(bridge, 't7')).toMatchObject({ status: 'done', board_column_id: 'project-done' });
    expect(await get(bridge, result.recurrence_effect!.next_occurrence_id!)).toMatchObject({ status: 'todo', board_column_id: 'project-queue' });
  });

  it('never regenerates a deleted future slot', async () => {
    const bridge = loadFixture(); await enable(bridge);
    const next = (await rows(bridge)).find(task => task.recurrence_instance?.sequence === 2)!;
    await bridge.invoke('delete_task', { id: next.id });
    await bridge.invoke('maintain_task_recurrences');
    expect((await rows(bridge)).filter(task => task.recurrence_instance)).toHaveLength(2);
    expect(await get(bridge, next.id)).toMatchObject({ deleted_at: expect.any(String) });
  });
});
