//! Durable, device-local task reminder scheduling.
//!
//! Task frontmatter remains canonical. This module only records derived
//! occurrences and delivery state in `.jin/reminder-state.sqlite`; callers
//! decide how a claimed occurrence is delivered (the CLI never invokes it).

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};

use crate::model::{DueDate, Task, TaskStatus};
use crate::ops::tasks;
use crate::{Config, JinError, Result};

const CATCH_UP_HOURS: i64 = 24;
const LEASE_MINUTES: i64 = 2;
const MAX_DELIVERY_ATTEMPTS: u32 = 5;
const OCCURRENCE_IDENTITY_VERSION: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderClaim {
    pub occurrence_key: String,
    pub task_id: String,
    pub task_title: String,
    pub fire_at: DateTime<Utc>,
    pub attempt: u32,
    /// Monotonic ownership token for this lease. Acknowledgements from an
    /// older generation cannot mutate a later claimant.
    pub claim_generation: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccurrenceState {
    Pending,
    Claimed,
    Delivered,
    Expired,
    Cancelled,
}

impl OccurrenceState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Claimed => "claimed",
            Self::Delivered => "delivered",
            Self::Expired => "expired",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "claimed" => Ok(Self::Claimed),
            "delivered" => Ok(Self::Delivered),
            "expired" => Ok(Self::Expired),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(JinError::Integrity(format!(
                "unknown reminder occurrence state '{other}'"
            ))),
        }
    }
}

#[derive(Debug)]
struct DesiredOccurrence {
    key: String,
    task_id: String,
    task_title: String,
    fire_at: DateTime<Utc>,
    definitions: Vec<String>,
}

#[derive(Debug)]
struct StoredOccurrence {
    occurrence_key: String,
    task_id: String,
    task_title: String,
    fire_at: String,
    definitions: Vec<String>,
    state: OccurrenceState,
    attempt_count: u32,
    claim_generation: i64,
    next_attempt_at: Option<String>,
    lease_until: Option<String>,
    last_error: Option<String>,
    updated_at: String,
}

pub struct ReminderEngine {
    conn: Connection,
}

impl ReminderEngine {
    pub fn open(root: &Path) -> Result<Self> {
        let cfg = Config::load(root)?;
        let path = cfg.reminder_state_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS reminder_meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS reminder_occurrences (
               occurrence_key TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               task_title TEXT NOT NULL,
               fire_at TEXT NOT NULL,
               definition TEXT NOT NULL,
               state TEXT NOT NULL CHECK(state IN ('pending','claimed','delivered','expired','cancelled')),
               attempt_count INTEGER NOT NULL DEFAULT 0,
               claim_generation INTEGER NOT NULL DEFAULT 0,
               next_attempt_at TEXT,
               lease_until TEXT,
               last_error TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS reminder_due_idx
               ON reminder_occurrences(state, next_attempt_at, fire_at);",
        )?;
        // Serialize migrations so two GUI processes opening the same root
        // cannot race schema changes or occurrence rekeying.
        let migration = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !has_column(&migration, "reminder_occurrences", "claim_generation")? {
            migration.execute(
                "ALTER TABLE reminder_occurrences
                 ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        migrate_occurrence_identity(&migration)?;
        migration.commit()?;
        Ok(Self { conn })
    }

    /// Reconcile canonical tasks, cancel stale occurrences, recover stale
    /// claims, and atomically claim everything due at `now`.
    pub fn reconcile_and_claim(
        &mut self,
        tasks_dir: &Path,
        now: DateTime<Utc>,
    ) -> Result<Vec<ReminderClaim>> {
        let tasks = tasks::list_tasks(tasks_dir, None, None, true)?;
        let desired = desired_occurrences(&tasks);
        let tx = self.conn.transaction()?;
        let first_launch = tx
            .query_row(
                "SELECT value FROM reminder_meta WHERE key = 'baseline_complete'",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_none();

        reconcile_desired(&tx, &desired, now, first_launch)?;
        cancel_stale(&tx, &desired, now)?;
        recover_and_expire(&tx, now)?;
        tx.execute(
            "INSERT OR REPLACE INTO reminder_meta(key, value) VALUES ('baseline_complete', ?1)",
            [format_time(now)],
        )?;
        let claims = claim_due(&tx, now)?;
        tx.commit()?;
        Ok(claims)
    }

    pub fn mark_delivered(
        &mut self,
        occurrence_key: &str,
        claim_generation: i64,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let updated = self.conn.execute(
            "UPDATE reminder_occurrences
             SET state = 'delivered', lease_until = NULL, next_attempt_at = NULL,
                 last_error = NULL, updated_at = ?3
             WHERE occurrence_key = ?1 AND state = 'claimed' AND claim_generation = ?2",
            params![occurrence_key, claim_generation, format_time(now)],
        )?;
        Ok(updated == 1)
    }

    /// Release a failed claim with bounded exponential backoff. After five
    /// delivery attempts the occurrence expires instead of retrying forever.
    pub fn mark_delivery_failed(
        &mut self,
        occurrence_key: &str,
        claim_generation: i64,
        now: DateTime<Utc>,
        error: &str,
    ) -> Result<bool> {
        let attempts: Option<u32> = self
            .conn
            .query_row(
                "SELECT attempt_count FROM reminder_occurrences
                 WHERE occurrence_key = ?1 AND state = 'claimed' AND claim_generation = ?2",
                params![occurrence_key, claim_generation],
                |row| row.get(0),
            )
            .optional()?;
        let Some(attempts) = attempts else {
            return Ok(false);
        };
        let updated = if attempts >= MAX_DELIVERY_ATTEMPTS {
            self.conn.execute(
                "UPDATE reminder_occurrences
                 SET state = 'expired', lease_until = NULL, next_attempt_at = NULL,
                     last_error = ?3, updated_at = ?4
                 WHERE occurrence_key = ?1 AND state = 'claimed' AND claim_generation = ?2",
                params![occurrence_key, claim_generation, error, format_time(now)],
            )?
        } else {
            let exponent = attempts.saturating_sub(1).min(6);
            let delay_seconds = 30_i64 * (1_i64 << exponent);
            self.conn.execute(
                "UPDATE reminder_occurrences
                 SET state = 'pending', lease_until = NULL, next_attempt_at = ?3,
                     last_error = ?4, updated_at = ?5
                 WHERE occurrence_key = ?1 AND state = 'claimed' AND claim_generation = ?2",
                params![
                    occurrence_key,
                    claim_generation,
                    format_time(now + Duration::seconds(delay_seconds)),
                    error,
                    format_time(now)
                ],
            )?
        };
        Ok(updated == 1)
    }

    pub fn occurrence_state(&self, occurrence_key: &str) -> Result<Option<OccurrenceState>> {
        self.conn
            .query_row(
                "SELECT state FROM reminder_occurrences WHERE occurrence_key = ?1",
                [occurrence_key],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|value| OccurrenceState::parse(&value))
            .transpose()
    }
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|candidate| candidate == column))
}

/// Rekey definition-sensitive rows from the first reminder implementation to
/// task + resolved UTC instant. The rewrite is versioned, transactional, and
/// collision-safe: delivered and expired dominate every other state to prevent
/// repeat notifications, while an active pending/claimed definition dominates
/// a cancelled equivalent so valid future work is not lost during upgrade.
fn migrate_occurrence_identity(tx: &Transaction<'_>) -> Result<()> {
    let current_version = tx
        .query_row(
            "SELECT value FROM reminder_meta WHERE key = 'occurrence_identity_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1);
    if current_version >= OCCURRENCE_IDENTITY_VERSION {
        return Ok(());
    }

    let mut stmt = tx.prepare(
        "SELECT occurrence_key, task_id, task_title, fire_at, definition, state,
                attempt_count, claim_generation, next_attempt_at, lease_until,
                last_error, updated_at
         FROM reminder_occurrences",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let definition = row.get::<_, String>(4)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                definition,
                row.get::<_, String>(5)?,
                row.get::<_, u32>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut merged: BTreeMap<String, StoredOccurrence> = BTreeMap::new();
    for (
        _old_key,
        task_id,
        task_title,
        fire_at_text,
        definition,
        state_text,
        attempt_count,
        claim_generation,
        next_attempt_at,
        lease_until,
        last_error,
        updated_at,
    ) in rows
    {
        let fire_at = parse_time(&fire_at_text)?;
        let key = occurrence_key(&task_id, fire_at);
        let definitions = parse_stored_definitions(&definition);
        let state = OccurrenceState::parse(&state_text)?;
        let candidate = StoredOccurrence {
            occurrence_key: key.clone(),
            task_id,
            task_title,
            fire_at: format_time(fire_at),
            definitions,
            state,
            attempt_count,
            claim_generation,
            next_attempt_at,
            lease_until,
            last_error,
            updated_at,
        };
        match merged.get_mut(&key) {
            Some(existing) => merge_stored_occurrence(existing, candidate),
            None => {
                merged.insert(key, candidate);
            }
        }
    }

    tx.execute("DELETE FROM reminder_occurrences", [])?;
    for occurrence in merged.values() {
        let definitions = serde_json::to_string(&occurrence.definitions)
            .map_err(|error| JinError::Integrity(format!("serialize reminder sources: {error}")))?;
        tx.execute(
            "INSERT INTO reminder_occurrences(
               occurrence_key, task_id, task_title, fire_at, definition, state,
               attempt_count, claim_generation, next_attempt_at, lease_until,
               last_error, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                occurrence.occurrence_key,
                occurrence.task_id,
                occurrence.task_title,
                occurrence.fire_at,
                definitions,
                occurrence.state.as_str(),
                occurrence.attempt_count,
                occurrence.claim_generation,
                occurrence.next_attempt_at,
                occurrence.lease_until,
                occurrence.last_error,
                occurrence.updated_at,
            ],
        )?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO reminder_meta(key, value)
         VALUES ('occurrence_identity_version', ?1)",
        [OCCURRENCE_IDENTITY_VERSION.to_string()],
    )?;
    Ok(())
}

fn parse_stored_definitions(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_else(|_| vec![value.to_string()])
}

fn state_precedence(state: OccurrenceState) -> u8 {
    match state {
        OccurrenceState::Delivered => 5,
        OccurrenceState::Expired => 4,
        OccurrenceState::Claimed => 3,
        OccurrenceState::Pending => 2,
        OccurrenceState::Cancelled => 1,
    }
}

fn merge_stored_occurrence(existing: &mut StoredOccurrence, candidate: StoredOccurrence) {
    for definition in &candidate.definitions {
        if !existing.definitions.contains(definition) {
            existing.definitions.push(definition.clone());
        }
    }
    existing.attempt_count = existing.attempt_count.max(candidate.attempt_count);
    let max_generation = existing.claim_generation.max(candidate.claim_generation);
    let candidate_wins = state_precedence(candidate.state) > state_precedence(existing.state)
        || (candidate.state == existing.state && candidate.updated_at > existing.updated_at);
    if candidate_wins {
        existing.task_title = candidate.task_title;
        existing.state = candidate.state;
        existing.next_attempt_at = candidate.next_attempt_at;
        existing.lease_until = candidate.lease_until;
        existing.last_error = candidate.last_error;
        existing.updated_at = candidate.updated_at;
    }
    existing.claim_generation = max_generation;

    if matches!(
        existing.state,
        OccurrenceState::Delivered | OccurrenceState::Expired | OccurrenceState::Cancelled
    ) {
        existing.next_attempt_at = None;
        existing.lease_until = None;
    }
}

fn desired_occurrences(tasks: &[Task]) -> BTreeMap<String, DesiredOccurrence> {
    let mut desired = BTreeMap::new();
    for task in tasks {
        if !matches!(
            task.frontmatter.status,
            TaskStatus::Todo | TaskStatus::Doing
        ) {
            continue;
        }
        for reminder in &task.frontmatter.reminders {
            let Some((fire_at, definition)) =
                resolve_reminder(task, &reminder.kind, &reminder.value)
            else {
                continue;
            };
            let key = occurrence_key(task.id(), fire_at);
            let occurrence = desired.entry(key.clone()).or_insert(DesiredOccurrence {
                key,
                task_id: task.id().to_string(),
                task_title: task.title().to_string(),
                fire_at,
                definitions: vec![],
            });
            if !occurrence.definitions.contains(&definition) {
                occurrence.definitions.push(definition);
            }
        }
    }
    desired
}

fn resolve_reminder(task: &Task, kind: &str, value: &str) -> Option<(DateTime<Utc>, String)> {
    match kind {
        "absolute" => {
            let fire_at = DateTime::parse_from_rfc3339(value)
                .ok()?
                .with_timezone(&Utc);
            Some((fire_at, format!("absolute:{}", format_time(fire_at))))
        }
        "relative" => {
            let (amount, unit) = parse_relative(value)?;
            let DueDate::DateTime(due) = task.frontmatter.due.as_ref()? else {
                return None;
            };
            let seconds_per_unit = match unit {
                'm' => 60,
                'h' => 60 * 60,
                'd' => 24 * 60 * 60,
                'w' => 7 * 24 * 60 * 60,
                _ => return None,
            };
            let seconds = amount.checked_mul(seconds_per_unit)?;
            let fire_at = due
                .with_timezone(&Utc)
                .checked_sub_signed(Duration::seconds(seconds))?;
            Some((fire_at, format!("relative:-{amount}{unit}")))
        }
        _ => None,
    }
}

fn parse_relative(value: &str) -> Option<(i64, char)> {
    let rest = value.strip_prefix('-')?;
    let unit = rest.chars().last()?;
    if !matches!(unit, 'm' | 'h' | 'd' | 'w') {
        return None;
    }
    let digits = rest.strip_suffix(unit)?;
    if digits.is_empty() || !digits.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let amount = digits.parse::<i64>().ok()?;
    (amount > 0).then_some((amount, unit))
}

fn occurrence_key(task_id: &str, fire_at: DateTime<Utc>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(task_id.as_bytes());
    hasher.update([0]);
    hasher.update(format_time(fire_at).as_bytes());
    format!("{:x}", hasher.finalize())
}

fn reconcile_desired(
    tx: &Transaction<'_>,
    desired: &BTreeMap<String, DesiredOccurrence>,
    now: DateTime<Utc>,
    first_launch: bool,
) -> Result<()> {
    let catch_up_floor = now - Duration::hours(CATCH_UP_HOURS);
    for occurrence in desired.values() {
        let definitions = serde_json::to_string(&occurrence.definitions)
            .map_err(|error| JinError::Integrity(format!("serialize reminder sources: {error}")))?;
        let initial_state =
            if (first_launch && occurrence.fire_at <= now) || occurrence.fire_at < catch_up_floor {
                OccurrenceState::Expired
            } else {
                OccurrenceState::Pending
            };
        tx.execute(
            "INSERT INTO reminder_occurrences(
               occurrence_key, task_id, task_title, fire_at, definition, state,
               attempt_count, next_attempt_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?4, ?7)
             ON CONFLICT(occurrence_key) DO UPDATE SET
               task_title = excluded.task_title,
               fire_at = excluded.fire_at,
               definition = excluded.definition,
               updated_at = excluded.updated_at",
            params![
                occurrence.key,
                occurrence.task_id,
                occurrence.task_title,
                format_time(occurrence.fire_at),
                definitions,
                initial_state.as_str(),
                format_time(now)
            ],
        )?;

        // Reopening can reactivate a cancelled future occurrence, but never a
        // reminder whose fire time has already passed.
        if occurrence.fire_at > now {
            tx.execute(
                "UPDATE reminder_occurrences
                 SET state = 'pending', attempt_count = 0, next_attempt_at = fire_at,
                     lease_until = NULL, last_error = NULL, updated_at = ?2
                 WHERE occurrence_key = ?1 AND state = 'cancelled'",
                params![occurrence.key, format_time(now)],
            )?;
        }
    }
    Ok(())
}

fn cancel_stale(
    tx: &Transaction<'_>,
    desired: &BTreeMap<String, DesiredOccurrence>,
    now: DateTime<Utc>,
) -> Result<()> {
    let desired_keys: HashSet<&str> = desired.keys().map(String::as_str).collect();
    let mut stmt = tx.prepare(
        "SELECT occurrence_key FROM reminder_occurrences
         WHERE state IN ('pending', 'claimed')",
    )?;
    let keys = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for key in keys {
        if !desired_keys.contains(key.as_str()) {
            tx.execute(
                "UPDATE reminder_occurrences
                 SET state = 'cancelled', lease_until = NULL, next_attempt_at = NULL,
                     updated_at = ?2 WHERE occurrence_key = ?1",
                params![key, format_time(now)],
            )?;
        }
    }
    Ok(())
}

fn recover_and_expire(tx: &Transaction<'_>, now: DateTime<Utc>) -> Result<()> {
    let now_text = format_time(now);
    let catch_up_floor = format_time(now - Duration::hours(CATCH_UP_HOURS));
    tx.execute(
        "UPDATE reminder_occurrences
         SET state = 'pending', lease_until = NULL, next_attempt_at = ?1, updated_at = ?1
         WHERE state = 'claimed' AND lease_until <= ?1 AND fire_at >= ?2",
        params![now_text, catch_up_floor],
    )?;
    tx.execute(
        "UPDATE reminder_occurrences
         SET state = 'expired', lease_until = NULL, next_attempt_at = NULL, updated_at = ?1
         WHERE state IN ('pending', 'claimed') AND fire_at < ?2",
        params![now_text, catch_up_floor],
    )?;
    Ok(())
}

fn claim_due(tx: &Transaction<'_>, now: DateTime<Utc>) -> Result<Vec<ReminderClaim>> {
    let now_text = format_time(now);
    let mut stmt = tx.prepare(
        "SELECT occurrence_key, task_id, task_title, fire_at, attempt_count, claim_generation
         FROM reminder_occurrences
         WHERE state = 'pending' AND fire_at <= ?1
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)
         ORDER BY fire_at, occurrence_key",
    )?;
    let rows = stmt
        .query_map([&now_text], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, u32>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut claims = Vec::with_capacity(rows.len());
    for (key, task_id, task_title, fire_at, attempts, claim_generation) in rows {
        let updated = tx.execute(
            "UPDATE reminder_occurrences
             SET state = 'claimed', attempt_count = attempt_count + 1,
                 claim_generation = claim_generation + 1,
                 lease_until = ?3, updated_at = ?4
             WHERE occurrence_key = ?1 AND state = 'pending' AND claim_generation = ?2",
            params![
                key,
                claim_generation,
                format_time(now + Duration::minutes(LEASE_MINUTES)),
                now_text
            ],
        )?;
        if updated == 1 {
            claims.push(ReminderClaim {
                occurrence_key: key,
                task_id,
                task_title,
                fire_at: parse_time(&fire_at)?,
                attempt: attempts + 1,
                claim_generation: claim_generation + 1,
            });
        }
    }
    Ok(claims)
}

fn format_time(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|error| JinError::Integrity(format!("invalid reminder timestamp: {error}")))
}

#[cfg(test)]
mod tests {
    use chrono::{FixedOffset, TimeZone};
    use tempfile::TempDir;

    use super::*;
    use crate::model::task::{Reminder, TaskFrontmatter};
    use crate::model::Priority;
    use crate::store::fs;

    fn setup() -> (TempDir, Config) {
        let tmp = TempDir::new().unwrap();
        let cfg = crate::ops::init::init(tmp.path()).unwrap();
        (tmp, cfg)
    }

    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    fn write_task(
        cfg: &Config,
        id: &str,
        status: TaskStatus,
        due: Option<DueDate>,
        reminders: Vec<Reminder>,
    ) -> Task {
        let fixed = FixedOffset::east_opt(0).unwrap();
        let timestamp = fixed.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let task = Task {
            frontmatter: TaskFrontmatter {
                id: id.to_string(),
                kind: "task".to_string(),
                title: format!("Task {id}"),
                created: timestamp,
                updated: timestamp,
                status,
                priority: Priority::None,
                due,
                list: "inbox".to_string(),
                completed_at: None,
                deleted_at: None,
                links: vec![],
                section_id: None,
                tags: vec![],
                position: String::new(),
                reminders,
                parent: None,
                agenda_bucket: None,
            },
            body: String::new(),
        };
        fs::write_task(&cfg.tasks_dir(), &task).unwrap();
        task
    }

    fn absolute(value: DateTime<Utc>) -> Reminder {
        Reminder {
            kind: "absolute".to_string(),
            value: value.to_rfc3339(),
        }
    }

    fn create_legacy_state_db(cfg: &Config) -> Connection {
        let conn = Connection::open(cfg.reminder_state_path()).unwrap();
        conn.execute_batch(
            "CREATE TABLE reminder_meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE reminder_occurrences (
               occurrence_key TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               task_title TEXT NOT NULL,
               fire_at TEXT NOT NULL,
               definition TEXT NOT NULL,
               state TEXT NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               claim_generation INTEGER NOT NULL DEFAULT 0,
               next_attempt_at TEXT,
               lease_until TEXT,
               last_error TEXT,
               updated_at TEXT NOT NULL
             );
             INSERT INTO reminder_meta(key, value)
             VALUES ('baseline_complete', '2026-09-01T00:00:00.000Z');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn resolves_utc_and_collapses_all_definitions_at_the_same_instant() {
        let (_tmp, cfg) = setup();
        let due = utc(2026, 9, 2, 12, 0).fixed_offset();
        write_task(
            &cfg,
            "one",
            TaskStatus::Todo,
            Some(DueDate::DateTime(due)),
            vec![
                Reminder {
                    kind: "relative".into(),
                    value: "-1h".into(),
                },
                Reminder {
                    kind: "relative".into(),
                    value: "-60m".into(),
                },
                absolute(utc(2026, 9, 2, 11, 0)),
                absolute(utc(2026, 9, 2, 11, 0)),
                Reminder {
                    kind: "relative".into(),
                    value: "1h".into(),
                },
                Reminder {
                    kind: "relative".into(),
                    value: "-1.5h".into(),
                },
                absolute(utc(2026, 9, 2, 11, 30)),
            ],
        );
        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), utc(2026, 9, 2, 10, 0))
            .unwrap()
            .is_empty());
        let claims = engine
            .reconcile_and_claim(&cfg.tasks_dir(), utc(2026, 9, 2, 11, 30))
            .unwrap();
        assert_eq!(claims.len(), 2);
        assert_eq!(claims[0].fire_at, utc(2026, 9, 2, 11, 0));
        assert_eq!(claims[1].fire_at, utc(2026, 9, 2, 11, 30));
        let sources: String = engine
            .conn
            .query_row(
                "SELECT definition FROM reminder_occurrences WHERE occurrence_key = ?1",
                [&claims[0].occurrence_key],
                |row| row.get(0),
            )
            .unwrap();
        let sources: Vec<String> = serde_json::from_str(&sources).unwrap();
        assert_eq!(
            sources.len(),
            3,
            "all distinct source definitions are retained"
        );
    }

    #[test]
    fn relative_without_timed_due_is_inert() {
        let (_tmp, cfg) = setup();
        write_task(
            &cfg,
            "date-only",
            TaskStatus::Todo,
            Some(DueDate::Date(
                chrono::NaiveDate::from_ymd_opt(2026, 9, 2).unwrap(),
            )),
            vec![Reminder {
                kind: "relative".into(),
                value: "-1h".into(),
            }],
        );
        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        engine
            .reconcile_and_claim(&cfg.tasks_dir(), utc(2026, 9, 1, 10, 0))
            .unwrap();
        let count: i64 = engine
            .conn
            .query_row("SELECT count(*) FROM reminder_occurrences", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn first_launch_expires_past_but_later_startup_catches_up_only_24_hours() {
        let (_tmp, cfg) = setup();
        let now = utc(2026, 9, 2, 12, 0);
        write_task(
            &cfg,
            "past",
            TaskStatus::Todo,
            None,
            vec![absolute(now - Duration::hours(1))],
        );
        write_task(
            &cfg,
            "future",
            TaskStatus::Todo,
            None,
            vec![absolute(now + Duration::hours(1))],
        );
        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now)
            .unwrap()
            .is_empty());

        write_task(
            &cfg,
            "catchup",
            TaskStatus::Todo,
            None,
            vec![absolute(now - Duration::hours(2))],
        );
        write_task(
            &cfg,
            "old",
            TaskStatus::Todo,
            None,
            vec![absolute(now - Duration::hours(25))],
        );
        let claims = engine.reconcile_and_claim(&cfg.tasks_dir(), now).unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].task_id, "catchup");
        engine
            .mark_delivered(&claims[0].occurrence_key, claims[0].claim_generation, now)
            .unwrap();

        let future = engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::hours(1))
            .unwrap();
        assert_eq!(future.len(), 1);
        assert_eq!(future[0].task_id, "future");
    }

    #[test]
    fn inactive_and_removed_occurrences_cancel_and_only_future_reopen_reactivates() {
        let (_tmp, cfg) = setup();
        let now = utc(2026, 9, 2, 12, 0);
        let mut task = write_task(
            &cfg,
            "state",
            TaskStatus::Todo,
            None,
            vec![absolute(now + Duration::hours(1))],
        );
        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        engine.reconcile_and_claim(&cfg.tasks_dir(), now).unwrap();
        let key: String = engine
            .conn
            .query_row(
                "SELECT occurrence_key FROM reminder_occurrences WHERE task_id = 'state'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        task.frontmatter.status = TaskStatus::Done;
        fs::write_task(&cfg.tasks_dir(), &task).unwrap();
        engine.reconcile_and_claim(&cfg.tasks_dir(), now).unwrap();
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Cancelled)
        );

        task.frontmatter.status = TaskStatus::Todo;
        fs::write_task(&cfg.tasks_dir(), &task).unwrap();
        engine.reconcile_and_claim(&cfg.tasks_dir(), now).unwrap();
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Pending)
        );

        task.frontmatter.status = TaskStatus::Cancelled;
        fs::write_task(&cfg.tasks_dir(), &task).unwrap();
        engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::hours(2))
            .unwrap();
        task.frontmatter.status = TaskStatus::Todo;
        fs::write_task(&cfg.tasks_dir(), &task).unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::hours(2))
            .unwrap()
            .is_empty());
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Cancelled)
        );
    }

    #[test]
    fn claims_are_durable_retry_with_backoff_and_recover_after_stale_lease() {
        let (_tmp, cfg) = setup();
        let now = utc(2026, 9, 2, 12, 0);
        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        engine
            .reconcile_and_claim(&cfg.tasks_dir(), now - Duration::minutes(1))
            .unwrap();
        write_task(&cfg, "retry", TaskStatus::Doing, None, vec![absolute(now)]);

        let first = engine.reconcile_and_claim(&cfg.tasks_dir(), now).unwrap();
        assert_eq!(first.len(), 1);
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now)
            .unwrap()
            .is_empty());

        engine
            .mark_delivery_failed(
                &first[0].occurrence_key,
                first[0].claim_generation,
                now,
                "denied",
            )
            .unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::seconds(29))
            .unwrap()
            .is_empty());
        let second = engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::seconds(30))
            .unwrap();
        assert_eq!(second[0].attempt, 2);

        // Simulate a process crash after claiming: before lease expiry nothing
        // duplicates; after expiry the same durable occurrence is reclaimed.
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now + Duration::minutes(2))
            .unwrap()
            .is_empty());
        let recovered = engine
            .reconcile_and_claim(
                &cfg.tasks_dir(),
                now + Duration::minutes(2) + Duration::seconds(30),
            )
            .unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].occurrence_key, first[0].occurrence_key);
        assert!(recovered[0].claim_generation > second[0].claim_generation);

        // The prior worker may finish after its lease expired. Neither its
        // success nor its failure may acknowledge/reset the newer claimant.
        assert!(!engine
            .mark_delivered(
                &second[0].occurrence_key,
                second[0].claim_generation,
                now + Duration::minutes(3),
            )
            .unwrap());
        assert_eq!(
            engine.occurrence_state(&first[0].occurrence_key).unwrap(),
            Some(OccurrenceState::Claimed)
        );
        assert!(!engine
            .mark_delivery_failed(
                &second[0].occurrence_key,
                second[0].claim_generation,
                now + Duration::minutes(3),
                "stale failure",
            )
            .unwrap());
        assert_eq!(
            engine.occurrence_state(&first[0].occurrence_key).unwrap(),
            Some(OccurrenceState::Claimed)
        );
        assert!(engine
            .mark_delivered(
                &recovered[0].occurrence_key,
                recovered[0].claim_generation,
                now + Duration::minutes(3),
            )
            .unwrap());
        assert_eq!(
            engine.occurrence_state(&first[0].occurrence_key).unwrap(),
            Some(OccurrenceState::Delivered)
        );
    }

    #[test]
    fn opening_migrates_pre_generation_state_database() {
        let (_tmp, cfg) = setup();
        let conn = Connection::open(cfg.reminder_state_path()).unwrap();
        conn.execute_batch(
            "CREATE TABLE reminder_occurrences (
               occurrence_key TEXT PRIMARY KEY,
               task_id TEXT NOT NULL,
               task_title TEXT NOT NULL,
               fire_at TEXT NOT NULL,
               definition TEXT NOT NULL,
               state TEXT NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               next_attempt_at TEXT,
               lease_until TEXT,
               last_error TEXT,
               updated_at TEXT NOT NULL
             );",
        )
        .unwrap();
        drop(conn);

        let engine = ReminderEngine::open(&cfg.root).unwrap();
        assert!(has_column(&engine.conn, "reminder_occurrences", "claim_generation").unwrap());
    }

    #[test]
    fn identity_migration_does_not_resurrect_a_delivered_legacy_occurrence() {
        let (_tmp, cfg) = setup();
        let fire_at = utc(2026, 9, 2, 12, 0);
        write_task(
            &cfg,
            "legacy-delivered",
            TaskStatus::Todo,
            None,
            vec![absolute(fire_at)],
        );
        let conn = create_legacy_state_db(&cfg);
        conn.execute(
            "INSERT INTO reminder_occurrences(
               occurrence_key, task_id, task_title, fire_at, definition, state,
               attempt_count, claim_generation, updated_at
             ) VALUES ('definition-sensitive-key', 'legacy-delivered', 'Task legacy-delivered',
                       ?1, ?2, 'delivered', 1, 1, ?1)",
            params![
                format_time(fire_at),
                format!("absolute:{}", format_time(fire_at))
            ],
        )
        .unwrap();
        drop(conn);

        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        let claims = engine
            .reconcile_and_claim(&cfg.tasks_dir(), fire_at + Duration::minutes(1))
            .unwrap();
        assert!(claims.is_empty());
        let semantic_key = occurrence_key("legacy-delivered", fire_at);
        assert_eq!(
            engine.occurrence_state(&semantic_key).unwrap(),
            Some(OccurrenceState::Delivered)
        );
        let count: i64 = engine
            .conn
            .query_row("SELECT count(*) FROM reminder_occurrences", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn identity_migration_reactivates_singleton_cancelled_reopened_offline() {
        let (_tmp, cfg) = setup();
        let now = utc(2026, 9, 2, 10, 0);
        let fire_at = now + Duration::hours(2);
        // The canonical task is already active when the upgraded GUI first
        // opens, modeling a reopen performed offline before migration.
        write_task(
            &cfg,
            "legacy-cancelled",
            TaskStatus::Todo,
            None,
            vec![absolute(fire_at)],
        );
        let conn = create_legacy_state_db(&cfg);
        conn.execute(
            "INSERT INTO reminder_occurrences(
               occurrence_key, task_id, task_title, fire_at, definition, state, updated_at
             ) VALUES ('old-cancelled-key', 'legacy-cancelled', 'Task legacy-cancelled',
                       ?1, ?2, 'cancelled', ?3)",
            params![
                format_time(fire_at),
                format!("absolute:{}", format_time(fire_at)),
                format_time(now),
            ],
        )
        .unwrap();
        drop(conn);

        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now)
            .unwrap()
            .is_empty());
        let key = occurrence_key("legacy-cancelled", fire_at);
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Pending)
        );
        let claims = engine
            .reconcile_and_claim(&cfg.tasks_dir(), fire_at)
            .unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].occurrence_key, key);
    }

    #[test]
    fn identity_migration_active_equivalent_outranks_cancelled_collision() {
        let (_tmp, cfg) = setup();
        let now = utc(2026, 9, 2, 10, 0);
        let due = utc(2026, 9, 2, 13, 0).fixed_offset();
        let fire_at = utc(2026, 9, 2, 12, 0);
        write_task(
            &cfg,
            "active-collision",
            TaskStatus::Todo,
            Some(DueDate::DateTime(due)),
            vec![Reminder {
                kind: "relative".into(),
                value: "-60m".into(),
            }],
        );
        let conn = create_legacy_state_db(&cfg);
        for (key, definition, state) in [
            ("old-cancelled", "relative:-1h", "cancelled"),
            ("old-pending", "relative:-60m", "pending"),
        ] {
            conn.execute(
                "INSERT INTO reminder_occurrences(
                   occurrence_key, task_id, task_title, fire_at, definition, state,
                   next_attempt_at, updated_at
                 ) VALUES (?1, 'active-collision', 'Active collision', ?2, ?3, ?4, ?2, ?5)",
                params![
                    key,
                    format_time(fire_at),
                    definition,
                    state,
                    format_time(now)
                ],
            )
            .unwrap();
        }
        drop(conn);

        let mut engine = ReminderEngine::open(&cfg.root).unwrap();
        assert!(engine
            .reconcile_and_claim(&cfg.tasks_dir(), now)
            .unwrap()
            .is_empty());
        let key = occurrence_key("active-collision", fire_at);
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Pending)
        );
        let claims = engine
            .reconcile_and_claim(&cfg.tasks_dir(), fire_at)
            .unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].occurrence_key, key);
    }

    #[test]
    fn identity_migration_collisions_preserve_safest_terminal_state_and_sources() {
        let (_tmp, cfg) = setup();
        let fire_at = utc(2026, 9, 2, 12, 0);
        let conn = create_legacy_state_db(&cfg);
        for (key, definition, state, updated_minute) in [
            ("old-pending", "relative:-60m", "pending", 0),
            ("old-cancelled", "relative:-1h", "cancelled", 1),
            (
                "old-expired",
                "absolute:2026-09-02T12:00:00.000Z",
                "expired",
                2,
            ),
            ("old-delivered", "legacy-custom-source", "delivered", 3),
        ] {
            conn.execute(
                "INSERT INTO reminder_occurrences(
                   occurrence_key, task_id, task_title, fire_at, definition, state,
                   attempt_count, claim_generation, next_attempt_at, lease_until, updated_at
                 ) VALUES (?1, 'collision', 'Collision', ?2, ?3, ?4, 2, 4, ?2, ?2, ?5)",
                params![
                    key,
                    format_time(fire_at),
                    definition,
                    state,
                    format_time(fire_at + Duration::minutes(updated_minute)),
                ],
            )
            .unwrap();
        }
        drop(conn);

        let engine = ReminderEngine::open(&cfg.root).unwrap();
        let key = occurrence_key("collision", fire_at);
        assert_eq!(
            engine.occurrence_state(&key).unwrap(),
            Some(OccurrenceState::Delivered)
        );
        let (count, definition, next_attempt, lease): (
            i64,
            String,
            Option<String>,
            Option<String>,
        ) = engine
            .conn
            .query_row(
                "SELECT count(*), definition, next_attempt_at, lease_until
                 FROM reminder_occurrences",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(next_attempt.is_none());
        assert!(lease.is_none());
        let sources: Vec<String> = serde_json::from_str(&definition).unwrap();
        assert_eq!(sources.len(), 4);
    }

    #[test]
    fn identity_migration_is_idempotent_across_repeated_opens() {
        let (_tmp, cfg) = setup();
        let fire_at = utc(2026, 9, 2, 12, 0);
        let conn = create_legacy_state_db(&cfg);
        conn.execute(
            "INSERT INTO reminder_occurrences(
               occurrence_key, task_id, task_title, fire_at, definition, state, updated_at
             ) VALUES ('old-key', 'repeat', 'Repeat', ?1, 'relative:-1h', 'expired', ?1)",
            [format_time(fire_at)],
        )
        .unwrap();
        drop(conn);

        let engine = ReminderEngine::open(&cfg.root).unwrap();
        let snapshot: (String, String, String) = engine
            .conn
            .query_row(
                "SELECT occurrence_key, definition, state FROM reminder_occurrences",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        drop(engine);

        let engine = ReminderEngine::open(&cfg.root).unwrap();
        let reopened: (String, String, String) = engine
            .conn
            .query_row(
                "SELECT occurrence_key, definition, state FROM reminder_occurrences",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(reopened, snapshot);
        assert_eq!(reopened.0, occurrence_key("repeat", fire_at));
        assert_eq!(reopened.2, "expired");
    }
}
