//! Query helpers — all data access goes through these functions; never raw SQL
//! from outside jin-core. All types here are pub(crate): consumers use the DTO
//! layer via ops::api, never these rows directly.

use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

/// A summary row for notes (returned by list/show operations).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct NoteRow {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) created: String,
    pub(crate) updated: String,
    pub(crate) deleted_at: Option<String>,
    pub(crate) tags: String, // JSON array string
    pub(crate) file_path: String,
    pub(crate) excerpt: String,
    /// Wave 2A: relative folder path (/ separated); "" = root "Notes" folder.
    pub(crate) folder_path: String,
}

/// A summary row for tasks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskRow {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) due: Option<String>,
    pub(crate) list_name: String,
    pub(crate) completed_at: Option<String>,
    pub(crate) deleted_at: Option<String>,
    pub(crate) created: String,
    pub(crate) updated: String,
    pub(crate) file_path: String,
    // P2 fields
    pub(crate) section_id: Option<String>,
    pub(crate) tags: String, // JSON array string
    pub(crate) position: String,
    pub(crate) reminders: String, // JSON array string
    /// S6 — parent task id (subtasks); `None` = top-level task.
    pub(crate) parent: Option<String>,
    pub(crate) agenda_bucket: Option<String>,
}

/// A summary row for lists (P2 — used by rebuild; full query surface in P3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)] // Will be used in P3 list query surface.
pub(crate) struct ListRow {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: String,
    pub(crate) icon: String,
    pub(crate) position: String,
    pub(crate) parent_id: Option<String>,
    pub(crate) view: String,
    pub(crate) sort_mode: String,
    pub(crate) archived_at: Option<String>,
    pub(crate) created: String,
    pub(crate) updated: String,
    pub(crate) file_path: String,
}

/// A summary row for tags (P2 — used by rebuild; full query surface in P4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)] // Will be used in P4 tag query surface.
pub(crate) struct TagRow {
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) color: String,
    pub(crate) file_path: String,
}

/// A summary row for events (M3: all RFC-5545 fields present).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct EventRow {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) start: String,
    pub(crate) end_time: String,
    pub(crate) is_all_day: bool,
    pub(crate) start_tzid: Option<String>,
    pub(crate) end_tzid: Option<String>,
    pub(crate) floating: bool,
    pub(crate) ical_uid: Option<String>,
    pub(crate) created: String,
    pub(crate) updated: String,
    pub(crate) source: String,
    pub(crate) authority: String,
    pub(crate) derived_from: Option<String>,
    pub(crate) recurrence_unexpanded: bool,
    pub(crate) file_path: String,
}

/// A backlink row (target-side view).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct BacklinkRow {
    pub(crate) source_id: String,
    pub(crate) source_kind: String,
    pub(crate) edge_type: String,
    pub(crate) backlink_label: String,
}

/// A dangling edge row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct DanglingEdgeRow {
    pub(crate) source_id: String,
    pub(crate) source_kind: String,
    pub(crate) target_id: String,
    pub(crate) edge_type: String,
    pub(crate) reason: String,
}

fn map_note_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok(NoteRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        created: row.get(3)?,
        updated: row.get(4)?,
        deleted_at: row.get(5)?,
        tags: row.get(6)?,
        file_path: row.get(7)?,
        excerpt: row.get(8)?,
        folder_path: row.get(9)?,
    })
}

pub(crate) fn list_notes(
    conn: &Connection,
    include_deleted: bool,
    folder_filter: Option<&str>,
) -> SqlResult<Vec<NoteRow>> {
    let mut conditions: Vec<String> = Vec::new();
    if !include_deleted {
        conditions.push("status != 'deleted'".to_string());
    }
    if let Some(folder) = folder_filter {
        // SQL-level exact match on the folder_path column (D-FILTER).
        // We use a positional param to avoid SQL injection.
        let _ = folder; // used below via dynamic SQL
        conditions.push("folder_path = ?1".to_string());
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!(
        "SELECT id, title, status, created, updated, deleted_at, tags, file_path, excerpt, folder_path \
         FROM notes {} ORDER BY id ASC",
        where_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(folder) = folder_filter {
        stmt.query_map(params![folder], map_note_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map([], map_note_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(rows)
}

/// List notes, optionally filtering by tag (post-fetch) and/or folder (SQL-level).
///
/// Tags are stored as a JSON array string; filtering is done after loading
/// so we don't rely on SQLite JSON functions.
/// Folder filter is SQL-level exact match (D-FILTER).
pub(crate) fn list_notes_by_tag(
    conn: &Connection,
    include_deleted: bool,
    tag_filter: Option<&str>,
    folder_filter: Option<&str>,
) -> SqlResult<Vec<NoteRow>> {
    let all = list_notes(conn, include_deleted, folder_filter)?;
    if let Some(tag) = tag_filter {
        Ok(all
            .into_iter()
            .filter(|row| {
                let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
                tags.iter().any(|t| t == tag)
            })
            .collect())
    } else {
        Ok(all)
    }
}

/// Return folder counts: (folder_path, count) for non-deleted notes.
/// Used by `api::list_folders` to populate note_count in FolderDto.
pub(crate) fn folder_counts(conn: &Connection) -> SqlResult<Vec<(String, usize)>> {
    let mut stmt = conn.prepare(
        "SELECT folder_path, COUNT(*) FROM notes WHERE status != 'deleted' GROUP BY folder_path",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
    })?;
    rows.collect()
}

pub(crate) fn get_note(conn: &Connection, id: &str) -> SqlResult<Option<NoteRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, status, created, updated, deleted_at, tags, file_path, excerpt, folder_path \
         FROM notes WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_note_row)?;
    rows.next().transpose()
}

/// Search only the deterministic, derived FTS projection (body, strict
/// properties, and canonical-link labels). The input is quoted as one literal
/// phrase so callers cannot supply FTS operators or alter query semantics.
pub(crate) fn search_notes(conn: &Connection, text: &str) -> SqlResult<Vec<NoteRow>> {
    let phrase = format!("\"{}\"", text.replace('"', "\"\""));
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.status, n.created, n.updated, n.deleted_at,
                n.tags, n.file_path, n.excerpt, n.folder_path
         FROM notes_fts f
         JOIN notes n ON n.id = f.note_id
         WHERE notes_fts MATCH ?1 AND n.status != 'deleted'
         ORDER BY n.updated DESC, n.id ASC",
    )?;
    let rows = stmt
        .query_map(params![phrase], map_note_row)?
        .collect::<SqlResult<Vec<_>>>()?;
    Ok(rows)
}

/// List tasks with optional filters. `tag_filter` is applied as a post-fetch filter
/// (consistent with `list_notes_by_tag`; tags are stored as a JSON array in the row).
pub(crate) fn list_tasks_by_tag(
    conn: &Connection,
    list_filter: Option<&str>,
    status_filter: Option<&str>,
    priority_filter: Option<&str>,
    tag_filter: Option<&str>,
    include_deleted: bool,
) -> SqlResult<Vec<TaskRow>> {
    let all = list_tasks(
        conn,
        list_filter,
        status_filter,
        priority_filter,
        include_deleted,
    )?;
    if let Some(tag) = tag_filter {
        Ok(all
            .into_iter()
            .filter(|row| {
                let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
                tags.iter().any(|t| t == tag)
            })
            .collect())
    } else {
        Ok(all)
    }
}

pub(crate) fn list_tasks(
    conn: &Connection,
    list_filter: Option<&str>,
    status_filter: Option<&str>,
    priority_filter: Option<&str>,
    include_deleted: bool,
) -> SqlResult<Vec<TaskRow>> {
    let mut conditions = vec![];
    if !include_deleted {
        conditions.push("status != 'deleted'".to_string());
    }
    if let Some(lf) = list_filter {
        conditions.push(format!("list_name = '{}'", lf.replace('\'', "''")));
    }
    if let Some(sf) = status_filter {
        conditions.push(format!("status = '{}'", sf.replace('\'', "''")));
    }
    if let Some(pf) = priority_filter {
        conditions.push(format!("priority = '{}'", pf.replace('\'', "''")));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!(
        "SELECT id, title, status, priority, due, list_name, completed_at, deleted_at, \
         created, updated, file_path, section_id, tags, position, reminders, parent, agenda_bucket \
         FROM tasks {} ORDER BY id ASC",
        where_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            priority: row.get(3)?,
            due: row.get(4)?,
            list_name: row.get(5)?,
            completed_at: row.get(6)?,
            deleted_at: row.get(7)?,
            created: row.get(8)?,
            updated: row.get(9)?,
            file_path: row.get(10)?,
            section_id: row.get(11)?,
            tags: row
                .get::<_, Option<String>>(12)?
                .unwrap_or_else(|| "[]".to_string()),
            position: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
            reminders: row
                .get::<_, Option<String>>(14)?
                .unwrap_or_else(|| "[]".to_string()),
            parent: row.get(15)?,
            agenda_bucket: row.get(16)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn get_task(conn: &Connection, id: &str) -> SqlResult<Option<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, status, priority, due, list_name, completed_at, deleted_at, \
         created, updated, file_path, section_id, tags, position, reminders, parent, agenda_bucket \
         FROM tasks WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            priority: row.get(3)?,
            due: row.get(4)?,
            list_name: row.get(5)?,
            completed_at: row.get(6)?,
            deleted_at: row.get(7)?,
            created: row.get(8)?,
            updated: row.get(9)?,
            file_path: row.get(10)?,
            section_id: row.get(11)?,
            tags: row
                .get::<_, Option<String>>(12)?
                .unwrap_or_else(|| "[]".to_string()),
            position: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
            reminders: row
                .get::<_, Option<String>>(14)?
                .unwrap_or_else(|| "[]".to_string()),
            parent: row.get(15)?,
            agenda_bucket: row.get(16)?,
        })
    })?;
    rows.next().transpose()
}

/// Explicit flexible work only. Unknown and inactive statuses fail closed.
pub(crate) fn list_flexible_tasks(conn: &Connection) -> SqlResult<Vec<TaskRow>> {
    let all = list_tasks(conn, None, None, None, true)?;
    Ok(all
        .into_iter()
        .filter(|row| {
            row.agenda_bucket.as_deref() == Some("flexible")
                && matches!(row.status.as_str(), "todo" | "doing")
        })
        .collect())
}

/// List all lists from the index.
/// Full list/section query surface is in P3; this helper is for rebuild verification.
#[allow(dead_code)] // Will be used in P3 list commands.
pub(crate) fn list_lists(conn: &Connection) -> SqlResult<Vec<ListRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, icon, position, parent_id, view, sort_mode, \
         archived_at, created, updated, file_path FROM lists ORDER BY position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ListRow {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            icon: row.get(3)?,
            position: row.get(4)?,
            parent_id: row.get(5)?,
            view: row.get(6)?,
            sort_mode: row.get(7)?,
            archived_at: row.get(8)?,
            created: row.get(9)?,
            updated: row.get(10)?,
            file_path: row.get(11)?,
        })
    })?;
    rows.collect()
}

/// List all tags from the index.
#[allow(dead_code)] // Will be used in P4 tag commands.
pub(crate) fn list_tags(conn: &Connection) -> SqlResult<Vec<TagRow>> {
    let mut stmt =
        conn.prepare("SELECT slug, name, color, file_path FROM tags ORDER BY slug ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(TagRow {
            slug: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            file_path: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Count task_tags rows for a given tag slug.
#[allow(dead_code)] // Used from rebuild tests; will be used in P4.
pub(crate) fn count_task_tags(conn: &Connection, tag_slug: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM task_tags WHERE tag_slug = ?1",
        params![tag_slug],
        |r| r.get(0),
    )
}

/// Count non-deleted tasks that carry a given tag (via task_tags join).
/// Used by list_tags (P4) for the task_count field.
pub(crate) fn count_non_deleted_tasks_for_tag(conn: &Connection, tag_slug: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM task_tags tt \
         JOIN tasks t ON t.id = tt.task_id \
         WHERE tt.tag_slug = ?1 AND t.status != 'deleted'",
        params![tag_slug],
        |r| r.get(0),
    )
}

/// Count non-deleted tasks in a given list.
/// Used by list_lists (P3) for the task_count field.
pub(crate) fn count_tasks_for_list(conn: &Connection, list_id: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE list_name = ?1 AND status != 'deleted'",
        params![list_id],
        |r| r.get(0),
    )
}

/// Count sections for a given list id.
#[allow(dead_code)] // Used from rebuild tests; will be used in P3/P5.
pub(crate) fn count_sections(conn: &Connection, list_id: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM sections WHERE list_id = ?1",
        params![list_id],
        |r| r.get(0),
    )
}

/// Build the SELECT column list for events — shared by list and get.
const EVENT_COLS: &str =
    "id, title, status, start, end_time, is_all_day, start_tzid, end_tzid, floating, ical_uid,
     created, updated, source, authority, derived_from, recurrence_unexpanded, file_path";

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventRow> {
    Ok(EventRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        start: row.get(3)?,
        end_time: row.get(4)?,
        is_all_day: row.get::<_, i32>(5)? != 0,
        start_tzid: row.get(6)?,
        end_tzid: row.get(7)?,
        floating: row.get::<_, i32>(8)? != 0,
        ical_uid: row.get(9)?,
        created: row.get(10)?,
        updated: row.get(11)?,
        source: row.get(12)?,
        authority: row.get(13)?,
        derived_from: row.get(14)?,
        recurrence_unexpanded: row.get::<_, i32>(15)? != 0,
        file_path: row.get(16)?,
    })
}

pub(crate) fn list_events(conn: &Connection, include_deleted: bool) -> SqlResult<Vec<EventRow>> {
    let sql = if include_deleted {
        format!("SELECT {} FROM events ORDER BY id ASC", EVENT_COLS)
    } else {
        format!(
            "SELECT {} FROM events WHERE status != 'cancelled' ORDER BY id ASC",
            EVENT_COLS
        )
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_event)?;
    rows.collect()
}

pub(crate) fn get_event(conn: &Connection, id: &str) -> SqlResult<Option<EventRow>> {
    let sql = format!("SELECT {} FROM events WHERE id = ?1", EVENT_COLS);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], row_to_event)?;
    rows.next().transpose()
}

pub(crate) fn get_backlinks(conn: &Connection, target_id: &str) -> SqlResult<Vec<BacklinkRow>> {
    let mut stmt = conn.prepare(
        "SELECT source_id, source_kind, edge_type, backlink_label
         FROM backlinks WHERE target_id = ?1 ORDER BY source_id ASC",
    )?;
    let rows = stmt.query_map(params![target_id], |row| {
        Ok(BacklinkRow {
            source_id: row.get(0)?,
            source_kind: row.get(1)?,
            edge_type: row.get(2)?,
            backlink_label: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn list_dangling_edges(conn: &Connection) -> SqlResult<Vec<DanglingEdgeRow>> {
    let mut stmt = conn.prepare(
        "SELECT source_id, source_kind, target_id, edge_type, reason
         FROM dangling_edges ORDER BY source_id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DanglingEdgeRow {
            source_id: row.get(0)?,
            source_kind: row.get(1)?,
            target_id: row.get(2)?,
            edge_type: row.get(3)?,
            reason: row.get(4)?,
        })
    })?;
    rows.collect()
}
