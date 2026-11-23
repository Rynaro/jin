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
    let today = chrono::Utc::now().date_naive();
    let return_on = today.to_string();
    let tomorrow = today.succ_opt().unwrap().to_string();
    run_json(root.path(), &["init"]);

    let captured = run_json(
        root.path(),
        &[
            "capture",
            "Review this task",
            "--task",
            "--review",
            "--return-on",
            &return_on,
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
        &["review", "defer", "task", &id, "--return-on", &tomorrow],
    );
    assert_eq!(deferred["kind"], "result");
    assert_eq!(data(&deferred)["state"], "deferred");
    assert_eq!(data(&deferred)["return_on"], tomorrow);
    let deferred_list = run_json(root.path(), &["review", "list"]);
    assert!(!data(&deferred_list)
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == id));

    let processed = run_json(root.path(), &["review", "process", "task", &id]);
    assert_eq!(processed["kind"], "result");
    assert_eq!(data(&processed)["state"], "processed");
}

#[test]
fn review_defer_rejects_a_past_return_date() {
    let root = TempDir::new().unwrap();
    let yesterday = chrono::Utc::now()
        .date_naive()
        .pred_opt()
        .unwrap()
        .to_string();
    run_json(root.path(), &["init"]);
    let captured = run_json(
        root.path(),
        &["capture", "Review this task", "--task", "--review"],
    );
    let id = data(&captured)["id"].as_str().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_jin"));
    command
        .arg("--root")
        .arg(root.path())
        .arg("review")
        .arg("defer")
        .arg("task")
        .arg(id)
        .arg("--return-on")
        .arg(yesterday);
    let output = command.output().expect("spawn jin");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("must be today or later"));
}
