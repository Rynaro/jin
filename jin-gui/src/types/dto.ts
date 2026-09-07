/**
 * Hand-mirrored TypeScript DTOs for jin-core.
 *
 * These mirror the Rust structs in jin-core/src/dto/*.rs exactly.
 * A shape-sync test (src/__tests__/dto_shapes.test.ts) exercises the
 * load-bearing fields (originating_task, prep_notes) to catch silent drift.
 *
 * [ASSUMPTION A1] — field names verified against jin-core/src/dto/* at GUI-S0.
 * If a Rust DTO field changes, update the matching interface here and the shape test.
 */

// ── Shared types ───────────────────────────────────────────────────────────────

export interface LinkDto {
  edge_type: string;
  target: string;
}

/** Strict portable Notes frontmatter property vocabulary. */
export type PropertyValue = string | number | boolean | string[];

export interface CanonicalLinkDto {
  target_id: string;
  label: string;
  start: number;
  end: number;
}

export interface UnlinkedMentionDto {
  target_id: string;
  label: string;
  start: number;
  end: number;
}

export interface AssetEntry {
  sha256: string;
  mime: string;
  size: number;
  original_names: string[];
}

export interface AssetRepairReport {
  added: string[];
  missing: string[];
  invalid: string[];
}

export interface BacklinkDto {
  source_id: string;
  source_kind: string;
  edge_type: string;
  label: string;
}

// ── NoteDto ────────────────────────────────────────────────────────────────────

/** Mirrors jin-core/src/dto/note.rs NoteDto */
export interface NoteDto {
  id: string;
  title: string;
  status: string;
  created: string;
  updated: string;
  deleted_at: string | null;
  tags: string[];
  links: LinkDto[];
  backlinks: BacklinkDto[];
  /**
   * Full markdown body of the note.
   * `Some` / present on `get_note` (read fresh from disk, D3 Wave 1).
   * `None` / absent on `list_notes` (body is never stored in the index, D1).
   * [ASSUMPTION A1] — verified against jin-core/src/dto/note.rs at Wave 1.
   */
  body_markdown?: string | null;
  /**
   * Short plain-text excerpt (≤200 chars, whitespace-collapsed, D2 Wave 1).
   * `Some` / present on `list_notes` (populated at rebuild time).
   * `None` / absent on `get_note` / create / edit responses.
   */
  excerpt?: string | null;
  /**
   * Relative folder path using `/`-separated components (Wave 2A).
   * `""` means the Notes root.
   * Present on `list_notes` (populated from index) and `create_note` / `move_note`.
   * Absent (`null`) on `get_note` (reads model directly, no index row).
   */
  folder_path?: string | null;
  properties?: Record<string, PropertyValue> | null;
  revision?: number | null;
  canonical_links?: CanonicalLinkDto[];
  unlinked_mentions?: UnlinkedMentionDto[];
}

// ── FolderDto ──────────────────────────────────────────────────────────────────

/** Mirrors jin-core/src/dto/folder.rs FolderDto (Wave 2A) */
export interface FolderDto {
  /** Relative path using `/`-separated components; `""` = Notes root. */
  path: string;
  /** Display name: last path component, or "Notes" for root. */
  name: string;
  /** Number of non-deleted notes in this folder (from index union + fs scan). */
  note_count: number;
}

// ── Notes Collections ───────────────────────────────────────────────────────────

/**
 * Closed, declarative collection filter grammar. It intentionally has no raw
 * SQL, JavaScript, template, or query-expression escape hatch.
 */
export type CollectionFilterDto =
  | { op: 'all'; clauses: CollectionFilterDto[] }
  | { op: 'any'; clauses: CollectionFilterDto[] }
  | { op: 'not'; clause: CollectionFilterDto }
  | { op: 'status'; value: string }
  | { op: 'tag'; value: string }
  | { op: 'property_equals'; key: string; value: PropertyValue }
  | { op: 'has_link'; target_id: string }
  | { op: 'body_contains'; value: string };

export interface CollectionSortDto {
  field: 'created' | 'updated' | 'title' | 'id';
  direction: 'asc' | 'desc';
}

export interface CollectionQueryDto {
  version: number;
  filter: CollectionFilterDto;
  sort: CollectionSortDto[];
  limit?: number | null;
}

/** Portable collection document. Unknown top-level fields survive bridge edits. */
export interface CollectionDto {
  schema_version: number;
  id: string;
  name: string;
  query: CollectionQueryDto;
  view: Record<string, unknown>;
  [unknownField: string]: unknown;
}

/** Recovery-preview DTO; intentionally contains no local filesystem path. */
export interface NoteRevisionPreviewDto {
  revision: number;
  title: string;
  body_markdown: string;
  updated: string;
}

// ── TaskDto ────────────────────────────────────────────────────────────────────

export interface TaskBacklinkDto {
  source_id: string;
  source_kind: string;
  edge_type: string;
  label: string;
}

/**
 * A reminder attached to a task (P2 storage; P10 surface).
 * Mirrors jin-core/src/dto/task.rs ReminderDto.
 */
export interface ReminderDto {
  kind: string; // "relative" | "absolute"
  value: string; // "-1h" | "-30m" | RFC-3339 timestamp
}

/** Mirrors jin-core/src/dto/task.rs TaskDto */
export interface TaskDto {
  id: string;
  title: string;
  status: string;
  priority: string;
  due: string | null;
  list: string;
  completed_at: string | null;
  deleted_at: string | null;
  created: string;
  updated: string;
  backlinks: TaskBacklinkDto[];
  /**
   * Task body (markdown). Populated on `get_task`; empty string on `list_tasks`.
   * Added in P1 body-fix. Use for display and editing in detail panel.
   */
  body?: string;
  // P2 fields
  /** Section within the task's list (null = "No Section"). Added in P2. */
  section_id?: string | null;
  /** Tag slugs attached to this task. Added in P2. */
  tags?: string[];
  /** Fractional position key for manual sort. Added in P2. */
  position?: string;
  /** Reminders (stored only in v1; no firing). Added in P2. */
  reminders?: ReminderDto[];
  /**
   * S6 — id of the parent task, if this task is a subtask. `null`/absent = a
   * top-level task. Populated on BOTH `create_task`/`edit_task`/`set_task_status`
   * (from_model) AND `list_tasks`/`get_task` (from_row) — see jin-core/src/dto/task.rs.
   */
  parent?: string | null;
  /** M1 explicit agenda placement; null means no flexible marker. */
  agenda_bucket?: 'flexible' | null;
}

// ── ListDto / SectionDto ───────────────────────────────────────────────────────

/** Mirrors jin-core/src/dto/list.rs SectionDto */
export interface SectionDto {
  id: string;
  list_id: string;
  name: string;
  position: string;
  task_count: number;
}

/** Mirrors jin-core/src/dto/list.rs ListDto */
export interface ListDto {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: string;
  parent_id: string | null;
  view: string;
  sort_mode: string;
  is_default: boolean;
  task_count: number;
  sections: SectionDto[];
}

// ── TagDto ─────────────────────────────────────────────────────────────────────

/** Mirrors jin-core/src/dto/tag.rs TagDto */
export interface TagDto {
  slug: string;
  name: string;
  color: string;
  task_count: number;
}

// ── EventDto ───────────────────────────────────────────────────────────────────

export interface EventBacklinkDto {
  source_id: string;
  source_kind: string;
  edge_type: string;
  label: string;
}

export interface EventOrganizerDto {
  id?: string;
  email?: string;
  displayName?: string;
  self?: boolean;
  [key: string]: unknown;
}

export interface EventAttendeeDto extends EventOrganizerDto {
  organizer?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: string;
  comment?: string;
  additionalGuests?: number;
}

export interface EventReminderOverrideDto {
  method: string;
  minutes: number;
  [key: string]: unknown;
}

export interface EventReminderSettingsDto {
  useDefault: boolean;
  overrides?: EventReminderOverrideDto[];
  [key: string]: unknown;
}

export interface ConferenceSolutionKeyDto {
  type?: string;
  [key: string]: unknown;
}

export interface ConferenceSolutionDto {
  key?: ConferenceSolutionKeyDto;
  name?: string;
  iconUri?: string;
  [key: string]: unknown;
}

export interface ConferenceEntryPointDto {
  entryPointType?: string;
  uri?: string;
  label?: string;
  pin?: string;
  accessCode?: string;
  meetingCode?: string;
  passcode?: string;
  password?: string;
  [key: string]: unknown;
}

export interface ConferenceCreateRequestDto {
  requestId?: string;
  conferenceSolutionKey?: ConferenceSolutionKeyDto;
  status?: { statusCode?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PendingConferenceCreateRequestDto {
  requestId: string;
  conferenceSolutionKey: ConferenceSolutionKeyDto;
}

export interface EventConferenceDataDto {
  createRequest?: ConferenceCreateRequestDto;
  pendingCreateRequest?: PendingConferenceCreateRequestDto;
  entryPoints?: ConferenceEntryPointDto[];
  conferenceSolution?: ConferenceSolutionDto;
  conferenceId?: string;
  signature?: string;
  notes?: string;
  [key: string]: unknown;
}

/** Mirrors jin-core/src/dto/event.rs EventDto */
export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  is_all_day: boolean;
  start_tzid: string | null;
  end_tzid: string | null;
  floating: boolean;
  status: string;
  source: string;
  authority: string;
  ical_uid: string | null;
  derived_from: string | null;
  recurrence: string[];
  recurring_event_id: string | null;
  original_start: string | null;
  master_id: string | null;
  recurrence_unexpanded: boolean;
  sequence: number;
  organizer?: EventOrganizerDto | null;
  attendees?: EventAttendeeDto[] | null;
  attendees_omitted?: boolean | null;
  conference_data?: EventConferenceDataDto | null;
  hangout_link?: string | null;
  /** Google Calendar delivery settings; unrelated to task reminder scheduling. */
  reminders?: EventReminderSettingsDto | null;
  created: string;
  updated: string;
  backlinks: EventBacklinkDto[];
  /** Exact provider route; absent for Jin-only events and legacy projections. */
  sync_context?: EventSyncContextDto | null;
}

export interface EventSyncContextDto {
  provider: string;
  account_id: string;
  account_alias: string;
  calendar_id: string;
  calendar_name: string;
  access_role: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | string;
  writable: boolean;
  state: string;
}

export interface GoogleCalendarDto {
  account_id: string;
  calendar_id: string;
  name: string;
  primary: boolean;
  access_role: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | string;
  writable: boolean;
  enabled: boolean;
  available: boolean;
  route_generation: number;
}

export interface GoogleAccountDto {
  id: string;
  alias: string;
  principal: string | null;
  state: 'pending' | 'connected' | 'needs_reauth' | 'disconnected' | string;
  auth_generation: number;
  calendars: GoogleCalendarDto[];
}

export interface QuarantinedSyncOperationDto {
  operation_id: string;
  provider: string;
  operation: 'insert' | 'patch' | 'delete';
  jin_id: string;
  recurrence_key: string;
  account_id: string;
  account_alias: string;
  calendar_id: string;
  calendar_name: string;
  pause_reason: string;
}

export type EventDisplayKind = 'event' | 'time-block';
export type EventReadOnlyReason =
  | 'cancelled'
  | 'recurring_milestone_1'
  | 'unsupported_recurrence'
  | 'external_authority_or_source';

export interface OriginatingTaskRefDto {
  id: string;
  title: string;
  status: string;
}

/** Detail-only policy projection; deliberately absent from EventDto list rows. */
export interface EventDetailCapabilitiesDto {
  display_kind: EventDisplayKind;
  can_edit: boolean;
  can_delete: boolean;
  read_only_reason: EventReadOnlyReason | null;
  recurrence_pattern_supported?: boolean;
  recurrence_scopes?: Array<'this_occurrence' | 'entire_series'>;
  can_return_task_to_flexible: boolean;
  originating_task: OriginatingTaskRefDto | null;
}

export interface EventDetailDto {
  event: EventDto;
  capabilities: EventDetailCapabilitiesDto;
  edit_token: string;
}

export interface EditEventResultDto {
  event: EventDto;
  no_op: boolean;
}

export interface RemoveTimeBlockResultDto {
  event: EventDto;
  originating_task: TaskDto | null;
}

// ── AgendaDto ──────────────────────────────────────────────────────────────────

/**
 * Linked task reference on an agenda event (originating_task).
 * Mirrors jin-core/src/dto/agenda.rs LinkedTaskRef.
 */
export interface LinkedTaskRef {
  id: string;
  title: string;
}

/**
 * Linked note reference on an agenda event (prep_notes).
 * Mirrors jin-core/src/dto/agenda.rs LinkedNoteRef.
 */
export interface LinkedNoteRef {
  id: string;
  title: string;
}

/**
 * A single event in the merged day agenda.
 * Mirrors jin-core/src/dto/agenda.rs AgendaEventDto.
 *
 * LOAD-BEARING for VG-GUI-2 (hero flow):
 *   - originating_task: populated for promoted events (derived-from edge)
 *   - prep_notes: populated for events with prep-for backlinks
 */
export interface AgendaEventDto {
  id: string;
  title: string;
  start: string;
  end: string;
  is_all_day: boolean;
  start_tzid: string | null;
  floating: boolean;
  status: string;
  source: string;
  authority: string;
  ical_uid: string | null;
  derived_from: string | null;
  recurrence_unexpanded: boolean;
  created: string;
  updated: string;
  /** Wall-time in display_tz as "HH:MM", or "all-day". */
  display_start: string;
  /** The task this event was promoted from, if any. */
  originating_task: LinkedTaskRef | null;
  /** Notes attached to this event via prep-for edges. */
  prep_notes: LinkedNoteRef[];
  sync_context?: EventSyncContextDto | null;
}

/** Mirrors jin-core/src/dto/agenda.rs AgendaDto */
export interface AgendaDto {
  /** Target date as "YYYY-MM-DD" in the display timezone. */
  date: string;
  /** IANA timezone name used for display and filtering. */
  display_tz: string;
  /** All-day events, sorted by date then title. */
  all_day_events: AgendaEventDto[];
  /** Timed and floating events, sorted by UTC start (ascending). */
  timed_events: AgendaEventDto[];
}

// ── Auth / Sync / Export / Config DTOs ────────────────────────────────────────

/** Mirrors jin-gui/src-tauri/src/commands/auth.rs AuthStatusDto */
export interface AuthStatusDto {
  state: 'connected' | 'disconnected' | 'needs_reauth';
  account: string | null;
  expires_at: number | null;
  backend: string;
}

/** Mirrors jin-core/src/ops/sync.rs SyncSummary */
export interface SyncSummary {
  status: string;
  pulled: number;
  pushed: number;
  resolved: number;
  conflicts: number;
  audit_log_path: string | null;
  errors: string[];
}

/** Mirrors jin-gui/src-tauri/src/commands/export.rs ExportResultDto */
export interface ExportResultDto {
  dest: string;
  file_count: number;
  included_audit: boolean;
  files: string[];
}

/** Mirrors jin-gui/src-tauri/src/commands/export.rs AppConfigDto */
export interface AppConfigDto {
  root_path: string;
  display_tz: string;
  calendar_id: string | null;
  schema_version: number;
}

// ── Notification Center DTOs ─────────────────────────────────────────────────────

/** Mirrors jin-core/src/notification_center.rs closed enums. */
export type NotificationItemStatus =
  | 'active'
  | 'action_pending'
  | 'acted'
  | 'superseded'
  | 'dismissed'
  | 'obsolete';

export type NotificationAction = 'allow' | 'maybe' | 'refuse' | 'complete_task';

export type NotificationActionState =
  | 'preparing'
  | 'queued'
  | 'sending'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'superseded'
  | 'obsolete';

export type NativeDeliveryState =
  | 'not_requested'
  | 'pending'
  | 'submitted'
  | 'failed'
  | 'suppressed';

export type NotificationResolutionOrigin = 'jin' | 'external';
export type NotificationSourceKind = 'calendar_invitation' | 'task_reminder';
export type InvitationRecurrenceScope = 'this_occurrence' | 'entire_series';
export type NotificationFilter =
  | 'all'
  | 'invitations'
  | 'reminders'
  | 'unread'
  | 'deferred'
  | 'history';

export type InvitationRecurrenceIdentity =
  | { type: 'single' }
  | { type: 'series_master'; master_google_event_id: string }
  | {
      type: 'instance';
      instance_google_event_id: string;
      recurring_event_id: string;
      original_start: string;
      original_start_tzid?: string;
    };

export interface NotificationCapabilitiesDto {
  can_mark_read: boolean;
  can_defer: boolean;
  can_dismiss: boolean;
  can_respond: boolean;
  can_complete_task: boolean;
  can_open_source: boolean;
  recurrence_scopes: InvitationRecurrenceScope[];
  disabled_reason: string | null;
}

export interface NotificationActionErrorDto {
  code: string;
  message: string;
  retryable: boolean;
}

interface NotificationItemCommonDto {
  id: string;
  source_key: string;
  source_revision: string;
  status: NotificationItemStatus;
  version: number;
  read_at: string | null;
  visible_after: string | null;
  created_at: string;
  updated_at: string;
  requested_action: NotificationAction | null;
  action_state: NotificationActionState | null;
  action_error: NotificationActionErrorDto | null;
  native_state: NativeDeliveryState;
  resolution_origin: NotificationResolutionOrigin | null;
  source_reason: string | null;
}

export interface CalendarInvitationNotificationDto extends NotificationItemCommonDto {
  kind: 'calendar_invitation';
  schema_version: number;
  account_id: string;
  account_alias: string;
  calendar_id: string;
  calendar_name: string;
  canonical_event_id: string;
  google_event_id: string;
  recurrence: InvitationRecurrenceIdentity;
  title: string;
  organizer_name: string | null;
  organizer_email: string | null;
  start: string;
  end: string;
  all_day: boolean;
  timezone: string | null;
  location: string | null;
  self_email: string;
  provider_response_status: string;
  etag: string;
  provider_subject: string;
  auth_generation: number;
  route_generation: number;
  capabilities: NotificationCapabilitiesDto;
}

export interface TaskReminderNotificationDto extends NotificationItemCommonDto {
  kind: 'task_reminder';
  schema_version: number;
  occurrence_key: string;
  task_id: string;
  title: string;
  scheduled_at: string;
  list_name: string | null;
  project_name: string | null;
  task_edit_token: string | null;
  capabilities: NotificationCapabilitiesDto;
}

export type NotificationItemDto =
  | CalendarInvitationNotificationDto
  | TaskReminderNotificationDto;

export interface NotificationListRequestDto {
  filter: NotificationFilter;
  include_deferred: boolean;
  include_terminal: boolean;
  cursor: string | null;
  limit: number | null;
}

export interface NotificationCenterPageDto {
  items: NotificationItemDto[];
  next_cursor: string | null;
  snapshot_watermark: string;
  partial_errors: NotificationSourceErrorDto[];
}

export interface NotificationSourceErrorDto {
  source_kind: NotificationSourceKind;
  source_key: string;
  code: string;
  message: string;
  updated_at: string;
}

export interface NotificationCenterSummaryDto {
  visible_unread: number;
  visible_total: number;
  pending: number;
  errors: number;
  partial_error_count: number;
}

export interface NotificationCommandErrorDto {
  code: string;
  message: string;
  retryable: boolean;
  item: NotificationItemDto | null;
}

export type NotificationPermission =
  | 'granted' | 'denied' | 'prompt' | 'restricted'
  | 'not_applicable' | 'unavailable' | 'unknown';

export interface NotificationStatusDto {
  platform: string;
  permission: NotificationPermission;
  reason: string;
  can_request: boolean;
  can_open_settings: boolean;
  settings_scope: string;
}

export interface TestNotificationResultDto {
  submitted: boolean;
  message: string;
}

/** Mirrors jin-gui/src-tauri/src/commands/capture.rs CaptureResultDto */
export interface CaptureResultDto {
  kind: 'note' | 'task';
  id: string;
  data: NoteDto | TaskDto;
}

/** Mirrors jin-gui/src-tauri/src/commands/attach.rs LinkResultDto */
export interface LinkResultDto {
  edge_type: string;
  source_id: string;
  target_id: string;
}
