//! Tag commands — Tauri bridge for the P4 Tag surface.
//!
//! Each exported `*_fn` is directly callable from integration tests (no runtime).
//! The async `#[tauri::command]` wrappers delegate to the `*_fn`.

use std::path::Path;

use jin_core::dto::TagDto;
use jin_core::ops::tags as tags_ops;

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_tags_fn(root: &Path) -> Result<Vec<TagDto>, JinErrorDto> {
    tags_ops::list_tags(root).map_err(JinErrorDto::from)
}

pub fn set_tag_color_fn(root: &Path, slug: String, color: String) -> Result<TagDto, JinErrorDto> {
    tags_ops::set_tag_color(root, &slug, color).map_err(JinErrorDto::from)
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_tags(state: tauri::State<'_, AppState>) -> Result<Vec<TagDto>, JinErrorDto> {
    list_tags_fn(&state.root)
}

#[tauri::command]
pub async fn set_tag_color(
    state: tauri::State<'_, AppState>,
    slug: String,
    color: String,
) -> Result<TagDto, JinErrorDto> {
    set_tag_color_fn(&state.root, slug, color)
}
