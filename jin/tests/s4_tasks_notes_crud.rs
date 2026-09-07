//! S4 — Tasks & Notes CRUD depth
//!
//! Shipped-path tests that drive the real `jin` binary and assert the full
//! S4 acceptance criteria:
//!
//!   * Task state machine: all valid transitions persist; invalid ones are
//!     rejected with exit 2 and do NOT mutate the file.
//!   * Field edits (title, priority, due, list) persist and bump `updated`.
//!   * Note edits (title, body, tags) persist; links[] are preserved.
//!   * List/query filtering (status, priority, list, tag) returns the right
//!     subset deterministically.
//!   * Promote-then-edit-task: backlinks survive the edit (VG6-adjacent).
//!   * `--json` parity for all new verbs.
//!
//! Every test is fully isolated (own `TempDir`); no global env mutation.

use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

// ── helpers ───────────────────────────────────────────────────────────────────

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// `jin --root <root> --json <args…>` — panics on non-zero exit.
fn run_json(root: &Path, args: &[&str]) -> Value {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    if !out.status.success() {
        panic!(
            "jin exited {}\nargs: {:?}\nstderr: {}",
            out.status,
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "invalid JSON from jin: {}\nraw: {}",
            e,
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

/// `jin --root <root> --json <args…>` — returns `(exit_code, Value)` without panicking.
/// On invalid JSON stdout the value is `null`.
fn run_json_raw(root: &Path, args: &[&str]) -> (i32, Value) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    let code = out.status.code().unwrap_or(-1);
    let val: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    (code, val)
}

/// `jin --root <root> <args…>` (no --json) — returns raw Output without panicking.
fn run_plain(root: &Path, args: &[&str]) -> std::process::Output {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root);
    for a in args {
        cmd.arg(a);
    }
    cmd.output().expect("failed to spawn jin")
}

/// Extract `.data` from a versioned DTO envelope.
fn data(v: &Value) -> &Value {
    v.get("data").expect("envelope must have 'data' field")
}

/// Initialise a fresh root and return the `TempDir` (keeps it alive).
fn init_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    run_json(tmp.path(), &["init"]);
    tmp
}

// ── Task state-machine: valid transitions ─────────────────────────────────────

/// todo → doing via `jin task start`
#[test]
fn task_start_todo_to_doing() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Prepare report"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "start", &id]);
    assert_eq!(data(&env)["status"].as_str().unwrap(), "doing");
    // completed_at must NOT be set on start
    assert!(data(&env)["completed_at"].is_null());
}

/// todo → done via `jin task done`, sets completed_at
#[test]
fn task_done_todo_to_done_sets_completed_at() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Write tests"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "done", &id]);
    assert_eq!(data(&env)["status"].as_str().unwrap(), "done");
    assert!(
        !data(&env)["completed_at"].is_null(),
        "completed_at must be set when task is marked done"
    );
}

/// doing → done via `jin task done`
#[test]
fn task_doing_to_done_sets_completed_at() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Deploy service"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "start", &id]);
    let env = run_json(root, &["task", "done", &id]);

    assert_eq!(data(&env)["status"].as_str().unwrap(), "done");
    assert!(!data(&env)["completed_at"].is_null());
}

/// todo → cancelled via `jin task cancel`
#[test]
fn task_cancel_todo_to_cancelled() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Low-priority thing"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "cancel", &id]);
    assert_eq!(data(&env)["status"].as_str().unwrap(), "cancelled");
    assert!(data(&env)["completed_at"].is_null());
}

/// doing → cancelled via `jin task cancel`
#[test]
fn task_cancel_doing_to_cancelled() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Interrupted work"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "start", &id]);
    let env = run_json(root, &["task", "cancel", &id]);
    assert_eq!(data(&env)["status"].as_str().unwrap(), "cancelled");
}

/// done → todo (reopen) clears completed_at
#[test]
fn task_reopen_done_clears_completed_at() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Review draft"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "done", &id]);
    let env = run_json(root, &["task", "reopen", &id]);

    assert_eq!(data(&env)["status"].as_str().unwrap(), "todo");
    assert!(
        data(&env)["completed_at"].is_null(),
        "completed_at must be cleared on reopen"
    );
}

/// cancelled → todo (reopen)
#[test]
fn task_reopen_cancelled_to_todo() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Resurrected task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "cancel", &id]);
    let env = run_json(root, &["task", "reopen", &id]);

    assert_eq!(data(&env)["status"].as_str().unwrap(), "todo");
}

// ── Task state-machine: INVALID transitions ───────────────────────────────────

/// done → doing is not allowed; exit 2; file must be byte-identical after.
#[test]
fn task_invalid_done_to_doing_rejected_file_unchanged() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Finished already"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    // Transition to done first.
    run_json(root, &["task", "done", &id]);

    // Capture file bytes before the bad transition.
    let task_path = root.join("tasks").join(format!("{}.md", id));
    let before = std::fs::read(&task_path).expect("task file must exist");

    // Attempt done → doing (invalid).
    let (code, _) = run_json_raw(root, &["task", "start", &id]);
    assert_eq!(
        code, 2,
        "invalid state transition must exit with code 2 (usage)"
    );

    // File must be byte-identical — status still 'done', completed_at unchanged.
    let after = std::fs::read(&task_path).expect("task file must exist");
    assert_eq!(
        before, after,
        "invalid transition must NOT mutate the task file"
    );
}

/// done → cancelled is not allowed (can only go done → todo via reopen).
#[test]
fn task_invalid_done_to_cancelled_rejected() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Already done"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "done", &id]);

    let task_path = root.join("tasks").join(format!("{}.md", id));
    let before = std::fs::read(&task_path).expect("task file must exist");

    let (code, _) = run_json_raw(root, &["task", "cancel", &id]);
    assert_eq!(code, 2, "done→cancelled must be rejected with exit 2");

    let after = std::fs::read(&task_path).expect("task file must exist");
    assert_eq!(
        before, after,
        "file must be unchanged after rejected transition"
    );
}

/// cancelled → done is not allowed (must reopen first).
#[test]
fn task_invalid_cancelled_to_done_rejected() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Abandoned task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(root, &["task", "cancel", &id]);

    let task_path = root.join("tasks").join(format!("{}.md", id));
    let before = std::fs::read(&task_path).expect("task file must exist");

    let (code, _) = run_json_raw(root, &["task", "done", &id]);
    assert_eq!(code, 2, "cancelled→done must be rejected with exit 2");

    let after = std::fs::read(&task_path).expect("task file must exist");
    assert_eq!(
        before, after,
        "file must be unchanged after rejected transition"
    );
}

// ── Task field edits ──────────────────────────────────────────────────────────

/// `jin task edit --title` changes title and bumps `updated`.
#[test]
fn task_edit_title_persists_and_bumps_updated() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Original title"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    let created_at = data(&env)["created"].as_str().unwrap().to_string();

    // Edit the title.
    let env = run_json(root, &["task", "edit", &id, "--title", "Revised title"]);
    assert_eq!(data(&env)["title"].as_str().unwrap(), "Revised title");

    // `updated` must differ from `created` (was bumped).
    let updated_at = data(&env)["updated"].as_str().unwrap();
    assert_ne!(updated_at, created_at, "updated must be bumped after edit");

    // Verify via show (index round-trip).
    let show = run_json(root, &["task", "show", &id]);
    assert_eq!(data(&show)["title"].as_str().unwrap(), "Revised title");
}

/// `jin task edit --priority high` persists priority.
#[test]
fn task_edit_priority_persists() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Prioritizable task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    assert_eq!(data(&env)["priority"].as_str().unwrap(), "none");

    run_json(root, &["task", "edit", &id, "--priority", "high"]);

    let show = run_json(root, &["task", "show", &id]);
    assert_eq!(data(&show)["priority"].as_str().unwrap(), "high");
}

/// `jin task edit --due` sets due date; `--clear-due` removes it.
#[test]
fn task_edit_due_set_and_clear() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Time-sensitive task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    assert!(data(&env)["due"].is_null());

    // Set due date.
    run_json(root, &["task", "edit", &id, "--due", "2026-08-01"]);
    let show = run_json(root, &["task", "show", &id]);
    assert_eq!(data(&show)["due"].as_str().unwrap(), "2026-08-01");

    // Clear due date.
    run_json(root, &["task", "edit", &id, "--clear-due"]);
    let show = run_json(root, &["task", "show", &id]);
    assert!(
        data(&show)["due"].is_null(),
        "due must be null after --clear-due"
    );
}

/// `jin task edit --list` moves the task to a different list.
#[test]
fn task_edit_list_moves_task() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Inbox item"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    assert_eq!(data(&env)["list"].as_str().unwrap(), "inbox");

    run_json(root, &["task", "edit", &id, "--list", "work"]);

    let show = run_json(root, &["task", "show", &id]);
    assert_eq!(data(&show)["list"].as_str().unwrap(), "work");

    // Should appear in --list work filter.
    let list_env = run_json(root, &["task", "list", "--list", "work"]);
    let items = data(&list_env).as_array().unwrap();
    assert!(
        items.iter().any(|t| t["id"].as_str() == Some(&id)),
        "task must appear in work list after edit"
    );
}

// ── Note edits ────────────────────────────────────────────────────────────────

/// `jin note edit --title` renames the file and persists the new title.
#[test]
fn note_edit_title_persists() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["note", "add", "Old title"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    let created_at = data(&env)["created"].as_str().unwrap().to_string();

    let env = run_json(root, &["note", "edit", &id, "--title", "New title"]);
    assert_eq!(data(&env)["title"].as_str().unwrap(), "New title");
    let updated_at = data(&env)["updated"].as_str().unwrap();
    assert_ne!(updated_at, created_at, "updated must be bumped");

    // Show via index round-trip.
    let show = run_json(root, &["note", "show", &id]);
    assert_eq!(data(&show)["title"].as_str().unwrap(), "New title");
}

/// `jin note edit --body` replaces the note body.
#[test]
fn note_edit_body_persists() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["note", "add", "My note"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    run_json(
        root,
        &["note", "edit", &id, "--body", "Updated content here"],
    );

    // Human-mode show prints body; check via note file content.
    let note_path = {
        let notes_dir = root.join("notes");
        std::fs::read_dir(&notes_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .find(|p| {
                p.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.starts_with(&id))
                    .unwrap_or(false)
            })
            .expect("note file must exist")
    };
    let content = std::fs::read_to_string(&note_path).unwrap();
    assert!(
        content.contains("Updated content here"),
        "note file must contain the new body"
    );
}

/// `jin note edit --add-tag / --rm-tag` manages tags correctly.
#[test]
fn note_edit_add_remove_tags() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["note", "add", "Research note"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    // Add two tags.
    run_json(
        root,
        &[
            "note",
            "edit",
            &id,
            "--add-tag",
            "research",
            "--add-tag",
            "draft",
        ],
    );

    let show = run_json(root, &["note", "show", &id]);
    let tags: Vec<&str> = data(&show)["tags"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(tags.contains(&"research"), "tag 'research' must be present");
    assert!(tags.contains(&"draft"), "tag 'draft' must be present");

    // Remove one tag.
    run_json(root, &["note", "edit", &id, "--rm-tag", "draft"]);

    let show = run_json(root, &["note", "show", &id]);
    let tags: Vec<&str> = data(&show)["tags"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(
        !tags.contains(&"draft"),
        "tag 'draft' must have been removed"
    );
    assert!(
        tags.contains(&"research"),
        "tag 'research' must still be present"
    );
}

// ── List / query filtering ────────────────────────────────────────────────────

/// `jin task list --status todo` returns only todo tasks.
#[test]
fn task_list_status_filter() {
    let tmp = init_root();
    let root = tmp.path();

    // Create todo, doing, done tasks.
    let t1 = run_json(root, &["task", "add", "Task A (todo)"]);
    let id1 = data(&t1)["id"].as_str().unwrap().to_string();

    let t2 = run_json(root, &["task", "add", "Task B (doing)"]);
    let id2 = data(&t2)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "start", &id2]);

    let t3 = run_json(root, &["task", "add", "Task C (done)"]);
    let id3 = data(&t3)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "done", &id3]);

    let env = run_json(root, &["task", "list", "--status", "todo"]);
    let items = data(&env).as_array().unwrap();

    assert!(
        items.iter().any(|t| t["id"].as_str() == Some(&id1)),
        "todo task must appear in --status todo"
    );
    assert!(
        !items.iter().any(|t| t["id"].as_str() == Some(&id2)),
        "doing task must NOT appear in --status todo"
    );
    assert!(
        !items.iter().any(|t| t["id"].as_str() == Some(&id3)),
        "done task must NOT appear in --status todo"
    );
}

/// `jin task list --priority high` returns only high-priority tasks.
#[test]
fn task_list_priority_filter() {
    let tmp = init_root();
    let root = tmp.path();

    let t1 = run_json(root, &["task", "add", "Normal task"]);
    let id1 = data(&t1)["id"].as_str().unwrap().to_string();

    let t2 = run_json(root, &["task", "add", "Urgent task"]);
    let id2 = data(&t2)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "edit", &id2, "--priority", "high"]);

    let env = run_json(root, &["task", "list", "--priority", "high"]);
    let items = data(&env).as_array().unwrap();

    assert!(
        items.iter().any(|t| t["id"].as_str() == Some(&id2)),
        "high-priority task must appear in --priority high filter"
    );
    assert!(
        !items.iter().any(|t| t["id"].as_str() == Some(&id1)),
        "none-priority task must NOT appear in --priority high filter"
    );
}

/// `jin task list --list <name>` returns only tasks in that list.
#[test]
fn task_list_list_filter() {
    let tmp = init_root();
    let root = tmp.path();

    let t1 = run_json(root, &["task", "add", "--list", "inbox", "Inbox task"]);
    let id1 = data(&t1)["id"].as_str().unwrap().to_string();

    let t2 = run_json(root, &["task", "add", "--list", "work", "Work task"]);
    let id2 = data(&t2)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "list", "--list", "work"]);
    let items = data(&env).as_array().unwrap();

    assert!(
        items.iter().any(|t| t["id"].as_str() == Some(&id2)),
        "work task must appear in --list work filter"
    );
    assert!(
        !items.iter().any(|t| t["id"].as_str() == Some(&id1)),
        "inbox task must NOT appear in --list work filter"
    );
}

/// `jin note list --tag <tag>` returns only notes carrying that tag.
#[test]
fn note_list_tag_filter() {
    let tmp = init_root();
    let root = tmp.path();

    let n1 = run_json(root, &["note", "add", "Untagged note"]);
    let id1 = data(&n1)["id"].as_str().unwrap().to_string();

    let n2 = run_json(root, &["note", "add", "Research note"]);
    let id2 = data(&n2)["id"].as_str().unwrap().to_string();
    run_json(root, &["note", "edit", &id2, "--add-tag", "research"]);

    let env = run_json(root, &["note", "list", "--tag", "research"]);
    let items = data(&env).as_array().unwrap();

    assert!(
        items.iter().any(|n| n["id"].as_str() == Some(&id2)),
        "tagged note must appear in --tag research"
    );
    assert!(
        !items.iter().any(|n| n["id"].as_str() == Some(&id1)),
        "untagged note must NOT appear in --tag research"
    );
}

// ── Invariant: backlinks survive edits ────────────────────────────────────────

/// Promote a task, then edit the task — the event's `derived-from` edge and
/// the task's `has-event` backlink must still resolve after the edit.
#[test]
fn promote_then_edit_task_preserves_backlinks() {
    let tmp = init_root();
    let root = tmp.path();

    // Create and promote task.
    let task_env = run_json(root, &["task", "add", "Quarterly review"]);
    let task_id = data(&task_env)["id"].as_str().unwrap().to_string();

    let event_env = run_json(
        root,
        &[
            "promote",
            &task_id,
            "--when",
            "2026-09-01T10:00:00",
            "--tz",
            "America/New_York",
        ],
    );
    let event_id = data(&event_env)["id"].as_str().unwrap().to_string();

    // Verify pre-edit: task has a has-event backlink.
    let task_show_before = run_json(root, &["task", "show", &task_id]);
    let bls_before = data(&task_show_before)["backlinks"].as_array().unwrap();
    assert!(
        bls_before
            .iter()
            .any(|b| b["edge_type"].as_str() == Some("derived-from")
                && b["source_kind"].as_str() == Some("event")),
        "task must have derived-from backlink from event before edit"
    );

    // Edit the task title (and priority for good measure).
    run_json(
        root,
        &[
            "task",
            "edit",
            &task_id,
            "--title",
            "Quarterly review (revised)",
            "--priority",
            "high",
        ],
    );

    // Post-edit: backlink must still be present.
    let task_show_after = run_json(root, &["task", "show", &task_id]);
    let bls_after = data(&task_show_after)["backlinks"].as_array().unwrap();
    assert!(
        bls_after
            .iter()
            .any(|b| b["edge_type"].as_str() == Some("derived-from")
                && b["source_kind"].as_str() == Some("event")
                && b["source_id"].as_str() == Some(&event_id)),
        "task's derived-from backlink from event must survive the edit"
    );

    // The event must still carry derived_from pointing to the task.
    let event_show = run_json(root, &["event", "show", &event_id]);
    assert_eq!(
        data(&event_show)["derived_from"].as_str().unwrap(),
        &task_id,
        "event's derived_from must still point to the task after editing the task"
    );
}

/// Edit a note that has outgoing links — links[] must be preserved.
#[test]
fn note_edit_preserves_outgoing_links_as_backlinks_on_target() {
    let tmp = init_root();
    let root = tmp.path();

    // Create note and task, link note→task.
    let note_env = run_json(root, &["note", "add", "Meeting prep"]);
    let note_id = data(&note_env)["id"].as_str().unwrap().to_string();

    let task_env = run_json(root, &["task", "add", "Prepare for meeting"]);
    let task_id = data(&task_env)["id"].as_str().unwrap().to_string();

    run_json(root, &["link", &note_id, &task_id, "--type", "references"]);

    // Verify the task has a backlink from the note before edit.
    let task_show_before = run_json(root, &["task", "show", &task_id]);
    let bls_before = data(&task_show_before)["backlinks"].as_array().unwrap();
    assert!(
        bls_before
            .iter()
            .any(|b| b["source_id"].as_str() == Some(&note_id)
                && b["edge_type"].as_str() == Some("references")),
        "task must have references backlink before note edit"
    );

    // Edit the note (change title and add a tag).
    run_json(
        root,
        &[
            "note",
            "edit",
            &note_id,
            "--title",
            "Meeting prep (updated)",
            "--add-tag",
            "meetings",
        ],
    );

    // After edit, the task's backlink must still be there.
    let task_show_after = run_json(root, &["task", "show", &task_id]);
    let bls_after = data(&task_show_after)["backlinks"].as_array().unwrap();
    assert!(
        bls_after
            .iter()
            .any(|b| b["source_id"].as_str() == Some(&note_id)
                && b["edge_type"].as_str() == Some("references")),
        "task's references backlink from note must survive note title edit"
    );
}

// ── --json parity ─────────────────────────────────────────────────────────────

/// `jin task start --json` returns a valid versioned DTO envelope.
#[test]
fn json_parity_task_start() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Sprint task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "start", &id]);

    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "task");
    assert_eq!(data(&env)["status"].as_str().unwrap(), "doing");
}

/// `jin task cancel --json` returns a valid versioned DTO envelope.
#[test]
fn json_parity_task_cancel() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Will be cancelled"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(root, &["task", "cancel", &id]);
    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "task");
    assert_eq!(data(&env)["status"].as_str().unwrap(), "cancelled");
}

/// `jin task reopen --json` returns a valid versioned DTO envelope.
#[test]
fn json_parity_task_reopen() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Reopened task"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "done", &id]);

    let env = run_json(root, &["task", "reopen", &id]);
    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "task");
    assert_eq!(data(&env)["status"].as_str().unwrap(), "todo");
    assert!(data(&env)["completed_at"].is_null());
}

/// `jin task edit --json` returns a valid versioned DTO envelope with updated fields.
#[test]
fn json_parity_task_edit() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Original"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(
        root,
        &[
            "task",
            "edit",
            &id,
            "--priority",
            "medium",
            "--title",
            "Updated",
        ],
    );

    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "task");
    assert_eq!(data(&env)["title"].as_str().unwrap(), "Updated");
    assert_eq!(data(&env)["priority"].as_str().unwrap(), "medium");
}

/// `jin note edit --json` returns a valid versioned DTO envelope with updated fields.
#[test]
fn json_parity_note_edit() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["note", "add", "Original note"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();

    let env = run_json(
        root,
        &[
            "note",
            "edit",
            &id,
            "--title",
            "Edited note",
            "--add-tag",
            "edited",
        ],
    );

    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "note");
    assert_eq!(data(&env)["title"].as_str().unwrap(), "Edited note");
    let tags: Vec<&str> = data(&env)["tags"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(tags.contains(&"edited"));
}

/// `jin note list --tag --json` returns a valid versioned DTO with the right subset.
#[test]
fn json_parity_note_list_tag_filter() {
    let tmp = init_root();
    let root = tmp.path();

    let n1 = run_json(root, &["note", "add", "Note without tag"]);
    let id1 = data(&n1)["id"].as_str().unwrap().to_string();

    let n2 = run_json(root, &["note", "add", "Tagged note"]);
    let id2 = data(&n2)["id"].as_str().unwrap().to_string();
    run_json(root, &["note", "edit", &id2, "--add-tag", "important"]);

    let env = run_json(root, &["note", "list", "--tag", "important"]);
    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "list");

    let items = data(&env).as_array().unwrap();
    assert!(items.iter().any(|n| n["id"].as_str() == Some(&id2)));
    assert!(!items.iter().any(|n| n["id"].as_str() == Some(&id1)));
}

/// `jin task list --priority --json` returns a valid versioned DTO with the right subset.
#[test]
fn json_parity_task_list_priority_filter() {
    let tmp = init_root();
    let root = tmp.path();

    let t1 = run_json(root, &["task", "add", "Low-priority task"]);
    let id1 = data(&t1)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "edit", &id1, "--priority", "low"]);

    let t2 = run_json(root, &["task", "add", "High-priority task"]);
    let id2 = data(&t2)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "edit", &id2, "--priority", "high"]);

    let env = run_json(root, &["task", "list", "--priority", "high"]);
    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "list");

    let items = data(&env).as_array().unwrap();
    assert!(items.iter().any(|t| t["id"].as_str() == Some(&id2)));
    assert!(!items.iter().any(|t| t["id"].as_str() == Some(&id1)));
}

/// Invalid-transition JSON error envelope has `jin_dto_version` and no raw SQLite columns.
#[test]
fn json_parity_invalid_transition_error_envelope() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(root, &["task", "add", "Complete me"]);
    let id = data(&env)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "done", &id]);

    let (code, val) = run_json_raw(root, &["task", "start", &id]);
    assert_eq!(code, 2);
    // Error envelope must have jin_dto_version.
    assert_eq!(
        val["jin_dto_version"].as_str().unwrap_or(""),
        "1",
        "error envelope must carry jin_dto_version"
    );
}

/// `jin note list` without a tag filter returns ALL non-deleted notes.
#[test]
fn note_list_no_filter_returns_all_active() {
    let tmp = init_root();
    let root = tmp.path();

    run_json(root, &["note", "add", "Note one"]);
    run_json(root, &["note", "add", "Note two"]);
    run_json(root, &["note", "add", "Note three"]);

    let env = run_json(root, &["note", "list"]);
    let items = data(&env).as_array().unwrap();
    assert_eq!(items.len(), 3, "note list must return all 3 active notes");
}

/// `jin task add --priority medium` wires through to the task.
#[test]
fn task_add_with_priority_and_due_wires_through() {
    let tmp = init_root();
    let root = tmp.path();

    let env = run_json(
        root,
        &[
            "task",
            "add",
            "Deadline task",
            "--priority",
            "medium",
            "--due",
            "2026-12-31",
        ],
    );
    assert_eq!(data(&env)["priority"].as_str().unwrap(), "medium");
    assert_eq!(data(&env)["due"].as_str().unwrap(), "2026-12-31");
}

/// `jin task list` without any filter returns all non-deleted tasks sorted by id.
#[test]
fn task_list_no_filter_returns_all_active_deterministic_order() {
    let tmp = init_root();
    let root = tmp.path();

    run_json(root, &["task", "add", "Alpha"]);
    run_json(root, &["task", "add", "Beta"]);
    run_json(root, &["task", "add", "Gamma"]);

    let env = run_json(root, &["task", "list"]);
    let items = data(&env).as_array().unwrap();
    assert_eq!(items.len(), 3, "task list must return all 3 tasks");

    // IDs should be in ascending ULID order (time-ordered).
    let ids: Vec<&str> = items.iter().filter_map(|t| t["id"].as_str()).collect();
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(
        ids, sorted,
        "task list must be sorted deterministically by id"
    );
}

/// Deleted tasks are excluded from the default list.
#[test]
fn task_list_excludes_deleted() {
    let tmp = init_root();
    let root = tmp.path();

    run_json(root, &["task", "add", "Keep me"]);
    let t2 = run_json(root, &["task", "add", "Delete me"]);
    let id2 = data(&t2)["id"].as_str().unwrap().to_string();
    run_json(root, &["task", "rm", &id2]);

    let env = run_json(root, &["task", "list"]);
    let items = data(&env).as_array().unwrap();
    assert_eq!(
        items.len(),
        1,
        "deleted tasks must be excluded from default list"
    );
    assert!(!items.iter().any(|t| t["id"].as_str() == Some(&id2)));
}

/// `run_plain` smoke: `jin note list` (no --json) exits 0.
#[test]
fn note_list_human_mode_exits_zero() {
    let tmp = init_root();
    let root = tmp.path();

    run_json(root, &["note", "add", "Test note"]);
    let out = run_plain(root, &["note", "list"]);
    assert!(
        out.status.success(),
        "`jin note list` must exit 0 in human mode"
    );
}

// ── S6 — subtasks: the projection-trap guard (AC-S6-04) ──────────────────────

/// AC-S6-04 — `parent` survives the REAL pipeline end to end: `create_task`
/// writes a task file → the CLI's own `api::refresh` (main.rs) rebuilds the
/// SQLite index from disk → `api::list_tasks` / `api::get_task` query the
/// index → `TaskDto::from_row` projects the row. This test drives the real
/// `jin` binary against a real temp store — no mocked `from_row`/`TaskRow`/
/// frontmatter fixture anywhere (CONSTRAINT). A mocked test here would
/// certify, rather than catch, the exact bug class that shipped in Notes
/// (`body_markdown` absent from the index): `parent` living on the model but
/// not in the index would leave every read path returning `null` forever
/// while a model-only serde round-trip test stayed green.
#[test]
fn parent_survives_index_rebuild_and_list_tasks() {
    let tmp = init_root();
    let root = tmp.path();

    let parent_env = run_json(root, &["task", "add", "Parent task"]);
    let parent_id = data(&parent_env)["id"].as_str().unwrap().to_string();

    let child_env = run_json(root, &["task", "add", "--parent", &parent_id, "Child task"]);
    let child_id = data(&child_env)["id"].as_str().unwrap().to_string();

    // list_tasks is index-backed (TaskDto::from_row via query::list_tasks_by_tag)
    // — exactly the path the spec's "projection trap" warns about.
    let list_env = run_json(root, &["task", "list"]);
    let items = data(&list_env).as_array().unwrap();
    let child_row = items
        .iter()
        .find(|t| t["id"].as_str() == Some(child_id.as_str()))
        .expect("child task must appear in list_tasks");
    assert_eq!(
        child_row["parent"].as_str(),
        Some(parent_id.as_str()),
        "parent must survive the index projection (list_tasks), not just the model"
    );

    let parent_row = items
        .iter()
        .find(|t| t["id"].as_str() == Some(parent_id.as_str()))
        .expect("parent task must appear in list_tasks");
    assert!(
        parent_row["parent"].is_null(),
        "a top-level task's parent must be null in the list_tasks projection"
    );

    // get_task is ALSO index-backed (query::get_task) — both paths the spec
    // names must carry `parent`, not just one of the two.
    let show_env = run_json(root, &["task", "show", &child_id]);
    assert_eq!(
        data(&show_env)["parent"].as_str(),
        Some(parent_id.as_str()),
        "parent must survive get_task too (also from_row-projected)"
    );
}

/// AC-S6-02 (CLI surface) — creating a task whose parent is itself a subtask
/// (depth 2) is rejected with a non-zero exit and writes no file.
#[test]
fn task_add_rejects_depth_two_parent() {
    let tmp = init_root();
    let root = tmp.path();

    let a = run_json(root, &["task", "add", "A"]);
    let a_id = data(&a)["id"].as_str().unwrap().to_string();
    let b = run_json(root, &["task", "add", "--parent", &a_id, "B"]);
    let b_id = data(&b)["id"].as_str().unwrap().to_string();

    let (code, _) = run_json_raw(root, &["task", "add", "--parent", &b_id, "C"]);
    assert_ne!(
        code, 0,
        "creating C with parent=B (depth 2) must exit non-zero"
    );

    let env = run_json(root, &["task", "list"]);
    let items = data(&env).as_array().unwrap();
    assert_eq!(items.len(), 2, "C must not have been written");
}
