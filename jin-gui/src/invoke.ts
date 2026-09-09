/**
 * Typed invoke wrapper — the typed boundary between the frontend and the
 * jin-gui Tauri command bridge.
 *
 * Each function corresponds 1:1 to a #[tauri::command] in jin-gui/src-tauri.
 * The invoke call uses the Rust function's snake_case name exactly.
 *
 * Errors are propagated as JinErrorDto (from the Err arm of Result<T, JinErrorDto>).
 * Call sites should catch with `catch (err: unknown)` + `isJinErrorDto(err)`.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  AgendaDto,
  TodayProjectionDto,
  AssetEntry,
  AssetRepairReport,
  ResolvedImageAssetDto,
  AppConfigDto,
  AuthStatusDto,
  CaptureResultDto,
  CollectionDto,
  CollectionQueryDto,
  EventDetailDto,
  EventDto,
  EventAttendeeDto,
  EventConferenceDataDto,
  EventReminderSettingsDto,
  EditEventResultDto,
  ExportResultDto,
  FolderDto,
  GoogleAccountDto,
  LinkResultDto,
  ListDto,
  NoteDto,
  NoteRevisionPreviewDto,
  NotificationCenterPageDto,
  NotificationCenterSummaryDto,
  NotificationFilter,
  NotificationItemDto,
  NotificationStatusDto,
  PropertyValue,
  QuarantinedSyncOperationDto,
  RemoveTimeBlockResultDto,
  SectionDto,
  SyncSummary,
  TagDto,
  TaskDto,
  TestNotificationResultDto,
} from './types/dto';

/** Generate a bridge-safe idempotency key at the user-action boundary. */
export function newOperationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ── Agenda ─────────────────────────────────────────────────────────────────────

/** today_agenda(date?: string) -> AgendaDto */
export function todayAgenda(date?: string): Promise<AgendaDto> {
  return invoke<AgendaDto>('today_agenda', { date });
}

/** today_projection(date?: string) -> backend-authoritative connected Today data. */
export function todayProjection(date?: string): Promise<TodayProjectionDto> {
  return invoke<TodayProjectionDto>('today_projection', { date });
}

// ── Notes ──────────────────────────────────────────────────────────────────────

export function listNotes(options?: {
  include_deleted?: boolean;
  tag?: string;
  /** Wave 2A: filter by folder path (exact match). "" = Notes root, omit = all. */
  folder?: string;
}): Promise<NoteDto[]> {
  return invoke<NoteDto[]>('list_notes', {
    include_deleted: options?.include_deleted,
    tag: options?.tag,
    folder: options?.folder,
  });
}

export function getNoteById(id: string): Promise<NoteDto> {
  return invoke<NoteDto>('get_note', { id });
}

/** Deterministic FTS over note bodies, strict properties, and link labels. */
export function searchNotes(text: string): Promise<NoteDto[]> {
  return invoke<NoteDto[]>('search_notes', { text });
}

/** Immutable snapshot revisions available for conflict-aware restore. */
export function listNoteRevisions(id: string): Promise<number[]> {
  return invoke<number[]>('list_note_revisions', { id });
}

/** Safe recovery preview; does not expose a snapshot filesystem path. */
export function previewNoteRevision(id: string, revision: number): Promise<NoteRevisionPreviewDto> {
  return invoke<NoteRevisionPreviewDto>('preview_note_revision', { id, revision });
}

export function createNote(input: {
  title: string;
  body?: string;
  tags?: string[];
  /** Wave 2A: target folder path. Defaults to "" (Notes root). */
  folder?: string;
}): Promise<NoteDto> {
  return invoke<NoteDto>('create_note', { input });
}

/** Wave 2A: Move a note to a different folder. Returns the note with updated folder_path. */
export function moveNote(id: string, folder: string): Promise<NoteDto> {
  return invoke<NoteDto>('move_note', { id, folder });
}

export function editNote(
  id: string,
  input: {
    title?: string;
    body?: string;
    add_tags?: string[];
    rm_tags?: string[];
    expected_revision?: number;
  }
): Promise<NoteDto> {
  return invoke<NoteDto>('edit_note', { id, input });
}

export function setNoteProperties(
  id: string,
  properties: Record<string, PropertyValue>,
  expectedRevision?: number,
): Promise<NoteDto> {
  return invoke<NoteDto>('set_note_properties', {
    id,
    input: { properties, expected_revision: expectedRevision },
  });
}

export function restoreNoteRevision(
  id: string,
  revision: number,
  expectedRevision?: number,
): Promise<NoteDto> {
  return invoke<NoteDto>('restore_note_revision', {
    id,
    revision,
    expected_revision: expectedRevision,
  });
}

export function importAttachment(source: string): Promise<AssetEntry> {
  return invoke<AssetEntry>('import_attachment', { source });
}

export function listAttachments(): Promise<AssetEntry[]> {
  return invoke<AssetEntry[]>('list_attachments', {});
}

/** Read locally-managed image bytes after backend hash, manifest and MIME checks. */
export function resolveImageAttachment(hash: string): Promise<ResolvedImageAssetDto> {
  return invoke<ResolvedImageAssetDto>('resolve_image_attachment', { hash });
}

export function repairAttachments(): Promise<AssetRepairReport> {
  return invoke<AssetRepairReport>('repair_attachments', {});
}

export function deleteNote(id: string): Promise<NoteDto> {
  return invoke<NoteDto>('delete_note', { id });
}

// ── Folders (Wave 2A) ──────────────────────────────────────────────────────────

/** list_folders() -> FolderDto[] — union of index-derived folders + on-disk subdirs */
export function listFolders(): Promise<FolderDto[]> {
  return invoke<FolderDto[]>('list_folders', {});
}

/** create_folder(path) -> FolderDto — mkdir_all; path must be /`-joined, no .., no absolute */
export function createFolder(path: string): Promise<FolderDto> {
  return invoke<FolderDto>('create_folder', { path });
}

/**
 * rename_folder(old_path, new_path) -> void
 * Renames a folder: moves all notes under old_path to new_path (ULID links preserved);
 * refreshes the index. Snake_case keys match the Rust command params.
 */
export function renameFolder(oldPath: string, newPath: string): Promise<void> {
  return invoke<void>('rename_folder', { old_path: oldPath, new_path: newPath });
}

/**
 * delete_folder(path) -> number (moved count)
 * Deletes a folder non-destructively: moves all notes under path to parent_of(path);
 * refreshes the index. Returns the count of notes moved.
 */
export function deleteFolder(path: string): Promise<number> {
  return invoke<number>('delete_folder', { path });
}

// ── Notes Collections ───────────────────────────────────────────────────────────

export function listCollections(): Promise<CollectionDto[]> {
  return invoke<CollectionDto[]>('list_collections', {});
}

export function createCollection(input: {
  name: string;
  query: CollectionQueryDto;
}): Promise<CollectionDto> {
  return invoke<CollectionDto>('create_collection', { input });
}

export function renameCollection(id: string, name: string): Promise<CollectionDto> {
  return invoke<CollectionDto>('rename_collection', { id, name });
}

export function updateCollectionQuery(
  id: string,
  query: CollectionQueryDto,
): Promise<CollectionDto> {
  return invoke<CollectionDto>('update_collection_query', { id, input: { query } });
}

/** Deleting a collection never deletes its canonical notes. */
export function deleteCollection(id: string): Promise<void> {
  return invoke<void>('delete_collection', { id });
}

export function evaluateCollection(id: string): Promise<NoteDto[]> {
  return invoke<NoteDto[]>('evaluate_collection', { id });
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

export function listTasks(options?: {
  list?: string;
  status?: string;
  priority?: string;
  /** P4: filter by tag slug (exact match). */
  tag?: string;
  include_deleted?: boolean;
}): Promise<TaskDto[]> {
  return invoke<TaskDto[]>('list_tasks', {
    list: options?.list,
    status: options?.status,
    priority: options?.priority,
    tag: options?.tag,
    include_deleted: options?.include_deleted,
  });
}

export function getTaskById(id: string): Promise<TaskDto> {
  return invoke<TaskDto>('get_task', { id });
}

export function createTask(input: {
  title: string;
  body?: string;
  priority?: string;
  due?: string;
  list?: string;
  /** P4: tag slugs to attach on creation. */
  tags?: string[];
  /** P10: initial reminders. Omit to use auto-reminder logic. */
  reminders?: Array<{ kind: string; value: string }>;
  /** S6: id of the parent task, if this is a subtask. Omit for a top-level task. */
  parent?: string;
}): Promise<TaskDto> {
  return invoke<TaskDto>('create_task', { input });
}

export function editTask(
  id: string,
  input: {
    title?: string;
    body?: string;
    priority?: string;
    due?: string;
    clear_due?: boolean;
    list?: string;
    /** P4: replace tag slugs on this task (full overwrite). */
    tags?: string[];
    /** P5: assign to a section (Some(id) = set; omit = no change). */
    section_id?: string;
    /** P5: if true, clear section_id (set to null). */
    clear_section?: boolean;
    /** P10: replace full reminder list. Omit = no change; empty array = clear all. */
    reminders?: Array<{ kind: string; value: string }>;
    /** S6: reassign the parent (id of the new parent task). */
    parent?: string;
    /** S6: if true, detach from the parent (set parent = null). */
    clear_parent?: boolean;
  }
): Promise<TaskDto> {
  return invoke<TaskDto>('edit_task', { id, input });
}

export function setTaskStatus(id: string, status: string): Promise<TaskDto> {
  return invoke<TaskDto>('set_task_status', { id, status });
}

export function deleteTask(id: string): Promise<TaskDto> {
  return invoke<TaskDto>('delete_task', { id });
}

/**
 * P9 — Atomic drag/drop: set list, section_id, and position in one file write.
 * `position` must be a non-empty base-62 key computed by `rank.between()`.
 */
export function moveTask(
  id: string,
  input: { listId: string; sectionId?: string | null; position: string }
): Promise<TaskDto> {
  return invoke<TaskDto>('move_task', {
    id,
    input: {
      list_id: input.listId,
      section_id: input.sectionId ?? null,
      position: input.position,
    },
  });
}

/**
 * P9 — Reseed positions for the displayed order (used on auto→manual sort-mode flip).
 * `orderedIds` must list task ids in top-to-bottom display order.
 */
export function reseedPositions(
  listId: string,
  sectionId: string | null,
  orderedIds: string[]
): Promise<void> {
  return invoke<void>('reseed_positions', {
    input: {
      list_id: listId,
      section_id: sectionId,
      ordered_ids: orderedIds,
    },
  });
}

// ── Lists (P3) ─────────────────────────────────────────────────────────────────

/** list_lists() -> ListDto[] — including inbox + user-created lists with task counts. */
export function listLists(): Promise<ListDto[]> {
  return invoke<ListDto[]>('list_lists', {});
}

/**
 * create_list(input) -> ListDto
 * `color` and `icon` are REQUIRED by the bridge (Rust `CreateListInput` has no
 * `#[serde(default)]`) — Tauri rejects the call at argument deserialization
 * ("missing field") if either is omitted. Do not make these optional again;
 * that turns a `tsc` error back into a silent runtime failure.
 */
export function createList(input: {
  name: string;
  color: string;
  icon: string;
}): Promise<ListDto> {
  return invoke<ListDto>('create_list', { input });
}

/** edit_list(id, input) -> ListDto — rename / recolor / reicon / view / sort_mode. */
export function editList(
  id: string,
  input: {
    name?: string;
    color?: string;
    icon?: string;
    /** P6: persisted view mode — "list" | "board". */
    view?: string;
    /** P6: sort mode — "manual" | "due" | "priority" | "title" | "created". */
    sort_mode?: string;
  }
): Promise<ListDto> {
  return invoke<ListDto>('edit_list', { id, input });
}

/** reorder_list(id, position) -> ListDto — set fractional position key. */
export function reorderList(id: string, position: string): Promise<ListDto> {
  return invoke<ListDto>('reorder_list', { id, position });
}

/**
 * delete_list(id) -> void
 * Refuses to delete the inbox (returns error code 9).
 * Tasks belonging to the deleted list are reassigned to inbox.
 */
export function deleteList(id: string): Promise<void> {
  return invoke<void>('delete_list', { id });
}

// ── Sections (P5) ─────────────────────────────────────────────────────────────

/**
 * create_section(list_id, input) -> SectionDto
 * Appends a new section to the list's sections[]. Returns the created SectionDto.
 */
export function createSection(listId: string, name: string): Promise<SectionDto> {
  return invoke<SectionDto>('create_section', { list_id: listId, input: { name } });
}

/**
 * rename_section(list_id, section_id, input) -> SectionDto
 * Mutates the section name; writes and refreshes.
 */
export function renameSection(listId: string, sectionId: string, name: string): Promise<SectionDto> {
  return invoke<SectionDto>('rename_section', { list_id: listId, section_id: sectionId, input: { name } });
}

/**
 * reorder_section(list_id, section_id, input) -> SectionDto
 * Sets the section's fractional position key; writes and refreshes.
 */
export function reorderSection(listId: string, sectionId: string, position: string): Promise<SectionDto> {
  return invoke<SectionDto>('reorder_section', { list_id: listId, section_id: sectionId, input: { position } });
}

/**
 * delete_section(list_id, section_id) -> void
 * Removes the section AND actively clears section_id on all affected tasks.
 */
export function deleteSection(listId: string, sectionId: string): Promise<void> {
  return invoke<void>('delete_section', { list_id: listId, section_id: sectionId });
}

// ── Tags (P4) ──────────────────────────────────────────────────────────────────

/** list_tags() -> TagDto[] — all tags that have been used, with task counts. */
export function listTags(): Promise<TagDto[]> {
  return invoke<TagDto[]>('list_tags', {});
}

/** set_tag_color(slug, color) -> TagDto — update the color for an existing tag. */
export function setTagColor(slug: string, color: string): Promise<TagDto> {
  return invoke<TagDto>('set_tag_color', { slug, color });
}

// ── Events ─────────────────────────────────────────────────────────────────────

export function listEvents(options?: { include_deleted?: boolean }): Promise<EventDto[]> {
  return invoke<EventDto[]>('list_events', {
    include_deleted: options?.include_deleted,
  });
}

export function getEventById(id: string): Promise<EventDto> {
  return invoke<EventDto>('get_event', { id });
}

export function getEventDetailById(id: string): Promise<EventDetailDto> {
  return invoke<EventDetailDto>('get_event_detail', { id });
}

export function removeTimeBlock(input: {
  event_id: string;
  return_to_flexible: boolean;
  operation_id: string;
}): Promise<RemoveTimeBlockResultDto> {
  return invoke<RemoveTimeBlockResultDto>('remove_time_block', { input });
}

export function createEvent(input: {
  title: string;
  start: string;
  end: string;
  tzid?: string;
  is_all_day?: boolean;
  description?: string;
  location?: string;
  attendees?: EventAttendeeDto[];
  conference_data?: EventConferenceDataDto;
  reminders?: EventReminderSettingsDto;
  recurrence?: RecurrenceDraft;
}): Promise<EventDto> {
  return invoke<EventDto>('create_event', { input });
}

export function deleteEvent(id: string, recurrenceScope?: RecurrenceMutationScope): Promise<EventDto> {
  return invoke<EventDto>('delete_event', recurrenceScope ? { id, recurrence_scope: recurrenceScope } : { id });
}

export function editEvent(input: {
  event_id: string;
  edit_token: string;
  operation_id: string;
  title: string;
  start: string;
  end: string;
  tzid?: string;
  is_all_day?: boolean;
  description?: string;
  location?: string;
  attendees?: EventAttendeeDto[];
  attendees_omitted?: boolean;
  conference_data?: EventConferenceDataDto;
  clear_conference_data?: boolean;
  reminders?: EventReminderSettingsDto;
  recurrence_scope?: RecurrenceMutationScope;
}): Promise<EditEventResultDto> {
  return invoke<EditEventResultDto>('edit_event', { input });
}

export type RecurrenceMutationScope = 'this_occurrence' | 'entire_series';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceWeekday = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su';
export type MonthlyRecurrence =
  | { kind: 'day_of_month'; day: number }
  | { kind: 'nth_weekday'; ordinal: number; weekday: RecurrenceWeekday };
export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'until'; date: string }
  | { kind: 'count'; count: number };
export interface RecurrenceDraft {
  frequency: RecurrenceFrequency;
  interval: number;
  weekly_days: RecurrenceWeekday[];
  monthly?: MonthlyRecurrence;
  end: RecurrenceEnd;
}
export interface RecurrencePreviewDto {
  recurrence: string[];
  occurrences: string[];
}

export function previewRecurrence(input: {
  start: string;
  tzid?: string;
  is_all_day?: boolean;
  recurrence: RecurrenceDraft;
}): Promise<RecurrencePreviewDto> {
  return invoke<RecurrencePreviewDto>('preview_recurrence', { input });
}

export function createRoutedEvent(input: {
  title: string;
  start: string;
  end: string;
  tzid?: string;
  is_all_day?: boolean;
  description?: string;
  location?: string;
  attendees?: EventAttendeeDto[];
  conference_data?: EventConferenceDataDto;
  reminders?: EventReminderSettingsDto;
  recurrence?: RecurrenceDraft;
  account_id: string;
  calendar_id: string;
  operation_id: string;
}): Promise<EventDto> {
  return invoke<EventDto>('create_routed_event', { input });
}

export function editRoutedEvent(input: {
  event_id: string;
  edit_token: string;
  operation_id: string;
  title: string;
  start: string;
  end: string;
  tzid?: string;
  is_all_day?: boolean;
  description?: string;
  location?: string;
  attendees?: EventAttendeeDto[];
  attendees_omitted?: boolean;
  conference_data?: EventConferenceDataDto;
  clear_conference_data?: boolean;
  reminders?: EventReminderSettingsDto;
  account_id: string;
  calendar_id: string;
  recurrence_scope?: RecurrenceMutationScope;
}): Promise<EventDto> {
  return invoke<EventDto>('edit_routed_event', { input });
}

export function deleteRoutedEvent(input: {
  event_id: string;
  account_id: string;
  calendar_id: string;
  recurrence_scope?: RecurrenceMutationScope;
  operation_id: string;
}): Promise<EventDto> {
  return invoke<EventDto>('delete_routed_event', { input });
}

// ── Promote / attach / link ────────────────────────────────────────────────────

export function promoteTask(
  taskId: string,
  slot: { when: string; tzid?: string },
  operationId: string,
  destination?: { accountId: string; calendarId: string } | 'local',
): Promise<EventDto> {
  const request: Record<string, unknown> = {
    task_id: taskId,
    slot,
    operation_id: operationId,
  };
  if (destination === 'local') request.local_only = true;
  if (destination && destination !== 'local') {
    request.account_id = destination.accountId;
    request.calendar_id = destination.calendarId;
  }
  return invoke<EventDto>('promote_task', request);
}

export function attachNote(
  noteId: string,
  targetId: string,
  kind?: string
): Promise<LinkResultDto> {
  return invoke<LinkResultDto>('attach_note', { note_id: noteId, target_id: targetId, kind });
}

export function linkObjects(
  sourceId: string,
  targetId: string,
  edgeType: string
): Promise<LinkResultDto> {
  return invoke<LinkResultDto>('link', { source_id: sourceId, target_id: targetId, edge_type: edgeType });
}

// ── Capture ────────────────────────────────────────────────────────────────────

export function capture(
  text: string,
  options?: { as_task?: boolean; list?: string }
): Promise<CaptureResultDto> {
  return invoke<CaptureResultDto>('capture', {
    text,
    as_task: options?.as_task,
    list: options?.list,
  });
}

// ── Sync / auth / export ───────────────────────────────────────────────────────

export function runSync(): Promise<SyncSummary> {
  return invoke<SyncSummary>('run_sync', {});
}

// ── Multi-account Google Calendar registry ───────────────────────────────────

export function listGoogleAccounts(): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('list_google_accounts', {});
}

export function addGoogleAccount(alias: string): Promise<GoogleAccountDto> {
  return invoke<GoogleAccountDto>('add_google_account', { alias });
}

export function connectGoogleAccount(accountId: string): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('connect_google_account', { account_id: accountId });
}

export function renameGoogleAccount(accountId: string, alias: string): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('rename_google_account', { account_id: accountId, alias });
}

export function disconnectGoogleAccount(accountId: string): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('disconnect_google_account', { account_id: accountId });
}

export function refreshGoogleCalendars(accountId: string): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('refresh_google_calendars', { account_id: accountId });
}

export function setGoogleCalendarEnabled(
  accountId: string,
  calendarId: string,
  enabled: boolean,
): Promise<GoogleAccountDto[]> {
  return invoke<GoogleAccountDto[]>('set_google_calendar_enabled', {
    account_id: accountId,
    calendar_id: calendarId,
    enabled,
  });
}

export function listQuarantinedSyncOperations(): Promise<QuarantinedSyncOperationDto[]> {
  return invoke<QuarantinedSyncOperationDto[]>('list_quarantined_sync_operations', {});
}

export function reviewQuarantinedSyncOperation(
  operation: Pick<QuarantinedSyncOperationDto, 'provider' | 'account_id' | 'calendar_id' | 'operation_id'>,
  resume: boolean,
): Promise<QuarantinedSyncOperationDto[]> {
  return invoke<void>('review_quarantined_sync_operation', { ...operation, resume })
    .then(() => listQuarantinedSyncOperations());
}

export function authStatus(): Promise<AuthStatusDto> {
  return invoke<AuthStatusDto>('auth_status', {});
}

export function authLogin(): Promise<AuthStatusDto> {
  return invoke<AuthStatusDto>('auth_login', {});
}

export function authLogout(): Promise<AuthStatusDto> {
  return invoke<AuthStatusDto>('auth_logout', {});
}

export function exportFiles(dest: string, force?: boolean): Promise<ExportResultDto> {
  return invoke<ExportResultDto>('export_files', { dest, force });
}

export function appConfig(): Promise<AppConfigDto> {
  return invoke<AppConfigDto>('app_config', {});
}

export function notificationStatus(): Promise<NotificationStatusDto> {
  return invoke<NotificationStatusDto>('notification_status', {});
}

export function requestNotificationPermission(): Promise<NotificationStatusDto> {
  return invoke<NotificationStatusDto>('request_notification_permission', {});
}

export function openNotificationSettings(): Promise<void> {
  return invoke<void>('open_notification_settings', {});
}

export function sendTestNotification(): Promise<TestNotificationResultDto> {
  return invoke<TestNotificationResultDto>('send_test_notification', {});
}

// ── Durable Notification Center ──

export function listNotificationItems(input: {
  filter?: NotificationFilter;
  include_deferred?: boolean;
  include_terminal?: boolean;
  cursor?: string | null;
  limit?: number | null;
} = {}): Promise<NotificationCenterPageDto> {
  return invoke<NotificationCenterPageDto>('list_notification_items', {
    input: {
      filter: input.filter ?? 'all',
      include_deferred: input.include_deferred ?? false,
      include_terminal: input.include_terminal ?? false,
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
    },
  });
}

export function getNotificationItem(itemId: string): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('get_notification_item', { item_id: itemId });
}

export function notificationCenterSummary(): Promise<NotificationCenterSummaryDto> {
  return invoke<NotificationCenterSummaryDto>('notification_center_summary', {});
}

export function setNotificationRead(input: {
  item_id: string;
  read: boolean;
  expected_version: number;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('set_notification_read', { input });
}

export function deferNotificationItem(input: {
  item_id: string;
  visible_after: string;
  expected_version: number;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('defer_notification_item', { input });
}

export function dismissNotificationItem(input: {
  item_id: string;
  expected_version: number;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('dismiss_notification_item', { input });
}

export function respondCalendarInvitation(input: {
  item_id: string;
  expected_item_version: number;
  operation_id: string;
  response: 'allow' | 'maybe' | 'refuse';
  recurrence_scope: 'this_occurrence' | 'entire_series' | null;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('respond_calendar_invitation', { input });
}

export function retryCalendarInvitation(input: {
  item_id: string;
  expected_item_version: number;
  operation_id: string;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('retry_calendar_invitation', { input });
}

export function completeNotificationTask(input: {
  item_id: string;
  expected_item_version: number;
  operation_id: string;
}): Promise<NotificationItemDto> {
  return invoke<NotificationItemDto>('complete_notification_task', { input });
}

// ── Store root (P1 sovereignty — user controls store location) ─────────────────

/**
 * Persist the user-chosen jin store root.
 * The new path takes effect on the next application launch.
 */
export function setStoreRoot(path: string): Promise<void> {
  return invoke<void>('set_store_root', { path });
}

/**
 * Returns the active jin root for the current session.
 * This is the path resolved at launch — a restart is required after setStoreRoot.
 */
export function getStoreRoot(): Promise<string> {
  return invoke<string>('get_store_root', {});
}
