//! Filesystem store: read/write Note/Task/Event/List/Tag files.
//!
//! Canonical layout:
//!   <root>/notes/<ULID>--<slug>.md                  (root notes)
//!   <root>/notes/<Folder>/.../<ULID>--<slug>.md     (foldered notes, Wave 2A)
//!   <root>/tasks/<ULID>.md
//!   <root>/events/<ULID>.md
//!   <root>/lists/<id>.md
//!   <root>/tags/<slug>.md

use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::model::{
    Event, EventFrontmatter, List, ListFrontmatter, Note, NoteFrontmatter, Tag, TagFrontmatter,
    Task, TaskFrontmatter,
};
use crate::{JinError, Result};

use super::frontmatter;

static ATOMIC_WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write a complete replacement using a same-directory temporary file, `fsync`,
/// and rename. A same-directory temporary is important: it keeps rename atomic
/// on normal local filesystems. The parent directory is synced when supported
/// so a successful response is as durable as the platform permits.
///
/// No partial canonical Markdown is ever deliberately written at `path`.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| {
        JinError::InvalidInput(format!(
            "cannot atomically write path without parent: {path:?}"
        ))
    })?;
    std::fs::create_dir_all(parent)?;
    let nonce = ATOMIC_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    let temp = parent.join(format!(".{name}.jin-tmp-{}-{nonce}", std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)?;
        // Directory fsync is unsupported on some platforms/filesystems. The
        // rename has still occurred, so do not turn that into a false failure.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    write_result.map_err(JinError::Io)
}

// ──────────────────────────────────────────────────────────────
// Slug derivation
// ──────────────────────────────────────────────────────────────

/// Derive a filesystem-safe slug from a title.
/// Lowercases, replaces non-alphanumeric with `-`, collapses runs, trims edges.
pub fn slugify(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    // Collapse consecutive dashes and trim
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                out.push(c);
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

// ──────────────────────────────────────────────────────────────
// Note I/O
// ──────────────────────────────────────────────────────────────

pub fn note_filename(id: &str, title: &str) -> String {
    format!("{}--{}.md", id, slugify(title))
}

/// Write a Note to disk in a specific folder under `notes_dir`.
/// `folder=""` writes to `notes_dir` directly (root). Creates the directory if needed.
/// D-PATHSEP: `folder` must be `/`-joined relative path (never OS-separator).
pub fn write_note_in(notes_dir: &Path, folder: &str, note: &Note) -> Result<PathBuf> {
    let dir = if folder.is_empty() {
        notes_dir.to_path_buf()
    } else {
        notes_dir.join(folder)
    };
    std::fs::create_dir_all(&dir)?;
    let filename = note_filename(&note.frontmatter.id, &note.frontmatter.title);
    let path = dir.join(&filename);
    let content = frontmatter::render(&note.frontmatter, &note.body)?;
    atomic_write(&path, content.as_bytes())?;
    Ok(path)
}

/// Write a Note to disk in the root `notes_dir`. Overwrites if the path already exists.
/// Delegates to `write_note_in(notes_dir, "", note)` — zero behavior change for existing callers.
pub fn write_note(notes_dir: &Path, note: &Note) -> Result<PathBuf> {
    write_note_in(notes_dir, "", note)
}

/// Read a Note from a path.
pub fn read_note(path: &Path) -> Result<Note> {
    let content = std::fs::read_to_string(path)?;
    let (yaml, body) = frontmatter::split(&content)?;
    let fm: NoteFrontmatter = frontmatter::parse_fm(&yaml)?;
    fm.validate_properties()?;
    Ok(Note {
        frontmatter: fm,
        body,
    })
}

/// Derive the `/`-joined relative folder path of a note file from `notes_dir`.
///
/// For a note at `notes/Work/Projects/x.md`, `notes_dir=notes`, returns `"Work/Projects"`.
/// For a note at `notes/x.md`, returns `""` (root).
/// D-PATHSEP: always uses `/` as separator for cross-OS portability.
pub fn folder_path_of(notes_dir: &Path, path: &Path) -> String {
    path.strip_prefix(notes_dir)
        .ok()
        .and_then(|rel| rel.parent())
        .map(|parent| {
            parent
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// Validate a folder path (D-VALIDATE).
///
/// Rejects: backslashes (Windows path traversal), absolute paths, `..` components,
/// `.` components, and empty components (e.g. `a//b`).
/// Empty string `""` is accepted (the root folder).
///
/// D-PATHSEP: folder paths are always `/`-joined; backslashes are NEVER valid,
/// even as part of a component name.  `foo\..\..\bar` is one slash-split
/// component that doesn't match ".." but on Windows `Path::join` resolves
/// it as traversal — reject all backslashes unconditionally.
pub fn validate_folder_path(folder: &str) -> Result<()> {
    if folder.is_empty() {
        return Ok(());
    }
    // Backslash rejection must come before the leading-slash check so that
    // `\abs` also hits this branch and gives a clear error.
    if folder.contains('\\') {
        return Err(JinError::InvalidInput(format!(
            "folder path must not contain backslashes (use '/' as separator): {:?}",
            folder
        )));
    }
    if folder.starts_with('/') {
        return Err(JinError::InvalidInput(format!(
            "folder path must be relative (no leading slash): {:?}",
            folder
        )));
    }
    for component in folder.split('/') {
        if component.is_empty() {
            return Err(JinError::InvalidInput(format!(
                "folder path has empty component (double-slash?): {:?}",
                folder
            )));
        }
        if component == ".." {
            return Err(JinError::InvalidInput(format!(
                "folder path must not contain '..': {:?}",
                folder
            )));
        }
        if component == "." {
            return Err(JinError::InvalidInput(format!(
                "folder path must not contain '.': {:?}",
                folder
            )));
        }
    }
    Ok(())
}

/// List all note files under `notes_dir` recursively (.md only, deterministic sort).
///
/// S1 (Wave 2A): walks all subdirectories, collects `.md` files.
/// `find_note_path` loops over the result of this function, so making it
/// recursive automatically makes `find_note_path` recursive too (A4).
pub fn list_note_paths(notes_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if notes_dir.exists() {
        collect_note_paths_recursive(notes_dir, &mut paths)?;
    }
    paths.sort();
    Ok(paths)
}

fn collect_note_paths_recursive(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Skip hidden entries (names starting with '.') — e.g. .obsidian, .DS_Store.
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry.file_type()?;

        // Skip symlinks — following them can cause cycles (unbounded recursion).
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            collect_note_paths_recursive(&path, paths)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    Ok(())
}

/// List all subdirectories of `notes_dir` (including empty ones) as `/`-joined
/// relative paths. The root `""` is always present. Deterministic (BTreeSet) order.
///
/// S1 (Wave 2A): used by `list_folders` to surface empty folders (D-EMPTY).
pub fn list_note_folders(notes_dir: &Path) -> Result<Vec<String>> {
    let mut folders: BTreeSet<String> = BTreeSet::new();
    folders.insert(String::new()); // root always present
    if notes_dir.exists() {
        collect_note_folders_recursive(notes_dir, notes_dir, &mut folders)?;
    }
    Ok(folders.into_iter().collect())
}

fn collect_note_folders_recursive(
    notes_dir: &Path,
    dir: &Path,
    folders: &mut BTreeSet<String>,
) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Skip hidden entries (names starting with '.') — e.g. .obsidian, .DS_Store.
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry.file_type()?;

        // Skip symlinks — following them can cause cycles (unbounded recursion).
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let path = entry.path();
            // `folder_path_of` is for FILES (it calls .parent() to get the containing dir).
            // For DIRECTORIES we strip_prefix without .parent() — otherwise notes/Empty
            // would compute to "" (the parent of "Empty") instead of "Empty".
            let rel = path
                .strip_prefix(notes_dir)
                .map(|r| {
                    r.components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_default();
            folders.insert(rel);
            collect_note_folders_recursive(notes_dir, &path, folders)?;
        }
    }
    Ok(())
}

/// Return the parent folder of a `/`-joined relative path (pure, no I/O).
///
/// ```
/// # use jin_core::store::fs::parent_of;
/// assert_eq!(parent_of("Work"),          "");
/// assert_eq!(parent_of("Work/Projects"), "Work");
/// assert_eq!(parent_of(""),              "");
/// ```
pub fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
}

/// Find the path of a note by its ULID id.
/// Now recursive (A4): loops over `list_note_paths` which walks all subdirs.
pub fn find_note_path(notes_dir: &Path, id: &str) -> Result<PathBuf> {
    for path in list_note_paths(notes_dir)? {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem.starts_with(id) {
                return Ok(path);
            }
        }
    }
    Err(JinError::NotFound(format!("note/{}", id)))
}

// ──────────────────────────────────────────────────────────────
// Task I/O
// ──────────────────────────────────────────────────────────────

pub fn task_filename(id: &str) -> String {
    format!("{}.md", id)
}

pub fn write_task(tasks_dir: &Path, task: &Task) -> Result<PathBuf> {
    let path = tasks_dir.join(task_filename(&task.frontmatter.id));
    let content = frontmatter::render(&task.frontmatter, &task.body)?;
    std::fs::write(&path, content)?;
    Ok(path)
}

pub fn read_task(path: &Path) -> Result<Task> {
    let content = std::fs::read_to_string(path)?;
    let (yaml, body) = frontmatter::split(&content)?;
    let fm: TaskFrontmatter = frontmatter::parse_fm(&yaml)?;
    Ok(Task {
        frontmatter: fm,
        body,
    })
}

pub fn list_task_paths(tasks_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if !tasks_dir.exists() {
        return Ok(paths);
    }
    for entry in std::fs::read_dir(tasks_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn find_task_path(tasks_dir: &Path, id: &str) -> Result<PathBuf> {
    let path = tasks_dir.join(task_filename(id));
    if path.exists() {
        Ok(path)
    } else {
        Err(JinError::NotFound(format!("task/{}", id)))
    }
}

// ──────────────────────────────────────────────────────────────
// Event I/O
// ──────────────────────────────────────────────────────────────

pub fn event_filename(id: &str) -> String {
    format!("{}.md", id)
}

pub fn write_event(events_dir: &Path, event: &Event) -> Result<PathBuf> {
    let path = events_dir.join(event_filename(&event.frontmatter.id));
    let content = frontmatter::render(&event.frontmatter, &event.body)?;
    atomic_write(&path, content.as_bytes())?;
    Ok(path)
}

/// Render the exact canonical representation used by `write_event` without
/// touching disk. Recoverable operations stage this complete post-image.
pub fn render_event_bytes(event: &Event) -> Result<Vec<u8>> {
    Ok(frontmatter::render(&event.frontmatter, &event.body)?.into_bytes())
}

pub fn read_event(path: &Path) -> Result<Event> {
    let content = std::fs::read_to_string(path)?;
    parse_event_bytes(content.as_bytes())
}

pub fn parse_event_bytes(bytes: &[u8]) -> Result<Event> {
    let content = std::str::from_utf8(bytes)
        .map_err(|error| JinError::Integrity(format!("event is not UTF-8: {error}")))?;
    let (yaml, body) = frontmatter::split(content)?;
    let fm: EventFrontmatter = frontmatter::parse_fm(&yaml)?;
    Ok(Event {
        frontmatter: fm,
        body,
    })
}

pub fn list_event_paths(events_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if !events_dir.exists() {
        return Ok(paths);
    }
    for entry in std::fs::read_dir(events_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn find_event_path(events_dir: &Path, id: &str) -> Result<PathBuf> {
    let path = events_dir.join(event_filename(id));
    if path.exists() {
        Ok(path)
    } else {
        Err(JinError::NotFound(format!("event/{}", id)))
    }
}

// ──────────────────────────────────────────────────────────────
// List I/O
// ──────────────────────────────────────────────────────────────

pub fn list_filename(id: &str) -> String {
    format!("{}.md", id)
}

pub fn write_list(lists_dir: &Path, list: &List) -> Result<PathBuf> {
    std::fs::create_dir_all(lists_dir)?;
    let path = lists_dir.join(list_filename(&list.frontmatter.id));
    let content = frontmatter::render(&list.frontmatter, &list.body)?;
    std::fs::write(&path, content)?;
    Ok(path)
}

pub fn read_list(path: &Path) -> Result<List> {
    let content = std::fs::read_to_string(path)?;
    let (yaml, body) = frontmatter::split(&content)?;
    let fm: ListFrontmatter = frontmatter::parse_fm(&yaml)?;
    Ok(List {
        frontmatter: fm,
        body,
    })
}

pub fn list_list_paths(lists_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if !lists_dir.exists() {
        return Ok(paths);
    }
    for entry in std::fs::read_dir(lists_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn find_list_path(lists_dir: &Path, id: &str) -> Result<PathBuf> {
    let path = lists_dir.join(list_filename(id));
    if path.exists() {
        Ok(path)
    } else {
        Err(JinError::NotFound(format!("list/{}", id)))
    }
}

// ──────────────────────────────────────────────────────────────
// Tag I/O
// ──────────────────────────────────────────────────────────────

pub fn tag_filename(slug: &str) -> String {
    format!("{}.md", slug)
}

pub fn write_tag(tags_dir: &Path, tag: &Tag) -> Result<PathBuf> {
    std::fs::create_dir_all(tags_dir)?;
    let path = tags_dir.join(tag_filename(&tag.frontmatter.slug));
    let content = frontmatter::render(&tag.frontmatter, &tag.body)?;
    std::fs::write(&path, content)?;
    Ok(path)
}

pub fn read_tag(path: &Path) -> Result<Tag> {
    let content = std::fs::read_to_string(path)?;
    let (yaml, body) = frontmatter::split(&content)?;
    let fm: TagFrontmatter = frontmatter::parse_fm(&yaml)?;
    Ok(Tag {
        frontmatter: fm,
        body,
    })
}

pub fn list_tag_paths(tags_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if !tags_dir.exists() {
        return Ok(paths);
    }
    for entry in std::fs::read_dir(tags_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn find_tag_path(tags_dir: &Path, slug: &str) -> Result<PathBuf> {
    let path = tags_dir.join(tag_filename(slug));
    if path.exists() {
        Ok(path)
    } else {
        Err(JinError::NotFound(format!("tag/{}", slug)))
    }
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("  foo  bar  "), "foo-bar");
        assert_eq!(
            slugify("Book dentist annual checkup"),
            "book-dentist-annual-checkup"
        );
        assert_eq!(slugify("!!!"), "untitled");
    }

    // ── VG-A1: recursive list_note_paths ──────────────────────────────────────

    /// AC-S1.1: list_note_paths recurses into subdirs.
    #[test]
    fn vg_a1_list_note_paths_recurses_into_subdirs() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();
        std::fs::create_dir_all(notes.join("A")).unwrap();
        std::fs::write(notes.join("A/ulid1--x.md"), "---\n---\n").unwrap();
        std::fs::write(notes.join("ulid2--y.md"), "---\n---\n").unwrap();

        let paths = list_note_paths(notes).unwrap();
        assert_eq!(
            paths.len(),
            2,
            "both root and subdir files must be returned"
        );
        let names: Vec<_> = paths
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"ulid1--x.md".to_string()));
        assert!(names.contains(&"ulid2--y.md".to_string()));
    }

    /// AC-S1.2: find_note_path finds a note in a subdir.
    #[test]
    fn vg_a1_find_note_path_finds_in_subdir() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();
        std::fs::create_dir_all(notes.join("Work")).unwrap();
        let id = "01TESTID000000000000000001";
        std::fs::write(
            notes.join("Work").join(format!("{}--title.md", id)),
            "---\n---\n",
        )
        .unwrap();

        let found = find_note_path(notes, id).unwrap();
        assert!(found.to_string_lossy().contains("Work"));
    }

    /// AC-S1.3: list_note_folders includes root, empty dirs, and nested dirs.
    #[test]
    fn vg_a1_list_note_folders_includes_empty_and_nested() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();
        std::fs::create_dir_all(notes.join("Empty")).unwrap();
        std::fs::create_dir_all(notes.join("Work/Projects")).unwrap();

        let folders = list_note_folders(notes).unwrap();
        // BTreeSet order: "" < "Empty" < "Work" < "Work/Projects"
        assert!(folders.contains(&"".to_string()), "root must be present");
        assert!(folders.contains(&"Empty".to_string()));
        assert!(folders.contains(&"Work".to_string()));
        assert!(folders.contains(&"Work/Projects".to_string()));
    }

    /// AC-S1.4: write_note_in creates the folder and writes the file.
    #[test]
    fn vg_a1_write_note_in_creates_dir_and_writes() {
        use crate::model::note::{Note, NoteFrontmatter, NoteStatus};
        use chrono::DateTime;

        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();

        let fm = NoteFrontmatter {
            id: "01TEST".to_string(),
            kind: "note".to_string(),
            title: "My Note".to_string(),
            created: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            updated: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            status: NoteStatus::Active,
            deleted_at: None,
            tags: vec![],
            links: vec![],
            properties: Default::default(),
            revision: 1,
            extra: Default::default(),
        };
        let note = Note {
            frontmatter: fm,
            body: String::new(),
        };

        let path = write_note_in(notes, "Work", &note).unwrap();
        assert!(path.exists(), "note file must be created");
        assert!(
            path.to_string_lossy().contains("Work"),
            "note must be in the Work folder"
        );
        assert!(notes.join("Work").is_dir(), "Work dir must be created");
    }

    // ── VG-VALIDATE ───────────────────────────────────────────────────────────

    /// AC-S1.5: validate_folder_path rejects bad paths.
    #[test]
    fn vg_validate_rejects_traversal_and_absolute() {
        assert!(validate_folder_path("../x").is_err(), ".. must be rejected");
        assert!(
            validate_folder_path("/abs").is_err(),
            "absolute path must be rejected"
        );
        assert!(
            validate_folder_path("a//b").is_err(),
            "double-slash must be rejected"
        );
        assert!(
            validate_folder_path("Work/Projects").is_ok(),
            "valid nested path must pass"
        );
        assert!(validate_folder_path("").is_ok(), "root (empty) must pass");
        assert!(
            validate_folder_path("Work").is_ok(),
            "simple folder must pass"
        );
    }

    /// folder_path_of: note at root returns "".
    #[test]
    fn folder_path_of_root_note_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();
        let path = notes.join("ulid--title.md");
        assert_eq!(folder_path_of(notes, &path), "");
    }

    /// folder_path_of: note in subdir returns correct relative path.
    #[test]
    fn folder_path_of_subdir_note_returns_relative() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();
        let path = notes.join("Work/Projects/ulid--title.md");
        assert_eq!(folder_path_of(notes, &path), "Work/Projects");
    }

    // ── VG-VALIDATE-BACKSLASH (Issue 2) ──────────────────────────────────────

    /// Backslash-based path traversal must be rejected (Windows sovereignty breach).
    /// `foo\..\..\bar` is a single slash-split component — it doesn't match ".." in
    /// the per-component check but on Windows Path::join resolves it as traversal.
    /// Rejecting ALL backslashes is the correct fix.
    #[test]
    fn vg_validate_rejects_backslash_paths() {
        // Windows-style traversal attempts
        assert!(
            validate_folder_path("..\\x").is_err(),
            "..\\x must be rejected"
        );
        assert!(
            validate_folder_path("foo\\..\\..\\bar").is_err(),
            "foo\\..\\..\\bar must be rejected"
        );
        assert!(
            validate_folder_path("a\\b").is_err(),
            "a\\b (backslash separator) must be rejected"
        );
        // Existing cases must still pass
        assert!(
            validate_folder_path("../x").is_err(),
            ".. must still be rejected"
        );
        assert!(
            validate_folder_path("/abs").is_err(),
            "absolute path must still be rejected"
        );
        assert!(
            validate_folder_path("a//b").is_err(),
            "double-slash must still be rejected"
        );
        assert!(
            validate_folder_path("Work/Projects").is_ok(),
            "valid path must still pass"
        );
        assert!(validate_folder_path("").is_ok(), "root must still pass");
    }

    // ── VG-PARENT-OF (S1) ────────────────────────────────────────────────────

    /// parent_of: "Work" → ""; "Work/Projects" → "Work"; "" → ""
    #[test]
    fn vg_parent_of_cases() {
        assert_eq!(
            parent_of("Work"),
            "",
            "top-level folder parent must be root"
        );
        assert_eq!(
            parent_of("Work/Projects"),
            "Work",
            "nested folder parent must be prefix"
        );
        assert_eq!(parent_of(""), "", "root parent is root");
        assert_eq!(parent_of("A/B/C"), "A/B", "deeply nested parent");
    }

    // ── VG-HIDDEN-DIR (Issue 4) ───────────────────────────────────────────────

    /// Hidden dirs (`.name`) are NOT walked — neither as note paths nor as folders.
    #[test]
    fn vg_hidden_dir_is_not_walked() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path();

        // Create a hidden dir with a note inside — must NOT be indexed.
        std::fs::create_dir_all(notes.join(".obsidian")).unwrap();
        std::fs::write(notes.join(".obsidian/config.md"), "---\n---\n").unwrap();

        // Also a real non-hidden note at root
        std::fs::write(notes.join("ulid1--real.md"), "---\n---\n").unwrap();

        // list_note_paths must not return the hidden dir's file
        let paths = list_note_paths(notes).unwrap();
        assert_eq!(paths.len(), 1, "only the real note must be returned");
        assert!(
            paths[0].to_string_lossy().contains("ulid1--real"),
            "real note must be included"
        );

        // list_note_folders must not include ".obsidian"
        let folders = list_note_folders(notes).unwrap();
        assert!(
            !folders.iter().any(|f| f.contains(".obsidian")),
            "hidden dir must not appear in folder list; got: {:?}",
            folders
        );
    }
}
