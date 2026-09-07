use chrono::{DateTime, FixedOffset, NaiveDate};
use serde::{Deserialize, Serialize};

use super::edge::LinkEntry;

/// A reminder stored inline in a Task file's frontmatter.
///
/// `kind` is either `"relative"` (e.g. `"-1h"`, `"-30m"`, `"-1d"`) or
/// `"absolute"` (an RFC-3339 timestamp). The desktop scheduler resolves and
/// fires these values while the Tauri GUI is running.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub kind: String,
    pub value: String,
}

/// Task state machine: todo → doing → done; todo|doing → cancelled; done|cancelled → todo (reopen).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Todo,
    Doing,
    Done,
    Cancelled,
    /// Soft-delete tombstone
    Deleted,
}

/// Explicit agenda-placement intent. This is orthogonal to Task lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgendaBucket {
    Flexible,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskStatus::Todo => "todo",
            TaskStatus::Doing => "doing",
            TaskStatus::Done => "done",
            TaskStatus::Cancelled => "cancelled",
            TaskStatus::Deleted => "deleted",
        };
        write!(f, "{}", s)
    }
}

impl TaskStatus {
    /// Returns true if this is the tombstone state.
    pub fn is_deleted(&self) -> bool {
        *self == TaskStatus::Deleted
    }

    /// Validate a transition; returns Ok(()) if legal.
    pub fn can_transition_to(&self, next: &TaskStatus) -> bool {
        matches!(
            (self, next),
            (TaskStatus::Todo, TaskStatus::Doing)
                | (TaskStatus::Todo, TaskStatus::Done)
                | (TaskStatus::Todo, TaskStatus::Cancelled)
                | (TaskStatus::Doing, TaskStatus::Done)
                | (TaskStatus::Doing, TaskStatus::Cancelled)
                | (TaskStatus::Doing, TaskStatus::Todo) // reopen-style
                | (TaskStatus::Done, TaskStatus::Todo)
                | (TaskStatus::Cancelled, TaskStatus::Todo)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    #[default]
    None,
    Low,
    Medium,
    High,
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Priority::None => "none",
            Priority::Low => "low",
            Priority::Medium => "medium",
            Priority::High => "high",
        };
        write!(f, "{}", s)
    }
}

/// Due date: either a bare date or a datetime with offset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DueDate {
    Date(NaiveDate),
    DateTime(DateTime<FixedOffset>),
}

fn default_list() -> String {
    "inbox".to_string()
}

/// YAML frontmatter for a Task file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFrontmatter {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // always "task"
    pub title: String,
    pub created: DateTime<FixedOffset>,
    pub updated: DateTime<FixedOffset>,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub due: Option<DueDate>,
    #[serde(default = "default_list")]
    pub list: String,
    #[serde(default)]
    pub completed_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub links: Vec<LinkEntry>,
    /// Which section within the task's list this task belongs to (nullable = "No Section").
    #[serde(default)]
    pub section_id: Option<String>,
    /// Tag slugs attached to this task (membership stored here; color in tags/<slug>.md).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Fractional position key (base-62, lexicographic order) for manual sort within
    /// (list_id, section_id). Empty string = unranked; rebuild assigns a rank if missing.
    #[serde(default)]
    pub position: String,
    /// Canonical reminder definitions. Device-local delivery state is separate.
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    /// S6 — id of the parent task, if this task is a subtask. `None` = a
    /// top-level task. Depth is capped at one: a task that has a `parent` may
    /// not itself be a parent (enforced in `ops::tasks`, not here — this is
    /// the model layer, which stays a plain data carrier).
    /// `#[serde(default)]` so every task file written before this wave (no
    /// `parent` key in its frontmatter) still parses without error
    /// (AC-S6-01 / AC-X-07 — the same migration-safety guarantee already
    /// covered by `serde_default_p2_fields_on_legacy_task_file` below).
    #[serde(default)]
    pub parent: Option<String>,
    /// Optional agenda placement. Missing legacy values mean no explicit bucket.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agenda_bucket: Option<AgendaBucket>,
}

/// A parsed Task (frontmatter + optional body).
#[derive(Debug, Clone)]
pub struct Task {
    pub frontmatter: TaskFrontmatter,
    pub body: String,
}

impl Task {
    pub fn id(&self) -> &str {
        &self.frontmatter.id
    }
    pub fn title(&self) -> &str {
        &self.frontmatter.title
    }
    pub fn is_deleted(&self) -> bool {
        self.frontmatter.status.is_deleted()
    }
    /// S6 — the parent task id, if this task is a subtask.
    pub fn parent(&self) -> Option<&str> {
        self.frontmatter.parent.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::frontmatter;

    /// VG-P2 serde-default: a task file missing ALL new P2 fields parses
    /// without error and applies the correct defaults, proving no migration is needed.
    #[test]
    fn serde_default_p2_fields_on_legacy_task_file() {
        let yaml = r#"id: "LEGACY01"
type: task
title: Legacy task
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml)
            .expect("legacy task YAML (no P2 fields) must parse without error");

        assert!(fm.section_id.is_none(), "section_id must default to None");
        assert!(fm.tags.is_empty(), "tags must default to empty Vec");
        assert_eq!(fm.position, "", "position must default to empty string");
        assert!(
            fm.reminders.is_empty(),
            "reminders must default to empty Vec"
        );
    }

    /// AC-S6-01 / AC-X-07 — a task file written before this wave (no `parent`
    /// key in its frontmatter at all) SHALL parse without error, with `parent`
    /// taking its `#[serde(default)]` value (`None`). Binds the moment S6
    /// adds `parent` to the model (no core change landed before S6), and
    /// again at wave exit against a legacy fixture.
    #[test]
    fn serde_default_legacy_task_file_parses_without_parent() {
        let yaml = r#"id: "LEGACY02"
type: task
title: Legacy task, no parent key
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml)
            .expect("legacy task YAML (no `parent` key) must parse without error");

        assert!(
            fm.parent.is_none(),
            "parent must default to None when the key is absent from frontmatter"
        );
    }

    #[test]
    fn serde_default_legacy_task_agenda_bucket() {
        let yaml = r#"id: "LEGACY03"
type: task
title: Legacy task, no agenda bucket
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml).unwrap();
        assert!(fm.agenda_bucket.is_none());
    }

    /// VG-P2 serde round-trip: a task file WITH all new P2 fields set correctly
    /// deserializes them, proving the new field layout is correct.
    #[test]
    fn serde_p2_fields_round_trip() {
        let yaml = r#"id: "NEW01"
type: task
title: New task
created: "2026-06-30T10:00:00+00:00"
updated: "2026-06-30T10:00:00+00:00"
status: todo
priority: medium
list: inbox
section_id: "section-abc"
tags:
  - work
  - urgent
position: "V"
reminders:
  - kind: relative
    value: "-1h"
  - kind: absolute
    value: "2026-07-01T09:00:00+00:00"
"#;
        let fm: TaskFrontmatter =
            frontmatter::parse_fm(yaml).expect("task YAML with all P2 fields must parse");

        assert_eq!(fm.section_id, Some("section-abc".to_string()));
        assert_eq!(fm.tags, vec!["work", "urgent"]);
        assert_eq!(fm.position, "V");
        assert_eq!(fm.reminders.len(), 2);
        assert_eq!(fm.reminders[0].kind, "relative");
        assert_eq!(fm.reminders[0].value, "-1h");
        assert_eq!(fm.reminders[1].kind, "absolute");
    }
}
