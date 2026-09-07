//! Store-root commands — P1 sovereignty: the user controls where their Markdown
//! store lives (SHOULD / GUI-S0 store-root spec).
//!
//! `set_store_root(path)` — persists the user-chosen path; takes effect on next launch.
//! `get_store_root()`     — returns the active root for the current session.
//!
//! Persistence mechanism: a small JSON file at
//!   `<OS config dir>/jin-gui/store_path.json`
//! (e.g., `~/.config/jin-gui/store_path.json` on Linux,
//!         `~/Library/Application Support/jin-gui/store_path.json` on macOS).

use crate::error::JinErrorDto;
use crate::root_resolver::write_persisted_root;
use crate::state::AppState;

fn config_dir_or_err() -> Result<std::path::PathBuf, JinErrorDto> {
    dirs::config_dir().ok_or_else(|| JinErrorDto {
        code: 1,
        kind: "other".to_string(),
        message: "cannot determine OS config directory — store path not persisted".to_string(),
        retriable: false,
        details: None,
    })
}

/// Persist the user-chosen jin store root.
///
/// The new root takes effect on the **next application launch** — a restart is
/// required. This is intentional for MVP; live-apply would need a `Mutex<PathBuf>`
/// in `AppState` plus re-init of all command state.
#[tauri::command]
pub async fn set_store_root(path: String) -> Result<(), JinErrorDto> {
    if path.trim().is_empty() {
        return Err(JinErrorDto {
            code: 2,
            kind: "usage".to_string(),
            message: "store root path must not be empty".to_string(),
            retriable: false,
            details: None,
        });
    }

    let config_dir = config_dir_or_err()?;
    write_persisted_root(&config_dir, &path).map_err(|e| JinErrorDto {
        code: 1,
        kind: "other".to_string(),
        message: format!("cannot save store path: {e}"),
        retriable: false,
        details: None,
    })?;
    Ok(())
}

/// Returns the active jin root for the current session.
///
/// This is the root that was resolved at application launch. It does **not**
/// change during the session — restart the app after `set_store_root` to apply.
#[tauri::command]
pub async fn get_store_root(state: tauri::State<'_, AppState>) -> Result<String, JinErrorDto> {
    Ok(state.root.display().to_string())
}
