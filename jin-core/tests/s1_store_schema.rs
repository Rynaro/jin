//! S1 Store & Schema tests.

use tempfile::TempDir;

use jin_core::model::event::{EventSource, EventStatus, TemporalValue, ValueType};
use jin_core::model::{NoteStatus, TaskStatus};
use jin_core::ops::{self, events, notes, tasks};
use jin_core::store::fs;

// ── S1 AC1: init creates layout and is idempotent ──────────────

#[test]
fn s1_init_creates_layout() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    assert!(root.join("notes").is_dir());
    assert!(root.join("tasks").is_dir());
    assert!(root.join("events").is_dir());
    assert!(root.join(".jin").is_dir());
    assert!(root.join(".jin").join("sync").is_dir());
    let cfg_path = root.join(".jin").join("config.toml");
    assert!(cfg_path.is_file());

    // schema_version must be 1
    let cfg = jin_core::Config::load(root).unwrap();
    assert_eq!(cfg.schema_version, 1);
}

#[test]
fn s1_init_idempotent() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    // Drop a file in notes
    let sentinel = root.join("notes").join("sentinel.md");
    std::fs::write(&sentinel, "keep me").unwrap();

    // Re-init
    ops::init(root).unwrap();
    assert!(sentinel.exists(), "sentinel must survive re-init");
}

// ── S1 AC2: note file has valid frontmatter ─────────────────────

#[test]
fn s1_note_frontmatter_valid() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Test note".to_string(),
            body: "body".to_string(),
            tags: vec!["t1".to_string()],
            folder: String::new(),
        },
    )
    .unwrap();

    assert!(!note.frontmatter.id.is_empty());
    assert_eq!(note.frontmatter.kind, "note");
    assert!(note.frontmatter.created <= note.frontmatter.updated);
    assert_eq!(note.frontmatter.status, NoteStatus::Active);

    // Re-read from disk and verify round-trip
    let path = fs::find_note_path(&root.join("notes"), note.id()).unwrap();
    let reread = fs::read_note(&path).unwrap();
    assert_eq!(reread.frontmatter.id, note.frontmatter.id);
    assert_eq!(reread.frontmatter.title, note.frontmatter.title);
    assert_eq!(reread.frontmatter.tags, vec!["t1"]);
}

// ── S1 AC3: soft-delete tombstone ──────────────────────────────

#[test]
fn s1_note_soft_delete_tombstone() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Soon deleted".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    let deleted = notes::delete_note(&root.join("notes"), note.id()).unwrap();
    assert_eq!(deleted.frontmatter.status, NoteStatus::Deleted);
    assert!(deleted.frontmatter.deleted_at.is_some());

    // File must still exist
    let path = fs::find_note_path(&root.join("notes"), note.id()).unwrap();
    assert!(path.exists(), "tombstoned note file must still exist");

    // list_notes with include_deleted=false must exclude it
    let active = notes::list_notes(&root.join("notes"), false).unwrap();
    assert!(
        active.iter().all(|n| n.id() != note.id()),
        "deleted note must not appear in active list"
    );

    // With include_deleted=true it must appear
    let all = notes::list_notes(&root.join("notes"), true).unwrap();
    assert!(
        all.iter().any(|n| n.id() == note.id()),
        "deleted note must appear in full list"
    );
}

#[test]
fn s1_task_soft_delete_tombstone() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Ephemeral".to_string(),
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

    let deleted = tasks::delete_task(&root.join("tasks"), task.id()).unwrap();
    assert_eq!(deleted.frontmatter.status, TaskStatus::Deleted);
    assert!(deleted.frontmatter.deleted_at.is_some());

    // File still exists
    let path = fs::find_task_path(&root.join("tasks"), task.id()).unwrap();
    assert!(path.exists());
}

// ── S1 AC4: event has all RFC-5545 fields ──────────────────────

#[test]
fn s1_event_rfc5545_fields_present() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T14:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Dentist".to_string(),
            body: "Agenda".to_string(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/Sao_Paulo".to_string()),
            end_tzid: Some("America/Sao_Paulo".to_string()),
            floating: false,
            ical_uid: None,
            description: Some("Annual checkup".to_string()),
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        },
    )
    .unwrap();

    let fm = &event.frontmatter;
    assert_eq!(fm.kind, "event");
    assert!(!fm.id.is_empty());
    assert!(fm.ical_uid.is_some());
    assert_eq!(fm.sequence, 0);
    assert_eq!(fm.status, EventStatus::Confirmed);
    assert_eq!(fm.source, EventSource::Jin);
    assert_eq!(fm.authority, EventSource::Jin);
    assert_eq!(fm.start_tzid.as_deref(), Some("America/Sao_Paulo"));
    assert!(!fm.is_all_day);
    assert!(!fm.floating);
    assert!(fm.recurrence.is_empty());
    assert!(fm.recurring_event_id.is_none());
    assert!(fm.master_id.is_none());
    assert!(!fm.recurrence_unexpanded);

    // Round-trip from disk
    let path = fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let reread = fs::read_event(&path).unwrap();
    assert_eq!(reread.frontmatter.id, fm.id);
    assert_eq!(reread.frontmatter.start_tzid, fm.start_tzid);
}

// ── S1 AC5: edges are source-side only ─────────────────────────

#[test]
fn s1_edges_source_side_only() {
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
    let start = NaiveDateTime::parse_from_str("2026-07-05T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-05T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Meeting".to_string(),
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

    // Event bytes before link
    let event_path = fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let event_before = std::fs::read(&event_path).unwrap();

    jin_core::ops::link::create_link(
        root,
        note.id(),
        "note",
        event.id(),
        "event",
        jin_core::model::EdgeType::PrepFor,
    )
    .unwrap();

    // Event must be unchanged
    let event_after = std::fs::read(&event_path).unwrap();
    assert_eq!(
        event_before, event_after,
        "target event file must not be mutated"
    );

    // Note must contain the link
    let note_path = fs::find_note_path(&root.join("notes"), note.id()).unwrap();
    let note_content = std::fs::read_to_string(note_path).unwrap();
    assert!(note_content.contains("prep-for"));
}
