//! Data model for a first-class List (§1.2).
//!
//! On-disk: `<root>/lists/<id>.md` with `type: list` YAML frontmatter.
//! The Inbox list has the stable id `"inbox"` (never a ULID).

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

/// A section entry embedded in a List file's frontmatter (§1.4).
/// A List owns its sections; deleting the list removes sections atomically.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionEntry {
    pub id: String,
    pub name: String,
    /// Fractional rank among sections within this list.
    pub position: String,
}

/// The canonical workflow owned by a list. Missing on legacy lists until the
/// owner explicitly sets one up; the old `view` field remains read-tolerant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowKind {
    Checklist,
    Board,
}

impl WorkflowKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Checklist => "checklist",
            Self::Board => "board",
        }
    }
}

/// The semantic lane of a board column. Names remain owner-editable while
/// status derives from this type rather than the displayed column name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardColumnType {
    Queue,
    None,
    InProgress,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardColumn {
    pub id: String,
    pub name: String,
    pub position: String,
    #[serde(rename = "type")]
    pub column_type: BoardColumnType,
}

/// YAML frontmatter for a List file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListFrontmatter {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // always "list"
    pub name: String,
    /// Jin swatch token name, e.g. "accent" | "sky" | "danger".
    pub color: String,
    /// Registered Lucide icon name, e.g. "inbox" | "list".
    pub icon: String,
    /// Fractional rank among lists in the sidebar.
    pub position: String,
    /// Optional list grouping / folder (nullable; v1 ships flat sidebar).
    #[serde(default)]
    pub parent_id: Option<String>,
    /// Persisted view mode: "list" | "board".
    #[serde(default = "default_view")]
    pub view: String,
    /// Sort mode: "manual" | "due" | "priority" | "title" | "created".
    #[serde(default = "default_sort_mode")]
    pub sort_mode: String,
    /// Per-list Kanban columns (§1.4).
    #[serde(default)]
    pub sections: Vec<SectionEntry>,
    /// None preserves a legacy list without silently selecting a workflow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_kind: Option<WorkflowKind>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<BoardColumn>,
    /// Where new Board work arrives. Older boards resolve their first Queue,
    /// then first neutral column, without rewriting their canonical file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_column_id: Option<String>,
    #[serde(default)]
    pub archived_at: Option<DateTime<FixedOffset>>,
    pub created: DateTime<FixedOffset>,
    pub updated: DateTime<FixedOffset>,
}

fn default_view() -> String {
    "list".to_string()
}

fn default_sort_mode() -> String {
    "manual".to_string()
}

/// A parsed List (frontmatter + optional body).
#[derive(Debug, Clone)]
pub struct List {
    pub frontmatter: ListFrontmatter,
    pub body: String,
}

impl List {
    pub fn id(&self) -> &str {
        &self.frontmatter.id
    }
}
