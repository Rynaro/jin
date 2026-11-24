//! Multi-account Google Calendar registry commands.
//!
//! These are thin adapters over jin-core. OAuth credentials never cross IPC.

use std::path::Path;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

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

fn connect_google_account_cancellable_fn(
    root: &Path,
    account_id: &str,
    attempt: &jin_core::google::auth::GoogleAuthAttempt,
) -> Result<
    (
        jin_core::google::account::GoogleAccountId,
        Vec<GoogleAccountDto>,
    ),
    JinErrorDto,
> {
    let account_id = parse_account_id(account_id)?;
    google_accounts::login_account_cancellable(root, &account_id, attempt)
        .map_err(JinErrorDto::from)?;
    Ok((account_id, list_google_accounts_fn(root)?))
}

pub fn connect_new_google_account_fn(
    root: &Path,
    alias: Option<&str>,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    google_accounts::connect_new_account(root, alias).map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

fn connect_new_google_account_cancellable_fn(
    root: &Path,
    alias: Option<&str>,
    attempt: &jin_core::google::auth::GoogleAuthAttempt,
) -> Result<
    (
        jin_core::google::account::GoogleAccountId,
        Vec<GoogleAccountDto>,
    ),
    JinErrorDto,
> {
    let account_id = google_accounts::connect_new_account_cancellable_with_id(root, alias, attempt)
        .map_err(JinErrorDto::from)?;
    Ok((account_id, list_google_accounts_fn(root)?))
}

#[derive(Clone, serde::Serialize)]
struct InitialGoogleCalendarPullFinished {
    account_id: String,
    attempt_id: String,
    status: String,
}

fn start_initial_google_calendar_pull<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: std::path::PathBuf,
    account_id: jin_core::google::account::GoogleAccountId,
    attempt_id: String,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let status = match jin_core::ops::sync::pull_account_inbound(&root, &account_id) {
            Ok(summary) => summary.status,
            Err(_) => "error".to_string(),
        };
        let _ = app.emit(
            "jin:google-calendar-initial-pull-finished",
            InitialGoogleCalendarPullFinished {
                account_id: account_id.to_string(),
                attempt_id,
                status,
            },
        );
    });
}

pub fn import_google_client_json_fn(root: &Path, path: &Path) -> Result<(), JinErrorDto> {
    let content = std::fs::read_to_string(path).map_err(|_| {
        JinErrorDto::from(jin_core::JinError::Integrity(
            "Jin could not read the selected OAuth client JSON file.".to_string(),
        ))
    })?;
    let mut config = Config::load(root).map_err(JinErrorDto::from)?;
    if google_environment_override_present() {
        return Err(JinErrorDto::from(jin_core::JinError::Auth(
            "Google OAuth environment settings are active. Clear both JIN_GOOGLE_CLIENT_ID and JIN_GOOGLE_CLIENT_SECRET before importing a vault client."
                .to_string(),
        )));
    }
    if config
        .google
        .client_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        && config
            .google
            .client_secret
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(JinErrorDto::from(jin_core::JinError::Auth(
            "A Google OAuth client is already configured for this vault.".to_string(),
        )));
    }
    jin_core::google::config::GoogleCredentials::import_desktop_client_json(&mut config, &content)
        .map_err(JinErrorDto::from)?;
    config.save().map_err(JinErrorDto::from)
}

fn google_environment_override_present() -> bool {
    ["JIN_GOOGLE_CLIENT_ID", "JIN_GOOGLE_CLIENT_SECRET"]
        .into_iter()
        .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty()))
}

pub fn google_client_configured_fn(root: &Path) -> Result<bool, JinErrorDto> {
    let config = Config::load(root).map_err(JinErrorDto::from)?;
    Ok(jin_core::google::config::GoogleCredentials::load(&config).is_ok())
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
    let tokens = jin_core::ops::sync::load_or_refresh_account_tokens_for_readonly(
        root,
        &account_id,
        &ReqwestClient,
    )
    .map_err(JinErrorDto::from)?;
    google_accounts::refresh_calendars(root, &account_id, &tokens.access_token, &ReqwestClient)
        .map_err(JinErrorDto::from)?;
    list_google_accounts_fn(root)
}

pub fn refresh_google_event_details_fn(
    root: &Path,
    event_id: &str,
    account_id: &str,
    calendar_id: &str,
) -> Result<(), JinErrorDto> {
    let account_id = parse_account_id(account_id)?;
    let tokens = jin_core::ops::sync::load_or_refresh_account_tokens_for_readonly(
        root,
        &account_id,
        &ReqwestClient,
    )
    .map_err(JinErrorDto::from)?;
    google_accounts::refresh_event_details(
        root,
        event_id,
        &account_id,
        calendar_id,
        &tokens.access_token,
        &ReqwestClient,
    )
    .map_err(JinErrorDto::from)
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

#[tauri::command(rename_all = "snake_case")]
pub async fn list_google_accounts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    list_google_accounts_fn(&state.root)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn add_google_account(
    state: tauri::State<'_, AppState>,
    alias: String,
) -> Result<GoogleAccountDto, JinErrorDto> {
    add_google_account_fn(&state.root, &alias)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rename_google_account(
    state: tauri::State<'_, AppState>,
    account_id: String,
    alias: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    rename_google_account_fn(&state.root, &account_id, &alias)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn connect_google_account<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    account_id: String,
    attempt_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let root = state.root.clone();
    let cancelled = state
        .begin_google_connection(attempt_id.clone())
        .map_err(|message| JinErrorDto::from(jin_core::JinError::Auth(message)))?;
    let result = super::blocking::run("Google account connection", move || {
        connect_google_account_cancellable_fn(&root, &account_id, &cancelled)
    })
    .await;
    state.finish_google_connection(&attempt_id);
    let (account_id, accounts) = result?;
    start_initial_google_calendar_pull(app, state.root.clone(), account_id, attempt_id);
    Ok(accounts)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn connect_new_google_account<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    alias: Option<String>,
    attempt_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    let root = state.root.clone();
    let cancelled = state
        .begin_google_connection(attempt_id.clone())
        .map_err(|message| JinErrorDto::from(jin_core::JinError::Auth(message)))?;
    let result = super::blocking::run("Google Calendar connection", move || {
        connect_new_google_account_cancellable_fn(&root, alias.as_deref(), &cancelled)
    })
    .await;
    state.finish_google_connection(&attempt_id);
    let (account_id, accounts) = result?;
    start_initial_google_calendar_pull(app, state.root.clone(), account_id, attempt_id);
    Ok(accounts)
}

/// Stop the one specific browser authorization attempt. The loopback listener
/// sees this within one poll interval and drops before a stale callback can be
/// accepted by a later retry.
#[tauri::command(rename_all = "snake_case")]
pub async fn cancel_google_connection(
    state: tauri::State<'_, AppState>,
    attempt_id: String,
) -> Result<bool, JinErrorDto> {
    let cancelled = state.cancel_google_connection(&attempt_id);
    if cancelled {
        state
            .wait_for_google_connection_to_finish(&attempt_id)
            .await;
    }
    Ok(cancelled)
}

/// Pick and import a Desktop OAuth client JSON file entirely in the native
/// process. Cancelling is a no-op and never exposes a filesystem path to JS.
#[tauri::command(rename_all = "snake_case")]
pub async fn import_google_client_json(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, JinErrorDto> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Google OAuth client", &["json"])
        .pick_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|_| {
        JinErrorDto::from(jin_core::JinError::Integrity(
            "The OAuth client picker closed unexpectedly. Try again.".to_string(),
        ))
    })?
    else {
        return Ok(false);
    };
    let path = path.as_path().ok_or_else(|| {
        JinErrorDto::from(jin_core::JinError::Integrity(
            "The selected OAuth client is not available as a local file.".to_string(),
        ))
    })?;
    import_google_client_json_fn(&state.root, path)?;
    Ok(true)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn google_client_configured(
    state: tauri::State<'_, AppState>,
) -> Result<bool, JinErrorDto> {
    google_client_configured_fn(&state.root)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn disconnect_google_account(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    disconnect_google_account_fn(&state.root, &account_id)
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
pub async fn refresh_google_event_details(
    state: tauri::State<'_, AppState>,
    event_id: String,
    account_id: String,
    calendar_id: String,
) -> Result<(), JinErrorDto> {
    refresh_google_event_details_fn(&state.root, &event_id, &account_id, &calendar_id)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_google_calendar_enabled(
    state: tauri::State<'_, AppState>,
    account_id: String,
    calendar_id: String,
    enabled: bool,
) -> Result<Vec<GoogleAccountDto>, JinErrorDto> {
    set_google_calendar_enabled_fn(&state.root, &account_id, &calendar_id, enabled)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_quarantined_sync_operations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<jin_core::ops::sync::QuarantinedOperationDto>, JinErrorDto> {
    list_quarantined_sync_operations_fn(&state.root)
}

#[tauri::command(rename_all = "snake_case")]
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
