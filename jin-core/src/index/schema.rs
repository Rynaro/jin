//! Private SQLite schema for the derived index.
//! This module is private to jin-core. No consumer may open index.sqlite directly.

use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};

/// Sentinel stored in schema_meta to gate the one-time excerpt-populate rebuild (K1).
/// Bump this value whenever a schema change requires a one-time rebuild.
/// wave3-tasks-v1: adds lists/sections/tags/task_tags tables + 4 new tasks columns (P2).
/// wave3-tasks-v2: S6 — adds the `parent` column to `tasks` (subtasks).
/// calendar-m1-v1: adds explicit flexible agenda placement to tasks.
pub(crate) const SCHEMA_VERSION: &str = "calendar-m1-v1";

pub const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL,
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL,
    deleted_at  TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array
    file_path   TEXT NOT NULL,
    excerpt     TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL DEFAULT ''    -- Wave 2A: relative folder path (/ separated)
);

-- Strict portable properties, derived solely from Note frontmatter.
CREATE TABLE IF NOT EXISTS note_properties (
    note_id     TEXT NOT NULL,
    property_key TEXT NOT NULL,
    value_type  TEXT NOT NULL,
    value_text  TEXT NOT NULL,
    PRIMARY KEY(note_id, property_key)
);

-- Canonical body links. The target ULID is identity; label is presentation.
CREATE TABLE IF NOT EXISTS note_links (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    label     TEXT NOT NULL,
    PRIMARY KEY(source_id, target_id, label)
);

CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL,
    priority     TEXT NOT NULL,
    due          TEXT,                       -- ISO string or null
    list_name    TEXT NOT NULL,
    completed_at TEXT,
    deleted_at   TEXT,
    created      TEXT NOT NULL,
    updated      TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    section_id   TEXT,                       -- P2: section within the list (nullable)
    tags         TEXT NOT NULL DEFAULT '[]', -- P2: JSON array of tag slugs
    position     TEXT NOT NULL DEFAULT '',   -- P2: fractional rank key (base-62)
    reminders    TEXT NOT NULL DEFAULT '[]', -- P2: JSON array of Reminder objects
    parent       TEXT,                     -- S6: parent task id (subtasks); NULL = top-level
    agenda_bucket TEXT                     -- M1: explicit agenda placement; NULL = none
);

CREATE TABLE IF NOT EXISTS events (
    id                    TEXT PRIMARY KEY,
    title                 TEXT NOT NULL,
    description           TEXT,
    location              TEXT,
    start                 TEXT NOT NULL,     -- wall-time NaiveDateTime or NaiveDate string
    end_time              TEXT NOT NULL,
    start_value_type      TEXT NOT NULL,
    end_value_type        TEXT NOT NULL,
    is_all_day            INTEGER NOT NULL DEFAULT 0,
    start_tzid            TEXT,
    end_tzid              TEXT,
    floating              INTEGER NOT NULL DEFAULT 0,
    recurrence            TEXT NOT NULL DEFAULT '[]', -- JSON array
    recurring_event_id    TEXT,
    original_start        TEXT,
    master_id             TEXT,
    recurrence_unexpanded INTEGER NOT NULL DEFAULT 0,
    ical_uid              TEXT,
    sequence              INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL,
    created               TEXT NOT NULL,
    updated               TEXT NOT NULL,
    source                TEXT NOT NULL,
    authority             TEXT NOT NULL,
    calendar_id           TEXT NOT NULL,
    derived_from          TEXT,              -- ULID of originating task
    file_path             TEXT NOT NULL,
    -- Derived: start_utc (index-only, not on disk)
    start_utc             TEXT
);

-- Source-side edges (stored in canonical files, mirrored here for query)
CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    edge_type   TEXT NOT NULL,
    UNIQUE(source_id, target_id, edge_type)
);

-- Backlinks (derived from edges; queryable from target endpoint; never on disk)
CREATE TABLE IF NOT EXISTS backlinks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id   TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    edge_type   TEXT NOT NULL,
    backlink_label TEXT NOT NULL,
    UNIQUE(target_id, source_id, edge_type)
);

-- Dangling edges (target missing or tombstoned at rebuild time)
CREATE TABLE IF NOT EXISTS dangling_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    edge_type   TEXT NOT NULL,
    reason      TEXT NOT NULL
);

-- P2: First-class Lists (§1.2)
CREATE TABLE IF NOT EXISTS lists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    icon        TEXT NOT NULL,
    position    TEXT NOT NULL,
    parent_id   TEXT,
    view        TEXT NOT NULL DEFAULT 'list',
    sort_mode   TEXT NOT NULL DEFAULT 'manual',
    archived_at TEXT,
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL,
    file_path   TEXT NOT NULL
);

-- P2: Sections derived from list.sections[] (§1.4)
CREATE TABLE IF NOT EXISTS sections (
    id       TEXT PRIMARY KEY,
    list_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    position TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sections_list ON sections(list_id);

-- P2: Tag metadata (§1.3)
CREATE TABLE IF NOT EXISTS tags (
    slug      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    color     TEXT NOT NULL,
    file_path TEXT NOT NULL
);

-- P2: Task ↔ Tag join (derived from task frontmatter tags[]) (§1.3)
CREATE TABLE IF NOT EXISTS task_tags (
    task_id  TEXT NOT NULL,
    tag_slug TEXT NOT NULL,
    UNIQUE(task_id, tag_slug)
);

CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_slug);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_backlinks_target ON backlinks(target_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_note_properties_key ON note_properties(property_key);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_id);

-- Derived search material only: canonical Markdown body, portable property
-- text, and internal-link labels. It deliberately excludes executable syntax
-- and may always be discarded/rebuilt.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    body,
    properties,
    link_labels
);
"#;

/// Apply the schema to a connection (idempotent — uses CREATE IF NOT EXISTS).
///
/// Also performs a guarded `ALTER TABLE notes ADD COLUMN excerpt` so that a
/// pre-existing `index.sqlite` created before Wave 1 gets the new column without
/// crashing.  The guard is PRAGMA-based and idempotent (safe to call many times).
pub fn apply(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    // R1 migration guard: add excerpt column to pre-existing index.sqlite.
    // CREATE TABLE IF NOT EXISTS only adds the column to *new* databases.
    if !has_column(conn, "notes", "excerpt")? {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN excerpt TEXT NOT NULL DEFAULT ''")?;
    }
    // Wave 2A migration guard: add folder_path column to pre-existing index.sqlite.
    if !has_column(conn, "notes", "folder_path")? {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''")?;
    }
    // P2 migration guards: add 4 new columns to the tasks table.
    // CREATE TABLE IF NOT EXISTS will NOT add these to a pre-existing tasks table,
    // so each column gets a guarded ALTER TABLE (§1.0 of the spec).
    if !has_column(conn, "tasks", "section_id")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN section_id TEXT")?;
    }
    if !has_column(conn, "tasks", "tags")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")?;
    }
    if !has_column(conn, "tasks", "position")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN position TEXT NOT NULL DEFAULT ''")?;
    }
    if !has_column(conn, "tasks", "reminders")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]'")?;
    }
    // S6 migration guard: add the `parent` column to a pre-existing tasks table
    // (CREATE TABLE IF NOT EXISTS only adds it to *new* databases). SCHEMA_VERSION
    // is also bumped (wave3-tasks-v1 -> wave3-tasks-v2) so a stale index rebuilds.
    if !has_column(conn, "tasks", "parent")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN parent TEXT")?;
    }
    if !has_column(conn, "tasks", "agenda_bucket")? {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN agenda_bucket TEXT")?;
    }
    Ok(())
}

/// Returns `true` when the stored schema_version sentinel matches SCHEMA_VERSION.
/// Missing sentinel → `false` (first run or pre-K1 install).
pub(crate) fn is_current_version(conn: &Connection) -> SqlResult<bool> {
    let ver: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(ver.as_deref() == Some(SCHEMA_VERSION))
}

/// Persist the SCHEMA_VERSION sentinel into schema_meta.
pub(crate) fn set_version(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?1)",
        params![SCHEMA_VERSION],
    )?;
    Ok(())
}

/// Return `true` when `column` exists on `table` (PRAGMA table_info).
fn has_column(conn: &Connection, table: &str, column: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names.iter().any(|n| n == column))
}

/// Derive the backlink label for a given edge type (target-side display).
pub fn backlink_label(edge_type: &str) -> &'static str {
    match edge_type {
        "derived-from" => "has-event",
        "prep-for" => "prep-notes",
        "references" => "referenced-by",
        _ => "related",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// VG2.3 — Migration safety: an index WITHOUT the excerpt column opens,
    /// apply() adds the column, and list queries succeed without crashing.
    #[test]
    fn vg2_3_migration_adds_excerpt_to_old_schema() {
        let conn = Connection::open_in_memory().unwrap();

        // Simulate an old schema (no excerpt column).
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                id         TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                status     TEXT NOT NULL,
                created    TEXT NOT NULL,
                updated    TEXT NOT NULL,
                deleted_at TEXT,
                tags       TEXT NOT NULL DEFAULT '[]',
                file_path  TEXT NOT NULL
            );
            "#,
        )
        .unwrap();

        // Insert an existing note row WITHOUT excerpt.
        conn.execute(
            "INSERT INTO notes (id, title, status, created, updated, tags, file_path) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "note-legacy",
                "Legacy Note",
                "active",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
                "[]",
                "/tmp/legacy.md",
            ],
        )
        .unwrap();

        // Apply new schema — must not panic or error.
        apply(&conn).unwrap();

        // excerpt column must now exist.
        assert!(has_column(&conn, "notes", "excerpt").unwrap());

        // Existing row must have the default empty excerpt.
        let excerpt: String = conn
            .query_row(
                "SELECT excerpt FROM notes WHERE id = 'note-legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(excerpt, "", "legacy row must have default empty excerpt");
    }

    /// VG2.3 corollary — apply() is idempotent: calling twice must not fail.
    #[test]
    fn vg2_3_apply_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();
        apply(&conn).unwrap(); // must not error (duplicate ALTER guard fires)
    }

    /// VG-MIG — Wave 2A: an index at wave1-v1 (has excerpt, no folder_path) is migrated.
    /// apply() adds folder_path column; pre-existing notes default to ''; idempotent.
    #[test]
    fn vg_mig_wave2_adds_folder_path_to_old_schema() {
        let conn = Connection::open_in_memory().unwrap();

        // Simulate a wave1-v1 schema (has excerpt, no folder_path).
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                id         TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                status     TEXT NOT NULL,
                created    TEXT NOT NULL,
                updated    TEXT NOT NULL,
                deleted_at TEXT,
                tags       TEXT NOT NULL DEFAULT '[]',
                file_path  TEXT NOT NULL,
                excerpt    TEXT NOT NULL DEFAULT ''
            );
            "#,
        )
        .unwrap();

        // Insert an existing note row (wave1 style: no folder_path column).
        conn.execute(
            "INSERT INTO notes (id, title, status, created, updated, tags, file_path, excerpt) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                "wave1-note",
                "Old Note",
                "active",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
                "[]",
                "/tmp/old.md",
                "some excerpt",
            ],
        )
        .unwrap();

        // Apply new schema — must not panic or error.
        apply(&conn).unwrap();

        // folder_path column must now exist.
        assert!(has_column(&conn, "notes", "folder_path").unwrap());

        // Existing row must have the default empty folder_path.
        let folder_path: String = conn
            .query_row(
                "SELECT folder_path FROM notes WHERE id = 'wave1-note'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            folder_path, "",
            "legacy row must have default empty folder_path"
        );

        // Idempotent: applying again must not error.
        apply(&conn).unwrap();
    }

    /// K1 sentinel: is_current_version / set_version round-trip.
    #[test]
    fn schema_version_sentinel_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();

        assert!(
            !is_current_version(&conn).unwrap(),
            "version absent → false"
        );
        set_version(&conn).unwrap();
        assert!(is_current_version(&conn).unwrap(), "version set → true");
    }

    /// G-ALTER (VG-P2): a pre-existing `tasks` table WITHOUT the 4 new P2 columns
    /// must gain all four columns after `apply()`, with correct defaults, and
    /// `apply()` must be idempotent on a second call.
    #[test]
    fn vg_p2_alter_adds_new_tasks_columns_to_old_schema() {
        let conn = Connection::open_in_memory().unwrap();

        // Simulate a wave2-v1 schema: tasks table has NO P2 columns.
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                created TEXT NOT NULL, updated TEXT NOT NULL, deleted_at TEXT,
                tags TEXT NOT NULL DEFAULT '[]', file_path TEXT NOT NULL,
                excerpt TEXT NOT NULL DEFAULT '', folder_path TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                priority TEXT NOT NULL, due TEXT, list_name TEXT NOT NULL,
                completed_at TEXT, deleted_at TEXT,
                created TEXT NOT NULL, updated TEXT NOT NULL, file_path TEXT NOT NULL
            );
            "#,
        )
        .unwrap();

        // Insert a legacy task row — no P2 columns present.
        conn.execute(
            "INSERT INTO tasks (id, title, status, priority, list_name, created, updated, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "LEGACY01",
                "Legacy Task",
                "todo",
                "none",
                "inbox",
                "2026-01-01T00:00:00+00:00",
                "2026-01-01T00:00:00+00:00",
                "/tmp/legacy.md",
            ],
        )
        .unwrap();

        // apply() must not panic or error.
        apply(&conn).unwrap();

        // All 4 new columns must now exist.
        assert!(
            has_column(&conn, "tasks", "section_id").unwrap(),
            "section_id must exist"
        );
        assert!(
            has_column(&conn, "tasks", "tags").unwrap(),
            "tags must exist"
        );
        assert!(
            has_column(&conn, "tasks", "position").unwrap(),
            "position must exist"
        );
        assert!(
            has_column(&conn, "tasks", "reminders").unwrap(),
            "reminders must exist"
        );

        // Legacy row must have the correct defaults for the new columns.
        let (section_id, tags, position, reminders): (Option<String>, String, String, String) =
            conn.query_row(
                "SELECT section_id, tags, position, reminders FROM tasks WHERE id = 'LEGACY01'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert!(section_id.is_none(), "section_id default must be NULL");
        assert_eq!(tags, "[]", "tags default must be empty JSON array");
        assert_eq!(position, "", "position default must be empty string");
        assert_eq!(
            reminders, "[]",
            "reminders default must be empty JSON array"
        );

        // Second apply() call must be idempotent (no error).
        apply(&conn).unwrap();

        // Columns still present after second apply.
        assert!(has_column(&conn, "tasks", "section_id").unwrap());
        assert!(has_column(&conn, "tasks", "tags").unwrap());
        assert!(has_column(&conn, "tasks", "position").unwrap());
        assert!(has_column(&conn, "tasks", "reminders").unwrap());
    }

    /// S6 G-ALTER: a pre-existing `tasks` table WITHOUT `parent` (i.e. a
    /// wave3-tasks-v1 index) must gain the column after `apply()`, defaulting
    /// existing rows to NULL, and `apply()` stays idempotent on a second call.
    /// This is the index half of the S6 projection chain (Approach §6 / the
    /// spec's "THE PROJECTION TRAP") — without this guard a stale index never
    /// rebuilds and `parent` stays `NULL` forever on every read path.
    #[test]
    fn s6_alter_adds_parent_column_to_old_schema() {
        let conn = Connection::open_in_memory().unwrap();

        // Simulate a wave3-tasks-v1 schema: tasks table has the P2 columns but NOT `parent`.
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                created TEXT NOT NULL, updated TEXT NOT NULL, deleted_at TEXT,
                tags TEXT NOT NULL DEFAULT '[]', file_path TEXT NOT NULL,
                excerpt TEXT NOT NULL DEFAULT '', folder_path TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                priority TEXT NOT NULL, due TEXT, list_name TEXT NOT NULL,
                completed_at TEXT, deleted_at TEXT,
                created TEXT NOT NULL, updated TEXT NOT NULL, file_path TEXT NOT NULL,
                section_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
                position TEXT NOT NULL DEFAULT '', reminders TEXT NOT NULL DEFAULT '[]'
            );
            "#,
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tasks (id, title, status, priority, list_name, created, updated, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "LEGACY03",
                "Pre-S6 Task",
                "todo",
                "none",
                "inbox",
                "2026-01-01T00:00:00+00:00",
                "2026-01-01T00:00:00+00:00",
                "/tmp/legacy3.md",
            ],
        )
        .unwrap();

        apply(&conn).unwrap();

        assert!(
            has_column(&conn, "tasks", "parent").unwrap(),
            "parent must exist"
        );

        let parent: Option<String> = conn
            .query_row("SELECT parent FROM tasks WHERE id = 'LEGACY03'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(
            parent.is_none(),
            "parent default must be NULL for a pre-existing row"
        );

        // Idempotent: applying again must not error.
        apply(&conn).unwrap();
        assert!(has_column(&conn, "tasks", "parent").unwrap());
    }

    #[test]
    fn calendar_m1_adds_agenda_bucket_to_old_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                priority TEXT NOT NULL, due TEXT, list_name TEXT NOT NULL,
                completed_at TEXT, deleted_at TEXT, created TEXT NOT NULL,
                updated TEXT NOT NULL, file_path TEXT NOT NULL, section_id TEXT,
                tags TEXT NOT NULL DEFAULT '[]', position TEXT NOT NULL DEFAULT '',
                reminders TEXT NOT NULL DEFAULT '[]', parent TEXT
             );",
        )
        .unwrap();
        apply(&conn).unwrap();
        assert!(has_column(&conn, "tasks", "agenda_bucket").unwrap());
        let value: Option<String> = conn
            .query_row("SELECT agenda_bucket FROM tasks LIMIT 1", [], |row| {
                row.get(0)
            })
            .optional()
            .unwrap()
            .flatten();
        assert!(value.is_none());
        apply(&conn).unwrap();
    }

    /// G-ALTER (VG-P2): new tables (lists, sections, tags, task_tags) are created by apply().
    #[test]
    fn vg_p2_new_tables_created_by_apply() {
        let conn = Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();

        // Verify all 4 new tables exist by inserting and querying each.
        conn.execute_batch(
            "INSERT INTO lists (id, name, color, icon, position, created, updated, file_path)
             VALUES ('inbox', 'Inbox', 'accent', 'inbox', 'V', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', '/tmp/inbox.md');
             INSERT INTO sections (id, list_id, name, position) VALUES ('s1', 'inbox', 'Backlog', 'V');
             INSERT INTO tags (slug, name, color, file_path) VALUES ('work', 'Work', 'sky', '/tmp/work.md');
             INSERT INTO task_tags (task_id, tag_slug) VALUES ('t1', 'work');",
        )
        .unwrap();

        let list_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM lists", [], |r| r.get(0))
            .unwrap();
        let section_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get(0))
            .unwrap();
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .unwrap();
        let task_tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();

        assert_eq!(list_count, 1, "lists table must be created and hold rows");
        assert_eq!(
            section_count, 1,
            "sections table must be created and hold rows"
        );
        assert_eq!(tag_count, 1, "tags table must be created and hold rows");
        assert_eq!(
            task_tag_count, 1,
            "task_tags table must be created and hold rows"
        );
    }
}
