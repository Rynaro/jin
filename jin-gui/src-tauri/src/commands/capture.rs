//! capture command — quick-add a note or task.

use std::path::Path;

use serde::Serialize;

use jin_core::dto::{NoteDto, TaskDto};
use jin_core::ops::{api, notes, tasks};
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct CaptureResultDto {
    /// "note" | "task"
    pub kind: String,
    pub id: String,
    /// The full DTO of the created object (serde_json::Value for polymorphism).
    pub data: serde_json::Value,
}

pub fn capture_fn(
    root: &Path,
    text: String,
    as_task: bool,
    list: Option<String>,
) -> Result<CaptureResultDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;

    if as_task {
        let task = tasks::create_task(
            &cfg.tasks_dir(),
            tasks::CreateTaskParams {
                title: text,
                body: String::new(),
                priority: None,
                due: None,
                list,
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .map_err(JinErrorDto::from)?;
        api::refresh(root).map_err(JinErrorDto::from)?;
        let dto = TaskDto::from_model(&task);
        let id = dto.id.clone();
        Ok(CaptureResultDto {
            kind: "task".to_string(),
            id,
            data: serde_json::to_value(&dto).unwrap_or(serde_json::Value::Null),
        })
    } else {
        let note = notes::create_note(
            &cfg.notes_dir(),
            notes::CreateNoteParams {
                title: text,
                body: String::new(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .map_err(JinErrorDto::from)?;
        api::refresh(root).map_err(JinErrorDto::from)?;
        let dto = NoteDto::from_model(&note);
        let id = dto.id.clone();
        Ok(CaptureResultDto {
            kind: "note".to_string(),
            id,
            data: serde_json::to_value(&dto).unwrap_or(serde_json::Value::Null),
        })
    }
}

#[tauri::command]
pub async fn capture(
    state: tauri::State<'_, AppState>,
    text: String,
    as_task: Option<bool>,
    list: Option<String>,
) -> Result<CaptureResultDto, JinErrorDto> {
    capture_fn(&state.root, text, as_task.unwrap_or(false), list)
}
