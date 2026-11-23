//! Regression coverage for indexed capture review and its JSON command contract.

use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

fn run_json(root: &Path, args: &[&str]) -> Value {
    let mut command = Command::new(env!("CARGO_BIN_EXE_jin"));
    command.arg("--root").arg(root).arg("--json").args(args);
    let output = command.output().expect("spawn jin");
    assert!(
        output.status.success(),
        "jin failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("JSON envelope")
}

fn data(value: &Value) -> &Value {
    value.get("data").expect("versioned envelope data")
}

#[test]
fn review_uses_index_despite_corrupt_unrelated_note_and_emits_json_results() {
    let root = TempDir::new().unwrap();
    run_json(root.path(), &["init"]);

    let captured = run_json(
        root.path(),
        &[
            "capture",
            "Review this task",
            "--task",
            "--review",
            "--return-on",
            "1900-01-01",
        ],
    );
    let id = data(&captured)["id"].as_str().unwrap().to_string();
    assert_eq!(data(&captured)["capture_review"]["state"], "deferred");

    // This malformed file is deliberately unrelated to the indexed task. The
    // review read must stay a SQLite projection rather than reparsing the vault.
    std::fs::write(
        root.path().join("notes").join("unrelated-corrupt.md"),
        "---\n[",
    )
    .unwrap();
    let listed = run_json(root.path(), &["review", "list"]);
    assert!(data(&listed)
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == id));

    let deferred = run_json(
        root.path(),
        &["review", "defer", "task", &id, "--return-on", "1900-01-02"],
    );
    assert_eq!(deferred["kind"], "result");
    assert_eq!(data(&deferred)["state"], "deferred");
    assert_eq!(data(&deferred)["return_on"], "1900-01-02");

    let processed = run_json(root.path(), &["review", "process", "task", &id]);
    assert_eq!(processed["kind"], "result");
    assert_eq!(data(&processed)["state"], "processed");
}
