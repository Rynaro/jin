//! M1 regression — tombstoned targets must be treated as dangling.
//!
//! GIVEN note → task edge (references),
//! WHEN the task is soft-deleted (tombstoned),
//! THEN rebuild flags the edge as dangling in doctor output.

use tempfile::TempDir;

use jin_core::model::EdgeType;
use jin_core::ops::{self, api, notes, tasks};

#[test]
fn m1_tombstoned_target_is_dangling() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    // Create note and task
    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "Prep note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Book dentist".to_string(),
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

    // Create note → task edge
    jin_core::ops::link::create_link(
        root,
        note.id(),
        "note",
        task.id(),
        "task",
        EdgeType::References,
    )
    .unwrap();

    // Rebuild with task alive — no dangling edges expected
    let warnings = api::refresh(root).unwrap();
    assert!(
        warnings.is_empty(),
        "should be no dangling edges before task deletion: {:?}",
        warnings
    );
    let dangling_before = api::list_dangling(root).unwrap();
    assert!(
        dangling_before.is_empty(),
        "doctor should report no dangling before tombstone"
    );

    // Soft-delete the task (tombstone it)
    tasks::delete_task(&root.join("tasks"), task.id()).unwrap();

    // Rebuild again — the edge now points to a tombstoned target → dangling
    let warnings_after = api::refresh(root).unwrap();
    assert!(
        !warnings_after.is_empty(),
        "M1 FAIL: rebuild did not detect dangling edge to tombstoned task"
    );

    let dangling_after = api::list_dangling(root).unwrap();
    assert_eq!(
        dangling_after.len(),
        1,
        "M1 FAIL: expected exactly 1 dangling edge, got {:?}",
        dangling_after
    );
    assert_eq!(dangling_after[0].source_id, note.id());
    assert_eq!(dangling_after[0].target_id, task.id());
    assert_eq!(dangling_after[0].edge_type, "references");
}
