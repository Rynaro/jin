//! DTO projection for Tags (P2 storage contract; P4 surface).

use serde::{Deserialize, Serialize};

/// DTO projection of a Tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDto {
    pub slug: String,
    pub name: String,
    /// Jin swatch token name.
    pub color: String,
    /// Number of tasks carrying this tag (query-time COUNT; 0 until P4 wires it).
    pub task_count: u32,
}
