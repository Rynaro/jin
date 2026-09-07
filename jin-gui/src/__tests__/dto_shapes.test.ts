/**
 * dto_shapes.test.ts — DTO shape validation tests.
 *
 * These tests verify that the TypeScript DTO interfaces contain the
 * load-bearing fields for VG-GUI-2:
 *   - AgendaEventDto.originating_task: LinkedTaskRef | null
 *   - AgendaEventDto.prep_notes: LinkedNoteRef[]
 *
 * We also verify the JinErrorDto type guard and error code union exhaustion.
 *
 * No mocking needed — all tests operate on plain objects against the TS type
 * definitions and runtime type guard functions.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import type {
  AgendaDto,
  AgendaEventDto,
  FolderDto,
  LinkedTaskRef,
  LinkedNoteRef,
  NoteDto,
  TaskDto,
  EventDto,
  EventDetailCapabilitiesDto,
  EventDetailDto,
  RemoveTimeBlockResultDto,
  AuthStatusDto,
  SyncSummary,
  ExportResultDto,
  AppConfigDto,
  CaptureResultDto,
  LinkResultDto,
} from '../types/dto';
import { isJinErrorDto, type JinErrorDto } from '../types/error';

// ── VG-GUI-2 shape tests ─────────────────────────────────────────────────────

describe('AgendaEventDto — VG-GUI-2 fields', () => {
  it('accepts an event with originating_task populated (promoted event)', () => {
    const task: LinkedTaskRef = { id: 't-abc', title: 'Write report' };
    const event: AgendaEventDto = {
      id: 'e-001',
      title: 'Write report',
      start: '2026-06-27T09:00:00Z',
      end: '2026-06-27T10:00:00Z',
      is_all_day: false,
      start_tzid: 'UTC',
      floating: false,
      status: 'confirmed',
      source: 'local',
      authority: 'local',
      ical_uid: null,
      derived_from: 't-abc',
      recurrence_unexpanded: false,
      created: '2026-06-27T00:00:00Z',
      updated: '2026-06-27T00:00:00Z',
      display_start: '09:00',
      originating_task: task,
      prep_notes: [],
    };
    expect(event.originating_task).not.toBeNull();
    expect(event.originating_task?.id).toBe('t-abc');
    expect(event.originating_task?.title).toBe('Write report');
  });

  it('accepts originating_task: null for non-promoted events', () => {
    const event = buildMinimalEvent({ originating_task: null, prep_notes: [] });
    expect(event.originating_task).toBeNull();
  });

  it('accepts prep_notes with one or more notes', () => {
    const note: LinkedNoteRef = { id: 'n-abc', title: 'Prep context' };
    const event = buildMinimalEvent({ prep_notes: [note], originating_task: null });
    expect(event.prep_notes).toHaveLength(1);
    expect(event.prep_notes[0].id).toBe('n-abc');
    expect(event.prep_notes[0].title).toBe('Prep context');
  });

  it('accepts an empty prep_notes array', () => {
    const event = buildMinimalEvent({ prep_notes: [], originating_task: null });
    expect(event.prep_notes).toHaveLength(0);
  });

  it('holds both originating_task and prep_notes simultaneously (hero flow shape)', () => {
    const task: LinkedTaskRef = { id: 't-hero', title: 'Hero task' };
    const note: LinkedNoteRef = { id: 'n-hero', title: 'Prep note' };
    const event = buildMinimalEvent({ originating_task: task, prep_notes: [note] });
    expect(event.originating_task?.id).toBe('t-hero');
    expect(event.prep_notes[0].id).toBe('n-hero');
  });
});

// ── AgendaDto shape ──────────────────────────────────────────────────────────

describe('AgendaDto', () => {
  it('has date, display_tz, all_day_events and timed_events', () => {
    const agenda: AgendaDto = {
      date: '2026-06-27',
      display_tz: 'America/New_York',
      all_day_events: [],
      timed_events: [],
    };
    expect(agenda.date).toBe('2026-06-27');
    expect(agenda.display_tz).toBe('America/New_York');
    expect(Array.isArray(agenda.all_day_events)).toBe(true);
    expect(Array.isArray(agenda.timed_events)).toBe(true);
  });
});

describe('Event detail M1 DTO parity', () => {
  it('keeps capabilities on the detail wrapper', () => {
    const capabilities: EventDetailCapabilitiesDto = {
      display_kind: 'time-block',
      can_edit: true,
      can_delete: true,
      read_only_reason: null,
      can_return_task_to_flexible: true,
      originating_task: { id: 't1', title: 'Task', status: 'todo' },
    };
    const detail = {
      event: { id: 'e1' } as EventDto,
      capabilities,
    } satisfies EventDetailDto;
    expect(detail.capabilities.display_kind).toBe('time-block');
  });

  it('models the compound remove result without a second mutation response', () => {
    const result = {
      event: { id: 'e1', status: 'cancelled' } as EventDto,
      originating_task: { id: 't1', agenda_bucket: 'flexible' } as TaskDto,
    } satisfies RemoveTimeBlockResultDto;
    expect(result.originating_task?.agenda_bucket).toBe('flexible');
  });
});

// ── isJinErrorDto type guard ─────────────────────────────────────────────────

describe('isJinErrorDto', () => {
  it('returns true for a valid JinErrorDto', () => {
    const err: JinErrorDto = { code: 7, kind: 'integrity', message: 'not init', retriable: false };
    expect(isJinErrorDto(err)).toBe(true);
  });

  it('returns true for code 6 retriable error', () => {
    const err: JinErrorDto = { code: 6, kind: 'offline', message: 'offline', retriable: true };
    expect(isJinErrorDto(err)).toBe(true);
  });

  it('returns false for a plain Error object', () => {
    expect(isJinErrorDto(new Error('oops'))).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isJinErrorDto('not an object')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isJinErrorDto(null)).toBe(false);
  });

  it('returns false for an object missing the retriable field', () => {
    expect(isJinErrorDto({ code: 1, kind: 'other', message: 'x' })).toBe(false);
  });

  it('returns false for an object with wrong types', () => {
    expect(isJinErrorDto({ code: 'one', kind: 'other', message: 'x', retriable: false })).toBe(false);
  });
});

// ── Other DTO shapes (compile-time + runtime spot-checks) ────────────────────

describe('NoteDto shape', () => {
  it('has id, title, status, links, backlinks', () => {
    const note: NoteDto = {
      id: 'n1',
      title: 'Test',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
    };
    expect(note.id).toBe('n1');
    expect(Array.isArray(note.tags)).toBe(true);
  });

  /// VG1.6 / K3 — body_markdown is optional on the TS interface (present on get_note, absent on list).
  it('accepts body_markdown when present (get_note projection)', () => {
    const note: NoteDto = {
      id: 'n2',
      title: 'Detail Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      body_markdown: '# Hello\n\nContent.',
    };
    expect(note.body_markdown).toBe('# Hello\n\nContent.');
  });

  it('accepts body_markdown = null (absent from index projection)', () => {
    const note: NoteDto = {
      id: 'n3',
      title: 'List Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      body_markdown: null,
    };
    expect(note.body_markdown).toBeNull();
  });

  /// K3 — excerpt is optional on the TS interface (present on list_notes, absent on detail/create).
  it('accepts excerpt when present (list projection)', () => {
    const note: NoteDto = {
      id: 'n4',
      title: 'List Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      excerpt: 'quick brown fox',
    };
    expect(note.excerpt).toBe('quick brown fox');
  });

  it('accepts excerpt = null (absent from detail/create projections)', () => {
    const note: NoteDto = {
      id: 'n5',
      title: 'Detail Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      excerpt: null,
    };
    expect(note.excerpt).toBeNull();
  });

  /// Wave 2A / K3 — folder_path is optional on the TS interface.
  it('accepts folder_path when present (list / create / move projection)', () => {
    const note: NoteDto = {
      id: 'n6',
      title: 'Foldered Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      folder_path: 'Work',
    };
    expect(note.folder_path).toBe('Work');
  });

  it('accepts folder_path = "" (Notes root)', () => {
    const note: NoteDto = {
      id: 'n7',
      title: 'Root Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      folder_path: '',
    };
    expect(note.folder_path).toBe('');
  });

  it('accepts folder_path = null (absent from get_note projection)', () => {
    const note: NoteDto = {
      id: 'n8',
      title: 'Detail Only Note',
      status: 'active',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      deleted_at: null,
      tags: [],
      links: [],
      backlinks: [],
      folder_path: null,
    };
    expect(note.folder_path).toBeNull();
  });
});

// ── FolderDto shape (Wave 2A) ────────────────────────────────────────────────

describe('FolderDto shape (Wave 2A)', () => {
  it('has path, name, note_count', () => {
    const folder: FolderDto = {
      path: 'Work',
      name: 'Work',
      note_count: 5,
    };
    expect(folder.path).toBe('Work');
    expect(folder.name).toBe('Work');
    expect(folder.note_count).toBe(5);
  });

  it('root folder has empty path and "Notes" display name', () => {
    const root: FolderDto = {
      path: '',
      name: 'Notes',
      note_count: 0,
    };
    expect(root.path).toBe('');
    expect(root.name).toBe('Notes');
  });

  it('nested folder path uses "/" separator', () => {
    const nested: FolderDto = {
      path: 'Work/Projects',
      name: 'Projects',
      note_count: 2,
    };
    expect(nested.path).toContain('/');
    expect(nested.name).toBe('Projects');
  });
});

describe('TaskDto shape', () => {
  it('has id, title, status, priority, completed_at', () => {
    const task: TaskDto = {
      id: 't1',
      title: 'Task',
      status: 'todo',
      priority: 'normal',
      due: null,
      list: 'inbox',
      completed_at: null,
      deleted_at: null,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      backlinks: [],
    };
    expect(task.completed_at).toBeNull();
  });
});

describe('EventDto shape', () => {
  it('has derived_from field', () => {
    const ev: EventDto = {
      id: 'e1',
      title: 'Meeting',
      description: null,
      location: null,
      start: '2026-01-01T09:00:00Z',
      end: '2026-01-01T10:00:00Z',
      is_all_day: false,
      start_tzid: 'UTC',
      end_tzid: 'UTC',
      floating: false,
      status: 'confirmed',
      source: 'local',
      authority: 'local',
      ical_uid: null,
      derived_from: null,
      recurrence: [],
      recurring_event_id: null,
      original_start: null,
      master_id: null,
      recurrence_unexpanded: false,
      sequence: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      backlinks: [],
    };
    expect(Object.prototype.hasOwnProperty.call(ev, 'derived_from')).toBe(true);
  });
});

describe('EventDto Rust/TypeScript serialization parity (AC-GCAL-034)', () => {
  it('matches the Rust provider-backed serialization fixture byte-for-byte', () => {
    const rustTestSource = readFileSync(
      resolve(process.cwd(), '../jin-core/tests/event_dto_cross_language_parity.rs'),
      'utf8'
    );
    const fixtureMatch = rustTestSource.match(
      /const EVENT_DTO_RUST_SERIALIZATION_FIXTURE: &str = r#"(.*?)"#;/s
    );
    expect(fixtureMatch, 'Rust EventDto serialization fixture must remain discoverable').not.toBeNull();

    const rustSerialization = fixtureMatch![1];
    const typeScriptFixture = {
      id: 'google-event-123',
      title: 'Roadmap review',
      description: 'Quarterly planning',
      location: 'Room 42',
      start: '2026-08-27T13:00:00Z',
      end: '2026-08-27T14:00:00Z',
      is_all_day: false,
      start_tzid: 'America/Sao_Paulo',
      end_tzid: 'America/Sao_Paulo',
      floating: false,
      status: 'confirmed',
      source: 'google',
      authority: 'external',
      ical_uid: 'google-event-123@example.com',
      derived_from: null,
      recurrence: [],
      recurring_event_id: null,
      original_start: null,
      master_id: null,
      recurrence_unexpanded: false,
      sequence: 7,
      organizer: null,
      attendees: null,
      attendees_omitted: null,
      conference_data: null,
      hangout_link: null,
      reminders: null,
      created: '2026-08-27T12:00:00Z',
      updated: '2026-08-27T12:30:00Z',
      backlinks: [],
      sync_context: {
        provider: 'google',
        account_id: 'acct-work-01',
        account_alias: 'Work',
        calendar_id: 'team@example.com',
        calendar_name: 'Team Calendar',
        access_role: 'writer',
        writable: true,
        state: 'synced',
      },
    } satisfies EventDto;

    expect(rustSerialization).toBe(JSON.stringify(typeScriptFixture));
    expect(JSON.parse(rustSerialization).sync_context).toStrictEqual(typeScriptFixture.sync_context);
  });
});

describe('Notification Center DTO parity (AC-NC-050)', () => {
  function record(value: unknown, label: string): Record<string, unknown> {
    expect(value, label).not.toBeNull();
    expect(typeof value, label).toBe('object');
    expect(Array.isArray(value), label).toBe(false);
    return value as Record<string, unknown>;
  }

  function exactKeys(value: unknown, keys: string[], label: string): Record<string, unknown> {
    const result = record(value, label);
    expect(Object.keys(result).sort(), label).toStrictEqual([...keys].sort());
    return result;
  }

  function nullableString(value: unknown, label: string): void {
    expect(value === null || typeof value === 'string', label).toBe(true);
  }

  function validateCapabilities(value: unknown): void {
    const capabilities = exactKeys(value, [
      'can_mark_read', 'can_defer', 'can_dismiss', 'can_respond', 'can_complete_task',
      'can_open_source', 'recurrence_scopes', 'disabled_reason',
    ], 'capabilities');
    for (const key of ['can_mark_read', 'can_defer', 'can_dismiss', 'can_respond', 'can_complete_task', 'can_open_source']) {
      expect(typeof capabilities[key], `capabilities.${key}`).toBe('boolean');
    }
    expect(capabilities.recurrence_scopes).toEqual(expect.any(Array));
    nullableString(capabilities.disabled_reason, 'capabilities.disabled_reason');
  }

  function validateRecurrence(value: unknown): void {
    const recurrence = record(value, 'recurrence');
    if (recurrence.type === 'single') {
      exactKeys(recurrence, ['type'], 'single recurrence');
    } else if (recurrence.type === 'series_master') {
      exactKeys(recurrence, ['type', 'master_google_event_id'], 'series recurrence');
      expect(typeof recurrence.master_google_event_id).toBe('string');
    } else {
      const instance = exactKeys(
        recurrence,
        recurrence.original_start_tzid === undefined
          ? ['type', 'instance_google_event_id', 'recurring_event_id', 'original_start']
          : ['type', 'instance_google_event_id', 'recurring_event_id', 'original_start', 'original_start_tzid'],
        'instance recurrence',
      );
      expect(instance.type).toBe('instance');
      for (const key of ['instance_google_event_id', 'recurring_event_id', 'original_start']) {
        expect(typeof instance[key], `recurrence.${key}`).toBe('string');
      }
      if (instance.original_start_tzid !== undefined) expect(typeof instance.original_start_tzid).toBe('string');
    }
  }

  it('consumes generated Rust serialization and validates the exact TypeScript wire schema', () => {
    const stdout = execFileSync('cargo', [
      'run', '--quiet', '--manifest-path', resolve(process.cwd(), '../Cargo.toml'),
      '-p', 'jin-gui', '--example', 'notification_contract',
    ], { encoding: 'utf8' });
    const contract = exactKeys(JSON.parse(stdout) as unknown, [
      'items', 'page', 'summary', 'command_errors', 'enums', 'recurrence_identities',
    ], 'contract');
    expect(contract.items).toEqual(expect.any(Array));
    const items = contract.items as unknown[];
    expect(items.map((item) => record(item, 'item').kind)).toStrictEqual([
      'calendar_invitation',
      'task_reminder',
    ]);
    const common = [
      'id', 'source_key', 'source_revision', 'status', 'version', 'read_at', 'visible_after',
      'created_at', 'updated_at', 'requested_action', 'action_state', 'action_error',
      'native_state', 'resolution_origin', 'source_reason', 'kind', 'schema_version', 'title',
      'capabilities',
    ];
    const invitation = exactKeys(items[0], [...common,
      'account_id', 'account_alias', 'calendar_id', 'calendar_name', 'canonical_event_id',
      'google_event_id', 'recurrence', 'organizer_name', 'organizer_email', 'start', 'end',
      'all_day', 'timezone', 'location', 'self_email', 'provider_response_status', 'etag',
      'provider_subject', 'auth_generation', 'route_generation',
    ], 'calendar invitation');
    const reminder = exactKeys(items[1], [...common,
      'occurrence_key', 'task_id', 'scheduled_at', 'list_name', 'project_name', 'task_edit_token',
    ], 'task reminder');
    for (const item of [invitation, reminder]) {
      for (const key of ['id', 'source_key', 'source_revision', 'status', 'created_at', 'updated_at', 'native_state', 'title']) {
        expect(typeof item[key], key).toBe('string');
      }
      expect(typeof item.version).toBe('number');
      expect(typeof item.schema_version).toBe('number');
      for (const key of ['read_at', 'visible_after', 'requested_action', 'action_state', 'resolution_origin', 'source_reason']) {
        nullableString(item[key], key);
      }
      validateCapabilities(item.capabilities);
    }
    validateRecurrence(invitation.recurrence);
    expect(typeof invitation.all_day).toBe('boolean');
    for (const key of ['auth_generation', 'route_generation']) expect(typeof invitation[key]).toBe('number');
    for (const key of ['organizer_name', 'organizer_email', 'timezone', 'location']) nullableString(invitation[key], key);
    for (const key of ['list_name', 'project_name', 'task_edit_token']) nullableString(reminder[key], key);
    const actionError = exactKeys(reminder.action_error, ['code', 'message', 'retryable'], 'action error');
    expect(typeof actionError.retryable).toBe('boolean');

    const page = exactKeys(
      contract.page,
      ['items', 'next_cursor', 'snapshot_watermark', 'partial_errors'],
      'notification page',
    );
    expect(page.items).toStrictEqual(contract.items);
    nullableString(page.next_cursor, 'page.next_cursor');
    expect(typeof page.snapshot_watermark).toBe('string');
    expect(page.partial_errors).toEqual(expect.any(Array));
    const partialError = exactKeys(
      (page.partial_errors as unknown[])[0],
      ['source_kind', 'source_key', 'code', 'message', 'updated_at'],
      'partial source error',
    );
    for (const key of ['source_kind', 'source_key', 'code', 'message', 'updated_at']) {
      expect(typeof partialError[key], `partial error.${key}`).toBe('string');
    }
    const summary = exactKeys(
      contract.summary,
      ['visible_unread', 'visible_total', 'pending', 'errors', 'partial_error_count'],
      'notification summary',
    );
    for (const key of ['visible_unread', 'visible_total', 'pending', 'errors', 'partial_error_count']) {
      expect(typeof summary[key], `summary.${key}`).toBe('number');
    }
    expect(contract.command_errors).toEqual(expect.any(Array));
    const commandErrors = contract.command_errors as unknown[];
    expect(commandErrors).toHaveLength(2);
    for (const [index, value] of commandErrors.entries()) {
      const commandError = exactKeys(value, ['code', 'message', 'retryable', 'item'], `command error ${index}`);
      expect(typeof commandError.code).toBe('string');
      expect(typeof commandError.message).toBe('string');
      expect(typeof commandError.retryable).toBe('boolean');
      if (index === 0) expect(commandError.item).toStrictEqual(items[0]);
      else expect(commandError.item).toBeNull();
    }

    expect(contract.enums).toStrictEqual({
      source_kind: ['calendar_invitation', 'task_reminder'],
      status: ['active', 'action_pending', 'acted', 'superseded', 'dismissed', 'obsolete'],
      action: ['allow', 'maybe', 'refuse', 'complete_task'],
      invitation_response: ['allow', 'maybe', 'refuse'],
      recurrence_scope: ['this_occurrence', 'entire_series'],
      action_state: ['preparing', 'queued', 'sending', 'succeeded', 'failed_retryable', 'failed_terminal', 'superseded', 'obsolete'],
      native_state: ['not_requested', 'pending', 'submitted', 'failed', 'suppressed'],
      resolution_origin: ['jin', 'external'],
      filter: ['all', 'invitations', 'reminders', 'unread', 'deferred', 'history'],
    });
    expect(contract.recurrence_identities).toEqual(expect.any(Array));
    const recurrenceIdentities = contract.recurrence_identities as unknown[];
    recurrenceIdentities.forEach(validateRecurrence);
    expect(recurrenceIdentities.map((identity) => record(identity, 'recurrence identity').type)).toStrictEqual([
      'single',
      'series_master',
      'instance',
    ]);
  });
});

describe('AuthStatusDto shape', () => {
  it('allows all three state values', () => {
    const s1: AuthStatusDto = { state: 'connected', account: 'a@b.com', expires_at: 1000, backend: 'google' };
    const s2: AuthStatusDto = { state: 'disconnected', account: null, expires_at: null, backend: 'google' };
    const s3: AuthStatusDto = { state: 'needs_reauth', account: 'a@b.com', expires_at: null, backend: 'google' };
    expect(s1.state).toBe('connected');
    expect(s2.state).toBe('disconnected');
    expect(s3.state).toBe('needs_reauth');
  });
});

describe('SyncSummary shape', () => {
  it('has pulled, pushed, conflicts, errors', () => {
    const s: SyncSummary = {
      status: 'ok',
      pulled: 2,
      pushed: 1,
      resolved: 0,
      conflicts: 0,
      audit_log_path: null,
      errors: [],
    };
    expect(s.pulled).toBe(2);
    expect(s.errors).toHaveLength(0);
  });
});

describe('ExportResultDto shape', () => {
  it('has dest, file_count, files', () => {
    const r: ExportResultDto = {
      dest: '/tmp/export',
      file_count: 5,
      included_audit: false,
      files: ['a.md', 'b.md'],
    };
    expect(r.file_count).toBe(5);
    expect(r.files).toHaveLength(2);
  });
});

describe('AppConfigDto shape', () => {
  it('has root_path, display_tz, schema_version', () => {
    const c: AppConfigDto = {
      root_path: '/home/user/.jin',
      display_tz: 'UTC',
      calendar_id: null,
      schema_version: 1,
    };
    expect(c.schema_version).toBe(1);
  });
});

describe('CaptureResultDto shape', () => {
  it('has kind, id, data', () => {
    const r: CaptureResultDto = { kind: 'note', id: 'n1', data: {} as NoteDto };
    expect(r.kind).toBe('note');
  });
});

describe('LinkResultDto shape', () => {
  it('has edge_type, source_id, target_id', () => {
    const r: LinkResultDto = { edge_type: 'prep_for', source_id: 'n1', target_id: 'e1' };
    expect(r.edge_type).toBe('prep_for');
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMinimalEvent(
  overrides: Partial<AgendaEventDto> & Pick<AgendaEventDto, 'originating_task' | 'prep_notes'>
): AgendaEventDto {
  return {
    id: 'e-min',
    title: 'Minimal',
    start: '2026-06-27T09:00:00Z',
    end: '2026-06-27T10:00:00Z',
    is_all_day: false,
    start_tzid: 'UTC',
    floating: false,
    status: 'confirmed',
    source: 'local',
    authority: 'local',
    ical_uid: null,
    derived_from: null,
    recurrence_unexpanded: false,
    created: '2026-06-27T00:00:00Z',
    updated: '2026-06-27T00:00:00Z',
    display_start: '09:00',
    ...overrides,
  };
}
