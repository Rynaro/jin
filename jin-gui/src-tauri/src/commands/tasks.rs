//! Task CRUD and state-machine commands.

use std::path::Path;

use serde::Deserialize;

use jin_core::dto::TaskDto;
use jin_core::model::task::Reminder;
use jin_core::model::{DueDate, Priority, TaskStatus};
use jin_core::ops::{api, tags as tags_ops, tasks};
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Input types ────────────────────────────────────────────────────────────────

/// P10: one reminder entry from the frontend.
#[derive(Debug, Deserialize)]
pub struct ReminderInput {
    pub kind: String,
    pub value: String,
}

impl From<ReminderInput> for Reminder {
    fn from(r: ReminderInput) -> Self {
        Reminder {
            kind: r.kind,
            value: r.value,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TaskInput {
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub priority: Option<String>,
    pub due: Option<String>,
    pub list: Option<String>,
    /// P4: initial tag slugs. Slugified before use.
    pub tags: Option<Vec<String>>,
    /// P10: initial reminders. `None` = use auto-reminder logic.
    #[serde(default)]
    pub reminders: Option<Vec<ReminderInput>>,
    /// S6: id of the parent task, if this is a subtask. `None` = top-level.
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EditTaskInput {
    pub title: Option<String>,
    pub priority: Option<String>,
    pub due: Option<String>,
    #[serde(default)]
    pub clear_due: bool,
    pub list: Option<String>,
    /// Task body (markdown). `Some(body)` updates; `None` leaves unchanged.
    pub body: Option<String>,
    /// P4: replace full tag list (`Some(slugs)` replaces; `None` leaves unchanged).
    pub tags: Option<Vec<String>>,
    /// P5: assign to a section (`Some(id)` = set; `None` = no change).
    pub section_id: Option<String>,
    /// P5: if true, clear section_id (set to None). Takes priority over section_id.
    #[serde(default)]
    pub clear_section: bool,
    /// P10: replace full reminder list (`Some(reminders)` replaces; `None` = no change).
    #[serde(default)]
    pub reminders: Option<Vec<ReminderInput>>,
    /// S6: reassign the parent (`Some(id)` = set). Omit (`None`) for no change.
    #[serde(default)]
    pub parent: Option<String>,
    /// S6: if true, detach from the parent (set parent = None). Takes priority
    /// over `parent` (mirrors the `clear_due` / `clear_section` idiom).
    #[serde(default)]
    pub clear_parent: bool,
}

/// P9: input for the atomic drag/drop move command.
#[derive(Debug, Deserialize)]
pub struct MoveTaskInput {
    pub list_id: String,
    pub section_id: Option<String>,
    /// Fractional position key (base-62). Must be non-empty.
    pub position: String,
}

/// P9: input for reseeding positions to the current display order.
#[derive(Debug, Deserialize)]
pub struct ReseedPositionsInput {
    pub list_id: String,
    pub section_id: Option<String>,
    /// Ordered list of task ids (top → bottom in the UI).
    pub ordered_ids: Vec<String>,
}

// ── Parse helpers ──────────────────────────────────────────────────────────────

fn parse_priority(s: &str) -> Result<Priority, JinErrorDto> {
    match s.to_ascii_lowercase().as_str() {
        "none" => Ok(Priority::None),
        "low" => Ok(Priority::Low),
        "medium" => Ok(Priority::Medium),
        "high" => Ok(Priority::High),
        _ => Err(JinErrorDto {
            code: 2,
            kind: "usage".to_string(),
            message: format!(
                "unknown priority '{}'; expected: none, low, medium, high",
                s
            ),
            retriable: false,
            details: None,
        }),
    }
}

fn parse_due(s: &str) -> Result<DueDate, JinErrorDto> {
    use chrono::{DateTime, FixedOffset, NaiveDate};
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Ok(DueDate::Date(d));
    }
    if let Ok(dt) = DateTime::<FixedOffset>::parse_from_rfc3339(s) {
        return Ok(DueDate::DateTime(dt));
    }
    Err(JinErrorDto {
        code: 2,
        kind: "usage".to_string(),
        message: format!(
            "invalid due date '{}'; expected YYYY-MM-DD or RFC 3339 datetime",
            s
        ),
        retriable: false,
        details: None,
    })
}

fn parse_status(s: &str) -> Result<TaskStatus, JinErrorDto> {
    match s.to_ascii_lowercase().as_str() {
        "todo" => Ok(TaskStatus::Todo),
        "doing" => Ok(TaskStatus::Doing),
        "done" => Ok(TaskStatus::Done),
        "cancelled" => Ok(TaskStatus::Cancelled),
        _ => Err(JinErrorDto {
            code: 2,
            kind: "usage".to_string(),
            message: format!(
                "unknown status '{}'; expected: todo, doing, done, cancelled",
                s
            ),
            retriable: false,
            details: None,
        }),
    }
}

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_tasks_fn(
    root: &Path,
    list: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    tag: Option<String>,
    include_deleted: bool,
) -> Result<Vec<TaskDto>, JinErrorDto> {
    api::list_tasks_with_tag(
        root,
        list.as_deref(),
        status.as_deref(),
        priority.as_deref(),
        tag.as_deref(),
        include_deleted,
    )
    .map_err(JinErrorDto::from)
}

pub fn get_task_fn(root: &Path, id: String) -> Result<TaskDto, JinErrorDto> {
    api::get_task(root, &id).map_err(JinErrorDto::from)
}

pub fn create_task_fn(root: &Path, input: TaskInput) -> Result<TaskDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let priority = input.priority.as_deref().map(parse_priority).transpose()?;
    let due = input.due.as_deref().map(parse_due).transpose()?;

    // P4: slugify and ensure tags exist before creating the task.
    let tags: Option<Vec<String>> = if let Some(ref raw_tags) = input.tags {
        let slugs: Vec<String> = raw_tags.iter().map(|t| tags_ops::slugify_tag(t)).collect();
        for slug in &slugs {
            tags_ops::ensure_tag(root, slug).map_err(JinErrorDto::from)?;
        }
        Some(slugs)
    } else {
        None
    };

    // P10: map ReminderInput → Reminder.
    let reminders: Option<Vec<Reminder>> = input
        .reminders
        .map(|rs| rs.into_iter().map(Reminder::from).collect());

    let task = tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: input.title,
            body: input.body,
            priority,
            due,
            list: input.list,
            tags,
            reminders,
            parent: input.parent,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(TaskDto::from_model(&task))
}

pub fn edit_task_fn(root: &Path, id: String, input: EditTaskInput) -> Result<TaskDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let priority = input.priority.as_deref().map(parse_priority).transpose()?;
    let due_param: Option<Option<DueDate>> = if input.clear_due {
        Some(None)
    } else if let Some(ref d) = input.due {
        Some(Some(parse_due(d)?))
    } else {
        None
    };

    // P4: slugify and ensure tags exist before editing.
    let tags: Option<Vec<String>> = if let Some(ref raw_tags) = input.tags {
        let slugs: Vec<String> = raw_tags.iter().map(|t| tags_ops::slugify_tag(t)).collect();
        for slug in &slugs {
            tags_ops::ensure_tag(root, slug).map_err(JinErrorDto::from)?;
        }
        Some(slugs)
    } else {
        None
    };

    // P10: map ReminderInput → Reminder.
    let reminders: Option<Vec<Reminder>> = input
        .reminders
        .map(|rs| rs.into_iter().map(Reminder::from).collect());

    // S6: `clear_parent` takes priority over `parent` (mirrors clear_due/clear_section).
    let parent_param: Option<Option<String>> = if input.clear_parent {
        Some(None)
    } else {
        input.parent.map(Some)
    };

    let task = tasks::edit_task(
        &cfg.tasks_dir(),
        &id,
        tasks::EditTaskParams {
            title: input.title,
            priority,
            due: due_param,
            list: input.list,
            body: input.body,
            tags,
            section_id: input.section_id,
            clear_section: input.clear_section,
            reminders,
            parent: parent_param,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(TaskDto::from_model(&task))
}

pub fn set_task_status_fn(root: &Path, id: String, status: String) -> Result<TaskDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let next = parse_status(&status)?;
    let task = tasks::transition_task(&cfg.tasks_dir(), &id, next).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(TaskDto::from_model(&task))
}

pub fn delete_task_fn(root: &Path, id: String) -> Result<TaskDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let task = tasks::delete_task(&cfg.tasks_dir(), &id).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(TaskDto::from_model(&task))
}

/// P9 — Atomic drag/drop: set list, section_id, and position in one file write.
pub fn move_task_fn(root: &Path, id: String, input: MoveTaskInput) -> Result<TaskDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let task = tasks::move_task(
        &cfg.tasks_dir(),
        &id,
        tasks::MoveTaskParams {
            list_id: input.list_id,
            section_id: input.section_id,
            position: input.position,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(TaskDto::from_model(&task))
}

/// P9 — Reseed positions for the current display order.
pub fn reseed_positions_fn(root: &Path, input: ReseedPositionsInput) -> Result<(), JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    tasks::reseed_positions(
        &cfg.tasks_dir(),
        &input.list_id,
        input.section_id.as_deref(),
        &input.ordered_ids,
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(())
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_tasks(
    state: tauri::State<'_, AppState>,
    list: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    tag: Option<String>,
    include_deleted: Option<bool>,
) -> Result<Vec<TaskDto>, JinErrorDto> {
    list_tasks_fn(
        &state.root,
        list,
        status,
        priority,
        tag,
        include_deleted.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn get_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<TaskDto, JinErrorDto> {
    get_task_fn(&state.root, id)
}

#[tauri::command]
pub async fn create_task(
    state: tauri::State<'_, AppState>,
    input: TaskInput,
) -> Result<TaskDto, JinErrorDto> {
    let task = create_task_fn(&state.root, input)?;
    state.wake_reminders();
    Ok(task)
}

#[tauri::command]
pub async fn edit_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: EditTaskInput,
) -> Result<TaskDto, JinErrorDto> {
    let task = edit_task_fn(&state.root, id, input)?;
    state.wake_reminders();
    Ok(task)
}

#[tauri::command]
pub async fn set_task_status(
    state: tauri::State<'_, AppState>,
    id: String,
    status: String,
) -> Result<TaskDto, JinErrorDto> {
    let task = set_task_status_fn(&state.root, id, status)?;
    state.wake_reminders();
    Ok(task)
}

#[tauri::command]
pub async fn delete_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<TaskDto, JinErrorDto> {
    let task = delete_task_fn(&state.root, id)?;
    state.wake_reminders();
    Ok(task)
}

#[tauri::command]
pub async fn move_task(
    state: tauri::State<'_, AppState>,
    id: String,
    input: MoveTaskInput,
) -> Result<TaskDto, JinErrorDto> {
    move_task_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn reseed_positions(
    state: tauri::State<'_, AppState>,
    input: ReseedPositionsInput,
) -> Result<(), JinErrorDto> {
    reseed_positions_fn(&state.root, input)
}
