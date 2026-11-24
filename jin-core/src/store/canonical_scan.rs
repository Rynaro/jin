//! Validate identities in canonical files before a rebuild consumes them.
//!
//! Cloud providers preserve both sides of a conflict by changing a filename.
//! Identity comes from frontmatter, never from that filename.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::store::fs;
use crate::{JinError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalFile {
    pub kind: &'static str,
    pub id: String,
    pub path: PathBuf,
}

/// A duplicated identity kept by a file provider as two canonical documents.
/// The paths are deliberately retained so a human can resolve the pair without
/// Jin selecting or replacing either version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateIdentity {
    pub kind: &'static str,
    pub id: String,
    pub paths: Vec<PathBuf>,
}

fn push(files: &mut Vec<CanonicalFile>, kind: &'static str, id: String, path: &Path) {
    files.push(CanonicalFile {
        kind,
        id,
        path: path.to_path_buf(),
    });
}

/// Reject duplicate embedded identities before the index transaction clears its
/// previous projection. Both canonical files stay on disk for user resolution.
fn collect_identities(root: &Path) -> Result<Vec<CanonicalFile>> {
    let mut files = Vec::new();
    for path in fs::list_note_paths(&root.join("notes"))? {
        let item = fs::read_note(&path).map_err(|e| {
            JinError::Integrity(format!("cannot safely index note {}: {e}", path.display()))
        })?;
        push(&mut files, "note", item.frontmatter.id, &path);
    }
    for path in fs::list_task_paths(&root.join("tasks"))? {
        let item = fs::read_task(&path).map_err(|e| {
            JinError::Integrity(format!("cannot safely index task {}: {e}", path.display()))
        })?;
        push(&mut files, "task", item.frontmatter.id, &path);
    }
    for path in fs::list_event_paths(&root.join("events"))? {
        let item = fs::read_event(&path).map_err(|e| {
            JinError::Integrity(format!("cannot safely index event {}: {e}", path.display()))
        })?;
        push(&mut files, "event", item.frontmatter.id, &path);
    }
    for path in fs::list_list_paths(&root.join("lists"))? {
        let item = fs::read_list(&path).map_err(|e| {
            JinError::Integrity(format!("cannot safely index list {}: {e}", path.display()))
        })?;
        push(&mut files, "list", item.frontmatter.id, &path);
    }
    for path in fs::list_tag_paths(&root.join("tags"))? {
        let item = fs::read_tag(&path).map_err(|e| {
            JinError::Integrity(format!("cannot safely index tag {}: {e}", path.display()))
        })?;
        push(&mut files, "tag", item.frontmatter.slug, &path);
    }
    Ok(files)
}

/// Inspect duplicated embedded identities while preserving every file. This is
/// useful to user-facing diagnostics before a rebuild refuses the workspace.
pub fn duplicate_identities_in(files: &[CanonicalFile]) -> Vec<DuplicateIdentity> {
    let mut identities: BTreeMap<(&str, &str), Vec<PathBuf>> = BTreeMap::new();
    for file in files {
        identities
            .entry((file.kind, &file.id))
            .or_default()
            .push(file.path.clone());
    }
    identities
        .into_iter()
        .filter_map(|((kind, id), paths)| {
            (paths.len() > 1).then(|| DuplicateIdentity {
                kind,
                id: id.to_string(),
                paths,
            })
        })
        .collect()
}

pub fn duplicate_identities(root: &Path) -> Result<Vec<DuplicateIdentity>> {
    Ok(duplicate_identities_in(&collect_identities(root)?))
}

/// Read canonical identities once and return both the complete inventory and
/// duplicate groups. Adapters can show a diagnostic without racing a second
/// filesystem pass against a synchronizing provider.
pub fn inspect_identities(root: &Path) -> Result<(Vec<CanonicalFile>, Vec<DuplicateIdentity>)> {
    let files = collect_identities(root)?;
    let duplicates = duplicate_identities_in(&files);
    Ok((files, duplicates))
}

/// Reject duplicate embedded identities before the index transaction clears its
/// previous projection. Both canonical files stay on disk for user resolution.
pub fn scan_identities(root: &Path) -> Result<Vec<CanonicalFile>> {
    let (files, duplicates) = inspect_identities(root)?;
    if let Some(conflict) = duplicates.into_iter().next() {
        let locations = conflict
            .paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let kind = conflict.kind;
        let id = conflict.id;
        return Err(JinError::SyncConflict(format!(
            "duplicate {kind} id {id} in canonical files: {locations}. Keep both files and resolve the conflict before continuing"
        )));
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use crate::ops::notes::{create_note, CreateNoteParams};
    use tempfile::TempDir;

    #[test]
    fn provider_conflict_filename_with_same_embedded_id_is_rejected() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let note = create_note(
            &vault.path().join("notes"),
            CreateNoteParams {
                title: "Original".to_string(),
                body: "first version".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let original = fs::find_note_path(&vault.path().join("notes"), note.id()).unwrap();
        let conflict = vault
            .path()
            .join("notes")
            .join(format!("{}--Original (conflicted copy).md", note.id()));
        std::fs::copy(original, conflict).unwrap();
        assert!(matches!(
            scan_identities(vault.path()),
            Err(JinError::SyncConflict(_))
        ));
    }
}
