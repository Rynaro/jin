//! Pure deterministic rebuild of the index from canonical files.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::model::event::{render_temporal, TemporalValue};
use crate::model::{parse_canonical_links, PropertyValue};
use crate::store::fs;
use crate::{JinError, Result};

use super::schema;

/// Rebuild the entire index from `root`. Wipes and repopulates all tables.
pub fn rebuild(conn: &mut Connection, root: &Path) -> Result<Vec<JinError>> {
    let notes_dir = root.join("notes");
    let tasks_dir = root.join("tasks");
    let events_dir = root.join("events");
    let lists_dir = root.join("lists");
    let tags_dir = root.join("tags");
    // Rebuild is best-effort for independent canonical files, but malformed
    // frontmatter—including invalid strict property types—must be surfaced as
    // diagnostics instead of silently disappearing from the derived index.
    let mut diagnostics = Vec::new();

    let tx = conn.transaction().map_err(JinError::Index)?;

    // 1. Clear derived tables (including new P2 tables)
    tx.execute_batch(
        "DELETE FROM backlinks;
         DELETE FROM dangling_edges;
         DELETE FROM edges;
         DELETE FROM note_links;
         DELETE FROM note_properties;
         DELETE FROM notes_fts;
         DELETE FROM events;
         DELETE FROM task_tags;
         DELETE FROM tasks;
         DELETE FROM sections;
         DELETE FROM lists;
         DELETE FROM tags;
         DELETE FROM notes;",
    )
    .map_err(JinError::Index)?;

    // --- Insert lists + sections ---
    let list_paths = fs::list_list_paths(&lists_dir).unwrap_or_default();
    for path in &list_paths {
        if let Ok(list) = fs::read_list(path) {
            let fm = &list.frontmatter;
            tx.execute(
                "INSERT OR REPLACE INTO lists
                 (id, name, color, icon, position, parent_id, view, sort_mode,
                  archived_at, created, updated, file_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    fm.id,
                    fm.name,
                    fm.color,
                    fm.icon,
                    fm.position,
                    fm.parent_id,
                    fm.view,
                    fm.sort_mode,
                    fm.archived_at.map(|d| d.to_rfc3339()),
                    fm.created.to_rfc3339(),
                    fm.updated.to_rfc3339(),
                    path.to_string_lossy().as_ref(),
                ],
            )
            .map_err(JinError::Index)?;

            for section in &fm.sections {
                tx.execute(
                    "INSERT OR REPLACE INTO sections (id, list_id, name, position)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![section.id, fm.id, section.name, section.position],
                )
                .map_err(JinError::Index)?;
            }
        }
    }

    // --- Insert tags ---
    let tag_paths = fs::list_tag_paths(&tags_dir).unwrap_or_default();
    for path in &tag_paths {
        if let Ok(tag) = fs::read_tag(path) {
            let fm = &tag.frontmatter;
            tx.execute(
                "INSERT OR REPLACE INTO tags (slug, name, color, file_path)
                 VALUES (?1, ?2, ?3, ?4)",
                params![fm.slug, fm.name, fm.color, path.to_string_lossy().as_ref(),],
            )
            .map_err(JinError::Index)?;
        }
    }

    // --- Insert notes ---
    let note_paths = fs::list_note_paths(&notes_dir).unwrap_or_default();
    for path in &note_paths {
        let note = match fs::read_note(path) {
            Ok(note) => note,
            Err(err) => {
                diagnostics.push(JinError::Integrity(format!(
                    "note {} was skipped during rebuild: {err}",
                    path.display()
                )));
                continue;
            }
        };
        let tags_json =
            serde_json::to_string(&note.frontmatter.tags).unwrap_or_else(|_| "[]".to_string());
        let excerpt = derive_excerpt(&note.body);
        // Wave 2A: derive folder_path from the file's location under notes_dir.
        let folder_path = fs::folder_path_of(&notes_dir, path);
        tx.execute(
                "INSERT OR REPLACE INTO notes
                 (id, title, status, created, updated, deleted_at, tags, file_path, excerpt, folder_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    note.frontmatter.id,
                    note.frontmatter.title,
                    note.frontmatter.status.to_string(),
                    note.frontmatter.created.to_rfc3339(),
                    note.frontmatter.updated.to_rfc3339(),
                    note.frontmatter.deleted_at.map(|d| d.to_rfc3339()),
                    tags_json,
                    path.to_string_lossy().as_ref(),
                    excerpt,
                    folder_path,
                ],
        )
        .map_err(JinError::Index)?;

        let mut property_search = Vec::new();
        for (key, value) in &note.frontmatter.properties {
            let value_text = property_value_text(value);
            property_search.push(format!("{key}: {value_text}"));
            tx.execute(
                "INSERT INTO note_properties (note_id, property_key, value_type, value_text)
                     VALUES (?1, ?2, ?3, ?4)",
                params![note.frontmatter.id, key, value.kind(), value_text,],
            )
            .map_err(JinError::Index)?;
        }

        let canonical_links = parse_canonical_links(&note.body);
        let link_labels = canonical_links
            .iter()
            .map(|link| link.label.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        tx.execute(
            "INSERT INTO notes_fts (note_id, body, properties, link_labels)
                 VALUES (?1, ?2, ?3, ?4)",
            params![
                note.frontmatter.id,
                note.body,
                property_search.join(" "),
                link_labels,
            ],
        )
        .map_err(JinError::Index)?;
    }

    // --- Insert tasks ---
    let task_paths = fs::list_task_paths(&tasks_dir).unwrap_or_default();
    for path in &task_paths {
        if let Ok(task) = fs::read_task(path) {
            let due_str = task.frontmatter.due.as_ref().map(|d| match d {
                crate::model::DueDate::Date(nd) => nd.to_string(),
                crate::model::DueDate::DateTime(dt) => dt.to_rfc3339(),
            });
            let tags_json =
                serde_json::to_string(&task.frontmatter.tags).unwrap_or_else(|_| "[]".to_string());
            let reminders_json = serde_json::to_string(&task.frontmatter.reminders)
                .unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT OR REPLACE INTO tasks
                 (id, title, status, priority, due, list_name, completed_at, deleted_at,
                  created, updated, file_path, section_id, tags, position, reminders, parent,
                  agenda_bucket)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    task.frontmatter.id,
                    task.frontmatter.title,
                    task.frontmatter.status.to_string(),
                    task.frontmatter.priority.to_string(),
                    due_str,
                    task.frontmatter.list,
                    task.frontmatter.completed_at.map(|d| d.to_rfc3339()),
                    task.frontmatter.deleted_at.map(|d| d.to_rfc3339()),
                    task.frontmatter.created.to_rfc3339(),
                    task.frontmatter.updated.to_rfc3339(),
                    path.to_string_lossy().as_ref(),
                    task.frontmatter.section_id,
                    tags_json,
                    task.frontmatter.position,
                    reminders_json,
                    task.frontmatter.parent,
                    task.frontmatter.agenda_bucket.as_ref().map(|_| "flexible"),
                ],
            )
            .map_err(JinError::Index)?;

            // Fan out task_tags: one row per tag slug.
            for slug in &task.frontmatter.tags {
                tx.execute(
                    "INSERT OR IGNORE INTO task_tags (task_id, tag_slug) VALUES (?1, ?2)",
                    params![task.frontmatter.id, slug],
                )
                .map_err(JinError::Index)?;
            }
        }
    }

    // --- Insert events ---
    let event_paths = fs::list_event_paths(&events_dir).unwrap_or_default();
    for path in &event_paths {
        if let Ok(event) = fs::read_event(path) {
            let fm = &event.frontmatter;
            let recurrence_json =
                serde_json::to_string(&fm.recurrence).unwrap_or_else(|_| "[]".to_string());
            let start_str = render_temporal(&fm.start);
            let end_str = render_temporal(&fm.end);
            let orig_start_str = fm.original_start.as_ref().map(render_temporal);

            // S5 (VG9): Compute start_utc for timed, non-floating events with a tzid.
            // All-day events (NaiveDate) and floating events have no UTC anchor.
            let start_utc: Option<String> = if !fm.is_all_day && !fm.floating {
                if let (Some(ref tzid), TemporalValue::DateTime(nd)) = (&fm.start_tzid, &fm.start) {
                    // resolve_to_utc applies the documented DST policy; errors are silently
                    // dropped here (e.g. truly bad tzid that slipped past validation).
                    crate::time::resolve_to_utc(*nd, tzid)
                        .ok()
                        .map(|r| r.utc().to_rfc3339())
                } else {
                    None
                }
            } else {
                None
            };

            tx.execute(
                "INSERT OR REPLACE INTO events
                 (id, title, description, location, start, end_time,
                  start_value_type, end_value_type, is_all_day,
                  start_tzid, end_tzid, floating,
                  recurrence, recurring_event_id, original_start, master_id,
                  recurrence_unexpanded, ical_uid, sequence, status,
                  created, updated, source, authority, calendar_id,
                  derived_from, file_path, start_utc)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28)",
                params![
                    fm.id,
                    fm.title,
                    fm.description,
                    fm.location,
                    start_str,
                    end_str,
                    value_type_str(&fm.start_value_type),
                    value_type_str(&fm.end_value_type),
                    fm.is_all_day as i32,
                    fm.start_tzid,
                    fm.end_tzid,
                    fm.floating as i32,
                    recurrence_json,
                    fm.recurring_event_id,
                    orig_start_str,
                    fm.master_id,
                    fm.recurrence_unexpanded as i32,
                    fm.ical_uid,
                    fm.sequence,
                    fm.status.to_string(),
                    fm.created.to_rfc3339(),
                    fm.updated.to_rfc3339(),
                    fm.source.to_string(),
                    fm.authority.to_string(),
                    fm.calendar_id,
                    fm.derived_from,
                    path.to_string_lossy().as_ref(),
                    start_utc,
                ],
            )
            .map_err(JinError::Index)?;
        }
    }

    // --- Build edges: Note links[] → edges ---
    for path in &note_paths {
        if let Ok(note) = fs::read_note(path) {
            for link in &note.frontmatter.links {
                tx.execute(
                    "INSERT OR IGNORE INTO edges (source_id, source_kind, target_id, target_kind, edge_type)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        note.frontmatter.id,
                        "note",
                        link.target,
                        infer_kind_from_id(&tx, &link.target),
                        link.edge_type.as_str(),
                    ],
                )
                .map_err(JinError::Index)?;
            }
            for link in parse_canonical_links(&note.body) {
                tx.execute(
                    "INSERT OR IGNORE INTO note_links (source_id, target_id, label)
                     VALUES (?1, ?2, ?3)",
                    params![note.frontmatter.id, link.target_id, link.label],
                )
                .map_err(JinError::Index)?;
                // Preserve explicit typed edges while making canonical Markdown
                // links participate in the same backlink/dangling diagnostics.
                tx.execute(
                    "INSERT OR IGNORE INTO edges (source_id, source_kind, target_id, target_kind, edge_type)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        note.frontmatter.id,
                        "note",
                        link.target_id,
                        infer_kind_from_id(&tx, &link.target_id),
                        "references",
                    ],
                )
                .map_err(JinError::Index)?;
            }
        }
    }

    fn property_value_text(value: &PropertyValue) -> String {
        match value {
            PropertyValue::String(value) | PropertyValue::Date(value) => value.clone(),
            PropertyValue::Number(value) => value.to_string(),
            PropertyValue::Bool(value) => value.to_string(),
            PropertyValue::StringList(values) => values.join(" "),
        }
    }

    // --- Build edges: Event derived_from → edges ---
    for path in &event_paths {
        if let Ok(event) = fs::read_event(path) {
            if let Some(ref task_id) = event.frontmatter.derived_from {
                tx.execute(
                    "INSERT OR IGNORE INTO edges (source_id, source_kind, target_id, target_kind, edge_type)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        event.frontmatter.id,
                        "event",
                        task_id,
                        "task",
                        "derived-from",
                    ],
                )
                .map_err(JinError::Index)?;
            }
        }
    }

    // --- Derive backlinks from edges ---
    {
        let mut stmt = tx
            .prepare("SELECT source_id, source_kind, target_id, target_kind, edge_type FROM edges")
            .map_err(JinError::Index)?;
        let edges: Vec<(String, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(JinError::Index)?
            .filter_map(|r| r.ok())
            .collect();

        for (src_id, src_kind, tgt_id, tgt_kind, etype) in edges {
            let label = schema::backlink_label(&etype);
            tx.execute(
                "INSERT OR IGNORE INTO backlinks (target_id, target_kind, source_id, source_kind, edge_type, backlink_label)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![tgt_id, tgt_kind, src_id, src_kind, etype, label],
            )
            .map_err(JinError::Index)?;
        }
    }

    // --- Detect dangling edges ---
    {
        let mut stmt = tx
            .prepare("SELECT source_id, source_kind, target_id, target_kind, edge_type FROM edges")
            .map_err(JinError::Index)?;
        let edges: Vec<(String, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(JinError::Index)?
            .filter_map(|r| r.ok())
            .collect();

        for (src_id, src_kind, tgt_id, tgt_kind, etype) in edges {
            // M1: tombstoned targets (deleted/cancelled) are treated as absent → dangling.
            let count: i64 = match tgt_kind.as_str() {
                "note" => tx
                    .query_row(
                        "SELECT COUNT(*) FROM notes WHERE id=?1 AND status != 'deleted'",
                        params![tgt_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0),
                "task" => tx
                    .query_row(
                        "SELECT COUNT(*) FROM tasks WHERE id=?1 AND status != 'deleted'",
                        params![tgt_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0),
                "event" => tx
                    .query_row(
                        "SELECT COUNT(*) FROM events WHERE id=?1 AND status != 'cancelled'",
                        params![tgt_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0),
                _ => 0,
            };

            if count == 0 {
                tx.execute(
                    "INSERT INTO dangling_edges (source_id, source_kind, target_id, edge_type, reason)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        src_id.clone(),
                        src_kind,
                        tgt_id.clone(),
                        etype,
                        "target not found or tombstoned in index",
                    ],
                )
                .map_err(JinError::Index)?;
                diagnostics.push(JinError::DanglingEdge {
                    source_id: src_id,
                    target_id: tgt_id,
                });
            }
        }
    }

    tx.commit().map_err(JinError::Index)?;

    Ok(diagnostics)
}

/// Return the canonical value_type string: "date-time" or "date".
/// (m3: format!("{:?}", ...).to_lowercase() gives "datetime", not "date-time")
fn value_type_str(vt: &crate::model::event::ValueType) -> &'static str {
    match vt {
        crate::model::event::ValueType::DateTime => "date-time",
        crate::model::event::ValueType::Date => "date",
    }
}

/// Derive a short plain-text excerpt from a note body (D2).
///
/// Contract (deterministic):
/// - Collapse every run of ASCII/Unicode whitespace (including newlines) to a
///   single ASCII space.
/// - Trim leading/trailing whitespace.
/// - Take the first **200 chars** on a UTF-8 char boundary (via `char_indices` —
///   never byte-slice; safe for multibyte chars).
/// - Empty/whitespace-only body → `""`.
/// - No trailing ellipsis (visual clamping is the frontend's responsibility).
pub(crate) fn derive_excerpt(body: &str) -> String {
    // Collapse all whitespace runs → single space, then trim.
    let collapsed: String = body.split_whitespace().collect::<Vec<&str>>().join(" ");

    if collapsed.is_empty() {
        return String::new();
    }

    // Truncate to at most 200 chars on a char boundary.
    const MAX_CHARS: usize = 200;
    if collapsed.chars().count() <= MAX_CHARS {
        collapsed
    } else {
        // Find the byte offset of the 200th char boundary.
        let byte_end = collapsed
            .char_indices()
            .nth(MAX_CHARS)
            .map(|(i, _)| i)
            .unwrap_or(collapsed.len());
        collapsed[..byte_end].to_string()
    }
}

/// Infer the kind of a target by querying the transaction tables.
fn infer_kind_from_id(conn: &rusqlite::Connection, id: &str) -> String {
    let note_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes WHERE id=?1", params![id], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    if note_count > 0 {
        return "note".to_string();
    }
    let task_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE id=?1", params![id], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    if task_count > 0 {
        return "task".to_string();
    }
    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if event_count > 0 {
        return "event".to_string();
    }
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::derive_excerpt;
    use crate::index::query;
    use crate::model::list::{ListFrontmatter, SectionEntry};
    use crate::model::tag::TagFrontmatter;
    use crate::model::task::{Reminder, Task, TaskFrontmatter, TaskStatus};
    use crate::store::fs;
    use crate::{ops, Config};
    use chrono::Local;
    use tempfile::TempDir;

    /// Set up a minimal initialized store and return the TempDir (keeps it alive).
    fn init_store() -> TempDir {
        let tmp = TempDir::new().unwrap();
        ops::init(tmp.path()).unwrap();
        tmp
    }

    /// Write a task file directly with P2 fields set.
    fn write_tagged_task(
        root: &std::path::Path,
        id: &str,
        tags: Vec<String>,
        section_id: Option<String>,
        position: &str,
        reminders: Vec<Reminder>,
    ) -> Task {
        let now = Local::now().fixed_offset();
        let fm = TaskFrontmatter {
            id: id.to_string(),
            kind: "task".to_string(),
            title: format!("Task {}", id),
            created: now,
            updated: now,
            status: TaskStatus::Todo,
            priority: crate::model::task::Priority::None,
            due: None,
            list: "inbox".to_string(),
            completed_at: None,
            deleted_at: None,
            links: vec![],
            section_id,
            tags,
            position: position.to_string(),
            reminders,
            parent: None,
            agenda_bucket: None,
        };
        let task = Task {
            frontmatter: fm,
            body: String::new(),
        };
        fs::write_task(&root.join("tasks"), &task).unwrap();
        task
    }

    /// Write a task file directly with an explicit `parent` (S6).
    fn write_task_with_parent(root: &std::path::Path, id: &str, parent: Option<String>) -> Task {
        let now = Local::now().fixed_offset();
        let fm = TaskFrontmatter {
            id: id.to_string(),
            kind: "task".to_string(),
            title: format!("Task {}", id),
            created: now,
            updated: now,
            status: TaskStatus::Todo,
            priority: crate::model::task::Priority::None,
            due: None,
            list: "inbox".to_string(),
            completed_at: None,
            deleted_at: None,
            links: vec![],
            section_id: None,
            tags: vec![],
            position: String::new(),
            reminders: vec![],
            parent,
            agenda_bucket: None,
        };
        let task = Task {
            frontmatter: fm,
            body: String::new(),
        };
        fs::write_task(&root.join("tasks"), &task).unwrap();
        task
    }

    /// Rebuild via the internal functions, using a connection from index::open.
    fn rebuild_from_root(root: &std::path::Path) -> Vec<crate::JinError> {
        let cfg = Config::load(root).unwrap();
        let mut conn = crate::index::open(&cfg.index_path()).unwrap();
        super::rebuild(&mut conn, root).unwrap()
    }

    // ── G-REBUILD: task new fields round-trip ─────────────────────────────────

    /// G-REBUILD (VG-P2): section_id, tags, position, reminders written to disk →
    /// rebuild populates the tasks table columns → list_tasks returns them in the DTO.
    #[test]
    fn g_rebuild_task_new_fields_round_trip() {
        let tmp = init_store();
        let root = tmp.path();

        let reminders = vec![
            Reminder {
                kind: "relative".to_string(),
                value: "-1h".to_string(),
            },
            Reminder {
                kind: "absolute".to_string(),
                value: "2026-07-01T09:00:00+00:00".to_string(),
            },
        ];
        write_tagged_task(
            root,
            "TASK0001",
            vec!["work".to_string(), "urgent".to_string()],
            Some("section-01".to_string()),
            "V",
            reminders,
        );

        rebuild_from_root(root);

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let rows = query::list_tasks(&conn, None, None, None, false).unwrap();
        assert_eq!(rows.len(), 1);

        let row = &rows[0];
        assert_eq!(row.id, "TASK0001");
        assert_eq!(
            row.section_id,
            Some("section-01".to_string()),
            "section_id must round-trip"
        );
        assert_eq!(row.position, "V", "position must round-trip");

        let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap();
        assert_eq!(tags, vec!["work", "urgent"], "tags JSON must round-trip");

        let rem_raw: Vec<serde_json::Value> = serde_json::from_str(&row.reminders).unwrap();
        assert_eq!(
            rem_raw.len(),
            2,
            "reminders JSON must round-trip with 2 entries"
        );
        assert_eq!(rem_raw[0]["kind"], "relative");
        assert_eq!(rem_raw[0]["value"], "-1h");
        assert_eq!(rem_raw[1]["kind"], "absolute");
    }

    /// S6 G-REBUILD — the projection-trap guard at the rebuild layer: `parent`
    /// written to disk survives `rebuild()` into the `tasks.parent` column
    /// (defense in depth alongside AC-S6-04's CLI-driven, no-mock integration
    /// test in `jin/tests/s4_tasks_notes_crud.rs`).
    #[test]
    fn g_rebuild_task_parent_field_round_trips_through_index() {
        let tmp = init_store();
        let root = tmp.path();

        let parent = write_task_with_parent(root, "PARENT01", None);
        write_task_with_parent(root, "CHILD01", Some(parent.id().to_string()));

        rebuild_from_root(root);

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let rows = query::list_tasks(&conn, None, None, None, false).unwrap();

        let parent_row = rows.iter().find(|r| r.id == "PARENT01").unwrap();
        assert!(
            parent_row.parent.is_none(),
            "top-level task must have parent=NULL"
        );

        let child_row = rows.iter().find(|r| r.id == "CHILD01").unwrap();
        assert_eq!(
            child_row.parent,
            Some("PARENT01".to_string()),
            "parent must survive the index projection (rebuild -> tasks.parent)"
        );
    }

    #[test]
    fn g_rebuild_task_agenda_bucket_round_trip_and_fails_closed() {
        let tmp = init_store();
        let root = tmp.path();
        let mut task = write_tagged_task(root, "FLEXIBLE1", vec![], None, "V", vec![]);
        task.frontmatter.agenda_bucket = Some(crate::model::AgendaBucket::Flexible);
        fs::write_task(&root.join("tasks"), &task).unwrap();

        rebuild_from_root(root);
        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let flexible = query::list_flexible_tasks(&conn).unwrap();
        assert_eq!(flexible.len(), 1);
        assert_eq!(flexible[0].agenda_bucket.as_deref(), Some("flexible"));

        conn.execute(
            "UPDATE tasks SET status = 'unknown' WHERE id = 'FLEXIBLE1'",
            [],
        )
        .unwrap();
        assert!(query::list_flexible_tasks(&conn).unwrap().is_empty());
    }

    /// G-REBUILD (VG-P2): task_tags fan-out — one row per tag slug is inserted.
    #[test]
    fn g_rebuild_task_tags_fan_out() {
        let tmp = init_store();
        let root = tmp.path();

        write_tagged_task(
            root,
            "TASK0002",
            vec!["alpha".to_string(), "beta".to_string()],
            None,
            "V",
            vec![],
        );

        rebuild_from_root(root);

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();

        let alpha_count = query::count_task_tags(&conn, "alpha").unwrap();
        let beta_count = query::count_task_tags(&conn, "beta").unwrap();
        let gamma_count = query::count_task_tags(&conn, "gamma").unwrap();

        assert_eq!(alpha_count, 1, "task_tags must have row for alpha");
        assert_eq!(beta_count, 1, "task_tags must have row for beta");
        assert_eq!(gamma_count, 0, "no row for tag not in task frontmatter");
    }

    // ── G-REBUILD: list + sections ─────────────────────────────────────────────

    /// G-REBUILD (VG-P2): list file → rebuild → lists + sections tables populated.
    #[test]
    fn g_rebuild_list_and_sections_round_trip() {
        let tmp = init_store();
        let root = tmp.path();
        let lists_dir = root.join("lists");
        std::fs::create_dir_all(&lists_dir).unwrap();

        let now = Local::now().fixed_offset();
        let list_fm = ListFrontmatter {
            id: "inbox".to_string(),
            kind: "list".to_string(),
            name: "Inbox".to_string(),
            color: "accent".to_string(),
            icon: "inbox".to_string(),
            position: "V".to_string(),
            parent_id: None,
            view: "list".to_string(),
            sort_mode: "manual".to_string(),
            sections: vec![
                SectionEntry {
                    id: "sec1".to_string(),
                    name: "Backlog".to_string(),
                    position: "V".to_string(),
                },
                SectionEntry {
                    id: "sec2".to_string(),
                    name: "In Progress".to_string(),
                    position: "VV".to_string(),
                },
            ],
            archived_at: None,
            created: now,
            updated: now,
        };
        let list = crate::model::List {
            frontmatter: list_fm,
            body: String::new(),
        };
        fs::write_list(&lists_dir, &list).unwrap();

        rebuild_from_root(root);

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();

        let lists = query::list_lists(&conn).unwrap();
        assert_eq!(lists.len(), 1, "lists table must have 1 row");
        assert_eq!(lists[0].id, "inbox");
        assert_eq!(lists[0].name, "Inbox");
        assert_eq!(lists[0].color, "accent");
        assert_eq!(lists[0].position, "V");

        let sec_count = query::count_sections(&conn, "inbox").unwrap();
        assert_eq!(
            sec_count, 2,
            "sections table must have 2 rows for 2 SectionEntries"
        );
    }

    // ── G-REBUILD: tags ───────────────────────────────────────────────────────

    /// G-REBUILD (VG-P2): tag file → rebuild → tags table populated.
    #[test]
    fn g_rebuild_tag_metadata_round_trip() {
        let tmp = init_store();
        let root = tmp.path();
        let tags_dir = root.join("tags");
        std::fs::create_dir_all(&tags_dir).unwrap();

        let now = Local::now().fixed_offset();
        let tag_fm = TagFrontmatter {
            slug: "work".to_string(),
            kind: "tag".to_string(),
            name: "Work".to_string(),
            color: "sky".to_string(),
            created: now,
        };
        let tag = crate::model::Tag {
            frontmatter: tag_fm,
            body: String::new(),
        };
        fs::write_tag(&tags_dir, &tag).unwrap();

        rebuild_from_root(root);

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();

        let tags = query::list_tags(&conn).unwrap();
        assert_eq!(tags.len(), 1, "tags table must have 1 row");
        assert_eq!(tags[0].slug, "work");
        assert_eq!(tags[0].name, "Work");
        assert_eq!(tags[0].color, "sky");
    }

    // ── G-REBUILD: idempotency after new tables ────────────────────────────────

    /// G-REBUILD (VG-P2): a second rebuild clears and repopulates all new tables correctly.
    #[test]
    fn g_rebuild_is_idempotent_with_new_tables() {
        let tmp = init_store();
        let root = tmp.path();

        write_tagged_task(root, "TASK0003", vec!["foo".to_string()], None, "V", vec![]);

        rebuild_from_root(root);
        rebuild_from_root(root); // second rebuild

        let cfg = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();

        let rows = query::list_tasks(&conn, None, None, None, false).unwrap();
        assert_eq!(rows.len(), 1, "must not duplicate tasks on second rebuild");

        let task_tag_count = query::count_task_tags(&conn, "foo").unwrap();
        assert_eq!(
            task_tag_count, 1,
            "must not duplicate task_tags on second rebuild"
        );
    }

    /// VG2.1 — derive_excerpt: collapse whitespace and trim.
    #[test]
    fn excerpt_collapses_whitespace() {
        let body = "# Heading\n\nFirst paragraph with detail.";
        let ex = derive_excerpt(body);
        assert!(!ex.contains('\n'), "newlines must be collapsed");
        assert!(!ex.starts_with(' '), "must be trimmed");
        assert!(!ex.ends_with(' '), "must be trimmed");
        assert!(!ex.is_empty());
    }

    /// VG2.1 — empty/whitespace-only body → "".
    #[test]
    fn excerpt_empty_body() {
        assert_eq!(derive_excerpt(""), "");
        assert_eq!(derive_excerpt("   \n\t  "), "");
    }

    /// VG2.1 — multibyte body > 200 chars never byte-slices (no panic, valid String).
    #[test]
    fn excerpt_multibyte_truncation() {
        // Each '日' is 3 bytes; 201 chars > 200-char limit.
        let body: String = "日".repeat(201);
        let ex = derive_excerpt(&body);
        // Must be a valid String (no panic, no invalid UTF-8).
        assert!(std::str::from_utf8(ex.as_bytes()).is_ok());
        assert_eq!(ex.chars().count(), 200);
    }

    /// VG2.1 — body shorter than 200 chars is returned in full (no truncation).
    #[test]
    fn excerpt_short_body_unchanged() {
        let body = "Short note.";
        assert_eq!(derive_excerpt(body), "Short note.");
    }

    /// VG2.1 — exactly 200 chars is returned as-is.
    #[test]
    fn excerpt_exactly_200_chars() {
        let body: String = "a".repeat(200);
        assert_eq!(derive_excerpt(&body).chars().count(), 200);
    }

    /// VG2.1 — body with only whitespace between words collapses to single spaces.
    #[test]
    fn excerpt_multiple_spaces_collapsed() {
        let ex = derive_excerpt("hello   world\n\nfoo");
        assert_eq!(ex, "hello world foo");
    }

    #[test]
    fn invalid_strict_property_is_reported_as_rebuild_diagnostic() {
        let vault = init_store();
        let path = vault
            .path()
            .join("notes/01ARZ3NDEKTSV4RRFFQ69G5FAV--bad.md");
        std::fs::write(
            path,
            "---\nid: 01ARZ3NDEKTSV4RRFFQ69G5FAV\ntype: note\ntitle: Bad\ncreated: 2026-01-01T00:00:00+00:00\nupdated: 2026-01-01T00:00:00+00:00\nproperties:\n  unsupported:\n    nested: object\n---\nbody",
        )
        .unwrap();
        let diagnostics = crate::ops::api::refresh(vault.path()).unwrap();
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.to_string().contains("property values")),
            "invalid portable properties must be surfaced, not silently skipped"
        );
    }

    #[test]
    fn fts_indexes_only_canonical_body_properties_and_link_labels() {
        let vault = init_store();
        let path = vault
            .path()
            .join("notes/01ARZ3NDEKTSV4RRFFQ69G5FAV--search.md");
        std::fs::write(
            path,
            "---\nid: 01ARZ3NDEKTSV4RRFFQ69G5FAV\ntype: note\ntitle: Not Indexed As FTS Title\ncreated: 2026-01-01T00:00:00+00:00\nupdated: 2026-01-01T00:00:00+00:00\nproperties:\n  topic: orbital-keyword\n---\nbody text [[01ARZ3NDEKTSV4RRFFQ69G5FAW|label-keyword]]",
        )
        .unwrap();
        crate::ops::api::refresh(vault.path()).unwrap();
        assert_eq!(
            crate::ops::api::search_notes(vault.path(), "orbital-keyword")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            crate::ops::api::search_notes(vault.path(), "label-keyword")
                .unwrap()
                .len(),
            1
        );
        assert!(
            crate::ops::api::search_notes(vault.path(), "Not Indexed As FTS Title")
                .unwrap()
                .is_empty()
        );
    }
}
