use serde::{Deserialize, Serialize};

use crate::index::query::{BacklinkRow, TaskRow};
use crate::model::task::{Reminder, Task};

/// DTO projection of a Reminder (mirrors `model::task::Reminder`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderDto {
    pub kind: String,
    pub value: String,
}

impl ReminderDto {
    fn from_model(r: &Reminder) -> Self {
        Self {
            kind: r.kind.clone(),
            value: r.value.clone(),
        }
    }
}

/// DTO projection of a Task.
///
/// `body` is populated on the `get_task` path (reads the full file from disk).
/// It is left as an empty string on the `list_tasks` path (index rows don't store body)
/// to keep list queries light.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due: Option<String>,
    pub list: String,
    pub completed_at: Option<String>,
    pub deleted_at: Option<String>,
    pub created: String,
    pub updated: String,
    pub backlinks: Vec<TaskBacklinkDto>,
    /// Task body (markdown). Populated on `get_task`; empty string on `list_tasks`.
    pub body: String,
    // P2 fields
    pub section_id: Option<String>,
    pub tags: Vec<String>,
    pub position: String,
    /// Canonical reminder definitions; delivery state is intentionally local-only.
    pub reminders: Vec<ReminderDto>,
    /// S6 — id of the parent task, if this task is a subtask. `None` = a
    /// top-level task. Populated on BOTH `from_model` and `from_row` — see
    /// the module-level note on the projection trap (jin-core/src/index/schema.rs,
    /// jin-core/src/index/query.rs): a field present only on one of these two
    /// constructors reads back `None` on whichever bridge path uses the other.
    pub parent: Option<String>,
    pub agenda_bucket: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBacklinkDto {
    pub source_id: String,
    pub source_kind: String,
    pub edge_type: String,
    pub label: String,
}

impl TaskDto {
    pub fn from_model(task: &Task) -> Self {
        let due = task.frontmatter.due.as_ref().map(|d| match d {
            crate::model::DueDate::Date(nd) => nd.to_string(),
            crate::model::DueDate::DateTime(dt) => dt.to_rfc3339(),
        });
        let reminders = task
            .frontmatter
            .reminders
            .iter()
            .map(ReminderDto::from_model)
            .collect();
        Self {
            id: task.frontmatter.id.clone(),
            title: task.frontmatter.title.clone(),
            status: task.frontmatter.status.to_string(),
            priority: task.frontmatter.priority.to_string(),
            due,
            list: task.frontmatter.list.clone(),
            completed_at: task.frontmatter.completed_at.map(|d| d.to_rfc3339()),
            deleted_at: task.frontmatter.deleted_at.map(|d| d.to_rfc3339()),
            created: task.frontmatter.created.to_rfc3339(),
            updated: task.frontmatter.updated.to_rfc3339(),
            backlinks: vec![],
            body: task.body.clone(),
            section_id: task.frontmatter.section_id.clone(),
            tags: task.frontmatter.tags.clone(),
            position: task.frontmatter.position.clone(),
            reminders,
            parent: task.frontmatter.parent.clone(),
            agenda_bucket: task
                .frontmatter
                .agenda_bucket
                .as_ref()
                .map(|_| "flexible".to_string()),
        }
    }

    pub(crate) fn from_row(row: &TaskRow) -> Self {
        let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
        let reminders: Vec<ReminderDto> = serde_json::from_str(&row.reminders).unwrap_or_default();
        Self {
            id: row.id.clone(),
            title: row.title.clone(),
            status: row.status.clone(),
            priority: row.priority.clone(),
            due: row.due.clone(),
            list: row.list_name.clone(),
            completed_at: row.completed_at.clone(),
            deleted_at: row.deleted_at.clone(),
            created: row.created.clone(),
            updated: row.updated.clone(),
            backlinks: vec![],
            body: String::new(), // list_tasks path: body not populated (kept light)
            section_id: row.section_id.clone(),
            tags,
            position: row.position.clone(),
            reminders,
            parent: row.parent.clone(),
            agenda_bucket: row.agenda_bucket.clone(),
        }
    }

    pub(crate) fn with_backlinks(mut self, bls: &[BacklinkRow]) -> Self {
        self.backlinks = bls
            .iter()
            .map(|b| TaskBacklinkDto {
                source_id: b.source_id.clone(),
                source_kind: b.source_kind.clone(),
                edge_type: b.edge_type.clone(),
                label: b.backlink_label.clone(),
            })
            .collect();
        self
    }

    /// Set the body (disk read). Mirrors NoteDto::with_body.
    /// Used by `api::get_task` to populate body from the task file on disk.
    /// `list_tasks` leaves body empty to keep list queries light.
    pub(crate) fn with_body(mut self, body: String) -> Self {
        self.body = body;
        self
    }
}
