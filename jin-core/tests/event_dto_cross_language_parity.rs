use jin_core::dto::{EventDto, EventSyncContextDto};

const EVENT_DTO_RUST_SERIALIZATION_FIXTURE: &str = r#"{"id":"google-event-123","title":"Roadmap review","description":"Quarterly planning","location":"Room 42","start":"2026-08-27T13:00:00Z","end":"2026-08-27T14:00:00Z","is_all_day":false,"start_tzid":"America/Sao_Paulo","end_tzid":"America/Sao_Paulo","floating":false,"status":"confirmed","source":"google","authority":"external","ical_uid":"google-event-123@example.com","derived_from":null,"recurrence":[],"recurring_event_id":null,"original_start":null,"master_id":null,"recurrence_unexpanded":false,"sequence":7,"organizer":null,"attendees":null,"attendees_omitted":null,"conference_data":null,"hangout_link":null,"reminders":null,"created":"2026-08-27T12:00:00Z","updated":"2026-08-27T12:30:00Z","backlinks":[],"sync_context":{"provider":"google","account_id":"acct-work-01","account_alias":"Work","calendar_id":"team@example.com","calendar_name":"Team Calendar","access_role":"writer","writable":true,"state":"synced"}}"#;

#[test]
fn provider_event_serialization_matches_cross_language_fixture() {
    let event = EventDto {
        id: "google-event-123".into(),
        title: "Roadmap review".into(),
        description: Some("Quarterly planning".into()),
        location: Some("Room 42".into()),
        start: "2026-08-27T13:00:00Z".into(),
        end: "2026-08-27T14:00:00Z".into(),
        is_all_day: false,
        start_tzid: Some("America/Sao_Paulo".into()),
        end_tzid: Some("America/Sao_Paulo".into()),
        floating: false,
        status: "confirmed".into(),
        source: "google".into(),
        authority: "external".into(),
        ical_uid: Some("google-event-123@example.com".into()),
        derived_from: None,
        recurrence: vec![],
        recurring_event_id: None,
        original_start: None,
        master_id: None,
        recurrence_unexpanded: false,
        sequence: 7,
        organizer: None,
        attendees: None,
        attendees_omitted: None,
        conference_data: None,
        hangout_link: None,
        reminders: None,
        created: "2026-08-27T12:00:00Z".into(),
        updated: "2026-08-27T12:30:00Z".into(),
        backlinks: vec![],
        sync_context: Some(EventSyncContextDto {
            provider: "google".into(),
            account_id: "acct-work-01".into(),
            account_alias: "Work".into(),
            calendar_id: "team@example.com".into(),
            calendar_name: "Team Calendar".into(),
            access_role: "writer".into(),
            writable: true,
            state: "synced".into(),
        }),
    };

    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        EVENT_DTO_RUST_SERIALIZATION_FIXTURE
    );
}
