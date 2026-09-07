//! promote_task command.

use std::path::Path;

use serde::Deserialize;

use jin_core::dto::EventDto;
use jin_core::ops::{api, promote};

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct TemporalSlot {
    /// ISO 8601 datetime: "YYYY-MM-DDTHH:MM:SS"
    pub when: String,
    /// Optional IANA timezone id. `None` → floating event.
    pub tzid: Option<String>,
}

pub fn promote_task_fn(
    root: &Path,
    task_id: String,
    slot: TemporalSlot,
    operation_id: String,
) -> Result<EventDto, JinErrorDto> {
    promote_task_routed_fn(root, task_id, slot, operation_id, None, None, false)
}

pub fn promote_task_routed_fn(
    root: &Path,
    task_id: String,
    slot: TemporalSlot,
    operation_id: String,
    account_id: Option<String>,
    calendar_id: Option<String>,
    local_only: bool,
) -> Result<EventDto, JinErrorDto> {
    use chrono::NaiveDateTime;

    let start_dt = NaiveDateTime::parse_from_str(&slot.when, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(&slot.when, "%Y-%m-%dT%H:%M"))
        .map_err(|_| JinErrorDto {
            code: 2,
            kind: "usage".to_string(),
            message: format!(
                "invalid when datetime '{}'; expected YYYY-MM-DDTHH:MM:SS",
                slot.when
            ),
            retriable: false,
            details: None,
        })?;

    jin_core::ops::recoverable_operations::validate_operation_id(&operation_id)
        .map_err(JinErrorDto::from)?;
    let target = match (account_id, calendar_id) {
        (Some(account_id), Some(calendar_id)) => Some(
            jin_core::google::account::EventSyncTarget::new(
                jin_core::google::account::GoogleAccountId::parse(account_id)
                    .map_err(JinErrorDto::from)?,
                calendar_id,
            )
            .map_err(JinErrorDto::from)?,
        ),
        (None, None) => None,
        _ => {
            return Err(JinErrorDto::from(jin_core::JinError::InvalidInput(
                "account_id and calendar_id must be provided together".to_string(),
            )))
        }
    };
    let event = promote::promote_with_destination_and_operation_id(
        root,
        &task_id,
        promote::PromoteParams {
            start_dt,
            tzid: slot.tzid,
        },
        target,
        local_only,
        &operation_id,
    )
    .map_err(JinErrorDto::from)?;

    // Re-fetch from the index so the returned DTO reflects the derived_from edge
    // that link::create_link wrote to disk AFTER the event was initially created.
    api::get_event(root, event.id()).map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn promote_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
    slot: TemporalSlot,
    operation_id: String,
    account_id: Option<String>,
    calendar_id: Option<String>,
    local_only: Option<bool>,
) -> Result<EventDto, JinErrorDto> {
    promote_task_routed_fn(
        &state.root,
        task_id,
        slot,
        operation_id,
        account_id,
        calendar_id,
        local_only.unwrap_or(false),
    )
}
