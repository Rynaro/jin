//! Folder commands (Wave 2A + folder-mgmt).

use std::path::Path;

use jin_core::dto::FolderDto;
use jin_core::ops::{api, notes};

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_folders_fn(root: &Path) -> Result<Vec<FolderDto>, JinErrorDto> {
    api::list_folders(root).map_err(JinErrorDto::from)
}

pub fn create_folder_fn(root: &Path, path: String) -> Result<FolderDto, JinErrorDto> {
    api::create_folder(root, &path).map_err(JinErrorDto::from)
}

/// Rename a folder, then rebuild the index.
///
/// Calls `notes::rename_folder` (per-note move_note; ULID links survive),
/// then `api::refresh` (full wipe+rebuild → index self-heals).
pub fn rename_folder_fn(
    root: &Path,
    old_path: String,
    new_path: String,
) -> Result<(), JinErrorDto> {
    let cfg = jin_core::Config::load(root).map_err(JinErrorDto::from)?;
    notes::rename_folder(&cfg.notes_dir(), &old_path, &new_path).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(())
}

/// Delete a folder (non-destructive move-to-parent), then rebuild the index.
///
/// Calls `notes::delete_folder` (flatten subtree to parent_of; ULID links survive),
/// then `api::refresh`. Returns the count of notes moved.
pub fn delete_folder_fn(root: &Path, path: String) -> Result<usize, JinErrorDto> {
    let cfg = jin_core::Config::load(root).map_err(JinErrorDto::from)?;
    let count = notes::delete_folder(&cfg.notes_dir(), &path).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(count)
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_folders(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FolderDto>, JinErrorDto> {
    list_folders_fn(&state.root)
}

#[tauri::command]
pub async fn create_folder(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<FolderDto, JinErrorDto> {
    create_folder_fn(&state.root, path)
}

#[tauri::command]
pub async fn rename_folder(
    state: tauri::State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), JinErrorDto> {
    rename_folder_fn(&state.root, old_path, new_path)
}

#[tauri::command]
pub async fn delete_folder(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<usize, JinErrorDto> {
    delete_folder_fn(&state.root, path)
}
