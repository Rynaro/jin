//! VG6 — Additive-write linking.
//!
//! GIVEN promote/attach,
//! WHEN edge is created,
//! THEN only the source file is mutated; the target file is byte-unchanged.

use std::fs;
use tempfile::TempDir;

use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::{self, events, notes, tasks};

#[test]
fn vg6_attach_note_to_event_target_unchanged() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Dentist prep".to_string(),
            body: "What to ask...".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T14:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Dentist".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/Sao_Paulo".to_string()),
            end_tzid: Some("America/Sao_Paulo".to_string()),
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

    // Capture byte content of the event file before attach
    let event_path =
        jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let event_before = fs::read(&event_path).unwrap();

    // Perform attach (note → event, default prep-for)
    jin_core::ops::link::create_link(
        root,
        note.id(),
        "note",
        event.id(),
        "event",
        jin_core::model::EdgeType::PrepFor,
    )
    .unwrap();

    // Event file must be byte-unchanged (VG6)
    let event_after = fs::read(&event_path).unwrap();
    assert_eq!(
        event_before, event_after,
        "VG6 FAIL: event file was mutated by attach"
    );

    // Note file must have the edge
    let note_path = jin_core::store::fs::find_note_path(&root.join("notes"), note.id()).unwrap();
    let note_content = fs::read_to_string(note_path).unwrap();
    assert!(
        note_content.contains("prep-for"),
        "VG6 FAIL: note frontmatter does not contain prep-for edge"
    );
    assert!(
        note_content.contains(event.id()),
        "VG6 FAIL: note frontmatter does not contain event id"
    );
}

#[test]
fn vg6_promote_task_file_unchanged() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Book dentist".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some("inbox".to_string()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    // Capture task file bytes before promote
    let task_path = jin_core::store::fs::find_task_path(&root.join("tasks"), task.id()).unwrap();
    let task_before = fs::read(&task_path).unwrap();

    // Promote
    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-07-02T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-02T09:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: task.title().to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
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
    )
    .unwrap();

    // Write derived-from edge into the event only
    jin_core::ops::link::create_link(
        root,
        event.id(),
        "event",
        task.id(),
        "task",
        jin_core::model::EdgeType::DerivedFrom,
    )
    .unwrap();

    // Task file must be byte-unchanged (VG6)
    let task_after = fs::read(&task_path).unwrap();
    assert_eq!(
        task_before, task_after,
        "VG6 FAIL: task file was mutated by promote"
    );

    // Event frontmatter must contain derived_from
    let event_path =
        jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let event_content = fs::read_to_string(event_path).unwrap();
    assert!(
        event_content.contains("derived_from"),
        "VG6 FAIL: event frontmatter does not contain derived_from"
    );
    assert!(
        event_content.contains(task.id()),
        "VG6 FAIL: event frontmatter does not contain task id"
    );
}

#[test]
fn vg6_backlinks_derived_from_rebuild() {
    // After attach, a full index rebuild must materialise the backlink on the target.
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Prep".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-08-01T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-08-01T11:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Workshop".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
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
    )
    .unwrap();

    jin_core::ops::link::create_link(
        root,
        note.id(),
        "note",
        event.id(),
        "event",
        jin_core::model::EdgeType::PrepFor,
    )
    .unwrap();

    // M4: use public API instead of raw index access
    jin_core::ops::api::refresh(root).unwrap();

    // Backlink from event's perspective should show the note via get_event DTO
    let event_dto = jin_core::ops::api::get_event(root, event.id()).unwrap();
    assert!(
        !event_dto.backlinks.is_empty(),
        "VG6 FAIL: no backlinks found on event after rebuild"
    );
    assert_eq!(event_dto.backlinks[0].source_id, note.id());
    assert_eq!(event_dto.backlinks[0].edge_type, "prep-for");
    assert_eq!(event_dto.backlinks[0].label, "prep-notes");
}
