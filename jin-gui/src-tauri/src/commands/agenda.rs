//! today_agenda command — hero view data (VG-GUI-2).

use std::path::Path;

use jin_core::dto::{AgendaDto, TodayProjectionDto};
use jin_core::ops::api;

use crate::error::JinErrorDto;
use crate::state::AppState;

/// Testable implementation — no Tauri runtime dependency.
///
/// `date` is an optional ISO date string (`"YYYY-MM-DD"`).
/// When `None` the agenda resolves to today in the configured display timezone.
pub fn today_agenda_fn(root: &Path, date: Option<String>) -> Result<AgendaDto, JinErrorDto> {
    let naive_date = date
        .map(|s| {
            chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|e| JinErrorDto {
                code: 2,
                kind: "usage".to_string(),
                message: format!("invalid date '{}': {}", s, e),
                retriable: false,
                details: None,
            })
        })
        .transpose()?;

    api::agenda_for_date(root, naive_date).map_err(JinErrorDto::from)
}

/// Testable connected Today projection. The legacy `today_agenda` command is
/// deliberately preserved for consumers that only require event buckets.
pub fn today_projection_fn(
    root: &Path,
    date: Option<String>,
) -> Result<TodayProjectionDto, JinErrorDto> {
    let naive_date = date
        .map(|s| {
            chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|e| JinErrorDto {
                code: 2,
                message: format!("invalid date '{}': {}", s, e),
                kind: "invalid_input".to_string(),
                retriable: false,
                details: None,
            })
        })
        .transpose()?;
    jin_core::ops::api::today_projection_for_date(root, naive_date).map_err(JinErrorDto::from)
}

/// Tauri command: today_agenda(date?: string) -> AgendaDto
#[tauri::command]
pub async fn today_agenda(
    state: tauri::State<'_, AppState>,
    date: Option<String>,
) -> Result<AgendaDto, JinErrorDto> {
    today_agenda_fn(&state.root, date)
}

/// Tauri command: today_projection(date?: string) -> TodayProjectionDto
#[tauri::command]
pub async fn today_projection(
    state: tauri::State<'_, AppState>,
    date: Option<String>,
) -> Result<TodayProjectionDto, JinErrorDto> {
    today_projection_fn(&state.root, date)
}
