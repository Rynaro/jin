//! Public sync API (VG4 boundary).
//!
//! Only this module (part of `jin-core`) touches the Google sync machinery.
//! The CLI/GUI call `run_sync` here; they never import `google::sync` directly.

use std::path::Path;
use std::path::PathBuf;

use crate::google::account::GoogleAccountState;
use crate::google::client::{HttpClient, ReqwestClient};
use crate::google::secrets::{load_tokens, load_tokens_with_passphrase};
use crate::google::sync::{run_sync, SyncResult};
use crate::{Config, JinError};

// ConflictInfo and ConflictKind are defined in sync::conflict (S6.3).
pub use crate::sync::conflict::{ConflictInfo, ConflictKind};

// ── Sync summary DTO (--json parity) ──────────────────────────────────────────

/// Sync outcome summary emitted by `jin sync` in both human and `--json` modes.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncSummary {
    /// `"ok"` | `"partial"` | `"conflict"` (genuinely unresolved) | `"error"`
    pub status: String,
    pub pulled: u32,
    pub pushed: u32,
    /// Number of conflicts AUTO-RESOLVED by S6.3 policy (not errors).
    pub resolved: u32,
    /// Number of genuinely unresolved conflicts (0 in MVP).
    /// Non-zero only if the resolution engine could not handle a conflict
    /// (missing data, unexpected state).
    pub conflicts: u32,
    /// Path to the append-only audit log (if it exists after this run).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_log_path: Option<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AggregateSyncSummary {
    pub status: String,
    pub destinations: Vec<crate::google::multi_sync::DestinationSyncResult>,
    pub pulled: u32,
    pub pushed: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QuarantinedOperationDto {
    pub operation_id: String,
    pub provider: String,
    pub account_id: String,
    pub account_alias: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub jin_id: String,
    pub recurrence_key: String,
    pub operation: String,
    pub pause_reason: String,
}

pub fn list_quarantined_operations(root: &Path) -> crate::Result<Vec<QuarantinedOperationDto>> {
    let config = Config::load(root)?;
    let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
    Ok(crate::sync::state::list_paused_outbox(&conn)?
        .into_iter()
        .map(|operation| {
            let account = config
                .google_registry
                .accounts
                .iter()
                .find(|account| account.id.as_str() == operation.destination.account_id);
            let calendar = config.google_registry.calendars.iter().find(|calendar| {
                calendar.account_id.as_str() == operation.destination.account_id
                    && calendar.calendar_id == operation.destination.calendar_id
            });
            QuarantinedOperationDto {
                operation_id: operation.operation_id,
                provider: operation.destination.provider,
                account_id: operation.destination.account_id,
                account_alias: account
                    .map(|account| account.alias.clone())
                    .unwrap_or_else(|| "Unknown account".to_string()),
                calendar_id: operation.destination.calendar_id,
                calendar_name: calendar
                    .map(|calendar| calendar.name.clone())
                    .unwrap_or_else(|| "Unknown calendar".to_string()),
                jin_id: operation.jin_id,
                recurrence_key: operation.recurrence_key,
                operation: format!("{:?}", operation.operation).to_lowercase(),
                pause_reason: operation
                    .pause_reason
                    .unwrap_or_else(|| "review_required".to_string()),
            }
        })
        .collect())
}

pub fn review_quarantined_operation(
    root: &Path,
    provider: &str,
    account_id: &str,
    calendar_id: &str,
    operation_id: &str,
    resume: bool,
) -> crate::Result<()> {
    if provider != crate::google::account::GOOGLE_PROVIDER {
        return Err(JinError::InvalidInput(
            "unsupported sync provider".to_string(),
        ));
    }
    let config = Config::load(root)?;
    let account_id_model = crate::google::account::GoogleAccountId::parse(account_id.to_string())?;
    let account = config.google_registry.account(&account_id_model)?;
    let calendar = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| {
            calendar.account_id == account_id_model && calendar.calendar_id == calendar_id
        })
        .ok_or_else(|| JinError::Integrity("unknown quarantined calendar route".to_string()))?;
    if resume
        && (account.state != GoogleAccountState::Connected
            || !calendar.enabled
            || !calendar.available
            || !calendar.access_role.can_write())
    {
        return Err(JinError::InvalidInput(
            "route is not writable; refresh permissions before resuming".to_string(),
        ));
    }
    let destination = crate::sync::state::SyncDestination {
        provider: provider.to_string(),
        account_id: account_id.to_string(),
        calendar_id: calendar_id.to_string(),
    };
    let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
    crate::sync::state::review_outbox_operation(
        &conn,
        &destination,
        operation_id,
        resume,
        account.auth_generation,
        calendar.route_generation,
    )
}

pub(crate) struct RefreshLock(PathBuf);

impl Drop for RefreshLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) fn acquire_refresh_lock(
    root: &Path,
    account_id: &crate::google::account::GoogleAccountId,
) -> crate::Result<RefreshLock> {
    let dir = root
        .join(".jin")
        .join("sync")
        .join("accounts")
        .join(account_id.as_str());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("refresh.lock");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            JinError::Auth(format!(
                "Google account refresh is already in progress: {error}"
            ))
        })?;
    Ok(RefreshLock(path))
}

/// Hold the same account lock used by refresh/disconnect while reloading the
/// exact auth and route generations. The caller must keep the returned guard
/// alive for the provider request itself.
pub(crate) fn acquire_provider_request_guard(
    root: &Path,
    target: &crate::google::account::EventSyncTarget,
    expected_auth_generation: u64,
    expected_route_generation: u64,
    require_write: bool,
) -> crate::Result<RefreshLock> {
    let guard = acquire_refresh_lock(root, &target.account_id)?;
    let config = Config::load(root)?;
    let account = config.google_registry.account(&target.account_id)?;
    let calendar = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| {
            calendar.account_id == target.account_id && calendar.calendar_id == target.calendar_id
        })
        .ok_or_else(|| JinError::Integrity("unknown Google calendar route".to_string()))?;
    if account.state != GoogleAccountState::Connected
        || account.auth_generation != expected_auth_generation
        || calendar.route_generation != expected_route_generation
        || !calendar.enabled
        || !calendar.available
        || (require_write && !calendar.access_role.can_write())
    {
        return Err(JinError::OperationBlocked {
            operation_id: "provider-request".to_string(),
            reason: "account or route generation changed before provider request".to_string(),
        });
    }
    Ok(guard)
}

struct HttpPostAdapter<'a, H>(&'a H);

impl<H: HttpClient> crate::google::auth::HttpPost for HttpPostAdapter<'_, H> {
    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value> {
        self.0.post_form(url, params)
    }
}

fn mark_account_revoked(
    root: &Path,
    account_id: &crate::google::account::GoogleAccountId,
) -> crate::Result<()> {
    let _lock = acquire_refresh_lock(root, account_id)?;
    let mut config = Config::load(root)?;
    let account = config.google_registry.account_mut(account_id)?;
    account.state = GoogleAccountState::NeedsReauth;
    account.auth_generation = account.auth_generation.saturating_add(1);
    config.save()?;
    let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
    crate::sync::state::clear_account_state_with_reason(
        &conn,
        crate::google::account::GOOGLE_PROVIDER,
        account_id.as_str(),
        "credentials_revoked",
    )
}

fn load_or_refresh_account_tokens<H: HttpClient>(
    root: &Path,
    account_id: &crate::google::account::GoogleAccountId,
    http: &H,
    passphrase: &str,
) -> crate::Result<(crate::google::secrets::TokenSet, u64)> {
    let _lock = acquire_refresh_lock(root, account_id)?;
    let config = Config::load(root)?;
    let account = config.google_registry.account(account_id)?;
    if account.state != GoogleAccountState::Connected {
        return Err(JinError::Auth(
            "Google account is not connected".to_string(),
        ));
    }
    let generation = account.auth_generation;
    let mut tokens = crate::google::secrets::load_tokens_for_account_with_passphrase(
        root, &config, account_id, passphrase,
    )?;
    if !tokens.is_expired() {
        return Ok((tokens, generation));
    }
    let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
        JinError::Auth("Google refresh token is missing; reconnect the account".to_string())
    })?;
    let credentials = crate::google::config::GoogleCredentials::load(&config)?;
    match crate::google::auth::refresh_access_token(
        &credentials,
        &refresh_token,
        crate::google::auth::GOOGLE_TOKEN_URL,
        &HttpPostAdapter(http),
    ) {
        Ok(refreshed) => tokens = refreshed,
        Err(error) => {
            let mut revoked = Config::load(root)?;
            let account = revoked.google_registry.account_mut(account_id)?;
            account.state = GoogleAccountState::NeedsReauth;
            account.auth_generation = account.auth_generation.saturating_add(1);
            revoked.save()?;
            let conn = crate::sync::state::open_sync_db(&revoked.sync_dir())?;
            crate::sync::state::clear_account_state_with_reason(
                &conn,
                crate::google::account::GOOGLE_PROVIDER,
                account_id.as_str(),
                "credentials_revoked",
            )?;
            return Err(error);
        }
    }
    let current = Config::load(root)?;
    let current_account = current.google_registry.account(account_id)?;
    if current_account.state != GoogleAccountState::Connected
        || current_account.auth_generation != generation
    {
        return Err(JinError::Auth(
            "Google credentials changed while refresh was in flight; refreshed token was discarded"
                .to_string(),
        ));
    }
    crate::google::secrets::save_tokens_for_account_with_passphrase(
        root, &current, account_id, &tokens, passphrase,
    )?;
    Ok((tokens, generation))
}

fn load_or_refresh_account_tokens_default<H: HttpClient>(
    root: &Path,
    account_id: &crate::google::account::GoogleAccountId,
    http: &H,
) -> crate::Result<(crate::google::secrets::TokenSet, u64)> {
    let _lock = acquire_refresh_lock(root, account_id)?;
    let config = Config::load(root)?;
    let account = config.google_registry.account(account_id)?;
    if account.state != GoogleAccountState::Connected {
        return Err(JinError::Auth(
            "Google account is not connected".to_string(),
        ));
    }
    let generation = account.auth_generation;
    let mut tokens = crate::google::secrets::load_tokens_for_account(root, &config, account_id)?;
    if !tokens.is_expired() {
        return Ok((tokens, generation));
    }
    let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
        JinError::Auth("Google refresh token is missing; reconnect the account".to_string())
    })?;
    let credentials = crate::google::config::GoogleCredentials::load(&config)?;
    match crate::google::auth::refresh_access_token(
        &credentials,
        &refresh_token,
        crate::google::auth::GOOGLE_TOKEN_URL,
        &HttpPostAdapter(http),
    ) {
        Ok(refreshed) => tokens = refreshed,
        Err(error) => {
            let mut revoked = Config::load(root)?;
            let account = revoked.google_registry.account_mut(account_id)?;
            account.state = GoogleAccountState::NeedsReauth;
            account.auth_generation = account.auth_generation.saturating_add(1);
            revoked.save()?;
            let conn = crate::sync::state::open_sync_db(&revoked.sync_dir())?;
            crate::sync::state::clear_account_state_with_reason(
                &conn,
                crate::google::account::GOOGLE_PROVIDER,
                account_id.as_str(),
                "credentials_revoked",
            )?;
            return Err(error);
        }
    }
    let current = Config::load(root)?;
    let current_account = current.google_registry.account(account_id)?;
    if current_account.state != GoogleAccountState::Connected
        || current_account.auth_generation != generation
    {
        return Err(JinError::Auth(
            "Google credentials changed while refresh was in flight; refreshed token was discarded"
                .to_string(),
        ));
    }
    crate::google::secrets::save_tokens_for_account(root, &current, account_id, &tokens)?;
    Ok((tokens, generation))
}

pub fn sync_all_with_http<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    http: &H,
) -> crate::Result<AggregateSyncSummary> {
    let mut destinations = Vec::new();
    let mut errors = Vec::new();
    let conn = crate::sync::state::open_sync_db(&cfg.sync_dir())?;
    let mut changed = false;
    for calendar in cfg.google_registry.calendars.iter().filter(|calendar| {
        calendar.enabled
            && calendar.available
            && cfg.google_registry.accounts.iter().any(|account| {
                account.id == calendar.account_id && account.state == GoogleAccountState::Connected
            })
    }) {
        let target = crate::google::account::EventSyncTarget {
            account_id: calendar.account_id.clone(),
            calendar_id: calendar.calendar_id.clone(),
        };
        let (tokens, auth_generation) =
            match load_or_refresh_account_tokens_default(root, &target.account_id, http) {
                Ok(tokens) => tokens,
                Err(error) => {
                    errors.push(format!(
                        "{}/{}: {error}",
                        target.account_id, target.calendar_id
                    ));
                    continue;
                }
            };
        match crate::google::multi_sync::pull_destination(
            root,
            &conn,
            &target,
            auth_generation,
            calendar.route_generation,
            &tokens,
            http,
        ) {
            Ok(mut result) => {
                match crate::google::multi_sync::drain_destination(
                    root,
                    &conn,
                    &target,
                    auth_generation,
                    calendar.route_generation,
                    &tokens,
                    http,
                ) {
                    Ok(count) => result.pushed = count,
                    Err(error) => {
                        if matches!(&error, JinError::Auth(_)) {
                            if let Err(revoke_error) =
                                mark_account_revoked(root, &target.account_id)
                            {
                                result.errors.push(revoke_error.to_string());
                            }
                        }
                        result.errors.push(error.to_string());
                    }
                }
                changed |= result.pulled > 0;
                destinations.push(result);
            }
            Err(error) => {
                if matches!(&error, JinError::Auth(_)) {
                    if let Err(revoke_error) = mark_account_revoked(root, &target.account_id) {
                        errors.push(format!(
                            "{}/{}: {revoke_error}",
                            target.account_id, target.calendar_id
                        ));
                    }
                }
                errors.push(format!(
                    "{}/{}: {error}",
                    target.account_id, target.calendar_id
                ));
            }
        }
    }
    if changed {
        let mut index = crate::index::open(&cfg.index_path())?;
        errors.extend(
            crate::index::rebuild::rebuild(&mut index, root)?
                .into_iter()
                .map(|e| e.to_string()),
        );
    }
    if let Err(error) =
        crate::notification_center::reconcile_calendar_invitations(root, chrono::Utc::now())
    {
        errors.push(format!("notification center reconciliation: {error}"));
    }
    let pulled = destinations.iter().map(|result| result.pulled).sum();
    let pushed = destinations.iter().map(|result| result.pushed).sum();
    Ok(AggregateSyncSummary {
        status: if errors.is_empty() {
            "ok"
        } else if destinations.is_empty() {
            "error"
        } else {
            "partial"
        }
        .to_string(),
        destinations,
        pulled,
        pushed,
        errors,
    })
}

pub fn sync_all_with_http_and_passphrase<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    http: &H,
    passphrase: &str,
) -> crate::Result<AggregateSyncSummary> {
    let mut destinations = Vec::new();
    let mut errors = Vec::new();
    let conn = crate::sync::state::open_sync_db(&cfg.sync_dir())?;
    let mut changed = false;
    for calendar in cfg.google_registry.calendars.iter().filter(|calendar| {
        calendar.enabled
            && calendar.available
            && cfg.google_registry.accounts.iter().any(|account| {
                account.id == calendar.account_id && account.state == GoogleAccountState::Connected
            })
    }) {
        let target = crate::google::account::EventSyncTarget {
            account_id: calendar.account_id.clone(),
            calendar_id: calendar.calendar_id.clone(),
        };
        let (tokens, auth_generation) =
            match load_or_refresh_account_tokens(root, &target.account_id, http, passphrase) {
                Ok(tokens) => tokens,
                Err(error) => {
                    errors.push(format!(
                        "{}/{}: {error}",
                        target.account_id, target.calendar_id
                    ));
                    continue;
                }
            };
        match crate::google::multi_sync::pull_destination(
            root,
            &conn,
            &target,
            auth_generation,
            calendar.route_generation,
            &tokens,
            http,
        ) {
            Ok(mut result) => {
                match crate::google::multi_sync::drain_destination(
                    root,
                    &conn,
                    &target,
                    auth_generation,
                    calendar.route_generation,
                    &tokens,
                    http,
                ) {
                    Ok(count) => result.pushed = count,
                    Err(error) => {
                        if matches!(&error, JinError::Auth(_)) {
                            if let Err(revoke_error) =
                                mark_account_revoked(root, &target.account_id)
                            {
                                result.errors.push(revoke_error.to_string());
                            }
                        }
                        result.errors.push(error.to_string());
                    }
                }
                changed |= result.pulled > 0;
                destinations.push(result);
            }
            Err(error) => {
                if matches!(&error, JinError::Auth(_)) {
                    if let Err(revoke_error) = mark_account_revoked(root, &target.account_id) {
                        errors.push(format!(
                            "{}/{}: {revoke_error}",
                            target.account_id, target.calendar_id
                        ));
                    }
                }
                errors.push(format!(
                    "{}/{}: {error}",
                    target.account_id, target.calendar_id
                ));
            }
        }
    }
    if changed {
        let mut index = crate::index::open(&cfg.index_path())?;
        let diagnostics = crate::index::rebuild::rebuild(&mut index, root)?;
        errors.extend(diagnostics.into_iter().map(|error| error.to_string()));
    }
    if let Err(error) =
        crate::notification_center::reconcile_calendar_invitations(root, chrono::Utc::now())
    {
        errors.push(format!("notification center reconciliation: {error}"));
    }
    let pulled = destinations.iter().map(|result| result.pulled).sum();
    let pushed = destinations.iter().map(|result| result.pushed).sum();
    Ok(AggregateSyncSummary {
        status: if errors.is_empty() {
            "ok"
        } else if destinations.is_empty() {
            "error"
        } else {
            "partial"
        }
        .to_string(),
        destinations,
        pulled,
        pushed,
        errors,
    })
}

impl SyncSummary {
    fn from_result(r: &SyncResult) -> Self {
        // Status reflects the POST-RESOLUTION state:
        //   "ok"       — clean sync (including auto-resolved conflicts)
        //   "partial"  — errors occurred but no unresolved conflicts
        //   "conflict" — genuinely unresolved conflicts remain (none expected in MVP)
        let status = if !r.conflicts.is_empty() {
            "conflict"
        } else if !r.errors.is_empty() {
            "partial"
        } else {
            "ok"
        };
        SyncSummary {
            status: status.to_string(),
            pulled: r.pulled,
            pushed: r.pushed,
            resolved: r.resolved,
            conflicts: r.conflicts.len() as u32,
            audit_log_path: None, // populated by sync_with_http
            errors: r.errors.clone(),
        }
    }
}

// ── Entry point (production: real network) ────────────────────────────────────

/// Run a full sync cycle using the real network and stored tokens.
///
/// Returns `JinError::Auth` (exit 5) when no tokens are stored or refresh fails.
/// Returns `JinError::Offline` (exit 6) on network errors.
pub fn sync(root: &Path) -> crate::Result<SyncSummary> {
    let cfg = Config::load(root)?;
    sync_with_http(root, &cfg, &ReqwestClient)
}

/// Run sync with a custom HTTP client (for offline tests — inject `MockHttpClient`).
pub fn sync_with_http<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    http: &H,
) -> crate::Result<SyncSummary> {
    if cfg.google_v2_active() {
        let aggregate = sync_all_with_http(root, cfg, http)?;
        return Ok(SyncSummary {
            status: aggregate.status,
            pulled: aggregate.pulled,
            pushed: aggregate.pushed,
            resolved: 0,
            conflicts: 0,
            audit_log_path: None,
            errors: aggregate.errors,
        });
    }
    cfg.ensure_singleton_write_allowed()?;
    // Load stored tokens — fails with Auth if not authenticated
    let mut tokens = load_tokens(root, cfg).map_err(|_| {
        JinError::Auth(
            "Not authenticated. Run 'jin auth login' to connect to Google Calendar.".to_string(),
        )
    })?;

    let result = run_sync(root, cfg, &mut tokens, http)?;
    let mut summary = SyncSummary::from_result(&result);

    // Populate audit_log_path if the file was created during this run.
    let audit_path = cfg.sync_dir().join("audit.jsonl");
    if audit_path.exists() {
        summary.audit_log_path = Some(audit_path.to_string_lossy().into_owned());
    }

    Ok(summary)
}

/// Run sync with a custom HTTP client, providing the token-decryption passphrase
/// explicitly rather than reading it from `JIN_TOKEN_PASSPHRASE`.
///
/// This is the preferred entry point for offline tests: it eliminates all
/// global-env-var mutations so tests can run safely in parallel.
pub fn sync_with_http_and_passphrase<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    http: &H,
    passphrase: &str,
) -> crate::Result<SyncSummary> {
    if cfg.google_v2_active() {
        let aggregate = sync_all_with_http_and_passphrase(root, cfg, http, passphrase)?;
        return Ok(SyncSummary {
            status: aggregate.status,
            pulled: aggregate.pulled,
            pushed: aggregate.pushed,
            resolved: 0,
            conflicts: 0,
            audit_log_path: None,
            errors: aggregate.errors,
        });
    }
    let mut tokens = load_tokens_with_passphrase(root, cfg, passphrase).map_err(|_| {
        JinError::Auth(
            "Not authenticated. Run 'jin auth login' to connect to Google Calendar.".to_string(),
        )
    })?;

    let result = run_sync(root, cfg, &mut tokens, http)?;
    let mut summary = SyncSummary::from_result(&result);

    let audit_path = cfg.sync_dir().join("audit.jsonl");
    if audit_path.exists() {
        summary.audit_log_path = Some(audit_path.to_string_lossy().into_owned());
    }

    Ok(summary)
}
