use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use crate::google::account::{GoogleCalendar, GoogleRegistry};
use crate::JinError;

pub const SCHEMA_VERSION: u32 = 1;
pub const GOOGLE_SYNC_SCHEMA_VERSION: u32 = 2;
pub const CONFIG_FILENAME: &str = "config.toml";
pub const JIN_DIR: &str = ".jin";
/// A portable workspace contains only owner data. Device state is stored outside
/// the folder so ordinary file synchronizers never replicate SQLite journals,
/// credentials, locks, or notification leases.
pub const PORTABLE_WORKSPACE_FILENAME: &str = "workspace.toml";
const PORTABLE_WORKSPACE_VERSION: u32 = 1;
const PORTABLE_LEGACY_TRIPWIRE: &[u8] =
    b"format = \"jin-portable-workspace\"\nlegacy_writes = \"forbidden\"\n";

/// Resolve a workspace or state path without silently losing an existing
/// symlink boundary. Relative workspace roots are interpreted from the current
/// directory; state overrides are checked as absolute by their caller.
/// For a not-yet-created runtime directory, resolve its closest existing
/// ancestor and reattach only the missing path components.
fn resolve_path(path: &Path) -> crate::Result<PathBuf> {
    let owned;
    let mut existing = if path.is_absolute() {
        path
    } else {
        owned = std::env::current_dir()?.join(path);
        &owned
    };
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            return Err(JinError::Integrity(format!(
                "cannot resolve path without an existing ancestor: {}",
                path.display()
            )));
        };
        missing.push(name.to_os_string());
        existing = existing.parent().ok_or_else(|| {
            JinError::Integrity(format!("cannot resolve path: {}", path.display()))
        })?;
    }
    let mut resolved = existing.canonicalize().map_err(JinError::Io)?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn create_or_validate_immutable(path: &Path, bytes: &[u8]) -> crate::Result<bool> {
    let parent = path
        .parent()
        .ok_or_else(|| JinError::InvalidInput(format!("path has no parent: {}", path.display())))?;
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!(
        ".{}-{}.jin-create",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace"),
        ulid::Ulid::new()
    ));
    crate::store::fs::atomic_write(&temp, bytes)?;
    let result = std::fs::hard_link(&temp, path);
    let _ = std::fs::remove_file(&temp);
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if std::fs::read(path)? == bytes {
                Ok(false)
            } else {
                Err(JinError::InvalidInput(format!(
                    "refusing to overwrite existing Jin metadata: {}",
                    path.display()
                )))
            }
        }
        // Some otherwise valid sync targets (notably exFAT and provider
        // filesystems) do not support hard links. `create_new` is still an
        // atomic no-clobber creation primitive; it never replaces a marker
        // that another device created first.
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::Unsupported | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            use std::io::Write;
            match std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
            {
                Ok(mut file) => {
                    if let Err(write_error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                        let _ = std::fs::remove_file(path);
                        return Err(JinError::Io(write_error));
                    }
                    Ok(true)
                }
                Err(create_error) if create_error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if std::fs::read(path)? == bytes {
                        Ok(false)
                    } else {
                        Err(JinError::InvalidInput(format!(
                            "refusing to overwrite existing Jin metadata: {}",
                            path.display()
                        )))
                    }
                }
                Err(create_error) => Err(JinError::Io(create_error)),
            }
        }
        Err(error) => Err(JinError::Io(error)),
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct PortableWorkspace {
    format: String,
    version: u32,
    vault_id: String,
}

/// Google OAuth client credentials (owner-provisioned desktop app).
/// Read from the `[google]` section of `.jin/config.toml`.
/// Never shipped with jin — each owner creates their own GCP project.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GoogleConfig {
    /// OAuth client ID (ends in .apps.googleusercontent.com)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// OAuth client secret (non-confidential for Desktop/Installed-app clients + PKCE)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub schema_version: u32,
    pub root: PathBuf,
    /// Local-only directory for indexes, credentials, journals and runtime
    /// bookkeeping. This value is deliberately never serialized into a portable
    /// workspace descriptor.
    #[serde(skip)]
    runtime_dir: PathBuf,
    pub display_tz: String,
    pub calendar_id: Option<String>,
    /// Preferred token backend: "keyring" or "file"
    pub token_backend: String,
    /// Google OAuth credentials (owner-provisioned; never shipped)
    #[serde(default)]
    pub google: GoogleConfig,
    /// Versioned multi-account registry. The core config schema remains v1 for
    /// old non-Google roots; activation is guarded by this separate marker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_sync_schema_version: Option<u32>,
    #[serde(default)]
    pub google_registry: GoogleRegistry,
}

impl Config {
    pub fn new(root: PathBuf) -> Self {
        let runtime_dir = Self::legacy_jin_dir(&root);
        Self {
            schema_version: SCHEMA_VERSION,
            root,
            runtime_dir,
            display_tz: "UTC".to_string(),
            calendar_id: None,
            token_backend: "keyring".to_string(),
            google: GoogleConfig::default(),
            google_sync_schema_version: None,
            google_registry: GoogleRegistry::default(),
        }
    }

    pub fn new_portable(root: PathBuf) -> crate::Result<Self> {
        let mut config = Self::new(root.clone());
        config.runtime_dir = Self::runtime_dir_for(&root)?;
        Ok(config)
    }

    pub fn jin_dir(&self) -> PathBuf {
        self.runtime_dir.clone()
    }

    pub fn notes_dir(&self) -> PathBuf {
        self.root.join("notes")
    }

    /// Portable saved-query/view documents (not device-local pins or recents).
    pub fn collections_dir(&self) -> PathBuf {
        self.root.join("collections")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.root.join(JIN_DIR).join("assets")
    }

    pub fn tasks_dir(&self) -> PathBuf {
        self.root.join("tasks")
    }

    pub fn lists_dir(&self) -> PathBuf {
        self.root.join("lists")
    }

    pub fn tags_dir(&self) -> PathBuf {
        self.root.join("tags")
    }

    pub fn events_dir(&self) -> PathBuf {
        self.root.join("events")
    }

    pub fn index_path(&self) -> PathBuf {
        self.jin_dir().join("index.sqlite")
    }

    /// Device-local reminder delivery state. Canonical reminder definitions
    /// remain in task frontmatter; this database is safe to rebuild locally.
    pub fn reminder_state_path(&self) -> PathBuf {
        self.jin_dir().join("reminder-state.sqlite")
    }

    /// Device-local durable Notification Center projection. Canonical events,
    /// tasks, and reminder definitions remain in their existing stores.
    pub fn notification_center_path(&self) -> PathBuf {
        self.jin_dir().join("notification-center.sqlite")
    }

    pub fn sync_dir(&self) -> PathBuf {
        self.jin_dir().join("sync")
    }

    pub fn config_path(root: &Path) -> PathBuf {
        // This legacy location is intentionally retained for compatibility and
        // for detecting an attempted portable conversion. Portable loading is
        // resolved explicitly in `load` after marker validation.
        Self::legacy_jin_dir(root).join(CONFIG_FILENAME)
    }

    fn legacy_jin_dir(root: &Path) -> PathBuf {
        root.join(JIN_DIR)
    }

    /// Returns the local, unsynchronized runtime directory for `root`.
    /// `JIN_STATE_DIR` provides a deterministic isolated location for tests and
    /// managed deployments. The root path is hashed so two copied workspaces get
    /// independent state even if their portable contents are identical.
    pub fn runtime_dir_for(root: &Path) -> crate::Result<PathBuf> {
        let base = match std::env::var_os("JIN_STATE_DIR") {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err(JinError::InvalidInput(
                        "JIN_STATE_DIR must be an absolute directory outside the portable workspace"
                            .to_string(),
                    ));
                }
                path
            }
            None => dirs::data_local_dir()
                .map(|path| path.join("Jin"))
                .ok_or_else(|| {
                    JinError::Integrity(
                        "cannot determine an operating-system local data directory; set JIN_STATE_DIR outside the workspace"
                            .to_string(),
                    )
                })?,
        };
        let root_real = resolve_path(root)?;
        let base_real = resolve_path(&base)?;
        if base_real.starts_with(&root_real) {
            return Err(JinError::InvalidInput(
                "JIN_STATE_DIR must be outside the portable workspace".to_string(),
            ));
        }
        let digest = format!(
            "{:x}",
            Sha256::digest(root_real.to_string_lossy().as_bytes())
        );
        let vault_id = Self::read_portable_workspace(root)?.vault_id;
        Ok(base_real
            .join("workspaces")
            .join(vault_id)
            .join(&digest[..24]))
    }

    pub fn portable_workspace_path(root: &Path) -> PathBuf {
        root.join(JIN_DIR).join(PORTABLE_WORKSPACE_FILENAME)
    }

    pub fn is_portable_workspace(root: &Path) -> bool {
        Self::portable_workspace_path(root).is_file()
    }

    /// Resolve the operational state directory without ever falling back into
    /// a portable root. Presence of a marker, including a malformed or symlink
    /// marker, is a fail-closed shared-workspace claim.
    pub fn state_dir(root: &Path) -> crate::Result<PathBuf> {
        let marker = Self::portable_workspace_path(root);
        match std::fs::symlink_metadata(&marker) {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                Err(JinError::Integrity(format!(
                    "portable workspace marker is not a regular file: {}",
                    marker.display()
                )))
            }
            Ok(_) => {
                let _ = Self::read_portable_workspace(root)?;
                Self::runtime_dir_for(root)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Self::legacy_jin_dir(root))
            }
            Err(error) => Err(JinError::Io(error)),
        }
    }

    fn read_portable_workspace(root: &Path) -> crate::Result<PortableWorkspace> {
        let path = Self::portable_workspace_path(root);
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(JinError::Integrity(format!(
                "portable workspace marker is not a regular file: {}",
                path.display()
            )));
        }
        let content = std::fs::read_to_string(&path).map_err(JinError::Io)?;
        let marker: PortableWorkspace = toml::from_str(&content).map_err(|error| {
            JinError::Integrity(format!(
                "invalid portable workspace marker {}: {error}",
                path.display()
            ))
        })?;
        if marker.format != "jin-portable-workspace" || marker.version != PORTABLE_WORKSPACE_VERSION
        {
            return Err(JinError::Integrity(format!(
                "unsupported portable workspace marker: {}",
                path.display()
            )));
        }
        ulid::Ulid::from_string(&marker.vault_id).map_err(|_| {
            JinError::Integrity(format!(
                "portable workspace has an invalid vault id: {}",
                path.display()
            ))
        })?;
        Ok(marker)
    }

    /// Public inspection helper for components that need to distinguish an
    /// untrusted/legacy root from a verified portable workspace.
    pub fn shared_state_dir(root: &Path) -> crate::Result<Option<PathBuf>> {
        if !Self::is_portable_workspace(root) {
            return Ok(None);
        }
        Ok(Some(Self::state_dir(root)?))
    }

    /// Create an opt-in portable marker before any local runtime state. Old
    /// clients see no `config.toml` in the portable folder and fail closed.
    pub fn create_portable_workspace(root: &Path) -> crate::Result<()> {
        let path = Self::portable_workspace_path(root);
        if path.exists() {
            Self::read_portable_workspace(root)?;
            return Ok(());
        }
        let legacy_tripwire = Self::config_path(root);
        // Older Jin builds only look for this path. Writing the tripwire before
        // the portable marker closes the race where an older build could create
        // mutable state inside a folder being enabled for sync.
        create_or_validate_immutable(&legacy_tripwire, PORTABLE_LEGACY_TRIPWIRE)?;
        let marker = format!(
            "format = \"jin-portable-workspace\"\nversion = {PORTABLE_WORKSPACE_VERSION}\nvault_id = \"{}\"\n",
            ulid::Ulid::new()
        );
        match create_or_validate_immutable(&path, marker.as_bytes()) {
            Ok(_) => Ok(()),
            Err(JinError::InvalidInput(_)) if path.exists() => {
                Self::read_portable_workspace(root)?;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub fn has_portable_tripwire(root: &Path) -> bool {
        std::fs::read(Self::config_path(root))
            .map(|bytes| bytes == PORTABLE_LEGACY_TRIPWIRE)
            .unwrap_or(false)
    }

    pub fn load(root: &Path) -> crate::Result<Self> {
        let runtime_dir = Self::state_dir(root)?;
        let path = runtime_dir.join(CONFIG_FILENAME);
        if !path.exists() {
            return Err(crate::JinError::NotInitialized {
                path: root.display().to_string(),
            });
        }
        let content = std::fs::read_to_string(&path)?;
        Self::from_serialized(root, &content)
    }

    /// Deserialize configuration bytes that originated from this root, then
    /// rebind every process-local path to the caller's current workspace.
    /// Migration staging uses this instead of deserializing `Config` directly.
    pub(crate) fn from_serialized(root: &Path, content: &str) -> crate::Result<Self> {
        let runtime_dir = Self::state_dir(root)?;
        let mut config: Self = toml::from_str(content)
            .map_err(|e| crate::JinError::YamlParse(format!("config.toml: {}", e)))?;
        // A persisted absolute root is historical metadata. The caller's root
        // is authoritative, especially after a vault is copied or moved.
        config.root = root.to_path_buf();
        config.runtime_dir = runtime_dir;
        config.google_registry.validate()?;
        Ok(config)
    }

    pub fn save(&self) -> crate::Result<()> {
        let path = self.jin_dir().join(CONFIG_FILENAME);
        let content = toml::to_string_pretty(self)
            .map_err(|e| crate::JinError::Integrity(format!("serialize config: {}", e)))?;
        crate::store::fs::atomic_write(&path, content.as_bytes())?;
        Ok(())
    }

    pub fn google_v2_active(&self) -> bool {
        self.google_sync_schema_version == Some(GOOGLE_SYNC_SCHEMA_VERSION)
    }

    /// Prepare the deterministic registry part of singleton migration. Token
    /// copy and sync-state migration must succeed before `activate_google_v2`.
    pub fn prepare_google_v2_migration(&mut self) -> crate::Result<Option<String>> {
        if self.google_v2_active() || !self.google_registry.accounts.is_empty() {
            return Ok(self
                .google_registry
                .accounts
                .first()
                .map(|account| account.id.to_string()));
        }
        if self.calendar_id.is_none() && self.google.client_id.is_none() {
            return Ok(None);
        }
        let mut suffix = 1;
        let alias = loop {
            let candidate = if suffix == 1 {
                "Google".to_string()
            } else {
                format!("Google {suffix}")
            };
            if !self
                .google_registry
                .accounts
                .iter()
                .any(|account| account.alias.eq_ignore_ascii_case(&candidate))
            {
                break candidate;
            }
            suffix += 1;
        };
        let id = self.google_registry.add_pending_account(alias)?;
        let now = chrono::Utc::now().fixed_offset();
        self.google_registry.calendars.push(GoogleCalendar {
            account_id: id.clone(),
            calendar_id: self
                .calendar_id
                .clone()
                .unwrap_or_else(|| "primary".to_string()),
            name: "Google Calendar".to_string(),
            primary: true,
            access_role: crate::google::account::GoogleAccessRole::Writer,
            allowed_conference_solution_types: Vec::new(),
            enabled: true,
            available: true,
            route_generation: 0,
            discovered_at: now,
            refreshed_at: now,
        });
        Ok(Some(id.to_string()))
    }

    pub fn activate_google_v2(&mut self) -> crate::Result<()> {
        self.google_registry.validate()?;
        if self.google_registry.accounts.is_empty() {
            return Err(crate::JinError::Integrity(
                "cannot activate Google v2 without an account registry".to_string(),
            ));
        }
        self.google_sync_schema_version = Some(GOOGLE_SYNC_SCHEMA_VERSION);
        // Remove the singleton routing input as a compatibility tripwire for
        // historical Google writers that do not understand the v2 marker.
        self.calendar_id = None;
        // Install the fail-closed guard before exposing the v2 config. A crash
        // between these writes may temporarily block singleton writes, but can
        // never permit a stale writer to mutate an already-migrated root.
        self.write_google_v2_guard()?;
        self.save()
    }

    pub fn write_google_v2_guard(&self) -> crate::Result<()> {
        std::fs::write(
            self.jin_dir().join("google-v2-required"),
            b"google-sync-schema=2\nlegacy-singleton-writes=forbidden\n",
        )?;
        Ok(())
    }

    /// Fail closed for legacy write paths once the account registry is active.
    pub fn ensure_singleton_write_allowed(&self) -> crate::Result<()> {
        if self.google_v2_active() || self.jin_dir().join("google-v2-required").exists() {
            return Err(crate::JinError::Integrity(
                "this root uses Google sync schema v2; upgrade Jin before writing through singleton APIs"
                    .to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn portable_workspace_uses_only_canonical_files_under_its_root() {
        let workspace = TempDir::new().unwrap();
        let state = TempDir::new().unwrap();
        let _state_env = crate::test_support::EnvGuard::set(
            "JIN_STATE_DIR",
            state.path().to_str().unwrap(),
            &crate::test_support::STATE_DIR_ENV_LOCK,
        );
        crate::ops::init_portable_workspace(workspace.path()).unwrap();
        let config = Config::load(workspace.path()).unwrap();
        let state_root = state.path().canonicalize().unwrap();
        assert!(config.index_path().starts_with(&state_root));
        assert!(config.sync_dir().starts_with(&state_root));
        assert!(config.assets_dir().starts_with(workspace.path()));
        assert!(Config::portable_workspace_path(workspace.path()).is_file());
        assert!(!workspace.path().join(".jin/index.sqlite").exists());
    }

    #[test]
    fn portable_initialization_retries_after_legacy_tripwire_without_clobbering_marker() {
        let workspace = TempDir::new().unwrap();
        let state = TempDir::new().unwrap();
        let _state_env = crate::test_support::EnvGuard::set(
            "JIN_STATE_DIR",
            state.path().to_str().unwrap(),
            &crate::test_support::STATE_DIR_ENV_LOCK,
        );
        std::fs::create_dir_all(workspace.path().join(JIN_DIR)).unwrap();
        std::fs::write(
            Config::config_path(workspace.path()),
            PORTABLE_LEGACY_TRIPWIRE,
        )
        .unwrap();

        crate::ops::init_portable_workspace(workspace.path()).unwrap();
        let marker = std::fs::read(Config::portable_workspace_path(workspace.path())).unwrap();
        Config::create_portable_workspace(workspace.path()).unwrap();
        assert_eq!(
            std::fs::read(Config::portable_workspace_path(workspace.path())).unwrap(),
            marker
        );
    }

    #[test]
    fn load_binds_legacy_config_to_opened_root() {
        let original = TempDir::new().unwrap();
        crate::ops::init(original.path()).unwrap();
        let copied = TempDir::new().unwrap();
        std::fs::create_dir_all(copied.path().join(".jin")).unwrap();
        std::fs::copy(
            original.path().join(".jin/config.toml"),
            copied.path().join(".jin/config.toml"),
        )
        .unwrap();
        let config = Config::load(copied.path()).unwrap();
        assert_eq!(config.root, copied.path());
        assert_eq!(config.notes_dir(), copied.path().join("notes"));
    }

    #[test]
    fn malformed_portable_marker_fails_closed() {
        let workspace = TempDir::new().unwrap();
        std::fs::create_dir_all(workspace.path().join(".jin")).unwrap();
        std::fs::write(
            Config::portable_workspace_path(workspace.path()),
            "version = 1\n",
        )
        .unwrap();
        assert!(Config::load(workspace.path()).is_err());
    }
}
