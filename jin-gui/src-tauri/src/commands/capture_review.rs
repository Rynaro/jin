//! Thin bridge for the portable quick-capture review projection.

use std::path::Path;

use jin_core::model::CaptureReviewState;
use jin_core::ops::{api, capture_review};
use serde::Deserialize;

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SetCaptureReviewInput {
    pub kind: String,
    pub id: String,
    pub state: CaptureReviewState,
    pub return_on: Option<String>,
}

fn parse_date(value: Option<String>) -> Result<Option<chrono::NaiveDate>, JinErrorDto> {
    value
        .map(|date| {
            chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| JinErrorDto {
                code: 2,
                kind: "usage".into(),
                message: "Return date must use YYYY-MM-DD.".into(),
                retriable: false,
                details: None,
            })
        })
        .transpose()
}

pub fn list_capture_review_fn(
    root: &Path,
) -> Result<Vec<capture_review::CaptureReviewItemDto>, JinErrorDto> {
    api::list_capture_review(root).map_err(JinErrorDto::from)
}

pub fn set_capture_review_fn(root: &Path, input: SetCaptureReviewInput) -> Result<(), JinErrorDto> {
    api::set_capture_review(
        root,
        capture_review::SetCaptureReviewInput {
            kind: input.kind,
            id: input.id,
            state: input.state,
            return_on: parse_date(input.return_on)?,
        },
    )
    .map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn list_capture_review(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<capture_review::CaptureReviewItemDto>, JinErrorDto> {
    list_capture_review_fn(&state.root)
}

#[tauri::command]
pub async fn set_capture_review(
    state: tauri::State<'_, AppState>,
    input: SetCaptureReviewInput,
) -> Result<(), JinErrorDto> {
    set_capture_review_fn(&state.root, input)
}
