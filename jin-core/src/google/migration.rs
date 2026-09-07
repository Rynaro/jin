//! Resumable singleton-to-account-registry migration.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::google::account::{GoogleAccountId, GoogleAccountState};
use crate::{Config, JinError};

const OPERATION_ID: &str = "google-v1-to-v2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationPhase {
    Prepared,
    RegistryWritten,
    TokenCopied,
    Activated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationJournal {
    pub operation_id: String,
    pub account_id: GoogleAccountId,
    pub phase: MigrationPhase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    pub account_id: GoogleAccountId,
    pub activated: bool,
    pub needs_reauth: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationFailpoint {
    AfterPrepared,
    AfterTokenCopied,
    AfterRegistryWritten,
    AfterActivated,
}

fn inject(failpoint: Option<MigrationFailpoint>, at: MigrationFailpoint) -> crate::Result<()> {
    if failpoint == Some(at) {
        return Err(JinError::OperationBlocked {
            operation_id: OPERATION_ID.to_string(),
            reason: format!("injected migration interruption at {at:?}"),
        });
    }
    Ok(())
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(".jin")
        .join("sync")
        .join("google-v2-migration.json")
}

fn backup_path(root: &Path) -> PathBuf {
    root.join(".jin").join("config.toml.google-v1.bak")
}

fn staged_config_path(root: &Path) -> PathBuf {
    root.join(".jin")
        .join("sync")
        .join("google-v2-config.prepared.toml")
}

fn write_staged_config(root: &Path, config: &Config) -> crate::Result<()> {
    let path = staged_config_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(
        &tmp,
        toml::to_string_pretty(config).map_err(|error| {
            JinError::Integrity(format!("serialize staged Google config: {error}"))
        })?,
    )?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn read_staged_config(root: &Path) -> crate::Result<Config> {
    toml::from_str(&std::fs::read_to_string(staged_config_path(root))?)
        .map_err(|error| JinError::Integrity(format!("parse staged Google config: {error}")))
}

fn disable_legacy_token_slot(root: &Path) -> crate::Result<()> {
    let legacy = root.join(".jin").join("sync").join("tokens.enc");
    if legacy.exists() {
        let disabled = legacy.with_extension("enc.google-v1-disabled");
        if !disabled.exists() {
            std::fs::rename(legacy, disabled)?;
        }
    }
    Ok(())
}

fn write_journal(root: &Path, journal: &MigrationJournal) -> crate::Result<()> {
    let path = journal_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|e| JinError::Integrity(format!("serialize Google migration journal: {e}")))?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn read_journal(root: &Path) -> crate::Result<Option<MigrationJournal>> {
    let path = journal_path(root);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| JinError::Integrity(format!("parse Google migration journal: {e}")))
}

/// Migrate the legacy singleton config and optional encrypted token.
///
/// The legacy token is copied and verified, never moved. A failed copy leaves
/// both the legacy config and token intact and does not activate v2.
pub fn migrate_singleton(
    root: &Path,
    token_passphrase: Option<&str>,
) -> crate::Result<Option<MigrationResult>> {
    migrate_singleton_with_failpoint(root, token_passphrase, None)
}

pub fn migrate_singleton_with_failpoint(
    root: &Path,
    token_passphrase: Option<&str>,
    failpoint: Option<MigrationFailpoint>,
) -> crate::Result<Option<MigrationResult>> {
    let mut config = Config::load(root)?;
    if config.google_v2_active() {
        disable_legacy_token_slot(root)?;
        let guard = root.join(".jin").join("google-v2-required");
        if !guard.exists() {
            std::fs::write(
                &guard,
                b"google-sync-schema=2\nlegacy-singleton-writes=forbidden\n",
            )?;
        }
        let account = config.google_registry.accounts.first().ok_or_else(|| {
            JinError::Integrity("Google v2 marker exists without an account".to_string())
        })?;
        return Ok(Some(MigrationResult {
            account_id: account.id.clone(),
            activated: true,
            needs_reauth: account.state == GoogleAccountState::NeedsReauth,
        }));
    }

    let journal = read_journal(root)?;
    let account_id = if let Some(journal) = &journal {
        if journal.operation_id != OPERATION_ID {
            return Err(JinError::Integrity(
                "unexpected Google migration operation id".to_string(),
            ));
        }
        journal.account_id.clone()
    } else {
        let Some(id) = config.prepare_google_v2_migration()? else {
            return Ok(None);
        };
        let account_id = GoogleAccountId::parse(id)?;
        let config_path = Config::config_path(root);
        if !backup_path(root).exists() {
            std::fs::copy(config_path, backup_path(root))?;
        }
        write_staged_config(root, &config)?;
        write_journal(
            root,
            &MigrationJournal {
                operation_id: OPERATION_ID.to_string(),
                account_id: account_id.clone(),
                phase: MigrationPhase::Prepared,
            },
        )?;
        inject(failpoint, MigrationFailpoint::AfterPrepared)?;
        account_id
    };

    // Resume from the staged registry; canonical v1 config remains unchanged
    // until every copied asset has been verified.
    if config.google_registry.account(&account_id).is_err() {
        config = read_staged_config(root)?;
    }
    config.google_registry.account(&account_id)?;

    let legacy_token_exists = root.join(".jin").join("sync").join("tokens.enc").exists();
    let mut needs_reauth = false;
    if legacy_token_exists {
        let passphrase = token_passphrase.ok_or_else(|| {
            JinError::Auth(
                "legacy encrypted token exists; passphrase is required to verify account migration"
                    .to_string(),
            )
        })?;
        crate::google::secrets::copy_legacy_file_tokens_for_account(
            root,
            &config,
            &account_id,
            passphrase,
        )?;
        let tokens = crate::google::secrets::load_tokens_for_account_with_passphrase(
            root,
            &config,
            &account_id,
            passphrase,
        )?;
        needs_reauth = !tokens.scope.split_whitespace().any(|scope| {
            scope == "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
                || scope == "https://www.googleapis.com/auth/calendar"
        });
        if needs_reauth {
            config.google_registry.account_mut(&account_id)?.state =
                GoogleAccountState::NeedsReauth;
            write_staged_config(root, &config)?;
        }
    }
    write_journal(
        root,
        &MigrationJournal {
            operation_id: OPERATION_ID.to_string(),
            account_id: account_id.clone(),
            phase: MigrationPhase::TokenCopied,
        },
    )?;
    inject(failpoint, MigrationFailpoint::AfterTokenCopied)?;

    let calendar_id = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| calendar.account_id == account_id)
        .map(|calendar| calendar.calendar_id.clone())
        .ok_or_else(|| JinError::Integrity("prepared migration calendar is missing".to_string()))?;
    let destination = crate::sync::state::SyncDestination::google(
        account_id.as_str().to_string(),
        calendar_id.clone(),
    );
    let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
    crate::sync::state::migrate_legacy_state(&conn, &destination)?;
    for event_id in crate::sync::state::list_scoped_jin_ids(&conn, &destination)? {
        let target =
            crate::google::account::EventSyncTarget::new(account_id.clone(), calendar_id.clone())?;
        crate::google::route_ownership::write(&config.events_dir(), &event_id, &target)?;
    }
    write_journal(
        root,
        &MigrationJournal {
            operation_id: OPERATION_ID.to_string(),
            account_id: account_id.clone(),
            phase: MigrationPhase::RegistryWritten,
        },
    )?;
    inject(failpoint, MigrationFailpoint::AfterRegistryWritten)?;

    config.activate_google_v2()?;
    disable_legacy_token_slot(root)?;
    inject(failpoint, MigrationFailpoint::AfterActivated)?;
    write_journal(
        root,
        &MigrationJournal {
            operation_id: OPERATION_ID.to_string(),
            account_id: account_id.clone(),
            phase: MigrationPhase::Activated,
        },
    )?;
    Ok(Some(MigrationResult {
        account_id,
        activated: true,
        needs_reauth,
    }))
}
