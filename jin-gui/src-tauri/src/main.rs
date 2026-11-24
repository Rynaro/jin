// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use jin_gui::root_resolver::{resolve_launch_state, LaunchState};

fn main() {
    let (root, mut launch) = resolve_launch();
    // A synchronized portable folder arrives without this device's derived
    // state. Bootstrap it before the GUI creates controllers.
    if !matches!(launch, LaunchState::FirstRun { .. })
        && jin_core::Config::is_portable_workspace(&root)
    {
        match jin_core::ops::init(&root) {
            Ok(_) => {
                launch = LaunchState::Ready {
                    root: root.display().to_string(),
                };
            }
            Err(error) => {
                let env_locked = matches!(
                    launch,
                    LaunchState::RootUnavailable {
                        env_locked: true,
                        ..
                    }
                ) || std::env::var_os("JIN_ROOT").is_some();
                launch = LaunchState::RootUnavailable {
                    root: root.display().to_string(),
                    reason: format!(
                        "Jin could not initialize local state for this shared workspace: {error}"
                    ),
                    env_locked,
                };
            }
        }
    }
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
