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
    promote_task_duration_routed_fn(
        root,
        task_id,
        slot,
        operation_id,
        account_id,
        calendar_id,
        local_only,
        60,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn promote_task_duration_routed_fn(
    root: &Path,
    task_id: String,
    slot: TemporalSlot,
    operation_id: String,
    account_id: Option<String>,
    calendar_id: Option<String>,
    local_only: bool,
    duration_minutes: u32,
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
    let event = promote::promote_with_duration_and_destination_and_operation_id(
        root,
        &task_id,
        promote::PromoteParams {
            start_dt,
            tzid: slot.tzid,
        },
        duration_minutes,
        target,
        local_only,
        &operation_id,
    )
    .map_err(JinErrorDto::from)?;

    // Re-fetch from the index so the returned DTO reflects the derived_from edge
    // that link::create_link wrote to disk AFTER the event was initially created.
    api::get_event(root, event.id()).map_err(JinErrorDto::from)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn promote_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
    slot: TemporalSlot,
    operation_id: String,
    account_id: Option<String>,
    calendar_id: Option<String>,
    local_only: Option<bool>,
    duration_minutes: Option<u32>,
) -> Result<EventDto, JinErrorDto> {
    promote_task_duration_routed_fn(
        &state.root,
        task_id,
        slot,
        operation_id,
        account_id,
        calendar_id,
        local_only.unwrap_or(false),
        duration_minutes.unwrap_or(60),
    )
}

#[cfg(test)]
mod ipc_tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn reviewed_duration_and_snake_case_arguments_reach_real_tauri_dispatch() {
        let root = tempfile::tempdir().unwrap();
        jin_core::ops::init(root.path()).unwrap();
        let task = jin_core::ops::workflows::create_task(
            root.path(),
            jin_core::ops::tasks::CreateTaskParams {
                title: "Follow up".into(),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::new(
                root.path().to_path_buf(),
                crate::root_resolver::LaunchState::Ready {
                    root: root.path().display().to_string(),
                },
            ))
            .invoke_handler(tauri::generate_handler![promote_task])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let response = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "promote_task".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(json!({
                    "task_id": task.id(), "operation_id": "actual-ipc-duration", "local_only": true,
                    "duration_minutes": 45,
                    "slot": { "when": "2026-11-20T14:15:00", "tzid": "America/Sao_Paulo" }
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("snake-case IPC arguments must reach the promotion command")
        .deserialize::<Value>()
        .unwrap();
        assert_eq!(response["derived_from"], task.id());
        assert_eq!(response["start"], "2026-11-20T14:15:00");
        assert_eq!(response["end"], "2026-11-20T15:00:00");
    }
}
