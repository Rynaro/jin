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

#[tauri::command(rename_all = "snake_case")]
pub async fn sync_calendar_event(
    state: tauri::State<'_, AppState>,
    event_id: String,
) -> Result<u32, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("event sync", move || {
        jin_core::ops::sync::sync_event_with_http(
            &root,
            &event_id,
            &jin_core::google::client::ReqwestClient,
        )
        .map_err(JinErrorDto::from)
    })
    .await
}

#[cfg(test)]
mod ipc_tests {
    use super::*;

    #[test]
    fn snake_case_calendar_commands_reach_the_backend_through_tauri_ipc() {
        let root = tempfile::tempdir().unwrap();
        jin_core::ops::init(root.path()).unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::new(
                root.path().to_path_buf(),
                crate::root_resolver::LaunchState::Ready {
                    root: root.path().to_string_lossy().into_owned(),
                },
            ))
            .invoke_handler(tauri::generate_handler![
                sync_calendar_event,
                super::super::google_accounts::refresh_google_event_details,
                super::super::google_accounts::rename_google_account,
                super::super::google_accounts::connect_google_account,
                super::super::google_accounts::disconnect_google_account,
                super::super::google_accounts::refresh_google_calendars,
                super::super::google_accounts::set_google_calendar_enabled,
                super::super::google_accounts::review_quarantined_sync_operation
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        for (command, body) in [
            (
                "rename_google_account",
                serde_json::json!({"account_id": "invalid-account", "alias": "Personal"}),
            ),
            (
                "connect_google_account",
                serde_json::json!({"account_id": "invalid-account"}),
            ),
            (
                "disconnect_google_account",
                serde_json::json!({"account_id": "invalid-account"}),
            ),
            (
                "refresh_google_calendars",
                serde_json::json!({"account_id": "invalid-account"}),
            ),
            (
                "set_google_calendar_enabled",
                serde_json::json!({"account_id": "invalid-account", "calendar_id": "calendar", "enabled": true}),
            ),
            (
                "review_quarantined_sync_operation",
                serde_json::json!({"provider": "google", "account_id": "invalid-account", "calendar_id": "calendar", "operation_id": "missing", "resume": true}),
            ),
            (
                "sync_calendar_event",
                serde_json::json!({"event_id": "missing-event"}),
            ),
            (
                "refresh_google_event_details",
                serde_json::json!({"event_id": "missing-event", "account_id": "invalid-account", "calendar_id": "calendar"}),
            ),
        ] {
            let response = tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .map(|body| body.deserialize::<serde_json::Value>().unwrap());
            // Invalid local fixtures produce a domain error only after arguments
            // deserialize. A casing mismatch instead produces a raw IPC string.
            let error =
                response.expect_err("missing local event/account must fail without network");
            assert!(
                error.is_object(),
                "{command} rejected its argument contract: {error}"
            );
            assert!(error.get("code").is_some());
            assert!(!error.to_string().contains("missing required key"));
        }
    }
}
