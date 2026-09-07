//! Auth commands: auth_status, auth_login, auth_logout.

use std::path::Path;

use serde::Serialize;

use jin_core::google::secrets::{delete_tokens, detect_backend, load_tokens};
use jin_core::Config;

use crate::error::JinErrorDto;
use crate::state::AppState;

/// Auth status DTO returned to the frontend.
#[derive(Debug, Serialize)]
pub struct AuthStatusDto {
    /// "connected" | "disconnected" | "needs_reauth"
    pub state: String,
    pub account: Option<String>,
    /// Unix timestamp (seconds) when the access token expires. `None` if disconnected.
    pub expires_at: Option<i64>,
    /// Token storage backend: "keyring" | "encrypted-file"
    pub backend: String,
}

pub fn auth_status_fn(root: &Path) -> Result<AuthStatusDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let backend = detect_backend(root, &cfg);

    match load_tokens(root, &cfg) {
        Ok(tokens) => {
            let state = if tokens.is_expired() {
                "needs_reauth"
            } else {
                "connected"
            };
            Ok(AuthStatusDto {
                state: state.to_string(),
                account: tokens.account,
                expires_at: Some(tokens.expires_at),
                backend: backend.name().to_string(),
            })
        }
        Err(_) => Ok(AuthStatusDto {
            state: "disconnected".to_string(),
            account: None,
            expires_at: None,
            backend: backend.name().to_string(),
        }),
    }
}

/// auth_login: run the PKCE + loopback OAuth flow.
///
/// This opens the system browser and cannot be exercised headlessly.
/// It is implemented but not covered by headless bridge tests (VG-GUI-8).
pub fn auth_login_fn(root: &Path) -> Result<AuthStatusDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    let creds =
        jin_core::google::config::GoogleCredentials::load(&cfg).map_err(JinErrorDto::from)?;
    let tokens = jin_core::google::auth::run_auth_flow(&creds).map_err(JinErrorDto::from)?;
    jin_core::google::secrets::save_tokens(root, &cfg, &tokens).map_err(JinErrorDto::from)?;
    // Re-read status after saving
    auth_status_fn(root)
}

pub fn auth_logout_fn(root: &Path) -> Result<AuthStatusDto, JinErrorDto> {
    let cfg = Config::load(root).map_err(JinErrorDto::from)?;
    delete_tokens(root, &cfg).map_err(JinErrorDto::from)?;
    auth_status_fn(root)
}

#[tauri::command]
pub async fn auth_status(state: tauri::State<'_, AppState>) -> Result<AuthStatusDto, JinErrorDto> {
    auth_status_fn(&state.root)
}

#[tauri::command]
pub async fn auth_login(state: tauri::State<'_, AppState>) -> Result<AuthStatusDto, JinErrorDto> {
    let root = state.root.clone();
    super::blocking::run("Google login", move || auth_login_fn(&root)).await
}

#[tauri::command]
pub async fn auth_logout(state: tauri::State<'_, AppState>) -> Result<AuthStatusDto, JinErrorDto> {
    auth_logout_fn(&state.root)
}
