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
    /// The single browser authorization that can own the loopback listener.
    /// The attempt id prevents an old Cancel click from cancelling a retry.
    google_connection: Mutex<Option<GoogleConnectionAttempt>>,
    google_connection_finished: Arc<Notify>,
}

struct GoogleConnectionAttempt {
    id: String,
    attempt: Arc<jin_core::google::auth::GoogleAuthAttempt>,
}

impl AppState {
    pub fn new(root: std::path::PathBuf, launch: LaunchState) -> Self {
        Self {
            root,
            reminder_wake: Arc::new(Notify::new()),
            launch,
            bootstrap_gate: Mutex::new(()),
            google_connection: Mutex::new(None),
            google_connection_finished: Arc::new(Notify::new()),
        }
    }

    pub fn wake_reminders(&self) {
        self.reminder_wake.notify_one();
    }

    pub fn begin_google_connection(
        &self,
        attempt_id: String,
    ) -> Result<Arc<jin_core::google::auth::GoogleAuthAttempt>, String> {
        if attempt_id.trim().is_empty() {
            return Err("Google sign-in attempt id is required".to_string());
        }
        let mut active = self
            .google_connection
            .lock()
            .expect("Google connection lock poisoned");
        if active.is_some() {
            return Err("Google sign-in is already in progress. Cancel it or finish it before trying again."
                .to_string());
        }
        let attempt = Arc::new(jin_core::google::auth::GoogleAuthAttempt::new());
        *active = Some(GoogleConnectionAttempt {
            id: attempt_id,
            attempt: Arc::clone(&attempt),
        });
        Ok(attempt)
    }

    pub fn finish_google_connection(&self, attempt_id: &str) {
        let mut active = self
            .google_connection
            .lock()
            .expect("Google connection lock poisoned");
        if active
            .as_ref()
            .is_some_and(|attempt| attempt.id == attempt_id)
        {
            *active = None;
            self.google_connection_finished.notify_one();
        }
    }

    pub fn cancel_google_connection(&self, attempt_id: &str) -> bool {
        let active = self
            .google_connection
            .lock()
            .expect("Google connection lock poisoned");
        let Some(active) = active.as_ref().filter(|attempt| attempt.id == attempt_id) else {
            return false;
        };
        active.attempt.cancel()
    }

    /// Wait until a successful cancellation has actually released the old
    /// loopback listener, so a retry receives a distinct safe listener.
    pub async fn wait_for_google_connection_to_finish(&self, attempt_id: &str) {
        loop {
            let notified = self.google_connection_finished.notified();
            let still_active = self
                .google_connection
                .lock()
                .expect("Google connection lock poisoned")
                .as_ref()
                .is_some_and(|attempt| attempt.id == attempt_id);
            if !still_active {
                return;
            }
            notified.await;
        }
    }
}
