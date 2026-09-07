use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::google::account::{GoogleCalendar, GoogleRegistry};

pub const SCHEMA_VERSION: u32 = 1;
pub const GOOGLE_SYNC_SCHEMA_VERSION: u32 = 2;
pub const CONFIG_FILENAME: &str = "config.toml";
pub const JIN_DIR: &str = ".jin";

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
        Self {
            schema_version: SCHEMA_VERSION,
            root,
            display_tz: "UTC".to_string(),
            calendar_id: None,
            token_backend: "keyring".to_string(),
            google: GoogleConfig::default(),
            google_sync_schema_version: None,
            google_registry: GoogleRegistry::default(),
        }
    }

    pub fn jin_dir(&self) -> PathBuf {
        self.root.join(JIN_DIR)
    }

    pub fn notes_dir(&self) -> PathBuf {
        self.root.join("notes")
    }

    /// Portable saved-query/view documents (not device-local pins or recents).
    pub fn collections_dir(&self) -> PathBuf {
        self.root.join("collections")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.jin_dir().join("assets")
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
        root.join(JIN_DIR).join(CONFIG_FILENAME)
    }

    pub fn load(root: &Path) -> crate::Result<Self> {
        let path = Self::config_path(root);
        if !path.exists() {
            return Err(crate::JinError::NotInitialized {
                path: root.display().to_string(),
            });
        }
        let content = std::fs::read_to_string(&path)?;
        let config: Self = toml::from_str(&content)
            .map_err(|e| crate::JinError::YamlParse(format!("config.toml: {}", e)))?;
        config.google_registry.validate()?;
        Ok(config)
    }

    pub fn save(&self) -> crate::Result<()> {
        let path = Self::config_path(&self.root);
        let content = toml::to_string_pretty(self)
            .map_err(|e| crate::JinError::Integrity(format!("serialize config: {}", e)))?;
        let tmp = path.with_extension("toml.tmp");
        std::fs::write(&tmp, content)?;
        std::fs::rename(tmp, path)?;
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
