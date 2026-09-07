//! Multi-account Google Calendar registry commands.
//!
//! These are thin adapters over jin-core. OAuth credentials never cross IPC.

use std::path::Path;

use jin_core::dto::GoogleAccountDto;
use jin_core::google::client::ReqwestClient;
use jin_core::ops::google_accounts;
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

fn parse_account_id(
    value: &str,
) -> Result<jin_core::google::account::GoogleAccountId, JinErrorDto> {
    jin_core::dto::google::account_id(value).map_err(JinErrorDto::from)
}

pub fn list_google_accounts_fn(root: &Path) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let config = Config::load(root).map_err(JinErrorDto::from)?;
    Ok(GoogleAccountDto::list(&config.google_registry))
}

pub fn add_google_account_fn(root: &Path, alias: &str) -> Result<GoogleAccountDto, JinErrorDto> {
    let id = google_accounts::add_account(root, alias).map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)?
        .into_iter()
        .find(|account| account.id == id.as_str())
        .ok_or_else(|| {
            JinErrorDto::from(jin_core::JinError::Integrity(
                "new Google account was not persisted".to_string(),
            ))
        })
}

pub fn rename_google_account_fn(
    root: &Path,
    account_id: &str,
    alias: &str,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    google_accounts::rename_account(root, &account_id, alias).map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn connect_google_account_fn(
    root: &Path,
    account_id: &str,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    google_accounts::login_account(root, &account_id).map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn disconnect_google_account_fn(
    root: &Path,
    account_id: &str,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    google_accounts::disconnect_account(root, &account_id).map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn refresh_google_calendars_fn(
    root: &Path,
    account_id: &str,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    let config = Config::load(root).map_err(JinErrorDto::from)?;
    let tokens = jin_core::google::secrets::load_tokens_for_account(root, &config, &account_id)
        .map_err(JinErrorDto::from)?;
    google_accounts::refresh_calendars(root, &account_id, &tokens.access_token, &ReqwestClient)
        .map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn set_google_calendar_enabled_fn(
    root: &Path,
    account_id: &str,
    calendar_id: &str,
    enabled: bool,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    google_accounts::set_calendar_enabled(root, &account_id, calendar_id, enabled)
        .map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn list_quarantined_sync_operations_fn(
    root: &Path,
) -> Result<Vec<jin_core::ops::sync::QuarantinedOperationDto>, JinErrorDto> {
    jin_core::ops::sync::list_quarantined_operations(root).map_err(JinErrorDto::from)
}

pub fn review_quarantined_sync_operation_fn(
    root: &Path,
    provider: &str,
    account_id: &str,
    calendar_id: &str,
    operation_id: &str,
    resume: bool,
) -> Result<(), JinErrorDto> {
    jin_core::ops::sync::review_quarantined_operation(
        root,
        provider,
        account_id,
        calendar_id,
        operation_id,
        resume,
    )
    .map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn list_google_accounts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    list_google_accounts_fn(&state.root)
}

#[tauri::command]
pub async fn add_google_account(
    state: tauri::State<'_, AppState>,
    alias: String,
) -> Result<GoogleAccountDto, JinErrorDto> {
    add_google_account_fn(&state.root, &alias)
}

#[tauri::command]
pub async fn rename_google_account(
    state: tauri::State<'_, AppState>,
    account_id: String,
    alias: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    rename_google_account_fn(&state.root, &account_id, &alias)
}

#[tauri::command]
pub async fn connect_google_account(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("Google account connection", move || {
        connect_google_account_fn(&root, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn disconnect_google_account(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    disconnect_google_account_fn(&state.root, &account_id)
}

#[tauri::command]
pub async fn refresh_google_calendars(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("Google calendar refresh", move || {
        refresh_google_calendars_fn(&root, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn set_google_calendar_enabled(
    state: tauri::State<'_, AppState>,
    account_id: String,
    calendar_id: String,
    enabled: bool,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    set_google_calendar_enabled_fn(&state.root, &account_id, &calendar_id, enabled)
}

#[tauri::command]
pub async fn list_quarantined_sync_operations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<jin_core::ops::sync::QuarantinedOperationDto>, JinErrorDto> {
    list_quarantined_sync_operations_fn(&state.root)
}

#[tauri::command]
pub async fn review_quarantined_sync_operation(
    state: tauri::State<'_, AppState>,
    provider: String,
    account_id: String,
    calendar_id: String,
    operation_id: String,
    resume: bool,
) -> Result<(), JinErrorDto> {
    review_quarantined_sync_operation_fn(
        &state.root,
        &provider,
        &account_id,
        &calendar_id,
        &operation_id,
        resume,
    )
}
