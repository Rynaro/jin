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
