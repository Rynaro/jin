//! Root directory resolution for the Jin GUI.
//!
//! Precedence (highest → lowest):
//!   1. `JIN_ROOT` environment variable — explicit override for power users and CI.
//!   2. Persisted store path — user changed it via Settings → "Change store folder".
//!      Written to `<OS config dir>/jin-gui/store_path.json`.
//!   3. Default `~/Jin` — sensible per-user default; NEVER `std::env::current_dir()`.
//!
//! # Why not `current_dir()`?
//! Under `npx tauri dev` the process cwd is `jin-gui/src-tauri/` — not a jin root
//! (no `.jin/config.toml`). Every command would return exit-code 7 / "not initialized"
//! and the whole app would be non-functional on first launch.
//!
//! # Testability
//! `resolve_root_impl` accepts all inputs as parameters so unit tests can inject
//! arbitrary home/config dirs without mutating real environment state.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Sub-path inside the OS config directory where the user's chosen store root
/// is persisted (e.g., `~/.config/jin-gui/store_path.json` on Linux).
const CONFIG_FILE_SUBPATH: &str = "jin-gui/store_path.json";
const FIRST_RUN_STATE_SUBPATH: &str = "jin-gui/first_run_state.json";

#[derive(Serialize, Deserialize)]
struct StorePathConfig {
    store_root: String,
}

/// The small, durable part of onboarding. It deliberately lives outside the
/// selected store: a failed initialization must not make the recovery state
/// disappear with the candidate directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FirstRunState {
    pub schema_version: u8,
    pub status: FirstRunStatus,
    pub step: FirstRunStep,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunStatus {
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunStep {
    Welcome,
    Storage,
    Functions,
    Settings,
    Review,
}

impl FirstRunState {
    pub fn new() -> Self {
        Self {
            schema_version: 1,
            status: FirstRunStatus::InProgress,
            step: FirstRunStep::Welcome,
            selected_root: None,
        }
    }
}

impl Default for FirstRunState {
    fn default() -> Self {
        Self::new()
    }
}

/// Native launch mode. `root` is never changed after this decision; finishing
/// setup requests a process restart so the ordinary app starts with a fully
/// initialized, immutable AppState root.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum LaunchState {
    Ready {
        root: String,
    },
    FirstRun {
        state: FirstRunState,
        suggested_root: String,
    },
    RootUnavailable {
        root: String,
        reason: String,
        env_locked: bool,
    },
}

/// Read the persisted store root from the OS app-config directory.
///
/// Returns `None` if the config file does not exist or cannot be parsed.
pub fn read_persisted_root(config_dir: &Path) -> Option<PathBuf> {
    let file = config_dir.join(CONFIG_FILE_SUBPATH);
    let text = std::fs::read_to_string(file).ok()?;
    let cfg: StorePathConfig = serde_json::from_str(&text).ok()?;
    let p = PathBuf::from(cfg.store_root);
    if p.as_os_str().is_empty() {
        None
    } else {
        Some(p)
    }
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    use std::io::Write;
    let mut file = std::fs::File::create(&temp)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    std::fs::rename(temp, path)
}

/// Persist the user-chosen store root to the OS app-config directory.
///
/// Creates parent directories as needed. Overwrites any existing value.
pub fn write_persisted_root(config_dir: &Path, store_root: &str) -> std::io::Result<()> {
    let file = config_dir.join(CONFIG_FILE_SUBPATH);
    let cfg = StorePathConfig {
        store_root: store_root.to_string(),
    };
    write_json_atomic(&file, &cfg)
}

pub fn read_first_run_state(config_dir: &Path) -> Option<FirstRunState> {
    let file = config_dir.join(FIRST_RUN_STATE_SUBPATH);
    let text = std::fs::read_to_string(file).ok()?;
    let state: FirstRunState = serde_json::from_str(&text).ok()?;
    (state.schema_version == 1).then_some(state)
}

pub fn write_first_run_state(config_dir: &Path, state: &FirstRunState) -> std::io::Result<()> {
    write_json_atomic(&config_dir.join(FIRST_RUN_STATE_SUBPATH), state)
}

pub fn root_is_initialized(root: &Path) -> bool {
    jin_core::Config::load(root).is_ok()
}

/// A setup candidate must be an absolute directory that is either empty or
/// already a Jin root. This prevents silently placing Jin metadata in a folder
/// that contains an unrelated project or files.
pub fn validate_first_run_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() {
        return Err("Choose an absolute folder path.".to_string());
    }
    match std::fs::metadata(root) {
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Choose a folder, not a file.".to_string());
        }
        Ok(_) if root_is_initialized(root) => return Ok(()),
        Ok(_) => {
            let mut entries = std::fs::read_dir(root)
                .map_err(|error| format!("Cannot inspect that folder: {error}"))?;
            if entries.next().is_some() {
                return Err(
                    "Choose an empty folder or a folder already initialized by Jin.".to_string(),
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Cannot use that folder: {error}")),
    }
    Ok(())
}

/// Resolve the mode before any core operation or background job starts.
pub fn resolve_launch_state(
    jin_root_env: Option<&str>,
    home_dir: Option<&Path>,
    config_dir: Option<&Path>,
) -> (PathBuf, LaunchState) {
    let env_root = jin_root_env
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let persisted_root = config_dir.and_then(read_persisted_root);
    let root = env_root
        .clone()
        .or_else(|| persisted_root.clone())
        .unwrap_or_else(|| resolve_root_impl(None, home_dir, None));

    let saved_first_run = config_dir.and_then(read_first_run_state);
    // A pending marker always wins for non-environment launches. This covers
    // interruption before a candidate was selected and after the root pointer
    // was written; an existing default root must not skip a resumable setup.
    if saved_first_run
        .as_ref()
        .is_some_and(|state| state.status == FirstRunStatus::InProgress)
        && env_root.is_none()
    {
        let suggested_root = root.display().to_string();
        return (
            root,
            LaunchState::FirstRun {
                state: saved_first_run.expect("checked above"),
                suggested_root,
            },
        );
    }

    if root_is_initialized(&root) {
        return (
            root.clone(),
            LaunchState::Ready {
                root: root.display().to_string(),
            },
        );
    }

    // A config-shaped root that cannot be loaded is not a fresh installation.
    // Starting normal controllers would be unsafe, while showing the tutorial
    // would offer a candidate it is intentionally forbidden to overwrite.
    if root.join(".jin/config.toml").exists() {
        return (
            root.clone(),
            LaunchState::RootUnavailable {
                root: root.display().to_string(),
                reason: "Jin found a storage folder, but its configuration cannot be read."
                    .to_string(),
                env_locked: env_root.is_some(),
            },
        );
    }

    if env_root.is_some() || persisted_root.is_some() {
        return (
            root.clone(),
            LaunchState::RootUnavailable {
                root: root.display().to_string(),
                reason: if env_root.is_some() {
                    "JIN_ROOT points to a folder that is not initialized by Jin.".to_string()
                } else {
                    "Your previously selected Jin folder is unavailable or is not initialized."
                        .to_string()
                },
                env_locked: env_root.is_some(),
            },
        );
    }

    if saved_first_run
        .as_ref()
        .is_some_and(|state| state.status == FirstRunStatus::Completed)
    {
        return (
            root.clone(),
            LaunchState::RootUnavailable {
                root: root.display().to_string(),
                reason: "Jin setup completed, but its selected folder is unavailable.".to_string(),
                env_locked: false,
            },
        );
    }
    let state = saved_first_run
        .filter(|state| state.status == FirstRunStatus::InProgress)
        .unwrap_or_default();
    let suggested_root = root.display().to_string();
    (
        root,
        LaunchState::FirstRun {
            state,
            suggested_root,
        },
    )
}

/// Resolve the jin root directory.
///
/// Fully injectable for unit-testability — no global state is accessed directly.
/// Call-site in `main.rs` passes `dirs::home_dir()` / `dirs::config_dir()`.
///
/// # Parameters
/// - `jin_root_env`: Value of the `JIN_ROOT` env var, if set.
/// - `home_dir`: User's home directory.
/// - `config_dir`: OS app-config directory (e.g., `~/.config` on Linux).
pub fn resolve_root_impl(
    jin_root_env: Option<&str>,
    home_dir: Option<&Path>,
    config_dir: Option<&Path>,
) -> PathBuf {
    // (1) JIN_ROOT env override — explicit beats everything.
    if let Some(p) = jin_root_env {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }

    // (2) Persisted store path — user changed it via Settings.
    if let Some(cfg_dir) = config_dir {
        if let Some(persisted) = read_persisted_root(cfg_dir) {
            return persisted;
        }
    }

    // (3) Default ~/Jin — never cwd.
    if let Some(home) = home_dir {
        return home.join("Jin");
    }

    // Absolute last resort: should never happen on any supported OS.
    // Append /Jin even here to avoid cwd-as-root bug.
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join("Jin")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ── resolve_root_impl precedence tests ──────────────────────────────────────

    #[test]
    fn jin_root_env_takes_precedence_over_default() {
        let home = TempDir::new().unwrap();
        let result = resolve_root_impl(Some("/custom/jin/root"), Some(home.path()), None);
        assert_eq!(result, PathBuf::from("/custom/jin/root"));
    }

    #[test]
    fn jin_root_env_takes_precedence_over_persisted() {
        let config_dir = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        write_persisted_root(config_dir.path(), "/some/persisted/path").unwrap();
        let result = resolve_root_impl(
            Some("/env/override"),
            Some(home.path()),
            Some(config_dir.path()),
        );
        assert_eq!(result, PathBuf::from("/env/override"));
    }

    #[test]
    fn persisted_path_takes_precedence_over_default() {
        let config_dir = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        write_persisted_root(config_dir.path(), "/my/custom/store").unwrap();
        let result = resolve_root_impl(None, Some(home.path()), Some(config_dir.path()));
        assert_eq!(result, PathBuf::from("/my/custom/store"));
    }

    #[test]
    fn defaults_to_home_jin_when_no_env_or_persisted() {
        let home = TempDir::new().unwrap();
        let result = resolve_root_impl(None, Some(home.path()), None);
        assert_eq!(result, home.path().join("Jin"));
    }

    #[test]
    fn no_home_no_env_no_persisted_appends_jin_not_bare_cwd() {
        // Even without a home dir, the fallback must end with /Jin.
        let result = resolve_root_impl(None, None, None);
        let s = result.to_string_lossy();
        assert!(s.ends_with("Jin"), "fallback must end with /Jin, got: {s}");
    }

    #[test]
    fn empty_jin_root_env_falls_through_to_default() {
        let home = TempDir::new().unwrap();
        // Explicitly empty string should be ignored (not used as root "").
        let result = resolve_root_impl(Some(""), Some(home.path()), None);
        assert_eq!(result, home.path().join("Jin"));
    }

    // ── read_persisted_root ──────────────────────────────────────────────────────

    #[test]
    fn read_persisted_root_returns_none_when_file_missing() {
        let config_dir = TempDir::new().unwrap();
        assert!(read_persisted_root(config_dir.path()).is_none());
    }

    #[test]
    fn read_persisted_root_returns_none_for_invalid_json() {
        let config_dir = TempDir::new().unwrap();
        let file = config_dir.path().join("jin-gui/store_path.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "not-json!!!").unwrap();
        assert!(read_persisted_root(config_dir.path()).is_none());
    }

    // ── write_persisted_root → read_persisted_root round-trip ──────────────────

    #[test]
    fn write_then_read_persisted_root_roundtrip() {
        let config_dir = TempDir::new().unwrap();
        let path = "/home/alice/Documents/jin-store";
        write_persisted_root(config_dir.path(), path).unwrap();
        let read = read_persisted_root(config_dir.path()).unwrap();
        assert_eq!(read, PathBuf::from(path));
    }

    #[test]
    fn write_persisted_root_creates_parent_directories() {
        let config_dir = TempDir::new().unwrap();
        // jin-gui/ subdirectory does not exist yet
        assert!(!config_dir.path().join("jin-gui").exists());
        write_persisted_root(config_dir.path(), "/some/path").unwrap();
        assert!(config_dir.path().join("jin-gui").exists());
    }

    #[test]
    fn write_persisted_root_overwrites_existing() {
        let config_dir = TempDir::new().unwrap();
        write_persisted_root(config_dir.path(), "/path/one").unwrap();
        write_persisted_root(config_dir.path(), "/path/two").unwrap();
        let read = read_persisted_root(config_dir.path()).unwrap();
        assert_eq!(read, PathBuf::from("/path/two"));
    }

    #[test]
    fn new_default_root_starts_first_run_without_initializing() {
        let home = TempDir::new().unwrap();
        let config = TempDir::new().unwrap();
        let (root, launch) = resolve_launch_state(None, Some(home.path()), Some(config.path()));
        assert_eq!(root, home.path().join("Jin"));
        assert!(matches!(launch, LaunchState::FirstRun { .. }));
        assert!(!root.exists());
    }

    #[test]
    fn valid_initialized_root_starts_ready() {
        let home = TempDir::new().unwrap();
        let config = TempDir::new().unwrap();
        let root = home.path().join("Jin");
        jin_core::ops::init(&root).unwrap();
        let (_, launch) = resolve_launch_state(None, Some(home.path()), Some(config.path()));
        assert!(matches!(launch, LaunchState::Ready { .. }));
    }

    #[test]
    fn in_progress_marker_resumes_before_an_initialized_default() {
        let home = TempDir::new().unwrap();
        let config = TempDir::new().unwrap();
        jin_core::ops::init(&home.path().join("Jin")).unwrap();
        write_first_run_state(config.path(), &FirstRunState::new()).unwrap();
        let (_, launch) = resolve_launch_state(None, Some(home.path()), Some(config.path()));
        assert!(matches!(launch, LaunchState::FirstRun { .. }));
    }

    #[test]
    fn explicit_missing_root_is_recoverable_and_never_falls_back() {
        let home = TempDir::new().unwrap();
        let config = TempDir::new().unwrap();
        let explicit = home.path().join("elsewhere");
        let (_, launch) = resolve_launch_state(
            Some(explicit.to_str().unwrap()),
            Some(home.path()),
            Some(config.path()),
        );
        assert!(matches!(
            launch,
            LaunchState::RootUnavailable {
                env_locked: true,
                ..
            }
        ));
    }

    #[test]
    fn corrupt_jin_config_never_starts_ready() {
        let home = TempDir::new().unwrap();
        let config = TempDir::new().unwrap();
        let root = home.path().join("Jin");
        std::fs::create_dir_all(root.join(".jin")).unwrap();
        std::fs::write(root.join(".jin/config.toml"), "this is not valid = toml =").unwrap();
        let (_, launch) = resolve_launch_state(None, Some(home.path()), Some(config.path()));
        assert!(matches!(launch, LaunchState::RootUnavailable { .. }));
    }

    #[test]
    fn first_run_state_round_trips_and_validates_candidates() {
        let config = TempDir::new().unwrap();
        let empty = TempDir::new().unwrap();
        let file = tempfile::NamedTempFile::new().unwrap();
        let state = FirstRunState {
            schema_version: 1,
            status: FirstRunStatus::InProgress,
            step: FirstRunStep::Storage,
            selected_root: Some(empty.path().display().to_string()),
        };
        write_first_run_state(config.path(), &state).unwrap();
        assert_eq!(read_first_run_state(config.path()), Some(state));
        assert!(validate_first_run_root(empty.path()).is_ok());
        assert!(validate_first_run_root(file.path()).is_err());
        std::fs::write(empty.path().join("unrelated.txt"), "keep me").unwrap();
        assert!(validate_first_run_root(empty.path()).is_err());
    }
}
