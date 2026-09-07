//! Bridge integration tests (GUI-S0 / VG-GUI-1 / VG-GUI-2).
//!
//! These tests exercise the command functions (`*_fn`) directly — no Tauri
//! runtime is required, making them fully headless and CI-safe (VG-GUI-8).
//!
//! All tests use a temporary directory for isolation; no global environment
//! mutation occurs.

use tempfile::TempDir;

/// Seed a fresh temp jin root and return the TempDir (keeps it alive).
fn init_root() -> TempDir {
    let tmp = TempDir::new().expect("create temp dir");
    jin_core::ops::init(tmp.path()).expect("init jin root");
    tmp
}

#[test]
fn concurrent_startup_reads_wait_for_canonical_operation_boundary() {
    use std::fs::OpenOptions;
    use std::sync::{mpsc, Arc, Barrier};
    use std::time::Duration;

    let tmp = init_root();
    let root = tmp.path().to_path_buf();
    let lock_path = root.join(".jin/operations.lock");
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .expect("open canonical operation lock");
    lock.lock().expect("hold canonical operation boundary");

    let barrier = Arc::new(Barrier::new(4));
    let (result_tx, result_rx) = mpsc::channel();
    let readers = (0..3)
        .map(|command| {
            let root = root.clone();
            let barrier = Arc::clone(&barrier);
            let result_tx = result_tx.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let result = match command {
                    0 => jin_gui::commands::agenda::today_agenda_fn(&root, None).map(|_| ()),
                    1 => jin_gui::commands::events::list_events_fn(&root, false).map(|_| ()),
                    _ => jin_gui::commands::tasks::list_tasks_fn(
                        &root, None, None, None, None, false,
                    )
                    .map(|_| ()),
                };
                result_tx.send(result).expect("report startup read");
            })
        })
        .collect::<Vec<_>>();
    drop(result_tx);

    barrier.wait();
    assert!(matches!(
        result_rx.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    drop(lock);

    for _ in 0..3 {
        assert!(result_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("startup read completes after convergence")
            .is_ok());
    }
    for reader in readers {
        reader.join().expect("join startup reader");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// VG4 / VG-GUI-1 — no rusqlite direct dependency
// ──────────────────────────────────────────────────────────────────────────────

/// Verify that jin-gui's Cargo.toml contains no direct rusqlite dependency.
///
/// This is the structural proof of VG4 (GUI-S0 / VG-GUI-1): consumers never
/// touch SQLite — only jin-core opens the index.
#[test]
fn vg4_vg_gui_1_no_rusqlite_direct_dep() {
    let cargo_toml = include_str!("../Cargo.toml");
    for (lineno, line) in cargo_toml.lines().enumerate() {
        let trimmed = line.trim();
        // Skip comment lines.
        if trimmed.starts_with('#') {
            continue;
        }
        assert!(
            !trimmed.contains("rusqlite"),
            "jin-gui Cargo.toml must NOT reference rusqlite (VG4 / VG-GUI-1) \
             — found on line {}: {:?}",
            lineno + 1,
            trimmed
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-GUI-2 — today_agenda hero flow: originating_task + prep_notes end-to-end
// ──────────────────────────────────────────────────────────────────────────────

/// Hero-flow test (VG-GUI-2): after task→promote→note→attach, `today_agenda`
/// returns an `AgendaEventDto` with `originating_task` and `prep_notes` populated.
///
/// This is the load-bearing GUI-S0 acceptance test.
#[test]
fn vg_gui_2_today_agenda_originating_task_and_prep_notes() {
    use chrono::Local;
    use jin_core::ops::{api, attach, promote};

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // 1. Create a task.
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Review the proposal".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("create task");
    api::refresh(root).expect("refresh after task");

    // 2. Promote the task to a floating event for today at 10:00.
    let today = Local::now().date_naive();
    let start_dt = today.and_hms_opt(10, 0, 0).expect("valid time 10:00:00");

    let event = promote::promote(
        root,
        task.id(),
        promote::PromoteParams {
            start_dt,
            tzid: None, // floating — no timezone needed
        },
    )
    .expect("promote task");
    api::refresh(root).expect("refresh after promote");

    // 3. Create a prep note.
    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Key talking points".to_string(),
            body: "- budget\n- timeline\n".to_string(),
            tags: vec!["prep".to_string()],
            folder: String::new(),
        },
    )
    .expect("create note");
    api::refresh(root).expect("refresh after note");

    // 4. Attach the note to the event (default: prep-for edge).
    attach::attach_note(root, note.id(), event.id(), None).expect("attach note");
    api::refresh(root).expect("refresh after attach");

    // 5. Call today_agenda for today's date.
    let date_str = today.format("%Y-%m-%d").to_string();
    let agenda =
        jin_gui::commands::agenda::today_agenda_fn(root, Some(date_str)).expect("today_agenda");

    // 6. Find the promoted event.
    let agenda_event = agenda
        .timed_events
        .iter()
        .find(|e| e.id == event.id())
        .expect("promoted event must appear in today's timed_events");

    // VG-GUI-2 assertion: originating_task is populated.
    let orig = agenda_event
        .originating_task
        .as_ref()
        .expect("AgendaEventDto.originating_task must be Some for a promoted event (VG-GUI-2)");
    assert_eq!(
        orig.id,
        task.id(),
        "originating_task.id must match the task"
    );
    assert_eq!(
        orig.title, "Review the proposal",
        "originating_task.title must match"
    );

    // VG-GUI-2 assertion: prep_notes is populated.
    assert_eq!(
        agenda_event.prep_notes.len(),
        1,
        "AgendaEventDto.prep_notes must contain the attached note (VG-GUI-2)"
    );
    assert_eq!(
        agenda_event.prep_notes[0].id,
        note.id(),
        "prep_notes[0].id must match the attached note"
    );
    assert_eq!(
        agenda_event.prep_notes[0].title, "Key talking points",
        "prep_notes[0].title must match"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Error-code mapping tests
// ──────────────────────────────────────────────────────────────────────────────

/// `today_agenda` on a non-initialized root must return code 7 (integrity).
#[test]
fn bridge_error_not_initialized_maps_to_code_7() {
    let tmp = TempDir::new().expect("create temp dir");
    // Deliberately do NOT call init() — no .jin/ directory.

    let err = jin_gui::commands::agenda::today_agenda_fn(tmp.path(), None)
        .expect_err("must fail on uninitialized root");

    assert_eq!(
        err.code, 7,
        "not_initialized must map to code 7 (integrity)"
    );
    assert_eq!(err.kind, "integrity");
    assert!(!err.retriable);
}

/// `get_note` for a non-existent id must return code 3 (not_found).
#[test]
fn bridge_error_not_found_maps_to_code_3() {
    let tmp = init_root();

    let err = jin_gui::commands::notes::get_note_fn(tmp.path(), "01NONEXISTENT".to_string())
        .expect_err("must fail for missing note");

    assert_eq!(err.code, 3, "not_found must map to code 3");
    assert_eq!(err.kind, "not_found");
    assert!(!err.retriable);
}

// ──────────────────────────────────────────────────────────────────────────────
// Wave 2A — VG gate tests (folders, move, edit-preserve, migration)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-LIST-FILTER: create a note in "Work" folder → list_notes(folder=Work) returns it;
/// list_notes(folder=Other) returns empty.
#[test]
fn vg_list_filter_folder_exact_match() {
    let tmp = init_root();
    let root = tmp.path();

    let note = jin_gui::commands::notes::create_note_fn(
        root,
        jin_gui::commands::notes::NoteInput {
            title: "Work note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: "Work".to_string(),
        },
    )
    .expect("create note in Work");

    // folder_path must be reported correctly on create
    assert_eq!(
        note.folder_path.as_deref(),
        Some("Work"),
        "VG-LIST-FILTER: create_note must return folder_path=Work"
    );

    // list with folder=Work must include the note
    let work_notes =
        jin_gui::commands::notes::list_notes_fn(root, false, None, Some("Work".to_string()))
            .expect("list Work");
    assert_eq!(
        work_notes.len(),
        1,
        "VG-LIST-FILTER: exactly one note in Work"
    );
    assert_eq!(work_notes[0].id, note.id);
    assert_eq!(
        work_notes[0].folder_path.as_deref(),
        Some("Work"),
        "VG-LIST-FILTER: list entry must carry folder_path"
    );

    // list with folder=Other must be empty
    let other_notes =
        jin_gui::commands::notes::list_notes_fn(root, false, None, Some("Other".to_string()))
            .expect("list Other");
    assert!(
        other_notes.is_empty(),
        "VG-LIST-FILTER: Other folder must be empty"
    );
}

/// VG-MOVE (link-integrity): creates a REAL B→A edge via attach_note (writes
/// B's frontmatter links[]); moves A to "Moved"; verifies that after refresh:
///   (a) A's file is under notes/Moved/
///   (b) get_note(A) body is intact
///   (c) A's backlinks STILL contain B (edge survives the move — ULID-based)
///   (d) list_dangling is empty (no broken edges)
///
/// Anti-shallow: this test WILL fail if move_note corrupts the link graph,
/// because the pre-move backlink assert proves the edge existed, and the
/// post-move backlink assert proves it survived.
#[test]
fn vg_move_link_integrity_after_folder_move() {
    use jin_core::ops::{api, attach};

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // 1. Create note A (root folder, body non-empty so we can verify it later).
    let note_a = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Note A".to_string(),
            body: "content of A — must survive the move".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create A");
    api::refresh(root).expect("refresh after A");

    // 2. Create note B (root folder).
    let note_b = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Note B".to_string(),
            body: "B references A".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create B");
    api::refresh(root).expect("refresh after B");

    // 3. Create REAL edge B→A (writes B's frontmatter links[]; A gets inbound backlink).
    //    None → default edge type for note→note = "references".
    attach::attach_note(root, note_b.id(), note_a.id(), None)
        .expect("VG-MOVE: attach B→A must succeed");
    api::refresh(root).expect("refresh after attach");

    // 4. PRE-MOVE SANITY: A must already have a backlink from B.
    let a_before = jin_gui::commands::notes::get_note_fn(root, note_a.id().to_string())
        .expect("VG-MOVE PRE: get_note(A) must succeed");
    assert!(
        a_before
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-MOVE PRE: A must have a backlink from B before the move; backlinks={:?}",
        a_before.backlinks
    );

    // 5. Move A to "Moved".
    let moved =
        jin_gui::commands::notes::move_note_fn(root, note_a.id().to_string(), "Moved".to_string())
            .expect("VG-MOVE: move A to Moved must succeed");
    assert_eq!(
        moved.folder_path.as_deref(),
        Some("Moved"),
        "VG-MOVE: move_note must return folder_path=Moved"
    );
    api::refresh(root).expect("VG-MOVE: refresh after move must succeed");

    // POST-MOVE: (a) A's file physically exists under notes/Moved/.
    let moved_dir = cfg.notes_dir().join("Moved");
    assert!(moved_dir.is_dir(), "VG-MOVE POST: notes/Moved/ must exist");
    let moved_files: Vec<_> = std::fs::read_dir(&moved_dir)
        .expect("read Moved dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "md"))
        .collect();
    assert_eq!(
        moved_files.len(),
        1,
        "VG-MOVE POST: exactly one md file in notes/Moved/"
    );

    // (b) get_note(A) returns body non-empty.
    let a_after = jin_gui::commands::notes::get_note_fn(root, note_a.id().to_string())
        .expect("VG-MOVE POST: get_note(A) after move must succeed");
    let bm = a_after
        .body_markdown
        .as_deref()
        .expect("VG-MOVE POST: body_markdown must be Some");
    assert!(
        bm.contains("content of A"),
        "VG-MOVE POST: body must be intact after move, got: {bm:?}"
    );

    // (c) A's backlinks STILL contain B — link-integrity survives the move.
    assert!(
        a_after
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-MOVE POST: A must STILL have backlink from B after move; backlinks={:?}",
        a_after.backlinks
    );

    // (d) list_dangling must be empty (no broken edges after move).
    let dangling = api::list_dangling(root).expect("VG-MOVE POST: list_dangling must succeed");
    assert!(
        dangling.is_empty(),
        "VG-MOVE POST: list_dangling must be empty after move; dangling={:?}",
        dangling
    );
}

/// VG-EDIT-PRESERVE: create note in "Work"; edit its title; file stays under notes/Work/.
#[test]
fn vg_edit_preserve_foldered_note_stays_in_folder() {
    use jin_core::ops::api;

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Old Title".to_string(),
            body: "body".to_string(),
            tags: vec![],
            folder: "Work".to_string(),
        },
    )
    .expect("create note in Work");
    api::refresh(root).expect("refresh after create");

    // Edit the title.
    jin_gui::commands::notes::edit_note_fn(
        root,
        note.id().to_string(),
        jin_gui::commands::notes::EditNoteInput {
            title: Some("New Title".to_string()),
            body: None,
            add_tags: vec![],
            rm_tags: vec![],
            expected_revision: None,
        },
    )
    .expect("edit note title");

    // File must still be under notes/Work/.
    let work_dir = cfg.notes_dir().join("Work");
    assert!(
        work_dir.is_dir(),
        "VG-EDIT-PRESERVE: notes/Work/ must still exist after title edit"
    );
    let work_files: Vec<_> = std::fs::read_dir(&work_dir)
        .expect("read Work dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "md"))
        .collect();
    assert_eq!(
        work_files.len(),
        1,
        "VG-EDIT-PRESERVE: exactly one file must be in Work after title edit (not relocated to root)"
    );

    // The file must contain the new title in its frontmatter.
    let content = std::fs::read_to_string(work_files[0].path()).expect("read note file");
    assert!(
        content.contains("New Title"),
        "VG-EDIT-PRESERVE: note file must contain the new title"
    );
}

/// VG-FOLDERS-EMPTY: create_folder("Empty") → list_folders includes "Empty" with note_count=0.
#[test]
fn vg_folders_empty_dir_appears_in_list() {
    let tmp = init_root();
    let root = tmp.path();

    // Create an empty folder.
    let created = jin_gui::commands::folders::create_folder_fn(root, "Empty".to_string())
        .expect("VG-FOLDERS-EMPTY: create_folder must succeed");
    assert_eq!(
        created.path, "Empty",
        "VG-FOLDERS-EMPTY: created folder path must be Empty"
    );
    assert_eq!(
        created.note_count, 0,
        "VG-FOLDERS-EMPTY: empty folder must have note_count=0"
    );

    // list_folders must include "Empty" with note_count=0.
    let folders = jin_gui::commands::folders::list_folders_fn(root).expect("list_folders");
    let empty_entry = folders.iter().find(|f| f.path == "Empty");
    assert!(
        empty_entry.is_some(),
        "VG-FOLDERS-EMPTY: list_folders must include Empty"
    );
    assert_eq!(
        empty_entry.unwrap().note_count,
        0,
        "VG-FOLDERS-EMPTY: Empty must have note_count=0"
    );

    // Root ("") must always be present.
    assert!(
        folders.iter().any(|f| f.path.is_empty()),
        "VG-FOLDERS-EMPTY: root folder (\"\") must always appear in list_folders"
    );
}

/// VG-MIG: open a root that has been in use (schema already exists from Wave 1 pattern);
/// guarded ALTER TABLE must not crash; list_notes must succeed afterwards.
#[test]
fn vg_mig_index_migration_does_not_crash_on_existing_schema() {
    use jin_core::ops::api;

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed a note then force a rebuild (which migrates the schema).
    jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Migration test".to_string(),
            body: "body".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note");
    api::refresh(root).expect("first refresh / migration");

    // Call refresh a second time — guarded ALTER must be idempotent.
    api::refresh(root).expect("VG-MIG: second refresh must succeed (idempotent migration)");

    // list_notes must return the note correctly (folder_path present in index).
    let notes = jin_gui::commands::notes::list_notes_fn(root, false, None, None)
        .expect("VG-MIG: list_notes must succeed after migration");
    assert_eq!(notes.len(), 1, "VG-MIG: seeded note must appear");
    assert_eq!(
        notes[0].folder_path.as_deref(),
        Some(""),
        "VG-MIG: folder_path must be empty string for root-folder note"
    );
}

/// VG-EDIT-SAME-SLUG: editing a note title to a value that slugifies identically
/// (e.g. "Test" → "Test!") must NOT delete the file.
/// Regression: the old code wrote the new file then unconditionally removed old_path;
/// when new_path == old_path this silently deleted the note.
#[test]
fn vg_edit_same_slug_title_change_does_not_destroy_note() {
    use jin_core::ops::api;

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Create a note titled "Test".
    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Test".to_string(),
            body: "precious content that must survive".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note");
    api::refresh(root).expect("refresh");

    // Edit to "Test!" — slugify("Test!") == "test" == slugify("Test"),
    // so the new path == old path.
    jin_gui::commands::notes::edit_note_fn(
        root,
        note.id().to_string(),
        jin_gui::commands::notes::EditNoteInput {
            title: Some("Test!".to_string()),
            body: None,
            add_tags: vec![],
            rm_tags: vec![],
            expected_revision: None,
        },
    )
    .expect("VG-EDIT-SAME-SLUG: edit to same-slug title must succeed");

    // The note file must still exist at the SAME path (same slug → same filename).
    let note_path = jin_core::store::fs::find_note_path(&cfg.notes_dir(), note.id())
        .expect("VG-EDIT-SAME-SLUG: note file must still exist after same-slug title change");

    // Body must be intact.
    let content = std::fs::read_to_string(&note_path).expect("read note file");
    assert!(
        content.contains("precious content that must survive"),
        "VG-EDIT-SAME-SLUG: body must be intact; got: {:?}",
        &content[..content.len().min(200)]
    );
    assert!(
        content.contains("Test!"),
        "VG-EDIT-SAME-SLUG: new title must be in frontmatter"
    );
}

/// VG-FOLDERS-COUNTS: list_folders reports correct note_count per folder and
/// excludes soft-deleted notes from the count (AC-S6.2).
#[test]
fn vg_folders_list_reports_correct_counts() {
    use jin_core::ops::api;

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed: 2 notes in "Work", 1 note in root.
    for i in 0..2u32 {
        jin_core::ops::notes::create_note(
            &cfg.notes_dir(),
            jin_core::ops::notes::CreateNoteParams {
                title: format!("Work Note {}", i),
                body: String::new(),
                tags: vec![],
                folder: "Work".to_string(),
            },
        )
        .expect("create Work note");
    }
    let root_note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Root Note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create root note");
    api::refresh(root).expect("refresh after seeding");

    // list_folders must report Work: 2, root: 1.
    let folders = jin_gui::commands::folders::list_folders_fn(root).expect("list_folders");

    let work_entry = folders
        .iter()
        .find(|f| f.path == "Work")
        .expect("Work must be present");
    assert_eq!(
        work_entry.note_count, 2,
        "VG-FOLDERS-COUNTS: Work must have note_count=2"
    );

    let root_entry = folders
        .iter()
        .find(|f| f.path.is_empty())
        .expect("root must be present");
    assert_eq!(
        root_entry.note_count, 1,
        "VG-FOLDERS-COUNTS: root must have note_count=1"
    );

    // Soft-delete the root note → root count must drop to 0.
    jin_core::ops::notes::delete_note(&cfg.notes_dir(), root_note.id())
        .expect("soft-delete root note");
    api::refresh(root).expect("refresh after delete");

    let folders2 =
        jin_gui::commands::folders::list_folders_fn(root).expect("list_folders after delete");
    let root_entry2 = folders2
        .iter()
        .find(|f| f.path.is_empty())
        .expect("root must still be present after delete");
    assert_eq!(
        root_entry2.note_count, 0,
        "VG-FOLDERS-COUNTS: soft-deleted note must be EXCLUDED from root note_count (AC-S6.2)"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-RENAME-BRIDGE — rename_folder round-trip with real attach edge
// ──────────────────────────────────────────────────────────────────────────────

/// VG-RENAME-BRIDGE: create W1 in Work, P1 in Work/Projects, B in root with a
/// REAL attach edge B→W1; rename Work→Job; verify:
///   (a) notes/Job/ exists, notes/Work/ gone
///   (b) list_notes(folder=Job) returns W1 with folder_path=="Job"
///   (c) list_notes(folder=Job/Projects) returns P1 with folder_path=="Job/Projects"
///   (d) get_note(W1).backlinks contains B (ULID survives)
///   (e) list_dangling empty
///   (f) collision: rename Job→Existing (existing dir) → Err
///   (g) root rename ""→X → Err
#[test]
fn vg_rename_bridge_link_integrity_after_folder_rename() {
    use jin_core::ops::{api, attach};

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // 1. Create W1 in Work (non-empty body so we can verify integrity later)
    let note_w1 = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Work Note 1".to_string(),
            body: "content of W1 — must survive the rename".to_string(),
            tags: vec![],
            folder: "Work".to_string(),
        },
    )
    .expect("VG-RENAME-BRIDGE: create W1 in Work");
    api::refresh(root).expect("refresh after W1");

    // 2. Create P1 in Work/Projects
    let note_p1 = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Project Note 1".to_string(),
            body: "content of P1".to_string(),
            tags: vec![],
            folder: "Work/Projects".to_string(),
        },
    )
    .expect("VG-RENAME-BRIDGE: create P1 in Work/Projects");
    api::refresh(root).expect("refresh after P1");

    // 3. Create B in root
    let note_b = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Backlink Source".to_string(),
            body: "B references W1".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("VG-RENAME-BRIDGE: create B in root");
    api::refresh(root).expect("refresh after B");

    // 4. Seed a REAL attach edge B→W1
    attach::attach_note(root, note_b.id(), note_w1.id(), None)
        .expect("VG-RENAME-BRIDGE: attach B→W1 must succeed");
    api::refresh(root).expect("refresh after attach");

    // PRE-ASSERT: W1 must already have a backlink from B
    let w1_before = jin_gui::commands::notes::get_note_fn(root, note_w1.id().to_string())
        .expect("VG-RENAME-BRIDGE PRE: get_note(W1)");
    assert!(
        w1_before
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-RENAME-BRIDGE PRE: W1 must have backlink from B before rename; backlinks={:?}",
        w1_before.backlinks
    );

    // 5. Rename Work→Job
    jin_gui::commands::folders::rename_folder_fn(root, "Work".to_string(), "Job".to_string())
        .expect("VG-RENAME-BRIDGE: rename_folder Work→Job must succeed");

    // (a) notes/Job/ exists, notes/Work/ gone
    assert!(
        cfg.notes_dir().join("Job").is_dir(),
        "VG-RENAME-BRIDGE: notes/Job/ must exist after rename"
    );
    assert!(
        !cfg.notes_dir().join("Work").exists(),
        "VG-RENAME-BRIDGE: notes/Work/ must be gone after rename"
    );

    // (b) list_notes(folder=Job) returns W1 with folder_path=="Job"
    let job_notes =
        jin_gui::commands::notes::list_notes_fn(root, false, None, Some("Job".to_string()))
            .expect("VG-RENAME-BRIDGE: list_notes(folder=Job)");
    assert_eq!(
        job_notes.len(),
        1,
        "VG-RENAME-BRIDGE: exactly one note in Job; got {:?}",
        job_notes.iter().map(|n| &n.id).collect::<Vec<_>>()
    );
    assert_eq!(job_notes[0].id, note_w1.id());
    assert_eq!(
        job_notes[0].folder_path.as_deref(),
        Some("Job"),
        "VG-RENAME-BRIDGE: W1 must have folder_path=='Job'"
    );

    // (c) list_notes(folder=Job/Projects) returns P1
    let job_proj_notes = jin_gui::commands::notes::list_notes_fn(
        root,
        false,
        None,
        Some("Job/Projects".to_string()),
    )
    .expect("VG-RENAME-BRIDGE: list_notes(folder=Job/Projects)");
    assert_eq!(
        job_proj_notes.len(),
        1,
        "VG-RENAME-BRIDGE: exactly one note in Job/Projects"
    );
    assert_eq!(job_proj_notes[0].id, note_p1.id());
    assert_eq!(
        job_proj_notes[0].folder_path.as_deref(),
        Some("Job/Projects"),
        "VG-RENAME-BRIDGE: P1 must have folder_path=='Job/Projects'"
    );

    // (d) get_note(W1).backlinks STILL contains B (link-integrity survives)
    let w1_after = jin_gui::commands::notes::get_note_fn(root, note_w1.id().to_string())
        .expect("VG-RENAME-BRIDGE POST: get_note(W1)");
    assert!(
        w1_after
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-RENAME-BRIDGE POST: W1 must STILL have backlink from B after rename; backlinks={:?}",
        w1_after.backlinks
    );

    // (e) list_dangling empty (no broken edges)
    let dangling = api::list_dangling(root).expect("VG-RENAME-BRIDGE: list_dangling");
    assert!(
        dangling.is_empty(),
        "VG-RENAME-BRIDGE: list_dangling must be empty after rename; dangling={:?}",
        dangling
    );

    // (f) Collision: create Existing folder, try rename Job→Existing → Err
    std::fs::create_dir_all(cfg.notes_dir().join("Existing")).expect("create Existing dir");
    jin_gui::commands::folders::rename_folder_fn(root, "Job".to_string(), "Existing".to_string())
        .expect_err("VG-RENAME-BRIDGE: rename to existing folder must fail");

    // (g) Root rename ""→X → Err
    jin_gui::commands::folders::rename_folder_fn(root, String::new(), "X".to_string())
        .expect_err("VG-RENAME-BRIDGE: root rename must fail");
}

#[test]
fn bridge_notes_properties_search_and_assets_are_verified() {
    use std::collections::BTreeMap;

    use jin_core::model::PropertyValue;
    use jin_gui::commands::{assets, notes};

    let vault = init_root();
    let root = vault.path();
    let note = notes::create_note_fn(
        root,
        notes::NoteInput {
            title: "Bridge Notes".to_string(),
            body: "unindexed body".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note through bridge");

    let mut properties = BTreeMap::new();
    properties.insert(
        "topic".to_string(),
        PropertyValue::String("bridge-search-keyword".to_string()),
    );
    let updated = notes::set_note_properties_fn(
        root,
        note.id.clone(),
        notes::NotePropertiesInput {
            properties,
            expected_revision: note.revision,
        },
    )
    .expect("set strict properties through bridge");
    assert_eq!(
        updated.properties.expect("properties returned")["topic"],
        PropertyValue::String("bridge-search-keyword".to_string())
    );
    assert_eq!(
        notes::search_notes_fn(root, "bridge-search-keyword".to_string())
            .expect("search Notes bridge")
            .iter()
            .map(|result| result.id.as_str())
            .collect::<Vec<_>>(),
        vec![note.id.as_str()]
    );
    assert_eq!(
        notes::list_note_revisions_fn(root, note.id.clone()).expect("list recovery snapshots"),
        vec![1]
    );

    let source = root.join("bridge-asset.png");
    std::fs::write(&source, b"verified bridge asset").expect("write attachment source");
    let attachment =
        assets::import_attachment_fn(root, source.to_string_lossy().to_string()).expect("import");
    assert_eq!(attachment.mime, "image/png");
    assert_eq!(
        assets::list_attachments_fn(root)
            .expect("list verified attachments")
            .iter()
            .map(|entry| entry.sha256.as_str())
            .collect::<Vec<_>>(),
        vec![attachment.sha256.as_str()]
    );
    let repair = assets::repair_attachments_fn(root).expect("repair verified attachments");
    assert!(repair.added.is_empty());
    assert!(repair.missing.is_empty());
    assert!(repair.invalid.is_empty());
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-DELETE-BRIDGE — delete_folder round-trip with real attach edge
// ──────────────────────────────────────────────────────────────────────────────

/// VG-DELETE-BRIDGE: create W1 in Work, P1 in Work/Projects, B in root with a
/// REAL attach edge B→W1; delete Work; verify:
///   (a) W1 and P1 have folder_path==""
///   (b) notes/Work gone
///   (c) get_note(W1).backlinks contains B (ULID survives)
///   (d) moved==2; list_dangling empty
///   (e) nested: note in A/B/C, delete A/B → folder_path=="A"
///   (f) root delete ""→Err
#[test]
fn vg_delete_bridge_link_integrity_after_folder_delete() {
    use jin_core::ops::{api, attach};

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // 1. Create W1 in Work
    let note_w1 = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Work Note 1".to_string(),
            body: "content of W1".to_string(),
            tags: vec![],
            folder: "Work".to_string(),
        },
    )
    .expect("VG-DELETE-BRIDGE: create W1 in Work");
    api::refresh(root).expect("refresh after W1");

    // 2. Create P1 in Work/Projects
    let note_p1 = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Project Note 1".to_string(),
            body: "content of P1".to_string(),
            tags: vec![],
            folder: "Work/Projects".to_string(),
        },
    )
    .expect("VG-DELETE-BRIDGE: create P1 in Work/Projects");
    api::refresh(root).expect("refresh after P1");

    // 3. Create B in root
    let note_b = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Backlink Source".to_string(),
            body: "B references W1".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("VG-DELETE-BRIDGE: create B in root");
    api::refresh(root).expect("refresh after B");

    // 4. Seed a REAL attach edge B→W1
    attach::attach_note(root, note_b.id(), note_w1.id(), None)
        .expect("VG-DELETE-BRIDGE: attach B→W1 must succeed");
    api::refresh(root).expect("refresh after attach");

    // PRE-ASSERT: W1 must already have a backlink from B
    let w1_before = jin_gui::commands::notes::get_note_fn(root, note_w1.id().to_string())
        .expect("VG-DELETE-BRIDGE PRE: get_note(W1)");
    assert!(
        w1_before
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-DELETE-BRIDGE PRE: W1 must have backlink from B before delete; backlinks={:?}",
        w1_before.backlinks
    );

    // 5. Delete Work
    let moved = jin_gui::commands::folders::delete_folder_fn(root, "Work".to_string())
        .expect("VG-DELETE-BRIDGE: delete_folder Work must succeed");

    // (a) moved==2 (W1 + P1)
    assert_eq!(
        moved, 2,
        "VG-DELETE-BRIDGE: delete_folder must return moved==2; got {moved}"
    );

    // (b) notes/Work gone
    assert!(
        !cfg.notes_dir().join("Work").exists(),
        "VG-DELETE-BRIDGE: notes/Work/ must be gone after delete"
    );

    // (a) W1 folder_path==""
    let w1_after = jin_gui::commands::notes::get_note_fn(root, note_w1.id().to_string())
        .expect("VG-DELETE-BRIDGE POST: get_note(W1)");
    assert_eq!(
        w1_after.folder_path.as_deref(),
        Some(""),
        "VG-DELETE-BRIDGE POST: W1 must have folder_path=='' after delete"
    );

    // (a) P1 folder_path==""
    let p1_after = jin_gui::commands::notes::get_note_fn(root, note_p1.id().to_string())
        .expect("VG-DELETE-BRIDGE POST: get_note(P1)");
    assert_eq!(
        p1_after.folder_path.as_deref(),
        Some(""),
        "VG-DELETE-BRIDGE POST: P1 must have folder_path=='' after delete"
    );

    // (c) W1 backlinks STILL contains B (link-integrity survives)
    assert!(
        w1_after
            .backlinks
            .iter()
            .any(|bl| bl.source_id == note_b.id()),
        "VG-DELETE-BRIDGE POST: W1 must STILL have backlink from B; backlinks={:?}",
        w1_after.backlinks
    );

    // (d) list_dangling empty
    let dangling = api::list_dangling(root).expect("VG-DELETE-BRIDGE: list_dangling");
    assert!(
        dangling.is_empty(),
        "VG-DELETE-BRIDGE: list_dangling must be empty after delete; dangling={:?}",
        dangling
    );

    // (e) Nested delete: note in A/B/C, delete A/B → note folder_path=="A"
    let tmp2 = init_root();
    let root2 = tmp2.path();
    let cfg2 = jin_core::Config::load(root2).expect("load config2");
    let note_abc = jin_core::ops::notes::create_note(
        &cfg2.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Deep Note".to_string(),
            body: "deep content".to_string(),
            tags: vec![],
            folder: "A/B/C".to_string(),
        },
    )
    .expect("VG-DELETE-BRIDGE NESTED: create note in A/B/C");
    api::refresh(root2).expect("refresh after A/B/C note");

    jin_gui::commands::folders::delete_folder_fn(root2, "A/B".to_string())
        .expect("VG-DELETE-BRIDGE NESTED: delete A/B must succeed");

    let note_abc_after = jin_gui::commands::notes::get_note_fn(root2, note_abc.id().to_string())
        .expect("VG-DELETE-BRIDGE NESTED: get note after delete A/B");
    assert_eq!(
        note_abc_after.folder_path.as_deref(),
        Some("A"),
        "VG-DELETE-BRIDGE NESTED: A/B/C note must have folder_path=='A' after delete A/B"
    );
    assert!(
        !cfg2.notes_dir().join("A/B").exists(),
        "VG-DELETE-BRIDGE NESTED: notes/A/B must be gone"
    );

    // (f) Root delete ""→Err
    jin_gui::commands::folders::delete_folder_fn(root, String::new())
        .expect_err("VG-DELETE-BRIDGE: root delete must fail");
}

/// `auth_status` on an uninitialized root must return code 7 (integrity).
#[test]
fn bridge_error_auth_status_uninitialized_returns_code_7() {
    let tmp = TempDir::new().expect("create temp dir");

    let err = jin_gui::commands::auth::auth_status_fn(tmp.path())
        .expect_err("must fail on uninitialized root");

    assert_eq!(err.code, 7, "NotInitialized must map to code 7");
    assert_eq!(err.kind, "integrity");
}

/// Invalid edge type must return code 2 (usage).
#[test]
fn bridge_error_invalid_edge_type_maps_to_code_2() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Create a note and a task to try linking.
    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "my note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note");
    jin_core::ops::api::refresh(root).expect("refresh");

    let err = jin_gui::commands::link::link_fn(
        root,
        note.id().to_string(),
        note.id().to_string(), // self-link is semantically wrong but the edge-type error fires first
        "bad-edge-type".to_string(),
    )
    .expect_err("invalid edge type must fail");

    assert_eq!(err.code, 2, "invalid edge type must map to code 2 (usage)");
    assert_eq!(err.kind, "usage");
}

// ──────────────────────────────────────────────────────────────────────────────
// Command shape tests — round-trip through create → list/get
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn bridge_create_note_round_trip() {
    let tmp = init_root();

    let dto = jin_gui::commands::notes::create_note_fn(
        tmp.path(),
        jin_gui::commands::notes::NoteInput {
            title: "Hello Bridge".to_string(),
            body: "body text".to_string(),
            tags: vec!["tag1".to_string()],
            folder: String::new(),
        },
    )
    .expect("create_note must succeed");

    assert!(!dto.id.is_empty(), "NoteDto must have an id");
    assert_eq!(dto.title, "Hello Bridge");
    assert_eq!(dto.tags, vec!["tag1"]);

    // get_note must return the same DTO
    let fetched =
        jin_gui::commands::notes::get_note_fn(tmp.path(), dto.id.clone()).expect("get_note");
    assert_eq!(fetched.id, dto.id);
    assert_eq!(fetched.title, dto.title);
}

// ── Wave 1 — VG1.1: body_markdown flows through get_note (anti-shallow) ──────

/// VG1.1 — create a note with a body → rebuild index → call get_note →
/// body_markdown must be Some and contain the original body.
#[test]
fn vg1_1_get_note_returns_body_markdown() {
    let tmp = init_root();
    let body = "line1\nline2\nThis is real content.";

    let created = jin_gui::commands::notes::create_note_fn(
        tmp.path(),
        jin_gui::commands::notes::NoteInput {
            title: "Body Test".to_string(),
            body: body.to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create_note must succeed");

    // create_note_fn already calls api::refresh, so the index is up-to-date.
    let fetched =
        jin_gui::commands::notes::get_note_fn(tmp.path(), created.id.clone()).expect("get_note");

    let bm = fetched
        .body_markdown
        .as_deref()
        .expect("VG1.1: body_markdown must be Some after get_note");
    assert!(
        !bm.is_empty(),
        "VG1.1: body_markdown must be non-empty (got empty string)"
    );
    assert!(
        bm.contains("real content"),
        "VG1.1: body_markdown must contain the original body text, got: {:?}",
        bm
    );
}

/// VG1.3 — edit the on-disk body WITHOUT rebuilding the index; get_note must
/// return the new body (proves disk-read, not index projection).
#[test]
fn vg1_3_get_note_reads_body_from_disk_not_index() {
    let tmp = init_root();
    let root = tmp.path();

    // 1. Create a note.
    let created = jin_gui::commands::notes::create_note_fn(
        root,
        jin_gui::commands::notes::NoteInput {
            title: "Disk Read Test".to_string(),
            body: "original body".to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create_note must succeed");

    // 2. Directly overwrite the file on disk (bypass the index).
    let cfg = jin_core::Config::load(root).expect("load config");
    let note_path = cfg
        .notes_dir()
        .read_dir()
        .expect("read notes dir")
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with(&created.id))
        .expect("note file must exist")
        .path();

    let original_content = std::fs::read_to_string(&note_path).expect("read note file");
    // Replace the body section (everything after the closing ---).
    let new_body = "DISK_EDITED: completely different body text";
    let updated_content = if let Some(pos) = original_content.rfind("---\n") {
        format!("{}---\n{}", &original_content[..pos], new_body)
    } else {
        panic!("could not find frontmatter end in note file");
    };
    std::fs::write(&note_path, &updated_content).expect("write updated note");

    // 3. Call get_note WITHOUT rebuilding the index.
    let fetched =
        jin_gui::commands::notes::get_note_fn(root, created.id.clone()).expect("get_note");

    let bm = fetched
        .body_markdown
        .as_deref()
        .expect("VG1.3: body_markdown must be Some");
    assert!(
        bm.contains("DISK_EDITED"),
        "VG1.3: get_note must read the updated body from disk (not from the index), got: {:?}",
        bm
    );
    assert!(
        !bm.contains("original body"),
        "VG1.3: get_note must NOT return the stale index value"
    );
}

// ── Wave 1 — VG2.2: excerpt flows from schema → rebuild → query → DTO ────────

/// VG2.2 (anti-shallow) — create a note with a multi-line body → rebuild →
/// list_notes → the note's excerpt must equal derive_excerpt(body).
#[test]
fn vg2_2_list_notes_excerpt_round_trip() {
    let tmp = init_root();

    let body = "# My Note\n\nFirst paragraph.\nSecond line of content.";

    jin_gui::commands::notes::create_note_fn(
        tmp.path(),
        jin_gui::commands::notes::NoteInput {
            title: "Excerpt Round-Trip".to_string(),
            body: body.to_string(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create_note must succeed");
    // create_note_fn calls api::refresh, so the index has the excerpt.

    let notes = jin_gui::commands::notes::list_notes_fn(tmp.path(), false, None, None)
        .expect("list_notes must succeed");

    let note = notes
        .iter()
        .find(|n| n.title == "Excerpt Round-Trip")
        .expect("created note must appear in list");

    let excerpt = note
        .excerpt
        .as_deref()
        .expect("VG2.2: excerpt must be Some on list path");
    assert!(
        !excerpt.is_empty(),
        "VG2.2: excerpt must be non-empty for a note with a body"
    );
    assert!(
        !excerpt.contains('\n'),
        "VG2.2: excerpt must have newlines collapsed"
    );
    assert!(
        excerpt.len() <= 200 * 4, // 200 chars × max 4 bytes/char (generous bound)
        "VG2.2: excerpt must not exceed 200 chars, got {} bytes",
        excerpt.len()
    );
}

#[test]
fn bridge_create_task_round_trip() {
    let tmp = init_root();

    let dto = jin_gui::commands::tasks::create_task_fn(
        tmp.path(),
        jin_gui::commands::tasks::TaskInput {
            title: "Write tests".to_string(),
            body: String::new(),
            priority: Some("high".to_string()),
            due: None,
            list: Some("work".to_string()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("create_task must succeed");

    assert!(!dto.id.is_empty());
    assert_eq!(dto.title, "Write tests");
    assert_eq!(dto.priority, "high");
    assert_eq!(dto.list, "work");

    // get_task round-trip
    let fetched =
        jin_gui::commands::tasks::get_task_fn(tmp.path(), dto.id.clone()).expect("get_task");
    assert_eq!(fetched.id, dto.id);
}

#[test]
fn bridge_task_status_transition() {
    let tmp = init_root();

    let task = jin_gui::commands::tasks::create_task_fn(
        tmp.path(),
        jin_gui::commands::tasks::TaskInput {
            title: "My task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("create");

    assert_eq!(task.status, "todo");

    let started = jin_gui::commands::tasks::set_task_status_fn(
        tmp.path(),
        task.id.clone(),
        "doing".to_string(),
    )
    .expect("transition todo→doing");
    assert_eq!(started.status, "doing");

    let done = jin_gui::commands::tasks::set_task_status_fn(
        tmp.path(),
        task.id.clone(),
        "done".to_string(),
    )
    .expect("transition doing→done");
    assert_eq!(done.status, "done");
    assert!(done.completed_at.is_some(), "completed_at must be set");
}

#[test]
fn bridge_create_event_round_trip() {
    let tmp = init_root();

    let dto = jin_gui::commands::events::create_event_fn(
        tmp.path(),
        jin_gui::commands::events::EventInput {
            title: "Team standup".to_string(),
            start: "2026-06-27T09:00:00".to_string(),
            end: "2026-06-27T09:30:00".to_string(),
            tzid: None, // floating
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
    )
    .expect("create_event");

    assert!(!dto.id.is_empty());
    assert_eq!(dto.title, "Team standup");
    assert!(dto.floating, "no tzid means floating");

    // get_event
    let fetched =
        jin_gui::commands::events::get_event_fn(tmp.path(), dto.id.clone()).expect("get_event");
    assert_eq!(fetched.id, dto.id);
}

#[test]
fn bridge_custom_recurrence_compiles_persists_and_previews() {
    use jin_core::recurrence::{
        MonthlyRecurrence, RecurrenceDraft, RecurrenceEnd, RecurrenceFrequency, RecurrenceWeekday,
    };

    let draft = RecurrenceDraft {
        frequency: RecurrenceFrequency::Monthly,
        interval: 2,
        weekly_days: Vec::new(),
        monthly: Some(MonthlyRecurrence::NthWeekday {
            ordinal: -1,
            weekday: RecurrenceWeekday::Th,
        }),
        end: RecurrenceEnd::Count { count: 6 },
    };
    let preview = jin_gui::commands::events::preview_recurrence_fn(
        jin_gui::commands::events::RecurrencePreviewInput {
            start: "2026-08-27T09:00:00".to_string(),
            tzid: Some("America/Sao_Paulo".to_string()),
            is_all_day: false,
            recurrence: draft.clone(),
        },
    )
    .unwrap();
    assert_eq!(preview.occurrences.len(), 3);
    assert_eq!(
        preview.recurrence,
        vec!["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=-1TH;COUNT=6"]
    );

    let tmp = init_root();
    let error = jin_gui::commands::events::create_event_fn(
        tmp.path(),
        jin_gui::commands::events::EventInput {
            title: "Last Thursday review".to_string(),
            start: "2026-08-27T09:00:00".to_string(),
            end: "2026-08-27T10:00:00".to_string(),
            tzid: Some("America/Sao_Paulo".to_string()),
            is_all_day: false,
            description: None,
            location: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
            recurrence: Some(draft),
        },
    )
    .unwrap_err();
    assert!(error.message.contains("require a writable Google Calendar"));
}

#[test]
fn bridge_event_edit_token_result_and_typed_stale_conflict() {
    use jin_gui::commands::events::EditEventInput;
    use jin_gui::error::JinErrorDetails;

    let tmp = init_root();
    let created = jin_gui::commands::events::create_event_fn(
        tmp.path(),
        jin_gui::commands::events::EventInput {
            title: "Quiet planning".to_string(),
            start: "2026-08-26T09:00:00".to_string(),
            end: "2026-08-26T10:00:00".to_string(),
            tzid: None,
            is_all_day: false,
            description: Some("Draft agenda".to_string()),
            location: Some("Studio".to_string()),
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
            recurrence: None,
        },
    )
    .unwrap();
    let detail =
        jin_gui::commands::events::get_event_detail_fn(tmp.path(), created.id.clone()).unwrap();
    assert!(detail.edit_token.starts_with("sha256:"));

    let no_op = jin_gui::commands::events::edit_event_fn(
        tmp.path(),
        EditEventInput {
            event_id: created.id.clone(),
            edit_token: detail.edit_token.clone(),
            operation_id: "bridge-edit-no-op".to_string(),
            title: created.title.clone(),
            start: created.start.clone(),
            end: created.end.clone(),
            tzid: None,
            is_all_day: false,
            description: created.description.clone(),
            location: created.location.clone(),
            attendees: created.attendees.clone(),
            attendees_omitted: None,
            conference_data: created.conference_data.clone(),
            clear_conference_data: false,
            reminders: created.reminders.clone(),
            recurrence_scope: None,
        },
    )
    .unwrap();
    assert!(no_op.no_op);

    let cfg = jin_core::Config::load(tmp.path()).unwrap();
    let mut changed = jin_core::ops::events::get_event(&cfg.events_dir(), &created.id).unwrap();
    changed.frontmatter.title = "Changed elsewhere".to_string();
    jin_core::store::fs::write_event(&cfg.events_dir(), &changed).unwrap();
    let stale = jin_gui::commands::events::edit_event_fn(
        tmp.path(),
        EditEventInput {
            event_id: created.id.clone(),
            edit_token: detail.edit_token,
            operation_id: "bridge-edit-stale".to_string(),
            title: "My draft".to_string(),
            start: created.start,
            end: created.end,
            tzid: None,
            is_all_day: false,
            description: created.description,
            location: created.location,
            attendees: created.attendees,
            attendees_omitted: None,
            conference_data: created.conference_data,
            clear_conference_data: false,
            reminders: created.reminders,
            recurrence_scope: None,
        },
    )
    .unwrap_err();
    assert_eq!(stale.kind, "sync_conflict");
    assert!(matches!(
        stale.details,
        Some(JinErrorDetails::StaleEvent { ref event_id }) if event_id == &created.id
    ));
}

fn bridge_time_block(
    root: &std::path::Path,
    operation_id: &str,
) -> (jin_core::model::Task, jin_core::model::Event) {
    let cfg = jin_core::Config::load(root).unwrap();
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Bridge Time block".to_string(),
            ..Default::default()
        },
    )
    .unwrap();
    let event = jin_core::ops::promote::promote_with_operation_id(
        root,
        task.id(),
        jin_core::ops::promote::PromoteParams {
            start_dt: chrono::NaiveDateTime::parse_from_str(
                "2026-08-26T09:00:00",
                "%Y-%m-%dT%H:%M:%S",
            )
            .unwrap(),
            tzid: None,
        },
        operation_id,
    )
    .unwrap();
    (task, event)
}

#[test]
fn bridge_event_detail_capability_matrix() {
    use jin_core::dto::{EventDisplayKind, EventReadOnlyReason};
    use jin_core::model::{EventSource, EventStatus};

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).unwrap();
    let plain = jin_gui::commands::events::create_event_fn(
        root,
        jin_gui::commands::events::EventInput {
            title: "Plain event".to_string(),
            start: "2026-08-26T11:00:00".to_string(),
            end: "2026-08-26T12:00:00".to_string(),
            tzid: None,
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
    )
    .unwrap();
    let detail = jin_gui::commands::events::get_event_detail_fn(root, plain.id.clone()).unwrap();
    assert_eq!(detail.event.id, plain.id);
    assert_eq!(detail.capabilities.display_kind, EventDisplayKind::Event);
    assert!(detail.capabilities.can_edit);

    let (_task, block) = bridge_time_block(root, "detail-time-block");
    let detail =
        jin_gui::commands::events::get_event_detail_fn(root, block.id().to_string()).unwrap();
    assert_eq!(
        detail.capabilities.display_kind,
        EventDisplayKind::TimeBlock
    );
    assert!(detail.capabilities.can_return_task_to_flexible);
    assert!(detail.capabilities.originating_task.is_some());

    let mut cancelled = jin_core::ops::events::get_event(&cfg.events_dir(), &plain.id).unwrap();
    cancelled.frontmatter.status = EventStatus::Cancelled;
    jin_core::store::fs::write_event(&cfg.events_dir(), &cancelled).unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    let detail = jin_gui::commands::events::get_event_detail_fn(root, plain.id.clone()).unwrap();
    assert_eq!(
        detail.capabilities.read_only_reason,
        Some(EventReadOnlyReason::Cancelled)
    );

    let mut recurring = cancelled.clone();
    recurring.frontmatter.id = jin_core::id::new_ulid();
    recurring.frontmatter.status = EventStatus::Confirmed;
    recurring.frontmatter.recurrence = vec!["RRULE:FREQ=WEEKLY".to_string()];
    jin_core::store::fs::write_event(&cfg.events_dir(), &recurring).unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    let detail =
        jin_gui::commands::events::get_event_detail_fn(root, recurring.id().to_string()).unwrap();
    assert_eq!(
        detail.capabilities.read_only_reason,
        Some(EventReadOnlyReason::RecurringMilestone1)
    );
    assert!(!detail.capabilities.can_edit);
    assert!(detail.capabilities.recurrence_pattern_supported);
    assert_eq!(detail.capabilities.recurrence_scopes, Vec::<String>::new());

    let mut external = recurring.clone();
    external.frontmatter.id = jin_core::id::new_ulid();
    external.frontmatter.recurrence.clear();
    external.frontmatter.source = EventSource::Google;
    external.frontmatter.authority = EventSource::Google;
    jin_core::store::fs::write_event(&cfg.events_dir(), &external).unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    let detail =
        jin_gui::commands::events::get_event_detail_fn(root, external.id().to_string()).unwrap();
    assert_eq!(
        detail.capabilities.read_only_reason,
        Some(EventReadOnlyReason::ExternalAuthorityOrSource)
    );
}

#[test]
fn bridge_remove_time_block_only_and_return() {
    use jin_core::model::AgendaBucket;

    for return_to_flexible in [false, true] {
        let tmp = init_root();
        let root = tmp.path();
        let (task, event) = bridge_time_block(root, "remove-setup");
        let result = jin_gui::commands::events::remove_time_block_fn(
            root,
            jin_gui::commands::events::RemoveTimeBlockInput {
                event_id: event.id().to_string(),
                return_to_flexible,
                operation_id: format!("bridge-remove-{return_to_flexible}"),
            },
        )
        .unwrap();
        assert_eq!(result.event.status, "cancelled");
        assert_eq!(
            result
                .originating_task
                .as_ref()
                .and_then(|task| task.agenda_bucket.as_deref()),
            return_to_flexible.then_some("flexible")
        );
        let canonical = jin_core::ops::tasks::get_task(&root.join("tasks"), task.id()).unwrap();
        assert_eq!(
            canonical.frontmatter.agenda_bucket,
            return_to_flexible.then_some(AgendaBucket::Flexible)
        );
    }
}

#[test]
fn bridge_remove_time_block_structured_validation_stale_and_blocked_errors() {
    use jin_gui::error::JinErrorDetails;

    let tmp = init_root();
    let root = tmp.path();
    let (task, event) = bridge_time_block(root, "error-setup");
    let invalid = jin_gui::commands::events::remove_time_block_fn(
        root,
        jin_gui::commands::events::RemoveTimeBlockInput {
            event_id: event.id().to_string(),
            return_to_flexible: false,
            operation_id: String::new(),
        },
    )
    .unwrap_err();
    assert!(matches!(
        invalid.details,
        Some(JinErrorDetails::Validation { ref field, .. }) if field == "operation_id"
    ));

    let cfg = jin_core::Config::load(root).unwrap();
    let mut another = jin_core::ops::events::get_event(&cfg.events_dir(), event.id()).unwrap();
    another.frontmatter.id = jin_core::id::new_ulid();
    another.frontmatter.derived_from = Some(task.id().to_string());
    jin_core::store::fs::write_event(&cfg.events_dir(), &another).unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    let stale = jin_gui::commands::events::remove_time_block_fn(
        root,
        jin_gui::commands::events::RemoveTimeBlockInput {
            event_id: event.id().to_string(),
            return_to_flexible: true,
            operation_id: "stale-return".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(stale.kind, "sync_conflict");
    assert!(matches!(
        stale.details,
        Some(JinErrorDetails::OperationConflict { ref operation_id, .. })
            if operation_id == "stale-return"
    ));

    let blocked_dir = root.join(".jin/operations/persisted-blocked");
    std::fs::create_dir_all(&blocked_dir).unwrap();
    std::fs::write(
        blocked_dir.join("operation.json"),
        serde_json::to_vec(&serde_json::json!({
            "operation_id": "persisted-blocked",
            "kind": "test",
            "state": "blocked",
            "decision": "roll_forward",
            "result_event_id": event.id(),
            "targets": [],
            "conflict_path": "tasks/conflict.md"
        }))
        .unwrap(),
    )
    .unwrap();
    let blocked = jin_gui::commands::events::remove_time_block_fn(
        root,
        jin_gui::commands::events::RemoveTimeBlockInput {
            event_id: event.id().to_string(),
            return_to_flexible: false,
            operation_id: "blocked-remove".to_string(),
        },
    )
    .unwrap_err();
    assert_eq!(blocked.kind, "integrity");
    assert!(matches!(
        blocked.details,
        Some(JinErrorDetails::OperationBlocked { ref operation_id, .. })
            if operation_id == "persisted-blocked"
    ));
}

#[test]
fn bridge_capture_note() {
    let tmp = init_root();

    let result = jin_gui::commands::capture::capture_fn(
        tmp.path(),
        "quick thought".to_string(),
        false,
        None,
    )
    .expect("capture note");

    assert_eq!(result.kind, "note");
    assert!(!result.id.is_empty());
}

#[test]
fn bridge_capture_task() {
    let tmp = init_root();

    let result = jin_gui::commands::capture::capture_fn(
        tmp.path(),
        "call dentist".to_string(),
        true,
        Some("personal".to_string()),
    )
    .expect("capture task");

    assert_eq!(result.kind, "task");
    assert!(!result.id.is_empty());
}

#[test]
fn bridge_promote_and_attach_round_trip() {
    use jin_core::ops::api;

    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Create task + note.
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Prepare presentation".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("create task");
    api::refresh(root).expect("refresh");

    let note = jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Slide outline".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note");
    api::refresh(root).expect("refresh");

    // Promote.
    let event = jin_gui::commands::promote::promote_task_fn(
        root,
        task.id().to_string(),
        jin_gui::commands::promote::TemporalSlot {
            when: "2026-06-28T14:00:00".to_string(),
            tzid: None,
        },
        "bridge-promote-round-trip".to_string(),
    )
    .expect("promote_task");
    assert_eq!(event.derived_from.as_deref(), Some(task.id()));

    // Attach note to event.
    let link = jin_gui::commands::attach::attach_note_fn(
        root,
        note.id().to_string(),
        event.id.clone(),
        None, // default: prep-for
    )
    .expect("attach_note");
    assert_eq!(link.edge_type, "prep-for");
    assert_eq!(link.source_id, note.id());
    assert_eq!(link.target_id, event.id);

    // M1 Related uses the core-supported Note → Event references direction.
    let related = jin_gui::commands::link::link_fn(
        root,
        note.id().to_string(),
        event.id.clone(),
        "references".to_string(),
    )
    .expect("link related note to event");
    assert_eq!(related.source_id, note.id());
    assert_eq!(related.target_id, event.id);
    let detail = jin_gui::commands::events::get_event_detail_fn(root, event.id.clone())
        .expect("get refreshed event detail");
    assert!(detail
        .event
        .backlinks
        .iter()
        .any(|backlink| { backlink.source_id == note.id() && backlink.edge_type == "references" }));
}

#[test]
fn bridge_export_creates_files() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed a note.
    jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "Export test note".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create note");
    jin_core::ops::api::refresh(root).expect("refresh");

    let dest = root.join("export-out");
    let result = jin_gui::commands::export::export_fn(root, dest.display().to_string(), false)
        .expect("export");

    assert!(result.file_count > 0, "export must copy at least one file");
    assert!(dest.exists(), "export destination must be created");
}

#[test]
fn bridge_app_config_returns_config() {
    let tmp = init_root();

    let cfg = jin_gui::commands::export::app_config_fn(tmp.path()).expect("app_config");
    assert_eq!(cfg.schema_version, 1);
    assert!(!cfg.display_tz.is_empty());
}

// ──────────────────────────────────────────────────────────────────────────────
// resolve_root_impl + auto-init integration tests (VG-GUI-ROOT-1 … ROOT-4)
//
// These prove the MUST fix: the startup root path was never tested before.
// ──────────────────────────────────────────────────────────────────────────────

/// JIN_ROOT env override is the highest-priority input (VG-GUI-ROOT-1).
#[test]
fn resolve_root_impl_jin_root_env_takes_precedence() {
    use jin_gui::root_resolver::resolve_root_impl;
    use tempfile::TempDir;

    let override_dir = TempDir::new().expect("create override dir");
    let home_dir = TempDir::new().expect("create home dir");

    let result = resolve_root_impl(
        Some(override_dir.path().to_str().unwrap()),
        Some(home_dir.path()),
        None,
    );
    assert_eq!(
        result,
        override_dir.path(),
        "JIN_ROOT must override home default"
    );
}

/// Persisted store path beats the ~/Jin default (VG-GUI-ROOT-2).
#[test]
fn resolve_root_impl_persisted_beats_default() {
    use jin_gui::root_resolver::{resolve_root_impl, write_persisted_root};
    use tempfile::TempDir;

    let config_dir = TempDir::new().expect("config dir");
    let home_dir = TempDir::new().expect("home dir");

    // Persist a custom store path.
    let custom_store = config_dir.path().join("custom-jin-store");
    write_persisted_root(config_dir.path(), custom_store.to_str().unwrap())
        .expect("write persisted root");

    let result = resolve_root_impl(None, Some(home_dir.path()), Some(config_dir.path()));
    assert_eq!(
        result, custom_store,
        "persisted path must beat the ~/Jin default"
    );
}

/// No env, no persisted → ~/Jin default (VG-GUI-ROOT-3).
#[test]
fn resolve_root_impl_defaults_to_home_jin() {
    use jin_gui::root_resolver::resolve_root_impl;
    use tempfile::TempDir;

    let home_dir = TempDir::new().expect("home dir");
    let result = resolve_root_impl(None, Some(home_dir.path()), None);
    assert_eq!(
        result,
        home_dir.path().join("Jin"),
        "default root must be <home>/Jin, not cwd"
    );
}

/// Auto-init on a fresh ~/Jin produces a working root: today_agenda succeeds
/// (no "not initialized" / exit-code 7).  This is the lesson — startup root
/// path was never tested (VG-GUI-ROOT-4).
#[test]
fn auto_init_on_fresh_default_root_yields_working_today_agenda() {
    use tempfile::TempDir;

    // Use a temp dir as stand-in for ~/Jin (prevents touching the real home).
    let home = TempDir::new().expect("home dir");
    let root = home.path().join("Jin");

    // Simulate what main() does: resolve + init.
    jin_core::ops::init(&root).expect("ops::init must succeed on a fresh dir");

    // Verify the store is functional — today_agenda must not return code 7.
    jin_gui::commands::agenda::today_agenda_fn(&root, None)
        .expect("today_agenda must succeed after auto-init — not-initialized bug is fixed");
}

/// Auto-init is idempotent: calling init twice does not corrupt the store
/// and today_agenda still succeeds (VG-GUI-ROOT-5).
#[test]
fn auto_init_idempotent_on_existing_root() {
    use tempfile::TempDir;

    let home = TempDir::new().expect("home dir");
    let root = home.path().join("Jin");

    // First init.
    jin_core::ops::init(&root).expect("first init");
    // Create a sentinel note to confirm data survives the second init.
    let cfg = jin_core::Config::load(&root).expect("load config");
    jin_core::ops::notes::create_note(
        &cfg.notes_dir(),
        jin_core::ops::notes::CreateNoteParams {
            title: "sentinel".to_string(),
            body: String::new(),
            tags: vec![],
            folder: String::new(),
        },
    )
    .expect("create sentinel note");

    // Second init (simulates app relaunch on an already-initialized root).
    jin_core::ops::init(&root).expect("second init — must be idempotent");

    // Store must still be functional.
    jin_gui::commands::agenda::today_agenda_fn(&root, None)
        .expect("today_agenda must still succeed after second init");
}

// ──────────────────────────────────────────────────────────────────────────────
// JinErrorDto mapping unit tests (supplement error.rs inline tests)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn error_dto_serializes_correctly() {
    let dto = jin_gui::error::JinErrorDto {
        code: 3,
        kind: "not_found".to_string(),
        message: "note/abc not found".to_string(),
        retriable: false,
        details: None,
    };
    let json = serde_json::to_value(&dto).expect("serialize JinErrorDto");
    assert_eq!(json["code"], 3);
    assert_eq!(json["kind"], "not_found");
    assert_eq!(json["retriable"], false);
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P1 — body fix, complete/reopen, delete (P1 interactive wiring)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P1 body fix: edit_task now passes body through; get_task returns the updated body.
/// Anti-shallow: asserts the new body ACTUALLY comes back from get_task (disk round-trip).
#[test]
fn vg_p1_edit_task_body_fix_persists_and_returns_via_get_task() {
    let tmp = init_root();
    let root = tmp.path();

    // 1. Create a task with an initial body.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Body Fix Task".to_string(),
            body: "initial body".to_string(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P1 BODY-FIX: create_task must succeed");

    // Verify initial body is returned by get_task.
    let fetched_initial = jin_gui::commands::tasks::get_task_fn(root, task.id.clone())
        .expect("VG-P1 BODY-FIX: get_task must succeed after create");
    assert_eq!(
        fetched_initial.body, "initial body",
        "VG-P1 BODY-FIX: get_task must return body on create path"
    );

    // 2. Edit the body via edit_task (the body bug fix: body: Some(...) must be passed through).
    let edited = jin_gui::commands::tasks::edit_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: Some("Updated Title".to_string()),
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: Some("updated body content".to_string()),
            tags: None,
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P1 BODY-FIX: edit_task must succeed");

    assert_eq!(
        edited.title, "Updated Title",
        "VG-P1 BODY-FIX: edit_task must update title"
    );

    // 3. Assert the new body returns via get_task (proves the body fix — not just edit response).
    let fetched_after = jin_gui::commands::tasks::get_task_fn(root, task.id.clone())
        .expect("VG-P1 BODY-FIX: get_task must succeed after edit");

    assert_eq!(
        fetched_after.body, "updated body content",
        "VG-P1 BODY-FIX: get_task must return the updated body (proves body: None bug is fixed)"
    );
    assert_eq!(
        fetched_after.title, "Updated Title",
        "VG-P1 BODY-FIX: get_task must return the updated title"
    );
}

/// VG-P1 complete: set_task_status("done") sets status AND completed_at;
/// reopen (set_task_status("todo")) clears completed_at.
/// Anti-shallow: asserts both fields change (not just that the call succeeded).
#[test]
fn vg_p1_complete_sets_status_and_completed_at_reopen_clears_it() {
    let tmp = init_root();
    let root = tmp.path();

    // Create a todo task.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Complete Me".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P1 COMPLETE: create must succeed");
    assert_eq!(task.status, "todo");
    assert!(
        task.completed_at.is_none(),
        "VG-P1 COMPLETE: new task must have no completed_at"
    );

    // Mark done → status == "done" AND completed_at is set.
    let done =
        jin_gui::commands::tasks::set_task_status_fn(root, task.id.clone(), "done".to_string())
            .expect("VG-P1 COMPLETE: set_task_status(done) must succeed");

    assert_eq!(done.status, "done", "VG-P1 COMPLETE: status must be 'done'");
    assert!(
        done.completed_at.is_some(),
        "VG-P1 COMPLETE: completed_at must be set when status=done"
    );

    // Reopen → status == "todo" AND completed_at is cleared.
    let reopened =
        jin_gui::commands::tasks::set_task_status_fn(root, task.id.clone(), "todo".to_string())
            .expect("VG-P1 COMPLETE: set_task_status(todo) must succeed (reopen)");

    assert_eq!(
        reopened.status, "todo",
        "VG-P1 COMPLETE: status must be 'todo' after reopen"
    );
    assert!(
        reopened.completed_at.is_none(),
        "VG-P1 COMPLETE: completed_at must be cleared on reopen (was Some, must be None)"
    );
}

/// VG-P1 delete: delete_task soft-deletes — status == "deleted" AND deleted_at is set.
/// Anti-shallow: asserts BOTH fields, not just that the call succeeded.
#[test]
fn vg_p1_delete_task_sets_status_deleted_and_deleted_at() {
    let tmp = init_root();
    let root = tmp.path();

    // Create a task.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Delete Me".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P1 DELETE: create must succeed");

    // Soft-delete it.
    let deleted = jin_gui::commands::tasks::delete_task_fn(root, task.id.clone())
        .expect("VG-P1 DELETE: delete_task must succeed");

    assert_eq!(
        deleted.status, "deleted",
        "VG-P1 DELETE: status must be 'deleted' after delete_task"
    );
    assert!(
        deleted.deleted_at.is_some(),
        "VG-P1 DELETE: deleted_at must be set (anti-shallow: proves soft-delete, not just call)"
    );

    // Confirm list_tasks (include_deleted=false) excludes this task.
    let tasks = jin_gui::commands::tasks::list_tasks_fn(root, None, None, None, None, false)
        .expect("VG-P1 DELETE: list_tasks must succeed");
    assert!(
        !tasks.iter().any(|t| t.id == task.id),
        "VG-P1 DELETE: deleted task must NOT appear in list_tasks (include_deleted=false)"
    );
}

/// VG-P1 create-in-place: create_task produces a new task with the typed title.
/// (Rust-level gate; the GUI layer test is in tasks_controller.test.ts.)
#[test]
fn vg_p1_create_task_with_typed_title_appears_in_list() {
    let tmp = init_root();
    let root = tmp.path();

    // Simulate what create-in-place does: create with only a title.
    let created = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Typed From Create-In-Place".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P1 CREATE-IN-PLACE: create must succeed");

    assert_eq!(
        created.title, "Typed From Create-In-Place",
        "VG-P1 CREATE-IN-PLACE: task title must match what was typed"
    );

    // Confirm it appears in list_tasks.
    let tasks = jin_gui::commands::tasks::list_tasks_fn(root, None, None, None, None, false)
        .expect("VG-P1 CREATE-IN-PLACE: list_tasks must succeed");
    assert!(
        tasks.iter().any(|t| t.id == created.id),
        "VG-P1 CREATE-IN-PLACE: new task must appear in list_tasks"
    );
    assert!(
        tasks
            .iter()
            .any(|t| t.title == "Typed From Create-In-Place"),
        "VG-P1 CREATE-IN-PLACE: task with typed title must be in the list"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P3 — First-class Lists (bridge command layer)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P3: list_lists_fn seeds the default Inbox and returns it.
#[test]
fn vg_p3_bridge_list_lists_seeds_inbox() {
    let tmp = init_root();
    let root = tmp.path();

    let lists =
        jin_gui::commands::lists::list_lists_fn(root).expect("VG-P3: list_lists must succeed");

    assert!(
        !lists.is_empty(),
        "VG-P3: list_lists must return at least 1 list"
    );
    let inbox = lists
        .iter()
        .find(|l| l.id == "inbox")
        .expect("VG-P3: inbox list must be present");
    assert_eq!(inbox.name, "Inbox");
    assert!(inbox.is_default, "VG-P3: inbox must have is_default=true");
}

/// VG-P3: delete_list_fn("inbox") must be refused.
#[test]
fn vg_p3_bridge_delete_inbox_refused() {
    let tmp = init_root();
    let root = tmp.path();
    // Seed inbox.
    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    let result = jin_gui::commands::lists::delete_list_fn(root, "inbox".to_string());
    assert!(result.is_err(), "VG-P3: delete_list(inbox) must be refused");
}

/// VG-P3: create_list / edit_list / reorder_list / delete_list end-to-end.
#[test]
fn vg_p3_bridge_crud_persist_and_rebuild() {
    let tmp = init_root();
    let root = tmp.path();
    // Seed inbox.
    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    // Create.
    let dto = jin_gui::commands::lists::create_list_fn(
        root,
        jin_gui::commands::lists::CreateListInput {
            name: "Personal".to_string(),
            color: "sky".to_string(),
            icon: "list".to_string(),
            parent_id: None,
        },
    )
    .expect("VG-P3: create_list must succeed");
    assert_eq!(dto.name, "Personal");
    let list_id = dto.id.clone();

    // Edit.
    let edited = jin_gui::commands::lists::edit_list_fn(
        root,
        list_id.clone(),
        jin_gui::commands::lists::EditListInput {
            name: Some("Personal Tasks".to_string()),
            color: Some("purple".to_string()),
            icon: None,
            view: None,
            sort_mode: None,
            parent_id: None,
        },
    )
    .expect("VG-P3: edit_list must succeed");
    assert_eq!(edited.name, "Personal Tasks");
    assert_eq!(edited.color, "purple");

    // Reorder.
    let original_pos = edited.position.clone();
    let new_pos = jin_core::order::between(None, Some(&original_pos));
    let reordered =
        jin_gui::commands::lists::reorder_list_fn(root, list_id.clone(), new_pos.clone())
            .expect("VG-P3: reorder_list must succeed");
    assert_eq!(reordered.position, new_pos);

    // Verify survives rebuild.
    jin_core::ops::api::refresh(root).unwrap();
    let lists = jin_gui::commands::lists::list_lists_fn(root).unwrap();
    let found = lists
        .iter()
        .find(|l| l.id == list_id)
        .expect("list must survive rebuild");
    assert_eq!(found.name, "Personal Tasks");

    // Delete.
    jin_gui::commands::lists::delete_list_fn(root, list_id.clone())
        .expect("VG-P3: delete_list must succeed");

    let lists_after = jin_gui::commands::lists::list_lists_fn(root).unwrap();
    assert!(
        !lists_after.iter().any(|l| l.id == list_id),
        "deleted list must not appear"
    );
}

/// VG-P3: delete_list reassigns tasks to inbox.
#[test]
fn vg_p3_bridge_delete_list_reassigns_tasks() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).unwrap();
    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    // Create list.
    let list = jin_gui::commands::lists::create_list_fn(
        root,
        jin_gui::commands::lists::CreateListInput {
            name: "Work".to_string(),
            color: "sky".to_string(),
            icon: "list".to_string(),
            parent_id: None,
        },
    )
    .unwrap();
    let list_id = list.id.clone();

    // Create task in that list.
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Work item".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some(list_id.clone()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();
    jin_core::ops::api::refresh(root).unwrap();

    // Delete the list.
    jin_gui::commands::lists::delete_list_fn(root, list_id.clone()).unwrap();

    // Task file must now have list: "inbox".
    let task_path = cfg.tasks_dir().join(format!("{}.md", task.frontmatter.id));
    let updated = jin_core::store::fs::read_task(&task_path).unwrap();
    assert_eq!(
        updated.frontmatter.list, "inbox",
        "VG-P3: task must be reassigned to inbox after list deletion"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P4 — Tags (bridge command layer)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P4: list_tags returns tags with task_count after tagging a task.
#[test]
fn vg_p4_bridge_list_tags_with_count() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).unwrap();

    // Create task and tag it via edit_task.
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Tagged".to_string(),
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
    jin_core::ops::api::refresh(root).unwrap();

    jin_gui::commands::tasks::edit_task_fn(
        root,
        task.frontmatter.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: Some(vec!["urgent".to_string()]),
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P4: edit_task with tags must succeed");

    let tags = jin_gui::commands::tags::list_tags_fn(root).expect("VG-P4: list_tags must succeed");

    let urgent = tags
        .iter()
        .find(|t| t.slug == "urgent")
        .expect("VG-P4: 'urgent' tag must exist in list_tags");
    assert_eq!(urgent.task_count, 1, "VG-P4: urgent tag must have 1 task");
}

/// VG-P4: tag filter returns only tagged tasks.
#[test]
fn vg_p4_bridge_tag_filter_returns_only_tagged() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).unwrap();

    let task1 = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Tagged".to_string(),
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
    let _task2 = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Untagged".to_string(),
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

    jin_gui::commands::tasks::edit_task_fn(
        root,
        task1.frontmatter.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: Some(vec!["email".to_string()]),
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .unwrap();

    let filtered = jin_gui::commands::tasks::list_tasks_fn(
        root,
        None,
        None,
        None,
        Some("email".to_string()),
        false,
    )
    .expect("VG-P4: list_tasks with tag filter must succeed");

    assert_eq!(
        filtered.len(),
        1,
        "VG-P4: tag filter must return only 1 task"
    );
    assert_eq!(
        filtered[0].id, task1.frontmatter.id,
        "VG-P4: filtered task must be the tagged one"
    );
}

/// VG-P4: set_tag_color persists and reload reflects it.
#[test]
fn vg_p4_bridge_set_tag_color_persists() {
    let tmp = init_root();
    let root = tmp.path();

    // Ensure tag exists by tagging a task.
    let cfg = jin_core::Config::load(root).unwrap();
    let task = jin_core::ops::tasks::create_task(
        &cfg.tasks_dir(),
        jin_core::ops::tasks::CreateTaskParams {
            title: "Tagged for color test".to_string(),
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
    jin_gui::commands::tasks::edit_task_fn(
        root,
        task.frontmatter.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: Some(vec!["urgent".to_string()]),
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .unwrap();

    let dto =
        jin_gui::commands::tags::set_tag_color_fn(root, "urgent".to_string(), "danger".to_string())
            .expect("VG-P4: set_tag_color must succeed");
    assert_eq!(
        dto.color, "danger",
        "VG-P4: returned dto.color must be 'danger'"
    );

    // Reload from disk.
    let tag_path = cfg.tags_dir().join("urgent.md");
    let on_disk = jin_core::store::fs::read_tag(&tag_path).unwrap();
    assert_eq!(
        on_disk.frontmatter.color, "danger",
        "VG-P4: tag file color must be persisted as 'danger'"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P5 — Section CRUD bridge tests
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P5-1: create_section → SectionDto returned; persisted in list file; survives rebuild.
#[test]
fn vg_p5_bridge_create_section_persists_and_survives_rebuild() {
    let tmp = init_root();
    let root = tmp.path();

    // Seed a list.
    let list = jin_gui::commands::lists::create_list_fn(
        root,
        jin_gui::commands::lists::CreateListInput {
            name: "Project Alpha".to_string(),
            color: "accent".to_string(),
            icon: "list".to_string(),
            parent_id: None,
        },
    )
    .expect("VG-P5: create_list must succeed");

    // Create a section.
    let sec = jin_gui::commands::lists::create_section_fn(
        root,
        list.id.clone(),
        jin_gui::commands::lists::CreateSectionInput {
            name: "Backlog".to_string(),
        },
    )
    .expect("VG-P5: create_section must succeed");

    assert_eq!(sec.name, "Backlog", "VG-P5: section name must match");
    assert_eq!(
        sec.list_id, list.id,
        "VG-P5: section.list_id must match the owning list"
    );
    assert!(
        !sec.id.is_empty(),
        "VG-P5: section.id must be a non-empty ULID"
    );

    // Assert persisted in list file.
    let cfg = jin_core::Config::load(root).expect("load config");
    let path =
        jin_core::store::fs::find_list_path(&cfg.lists_dir(), &list.id).expect("find list path");
    let on_disk = jin_core::store::fs::read_list(&path).expect("read list");
    assert_eq!(
        on_disk.frontmatter.sections.len(),
        1,
        "VG-P5: one section must be on disk"
    );
    assert_eq!(on_disk.frontmatter.sections[0].name, "Backlog");

    // Survives rebuild.
    jin_core::ops::api::refresh(root).expect("rebuild");
    let lists = jin_gui::commands::lists::list_lists_fn(root).expect("list_lists after rebuild");
    let found = lists
        .iter()
        .find(|l| l.id == list.id)
        .expect("list must still exist");
    assert_eq!(
        found.sections.len(),
        1,
        "VG-P5: section must survive rebuild"
    );
    assert_eq!(found.sections[0].name, "Backlog");
}

/// VG-P5-2: delete_section → SectionEntry gone AND affected tasks have section_id=None on disk.
#[test]
fn vg_p5_bridge_delete_section_clears_tasks() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed a list.
    let list = jin_gui::commands::lists::create_list_fn(
        root,
        jin_gui::commands::lists::CreateListInput {
            name: "Sprint".to_string(),
            color: "sky".to_string(),
            icon: "list".to_string(),
            parent_id: None,
        },
    )
    .expect("VG-P5: create_list");

    // Create a section.
    let sec = jin_gui::commands::lists::create_section_fn(
        root,
        list.id.clone(),
        jin_gui::commands::lists::CreateSectionInput {
            name: "Doing".to_string(),
        },
    )
    .expect("VG-P5: create_section");

    // Create a task in this list and assign it to the section.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Task in section".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some(list.id.clone()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P5: create_task");

    jin_gui::commands::tasks::edit_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: None,
            section_id: Some(sec.id.clone()),
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P5: edit_task section_id must succeed");

    // Verify task has the section_id set.
    let task_path = cfg.tasks_dir().join(format!("{}.md", task.id));
    let before = jin_core::store::fs::read_task(&task_path).expect("read task before delete");
    assert_eq!(before.frontmatter.section_id, Some(sec.id.clone()));

    // Delete the section.
    jin_gui::commands::lists::delete_section_fn(root, list.id.clone(), sec.id.clone())
        .expect("VG-P5: delete_section must succeed");

    // Assert: SectionEntry is gone from list file.
    let list_path = jin_core::store::fs::find_list_path(&cfg.lists_dir(), &list.id)
        .expect("find list path after delete");
    let list_disk = jin_core::store::fs::read_list(&list_path).expect("read list after delete");
    assert!(
        list_disk.frontmatter.sections.is_empty(),
        "VG-P5: section entry must be removed from list file"
    );

    // Assert: task file now has section_id = None (active clear).
    let after = jin_core::store::fs::read_task(&task_path).expect("read task after delete");
    assert_eq!(
        after.frontmatter.section_id, None,
        "VG-P5: affected task section_id must be actively cleared (not lazy)"
    );

    // Assert survives rebuild.
    jin_core::ops::api::refresh(root).expect("rebuild after delete");
    let lists = jin_gui::commands::lists::list_lists_fn(root).expect("list_lists after rebuild");
    let found = lists
        .iter()
        .find(|l| l.id == list.id)
        .expect("list must remain");
    assert!(
        found.sections.is_empty(),
        "VG-P5: no sections after rebuild"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P9 — Drag-and-drop manual reorder (bridge command layer)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P9-1: move_task persists list, section_id, and position atomically.
/// After move, the task file on disk reflects all three fields; the DTO
/// reports the updated position; a second task is unaffected.
#[test]
fn vg_p9_bridge_move_task_persists_position_change() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed inbox.
    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    // Create two tasks — they start with position == "".
    let task_a = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Task A".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some("inbox".to_string()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P9: create task A");

    let task_b = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Task B".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some("inbox".to_string()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P9: create task B");

    // Compute positions: A gets "V" (between(None, None)), B gets position after A.
    let pos_a = jin_core::order::between(None, None);
    let pos_b = jin_core::order::between(Some(&pos_a), None);

    // Move task A to position pos_a (still in inbox, no section).
    let moved_a = jin_gui::commands::tasks::move_task_fn(
        root,
        task_a.id.clone(),
        jin_gui::commands::tasks::MoveTaskInput {
            list_id: "inbox".to_string(),
            section_id: None,
            position: pos_a.clone(),
        },
    )
    .expect("VG-P9: move_task A must succeed");

    assert_eq!(
        moved_a.position, pos_a,
        "VG-P9: DTO position must reflect new key"
    );
    assert_eq!(moved_a.list, "inbox", "VG-P9: list must remain inbox");

    // Assert persisted to disk.
    let task_a_path = cfg.tasks_dir().join(format!("{}.md", task_a.id));
    let on_disk_a = jin_core::store::fs::read_task(&task_a_path).expect("read task A");
    assert_eq!(
        on_disk_a.frontmatter.position, pos_a,
        "VG-P9: position must be on disk"
    );

    // Task B is unaffected.
    let task_b_path = cfg.tasks_dir().join(format!("{}.md", task_b.id));
    let on_disk_b = jin_core::store::fs::read_task(&task_b_path).expect("read task B");
    // B was never moved, its position is still empty.
    assert_eq!(
        on_disk_b.frontmatter.position, "",
        "VG-P9: task B must be unaffected by A move"
    );

    // Move task B BEFORE A: give B a position that sorts before pos_a.
    let pos_b_before_a = jin_core::order::between(None, Some(&pos_a));
    jin_gui::commands::tasks::move_task_fn(
        root,
        task_b.id.clone(),
        jin_gui::commands::tasks::MoveTaskInput {
            list_id: "inbox".to_string(),
            section_id: None,
            position: pos_b_before_a.clone(),
        },
    )
    .expect("VG-P9: move_task B before A must succeed");

    // Assert sort order: B < A (pos_b_before_a < pos_a lexicographically).
    assert!(
        pos_b_before_a < pos_a,
        "VG-P9: B position ({:?}) must sort before A position ({:?})",
        pos_b_before_a,
        pos_a
    );

    // Survives rebuild.
    jin_core::ops::api::refresh(root).expect("VG-P9: rebuild");
    let tasks = jin_gui::commands::tasks::list_tasks_fn(
        root,
        Some("inbox".to_string()),
        None,
        None,
        None,
        false,
    )
    .expect("VG-P9: list_tasks after rebuild");
    let a_dto = tasks
        .iter()
        .find(|t| t.id == task_a.id)
        .expect("A must survive rebuild");
    assert_eq!(
        a_dto.position, pos_a,
        "VG-P9: A position must survive rebuild"
    );
    let b_dto = tasks
        .iter()
        .find(|t| t.id == task_b.id)
        .expect("B must survive rebuild");
    assert_eq!(
        b_dto.position, pos_b_before_a,
        "VG-P9: B position must survive rebuild"
    );

    let _ = pos_b; // suppress unused warning
}

/// VG-P9-2: cross-column move — section_id AND position both change in one write.
#[test]
fn vg_p9_bridge_move_task_cross_column() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    // Seed a list with two sections.
    let list = jin_gui::commands::lists::create_list_fn(
        root,
        jin_gui::commands::lists::CreateListInput {
            name: "Board".to_string(),
            color: "sky".to_string(),
            icon: "layout-grid".to_string(),
            parent_id: None,
        },
    )
    .expect("VG-P9-CROSS: create list");

    let sec_todo = jin_gui::commands::lists::create_section_fn(
        root,
        list.id.clone(),
        jin_gui::commands::lists::CreateSectionInput {
            name: "To Do".to_string(),
        },
    )
    .expect("VG-P9-CROSS: create To Do section");

    let sec_doing = jin_gui::commands::lists::create_section_fn(
        root,
        list.id.clone(),
        jin_gui::commands::lists::CreateSectionInput {
            name: "Doing".to_string(),
        },
    )
    .expect("VG-P9-CROSS: create Doing section");

    // Create task in To Do section.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Cross-column task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: Some(list.id.clone()),
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P9-CROSS: create task");

    // Assign to To Do section.
    jin_gui::commands::tasks::edit_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: None,
            section_id: Some(sec_todo.id.clone()),
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P9-CROSS: assign to To Do");

    let pos_in_doing = jin_core::order::between(None, None);

    // Move task from To Do → Doing in one atomic call.
    let moved = jin_gui::commands::tasks::move_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::MoveTaskInput {
            list_id: list.id.clone(),
            section_id: Some(sec_doing.id.clone()),
            position: pos_in_doing.clone(),
        },
    )
    .expect("VG-P9-CROSS: move_task to Doing must succeed");

    assert_eq!(
        moved.section_id.as_deref(),
        Some(sec_doing.id.as_str()),
        "VG-P9-CROSS: section_id must be Doing after move"
    );
    assert_eq!(
        moved.position, pos_in_doing,
        "VG-P9-CROSS: position must be the new key"
    );

    // Assert both changes are on disk in ONE file write (no residual To Do section_id).
    let task_path = cfg.tasks_dir().join(format!("{}.md", task.id));
    let on_disk = jin_core::store::fs::read_task(&task_path).expect("read task after cross-move");
    assert_eq!(
        on_disk.frontmatter.section_id.as_deref(),
        Some(sec_doing.id.as_str()),
        "VG-P9-CROSS: section_id on disk must be Doing"
    );
    assert_eq!(
        on_disk.frontmatter.position, pos_in_doing,
        "VG-P9-CROSS: position on disk must be updated"
    );

    // Survives rebuild.
    jin_core::ops::api::refresh(root).expect("VG-P9-CROSS: rebuild");
    let fetched = jin_gui::commands::tasks::get_task_fn(root, task.id.clone())
        .expect("VG-P9-CROSS: get_task after rebuild");
    assert_eq!(
        fetched.section_id.as_deref(),
        Some(sec_doing.id.as_str()),
        "VG-P9-CROSS: section_id must survive rebuild"
    );
    assert_eq!(
        fetched.position, pos_in_doing,
        "VG-P9-CROSS: position must survive rebuild"
    );

    let _ = sec_todo; // suppress unused warning
}

/// VG-P9-3: reseed_positions assigns monotonically increasing keys in display order.
#[test]
fn vg_p9_bridge_reseed_positions_assigns_ordered_keys() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    // Create three tasks (all start with position == "").
    let mut ids = Vec::new();
    for i in 0..3u32 {
        let t = jin_gui::commands::tasks::create_task_fn(
            root,
            jin_gui::commands::tasks::TaskInput {
                title: format!("Task {}", i),
                body: String::new(),
                priority: None,
                due: None,
                list: Some("inbox".to_string()),
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .expect("VG-P9-RESEED: create task");
        ids.push(t.id);
    }

    // Reseed in reverse order: [2, 1, 0] → the new position keys must be ascending.
    let reversed: Vec<String> = ids.iter().rev().cloned().collect();
    jin_gui::commands::tasks::reseed_positions_fn(
        root,
        jin_gui::commands::tasks::ReseedPositionsInput {
            list_id: "inbox".to_string(),
            section_id: None,
            ordered_ids: reversed.clone(),
        },
    )
    .expect("VG-P9-RESEED: reseed_positions must succeed");

    // Read positions from disk and verify they are strictly ascending in the given order.
    let mut positions = Vec::new();
    for id in &reversed {
        let path = cfg.tasks_dir().join(format!("{}.md", id));
        let task = jin_core::store::fs::read_task(&path).expect("read reseeded task");
        assert!(
            !task.frontmatter.position.is_empty(),
            "VG-P9-RESEED: position must be non-empty after reseed for task {}",
            id
        );
        positions.push(task.frontmatter.position.clone());
    }

    // Positions must be strictly ascending (earlier in list → smaller key).
    for i in 0..positions.len().saturating_sub(1) {
        assert!(
            positions[i] < positions[i + 1],
            "VG-P9-RESEED: position[{}]={:?} must sort before position[{}]={:?}",
            i,
            positions[i],
            i + 1,
            positions[i + 1]
        );
    }

    // Survives rebuild: rebuild re-indexes from disk, positions must be intact.
    jin_core::ops::api::refresh(root).expect("VG-P9-RESEED: rebuild");
    let tasks_after = jin_gui::commands::tasks::list_tasks_fn(
        root,
        Some("inbox".to_string()),
        None,
        None,
        None,
        false,
    )
    .expect("VG-P9-RESEED: list after rebuild");
    for (id, expected_pos) in reversed.iter().zip(positions.iter()) {
        let dto = tasks_after
            .iter()
            .find(|t| &t.id == id)
            .expect("task must survive rebuild");
        assert_eq!(
            &dto.position, expected_pos,
            "VG-P9-RESEED: position must survive rebuild for task {}",
            id
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// VG-P10 — Multiple reminders, stored only (bridge command layer)
// ──────────────────────────────────────────────────────────────────────────────

/// VG-P10-1: relative + absolute reminders persist AND survive index rebuild.
#[test]
fn vg_p10_bridge_reminders_persist_and_survive_rebuild() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Reminder task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: Some(vec![
                jin_gui::commands::tasks::ReminderInput {
                    kind: "relative".to_string(),
                    value: "-1h".to_string(),
                },
                jin_gui::commands::tasks::ReminderInput {
                    kind: "absolute".to_string(),
                    value: "2026-07-01T09:00:00+00:00".to_string(),
                },
            ]),
            parent: None,
        },
    )
    .expect("VG-P10: create_task with reminders");

    // Assert returned DTO has reminders.
    assert_eq!(
        task.reminders.len(),
        2,
        "VG-P10: create must return 2 reminders"
    );
    assert_eq!(task.reminders[0].kind, "relative");
    assert_eq!(task.reminders[0].value, "-1h");
    assert_eq!(task.reminders[1].kind, "absolute");
    assert_eq!(task.reminders[1].value, "2026-07-01T09:00:00+00:00");

    // Assert persisted to disk frontmatter.
    let task_path = cfg.tasks_dir().join(format!("{}.md", task.id));
    let on_disk = jin_core::store::fs::read_task(&task_path).expect("read task on disk");
    assert_eq!(
        on_disk.frontmatter.reminders.len(),
        2,
        "VG-P10: disk must have 2 reminders"
    );
    assert_eq!(on_disk.frontmatter.reminders[0].kind, "relative");
    assert_eq!(on_disk.frontmatter.reminders[1].kind, "absolute");

    // Rebuild index and verify reminders survive (they go through JSON column).
    jin_core::ops::api::refresh(root).expect("VG-P10: rebuild");
    let fetched = jin_gui::commands::tasks::get_task_fn(root, task.id.clone())
        .expect("VG-P10: get_task after rebuild");
    assert_eq!(
        fetched.reminders.len(),
        2,
        "VG-P10: reminders must survive index rebuild"
    );
    assert_eq!(
        fetched.reminders[0].value, "-1h",
        "VG-P10: relative reminder must survive rebuild"
    );
    assert_eq!(
        fetched.reminders[1].value, "2026-07-01T09:00:00+00:00",
        "VG-P10: absolute reminder must survive rebuild"
    );
}

/// VG-P10-2: edit_task replaces reminders; removing all leaves empty list.
#[test]
fn vg_p10_bridge_edit_task_replaces_reminders() {
    let tmp = init_root();
    let root = tmp.path();

    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Editable reminder task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: Some(vec![jin_gui::commands::tasks::ReminderInput {
                kind: "relative".to_string(),
                value: "-30m".to_string(),
            }]),
            parent: None,
        },
    )
    .expect("VG-P10-EDIT: create with 1 reminder");

    assert_eq!(
        task.reminders.len(),
        1,
        "VG-P10-EDIT: initial reminder count"
    );

    // Replace with 2 reminders.
    let updated = jin_gui::commands::tasks::edit_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: None,
            section_id: None,
            clear_section: false,
            reminders: Some(vec![
                jin_gui::commands::tasks::ReminderInput {
                    kind: "relative".to_string(),
                    value: "-1d".to_string(),
                },
                jin_gui::commands::tasks::ReminderInput {
                    kind: "relative".to_string(),
                    value: "-1h".to_string(),
                },
            ]),
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P10-EDIT: edit must succeed");

    assert_eq!(
        updated.reminders.len(),
        2,
        "VG-P10-EDIT: reminders must be replaced with 2"
    );
    assert_eq!(updated.reminders[0].value, "-1d");
    assert_eq!(updated.reminders[1].value, "-1h");

    // Remove all reminders (pass empty list).
    let cleared = jin_gui::commands::tasks::edit_task_fn(
        root,
        task.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: None,
            section_id: None,
            clear_section: false,
            reminders: Some(vec![]),
            parent: None,
            clear_parent: false,
        },
    )
    .expect("VG-P10-EDIT: clear reminders must succeed");

    assert_eq!(
        cleared.reminders.len(),
        0,
        "VG-P10-EDIT: all reminders must be cleared"
    );

    // Rebuild — empty list survives.
    jin_core::ops::api::refresh(root).expect("VG-P10-EDIT: rebuild");
    let fetched = jin_gui::commands::tasks::get_task_fn(root, task.id.clone())
        .expect("VG-P10-EDIT: get_task after clear");
    assert_eq!(
        fetched.reminders.len(),
        0,
        "VG-P10-EDIT: empty reminder list must survive rebuild"
    );
}

/// Reminder delivery belongs to the GUI process and every desktop adapter
/// propagates the native notification service's submission result.
#[test]
fn vg_p10_gui_owns_native_notification_delivery() {
    let cargo_toml = include_str!("../Cargo.toml");
    let adapter = include_str!("../src/notifications.rs");
    assert!(cargo_toml.contains("notify-rust"));
    assert!(cargo_toml.contains("tauri-winrt-notification"));
    assert!(!cargo_toml.contains("tauri-plugin-notification"));
    assert!(!include_str!("../../../jin/Cargo.toml").contains("tauri-plugin-notification"));
    assert!(adapter.contains("UNMutableNotificationContent"));
    assert!(adapter.contains("UNNotificationRequest"));
    assert!(adapter.contains("addNotificationRequest_withCompletionHandler"));
    assert!(adapter.contains("notify_rust::Notification::new()"));
    assert!(adapter.contains("tauri_winrt_notification::Toast::new(app_id)"));
    assert!(adapter.contains("CreateToastNotifierWithId(&HSTRING::from(app_id))"));
    assert!(!adapter.contains("async_runtime::spawn"));
}

#[test]
fn notification_platform_schemas_are_regenerated_and_consistent() {
    assert_eq!(
        include_str!("../gen/schemas/desktop-schema.json"),
        include_str!("../gen/schemas/macOS-schema.json"),
        "desktop schemas generated from the same narrow capability set must not drift"
    );
    assert!(!include_str!("../gen/schemas/desktop-schema.json").contains("notification:allow"));
}

#[test]
fn notification_settings_commands_are_narrow_and_scheduler_never_requests_permission() {
    let lib = include_str!("../src/lib.rs");
    let adapter = include_str!("../src/notifications.rs");
    let scheduler = include_str!("../src/scheduler.rs");
    for command in [
        "notifications::notification_status",
        "notifications::request_notification_permission",
        "notifications::open_notification_settings",
        "notifications::send_test_notification",
    ] {
        assert!(lib.contains(command));
    }
    assert!(!scheduler.contains("request_permission"));
    assert!(scheduler.contains("NativeNotificationTransport"));
    assert!(adapter.contains("reconcile_mac_delivery_completion"));
    assert!(adapter.contains("Notifications are working."));
    assert!(adapter.contains("Focus or Do Not Disturb"));
    assert!(!adapter.contains("url: String"));

    let run_start = lib.find("pub fn run(").expect("Tauri run entry point");
    let delegate_install = lib[run_start..]
        .find("notifications::install_notification_center_delegate()")
        .expect("notification delegate lifecycle preflight");
    let builder_start = lib[run_start..]
        .find("tauri::Builder::default()")
        .expect("Tauri builder startup");
    let scheduler_spawn = lib[run_start..]
        .find("scheduler::spawn(")
        .expect("reminder scheduler startup");
    assert!(delegate_install < builder_start);
    assert!(builder_start < scheduler_spawn);
    assert!(adapter.contains("UNUserNotificationCenterDelegate"));
    assert!(adapter.contains("Options::Banner | Options::List | Options::Sound"));
    assert!(adapter.contains("NotificationDelegateSlotDecision::PreserveExisting"));
    assert!(adapter.contains("OnceLock"));
    assert!(!adapter.contains("Retained::into_raw(delegate)"));
    assert!(lib.contains("preserving an existing macOS Notification Center delegate"));
}

/// VG-P10-4: auto-reminder is seeded when a task is created with a due DateTime.
#[test]
fn vg_p10_bridge_auto_reminder_seeded_for_due_datetime() {
    let tmp = init_root();
    let root = tmp.path();
    let cfg = jin_core::Config::load(root).expect("load config");

    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    // Create task with a due DateTime (RFC 3339) and NO explicit reminders.
    let task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Auto-reminder task".to_string(),
            body: String::new(),
            priority: None,
            due: Some("2026-07-04T10:00:00+00:00".to_string()),
            list: None,
            tags: None,
            reminders: None, // no explicit reminders → auto-reminder should fire
            parent: None,
        },
    )
    .expect("VG-P10-AUTO: create_task with due datetime");

    // Auto-reminder must be added by the backend.
    assert_eq!(
        task.reminders.len(),
        1,
        "VG-P10-AUTO: one auto-reminder must be added for due DateTime"
    );
    assert_eq!(
        task.reminders[0].kind, "absolute",
        "VG-P10-AUTO: auto-reminder must be absolute"
    );
    assert!(
        task.reminders[0].value.contains("2026-07-04"),
        "VG-P10-AUTO: auto-reminder value must contain the due date, got: {:?}",
        task.reminders[0].value
    );

    // Assert on disk.
    let task_path = cfg.tasks_dir().join(format!("{}.md", task.id));
    let on_disk = jin_core::store::fs::read_task(&task_path).expect("read task on disk");
    assert_eq!(
        on_disk.frontmatter.reminders.len(),
        1,
        "VG-P10-AUTO: auto-reminder must be persisted to disk"
    );

    // Date-only due must NOT add an auto-reminder.
    let date_only_task = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Date-only task".to_string(),
            body: String::new(),
            priority: None,
            due: Some("2026-07-04".to_string()), // date only — no time
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("VG-P10-AUTO: create_task with date-only due");

    assert_eq!(
        date_only_task.reminders.len(),
        0,
        "VG-P10-AUTO: date-only due must NOT trigger auto-reminder"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// S6 — subtasks: bridge layer (TaskInput.parent / EditTaskInput.parent+clear_parent)
// ──────────────────────────────────────────────────────────────────────────────

/// S6: `create_task_fn` with `TaskInput.parent` set persists the parent id,
/// and the bridge's returned DTO (create_task_fn returns `TaskDto::from_model`)
/// carries it immediately — the SAME field that must also survive the index
/// projection (proven independently, without mocks, in
/// `jin/tests/s4_tasks_notes_crud.rs#parent_survives_index_rebuild_and_list_tasks`).
#[test]
fn s6_create_task_with_parent_persists_and_returns_it() {
    let tmp = init_root();
    let root = tmp.path();

    jin_gui::commands::lists::list_lists_fn(root).unwrap();

    let parent = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Parent task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .expect("S6: create parent task");

    let child = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Child task".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: Some(parent.id.clone()),
        },
    )
    .expect("S6: create_task with parent must succeed");

    assert_eq!(
        child.parent,
        Some(parent.id.clone()),
        "S6: create_task_fn must return the parent id it was given"
    );

    let cfg = jin_core::Config::load(root).unwrap();
    let task_path = cfg.tasks_dir().join(format!("{}.md", child.id));
    let on_disk = jin_core::store::fs::read_task(&task_path).expect("read child task on disk");
    assert_eq!(
        on_disk.frontmatter.parent,
        Some(parent.id),
        "S6: parent must be persisted to the child's frontmatter on disk"
    );
}

/// S6: a depth-2 parent (parent's parent is itself a subtask) is rejected by
/// `create_task_fn`, mapped to a usage (code 2) `JinErrorDto`, not a panic.
#[test]
fn s6_create_task_rejects_depth_two_parent_via_bridge() {
    let tmp = init_root();
    let root = tmp.path();

    let a = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "A".to_string(),
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
    let b = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "B".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: Some(a.id.clone()),
        },
    )
    .unwrap();

    let result = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "C".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: Some(b.id.clone()),
        },
    );

    let err = result.expect_err("S6: depth-2 parent must be rejected");
    assert_eq!(
        err.code, 2,
        "S6: depth-2 rejection must map to usage (code 2)"
    );
}

/// S6: `edit_task_fn` with `clear_parent: true` detaches a subtask (mirrors
/// the `clear_due` / `clear_section` idiom already covered elsewhere in this file).
#[test]
fn s6_edit_task_clear_parent_detaches_subtask() {
    let tmp = init_root();
    let root = tmp.path();

    let parent = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Parent".to_string(),
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
    let child = jin_gui::commands::tasks::create_task_fn(
        root,
        jin_gui::commands::tasks::TaskInput {
            title: "Child".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: Some(parent.id.clone()),
        },
    )
    .unwrap();
    assert_eq!(child.parent, Some(parent.id));

    let detached = jin_gui::commands::tasks::edit_task_fn(
        root,
        child.id.clone(),
        jin_gui::commands::tasks::EditTaskInput {
            title: None,
            priority: None,
            due: None,
            clear_due: false,
            list: None,
            body: None,
            tags: None,
            section_id: None,
            clear_section: false,
            reminders: None,
            parent: None,
            clear_parent: true,
        },
    )
    .expect("S6: clear_parent edit must succeed");

    assert!(
        detached.parent.is_none(),
        "S6: clear_parent must detach the subtask"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bug A2 (VIGIL) — cross-boundary GUI payload -> bridge Input struct deserialization
// ──────────────────────────────────────────────────────────────────────────────

/// Bug A root cause: `CreateListInput` declares `color`/`icon` as required
/// `String` fields (no `#[serde(default)]`) but nothing ever ran a GUI-shaped
/// JSON payload through `serde_json` to prove the two sides agree.
/// `vg_p3_bridge_crud_persist_and_rebuild` (above) builds `CreateListInput` as
/// a Rust struct LITERAL — serde never touches it. `invoke.test.ts` asserted
/// the mock payload against itself, so a missing field could never surface
/// there either. Neither side ever crossed the JSON boundary that was
/// actually broken.
///
/// This table takes the exact JSON shape `src/invoke.ts` (+ its calling
/// controllers) send as an `input` argument for every mutating command, and
/// runs it through `serde_json::from_value::<T>` — the same deserialization
/// Tauri performs on a real IPC call before a command body ever runs. Each
/// case uses the MINIMAL shape a real call site can emit (optional TS fields
/// omitted) since that is exactly the condition that breaks a field the Rust
/// side requires but never declared `#[serde(default)]` for.
/// A named case: a human-readable label (which call site + shape) paired
/// with a thunk that runs the real `serde_json::from_value::<T>` for that
/// case's concrete Input type and reports Ok/Err as a plain `Result`.
type CrossBoundaryCase = (&'static str, Box<dyn Fn() -> Result<(), String>>);

#[test]
fn bug_a2_gui_payload_shapes_deserialize_into_bridge_input_structs() {
    use serde_json::json;

    let cases: Vec<CrossBoundaryCase> = vec![
        (
            "CreateListInput — lists_controller.ts saveCreate(): { name, color, icon }",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::lists::CreateListInput>(json!({
                    "name": "Work",
                    "color": "sky",
                    "icon": "list"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "EditListInput — editList(id, { name }) minimal partial edit",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::lists::EditListInput>(json!({
                    "name": "Renamed"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "CreateSectionInput — createSection(listId, name): { name }",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::lists::CreateSectionInput>(json!({
                    "name": "Backlog"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "RenameSectionInput — renameSection(listId, sectionId, name): { name }",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::lists::RenameSectionInput>(json!({
                    "name": "Renamed Section"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "ReorderSectionInput — reorderSection(listId, sectionId, position): { position }",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::lists::ReorderSectionInput>(json!({
                    "position": "m"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "TaskInput — createTask({ title }) quick-add minimal",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::tasks::TaskInput>(json!({
                    "title": "Buy milk"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "EditTaskInput — editTask(id, { title }) single-field edit",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::tasks::EditTaskInput>(json!({
                    "title": "New title"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "MoveTaskInput — moveTask(id, { listId, sectionId: null, position })",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::tasks::MoveTaskInput>(json!({
                    "list_id": "list-1",
                    "section_id": null,
                    "position": "m"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "ReseedPositionsInput — reseedPositions(listId, sectionId, orderedIds)",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::tasks::ReseedPositionsInput>(json!({
                    "list_id": "list-1",
                    "section_id": null,
                    "ordered_ids": ["t1", "t2"]
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "NoteInput — createNote({ title }) minimal",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::notes::NoteInput>(json!({
                    "title": "Minimal Note"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "EditNoteInput — editNote(id, {}) no-op edit (every field optional)",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::notes::EditNoteInput>(json!({}))
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }),
        ),
        (
            "EventInput — createEvent({ title, start, end }) minimal",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::events::EventInput>(json!({
                    "title": "Standup",
                    "start": "2026-07-14T09:00:00",
                    "end": "2026-07-14T09:15:00"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "TemporalSlot — promoteTask(taskId, { when }) tzid omitted",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::promote::TemporalSlot>(json!({
                    "when": "2026-07-14T09:00:00"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
        (
            "RemoveTimeBlockInput — compound removal requires operation_id",
            Box::new(|| {
                serde_json::from_value::<jin_gui::commands::events::RemoveTimeBlockInput>(json!({
                    "event_id": "event-1",
                    "return_to_flexible": true,
                    "operation_id": "remove-event-1"
                }))
                .map(|_| ())
                .map_err(|e| e.to_string())
            }),
        ),
    ];

    let mut failures = Vec::new();
    for (name, check) in &cases {
        if let Err(e) = check() {
            failures.push(format!("{name}: {e}"));
        }
    }

    assert!(
        failures.is_empty(),
        "cross-boundary GUI payload -> bridge Input struct deserialization failed for:\n{}",
        failures.join("\n")
    );

    assert!(
        serde_json::from_value::<jin_gui::commands::events::RemoveTimeBlockInput>(json!({
            "event_id": "event-1",
            "return_to_flexible": false
        }))
        .is_err(),
        "remove_time_block must reject a bridge payload without operation_id"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Notes surfaces — declarative collections, recovery preview, stale-write details
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn bridge_notes_collections_recovery_preview_and_stale_details_are_safe() {
    use jin_core::model::{CollectionQuery, QueryFilter};
    use jin_gui::commands::{collections, notes};
    use jin_gui::error::JinErrorDetails;

    let vault = init_root();
    let root = vault.path();
    let note = notes::create_note_fn(
        root,
        notes::NoteInput {
            title: "Bridge note".to_string(),
            body: "draft body".to_string(),
            tags: vec!["work".to_string()],
            folder: String::new(),
        },
    )
    .expect("create note");

    let collection = collections::create_collection_fn(
        root,
        collections::CreateCollectionInput {
            name: "Work notes".to_string(),
            query: CollectionQuery {
                filter: QueryFilter::Tag {
                    value: "work".to_string(),
                },
                ..Default::default()
            },
        },
    )
    .expect("create declarative collection");
    assert_eq!(
        collections::evaluate_collection_fn(root, collection.id.clone())
            .expect("evaluate collection")
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec![note.id.as_str()]
    );

    // Seed an unknown field as a newer installation would, then mutate only
    // bridge-owned fields. The flattened document must retain it.
    let collection_path = root
        .join("collections")
        .join(format!("{}.json", collection.id));
    let mut raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&collection_path).unwrap()).unwrap();
    raw["future_field"] = serde_json::json!({"kept": true});
    std::fs::write(&collection_path, serde_json::to_vec(&raw).unwrap()).unwrap();
    collections::rename_collection_fn(root, collection.id.clone(), "Renamed".to_string())
        .expect("rename collection");
    collections::update_collection_query_fn(
        root,
        collection.id.clone(),
        collections::UpdateCollectionQueryInput {
            query: CollectionQuery::default(),
        },
    )
    .expect("update collection query");
    let retained: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&collection_path).unwrap()).unwrap();
    assert_eq!(retained["future_field"]["kept"], serde_json::json!(true));

    // A snapshot is taken before each write. Advance once so revision 1 (the
    // original note) exists for the path-free preview and restore assertions.
    let snapshotted = notes::edit_note_fn(
        root,
        note.id.clone(),
        notes::EditNoteInput {
            title: None,
            body: Some("intermediate body".to_string()),
            add_tags: vec![],
            rm_tags: vec![],
            expected_revision: note.revision,
        },
    )
    .expect("create first immutable revision snapshot");
    let preview =
        notes::preview_note_revision_fn(root, note.id.clone(), 1).expect("safe revision preview");
    assert_eq!(preview.body_markdown, "draft body");
    assert!(
        serde_json::to_value(&preview)
            .unwrap()
            .get("path")
            .is_none(),
        "recovery preview must not expose a snapshot filesystem path"
    );

    let updated = notes::edit_note_fn(
        root,
        note.id.clone(),
        notes::EditNoteInput {
            title: None,
            body: Some("newest body".to_string()),
            add_tags: vec![],
            rm_tags: vec![],
            expected_revision: snapshotted.revision,
        },
    )
    .expect("advance revision");
    let stale = notes::edit_note_fn(
        root,
        note.id.clone(),
        notes::EditNoteInput {
            title: None,
            body: Some("local draft".to_string()),
            add_tags: vec![],
            rm_tags: vec![],
            expected_revision: snapshotted.revision,
        },
    )
    .expect_err("stale write must be rejected");
    assert_eq!(stale.code, 4);
    assert_eq!(
        stale.details,
        Some(JinErrorDetails::StaleNote {
            note_id: note.id.clone(),
            expected_revision: snapshotted.revision.expect("first edit returns revision"),
            current_revision: updated.revision.expect("edit returns revision"),
        })
    );

    let restored = notes::restore_note_revision_fn(root, note.id.clone(), 1, updated.revision)
        .expect("restore makes a new revision");
    assert_eq!(restored.body_markdown.as_deref(), Some("draft body"));
    assert!(
        restored.revision.expect("restore returns revision")
            > updated.revision.expect("edit returns revision")
    );

    collections::delete_collection_fn(root, collection.id).expect("delete collection only");
    assert!(
        notes::get_note_fn(root, note.id).is_ok(),
        "deleting a collection must never delete canonical notes"
    );
}
