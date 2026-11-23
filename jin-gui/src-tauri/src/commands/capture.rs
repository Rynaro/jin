//! capture command — quick-add a note or task.

use std::path::Path;

use serde::Serialize;

use jin_core::dto::{NoteDto, TaskDto};
use jin_core::ops::{api, notes, tasks, workflows};
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
    capture_with_review_fn(root, text, as_task, list, false, None)
}

pub fn capture_with_review_fn(
    root: &Path,
    text: String,
    as_task: bool,
    list: Option<String>,
    review: bool,
    return_on: Option<chrono::NaiveDate>,
) -> Result<CaptureResultDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let (title, body) =
        jin_core::ops::capture_review::split_capture_text(&text).map_err(JinErrorDto::from)?;
    let capture_review =
        jin_core::ops::capture_review::initial_capture_review(review, return_on, &cfg.display_tz)
            .map_err(JinErrorDto::from)?;

    if as_task {
        let task = workflows::create_task_with_capture_review(
            root,
            tasks::CreateTaskParams {
                recurrence_upcoming_count: None,
                title,
                body,
                priority: None,
                due: None,
                list,
                tags: None,
                reminders: None,
                parent: None,
                recurrence: None,
            },
            None,
            capture_review,
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
        let note = notes::create_note_with_capture_review(
            &cfg.notes_dir(),
            notes::CreateNoteParams {
                title,
                body,
                tags: vec![],
                folder: String::new(),
            },
            capture_review,
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

#[tauri::command(rename_all = "snake_case")]
pub async fn capture(
    state: tauri::State<'_, AppState>,
    text: String,
    as_task: Option<bool>,
    list: Option<String>,
    review: Option<bool>,
    return_on: Option<String>,
) -> Result<CaptureResultDto, JinErrorDto> {
    let return_on = return_on
        .map(|date| {
            chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| JinErrorDto {
                code: 2,
                kind: "usage".into(),
                message: "Return date must use YYYY-MM-DD.".into(),
                retriable: false,
                details: None,
            })
        })
        .transpose()?;
    capture_with_review_fn(
        &state.root,
        text,
        as_task.unwrap_or(false),
        list,
        review.unwrap_or(false),
        return_on,
    )
}
