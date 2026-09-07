use chrono::{DateTime, Utc};
use jin_core::google::account::{
    DiscoveredCalendar, EventSyncTarget, GoogleAccessRole, GoogleAccountState, GOOGLE_ISSUER,
};
use jin_core::google::client::{HttpClient, HttpResponse, MockHttpClient};
use jin_core::google::mapping::google_to_jin;
use jin_core::google::secrets::TokenSet;
use jin_core::notification_center::{
    ActionAttemptIntent, CalendarInvitationPayload, InvitationRecurrenceIdentity,
    InvitationResponse, NotificationAction, NotificationCapabilities, NotificationCenter,
    NotificationFilter, NotificationListRequest, NotificationPayload, NotificationSource,
    NotificationStatus, RespondInvitationRequest, RetryInvitationRequest,
    NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
};
use jin_core::ops::event_mutation::{
    EventMutationService, InvitationResponseMutationRequest, RecurrenceMutationScope,
};
use jin_core::sync::state::{self, ScopedEventSyncEntry, SyncDestination, MASTER_RECURRENCE_KEY};
use tempfile::TempDir;

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-09-03T10:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
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

fn response(status: u16, body: serde_json::Value) -> HttpResponse {
    HttpResponse {
        status,
        etag: body
            .get("etag")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        body,
    }
}

struct Fixture {
    tmp: TempDir,
    config: jin_core::Config,
    target: EventSyncTarget,
    item_id: String,
    item_version: u64,
    event_id: String,
    google_event_id: String,
    etag: String,
    self_email: String,
}

impl Fixture {
    fn center(&self) -> NotificationCenter {
        NotificationCenter::open(&self.config.notification_center_path()).unwrap()
    }

    fn request(
        &self,
        operation_id: &str,
        response: InvitationResponse,
    ) -> RespondInvitationRequest {
        RespondInvitationRequest {
            item_id: self.item_id.clone(),
            expected_item_version: self.item_version,
            operation_id: operation_id.to_string(),
            response,
            recurrence_scope: None,
        }
    }

    fn mutation_request(
        &self,
        operation_id: &str,
        response: InvitationResponse,
    ) -> InvitationResponseMutationRequest {
        let account = self
            .config
            .google_registry
            .account(&self.target.account_id)
            .unwrap();
        let calendar = self
            .config
            .google_registry
            .calendars
            .iter()
            .find(|calendar| {
                calendar.account_id == self.target.account_id
                    && calendar.calendar_id == self.target.calendar_id
            })
            .unwrap();
        InvitationResponseMutationRequest {
            event_id: self.event_id.clone(),
            target: self.target.clone(),
            operation_id: operation_id.to_string(),
            response,
            recurrence_scope: None,
            expected_google_event_id: self.google_event_id.clone(),
            expected_recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
            expected_self_email: self.self_email.clone(),
            expected_etag: self.etag.clone(),
            expected_provider_subject: account.provider_subject.clone().unwrap(),
            expected_auth_generation: account.auth_generation,
            expected_route_generation: calendar.route_generation,
        }
    }

    fn queue(&self, operation_id: &str, response: InvitationResponse) {
        self.center()
            .respond_to_invitation(
                self.tmp.path(),
                &self.request(operation_id, response),
                now(),
            )
            .unwrap();
    }

    fn drain<H: HttpClient>(&self, http: &H) -> jin_core::Result<u32> {
        let config = jin_core::Config::load(self.tmp.path()).unwrap();
        let account = config
            .google_registry
            .account(&self.target.account_id)
            .unwrap();
        let calendar = config
            .google_registry
            .calendars
            .iter()
            .find(|calendar| {
                calendar.account_id == self.target.account_id
                    && calendar.calendar_id == self.target.calendar_id
            })
            .unwrap();
        let sync = state::open_sync_db(&config.sync_dir()).unwrap();
        jin_core::google::multi_sync::drain_destination(
            self.tmp.path(),
            &sync,
            &self.target,
            account.auth_generation,
            calendar.route_generation,
            &tokens(),
            http,
        )
    }

    fn replace_canonical_response(&self, etag: &str, response_status: &str) {
        let resource =
            invitation_resource(&self.google_event_id, etag, response_status, false, 1, None);
        let event = jin_core::model::event::Event {
            frontmatter: google_to_jin(&resource, &self.event_id, &self.target.calendar_id)
                .unwrap(),
            body: String::new(),
        };
        jin_core::store::fs::write_event(&self.config.events_dir(), &event).unwrap();
        let sync = state::open_sync_db(&self.config.sync_dir()).unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination: SyncDestination::google(
                    self.target.account_id.as_str().to_string(),
                    self.target.calendar_id.clone(),
                ),
                jin_id: self.event_id.clone(),
                recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                google_event_id: Some(self.google_event_id.clone()),
                ical_uid: event.frontmatter.ical_uid.clone(),
                etag: Some(etag.to_string()),
                google_updated: Some(now().to_rfc3339()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();
    }
}

fn invitation_resource(
    google_event_id: &str,
    etag: &str,
    response_status: &str,
    organizer_self: bool,
    self_count: usize,
    attendees_omitted: Option<bool>,
) -> serde_json::Value {
    let mut attendees = vec![serde_json::json!({
        "email": "organizer@example.com",
        "organizer": true,
        "self": false,
        "responseStatus": "accepted"
    })];
    for index in 0..self_count {
        attendees.push(serde_json::json!({
            "email": if index == 0 { "self@example.com" } else { "alias@example.com" },
            "organizer": false,
            "self": true,
            "responseStatus": response_status
        }));
    }
    let mut resource = serde_json::json!({
        "id": google_event_id,
        "iCalUID": format!("{google_event_id}@google.com"),
        "etag": etag,
        "status": "confirmed",
        "summary": "Planning session",
        "location": "Room 1",
        "start": {"dateTime": "2099-09-03T10:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2099-09-03T11:00:00Z", "timeZone": "UTC"},
        "created": "2026-09-01T10:00:00Z",
        "updated": "2026-09-02T10:00:00Z",
        "organizer": {
            "email": "organizer@example.com",
            "displayName": "Organizer",
            "self": organizer_self
        },
        "attendees": attendees
    });
    if let Some(value) = attendees_omitted {
        resource["attendeesOmitted"] = serde_json::json!(value);
    }
    resource
}

fn setup_invitation(
    response_status: &str,
    organizer_self: bool,
    self_count: usize,
    attendees_omitted: Option<bool>,
) -> Fixture {
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
            Some("self@example.com".to_string()),
        )
        .unwrap();
    config
        .google_registry
        .reconcile_calendars(
            &account_id,
            vec![DiscoveredCalendar {
                calendar_id: "calendar-a".to_string(),
                name: "Personal".to_string(),
                primary: true,
                access_role: GoogleAccessRole::Writer,
            }],
        )
        .unwrap();
    config.google_sync_schema_version = Some(jin_core::config::GOOGLE_SYNC_SCHEMA_VERSION);
    config.write_google_v2_guard().unwrap();
    config.save().unwrap();
    let target = EventSyncTarget::new(account_id, "calendar-a").unwrap();
    let event_id = "jin-event-1".to_string();
    let google_event_id = "google-event-1".to_string();
    let etag = "etag-1".to_string();
    let resource = invitation_resource(
        &google_event_id,
        &etag,
        response_status,
        organizer_self,
        self_count,
        attendees_omitted,
    );
    let event = jin_core::model::event::Event {
        frontmatter: google_to_jin(&resource, &event_id, &target.calendar_id).unwrap(),
        body: String::new(),
    };
    jin_core::store::fs::write_event(&config.events_dir(), &event).unwrap();
    jin_core::google::route_ownership::write(&config.events_dir(), &event_id, &target).unwrap();
    let destination = SyncDestination::google(
        target.account_id.as_str().to_string(),
        target.calendar_id.clone(),
    );
    let sync = state::open_sync_db(&config.sync_dir()).unwrap();
    let account = config.google_registry.account(&target.account_id).unwrap();
    let calendar = config
        .google_registry
        .calendars
        .iter()
        .find(|calendar| {
            calendar.account_id == target.account_id && calendar.calendar_id == target.calendar_id
        })
        .unwrap();
    state::ensure_destination(
        &sync,
        &destination,
        account.auth_generation,
        calendar.route_generation,
    )
    .unwrap();
    state::upsert_scoped_entry(
        &sync,
        &ScopedEventSyncEntry {
            destination,
            jin_id: event_id.clone(),
            recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
            google_event_id: Some(google_event_id.clone()),
            ical_uid: event.frontmatter.ical_uid.clone(),
            etag: Some(etag.clone()),
            google_updated: Some("2026-09-02T10:00:00Z".to_string()),
            last_synced_at: Some(now().to_rfc3339()),
        },
    )
    .unwrap();

    let mut center = NotificationCenter::open(&config.notification_center_path()).unwrap();
    let item = center
        .upsert_source(
            &NotificationSource {
                source_key: format!(
                    "google/{}/{}/{}/master",
                    target.account_id, target.calendar_id, google_event_id
                ),
                source_revision: etag.clone(),
                request_native_signal: true,
                new_response_cycle: false,
                payload: NotificationPayload::CalendarInvitation(Box::new(
                    CalendarInvitationPayload {
                        schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                        account_id: target.account_id.to_string(),
                        account_alias: "Personal".to_string(),
                        calendar_id: target.calendar_id.clone(),
                        calendar_name: "Personal".to_string(),
                        canonical_event_id: event_id.clone(),
                        google_event_id: google_event_id.clone(),
                        recurrence: InvitationRecurrenceIdentity::Single,
                        title: "Planning session".to_string(),
                        organizer_name: Some("Organizer".to_string()),
                        organizer_email: Some("organizer@example.com".to_string()),
                        start: "2099-09-03T10:00:00".to_string(),
                        end: "2099-09-03T11:00:00".to_string(),
                        all_day: false,
                        timezone: Some("UTC".to_string()),
                        location: Some("Room 1".to_string()),
                        self_email: "self@example.com".to_string(),
                        provider_response_status: response_status.to_string(),
                        etag: etag.clone(),
                        provider_subject: "subject-personal".to_string(),
                        auth_generation: account.auth_generation,
                        route_generation: calendar.route_generation,
                        capabilities: NotificationCapabilities {
                            can_respond: response_status == "needsAction"
                                && !organizer_self
                                && self_count == 1,
                            ..NotificationCapabilities::default()
                        },
                    },
                )),
            },
            now(),
        )
        .unwrap()
        .unwrap();
    Fixture {
        tmp,
        config,
        target,
        item_id: item.id,
        item_version: item.version,
        event_id,
        google_event_id,
        etag,
        self_email: "self@example.com".to_string(),
    }
}

mod event_mutation {
    use super::*;

    fn make_occurrence(fixture: &Fixture) -> String {
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.recurring_event_id = Some("google-master-1".to_string());
        event.frontmatter.master_id = Some("jin-master-1".to_string());
        event.frontmatter.original_start = Some(event.frontmatter.start.clone());
        let recurrence_key = format!(
            "{}@UTC",
            jin_core::model::event::render_temporal(
                event.frontmatter.original_start.as_ref().unwrap()
            )
        );
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &event).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        state::delete_scoped_entry(
            &sync,
            &destination,
            &fixture.event_id,
            MASTER_RECURRENCE_KEY,
        )
        .unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination,
                jin_id: fixture.event_id.clone(),
                recurrence_key: recurrence_key.clone(),
                google_event_id: Some(fixture.google_event_id.clone()),
                ical_uid: event.frontmatter.ical_uid.clone(),
                etag: Some(fixture.etag.clone()),
                google_updated: Some("2026-09-02T10:00:00Z".to_string()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();
        recurrence_key
    }

    #[test]
    fn invitation_response_mapping_is_closed() {
        assert_eq!(InvitationResponse::Allow.provider_status(), "accepted");
        assert_eq!(InvitationResponse::Maybe.provider_status(), "tentative");
        assert_eq!(InvitationResponse::Refuse.provider_status(), "declined");
    }

    #[test]
    fn rsvp_preserves_canonical_attendees_omitted() {
        for omitted in [None, Some(false), Some(true)] {
            let fixture = setup_invitation("needsAction", false, 1, omitted);
            let before = std::fs::read(
                jin_core::store::fs::find_event_path(
                    &fixture.config.events_dir(),
                    &fixture.event_id,
                )
                .unwrap(),
            )
            .unwrap();
            let mut center = fixture.center();
            center
                .respond_to_invitation(
                    fixture.tmp.path(),
                    &fixture.request("preserve-omitted", InvitationResponse::Allow),
                    now(),
                )
                .unwrap();
            let after = std::fs::read(
                jin_core::store::fs::find_event_path(
                    &fixture.config.events_dir(),
                    &fixture.event_id,
                )
                .unwrap(),
            )
            .unwrap();
            assert_eq!(before, after);
        }
    }

    #[test]
    fn rsvp_routes_exact_destination() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let mut center = fixture.center();
        center
            .respond_to_invitation(
                fixture.tmp.path(),
                &fixture.request("exact-route", InvitationResponse::Maybe),
                now(),
            )
            .unwrap();
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let operation = state::get_outbox_operation(&sync, "exact-route")
            .unwrap()
            .unwrap();
        assert_eq!(
            operation.destination.account_id,
            fixture.target.account_id.as_str()
        );
        assert_eq!(
            operation.destination.calendar_id,
            fixture.target.calendar_id
        );
        assert_eq!(operation.google_event_id.as_deref(), Some("google-event-1"));
        assert_eq!(operation.recurrence_key, MASTER_RECURRENCE_KEY);
        assert_eq!(operation.base_etag.as_deref(), Some("etag-1"));
    }

    #[test]
    fn rsvp_operation_is_idempotent() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let request = fixture.request("same-operation", InvitationResponse::Allow);
        let mut center = fixture.center();
        let first = center
            .respond_to_invitation(fixture.tmp.path(), &request, now())
            .unwrap();
        let second = center
            .respond_to_invitation(fixture.tmp.path(), &request, now())
            .unwrap();
        assert_eq!(first.id, second.id);
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert!(state::get_outbox_operation(&sync, "same-operation")
            .unwrap()
            .is_some());
    }

    #[test]
    fn rsvp_operation_replay_precedes_mutable_canonical_revalidation() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let request = fixture.request("stable-replay", InvitationResponse::Allow);
        let mut center = fixture.center();
        let first = center
            .respond_to_invitation(fixture.tmp.path(), &request, now())
            .unwrap();
        fixture.replace_canonical_response("etag-2", "declined");

        let replayed = center
            .respond_to_invitation(fixture.tmp.path(), &request, now())
            .unwrap();
        assert_eq!(replayed.id, first.id);
        assert_eq!(replayed.status, NotificationStatus::ActionPending);
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert_eq!(
            state::list_route_outbox(
                &sync,
                &SyncDestination::google(
                    fixture.target.account_id.as_str().to_string(),
                    fixture.target.calendar_id.clone(),
                ),
                "pending",
            )
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn rsvp_idempotency_conflict() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let mut center = fixture.center();
        center
            .respond_to_invitation(
                fixture.tmp.path(),
                &fixture.request("conflicting-operation", InvitationResponse::Allow),
                now(),
            )
            .unwrap();
        let error = center
            .respond_to_invitation(
                fixture.tmp.path(),
                &fixture.request("conflicting-operation", InvitationResponse::Refuse),
                now(),
            )
            .unwrap_err();
        assert_eq!(error.code, "idempotency_conflict");
    }

    #[test]
    fn unavailable_route_fails_before_mutation() {
        let mut fixture = setup_invitation("needsAction", false, 1, None);
        fixture
            .config
            .google_registry
            .account_mut(&fixture.target.account_id)
            .unwrap()
            .state = jin_core::google::account::GoogleAccountState::Disconnected;
        fixture.config.save().unwrap();
        let mut center = fixture.center();
        let error = center
            .respond_to_invitation(
                fixture.tmp.path(),
                &fixture.request("disconnected", InvitationResponse::Allow),
                now(),
            )
            .unwrap_err();
        assert_eq!(error.code, "reauth_required");
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Active
        );
        assert!(center.action_attempt("disconnected").unwrap().is_none());
    }

    #[test]
    fn rsvp_this_and_following_rejected() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let mut request = fixture.mutation_request("unsupported-scope", InvitationResponse::Allow);
        request.recurrence_scope = Some(RecurrenceMutationScope::ThisAndFollowing);
        let error = EventMutationService::new(fixture.tmp.path())
            .unwrap()
            .respond_to_invitation(request)
            .unwrap_err();
        assert!(error.to_string().contains("This and following"));
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert!(state::get_outbox_operation(&sync, "unsupported-scope")
            .unwrap()
            .is_none());
    }

    #[test]
    fn rsvp_this_occurrence_exact_identity() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let recurrence_key = make_occurrence(&fixture);
        let mut request = fixture.mutation_request("occurrence-rsvp", InvitationResponse::Maybe);
        request.recurrence_scope = Some(RecurrenceMutationScope::ThisOccurrence);
        request.expected_recurrence_key = recurrence_key.clone();

        let queued = EventMutationService::new(fixture.tmp.path())
            .unwrap()
            .respond_to_invitation(request)
            .unwrap();
        assert_eq!(queued.event_id, fixture.event_id);
        assert_eq!(queued.google_event_id, fixture.google_event_id);
        assert_eq!(queued.recurrence_key, recurrence_key);
    }
}

mod event_capabilities {
    use super::*;

    #[test]
    fn rsvp_does_not_unlock_general_edit() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let before = jin_core::ops::api::get_event_detail_capabilities(
            fixture.tmp.path(),
            &fixture.event_id,
        )
        .unwrap();
        fixture.queue("capability-rsvp", InvitationResponse::Allow);
        let after = jin_core::ops::api::get_event_detail_capabilities(
            fixture.tmp.path(),
            &fixture.event_id,
        )
        .unwrap();
        assert_eq!(before, after);
    }
}

mod invitation_saga {
    use super::*;

    #[test]
    fn pending_overlay_does_not_mutate_canonical() {
        let fixture = setup_invitation("needsAction", false, 1, Some(false));
        let mut center = fixture.center();
        let item = center
            .respond_to_invitation(
                fixture.tmp.path(),
                &fixture.request("pending-overlay", InvitationResponse::Maybe),
                now(),
            )
            .unwrap();
        assert_eq!(item.status, NotificationStatus::ActionPending);
        assert_eq!(item.requested_action, Some(NotificationAction::Maybe));
        let event = jin_core::store::fs::read_event(
            &jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap(),
        )
        .unwrap();
        let self_attendee = event
            .frontmatter
            .attendees
            .unwrap()
            .into_iter()
            .find(|attendee| attendee.is_self == Some(true))
            .unwrap();
        assert_eq!(
            self_attendee.response_status.as_deref(),
            Some("needsAction")
        );
        assert_eq!(event.frontmatter.attendees_omitted, Some(false));
    }

    #[test]
    fn recover_after_outbox_commit() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let intent = ActionAttemptIntent {
            operation_id: "outbox-crash".to_string(),
            item_id: fixture.item_id.clone(),
            expected_item_version: fixture.item_version,
            requested_action: NotificationAction::Allow,
            recurrence_scope: None,
            source_revision: fixture.etag.clone(),
            provider: Some("google".to_string()),
            account_id: Some(fixture.target.account_id.to_string()),
            calendar_id: Some(fixture.target.calendar_id.clone()),
            canonical_event_id: Some(fixture.event_id.clone()),
            google_event_id: Some(fixture.google_event_id.clone()),
            recurrence_key: Some(MASTER_RECURRENCE_KEY.to_string()),
            self_email: Some(fixture.self_email.clone()),
            provider_subject: Some("subject-personal".to_string()),
            auth_generation: Some(1),
            route_generation: Some(0),
            base_etag: Some(fixture.etag.clone()),
        };
        let mut center = fixture.center();
        center.prepare_action_attempt(&intent, now()).unwrap();
        EventMutationService::new(fixture.tmp.path())
            .unwrap()
            .respond_to_invitation(
                fixture.mutation_request("outbox-crash", InvitationResponse::Allow),
            )
            .unwrap();
        assert_eq!(
            center
                .action_attempt("outbox-crash")
                .unwrap()
                .unwrap()
                .state,
            jin_core::notification_center::ActionAttemptState::Preparing
        );
        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        assert_eq!(
            center
                .action_attempt("outbox-crash")
                .unwrap()
                .unwrap()
                .state,
            jin_core::notification_center::ActionAttemptState::Queued
        );
    }

    #[test]
    fn preparing_recovery_prioritizes_complete_outbox_and_converges_in_one_pass() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let intent = ActionAttemptIntent {
            operation_id: "preparing-complete-crash".to_string(),
            item_id: fixture.item_id.clone(),
            expected_item_version: fixture.item_version,
            requested_action: NotificationAction::Allow,
            recurrence_scope: None,
            source_revision: fixture.etag.clone(),
            provider: Some("google".to_string()),
            account_id: Some(fixture.target.account_id.to_string()),
            calendar_id: Some(fixture.target.calendar_id.clone()),
            canonical_event_id: Some(fixture.event_id.clone()),
            google_event_id: Some(fixture.google_event_id.clone()),
            recurrence_key: Some(MASTER_RECURRENCE_KEY.to_string()),
            self_email: Some(fixture.self_email.clone()),
            provider_subject: Some("subject-personal".to_string()),
            auth_generation: Some(1),
            route_generation: Some(0),
            base_etag: Some(fixture.etag.clone()),
        };
        let mut center = fixture.center();
        center.prepare_action_attempt(&intent, now()).unwrap();
        EventMutationService::new(fixture.tmp.path())
            .unwrap()
            .respond_to_invitation(
                fixture.mutation_request("preparing-complete-crash", InvitationResponse::Allow),
            )
            .unwrap();
        let imported = jin_core::model::event::Event {
            frontmatter: google_to_jin(
                &invitation_resource("google-event-1", "etag-2", "accepted", false, 1, None),
                &fixture.event_id,
                &fixture.target.calendar_id,
            )
            .unwrap(),
            body: String::new(),
        };
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &imported).unwrap();
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        state::complete_outbox_operation(&sync, &destination, "preparing-complete-crash").unwrap();

        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        assert_eq!(
            center
                .action_attempt("preparing-complete-crash")
                .unwrap()
                .unwrap()
                .state,
            jin_core::notification_center::ActionAttemptState::Succeeded
        );
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Acted
        );
    }

    #[test]
    fn preparing_recovery_prioritizes_paused_outbox_and_converges_in_one_pass() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let intent = ActionAttemptIntent {
            operation_id: "preparing-paused-crash".to_string(),
            item_id: fixture.item_id.clone(),
            expected_item_version: fixture.item_version,
            requested_action: NotificationAction::Refuse,
            recurrence_scope: None,
            source_revision: fixture.etag.clone(),
            provider: Some("google".to_string()),
            account_id: Some(fixture.target.account_id.to_string()),
            calendar_id: Some(fixture.target.calendar_id.clone()),
            canonical_event_id: Some(fixture.event_id.clone()),
            google_event_id: Some(fixture.google_event_id.clone()),
            recurrence_key: Some(MASTER_RECURRENCE_KEY.to_string()),
            self_email: Some(fixture.self_email.clone()),
            provider_subject: Some("subject-personal".to_string()),
            auth_generation: Some(1),
            route_generation: Some(0),
            base_etag: Some(fixture.etag.clone()),
        };
        let mut center = fixture.center();
        center.prepare_action_attempt(&intent, now()).unwrap();
        EventMutationService::new(fixture.tmp.path())
            .unwrap()
            .respond_to_invitation(
                fixture.mutation_request("preparing-paused-crash", InvitationResponse::Refuse),
            )
            .unwrap();
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        state::pause_outbox_operation(
            &sync,
            &destination,
            "preparing-paused-crash",
            "provider_http_503",
        )
        .unwrap();

        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        let attempt = center
            .action_attempt("preparing-paused-crash")
            .unwrap()
            .unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::FailedRetryable
        );
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Active
        );
    }

    #[test]
    fn recover_after_center_prepare() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let intent = ActionAttemptIntent {
            operation_id: "center-prepare-crash".to_string(),
            item_id: fixture.item_id.clone(),
            expected_item_version: fixture.item_version,
            requested_action: NotificationAction::Maybe,
            recurrence_scope: None,
            source_revision: fixture.etag.clone(),
            provider: Some("google".to_string()),
            account_id: Some(fixture.target.account_id.to_string()),
            calendar_id: Some(fixture.target.calendar_id.clone()),
            canonical_event_id: Some(fixture.event_id.clone()),
            google_event_id: Some(fixture.google_event_id.clone()),
            recurrence_key: Some(MASTER_RECURRENCE_KEY.to_string()),
            self_email: Some(fixture.self_email.clone()),
            provider_subject: Some("subject-personal".to_string()),
            auth_generation: Some(1),
            route_generation: Some(0),
            base_etag: Some(fixture.etag.clone()),
        };
        let mut center = fixture.center();
        center.prepare_action_attempt(&intent, now()).unwrap();

        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        let attempt = center
            .action_attempt("center-prepare-crash")
            .unwrap()
            .unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::Queued
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert!(state::get_outbox_operation(&sync, "center-prepare-crash")
            .unwrap()
            .is_some());
    }

    #[test]
    fn preparing_recovery_uses_immutable_attempt_when_item_payload_changes() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        let intent = ActionAttemptIntent {
            operation_id: "immutable-prepare-crash".to_string(),
            item_id: fixture.item_id.clone(),
            expected_item_version: item.version,
            requested_action: NotificationAction::Maybe,
            recurrence_scope: None,
            source_revision: fixture.etag.clone(),
            provider: Some("google".to_string()),
            account_id: Some(fixture.target.account_id.to_string()),
            calendar_id: Some(fixture.target.calendar_id.clone()),
            canonical_event_id: Some(fixture.event_id.clone()),
            google_event_id: Some(fixture.google_event_id.clone()),
            recurrence_key: Some(MASTER_RECURRENCE_KEY.to_string()),
            self_email: Some(fixture.self_email.clone()),
            provider_subject: Some("subject-personal".to_string()),
            auth_generation: Some(1),
            route_generation: Some(0),
            base_etag: Some(fixture.etag.clone()),
        };
        let mut center = fixture.center();
        center.prepare_action_attempt(&intent, now()).unwrap();
        let NotificationPayload::CalendarInvitation(mut changed) = item.payload else {
            panic!("expected invitation payload");
        };
        changed.account_id = "mutable-wrong-account".to_string();
        changed.calendar_id = "mutable-wrong-calendar".to_string();
        changed.canonical_event_id = "mutable-wrong-event".to_string();
        changed.google_event_id = "mutable-wrong-google-event".to_string();
        changed.self_email = "mutable-wrong@example.com".to_string();
        changed.etag = "mutable-wrong-etag".to_string();
        center
            .upsert_source(
                &NotificationSource {
                    source_key: item.source_key,
                    source_revision: "mutable-revision".to_string(),
                    payload: NotificationPayload::CalendarInvitation(changed),
                    request_native_signal: false,
                    new_response_cycle: false,
                },
                now() + chrono::Duration::minutes(1),
            )
            .unwrap();

        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let operation = state::get_outbox_operation(&sync, "immutable-prepare-crash")
            .unwrap()
            .unwrap();
        assert_eq!(operation.jin_id, fixture.event_id);
        assert_eq!(operation.google_event_id.as_deref(), Some("google-event-1"));
        assert_eq!(operation.base_etag.as_deref(), Some("etag-1"));
        assert_eq!(
            operation.destination.account_id,
            fixture.target.account_id.as_str()
        );
        assert_eq!(
            operation.destination.calendar_id,
            fixture.target.calendar_id
        );
    }

    #[test]
    fn recover_after_provider_success() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("provider-import-crash", InvitationResponse::Allow);
        let mut center = fixture.center();
        center
            .mark_attempt_sending("provider-import-crash", now())
            .unwrap();
        let imported = jin_core::model::event::Event {
            frontmatter: google_to_jin(
                &invitation_resource("google-event-1", "etag-2", "accepted", false, 1, None),
                &fixture.event_id,
                &fixture.target.calendar_id,
            )
            .unwrap(),
            body: String::new(),
        };
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &imported).unwrap();
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        state::complete_outbox_operation(&sync, &destination, "provider-import-crash").unwrap();

        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Acted
        );
    }

    #[test]
    fn complete_outbox_with_unconfirmed_canonical_state_converges_active_with_error() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("complete-mismatch", InvitationResponse::Allow);
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        state::complete_outbox_operation(&sync, &destination, "complete-mismatch").unwrap();

        let mut center = fixture.center();
        assert_eq!(
            center
                .recover_invitation_sagas(fixture.tmp.path(), now())
                .unwrap(),
            1
        );
        let attempt = center.action_attempt("complete-mismatch").unwrap().unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::FailedRetryable
        );
        let item = center.get_item(&fixture.item_id).unwrap();
        assert_eq!(item.status, NotificationStatus::Active);
        assert_eq!(
            item.action_error.as_ref().map(|error| error.code.as_str()),
            Some("provider_confirmation_mismatch")
        );
    }

    #[test]
    fn superseded_terminal_state_and_observed_response_commit_atomically() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("atomic-superseded", InvitationResponse::Allow);
        let db = fixture.config.notification_center_path();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER fail_item_terminal BEFORE UPDATE ON notification_items
             BEGIN SELECT RAISE(ABORT, 'crash-window'); END;",
        )
        .unwrap();
        drop(conn);

        let mut center = fixture.center();
        assert!(center
            .finish_attempt_superseded("atomic-superseded", "declined", now())
            .is_err());
        let attempt = center.action_attempt("atomic-superseded").unwrap().unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::Queued
        );
        assert_eq!(attempt.observed_response, None);

        drop(center);
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute("DROP TRIGGER fail_item_terminal", []).unwrap();
        drop(conn);
        let mut center = fixture.center();
        center
            .finish_attempt_superseded("atomic-superseded", "declined", now())
            .unwrap();
        let attempt = center.action_attempt("atomic-superseded").unwrap().unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::Superseded
        );
        assert_eq!(attempt.observed_response.as_deref(), Some("declined"));
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Superseded
        );
    }
}

mod google_delivery {
    use super::*;

    struct BlockingPatchHttp {
        entered: (std::sync::Mutex<bool>, std::sync::Condvar),
        release: (std::sync::Mutex<bool>, std::sync::Condvar),
        patches: std::sync::atomic::AtomicUsize,
        accepted: serde_json::Value,
    }

    impl BlockingPatchHttp {
        fn new(accepted: serde_json::Value) -> Self {
            Self {
                entered: (std::sync::Mutex::new(false), std::sync::Condvar::new()),
                release: (std::sync::Mutex::new(false), std::sync::Condvar::new()),
                patches: std::sync::atomic::AtomicUsize::new(0),
                accepted,
            }
        }

        fn wait_until_patch_started(&self) {
            let (lock, condition) = &self.entered;
            let (entered, _) = condition
                .wait_timeout_while(
                    lock.lock().unwrap(),
                    std::time::Duration::from_secs(5),
                    |entered| !*entered,
                )
                .unwrap();
            assert!(*entered, "first RSVP worker did not reach PATCH");
        }

        fn release_patch(&self) {
            let (lock, condition) = &self.release;
            *lock.lock().unwrap() = true;
            condition.notify_all();
        }
    }

    impl HttpClient for BlockingPatchHttp {
        fn get(&self, _: &str, _: &str) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Integrity("unexpected GET".to_string()))
        }

        fn post_json(
            &self,
            _: &str,
            _: &str,
            _: &serde_json::Value,
        ) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Integrity("unexpected POST".to_string()))
        }

        fn patch_json(
            &self,
            _: &str,
            _: &str,
            _: Option<&str>,
            _: &serde_json::Value,
        ) -> jin_core::Result<HttpResponse> {
            self.patches
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let (entered_lock, entered_condition) = &self.entered;
            *entered_lock.lock().unwrap() = true;
            entered_condition.notify_all();
            let (release_lock, release_condition) = &self.release;
            let mut released = release_lock.lock().unwrap();
            while !*released {
                released = release_condition.wait(released).unwrap();
            }
            Ok(response(200, self.accepted.clone()))
        }

        fn delete(&self, _: &str, _: &str, _: Option<&str>) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Integrity(
                "unexpected DELETE".to_string(),
            ))
        }

        fn post_form(&self, _: &str, _: &[(&str, &str)]) -> jin_core::Result<serde_json::Value> {
            Err(jin_core::JinError::Integrity(
                "unexpected form POST".to_string(),
            ))
        }
    }

    fn requested_body(status: &str) -> serde_json::Value {
        serde_json::json!({
            "attendees": [{
                "email": "self@example.com",
                "responseStatus": status
            }],
            "attendeesOmitted": true
        })
    }

    #[test]
    fn concurrent_drainers_atomically_claim_one_rsvp_patch() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("concurrent-claim", InvitationResponse::Allow);
        let http = std::sync::Arc::new(BlockingPatchHttp::new(invitation_resource(
            "google-event-1",
            "etag-2",
            "accepted",
            false,
            1,
            None,
        )));

        std::thread::scope(|scope| {
            let worker_http = std::sync::Arc::clone(&http);
            let worker_fixture = &fixture;
            let first = scope.spawn(move || worker_fixture.drain(worker_http.as_ref()));
            http.wait_until_patch_started();
            let second = fixture.drain(http.as_ref());
            http.release_patch();
            assert_eq!(first.join().unwrap().unwrap(), 1);
            assert!(second.is_err());
        });
        assert_eq!(http.patches.load(std::sync::atomic::Ordering::SeqCst), 1);
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert_eq!(
            state::get_outbox_operation(&sync, "concurrent-claim")
                .unwrap()
                .unwrap()
                .state,
            "complete"
        );
    }

    #[test]
    fn interrupted_sending_refetches_remote_acceptance_without_repatching() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("accepted-crash", InvitationResponse::Allow);
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        let claimed = state::claim_invitation_outbox(&sync, &destination, "accepted-crash")
            .unwrap()
            .unwrap();
        assert_eq!(claimed.state, "sending");
        let http = MockHttpClient::new(vec![response(
            200,
            invitation_resource("google-event-1", "etag-2", "accepted", false, 1, None),
        )]);

        assert_eq!(fixture.drain(&http).unwrap(), 1);
        assert!(http.requested_patches().is_empty());
        assert_eq!(http.requested_urls().len(), 1);
        assert_eq!(
            state::get_outbox_operation(&sync, "accepted-crash")
                .unwrap()
                .unwrap()
                .state,
            "complete"
        );
        assert_eq!(
            fixture
                .center()
                .action_attempt("accepted-crash")
                .unwrap()
                .unwrap()
                .state,
            jin_core::notification_center::ActionAttemptState::Succeeded
        );
    }

    #[test]
    fn deleted_canonical_invitation_obsoletes_item_attempt_and_outbox() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deleted-canonical", InvitationResponse::Refuse);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        std::fs::remove_file(path).unwrap();

        assert_eq!(fixture.drain(&MockHttpClient::new(vec![])).unwrap(), 0);
        let center = fixture.center();
        assert_eq!(
            center.get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Obsolete
        );
        assert_eq!(
            center
                .action_attempt("deleted-canonical")
                .unwrap()
                .unwrap()
                .state,
            jin_core::notification_center::ActionAttemptState::Obsolete
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert_eq!(
            state::get_outbox_operation(&sync, "deleted-canonical")
                .unwrap()
                .unwrap()
                .state,
            "obsolete"
        );
    }

    #[test]
    fn success_uses_narrow_patch_if_match_and_no_updates() {
        let fixture = setup_invitation("needsAction", false, 1, Some(false));
        fixture.queue("deliver-success", InvitationResponse::Allow);
        let http = MockHttpClient::new(vec![response(
            200,
            invitation_resource(
                "google-event-1",
                "etag-2",
                "accepted",
                false,
                1,
                Some(false),
            ),
        )]);

        assert_eq!(fixture.drain(&http).unwrap(), 1);
        let patches = http.requested_patches();
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].if_match_etag.as_deref(), Some("etag-1"));
        assert_eq!(patches[0].body, requested_body("accepted"));
        assert!(patches[0]
            .url
            .ends_with("/events/google-event-1?sendUpdates=none"));
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(item.status, NotificationStatus::Acted);
        let canonical = jin_core::store::fs::read_event(
            &jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap(),
        )
        .unwrap();
        let self_attendee = canonical
            .frontmatter
            .attendees
            .unwrap()
            .into_iter()
            .find(|attendee| attendee.is_self == Some(true))
            .unwrap();
        assert_eq!(self_attendee.response_status.as_deref(), Some("accepted"));
    }

    #[test]
    fn rsvp_412_already_applied_is_success() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-refetched", InvitationResponse::Maybe);
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "tentative", false, 1, None),
            ),
        ]);

        assert_eq!(fixture.drain(&http).unwrap(), 1);
        assert_eq!(http.requested_patches().len(), 1);
        assert_eq!(
            fixture.center().get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Acted
        );
    }

    #[test]
    fn rsvp_412_retries_once_with_new_etag() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-retry", InvitationResponse::Refuse);
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
            ),
            response(
                200,
                invitation_resource("google-event-1", "etag-3", "declined", false, 1, None),
            ),
        ]);

        assert_eq!(fixture.drain(&http).unwrap(), 1);
        let patches = http.requested_patches();
        assert_eq!(patches.len(), 2);
        assert_eq!(patches[0].if_match_etag.as_deref(), Some("etag-1"));
        assert_eq!(patches[1].if_match_etag.as_deref(), Some("etag-2"));
        assert_eq!(patches[1].body, requested_body("declined"));
    }

    #[test]
    fn rsvp_retry_auth_failures_disable_controls_as_nonretryable() {
        for status in [401, 403] {
            let fixture = setup_invitation("needsAction", false, 1, None);
            fixture.queue(&format!("retry-auth-{status}"), InvitationResponse::Allow);
            let http = MockHttpClient::new(vec![
                response(412, serde_json::json!({})),
                response(
                    200,
                    invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
                ),
                response(status, serde_json::json!({})),
            ]);

            assert_eq!(fixture.drain(&http).unwrap(), 0);
            let item = fixture.center().get_item(&fixture.item_id).unwrap();
            assert_eq!(item.status, NotificationStatus::Active);
            assert_eq!(
                item.action_error.as_ref().map(|error| error.retryable),
                Some(false)
            );
            let NotificationPayload::CalendarInvitation(payload) = item.payload else {
                panic!("expected invitation payload");
            };
            assert!(!payload.capabilities.can_respond);
        }
    }

    #[test]
    fn rsvp_retry_missing_event_becomes_obsolete() {
        for status in [404, 410] {
            let fixture = setup_invitation("needsAction", false, 1, None);
            fixture.queue(
                &format!("retry-missing-{status}"),
                InvitationResponse::Allow,
            );
            let http = MockHttpClient::new(vec![
                response(412, serde_json::json!({})),
                response(
                    200,
                    invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
                ),
                response(status, serde_json::json!({})),
            ]);

            assert_eq!(fixture.drain(&http).unwrap(), 0);
            assert_eq!(
                fixture.center().get_item(&fixture.item_id).unwrap().status,
                NotificationStatus::Obsolete
            );
        }
    }

    #[test]
    fn rsvp_retry_cancelled_event_becomes_obsolete() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("retry-cancelled", InvitationResponse::Allow);
        let mut cancelled =
            invitation_resource("google-event-1", "etag-3", "needsAction", false, 1, None);
        cancelled["status"] = serde_json::json!("cancelled");
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
            ),
            response(200, cancelled),
        ]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        assert_eq!(
            fixture.center().get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Obsolete
        );
    }

    #[test]
    fn rsvp_second_412_preserves_choice() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-second-412", InvitationResponse::Allow);
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
            ),
            response(412, serde_json::json!({})),
        ]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        assert_eq!(http.requested_patches().len(), 2);
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(item.status, NotificationStatus::Active);
        assert_eq!(item.requested_action, Some(NotificationAction::Allow));
        assert_eq!(
            item.action_error.as_ref().map(|error| error.code.as_str()),
            Some("provider_failed")
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let operation = state::get_outbox_operation(&sync, "deliver-second-412")
            .unwrap()
            .unwrap();
        assert_eq!(operation.state, "paused");
        assert_eq!(operation.pause_reason.as_deref(), Some("rsvp_second_412"));
    }

    #[test]
    fn retry_rsvp_requires_retryable_failure_and_uses_new_operation_id() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("retryable-original", InvitationResponse::Maybe);
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "needsAction", false, 1, None),
            ),
            response(412, serde_json::json!({})),
        ]);
        assert_eq!(fixture.drain(&http).unwrap(), 0);
        let failed = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(
            failed.action_error.as_ref().map(|error| error.retryable),
            Some(true)
        );

        let retried = fixture
            .center()
            .retry_invitation(
                fixture.tmp.path(),
                &RetryInvitationRequest {
                    item_id: failed.id,
                    expected_item_version: failed.version,
                    operation_id: "retryable-new".to_string(),
                },
                now(),
            )
            .unwrap();
        assert_eq!(retried.status, NotificationStatus::ActionPending);
        assert_eq!(retried.requested_action, Some(NotificationAction::Maybe));
        let attempt = fixture
            .center()
            .action_attempt("retryable-new")
            .unwrap()
            .unwrap();
        assert_eq!(attempt.requested_action, NotificationAction::Maybe);
    }

    #[test]
    fn conflicting_external_response_supersedes() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-superseded", InvitationResponse::Allow);
        let http = MockHttpClient::new(vec![
            response(412, serde_json::json!({})),
            response(
                200,
                invitation_resource("google-event-1", "etag-2", "declined", false, 1, None),
            ),
        ]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(item.status, NotificationStatus::Superseded);
        assert_eq!(item.requested_action, Some(NotificationAction::Allow));
        let attempt = fixture
            .center()
            .action_attempt("deliver-superseded")
            .unwrap()
            .unwrap();
        assert_eq!(attempt.observed_response.as_deref(), Some("declined"));
    }

    struct OfflineHttp;

    impl HttpClient for OfflineHttp {
        fn get(&self, _: &str, _: &str) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Offline("offline cassette".to_string()))
        }

        fn post_json(
            &self,
            _: &str,
            _: &str,
            _: &serde_json::Value,
        ) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Offline("offline cassette".to_string()))
        }

        fn patch_json(
            &self,
            _: &str,
            _: &str,
            _: Option<&str>,
            _: &serde_json::Value,
        ) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Offline("offline cassette".to_string()))
        }

        fn delete(&self, _: &str, _: &str, _: Option<&str>) -> jin_core::Result<HttpResponse> {
            Err(jin_core::JinError::Offline("offline cassette".to_string()))
        }

        fn post_form(&self, _: &str, _: &[(&str, &str)]) -> jin_core::Result<serde_json::Value> {
            Err(jin_core::JinError::Offline("offline cassette".to_string()))
        }
    }

    #[test]
    fn offline_rsvp_remains_queued() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-offline", InvitationResponse::Allow);

        assert!(matches!(
            fixture.drain(&OfflineHttp),
            Err(jin_core::JinError::Offline(_))
        ));
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(item.status, NotificationStatus::ActionPending);
        assert_eq!(item.requested_action, Some(NotificationAction::Allow));
        let attempt = fixture
            .center()
            .action_attempt("deliver-offline")
            .unwrap()
            .unwrap();
        assert_eq!(
            attempt.state,
            jin_core::notification_center::ActionAttemptState::Queued
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        assert_eq!(
            state::get_outbox_operation(&sync, "deliver-offline")
                .unwrap()
                .unwrap()
                .state,
            "pending"
        );
    }

    #[test]
    fn credential_or_route_rotation_blocks_send() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-old-generation", InvitationResponse::Allow);
        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config
            .google_registry
            .account_mut(&fixture.target.account_id)
            .unwrap()
            .auth_generation += 1;
        config.save().unwrap();
        let http = MockHttpClient::new(vec![]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        assert!(http.requested_urls().is_empty());
        let item = fixture.center().get_item(&fixture.item_id).unwrap();
        let NotificationPayload::CalendarInvitation(payload) = item.payload else {
            panic!("expected invitation payload");
        };
        assert!(!payload.capabilities.can_respond);
        assert_eq!(item.status, NotificationStatus::Active);
    }

    #[test]
    fn cancelled_canonical_invitation_becomes_obsolete_without_network() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-cancelled", InvitationResponse::Allow);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.status = jin_core::model::event::EventStatus::Cancelled;
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &event).unwrap();
        let http = MockHttpClient::new(vec![]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        assert!(http.requested_urls().is_empty());
        assert_eq!(
            fixture.center().get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Obsolete
        );
    }

    #[test]
    fn ended_canonical_invitation_becomes_obsolete_without_network() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("deliver-ended", InvitationResponse::Allow);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.end = jin_core::model::event::TemporalValue::DateTime(
            DateTime::parse_from_rfc3339("2020-01-01T01:00:00Z")
                .unwrap()
                .naive_utc(),
        );
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &event).unwrap();
        let http = MockHttpClient::new(vec![]);

        assert_eq!(fixture.drain(&http).unwrap(), 0);
        assert!(http.requested_urls().is_empty());
        assert_eq!(
            fixture.center().get_item(&fixture.item_id).unwrap().status,
            NotificationStatus::Obsolete
        );
    }
}

mod invitation_reconcile {
    use super::*;

    #[test]
    fn same_etag_reconcile_refreshes_disconnect_reconnect_role_and_generations() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let initial = fixture.center().get_item(&fixture.item_id).unwrap();

        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config
            .google_registry
            .account_mut(&fixture.target.account_id)
            .unwrap()
            .state = GoogleAccountState::Disconnected;
        config.save().unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let disconnected = fixture.center().get_item(&fixture.item_id).unwrap();
        let NotificationPayload::CalendarInvitation(payload) = &disconnected.payload else {
            panic!("expected invitation");
        };
        assert!(!payload.capabilities.can_respond);
        assert_eq!(disconnected.version, initial.version + 1);

        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config
            .google_registry
            .account_mut(&fixture.target.account_id)
            .unwrap()
            .state = GoogleAccountState::Connected;
        config.save().unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        let reconnected = fixture.center().get_item(&fixture.item_id).unwrap();
        let NotificationPayload::CalendarInvitation(payload) = &reconnected.payload else {
            panic!("expected invitation");
        };
        assert!(payload.capabilities.can_respond);
        assert_eq!(reconnected.version, disconnected.version + 1);

        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        let calendar = config
            .google_registry
            .calendars
            .iter_mut()
            .find(|calendar| {
                calendar.account_id == fixture.target.account_id
                    && calendar.calendar_id == fixture.target.calendar_id
            })
            .unwrap();
        calendar.access_role = GoogleAccessRole::Reader;
        config.save().unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(2),
        )
        .unwrap();
        let reader = fixture.center().get_item(&fixture.item_id).unwrap();
        let NotificationPayload::CalendarInvitation(payload) = &reader.payload else {
            panic!("expected invitation");
        };
        assert!(!payload.capabilities.can_respond);
        assert_eq!(reader.version, reconnected.version + 1);

        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config
            .google_registry
            .account_mut(&fixture.target.account_id)
            .unwrap()
            .auth_generation += 1;
        config.save().unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(3),
        )
        .unwrap();
        let auth_changed = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(auth_changed.version, reader.version + 1);

        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config
            .google_registry
            .calendars
            .iter_mut()
            .find(|calendar| {
                calendar.account_id == fixture.target.account_id
                    && calendar.calendar_id == fixture.target.calendar_id
            })
            .unwrap()
            .route_generation += 1;
        config.save().unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(4),
        )
        .unwrap();
        let route_changed = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(route_changed.version, auth_changed.version + 1);
        let NotificationPayload::CalendarInvitation(payload) = route_changed.payload else {
            panic!("expected invitation");
        };
        assert_eq!(payload.auth_generation, 2);
        assert_eq!(payload.route_generation, 1);
    }

    fn reset_center(fixture: &Fixture) {
        let path = fixture.config.notification_center_path();
        if path.exists() {
            std::fs::remove_file(path).unwrap();
        }
    }

    fn all_items(fixture: &Fixture) -> Vec<jin_core::notification_center::NotificationItem> {
        let mut center = fixture.center();
        let mut items = center
            .list(
                &NotificationListRequest {
                    filter: NotificationFilter::All,
                    include_deferred: true,
                    include_terminal: true,
                    cursor: None,
                    limit: Some(100),
                },
                now(),
            )
            .unwrap()
            .items;
        items.extend(
            center
                .list(
                    &NotificationListRequest {
                        filter: NotificationFilter::History,
                        include_deferred: true,
                        include_terminal: true,
                        cursor: None,
                        limit: Some(100),
                    },
                    now(),
                )
                .unwrap()
                .items,
        );
        items
    }

    fn write_event(fixture: &Fixture, event: &jin_core::model::event::Event) {
        jin_core::store::fs::write_event(&fixture.config.events_dir(), event).unwrap();
    }

    #[test]
    fn eligible_event_creates_item() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert_eq!(report.errors, vec![]);
        assert_eq!(report.upserted, 1);
        let items = all_items(&fixture);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].status, NotificationStatus::Active);
        let NotificationPayload::CalendarInvitation(payload) = &items[0].payload else {
            panic!("expected invitation payload");
        };
        assert!(payload.capabilities.can_respond);
        assert_eq!(payload.self_email, "self@example.com");
    }

    #[test]
    fn legacy_google_event_without_invitation_signals_is_ignored() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.attendees = None;
        event.frontmatter.attendees_omitted = None;
        let organizer = event.frontmatter.organizer.as_mut().unwrap();
        organizer.email = Some("self@example.com".to_string());
        organizer.is_self = None;
        write_event(&fixture, &event);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();

        assert!(report.errors.is_empty());
        assert!(all_items(&fixture).is_empty());
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
    }

    #[test]
    fn route_confirmed_external_organizer_without_attendees_fails_closed() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.attendees = None;
        event.frontmatter.attendees_omitted = None;
        event.frontmatter.organizer.as_mut().unwrap().is_self = None;
        write_event(&fixture, &event);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();

        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "self_attendee_missing"));
        assert!(all_items(&fixture).is_empty());
    }

    #[test]
    fn attendees_omitted_without_self_identity_fails_closed() {
        let fixture = setup_invitation("needsAction", false, 1, Some(true));
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.attendees = None;
        event.frontmatter.organizer = None;
        write_event(&fixture, &event);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();

        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "self_attendee_missing"));
        assert!(all_items(&fixture).is_empty());
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );
    }

    #[test]
    fn attendees_omitted_with_exact_self_identity_remains_actionable() {
        let fixture = setup_invitation("needsAction", false, 1, Some(true));
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();

        assert!(report.errors.is_empty());
        let items = all_items(&fixture);
        assert_eq!(items.len(), 1);
        let NotificationPayload::CalendarInvitation(payload) = &items[0].payload else {
            panic!("expected invitation payload");
        };
        assert!(payload.capabilities.can_respond);
        assert_eq!(payload.self_email, "self@example.com");
    }

    #[test]
    fn stale_invitation_error_is_cleared_when_source_becomes_an_ordinary_event() {
        let fixture = setup_invitation("needsAction", false, 0, None);
        reset_center(&fixture);
        let first = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(first
            .errors
            .iter()
            .any(|error| error.code == "self_attendee_missing"));
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );

        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event.frontmatter.attendees = None;
        event.frontmatter.attendees_omitted = None;
        let organizer = event.frontmatter.organizer.as_mut().unwrap();
        organizer.email = Some("self@example.com".to_string());
        organizer.is_self = None;
        write_event(&fixture, &event);

        let second = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert!(second.errors.is_empty());
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
        assert!(all_items(&fixture).is_empty());
    }

    #[test]
    fn bootstrap_skips_ended_cancelled_and_already_answered_invitations() {
        let answered = setup_invitation("accepted", false, 1, None);
        reset_center(&answered);
        jin_core::notification_center::reconcile_calendar_invitations(answered.tmp.path(), now())
            .unwrap();
        assert!(all_items(&answered).is_empty());

        let cancelled = setup_invitation("needsAction", false, 1, None);
        let cancelled_path = jin_core::store::fs::find_event_path(
            &cancelled.config.events_dir(),
            &cancelled.event_id,
        )
        .unwrap();
        let mut cancelled_event = jin_core::store::fs::read_event(&cancelled_path).unwrap();
        cancelled_event.frontmatter.status = jin_core::model::event::EventStatus::Cancelled;
        write_event(&cancelled, &cancelled_event);
        reset_center(&cancelled);
        jin_core::notification_center::reconcile_calendar_invitations(cancelled.tmp.path(), now())
            .unwrap();
        assert!(all_items(&cancelled).is_empty());

        let ended = setup_invitation("needsAction", false, 1, None);
        let ended_path =
            jin_core::store::fs::find_event_path(&ended.config.events_dir(), &ended.event_id)
                .unwrap();
        let mut ended_event = jin_core::store::fs::read_event(&ended_path).unwrap();
        ended_event.frontmatter.end = jin_core::model::event::TemporalValue::DateTime(
            DateTime::parse_from_rfc3339("2020-01-01T01:00:00Z")
                .unwrap()
                .naive_utc(),
        );
        write_event(&ended, &ended_event);
        reset_center(&ended);
        jin_core::notification_center::reconcile_calendar_invitations(ended.tmp.path(), now())
            .unwrap();
        assert!(all_items(&ended).is_empty());
    }

    #[test]
    fn organizer_owned_is_rejected() {
        let fixture = setup_invitation("needsAction", true, 1, None);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "organizer_owned"));
        assert!(all_items(&fixture).is_empty());
    }

    #[test]
    fn missing_self_is_rejected() {
        let fixture = setup_invitation("needsAction", false, 0, None);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "self_attendee_missing"));
        assert!(all_items(&fixture).is_empty());
    }

    #[test]
    fn ambiguous_self_is_rejected() {
        let fixture = setup_invitation("needsAction", false, 2, None);
        reset_center(&fixture);

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "self_attendee_ambiguous"));
        assert!(all_items(&fixture).is_empty());
    }

    #[test]
    fn canonical_projection_owns_eligibility() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        let index_path = fixture.config.index_path();
        if index_path.exists() {
            std::fs::remove_file(index_path).unwrap();
        }

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let items = all_items(&fixture);
        let NotificationPayload::CalendarInvitation(payload) = &items[0].payload else {
            panic!("expected invitation payload");
        };
        assert!(payload.capabilities.can_respond);
    }

    #[test]
    fn multi_account_identity_isolated() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        let account_id = config.google_registry.add_pending_account("Work").unwrap();
        config
            .google_registry
            .account_mut(&account_id)
            .unwrap()
            .bind_subject(
                GOOGLE_ISSUER,
                "subject-work",
                Some("self@example.com".to_string()),
            )
            .unwrap();
        config
            .google_registry
            .reconcile_calendars(
                &account_id,
                vec![DiscoveredCalendar {
                    calendar_id: fixture.target.calendar_id.clone(),
                    name: "Work".to_string(),
                    primary: true,
                    access_role: GoogleAccessRole::Writer,
                }],
            )
            .unwrap();
        config.save().unwrap();
        let target =
            EventSyncTarget::new(account_id.clone(), fixture.target.calendar_id.clone()).unwrap();
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut second = jin_core::store::fs::read_event(&path).unwrap();
        second.frontmatter.id = "jin-event-2".to_string();
        write_event(&fixture, &second);
        jin_core::google::route_ownership::write(
            &fixture.config.events_dir(),
            second.id(),
            &target,
        )
        .unwrap();
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        let account = config.google_registry.account(&account_id).unwrap();
        let calendar = config
            .google_registry
            .calendars
            .iter()
            .find(|calendar| calendar.account_id == account_id)
            .unwrap();
        let destination =
            SyncDestination::google(account_id.as_str().to_string(), target.calendar_id.clone());
        state::ensure_destination(
            &sync,
            &destination,
            account.auth_generation,
            calendar.route_generation,
        )
        .unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination,
                jin_id: second.id().to_string(),
                recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                google_event_id: Some(fixture.google_event_id.clone()),
                ical_uid: second.frontmatter.ical_uid.clone(),
                etag: Some(fixture.etag.clone()),
                google_updated: Some("2026-09-02T10:00:00Z".to_string()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();
        reset_center(&fixture);

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let items = all_items(&fixture);
        assert_eq!(items.len(), 2);
        assert_ne!(items[0].source_key, items[1].source_key);
        assert!(items
            .iter()
            .any(|item| item.source_key.contains(fixture.target.account_id.as_str())));
        assert!(items
            .iter()
            .any(|item| item.source_key.contains(account_id.as_str())));
    }

    #[test]
    fn recurring_master_deduplicates_instances() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut master = jin_core::store::fs::read_event(&path).unwrap();
        master.frontmatter.recurrence = vec!["RRULE:FREQ=WEEKLY".to_string()];
        write_event(&fixture, &master);
        let mut generated = master.clone();
        generated.frontmatter.id = "generated-instance".to_string();
        generated.frontmatter.recurrence.clear();
        generated.frontmatter.recurring_event_id = Some(fixture.google_event_id.clone());
        generated.frontmatter.master_id = Some(fixture.event_id.clone());
        generated.frontmatter.original_start = Some(generated.frontmatter.start.clone());
        write_event(&fixture, &generated);
        jin_core::google::route_ownership::write(
            &fixture.config.events_dir(),
            generated.id(),
            &fixture.target,
        )
        .unwrap();
        reset_center(&fixture);

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let items = all_items(&fixture);
        assert_eq!(items.len(), 1);
        let NotificationPayload::CalendarInvitation(payload) = &items[0].payload else {
            panic!("expected invitation payload");
        };
        assert!(matches!(
            payload.recurrence,
            InvitationRecurrenceIdentity::SeriesMaster { .. }
        ));
    }

    #[test]
    fn detached_exception_is_independent() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut master = jin_core::store::fs::read_event(&path).unwrap();
        master.frontmatter.recurrence = vec!["RRULE:FREQ=WEEKLY".to_string()];
        write_event(&fixture, &master);
        let mut detached = master.clone();
        detached.frontmatter.id = "detached-instance".to_string();
        detached.frontmatter.recurrence.clear();
        detached.frontmatter.recurring_event_id = Some(fixture.google_event_id.clone());
        detached.frontmatter.master_id = Some(fixture.event_id.clone());
        detached.frontmatter.original_start = Some(detached.frontmatter.start.clone());
        write_event(&fixture, &detached);
        jin_core::google::route_ownership::write(
            &fixture.config.events_dir(),
            detached.id(),
            &fixture.target,
        )
        .unwrap();
        let recurrence_key = format!(
            "{}@UTC",
            jin_core::model::event::render_temporal(
                detached.frontmatter.original_start.as_ref().unwrap()
            )
        );
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination,
                jin_id: detached.id().to_string(),
                recurrence_key,
                google_event_id: Some("google-detached".to_string()),
                ical_uid: detached.frontmatter.ical_uid.clone(),
                etag: Some("etag-detached".to_string()),
                google_updated: Some("2026-09-02T10:00:00Z".to_string()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();
        reset_center(&fixture);

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let items = all_items(&fixture);
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| matches!(
            &item.payload,
            NotificationPayload::CalendarInvitation(payload)
                if matches!(payload.recurrence, InvitationRecurrenceIdentity::Instance { .. })
        )));
    }

    #[test]
    fn external_answer_resolves_item() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut event = jin_core::store::fs::read_event(&path).unwrap();
        event
            .frontmatter
            .attendees
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|attendee| attendee.is_self == Some(true))
            .unwrap()
            .response_status = Some("accepted".to_string());
        write_event(&fixture, &event);
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination,
                jin_id: fixture.event_id.clone(),
                recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                google_event_id: Some(fixture.google_event_id.clone()),
                ical_uid: event.frontmatter.ical_uid.clone(),
                etag: Some("etag-2".to_string()),
                google_updated: Some("2026-09-03T10:00:00Z".to_string()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let item = all_items(&fixture).pop().unwrap();
        assert_eq!(item.status, NotificationStatus::Acted);
        assert_eq!(
            item.resolution_origin,
            Some(jin_core::notification_center::ResolutionOrigin::External)
        );
    }

    #[test]
    fn reconciliation_records_answered_tombstone_before_a_new_needs_action_cycle() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let old = DateTime::parse_from_rfc3339("2026-07-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut center = fixture.center();
        let item = center.get_item(&fixture.item_id).unwrap();
        center.dismiss_item(&item.id, item.version, old).unwrap();
        assert_eq!(center.prune(now()).unwrap(), 1);
        drop(center);

        fixture.replace_canonical_response("etag-2", "accepted");
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        assert!(all_items(&fixture).is_empty());

        fixture.replace_canonical_response("etag-3", "needsAction");
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        let recreated = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(recreated.status, NotificationStatus::Active);
    }

    #[test]
    fn repeated_reconciliation_preserves_superseded_response_and_terminal_state() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        fixture.queue("reconcile-superseded", InvitationResponse::Allow);
        fixture.replace_canonical_response("etag-2", "declined");

        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let first = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(first.status, NotificationStatus::Superseded);
        let attempt = fixture
            .center()
            .action_attempt("reconcile-superseded")
            .unwrap()
            .unwrap();
        assert_eq!(attempt.observed_response.as_deref(), Some("declined"));

        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        let second = fixture.center().get_item(&fixture.item_id).unwrap();
        assert_eq!(second.status, NotificationStatus::Superseded);
        assert_eq!(second.version, first.version);
        let attempt = fixture
            .center()
            .action_attempt("reconcile-superseded")
            .unwrap()
            .unwrap();
        assert_eq!(attempt.observed_response.as_deref(), Some("declined"));
    }

    #[test]
    fn partial_scan_failure_isolated() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        std::fs::write(
            fixture.config.events_dir().join("broken-event.md"),
            b"not valid frontmatter",
        )
        .unwrap();

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert_eq!(all_items(&fixture).len(), 1);
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "canonical_event_invalid"));
    }

    #[test]
    fn malformed_source_does_not_block_healthy_stale_source_obsoletion() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        let current = all_items(&fixture).pop().unwrap();
        let NotificationPayload::CalendarInvitation(mut stale_payload) = current.payload else {
            panic!("expected invitation payload");
        };
        stale_payload.canonical_event_id = "healthy-stale-event".to_string();
        stale_payload.google_event_id = "healthy-stale-google-event".to_string();
        stale_payload.etag = "healthy-stale-etag".to_string();
        let stale_key = format!(
            "google/{}/{}/healthy-stale-google-event/master",
            fixture.target.account_id, fixture.target.calendar_id
        );
        fixture
            .center()
            .upsert_source(
                &NotificationSource {
                    source_key: stale_key.clone(),
                    source_revision: "healthy-stale-etag".to_string(),
                    payload: NotificationPayload::CalendarInvitation(stale_payload),
                    request_native_signal: false,
                    new_response_cycle: false,
                },
                now(),
            )
            .unwrap();
        std::fs::write(
            fixture.config.events_dir().join("malformed-unrelated.md"),
            b"not valid frontmatter",
        )
        .unwrap();

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "canonical_event_invalid"));
        let stale = all_items(&fixture)
            .into_iter()
            .find(|item| item.source_key == stale_key)
            .unwrap();
        assert_eq!(stale.status, NotificationStatus::Obsolete);
        assert_eq!(stale.source_reason.as_deref(), Some("source_missing"));
    }

    #[test]
    fn repaired_ordinary_generated_recurrence_clears_its_malformed_source_error() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        let event_path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut repaired = jin_core::store::fs::read_event(&event_path).unwrap();
        std::fs::write(&event_path, b"not valid frontmatter").unwrap();

        let first = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(first
            .errors
            .iter()
            .any(|error| error.code == "canonical_event_invalid"));
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );

        repaired.frontmatter.attendees = None;
        repaired.frontmatter.attendees_omitted = None;
        let organizer = repaired.frontmatter.organizer.as_mut().unwrap();
        organizer.email = Some("self@example.com".to_string());
        organizer.is_self = None;
        repaired.frontmatter.recurring_event_id = Some("google-master".to_string());
        repaired.frontmatter.master_id = Some("jin-master".to_string());
        repaired.frontmatter.original_start = Some(repaired.frontmatter.start.clone());
        write_event(&fixture, &repaired);

        let second = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert!(second.errors.is_empty());
        assert!(all_items(&fixture).is_empty());
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
    }

    #[test]
    fn parseable_recurrence_failures_are_isolated_before_a_healthy_later_source() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        let healthy_path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let healthy = jin_core::store::fs::read_event(&healthy_path).unwrap();
        let destination = SyncDestination::google(
            fixture.target.account_id.as_str().to_string(),
            fixture.target.calendar_id.clone(),
        );
        let sync = state::open_sync_db(&fixture.config.sync_dir()).unwrap();

        let mut malformed_identity = healthy.clone();
        malformed_identity.frontmatter.id = "aaa-malformed-identity".to_string();
        malformed_identity.frontmatter.recurring_event_id = Some("google-master".to_string());
        malformed_identity.frontmatter.original_start = None;
        write_event(&fixture, &malformed_identity);
        jin_core::google::route_ownership::write(
            &fixture.config.events_dir(),
            malformed_identity.id(),
            &fixture.target,
        )
        .unwrap();
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination: destination.clone(),
                jin_id: malformed_identity.id().to_string(),
                recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                google_event_id: Some("google-malformed-identity".to_string()),
                ical_uid: malformed_identity.frontmatter.ical_uid.clone(),
                etag: Some("etag-malformed-identity".to_string()),
                google_updated: Some(now().to_rfc3339()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();

        let mut malformed_master_route = healthy.clone();
        malformed_master_route.frontmatter.id = "aab-malformed-master-route".to_string();
        malformed_master_route.frontmatter.recurring_event_id = Some("google-master".to_string());
        malformed_master_route.frontmatter.master_id = Some("broken-master".to_string());
        malformed_master_route.frontmatter.original_start =
            Some(malformed_master_route.frontmatter.start.clone());
        write_event(&fixture, &malformed_master_route);
        jin_core::google::route_ownership::write(
            &fixture.config.events_dir(),
            malformed_master_route.id(),
            &fixture.target,
        )
        .unwrap();
        let recurrence_key = format!(
            "{}@UTC",
            jin_core::model::event::render_temporal(
                malformed_master_route
                    .frontmatter
                    .original_start
                    .as_ref()
                    .unwrap()
            )
        );
        state::upsert_scoped_entry(
            &sync,
            &ScopedEventSyncEntry {
                destination,
                jin_id: malformed_master_route.id().to_string(),
                recurrence_key,
                google_event_id: Some("google-malformed-route".to_string()),
                ical_uid: malformed_master_route.frontmatter.ical_uid.clone(),
                etag: Some("etag-malformed-route".to_string()),
                google_updated: Some(now().to_rfc3339()),
                last_synced_at: Some(now().to_rfc3339()),
            },
        )
        .unwrap();
        std::fs::write(
            fixture.config.events_dir().join("broken-master.route.json"),
            b"{invalid route",
        )
        .unwrap();

        let report = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "recurrence_identity_invalid"));
        assert!(report
            .errors
            .iter()
            .any(|error| error.code == "recurrence_master_route_invalid"));
        assert!(all_items(&fixture)
            .iter()
            .any(|item| item.source_key.contains(&fixture.google_event_id)));
    }

    #[test]
    fn canonical_partial_error_clears_after_source_repair() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        let broken_path = fixture.config.events_dir().join("broken-event.md");
        std::fs::write(&broken_path, b"not valid frontmatter").unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );

        let healthy_path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        let mut repaired = jin_core::store::fs::read_event(&healthy_path).unwrap();
        repaired.frontmatter.id = "broken-event".to_string();
        repaired.frontmatter.source = jin_core::model::event::EventSource::Jin;
        repaired.frontmatter.authority = jin_core::model::event::EventSource::Jin;
        jin_core::store::fs::write_event(&fixture.config.events_dir(), &repaired).unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
    }

    #[test]
    fn unseen_canonical_partial_error_is_collected_after_source_removal() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        reset_center(&fixture);
        let broken_path = fixture.config.events_dir().join("removed-broken.md");
        std::fs::write(&broken_path, b"not valid frontmatter").unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(fixture.tmp.path(), now())
            .unwrap();
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );

        std::fs::remove_file(broken_path).unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
    }

    #[test]
    fn unseen_mapped_google_partial_error_is_collected_after_source_removal() {
        let fixture = setup_invitation("needsAction", false, 1, None);
        let mut config = jin_core::Config::load(fixture.tmp.path()).unwrap();
        config.google_registry.calendars.clear();
        config.save().unwrap();
        let first = jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now(),
        )
        .unwrap();
        assert!(first.errors.iter().any(|error| {
            error.code == "calendar_missing" && error.source_key.starts_with("google/")
        }));
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            1
        );

        let event_path =
            jin_core::store::fs::find_event_path(&fixture.config.events_dir(), &fixture.event_id)
                .unwrap();
        std::fs::remove_file(event_path).unwrap();
        jin_core::notification_center::reconcile_calendar_invitations(
            fixture.tmp.path(),
            now() + chrono::Duration::minutes(1),
        )
        .unwrap();
        assert_eq!(
            fixture.center().summary(now()).unwrap().partial_error_count,
            0
        );
    }
}
