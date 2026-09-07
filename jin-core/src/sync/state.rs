//! Sync-state SQLite store: per-calendar sync_token + per-event mapping.
//!
//! Lives at `.jin/sync/sync-state.sqlite`.  Entirely separate from `index.sqlite`.
//! Rebuildable via a full Google re-sync (410 → wipe → bootstrap).
//!
//! Schema:
//!   `calendar_sync(calendar_id PK, sync_token)`
//!   `event_sync_map(jin_id PK, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at)`

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use crate::JinError;

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS calendar_sync (
    calendar_id  TEXT PRIMARY KEY,
    sync_token   TEXT
);

CREATE TABLE IF NOT EXISTS event_sync_map (
    jin_id          TEXT PRIMARY KEY,
    google_event_id TEXT UNIQUE,
    ical_uid        TEXT,
    etag            TEXT,
    google_updated  TEXT,
    dirty           INTEGER NOT NULL DEFAULT 0,
    last_synced_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_esm_google_id
    ON event_sync_map(google_event_id);

CREATE INDEX IF NOT EXISTS idx_esm_ical_uid
    ON event_sync_map(ical_uid);

CREATE INDEX IF NOT EXISTS idx_esm_dirty
    ON event_sync_map(dirty);

CREATE TABLE IF NOT EXISTS calendar_sync_v2 (
    provider       TEXT NOT NULL,
    account_id     TEXT NOT NULL,
    calendar_id    TEXT NOT NULL,
    sync_token     TEXT,
    auth_generation INTEGER NOT NULL DEFAULT 0,
    route_generation INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider, account_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS event_sync_map_v2 (
    provider        TEXT NOT NULL,
    account_id      TEXT NOT NULL,
    calendar_id     TEXT NOT NULL,
    jin_id          TEXT NOT NULL,
    recurrence_key  TEXT NOT NULL DEFAULT 'master',
    google_event_id TEXT,
    ical_uid        TEXT,
    etag            TEXT,
    google_updated  TEXT,
    last_synced_at  TEXT,
    PRIMARY KEY(provider, account_id, calendar_id, jin_id, recurrence_key),
    UNIQUE(provider, account_id, calendar_id, google_event_id, recurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_esm_v2_remote
    ON event_sync_map_v2(provider, account_id, calendar_id, google_event_id, recurrence_key);
CREATE INDEX IF NOT EXISTS idx_esm_v2_ical
    ON event_sync_map_v2(provider, account_id, calendar_id, ical_uid, recurrence_key);

CREATE TABLE IF NOT EXISTS sync_outbox (
    operation_id      TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    account_id        TEXT NOT NULL,
    calendar_id       TEXT NOT NULL,
    jin_id            TEXT NOT NULL,
    recurrence_key    TEXT NOT NULL DEFAULT 'master',
    google_event_id   TEXT,
    operation         TEXT NOT NULL,
    base_etag         TEXT,
    canonical_revision TEXT NOT NULL,
    auth_generation   INTEGER NOT NULL,
    route_generation  INTEGER NOT NULL,
    payload_json      TEXT,
    state             TEXT NOT NULL DEFAULT 'pending',
    pause_reason      TEXT,
    reviewed          INTEGER NOT NULL DEFAULT 0,
    attempts          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    FOREIGN KEY(provider, account_id, calendar_id)
      REFERENCES calendar_sync_v2(provider, account_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_route_state
    ON sync_outbox(provider, account_id, calendar_id, state, created_at);

CREATE TABLE IF NOT EXISTS sync_outbox_v2 (
    operation_id TEXT NOT NULL, provider TEXT NOT NULL, account_id TEXT NOT NULL,
    calendar_id TEXT NOT NULL, jin_id TEXT NOT NULL,
    recurrence_key TEXT NOT NULL DEFAULT 'master', google_event_id TEXT,
    operation TEXT NOT NULL, base_etag TEXT, canonical_revision TEXT NOT NULL,
    auth_generation INTEGER NOT NULL, route_generation INTEGER NOT NULL,
    payload_json TEXT, state TEXT NOT NULL DEFAULT 'pending', pause_reason TEXT,
    reviewed INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(provider,account_id,calendar_id,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_outbox_v2_route_state
    ON sync_outbox_v2(provider,account_id,calendar_id,state,created_at);

INSERT OR IGNORE INTO sync_outbox_v2(
    operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
    google_event_id,operation,base_etag,canonical_revision,auth_generation,
    route_generation,payload_json,state,pause_reason,reviewed,attempts,
    created_at,updated_at)
SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
    google_event_id,operation,base_etag,canonical_revision,auth_generation,
    route_generation,payload_json,state,pause_reason,reviewed,attempts,
    created_at,updated_at
FROM sync_outbox;
"#;

// ── Entry types ───────────────────────────────────────────────────────────────

/// A row from `event_sync_map`.
#[derive(Debug, Clone)]
pub struct EventSyncEntry {
    pub jin_id: String,
    pub google_event_id: Option<String>,
    pub ical_uid: Option<String>,
    pub etag: Option<String>,
    pub google_updated: Option<String>,
    /// `true` → this event has local changes not yet pushed to Google.
    pub dirty: bool,
    pub last_synced_at: Option<String>,
}

pub const MASTER_RECURRENCE_KEY: &str = "master";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncDestination {
    pub provider: String,
    pub account_id: String,
    pub calendar_id: String,
}

impl SyncDestination {
    pub fn google(account_id: impl Into<String>, calendar_id: impl Into<String>) -> Self {
        Self {
            provider: crate::google::account::GOOGLE_PROVIDER.to_string(),
            account_id: account_id.into(),
            calendar_id: calendar_id.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScopedEventSyncEntry {
    pub destination: SyncDestination,
    pub jin_id: String,
    pub recurrence_key: String,
    pub google_event_id: Option<String>,
    pub ical_uid: Option<String>,
    pub etag: Option<String>,
    pub google_updated: Option<String>,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxOperationKind {
    Insert,
    Patch,
    Delete,
    RespondInvitation,
}

impl OutboxOperationKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
            Self::RespondInvitation => "respond_invitation",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "insert" => Ok(Self::Insert),
            "patch" => Ok(Self::Patch),
            "delete" => Ok(Self::Delete),
            "respond_invitation" => Ok(Self::RespondInvitation),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Clone)]
pub struct OutboxOperation {
    pub operation_id: String,
    pub destination: SyncDestination,
    pub jin_id: String,
    pub recurrence_key: String,
    pub google_event_id: Option<String>,
    pub operation: OutboxOperationKind,
    pub base_etag: Option<String>,
    pub canonical_revision: String,
    pub auth_generation: u64,
    pub route_generation: u64,
    pub payload: Option<serde_json::Value>,
    pub state: String,
    pub pause_reason: Option<String>,
    pub reviewed: bool,
}

// ── Open / init ───────────────────────────────────────────────────────────────

/// Open (or create) the sync-state database at `<sync_dir>/sync-state.sqlite`.
pub fn open_sync_db(sync_dir: &Path) -> crate::Result<Connection> {
    std::fs::create_dir_all(sync_dir)?;
    let path = sync_dir.join("sync-state.sqlite");
    let conn = Connection::open(path).map_err(JinError::Index)?;
    conn.execute_batch(SCHEMA).map_err(JinError::Index)?;
    Ok(conn)
}

// ── Calendar sync_token ───────────────────────────────────────────────────────

/// Get the stored `syncToken` for `calendar_id`.  Returns `None` if no token is
/// stored (triggers BOOTSTRAP).
pub fn get_sync_token(conn: &Connection, calendar_id: &str) -> crate::Result<Option<String>> {
    conn.query_row(
        "SELECT sync_token FROM calendar_sync WHERE calendar_id = ?1",
        params![calendar_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(JinError::Index)
    .map(|opt| opt.flatten())
}

/// Persist `next_sync_token` for `calendar_id`.
pub fn set_sync_token(conn: &Connection, calendar_id: &str, token: &str) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO calendar_sync(calendar_id, sync_token)
         VALUES(?1, ?2)
         ON CONFLICT(calendar_id) DO UPDATE SET sync_token = excluded.sync_token",
        params![calendar_id, token],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

/// Clear the `syncToken` for `calendar_id` (used on HTTP 410 → triggers full re-sync).
pub fn clear_sync_token(conn: &Connection, calendar_id: &str) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO calendar_sync(calendar_id, sync_token)
         VALUES(?1, NULL)
         ON CONFLICT(calendar_id) DO UPDATE SET sync_token = NULL",
        params![calendar_id],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

// ── Event sync map ────────────────────────────────────────────────────────────

/// Fetch the sync entry for a Jin event by its ULID.
pub fn get_entry_by_jin_id(
    conn: &Connection,
    jin_id: &str,
) -> crate::Result<Option<EventSyncEntry>> {
    conn.query_row(
        "SELECT jin_id, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at
         FROM event_sync_map WHERE jin_id = ?1",
        params![jin_id],
        row_to_entry,
    )
    .optional()
    .map_err(JinError::Index)
}

/// Fetch the sync entry by iCalUID.
/// Fallback lookup used during 410 re-sync when the google_event_id index is cleared.
pub fn get_entry_by_ical_uid(
    conn: &Connection,
    ical_uid: &str,
) -> crate::Result<Option<EventSyncEntry>> {
    conn.query_row(
        "SELECT jin_id, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at
         FROM event_sync_map WHERE ical_uid = ?1",
        params![ical_uid],
        row_to_entry,
    )
    .optional()
    .map_err(JinError::Index)
}

/// Fetch the sync entry by Google event ID.
pub fn get_entry_by_google_id(
    conn: &Connection,
    google_event_id: &str,
) -> crate::Result<Option<EventSyncEntry>> {
    conn.query_row(
        "SELECT jin_id, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at
         FROM event_sync_map WHERE google_event_id = ?1",
        params![google_event_id],
        row_to_entry,
    )
    .optional()
    .map_err(JinError::Index)
}

/// Insert or update a sync entry.
pub fn upsert_entry(conn: &Connection, entry: &EventSyncEntry) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO event_sync_map(jin_id, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(jin_id) DO UPDATE SET
             google_event_id = excluded.google_event_id,
             ical_uid        = excluded.ical_uid,
             etag            = excluded.etag,
             google_updated  = excluded.google_updated,
             dirty           = excluded.dirty,
             last_synced_at  = excluded.last_synced_at",
        params![
            entry.jin_id,
            entry.google_event_id,
            entry.ical_uid,
            entry.etag,
            entry.google_updated,
            entry.dirty as i64,
            entry.last_synced_at,
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

/// Mark an event's `dirty` flag (true = needs push, false = in sync).
pub fn set_dirty(conn: &Connection, jin_id: &str, dirty: bool) -> crate::Result<()> {
    conn.execute(
        "UPDATE event_sync_map SET dirty = ?1 WHERE jin_id = ?2",
        params![dirty as i64, jin_id],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

/// Insert an entry as dirty (enqueue for push).  Used when a Jin-origin event is
/// created/updated offline.
pub fn enqueue_dirty(conn: &Connection, jin_id: &str) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO event_sync_map(jin_id, dirty) VALUES(?1, 1)
         ON CONFLICT(jin_id) DO UPDATE SET dirty = 1",
        params![jin_id],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

/// List all events with `dirty = true`.
pub fn list_dirty(conn: &Connection) -> crate::Result<Vec<EventSyncEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT jin_id, google_event_id, ical_uid, etag, google_updated, dirty, last_synced_at
             FROM event_sync_map WHERE dirty = 1",
        )
        .map_err(JinError::Index)?;

    let rows = stmt
        .query_map([], row_to_entry)
        .map_err(JinError::Index)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;

    Ok(rows)
}

/// Delete an event's sync entry (e.g., after a Google-canonical event is tombstoned).
pub fn delete_entry(conn: &Connection, jin_id: &str) -> crate::Result<()> {
    conn.execute(
        "DELETE FROM event_sync_map WHERE jin_id = ?1",
        params![jin_id],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

/// Clear ALL event sync map entries for a calendar (used on 410 full-sync wipe).
/// Preserves dirty entries (they represent unsent local mutations that still need pushing).
pub fn clear_clean_entries(conn: &Connection) -> crate::Result<()> {
    conn.execute("DELETE FROM event_sync_map WHERE dirty = 0", [])
        .map_err(JinError::Index)?;
    Ok(())
}

// ── Destination-scoped v2 APIs ──────────────────────────────────────────────

pub fn ensure_destination(
    conn: &Connection,
    destination: &SyncDestination,
    auth_generation: u64,
    route_generation: u64,
) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO calendar_sync_v2(provider, account_id, calendar_id, auth_generation, route_generation)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(provider, account_id, calendar_id) DO UPDATE SET
           auth_generation=excluded.auth_generation,
           route_generation=excluded.route_generation",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            auth_generation as i64,
            route_generation as i64
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn get_scoped_sync_token(
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<Option<String>> {
    conn.query_row(
        "SELECT sync_token FROM calendar_sync_v2
         WHERE provider=?1 AND account_id=?2 AND calendar_id=?3",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id
        ],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(JinError::Index)
    .map(Option::flatten)
}

pub fn set_scoped_sync_token(
    conn: &Connection,
    destination: &SyncDestination,
    token: Option<&str>,
) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO calendar_sync_v2(provider, account_id, calendar_id, sync_token)
         VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(provider, account_id, calendar_id) DO UPDATE SET sync_token=excluded.sync_token",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            token
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn upsert_scoped_entry(conn: &Connection, entry: &ScopedEventSyncEntry) -> crate::Result<()> {
    conn.execute(
        "INSERT INTO event_sync_map_v2(
           provider, account_id, calendar_id, jin_id, recurrence_key,
           google_event_id, ical_uid, etag, google_updated, last_synced_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(provider, account_id, calendar_id, jin_id, recurrence_key)
         DO UPDATE SET google_event_id=excluded.google_event_id,
           ical_uid=excluded.ical_uid, etag=excluded.etag,
           google_updated=excluded.google_updated, last_synced_at=excluded.last_synced_at",
        params![
            entry.destination.provider,
            entry.destination.account_id,
            entry.destination.calendar_id,
            entry.jin_id,
            entry.recurrence_key,
            entry.google_event_id,
            entry.ical_uid,
            entry.etag,
            entry.google_updated,
            entry.last_synced_at
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn get_scoped_entry_by_remote_id(
    conn: &Connection,
    destination: &SyncDestination,
    google_event_id: &str,
    recurrence_key: &str,
) -> crate::Result<Option<ScopedEventSyncEntry>> {
    conn.query_row(
        "SELECT provider,account_id,calendar_id,jin_id,recurrence_key,
                google_event_id,ical_uid,etag,google_updated,last_synced_at
         FROM event_sync_map_v2
         WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
           AND google_event_id=?4 AND recurrence_key=?5",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            google_event_id,
            recurrence_key
        ],
        row_to_scoped_entry,
    )
    .optional()
    .map_err(JinError::Index)
}

pub fn get_scoped_entry_by_jin_id(
    conn: &Connection,
    destination: &SyncDestination,
    jin_id: &str,
    recurrence_key: &str,
) -> crate::Result<Option<ScopedEventSyncEntry>> {
    conn.query_row(
        "SELECT provider,account_id,calendar_id,jin_id,recurrence_key,
                google_event_id,ical_uid,etag,google_updated,last_synced_at
         FROM event_sync_map_v2
         WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
           AND jin_id=?4 AND recurrence_key=?5",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            jin_id,
            recurrence_key
        ],
        row_to_scoped_entry,
    )
    .optional()
    .map_err(JinError::Index)
}

pub fn delete_scoped_entry(
    conn: &Connection,
    destination: &SyncDestination,
    jin_id: &str,
    recurrence_key: &str,
) -> crate::Result<()> {
    conn.execute(
        "DELETE FROM event_sync_map_v2 WHERE provider=?1 AND account_id=?2
         AND calendar_id=?3 AND jin_id=?4 AND recurrence_key=?5",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            jin_id,
            recurrence_key
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn list_scoped_entries_by_jin_id(
    conn: &Connection,
    jin_id: &str,
) -> crate::Result<Vec<ScopedEventSyncEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT provider,account_id,calendar_id,jin_id,recurrence_key,
                    google_event_id,ical_uid,etag,google_updated,last_synced_at
             FROM event_sync_map_v2 WHERE jin_id=?1",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map(params![jin_id], row_to_scoped_entry)
        .map_err(JinError::Index)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    Ok(rows)
}

pub fn list_scoped_entries_for_destination(
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<Vec<ScopedEventSyncEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT provider,account_id,calendar_id,jin_id,recurrence_key,
                    google_event_id,ical_uid,etag,google_updated,last_synced_at
             FROM event_sync_map_v2 WHERE provider=?1 AND account_id=?2 AND calendar_id=?3",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map(
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id
            ],
            row_to_scoped_entry,
        )
        .map_err(JinError::Index)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    Ok(rows)
}

pub fn has_active_outbox_for_event(
    conn: &Connection,
    destination: &SyncDestination,
    jin_id: &str,
    recurrence_key: &str,
) -> crate::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_outbox_v2
         WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
           AND jin_id=?4 AND recurrence_key=?5 AND state IN ('pending','paused'))",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            jin_id,
            recurrence_key
        ],
        |row| row.get(0),
    )
    .map_err(JinError::Index)
}

pub fn clear_scoped_clean_entries(
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<()> {
    conn.execute(
        "DELETE FROM event_sync_map_v2
         WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
           AND NOT EXISTS (
             SELECT 1 FROM sync_outbox_v2 o WHERE o.provider=event_sync_map_v2.provider
               AND o.account_id=event_sync_map_v2.account_id
               AND o.calendar_id=event_sync_map_v2.calendar_id
               AND o.jin_id=event_sync_map_v2.jin_id
               AND o.recurrence_key=event_sync_map_v2.recurrence_key
               AND o.state IN ('pending','paused'))",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn enqueue_outbox(conn: &Connection, operation: &OutboxOperation) -> crate::Result<()> {
    ensure_destination(
        conn,
        &operation.destination,
        operation.auth_generation,
        operation.route_generation,
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    let payload = operation
        .payload
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| JinError::Integrity(format!("serialize outbox payload: {e}")))?;
    conn.execute(
        "INSERT INTO sync_outbox_v2(operation_id,provider,account_id,calendar_id,jin_id,
          recurrence_key,google_event_id,operation,base_etag,canonical_revision,
          auth_generation,route_generation,payload_json,state,pause_reason,reviewed,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)
         ON CONFLICT(provider,account_id,calendar_id,operation_id) DO NOTHING",
        params![
            operation.operation_id,
            operation.destination.provider,
            operation.destination.account_id,
            operation.destination.calendar_id,
            operation.jin_id,
            operation.recurrence_key,
            operation.google_event_id,
            operation.operation.as_str(),
            operation.base_etag,
            operation.canonical_revision,
            operation.auth_generation as i64,
            operation.route_generation as i64,
            payload,
            operation.state,
            operation.pause_reason,
            operation.reviewed as i64,
            now
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn list_route_outbox(
    conn: &Connection,
    destination: &SyncDestination,
    state: &str,
) -> crate::Result<Vec<OutboxOperation>> {
    let mut stmt = conn
        .prepare(
            "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
                    google_event_id,operation,base_etag,canonical_revision,
                    auth_generation,route_generation,payload_json,state,pause_reason,reviewed
             FROM sync_outbox_v2 WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
               AND state=?4 ORDER BY created_at,operation_id",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map(
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id,
                state
            ],
            row_to_outbox,
        )
        .map_err(JinError::Index)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    Ok(rows)
}

/// Rows eligible for one drain pass. Invitation rows left in `sending` are
/// crash-recovery candidates and must be verified remotely before any PATCH.
pub fn list_route_outbox_for_drain(
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<Vec<OutboxOperation>> {
    let mut stmt = conn
        .prepare(
            "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
                    google_event_id,operation,base_etag,canonical_revision,
                    auth_generation,route_generation,payload_json,state,pause_reason,reviewed
             FROM sync_outbox_v2 WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
               AND (state='pending' OR (operation='respond_invitation' AND state='sending'))
             ORDER BY created_at,operation_id",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map(
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id
            ],
            row_to_outbox,
        )
        .map_err(JinError::Index)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    Ok(rows)
}

pub fn claim_invitation_outbox(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
) -> crate::Result<Option<OutboxOperation>> {
    let tx = conn.unchecked_transaction().map_err(JinError::Index)?;
    let changed = tx
        .execute(
            "UPDATE sync_outbox_v2 SET state='sending',updated_at=?1
             WHERE provider=?2 AND account_id=?3 AND calendar_id=?4 AND operation_id=?5
               AND operation='respond_invitation' AND state='pending'",
            params![
                chrono::Utc::now().to_rfc3339(),
                destination.provider,
                destination.account_id,
                destination.calendar_id,
                operation_id
            ],
        )
        .map_err(JinError::Index)?;
    if changed != 1 {
        tx.rollback().map_err(JinError::Index)?;
        return Ok(None);
    }
    let operation = tx
        .query_row(
            "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
                    google_event_id,operation,base_etag,canonical_revision,
                    auth_generation,route_generation,payload_json,state,pause_reason,reviewed
             FROM sync_outbox_v2 WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
               AND operation_id=?4",
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id,
                operation_id
            ],
            row_to_outbox,
        )
        .map_err(JinError::Index)?;
    tx.commit().map_err(JinError::Index)?;
    Ok(Some(operation))
}

pub fn get_route_outbox_operation(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
) -> crate::Result<Option<OutboxOperation>> {
    conn.query_row(
        "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
                google_event_id,operation,base_etag,canonical_revision,
                auth_generation,route_generation,payload_json,state,pause_reason,reviewed
         FROM sync_outbox_v2 WHERE provider=?1 AND account_id=?2 AND calendar_id=?3
           AND operation_id=?4",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
        row_to_outbox,
    )
    .optional()
    .map_err(JinError::Index)
}

/// Resolve an operation id globally. Notification Center operation ids are
/// global idempotency keys even though legacy outbox storage is route-scoped.
pub fn get_outbox_operation(
    conn: &Connection,
    operation_id: &str,
) -> crate::Result<Option<OutboxOperation>> {
    let mut stmt = conn
        .prepare(
            "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,\n\
                    google_event_id,operation,base_etag,canonical_revision,\n\
                    auth_generation,route_generation,payload_json,state,pause_reason,reviewed\n\
             FROM sync_outbox_v2 WHERE operation_id=?1 ORDER BY provider,account_id,calendar_id",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map([operation_id], row_to_outbox)
        .map_err(JinError::Index)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(JinError::Index)?;
    match rows.as_slice() {
        [] => Ok(None),
        [operation] => Ok(Some(operation.clone())),
        _ => Err(JinError::Integrity(format!(
            "operation id {operation_id} is duplicated across provider routes"
        ))),
    }
}

pub fn outbox_attempt_count(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
) -> crate::Result<u8> {
    conn.query_row(
        "SELECT attempts FROM sync_outbox_v2 WHERE provider=?1 AND account_id=?2\n\
         AND calendar_id=?3 AND operation_id=?4",
        params![
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
        |row| row.get::<_, i64>(0),
    )
    .map(|value| value as u8)
    .map_err(JinError::Index)
}

pub fn prepare_outbox_retry(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
    refreshed_etag: &str,
) -> crate::Result<()> {
    let changed = conn
        .execute(
            "UPDATE sync_outbox_v2 SET base_etag=?1,attempts=attempts+1,updated_at=?2\n\
             WHERE provider=?3 AND account_id=?4 AND calendar_id=?5 AND operation_id=?6\n\
               AND operation='respond_invitation' AND attempts=0",
            params![
                refreshed_etag,
                chrono::Utc::now().to_rfc3339(),
                destination.provider,
                destination.account_id,
                destination.calendar_id,
                operation_id
            ],
        )
        .map_err(JinError::Index)?;
    if changed != 1 {
        return Err(JinError::OperationBlocked {
            operation_id: operation_id.to_string(),
            reason: "RSVP conflict retry was already consumed".to_string(),
        });
    }
    Ok(())
}

/// Resolve the most recent persisted destination for a Jin event, including
/// inserts that have not yet received a provider event id.
pub fn latest_destination_for_jin_id(
    conn: &Connection,
    jin_id: &str,
) -> crate::Result<Option<SyncDestination>> {
    conn.query_row(
        "SELECT provider,account_id,calendar_id FROM (
           SELECT provider,account_id,calendar_id,updated_at FROM sync_outbox_v2 WHERE jin_id=?1
           UNION ALL
           SELECT provider,account_id,calendar_id,COALESCE(last_synced_at,'') FROM event_sync_map_v2 WHERE jin_id=?1
         ) ORDER BY updated_at DESC LIMIT 1",
        params![jin_id],
        |row| Ok(SyncDestination {
            provider: row.get(0)?,
            account_id: row.get(1)?,
            calendar_id: row.get(2)?,
        }),
    )
    .optional()
    .map_err(JinError::Index)
}

pub fn quarantine_route(
    conn: &Connection,
    destination: &SyncDestination,
    reason: &str,
) -> crate::Result<usize> {
    conn.execute(
        "UPDATE sync_outbox_v2 SET state='paused',pause_reason=?1,reviewed=0,updated_at=?2
         WHERE provider=?3 AND account_id=?4 AND calendar_id=?5 AND state='pending'",
        params![
            reason,
            chrono::Utc::now().to_rfc3339(),
            destination.provider,
            destination.account_id,
            destination.calendar_id
        ],
    )
    .map_err(JinError::Index)
}

pub fn pause_outbox_operation(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
    reason: &str,
) -> crate::Result<()> {
    conn.execute(
        "UPDATE sync_outbox_v2 SET state='paused',pause_reason=?1,reviewed=0,updated_at=?2
         WHERE provider=?3 AND account_id=?4 AND calendar_id=?5 AND operation_id=?6
           AND state IN ('pending','sending')",
        params![
            reason,
            chrono::Utc::now().to_rfc3339(),
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn obsolete_outbox_operation(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
    reason: &str,
) -> crate::Result<()> {
    conn.execute(
        "UPDATE sync_outbox_v2 SET state='obsolete',pause_reason=?1,reviewed=1,updated_at=?2
         WHERE provider=?3 AND account_id=?4 AND calendar_id=?5 AND operation_id=?6
           AND state IN ('pending','sending','paused')",
        params![
            reason,
            chrono::Utc::now().to_rfc3339(),
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn requeue_sending_outbox(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
) -> crate::Result<()> {
    conn.execute(
        "UPDATE sync_outbox_v2 SET state='pending',updated_at=?1
         WHERE provider=?2 AND account_id=?3 AND calendar_id=?4 AND operation_id=?5
           AND state='sending'",
        params![
            chrono::Utc::now().to_rfc3339(),
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn clear_account_state(
    conn: &Connection,
    provider: &str,
    account_id: &str,
) -> crate::Result<()> {
    clear_account_state_with_reason(conn, provider, account_id, "account_disconnected")
}

pub fn clear_account_state_with_reason(
    conn: &Connection,
    provider: &str,
    account_id: &str,
    reason: &str,
) -> crate::Result<()> {
    let tx = conn.unchecked_transaction().map_err(JinError::Index)?;
    tx.execute(
        "UPDATE calendar_sync_v2 SET sync_token=NULL,auth_generation=auth_generation+1
         WHERE provider=?1 AND account_id=?2",
        params![provider, account_id],
    )
    .map_err(JinError::Index)?;
    tx.execute(
        "UPDATE sync_outbox_v2 SET state='paused',pause_reason=?1,reviewed=0,
          updated_at=?2 WHERE provider=?3 AND account_id=?4 AND state='pending'",
        params![
            reason,
            chrono::Utc::now().to_rfc3339(),
            provider,
            account_id
        ],
    )
    .map_err(JinError::Index)?;
    tx.commit().map_err(JinError::Index)
}

pub fn review_outbox_operation(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
    resume: bool,
    auth_generation: u64,
    route_generation: u64,
) -> crate::Result<()> {
    let changed = conn.execute(
        "UPDATE sync_outbox_v2 SET reviewed=1,state=?1,pause_reason=NULL,updated_at=?2,
         auth_generation=?7,route_generation=?8
         WHERE provider=?3 AND account_id=?4 AND calendar_id=?5 AND operation_id=?6 AND state='paused'",
        params![
            if resume { "pending" } else { "cancelled" },
            chrono::Utc::now().to_rfc3339(),
            destination.provider, destination.account_id, destination.calendar_id, operation_id,
            auth_generation as i64, route_generation as i64
        ],
    )
    .map_err(JinError::Index)?;
    if changed != 1 {
        return Err(JinError::Integrity(
            "quarantined operation does not exist on the requested exact route".to_string(),
        ));
    }
    Ok(())
}

pub fn list_paused_outbox(conn: &Connection) -> crate::Result<Vec<OutboxOperation>> {
    let mut stmt = conn
        .prepare(
            "SELECT operation_id,provider,account_id,calendar_id,jin_id,recurrence_key,
                google_event_id,operation,base_etag,canonical_revision,
                auth_generation,route_generation,payload_json,state,pause_reason,reviewed
         FROM sync_outbox_v2 WHERE state='paused'
         ORDER BY updated_at,provider,account_id,calendar_id,operation_id",
        )
        .map_err(JinError::Index)?;
    let rows = stmt.query_map([], row_to_outbox).map_err(JinError::Index)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(JinError::Index)
}

pub fn complete_outbox_operation(
    conn: &Connection,
    destination: &SyncDestination,
    operation_id: &str,
) -> crate::Result<()> {
    conn.execute(
        "UPDATE sync_outbox_v2 SET state='complete',updated_at=?1
         WHERE provider=?2 AND account_id=?3 AND calendar_id=?4 AND operation_id=?5",
        params![
            chrono::Utc::now().to_rfc3339(),
            destination.provider,
            destination.account_id,
            destination.calendar_id,
            operation_id
        ],
    )
    .map_err(JinError::Index)?;
    Ok(())
}

pub fn migrate_legacy_state(conn: &Connection, destination: &SyncDestination) -> crate::Result<()> {
    let transaction = conn.unchecked_transaction().map_err(JinError::Index)?;
    ensure_destination(&transaction, destination, 0, 0)?;
    transaction
        .execute(
            "UPDATE calendar_sync_v2 SET sync_token=(
           SELECT sync_token FROM calendar_sync WHERE calendar_id=?1)
         WHERE provider=?2 AND account_id=?3 AND calendar_id=?1
           AND sync_token IS NULL",
            params![
                destination.calendar_id,
                destination.provider,
                destination.account_id
            ],
        )
        .map_err(JinError::Index)?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO event_sync_map_v2(
          provider,account_id,calendar_id,jin_id,recurrence_key,google_event_id,
          ical_uid,etag,google_updated,last_synced_at)
         SELECT ?1,?2,?3,jin_id,'master',google_event_id,ical_uid,etag,google_updated,last_synced_at
         FROM event_sync_map",
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id
            ],
        )
        .map_err(JinError::Index)?;
    transaction.commit().map_err(JinError::Index)
}

pub fn list_scoped_jin_ids(
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT jin_id FROM event_sync_map_v2
             WHERE provider=?1 AND account_id=?2 AND calendar_id=?3 ORDER BY jin_id",
        )
        .map_err(JinError::Index)?;
    let rows = stmt
        .query_map(
            params![
                destination.provider,
                destination.account_id,
                destination.calendar_id
            ],
            |row| row.get(0),
        )
        .map_err(JinError::Index)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(JinError::Index)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventSyncEntry> {
    Ok(EventSyncEntry {
        jin_id: row.get(0)?,
        google_event_id: row.get(1)?,
        ical_uid: row.get(2)?,
        etag: row.get(3)?,
        google_updated: row.get(4)?,
        dirty: row.get::<_, i64>(5)? != 0,
        last_synced_at: row.get(6)?,
    })
}

fn row_to_scoped_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScopedEventSyncEntry> {
    Ok(ScopedEventSyncEntry {
        destination: SyncDestination {
            provider: row.get(0)?,
            account_id: row.get(1)?,
            calendar_id: row.get(2)?,
        },
        jin_id: row.get(3)?,
        recurrence_key: row.get(4)?,
        google_event_id: row.get(5)?,
        ical_uid: row.get(6)?,
        etag: row.get(7)?,
        google_updated: row.get(8)?,
        last_synced_at: row.get(9)?,
    })
}

fn row_to_outbox(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxOperation> {
    let payload: Option<String> = row.get(12)?;
    Ok(OutboxOperation {
        operation_id: row.get(0)?,
        destination: SyncDestination {
            provider: row.get(1)?,
            account_id: row.get(2)?,
            calendar_id: row.get(3)?,
        },
        jin_id: row.get(4)?,
        recurrence_key: row.get(5)?,
        google_event_id: row.get(6)?,
        operation: OutboxOperationKind::parse(row.get::<_, String>(7)?.as_str())?,
        base_etag: row.get(8)?,
        canonical_revision: row.get(9)?,
        auth_generation: row.get::<_, i64>(10)? as u64,
        route_generation: row.get::<_, i64>(11)? as u64,
        payload: payload.and_then(|value| serde_json::from_str(&value).ok()),
        state: row.get(13)?,
        pause_reason: row.get(14)?,
        reviewed: row.get::<_, i64>(15)? != 0,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn mk_db() -> (TempDir, Connection) {
        let tmp = TempDir::new().unwrap();
        let conn = open_sync_db(tmp.path()).unwrap();
        (tmp, conn)
    }

    #[test]
    fn sync_token_round_trip() {
        let (_tmp, conn) = mk_db();
        assert!(get_sync_token(&conn, "primary").unwrap().is_none());

        set_sync_token(&conn, "primary", "tok123").unwrap();
        assert_eq!(
            get_sync_token(&conn, "primary").unwrap().as_deref(),
            Some("tok123")
        );

        clear_sync_token(&conn, "primary").unwrap();
        assert!(get_sync_token(&conn, "primary").unwrap().is_none());
    }

    #[test]
    fn event_sync_map_upsert_and_dirty() {
        let (_tmp, conn) = mk_db();

        let entry = EventSyncEntry {
            jin_id: "01JTEST0001".to_string(),
            google_event_id: Some("google123".to_string()),
            ical_uid: Some("uid@google.com".to_string()),
            etag: Some("\"etag1\"".to_string()),
            google_updated: Some("2026-06-26T10:00:00Z".to_string()),
            dirty: false,
            last_synced_at: Some("2026-06-26T10:01:00Z".to_string()),
        };
        upsert_entry(&conn, &entry).unwrap();

        let loaded = get_entry_by_jin_id(&conn, "01JTEST0001").unwrap().unwrap();
        assert_eq!(loaded.google_event_id.as_deref(), Some("google123"));
        assert!(!loaded.dirty);

        set_dirty(&conn, "01JTEST0001", true).unwrap();
        let loaded2 = get_entry_by_jin_id(&conn, "01JTEST0001").unwrap().unwrap();
        assert!(loaded2.dirty);

        let dirty_list = list_dirty(&conn).unwrap();
        assert_eq!(dirty_list.len(), 1);
        assert_eq!(dirty_list[0].jin_id, "01JTEST0001");
    }

    #[test]
    fn get_entry_by_google_id_works() {
        let (_tmp, conn) = mk_db();
        let entry = EventSyncEntry {
            jin_id: "01JTEST0002".to_string(),
            google_event_id: Some("goog456".to_string()),
            ical_uid: None,
            etag: None,
            google_updated: None,
            dirty: false,
            last_synced_at: None,
        };
        upsert_entry(&conn, &entry).unwrap();

        let found = get_entry_by_google_id(&conn, "goog456").unwrap().unwrap();
        assert_eq!(found.jin_id, "01JTEST0002");

        assert!(get_entry_by_google_id(&conn, "nonexistent")
            .unwrap()
            .is_none());
    }

    #[test]
    fn enqueue_dirty_and_clear_clean() {
        let (_tmp, conn) = mk_db();

        // Insert a clean entry and a dirty one
        upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: "clean_event".to_string(),
                google_event_id: Some("g1".to_string()),
                ical_uid: None,
                etag: None,
                google_updated: None,
                dirty: false,
                last_synced_at: None,
            },
        )
        .unwrap();

        enqueue_dirty(&conn, "new_dirty").unwrap();

        // clear_clean_entries should only remove clean ones
        clear_clean_entries(&conn).unwrap();

        assert!(get_entry_by_jin_id(&conn, "clean_event").unwrap().is_none());
        assert!(
            get_entry_by_jin_id(&conn, "new_dirty")
                .unwrap()
                .unwrap()
                .dirty
        );
    }
}
