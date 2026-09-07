// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use jin_gui::root_resolver::resolve_root_impl;

fn main() {
    let root = resolve_root();

    // Auto-initialize the jin root if it does not yet exist.
    // ops::init is idempotent — safe to call on an already-initialized root.
    // This ensures first-launch works without requiring the user to run `jin init`.
    jin_core::ops::init(&root)
        .unwrap_or_else(|e| panic!("Failed to initialize jin root at {}: {e}", root.display()));

    jin_gui::run(root);
}

/// Determine the jin root directory.
///
/// Precedence:
///   1. `JIN_ROOT` env var (override for power users / CI).
///   2. Persisted store path (user chose it in Settings).
///   3. Default `~/Jin` — NEVER `current_dir()`.
fn resolve_root() -> std::path::PathBuf {
    resolve_root_impl(
        std::env::var("JIN_ROOT").ok().as_deref(),
        dirs::home_dir().as_deref(),
        dirs::config_dir().as_deref(),
    )
}
