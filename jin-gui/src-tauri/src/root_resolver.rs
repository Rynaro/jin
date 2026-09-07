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

#[derive(Serialize, Deserialize)]
struct StorePathConfig {
    store_root: String,
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

/// Persist the user-chosen store root to the OS app-config directory.
///
/// Creates parent directories as needed. Overwrites any existing value.
pub fn write_persisted_root(config_dir: &Path, store_root: &str) -> std::io::Result<()> {
    let file = config_dir.join(CONFIG_FILE_SUBPATH);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let cfg = StorePathConfig {
        store_root: store_root.to_string(),
    };
    let json = serde_json::to_string_pretty(&cfg).expect("serialize store path config");
    std::fs::write(file, json)
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
}
