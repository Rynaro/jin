//! Secure attachment bridge.
//!
//! The bridge returns verified manifest metadata only—not arbitrary filesystem
//! paths—so frontend rendering cannot turn Markdown into local-file access.

use std::path::Path;

use jin_core::ops::assets::{self, AssetEntry, AssetRepairReport};

use crate::error::JinErrorDto;
use crate::state::AppState;

pub fn import_attachment_fn(root: &Path, source: String) -> Result<AssetEntry, JinErrorDto> {
    assets::import_attachment(root, Path::new(&source)).map_err(JinErrorDto::from)
}

pub fn list_attachments_fn(root: &Path) -> Result<Vec<AssetEntry>, JinErrorDto> {
    let manifest = assets::load_manifest(root).map_err(JinErrorDto::from)?;
    let mut entries = Vec::new();
    for hash in manifest.assets.keys() {
        entries.push(assets::get_attachment(root, hash).map_err(JinErrorDto::from)?);
    }
    Ok(entries)
}

pub fn repair_attachments_fn(root: &Path) -> Result<AssetRepairReport, JinErrorDto> {
    assets::repair_assets(root).map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn import_attachment(
    state: tauri::State<'_, AppState>,
    source: String,
) -> Result<AssetEntry, JinErrorDto> {
    import_attachment_fn(&state.root, source)
}

#[tauri::command]
pub async fn list_attachments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AssetEntry>, JinErrorDto> {
    list_attachments_fn(&state.root)
}

#[tauri::command]
pub async fn repair_attachments(
    state: tauri::State<'_, AppState>,
) -> Result<AssetRepairReport, JinErrorDto> {
    repair_attachments_fn(&state.root)
}
