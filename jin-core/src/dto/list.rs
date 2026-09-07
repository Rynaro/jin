//! DTO projections for Lists and Sections (P2 storage contract; P3 surface).

use serde::{Deserialize, Serialize};

/// DTO projection of a Section (derived from `list.sections[]`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionDto {
    pub id: String,
    pub list_id: String,
    pub name: String,
    /// Fractional rank among sections within the list.
    pub position: String,
    /// Number of non-deleted tasks in this section (query-time COUNT; 0 until P3 wires it).
    pub task_count: u32,
}

/// DTO projection of a List.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDto {
    pub id: String,
    pub name: String,
    /// Jin swatch token name.
    pub color: String,
    /// Registered Lucide icon name.
    pub icon: String,
    /// Fractional rank among lists in the sidebar.
    pub position: String,
    pub parent_id: Option<String>,
    /// Persisted view mode: "list" | "board".
    pub view: String,
    /// Sort mode: "manual" | "due" | "priority" | "title" | "created".
    pub sort_mode: String,
    /// True when `id == "inbox"` (the stable default list that cannot be deleted).
    pub is_default: bool,
    /// Number of non-deleted tasks in this list (query-time COUNT; 0 until P3 wires it).
    pub task_count: u32,
    pub sections: Vec<SectionDto>,
}
