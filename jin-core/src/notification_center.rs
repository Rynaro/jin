//! Durable, device-local Notification Center projection.
//!
//! Canonical Task and Event files remain authoritative. This module stores a
//! rebuildable inbox snapshot, user curation, and recoverable action attempts.

use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{JinError, Result};

#[cfg(test)]
static PREPARE_ACTION_BEFORE_TRANSACTION_HOOK: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn run_prepare_action_before_transaction_hook() {
    if let Some(hook) = PREPARE_ACTION_BEFORE_TRANSACTION_HOOK
        .lock()
        .unwrap()
        .take()
    {
        hook();
    }
}

pub const NOTIFICATION_CENTER_SCHEMA_VERSION: u32 = 1;
pub const NOTIFICATION_PAYLOAD_SCHEMA_VERSION: u32 = 1;
pub const NATIVE_DELIVERY_ATTEMPT_LIMIT: u32 = 3;
const SQLITE_BUSY_TIMEOUT: StdDuration = StdDuration::from_secs(5);

static INITIALIZATION_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS notification_center_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_items (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('calendar_invitation','task_reminder')),
    source_key TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    kind_payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','action_pending','acted','superseded','dismissed','obsolete')),
    read_at TEXT,
    visible_after TEXT,
    requested_action TEXT CHECK(requested_action IS NULL OR requested_action IN ('allow','maybe','refuse','complete_task')),
    action_error_code TEXT,
    action_error_message TEXT,
    native_state TEXT NOT NULL CHECK(native_state IN ('not_requested','pending','submitted','failed','suppressed')),
    native_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(native_attempt_count >= 0),
    native_next_attempt_at TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    last_seen_at TEXT NOT NULL,
    resolution_origin TEXT CHECK(resolution_origin IS NULL OR resolution_origin IN ('jin','external')),
    source_reason TEXT,
    UNIQUE(source_kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_items_visible
    ON notification_items(status, visible_after, read_at, updated_at, id);

CREATE TABLE IF NOT EXISTS notification_action_attempts (
    operation_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    requested_action TEXT NOT NULL CHECK(requested_action IN ('allow','maybe','refuse','complete_task')),
    recurrence_scope TEXT CHECK(recurrence_scope IS NULL OR recurrence_scope IN ('this_occurrence','entire_series')),
    state TEXT NOT NULL CHECK(state IN ('preparing','queued','sending','succeeded','failed_retryable','failed_terminal','superseded','obsolete')),
    intent_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    provider TEXT,
    account_id TEXT,
    calendar_id TEXT,
    canonical_event_id TEXT,
    google_event_id TEXT,
    recurrence_key TEXT,
    self_email TEXT,
    provider_subject TEXT,
    auth_generation INTEGER,
    route_generation INTEGER,
    base_etag TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 1),
    error_code TEXT,
    error_message TEXT,
    observed_response TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(item_id) REFERENCES notification_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_item_state
    ON notification_action_attempts(item_id, state, updated_at);

CREATE TABLE IF NOT EXISTS notification_action_attempt_audit (
    operation_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    requested_action TEXT NOT NULL,
    recurrence_scope TEXT,
    state TEXT NOT NULL,
    intent_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    provider TEXT,
    account_id TEXT,
    calendar_id TEXT,
    canonical_event_id TEXT,
    google_event_id TEXT,
    recurrence_key TEXT,
    self_email TEXT,
    provider_subject TEXT,
    auth_generation INTEGER,
    route_generation INTEGER,
    base_etag TEXT,
    retry_count INTEGER NOT NULL,
    error_code TEXT,
    error_message TEXT,
    observed_response TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_source_tombstones (
    source_kind TEXT NOT NULL CHECK(source_kind IN ('calendar_invitation','task_reminder')),
    source_key TEXT NOT NULL,
    terminal_status TEXT NOT NULL CHECK(terminal_status IN ('acted','superseded','dismissed','obsolete')),
    last_source_revision TEXT NOT NULL,
    response_cycle_fingerprint TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(source_kind, source_key)
);

CREATE TABLE IF NOT EXISTS notification_source_errors (
    source_kind TEXT NOT NULL,
    source_key TEXT NOT NULL,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(source_kind, source_key)
);
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationSourceKind {
    CalendarInvitation,
    TaskReminder,
}

impl NotificationSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CalendarInvitation => "calendar_invitation",
            Self::TaskReminder => "task_reminder",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "calendar_invitation" => Ok(Self::CalendarInvitation),
            "task_reminder" => Ok(Self::TaskReminder),
            _ => Err(JinError::Integrity(format!(
                "unsupported Notification Center source kind: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationStatus {
    Active,
    ActionPending,
    Acted,
    Superseded,
    Dismissed,
    Obsolete,
}

impl NotificationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::ActionPending => "action_pending",
            Self::Acted => "acted",
            Self::Superseded => "superseded",
            Self::Dismissed => "dismissed",
            Self::Obsolete => "obsolete",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "action_pending" => Ok(Self::ActionPending),
            "acted" => Ok(Self::Acted),
            "superseded" => Ok(Self::Superseded),
            "dismissed" => Ok(Self::Dismissed),
            "obsolete" => Ok(Self::Obsolete),
            _ => Err(JinError::Integrity(format!(
                "unsupported Notification Center item status: {value}"
            ))),
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Acted | Self::Superseded | Self::Dismissed | Self::Obsolete
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeDeliveryState {
    NotRequested,
    Pending,
    Submitted,
    Failed,
    Suppressed,
}

impl NativeDeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequested => "not_requested",
            Self::Pending => "pending",
            Self::Submitted => "submitted",
            Self::Failed => "failed",
            Self::Suppressed => "suppressed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "not_requested" => Ok(Self::NotRequested),
            "pending" => Ok(Self::Pending),
            "submitted" => Ok(Self::Submitted),
            "failed" => Ok(Self::Failed),
            "suppressed" => Ok(Self::Suppressed),
            _ => Err(JinError::Integrity(format!(
                "unsupported native notification state: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationAction {
    Allow,
    Maybe,
    Refuse,
    CompleteTask,
}

impl NotificationAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Maybe => "maybe",
            Self::Refuse => "refuse",
            Self::CompleteTask => "complete_task",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "allow" => Ok(Self::Allow),
            "maybe" => Ok(Self::Maybe),
            "refuse" => Ok(Self::Refuse),
            "complete_task" => Ok(Self::CompleteTask),
            _ => Err(JinError::Integrity(format!(
                "unsupported Notification Center action: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvitationResponse {
    Allow,
    Maybe,
    Refuse,
}

impl InvitationResponse {
    pub fn provider_status(self) -> &'static str {
        match self {
            Self::Allow => "accepted",
            Self::Maybe => "tentative",
            Self::Refuse => "declined",
        }
    }

    pub fn action(self) -> NotificationAction {
        match self {
            Self::Allow => NotificationAction::Allow,
            Self::Maybe => NotificationAction::Maybe,
            Self::Refuse => NotificationAction::Refuse,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvitationRecurrenceScope {
    ThisOccurrence,
    EntireSeries,
}

impl InvitationRecurrenceScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ThisOccurrence => "this_occurrence",
            Self::EntireSeries => "entire_series",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionAttemptState {
    Preparing,
    Queued,
    Sending,
    Succeeded,
    FailedRetryable,
    FailedTerminal,
    Superseded,
    Obsolete,
}

impl ActionAttemptState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Queued => "queued",
            Self::Sending => "sending",
            Self::Succeeded => "succeeded",
            Self::FailedRetryable => "failed_retryable",
            Self::FailedTerminal => "failed_terminal",
            Self::Superseded => "superseded",
            Self::Obsolete => "obsolete",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "preparing" => Ok(Self::Preparing),
            "queued" => Ok(Self::Queued),
            "sending" => Ok(Self::Sending),
            "succeeded" => Ok(Self::Succeeded),
            "failed_retryable" => Ok(Self::FailedRetryable),
            "failed_terminal" => Ok(Self::FailedTerminal),
            "superseded" => Ok(Self::Superseded),
            "obsolete" => Ok(Self::Obsolete),
            _ => Err(JinError::Integrity(format!(
                "unsupported Notification Center attempt state: {value}"
            ))),
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded
                | Self::FailedRetryable
                | Self::FailedTerminal
                | Self::Superseded
                | Self::Obsolete
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionOrigin {
    Jin,
    External,
}

impl ResolutionOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Jin => "jin",
            Self::External => "external",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "jin" => Ok(Self::Jin),
            "external" => Ok(Self::External),
            _ => Err(JinError::Integrity(format!(
                "unsupported Notification Center resolution origin: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InvitationRecurrenceIdentity {
    Single,
    SeriesMaster {
        master_google_event_id: String,
    },
    Instance {
        instance_google_event_id: String,
        recurring_event_id: String,
        original_start: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        original_start_tzid: Option<String>,
    },
}

impl InvitationRecurrenceIdentity {
    pub fn recurrence_key(&self) -> String {
        match self {
            Self::Single | Self::SeriesMaster { .. } => "master".to_string(),
            Self::Instance {
                original_start,
                original_start_tzid,
                ..
            } => match original_start_tzid {
                Some(tzid) => format!("{original_start}@{tzid}"),
                None => original_start.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationCapabilities {
    pub can_mark_read: bool,
    pub can_defer: bool,
    pub can_dismiss: bool,
    pub can_respond: bool,
    pub can_complete_task: bool,
    pub can_open_source: bool,
    pub recurrence_scopes: Vec<InvitationRecurrenceScope>,
    pub disabled_reason: Option<String>,
}

impl Default for NotificationCapabilities {
    fn default() -> Self {
        Self {
            can_mark_read: true,
            can_defer: true,
            can_dismiss: true,
            can_respond: false,
            can_complete_task: false,
            can_open_source: true,
            recurrence_scopes: Vec::new(),
            disabled_reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarInvitationPayload {
    pub schema_version: u32,
    pub account_id: String,
    pub account_alias: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub canonical_event_id: String,
    pub google_event_id: String,
    pub recurrence: InvitationRecurrenceIdentity,
    pub title: String,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub timezone: Option<String>,
    pub location: Option<String>,
    pub self_email: String,
    pub provider_response_status: String,
    pub etag: String,
    pub provider_subject: String,
    pub auth_generation: u64,
    pub route_generation: u64,
    pub capabilities: NotificationCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskReminderPayload {
    pub schema_version: u32,
    pub occurrence_key: String,
    pub task_id: String,
    pub title: String,
    pub scheduled_at: String,
    pub list_name: Option<String>,
    pub project_name: Option<String>,
    pub task_edit_token: Option<String>,
    pub capabilities: NotificationCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NotificationPayload {
    CalendarInvitation(Box<CalendarInvitationPayload>),
    TaskReminder(Box<TaskReminderPayload>),
}

impl NotificationPayload {
    pub fn source_kind(&self) -> NotificationSourceKind {
        match self {
            Self::CalendarInvitation(_) => NotificationSourceKind::CalendarInvitation,
            Self::TaskReminder(_) => NotificationSourceKind::TaskReminder,
        }
    }

    pub fn capabilities(&self) -> &NotificationCapabilities {
        match self {
            Self::CalendarInvitation(payload) => &payload.capabilities,
            Self::TaskReminder(payload) => &payload.capabilities,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationActionError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationItem {
    pub id: String,
    pub source_key: String,
    pub source_revision: String,
    pub status: NotificationStatus,
    pub version: u64,
    pub read_at: Option<String>,
    pub visible_after: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub requested_action: Option<NotificationAction>,
    pub action_state: Option<ActionAttemptState>,
    pub action_error: Option<NotificationActionError>,
    pub native_state: NativeDeliveryState,
    pub resolution_origin: Option<ResolutionOrigin>,
    pub source_reason: Option<String>,
    #[serde(flatten)]
    pub payload: NotificationPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationFilter {
    All,
    Invitations,
    Reminders,
    Unread,
    Deferred,
    History,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationListRequest {
    pub filter: NotificationFilter,
    pub include_deferred: bool,
    pub include_terminal: bool,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

impl Default for NotificationListRequest {
    fn default() -> Self {
        Self {
            filter: NotificationFilter::All,
            include_deferred: false,
            include_terminal: false,
            cursor: None,
            limit: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationCenterPage {
    pub items: Vec<NotificationItem>,
    pub next_cursor: Option<String>,
    pub snapshot_watermark: String,
    pub partial_errors: Vec<NotificationSourceError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct NotificationCenterSummary {
    pub visible_unread: u64,
    pub visible_total: u64,
    pub pending: u64,
    pub errors: u64,
    pub partial_error_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationSourceError {
    pub source_kind: NotificationSourceKind,
    pub source_key: String,
    pub code: String,
    pub message: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RespondInvitationRequest {
    pub item_id: String,
    pub expected_item_version: u64,
    pub operation_id: String,
    pub response: InvitationResponse,
    pub recurrence_scope: Option<InvitationRecurrenceScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetryInvitationRequest {
    pub item_id: String,
    pub expected_item_version: u64,
    pub operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompleteNotificationTaskRequest {
    pub item_id: String,
    pub expected_item_version: u64,
    pub operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationSource {
    pub source_key: String,
    pub source_revision: String,
    pub payload: NotificationPayload,
    pub request_native_signal: bool,
    /// True only after observing a non-needsAction revision followed by a newer
    /// needsAction revision. Ordinary organizer edits must leave this false.
    pub new_response_cycle: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvitationReconcileError {
    pub source_key: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvitationReconcileReport {
    pub scanned: usize,
    pub upserted: usize,
    pub resolved: usize,
    pub obsoleted: usize,
    pub errors: Vec<InvitationReconcileError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionAttemptIntent {
    pub operation_id: String,
    pub item_id: String,
    pub expected_item_version: u64,
    pub requested_action: NotificationAction,
    pub recurrence_scope: Option<InvitationRecurrenceScope>,
    pub source_revision: String,
    pub provider: Option<String>,
    pub account_id: Option<String>,
    pub calendar_id: Option<String>,
    pub canonical_event_id: Option<String>,
    pub google_event_id: Option<String>,
    pub recurrence_key: Option<String>,
    pub self_email: Option<String>,
    pub provider_subject: Option<String>,
    pub auth_generation: Option<u64>,
    pub route_generation: Option<u64>,
    pub base_etag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationActionAttempt {
    pub operation_id: String,
    pub item_id: String,
    pub requested_action: NotificationAction,
    pub recurrence_scope: Option<InvitationRecurrenceScope>,
    pub state: ActionAttemptState,
    pub source_revision: String,
    pub provider: Option<String>,
    pub account_id: Option<String>,
    pub calendar_id: Option<String>,
    pub canonical_event_id: Option<String>,
    pub google_event_id: Option<String>,
    pub recurrence_key: Option<String>,
    pub self_email: Option<String>,
    pub provider_subject: Option<String>,
    pub auth_generation: Option<u64>,
    pub route_generation: Option<u64>,
    pub base_etag: Option<String>,
    pub retry_count: u8,
    pub error: Option<NotificationActionError>,
    pub observed_response: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub item: Option<Box<NotificationItem>>,
}

impl std::fmt::Display for NotificationCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NotificationCommandError {}

impl NotificationCommandError {
    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: redact_provider_error(&message.into()),
            retryable,
            item: None,
        }
    }

    fn stale(item: NotificationItem) -> Self {
        Self {
            code: "stale_item".to_string(),
            message: "This notification changed; review the latest state.".to_string(),
            retryable: true,
            item: Some(Box::new(item)),
        }
    }

    pub fn from_jin(error: JinError) -> Self {
        let (code, retryable) = match &error {
            JinError::NotFound(_) => ("not_found", false),
            JinError::Auth(_) => ("reauth_required", false),
            JinError::Offline(_) => ("provider_failed", true),
            JinError::OperationConflict { reason, .. } => {
                (closed_command_error_code(reason), false)
            }
            JinError::InvalidInput(message) => (closed_command_error_code(message), false),
            JinError::InvalidStateTransition { .. } => ("ineligible", false),
            _ => ("provider_failed", true),
        };
        Self::new(code, error.to_string(), retryable)
    }
}

pub struct NotificationCenter {
    path: PathBuf,
    conn: SynchronizedConnection,
}

/// Keeps SQLite connection teardown in the same per-path critical section as
/// initialization. SQLite can otherwise deadlock when one thread closes a
/// connection while another opens the same database.
struct SynchronizedConnection {
    lifecycle_lock: Arc<Mutex<()>>,
    connection: Option<Connection>,
}

impl SynchronizedConnection {
    fn new(lifecycle_lock: Arc<Mutex<()>>, connection: Connection) -> Self {
        Self {
            lifecycle_lock,
            connection: Some(connection),
        }
    }
}

impl Deref for SynchronizedConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.connection
            .as_ref()
            .expect("Notification Center connection must exist until it is dropped")
    }
}

impl DerefMut for SynchronizedConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.connection
            .as_mut()
            .expect("Notification Center connection must exist until it is dropped")
    }
}

impl Drop for SynchronizedConnection {
    fn drop(&mut self) {
        let _lifecycle_guard = self
            .lifecycle_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        drop(self.connection.take());
    }
}

struct AnsweredInvitationTombstone<'a> {
    source_key: &'a str,
    source_revision: &'a str,
    account_id: &'a str,
    calendar_id: &'a str,
    google_event_id: &'a str,
    recurrence_key: &'a str,
    self_email: &'a str,
    response_status: &'a str,
}

fn initialization_lock(path: &Path) -> Arc<Mutex<()>> {
    let key = path.parent().map_or_else(
        || path.to_path_buf(),
        |parent| {
            let normalized_parent =
                std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
            path.file_name().map_or(normalized_parent.clone(), |name| {
                normalized_parent.join(name)
            })
        },
    );
    let locks = INITIALIZATION_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

impl NotificationCenter {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let initialization_lock = initialization_lock(path);
        let _initialization_guard = initialization_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut conn = Connection::open(path).map_err(JinError::Index)?;
        conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(JinError::Index)?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(JinError::Index)?;
        let journal_mode = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .map_err(JinError::Index)?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            conn.pragma_update(None, "journal_mode", "WAL")
                .map_err(JinError::Index)?;
        }
        if let Some(version) = existing_schema_version(&conn)? {
            if version > NOTIFICATION_CENTER_SCHEMA_VERSION {
                return Err(JinError::Integrity(format!(
                    "Notification Center schema version {version} is newer than supported version {NOTIFICATION_CENTER_SCHEMA_VERSION}"
                )));
            }
        }
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(JinError::Index)?;
        transaction.execute_batch(SCHEMA).map_err(JinError::Index)?;
        let has_canonical_event_id = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('notification_action_attempts') WHERE name='canonical_event_id')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(JinError::Index)?;
        if !has_canonical_event_id {
            transaction
                .execute(
                    "ALTER TABLE notification_action_attempts ADD COLUMN canonical_event_id TEXT",
                    [],
                )
                .map_err(JinError::Index)?;
        }
        let has_response_cycle_fingerprint = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('notification_source_tombstones') WHERE name='response_cycle_fingerprint')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(JinError::Index)?;
        if !has_response_cycle_fingerprint {
            transaction
                .execute(
                    "ALTER TABLE notification_source_tombstones ADD COLUMN response_cycle_fingerprint TEXT",
                    [],
                )
                .map_err(JinError::Index)?;
        }
        transaction
            .execute(
                "INSERT INTO notification_center_meta(key,value) VALUES('schema_version',?1)\n\
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [NOTIFICATION_CENTER_SCHEMA_VERSION.to_string()],
            )
            .map_err(JinError::Index)?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO notification_center_meta(key,value) VALUES('created_by_version',?1)",
                [env!("CARGO_PKG_VERSION")],
            )
            .map_err(JinError::Index)?;
        transaction
            .execute(
                "INSERT INTO notification_center_meta(key,value) VALUES('last_completed_migration',?1)\n\
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [NOTIFICATION_CENTER_SCHEMA_VERSION.to_string()],
            )
            .map_err(JinError::Index)?;
        transaction.commit().map_err(JinError::Index)?;
        Ok(Self {
            path: path.to_path_buf(),
            conn: SynchronizedConnection::new(Arc::clone(&initialization_lock), conn),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<u32> {
        let value: String = self
            .conn
            .query_row(
                "SELECT value FROM notification_center_meta WHERE key='schema_version'",
                [],
                |row| row.get(0),
            )
            .map_err(JinError::Index)?;
        value.parse().map_err(|_| {
            JinError::Integrity("invalid Notification Center schema version".to_string())
        })
    }

    pub fn upsert_source(
        &mut self,
        source: &NotificationSource,
        now: DateTime<Utc>,
    ) -> Result<Option<NotificationItem>> {
        validate_source(source)?;
        let now_text = now.to_rfc3339();
        let kind = source.payload.source_kind();
        let tx = self.conn.transaction().map_err(JinError::Index)?;
        let tombstone = tx
            .query_row(
                "SELECT last_source_revision,response_cycle_fingerprint,expires_at FROM notification_source_tombstones\n\
                 WHERE source_kind=?1 AND source_key=?2",
                params![kind.as_str(), source.source_key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(JinError::Index)?;
        if let Some((_revision, stored_cycle, expires_at)) = tombstone {
            let active_tombstone = parse_time(&expires_at)? > now;
            let incoming_cycle = invitation_response_cycle_fingerprint(&source.payload);
            let inferred_new_cycle = active_tombstone
                && invitation_needs_response(&source.payload)
                && stored_cycle.is_some()
                && stored_cycle != incoming_cycle;
            if active_tombstone && !source.new_response_cycle && !inferred_new_cycle {
                tx.execute(
                    "UPDATE notification_source_tombstones SET last_source_revision=?1,\n\
                       response_cycle_fingerprint=?2 WHERE source_kind=?3 AND source_key=?4",
                    params![
                        source.source_revision,
                        incoming_cycle,
                        kind.as_str(),
                        source.source_key
                    ],
                )
                .map_err(JinError::Index)?;
                tx.commit().map_err(JinError::Index)?;
                return Ok(None);
            }
            if source.new_response_cycle || inferred_new_cycle || !active_tombstone {
                tx.execute(
                    "DELETE FROM notification_source_tombstones WHERE source_kind=?1 AND source_key=?2",
                    params![kind.as_str(), source.source_key],
                )
                .map_err(JinError::Index)?;
            }
        }

        let payload_json = serde_json::to_string(&source.payload).map_err(|error| {
            JinError::Integrity(format!("serialize notification payload: {error}"))
        })?;
        let existing = find_item_by_source(&tx, kind, &source.source_key)?;
        let id = deterministic_item_id(kind, &source.source_key);
        match existing {
            None => {
                tx.execute(
                    "INSERT INTO notification_items(\n\
                       id,source_kind,source_key,source_revision,kind_payload_json,status,\n\
                       native_state,version,created_at,updated_at,last_seen_at)\n\
                     VALUES(?1,?2,?3,?4,?5,'active',?6,1,?7,?7,?7)",
                    params![
                        id,
                        kind.as_str(),
                        source.source_key,
                        source.source_revision,
                        payload_json,
                        if source.request_native_signal {
                            NativeDeliveryState::Pending.as_str()
                        } else {
                            NativeDeliveryState::NotRequested.as_str()
                        },
                        now_text
                    ],
                )
                .map_err(JinError::Index)?;
            }
            Some(item) => {
                if item.source_revision == source.source_revision && !source.new_response_cycle {
                    if effective_action_payload_changed(&item.payload, &source.payload) {
                        tx.execute(
                            "UPDATE notification_items SET kind_payload_json=?1,\n\
                               native_state=CASE WHEN native_state='not_requested' AND ?2 THEN 'pending' ELSE native_state END,\n\
                               last_seen_at=?3,updated_at=?3,version=version+1 WHERE id=?4",
                            params![payload_json, source.request_native_signal, now_text, item.id],
                        )
                        .map_err(JinError::Index)?;
                    } else {
                        tx.execute(
                            "UPDATE notification_items SET last_seen_at=?1 WHERE id=?2",
                            params![now_text, item.id],
                        )
                        .map_err(JinError::Index)?;
                    }
                    tx.commit().map_err(JinError::Index)?;
                    return self.get_item(&id).map(Some);
                }
                let reopen = source.new_response_cycle && item.status.is_terminal();
                let status = if reopen {
                    NotificationStatus::Active
                } else {
                    item.status
                };
                tx.execute(
                    "UPDATE notification_items SET source_revision=?1,kind_payload_json=?2,\n\
                       status=?3,read_at=CASE WHEN ?4 THEN NULL ELSE read_at END,\n\
                       visible_after=CASE WHEN ?4 THEN NULL ELSE visible_after END,\n\
                       requested_action=CASE WHEN ?4 THEN NULL ELSE requested_action END,\n\
                       action_error_code=CASE WHEN ?4 THEN NULL ELSE action_error_code END,\n\
                       action_error_message=CASE WHEN ?4 THEN NULL ELSE action_error_message END,\n\
                       resolved_at=CASE WHEN ?4 THEN NULL ELSE resolved_at END,\n\
                       resolution_origin=CASE WHEN ?4 THEN NULL ELSE resolution_origin END,\n\
                       source_reason=CASE WHEN ?4 THEN NULL ELSE source_reason END,\n\
                       native_state=CASE WHEN native_state='not_requested' AND ?5 THEN 'pending' ELSE native_state END,\n\
                       last_seen_at=?6,updated_at=?6,version=version+1 WHERE id=?7",
                    params![
                        source.source_revision,
                        payload_json,
                        status.as_str(),
                        reopen,
                        source.request_native_signal,
                        now_text,
                        item.id
                    ],
                )
                .map_err(JinError::Index)?;
            }
        }
        tx.commit().map_err(JinError::Index)?;
        self.get_item(&id)
            .map(Some)
            .map_err(NotificationCommandError::from_jin)
            .map_err(|error| JinError::Integrity(error.to_string()))
    }

    fn observe_answered_invitation_tombstone(
        &mut self,
        observation: &AnsweredInvitationTombstone<'_>,
    ) -> Result<()> {
        let fingerprint = invitation_response_cycle_fingerprint_fields(
            observation.account_id,
            observation.calendar_id,
            observation.google_event_id,
            observation.recurrence_key,
            observation.self_email,
            observation.response_status,
        );
        self.conn
            .execute(
                "UPDATE notification_source_tombstones SET last_source_revision=?1,\n\
                   response_cycle_fingerprint=?2 WHERE source_kind='calendar_invitation'\n\
                   AND source_key=?3",
                params![
                    observation.source_revision,
                    fingerprint,
                    observation.source_key
                ],
            )
            .map_err(JinError::Index)?;
        Ok(())
    }

    pub fn get_item(&self, item_id: &str) -> Result<NotificationItem> {
        get_item_conn(&self.conn, item_id)?.ok_or_else(|| JinError::NotFound(item_id.to_string()))
    }

    pub fn set_read(
        &mut self,
        item_id: &str,
        read: bool,
        expected_version: u64,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        let current = self
            .get_item(item_id)
            .map_err(NotificationCommandError::from_jin)?;
        ensure_supported_item_payload(&current)?;
        if current.version != expected_version {
            return Err(NotificationCommandError::stale(current));
        }
        let read_at = read.then(|| now.to_rfc3339());
        let changed = self
            .conn
            .execute(
                "UPDATE notification_items SET read_at=?1,updated_at=?2,version=version+1\n\
                 WHERE id=?3 AND version=?4",
                params![read_at, now.to_rfc3339(), item_id, expected_version as i64],
            )
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        if changed != 1 {
            let refreshed = self
                .get_item(item_id)
                .map_err(NotificationCommandError::from_jin)?;
            return Err(NotificationCommandError::stale(refreshed));
        }
        self.get_item(item_id)
            .map_err(NotificationCommandError::from_jin)
    }

    pub fn defer_item(
        &mut self,
        item_id: &str,
        visible_after: DateTime<Utc>,
        expected_version: u64,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        if visible_after <= now || visible_after > now + Duration::days(30) {
            return Err(NotificationCommandError::new(
                "ineligible",
                "Choose a future time within 30 days.",
                false,
            ));
        }
        let current = self
            .get_item(item_id)
            .map_err(NotificationCommandError::from_jin)?;
        ensure_supported_item_payload(&current)?;
        if current.version != expected_version {
            return Err(NotificationCommandError::stale(current));
        }
        if current.status != NotificationStatus::Active {
            return Err(NotificationCommandError::new(
                "ineligible",
                "Only active notifications can be deferred.",
                false,
            ));
        }
        let changed = self
            .conn
            .execute(
                "UPDATE notification_items SET visible_after=?1,updated_at=?2,version=version+1\n\
                 WHERE id=?3 AND version=?4 AND status='active'",
                params![
                    visible_after.to_rfc3339(),
                    now.to_rfc3339(),
                    item_id,
                    expected_version as i64
                ],
            )
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        if changed != 1 {
            let refreshed = self
                .get_item(item_id)
                .map_err(NotificationCommandError::from_jin)?;
            return Err(NotificationCommandError::stale(refreshed));
        }
        self.get_item(item_id)
            .map_err(NotificationCommandError::from_jin)
    }

    pub fn dismiss_item(
        &mut self,
        item_id: &str,
        expected_version: u64,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        self.transition_active_item(
            item_id,
            expected_version,
            NotificationStatus::Dismissed,
            None,
            now,
        )
    }

    pub fn mark_source_obsolete(
        &mut self,
        kind: NotificationSourceKind,
        source_key: &str,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<NotificationItem>> {
        let existing = find_item_by_source(&self.conn, kind, source_key)?;
        let Some(item) = existing else {
            return Ok(None);
        };
        if item.status == NotificationStatus::Obsolete {
            return Ok(Some(item));
        }
        self.conn
            .execute(
                "UPDATE notification_items SET status='obsolete',source_reason=?1,resolved_at=?2,\n\
                 updated_at=?2,version=version+1 WHERE id=?3",
                params![redact_provider_error(reason), now.to_rfc3339(), item.id],
            )
            .map_err(JinError::Index)?;
        self.get_item(&item.id).map(Some)
    }

    pub fn list(
        &mut self,
        request: &NotificationListRequest,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationCenterPage, NotificationCommandError> {
        let limit = request.limit.unwrap_or(50);
        if !(1..=100).contains(&limit) {
            return Err(NotificationCommandError::new(
                "invalid_cursor",
                "Notification page size must be between 1 and 100.",
                false,
            ));
        }
        self.wake_deferred(now)
            .map_err(NotificationCommandError::from_jin)?;
        let cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
        let watermark = cursor
            .as_ref()
            .map(|cursor| cursor.watermark.clone())
            .unwrap_or_else(|| now.to_rfc3339());
        let mut items = all_items(&self.conn)
            .map_err(NotificationCommandError::from_jin)?
            .into_iter()
            .filter(|item| item.created_at <= watermark)
            .filter(|item| item_matches_filter(item, request, now))
            .collect::<Vec<_>>();
        items.sort_by_key(item_sort_key);
        if let Some(cursor) = cursor {
            items.retain(|item| item_sort_key(item) > cursor.after);
        }
        let has_more = items.len() > limit as usize;
        items.truncate(limit as usize);
        let next_cursor = if has_more {
            items.last().map(|item| {
                encode_cursor(&PageCursor {
                    version: 1,
                    watermark: watermark.clone(),
                    after: item_sort_key(item),
                })
            })
        } else {
            None
        };
        Ok(NotificationCenterPage {
            items,
            next_cursor,
            snapshot_watermark: watermark,
            partial_errors: self
                .source_errors(20)
                .map_err(NotificationCommandError::from_jin)?,
        })
    }

    pub fn summary(&mut self, now: DateTime<Utc>) -> Result<NotificationCenterSummary> {
        self.wake_deferred(now)?;
        let items = all_items(&self.conn)?;
        let visible = items.iter().filter(|item| {
            matches!(
                item.status,
                NotificationStatus::Active | NotificationStatus::ActionPending
            ) && item
                .visible_after
                .as_deref()
                .and_then(|value| parse_time(value).ok())
                .is_none_or(|instant| instant <= now)
        });
        let mut summary = NotificationCenterSummary::default();
        for item in visible {
            summary.visible_total += 1;
            if item.read_at.is_none() {
                summary.visible_unread += 1;
            }
            if item.status == NotificationStatus::ActionPending {
                summary.pending += 1;
            }
            if item.action_error.is_some() {
                summary.errors += 1;
            }
        }
        summary.partial_error_count = self.source_error_count()?;
        Ok(summary)
    }

    pub fn prepare_action_attempt(
        &mut self,
        intent: &ActionAttemptIntent,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        validate_operation_id(&intent.operation_id)?;
        let intent_hash = intent_hash(intent)?;
        if let Some((stored_hash, item_id)) = self
            .conn
            .query_row(
                "SELECT intent_hash,item_id FROM notification_action_attempts WHERE operation_id=?1\n\
                 UNION ALL SELECT intent_hash,item_id FROM notification_action_attempt_audit\n\
                 WHERE operation_id=?1 LIMIT 1",
                [&intent.operation_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?
        {
            if stored_hash != intent_hash {
                return Err(NotificationCommandError::new(
                    "idempotency_conflict",
                    "That operation ID was already used for a different action.",
                    false,
                ));
            }
            return self
                .get_item(&item_id)
                .map_err(NotificationCommandError::from_jin);
        }
        let current = self
            .get_item(&intent.item_id)
            .map_err(NotificationCommandError::from_jin)?;
        if current.version != intent.expected_item_version {
            return Err(NotificationCommandError::stale(current));
        }
        if current.status != NotificationStatus::Active {
            return Err(NotificationCommandError::new(
                "ineligible",
                "Only active notifications can start an action.",
                false,
            ));
        }
        #[cfg(test)]
        run_prepare_action_before_transaction_hook();
        let tx = self
            .conn
            .transaction()
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        tx.execute(
            "INSERT INTO notification_action_attempts(\n\
               operation_id,item_id,requested_action,recurrence_scope,state,intent_hash,\n\
               source_revision,provider,account_id,calendar_id,canonical_event_id,google_event_id,recurrence_key,\n\
               self_email,provider_subject,auth_generation,route_generation,base_etag,created_at,updated_at)\n\
             VALUES(?1,?2,?3,?4,'preparing',?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
            params![
                intent.operation_id,
                intent.item_id,
                intent.requested_action.as_str(),
                intent.recurrence_scope.map(InvitationRecurrenceScope::as_str),
                intent_hash,
                intent.source_revision,
                intent.provider,
                intent.account_id,
                intent.calendar_id,
                intent.canonical_event_id,
                intent.google_event_id,
                intent.recurrence_key,
                intent.self_email,
                intent.provider_subject,
                intent.auth_generation.map(|value| value as i64),
                intent.route_generation.map(|value| value as i64),
                intent.base_etag,
                now.to_rfc3339()
            ],
        )
        .map_err(JinError::Index)
        .map_err(NotificationCommandError::from_jin)?;
        let changed = tx
            .execute(
                "UPDATE notification_items SET status='action_pending',requested_action=?1,\n\
                 action_error_code=NULL,action_error_message=NULL,updated_at=?2,version=version+1\n\
                 WHERE id=?3 AND status='active' AND version=?4",
                params![
                    intent.requested_action.as_str(),
                    now.to_rfc3339(),
                    intent.item_id,
                    intent.expected_item_version as i64
                ],
            )
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        if changed != 1 {
            tx.rollback()
                .map_err(JinError::Index)
                .map_err(NotificationCommandError::from_jin)?;
            let refreshed = self
                .get_item(&intent.item_id)
                .map_err(NotificationCommandError::from_jin)?;
            return Err(NotificationCommandError::stale(refreshed));
        }
        tx.commit()
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        self.get_item(&intent.item_id)
            .map_err(NotificationCommandError::from_jin)
    }

    pub fn action_attempt(&self, operation_id: &str) -> Result<Option<NotificationActionAttempt>> {
        self.conn
            .query_row(
                "SELECT operation_id,item_id,requested_action,recurrence_scope,state,source_revision,\n\
                        provider,account_id,calendar_id,canonical_event_id,google_event_id,recurrence_key,\n\
                        self_email,provider_subject,auth_generation,route_generation,base_etag,\n\
                        retry_count,error_code,error_message,observed_response\n\
                 FROM notification_action_attempts WHERE operation_id=?1\n\
                 UNION ALL\n\
                 SELECT operation_id,item_id,requested_action,recurrence_scope,state,source_revision,\n\
                        provider,account_id,calendar_id,canonical_event_id,google_event_id,recurrence_key,\n\
                        self_email,provider_subject,auth_generation,route_generation,base_etag,\n\
                        retry_count,error_code,error_message,observed_response\n\
                 FROM notification_action_attempt_audit WHERE operation_id=?1 LIMIT 1",
                [operation_id],
                row_to_attempt,
            )
            .optional()
            .map_err(JinError::Index)
            .and_then(|attempt| attempt.transpose())
    }

    fn latest_retryable_attempt_for_item(
        &self,
        item_id: &str,
    ) -> Result<Option<NotificationActionAttempt>> {
        self.conn
            .query_row(
                "SELECT operation_id,item_id,requested_action,recurrence_scope,state,source_revision,\n\
                        provider,account_id,calendar_id,canonical_event_id,google_event_id,recurrence_key,\n\
                        self_email,provider_subject,auth_generation,route_generation,base_etag,\n\
                        retry_count,error_code,error_message,observed_response\n\
                 FROM notification_action_attempts\n\
                 WHERE item_id=?1 AND state='failed_retryable'\n\
                 ORDER BY completed_at DESC,operation_id DESC LIMIT 1",
                [item_id],
                row_to_attempt,
            )
            .optional()
            .map_err(JinError::Index)?
            .transpose()
    }

    pub fn respond_to_invitation(
        &mut self,
        root: &Path,
        request: &RespondInvitationRequest,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        let item = self
            .get_item(&request.item_id)
            .map_err(NotificationCommandError::from_jin)?;
        validate_operation_id(&request.operation_id)?;
        if let Some(existing) = self
            .action_attempt(&request.operation_id)
            .map_err(NotificationCommandError::from_jin)?
        {
            let requested_action = request.response.action();
            if existing.item_id != request.item_id
                || existing.requested_action != requested_action
                || existing.recurrence_scope != request.recurrence_scope
            {
                return Err(error_with_item(
                    "idempotency_conflict",
                    "That operation ID was already used for a different action.",
                    false,
                    item,
                ));
            }
            return self
                .get_item(&existing.item_id)
                .map_err(NotificationCommandError::from_jin);
        }
        ensure_supported_item_payload(&item)?;
        let NotificationPayload::CalendarInvitation(payload) = item.payload.clone() else {
            return Err(error_with_item(
                "ineligible",
                "This notification is not a calendar invitation.",
                false,
                item,
            ));
        };
        let recurrence_scope = request.recurrence_scope.map(|scope| match scope {
            InvitationRecurrenceScope::ThisOccurrence => {
                crate::ops::event_mutation::RecurrenceMutationScope::ThisOccurrence
            }
            InvitationRecurrenceScope::EntireSeries => {
                crate::ops::event_mutation::RecurrenceMutationScope::EntireSeries
            }
        });
        let snapshot = invitation_action_snapshot(root, &payload, request.recurrence_scope)
            .map_err(|error| invitation_mutation_error(error, item.clone()))?;
        let target = crate::google::account::EventSyncTarget::new(
            crate::google::account::GoogleAccountId::parse(snapshot.account_id.clone())
                .map_err(NotificationCommandError::from_jin)?,
            snapshot.calendar_id.clone(),
        )
        .map_err(NotificationCommandError::from_jin)?;
        let mutation_request = crate::ops::event_mutation::InvitationResponseMutationRequest {
            event_id: snapshot.canonical_event_id.clone(),
            target,
            operation_id: request.operation_id.clone(),
            response: request.response,
            recurrence_scope,
            expected_google_event_id: snapshot.google_event_id.clone(),
            expected_recurrence_key: snapshot.recurrence_key.clone(),
            expected_self_email: snapshot.self_email.clone(),
            expected_etag: snapshot.etag.clone(),
            expected_provider_subject: payload.provider_subject.clone(),
            expected_auth_generation: payload.auth_generation,
            expected_route_generation: payload.route_generation,
        };
        let intent = ActionAttemptIntent {
            operation_id: request.operation_id.clone(),
            item_id: request.item_id.clone(),
            expected_item_version: request.expected_item_version,
            requested_action: request.response.action(),
            recurrence_scope: request.recurrence_scope,
            source_revision: item.source_revision.clone(),
            provider: Some(crate::google::account::GOOGLE_PROVIDER.to_string()),
            account_id: Some(snapshot.account_id),
            calendar_id: Some(snapshot.calendar_id),
            canonical_event_id: Some(snapshot.canonical_event_id),
            google_event_id: Some(snapshot.google_event_id),
            recurrence_key: Some(snapshot.recurrence_key),
            self_email: Some(snapshot.self_email),
            provider_subject: Some(payload.provider_subject),
            auth_generation: Some(payload.auth_generation),
            route_generation: Some(payload.route_generation),
            base_etag: Some(snapshot.etag),
        };

        if item.version != request.expected_item_version {
            return Err(NotificationCommandError::stale(item));
        }
        if item.status != NotificationStatus::Active || !payload.capabilities.can_respond {
            return Err(error_with_item(
                "ineligible",
                payload
                    .capabilities
                    .disabled_reason
                    .as_deref()
                    .unwrap_or("This invitation can no longer be answered."),
                false,
                item,
            ));
        }
        let service = crate::ops::event_mutation::EventMutationService::new(root)
            .map_err(NotificationCommandError::from_jin)?;
        service
            .validate_invitation_response(&mutation_request)
            .map_err(|error| invitation_mutation_error(error, item.clone()))?;
        self.prepare_action_attempt(&intent, now)?;
        if let Err(error) = service.respond_to_invitation(mutation_request) {
            let code = invitation_error_code(&error).to_string();
            let retryable = matches!(error, JinError::Offline(_));
            let failed = self
                .finish_attempt_failed(
                    &request.operation_id,
                    &code,
                    &error.to_string(),
                    retryable,
                    now,
                )
                .map_err(NotificationCommandError::from_jin)?;
            return Err(error_with_item(&code, error.to_string(), retryable, failed));
        }
        self.mark_attempt_queued(&request.operation_id, now)
            .map_err(NotificationCommandError::from_jin)
    }

    pub fn retry_invitation(
        &mut self,
        root: &Path,
        request: &RetryInvitationRequest,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        validate_operation_id(&request.operation_id)?;
        let item = self
            .get_item(&request.item_id)
            .map_err(NotificationCommandError::from_jin)?;
        ensure_supported_item_payload(&item)?;
        if item.version != request.expected_item_version {
            return Err(NotificationCommandError::stale(item));
        }
        let retryable = item.status == NotificationStatus::Active
            && item
                .action_error
                .as_ref()
                .is_some_and(|error| error.retryable);
        let NotificationPayload::CalendarInvitation(payload) = &item.payload else {
            return Err(error_with_item(
                "ineligible",
                "Only calendar invitation responses can be retried.",
                false,
                item,
            ));
        };
        if !retryable || !payload.capabilities.can_respond {
            return Err(error_with_item(
                "ineligible",
                "This invitation response cannot be retried.",
                false,
                item,
            ));
        }
        let previous = self
            .latest_retryable_attempt_for_item(&request.item_id)
            .map_err(NotificationCommandError::from_jin)?
            .ok_or_else(|| {
                error_with_item(
                    "ineligible",
                    "No retryable invitation response is available.",
                    false,
                    item.clone(),
                )
            })?;
        let response = match previous.requested_action {
            NotificationAction::Allow => InvitationResponse::Allow,
            NotificationAction::Maybe => InvitationResponse::Maybe,
            NotificationAction::Refuse => InvitationResponse::Refuse,
            NotificationAction::CompleteTask => {
                return Err(error_with_item(
                    "ineligible",
                    "The prior action is not an invitation response.",
                    false,
                    item,
                ))
            }
        };
        self.respond_to_invitation(
            root,
            &RespondInvitationRequest {
                item_id: request.item_id.clone(),
                expected_item_version: request.expected_item_version,
                operation_id: request.operation_id.clone(),
                response,
                recurrence_scope: previous.recurrence_scope,
            },
            now,
        )
    }

    pub fn upsert_task_reminder(
        &mut self,
        root: &Path,
        claim: &crate::reminders::ReminderClaim,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let config = crate::Config::load(root)?;
        let task = crate::ops::tasks::get_task(&config.tasks_dir(), &claim.task_id)?;
        if !matches!(
            task.frontmatter.status,
            crate::model::task::TaskStatus::Todo | crate::model::task::TaskStatus::Doing
        ) {
            return Err(JinError::InvalidInput(
                "task reminder source is no longer open".to_string(),
            ));
        }
        let task_path = crate::store::fs::find_task_path(&config.tasks_dir(), task.id())?;
        let task_edit_token = format!("sha256:{:x}", Sha256::digest(std::fs::read(task_path)?));
        self.upsert_source(
            &NotificationSource {
                source_key: claim.occurrence_key.clone(),
                source_revision: format!(
                    "{}:{}",
                    claim.fire_at.to_rfc3339(),
                    task.frontmatter.updated.to_rfc3339()
                ),
                request_native_signal: true,
                new_response_cycle: false,
                payload: NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
                    schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                    occurrence_key: claim.occurrence_key.clone(),
                    task_id: task.id().to_string(),
                    title: task.title().to_string(),
                    scheduled_at: claim.fire_at.to_rfc3339(),
                    list_name: Some(task.frontmatter.list.clone()),
                    project_name: None,
                    task_edit_token: Some(task_edit_token),
                    capabilities: NotificationCapabilities {
                        can_respond: false,
                        can_complete_task: true,
                        recurrence_scopes: Vec::new(),
                        ..NotificationCapabilities::default()
                    },
                })),
            },
            now,
        )?
        .ok_or_else(|| {
            JinError::Integrity("task reminder tombstone blocked an active occurrence".to_string())
        })
    }

    pub fn mark_native_submitted(
        &mut self,
        item_id: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.update_native_state(item_id, NativeDeliveryState::Submitted, None, now)
    }

    pub fn mark_native_failed(
        &mut self,
        item_id: &str,
        error: &str,
        suppressed: bool,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let attempts = self.native_attempt_count(item_id)?;
        self.update_native_state(
            item_id,
            if suppressed || attempts.saturating_add(1) >= NATIVE_DELIVERY_ATTEMPT_LIMIT {
                NativeDeliveryState::Suppressed
            } else {
                NativeDeliveryState::Failed
            },
            Some(error),
            now,
        )
    }

    pub fn claim_native_deliveries(
        &mut self,
        now: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<NotificationItem>> {
        let limit = limit.clamp(1, 100);
        let tx = self.conn.transaction().map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_items SET native_state='suppressed',native_next_attempt_at=NULL,\n\
               updated_at=?1,version=version+1\n\
             WHERE native_state IN ('pending','failed') AND native_attempt_count >= ?2",
            params![now.to_rfc3339(), NATIVE_DELIVERY_ATTEMPT_LIMIT as i64],
        )
        .map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_items SET native_state='pending',native_next_attempt_at=NULL,\n\
               updated_at=?1,version=version+1\n\
             WHERE native_state='failed' AND native_attempt_count < ?2\n\
               AND native_next_attempt_at IS NOT NULL AND native_next_attempt_at <= ?1",
            params![now.to_rfc3339(), NATIVE_DELIVERY_ATTEMPT_LIMIT as i64],
        )
        .map_err(JinError::Index)?;
        let ids = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM notification_items\n\
                     WHERE native_state='pending'\n\
                       AND native_attempt_count < ?1\n\
                     ORDER BY created_at,id LIMIT ?2",
                )
                .map_err(JinError::Index)?;
            let rows = stmt
                .query_map(
                    params![NATIVE_DELIVERY_ATTEMPT_LIMIT as i64, limit as i64],
                    |row| row.get::<_, String>(0),
                )
                .map_err(JinError::Index)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(JinError::Index)?;
            rows
        };
        tx.commit().map_err(JinError::Index)?;
        ids.into_iter().map(|id| self.get_item(&id)).collect()
    }

    pub fn complete_notification_task(
        &mut self,
        root: &Path,
        request: &CompleteNotificationTaskRequest,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        let item = self
            .get_item(&request.item_id)
            .map_err(NotificationCommandError::from_jin)?;
        ensure_supported_item_payload(&item)?;
        let NotificationPayload::TaskReminder(payload) = item.payload.clone() else {
            return Err(error_with_item(
                "ineligible",
                "This notification is not a task reminder.",
                false,
                item,
            ));
        };
        let intent = ActionAttemptIntent {
            operation_id: request.operation_id.clone(),
            item_id: item.id.clone(),
            expected_item_version: request.expected_item_version,
            requested_action: NotificationAction::CompleteTask,
            recurrence_scope: None,
            source_revision: item.source_revision.clone(),
            provider: None,
            account_id: None,
            calendar_id: None,
            canonical_event_id: None,
            google_event_id: None,
            recurrence_key: Some(payload.occurrence_key.clone()),
            self_email: None,
            provider_subject: None,
            auth_generation: None,
            route_generation: None,
            base_etag: None,
        };
        if self
            .action_attempt(&request.operation_id)
            .map_err(NotificationCommandError::from_jin)?
            .is_some()
        {
            return self.prepare_action_attempt(&intent, now);
        }
        if item.version != request.expected_item_version {
            return Err(NotificationCommandError::stale(item));
        }
        if item.status != NotificationStatus::Active || !payload.capabilities.can_complete_task {
            return Err(error_with_item(
                "ineligible",
                "This task reminder can no longer be completed.",
                false,
                item,
            ));
        }
        let config = crate::Config::load(root).map_err(NotificationCommandError::from_jin)?;
        let task = crate::ops::tasks::get_task(&config.tasks_dir(), &payload.task_id).map_err(
            |error| error_with_item("ineligible", error.to_string(), false, item.clone()),
        )?;
        if !matches!(
            task.frontmatter.status,
            crate::model::task::TaskStatus::Todo | crate::model::task::TaskStatus::Doing
        ) {
            return Err(error_with_item(
                "ineligible",
                "This task is already resolved.",
                false,
                item,
            ));
        }
        self.prepare_action_attempt(&intent, now)?;
        if let Err(error) = crate::ops::tasks::transition_task(
            &config.tasks_dir(),
            &payload.task_id,
            crate::model::task::TaskStatus::Done,
        ) {
            let failed = self
                .finish_attempt_failed(
                    &request.operation_id,
                    "ineligible",
                    &error.to_string(),
                    false,
                    now,
                )
                .map_err(NotificationCommandError::from_jin)?;
            return Err(error_with_item(
                "ineligible",
                error.to_string(),
                false,
                failed,
            ));
        }
        self.finish_attempt_succeeded(&request.operation_id, now)
            .map_err(NotificationCommandError::from_jin)
    }

    pub fn mark_attempt_queued(
        &mut self,
        operation_id: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.update_nonterminal_attempt(
            operation_id,
            &[
                ActionAttemptState::Preparing,
                ActionAttemptState::Queued,
                ActionAttemptState::Sending,
            ],
            ActionAttemptState::Queued,
            now,
        )
    }

    pub fn mark_attempt_sending(
        &mut self,
        operation_id: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.update_nonterminal_attempt(
            operation_id,
            &[ActionAttemptState::Queued, ActionAttemptState::Sending],
            ActionAttemptState::Sending,
            now,
        )
    }

    pub fn finish_attempt_succeeded(
        &mut self,
        operation_id: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.finish_attempt(
            operation_id,
            ActionAttemptState::Succeeded,
            NotificationStatus::Acted,
            None,
            None,
            Some(ResolutionOrigin::Jin),
            now,
        )
    }

    pub fn finish_attempt_failed(
        &mut self,
        operation_id: &str,
        code: &str,
        message: &str,
        retryable: bool,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let state = if retryable {
            ActionAttemptState::FailedRetryable
        } else {
            ActionAttemptState::FailedTerminal
        };
        self.finish_attempt(
            operation_id,
            state,
            NotificationStatus::Active,
            Some(code),
            Some(message),
            None,
            now,
        )
    }

    pub fn finish_attempt_superseded(
        &mut self,
        operation_id: &str,
        observed_response: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.finish_attempt_with_observed(
            operation_id,
            ActionAttemptState::Superseded,
            NotificationStatus::Superseded,
            None,
            None,
            Some(ResolutionOrigin::External),
            Some(observed_response),
            now,
        )
    }

    pub fn finish_attempt_obsolete(
        &mut self,
        operation_id: &str,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.finish_attempt(
            operation_id,
            ActionAttemptState::Obsolete,
            NotificationStatus::Obsolete,
            Some("ineligible"),
            Some(reason),
            None,
            now,
        )
    }

    pub fn disable_invitation_response(
        &mut self,
        operation_id: &str,
        code: &str,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let attempt = self
            .action_attempt(operation_id)?
            .ok_or_else(|| JinError::NotFound(format!("notification action/{operation_id}")))?;
        let mut item = self.get_item(&attempt.item_id)?;
        if let NotificationPayload::CalendarInvitation(payload) = &mut item.payload {
            payload.capabilities.can_respond = false;
            payload.capabilities.disabled_reason = Some(
                "Reconnect this Google account before responding to the invitation.".to_string(),
            );
        }
        let payload_json = serde_json::to_string(&item.payload).map_err(|error| {
            JinError::Integrity(format!("serialize notification payload: {error}"))
        })?;
        self.conn
            .execute(
                "UPDATE notification_action_attempts SET state='failed_terminal',error_code=?1,\n\
                   error_message=?2,completed_at=?3,updated_at=?3 WHERE operation_id=?4",
                params![
                    code,
                    "The saved account or calendar authority changed.",
                    now.to_rfc3339(),
                    operation_id
                ],
            )
            .map_err(JinError::Index)?;
        self.conn
            .execute(
                "UPDATE notification_items SET kind_payload_json=?1,status='active',read_at=NULL,\n\
                   action_error_code=?2,action_error_message=?3,updated_at=?4,version=version+1\n\
                 WHERE id=?5",
                params![
                    payload_json,
                    code,
                    "Reconnect this Google account before retrying.",
                    now.to_rfc3339(),
                    item.id
                ],
            )
            .map_err(JinError::Index)?;
        self.get_item(&item.id)
    }

    pub fn recover_invitation_sagas(&mut self, root: &Path, now: DateTime<Utc>) -> Result<usize> {
        let conn = crate::sync::state::open_sync_db(&root.join(".jin/sync"))?;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT operation_id FROM notification_action_attempts\n\
                 WHERE requested_action IN ('allow','maybe','refuse')\n\
                   AND state IN ('preparing','queued','sending') ORDER BY created_at,operation_id",
            )
            .map_err(JinError::Index)?;
        let operation_ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(JinError::Index)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(JinError::Index)?;
        drop(stmt);
        let mut recovered = 0;
        for operation_id in operation_ids {
            let attempt = self.action_attempt(&operation_id)?.ok_or_else(|| {
                JinError::Integrity("Notification Center attempt disappeared".to_string())
            })?;
            let outbox = crate::sync::state::get_outbox_operation(&conn, &operation_id)?;
            match (attempt.state, outbox) {
                (_, Some(operation)) if operation.state == "complete" => {
                    match canonical_attempt_outcome(&attempt, root, now) {
                        Ok(CanonicalAttemptOutcome::Requested) => {
                            self.finish_attempt_succeeded(&operation_id, now)?;
                        }
                        Ok(CanonicalAttemptOutcome::Superseded(observed)) => {
                            self.finish_attempt_superseded(&operation_id, &observed, now)?;
                        }
                        Ok(CanonicalAttemptOutcome::Obsolete(reason)) => {
                            self.finish_attempt_obsolete(&operation_id, &reason, now)?;
                        }
                        Ok(CanonicalAttemptOutcome::StillPending) => {
                            self.finish_attempt_failed(
                                &operation_id,
                                "provider_confirmation_mismatch",
                                "The completed provider operation is not reflected in the canonical invitation.",
                                true,
                                now,
                            )?;
                        }
                        Err(error) => {
                            self.finish_attempt_failed(
                                &operation_id,
                                "provider_confirmation_mismatch",
                                &error.to_string(),
                                true,
                                now,
                            )?;
                        }
                    }
                    recovered += 1;
                }
                (_, Some(operation)) if operation.state == "obsolete" => {
                    self.finish_attempt_obsolete(
                        &operation_id,
                        operation
                            .pause_reason
                            .as_deref()
                            .unwrap_or("The invitation no longer exists."),
                        now,
                    )?;
                    recovered += 1;
                }
                (_, Some(operation)) if operation.state == "paused" => {
                    let reason = operation
                        .pause_reason
                        .as_deref()
                        .unwrap_or("provider_failed");
                    if reason.contains("permission") || reason.contains("generation") {
                        self.disable_invitation_response(&operation_id, reason, now)?;
                    } else {
                        self.finish_attempt_failed(
                            &operation_id,
                            reason,
                            reason,
                            paused_rsvp_reason_is_retryable(reason),
                            now,
                        )?;
                    }
                    recovered += 1;
                }
                (ActionAttemptState::Preparing, Some(operation))
                    if operation.operation
                        == crate::sync::state::OutboxOperationKind::RespondInvitation =>
                {
                    self.mark_attempt_queued(&operation_id, now)?;
                    recovered += 1;
                }
                (ActionAttemptState::Preparing, None) => {
                    let response = match attempt.requested_action {
                        NotificationAction::Allow => InvitationResponse::Allow,
                        NotificationAction::Maybe => InvitationResponse::Maybe,
                        NotificationAction::Refuse => InvitationResponse::Refuse,
                        NotificationAction::CompleteTask => continue,
                    };
                    let mutation_request =
                        invitation_mutation_request_from_attempt(&attempt, response)?;
                    let service = crate::ops::event_mutation::EventMutationService::new(root)?;
                    match service.respond_to_invitation(mutation_request) {
                        Ok(_) => {
                            self.mark_attempt_queued(&operation_id, now)?;
                            recovered += 1;
                        }
                        Err(error) => {
                            let code = invitation_error_code(&error);
                            self.finish_attempt_failed(
                                &operation_id,
                                code,
                                &error.to_string(),
                                matches!(error, JinError::Offline(_)),
                                now,
                            )?;
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(recovered)
    }

    pub fn prune(&mut self, now: DateTime<Utc>) -> Result<usize> {
        let tx = self.conn.transaction().map_err(JinError::Index)?;
        tx.execute(
            "DELETE FROM notification_action_attempts WHERE completed_at IS NOT NULL AND completed_at < ?1",
            [(now - Duration::days(90)).to_rfc3339()],
        )
        .map_err(JinError::Index)?;
        tx.execute(
            "DELETE FROM notification_action_attempt_audit WHERE completed_at < ?1",
            [(now - Duration::days(90)).to_rfc3339()],
        )
        .map_err(JinError::Index)?;
        let cutoff = (now - Duration::days(30)).to_rfc3339();
        let mut stmt = tx
            .prepare(
                "SELECT id,source_kind,source_key,status,source_revision,kind_payload_json FROM notification_items i\n\
                 WHERE i.status IN ('acted','superseded','dismissed','obsolete')\n\
                   AND i.resolved_at IS NOT NULL AND i.resolved_at < ?1\n\
                   AND NOT EXISTS(SELECT 1 FROM notification_action_attempts a WHERE a.item_id=i.id\n\
                                  AND a.state IN ('preparing','queued','sending'))",
            )
            .map_err(JinError::Index)?;
        let rows = stmt
            .query_map([cutoff], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(JinError::Index)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(JinError::Index)?;
        drop(stmt);
        for (id, source_kind, source_key, status, revision, payload_json) in &rows {
            let payload: NotificationPayload =
                serde_json::from_str(payload_json).map_err(|error| {
                    JinError::Integrity(format!(
                        "decode notification payload for tombstone: {error}"
                    ))
                })?;
            let response_cycle_fingerprint = invitation_response_cycle_fingerprint(&payload);
            tx.execute(
                "INSERT OR IGNORE INTO notification_action_attempt_audit(\n\
                   operation_id,item_id,requested_action,recurrence_scope,state,intent_hash,\n\
                   source_revision,provider,account_id,calendar_id,canonical_event_id,google_event_id,\n\
                   recurrence_key,self_email,provider_subject,auth_generation,route_generation,base_etag,\n\
                   retry_count,error_code,error_message,observed_response,created_at,updated_at,completed_at)\n\
                 SELECT operation_id,item_id,requested_action,recurrence_scope,state,intent_hash,\n\
                   source_revision,provider,account_id,calendar_id,canonical_event_id,google_event_id,\n\
                   recurrence_key,self_email,provider_subject,auth_generation,route_generation,base_etag,\n\
                   retry_count,error_code,error_message,observed_response,created_at,updated_at,completed_at\n\
                 FROM notification_action_attempts WHERE item_id=?1 AND completed_at IS NOT NULL",
                [id],
            )
            .map_err(JinError::Index)?;
            tx.execute(
                "DELETE FROM notification_action_attempts WHERE item_id=?1 AND completed_at IS NOT NULL",
                [id],
            )
            .map_err(JinError::Index)?;
            tx.execute(
                "INSERT INTO notification_source_tombstones(\n\
                   source_kind,source_key,terminal_status,last_source_revision,response_cycle_fingerprint,expires_at,created_at)\n\
                 VALUES(?1,?2,?3,?4,?5,?6,?7)\n\
                 ON CONFLICT(source_kind,source_key) DO UPDATE SET\n\
                   terminal_status=excluded.terminal_status,last_source_revision=excluded.last_source_revision,\n\
                   response_cycle_fingerprint=excluded.response_cycle_fingerprint,\n\
                   expires_at=excluded.expires_at,created_at=excluded.created_at",
                params![
                    source_kind,
                    source_key,
                    status,
                    revision,
                    response_cycle_fingerprint,
                    (now + Duration::days(90)).to_rfc3339(),
                    now.to_rfc3339()
                ],
            )
            .map_err(JinError::Index)?;
            tx.execute("DELETE FROM notification_items WHERE id=?1", [id])
                .map_err(JinError::Index)?;
        }
        tx.commit().map_err(JinError::Index)?;
        Ok(rows.len())
    }

    pub fn record_source_error(
        &mut self,
        kind: NotificationSourceKind,
        source_key: &str,
        code: &str,
        message: &str,
        now: DateTime<Utc>,
    ) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO notification_source_errors(source_kind,source_key,error_code,error_message,updated_at)\n\
                 VALUES(?1,?2,?3,?4,?5) ON CONFLICT(source_kind,source_key) DO UPDATE SET\n\
                   error_code=excluded.error_code,error_message=excluded.error_message,updated_at=excluded.updated_at",
                params![
                    kind.as_str(),
                    source_key,
                    code,
                    redact_provider_error(message),
                    now.to_rfc3339()
                ],
            )
            .map_err(JinError::Index)?;
        Ok(())
    }

    pub fn source_error(
        &self,
        kind: NotificationSourceKind,
        source_key: &str,
    ) -> Result<Option<InvitationReconcileError>> {
        self.conn
            .query_row(
                "SELECT error_code,error_message FROM notification_source_errors
                 WHERE source_kind=?1 AND source_key=?2",
                params![kind.as_str(), source_key],
                |row| {
                    Ok(InvitationReconcileError {
                        source_key: source_key.to_string(),
                        code: row.get(0)?,
                        message: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(JinError::Index)
    }

    pub fn source_errors(&self, limit: u32) -> Result<Vec<NotificationSourceError>> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT source_kind,source_key,error_code,error_message,updated_at
                 FROM notification_source_errors
                 ORDER BY updated_at DESC,source_kind,source_key LIMIT ?1",
            )
            .map_err(JinError::Index)?;
        let errors = statement
            .query_map([limit.clamp(1, 100) as i64], |row| {
                let source_kind: String = row.get(0)?;
                Ok((
                    source_kind,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(JinError::Index)?
            .map(|row| {
                let (source_kind, source_key, code, message, updated_at) =
                    row.map_err(JinError::Index)?;
                Ok(NotificationSourceError {
                    source_kind: NotificationSourceKind::parse(&source_kind)?,
                    source_key,
                    code,
                    message,
                    updated_at,
                })
            })
            .collect();
        errors
    }

    fn source_error_count(&self) -> Result<u64> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM notification_source_errors",
                [],
                |row| row.get(0),
            )
            .map_err(JinError::Index)?;
        Ok(count.max(0) as u64)
    }

    fn clear_source_error(&mut self, kind: NotificationSourceKind, source_key: &str) -> Result<()> {
        self.conn
            .execute(
                "DELETE FROM notification_source_errors WHERE source_kind=?1 AND source_key=?2",
                params![kind.as_str(), source_key],
            )
            .map_err(JinError::Index)?;
        Ok(())
    }

    fn clear_unseen_source_errors(
        &mut self,
        kind: NotificationSourceKind,
        prefix: &str,
        seen: &std::collections::HashSet<String>,
    ) -> Result<()> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT source_key FROM notification_source_errors
                 WHERE source_kind=?1 AND source_key LIKE ?2",
            )
            .map_err(JinError::Index)?;
        let keys = statement
            .query_map(params![kind.as_str(), format!("{prefix}%")], |row| {
                row.get::<_, String>(0)
            })
            .map_err(JinError::Index)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(JinError::Index)?;
        drop(statement);
        for key in keys {
            if !seen.contains(&key) {
                self.clear_source_error(kind, &key)?;
            }
        }
        Ok(())
    }

    fn clear_invitation_error_aliases(
        &mut self,
        canonical_event_id: &str,
        aliases: &[&str],
    ) -> Result<()> {
        let mut keys = aliases
            .iter()
            .map(|key| (*key).to_string())
            .collect::<Vec<_>>();
        keys.extend(all_items(&self.conn)?.into_iter().filter_map(|item| {
            matches!(
                &item.payload,
                NotificationPayload::CalendarInvitation(payload)
                    if payload.canonical_event_id == canonical_event_id
            )
            .then_some(item.source_key)
        }));
        keys.sort();
        keys.dedup();
        for key in keys {
            self.clear_source_error(NotificationSourceKind::CalendarInvitation, &key)?;
        }
        Ok(())
    }

    fn resolve_external_invitation(
        &mut self,
        source_key: &str,
        observed_response: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<NotificationItem>> {
        let Some(item) = find_item_by_source(
            &self.conn,
            NotificationSourceKind::CalendarInvitation,
            source_key,
        )?
        else {
            return Ok(None);
        };
        let operation = self
            .conn
            .query_row(
                "SELECT operation_id,requested_action FROM notification_action_attempts
                 WHERE item_id=?1 AND state IN ('preparing','queued','sending','failed_retryable')
                 ORDER BY created_at DESC,operation_id DESC LIMIT 1",
                [item.id.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(JinError::Index)?;
        if let Some((operation_id, requested_action)) = operation {
            let requested = NotificationAction::parse(&requested_action)?;
            let requested_status = match requested {
                NotificationAction::Allow => "accepted",
                NotificationAction::Maybe => "tentative",
                NotificationAction::Refuse => "declined",
                NotificationAction::CompleteTask => "",
            };
            return if requested_status == observed_response {
                self.finish_attempt_succeeded(&operation_id, now).map(Some)
            } else {
                self.finish_attempt_superseded(&operation_id, observed_response, now)
                    .map(Some)
            };
        }
        if item.status == NotificationStatus::Superseded
            || (item.status == NotificationStatus::Acted
                && item.resolution_origin == Some(ResolutionOrigin::External))
        {
            return Ok(Some(item));
        }
        self.conn
            .execute(
                "UPDATE notification_items SET status='acted',resolved_at=?1,resolution_origin='external',
                   source_reason='answered_externally',updated_at=?1,version=version+1 WHERE id=?2",
                params![now.to_rfc3339(), item.id],
            )
            .map_err(JinError::Index)?;
        self.get_item(&item.id).map(Some)
    }

    fn transition_active_item(
        &mut self,
        item_id: &str,
        expected_version: u64,
        target: NotificationStatus,
        source_reason: Option<&str>,
        now: DateTime<Utc>,
    ) -> std::result::Result<NotificationItem, NotificationCommandError> {
        let current = self
            .get_item(item_id)
            .map_err(NotificationCommandError::from_jin)?;
        ensure_supported_item_payload(&current)?;
        if current.version != expected_version {
            return Err(NotificationCommandError::stale(current));
        }
        if current.status != NotificationStatus::Active || !target.is_terminal() {
            return Err(NotificationCommandError::new(
                "ineligible",
                "That notification action is no longer available.",
                false,
            ));
        }
        let changed = self
            .conn
            .execute(
                "UPDATE notification_items SET status=?1,source_reason=?2,resolved_at=?3,\n\
                 updated_at=?3,version=version+1 WHERE id=?4 AND version=?5 AND status='active'",
                params![
                    target.as_str(),
                    source_reason,
                    now.to_rfc3339(),
                    item_id,
                    expected_version as i64
                ],
            )
            .map_err(JinError::Index)
            .map_err(NotificationCommandError::from_jin)?;
        if changed != 1 {
            let refreshed = self
                .get_item(item_id)
                .map_err(NotificationCommandError::from_jin)?;
            return Err(NotificationCommandError::stale(refreshed));
        }
        self.get_item(item_id)
            .map_err(NotificationCommandError::from_jin)
    }

    fn update_native_state(
        &mut self,
        item_id: &str,
        state: NativeDeliveryState,
        _error: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let current = self.get_item(item_id)?;
        let next_attempt = if state == NativeDeliveryState::Failed {
            let prior_attempts = self.native_attempt_count(item_id)?;
            let backoff_minutes = 5_i64.saturating_mul(1_i64 << prior_attempts.min(4));
            Some((now + Duration::minutes(backoff_minutes)).to_rfc3339())
        } else {
            None
        };
        self.conn
            .execute(
                "UPDATE notification_items SET native_state=?1,native_attempt_count=native_attempt_count+1,
                   native_next_attempt_at=?2,updated_at=?3,version=version+1 WHERE id=?4",
                params![
                    state.as_str(),
                    next_attempt,
                    now.to_rfc3339(),
                    current.id
                ],
            )
            .map_err(JinError::Index)?;
        self.get_item(item_id)
    }

    fn native_attempt_count(&self, item_id: &str) -> Result<u32> {
        self.conn
            .query_row(
                "SELECT native_attempt_count FROM notification_items WHERE id=?1",
                [item_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value as u32)
            .map_err(JinError::Index)
    }

    fn update_nonterminal_attempt(
        &mut self,
        operation_id: &str,
        allowed: &[ActionAttemptState],
        target: ActionAttemptState,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let attempt = self
            .action_attempt(operation_id)?
            .ok_or_else(|| JinError::NotFound(format!("notification action/{operation_id}")))?;
        if !allowed.contains(&attempt.state) {
            return Err(JinError::InvalidStateTransition {
                from: attempt.state.as_str().to_string(),
                to: target.as_str().to_string(),
            });
        }
        let tx = self.conn.transaction().map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_action_attempts SET state=?1,updated_at=?2 WHERE operation_id=?3",
            params![target.as_str(), now.to_rfc3339(), operation_id],
        )
        .map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_items SET updated_at=?1,version=version+1 WHERE id=?2",
            params![now.to_rfc3339(), attempt.item_id],
        )
        .map_err(JinError::Index)?;
        tx.commit().map_err(JinError::Index)?;
        self.get_item(&attempt.item_id)
    }

    #[allow(clippy::too_many_arguments)]
    fn finish_attempt(
        &mut self,
        operation_id: &str,
        attempt_state: ActionAttemptState,
        item_status: NotificationStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
        resolution_origin: Option<ResolutionOrigin>,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        self.finish_attempt_with_observed(
            operation_id,
            attempt_state,
            item_status,
            error_code,
            error_message,
            resolution_origin,
            None,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn finish_attempt_with_observed(
        &mut self,
        operation_id: &str,
        attempt_state: ActionAttemptState,
        item_status: NotificationStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
        resolution_origin: Option<ResolutionOrigin>,
        observed_response: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<NotificationItem> {
        let attempt = self
            .action_attempt(operation_id)?
            .ok_or_else(|| JinError::NotFound(format!("notification action/{operation_id}")))?;
        let tx = self.conn.transaction().map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_action_attempts SET state=?1,error_code=?2,error_message=?3,\n\
               observed_response=?4,updated_at=?5,completed_at=?5 WHERE operation_id=?6",
            params![
                attempt_state.as_str(),
                error_code,
                error_message.map(redact_provider_error),
                observed_response,
                now.to_rfc3339(),
                operation_id
            ],
        )
        .map_err(JinError::Index)?;
        tx.execute(
            "UPDATE notification_items SET status=?1,read_at=CASE WHEN ?1='active' THEN NULL ELSE read_at END,\n\
               action_error_code=?2,action_error_message=?3,resolved_at=CASE WHEN ?4 THEN ?5 ELSE NULL END,\n\
               resolution_origin=?6,updated_at=?5,version=version+1 WHERE id=?7",
            params![
                item_status.as_str(),
                error_code,
                error_message.map(redact_provider_error),
                item_status.is_terminal(),
                now.to_rfc3339(),
                resolution_origin.map(ResolutionOrigin::as_str),
                attempt.item_id
            ],
        )
        .map_err(JinError::Index)?;
        tx.commit().map_err(JinError::Index)?;
        self.get_item(&attempt.item_id)
    }

    fn wake_deferred(&mut self, now: DateTime<Utc>) -> Result<()> {
        self.conn
            .execute(
                "UPDATE notification_items SET visible_after=NULL,read_at=NULL,updated_at=?1,version=version+1\n\
                 WHERE status='active' AND visible_after IS NOT NULL AND visible_after <= ?1",
                [now.to_rfc3339()],
            )
            .map_err(JinError::Index)?;
        Ok(())
    }
}

/// Rebuild actionable Google invitation projections from canonical event files.
/// Indexed event DTOs are intentionally not consulted because they omit the
/// attendee identity needed to authorize an RSVP.
pub fn reconcile_calendar_invitations(
    root: &Path,
    now: DateTime<Utc>,
) -> Result<InvitationReconcileReport> {
    let config = crate::Config::load(root)?;
    let sync = crate::sync::state::open_sync_db(&config.sync_dir())?;
    let mut center = NotificationCenter::open(&config.notification_center_path())?;
    let mut report = InvitationReconcileReport::default();
    let mut seen = std::collections::HashSet::new();
    let mut canonical_aliases_seen = std::collections::HashSet::new();
    let mut incomplete_sources = std::collections::HashSet::new();
    let mut incomplete_accounts = std::collections::HashSet::new();

    for path in crate::store::fs::list_event_paths(&config.events_dir())? {
        report.scanned += 1;
        let path_fallback_key = format!(
            "canonical/{}",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unreadable-event")
        );
        canonical_aliases_seen.insert(path_fallback_key.clone());
        let event = match crate::store::fs::read_event(&path) {
            Ok(event) => event,
            Err(error) => {
                if let Some(id) = path.file_stem().and_then(|name| name.to_str()) {
                    incomplete_sources.insert(id.to_string());
                }
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &path_fallback_key,
                    "canonical_event_invalid",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let fallback_key = format!("canonical/{}", event.id());
        canonical_aliases_seen.insert(fallback_key.clone());
        if event.frontmatter.source != crate::model::event::EventSource::Google
            || event.frontmatter.authority != crate::model::event::EventSource::Google
        {
            center
                .clear_invitation_error_aliases(event.id(), &[&path_fallback_key, &fallback_key])?;
            continue;
        }
        let has_attendee_payload = event.frontmatter.attendees.is_some();
        let attendees_were_omitted = event.frontmatter.attendees_omitted == Some(true);
        let organizer_declares_external = event
            .frontmatter
            .organizer
            .as_ref()
            .and_then(|organizer| organizer.is_self)
            == Some(false);
        let explicit_invitation_signal =
            has_attendee_payload || attendees_were_omitted || organizer_declares_external;
        let ownership = match crate::google::route_ownership::read(&config.events_dir(), event.id())
        {
            Ok(Some(ownership))
                if ownership.provider == crate::google::account::GOOGLE_PROVIDER =>
            {
                ownership
            }
            Ok(_) => {
                if !explicit_invitation_signal {
                    center.clear_invitation_error_aliases(
                        event.id(),
                        &[&path_fallback_key, &fallback_key],
                    )?;
                    continue;
                }
                incomplete_sources.insert(event.id().to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &fallback_key,
                    "route_missing",
                    "Google invitation is missing exact route ownership",
                    now,
                )?;
                continue;
            }
            Err(error) => {
                if !explicit_invitation_signal {
                    center.clear_invitation_error_aliases(
                        event.id(),
                        &[&path_fallback_key, &fallback_key],
                    )?;
                    continue;
                }
                incomplete_sources.insert(event.id().to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &fallback_key,
                    "route_invalid",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let recurrence_key = match invitation_event_recurrence_key(&event) {
            Ok(recurrence_key) => recurrence_key,
            Err(error) => {
                if !explicit_invitation_signal {
                    center.clear_invitation_error_aliases(
                        event.id(),
                        &[&path_fallback_key, &fallback_key],
                    )?;
                    continue;
                }
                incomplete_sources.insert(event.id().to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &fallback_key,
                    "recurrence_projection_invalid",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let entries = match crate::sync::state::list_scoped_entries_by_jin_id(&sync, event.id()) {
            Ok(entries) => entries,
            Err(error) => {
                if !explicit_invitation_signal {
                    center.clear_invitation_error_aliases(
                        event.id(),
                        &[&path_fallback_key, &fallback_key],
                    )?;
                    continue;
                }
                incomplete_accounts.insert(ownership.account_id.to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &fallback_key,
                    "mapping_unavailable",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let matching = entries
            .iter()
            .filter(|entry| {
                entry.destination.provider == crate::google::account::GOOGLE_PROVIDER
                    && entry.destination.account_id == ownership.account_id.as_str()
                    && entry.destination.calendar_id == ownership.calendar_id
                    && entry.recurrence_key == recurrence_key
                    && entry
                        .google_event_id
                        .as_deref()
                        .is_some_and(|id| !id.is_empty())
                    && entry.etag.as_deref().is_some_and(|etag| !etag.is_empty())
            })
            .collect::<Vec<_>>();
        if matching.is_empty()
            && (event.frontmatter.recurring_event_id.is_some()
                || event.frontmatter.original_start.is_some())
        {
            // Locally expanded presentation-only instances inherit their
            // master's item and must never become actionable sources.
            center
                .clear_invitation_error_aliases(event.id(), &[&path_fallback_key, &fallback_key])?;
            continue;
        }
        if matching.len() != 1 && !explicit_invitation_signal {
            center
                .clear_invitation_error_aliases(event.id(), &[&path_fallback_key, &fallback_key])?;
            continue;
        }
        let mapping = match matching.as_slice() {
            [mapping] => *mapping,
            _ => {
                incomplete_accounts.insert(ownership.account_id.to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &fallback_key,
                    if matching.is_empty() {
                        "mapping_missing"
                    } else {
                        "mapping_ambiguous"
                    },
                    "Google invitation does not have one exact provider mapping",
                    now,
                )?;
                continue;
            }
        };
        let google_event_id = mapping.google_event_id.as_deref().unwrap();
        let source_key = format!(
            "google/{}/{}/{}/{}",
            ownership.account_id, ownership.calendar_id, google_event_id, recurrence_key
        );
        seen.insert(source_key.clone());
        let account = match config.google_registry.account(&ownership.account_id) {
            Ok(account) => account,
            Err(error) => {
                if !explicit_invitation_signal {
                    ignore_non_invitation_projection(
                        &mut center,
                        &mut report,
                        event.id(),
                        &[&path_fallback_key, &fallback_key, &source_key],
                        &source_key,
                        now,
                    )?;
                    continue;
                }
                incomplete_accounts.insert(ownership.account_id.to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &source_key,
                    "account_missing",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let organizer_is_external_for_route = event
            .frontmatter
            .organizer
            .as_ref()
            .and_then(|organizer| organizer.email.as_deref())
            .zip(account.principal.as_deref())
            .is_some_and(|(organizer, principal)| {
                !organizer.trim().eq_ignore_ascii_case(principal.trim())
            });
        let invitation_candidate = explicit_invitation_signal || organizer_is_external_for_route;
        if !invitation_candidate {
            ignore_non_invitation_projection(
                &mut center,
                &mut report,
                event.id(),
                &[&path_fallback_key, &fallback_key, &source_key],
                &source_key,
                now,
            )?;
            continue;
        }
        let calendar = match config.google_registry.calendars.iter().find(|calendar| {
            calendar.account_id == ownership.account_id
                && calendar.calendar_id == ownership.calendar_id
        }) {
            Some(calendar) => calendar,
            None => {
                incomplete_accounts.insert(ownership.account_id.to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &source_key,
                    "calendar_missing",
                    "Google invitation calendar is no longer registered",
                    now,
                )?;
                continue;
            }
        };
        let self_attendees = event
            .frontmatter
            .attendees
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|attendee| attendee.is_self == Some(true))
            .collect::<Vec<_>>();
        let eligibility_error = if event
            .frontmatter
            .organizer
            .as_ref()
            .and_then(|organizer| organizer.is_self)
            == Some(true)
        {
            Some("organizer_owned")
        } else if self_attendees.is_empty() {
            Some("self_attendee_missing")
        } else if self_attendees.len() > 1 {
            Some("self_attendee_ambiguous")
        } else if self_attendees[0].organizer == Some(true) {
            Some("organizer_owned")
        } else if self_attendees[0]
            .email
            .as_deref()
            .is_none_or(|email| email.trim().is_empty())
        {
            Some("self_attendee_missing")
        } else {
            None
        };
        if let Some(code) = eligibility_error {
            record_reconcile_error(
                &mut center,
                &mut report,
                &source_key,
                code,
                "Google invitation attendee identity is not safely actionable",
                now,
            )?;
            if center
                .mark_source_obsolete(
                    NotificationSourceKind::CalendarInvitation,
                    &source_key,
                    code,
                    now,
                )?
                .is_some()
            {
                report.obsoleted += 1;
            }
            continue;
        }
        let self_attendee = self_attendees[0];
        let response_status = self_attendee.response_status.as_deref().unwrap_or("");
        if response_status != "needsAction" {
            center.observe_answered_invitation_tombstone(&AnsweredInvitationTombstone {
                source_key: &source_key,
                source_revision: mapping.etag.as_deref().unwrap(),
                account_id: ownership.account_id.as_str(),
                calendar_id: &ownership.calendar_id,
                google_event_id,
                recurrence_key: &recurrence_key,
                self_email: self_attendee.email.as_deref().unwrap(),
                response_status,
            })?;
        }
        let existing = find_item_by_source(
            &center.conn,
            NotificationSourceKind::CalendarInvitation,
            &source_key,
        )?;
        let obsolete = event.frontmatter.status == crate::model::event::EventStatus::Cancelled
            || notification_event_has_ended(&event, now);
        if existing.is_none() && (obsolete || response_status != "needsAction") {
            center.clear_invitation_error_aliases(
                event.id(),
                &[&path_fallback_key, &fallback_key, &source_key],
            )?;
            continue;
        }
        let recurrence = match invitation_recurrence_identity(&event, google_event_id) {
            Ok(recurrence) => recurrence,
            Err(error) => {
                incomplete_sources.insert(event.id().to_string());
                record_reconcile_error(
                    &mut center,
                    &mut report,
                    &source_key,
                    "recurrence_identity_invalid",
                    &error.to_string(),
                    now,
                )?;
                continue;
            }
        };
        let route_writable = account.state == crate::google::account::GoogleAccountState::Connected
            && account.provider_subject.is_some()
            && calendar.enabled
            && calendar.available
            && calendar.access_role.can_write();
        let mut capabilities = NotificationCapabilities {
            can_respond: response_status == "needsAction"
                && route_writable
                && event.frontmatter.status != crate::model::event::EventStatus::Cancelled
                && !notification_event_has_ended(&event, now),
            disabled_reason: (!route_writable).then(|| {
                "Reconnect this Google account before responding to the invitation.".to_string()
            }),
            ..NotificationCapabilities::default()
        };
        capabilities.recurrence_scopes =
            match invitation_recurrence_scopes(&config, &sync, &event, &ownership, &recurrence) {
                Ok(scopes) => scopes,
                Err(error) => {
                    incomplete_sources.insert(event.id().to_string());
                    record_reconcile_error(
                        &mut center,
                        &mut report,
                        &source_key,
                        "recurrence_master_route_invalid",
                        &error.to_string(),
                        now,
                    )?;
                    continue;
                }
            };
        let source = NotificationSource {
            source_key: source_key.clone(),
            source_revision: mapping.etag.clone().unwrap(),
            request_native_signal: response_status == "needsAction",
            new_response_cycle: existing.as_ref().is_some_and(|item| {
                item.status.is_terminal()
                    && matches!(
                        &item.payload,
                        NotificationPayload::CalendarInvitation(payload)
                            if payload.provider_response_status != "needsAction"
                    )
                    && response_status == "needsAction"
            }),
            payload: NotificationPayload::CalendarInvitation(Box::new(CalendarInvitationPayload {
                schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                account_id: ownership.account_id.to_string(),
                account_alias: account.alias.clone(),
                calendar_id: ownership.calendar_id.clone(),
                calendar_name: calendar.name.clone(),
                canonical_event_id: event.id().to_string(),
                google_event_id: google_event_id.to_string(),
                recurrence,
                title: event.frontmatter.title.clone(),
                organizer_name: event
                    .frontmatter
                    .organizer
                    .as_ref()
                    .and_then(|organizer| organizer.display_name.clone()),
                organizer_email: event
                    .frontmatter
                    .organizer
                    .as_ref()
                    .and_then(|organizer| organizer.email.clone()),
                start: crate::model::event::render_temporal(&event.frontmatter.start),
                end: crate::model::event::render_temporal(&event.frontmatter.end),
                all_day: event.frontmatter.is_all_day,
                timezone: event.frontmatter.start_tzid.clone(),
                location: event.frontmatter.location.clone(),
                self_email: self_attendee.email.clone().unwrap(),
                provider_response_status: response_status.to_string(),
                etag: mapping.etag.clone().unwrap(),
                provider_subject: account.provider_subject.clone().unwrap_or_default(),
                auth_generation: account.auth_generation,
                route_generation: calendar.route_generation,
                capabilities,
            })),
        };
        center.upsert_source(&source, now)?;
        center.clear_invitation_error_aliases(
            event.id(),
            &[&path_fallback_key, &fallback_key, &source_key],
        )?;
        report.upserted += 1;
        if obsolete {
            if center
                .mark_source_obsolete(
                    NotificationSourceKind::CalendarInvitation,
                    &source_key,
                    "invitation_obsolete",
                    now,
                )?
                .is_some()
            {
                report.obsoleted += 1;
            }
        } else if response_status != "needsAction"
            && center
                .resolve_external_invitation(&source_key, response_status, now)?
                .is_some()
        {
            report.resolved += 1;
        }
    }

    for item in all_items(&center.conn)? {
        let NotificationPayload::CalendarInvitation(payload) = &item.payload else {
            continue;
        };
        if incomplete_sources.contains(&payload.canonical_event_id)
            || incomplete_accounts.contains(&payload.account_id)
        {
            seen.insert(item.source_key);
        }
    }
    let missing = all_items(&center.conn)?
        .into_iter()
        .filter_map(|item| {
            let NotificationPayload::CalendarInvitation(payload) = &item.payload else {
                return None;
            };
            (!item.status.is_terminal()
                && !seen.contains(&item.source_key)
                && !incomplete_sources.contains(&payload.canonical_event_id)
                && !incomplete_accounts.contains(&payload.account_id))
            .then_some(item.source_key)
        })
        .collect::<Vec<_>>();
    for source_key in missing {
        if center
            .mark_source_obsolete(
                NotificationSourceKind::CalendarInvitation,
                &source_key,
                "source_missing",
                now,
            )?
            .is_some()
        {
            report.obsoleted += 1;
        }
    }
    center.clear_unseen_source_errors(
        NotificationSourceKind::CalendarInvitation,
        "canonical/",
        &canonical_aliases_seen,
    )?;
    center.clear_unseen_source_errors(
        NotificationSourceKind::CalendarInvitation,
        "google/",
        &seen,
    )?;
    Ok(report)
}

/// Resolve reminder items whose canonical task was completed, cancelled,
/// deleted, or removed outside the Notification Center.
pub fn reconcile_task_reminders(root: &Path, now: DateTime<Utc>) -> Result<usize> {
    let config = crate::Config::load(root)?;
    let mut center = NotificationCenter::open(&config.notification_center_path())?;
    let items = all_items(&center.conn)?;
    let mut resolved = 0;
    for item in items {
        let NotificationPayload::TaskReminder(payload) = &item.payload else {
            continue;
        };
        if item.status == NotificationStatus::Acted || item.status == NotificationStatus::Obsolete {
            continue;
        }
        let task = crate::ops::tasks::get_task(&config.tasks_dir(), &payload.task_id);
        let canonical_done = task
            .as_ref()
            .is_ok_and(|task| task.frontmatter.status == crate::model::task::TaskStatus::Done);
        let canonical_resolved = task.as_ref().map_or(true, |task| {
            matches!(
                task.frontmatter.status,
                crate::model::task::TaskStatus::Done
                    | crate::model::task::TaskStatus::Cancelled
                    | crate::model::task::TaskStatus::Deleted
            )
        });
        if !canonical_resolved {
            continue;
        }
        let completion_attempt = center
            .conn
            .query_row(
                "SELECT operation_id FROM notification_action_attempts
                 WHERE item_id=?1 AND requested_action='complete_task'
                   AND state IN ('preparing','queued','sending')
                 ORDER BY created_at DESC,operation_id DESC LIMIT 1",
                [item.id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(JinError::Index)?;
        if canonical_done {
            if let Some(operation_id) = completion_attempt {
                center.finish_attempt_succeeded(&operation_id, now)?;
                resolved += 1;
                continue;
            }
        }
        if center
            .mark_source_obsolete(
                NotificationSourceKind::TaskReminder,
                &item.source_key,
                "task_resolved",
                now,
            )?
            .is_some()
        {
            resolved += 1;
        }
    }
    Ok(resolved)
}

fn record_reconcile_error(
    center: &mut NotificationCenter,
    report: &mut InvitationReconcileReport,
    source_key: &str,
    code: &str,
    message: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    center.record_source_error(
        NotificationSourceKind::CalendarInvitation,
        source_key,
        code,
        message,
        now,
    )?;
    report.errors.push(InvitationReconcileError {
        source_key: source_key.to_string(),
        code: code.to_string(),
        message: redact_provider_error(message),
    });
    Ok(())
}

fn ignore_non_invitation_projection(
    center: &mut NotificationCenter,
    report: &mut InvitationReconcileReport,
    canonical_event_id: &str,
    aliases: &[&str],
    source_key: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    center.clear_invitation_error_aliases(canonical_event_id, aliases)?;
    if center
        .mark_source_obsolete(
            NotificationSourceKind::CalendarInvitation,
            source_key,
            "not_an_invitation",
            now,
        )?
        .is_some()
    {
        report.obsoleted += 1;
    }
    Ok(())
}

fn invitation_event_recurrence_key(event: &crate::model::event::Event) -> Result<String> {
    let Some(original_start) = event.frontmatter.original_start.as_ref() else {
        return Ok(crate::sync::state::MASTER_RECURRENCE_KEY.to_string());
    };
    Ok(match (&event.frontmatter.start_tzid, original_start) {
        (Some(tzid), crate::model::event::TemporalValue::DateTime(_)) => format!(
            "{}@{}",
            crate::model::event::render_temporal(original_start),
            tzid
        ),
        _ => crate::model::event::render_temporal(original_start),
    })
}

fn invitation_recurrence_identity(
    event: &crate::model::event::Event,
    google_event_id: &str,
) -> Result<InvitationRecurrenceIdentity> {
    if let (Some(recurring_event_id), Some(original_start)) = (
        event.frontmatter.recurring_event_id.as_ref(),
        event.frontmatter.original_start.as_ref(),
    ) {
        return Ok(InvitationRecurrenceIdentity::Instance {
            instance_google_event_id: google_event_id.to_string(),
            recurring_event_id: recurring_event_id.clone(),
            original_start: crate::model::event::render_temporal(original_start),
            original_start_tzid: matches!(
                original_start,
                crate::model::event::TemporalValue::DateTime(_)
            )
            .then(|| event.frontmatter.start_tzid.clone())
            .flatten(),
        });
    }
    if !event.frontmatter.recurrence.is_empty() {
        return Ok(InvitationRecurrenceIdentity::SeriesMaster {
            master_google_event_id: google_event_id.to_string(),
        });
    }
    if event.frontmatter.recurring_event_id.is_some() || event.frontmatter.original_start.is_some()
    {
        return Err(JinError::Integrity(
            "recurring invitation instance is missing exact original-start identity".to_string(),
        ));
    }
    Ok(InvitationRecurrenceIdentity::Single)
}

fn invitation_recurrence_scopes(
    config: &crate::Config,
    sync: &rusqlite::Connection,
    event: &crate::model::event::Event,
    ownership: &crate::google::route_ownership::CanonicalRouteOwnership,
    identity: &InvitationRecurrenceIdentity,
) -> Result<Vec<InvitationRecurrenceScope>> {
    match identity {
        InvitationRecurrenceIdentity::Single => Ok(Vec::new()),
        InvitationRecurrenceIdentity::SeriesMaster { .. } => {
            Ok(vec![InvitationRecurrenceScope::EntireSeries])
        }
        InvitationRecurrenceIdentity::Instance {
            recurring_event_id, ..
        } => {
            let mut scopes = vec![InvitationRecurrenceScope::ThisOccurrence];
            if let Some(master_id) = event.frontmatter.master_id.as_deref() {
                let route = crate::google::route_ownership::read(&config.events_dir(), master_id)?;
                if route.as_ref().is_some_and(|route| {
                    route.provider == crate::google::account::GOOGLE_PROVIDER
                        && route.account_id == ownership.account_id
                        && route.calendar_id == ownership.calendar_id
                }) {
                    let destination = crate::sync::state::SyncDestination::google(
                        ownership.account_id.as_str().to_string(),
                        ownership.calendar_id.clone(),
                    );
                    let mapping = crate::sync::state::get_scoped_entry_by_jin_id(
                        sync,
                        &destination,
                        master_id,
                        crate::sync::state::MASTER_RECURRENCE_KEY,
                    )?;
                    if mapping.as_ref().is_some_and(|mapping| {
                        mapping.google_event_id.as_deref() == Some(recurring_event_id.as_str())
                            && mapping.etag.as_deref().is_some_and(|etag| !etag.is_empty())
                    }) {
                        scopes.push(InvitationRecurrenceScope::EntireSeries);
                    }
                }
            }
            Ok(scopes)
        }
    }
}

fn notification_event_has_ended(event: &crate::model::event::Event, now: DateTime<Utc>) -> bool {
    match &event.frontmatter.end {
        crate::model::event::TemporalValue::Date(date) => *date <= now.date_naive(),
        crate::model::event::TemporalValue::DateTime(value) => {
            let tzid = event
                .frontmatter
                .end_tzid
                .as_deref()
                .or(event.frontmatter.start_tzid.as_deref())
                .unwrap_or("UTC");
            crate::time::resolve_to_utc(*value, tzid)
                .map(|resolved| resolved.utc() <= now)
                .unwrap_or(true)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
struct ItemSortKey {
    class: u8,
    reverse_relevant_at: std::cmp::Reverse<String>,
    id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PageCursor {
    version: u8,
    watermark: String,
    after: ItemSortKey,
}

fn existing_schema_version(conn: &Connection) -> Result<Option<u32>> {
    let has_meta = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_center_meta')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(JinError::Index)?;
    if !has_meta {
        return Ok(None);
    }
    let value = conn
        .query_row(
            "SELECT value FROM notification_center_meta WHERE key='schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(JinError::Index)?;
    value
        .map(|value| {
            value.parse().map_err(|_| {
                JinError::Integrity("invalid Notification Center schema version".to_string())
            })
        })
        .transpose()
}

fn payload_schema_version(payload: &NotificationPayload) -> u32 {
    match payload {
        NotificationPayload::CalendarInvitation(payload) => payload.schema_version,
        NotificationPayload::TaskReminder(payload) => payload.schema_version,
    }
}

fn ensure_supported_item_payload(
    item: &NotificationItem,
) -> std::result::Result<(), NotificationCommandError> {
    let version = payload_schema_version(&item.payload);
    if version == NOTIFICATION_PAYLOAD_SCHEMA_VERSION {
        return Ok(());
    }
    Err(error_with_item(
        "ineligible",
        "Update Jin before managing this notification.",
        false,
        item.clone(),
    ))
}

fn effective_action_payload_changed(
    current: &NotificationPayload,
    incoming: &NotificationPayload,
) -> bool {
    match (current, incoming) {
        (
            NotificationPayload::CalendarInvitation(current),
            NotificationPayload::CalendarInvitation(incoming),
        ) => {
            current.capabilities != incoming.capabilities
                || current.provider_subject != incoming.provider_subject
                || current.auth_generation != incoming.auth_generation
                || current.route_generation != incoming.route_generation
                || current.provider_response_status != incoming.provider_response_status
                || current.self_email != incoming.self_email
        }
        (
            NotificationPayload::TaskReminder(current),
            NotificationPayload::TaskReminder(incoming),
        ) => {
            current.capabilities != incoming.capabilities
                || current.task_edit_token != incoming.task_edit_token
        }
        _ => true,
    }
}

fn invitation_needs_response(payload: &NotificationPayload) -> bool {
    matches!(
        payload,
        NotificationPayload::CalendarInvitation(invitation)
            if invitation.provider_response_status == "needsAction"
    )
}

fn invitation_response_cycle_fingerprint(payload: &NotificationPayload) -> Option<String> {
    let NotificationPayload::CalendarInvitation(invitation) = payload else {
        return None;
    };
    let recurrence_key = invitation.recurrence.recurrence_key();
    Some(invitation_response_cycle_fingerprint_fields(
        &invitation.account_id,
        &invitation.calendar_id,
        &invitation.google_event_id,
        &recurrence_key,
        &invitation.self_email,
        &invitation.provider_response_status,
    ))
}

fn invitation_response_cycle_fingerprint_fields(
    account_id: &str,
    calendar_id: &str,
    google_event_id: &str,
    recurrence_key: &str,
    self_email: &str,
    response_status: &str,
) -> String {
    let mut digest = Sha256::new();
    for value in [
        account_id,
        calendar_id,
        google_event_id,
        recurrence_key,
        self_email,
        response_status,
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

fn validate_source(source: &NotificationSource) -> Result<()> {
    if source.source_key.trim().is_empty() || source.source_revision.trim().is_empty() {
        return Err(JinError::InvalidInput(
            "notification source key and revision are required".to_string(),
        ));
    }
    let schema_version = payload_schema_version(&source.payload);
    if schema_version != NOTIFICATION_PAYLOAD_SCHEMA_VERSION {
        return Err(JinError::InvalidInput(format!(
            "unsupported notification payload schema version {schema_version}"
        )));
    }
    Ok(())
}

fn deterministic_item_id(kind: NotificationSourceKind, source_key: &str) -> String {
    format!(
        "nc_{:x}",
        Sha256::digest(format!("{}\0{source_key}", kind.as_str()).as_bytes())
    )
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| JinError::Integrity(format!("invalid Notification Center time: {error}")))
}

fn find_item_by_source(
    conn: &Connection,
    kind: NotificationSourceKind,
    source_key: &str,
) -> Result<Option<NotificationItem>> {
    let id = conn
        .query_row(
            "SELECT id FROM notification_items WHERE source_kind=?1 AND source_key=?2",
            params![kind.as_str(), source_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(JinError::Index)?;
    id.map(|id| get_item_conn_strict(conn, &id))
        .transpose()
        .map(Option::flatten)
}

fn get_item_conn(conn: &Connection, item_id: &str) -> Result<Option<NotificationItem>> {
    get_item_conn_with_decoder(conn, item_id, row_to_item)
}

fn get_item_conn_strict(conn: &Connection, item_id: &str) -> Result<Option<NotificationItem>> {
    get_item_conn_with_decoder(conn, item_id, row_to_item_strict)
}

fn get_item_conn_with_decoder(
    conn: &Connection,
    item_id: &str,
    decoder: fn(&rusqlite::Row<'_>) -> rusqlite::Result<Result<NotificationItem>>,
) -> Result<Option<NotificationItem>> {
    conn.query_row(
        "SELECT i.id,i.source_kind,i.source_key,i.source_revision,i.kind_payload_json,i.status,\n\
                i.read_at,i.visible_after,i.requested_action,i.action_error_code,i.action_error_message,\n\
                i.native_state,i.version,i.created_at,i.updated_at,i.resolution_origin,i.source_reason,\n\
                (SELECT state FROM notification_action_attempts a WHERE a.item_id=i.id\n\
                 ORDER BY a.created_at DESC,a.operation_id DESC LIMIT 1)\n\
         FROM notification_items i WHERE i.id=?1",
        [item_id],
        decoder,
    )
    .optional()
    .map_err(JinError::Index)?
    .transpose()
}

fn all_items(conn: &Connection) -> Result<Vec<NotificationItem>> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id,i.source_kind,i.source_key,i.source_revision,i.kind_payload_json,i.status,\n\
                    i.read_at,i.visible_after,i.requested_action,i.action_error_code,i.action_error_message,\n\
                    i.native_state,i.version,i.created_at,i.updated_at,i.resolution_origin,i.source_reason,\n\
                    (SELECT state FROM notification_action_attempts a WHERE a.item_id=i.id\n\
                     ORDER BY a.created_at DESC,a.operation_id DESC LIMIT 1)\n\
             FROM notification_items i",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map([], row_to_item)
        .map_err(JinError::Index)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    rows.into_iter().collect()
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<NotificationItem>> {
    row_to_item_mode(row, true)
}

fn row_to_item_strict(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<NotificationItem>> {
    row_to_item_mode(row, false)
}

fn row_to_item_mode(
    row: &rusqlite::Row<'_>,
    project_future_payload: bool,
) -> rusqlite::Result<Result<NotificationItem>> {
    let source_kind = row.get::<_, String>(1)?;
    let payload_json = row.get::<_, String>(4)?;
    let status = row.get::<_, String>(5)?;
    let requested_action = row.get::<_, Option<String>>(8)?;
    let native_state = row.get::<_, String>(11)?;
    let resolution_origin = row.get::<_, Option<String>>(15)?;
    let attempt_state = row.get::<_, Option<String>>(17)?;
    Ok((|| {
        let parsed_kind = NotificationSourceKind::parse(&source_kind)?;
        let raw_payload: serde_json::Value =
            serde_json::from_str(&payload_json).map_err(|error| {
                JinError::Integrity(format!("decode notification payload: {error}"))
            })?;
        let stored_schema_version = raw_payload
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| {
                JinError::Integrity("notification payload schema version is missing".to_string())
            })? as u32;
        let payload: NotificationPayload =
            if stored_schema_version == NOTIFICATION_PAYLOAD_SCHEMA_VERSION {
                serde_json::from_value(raw_payload.clone()).map_err(|error| {
                    JinError::Integrity(format!("decode notification payload: {error}"))
                })?
            } else if project_future_payload
                && stored_schema_version > NOTIFICATION_PAYLOAD_SCHEMA_VERSION
            {
                unsupported_payload_projection(parsed_kind, &raw_payload, stored_schema_version)
            } else {
                return Err(JinError::Integrity(format!(
                "unsupported stored notification payload schema version {stored_schema_version}"
            )));
            };
        if payload.source_kind() != parsed_kind {
            return Err(JinError::Integrity(
                "notification payload kind does not match source kind".to_string(),
            ));
        }
        let error_code = row.get::<_, Option<String>>(9).map_err(JinError::Index)?;
        let error_message = row.get::<_, Option<String>>(10).map_err(JinError::Index)?;
        Ok(NotificationItem {
            id: row.get(0).map_err(JinError::Index)?,
            source_key: row.get(2).map_err(JinError::Index)?,
            source_revision: row.get(3).map_err(JinError::Index)?,
            status: NotificationStatus::parse(&status)?,
            version: row.get::<_, i64>(12).map_err(JinError::Index)? as u64,
            read_at: row.get(6).map_err(JinError::Index)?,
            visible_after: row.get(7).map_err(JinError::Index)?,
            created_at: row.get(13).map_err(JinError::Index)?,
            updated_at: row.get(14).map_err(JinError::Index)?,
            requested_action: requested_action
                .as_deref()
                .map(NotificationAction::parse)
                .transpose()?,
            action_state: attempt_state
                .as_deref()
                .map(ActionAttemptState::parse)
                .transpose()?,
            action_error: error_code.map(|code| NotificationActionError {
                code,
                message: error_message
                    .unwrap_or_else(|| "The action could not be completed.".to_string()),
                retryable: attempt_state.as_deref() == Some("failed_retryable"),
            }),
            native_state: NativeDeliveryState::parse(&native_state)?,
            resolution_origin: resolution_origin
                .as_deref()
                .map(ResolutionOrigin::parse)
                .transpose()?,
            source_reason: row.get(16).map_err(JinError::Index)?,
            payload,
        })
    })())
}

fn unsupported_payload_projection(
    kind: NotificationSourceKind,
    raw: &serde_json::Value,
    schema_version: u32,
) -> NotificationPayload {
    let value = |key: &str| {
        raw.get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let optional = |key: &str| {
        raw.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    let capabilities = NotificationCapabilities {
        can_mark_read: false,
        can_defer: false,
        can_dismiss: false,
        can_respond: false,
        can_complete_task: false,
        can_open_source: false,
        recurrence_scopes: Vec::new(),
        disabled_reason: Some(
            "Update Jin to manage this notification from a newer schema version.".to_string(),
        ),
    };
    match kind {
        NotificationSourceKind::CalendarInvitation => {
            let google_event_id = value("google_event_id");
            let recurrence = raw
                .get("recurrence")
                .cloned()
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or(InvitationRecurrenceIdentity::Single);
            NotificationPayload::CalendarInvitation(Box::new(CalendarInvitationPayload {
                schema_version,
                account_id: value("account_id"),
                account_alias: value("account_alias"),
                calendar_id: value("calendar_id"),
                calendar_name: value("calendar_name"),
                canonical_event_id: value("canonical_event_id"),
                google_event_id,
                recurrence,
                title: optional("title")
                    .unwrap_or_else(|| "Unsupported calendar invitation".to_string()),
                organizer_name: optional("organizer_name"),
                organizer_email: optional("organizer_email"),
                start: value("start"),
                end: value("end"),
                all_day: raw
                    .get("all_day")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                timezone: optional("timezone"),
                location: optional("location"),
                self_email: value("self_email"),
                provider_response_status: value("provider_response_status"),
                etag: value("etag"),
                provider_subject: value("provider_subject"),
                auth_generation: raw
                    .get("auth_generation")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
                route_generation: raw
                    .get("route_generation")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
                capabilities,
            }))
        }
        NotificationSourceKind::TaskReminder => {
            NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
                schema_version,
                occurrence_key: value("occurrence_key"),
                task_id: value("task_id"),
                title: optional("title").unwrap_or_else(|| "Unsupported task reminder".to_string()),
                scheduled_at: value("scheduled_at"),
                list_name: optional("list_name"),
                project_name: optional("project_name"),
                task_edit_token: optional("task_edit_token"),
                capabilities,
            }))
        }
    }
}

fn row_to_attempt(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<NotificationActionAttempt>> {
    let action = row.get::<_, String>(2)?;
    let recurrence = row.get::<_, Option<String>>(3)?;
    let state = row.get::<_, String>(4)?;
    let error_code = row.get::<_, Option<String>>(18)?;
    let error_message = row.get::<_, Option<String>>(19)?;
    Ok((|| {
        Ok(NotificationActionAttempt {
            operation_id: row.get(0).map_err(JinError::Index)?,
            item_id: row.get(1).map_err(JinError::Index)?,
            requested_action: NotificationAction::parse(&action)?,
            recurrence_scope: recurrence
                .as_deref()
                .map(|value| match value {
                    "this_occurrence" => Ok(InvitationRecurrenceScope::ThisOccurrence),
                    "entire_series" => Ok(InvitationRecurrenceScope::EntireSeries),
                    _ => Err(JinError::Integrity(format!(
                        "unsupported invitation recurrence scope: {value}"
                    ))),
                })
                .transpose()?,
            state: ActionAttemptState::parse(&state)?,
            source_revision: row.get(5).map_err(JinError::Index)?,
            provider: row.get(6).map_err(JinError::Index)?,
            account_id: row.get(7).map_err(JinError::Index)?,
            calendar_id: row.get(8).map_err(JinError::Index)?,
            canonical_event_id: row.get(9).map_err(JinError::Index)?,
            google_event_id: row.get(10).map_err(JinError::Index)?,
            recurrence_key: row.get(11).map_err(JinError::Index)?,
            self_email: row.get(12).map_err(JinError::Index)?,
            provider_subject: row.get(13).map_err(JinError::Index)?,
            auth_generation: row
                .get::<_, Option<i64>>(14)
                .map_err(JinError::Index)?
                .map(|value| value as u64),
            route_generation: row
                .get::<_, Option<i64>>(15)
                .map_err(JinError::Index)?
                .map(|value| value as u64),
            base_etag: row.get(16).map_err(JinError::Index)?,
            retry_count: row.get::<_, i64>(17).map_err(JinError::Index)? as u8,
            error: error_code.map(|code| NotificationActionError {
                code,
                message: error_message
                    .unwrap_or_else(|| "The action could not be completed.".to_string()),
                retryable: matches!(state.as_str(), "failed_retryable"),
            }),
            observed_response: row.get(20).map_err(JinError::Index)?,
        })
    })())
}

fn item_matches_filter(
    item: &NotificationItem,
    request: &NotificationListRequest,
    now: DateTime<Utc>,
) -> bool {
    let terminal = item.status.is_terminal();
    let deferred = item
        .visible_after
        .as_deref()
        .and_then(|value| parse_time(value).ok())
        .is_some_and(|instant| instant > now);
    if terminal && !request.include_terminal && request.filter != NotificationFilter::History {
        return false;
    }
    if deferred && !request.include_deferred && request.filter != NotificationFilter::Deferred {
        return false;
    }
    match request.filter {
        NotificationFilter::All => !terminal && !deferred,
        NotificationFilter::Invitations => {
            !terminal
                && !deferred
                && matches!(item.payload, NotificationPayload::CalendarInvitation(_))
        }
        NotificationFilter::Reminders => {
            !terminal && !deferred && matches!(item.payload, NotificationPayload::TaskReminder(_))
        }
        NotificationFilter::Unread => !terminal && !deferred && item.read_at.is_none(),
        NotificationFilter::Deferred => deferred && !terminal,
        NotificationFilter::History => terminal,
    }
}

fn item_sort_key(item: &NotificationItem) -> ItemSortKey {
    ItemSortKey {
        class: if item.action_error.is_some() {
            0
        } else if item.read_at.is_none() {
            1
        } else {
            2
        },
        reverse_relevant_at: std::cmp::Reverse(item.updated_at.clone()),
        id: item.id.clone(),
    }
}

fn encode_cursor(cursor: &PageCursor) -> String {
    let bytes = serde_json::to_vec(cursor).expect("page cursor is serializable");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_cursor(value: &str) -> std::result::Result<PageCursor, NotificationCommandError> {
    if !value.len().is_multiple_of(2) {
        return Err(NotificationCommandError::new(
            "invalid_cursor",
            "The notification cursor is invalid.",
            false,
        ));
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| {
            NotificationCommandError::new(
                "invalid_cursor",
                "The notification cursor is invalid.",
                false,
            )
        })?;
    let cursor: PageCursor = serde_json::from_slice(&bytes).map_err(|_| {
        NotificationCommandError::new(
            "invalid_cursor",
            "The notification cursor is invalid.",
            false,
        )
    })?;
    if cursor.version != 1 {
        return Err(NotificationCommandError::new(
            "invalid_cursor",
            "The notification cursor version is unsupported.",
            false,
        ));
    }
    Ok(cursor)
}

fn validate_operation_id(operation_id: &str) -> std::result::Result<(), NotificationCommandError> {
    if operation_id.trim().is_empty()
        || operation_id.contains('/')
        || operation_id.contains('\\')
        || operation_id == "."
        || operation_id == ".."
    {
        return Err(NotificationCommandError::new(
            "idempotency_conflict",
            "The operation ID is invalid.",
            false,
        ));
    }
    Ok(())
}

fn intent_hash(
    intent: &ActionAttemptIntent,
) -> std::result::Result<String, NotificationCommandError> {
    let bytes = serde_json::to_vec(intent).map_err(|_| {
        NotificationCommandError::new(
            "provider_failed",
            "The notification action could not be prepared.",
            false,
        )
    })?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub fn redact_provider_error(message: &str) -> String {
    let lowercase = message.to_ascii_lowercase();
    if lowercase.contains("access_token")
        || lowercase.contains("refresh_token")
        || lowercase.contains("authorization: bearer")
        || lowercase.contains("\"attendees\"")
        || lowercase.contains("provider body")
    {
        "The provider rejected the request. Review the account connection and try again."
            .to_string()
    } else {
        message.chars().take(240).collect()
    }
}

fn invitation_error_code(error: &JinError) -> &'static str {
    let message = error.to_string();
    for code in [
        "organizer_owned",
        "self_attendee_missing",
        "self_attendee_ambiguous",
        "already_answered",
        "credential_generation_changed",
        "route_generation_changed",
        "unsupported_recurrence_scope",
        "idempotency_conflict",
        "stale_item",
    ] {
        if message.contains(code) {
            return code;
        }
    }
    match error {
        JinError::Auth(_) => "reauth_required",
        JinError::Offline(_) => "provider_failed",
        JinError::NotFound(_) => "not_found",
        _ => "ineligible",
    }
}

fn closed_command_error_code(value: &str) -> &'static str {
    const CODES: &[&str] = &[
        "not_found",
        "stale_item",
        "invalid_cursor",
        "ineligible",
        "organizer_owned",
        "self_attendee_missing",
        "self_attendee_ambiguous",
        "already_answered",
        "route_unavailable",
        "reauth_required",
        "credential_generation_changed",
        "route_generation_changed",
        "unsupported_recurrence_scope",
        "idempotency_conflict",
        "provider_failed",
    ];
    CODES
        .iter()
        .copied()
        .find(|code| value == *code || value.starts_with(&format!("{code}:")))
        .unwrap_or("ineligible")
}

struct InvitationActionSnapshot {
    account_id: String,
    calendar_id: String,
    canonical_event_id: String,
    google_event_id: String,
    recurrence_key: String,
    self_email: String,
    etag: String,
}

fn invitation_action_snapshot(
    root: &Path,
    payload: &CalendarInvitationPayload,
    scope: Option<InvitationRecurrenceScope>,
) -> Result<InvitationActionSnapshot> {
    if scope != Some(InvitationRecurrenceScope::EntireSeries) {
        return Ok(InvitationActionSnapshot {
            account_id: payload.account_id.clone(),
            calendar_id: payload.calendar_id.clone(),
            canonical_event_id: payload.canonical_event_id.clone(),
            google_event_id: payload.google_event_id.clone(),
            recurrence_key: payload.recurrence.recurrence_key(),
            self_email: payload.self_email.clone(),
            etag: payload.etag.clone(),
        });
    }

    let config = crate::Config::load(root)?;
    let requested = crate::store::fs::read_event(&crate::store::fs::find_event_path(
        &config.events_dir(),
        &payload.canonical_event_id,
    )?)?;
    let master_id = requested
        .frontmatter
        .master_id
        .as_deref()
        .unwrap_or(&payload.canonical_event_id)
        .to_string();
    let ownership = crate::google::route_ownership::read(&config.events_dir(), &master_id)?
        .ok_or_else(|| {
            JinError::Integrity(
                "Google series master is missing canonical route ownership".to_string(),
            )
        })?;
    if ownership.provider != crate::google::account::GOOGLE_PROVIDER
        || ownership.account_id.as_str() != payload.account_id
        || ownership.calendar_id != payload.calendar_id
    {
        return Err(JinError::InvalidInput(
            "event belongs to a different provider account/calendar route".to_string(),
        ));
    }
    let master = crate::store::fs::read_event(&crate::store::fs::find_event_path(
        &config.events_dir(),
        &master_id,
    )?)?;
    let self_attendees = master
        .frontmatter
        .attendees
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|attendee| attendee.is_self == Some(true))
        .collect::<Vec<_>>();
    let self_attendee = match self_attendees.as_slice() {
        [attendee] => *attendee,
        [] => return Err(JinError::InvalidInput("self_attendee_missing".to_string())),
        _ => {
            return Err(JinError::InvalidInput(
                "self_attendee_ambiguous".to_string(),
            ))
        }
    };
    let self_email = self_attendee
        .email
        .as_deref()
        .filter(|email| !email.trim().is_empty())
        .ok_or_else(|| JinError::InvalidInput("self_attendee_missing".to_string()))?;
    if self_email != payload.self_email {
        return Err(JinError::InvalidInput("self_attendee_changed".to_string()));
    }
    let destination = crate::sync::state::SyncDestination::google(
        ownership.account_id.as_str().to_string(),
        ownership.calendar_id.clone(),
    );
    let sync = crate::sync::state::open_sync_db(&config.sync_dir())?;
    let mapping = crate::sync::state::get_scoped_entry_by_jin_id(
        &sync,
        &destination,
        &master_id,
        crate::sync::state::MASTER_RECURRENCE_KEY,
    )?
    .ok_or_else(|| {
        JinError::Integrity(
            "Google series master has no mapping for its exact provider route".to_string(),
        )
    })?;
    Ok(InvitationActionSnapshot {
        account_id: ownership.account_id.as_str().to_string(),
        calendar_id: ownership.calendar_id,
        canonical_event_id: master_id,
        google_event_id: mapping.google_event_id.ok_or_else(|| {
            JinError::Integrity("Google series master mapping has no event id".to_string())
        })?,
        recurrence_key: crate::sync::state::MASTER_RECURRENCE_KEY.to_string(),
        self_email: self_email.to_string(),
        etag: mapping.etag.ok_or_else(|| {
            JinError::Integrity("Google series master mapping has no etag".to_string())
        })?,
    })
}

fn invitation_mutation_error(error: JinError, item: NotificationItem) -> NotificationCommandError {
    let code = invitation_error_code(&error);
    error_with_item(
        code,
        error.to_string(),
        matches!(error, JinError::Offline(_)),
        item,
    )
}

fn error_with_item(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    item: NotificationItem,
) -> NotificationCommandError {
    NotificationCommandError {
        code: code.to_string(),
        message: redact_provider_error(&message.into()),
        retryable,
        item: Some(Box::new(item)),
    }
}

enum CanonicalAttemptOutcome {
    Requested,
    Superseded(String),
    Obsolete(String),
    StillPending,
}

fn canonical_attempt_outcome(
    attempt: &NotificationActionAttempt,
    root: &Path,
    now: DateTime<Utc>,
) -> Result<CanonicalAttemptOutcome> {
    let canonical_event_id =
        required_attempt_field(attempt.canonical_event_id.as_deref(), "canonical_event_id")?;
    let self_email = required_attempt_field(attempt.self_email.as_deref(), "self_email")?;
    let path = match crate::store::fs::find_event_path(&root.join("events"), canonical_event_id) {
        Ok(path) => path,
        Err(JinError::NotFound(_)) => {
            return Ok(CanonicalAttemptOutcome::Obsolete(
                "The invitation no longer exists.".to_string(),
            ));
        }
        Err(error) => return Err(error),
    };
    let event = crate::store::fs::read_event(&path)?;
    if event.frontmatter.status == crate::model::event::EventStatus::Cancelled
        || notification_event_has_ended(&event, now)
    {
        return Ok(CanonicalAttemptOutcome::Obsolete(
            "The invitation is no longer actionable.".to_string(),
        ));
    }
    let desired = match attempt.requested_action {
        NotificationAction::Allow => "accepted",
        NotificationAction::Maybe => "tentative",
        NotificationAction::Refuse => "declined",
        NotificationAction::CompleteTask => return Ok(CanonicalAttemptOutcome::StillPending),
    };
    let observed = event
        .frontmatter
        .attendees
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find(|attendee| {
            attendee.is_self == Some(true) && attendee.email.as_deref() == Some(self_email)
        })
        .and_then(|attendee| attendee.response_status.as_deref());
    match observed {
        Some(status) if status == desired => Ok(CanonicalAttemptOutcome::Requested),
        Some(status) if status != "needsAction" => {
            Ok(CanonicalAttemptOutcome::Superseded(status.to_string()))
        }
        _ => Ok(CanonicalAttemptOutcome::StillPending),
    }
}

fn invitation_mutation_request_from_attempt(
    attempt: &NotificationActionAttempt,
    response: InvitationResponse,
) -> Result<crate::ops::event_mutation::InvitationResponseMutationRequest> {
    if attempt.provider.as_deref() != Some(crate::google::account::GOOGLE_PROVIDER) {
        return Err(JinError::Integrity(
            "RSVP attempt provider is not Google".to_string(),
        ));
    }
    let account_id = required_attempt_field(attempt.account_id.as_deref(), "account_id")?;
    let calendar_id = required_attempt_field(attempt.calendar_id.as_deref(), "calendar_id")?;
    let canonical_event_id =
        required_attempt_field(attempt.canonical_event_id.as_deref(), "canonical_event_id")?;
    let google_event_id =
        required_attempt_field(attempt.google_event_id.as_deref(), "google_event_id")?;
    let recurrence_key =
        required_attempt_field(attempt.recurrence_key.as_deref(), "recurrence_key")?;
    let self_email = required_attempt_field(attempt.self_email.as_deref(), "self_email")?;
    let provider_subject =
        required_attempt_field(attempt.provider_subject.as_deref(), "provider_subject")?;
    let base_etag = required_attempt_field(attempt.base_etag.as_deref(), "base_etag")?;
    Ok(
        crate::ops::event_mutation::InvitationResponseMutationRequest {
            event_id: canonical_event_id.to_string(),
            target: crate::google::account::EventSyncTarget::new(
                crate::google::account::GoogleAccountId::parse(account_id.to_string())?,
                calendar_id.to_string(),
            )?,
            operation_id: attempt.operation_id.clone(),
            response,
            recurrence_scope: attempt.recurrence_scope.map(|scope| match scope {
                InvitationRecurrenceScope::ThisOccurrence => {
                    crate::ops::event_mutation::RecurrenceMutationScope::ThisOccurrence
                }
                InvitationRecurrenceScope::EntireSeries => {
                    crate::ops::event_mutation::RecurrenceMutationScope::EntireSeries
                }
            }),
            expected_google_event_id: google_event_id.to_string(),
            expected_recurrence_key: recurrence_key.to_string(),
            expected_self_email: self_email.to_string(),
            expected_etag: base_etag.to_string(),
            expected_provider_subject: provider_subject.to_string(),
            expected_auth_generation: attempt.auth_generation.ok_or_else(|| {
                JinError::Integrity("RSVP attempt missing auth_generation".to_string())
            })?,
            expected_route_generation: attempt.route_generation.ok_or_else(|| {
                JinError::Integrity("RSVP attempt missing route_generation".to_string())
            })?,
        },
    )
}

fn required_attempt_field<'a>(value: Option<&'a str>, field: &str) -> Result<&'a str> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| JinError::Integrity(format!("RSVP attempt missing immutable {field}")))
}

fn paused_rsvp_reason_is_retryable(reason: &str) -> bool {
    reason == "rsvp_second_412"
        || reason == "provider_confirmation_mismatch"
        || reason == "provider_http_429"
        || reason
            .strip_prefix("provider_http_")
            .and_then(|status| status.parse::<u16>().ok())
            .is_some_and(|status| status >= 500)
}

#[cfg(test)]
mod transactional_tests {
    use std::sync::{Arc, Barrier};

    use chrono::TimeZone;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn prepare_action_cas_loss_rolls_back_and_returns_current_item() {
        let tmp = TempDir::new().unwrap();
        let database = tmp.path().join("notification-center.sqlite");
        let now = Utc.with_ymd_and_hms(2026, 9, 3, 10, 0, 0).unwrap();
        let mut first = NotificationCenter::open(&database).unwrap();
        let item = first
            .upsert_source(
                &NotificationSource {
                    source_key: "task/race/occurrence".to_string(),
                    source_revision: "revision-1".to_string(),
                    request_native_signal: false,
                    new_response_cycle: false,
                    payload: NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
                        schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                        occurrence_key: "race-occurrence".to_string(),
                        task_id: "race-task".to_string(),
                        title: "Race task".to_string(),
                        scheduled_at: now.to_rfc3339(),
                        list_name: None,
                        project_name: None,
                        task_edit_token: None,
                        capabilities: NotificationCapabilities {
                            can_complete_task: true,
                            ..Default::default()
                        },
                    })),
                },
                now,
            )
            .unwrap()
            .unwrap();
        let entered = Arc::new(Barrier::new(2));
        let updated = Arc::new(Barrier::new(2));
        let thread_entered = Arc::clone(&entered);
        let thread_updated = Arc::clone(&updated);
        let database_for_thread = database.clone();
        let item_for_thread = item.clone();
        let writer = std::thread::spawn(move || {
            thread_entered.wait();
            let mut second = NotificationCenter::open(&database_for_thread).unwrap();
            second
                .set_read(
                    &item_for_thread.id,
                    true,
                    item_for_thread.version,
                    now + Duration::seconds(1),
                )
                .unwrap();
            thread_updated.wait();
        });
        *PREPARE_ACTION_BEFORE_TRANSACTION_HOOK.lock().unwrap() = Some(Box::new(move || {
            entered.wait();
            updated.wait();
        }));

        let error = first
            .prepare_action_attempt(
                &ActionAttemptIntent {
                    operation_id: "genuine-two-connection-race".to_string(),
                    item_id: item.id.clone(),
                    expected_item_version: item.version,
                    requested_action: NotificationAction::CompleteTask,
                    recurrence_scope: None,
                    source_revision: item.source_revision,
                    provider: None,
                    account_id: None,
                    calendar_id: None,
                    canonical_event_id: None,
                    google_event_id: None,
                    recurrence_key: None,
                    self_email: None,
                    provider_subject: None,
                    auth_generation: None,
                    route_generation: None,
                    base_etag: None,
                },
                now,
            )
            .unwrap_err();
        writer.join().unwrap();
        assert_eq!(error.code, "stale_item");
        let current = error.item.expect("stale error includes current item");
        assert_eq!(current.version, item.version + 1);
        assert!(current.read_at.is_some());
        assert!(first
            .action_attempt("genuine-two-connection-race")
            .unwrap()
            .is_none());
    }
}
