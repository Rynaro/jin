//! Note CRUD commands.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use jin_core::dto::NoteDto;
use jin_core::model::PropertyValue;
use jin_core::ops::{api, notes};
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Input types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct NoteInput {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Wave 2A: target folder (relative path, validated). Defaults to "" (root).
    #[serde(default)]
    pub folder: String,
}

#[derive(Debug, Deserialize)]
pub struct EditNoteInput {
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub add_tags: Vec<String>,
    #[serde(default)]
    pub rm_tags: Vec<String>,
    #[serde(default)]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct NotePropertiesInput {
    pub properties: BTreeMap<String, PropertyValue>,
    #[serde(default)]
    pub expected_revision: Option<u64>,
}

/// Safe recovery-preview DTO. It deliberately contains no snapshot path.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NoteRevisionPreviewDto {
    pub revision: u64,
    pub title: String,
    pub body_markdown: String,
    pub updated: String,
}

impl From<jin_core::model::Note> for NoteRevisionPreviewDto {
    fn from(note: jin_core::model::Note) -> Self {
        Self {
            revision: note.frontmatter.revision,
            title: note.frontmatter.title,
            body_markdown: note.body,
            updated: note.frontmatter.updated.to_rfc3339(),
        }
    }
}

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_notes_fn(
    root: &Path,
    include_deleted: bool,
    tag: Option<String>,
    folder: Option<String>,
) -> Result<Vec<NoteDto>, JinErrorDto> {
    api::list_notes(root, include_deleted, tag.as_deref(), folder.as_deref())
        .map_err(JinErrorDto::from)
}

pub fn get_note_fn(root: &Path, id: String) -> Result<NoteDto, JinErrorDto> {
    api::get_note(root, &id).map_err(JinErrorDto::from)
}

pub fn create_note_fn(root: &Path, input: NoteInput) -> Result<NoteDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let folder = input.folder.clone();
    let note = notes::create_note(
        &cfg.notes_dir(),
        notes::CreateNoteParams {
            title: input.title,
            body: input.body,
            tags: input.tags,
            folder: input.folder,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note).with_folder(folder))
}

pub fn edit_note_fn(root: &Path, id: String, input: EditNoteInput) -> Result<NoteDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let note = notes::edit_note(
        &cfg.notes_dir(),
        &id,
        notes::EditNoteParams {
            title: input.title,
            body: input.body,
            add_tags: input.add_tags,
            rm_tags: input.rm_tags,
            properties: None,
            expected_revision: input.expected_revision,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note))
}

pub fn set_note_properties_fn(
    root: &Path,
    id: String,
    input: NotePropertiesInput,
) -> Result<NoteDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let note = notes::edit_note(
        &cfg.notes_dir(),
        &id,
        notes::EditNoteParams {
            title: None,
            body: None,
            add_tags: vec![],
            rm_tags: vec![],
            properties: Some(input.properties),
            expected_revision: input.expected_revision,
        },
    )
    .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note))
}

pub fn search_notes_fn(root: &Path, text: String) -> Result<Vec<NoteDto>, JinErrorDto> {
    api::search_notes(root, &text).map_err(JinErrorDto::from)
}

/// Expose only revision numbers to the UI; filesystem snapshot locations remain
/// an internal recovery detail.
pub fn list_note_revisions_fn(root: &Path, id: String) -> Result<Vec<u64>, JinErrorDto> {
    jin_core::ops::recovery::list_revisions(root, &id)
        .map(|revisions| {
            revisions
                .into_iter()
                .map(|revision| revision.revision)
                .collect()
        })
        .map_err(JinErrorDto::from)
}

pub fn preview_note_revision_fn(
    root: &Path,
    id: String,
    revision: u64,
) -> Result<NoteRevisionPreviewDto, JinErrorDto> {
    jin_core::ops::recovery::preview_note_revision(root, &id, revision)
        .map(NoteRevisionPreviewDto::from)
        .map_err(JinErrorDto::from)
}

pub fn restore_note_revision_fn(
    root: &Path,
    id: String,
    revision: u64,
    expected_revision: Option<u64>,
) -> Result<NoteDto, JinErrorDto> {
    let note =
        jin_core::ops::recovery::restore_note_revision(root, &id, revision, expected_revision)
            .map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note))
}

pub fn delete_note_fn(root: &Path, id: String) -> Result<NoteDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let note = notes::delete_note(&cfg.notes_dir(), &id).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note))
}

/// Move a note to a different folder. Calls api::refresh so the index is updated (F2).
pub fn move_note_fn(root: &Path, id: String, folder: String) -> Result<NoteDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let dest_folder = folder.clone();
    let note = notes::move_note(&cfg.notes_dir(), &id, &dest_folder).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(NoteDto::from_model(&note).with_folder(folder))
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_notes(
    state: tauri::State<'_, AppState>,
    include_deleted: Option<bool>,
    tag: Option<String>,
    folder: Option<String>,
) -> Result<Vec<NoteDto>, JinErrorDto> {
    list_notes_fn(&state.root, include_deleted.unwrap_or(false), tag, folder)
}

#[tauri::command]
pub async fn get_note(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<NoteDto, JinErrorDto> {
    get_note_fn(&state.root, id)
}

#[tauri::command]
pub async fn search_notes(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<Vec<NoteDto>, JinErrorDto> {
    search_notes_fn(&state.root, text)
}

#[tauri::command]
pub async fn list_note_revisions(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<u64>, JinErrorDto> {
    list_note_revisions_fn(&state.root, id)
}

#[tauri::command]
pub async fn preview_note_revision(
    state: tauri::State<'_, AppState>,
    id: String,
    revision: u64,
) -> Result<NoteRevisionPreviewDto, JinErrorDto> {
    preview_note_revision_fn(&state.root, id, revision)
}

#[tauri::command]
pub async fn create_note(
    state: tauri::State<'_, AppState>,
    input: NoteInput,
) -> Result<NoteDto, JinErrorDto> {
    create_note_fn(&state.root, input)
}

#[tauri::command]
pub async fn edit_note(
    state: tauri::State<'_, AppState>,
    id: String,
    input: EditNoteInput,
) -> Result<NoteDto, JinErrorDto> {
    edit_note_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn set_note_properties(
    state: tauri::State<'_, AppState>,
    id: String,
    input: NotePropertiesInput,
) -> Result<NoteDto, JinErrorDto> {
    set_note_properties_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn delete_note(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<NoteDto, JinErrorDto> {
    delete_note_fn(&state.root, id)
}

#[tauri::command]
pub async fn move_note(
    state: tauri::State<'_, AppState>,
    id: String,
    folder: String,
) -> Result<NoteDto, JinErrorDto> {
    move_note_fn(&state.root, id, folder)
}

#[tauri::command]
pub async fn restore_note_revision(
    state: tauri::State<'_, AppState>,
    id: String,
    revision: u64,
    expected_revision: Option<u64>,
) -> Result<NoteDto, JinErrorDto> {
    restore_note_revision_fn(&state.root, id, revision, expected_revision)
}
