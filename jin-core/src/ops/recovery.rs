//! Canonical note recovery primitives.
//!
//! SQLite is disposable in Jin. Recovery always repairs canonical Markdown
//! first, then callers rebuild the derived index. The journal is intentionally
//! small and append-only: it records a replacement before the atomic rename and
//! records completion afterwards, enabling a conservative startup repair after
//! a crash or power loss.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::Note;
use crate::store::{frontmatter, fs};
use crate::{JinError, Result};

const JOURNAL_FILE: &str = "notes-journal.jsonl";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JournalEntry {
    operation_id: String,
    state: String,
    target: String,
    backup: Option<String>,
    after_sha256: String,
}

/// Result of replaying unfinished recovery operations.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryReport {
    pub completed: usize,
    pub restored: usize,
}

/// A revision snapshot available for diagnostics or disaster restoration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteRevision {
    pub revision: u64,
    pub path: String,
}

fn root_from_notes_dir(notes_dir: &Path) -> Result<&Path> {
    notes_dir.parent().ok_or_else(|| {
        JinError::InvalidInput(format!(
            "notes directory must have a vault root parent: {}",
            notes_dir.display()
        ))
    })
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(".jin").join(JOURNAL_FILE)
}

fn revision_dir(root: &Path, note_id: &str) -> PathBuf {
    root.join(".jin").join("revisions").join(note_id)
}

fn validated_note_id(root: &Path, note_id: &str) -> Result<()> {
    ulid::Ulid::from_string(note_id)
        .map_err(|_| JinError::InvalidInput(format!("invalid note id: {note_id}")))?;
    let path = fs::find_note_path(&root.join("notes"), note_id)?;
    let note = fs::read_note(&path)?;
    if note.id() != note_id {
        return Err(JinError::NotFound(format!("note/{note_id}")));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn relative_to_root(root: &Path, path: &Path) -> Result<String> {
    path.strip_prefix(root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .map_err(|_| {
            JinError::Integrity(format!("recovery path escaped vault: {}", path.display()))
        })
}

fn append_entry(root: &Path, entry: &JournalEntry) -> Result<()> {
    let path = journal_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let line = serde_json::to_string(entry)
        .map_err(|err| JinError::Integrity(format!("serialize recovery journal: {err}")))?;
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")?;
    file.sync_data()?;
    Ok(())
}

fn snapshot_before_write(root: &Path, note: &Note, content: &[u8]) -> Result<PathBuf> {
    let dir = revision_dir(root, note.id());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.md", note.frontmatter.revision));
    // Snapshot files are immutable. An existing snapshot represents the same
    // revision and must agree byte-for-byte rather than be silently replaced.
    if path.exists() {
        if std::fs::read(&path)? != content {
            return Err(JinError::Integrity(format!(
                "revision {} for note {} already exists with different content",
                note.frontmatter.revision,
                note.id()
            )));
        }
    } else {
        fs::atomic_write(&path, content)?;
    }
    Ok(path)
}

/// Atomically replace an existing note file while recording a recoverable
/// before-image. Callers pass the *old* note content and the already-mutated
/// note, whose revision must be greater than the old revision.
pub(crate) fn journaled_replace(
    notes_dir: &Path,
    target: &Path,
    old_note: &Note,
    old_content: &[u8],
    new_note: &Note,
) -> Result<()> {
    let root = root_from_notes_dir(notes_dir)?;
    let backup = snapshot_before_write(root, old_note, old_content)?;
    let content = frontmatter::render(&new_note.frontmatter, &new_note.body)?;
    let operation_id = format!("{}-{}", new_note.id(), new_note.frontmatter.revision);
    let entry = JournalEntry {
        operation_id: operation_id.clone(),
        state: "started".to_string(),
        target: relative_to_root(root, target)?,
        backup: Some(relative_to_root(root, &backup)?),
        after_sha256: sha256(content.as_bytes()),
    };
    append_entry(root, &entry)?;
    fs::atomic_write(target, content.as_bytes())?;
    append_entry(
        root,
        &JournalEntry {
            state: "completed".to_string(),
            ..entry
        },
    )?;
    Ok(())
}

/// Replay journal entries that lack a completion record.
///
/// If the intended post-image is already at the target, the rename succeeded
/// and only the journal completion was lost. A different target is never
/// overwritten: it may contain an externally edited or later successfully
/// committed revision. A malformed journal line is ignored rather than
/// blocking access to canonical data; its absence is visible through the
/// resulting index diagnostics on the next rebuild.
pub fn recover_incomplete_operations(root: &Path) -> Result<RecoveryReport> {
    let path = journal_path(root);
    if !path.exists() {
        return Ok(RecoveryReport::default());
    }
    let mut entries: BTreeMap<String, JournalEntry> = BTreeMap::new();
    let mut completed = BTreeSet::new();
    for line in std::fs::read_to_string(&path)?.lines() {
        let Ok(entry) = serde_json::from_str::<JournalEntry>(line) else {
            continue;
        };
        if entry.state == "completed" {
            completed.insert(entry.operation_id.clone());
        } else if entry.state == "started" {
            entries.insert(entry.operation_id.clone(), entry);
        }
    }

    let mut report = RecoveryReport::default();
    for (operation_id, entry) in entries {
        if completed.contains(&operation_id) {
            continue;
        }
        let target = root.join(&entry.target);
        let current_matches = std::fs::read(&target)
            .ok()
            .is_some_and(|bytes| sha256(&bytes) == entry.after_sha256);
        if current_matches {
            append_entry(
                root,
                &JournalEntry {
                    state: "completed".to_string(),
                    ..entry
                },
            )?;
            report.completed += 1;
            continue;
        }

        // A started operation that did not leave its post-image is either an
        // interrupted pre-rename write or has been superseded. The target is
        // authoritative in both cases; restoring an older before-image here
        // would discard a newer completed edit.
        append_entry(
            root,
            &JournalEntry {
                state: "completed".to_string(),
                ..entry
            },
        )?;
        report.completed += 1;
    }
    Ok(report)
}

/// List immutable snapshots for a note, oldest revision first.
pub fn list_revisions(root: &Path, note_id: &str) -> Result<Vec<NoteRevision>> {
    validated_note_id(root, note_id)?;
    let dir = revision_dir(root, note_id);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut revisions = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        let Ok(revision) = stem.parse::<u64>() else {
            continue;
        };
        if path.extension().and_then(|extension| extension.to_str()) == Some("md") {
            revisions.push(NoteRevision {
                revision,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    revisions.sort_by_key(|revision| revision.revision);
    Ok(revisions)
}

/// Load one immutable revision snapshot for safe UI preview.
///
/// The returned model contains canonical note content only. Snapshot filesystem
/// paths remain an internal recovery implementation detail and are never part of
/// this API's result.
pub fn preview_note_revision(root: &Path, note_id: &str, revision: u64) -> Result<Note> {
    validated_note_id(root, note_id)?;
    let snapshot = revision_dir(root, note_id).join(format!("{revision}.md"));
    fs::read_note(&snapshot)
        .map_err(|_| JinError::NotFound(format!("note/{note_id}/revision/{revision}")))
}

/// Restore a prior snapshot as a *new* revision. `expected_revision` provides
/// optimistic conflict detection: a caller that reviewed revision N cannot
/// accidentally overwrite a note that has advanced to N+1.
pub fn restore_note_revision(
    root: &Path,
    note_id: &str,
    revision: u64,
    expected_revision: Option<u64>,
) -> Result<Note> {
    let notes_dir = root.join("notes");
    let target = fs::find_note_path(&notes_dir, note_id)?;
    let current_content = std::fs::read(&target)?;
    let current = fs::read_note(&target)?;
    if let Some(expected) = expected_revision {
        if current.frontmatter.revision != expected {
            return Err(JinError::StaleNote {
                note_id: note_id.to_string(),
                expected_revision: expected,
                current_revision: current.frontmatter.revision,
            });
        }
    }
    let mut restored = preview_note_revision(root, note_id, revision)?;
    restored.frontmatter.revision = current.frontmatter.revision.saturating_add(1);
    restored.frontmatter.updated = Local::now().fixed_offset();
    journaled_replace(&notes_dir, &target, &current, &current_content, &restored)?;
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use crate::ops::notes::{create_note, edit_note, CreateNoteParams, EditNoteParams};
    use tempfile::TempDir;

    #[test]
    fn restoring_a_snapshot_requires_the_expected_revision_and_creates_a_new_one() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let notes = vault.path().join("notes");
        let note = create_note(
            &notes,
            CreateNoteParams {
                title: "Recover me".to_string(),
                body: "first".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let changed = edit_note(
            &notes,
            note.id(),
            EditNoteParams {
                title: None,
                body: Some("second".to_string()),
                add_tags: vec![],
                rm_tags: vec![],
                properties: None,
                expected_revision: Some(1),
            },
        )
        .unwrap();
        assert_eq!(changed.frontmatter.revision, 2);
        let restored = restore_note_revision(vault.path(), note.id(), 1, Some(2)).unwrap();
        assert_eq!(restored.body, "first");
        assert_eq!(restored.frontmatter.revision, 3);
        assert!(restore_note_revision(vault.path(), note.id(), 1, Some(2)).is_err());
    }

    #[test]
    fn recovery_never_overwrites_a_target_that_differs_from_an_unfinished_post_image() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let notes = vault.path().join("notes");
        let note = create_note(
            &notes,
            CreateNoteParams {
                title: "Keep newer content".to_string(),
                body: "first".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let target = fs::find_note_path(&notes, note.id()).unwrap();
        let newer = b"externally updated canonical content";
        fs::atomic_write(&target, newer).unwrap();
        append_entry(
            vault.path(),
            &JournalEntry {
                operation_id: "unfinished-old-write".to_string(),
                state: "started".to_string(),
                target: relative_to_root(vault.path(), &target).unwrap(),
                backup: None,
                after_sha256: sha256(b"interrupted post image"),
            },
        )
        .unwrap();

        let report = recover_incomplete_operations(vault.path()).unwrap();

        assert_eq!(report.completed, 1);
        assert_eq!(report.restored, 0);
        assert_eq!(std::fs::read(&target).unwrap(), newer);
    }
}
