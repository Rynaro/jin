//! VG4 — No-direct-SQLite boundary.
//!
//! VG4 SPEC: "only `jin-core` opens `index.sqlite`; schema stays private."
//!
//! # Enforcement layers
//!
//! 1. **Compile-time (primary):** `index` is declared `pub(crate)` in
//!    `jin-core/src/lib.rs`, making it invisible to every crate outside
//!    `jin-core`. This integration-test file lives in `jin-core/tests/`, which
//!    the Rust compiler treats as a *separate* crate that links `jin_core` as a
//!    library dependency — so `jin_core::index` is simply not in scope here,
//!    just as it would not be in the `jin` CLI binary or a future GUI crate.
//!
//! 2. **Runtime (this file):** the tests below prove that all data access
//!    through `jin_core`'s public API returns typed DTO structs. No
//!    `rusqlite::Connection`, no raw row iterators, and no SQLite-internal
//!    column names (like `rowid` or `file_path`) leak through the boundary.
//!
//! # Compile-time proof (uncomment to verify)
//!
//! The following line would produce a compile error, confirming that the index
//! module is unreachable from outside `jin-core`:
//!
//! ```ignore
//! use jin_core::index; // error[E0603]: module `index` is private
//! ```
//!
//! This is the **primary** VG4 enforcement mechanism and is re-checked on every
//! `cargo check` / `cargo build` run.

use chrono::NaiveDateTime;
use tempfile::TempDir;

use jin_core::dto::{DanglingEdgeDto, EventDto, NoteDto, TaskDto};
use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::{self, api, events, notes, tasks};

fn make_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    ops::init(tmp.path()).unwrap();
    tmp
}

/// VG4-A: All public API read operations return typed DTOs (not raw SQL rows).
///
/// The explicit type annotations on the local variables serve as the compile-time
/// assertion: if `api::list_notes` returned a `Connection` or a raw row type, the
/// annotation `Vec<NoteDto>` would refuse to compile.
#[test]
fn vg4_public_api_returns_dto_types_not_raw_sql() {
    let tmp = make_root();
    let root = tmp.path();

    let note = notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "VG4 note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "VG4 task".to_string(),
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

    let start = NaiveDateTime::parse_from_str("2026-07-01T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "VG4 event".to_string(),
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

    api::refresh(root).unwrap();

    // Explicit type annotations: these will not compile if the API returns
    // anything other than the named DTO types.
    let note_list: Vec<NoteDto> = api::list_notes(root, false, None, None).unwrap();
    let task_list: Vec<TaskDto> = api::list_tasks(root, None, None, None, false).unwrap();
    let event_list: Vec<EventDto> = api::list_events(root, false).unwrap();

    assert_eq!(note_list.len(), 1, "VG4: exactly 1 note via public API");
    assert_eq!(task_list.len(), 1, "VG4: exactly 1 task via public API");
    assert_eq!(event_list.len(), 1, "VG4: exactly 1 event via public API");

    // Single-item getters must also return typed DTOs.
    let note_dto: NoteDto = api::get_note(root, note.id()).unwrap();
    let task_dto: TaskDto = api::get_task(root, task.id()).unwrap();
    let event_dto: EventDto = api::get_event(root, event.id()).unwrap();

    assert_eq!(note_dto.id, note.id(), "VG4: NoteDto.id matches model id");
    assert_eq!(task_dto.id, task.id(), "VG4: TaskDto.id matches model id");
    assert_eq!(
        event_dto.id,
        event.id(),
        "VG4: EventDto.id matches model id"
    );

    // The following would fail to compile if file_path / rowid were exposed:
    //
    //   let _ = note_dto.file_path;  // error: no field `file_path` on `NoteDto`
    //   let _ = task_dto.rowid;      // error: no field `rowid` on `TaskDto`
    //
    // That compile-time absence is the structural VG4 guarantee.
}

/// VG4-B: `api::refresh` exposes only a warning list (Vec<JinError>),
/// not a Connection handle. The index is opened and closed entirely inside
/// `jin-core`; no Connection object escapes to the caller.
#[test]
fn vg4_refresh_does_not_leak_connection() {
    let tmp = make_root();
    let root = tmp.path();

    notes::create_note(
        &root.join("notes"),
        notes::CreateNoteParams {
            title: "refresh boundary check".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .unwrap();

    // Return type is Vec<JinError> (warnings), not a Connection.
    // If the return type changed to expose a Connection, the annotation below
    // would refuse to compile.
    let warnings: Vec<jin_core::JinError> = api::refresh(root).unwrap();
    assert!(warnings.is_empty(), "VG4: no warnings on a clean store");
}

/// VG4-C: `api::list_dangling` returns only DanglingEdgeDtos — the SQLite
/// query result is fully projected before leaving jin-core's boundary.
#[test]
fn vg4_list_dangling_returns_dto_not_raw_rows() {
    let tmp = make_root();
    let root = tmp.path();
    api::refresh(root).unwrap();

    // Explicit type annotation: Vec<DanglingEdgeDto> is the DTO projection.
    let dangling: Vec<DanglingEdgeDto> = api::list_dangling(root).unwrap();
    assert!(
        dangling.is_empty(),
        "VG4: empty store has no dangling edges"
    );
}
