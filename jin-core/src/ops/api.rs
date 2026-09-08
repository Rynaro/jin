//! Public API layer (VG4).
//! All index access flows through here. No consumer outside jin-core may open
//! the SQLite database or access index row types.

use std::collections::HashMap;
use std::path::Path;

use crate::dto::{
    AgendaDto, DanglingEdgeDto, EventDetailCapabilitiesDto, EventDetailDto, EventDto, FolderDto,
    ListDto, NoteDto, TagDto, TaskDto, TodayProjectionDto,
};
use crate::index::{self, query, rebuild};
use crate::store::fs;
use crate::{Config, JinError, Result};

// ── Read operations ────────────────────────────────────────────────────────────

/// Ensure a read never serves an index produced from an interrupted canonical
/// replacement. A completed-but-unrecorded rename also triggers a rebuild: the
/// index might still describe the before-image.
pub(crate) fn recover_before_read(root: &Path) -> Result<()> {
    let notes = super::recovery::recover_incomplete_operations(root)?;
    let operations = super::recoverable_operations::recover_incomplete_operations_for_read(root)?;
    if operations.blocked > 0 {
        return Err(JinError::OperationBlocked {
            operation_id: operations
                .blocking_operation_id
                .unwrap_or_else(|| "unknown".to_string()),
            reason: "canonical recovery is blocked by divergent content".to_string(),
        });
    }
    if notes.completed > 0 || notes.restored > 0 || operations.rolled_back > 0 {
        let cfg = Config::load(root)?;
        let mut conn = index::open(&cfg.index_path())?;
        rebuild::rebuild(&mut conn, root)?;
    }
    Ok(())
}

pub fn list_notes(
    root: &Path,
    include_deleted: bool,
    tag_filter: Option<&str>,
    folder_filter: Option<&str>,
) -> Result<Vec<NoteDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_notes_by_tag(&conn, include_deleted, tag_filter, folder_filter)
        .map_err(JinError::Index)?;
    Ok(rows.iter().map(NoteDto::from_row).collect())
}

/// Search the rebuildable FTS projection. Search deliberately has no raw SQL
/// or executable expression surface; it is a literal phrase over canonical
/// body/property/link-label text.
pub fn search_notes(root: &Path, text: &str) -> Result<Vec<NoteDto>> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::search_notes(&conn, text).map_err(JinError::Index)?;
    Ok(rows.iter().map(NoteDto::from_row).collect())
}

pub fn get_note(root: &Path, id: &str) -> Result<NoteDto> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let row = query::get_note(&conn, id)
        .map_err(JinError::Index)?
        .ok_or_else(|| JinError::NotFound(format!("note/{}", id)))?;
    // D3: read body fresh from disk (never from the index — body is not stored there).
    let note_on_disk = fs::read_note(std::path::Path::new(&row.file_path))?;
    let backlinks = query::get_backlinks(&conn, &row.id).map_err(JinError::Index)?;
    let mention_candidates = query::list_notes(&conn, false, None)
        .map_err(JinError::Index)?
        .into_iter()
        .map(|candidate| (candidate.id, candidate.title))
        .collect::<Vec<_>>();
    Ok(NoteDto::from_row(&row)
        .with_body(note_on_disk.body.clone())
        .with_backlinks(&backlinks)
        .with_note_details(&note_on_disk, mention_candidates))
}

pub fn list_tasks(
    root: &Path,
    list_filter: Option<&str>,
    status_filter: Option<&str>,
    priority_filter: Option<&str>,
    include_deleted: bool,
) -> Result<Vec<TaskDto>> {
    list_tasks_with_tag(
        root,
        list_filter,
        status_filter,
        priority_filter,
        None,
        include_deleted,
    )
}

pub fn list_flexible_tasks(root: &Path) -> Result<Vec<TaskDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_flexible_tasks(&conn).map_err(JinError::Index)?;
    Ok(rows.iter().map(TaskDto::from_row).collect())
}

/// list_tasks with an optional tag filter (P4). `tag_filter = None` → no tag constraint.
pub fn list_tasks_with_tag(
    root: &Path,
    list_filter: Option<&str>,
    status_filter: Option<&str>,
    priority_filter: Option<&str>,
    tag_filter: Option<&str>,
    include_deleted: bool,
) -> Result<Vec<TaskDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_tasks_by_tag(
        &conn,
        list_filter,
        status_filter,
        priority_filter,
        tag_filter,
        include_deleted,
    )
    .map_err(JinError::Index)?;
    Ok(rows.iter().map(TaskDto::from_row).collect())
}

/// List all lists (P3). Delegates to ops::lists::list_lists.
pub fn list_lists(root: &Path) -> Result<Vec<ListDto>> {
    recover_before_read(root)?;
    super::lists::list_lists(root)
}

/// List all tags (P4). Returns tags with task_count from index.
pub fn list_tags(root: &Path) -> Result<Vec<TagDto>> {
    recover_before_read(root)?;
    super::tags::list_tags(root)
}

pub fn get_task(root: &Path, id: &str) -> Result<TaskDto> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let row = query::get_task(&conn, id)
        .map_err(JinError::Index)?
        .ok_or_else(|| JinError::NotFound(format!("task/{}", id)))?;
    // D3: read body fresh from disk (never from the index — body is not stored there).
    let task_on_disk = fs::read_task(std::path::Path::new(&row.file_path))?;
    let backlinks = query::get_backlinks(&conn, &row.id).map_err(JinError::Index)?;
    Ok(TaskDto::from_row(&row)
        .with_backlinks(&backlinks)
        .with_body(task_on_disk.body))
}

pub fn list_events(root: &Path, include_deleted: bool) -> Result<Vec<EventDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_events(&conn, include_deleted).map_err(JinError::Index)?;
    let sync_conn = crate::sync::state::open_sync_db(&cfg.sync_dir()).ok();
    rows.iter()
        .filter_map(|row| match fs::read_event(Path::new(&row.file_path)) {
            Ok(event)
                if event.frontmatter.source == crate::model::event::EventSource::Google
                    && !event.frontmatter.recurrence.is_empty()
                    && event.frontmatter.recurring_event_id.is_none() =>
            {
                None
            }
            Ok(event) => Some(Ok(with_event_sync_context(
                EventDto::from_model(&event),
                &cfg,
                sync_conn.as_ref(),
                &row.id,
            ))),
            Err(error) => Some(Err(error)),
        })
        .collect()
}

pub fn get_event(root: &Path, id: &str) -> Result<EventDto> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let row = query::get_event(&conn, id)
        .map_err(JinError::Index)?
        .ok_or_else(|| JinError::NotFound(format!("event/{}", id)))?;
    let backlinks = query::get_backlinks(&conn, &row.id).map_err(JinError::Index)?;
    let event = fs::read_event(Path::new(&row.file_path))?;
    let sync_conn = crate::sync::state::open_sync_db(&cfg.sync_dir()).ok();
    Ok(with_event_sync_context(
        EventDto::from_model(&event).with_backlinks(&backlinks),
        &cfg,
        sync_conn.as_ref(),
        id,
    ))
}

pub fn get_event_detail_capabilities(root: &Path, id: &str) -> Result<EventDetailCapabilitiesDto> {
    super::events::event_detail_capabilities(root, id)
}

pub fn get_event_detail(root: &Path, id: &str) -> Result<EventDetailDto> {
    let notes = super::recovery::recover_incomplete_operations(root)?;
    super::recoverable_operations::with_canonical_read_lock(
        root,
        notes.completed > 0 || notes.restored > 0,
        || {
            let cfg = Config::load(root)?;
            let conn = index::open(&cfg.index_path())?;
            let row = query::get_event(&conn, id)
                .map_err(JinError::Index)?
                .ok_or_else(|| JinError::NotFound(format!("event/{id}")))?;
            let backlinks = query::get_backlinks(&conn, id).map_err(JinError::Index)?;
            let bytes = std::fs::read(&row.file_path)?;
            let event = fs::parse_event_bytes(&bytes)?;
            let capabilities = super::events::event_detail_capabilities_unrecovered(root, &event)?;
            Ok(EventDetailDto {
                event: with_event_sync_context(
                    EventDto::from_model(&event).with_backlinks(&backlinks),
                    &cfg,
                    crate::sync::state::open_sync_db(&cfg.sync_dir())
                        .ok()
                        .as_ref(),
                    id,
                ),
                capabilities,
                edit_token: super::events::edit_token_for_bytes(&bytes),
            })
        },
    )
}

fn with_event_sync_context(
    dto: EventDto,
    cfg: &Config,
    conn: Option<&rusqlite::Connection>,
    event_id: &str,
) -> EventDto {
    let Some(conn) = conn else { return dto };
    let Ok(Some(destination)) = crate::sync::state::latest_destination_for_jin_id(conn, event_id)
    else {
        return dto;
    };
    let state = crate::sync::state::list_route_outbox(conn, &destination, "pending")
        .map(|items| {
            if items.iter().any(|item| item.jin_id == event_id) {
                "pending"
            } else {
                "synced"
            }
        })
        .unwrap_or("unknown");
    crate::dto::google::event_context(
        &cfg.google_registry,
        &destination.account_id,
        &destination.calendar_id,
        state,
    )
    .map(|context| dto.clone().with_sync_context(context))
    .unwrap_or(dto)
}

/// Return events that start on today's date (local time).
pub fn today_events(root: &Path) -> Result<Vec<EventDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let today = chrono::Local::now().date_naive().to_string();
    let rows = query::list_events(&conn, false).map_err(JinError::Index)?;
    Ok(rows
        .iter()
        .filter(|e| e.start.starts_with(&today))
        .map(EventDto::from_row)
        .collect())
}

/// Build the merged day agenda for `date` (or "today" in the display timezone
/// when `date` is `None`).
pub fn agenda_for_date(root: &Path, date: Option<chrono::NaiveDate>) -> Result<AgendaDto> {
    recover_before_read(root)?;
    super::agenda::agenda_for_date(root, date)
}

/// Build the connected, timezone-authoritative Today projection.
pub fn today_projection_for_date(
    root: &Path,
    date: Option<chrono::NaiveDate>,
) -> Result<TodayProjectionDto> {
    recover_before_read(root)?;
    super::agenda::today_projection_for_date(root, date)
}

pub fn list_dangling(root: &Path) -> Result<Vec<DanglingEdgeDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_dangling_edges(&conn).map_err(JinError::Index)?;
    Ok(rows.iter().map(DanglingEdgeDto::from_row).collect())
}

// ── Folder operations (Wave 2A) ────────────────────────────────────────────────

/// List all folders, including empty ones, with note counts.
///
/// Unions: index `DISTINCT folder_path` (with counts) + on-disk recursive subdir scan.
/// `""` (root "Notes") is always present even with zero notes.
/// D-EMPTY: the on-disk scan surfaces empty folders that have no index rows.
pub fn list_folders(root: &Path) -> Result<Vec<FolderDto>> {
    recover_before_read(root)?;
    let cfg = Config::load(root)?;
    let notes_dir = cfg.notes_dir();
    let conn = index::open(&cfg.index_path())?;

    // Index side: folder_path → count for non-deleted notes.
    let counts_vec = query::folder_counts(&conn).map_err(JinError::Index)?;
    let counts: HashMap<String, usize> = counts_vec.into_iter().collect();

    // Disk side: all subdirs (including empty ones) + root "".
    let disk_folders = fs::list_note_folders(&notes_dir)?;

    // Union into a BTreeSet: collect all folder paths from both sources.
    let mut all_paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    all_paths.insert(String::new()); // root always present
    for path in counts.keys() {
        all_paths.insert(path.clone());
    }
    for path in disk_folders {
        all_paths.insert(path);
    }

    let result = all_paths
        .into_iter()
        .map(|path| {
            let note_count = counts.get(&path).copied().unwrap_or(0);
            FolderDto::new(path, note_count)
        })
        .collect();

    Ok(result)
}

/// Create an empty folder under the store's `notes/` directory.
///
/// `folder_path` must be a valid relative path (validated by `validate_folder_path`).
/// Returns a `FolderDto` for the newly-created folder (note_count=0).
/// Empty string is rejected (the root folder always exists).
pub fn create_folder(root: &Path, folder_path: &str) -> Result<FolderDto> {
    if folder_path.is_empty() {
        return Err(JinError::InvalidInput(
            "folder_path must not be empty when creating a folder (root always exists)".to_string(),
        ));
    }
    fs::validate_folder_path(folder_path)?;
    let cfg = Config::load(root)?;
    let notes_dir = cfg.notes_dir();
    std::fs::create_dir_all(notes_dir.join(folder_path))?;
    Ok(FolderDto::new(folder_path.to_string(), 0))
}

// ── Write / maintenance ────────────────────────────────────────────────────────

/// Rebuild the derived index from canonical files. Call after any write op.
pub fn refresh(root: &Path) -> Result<Vec<JinError>> {
    // Canonical files are repaired before the derived database is rebuilt.
    // A stale SQLite index must never decide recovery outcomes.
    super::recovery::recover_incomplete_operations(root)?;
    let operations = super::recoverable_operations::recover_incomplete_operations(root)?;
    if operations.blocked > 0 {
        return Err(JinError::OperationBlocked {
            operation_id: operations
                .blocking_operation_id
                .unwrap_or_else(|| "unknown".to_string()),
            reason: "canonical recovery is blocked by divergent content".to_string(),
        });
    }
    let cfg = Config::load(root)?;
    let mut conn = index::open(&cfg.index_path())?;
    rebuild::rebuild(&mut conn, root)
}

// ── Utility ───────────────────────────────────────────────────────────────────

/// Infer the kind ("note" | "task" | "event") of an object by checking the
/// filesystem. Returns JinError::NotFound (exit 3) when not found.
pub fn infer_kind(root: &Path, id: &str) -> Result<String> {
    recover_before_read(root)?;
    let notes_dir = root.join("notes");
    let tasks_dir = root.join("tasks");
    let events_dir = root.join("events");

    if crate::store::fs::find_note_path(&notes_dir, id).is_ok() {
        return Ok("note".to_string());
    }
    if crate::store::fs::find_task_path(&tasks_dir, id).is_ok() {
        return Ok("task".to_string());
    }
    if crate::store::fs::find_event_path(&events_dir, id).is_ok() {
        return Ok("event".to_string());
    }
    Err(JinError::NotFound(format!("object/{}", id)))
}
