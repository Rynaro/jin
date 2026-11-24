//! export and app_config commands.

use std::path::Path;

use serde::Serialize;

use jin_core::ops::export::{export, verify_export};
use jin_core::{Config, JinError};

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ExportResultDto {
    pub dest: String,
    pub file_count: usize,
    pub included_audit: bool,
    pub files: Vec<String>,
    pub verified: bool,
}

#[derive(Debug, Serialize)]
pub struct AppConfigDto {
    pub root_path: String,
    pub display_tz: String,
    pub calendar_id: Option<String>,
    pub schema_version: u32,
}

pub fn export_fn(root: &Path, dest: String, force: bool) -> Result<ExportResultDto, JinErrorDto> {
    if force {
        let missing = ["notes", "tasks", "events"]
            .into_iter()
            .filter(|name| !root.join(name).is_dir())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(JinError::Integrity(format!(
                "refusing to replace a verified export while workspace folders are unavailable: {}",
                missing.join(", ")
            ))
            .into());
        }
    }
    let dest_path = std::path::PathBuf::from(&dest);
    let summary = export(root, &dest_path, force).map_err(JinErrorDto::from)?;
    verify_export(&dest_path).map_err(JinErrorDto::from)?;
    Ok(ExportResultDto {
        dest,
        file_count: summary.total_files(),
        included_audit: summary.audit_included,
        files: summary.files,
        verified: true,
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
    let root = state.root.clone();
    super::blocking::run("export", move || {
        export_fn(&root, dest, force.unwrap_or(false))
    })
    .await
}

#[tauri::command]
pub async fn app_config(state: tauri::State<'_, AppState>) -> Result<AppConfigDto, JinErrorDto> {
    app_config_fn(&state.root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_export_refuses_an_incomplete_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let export_destination = tempfile::tempdir().unwrap();
        jin_core::ops::init(workspace.path()).unwrap();
        export_fn(
            workspace.path(),
            export_destination.path().display().to_string(),
            false,
        )
        .unwrap();
        std::fs::remove_dir(workspace.path().join("events")).unwrap();
        let error = export_fn(
            workspace.path(),
            export_destination.path().display().to_string(),
            true,
        )
        .unwrap_err();
        assert!(error.message.contains("events"));
    }
}
