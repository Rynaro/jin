//! export and app_config commands.

use std::path::Path;

use serde::Serialize;

use jin_core::ops::export::export;
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ExportResultDto {
    pub dest: String,
    pub file_count: usize,
    pub included_audit: bool,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AppConfigDto {
    pub root_path: String,
    pub display_tz: String,
    pub calendar_id: Option<String>,
    pub schema_version: u32,
}

pub fn export_fn(root: &Path, dest: String, force: bool) -> Result<ExportResultDto, JinErrorDto> {
    let dest_path = std::path::PathBuf::from(&dest);
    let summary = export(root, &dest_path, force).map_err(JinErrorDto::from)?;
    Ok(ExportResultDto {
        dest,
        file_count: summary.total_files(),
        included_audit: summary.audit_included,
        files: summary.files,
    })
}

pub fn app_config_fn(root: &Path) -> Result<AppConfigDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    Ok(AppConfigDto {
        root_path: cfg.root.display().to_string(),
        display_tz: cfg.display_tz.clone(),
        calendar_id: cfg.calendar_id.clone(),
        schema_version: cfg.schema_version,
    })
}

#[tauri::command]
pub async fn export_files(
    state: tauri::State<'_, AppState>,
    dest: String,
    force: Option<bool>,
) -> Result<ExportResultDto, JinErrorDto> {
    export_fn(&state.root, dest, force.unwrap_or(false))
}

#[tauri::command]
pub async fn app_config(state: tauri::State<'_, AppState>) -> Result<AppConfigDto, JinErrorDto> {
    app_config_fn(&state.root)
}
