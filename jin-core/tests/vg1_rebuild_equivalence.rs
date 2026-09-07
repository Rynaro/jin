//! VG1 — Rebuild-equivalence regression test.
//!
//! GIVEN a populated canonical store,
//! WHEN index.sqlite is deleted and rebuilt,
//! THEN every query returns byte-identical results to before deletion.

use std::path::Path;
use tempfile::TempDir;

use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::{self, api, events, notes, tasks};

fn setup_store() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    ops::init(root).unwrap();

    let _n1 = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Meeting prep".to_string(),
            body: "Some prep notes".to_string(),
            tags: vec!["work".to_string()],
            folder: String::new(),
        },
    )
    .unwrap();

    let _n2 = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Quick thought".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    let _t1 = tasks::create_task(
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

    let t2 = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Review PR".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some("work".to_string()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    tasks::transition_task(
        &root.join("tasks"),
        t2.id(),
        jin_core::model::TaskStatus::Done,
    )
    .unwrap();

    use chrono::NaiveDateTime;
    let start = NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T14:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let _e1 = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Team sync".to_string(),
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

    tmp
}

/// Capture a deterministic snapshot of query results via the public API.
fn snapshot(root: &Path) -> String {
    let notes = api::list_notes(root, true, None, None).unwrap();
    let tasks = api::list_tasks(root, None, None, None, true).unwrap();
    let events = api::list_events(root, true).unwrap();

    let mut out = String::new();

    out.push_str("=== NOTES ===\n");
    for n in &notes {
        out.push_str(&format!(
            "id={} title={} status={}\n",
            n.id, n.title, n.status
        ));
    }

    out.push_str("=== TASKS ===\n");
    for t in &tasks {
        out.push_str(&format!(
            "id={} title={} status={} priority={} list={}\n",
            t.id, t.title, t.status, t.priority, t.list
        ));
    }

    out.push_str("=== EVENTS ===\n");
    for e in &events {
        out.push_str(&format!(
            "id={} title={} status={} start={} tzid={:?}\n",
            e.id, e.title, e.status, e.start, e.start_tzid
        ));
    }

    out
}

#[test]
fn vg1_rebuild_equivalence() {
    let tmp = setup_store();
    let root = tmp.path();

    // Initial build via public API
    let warnings = api::refresh(root).unwrap();
    assert!(
        warnings.is_empty(),
        "unexpected dangling edges: {:?}",
        warnings
    );

    let snap_before = snapshot(root);

    // Delete the index file
    let index_path = root.join(".jin").join("index.sqlite");
    std::fs::remove_file(&index_path).expect("should be able to delete index");
    assert!(!index_path.exists());

    // Rebuild from scratch
    let warnings2 = api::refresh(root).unwrap();
    assert!(
        warnings2.is_empty(),
        "unexpected dangling edges after rebuild: {:?}",
        warnings2
    );

    let snap_after = snapshot(root);

    assert_eq!(
        snap_before, snap_after,
        "VG1 FAIL: index query results differ after rebuild"
    );
}

#[test]
fn vg1_rebuild_is_deterministic() {
    let tmp = setup_store();
    let root = tmp.path();

    api::refresh(root).unwrap();
    let snap1 = snapshot(root);

    api::refresh(root).unwrap();
    let snap2 = snapshot(root);

    assert_eq!(
        snap1, snap2,
        "VG1 FAIL: second rebuild yielded different results"
    );
}
