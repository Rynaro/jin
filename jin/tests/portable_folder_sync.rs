//! Regression coverage for generic synchronized folders.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

fn run(root: &Path, state: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_jin"))
        .arg("--root")
        .arg(root)
        .args(arguments)
        .env("JIN_STATE_DIR", state)
        .output()
        .expect("run jin")
}

fn succeeds(root: &Path, state: &Path, arguments: &[&str]) -> String {
    let output = run(root, state, arguments);
    assert!(
        output.status.success(),
        "jin {arguments:?} failed\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("UTF-8 output")
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).expect("create copied workspace");
    for entry in fs::read_dir(source).expect("read workspace") {
        let entry = entry.expect("read entry");
        let source = entry.path();
        let destination = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source).expect("stat source");
        assert!(!metadata.file_type().is_symlink());
        if metadata.is_dir() {
            copy_tree(&source, &destination);
        } else {
            fs::copy(source, destination).expect("copy canonical file");
        }
    }
}

fn note(root: &Path) -> PathBuf {
    let mut paths = fs::read_dir(root.join("notes"))
        .expect("read notes")
        .map(|entry| entry.expect("note entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "md"))
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(paths.len(), 1);
    paths.pop().expect("note path")
}

fn note_id(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.split_once("--"))
        .map(|(id, _)| id.to_string())
        .expect("stable note id")
}

#[test]
fn portable_folder_preserves_conflicts_and_device_local_history() {
    let temp = TempDir::new().expect("temporary workspace");
    let a = temp.path().join("drive-a");
    let b = temp.path().join("drive-b");
    let state_a = temp.path().join("state-a");
    let state_b = temp.path().join("state-b");

    succeeds(&a, &state_a, &["init", "--portable"]);
    succeeds(
        &a,
        &state_a,
        &["note", "add", "Shared", "--body", "original"],
    );
    let a_note = note(&a);
    let id = note_id(&a_note);
    succeeds(&a, &state_a, &["note", "edit", &id, "--body", "A offline"]);

    copy_tree(&a, &b);
    assert!(succeeds(&b, &state_b, &["note", "list"]).contains("Shared"));
    succeeds(&b, &state_b, &["note", "edit", &id, "--body", "B offline"]);
    assert!(fs::read_to_string(&a_note).unwrap().contains("A offline"));

    let b_note = note(&b);
    let conflict = a.join("notes").join(format!("{id}--provider-conflict.md"));
    fs::copy(&b_note, &conflict).expect("provider conflict copy");
    let before = fs::read(&a_note).unwrap();
    let result = run(
        &a,
        &state_a,
        &["note", "edit", &id, "--body", "must refuse"],
    );
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr)
        .to_ascii_lowercase()
        .contains("conflict"));
    assert_eq!(fs::read(&a_note).unwrap(), before);

    fs::remove_file(&conflict).unwrap();
    fs::copy(&b_note, &a_note).expect("provider replacement");
    assert!(succeeds(&a, &state_a, &["note", "show", &id]).contains("B offline"));
    let history = succeeds(&a, &state_a, &["history", "note", &id]);
    assert!(history.lines().map(PathBuf::from).any(|path| {
        fs::read_to_string(path)
            .map(|contents| contents.contains("A offline"))
            .unwrap_or(false)
    }));

    for workspace in [&a, &b] {
        for unexpected in ["index.sqlite", "tokens", "operations", "history"] {
            assert!(
                !walkdir(workspace)
                    .iter()
                    .any(|path| path.contains(unexpected)),
                "runtime state leaked into {}",
                workspace.display()
            );
        }
    }
}

fn walkdir(root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root).expect("walk workspace") {
        let entry = entry.expect("walk entry");
        let path = entry.path();
        if entry.file_type().expect("file type").is_dir() {
            paths.extend(walkdir(&path));
        } else {
            paths.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .display()
                    .to_string(),
            );
        }
    }
    paths
}
