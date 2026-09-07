//! CLI regression test: `show` commands must surface index-derived backlinks.
//!
//! Drives the real `jin` binary via `env!("CARGO_BIN_EXE_jin")` and `--json`.
//! All three object kinds are covered:
//!
//! 1. note→task `references` edge: `jin task show <tid>` must return a
//!    non-empty backlinks array containing the note.
//! 2. promote with `--tz`: `jin task show <tid>` must return a backlink with
//!    source_kind="event", edge_type="derived-from", label="has-event".
//! 3. note→event `prep-for` edge: `jin event show <eid>` must return a
//!    non-empty backlinks array containing the note.
//!
//! These tests FAIL if `cmd_*_show` bypasses the index (i.e. uses `from_model`
//! instead of `api::get_*`), because `from_model` always produces empty backlinks.

use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

// ─── helpers ──────────────────────────────────────────────────────────────────

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// Run `jin --root <root> --json <args…>` and return the parsed JSON envelope.
/// Panics with the command's stderr on non-zero exit.
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

/// Extract the `.data` field from the versioned envelope.
fn data(v: &Value) -> &Value {
    v.get("data").expect("envelope must have 'data' field")
}

// ─── tests ────────────────────────────────────────────────────────────────────

/// note→task `references` edge: `jin task show` must surface the backlink.
#[test]
fn cli_task_show_surfaces_note_reference_backlink() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // Init
    run_json(root, &["init"]);

    // Create note
    let note_env = run_json(root, &["note", "add", "Kickoff prep notes"]);
    let note_id = data(&note_env)["id"].as_str().expect("note id").to_string();

    // Create task
    let task_env = run_json(root, &["task", "add", "Kickoff meeting"]);
    let task_id = data(&task_env)["id"].as_str().expect("task id").to_string();

    // Link note→task with `references`
    run_json(root, &["link", &note_id, &task_id, "--type", "references"]);

    // Show task — backlinks must be non-empty
    let show_env = run_json(root, &["task", "show", &task_id]);
    let backlinks = data(&show_env)["backlinks"]
        .as_array()
        .expect("backlinks must be an array");

    assert!(
        !backlinks.is_empty(),
        "task show must return non-empty backlinks after note→task reference link"
    );

    let bl = &backlinks[0];
    assert_eq!(bl["source_id"].as_str().unwrap(), note_id);
    assert_eq!(bl["source_kind"].as_str().unwrap(), "note");
    assert_eq!(bl["edge_type"].as_str().unwrap(), "references");
    assert_eq!(bl["label"].as_str().unwrap(), "referenced-by");
}

/// promote with `--tz`: `jin task show` must surface the `derived-from` backlink.
#[test]
fn cli_task_show_surfaces_derived_from_backlink_after_promote() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    run_json(root, &["init"]);

    let task_env = run_json(root, &["task", "add", "Prepare Q3 report"]);
    let task_id = data(&task_env)["id"].as_str().expect("task id").to_string();

    // Promote to an anchored event
    run_json(
        root,
        &[
            "promote",
            &task_id,
            "--when",
            "2026-09-15T10:00:00",
            "--tz",
            "America/New_York",
        ],
    );

    // task show must include the derived-from backlink from the event
    let show_env = run_json(root, &["task", "show", &task_id]);
    let backlinks = data(&show_env)["backlinks"]
        .as_array()
        .expect("backlinks must be an array");

    assert!(
        !backlinks.is_empty(),
        "task show must return non-empty backlinks after promote"
    );

    let bl = backlinks
        .iter()
        .find(|b| b["edge_type"].as_str() == Some("derived-from"))
        .expect("must find a derived-from backlink");

    assert_eq!(bl["source_kind"].as_str().unwrap(), "event");
    assert_eq!(bl["label"].as_str().unwrap(), "has-event");
}

/// note→event `prep-for` edge: `jin event show` must surface the backlink.
#[test]
fn cli_event_show_surfaces_prep_for_backlink() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    run_json(root, &["init"]);

    // Create note
    let note_env = run_json(root, &["note", "add", "Pre-flight checklist"]);
    let note_id = data(&note_env)["id"].as_str().expect("note id").to_string();

    // Create event
    let event_env = run_json(
        root,
        &[
            "event",
            "add",
            "Launch day",
            "--start",
            "2026-11-01T09:00:00",
            "--end",
            "2026-11-01T10:00:00",
            "--tz",
            "America/New_York",
        ],
    );
    let event_id = data(&event_env)["id"]
        .as_str()
        .expect("event id")
        .to_string();

    // Link note→event with `prep-for` (attach default)
    run_json(root, &["attach", &note_id, &event_id]);

    // event show must surface the prep-for backlink
    let show_env = run_json(root, &["event", "show", &event_id]);
    let backlinks = data(&show_env)["backlinks"]
        .as_array()
        .expect("backlinks must be an array");

    assert!(
        !backlinks.is_empty(),
        "event show must return non-empty backlinks after note→event prep-for attach"
    );

    let bl = backlinks
        .iter()
        .find(|b| b["edge_type"].as_str() == Some("prep-for"))
        .expect("must find a prep-for backlink");

    assert_eq!(bl["source_id"].as_str().unwrap(), note_id);
    assert_eq!(bl["source_kind"].as_str().unwrap(), "note");
    assert_eq!(bl["label"].as_str().unwrap(), "prep-notes");
}
