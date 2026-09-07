//! Declarative Notes Collections bridge.
//!
//! Collections are portable JSON documents evaluated by jin-core. This bridge
//! exposes only the typed declarative query grammar; it accepts no SQL, script,
//! template, or expression strings.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use jin_core::dto::NoteDto;
use jin_core::model::{CollectionDocument, CollectionQuery};
use jin_core::ops::{api, collections};

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    pub query: CollectionQuery,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCollectionQueryInput {
    pub query: CollectionQuery,
}

pub fn list_collections_fn(root: &Path) -> Result<Vec<CollectionDocument>, JinErrorDto> {
    collections::list_collections(root).map_err(JinErrorDto::from)
}

pub fn create_collection_fn(
    root: &Path,
    input: CreateCollectionInput,
) -> Result<CollectionDocument, JinErrorDto> {
    collections::create_collection(root, input.name, input.query).map_err(JinErrorDto::from)
}

pub fn rename_collection_fn(
    root: &Path,
    id: String,
    name: String,
) -> Result<CollectionDocument, JinErrorDto> {
    collections::rename_collection(root, &id, name).map_err(JinErrorDto::from)
}

pub fn update_collection_query_fn(
    root: &Path,
    id: String,
    input: UpdateCollectionQueryInput,
) -> Result<CollectionDocument, JinErrorDto> {
    collections::update_collection_query(root, &id, input.query).map_err(JinErrorDto::from)
}

pub fn delete_collection_fn(root: &Path, id: String) -> Result<(), JinErrorDto> {
    collections::delete_collection(root, &id).map_err(JinErrorDto::from)
}

/// Evaluate a collection and return the corresponding list projections in the
/// collection's canonical sort order.
pub fn evaluate_collection_fn(root: &Path, id: String) -> Result<Vec<NoteDto>, JinErrorDto> {
    let evaluated = collections::evaluate_collection(root, &id).map_err(JinErrorDto::from)?;
    let listed = api::list_notes(root, false, None, None).map_err(JinErrorDto::from)?;
    let mut by_id: BTreeMap<_, _> = listed
        .into_iter()
        .map(|note| (note.id.clone(), note))
        .collect();
    Ok(evaluated
        .into_iter()
        .filter_map(|note| by_id.remove(note.id()))
        .collect())
}

#[tauri::command]
pub async fn list_collections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CollectionDocument>, JinErrorDto> {
    list_collections_fn(&state.root)
}

#[tauri::command]
pub async fn create_collection(
    state: tauri::State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<CollectionDocument, JinErrorDto> {
    create_collection_fn(&state.root, input)
}

#[tauri::command]
pub async fn rename_collection(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<CollectionDocument, JinErrorDto> {
    rename_collection_fn(&state.root, id, name)
}

#[tauri::command]
pub async fn update_collection_query(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateCollectionQueryInput,
) -> Result<CollectionDocument, JinErrorDto> {
    update_collection_query_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn delete_collection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), JinErrorDto> {
    delete_collection_fn(&state.root, id)
}

#[tauri::command]
pub async fn evaluate_collection(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<NoteDto>, JinErrorDto> {
    evaluate_collection_fn(&state.root, id)
}
