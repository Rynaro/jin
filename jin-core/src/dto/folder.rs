use serde::{Deserialize, Serialize};

/// DTO for a note folder (Wave 2A, Track A).
/// Mirrors the `FolderDto` expected by the Tauri bridge and TypeScript frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDto {
    /// Relative path of the folder (/ separated); `""` = root "Notes" folder.
    pub path: String,
    /// Human-readable name: last path component, or `"Notes"` when `path == ""`.
    pub name: String,
    /// Count of non-deleted notes with exactly this `folder_path`.
    pub note_count: usize,
}

impl FolderDto {
    pub fn new(path: String, note_count: usize) -> Self {
        let name = if path.is_empty() {
            "Notes".to_string()
        } else {
            path.split('/').next_back().unwrap_or(&path).to_string()
        };
        Self {
            path,
            name,
            note_count,
        }
    }
}
