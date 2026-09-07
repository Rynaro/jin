//! List CRUD commands — Tauri bridge for the P3 List surface.
//!
//! Each exported `*_fn` is directly callable from integration tests (no runtime).
//! The async `#[tauri::command]` wrappers delegate to the `*_fn`.

use std::path::Path;

use serde::Deserialize;

use jin_core::dto::{ListDto, SectionDto};
use jin_core::ops::{api, lists};
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Input types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateListInput {
    pub name: String,
    pub color: String,
    pub icon: String,
    pub parent_id: Option<String>,
}

// ── Section inputs (P5) ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateSectionInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameSectionInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderSectionInput {
    pub position: String,
}

#[derive(Debug, Deserialize)]
pub struct EditListInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub view: Option<String>,
    pub sort_mode: Option<String>,
    /// `Some(Some(id))` = set parent, `Some(None)` = clear parent, `None` = no change.
    pub parent_id: Option<Option<String>>,
}

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_lists_fn(root: &Path) -> Result<Vec<ListDto>, JinErrorDto> {
    lists::list_lists(root).map_err(JinErrorDto::from)
}

pub fn create_list_fn(root: &Path, input: CreateListInput) -> Result<ListDto, JinErrorDto> {
    lists::create_list(
        root,
        lists::CreateListParams {
            name: input.name,
            color: input.color,
            icon: input.icon,
            parent_id: input.parent_id,
        },
    )
    .map_err(JinErrorDto::from)
}

pub fn edit_list_fn(root: &Path, id: String, input: EditListInput) -> Result<ListDto, JinErrorDto> {
    lists::edit_list(
        root,
        &id,
        lists::EditListParams {
            name: input.name,
            color: input.color,
            icon: input.icon,
            view: input.view,
            sort_mode: input.sort_mode,
            parent_id: input.parent_id,
        },
    )
    .map_err(JinErrorDto::from)
}

pub fn reorder_list_fn(root: &Path, id: String, position: String) -> Result<ListDto, JinErrorDto> {
    lists::reorder_list(root, &id, position).map_err(JinErrorDto::from)
}

pub fn delete_list_fn(root: &Path, id: String) -> Result<(), JinErrorDto> {
    lists::delete_list(root, &id).map_err(JinErrorDto::from)
}

// ── Section fn wrappers (P5) ──────────────────────────────────────────────────

pub fn create_section_fn(
    root: &Path,
    list_id: String,
    input: CreateSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::create_section(root, &list_id, input.name).map_err(JinErrorDto::from)
}

pub fn rename_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
    input: RenameSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::rename_section(root, &list_id, &section_id, input.name).map_err(JinErrorDto::from)
}

pub fn reorder_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
    input: ReorderSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::reorder_section(root, &list_id, &section_id, input.position).map_err(JinErrorDto::from)
}

pub fn delete_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
) -> Result<(), JinErrorDto> {
    lists::delete_section(root, &list_id, &section_id).map_err(JinErrorDto::from)
}

/// Ensure the default Inbox list is seeded (used at app init).
pub fn ensure_default_list_fn(root: &Path) -> Result<(), JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    lists::ensure_default_list(&cfg.lists_dir()).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(())
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

// ── Section Tauri commands (P5) ───────────────────────────────────────────────

#[tauri::command]
pub async fn create_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    input: CreateSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    create_section_fn(&state.root, list_id, input)
}

#[tauri::command]
pub async fn rename_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
    input: RenameSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    rename_section_fn(&state.root, list_id, section_id, input)
}

#[tauri::command]
pub async fn reorder_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
    input: ReorderSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    reorder_section_fn(&state.root, list_id, section_id, input)
}

#[tauri::command]
pub async fn delete_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
) -> Result<(), JinErrorDto> {
    delete_section_fn(&state.root, list_id, section_id)
}

#[tauri::command]
pub async fn list_lists(state: tauri::State<'_, AppState>) -> Result<Vec<ListDto>, JinErrorDto> {
    list_lists_fn(&state.root)
}

#[tauri::command]
pub async fn create_list(
    state: tauri::State<'_, AppState>,
    input: CreateListInput,
) -> Result<ListDto, JinErrorDto> {
    create_list_fn(&state.root, input)
}

#[tauri::command]
pub async fn edit_list(
    state: tauri::State<'_, AppState>,
    id: String,
    input: EditListInput,
) -> Result<ListDto, JinErrorDto> {
    edit_list_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn reorder_list(
    state: tauri::State<'_, AppState>,
    id: String,
    position: String,
) -> Result<ListDto, JinErrorDto> {
    reorder_list_fn(&state.root, id, position)
}

#[tauri::command]
pub async fn delete_list(state: tauri::State<'_, AppState>, id: String) -> Result<(), JinErrorDto> {
    delete_list_fn(&state.root, id)
}
