use std::collections::BTreeMap;

use chrono::Local;
use std::path::Path;

use crate::id::new_ulid;
use crate::model::{validate_property_key, Note, NoteFrontmatter, NoteStatus, PropertyValue};
use crate::store::fs;
use crate::{JinError, Result};

use super::recovery;

/// Parameters for creating a note.
/// Wave 2A: `folder` is the relative folder path (validated, `/`-joined).
pub struct CreateNoteParams {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    /// Relative folder path (validated). `""` = root "Notes" folder (default).
    pub folder: String,
}

/// Parameters for editing an existing note.
/// `None`/empty fields are left unchanged.
pub struct EditNoteParams {
    pub title: Option<String>,
    pub body: Option<String>,
    /// Tags to add (idempotent — duplicates ignored).
    pub add_tags: Vec<String>,
    /// Tags to remove (idempotent — no-ops if tag is not present).
    pub rm_tags: Vec<String>,
    /// Replace the strict portable property map. Unknown frontmatter remains
    /// untouched; `None` leaves the current property map unchanged.
    pub properties: Option<BTreeMap<String, PropertyValue>>,
    /// Optional optimistic-concurrency precondition for recovery-safe clients.
    pub expected_revision: Option<u64>,
}

/// Create a new Note, write it to disk, return the Note.
/// Wave 2A: writes into the specified folder (D-UI-NEWNOTE, AC-S5.1).
pub fn create_note(notes_dir: &Path, params: CreateNoteParams) -> Result<Note> {
    fs::validate_folder_path(&params.folder)?;
    let now = Local::now().fixed_offset();
    let id = new_ulid();
    let fm = NoteFrontmatter {
        id: id.clone(),
        kind: "note".to_string(),
        title: params.title,
        created: now,
        updated: now,
        status: NoteStatus::Active,
        deleted_at: None,
        tags: params.tags,
        links: vec![],
        properties: BTreeMap::new(),
        revision: 1,
        extra: BTreeMap::new(),
    };
    let note = Note {
        frontmatter: fm,
        body: params.body,
    };
    fs::write_note_in(notes_dir, &params.folder, &note)?;
    Ok(note)
}

/// Read a Note by id.
pub fn get_note(notes_dir: &Path, id: &str) -> Result<Note> {
    let path = fs::find_note_path(notes_dir, id)?;
    fs::read_note(&path)
}

/// List all non-deleted notes, sorted by id (deterministic).
pub fn list_notes(notes_dir: &Path, include_deleted: bool) -> Result<Vec<Note>> {
    let paths = fs::list_note_paths(notes_dir)?;
    let mut notes = Vec::new();
    for path in &paths {
        let note = fs::read_note(path)?;
        if include_deleted || !note.is_deleted() {
            notes.push(note);
        }
    }
    // Sort by id (ULID = time-ordered, so this is chronological too)
    notes.sort_by(|a, b| a.id().cmp(b.id()));
    Ok(notes)
}

/// Edit mutable fields of an existing note.
///
/// Wave 2A (D-EDIT-PRESERVE, F-EDIT fix): on title-change, the new file is written
/// into the SAME folder as the old file (not the root). This prevents silent relocation
/// of foldered notes when the title changes.
pub fn edit_note(notes_dir: &Path, id: &str, params: EditNoteParams) -> Result<Note> {
    let old_path = fs::find_note_path(notes_dir, id)?;
    let mut note = fs::read_note(&old_path)?;
    let old_note = note.clone();
    let old_content = std::fs::read(&old_path)?;
    if note.is_deleted() {
        return Err(JinError::NotFound(format!("note/{} is deleted", id)));
    }
    if let Some(expected) = params.expected_revision {
        if note.frontmatter.revision != expected {
            return Err(JinError::StaleNote {
                note_id: id.to_string(),
                expected_revision: expected,
                current_revision: note.frontmatter.revision,
            });
        }
    }

    let mut changed = false;

    if let Some(title) = params.title {
        note.frontmatter.title = title;
        changed = true;
    }
    if let Some(body) = params.body {
        note.body = body;
        changed = true;
    }
    for tag in params.add_tags {
        if !note.frontmatter.tags.contains(&tag) {
            note.frontmatter.tags.push(tag);
            changed = true;
        }
    }
    for tag in &params.rm_tags {
        let before = note.frontmatter.tags.len();
        note.frontmatter.tags.retain(|t| t != tag);
        if note.frontmatter.tags.len() != before {
            changed = true;
        }
    }
    if let Some(properties) = params.properties {
        for key in properties.keys() {
            validate_property_key(key)?;
        }
        if note.frontmatter.properties != properties {
            note.frontmatter.properties = properties;
            changed = true;
        }
    }

    if changed {
        let now = Local::now().fixed_offset();
        note.frontmatter.updated = now;
        note.frontmatter.revision = note.frontmatter.revision.saturating_add(1);

        // A filename is never identity. Retaining the existing path turns a
        // title edit into one journaled atomic replacement, avoiding the
        // write-new/remove-old crash window and preserving folder placement.
        recovery::journaled_replace(notes_dir, &old_path, &old_note, &old_content, &note)?;
    }

    Ok(note)
}

/// Move a note to a different folder.
///
/// Write-new-then-remove-old (reuses the title-change mechanic).
/// Does NOT mutate frontmatter — a folder is a path, not content.
/// This keeps link-integrity trivial: edges are ULID-based (A2, D-MOVE).
///
/// **Callers MUST call `api::refresh` after this** so that `NoteRow.file_path`
/// is updated in the index. Without refresh, `api::get_note` errors (F2).
pub fn move_note(notes_dir: &Path, id: &str, dest_folder: &str) -> Result<Note> {
    fs::validate_folder_path(dest_folder)?;
    let old_path = fs::find_note_path(notes_dir, id)?;
    let note = fs::read_note(&old_path)?;
    if note.is_deleted() {
        return Err(JinError::NotFound(format!(
            "note/{} is deleted and cannot be moved",
            id
        )));
    }
    let new_path = fs::write_note_in(notes_dir, dest_folder, &note)?;
    if new_path != old_path {
        std::fs::remove_file(&old_path)?;
    }
    Ok(note)
}

/// Rename a folder, moving all notes under it (and nested subfolders) to the
/// new prefix via the proven `move_note` mechanic (ULID-based → links survive).
///
/// **Algorithm:**
/// 1. Validate + refuse: root rename, empty new_path, new==old, own-descendant,
///    collision (new_path dir already exists).
/// 2. Snapshot `(id, current_folder)` for every note in the subtree BEFORE any
///    mutation, and snapshot all subdirs.
/// 3. For each note: `dest = new_path + folder[old_path.len()..]` → `move_note`.
/// 4. Recreate empty descendant subdirs under new prefix (D-RENAME-EMPTY-SUBDIRS).
/// 5. R-ORPHAN-DIR guard: scan old subtree for remaining `.md`; return `Err` if
///    any remain. Then `remove_dir_all` the now-empty old tree.
///
/// **Callers MUST call `api::refresh` after this** so the index self-heals.
pub fn rename_folder(notes_dir: &Path, old_path: &str, new_path: &str) -> Result<()> {
    if old_path.is_empty() {
        return Err(JinError::InvalidInput(
            "cannot rename the root folder".to_string(),
        ));
    }
    fs::validate_folder_path(new_path)?;
    if new_path.is_empty() {
        return Err(JinError::InvalidInput(
            "new folder path must not be empty".to_string(),
        ));
    }
    if new_path == old_path {
        return Err(JinError::InvalidInput(
            "new path equals old path".to_string(),
        ));
    }
    let descendant_prefix = format!("{}/", old_path);
    if new_path.starts_with(&descendant_prefix) {
        return Err(JinError::InvalidInput(
            "cannot rename a folder into its own descendant".to_string(),
        ));
    }
    // D-RENAME-COLLISION: refuse if destination already exists on disk.
    if notes_dir.join(new_path).exists() {
        return Err(JinError::InvalidInput(
            "destination folder already exists".to_string(),
        ));
    }

    // Snapshot BEFORE mutation: (id, current_folder) for every note in old subtree.
    let all_paths = fs::list_note_paths(notes_dir)?;
    let mut notes_snapshot: Vec<(String, String)> = Vec::new();
    for path in &all_paths {
        let folder = fs::folder_path_of(notes_dir, path);
        if folder == old_path || folder.starts_with(&descendant_prefix) {
            let note = fs::read_note(path)?;
            notes_snapshot.push((note.frontmatter.id.clone(), folder));
        }
    }

    // Snapshot all subdirs under old_path (for D-RENAME-EMPTY-SUBDIRS).
    let all_folders = fs::list_note_folders(notes_dir)?;
    let subdirs: Vec<String> = all_folders
        .into_iter()
        .filter(|d| d == old_path || d.starts_with(&descendant_prefix))
        .collect();

    // Move each note to the new prefix.
    // suffix = "" for exact match (Work→Job), "/Sub" for nested (Work/Sub→Job/Sub).
    for (id, folder) in &notes_snapshot {
        let suffix = &folder[old_path.len()..];
        let dest = format!("{}{}", new_path, suffix);
        move_note(notes_dir, id, &dest)?;
    }

    // Recreate empty descendant subdirs under new prefix (D-RENAME-EMPTY-SUBDIRS).
    for d in &subdirs {
        let suffix = &d[old_path.len()..];
        let new_dir = notes_dir.join(format!("{}{}", new_path, suffix));
        std::fs::create_dir_all(&new_dir)?;
    }

    // R-ORPHAN-DIR guard: scan old subtree for remaining .md files before removing.
    let old_dir = notes_dir.join(old_path);
    if old_dir.exists() {
        let remaining = fs::list_note_paths(&old_dir)?;
        if !remaining.is_empty() {
            return Err(JinError::Integrity(format!(
                "rename_folder: {} note(s) remain under '{}' after move — \
                 aborting removal to prevent data loss (R-ORPHAN-DIR)",
                remaining.len(),
                old_path
            )));
        }
        std::fs::remove_dir_all(&old_dir)?;
    }

    Ok(())
}

/// Delete a folder non-destructively (move-to-parent, D-DELETE-POLICY).
///
/// Moves ALL notes in the folder subtree to `parent_of(path)` (flattening
/// the entire subtree into the parent). Removes the now-empty directory tree.
/// Returns the count of notes moved. Refuses deleting the root `""`.
///
/// **Callers MUST call `api::refresh` after this** so the index self-heals.
pub fn delete_folder(notes_dir: &Path, path: &str) -> Result<usize> {
    if path.is_empty() {
        return Err(JinError::InvalidInput(
            "cannot delete the root folder".to_string(),
        ));
    }
    fs::validate_folder_path(path)?; // defensive
    let parent = fs::parent_of(path);

    // Snapshot: collect ids for all notes in the subtree.
    let all_paths = fs::list_note_paths(notes_dir)?;
    let path_prefix = format!("{}/", path);
    let mut ids: Vec<String> = Vec::new();
    for p in &all_paths {
        let folder = fs::folder_path_of(notes_dir, p);
        if folder == path || folder.starts_with(&path_prefix) {
            let note = fs::read_note(p)?;
            ids.push(note.frontmatter.id.clone());
        }
    }

    // Move all notes to parent (flatten entire subtree → parent).
    for id in &ids {
        move_note(notes_dir, id, parent)?;
    }

    // R-ORPHAN-DIR guard: scan path subtree for remaining .md files before removing.
    let path_dir = notes_dir.join(path);
    if path_dir.exists() {
        let remaining = fs::list_note_paths(&path_dir)?;
        if !remaining.is_empty() {
            return Err(JinError::Integrity(format!(
                "delete_folder: {} note(s) remain under '{}' after move — \
                 aborting removal to prevent data loss (R-ORPHAN-DIR)",
                remaining.len(),
                path
            )));
        }
        std::fs::remove_dir_all(&path_dir)?;
    }

    Ok(ids.len())
}

/// Soft-delete a note (status → deleted, deleted_at set).
pub fn delete_note(notes_dir: &Path, id: &str) -> Result<Note> {
    let path = fs::find_note_path(notes_dir, id)?;
    let mut note = fs::read_note(&path)?;
    let old_note = note.clone();
    let old_content = std::fs::read(&path)?;
    if note.is_deleted() {
        return Err(JinError::NotFound(format!("note/{} already deleted", id)));
    }
    let now = Local::now().fixed_offset();
    note.frontmatter.status = NoteStatus::Deleted;
    note.frontmatter.deleted_at = Some(now);
    note.frontmatter.updated = now;
    note.frontmatter.revision = note.frontmatter.revision.saturating_add(1);
    recovery::journaled_replace(notes_dir, &path, &old_note, &old_content, &note)?;
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_notes_dir() -> TempDir {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path()).unwrap();
        tmp
    }

    /// VG-EDIT-SAME-SLUG (Issue 3): editing a note's title to a value that produces
    /// the same slug must NOT delete the file.
    /// Previously: write_note_in → remove_file unconditionally → file gone when paths equal.
    #[test]
    fn vg_edit_same_slug_does_not_destroy_note() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        // Create a note titled "Test".
        let note = create_note(
            notes,
            CreateNoteParams {
                title: "Test".to_string(),
                body: "precious body content".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let id = note.frontmatter.id.clone();

        // Edit to "Test!" — slugify("Test!") == "test" == slugify("Test"),
        // so the path-after-edit equals path-before-edit.
        let edited = edit_note(
            notes,
            &id,
            EditNoteParams {
                title: Some("Test!".to_string()),
                body: None,
                add_tags: vec![],
                rm_tags: vec![],
                properties: None,
                expected_revision: None,
            },
        )
        .expect("edit to same-slug title must succeed");
        assert_eq!(edited.frontmatter.title, "Test!");

        // File must still exist.
        let found_path = fs::find_note_path(notes, &id)
            .expect("VG-EDIT-SAME-SLUG: note must still exist after same-slug title change");

        // Body must be intact.
        let content = std::fs::read_to_string(&found_path).unwrap();
        assert!(
            content.contains("precious body content"),
            "VG-EDIT-SAME-SLUG: body must be intact; got snippet: {:?}",
            &content[..content.len().min(200)]
        );
        assert!(
            content.contains("Test!"),
            "VG-EDIT-SAME-SLUG: new title must appear in frontmatter"
        );
    }

    // ── VG-RENAME-CORE (S1) ───────────────────────────────────────────────────

    /// Helper: create a note in a given folder, return its id.
    fn seed_note(notes: &Path, folder: &str, title: &str) -> String {
        let note = create_note(
            notes,
            CreateNoteParams {
                title: title.to_string(),
                body: "body".to_string(),
                tags: vec![],
                folder: folder.to_string(),
            },
        )
        .unwrap();
        note.frontmatter.id.clone()
    }

    /// VG-RENAME-CORE: basic rename Work→Job moves files, removes old dir.
    #[test]
    fn vg_rename_core_moves_notes_and_removes_old_dir() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        let id_work = seed_note(notes, "Work", "Work Note");
        let id_proj = seed_note(notes, "Work/Projects", "Project Note");

        rename_folder(notes, "Work", "Job").expect("rename_folder must succeed");

        // Notes must now live under Job / Job/Projects
        let path_work = fs::find_note_path(notes, &id_work).expect("Work note after rename");
        let path_proj = fs::find_note_path(notes, &id_proj).expect("Project note after rename");

        assert!(
            path_work.to_string_lossy().contains("Job"),
            "Work note must be under Job; got {:?}",
            path_work
        );
        assert!(
            path_proj.to_string_lossy().contains("Job/Projects"),
            "Project note must be under Job/Projects; got {:?}",
            path_proj
        );

        // Old tree must be gone
        assert!(
            !notes.join("Work").exists(),
            "notes/Work must be removed after rename"
        );
    }

    /// VG-RENAME-CORE: empty subdir is recreated under new prefix (D-RENAME-EMPTY-SUBDIRS).
    #[test]
    fn vg_rename_core_preserves_empty_subdir() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        seed_note(notes, "Work", "Work Note");
        // Create an empty subdirectory
        std::fs::create_dir_all(notes.join("Work/Empty")).unwrap();

        rename_folder(notes, "Work", "Job").expect("rename_folder must succeed");

        assert!(
            notes.join("Job/Empty").is_dir(),
            "notes/Job/Empty must exist after rename (D-RENAME-EMPTY-SUBDIRS)"
        );
    }

    /// VG-RENAME-CORE: collision — rename to existing dir returns Err; old dir untouched.
    #[test]
    fn vg_rename_core_collision_returns_err() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        seed_note(notes, "Work", "Work Note");
        std::fs::create_dir_all(notes.join("Existing")).unwrap();

        let err = rename_folder(notes, "Work", "Existing")
            .expect_err("rename to existing folder must fail");
        assert!(
            err.to_string().to_lowercase().contains("exist")
                || err.to_string().to_lowercase().contains("invalid"),
            "error must mention collision; got: {err}"
        );
        // Old dir must be untouched
        assert!(
            notes.join("Work").is_dir(),
            "notes/Work must remain after collision Err"
        );
    }

    /// VG-RENAME-CORE: renaming root ("") must fail.
    #[test]
    fn vg_rename_core_refuses_root_rename() {
        let tmp = make_notes_dir();
        let notes = tmp.path();
        let err = rename_folder(notes, "", "X").expect_err("root rename must be refused");
        assert!(
            err.to_string().contains("root") || err.to_string().contains("invalid"),
            "error must mention root; got: {err}"
        );
    }

    /// VG-RENAME-CORE: renaming into own descendant must fail.
    #[test]
    fn vg_rename_core_refuses_own_descendant() {
        let tmp = make_notes_dir();
        let notes = tmp.path();
        seed_note(notes, "Work", "Work Note");
        let err = rename_folder(notes, "Work", "Work/Sub")
            .expect_err("own-descendant rename must be refused");
        assert!(
            err.to_string().contains("descendant") || err.to_string().contains("invalid"),
            "error must mention descendant; got: {err}"
        );
    }

    // ── VG-DELETE-CORE (S2) ───────────────────────────────────────────────────

    /// VG-DELETE-CORE: delete Work flattens Work + Work/Projects to root; removes notes/Work.
    #[test]
    fn vg_delete_core_flattens_to_root_and_removes_dir() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        let id_work = seed_note(notes, "Work", "Work Note");
        let id_proj = seed_note(notes, "Work/Projects", "Project Note");
        let id_root = seed_note(notes, "", "Root Note");

        let count = delete_folder(notes, "Work").expect("delete_folder must succeed");

        // Moved count: Work (1) + Work/Projects (1) = 2
        assert_eq!(count, 2, "delete_folder must return moved count == 2");

        // Both notes must now be at root (folder_path == "")
        let path_work = fs::find_note_path(notes, &id_work).expect("Work note after delete");
        let path_proj = fs::find_note_path(notes, &id_proj).expect("Project note after delete");
        assert_eq!(
            fs::folder_path_of(notes, &path_work),
            "",
            "Work note must be at root after delete"
        );
        assert_eq!(
            fs::folder_path_of(notes, &path_proj),
            "",
            "Project note must be at root after delete"
        );

        // Root note must be untouched
        let path_root = fs::find_note_path(notes, &id_root).expect("Root note must remain");
        assert_eq!(
            fs::folder_path_of(notes, &path_root),
            "",
            "Root note must stay at root"
        );

        // notes/Work must be gone
        assert!(
            !notes.join("Work").exists(),
            "notes/Work must be removed after delete"
        );
    }

    /// VG-DELETE-CORE: delete A/B flattens A/B/C note to "A" (parent of A/B).
    #[test]
    fn vg_delete_core_nested_parent_flatten() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        let id_abc = seed_note(notes, "A/B/C", "Deep Note");
        // Also create a note directly in A to ensure A remains
        let id_a = seed_note(notes, "A", "A Note");

        let count = delete_folder(notes, "A/B").expect("delete A/B must succeed");
        // A/B/C has one note → count == 1
        assert_eq!(
            count, 1,
            "delete A/B must return count 1 (A/B/C has 1 note)"
        );

        // The A/B/C note must now be at "A" (parent of A/B)
        let path_abc = fs::find_note_path(notes, &id_abc).expect("A/B/C note after delete");
        assert_eq!(
            fs::folder_path_of(notes, &path_abc),
            "A",
            "A/B/C note must be at 'A' after delete A/B"
        );

        // The A note must remain at A
        let path_a = fs::find_note_path(notes, &id_a).expect("A note must remain");
        assert_eq!(fs::folder_path_of(notes, &path_a), "A");

        // notes/A/B must be gone; notes/A must remain
        assert!(
            !notes.join("A/B").exists(),
            "notes/A/B must be removed after delete"
        );
        assert!(
            notes.join("A").is_dir(),
            "notes/A must remain after delete A/B"
        );
    }

    /// VG-DELETE-CORE: deleting root ("") must fail.
    #[test]
    fn vg_delete_core_refuses_root() {
        let tmp = make_notes_dir();
        let notes = tmp.path();
        let err = delete_folder(notes, "").expect_err("root delete must be refused");
        assert!(
            err.to_string().contains("root") || err.to_string().contains("invalid"),
            "error must mention root; got: {err}"
        );
    }

    /// VG-VALIDATE-BACKSLASH (Issue 2): validate_folder_path rejects all backslashes.
    #[test]
    fn vg_edit_validate_backslash_rejected_on_create() {
        let tmp = make_notes_dir();
        let notes = tmp.path();

        let err = create_note(
            notes,
            CreateNoteParams {
                title: "X".to_string(),
                body: String::new(),
                tags: vec![],
                folder: "foo\\bar".to_string(),
            },
        )
        .expect_err("backslash folder must be rejected");
        let msg = err.to_string();
        assert!(
            msg.contains("backslash") || msg.contains("invalid input"),
            "error must mention backslash or invalid input; got: {msg}"
        );
    }
}
