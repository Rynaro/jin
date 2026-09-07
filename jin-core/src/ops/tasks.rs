use chrono::Local;
use std::path::Path;

use crate::id::new_ulid;
use crate::model::task::Reminder;
use crate::model::{DueDate, Priority, Task, TaskFrontmatter, TaskStatus};
use crate::store::fs;
use crate::{JinError, Result};

/// Parameters for editing an existing task.
/// `None` fields are left unchanged; `Some` fields are applied.
/// For `due`, use `Some(None)` to clear the due date.
#[derive(Default)]
pub struct EditTaskParams {
    pub title: Option<String>,
    pub priority: Option<Priority>,
    /// `Some(Some(d))` = set due, `Some(None)` = clear due, `None` = no change.
    pub due: Option<Option<DueDate>>,
    pub list: Option<String>,
    pub body: Option<String>,
    /// P4: set full tag list (`Some(slugs)` replaces; `None` leaves unchanged).
    pub tags: Option<Vec<String>>,
    /// P5: `Some(id)` = assign to section; `None` = no change.
    /// Use `clear_section = true` to explicitly clear (set section_id = None).
    pub section_id: Option<String>,
    /// P5: if `true`, set section_id = None regardless of `section_id` field.
    pub clear_section: bool,
    /// P10: replace full reminder list (`Some(reminders)` replaces; `None` leaves unchanged).
    pub reminders: Option<Vec<Reminder>>,
    /// S6: reassign the parent. `Some(Some(id))` = set parent to `id`;
    /// `Some(None)` = detach (clear parent, mirrors the `due` idiom); `None` =
    /// no change. Validated by `validate_parent_assignment` (self-parenting,
    /// missing parent, and depth ≥ 2 are all rejected).
    pub parent: Option<Option<String>>,
}

#[derive(Default)]
pub struct CreateTaskParams {
    pub title: String,
    pub body: String,
    pub priority: Option<Priority>,
    pub due: Option<DueDate>,
    pub list: Option<String>,
    /// P4: initial tag slugs (empty = no tags).
    pub tags: Option<Vec<String>>,
    /// P10: initial reminders (empty = no reminders).
    pub reminders: Option<Vec<Reminder>>,
    /// S6: id of the parent task, if this is a subtask. `None` = top-level.
    /// Validated by `validate_parent_for_create` (missing parent, depth ≥ 2).
    pub parent: Option<String>,
}

/// Parameters for the atomic drag/drop move operation (P9).
pub struct MoveTaskParams {
    /// Target list id. Always specified (definite target).
    pub list_id: String,
    /// Target section id. None = "No Section".
    pub section_id: Option<String>,
    /// New fractional position key (base-62). Must be non-empty.
    pub position: String,
}

/// Create a new Task, write to disk.
pub fn create_task(tasks_dir: &Path, params: CreateTaskParams) -> Result<Task> {
    // S6: validate the parent BEFORE anything is written — a rejection must
    // leave no file behind.
    if let Some(ref parent_id) = params.parent {
        validate_parent_for_create(tasks_dir, parent_id)?;
    }

    let now = Local::now().fixed_offset();
    let id = new_ulid();

    // P10: auto-reminder: when a due *time* is set and no reminders provided,
    // default one reminder at the due time.
    let reminders = match params.reminders {
        Some(r) => r,
        None => auto_reminder_if_time(&params.due),
    };

    let fm = TaskFrontmatter {
        id,
        kind: "task".to_string(),
        title: params.title,
        created: now,
        updated: now,
        status: TaskStatus::Todo,
        priority: params.priority.unwrap_or_default(),
        due: params.due,
        list: params.list.unwrap_or_else(|| "inbox".to_string()),
        completed_at: None,
        deleted_at: None,
        links: vec![],
        // P2 fields: default values for newly created tasks.
        section_id: None,
        tags: params.tags.unwrap_or_default(),
        position: String::new(),
        reminders,
        parent: params.parent,
        agenda_bucket: None,
    };
    let task = Task {
        frontmatter: fm,
        body: params.body,
    };
    fs::write_task(tasks_dir, &task)?;
    Ok(task)
}

/// Read a Task by id.
pub fn get_task(tasks_dir: &Path, id: &str) -> Result<Task> {
    let path = fs::find_task_path(tasks_dir, id)?;
    fs::read_task(&path)
}

/// List tasks with optional filters.
pub fn list_tasks(
    tasks_dir: &Path,
    list_filter: Option<&str>,
    status_filter: Option<&TaskStatus>,
    include_deleted: bool,
) -> Result<Vec<Task>> {
    let paths = fs::list_task_paths(tasks_dir)?;
    let mut tasks = Vec::new();
    for path in &paths {
        let task = fs::read_task(path)?;
        if !include_deleted && task.is_deleted() {
            continue;
        }
        if let Some(lf) = list_filter {
            if task.frontmatter.list != lf {
                continue;
            }
        }
        if let Some(sf) = status_filter {
            if &task.frontmatter.status != sf {
                continue;
            }
        }
        tasks.push(task);
    }
    tasks.sort_by(|a, b| a.id().cmp(b.id()));
    Ok(tasks)
}

/// Apply a status transition, writing file first then returning updated Task.
///
/// S6 rollup (Approach §6): completing (`done`) or cancelling (`cancelled`) a
/// parent cascades down to every child currently in `todo`/`doing`. Reopening
/// a parent (`-> todo`) does NOT reverse-cascade — children stay as they are.
/// The cascade writes children FIRST and the parent LAST: a crash mid-cascade
/// therefore leaves the parent open (recoverable by re-completing) rather than
/// a completed parent with open children (AC-S6-05's CONSTRAINT).
pub fn transition_task(tasks_dir: &Path, id: &str, next: TaskStatus) -> Result<Task> {
    let path = fs::find_task_path(tasks_dir, id)?;
    let mut task = fs::read_task(&path)?;
    let current = task.frontmatter.status.clone();

    if !current.can_transition_to(&next) {
        return Err(JinError::InvalidStateTransition {
            from: current.to_string(),
            to: next.to_string(),
        });
    }

    // Children first (AC-S6-05 / AC-S6-05b): only `done`/`cancelled` cascade;
    // reopening never does (AC-S6-06), and children never bubble up to
    // auto-complete the parent (AC-S6-07 — this fn never runs for the parent
    // as a side effect of a CHILD's own transition).
    if matches!(next, TaskStatus::Done | TaskStatus::Cancelled) {
        cascade_status_to_children(tasks_dir, id, &next)?;
    }

    let now = Local::now().fixed_offset();
    if next == TaskStatus::Done {
        task.frontmatter.completed_at = Some(now);
    } else if next == TaskStatus::Todo {
        // reopen
        task.frontmatter.completed_at = None;
    }
    task.frontmatter.status = next;
    if matches!(
        task.frontmatter.status,
        TaskStatus::Done | TaskStatus::Cancelled | TaskStatus::Deleted
    ) {
        task.frontmatter.agenda_bucket = None;
    }
    task.frontmatter.updated = now;
    fs::write_task(tasks_dir, &task)?;
    Ok(task)
}

/// S6 — cascade a parent's `done`/`cancelled` transition down to every child
/// currently in `todo` or `doing`. Depth is capped at one (a subtask cannot
/// itself have children — enforced at parent-assignment time), so this never
/// recurses past one level in practice; it goes through the same FSM-checked
/// `transition_task` path so `completed_at` bookkeeping stays correct on the
/// child too.
fn cascade_status_to_children(tasks_dir: &Path, parent_id: &str, next: &TaskStatus) -> Result<()> {
    for child in find_children(tasks_dir, parent_id, false)? {
        if matches!(
            child.frontmatter.status,
            TaskStatus::Todo | TaskStatus::Doing
        ) {
            transition_task(tasks_dir, child.id(), next.clone())?;
        }
    }
    Ok(())
}

/// Edit mutable fields of an existing task. File is written first, then
/// `updated` is bumped. Returns the updated Task.
/// Returns an error if the task is deleted or not found.
///
/// S6: `params.parent` reassignment is validated (self-parenting, missing
/// parent, depth ≥ 2) BEFORE anything is mutated — a rejection leaves the
/// file untouched. A `list`/`section_id` change cascades to every child
/// (Approach §6: "a subtask lives with its parent"), written FIRST, parent
/// LAST — the same crash-safety ordering as the status rollup.
pub fn edit_task(tasks_dir: &Path, id: &str, params: EditTaskParams) -> Result<Task> {
    let path = fs::find_task_path(tasks_dir, id)?;
    let mut task = fs::read_task(&path)?;
    if task.is_deleted() {
        return Err(JinError::NotFound(format!("task/{} is deleted", id)));
    }

    if let Some(Some(ref new_parent)) = params.parent {
        validate_parent_assignment(tasks_dir, id, new_parent)?;
    }

    let list_before = task.frontmatter.list.clone();
    let section_before = task.frontmatter.section_id.clone();

    let mut changed = false;

    if let Some(title) = params.title {
        task.frontmatter.title = title;
        changed = true;
    }
    if let Some(priority) = params.priority {
        task.frontmatter.priority = priority;
        changed = true;
    }
    if let Some(due) = params.due {
        // Explicit reminder replacement always wins. Otherwise keep the one
        // generated absolute reminder coupled to the due-time lifecycle while
        // preserving every custom/nonmatching reminder.
        if params.reminders.is_none() {
            let old_due = task.frontmatter.due.clone();
            reconcile_auto_due_reminder(&mut task.frontmatter.reminders, &old_due, &due);
        }
        task.frontmatter.due = due;
        changed = true;
    }
    if let Some(list) = params.list {
        task.frontmatter.list = list;
        changed = true;
    }
    if let Some(body) = params.body {
        task.body = body;
        changed = true;
    }
    if let Some(tags) = params.tags {
        task.frontmatter.tags = tags;
        changed = true;
    }
    // P5: section assignment (clear takes priority over assignment)
    if params.clear_section {
        task.frontmatter.section_id = None;
        changed = true;
    } else if let Some(sid) = params.section_id {
        task.frontmatter.section_id = Some(sid);
        changed = true;
    }
    // P10: reminders passthrough (None = no change)
    if let Some(reminders) = params.reminders {
        task.frontmatter.reminders = reminders;
        changed = true;
    }
    // S6: parent reassignment (already validated above). `Some(Some(id))` =
    // set; `Some(None)` = detach; `None` = no change (mirrors the `due` idiom).
    if let Some(parent) = params.parent {
        task.frontmatter.parent = parent;
        changed = true;
    }

    if changed {
        // S6: a placement change (list and/or section) cascades to children
        // FIRST — they must live wherever their parent ends up, and the
        // parent write happens last (crash-safety, same ordering as the
        // status rollup).
        let placement_changed =
            task.frontmatter.list != list_before || task.frontmatter.section_id != section_before;
        if placement_changed {
            cascade_placement_to_children(
                tasks_dir,
                id,
                &task.frontmatter.list,
                task.frontmatter.section_id.as_deref(),
            )?;
        }

        let now = Local::now().fixed_offset();
        task.frontmatter.updated = now;
        fs::write_task(tasks_dir, &task)?;
    }

    Ok(task)
}

/// S6 — cascade a parent's new `list`/`section_id` down to every child (a
/// subtask lives with its parent, Approach §6). Children are written before
/// this is called by the caller writing the parent, matching the
/// children-first / parent-last ordering used by the status rollup.
fn cascade_placement_to_children(
    tasks_dir: &Path,
    parent_id: &str,
    new_list: &str,
    new_section_id: Option<&str>,
) -> Result<()> {
    for mut child in find_children(tasks_dir, parent_id, false)? {
        child.frontmatter.list = new_list.to_string();
        child.frontmatter.section_id = new_section_id.map(|s| s.to_string());
        child.frontmatter.updated = Local::now().fixed_offset();
        fs::write_task(tasks_dir, &child)?;
    }
    Ok(())
}

/// Soft-delete a task.
///
/// S6 (AC-S6-09): soft-deleting a parent cascades to every child — children
/// are soft-deleted FIRST, the parent LAST (same crash-safety ordering as the
/// status rollup: a crash mid-cascade leaves the parent recoverable rather
/// than a deleted parent with live children).
pub fn delete_task(tasks_dir: &Path, id: &str) -> Result<Task> {
    let path = fs::find_task_path(tasks_dir, id)?;
    let mut task = fs::read_task(&path)?;
    if task.is_deleted() {
        return Err(JinError::NotFound(format!("task/{} already deleted", id)));
    }

    for child in find_children(tasks_dir, id, false)? {
        delete_task(tasks_dir, child.id())?;
    }

    let now = Local::now().fixed_offset();
    task.frontmatter.status = TaskStatus::Deleted;
    task.frontmatter.agenda_bucket = None;
    task.frontmatter.deleted_at = Some(now);
    task.frontmatter.updated = now;
    fs::write_task(tasks_dir, &task)?;
    Ok(task)
}

/// P9 — Atomic drag/drop: set list, section_id, and position in ONE file write.
///
/// Handles within-section reorder, cross-section move, and cross-list move identically.
/// The caller is responsible for computing a valid non-empty `position` key via `order::between`.
pub fn move_task(tasks_dir: &Path, id: &str, params: MoveTaskParams) -> Result<Task> {
    let path = fs::find_task_path(tasks_dir, id)?;
    let mut task = fs::read_task(&path)?;
    if task.is_deleted() {
        return Err(JinError::NotFound(format!("task/{} is deleted", id)));
    }
    let now = Local::now().fixed_offset();
    task.frontmatter.list = params.list_id;
    task.frontmatter.section_id = params.section_id;
    task.frontmatter.position = params.position;
    task.frontmatter.updated = now;
    fs::write_task(tasks_dir, &task)?;
    Ok(task)
}

/// P9 — Reseed positions for the given ordered list of task ids.
///
/// Assigns evenly-spaced fractional rank keys to `ordered_ids` in one pass using
/// repeated `order::between(prev, None)` (append mode). Used ONLY on the auto→manual
/// sort-mode flip so the drag operates on what the user currently sees.
pub fn reseed_positions(
    tasks_dir: &Path,
    list_id: &str,
    section_id: Option<&str>,
    ordered_ids: &[String],
) -> Result<()> {
    use crate::order::between;
    let mut prev: Option<String> = None;
    for task_id in ordered_ids {
        let path = fs::find_task_path(tasks_dir, task_id)?;
        let mut task = fs::read_task(&path)?;
        if task.is_deleted() {
            continue;
        }
        let now = Local::now().fixed_offset();
        let new_pos = between(prev.as_deref(), None);
        task.frontmatter.position = new_pos.clone();
        task.frontmatter.list = list_id.to_string();
        task.frontmatter.section_id = section_id.map(|s| s.to_string());
        task.frontmatter.updated = now;
        fs::write_task(tasks_dir, &task)?;
        prev = Some(new_pos);
    }
    Ok(())
}

// ── P10 helpers ───────────────────────────────────────────────────────────────

/// Returns a single absolute reminder at the due time if the due date has a time
/// component and no reminders were explicitly provided.
///
/// This is the "sensible default auto-reminder" (spec §1.8): when a task gets a
/// due *time* (not just a date), we add a reminder at that exact time so the user
/// is notified at the moment the task is due.
fn auto_reminder_if_time(due: &Option<DueDate>) -> Vec<Reminder> {
    match due {
        Some(DueDate::DateTime(dt)) => vec![Reminder {
            kind: "absolute".to_string(),
            value: dt.to_rfc3339(),
        }],
        _ => vec![],
    }
}

/// Reconcile the default absolute reminder when an edit changes the due value.
///
/// With no provenance field on `Reminder`, the generated reminder is identified
/// narrowly as the first absolute reminder whose value exactly matches the old
/// timed due. Nonmatching reminders are never altered. A task without reminders
/// still gains the default when it first receives a timed due.
fn reconcile_auto_due_reminder(
    reminders: &mut Vec<Reminder>,
    old_due: &Option<DueDate>,
    new_due: &Option<DueDate>,
) {
    let old_value = match old_due {
        Some(DueDate::DateTime(dt)) => Some(dt.to_rfc3339()),
        _ => None,
    };
    let matching_index = old_value.as_ref().and_then(|value| {
        reminders
            .iter()
            .position(|reminder| reminder.kind == "absolute" && reminder.value == *value)
    });

    if let Some(index) = matching_index {
        match new_due {
            Some(DueDate::DateTime(dt)) => reminders[index].value = dt.to_rfc3339(),
            _ => {
                reminders.remove(index);
            }
        }
        return;
    }

    if reminders.is_empty() {
        reminders.extend(auto_reminder_if_time(new_due));
    }
}

// ── S6 helpers: subtasks ────────────────────────────────────────────────────

/// Find all direct children of `parent_id` (S6). Depth is capped at one, so a
/// child never has children of its own — this is a flat, one-level lookup, no
/// recursion. A plain filesystem scan, consistent with the rest of this
/// module (`list_tasks` above) — no index dependency at the ops layer.
fn find_children(tasks_dir: &Path, parent_id: &str, include_deleted: bool) -> Result<Vec<Task>> {
    let paths = fs::list_task_paths(tasks_dir)?;
    let mut children = Vec::new();
    for path in &paths {
        let task = fs::read_task(path)?;
        if task.frontmatter.parent.as_deref() == Some(parent_id)
            && (include_deleted || !task.is_deleted())
        {
            children.push(task);
        }
    }
    Ok(children)
}

/// S6 — validate a `parent` assignment made at CREATE time: the parent must
/// exist, and it must not itself have a parent (depth ≥ 2 is rejected). A
/// freshly-generated id cannot collide with an existing task, so self-parenting
/// cannot occur on create.
fn validate_parent_for_create(tasks_dir: &Path, parent_id: &str) -> Result<()> {
    let parent_path = fs::find_task_path(tasks_dir, parent_id)
        .map_err(|_| JinError::InvalidInput(format!("parent task {} does not exist", parent_id)))?;
    let parent_task = fs::read_task(&parent_path)?;
    if parent_task.frontmatter.parent.is_some() {
        return Err(JinError::InvalidInput(format!(
            "parent task {} is itself a subtask; a task may not be nested more than one level deep",
            parent_id
        )));
    }
    Ok(())
}

/// S6 — validate a `parent` assignment made at EDIT time: rejects
/// self-parenting, a missing parent, the parent itself being a subtask
/// (depth ≥ 2 one direction), and `task_id` already having children of its
/// own (depth ≥ 2 the other direction — a task with subtasks cannot become a
/// subtask itself).
fn validate_parent_assignment(tasks_dir: &Path, task_id: &str, parent_id: &str) -> Result<()> {
    if parent_id == task_id {
        return Err(JinError::InvalidInput(format!(
            "task {} cannot be its own parent",
            task_id
        )));
    }
    let parent_path = fs::find_task_path(tasks_dir, parent_id)
        .map_err(|_| JinError::InvalidInput(format!("parent task {} does not exist", parent_id)))?;
    let parent_task = fs::read_task(&parent_path)?;
    if parent_task.frontmatter.parent.is_some() {
        return Err(JinError::InvalidInput(format!(
            "parent task {} is itself a subtask; a task may not be nested more than one level deep",
            parent_id
        )));
    }
    if !find_children(tasks_dir, task_id, false)?.is_empty() {
        return Err(JinError::InvalidInput(format!(
            "task {} already has subtasks; a task with subtasks cannot itself become a subtask",
            task_id
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! S6 — `ops/tasks.rs` had ZERO in-file unit tests before this story
    //! (task behavior was pinned only indirectly through the CLI suite in
    //! `jin/tests/`). This module pins every rollup rule from Approach §6 —
    //! a story deliverable per the S6 action plan (item 8), not a nice-to-have:
    //! the cascades are the part of this wave most likely to be silently wrong.

    use super::*;
    use tempfile::TempDir;

    /// Fresh temp `tasks/` dir for one test. The `TempDir` guard must be kept
    /// alive for the test's duration (dropping it deletes the directory).
    fn setup() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();
        (tmp, tasks_dir)
    }

    fn create(tasks_dir: &Path, title: &str, parent: Option<String>) -> Task {
        create_task(
            tasks_dir,
            CreateTaskParams {
                title: title.to_string(),
                parent,
                ..Default::default()
            },
        )
        .unwrap()
    }

    fn create_in_list(tasks_dir: &Path, title: &str, list: &str) -> Task {
        create_task(
            tasks_dir,
            CreateTaskParams {
                title: title.to_string(),
                list: Some(list.to_string()),
                ..Default::default()
            },
        )
        .unwrap()
    }

    fn mark_flexible(tasks_dir: &Path, task: &mut Task) {
        task.frontmatter.agenda_bucket = Some(crate::model::AgendaBucket::Flexible);
        fs::write_task(tasks_dir, task).unwrap();
    }

    fn datetime(value: &str) -> DueDate {
        DueDate::DateTime(chrono::DateTime::parse_from_rfc3339(value).unwrap())
    }

    fn date(value: &str) -> DueDate {
        DueDate::Date(chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
    }

    fn create_timed(tasks_dir: &Path, due: &str) -> Task {
        create_task(
            tasks_dir,
            CreateTaskParams {
                title: "Timed".to_string(),
                due: Some(datetime(due)),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn timed_due_edit_moves_matching_auto_reminder() {
        let (_tmp, tasks_dir) = setup();
        let task = create_timed(&tasks_dir, "2026-09-01T09:00:00-03:00");

        let edited = edit_task(
            &tasks_dir,
            task.id(),
            EditTaskParams {
                due: Some(Some(datetime("2026-09-02T14:30:00-03:00"))),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(edited.frontmatter.reminders.len(), 1);
        assert_eq!(edited.frontmatter.reminders[0].kind, "absolute");
        assert_eq!(
            edited.frontmatter.reminders[0].value,
            "2026-09-02T14:30:00-03:00"
        );
    }

    #[test]
    fn timed_due_to_date_removes_matching_auto_reminder() {
        let (_tmp, tasks_dir) = setup();
        let task = create_timed(&tasks_dir, "2026-09-01T09:00:00-03:00");

        let edited = edit_task(
            &tasks_dir,
            task.id(),
            EditTaskParams {
                due: Some(Some(date("2026-09-02"))),
                ..Default::default()
            },
        )
        .unwrap();

        assert!(edited.frontmatter.reminders.is_empty());
    }

    #[test]
    fn clearing_timed_due_removes_matching_auto_reminder() {
        let (_tmp, tasks_dir) = setup();
        let task = create_timed(&tasks_dir, "2026-09-01T09:00:00-03:00");

        let edited = edit_task(
            &tasks_dir,
            task.id(),
            EditTaskParams {
                due: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

        assert!(edited.frontmatter.reminders.is_empty());
    }

    #[test]
    fn due_edit_preserves_custom_and_nonmatching_reminders() {
        let (_tmp, tasks_dir) = setup();
        let mut task = create_timed(&tasks_dir, "2026-09-01T09:00:00-03:00");
        task.frontmatter.reminders.push(Reminder {
            kind: "relative".to_string(),
            value: "-1h".to_string(),
        });
        task.frontmatter.reminders.push(Reminder {
            kind: "absolute".to_string(),
            value: "2026-08-31T17:00:00-03:00".to_string(),
        });
        fs::write_task(&tasks_dir, &task).unwrap();

        let edited = edit_task(
            &tasks_dir,
            task.id(),
            EditTaskParams {
                due: Some(Some(datetime("2026-09-03T11:00:00-03:00"))),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(edited.frontmatter.reminders.len(), 3);
        assert_eq!(
            edited.frontmatter.reminders[0].value,
            "2026-09-03T11:00:00-03:00"
        );
        assert_eq!(edited.frontmatter.reminders[1].kind, "relative");
        assert_eq!(edited.frontmatter.reminders[1].value, "-1h");
        assert_eq!(
            edited.frontmatter.reminders[2].value,
            "2026-08-31T17:00:00-03:00"
        );
    }

    #[test]
    fn explicit_reminders_replace_auto_reconciliation_result() {
        let (_tmp, tasks_dir) = setup();
        let task = create_timed(&tasks_dir, "2026-09-01T09:00:00-03:00");
        let explicit = vec![Reminder {
            kind: "relative".to_string(),
            value: "-30m".to_string(),
        }];

        let edited = edit_task(
            &tasks_dir,
            task.id(),
            EditTaskParams {
                due: Some(Some(datetime("2026-09-04T16:00:00-03:00"))),
                reminders: Some(explicit),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(edited.frontmatter.reminders.len(), 1);
        assert_eq!(edited.frontmatter.reminders[0].kind, "relative");
        assert_eq!(edited.frontmatter.reminders[0].value, "-30m");
    }

    #[test]
    fn completion_clears_flexible() {
        let (_tmp, tasks_dir) = setup();
        let mut task = create(&tasks_dir, "Flexible", None);
        mark_flexible(&tasks_dir, &mut task);
        let done = transition_task(&tasks_dir, task.id(), TaskStatus::Done).unwrap();
        assert!(done.frontmatter.agenda_bucket.is_none());
    }

    #[test]
    fn inactive_clears_flexible() {
        for delete in [false, true] {
            let (_tmp, tasks_dir) = setup();
            let mut task = create(&tasks_dir, "Flexible", None);
            mark_flexible(&tasks_dir, &mut task);
            let inactive = if delete {
                delete_task(&tasks_dir, task.id()).unwrap()
            } else {
                transition_task(&tasks_dir, task.id(), TaskStatus::Cancelled).unwrap()
            };
            assert!(inactive.frontmatter.agenda_bucket.is_none());
        }
    }

    // ── AC-S6-02 ────────────────────────────────────────────────────────────

    /// subtask_depth_is_capped_at_one — a task whose parent (B) is itself a
    /// subtask (of A) cannot be created: `create_task` rejects depth ≥ 2 and
    /// writes no file for the rejected task.
    #[test]
    fn subtask_depth_is_capped_at_one() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string()));

        let result = create_task(
            &tasks_dir,
            CreateTaskParams {
                title: "C".to_string(),
                parent: Some(b.id().to_string()),
                ..Default::default()
            },
        );
        assert!(
            result.is_err(),
            "creating C with parent=B (B is itself a subtask of A — depth 2) must be rejected"
        );

        let paths = fs::list_task_paths(&tasks_dir).unwrap();
        assert_eq!(
            paths.len(),
            2,
            "only A and B may exist on disk — C's file must not be written"
        );
    }

    // ── AC-S6-03 ────────────────────────────────────────────────────────────

    /// self_parenting_is_rejected — `edit_task` refuses to set a task as its
    /// own parent, and the file is left unchanged.
    #[test]
    fn self_parenting_is_rejected() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);

        let result = edit_task(
            &tasks_dir,
            a.id(),
            EditTaskParams {
                parent: Some(Some(a.id().to_string())),
                ..Default::default()
            },
        );
        assert!(
            result.is_err(),
            "setting A's parent to itself must be rejected"
        );

        let reloaded = get_task(&tasks_dir, a.id()).unwrap();
        assert!(
            reloaded.frontmatter.parent.is_none(),
            "A's parent must remain None after the rejected edit"
        );
    }

    // ── AC-S6-05 ────────────────────────────────────────────────────────────

    /// parent_completion_cascades_to_open_children — A -> done cascades both
    /// an open `todo` child and an open `doing` child down to `done`.
    #[test]
    fn parent_completion_cascades_to_open_children() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string())); // todo
        let c = create(&tasks_dir, "C", Some(a.id().to_string()));
        transition_task(&tasks_dir, c.id(), TaskStatus::Doing).unwrap(); // doing

        transition_task(&tasks_dir, a.id(), TaskStatus::Done).unwrap();

        let b2 = get_task(&tasks_dir, b.id()).unwrap();
        let c2 = get_task(&tasks_dir, c.id()).unwrap();
        assert_eq!(
            b2.frontmatter.status,
            TaskStatus::Done,
            "todo child must cascade to done"
        );
        assert_eq!(
            c2.frontmatter.status,
            TaskStatus::Done,
            "doing child must cascade to done"
        );
        assert!(
            b2.frontmatter.completed_at.is_some(),
            "cascaded child must get completed_at set (same FSM path as a direct transition)"
        );
    }

    // ── AC-S6-05b ───────────────────────────────────────────────────────────

    /// parent_cancellation_cascades_to_open_children — the exact parallel of
    /// AC-S6-05 for `cancelled` rather than `done`. Exists specifically
    /// because an implementation that cascades on `done` and forgets
    /// `cancelled` would otherwise stay green against AC-S6-05 alone.
    #[test]
    fn parent_cancellation_cascades_to_open_children() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string())); // todo
        let c = create(&tasks_dir, "C", Some(a.id().to_string()));
        transition_task(&tasks_dir, c.id(), TaskStatus::Doing).unwrap(); // doing

        transition_task(&tasks_dir, a.id(), TaskStatus::Cancelled).unwrap();

        let b2 = get_task(&tasks_dir, b.id()).unwrap();
        let c2 = get_task(&tasks_dir, c.id()).unwrap();
        assert_eq!(
            b2.frontmatter.status,
            TaskStatus::Cancelled,
            "todo child must cascade to cancelled"
        );
        assert_eq!(
            c2.frontmatter.status,
            TaskStatus::Cancelled,
            "doing child must cascade to cancelled"
        );
    }

    // ── AC-S6-06 ────────────────────────────────────────────────────────────

    /// parent_reopen_does_not_reopen_children — reopening a `done` parent
    /// (`-> todo`) does NOT reverse-cascade; children already `done` stay `done`.
    #[test]
    fn parent_reopen_does_not_reopen_children() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string()));
        let c = create(&tasks_dir, "C", Some(a.id().to_string()));
        transition_task(&tasks_dir, b.id(), TaskStatus::Done).unwrap();
        transition_task(&tasks_dir, c.id(), TaskStatus::Done).unwrap();
        transition_task(&tasks_dir, a.id(), TaskStatus::Done).unwrap();

        transition_task(&tasks_dir, a.id(), TaskStatus::Todo).unwrap(); // reopen

        let b2 = get_task(&tasks_dir, b.id()).unwrap();
        let c2 = get_task(&tasks_dir, c.id()).unwrap();
        assert_eq!(
            b2.frontmatter.status,
            TaskStatus::Done,
            "children must NOT reverse-cascade when the parent is reopened"
        );
        assert_eq!(c2.frontmatter.status, TaskStatus::Done);
    }

    // ── AC-S6-07 ────────────────────────────────────────────────────────────

    /// children_completion_never_auto_completes_parent — all children
    /// reaching `done` does NOT auto-complete the parent; it stays `todo`.
    #[test]
    fn children_completion_never_auto_completes_parent() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string()));
        let c = create(&tasks_dir, "C", Some(a.id().to_string()));

        transition_task(&tasks_dir, b.id(), TaskStatus::Done).unwrap();
        transition_task(&tasks_dir, c.id(), TaskStatus::Done).unwrap();

        let a2 = get_task(&tasks_dir, a.id()).unwrap();
        assert_eq!(
            a2.frontmatter.status,
            TaskStatus::Todo,
            "parent must NOT auto-complete when every child reaches done"
        );
    }

    // ── AC-S6-08 ────────────────────────────────────────────────────────────

    /// child_list_follows_parent_list_change — editing the parent's `list`
    /// cascades the new list to the child ("a subtask lives with its parent").
    #[test]
    fn child_list_follows_parent_list_change() {
        let (_tmp, tasks_dir) = setup();
        let a = create_in_list(&tasks_dir, "A", "list-1");
        // The child starts in the same list as its parent (the caller's job at
        // creation time — core does not auto-derive it); this test's subject is
        // the CASCADE on a subsequent parent list change, not initial placement.
        let b = create_task(
            &tasks_dir,
            CreateTaskParams {
                title: "B".to_string(),
                parent: Some(a.id().to_string()),
                list: Some("list-1".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(b.frontmatter.list, "list-1");

        edit_task(
            &tasks_dir,
            a.id(),
            EditTaskParams {
                list: Some("list-2".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let b2 = get_task(&tasks_dir, b.id()).unwrap();
        assert_eq!(
            b2.frontmatter.list, "list-2",
            "child's list must follow the parent's list change"
        );
    }

    // ── AC-S6-09 ────────────────────────────────────────────────────────────

    /// parent_delete_cascades_to_children — soft-deleting a parent cascades
    /// the soft-delete to its children.
    #[test]
    fn parent_delete_cascades_to_children() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let b = create(&tasks_dir, "B", Some(a.id().to_string()));

        delete_task(&tasks_dir, a.id()).unwrap();

        let b2 = get_task(&tasks_dir, b.id()).unwrap();
        assert!(
            b2.is_deleted(),
            "child must be soft-deleted when its parent is soft-deleted"
        );
    }

    // ── Additional depth-invariant coverage (not separately ACed, but the
    //    spec's general statement — "Core rejects self-parenting, cycles, and
    //    depth ≥ 2" — is bidirectional) ────────────────────────────────────

    /// A task that already has children cannot itself become a subtask (the
    /// other direction of the depth-≥2 invariant from AC-S6-02).
    #[test]
    fn a_task_with_children_cannot_become_a_subtask() {
        let (_tmp, tasks_dir) = setup();
        let a = create(&tasks_dir, "A", None);
        let _b = create(&tasks_dir, "B", Some(a.id().to_string()));
        let x = create(&tasks_dir, "X", None);

        let result = edit_task(
            &tasks_dir,
            a.id(),
            EditTaskParams {
                parent: Some(Some(x.id().to_string())),
                ..Default::default()
            },
        );
        assert!(
            result.is_err(),
            "A already has a child (B); A cannot become a subtask of X"
        );
    }

    /// Assigning a parent that does not exist is rejected (not a panic).
    #[test]
    fn parent_must_exist() {
        let (_tmp, tasks_dir) = setup();
        let result = create_task(
            &tasks_dir,
            CreateTaskParams {
                title: "Orphan".to_string(),
                parent: Some("does-not-exist".to_string()),
                ..Default::default()
            },
        );
        assert!(result.is_err(), "a nonexistent parent id must be rejected");
    }
}
