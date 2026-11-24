//! Provider-neutral workspace health commands.
//!
//! A file provider owns replication. Jin only reports facts it can verify from
//! the selected workspace and never infers whether an external service has
//! uploaded a change.

use std::path::Path;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct WorkspaceConflictDto {
    pub kind: String,
    pub id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct WorkspaceStatusDto {
    pub status: String,
    pub portable: bool,
    pub root_path: String,
    pub recovery_path: String,
    pub checked_at: String,
    pub canonical_file_count: usize,
    pub conflicts: Vec<WorkspaceConflictDto>,
    pub message: Option<String>,
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn workspace_status_fn(root: &Path) -> Result<WorkspaceStatusDto, JinErrorDto> {
    let config = jin_core::Config::load(root).map_err(JinErrorDto::from)?;
    let missing_required_dirs = ["notes", "tasks", "events"]
        .into_iter()
        .filter(|name| !root.join(name).is_dir())
        .collect::<Vec<_>>();
    if !missing_required_dirs.is_empty() {
        return Ok(WorkspaceStatusDto {
            status: "attention".to_string(),
            portable: jin_core::workspace::is_shared(root),
            root_path: root.display().to_string(),
            recovery_path: config.jin_dir().join("history").display().to_string(),
            checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            canonical_file_count: 0,
            conflicts: Vec::new(),
            message: Some(format!(
                "Workspace files are unavailable because {} is missing. Let your provider finish restoring it, then check again. Jin did not refresh its local view.",
                missing_required_dirs.join(", ")
            )),
        });
    }
    let (files, duplicate_identities) =
        jin_core::store::canonical_scan::inspect_identities(root).map_err(JinErrorDto::from)?;
    let conflicts = duplicate_identities
        .into_iter()
        .map(|conflict| WorkspaceConflictDto {
            kind: conflict.kind.to_string(),
            id: conflict.id,
            paths: conflict
                .paths
                .iter()
                .map(|path| relative_path(root, path))
                .collect(),
        })
        .collect::<Vec<_>>();
    let message = (!conflicts.is_empty()).then(|| "Jin found two files with the same identity. Both versions are preserved. Review the listed files in your workspace, then check again.".to_string());
    Ok(WorkspaceStatusDto {
        status: if conflicts.is_empty() {
            "ready"
        } else {
            "attention"
        }
        .to_string(),
        portable: jin_core::workspace::is_shared(root),
        root_path: root.display().to_string(),
        recovery_path: config.jin_dir().join("history").display().to_string(),
        checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        canonical_file_count: files.len(),
        conflicts,
        message,
    })
}

pub fn refresh_workspace_projection_fn(root: &Path) -> Result<WorkspaceStatusDto, JinErrorDto> {
    let status = workspace_status_fn(root)?;
    if status.status == "attention" {
        return Ok(status);
    }
    jin_core::ops::api::refresh(root).map_err(JinErrorDto::from)?;
    workspace_status_fn(root)
}

#[tauri::command]
pub async fn workspace_status(
    state: tauri::State<'_, AppState>,
) -> Result<WorkspaceStatusDto, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("workspace check", move || workspace_status_fn(&root)).await
}

#[tauri::command]
pub async fn refresh_workspace_projection(
    state: tauri::State<'_, AppState>,
) -> Result<WorkspaceStatusDto, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("refresh workspace projection", move || {
        refresh_workspace_projection_fn(&root)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use jin_core::ops;
    use jin_core::ops::notes::{create_note, CreateNoteParams};

    #[test]
    fn reports_duplicate_workspace_files_and_pauses_refresh_without_replacing_them() {
        let workspace = tempfile::tempdir().unwrap();
        ops::init(workspace.path()).unwrap();
        let note = create_note(
            &workspace.path().join("notes"),
            CreateNoteParams {
                title: "Original".to_string(),
                body: "Keep this text".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let original =
            jin_core::store::fs::find_note_path(&workspace.path().join("notes"), note.id())
                .unwrap();
        let duplicate = workspace.path().join("notes/provider-conflict.md");
        std::fs::copy(&original, &duplicate).unwrap();
        let before_original = std::fs::read(&original).unwrap();
        let before_duplicate = std::fs::read(&duplicate).unwrap();

        let status = workspace_status_fn(workspace.path()).unwrap();
        assert_eq!(status.status, "attention");
        assert_eq!(status.canonical_file_count, 2);
        assert_eq!(status.conflicts.len(), 1);
        assert_eq!(status.conflicts[0].paths.len(), 2);
        assert!(status.conflicts[0]
            .paths
            .iter()
            .all(|path| path.starts_with("notes/")));

        let paused = refresh_workspace_projection_fn(workspace.path()).unwrap();
        assert_eq!(paused.status, "attention");
        assert_eq!(std::fs::read(&original).unwrap(), before_original);
        assert_eq!(std::fs::read(&duplicate).unwrap(), before_duplicate);
    }

    #[test]
    fn reports_healthy_local_workspace_and_refreshes_projection() {
        let workspace = tempfile::tempdir().unwrap();
        ops::init(workspace.path()).unwrap();
        let status = refresh_workspace_projection_fn(workspace.path()).unwrap();
        assert_eq!(status.status, "ready");
        assert!(status.conflicts.is_empty());
        assert!(!status.checked_at.is_empty());
    }

    #[test]
    fn pauses_refresh_when_a_required_workspace_folder_is_missing() {
        let workspace = tempfile::tempdir().unwrap();
        ops::init(workspace.path()).unwrap();
        std::fs::remove_dir(workspace.path().join("events")).unwrap();
        let status = refresh_workspace_projection_fn(workspace.path()).unwrap();
        assert_eq!(status.status, "attention");
        assert!(status.message.unwrap().contains("events"));
    }
}
