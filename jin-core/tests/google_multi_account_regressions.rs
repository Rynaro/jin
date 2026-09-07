use jin_core::google::account::{
    DiscoveredCalendar, EventSyncTarget, GoogleAccessRole, GoogleAccountId, GOOGLE_ISSUER,
};
use jin_core::google::client::{HttpResponse, MockHttpClient};
use jin_core::google::migration::MigrationFailpoint;
use jin_core::google::secrets::TokenSet;
use jin_core::sync::audit::redacted_delta;
use jin_core::sync::state::{
    self, OutboxOperation, OutboxOperationKind, SyncDestination, MASTER_RECURRENCE_KEY,
};
use tempfile::TempDir;

struct RecordingHttp {
    responses: std::sync::Mutex<std::collections::VecDeque<jin_core::Result<HttpResponse>>>,
    urls: std::sync::Mutex<Vec<String>>,
}

impl RecordingHttp {
    fn new(responses: Vec<jin_core::Result<HttpResponse>>) -> Self {
        Self {
            responses: std::sync::Mutex::new(responses.into()),
            urls: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn urls(&self) -> Vec<String> {
        self.urls.lock().unwrap().clone()
    }
}

impl jin_core::google::client::HttpClient for RecordingHttp {
    fn get(&self, url: &str, _bearer: &str) -> jin_core::Result<HttpResponse> {
        self.urls.lock().unwrap().push(url.to_string());
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
                Err(jin_core::JinError::Integrity(
                    "recording cassette exhausted".to_string(),
                ))
            })
    }

    fn post_json(&self, _: &str, _: &str, _: &serde_json::Value) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }

    fn patch_json(
        &self,
        _: &str,
        _: &str,
        _: Option<&str>,
        _: &serde_json::Value,
    ) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }

    fn delete(&self, _: &str, _: &str, _: Option<&str>) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }

    fn post_form(&self, _: &str, _: &[(&str, &str)]) -> jin_core::Result<serde_json::Value> {
        unreachable!()
    }
}

struct CountingHttp {
    calls: std::sync::atomic::AtomicUsize,
}

impl CountingHttp {
    fn new() -> Self {
        Self {
            calls: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl jin_core::google::client::HttpClient for CountingHttp {
    fn get(&self, _url: &str, _bearer: &str) -> jin_core::Result<HttpResponse> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [], "nextSyncToken": "next"}),
            etag: None,
        })
    }
    fn post_json(
        &self,
        _url: &str,
        _bearer: &str,
        _body: &serde_json::Value,
    ) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }
    fn patch_json(
        &self,
        _url: &str,
        _bearer: &str,
        _etag: Option<&str>,
        _body: &serde_json::Value,
    ) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }
    fn delete(
        &self,
        _url: &str,
        _bearer: &str,
        _etag: Option<&str>,
    ) -> jin_core::Result<HttpResponse> {
        unreachable!()
    }
    fn post_form(
        &self,
        _url: &str,
        _params: &[(&str, &str)],
    ) -> jin_core::Result<serde_json::Value> {
        unreachable!()
    }
}

fn configured_root() -> (TempDir, jin_core::Config, EventSyncTarget) {
    let tmp = TempDir::new().unwrap();
    jin_core::ops::init(tmp.path()).unwrap();
    let mut config = jin_core::Config::load(tmp.path()).unwrap();
    config.token_backend = "file".to_string();
    let account_id = config
        .google_registry
        .add_pending_account("Personal")
        .unwrap();
    config
        .google_registry
        .account_mut(&account_id)
        .unwrap()
        .bind_subject(
            GOOGLE_ISSUER,
            "subject-personal",
            Some("p@example.com".to_string()),
        )
        .unwrap();
    config
        .google_registry
        .reconcile_calendars(
            &account_id,
            vec![DiscoveredCalendar {
                calendar_id: "primary".to_string(),
                name: "Personal".to_string(),
                primary: true,
                access_role: GoogleAccessRole::Owner,
            }],
        )
        .unwrap();
    config.google_sync_schema_version = Some(jin_core::config::GOOGLE_SYNC_SCHEMA_VERSION);
    config.write_google_v2_guard().unwrap();
    config.save().unwrap();
    let target = EventSyncTarget::new(account_id, "primary").unwrap();
    (tmp, config, target)
}

fn tokens() -> TokenSet {
    TokenSet {
        access_token: "access".to_string(),
        refresh_token: Some("refresh".to_string()),
        expires_at: i64::MAX,
        scope: "https://www.googleapis.com/auth/calendar".to_string(),
        client_id: "client".to_string(),
        account: None,
    }
}

fn google_event(id: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id, "summary": title, "status": "confirmed", "etag": format!("etag-{id}"),
        "created": "2026-08-20T10:00:00Z", "updated": "2026-08-20T10:00:00Z",
        "start": {"dateTime": "2026-08-20T10:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-08-20T11:00:00Z", "timeZone": "UTC"}
    })
}

fn google_occurrence(id: &str, title: &str, original: &str) -> serde_json::Value {
    let mut event = google_event(id, title);
    event["recurringEventId"] = serde_json::json!("remote-master");
    event["originalStartTime"] = serde_json::json!({"dateTime": original, "timeZone": "UTC"});
    event
}

fn operation(destination: SyncDestination, operation_id: &str) -> OutboxOperation {
    OutboxOperation {
        operation_id: operation_id.to_string(),
        destination,
        jin_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ".to_string(),
        recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
        google_event_id: None,
        operation: OutboxOperationKind::Insert,
        base_etag: None,
        canonical_revision: "sha256:canonical".to_string(),
        auth_generation: 1,
        route_generation: 1,
        payload: Some(serde_json::json!({"summary": "Safe"})),
        state: "pending".to_string(),
        pause_reason: None,
        reviewed: false,
    }
}

#[test]
fn sync_state_composite_recurrence_collision_schema() {
    let tmp = TempDir::new().unwrap();
    let conn = state::open_sync_db(tmp.path()).unwrap();
    let personal = SyncDestination::google("account-personal", "shared-id");
    let work = SyncDestination::google("account-work", "shared-id");

    state::enqueue_outbox(&conn, &operation(personal.clone(), "same-operation")).unwrap();
    state::enqueue_outbox(&conn, &operation(work.clone(), "same-operation")).unwrap();

    assert_eq!(
        state::list_route_outbox(&conn, &personal, "pending")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        state::list_route_outbox(&conn, &work, "pending")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn account_registry_disconnect_scopes_cursor_and_outbox() {
    let tmp = TempDir::new().unwrap();
    let conn = state::open_sync_db(tmp.path()).unwrap();
    let google = SyncDestination::google("same-account", "calendar-a");
    let other = SyncDestination {
        provider: "other-provider".to_string(),
        account_id: "same-account".to_string(),
        calendar_id: "calendar-a".to_string(),
    };
    state::enqueue_outbox(&conn, &operation(google.clone(), "disconnect-op")).unwrap();
    state::enqueue_outbox(&conn, &operation(other.clone(), "disconnect-op")).unwrap();

    state::clear_account_state(&conn, "google", "same-account").unwrap();
    assert_eq!(
        state::list_route_outbox(&conn, &google, "paused")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        state::list_route_outbox(&conn, &other, "pending")
            .unwrap()
            .len(),
        1
    );
    assert!(
        state::review_outbox_operation(&conn, &other, "missing-on-this-route", true, 2, 2,)
            .is_err()
    );
    state::review_outbox_operation(&conn, &google, "disconnect-op", true, 2, 2).unwrap();
    assert_eq!(
        state::list_route_outbox(&conn, &google, "pending")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn event_mutation_intent_route_is_immutable() {
    let tmp = TempDir::new().unwrap();
    let personal = EventSyncTarget::new(
        GoogleAccountId::parse("account-personal").unwrap(),
        "same-calendar-id",
    )
    .unwrap();
    let work = EventSyncTarget::new(
        GoogleAccountId::parse("account-work").unwrap(),
        "same-calendar-id",
    )
    .unwrap();
    jin_core::google::route_ownership::write(tmp.path(), "event-id", &personal).unwrap();

    jin_core::google::route_ownership::validate(tmp.path(), "event-id", &personal).unwrap();
    assert!(jin_core::google::route_ownership::validate(tmp.path(), "event-id", &work).is_err());
}

#[test]
fn conflict_google_412_audit_contract() {
    let delta = serde_json::json!({
        "summary": "safe",
        "access_token": "secret",
        "nested": {"alias": "Work", "local_context": {"task": "private"}},
        "items": [{"client_secret": "secret"}, {"location": "safe"}]
    });
    let redacted = redacted_delta(&delta);
    let serialized = serde_json::to_string(&redacted).unwrap();

    assert_eq!(redacted["summary"], "safe");
    assert_eq!(redacted["items"][1]["location"], "safe");
    for forbidden in ["access_token", "client_secret", "local_context", "Work"] {
        assert!(!serialized.contains(forbidden));
    }
}

#[test]
fn config_migration_token_copy_failure_rolls_back() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join(".jin/sync")).unwrap();
    std::fs::create_dir_all(root.join("events")).unwrap();
    let mut config = jin_core::Config::new(root.to_path_buf());
    config.calendar_id = Some("legacy-calendar".to_string());
    config.token_backend = "file".to_string();
    config.save().unwrap();
    let before = std::fs::read(jin_core::Config::config_path(root)).unwrap();
    std::fs::write(root.join(".jin/sync/tokens.enc"), b"not-an-encrypted-token").unwrap();

    assert!(jin_core::google::migration::migrate_singleton(root, Some("passphrase")).is_err());
    assert_eq!(
        std::fs::read(jin_core::Config::config_path(root)).unwrap(),
        before
    );
    assert!(root.join(".jin/sync/tokens.enc").exists());
    assert!(!jin_core::Config::load(root).unwrap().google_v2_active());
}

#[test]
fn config_migration_old_binary_write_guard_fixture() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join(".jin")).unwrap();
    let config = jin_core::Config::new(root.to_path_buf());
    config.save().unwrap();
    assert!(config.ensure_singleton_write_allowed().is_ok());

    config.write_google_v2_guard().unwrap();
    assert!(config.ensure_singleton_write_allowed().is_err());
}

#[test]
fn config_migration_all_phase_failure_injection() {
    for failpoint in [
        MigrationFailpoint::AfterPrepared,
        MigrationFailpoint::AfterTokenCopied,
        MigrationFailpoint::AfterRegistryWritten,
        MigrationFailpoint::AfterActivated,
    ] {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init(tmp.path()).unwrap();
        let mut config = jin_core::Config::load(tmp.path()).unwrap();
        config.calendar_id = Some("legacy-calendar".to_string());
        config.save().unwrap();

        assert!(
            jin_core::google::migration::migrate_singleton_with_failpoint(
                tmp.path(),
                None,
                Some(failpoint),
            )
            .is_err()
        );
        let recovered = jin_core::google::migration::migrate_singleton(tmp.path(), None)
            .unwrap()
            .unwrap();
        assert!(recovered.activated, "failed to recover from {failpoint:?}");
        let current = jin_core::Config::load(tmp.path()).unwrap();
        assert!(current.google_v2_active());
        assert!(current.calendar_id.is_none());
        assert!(tmp.path().join(".jin/google-v2-required").exists());
        assert_eq!(current.google_registry.accounts.len(), 1);
    }
}

#[test]
fn config_migration_historical_singleton_layout_refuses_write() {
    #[derive(serde::Deserialize)]
    struct HistoricalConfig {
        calendar_id: Option<String>,
    }
    fn historical_writer(root: &std::path::Path) -> Result<(), &'static str> {
        let config: HistoricalConfig =
            toml::from_str(&std::fs::read_to_string(root.join(".jin/config.toml")).unwrap())
                .unwrap();
        if config.calendar_id.is_none() {
            return Err("legacy calendar destination unavailable");
        }
        std::fs::write(root.join("events/historical-write"), b"unsafe").unwrap();
        Ok(())
    }

    let tmp = TempDir::new().unwrap();
    jin_core::ops::init(tmp.path()).unwrap();
    let mut config = jin_core::Config::load(tmp.path()).unwrap();
    config.calendar_id = Some("legacy-calendar".to_string());
    config.save().unwrap();
    jin_core::google::migration::migrate_singleton(tmp.path(), None).unwrap();

    assert!(historical_writer(tmp.path()).is_err());
    assert!(!tmp.path().join("events/historical-write").exists());
    let active = jin_core::Config::load(tmp.path()).unwrap();
    assert!(jin_core::google::secrets::delete_tokens(tmp.path(), &active).is_err());
}

#[test]
fn event_mutation_routed_create_recovery_restores_sidecar() {
    use chrono::NaiveDateTime;
    use jin_core::model::event::{TemporalValue, ValueType};
    let (tmp, config, target) = configured_root();
    let service = jin_core::ops::event_mutation::EventMutationService::new(tmp.path()).unwrap();
    let start = NaiveDateTime::parse_from_str("2026-08-20T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = service
        .create(
            jin_core::ops::events::CreateEventParams {
                title: "Recover route".to_string(),
                body: String::new(),
                start: TemporalValue::DateTime(start),
                end: TemporalValue::DateTime(start + chrono::Duration::hours(1)),
                start_value_type: ValueType::DateTime,
                end_value_type: ValueType::DateTime,
                is_all_day: false,
                start_tzid: None,
                end_tzid: None,
                floating: true,
                ical_uid: None,
                description: None,
                location: None,
                attendees: None,
                conference_data: None,
                reminders: None,
            },
            Some(target.clone()),
            "route-recovery",
        )
        .unwrap();
    jin_core::google::route_ownership::clear(&config.events_dir(), event.id()).unwrap();
    let journal_path = config
        .sync_dir()
        .join("mutation-journal/route-recovery.json");
    let mut journal: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&journal_path).unwrap()).unwrap();
    journal["finalized"] = serde_json::Value::Bool(false);
    std::fs::write(&journal_path, serde_json::to_vec_pretty(&journal).unwrap()).unwrap();

    assert_eq!(service.recover().unwrap(), 1);
    jin_core::google::route_ownership::validate(&config.events_dir(), event.id(), &target).unwrap();
}

#[test]
fn promotion_requires_typed_destination_and_publishes_exact_route() {
    use chrono::NaiveDateTime;
    let (tmp, mut config, personal) = configured_root();
    let work_id = config.google_registry.add_pending_account("Work").unwrap();
    config
        .google_registry
        .account_mut(&work_id)
        .unwrap()
        .bind_subject(
            GOOGLE_ISSUER,
            "subject-work",
            Some("w@example.com".to_string()),
        )
        .unwrap();
    config
        .google_registry
        .reconcile_calendars(
            &work_id,
            vec![DiscoveredCalendar {
                calendar_id: "work-primary".to_string(),
                name: "Work".to_string(),
                primary: true,
                access_role: GoogleAccessRole::Writer,
            }],
        )
        .unwrap();
    config.save().unwrap();
    let task = jin_core::ops::tasks::create_task(
        &config.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Publish planning block".to_string(),
            ..Default::default()
        },
    )
    .unwrap();
    let params = || jin_core::ops::promote::PromoteParams {
        start_dt: NaiveDateTime::parse_from_str("2026-08-20T10:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap(),
        tzid: None,
    };
    let error = jin_core::ops::promote::promote_with_operation_id(
        tmp.path(),
        task.id(),
        params(),
        "ambiguous-promote",
    )
    .unwrap_err();
    assert!(matches!(
        error,
        jin_core::JinError::AmbiguousDestination { count: 2 }
    ));
    assert!(
        jin_core::ops::events::list_events(&config.events_dir(), false)
            .unwrap()
            .is_empty()
    );

    let event = jin_core::ops::promote::promote_with_destination_and_operation_id(
        tmp.path(),
        task.id(),
        params(),
        Some(personal.clone()),
        false,
        "routed-promote",
    )
    .unwrap();
    jin_core::google::route_ownership::validate(&config.events_dir(), event.id(), &personal)
        .unwrap();
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let route = SyncDestination::google(personal.account_id.as_str(), personal.calendar_id);
    assert_eq!(
        state::list_route_outbox(&conn, &route, "pending")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn sync_orchestrator_stale_generation_blocks_before_provider_request() {
    let (tmp, mut config, target) = configured_root();
    let captured_auth_generation = config
        .google_registry
        .account(&target.account_id)
        .unwrap()
        .auth_generation;
    let route_generation = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| calendar.calendar_id == target.calendar_id)
        .unwrap()
        .route_generation;
    config
        .google_registry
        .account_mut(&target.account_id)
        .unwrap()
        .auth_generation += 1;
    config.save().unwrap();
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let http = CountingHttp::new();

    assert!(jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        captured_auth_generation,
        route_generation,
        &tokens(),
        &http,
    )
    .is_err());
    assert_eq!(http.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn google_sync_recurring_series_identity_and_jin_unpublish_are_reachable() {
    let (tmp, config, target) = configured_root();
    let destination =
        SyncDestination::google(target.account_id.as_str(), target.calendar_id.clone());
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let calendar = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| calendar.calendar_id == target.calendar_id)
        .unwrap();
    let account = config.google_registry.account(&target.account_id).unwrap();
    let mut master = google_event("remote-master", "Weekly");
    master["recurrence"] = serde_json::json!(["RRULE:FREQ=WEEKLY"]);
    let mut occurrence = google_event("remote-occurrence", "Weekly instance");
    occurrence["recurringEventId"] = serde_json::json!("remote-master");
    occurrence["originalStartTime"] =
        serde_json::json!({"dateTime": "2026-08-20T10:00:00Z", "timeZone": "UTC"});
    let http = MockHttpClient::new(vec![
        HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [master], "nextSyncToken": "sync-1"}),
            etag: None,
        },
        HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [occurrence]}),
            etag: None,
        },
    ]);
    jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &http,
    )
    .unwrap();
    let occurrence_mapping = state::get_scoped_entry_by_remote_id(
        &conn,
        &destination,
        "remote-occurrence",
        "2026-08-20T10:00:00+00:00@UTC",
    )
    .unwrap()
    .unwrap();
    let master_mapping = state::get_scoped_entry_by_remote_id(
        &conn,
        &destination,
        "remote-master",
        MASTER_RECURRENCE_KEY,
    )
    .unwrap()
    .unwrap();
    let occurrence_event =
        jin_core::ops::events::get_event(&config.events_dir(), &occurrence_mapping.jin_id).unwrap();
    assert_eq!(
        occurrence_event.frontmatter.master_id.as_deref(),
        Some(master_mapping.jin_id.as_str())
    );

    jin_core::ops::api::refresh(tmp.path()).unwrap();
    let occurrence_detail =
        jin_core::ops::api::get_event_detail(tmp.path(), &occurrence_mapping.jin_id).unwrap();
    let master_before =
        jin_core::ops::events::get_event(&config.events_dir(), &master_mapping.jin_id).unwrap();
    let edited_master = jin_core::ops::event_mutation::EventMutationService::new(tmp.path())
        .unwrap()
        .edit(
            &occurrence_mapping.jin_id,
            &occurrence_detail.edit_token,
            jin_core::ops::events::EditEventPatch {
                title: "Weekly renamed".to_string(),
                start: master_before.frontmatter.start.clone(),
                end: master_before.frontmatter.end.clone(),
                start_value_type: master_before.frontmatter.start_value_type,
                end_value_type: master_before.frontmatter.end_value_type,
                is_all_day: master_before.frontmatter.is_all_day,
                start_tzid: master_before.frontmatter.start_tzid.clone(),
                end_tzid: master_before.frontmatter.end_tzid.clone(),
                floating: master_before.frontmatter.floating,
                description: master_before.frontmatter.description.clone(),
                location: master_before.frontmatter.location.clone(),
                attendees: master_before.frontmatter.attendees.clone(),
                attendees_omitted: None,
                conference_data: master_before.frontmatter.conference_data.clone(),
                clear_conference_data: false,
                reminders: master_before.frontmatter.reminders.clone(),
            },
            target.clone(),
            Some(jin_core::ops::event_mutation::RecurrenceMutationScope::EntireSeries),
            "series-edit",
        )
        .unwrap();
    assert_eq!(edited_master.id(), master_mapping.jin_id);
    assert_eq!(
        edited_master.frontmatter.recurrence,
        vec!["RRULE:FREQ=WEEKLY"]
    );

    let mut jin_event =
        jin_core::ops::events::get_event(&config.events_dir(), &master_mapping.jin_id).unwrap();
    jin_event.frontmatter.source = jin_core::model::event::EventSource::Jin;
    jin_event.frontmatter.authority = jin_core::model::event::EventSource::Jin;
    jin_core::store::fs::write_event(&config.events_dir(), &jin_event).unwrap();
    let changed = google_event("remote-master", "Remote changed");
    let http = MockHttpClient::new(vec![HttpResponse {
        status: 200,
        body: serde_json::json!({"items": [changed], "nextSyncToken": "sync-2"}),
        etag: None,
    }]);
    jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &http,
    )
    .unwrap();
    let preserved =
        jin_core::ops::events::get_event(&config.events_dir(), &master_mapping.jin_id).unwrap();
    assert_eq!(
        preserved.frontmatter.source,
        jin_core::model::event::EventSource::Jin
    );

    let http = MockHttpClient::new(vec![HttpResponse {
        status: 200,
        body: serde_json::json!({"items": [{"id": "remote-master", "status": "cancelled"}], "nextSyncToken": "sync-3"}),
        etag: None,
    }]);
    jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &http,
    )
    .unwrap();
    let unpublished =
        jin_core::ops::events::get_event(&config.events_dir(), &master_mapping.jin_id).unwrap();
    assert_eq!(
        unpublished.frontmatter.source,
        jin_core::model::event::EventSource::Jin
    );
    assert_ne!(
        unpublished.frontmatter.status,
        jin_core::model::event::EventStatus::Cancelled
    );
    assert!(state::get_scoped_entry_by_remote_id(
        &conn,
        &destination,
        "remote-master",
        MASTER_RECURRENCE_KEY,
    )
    .unwrap()
    .is_none());
}

#[test]
fn recurring_occurrence_snapshot_is_paginated_safe_and_hidden_master_is_addressable() {
    let (tmp, config, target) = configured_root();
    let destination =
        SyncDestination::google(target.account_id.as_str(), target.calendar_id.clone());
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let calendar = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| calendar.calendar_id == target.calendar_id)
        .unwrap();
    let account = config.google_registry.account(&target.account_id).unwrap();
    let mut master = google_event("remote-master", "Weekly master");
    master["recurrence"] = serde_json::json!(["RRULE:FREQ=WEEKLY"]);
    let occurrences = [
        google_occurrence("occ-keep", "Keep", "2026-08-20T10:00:00Z"),
        google_occurrence("occ-stale", "Stale", "2026-08-27T10:00:00Z"),
        google_occurrence("occ-jin", "Jin protected", "2026-09-03T10:00:00Z"),
        google_occurrence("occ-outbox", "Outbox protected", "2026-09-10T10:00:00Z"),
    ];
    let initial = RecordingHttp::new(vec![
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [master, &occurrences[0]], "nextPageToken": "base-page-2"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [], "nextSyncToken": "sync-1"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [&occurrences[0], &occurrences[1]], "nextPageToken": "occ-page-2"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [&occurrences[2], &occurrences[3]]}),
            etag: None,
        }),
    ]);
    let first = jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &initial,
    )
    .unwrap();
    assert_eq!(first.pulled, 5);
    assert_eq!(
        state::get_scoped_sync_token(&conn, &destination)
            .unwrap()
            .as_deref(),
        Some("sync-1")
    );
    let urls = initial.urls();
    assert!(urls[0].contains("singleEvents=false"));
    assert!(urls[1].contains("pageToken=base-page-2"));
    assert!(urls[2].contains("singleEvents=true"));
    assert!(urls[2].contains("timeMin="));
    assert!(urls[2].contains("timeMax="));
    assert!(urls[3].contains("pageToken=occ-page-2"));

    let master_entry = state::get_scoped_entry_by_remote_id(
        &conn,
        &destination,
        "remote-master",
        MASTER_RECURRENCE_KEY,
    )
    .unwrap()
    .unwrap();
    let entry = |remote: &str, original: &str| {
        let recurrence_key = format!(
            "{}@UTC",
            chrono::DateTime::parse_from_rfc3339(original)
                .unwrap()
                .to_rfc3339()
        );
        state::get_scoped_entry_by_remote_id(&conn, &destination, remote, &recurrence_key)
            .unwrap()
            .unwrap()
    };
    let keep = entry("occ-keep", "2026-08-20T10:00:00Z");
    let stale = entry("occ-stale", "2026-08-27T10:00:00Z");
    let jin_protected = entry("occ-jin", "2026-09-03T10:00:00Z");
    let outbox_protected = entry("occ-outbox", "2026-09-10T10:00:00Z");
    let keep_event = jin_core::ops::events::get_event(&config.events_dir(), &keep.jin_id).unwrap();
    assert_eq!(
        keep_event.frontmatter.master_id.as_deref(),
        Some(master_entry.jin_id.as_str())
    );

    jin_core::ops::api::refresh(tmp.path()).unwrap();
    let visible = jin_core::ops::api::list_events(tmp.path(), false).unwrap();
    assert_eq!(
        visible.len(),
        4,
        "the recurring master must not duplicate its instances"
    );
    assert!(visible.iter().all(|event| event.id != master_entry.jin_id));
    assert_eq!(
        jin_core::ops::api::get_event(tmp.path(), &master_entry.jin_id)
            .unwrap()
            .title,
        "Weekly master"
    );

    let failed_snapshot = RecordingHttp::new(vec![
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [], "nextPageToken": "incremental-page-2"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [], "nextSyncToken": "sync-after-failure"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [&occurrences[0]], "nextPageToken": "will-fail"}),
            etag: None,
        }),
        Err(jin_core::JinError::Offline(
            "snapshot interrupted".to_string(),
        )),
    ]);
    assert!(jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &failed_snapshot,
    )
    .is_err());
    let failed_urls = failed_snapshot.urls();
    assert!(failed_urls[0].contains("singleEvents=false"));
    assert!(failed_urls[0].contains("syncToken=sync-1"));
    assert!(failed_urls[1].contains("syncToken=sync-1"));
    assert!(failed_urls[1].contains("pageToken=incremental-page-2"));
    assert!(config
        .events_dir()
        .join(format!("{}.md", stale.jin_id))
        .exists());

    let mut jin_event =
        jin_core::ops::events::get_event(&config.events_dir(), &jin_protected.jin_id).unwrap();
    jin_event.frontmatter.source = jin_core::model::event::EventSource::Jin;
    jin_core::store::fs::write_event(&config.events_dir(), &jin_event).unwrap();
    state::enqueue_outbox(
        &conn,
        &OutboxOperation {
            operation_id: "protect-occurrence".to_string(),
            destination: destination.clone(),
            jin_id: outbox_protected.jin_id.clone(),
            recurrence_key: outbox_protected.recurrence_key.clone(),
            google_event_id: outbox_protected.google_event_id.clone(),
            operation: OutboxOperationKind::Patch,
            base_etag: outbox_protected.etag.clone(),
            canonical_revision: "sha256:test".to_string(),
            auth_generation: account.auth_generation,
            route_generation: calendar.route_generation,
            payload: None,
            state: "pending".to_string(),
            pause_reason: None,
            reviewed: false,
        },
    )
    .unwrap();

    let mut changed_keep = occurrences[0].clone();
    changed_keep["summary"] = serde_json::json!("Keep edited remotely");
    changed_keep["etag"] = serde_json::json!("etag-occ-keep-v2");
    let mut cancelled_stale = occurrences[1].clone();
    cancelled_stale["status"] = serde_json::json!("cancelled");
    let complete = RecordingHttp::new(vec![
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [], "nextSyncToken": "sync-2"}),
            etag: None,
        }),
        Ok(HttpResponse {
            status: 200,
            body: serde_json::json!({"items": [changed_keep, cancelled_stale]}),
            etag: None,
        }),
    ]);
    let second = jin_core::google::multi_sync::pull_destination(
        tmp.path(),
        &conn,
        &target,
        account.auth_generation,
        calendar.route_generation,
        &tokens(),
        &complete,
    )
    .unwrap();
    assert_eq!(second.pulled, 1);
    let keep_after = entry("occ-keep", "2026-08-20T10:00:00Z");
    assert_eq!(keep_after.jin_id, keep.jin_id);
    let keep_event =
        jin_core::ops::events::get_event(&config.events_dir(), &keep_after.jin_id).unwrap();
    assert_eq!(keep_event.frontmatter.title, "Keep edited remotely");
    assert_eq!(
        keep_event.frontmatter.master_id.as_deref(),
        Some(master_entry.jin_id.as_str())
    );
    assert!(!config
        .events_dir()
        .join(format!("{}.md", stale.jin_id))
        .exists());
    assert!(config
        .events_dir()
        .join(format!("{}.md", jin_protected.jin_id))
        .exists());
    assert!(config
        .events_dir()
        .join(format!("{}.md", outbox_protected.jin_id))
        .exists());
}

#[test]
fn sync_orchestrator_reconnect_requires_outbox_review() {
    let tmp = TempDir::new().unwrap();
    let conn = state::open_sync_db(tmp.path()).unwrap();
    let route = SyncDestination::google("account", "calendar");
    state::enqueue_outbox(&conn, &operation(route.clone(), "review-op")).unwrap();
    state::quarantine_route(&conn, &route, "provider_permission_changed").unwrap();

    assert!(state::list_route_outbox(&conn, &route, "pending")
        .unwrap()
        .is_empty());
    assert_eq!(
        state::list_route_outbox(&conn, &route, "paused")
            .unwrap()
            .len(),
        1
    );
    state::review_outbox_operation(&conn, &route, "review-op", true, 3, 4).unwrap();
    let resumed = state::list_route_outbox(&conn, &route, "pending").unwrap();
    assert_eq!(resumed.len(), 1);
    assert_eq!(resumed[0].auth_generation, 3);
    assert_eq!(resumed[0].route_generation, 4);
    assert!(resumed[0].reviewed);
}
