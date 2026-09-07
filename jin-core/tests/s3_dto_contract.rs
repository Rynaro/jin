//! S3 DTO contract tests (VG3 / VG4).
//!
//! VG3: every DTO envelope has jin_dto_version; no raw SQLite columns cross.
//! VG4: only jin-core opens index.sqlite (enforced structurally — no public DB type).

use jin_core::dto::{Envelope, EventDto, NoteDto, TaskDto};
use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::{self, api, events, notes, tasks};
use tempfile::TempDir;

fn make_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();
    tmp
}

#[test]
fn vg3_note_dto_envelope_has_version() {
    let tmp = make_root();
    let note = notes::create_note(
        &tmp.path().join("notes"),
        notes::CreateNoteParams {
            title: "Hello".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    let dto = NoteDto::from_model(&note);
    let envelope = Envelope::ok("note", serde_json::to_value(&dto).unwrap());
    let serialized = serde_json::to_string(&envelope).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();

    assert_eq!(
        parsed["jin_dto_version"], "1",
        "VG3: jin_dto_version must be '1'"
    );
    assert_eq!(parsed["kind"], "note");

    // No raw SQLite column names (file_path is internal; it should not appear in NoteDto)
    assert!(
        parsed["data"].get("file_path").is_none(),
        "VG3: file_path must not appear in NoteDto"
    );
    // id, title must be present
    assert!(parsed["data"]["id"].is_string());
    assert!(parsed["data"]["title"].is_string());
}

#[test]
fn vg3_task_dto_has_version() {
    let tmp = make_root();
    let task = tasks::create_task(
        &tmp.path().join("tasks"),
        tasks::CreateTaskParams {
            title: "Do thing".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    let dto = TaskDto::from_model(&task);
    let envelope = Envelope::ok("task", serde_json::to_value(&dto).unwrap());
    let json_str = serde_json::to_string(&envelope).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    assert_eq!(parsed["jin_dto_version"], "1");
    assert_eq!(parsed["kind"], "task");
    assert!(parsed["data"]["id"].is_string());
    assert!(
        parsed["data"]["file_path"].is_null() || parsed["data"].get("file_path").is_none(),
        "VG3: file_path must not appear in TaskDto"
    );
}

#[test]
fn vg3_event_dto_has_version() {
    let tmp = make_root();
    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T15:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &tmp.path().join("events"),
        events::CreateEventParams {
            title: "Stand-up".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("UTC".to_string()),
            end_tzid: Some("UTC".to_string()),
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

    let dto = EventDto::from_model(&event);
    let envelope = Envelope::ok("event", serde_json::to_value(&dto).unwrap());
    let json_str = serde_json::to_string(&envelope).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    assert_eq!(parsed["jin_dto_version"], "1");
    assert_eq!(parsed["kind"], "event");
    assert!(
        parsed["data"].get("file_path").is_none(),
        "VG3: file_path must not appear in EventDto"
    );
}

#[test]
fn event_reads_hydrate_canonical_edit_fields_and_recurrence_shape() {
    use chrono::NaiveDateTime;

    let tmp = make_root();
    let start = NaiveDateTime::parse_from_str("2026-07-01T23:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-03T01:15:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &tmp.path().join("events"),
        events::CreateEventParams {
            title: "Overnight workshop".to_string(),
            body: "canonical body".to_string(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/Sao_Paulo".to_string()),
            end_tzid: Some("America/Sao_Paulo".to_string()),
            floating: false,
            ical_uid: None,
            description: Some("Keep this description".to_string()),
            location: Some("Studio 4".to_string()),
            attendees: None,
            conference_data: None,
            reminders: None,
        },
    )
    .unwrap();

    api::refresh(tmp.path()).unwrap();
    let listed = api::list_events(tmp.path(), false).unwrap();
    let listed = listed
        .iter()
        .find(|dto| dto.id == event.frontmatter.id)
        .unwrap();
    assert_eq!(listed.description.as_deref(), Some("Keep this description"));
    assert_eq!(listed.location.as_deref(), Some("Studio 4"));
    assert_eq!(listed.start, "2026-07-01T23:30:00");
    assert_eq!(listed.end, "2026-07-03T01:15:00");
    assert_eq!(listed.start_tzid.as_deref(), Some("America/Sao_Paulo"));
    assert!(listed.recurrence.is_empty());
    assert!(listed.recurring_event_id.is_none());
    assert!(listed.original_start.is_none());
    assert!(listed.master_id.is_none());

    let detail = api::get_event(tmp.path(), &event.frontmatter.id).unwrap();
    assert_eq!(detail.description, listed.description);
    assert_eq!(detail.location, listed.location);
    assert_eq!(detail.start, listed.start);
    assert_eq!(detail.end, listed.end);
    assert_eq!(detail.start_tzid, listed.start_tzid);
}

#[test]
fn vg3_list_dto_envelope_valid() {
    let tmp = make_root();
    notes::create_note(
        &tmp.path().join("notes"),
        notes::CreateNoteParams {
            title: "A".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();
    notes::create_note(
        &tmp.path().join("notes"),
        notes::CreateNoteParams {
            title: "B".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    // M4: use api::refresh + api::list_notes instead of raw index access
    api::refresh(tmp.path()).unwrap();
    let dtos = api::list_notes(tmp.path(), false, None, None).unwrap();

    let envelope = Envelope::ok("list", serde_json::to_value(&dtos).unwrap());
    assert_eq!(envelope.jin_dto_version, "1");
    assert_eq!(envelope.kind, "list");
    let json_str = serde_json::to_string(&envelope).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert!(parsed["data"].is_array());
    assert_eq!(parsed["data"].as_array().unwrap().len(), 2);
}

#[test]
fn s3_edge_vocabulary_rejects_invalid() {
    assert!(
        jin_core::model::EdgeType::parse("relates-to").is_none(),
        "relates-to must not be in the edge vocabulary"
    );
    assert!(
        jin_core::model::EdgeType::parse("depends-on").is_none(),
        "depends-on must not be in the edge vocabulary"
    );
    assert!(jin_core::model::EdgeType::parse("derived-from").is_some());
    assert!(jin_core::model::EdgeType::parse("prep-for").is_some());
    assert!(jin_core::model::EdgeType::parse("references").is_some());
}

#[test]
fn s3_edge_signature_validation() {
    use jin_core::model::EdgeType;
    assert!(EdgeType::DerivedFrom.validate_signature("event", "task"));
    assert!(!EdgeType::DerivedFrom.validate_signature("note", "task"));
    assert!(!EdgeType::DerivedFrom.validate_signature("event", "note"));
    assert!(EdgeType::PrepFor.validate_signature("note", "event"));
    assert!(!EdgeType::PrepFor.validate_signature("note", "task"));
    assert!(EdgeType::References.validate_signature("note", "task"));
    assert!(EdgeType::References.validate_signature("note", "event"));
    assert!(EdgeType::References.validate_signature("note", "note"));
    assert!(!EdgeType::References.validate_signature("task", "note"));
}

// ── M7 regression: Envelope round-trips through serde_json ───────────────

#[test]
fn m7_envelope_version_round_trips() {
    // jin_dto_version must be String (not &'static str) to deserialize correctly.
    let env = Envelope::ok("note", serde_json::json!({"id": "abc"}));
    let json_str = serde_json::to_string(&env).unwrap();

    // Must deserialize back into Envelope
    let round: Envelope = serde_json::from_str(&json_str).unwrap();
    assert_eq!(round.jin_dto_version, "1");
    assert_eq!(round.kind, "note");
}

#[test]
fn m7_error_envelope_round_trips() {
    let env = Envelope::error("3", "object/abc not found");
    let json_str = serde_json::to_string(&env).unwrap();
    let round: Envelope = serde_json::from_str(&json_str).unwrap();
    assert_eq!(round.jin_dto_version, "1");
    assert_eq!(round.kind, "result");
    assert_eq!(round.data["ok"], false);
    assert_eq!(round.data["code"], "3");
}
