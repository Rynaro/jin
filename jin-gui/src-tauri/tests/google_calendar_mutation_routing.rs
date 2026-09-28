use jin_core::google::account::{DiscoveredCalendar, GoogleAccessRole, GOOGLE_ISSUER};
use jin_core::sync::state::{self, OutboxOperationKind, SyncDestination};
use jin_gui::commands::events::{
    create_routed_event_fn, delete_event_fn, edit_event_fn, get_event_detail_fn, EditEventInput,
    EventInput, RoutedEventInput,
};
use tempfile::TempDir;

fn configured_root() -> (TempDir, String) {
    let root = TempDir::new().unwrap();
    jin_core::ops::init(root.path()).unwrap();
    let mut config = jin_core::Config::load(root.path()).unwrap();
    let account_id = config.google_registry.add_pending_account("Work").unwrap();
    config
        .google_registry
        .account_mut(&account_id)
        .unwrap()
        .bind_subject(
            GOOGLE_ISSUER,
            "work-subject",
            Some("work@example.com".into()),
        )
        .unwrap();
    config
        .google_registry
        .reconcile_calendars(
            &account_id,
            vec![DiscoveredCalendar {
                calendar_id: "primary".into(),
                name: "Work".into(),
                primary: true,
                access_role: GoogleAccessRole::Writer,
                allowed_conference_solution_types: vec!["hangoutsMeet".to_string()],
            }],
        )
        .unwrap();
    config.google_sync_schema_version = Some(jin_core::config::GOOGLE_SYNC_SCHEMA_VERSION);
    config.write_google_v2_guard().unwrap();
    config.save().unwrap();
    (root, account_id.to_string())
}

fn duplicate_conference_request() -> jin_core::model::event::EventConferenceData {
    serde_json::from_value(serde_json::json!({
        "createRequest": {
            "requestId": "provider-consumed-request",
            "conferenceSolutionKey": { "type": "hangoutsMeet" },
            "status": { "statusCode": "success" }
        },
        "pendingCreateRequest": {
            "requestId": "provider-consumed-request",
            "conferenceSolutionKey": { "type": "hangoutsMeet" }
        }
    }))
    .unwrap()
}

#[test]
fn public_create_and_edit_inputs_reject_reused_conference_request_ids() {
    let (root, account_id) = configured_root();
    let invalid_create = create_routed_event_fn(
        root.path(),
        RoutedEventInput {
            event: EventInput {
                title: "Invalid conference create".into(),
                start: "2026-09-02T09:00:00".into(),
                end: "2026-09-02T10:00:00".into(),
                tzid: Some("UTC".into()),
                is_all_day: false,
                description: None,
                location: None,
                recurrence: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: Some(duplicate_conference_request()),
                clear_conference_data: false,
                reminders: None,
            },
            account_id: account_id.clone(),
            calendar_id: "primary".into(),
            operation_id: "reject-reused-conference-create".into(),
            guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy::All,
        },
    );
    assert!(invalid_create.is_err());

    let event = create_routed_event_fn(
        root.path(),
        RoutedEventInput {
            event: EventInput {
                title: "Valid event".into(),
                start: "2026-09-02T11:00:00".into(),
                end: "2026-09-02T12:00:00".into(),
                tzid: Some("UTC".into()),
                is_all_day: false,
                description: None,
                location: None,
                recurrence: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: None,
                clear_conference_data: false,
                reminders: None,
            },
            account_id,
            calendar_id: "primary".into(),
            operation_id: "valid-event-before-invalid-edit".into(),
            guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy::All,
        },
    )
    .unwrap();
    let detail = get_event_detail_fn(root.path(), event.id.clone()).unwrap();
    // The edit path is deliberately asymmetric with create: it freshens the
    // request id *before* validating, so a reused id is replaced rather than
    // rejected. See `edit_with_guest_update_policy` in event_mutation.rs.
    let edit_result = edit_event_fn(
        root.path(),
        EditEventInput {
            event_id: event.id,
            edit_token: detail.edit_token,
            operation_id: "reject-reused-conference-edit".into(),
            recurrence: None,
            clear_recurrence: false,
            title: "Invalid conference edit".into(),
            start: "2026-09-02T11:00:00".into(),
            end: "2026-09-02T12:00:00".into(),
            tzid: Some("UTC".into()),
            is_all_day: false,
            description: None,
            location: None,
            recurrence_scope: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: Some(duplicate_conference_request()),
            clear_conference_data: false,
            reminders: None,
        },
    )
    .expect("core freshens a reused conference request id on edit rather than rejecting it");
    let request_id = edit_result
        .event
        .conference_data
        .as_ref()
        .and_then(|conference| conference.pending_create_request.as_ref())
        .map(|pending| pending.request_id.as_str())
        .expect("a fresh conference request id must survive the edit");
    assert!(
        request_id.starts_with("jin-meet-"),
        "core must replace any client-supplied request id with its own, got {request_id}"
    );
    assert_ne!(request_id, "provider-consumed-request");
}

#[test]
fn routed_recurrence_payload_includes_timezone_and_complete_rule() {
    use jin_core::recurrence::{
        RecurrenceDraft, RecurrenceEnd, RecurrenceFrequency, RecurrenceWeekday,
    };

    let (root, account_id) = configured_root();
    let event = create_routed_event_fn(
        root.path(),
        RoutedEventInput {
            event: EventInput {
                title: "Weekly review".into(),
                start: "2026-09-01T09:00:00".into(),
                end: "2026-09-01T10:00:00".into(),
                tzid: Some("America/Sao_Paulo".into()),
                is_all_day: false,
                description: None,
                location: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: None,
                clear_conference_data: false,
                reminders: None,
                recurrence: Some(RecurrenceDraft {
                    frequency: RecurrenceFrequency::Weekly,
                    interval: 1,
                    weekly_days: vec![RecurrenceWeekday::Tu],
                    monthly: None,
                    end: RecurrenceEnd::Never,
                }),
            },
            account_id: account_id.clone(),
            calendar_id: "primary".into(),
            operation_id: "tauri-create-recurring-route".into(),
            guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy::All,
        },
    )
    .unwrap();

    let config = jin_core::Config::load(root.path()).unwrap();
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let route = SyncDestination::google(&account_id, "primary");
    let pending = state::list_route_outbox(&conn, &route, "pending").unwrap();
    let payload = pending
        .iter()
        .find(|item| item.jin_id == event.id)
        .and_then(|item| item.payload.as_ref())
        .unwrap();
    assert_eq!(payload["start"]["timeZone"], "America/Sao_Paulo");
    assert_eq!(payload["end"]["timeZone"], "America/Sao_Paulo");
    assert_eq!(
        payload["recurrence"],
        serde_json::json!(["RRULE:FREQ=WEEKLY;BYDAY=TU"])
    );
}

#[test]
fn legacy_tauri_edit_and_delete_preserve_the_canonical_route() {
    let (root, account_id) = configured_root();
    let event = create_routed_event_fn(
        root.path(),
        RoutedEventInput {
            event: EventInput {
                title: "Account-routed event".into(),
                start: "2026-08-28T09:00:00".into(),
                end: "2026-08-28T10:00:00".into(),
                tzid: Some("UTC".into()),
                is_all_day: false,
                description: None,
                location: None,
                attendees: None,
                attendees_omitted: None,
                conference_data: None,
                clear_conference_data: false,
                reminders: None,
                recurrence: None,
            },
            account_id: account_id.clone(),
            calendar_id: "primary".into(),
            operation_id: "tauri-create-route".into(),
            guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy::All,
        },
    )
    .unwrap();
    let detail = get_event_detail_fn(root.path(), event.id.clone()).unwrap();

    edit_event_fn(
        root.path(),
        EditEventInput {
            event_id: event.id.clone(),
            edit_token: detail.edit_token,
            operation_id: "tauri-legacy-edit".into(),
            recurrence: None,
            clear_recurrence: false,
            title: "Edited through legacy command".into(),
            start: "2026-08-28T09:00:00".into(),
            end: "2026-08-28T10:30:00".into(),
            tzid: Some("UTC".into()),
            is_all_day: false,
            description: None,
            location: None,
            attendees: Some(vec![serde_json::from_value(serde_json::json!({
                "email": "guest@example.com",
                "responseStatus": "needsAction"
            }))
            .unwrap()]),
            attendees_omitted: None,
            conference_data: Some(
                serde_json::from_value(serde_json::json!({
                    "pendingCreateRequest": {
                        "requestId": "tauri-fresh-conference-request",
                        "conferenceSolutionKey": { "type": "hangoutsMeet" }
                    }
                }))
                .unwrap(),
            ),
            clear_conference_data: false,
            reminders: Some(
                serde_json::from_value(serde_json::json!({
                    "useDefault": false,
                    "overrides": [{ "method": "popup", "minutes": 20 }]
                }))
                .unwrap(),
            ),
            recurrence_scope: None,
        },
    )
    .unwrap();
    let config = jin_core::Config::load(root.path()).unwrap();
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let route = SyncDestination::google(&account_id, "primary");
    state::upsert_scoped_entry(
        &conn,
        &state::ScopedEventSyncEntry {
            destination: route.clone(),
            jin_id: event.id.clone(),
            recurrence_key: state::MASTER_RECURRENCE_KEY.into(),
            google_event_id: Some("remote-tauri-event".into()),
            ical_uid: None,
            etag: Some("etag-1".into()),
            google_updated: None,
            last_synced_at: None,
        },
    )
    .unwrap();
    delete_event_fn(root.path(), event.id.clone()).unwrap();

    let pending = state::list_route_outbox(&conn, &route, "pending").unwrap();
    assert_eq!(pending.len(), 3);
    assert!(pending
        .iter()
        .any(|item| item.operation == OutboxOperationKind::Insert));
    assert!(pending
        .iter()
        .any(|item| item.operation == OutboxOperationKind::Patch));
    assert!(pending
        .iter()
        .any(|item| item.operation == OutboxOperationKind::Delete));
    assert!(pending.iter().all(|item| item.jin_id == event.id));
    let patch = pending
        .iter()
        .find(|item| item.operation == OutboxOperationKind::Patch)
        .and_then(|item| item.payload.as_ref())
        .unwrap();
    assert_eq!(patch["attendees"][0]["email"], "guest@example.com");
    // Core owns the provider request id; a client-supplied value is replaced,
    // never carried through to the outbox verbatim.
    let request_id = patch["conferenceData"]["createRequest"]["requestId"]
        .as_str()
        .expect("a fresh conference request must carry a requestId");
    assert!(request_id.starts_with("jin-meet-"));
    assert_ne!(request_id, "tauri-fresh-conference-request");
    assert!(patch["conferenceData"]["createRequest"]
        .get("status")
        .is_none());
    assert_eq!(patch["reminders"]["overrides"][0]["minutes"], 20);
}
