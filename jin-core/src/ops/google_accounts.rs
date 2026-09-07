//! Root-aware Google account and CalendarList lifecycle operations.

use std::path::Path;

use crate::google::account::{GoogleAccountId, GoogleAccountState};
use crate::google::client::HttpClient;
use crate::{Config, JinError};

pub fn add_account(root: &Path, alias: &str) -> crate::Result<GoogleAccountId> {
    let mut config = Config::load(root)?;
    let id = config.google_registry.add_pending_account(alias)?;
    config.google_sync_schema_version = Some(crate::config::GOOGLE_SYNC_SCHEMA_VERSION);
    config.write_google_v2_guard()?;
    config.save()?;
    Ok(id)
}

pub fn login_account(root: &Path, account_id: &GoogleAccountId) -> crate::Result<()> {
    let config = Config::load(root)?;
    config.google_registry.account(account_id)?;
    let credentials = crate::google::config::GoogleCredentials::load(&config)?;
    let (tokens, subject, principal) =
        crate::google::auth::run_account_auth_flow(&credentials, account_id)?;
    {
        let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;

        // Identity must be accepted before any credential replacement occurs.
        let mut next = config.clone();
        if next.google_registry.accounts.iter().any(|account| {
            &account.id != account_id
                && account.provider_issuer.as_deref() == Some(crate::google::account::GOOGLE_ISSUER)
                && account.provider_subject.as_deref() == Some(&subject)
        }) {
            return Err(JinError::Integrity(
                "Google account is already connected under another alias".to_string(),
            ));
        }
        next.google_registry.account_mut(account_id)?.bind_subject(
            crate::google::account::GOOGLE_ISSUER,
            subject,
            Some(principal),
        )?;
        crate::google::secrets::save_tokens_for_account(root, &next, account_id, &tokens)?;
        next.save()?;
    }

    // Authentication is durable before discovery begins. If CalendarList is
    // temporarily unavailable, the account remains connected and the caller
    // receives a retriable, explicit partial-success error.
    refresh_calendars_after_login(
        root,
        account_id,
        &tokens.access_token,
        &crate::google::client::ReqwestClient,
    )
}

fn refresh_calendars_after_login<H: HttpClient>(
    root: &Path,
    account_id: &GoogleAccountId,
    bearer: &str,
    http: &H,
) -> crate::Result<()> {
    refresh_calendars(root, account_id, bearer, http).map_err(|error| {
        let message = format!(
            "Google account connected successfully, but calendar discovery failed: {error}. \
             The connection was kept; retry Refresh calendars."
        );
        match error {
            JinError::Offline(_) => JinError::Offline(message),
            JinError::Auth(_) => JinError::Auth(message),
            _ => JinError::Integrity(message),
        }
    })
}

pub fn activate_account(
    root: &Path,
    account_id: &GoogleAccountId,
    issuer: &str,
    subject: &str,
    principal: Option<String>,
) -> crate::Result<()> {
    let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;
    let mut config = Config::load(root)?;
    if config.google_registry.accounts.iter().any(|account| {
        &account.id != account_id
            && account.provider_issuer.as_deref() == Some(issuer)
            && account.provider_subject.as_deref() == Some(subject)
    }) {
        return Err(JinError::Integrity(
            "Google issuer/subject is already bound to another Jin account".to_string(),
        ));
    }
    config
        .google_registry
        .account_mut(account_id)?
        .bind_subject(issuer, subject, principal)?;
    config.save()
}

pub fn rename_account(root: &Path, account_id: &GoogleAccountId, alias: &str) -> crate::Result<()> {
    let mut config = Config::load(root)?;
    config.google_registry.rename(account_id, alias)?;
    config.save()
}

pub fn disconnect_account(root: &Path, account_id: &GoogleAccountId) -> crate::Result<()> {
    let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;
    let mut config = Config::load(root)?;
    let account = config.google_registry.account_mut(account_id)?;
    account.state = GoogleAccountState::Disconnected;
    account.auth_generation = account.auth_generation.saturating_add(1);
    for calendar in config
        .google_registry
        .calendars
        .iter_mut()
        .filter(|calendar| &calendar.account_id == account_id)
    {
        calendar.route_generation = calendar.route_generation.saturating_add(1);
    }
    // Persist revocation generations before touching credentials so every
    // partial failure remains fail-closed.
    config.save()?;
    let sync_db_path = config.sync_dir().join("sync-state.sqlite");
    if sync_db_path.exists() {
        let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
        crate::sync::state::clear_account_state(
            &conn,
            crate::google::account::GOOGLE_PROVIDER,
            account_id.as_str(),
        )?;
    }
    let _ = crate::google::secrets::delete_tokens_for_account(root, &config, account_id)?;
    Ok(())
}

pub fn refresh_calendars<H: HttpClient>(
    root: &Path,
    account_id: &GoogleAccountId,
    bearer: &str,
    http: &H,
) -> crate::Result<()> {
    let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;
    let discovered = crate::google::client::list_calendars(http, bearer)?;
    let mut config = Config::load(root)?;
    let before = config.google_registry.calendars.clone();
    config
        .google_registry
        .reconcile_calendars(account_id, discovered)?;
    config.save()?;
    let sync_db_path = config.sync_dir().join("sync-state.sqlite");
    if sync_db_path.exists() {
        let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
        for calendar in config
            .google_registry
            .calendars
            .iter()
            .filter(|calendar| &calendar.account_id == account_id)
        {
            let changed = before
                .iter()
                .find(|old| {
                    old.account_id == calendar.account_id && old.calendar_id == calendar.calendar_id
                })
                .map(|old| {
                    old.route_generation != calendar.route_generation
                        || (old.available && !calendar.available)
                })
                .unwrap_or(false);
            if changed {
                crate::sync::state::quarantine_route(
                    &conn,
                    &crate::sync::state::SyncDestination::google(
                        account_id.as_str().to_string(),
                        calendar.calendar_id.clone(),
                    ),
                    "provider_permission_changed",
                )?;
            }
        }
    }
    Ok(())
}

pub fn set_calendar_enabled(
    root: &Path,
    account_id: &GoogleAccountId,
    calendar_id: &str,
    enabled: bool,
) -> crate::Result<()> {
    let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;
    let mut config = Config::load(root)?;
    let mut changed = false;
    let calendar = config
        .google_registry
        .calendars
        .iter_mut()
        .find(|calendar| &calendar.account_id == account_id && calendar.calendar_id == calendar_id)
        .ok_or_else(|| JinError::Integrity("unknown Google calendar route".to_string()))?;
    if calendar.enabled != enabled {
        calendar.enabled = enabled;
        calendar.route_generation = calendar.route_generation.saturating_add(1);
        changed = true;
    }
    config.save()?;
    let sync_db_path = config.sync_dir().join("sync-state.sqlite");
    if changed && sync_db_path.exists() {
        let conn = crate::sync::state::open_sync_db(&config.sync_dir())?;
        crate::sync::state::quarantine_route(
            &conn,
            &crate::sync::state::SyncDestination::google(
                account_id.as_str().to_string(),
                calendar_id.to_string(),
            ),
            if enabled {
                "route_reenabled_requires_review"
            } else {
                "route_disabled"
            },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google::account::{GoogleAccountState, GOOGLE_ISSUER};
    use crate::google::client::{HttpResponse, MockHttpClient};
    use tempfile::TempDir;

    fn connected_account() -> (TempDir, GoogleAccountId) {
        let root = TempDir::new().unwrap();
        crate::ops::init(root.path()).unwrap();
        let id = add_account(root.path(), "Work").unwrap();
        activate_account(
            root.path(),
            &id,
            GOOGLE_ISSUER,
            "subject-work",
            Some("work@example.com".to_string()),
        )
        .unwrap();
        (root, id)
    }

    #[test]
    fn successful_login_discovery_makes_calendars_immediately_visible() {
        let (root, account_id) = connected_account();
        let http = MockHttpClient::new(vec![HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [{
                    "id": "work-primary",
                    "summary": "Work",
                    "primary": true,
                    "accessRole": "owner"
                }]
            }),
            etag: None,
        }]);

        refresh_calendars_after_login(root.path(), &account_id, "access", &http).unwrap();

        let config = Config::load(root.path()).unwrap();
        let account = config.google_registry.account(&account_id).unwrap();
        assert_eq!(account.state, GoogleAccountState::Connected);
        let calendars: Vec<_> = config
            .google_registry
            .calendars
            .iter()
            .filter(|calendar| calendar.account_id == account_id)
            .collect();
        assert_eq!(calendars.len(), 1);
        assert_eq!(calendars[0].calendar_id, "work-primary");
    }

    #[test]
    fn discovery_failure_keeps_connection_and_reports_partial_success() {
        let (root, account_id) = connected_account();
        let http = MockHttpClient::new(vec![HttpResponse {
            status: 503,
            body: serde_json::json!({}),
            etag: None,
        }]);

        let error =
            refresh_calendars_after_login(root.path(), &account_id, "access", &http).unwrap_err();
        assert!(matches!(error, JinError::Offline(_)));
        assert!(error.to_string().contains("connected successfully"));
        assert!(error.to_string().contains("retry Refresh calendars"));

        let config = Config::load(root.path()).unwrap();
        assert_eq!(
            config.google_registry.account(&account_id).unwrap().state,
            GoogleAccountState::Connected
        );
        assert!(config.google_registry.calendars.is_empty());
    }

    #[test]
    fn discovery_auth_failure_keeps_connection_and_partial_success_auth_class() {
        let (root, account_id) = connected_account();
        let http = MockHttpClient::new(vec![HttpResponse {
            status: 403,
            body: serde_json::json!({}),
            etag: None,
        }]);

        let error =
            refresh_calendars_after_login(root.path(), &account_id, "access", &http).unwrap_err();
        assert!(matches!(error, JinError::Auth(_)));
        assert!(error.to_string().contains("connected successfully"));
        assert!(error.to_string().contains("Calendar API is enabled"));
        assert!(error.to_string().contains("connection was kept"));

        let config = Config::load(root.path()).unwrap();
        assert_eq!(
            config.google_registry.account(&account_id).unwrap().state,
            GoogleAccountState::Connected
        );
    }
}
