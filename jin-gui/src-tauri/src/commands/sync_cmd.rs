//! run_sync command.

use std::path::Path;

use jin_core::ops::sync::{sync, SyncSummary};

use crate::error::JinErrorDto;
use crate::state::AppState;

pub fn run_sync_fn(root: &Path) -> Result<SyncSummary, JinErrorDto> {
    sync(root).map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn run_sync(state: tauri::State<'_, AppState>) -> Result<SyncSummary, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("calendar sync", move || run_sync_fn(&root)).await
}
