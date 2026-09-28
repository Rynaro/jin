//! Root-aware Google account and CalendarList lifecycle operations.

use std::path::Path;

use crate::google::account::{GoogleAccountId, GoogleAccountState};
use crate::google::client::CalendarClient;
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

/// Refresh one already-mapped Google event without draining or creating outbox
/// work. This repairs legacy imports that predate organizer/collaboration facts.
pub fn refresh_event_details<H: HttpClient>(
    root: &Path,
    event_id: &str,
    account_id: &GoogleAccountId,
    calendar_id: &str,
    bearer: &str,
    http: &H,
) -> crate::Result<()> {
    // Share the account-level refresh lock with calendar discovery and sync.
    // This command deliberately never drains the outbox, but it must not race
    // a route change or a concurrent provider import.
    let _account_guard = crate::ops::sync::acquire_refresh_lock(root, account_id)?;
    let cfg = Config::load(root)?;
    let target =
        crate::google::account::EventSyncTarget::new(account_id.clone(), calendar_id.to_string())?;
    let route = cfg
        .google_registry
        .calendars
        .iter()
        .find(|calendar| calendar.account_id == *account_id && calendar.calendar_id == calendar_id)
        .ok_or_else(|| JinError::Integrity("unknown Google calendar route".to_string()))?;
    if !route.enabled || !route.available || !route.access_role.can_write() {
        return Err(JinError::OperationBlocked {
            operation_id: event_id.to_string(),
            reason: "Google calendar route is not writable; refresh calendar permissions first"
                .to_string(),
        });
    }
    crate::google::route_ownership::validate(&cfg.events_dir(), event_id, &target)?;
    let local_event =
        crate::store::fs::read_event(&cfg.events_dir().join(format!("{event_id}.md")))?;
    let destination = crate::sync::state::SyncDestination::google(
        account_id.as_str().to_string(),
        calendar_id.to_string(),
    );
    let conn = crate::sync::state::open_sync_db(&cfg.sync_dir())?;
    let delivery = crate::sync::state::event_delivery_state(&conn, &destination, event_id)?;
    if delivery != "synced" {
        let reason = match delivery.as_str() {
            "paused" | "sending" => "Google publication needs review. Open Settings > Calendars & Sync and review this event's paused change before syncing.",
            "cancelled" => "Publishing this event to Google was cancelled. The event is saved in Jin; no Google copy is confirmed.",
            "pending" => "This event has unsent local changes. Sync it before refreshing Google details.",
            _ => "This event has not been published to Google yet.",
        };
        return Err(JinError::OperationBlocked {
            operation_id: event_id.to_string(),
            reason: reason.to_string(),
        });
    }
    let entry = crate::sync::state::list_scoped_entries_by_jin_id(&conn, event_id)?
        .into_iter()
        .find(|entry| entry.destination == destination)
        .ok_or_else(|| JinError::Integrity("event has no Google route mapping".to_string()))?;
    if crate::sync::state::has_active_outbox_for_event(
        &conn,
        &destination,
        event_id,
        &entry.recurrence_key,
    )? {
        return Err(JinError::OperationBlocked {
            operation_id: event_id.to_string(),
            reason:
                "event has unsent local changes; review them before refreshing provider details"
                    .to_string(),
        });
    }
    let google_id = entry
        .google_event_id
        .as_deref()
        .ok_or_else(|| JinError::Integrity("event mapping has no Google event id".to_string()))?;
    let client = CalendarClient {
        http,
        calendar_id,
        access_token: bearer,
    };
    let response = client.get_event(google_id)?;
    if !(200..300).contains(&response.status) {
        return Err(JinError::Offline(format!(
            "Google event details request failed with HTTP {}",
            response.status
        )));
    }
    let mut frontmatter =
        crate::google::mapping::google_to_jin(&response.body, event_id, calendar_id)?;
    frontmatter.source = local_event.frontmatter.source.clone();
    frontmatter.authority = local_event.frontmatter.authority.clone();
    // Mapping owns provider facts. Retain Jin's local identity/linkage and the
    // recurrence-instance projection that Google's single-event GET omits.
    frontmatter.derived_from = local_event.frontmatter.derived_from.clone();
    frontmatter.master_id = local_event.frontmatter.master_id.clone();
    frontmatter.recurrence_unexpanded = local_event.frontmatter.recurrence_unexpanded;
    if frontmatter.recurring_event_id.is_none() {
        frontmatter.recurring_event_id = local_event.frontmatter.recurring_event_id.clone();
    }
    if frontmatter.original_start.is_none() {
        frontmatter.original_start = local_event.frontmatter.original_start.clone();
    }
    crate::store::fs::write_event(
        &cfg.events_dir(),
        &crate::model::Event {
            frontmatter,
            body: local_event.body,
        },
    )?;
    crate::google::route_ownership::write(&cfg.events_dir(), event_id, &target)?;
    crate::sync::state::upsert_scoped_entry(
        &conn,
        &crate::sync::state::ScopedEventSyncEntry {
            destination,
            jin_id: event_id.to_string(),
            recurrence_key: entry.recurrence_key,
            google_event_id: Some(google_id.to_string()),
            ical_uid: response
                .body
                .get("iCalUID")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            etag: response.etag.or_else(|| {
                response
                    .body
                    .get("etag")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            }),
            google_updated: response
                .body
                .get("updated")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            last_synced_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )?;
    crate::ops::api::refresh(root).map(|_| ())
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
    use crate::model::{EventSource, TemporalValue, ValueType};
    use crate::ops::events::{create_event, CreateEventParams};
    use crate::sync::state::{
        self, OutboxOperation, OutboxOperationKind, ScopedEventSyncEntry, SyncDestination,
        MASTER_RECURRENCE_KEY,
    };
    use chrono::NaiveDate;
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

    #[test]
    fn event_detail_refresh_never_fetches_or_drains_active_outbox_work() {
        for (state_name, mapped) in [
            ("pending", true),
            ("sending", true),
            ("paused", true),
            ("pending", false),
            ("paused", false),
            ("cancelled", false),
        ] {
            let (root, account_id) = connected_account();
            let discovery = MockHttpClient::new(vec![HttpResponse {
                status: 200,
                body: serde_json::json!({"items":[{"id":"work-primary","summary":"Work","accessRole":"owner"}]}),
                etag: None,
            }]);
            refresh_calendars(root.path(), &account_id, "access", &discovery).unwrap();
            let cfg = Config::load(root.path()).unwrap();
            let mut event = create_event(
                &cfg.events_dir(),
                CreateEventParams {
                    title: "Legacy mirrored event".to_string(),
                    body: "keep this body".to_string(),
                    start: TemporalValue::Date(NaiveDate::from_ymd_opt(2026, 1, 2).unwrap()),
                    end: TemporalValue::Date(NaiveDate::from_ymd_opt(2026, 1, 3).unwrap()),
                    start_value_type: ValueType::Date,
                    end_value_type: ValueType::Date,
                    is_all_day: true,
                    start_tzid: None,
                    end_tzid: None,
                    floating: false,
                    ical_uid: None,
                    description: None,
                    location: None,
                    attendees: None,
                    conference_data: None,
                    reminders: None,
                },
            )
            .unwrap();
            event.frontmatter.source = EventSource::Google;
            event.frontmatter.authority = EventSource::Google;
            crate::store::fs::write_event(&cfg.events_dir(), &event).unwrap();
            let target =
                crate::google::account::EventSyncTarget::new(account_id.clone(), "work-primary")
                    .unwrap();
            crate::google::route_ownership::write(&cfg.events_dir(), event.id(), &target).unwrap();
            let destination = SyncDestination::google(account_id.as_str(), "work-primary");
            let conn = state::open_sync_db(&cfg.sync_dir()).unwrap();
            if mapped {
                state::upsert_scoped_entry(
                    &conn,
                    &ScopedEventSyncEntry {
                        destination: destination.clone(),
                        jin_id: event.id().to_string(),
                        recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                        google_event_id: Some("remote-1".to_string()),
                        ical_uid: None,
                        etag: Some("etag-1".to_string()),
                        google_updated: None,
                        last_synced_at: None,
                    },
                )
                .unwrap();
            }
            state::enqueue_outbox(
                &conn,
                &OutboxOperation {
                    operation_id: format!("refresh-guard-{state_name}"),
                    destination: destination.clone(),
                    jin_id: event.id().to_string(),
                    recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                    google_event_id: Some("remote-1".to_string()),
                    operation: OutboxOperationKind::Patch,
                    base_etag: Some("etag-1".to_string()),
                    canonical_revision: "revision".to_string(),
                    auth_generation: 1,
                    route_generation: 0,
                    payload: None,
                    state: state_name.to_string(),
                    pause_reason: (state_name == "paused").then(|| "review".to_string()),
                    reviewed: false,
                },
            )
            .unwrap();
            assert_eq!(
                state::event_delivery_state(&conn, &destination, event.id()).unwrap(),
                state_name
            );
            crate::ops::api::refresh(root.path()).unwrap();
            let dto = crate::ops::api::get_event(root.path(), event.id()).unwrap();
            assert_eq!(dto.sync_context.unwrap().state, state_name);
            let before = state::list_route_outbox(&conn, &destination, state_name).unwrap();
            let http = MockHttpClient::new(Vec::new());
            let error = refresh_event_details(
                root.path(),
                event.id(),
                &account_id,
                "work-primary",
                "access",
                &http,
            )
            .unwrap_err();
            assert!(
                matches!(error, JinError::OperationBlocked { .. }),
                "{state_name}: {error}"
            );
            assert!(
                http.requested_urls().is_empty(),
                "{state_name} must not issue a GET"
            );
            let after = state::list_route_outbox(&conn, &destination, state_name).unwrap();
            assert_eq!(
                after.len(),
                before.len(),
                "{state_name} work must remain queued"
            );
            assert_eq!(after[0].operation_id, before[0].operation_id);
        }
    }
}
