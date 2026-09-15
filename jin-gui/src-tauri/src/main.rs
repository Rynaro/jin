// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use jin_gui::root_resolver::{resolve_launch_state, LaunchState};

fn main() {
    let (root, launch) = resolve_launch();
    jin_gui::run(root, launch);
}

/// Determine the jin root directory.
///
/// Precedence:
///   1. `JIN_ROOT` env var (override for power users / CI).
///   2. Persisted store path (user chose it in Settings).
///   3. Default `~/Jin` — NEVER `current_dir()`.
fn resolve_launch() -> (std::path::PathBuf, LaunchState) {
    resolve_launch_state(
        std::env::var("JIN_ROOT").ok().as_deref(),
        dirs::home_dir().as_deref(),
        dirs::config_dir().as_deref(),
    )
}
