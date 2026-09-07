//! AppState — shared state injected into every #[tauri::command].

use std::sync::Arc;

use tokio::sync::Notify;

/// Application state managed by the Tauri runtime.
/// Injected into commands via `tauri::State<'_, AppState>`.
pub struct AppState {
    /// Path to the jin root directory (the one containing `.jin/config.toml`).
    pub root: std::path::PathBuf,
    /// Wakes the reminder scheduler after a successful task mutation.
    pub reminder_wake: Arc<Notify>,
}

impl AppState {
    pub fn new(root: std::path::PathBuf) -> Self {
        Self {
            root,
            reminder_wake: Arc::new(Notify::new()),
        }
    }

    pub fn wake_reminders(&self) {
        self.reminder_wake.notify_one();
    }
}
