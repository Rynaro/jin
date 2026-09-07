//! List operations — create, read, edit, reorder, delete (§1.2 / EPIC P3).
//!
//! Source of truth: `<root>/lists/<id>.md` files.
//! Index is derived (rebuilt via `api::refresh`).

use chrono::Local;
use std::path::Path;

use crate::dto::list::{ListDto, SectionDto};
use crate::id::new_ulid;
use crate::index::{self, query};
use crate::model::list::{List, ListFrontmatter};
use crate::order;
use crate::store::fs;
use crate::{Config, JinError, Result};

// ── Default list constants ────────────────────────────────────────────────────

const INBOX_ID: &str = "inbox";
const INBOX_NAME: &str = "Inbox";
const INBOX_COLOR: &str = "accent";
const INBOX_ICON: &str = "inbox";

// ── Jin swatch palette (for deterministic tag colour + new-list default) ──────

/// The ordered palette of Jin swatch tokens.
pub const JIN_PALETTE: &[&str] = &[
    "accent", "sky", "danger", "warning", "success", "purple", "pink", "orange",
];

/// Normalize a color at write boundaries. Existing files remain read-tolerant.
pub fn normalize_color(input: &str) -> Result<String> {
    let value = input.trim();
    let token = value.to_ascii_lowercase();
    if JIN_PALETTE.contains(&token.as_str()) {
        return Ok(token);
    }
    let hex = value.strip_prefix('#').ok_or_else(|| {
        JinError::InvalidInput("color must be a Jin palette token or HEX value".to_string())
    })?;
    if !matches!(hex.len(), 3 | 6) || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(JinError::InvalidInput(
            "color HEX value must contain exactly 3 or 6 hexadecimal digits".to_string(),
        ));
    }
    let expanded = if hex.len() == 3 {
        hex.chars()
            .flat_map(|character| [character, character])
            .collect::<String>()
    } else {
        hex.to_string()
    };
    Ok(format!("#{}", expanded.to_ascii_uppercase()))
}

// ── Params ────────────────────────────────────────────────────────────────────

pub struct CreateListParams {
    pub name: String,
    pub color: String,
    pub icon: String,
    pub parent_id: Option<String>,
}

pub struct EditListParams {
    pub name: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub view: Option<String>,
    pub sort_mode: Option<String>,
    pub parent_id: Option<Option<String>>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Convert a `ListFrontmatter` + task_count into a `ListDto` (without sections loaded).
fn list_to_dto(fm: &ListFrontmatter, task_count: u32) -> ListDto {
    ListDto {
        id: fm.id.clone(),
        name: fm.name.clone(),
        color: fm.color.clone(),
        icon: fm.icon.clone(),
        position: fm.position.clone(),
        parent_id: fm.parent_id.clone(),
        view: fm.view.clone(),
        sort_mode: fm.sort_mode.clone(),
        is_default: fm.id == INBOX_ID,
        task_count,
        sections: fm
            .sections
            .iter()
            .map(|s| SectionDto {
                id: s.id.clone(),
                list_id: fm.id.clone(),
                name: s.name.clone(),
                position: s.position.clone(),
                task_count: 0, // P3: section task_count not surfaced yet
            })
            .collect(),
    }
}

/// Resolve the last (largest) position among existing lists in the index.
fn last_list_position(conn: &rusqlite::Connection) -> Option<String> {
    let rows = query::list_lists(conn).unwrap_or_default();
    rows.into_iter()
        .map(|r| r.position)
        .max_by(|a, b| a.as_str().cmp(b.as_str()))
}

// ── Public ops ────────────────────────────────────────────────────────────────

/// Idempotently create `lists/inbox.md` with the stable id `"inbox"`.
/// Called by `list_lists` and Tauri app init.
pub fn ensure_default_list(lists_dir: &Path) -> Result<()> {
    let inbox_path = lists_dir.join(fs::list_filename(INBOX_ID));
    if inbox_path.exists() {
        return Ok(());
    }
    let now = Local::now().fixed_offset();
    let position = order::between(None, None);
    let fm = ListFrontmatter {
        id: INBOX_ID.to_string(),
        kind: "list".to_string(),
        name: INBOX_NAME.to_string(),
        color: INBOX_COLOR.to_string(),
        icon: INBOX_ICON.to_string(),
        position,
        parent_id: None,
        view: "list".to_string(),
        sort_mode: "manual".to_string(),
        sections: vec![],
        archived_at: None,
        created: now,
        updated: now,
    };
    let list = List {
        frontmatter: fm,
        body: String::new(),
    };
    fs::write_list(lists_dir, &list)?;
    Ok(())
}

/// List all lists, ensuring the default Inbox list is seeded first.
/// Returns `Vec<ListDto>` ordered by position (ascending).
/// Each `ListDto.task_count` is a live COUNT from the index.
pub fn list_lists(root: &Path) -> Result<Vec<ListDto>> {
    let cfg = Config::load(root)?;
    let inbox_path = cfg.lists_dir().join(fs::list_filename(INBOX_ID));
    let inbox_existed = inbox_path.exists();
    ensure_default_list(&cfg.lists_dir())?;
    // If inbox was just created (first call), rebuild the index so the new
    // list file is reflected in the query results.
    if !inbox_existed {
        crate::ops::api::refresh(root)?;
    }

    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_lists(&conn).map_err(JinError::Index)?;

    let mut dtos = Vec::with_capacity(rows.len());
    for row in &rows {
        let task_count =
            query::count_tasks_for_list(&conn, &row.id).map_err(JinError::Index)? as u32;
        let fm_proxy = ListFrontmatter {
            id: row.id.clone(),
            kind: "list".to_string(),
            name: row.name.clone(),
            color: row.color.clone(),
            icon: row.icon.clone(),
            position: row.position.clone(),
            parent_id: row.parent_id.clone(),
            view: row.view.clone(),
            sort_mode: row.sort_mode.clone(),
            sections: vec![], // loaded separately below
            archived_at: None,
            created: Local::now().fixed_offset(), // not critical for DTO
            updated: Local::now().fixed_offset(),
        };
        // Load real sections from disk for this list to populate sections[].
        let sections = if let Ok(path) = fs::find_list_path(&cfg.lists_dir(), &row.id) {
            if let Ok(list) = fs::read_list(&path) {
                list.frontmatter
                    .sections
                    .iter()
                    .map(|s| SectionDto {
                        id: s.id.clone(),
                        list_id: row.id.clone(),
                        name: s.name.clone(),
                        position: s.position.clone(),
                        task_count: 0,
                    })
                    .collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        };
        let mut dto = list_to_dto(&fm_proxy, task_count);
        dto.sections = sections;
        dtos.push(dto);
    }
    Ok(dtos)
}

/// Create a new list with the given params; returns the created `ListDto`.
pub fn create_list(root: &Path, params: CreateListParams) -> Result<ListDto> {
    let cfg = Config::load(root)?;
    ensure_default_list(&cfg.lists_dir())?;

    let conn = index::open(&cfg.index_path())?;
    let last_pos = last_list_position(&conn);
    drop(conn); // release before refresh

    let id = new_ulid();
    let now = Local::now().fixed_offset();
    let position = order::between(last_pos.as_deref(), None);

    let color = normalize_color(&params.color)?;
    let fm = ListFrontmatter {
        id: id.clone(),
        kind: "list".to_string(),
        name: params.name.clone(),
        color,
        icon: params.icon.clone(),
        position: position.clone(),
        parent_id: params.parent_id.clone(),
        view: "list".to_string(),
        sort_mode: "manual".to_string(),
        sections: vec![],
        archived_at: None,
        created: now,
        updated: now,
    };
    let list = List {
        frontmatter: fm.clone(),
        body: String::new(),
    };
    fs::write_list(&cfg.lists_dir(), &list)?;
    crate::ops::api::refresh(root)?;

    Ok(list_to_dto(&fm, 0))
}

/// Edit mutable fields of an existing list. `None` = leave unchanged.
pub fn edit_list(root: &Path, id: &str, params: EditListParams) -> Result<ListDto> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), id)?;
    let mut list = fs::read_list(&path)?;
    let mut changed = false;

    if let Some(name) = params.name {
        list.frontmatter.name = name;
        changed = true;
    }
    if let Some(color) = params.color {
        list.frontmatter.color = normalize_color(&color)?;
        changed = true;
    }
    if let Some(icon) = params.icon {
        list.frontmatter.icon = icon;
        changed = true;
    }
    if let Some(view) = params.view {
        list.frontmatter.view = view;
        changed = true;
    }
    if let Some(sort_mode) = params.sort_mode {
        list.frontmatter.sort_mode = sort_mode;
        changed = true;
    }
    if let Some(parent_id) = params.parent_id {
        list.frontmatter.parent_id = parent_id;
        changed = true;
    }

    if changed {
        list.frontmatter.updated = Local::now().fixed_offset();
        fs::write_list(&cfg.lists_dir(), &list)?;
        crate::ops::api::refresh(root)?;
    }

    // Count tasks from index after refresh.
    let cfg2 = Config::load(root)?;
    let conn = index::open(&cfg2.index_path())?;
    let task_count = query::count_tasks_for_list(&conn, id).map_err(JinError::Index)? as u32;

    Ok(list_to_dto(&list.frontmatter, task_count))
}

/// Set the position of a list (for reordering). Refreshes the index.
pub fn reorder_list(root: &Path, id: &str, position: String) -> Result<ListDto> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), id)?;
    let mut list = fs::read_list(&path)?;
    list.frontmatter.position = position;
    list.frontmatter.updated = Local::now().fixed_offset();
    fs::write_list(&cfg.lists_dir(), &list)?;
    crate::ops::api::refresh(root)?;

    let cfg2 = Config::load(root)?;
    let conn = index::open(&cfg2.index_path())?;
    let task_count = query::count_tasks_for_list(&conn, id).map_err(JinError::Index)? as u32;

    Ok(list_to_dto(&list.frontmatter, task_count))
}

/// Delete a list. Refuses if `id == "inbox"`.
/// Reassigns all tasks whose `list == id` to `"inbox"`, then removes the list file.
pub fn delete_list(root: &Path, id: &str) -> Result<()> {
    if id == INBOX_ID {
        return Err(JinError::InvalidInput(
            "The default Inbox list cannot be deleted.".to_string(),
        ));
    }

    let cfg = Config::load(root)?;

    // Reassign tasks belonging to this list → "inbox".
    let tasks_dir = cfg.tasks_dir();
    let task_paths = fs::list_task_paths(&tasks_dir)?;
    for path in &task_paths {
        if let Ok(mut task) = fs::read_task(path) {
            if task.frontmatter.list == id {
                task.frontmatter.list = INBOX_ID.to_string();
                task.frontmatter.updated = Local::now().fixed_offset();
                fs::write_task(&tasks_dir, &task)?;
            }
        }
    }

    // Remove the list file.
    let list_path = fs::find_list_path(&cfg.lists_dir(), id)?;
    std::fs::remove_file(&list_path)?;

    crate::ops::api::refresh(root)?;
    Ok(())
}

// ── Section ops (P5) ──────────────────────────────────────────────────────────

/// Append a new `SectionEntry` to the list's `sections`, write the list, refresh.
/// Returns the new `SectionDto`.
pub fn create_section(root: &Path, list_id: &str, name: String) -> Result<SectionDto> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    let mut list = fs::read_list(&path)?;

    // Last position among existing sections (for appending).
    let last_pos = list
        .frontmatter
        .sections
        .iter()
        .map(|s| s.position.as_str())
        .max_by(|a, b| a.cmp(b))
        .map(|s| s.to_string());

    let position = order::between(last_pos.as_deref(), None);
    let id = new_ulid();

    let entry = crate::model::list::SectionEntry {
        id: id.clone(),
        name: name.clone(),
        position: position.clone(),
    };
    list.frontmatter.sections.push(entry);
    list.frontmatter.updated = Local::now().fixed_offset();
    fs::write_list(&cfg.lists_dir(), &list)?;
    crate::ops::api::refresh(root)?;

    Ok(SectionDto {
        id,
        list_id: list_id.to_string(),
        name,
        position,
        task_count: 0,
    })
}

/// Rename an existing section, write the list, refresh.
pub fn rename_section(
    root: &Path,
    list_id: &str,
    section_id: &str,
    name: String,
) -> Result<SectionDto> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    let mut list = fs::read_list(&path)?;

    let entry = list
        .frontmatter
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| {
            JinError::NotFound(format!(
                "section/{} not found in list/{}",
                section_id, list_id
            ))
        })?;

    entry.name = name.clone();
    let position = entry.position.clone();
    list.frontmatter.updated = Local::now().fixed_offset();
    fs::write_list(&cfg.lists_dir(), &list)?;
    crate::ops::api::refresh(root)?;

    Ok(SectionDto {
        id: section_id.to_string(),
        list_id: list_id.to_string(),
        name,
        position,
        task_count: 0,
    })
}

/// Set the position of a section (for reordering), write the list, refresh.
pub fn reorder_section(
    root: &Path,
    list_id: &str,
    section_id: &str,
    position: String,
) -> Result<SectionDto> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    let mut list = fs::read_list(&path)?;

    let entry = list
        .frontmatter
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| {
            JinError::NotFound(format!(
                "section/{} not found in list/{}",
                section_id, list_id
            ))
        })?;

    entry.position = position.clone();
    let name = entry.name.clone();
    list.frontmatter.updated = Local::now().fixed_offset();
    fs::write_list(&cfg.lists_dir(), &list)?;
    crate::ops::api::refresh(root)?;

    Ok(SectionDto {
        id: section_id.to_string(),
        list_id: list_id.to_string(),
        name,
        position,
        task_count: 0,
    })
}

/// Delete a section entry and **actively clear** `section_id` on every task that
/// was in this section (§1.4 owner-locked decision: active clear, not lazy bucketing).
///
/// Write order: list file first, then affected task files, then refresh.
pub fn delete_section(root: &Path, list_id: &str, section_id: &str) -> Result<()> {
    let cfg = Config::load(root)?;
    let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    let mut list = fs::read_list(&path)?;

    // Remove the section entry (error if not found).
    let orig_len = list.frontmatter.sections.len();
    list.frontmatter.sections.retain(|s| s.id != section_id);
    if list.frontmatter.sections.len() == orig_len {
        return Err(JinError::NotFound(format!(
            "section/{} not found in list/{}",
            section_id, list_id
        )));
    }
    list.frontmatter.updated = Local::now().fixed_offset();
    fs::write_list(&cfg.lists_dir(), &list)?;

    // Actively clear section_id on all affected tasks.
    let tasks_dir = cfg.tasks_dir();
    let task_paths = fs::list_task_paths(&tasks_dir)?;
    let now = Local::now().fixed_offset();
    for task_path in &task_paths {
        if let Ok(mut task) = fs::read_task(task_path) {
            if task.frontmatter.list == list_id
                && task.frontmatter.section_id.as_deref() == Some(section_id)
            {
                task.frontmatter.section_id = None;
                task.frontmatter.updated = now;
                fs::write_task(&tasks_dir, &task)?;
            }
        }
    }

    crate::ops::api::refresh(root)?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use crate::ops::tasks::{create_task, CreateTaskParams};
    use tempfile::TempDir;

    #[test]
    fn color_writes_normalize_tokens_and_hex() {
        assert_eq!(normalize_color(" Purple ").unwrap(), "purple");
        assert_eq!(normalize_color("#a3f").unwrap(), "#AA33FF");
        assert_eq!(normalize_color("#12abEF").unwrap(), "#12ABEF");
        assert!(normalize_color("12ABEF").is_err());
        assert!(normalize_color("#abcd").is_err());
    }

    #[test]
    fn create_and_edit_list_persist_canonical_custom_colors() {
        let tmp = init_store();
        let created = create_list(
            tmp.path(),
            CreateListParams {
                name: "Chroma".to_string(),
                color: "#a3f".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        assert_eq!(created.color, "#AA33FF");
        let edited = edit_list(
            tmp.path(),
            &created.id,
            EditListParams {
                name: None,
                color: Some("#12abef".to_string()),
                icon: None,
                view: None,
                sort_mode: None,
                parent_id: None,
            },
        )
        .unwrap();
        assert_eq!(edited.color, "#12ABEF");
    }

    fn init_store() -> TempDir {
        let tmp = TempDir::new().unwrap();
        ops::init(tmp.path()).unwrap();
        tmp
    }

    // ── VG-P3: default list seeded ────────────────────────────────────────────

    /// VG-P3: ensure_default_list creates inbox.md with id "inbox".
    #[test]
    fn vg_p3_ensure_default_list_creates_inbox() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        let lists_dir = cfg.lists_dir();

        ensure_default_list(&lists_dir).unwrap();

        let inbox_path = lists_dir.join("inbox.md");
        assert!(inbox_path.exists(), "inbox.md must be created");
        let list = fs::read_list(&inbox_path).unwrap();
        assert_eq!(list.frontmatter.id, "inbox");
        assert_eq!(list.frontmatter.name, "Inbox");
    }

    /// VG-P3: ensure_default_list is idempotent (safe to call twice).
    #[test]
    fn vg_p3_ensure_default_list_idempotent() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        let lists_dir = cfg.lists_dir();

        ensure_default_list(&lists_dir).unwrap();
        let before = std::fs::read(lists_dir.join("inbox.md")).unwrap();
        ensure_default_list(&lists_dir).unwrap(); // second call
        let after = std::fs::read(lists_dir.join("inbox.md")).unwrap();
        assert_eq!(before, after, "second call must not change the file");
    }

    /// VG-P3: delete_list("inbox") is refused.
    #[test]
    fn vg_p3_delete_inbox_is_refused() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let result = delete_list(root, "inbox");
        assert!(result.is_err(), "delete_list(inbox) must return an error");
    }

    /// VG-P3: create/rename/recolor persist to the list file AND survive rebuild.
    #[test]
    fn vg_p3_create_rename_recolor_persist_and_survive_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        // Create a list.
        let dto = create_list(
            root,
            CreateListParams {
                name: "Work".to_string(),
                color: "sky".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        assert_eq!(dto.name, "Work");
        assert_eq!(dto.color, "sky");
        let list_id = dto.id.clone();

        // Rename + recolor.
        let edited = edit_list(
            root,
            &list_id,
            EditListParams {
                name: Some("Work Tasks".to_string()),
                color: Some("purple".to_string()),
                icon: None,
                view: None,
                sort_mode: None,
                parent_id: None,
            },
        )
        .unwrap();
        assert_eq!(edited.name, "Work Tasks");
        assert_eq!(edited.color, "purple");

        // Verify persisted to disk.
        let cfg2 = Config::load(root).unwrap();
        let path = fs::find_list_path(&cfg2.lists_dir(), &list_id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        assert_eq!(on_disk.frontmatter.name, "Work Tasks");
        assert_eq!(on_disk.frontmatter.color, "purple");

        // Rebuild and re-check index.
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        let found = lists.iter().find(|l| l.id == list_id).unwrap();
        assert_eq!(found.name, "Work Tasks");
        assert_eq!(found.color, "purple");
    }

    /// VG-P3: reorder persists to file AND survives rebuild.
    #[test]
    fn vg_p3_reorder_persists_and_survives_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let dto = create_list(
            root,
            CreateListParams {
                name: "Personal".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        let original_pos = dto.position.clone();

        let new_pos = order::between(None, Some(&original_pos));
        let reordered = reorder_list(root, &dto.id, new_pos.clone()).unwrap();
        assert_eq!(reordered.position, new_pos);

        // Verify persisted on disk.
        let cfg2 = Config::load(root).unwrap();
        let path = fs::find_list_path(&cfg2.lists_dir(), &dto.id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        assert_eq!(on_disk.frontmatter.position, new_pos);

        // Survive rebuild.
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        let found = lists.iter().find(|l| l.id == dto.id).unwrap();
        assert_eq!(found.position, new_pos);
    }

    /// VG-P3: existing `list:"inbox"` task resolves to default with file BYTE-UNCHANGED.
    #[test]
    fn vg_p3_inbox_task_byte_unchanged_after_list_lists() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();

        // Create a task with list: "inbox" (the default).
        let task = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Inbox task".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some("inbox".to_string()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        crate::ops::api::refresh(root).unwrap();

        // Capture the file bytes before calling list_lists.
        let task_path = cfg.tasks_dir().join(format!("{}.md", task.frontmatter.id));
        let before_bytes = std::fs::read(&task_path).unwrap();

        // Call list_lists — must NOT rewrite the task file.
        let lists = list_lists(root).unwrap();
        let inbox = lists.iter().find(|l| l.id == "inbox").unwrap();
        assert!(inbox.is_default);
        assert!(inbox.task_count >= 1, "inbox must show at least 1 task");

        let after_bytes = std::fs::read(&task_path).unwrap();
        assert_eq!(
            before_bytes, after_bytes,
            "task file must be byte-unchanged"
        );
    }

    // ── VG-P5: Section CRUD ───────────────────────────────────────────────────

    /// VG-P5: create_section persists to the list file AND survives a rebuild.
    #[test]
    fn vg_p5_create_section_persists_and_survives_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        // Create a list to own the section.
        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Project".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();

        // Create a section.
        let sec = create_section(root, &list_dto.id, "Backlog".to_string()).unwrap();
        assert_eq!(sec.name, "Backlog");
        assert_eq!(sec.list_id, list_dto.id);
        assert!(!sec.id.is_empty());
        assert!(!sec.position.is_empty());

        // Assert persisted on disk.
        let path = fs::find_list_path(&cfg.lists_dir(), &list_dto.id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        assert_eq!(on_disk.frontmatter.sections.len(), 1);
        assert_eq!(on_disk.frontmatter.sections[0].name, "Backlog");

        // Assert survives rebuild (check list_lists returns sections).
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        let found = lists.iter().find(|l| l.id == list_dto.id).unwrap();
        assert_eq!(found.sections.len(), 1);
        assert_eq!(found.sections[0].name, "Backlog");
    }

    /// VG-P5: rename_section persists to the list file AND survives rebuild.
    #[test]
    fn vg_p5_rename_section_persists_and_survives_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Project".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();

        let sec = create_section(root, &list_dto.id, "Backlog".to_string()).unwrap();

        // Rename.
        let renamed =
            rename_section(root, &list_dto.id, &sec.id, "In Progress".to_string()).unwrap();
        assert_eq!(renamed.name, "In Progress");

        // Assert persisted on disk.
        let path = fs::find_list_path(&cfg.lists_dir(), &list_dto.id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        assert_eq!(on_disk.frontmatter.sections[0].name, "In Progress");

        // Assert survives rebuild.
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        let found = lists.iter().find(|l| l.id == list_dto.id).unwrap();
        assert_eq!(found.sections[0].name, "In Progress");
    }

    /// VG-P5: reorder_section persists position to the list file AND survives rebuild.
    #[test]
    fn vg_p5_reorder_section_persists_and_survives_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Project".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();

        let sec1 = create_section(root, &list_dto.id, "Alpha".to_string()).unwrap();
        let sec2 = create_section(root, &list_dto.id, "Beta".to_string()).unwrap();

        // Reorder sec2 to come before sec1.
        let new_pos = order::between(None, Some(&sec1.position));
        let reordered = reorder_section(root, &list_dto.id, &sec2.id, new_pos.clone()).unwrap();
        assert_eq!(reordered.position, new_pos);

        // Assert persisted on disk.
        let path = fs::find_list_path(&cfg.lists_dir(), &list_dto.id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        let beta = on_disk
            .frontmatter
            .sections
            .iter()
            .find(|s| s.id == sec2.id)
            .unwrap();
        assert_eq!(beta.position, new_pos);
        // Beta position < Alpha position (beta is before alpha).
        let alpha = on_disk
            .frontmatter
            .sections
            .iter()
            .find(|s| s.id == sec1.id)
            .unwrap();
        assert!(beta.position < alpha.position);

        // Survives rebuild.
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        let found = lists.iter().find(|l| l.id == list_dto.id).unwrap();
        let beta_dto = found.sections.iter().find(|s| s.id == sec2.id).unwrap();
        assert_eq!(beta_dto.position, new_pos);
    }

    /// VG-P5: edit_task with section_id persists on disk AND survives rebuild.
    #[test]
    fn vg_p5_edit_task_section_persists_and_survives_rebuild() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Work".to_string(),
                color: "sky".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        let sec = create_section(root, &list_dto.id, "In Progress".to_string()).unwrap();

        // Create task in the list.
        let task = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Write spec".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(list_dto.id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        assert!(task.frontmatter.section_id.is_none());

        // Set section_id via edit_task.
        let updated = crate::ops::tasks::edit_task(
            &cfg.tasks_dir(),
            task.id(),
            crate::ops::tasks::EditTaskParams {
                title: None,
                priority: None,
                due: None,
                list: None,
                body: None,
                tags: None,
                section_id: Some(sec.id.clone()),
                clear_section: false,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        assert_eq!(updated.frontmatter.section_id, Some(sec.id.clone()));

        // Assert persisted on disk.
        let task_path = cfg.tasks_dir().join(format!("{}.md", task.id()));
        let on_disk = fs::read_task(&task_path).unwrap();
        assert_eq!(on_disk.frontmatter.section_id, Some(sec.id.clone()));

        // Assert survives rebuild (rebuild repopulates tasks.section_id column).
        crate::ops::api::refresh(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let rows =
            crate::index::query::list_tasks(&conn, Some(&list_dto.id), None, None, false).unwrap();
        let row = rows.iter().find(|r| r.id == task.id()).unwrap();
        assert_eq!(row.section_id, Some(sec.id.clone()));
    }

    /// VG-P5: delete_section removes the SectionEntry AND clears section_id on affected tasks.
    #[test]
    fn vg_p5_delete_section_clears_affected_tasks() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Project".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        let sec = create_section(root, &list_dto.id, "Doing".to_string()).unwrap();

        // Create two tasks: one assigned to the section, one not.
        let t1 = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "In section".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(list_dto.id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        // Assign t1 to the section.
        crate::ops::tasks::edit_task(
            &cfg.tasks_dir(),
            t1.id(),
            crate::ops::tasks::EditTaskParams {
                title: None,
                priority: None,
                due: None,
                list: None,
                body: None,
                tags: None,
                section_id: Some(sec.id.clone()),
                clear_section: false,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        let t2 = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "No section".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(list_dto.id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        // Delete the section.
        delete_section(root, &list_dto.id, &sec.id).unwrap();

        // Assert: SectionEntry is gone from list file.
        let path = fs::find_list_path(&cfg.lists_dir(), &list_dto.id).unwrap();
        let on_disk = fs::read_list(&path).unwrap();
        assert!(
            on_disk.frontmatter.sections.is_empty(),
            "section must be removed"
        );

        // Assert: t1 now has section_id = None on disk (active clear).
        let t1_path = cfg.tasks_dir().join(format!("{}.md", t1.id()));
        let t1_disk = fs::read_task(&t1_path).unwrap();
        assert_eq!(
            t1_disk.frontmatter.section_id, None,
            "t1 section_id must be cleared (active clear)"
        );

        // Assert: t2 (no section) is unaffected.
        let t2_path = cfg.tasks_dir().join(format!("{}.md", t2.id()));
        let t2_disk = fs::read_task(&t2_path).unwrap();
        assert_eq!(
            t2_disk.frontmatter.section_id, None,
            "t2 was never assigned — still None"
        );

        // Assert: rebuild preserves cleared state.
        crate::ops::api::refresh(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let rows =
            crate::index::query::list_tasks(&conn, Some(&list_dto.id), None, None, false).unwrap();
        let t1_row = rows.iter().find(|r| r.id == t1.id()).unwrap();
        assert_eq!(
            t1_row.section_id, None,
            "t1 must resolve to No Section after rebuild"
        );
    }

    /// VG-P3: delete-list reassigns tasks to default and removes list file.
    #[test]
    fn vg_p3_delete_list_reassigns_tasks_to_inbox() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();
        ensure_default_list(&cfg.lists_dir()).unwrap();
        crate::ops::api::refresh(root).unwrap();

        // Create a new list.
        let list_dto = create_list(
            root,
            CreateListParams {
                name: "Work".to_string(),
                color: "sky".to_string(),
                icon: "list".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        let list_id = list_dto.id.clone();

        // Create a task in that list.
        let task = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Work task".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(list_id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        crate::ops::api::refresh(root).unwrap();

        // Delete the list.
        delete_list(root, &list_id).unwrap();

        // Assert: task file now has list: "inbox".
        let task_path = cfg.tasks_dir().join(format!("{}.md", task.frontmatter.id));
        let updated = fs::read_task(&task_path).unwrap();
        assert_eq!(
            updated.frontmatter.list, "inbox",
            "task must be reassigned to inbox after list deletion"
        );

        // Assert: list file is gone.
        let cfg2 = Config::load(root).unwrap();
        assert!(
            !cfg2.lists_dir().join(format!("{}.md", list_id)).exists(),
            "list file must be removed"
        );

        // Assert: index after rebuild also reflects reassignment.
        crate::ops::api::refresh(root).unwrap();
        let lists = list_lists(root).unwrap();
        assert!(
            !lists.iter().any(|l| l.id == list_id),
            "deleted list must not appear"
        );
        let inbox = lists.iter().find(|l| l.id == "inbox").unwrap();
        assert!(inbox.task_count >= 1, "inbox must have the reassigned task");
    }
}
