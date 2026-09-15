//! AppState — shared state injected into every #[tauri::command].

use std::sync::Arc;
use std::sync::Mutex;

use tokio::sync::Notify;

use crate::root_resolver::LaunchState;

/// Application state managed by the Tauri runtime.
/// Injected into commands via `tauri::State<'_, AppState>`.
pub struct AppState {
    /// Path to the jin root directory (the one containing `.jin/config.toml`).
    pub root: std::path::PathBuf,
    /// Wakes the reminder scheduler after a successful task mutation.
    pub reminder_wake: Arc<Notify>,
    /// Launch mode is chosen once before the WebView starts. The root remains
    /// immutable; setup completion restarts rather than swapping it in place.
    pub launch: LaunchState,
    /// Serializes durable first-run writes and initialization.
    pub bootstrap_gate: Mutex<()>,
}

impl AppState {
    pub fn new(root: std::path::PathBuf, launch: LaunchState) -> Self {
        Self {
            root,
            reminder_wake: Arc::new(Notify::new()),
            launch,
            bootstrap_gate: Mutex::new(()),
        }
    }

    pub fn wake_reminders(&self) {
        self.reminder_wake.notify_one();
    }
}
