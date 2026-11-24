//! Device-local immutable observations of canonical data.
//!
//! The history directory is derived from `Config::jin_dir()`. Portable
//! workspaces resolve that directory outside the shared folder, so provider
//! replacement cannot delete the only local copy Jin observed.

use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use crate::store::fs;
use crate::{Config, JinError, Result};

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn extension(path: &Path) -> &str {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin")
}
fn component_digest(value: &str) -> String {
    digest(value.as_bytes())
}

fn safe_kind(kind: &str) -> Result<&str> {
    if !kind.is_empty() && kind.bytes().all(|byte| byte.is_ascii_lowercase()) {
        Ok(kind)
    } else {
        Err(JinError::InvalidInput(
            "history kind must be lower-case ASCII".to_string(),
        ))
    }
}

fn archive_at(
    state_dir: &Path,
    kind: &str,
    id: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf> {
    let kind = safe_kind(kind)?;
    let extension = if extension
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        extension
    } else {
        "bin"
    };
    // Object ids originate in user-editable frontmatter. Hashing this path
    // component prevents traversal, Windows-reserved names, and symlink tricks.
    let path = state_dir
        .join("history")
        .join(kind)
        .join(component_digest(id))
        .join(format!("{}.{}", digest(bytes), extension));
    if path.exists() {
        if std::fs::read(&path)? != bytes {
            return Err(JinError::Integrity(format!(
                "history hash collision at {}",
                path.display()
            )));
        }
        return Ok(path);
    }
    fs::atomic_write(&path, bytes)?;
    Ok(path)
}

/// Archive a complete observed representation by content hash. Repeated scans
/// are idempotent and retain divergent revisions side by side.
pub fn archive_bytes(
    root: &Path,
    kind: &str,
    id: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf> {
    let cfg = Config::load(root)?;
    archive_at(&cfg.jin_dir(), kind, id, extension, bytes)
}

/// Preserve every valid object representation observed after an index rebuild.
pub fn archive_observations(
    root: &Path,
    files: &[super::canonical_scan::CanonicalFile],
) -> Result<()> {
    let cfg = Config::load(root)?;
    let state_dir = cfg.jin_dir();
    for file in files {
        let bytes = std::fs::read(&file.path)?;
        archive_at(
            &state_dir,
            file.kind,
            &file.id,
            extension(&file.path),
            &bytes,
        )?;
    }
    // Attachments are already content addressed. Their manifest is mutable and
    // must be retained independently so a provider overwrite is recoverable.
    let manifest = root.join(".jin/assets/manifest.json");
    if manifest.exists() {
        archive_at(
            &state_dir,
            "assets",
            "manifest",
            "json",
            &std::fs::read(manifest)?,
        )?;
    }
    Ok(())
}

pub(crate) fn current_fingerprint(root: &Path) -> Result<String> {
    let mut paths = Vec::new();
    paths.extend(fs::list_note_paths(&root.join("notes"))?);
    paths.extend(fs::list_task_paths(&root.join("tasks"))?);
    paths.extend(fs::list_event_paths(&root.join("events"))?);
    paths.extend(fs::list_list_paths(&root.join("lists"))?);
    paths.extend(fs::list_tag_paths(&root.join("tags"))?);
    let collections = root.join("collections");
    if collections.exists() {
        for entry in std::fs::read_dir(&collections)? {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
                paths.push(path);
            }
        }
    }
    let manifest = root.join(".jin/assets/manifest.json");
    if manifest.exists() {
        paths.push(manifest);
    }
    paths.sort();
    let mut hasher = Sha256::new();
    for path in paths {
        let relative = path.strip_prefix(root).map_err(|_| {
            JinError::Integrity(format!(
                "canonical path escaped workspace: {}",
                path.display()
            ))
        })?;
        let bytes = std::fs::read(&path)?;
        hasher.update((relative.as_os_str().len() as u64).to_be_bytes());
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(&bytes);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Returns true when an external provider changed the canonical tree since
/// Jin last made a projection. The marker stays in device-local runtime state.
pub fn shared_projection_changed(root: &Path) -> Result<bool> {
    if !crate::workspace::is_shared(root) {
        return Ok(false);
    }
    let cfg = Config::load(root)?;
    let current = current_fingerprint(root)?;
    // `index::open` installs the schema for a newly created local cache. A
    // raw SQLite connection would leave an empty database on disk and make
    // subsequent startup fail after a user clears device state.
    let conn = crate::index::open(&cfg.index_path())?;
    let indexed: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'canonical_fingerprint'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(JinError::Index)?;
    Ok(indexed.as_deref() != Some(current.as_str()))
}

/// Return immutable local copies for a recovery UI or CLI. This never mutates
/// canonical data, so opening a historical version cannot destroy newer work.
pub fn list(root: &Path, kind: &str, id: &str) -> Result<Vec<PathBuf>> {
    let cfg = Config::load(root)?;
    let dir = cfg
        .jin_dir()
        .join("history")
        .join(safe_kind(kind)?)
        .join(component_digest(id));
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

/// Guard one canonical replacement. The public write primitives call this
/// while their caller holds the ordinary Jin operation lock. Provider clients
/// do not honor that lock, so the complete previous bytes are archived before
/// replacement and the post-image is archived immediately afterwards.
pub fn prepare_replacement(
    directory: &Path,
    kind: &str,
    id: &str,
    target: &Path,
    proposed: &[u8],
) -> Result<()> {
    let Some(root) = directory.parent() else {
        return Ok(());
    };
    if !crate::workspace::is_shared(root) {
        return Ok(());
    }
    let cfg = Config::load(root)?;
    let files = super::canonical_scan::scan_identities(root)?;
    if let Some(existing) = files.iter().find(|file| file.kind == kind && file.id == id) {
        if existing.path != target {
            return Err(JinError::SyncConflict(format!(
                "{kind} {id} is already represented at {}; refusing an ambiguous replacement",
                existing.path.display()
            )));
        }
        archive_at(
            &cfg.jin_dir(),
            kind,
            id,
            extension(target),
            &std::fs::read(target)?,
        )?;
    }
    // Archive the rendered post-image before changing canonical storage. A
    // provider can race a successful rename, and this is the last point where
    // Jin still holds the complete intended bytes in memory.
    archive_at(&cfg.jin_dir(), kind, id, extension(target), proposed)?;
    Ok(())
}

/// Preserve the mutable asset manifest before and after an attachment update.
pub fn prepare_asset_manifest_write(root: &Path, proposed: &[u8]) -> Result<()> {
    if !crate::workspace::is_shared(root) {
        return Ok(());
    }
    let cfg = Config::load(root)?;
    let path = root.join(".jin/assets/manifest.json");
    if path.exists() {
        archive_at(
            &cfg.jin_dir(),
            "assets",
            "manifest",
            "json",
            &std::fs::read(&path)?,
        )?;
    }
    archive_at(&cfg.jin_dir(), "assets", "manifest", "json", proposed)?;
    Ok(())
}

/// Compound operations may update several canonical paths. Their durable
/// staging images are already hash-verified, so retain both sides under an
/// operation-specific history identity before applying each image.
pub fn prepare_compound_replacement(root: &Path, canonical: &Path, proposed: &[u8]) -> Result<()> {
    if !crate::workspace::is_shared(root) {
        return Ok(());
    }
    let cfg = Config::load(root)?;
    let (kind, identity) = compound_identity(root, canonical, proposed);
    if canonical.exists() {
        archive_at(
            &cfg.jin_dir(),
            kind,
            &identity,
            extension(canonical),
            &std::fs::read(canonical)?,
        )?;
    }
    archive_at(
        &cfg.jin_dir(),
        kind,
        &identity,
        extension(canonical),
        proposed,
    )
    .map(|_| ())
}

fn compound_identity(root: &Path, canonical: &Path, bytes: &[u8]) -> (&'static str, String) {
    let fallback = (
        "operation",
        canonical
            .strip_prefix(root)
            .unwrap_or(canonical)
            .to_string_lossy()
            .into_owned(),
    );
    let Ok(text) = std::str::from_utf8(bytes) else {
        return fallback;
    };
    let Ok((yaml, _)) = crate::store::frontmatter::split(text) else {
        return fallback;
    };
    let directory = canonical
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str());
    match directory {
        Some("tasks") => {
            crate::store::frontmatter::parse_fm::<crate::model::TaskFrontmatter>(&yaml)
                .map(|item| ("task", item.id))
                .unwrap_or(fallback)
        }
        Some("events") => {
            crate::store::frontmatter::parse_fm::<crate::model::EventFrontmatter>(&yaml)
                .map(|item| ("event", item.id))
                .unwrap_or(fallback)
        }
        Some("lists") => {
            crate::store::frontmatter::parse_fm::<crate::model::ListFrontmatter>(&yaml)
                .map(|item| ("list", item.id))
                .unwrap_or(fallback)
        }
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use tempfile::TempDir;

    struct StateDirGuard {
        prior: Option<std::ffi::OsString>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for StateDirGuard {
        fn drop(&mut self) {
            match self.prior.take() {
                Some(value) => std::env::set_var("JIN_STATE_DIR", value),
                None => std::env::remove_var("JIN_STATE_DIR"),
            }
        }
    }

    fn init_shared(vault: &TempDir, state: &TempDir) -> StateDirGuard {
        let lock = crate::test_support::STATE_DIR_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let prior = std::env::var_os("JIN_STATE_DIR");
        std::env::set_var("JIN_STATE_DIR", state.path());
        ops::init_portable_workspace(vault.path()).unwrap();
        StateDirGuard { prior, _lock: lock }
    }

    #[test]
    fn divergent_versions_are_retained_side_by_side() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        archive_bytes(vault.path(), "note", "01TEST", "md", b"device a").unwrap();
        archive_bytes(vault.path(), "note", "01TEST", "md", b"device b").unwrap();
        archive_bytes(vault.path(), "note", "01TEST", "md", b"device a").unwrap();
        assert_eq!(list(vault.path(), "note", "01TEST").unwrap().len(), 2);
    }

    #[test]
    fn shared_write_refuses_duplicate_before_replacing_canonical_bytes() {
        use crate::ops::notes::{create_note, CreateNoteParams};

        let vault = TempDir::new().unwrap();
        let state = TempDir::new().unwrap();
        let _state = init_shared(&vault, &state);
        let notes = vault.path().join("notes");
        let note = create_note(
            &notes,
            CreateNoteParams {
                title: "Original".to_string(),
                body: "before".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let canonical = crate::store::fs::find_note_path(&notes, note.id()).unwrap();
        let before = std::fs::read(&canonical).unwrap();
        std::fs::copy(
            &canonical,
            notes.join(format!("{}--conflict.md", note.id())),
        )
        .unwrap();

        assert!(matches!(
            crate::store::fs::write_note(&notes, &note),
            Err(JinError::SyncConflict(_))
        ));
        assert_eq!(std::fs::read(canonical).unwrap(), before);
    }

    #[test]
    fn shared_write_archives_old_and_proposed_bytes_before_replacement() {
        use crate::ops::notes::{create_note, CreateNoteParams};

        let vault = TempDir::new().unwrap();
        let state = TempDir::new().unwrap();
        let _state = init_shared(&vault, &state);
        let notes = vault.path().join("notes");
        let mut note = create_note(
            &notes,
            CreateNoteParams {
                title: "Original".to_string(),
                body: "before".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        note.body = "after".to_string();
        crate::store::fs::write_note(&notes, &note).unwrap();

        assert_eq!(list(vault.path(), "note", note.id()).unwrap().len(), 2);
    }

    #[test]
    fn shared_read_detects_provider_conflict_without_replacing_prior_index() {
        use crate::ops::notes::{create_note, CreateNoteParams};

        let vault = TempDir::new().unwrap();
        let state = TempDir::new().unwrap();
        let _state = init_shared(&vault, &state);
        let notes = vault.path().join("notes");
        let note = create_note(
            &notes,
            CreateNoteParams {
                title: "Original".to_string(),
                body: "before".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        crate::ops::api::refresh(vault.path()).unwrap();
        let canonical = crate::store::fs::find_note_path(&notes, note.id()).unwrap();
        let conflict = notes.join(format!("{}--provider-conflict.md", note.id()));
        std::fs::copy(&canonical, &conflict).unwrap();

        assert!(matches!(
            crate::ops::api::list_notes(vault.path(), false, None, None),
            Err(JinError::SyncConflict(_))
        ));
        std::fs::remove_file(conflict).unwrap();
        assert_eq!(
            crate::ops::api::list_notes(vault.path(), false, None, None)
                .unwrap()
                .len(),
            1
        );
    }
}
