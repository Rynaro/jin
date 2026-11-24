//! Portable export/import with content-integrity verification.
//!
//! Canonical Markdown, Collections, and content-addressed attachments travel
//! together. SQLite, device-local preferences, and credentials never do.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::ops::assets;
use crate::store::canonical_scan;
use crate::store::fs;
use crate::{Config, JinError, Result};

pub const EXPORT_MANIFEST_VERSION: u32 = 2;
const EXPORT_MANIFEST_FILE: &str = "jin-export-manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExportFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportManifest {
    pub format_version: u32,
    pub files: Vec<ExportFile>,
    #[serde(default)]
    pub directories: Vec<String>,
}

/// Summary returned by a successful export.
#[derive(Debug, Clone)]
pub struct ExportSummary {
    pub notes: usize,
    pub tasks: usize,
    pub events: usize,
    pub lists: usize,
    pub tags: usize,
    pub attachments: usize,
    pub collections: usize,
    pub audit_included: bool,
    /// Owner payload files included in the export. The generated verification
    /// envelope is deliberately not counted for backward-compatible CLI output.
    pub files: Vec<String>,
}

impl ExportSummary {
    pub fn total_files(&self) -> usize {
        // Retain the established public count semantics: the generated export
        // manifest is a verification envelope, not one of the owner payload
        // files.
        self.notes
            + self.tasks
            + self.events
            + self.lists
            + self.tags
            + self.attachments
            + self.collections
            + usize::from(self.audit_included)
    }
}

/// Summary returned by import after verification and index rebuild.
#[derive(Debug, Clone)]
pub struct ImportSummary {
    pub imported_files: usize,
    pub notes: usize,
    pub tasks: usize,
    pub events: usize,
    pub lists: usize,
    pub tags: usize,
    pub attachments: usize,
    pub collections: usize,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn relative_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn read_regular_file(source: &Path) -> Result<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(source)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(JinError::Integrity(format!(
            "export refuses non-regular canonical file: {}",
            source.display()
        )));
    }
    Ok(std::fs::read(source)?)
}

fn copy_file(source: &Path, dest: &Path) -> Result<()> {
    fs::atomic_write(dest, &read_regular_file(source)?)
}

/// Write an export payload only if no other writer has claimed the destination
/// path. A folder synchronizer can add a file while an export is assembling;
/// silently replacing that file would make a local export destructive.
fn copy_file_new(source: &Path, dest: &Path) -> Result<()> {
    let bytes = read_regular_file(source)?;
    let parent = dest.parent().ok_or_else(|| {
        JinError::InvalidInput(format!(
            "cannot create export file without parent: {}",
            dest.display()
        ))
    })?;
    std::fs::create_dir_all(parent)?;
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                JinError::Integrity(format!(
                    "export destination changed while writing: {}",
                    dest.display()
                ))
            } else {
                JinError::Io(error)
            }
        })?;
    output.write_all(&bytes)?;
    output.sync_all()?;
    Ok(())
}

fn write_export_manifest_new(dest: &Path, bytes: &[u8]) -> Result<()> {
    // Manifest publication is the point at which a copied directory becomes a
    // backup. Validate the copied candidate after its hashes were collected,
    // using the same duplicate-identity rule as import.
    validate_export_identities(dest)?;
    let path = dest.join(EXPORT_MANIFEST_FILE);
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                JinError::Integrity(format!(
                    "export destination changed while writing: {}",
                    path.display()
                ))
            } else {
                JinError::Io(error)
            }
        })?;
    output.write_all(bytes)?;
    output.sync_all()?;
    Ok(())
}

fn collect_manifest(
    dest: &Path,
    files: &[String],
    directories: &[String],
) -> Result<ExportManifest> {
    let mut entries = Vec::new();
    for relative in files {
        let path = dest.join(relative);
        let bytes = std::fs::read(&path)?;
        entries.push(ExportFile {
            path: relative.clone(),
            sha256: digest(&bytes),
            size: bytes.len() as u64,
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ExportManifest {
        format_version: EXPORT_MANIFEST_VERSION,
        files: entries,
        directories: directories.to_vec(),
    })
}

fn safe_export_path(relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(JinError::Integrity(format!(
            "export manifest contains unsafe path: {relative:?}"
        )));
    }
    let allowed = relative.starts_with("notes/")
        || relative.starts_with("tasks/")
        || relative.starts_with("events/")
        || relative.starts_with("lists/")
        || relative.starts_with("tags/")
        || relative.starts_with("collections/")
        || relative.starts_with(".jin/assets/sha256/")
        || relative == ".jin/assets/manifest.json"
        || relative == ".jin/sync/audit.jsonl";
    if !allowed {
        return Err(JinError::Integrity(format!(
            "export manifest path is outside portable vault content: {relative:?}"
        )));
    }
    Ok(path.to_path_buf())
}

fn safe_export_directory(relative: &str) -> Result<PathBuf> {
    let path = safe_export_path(&format!("{relative}/placeholder"))?;
    path.parent().map(Path::to_path_buf).ok_or_else(|| {
        JinError::Integrity(format!(
            "export manifest contains invalid directory: {relative:?}"
        ))
    })
}

/// Verify an export without writing to a vault. This is the cross-version
/// verification boundary: newer format versions are refused rather than
/// partially imported by an older binary.
pub fn verify_export(source: &Path) -> Result<ExportManifest> {
    let path = source.join(EXPORT_MANIFEST_FILE);
    let manifest: ExportManifest = serde_json::from_slice(&std::fs::read(&path)?)
        .map_err(|err| JinError::Integrity(format!("parse export manifest: {err}")))?;
    if manifest.format_version == 0 || manifest.format_version > EXPORT_MANIFEST_VERSION {
        return Err(JinError::Integrity(format!(
            "export format {} is newer than supported {}",
            manifest.format_version, EXPORT_MANIFEST_VERSION
        )));
    }
    let mut seen = BTreeSet::new();
    for file in &manifest.files {
        if !seen.insert(file.path.clone()) {
            return Err(JinError::Integrity(format!(
                "export manifest repeats path: {}",
                file.path
            )));
        }
        let relative = safe_export_path(&file.path)?;
        let full = source.join(relative);
        let metadata = std::fs::symlink_metadata(&full)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(JinError::Integrity(format!(
                "export manifest entry is not a regular file: {}",
                file.path
            )));
        }
        let bytes = std::fs::read(&full)?;
        if bytes.len() as u64 != file.size || digest(&bytes) != file.sha256 {
            return Err(JinError::Integrity(format!(
                "export integrity mismatch: {}",
                file.path
            )));
        }
    }
    let mut directories = BTreeSet::new();
    for directory in &manifest.directories {
        if !directories.insert(directory.clone()) {
            return Err(JinError::Integrity(format!(
                "export manifest repeats directory: {directory}"
            )));
        }
        let _ = safe_export_directory(directory)?;
    }
    Ok(manifest)
}

fn ensure_export_has_no_unowned_content(dest: &Path, manifest: &ExportManifest) -> Result<()> {
    let mut files: BTreeSet<String> = manifest
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect();
    files.insert(EXPORT_MANIFEST_FILE.to_string());
    let mut directories: BTreeSet<String> = manifest.directories.iter().cloned().collect();
    // Version 2 exports preserve the Notes root even when it is empty. Older
    // verified exports did the same without recording that root directory in
    // their manifest, so accept it while still walking its contents below.
    if dest.join("notes").is_dir() {
        directories.insert("notes".to_string());
    }
    for file in &files {
        let mut path = Path::new(file).parent();
        while let Some(parent) = path {
            if !parent.as_os_str().is_empty() {
                directories.insert(relative_string(parent));
            }
            path = parent.parent();
        }
    }

    fn walk(
        root: &Path,
        current: &Path,
        files: &BTreeSet<String>,
        directories: &BTreeSet<String>,
    ) -> Result<()> {
        for entry in std::fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            let relative = relative_string(path.strip_prefix(root).map_err(|_| {
                JinError::Integrity(format!(
                    "export path escaped destination: {}",
                    path.display()
                ))
            })?);
            let metadata = std::fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                return Err(JinError::Integrity(format!(
                    "forced export refuses unowned symlink: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                if !directories.contains(&relative) {
                    return Err(JinError::Integrity(format!(
                        "forced export refuses unowned directory: {}",
                        path.display()
                    )));
                }
                walk(root, &path, files, directories)?;
            } else if !metadata.is_file() || !files.contains(&relative) {
                return Err(JinError::Integrity(format!(
                    "forced export refuses unowned file: {}",
                    path.display()
                )));
            }
        }
        Ok(())
    }

    walk(dest, dest, &files, &directories)
}

fn ensure_replaced_export_is_unchanged(backup: &Path, expected: &ExportManifest) -> Result<()> {
    let observed = verify_export(backup)?;
    if observed.format_version != expected.format_version
        || observed.files != expected.files
        || observed.directories != expected.directories
    {
        return Err(JinError::Integrity(format!(
            "forced export destination changed during replacement: {}",
            backup.display()
        )));
    }
    ensure_export_has_no_unowned_content(backup, &observed)
}

/// A manifest proves that the listed file bytes arrived intact. It does not
/// prove that those bytes form a vault which Jin can rebuild. Keep export on
/// the same duplicate-identity boundary as import before publishing a
/// manifest or replacing an existing backup.
fn validate_export_identities(candidate: &Path) -> Result<()> {
    // `inspect_identities` shares the parser and duplicate grouping used by
    // `scan_identities`, which import invokes before promotion. Read once so a
    // synchronizing provider cannot make the displayed pair differ from the
    // pair that was validated.
    let (_, duplicates) = canonical_scan::inspect_identities(candidate)?;
    let Some(conflict) = duplicates.into_iter().next() else {
        return Ok(());
    };
    let paths = conflict
        .paths
        .iter()
        .map(|path| relative_string(path.strip_prefix(candidate).unwrap_or(path)))
        .collect::<Vec<_>>()
        .join(", ");
    Err(JinError::SyncConflict(format!(
        "cannot create a restorable backup. Manifest hashes can verify copied file bytes, but duplicate canonical identities cannot be restored. Duplicate {} id {} in canonical files: {}. Preserve and reconcile both versions in the workspace, then export again",
        conflict.kind, conflict.id, paths
    )))
}

fn restore_or_preserve_forced_export(
    dest: &Path,
    backup: &Path,
    stage: &Path,
    failure: JinError,
) -> JinError {
    if dest.exists() {
        return JinError::Integrity(format!(
            "forced export promoted new data but preserved the prior export for recovery at {} after: {failure}",
            backup.display()
        ));
    }
    match std::fs::rename(backup, dest) {
        Ok(()) => match failure {
            JinError::SyncConflict(message) => JinError::SyncConflict(format!(
                "forced export kept the previous backup at {} and rejected the staged backup at {}: {message}",
                dest.display(),
                stage.display()
            )),
            failure => JinError::Integrity(format!(
                "forced export left the previous export restored at {} and retained the staged export at {} after: {failure}",
                dest.display(),
                stage.display()
            )),
        },
        Err(rollback) => JinError::Integrity(format!(
            "forced export could not restore the previous export. Recover it from {} and the staged export from {}. Original failure: {failure}. Rollback failure: {rollback}",
            backup.display(),
            stage.display()
        )),
    }
}

fn replace_verified_export_with<AfterBackup>(
    dest: &Path,
    stage: &Path,
    previous: &ExportManifest,
    mut after_backup: AfterBackup,
) -> Result<()>
where
    AfterBackup: FnMut(&Path) -> Result<()>,
{
    let backup = import_staging_dir(dest, "export-backup")?;
    std::fs::rename(dest, &backup)?;

    let replacement = (|| {
        after_backup(&backup)?;
        ensure_replaced_export_is_unchanged(&backup, previous)?;
        // The private stage may have changed while the prior backup was
        // checked. Recheck its bytes and restorable identities immediately
        // before it can replace the old backup.
        verify_export(stage)?;
        validate_export_identities(stage)?;
        std::fs::rename(stage, dest)?;
        // Check immediately before removal as well. A failed check leaves the
        // intact backup beside the newly promoted export for explicit recovery.
        ensure_replaced_export_is_unchanged(&backup, previous)?;
        std::fs::remove_dir_all(&backup)?;
        Ok(())
    })();

    replacement.map_err(|failure| restore_or_preserve_forced_export(dest, &backup, stage, failure))
}

/// Copy canonical, portable vault content to an empty export destination.
pub fn export(root: &Path, dest: &Path, force: bool) -> Result<ExportSummary> {
    if paths_overlap(root, dest) {
        return Err(JinError::InvalidInput(format!(
            "export source and destination overlap: {} and {}",
            root.display(),
            dest.display()
        )));
    }
    if dest.exists() && !force && std::fs::read_dir(dest)?.next().is_some() {
        return Err(JinError::ExportDestNotEmpty {
            path: dest.display().to_string(),
        });
    }
    // A forced update is allowed only over a prior, verified Jin export. This
    // keeps a typo such as `--force ~/Documents` from becoming an overwrite.
    if force && dest.exists() && std::fs::read_dir(dest)?.next().is_some() {
        let previous = verify_export(dest)?;
        ensure_export_has_no_unowned_content(dest, &previous)?;
        let stage = import_staging_dir(dest, "export-staging")?;
        let summary = export(root, &stage, false)?;
        replace_verified_export_with(dest, &stage, &previous, |_| Ok(()))?;
        return Ok(summary);
    }
    // Reject the current source before touching a fresh destination. Forced
    // exports recurse through this fresh path for their private stage. The
    // copied candidate is checked again below in case the provider changes a
    // canonical file during the export.
    validate_export_identities(root)?;
    std::fs::create_dir_all(dest)?;

    let mut files = Vec::new();
    let mut notes = 0;
    let mut tasks = 0;
    let mut events = 0;
    let mut lists = 0;
    let mut tags = 0;
    let mut collections = 0;
    let mut directories = Vec::new();

    // Preserve all Notes folders (including empty folders) and recursive Markdown.
    let notes_src = root.join("notes");
    if notes_src.exists() {
        let notes_dst = dest.join("notes");
        for folder in fs::list_note_folders(&notes_src)? {
            std::fs::create_dir_all(notes_dst.join(&folder))?;
            if !folder.is_empty() {
                directories.push(format!("notes/{folder}"));
            }
        }
        for source in fs::list_note_paths(&notes_src)? {
            let relative = source
                .strip_prefix(root)
                .map_err(|_| JinError::Integrity("note escaped vault root".to_string()))?;
            copy_file_new(&source, &dest.join(relative))?;
            files.push(relative_string(relative));
            notes += 1;
        }
    }

    for (directory, count) in [
        ("tasks", &mut tasks),
        ("events", &mut events),
        ("lists", &mut lists),
        ("tags", &mut tags),
    ] {
        let source_dir = root.join(directory);
        if !source_dir.exists() {
            continue;
        }
        let mut paths = Vec::new();
        for entry in std::fs::read_dir(&source_dir)? {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("md") {
                paths.push(path);
            }
        }
        paths.sort();
        for source in paths {
            let relative = source.strip_prefix(root).expect("source under root");
            copy_file_new(&source, &dest.join(relative))?;
            files.push(relative_string(relative));
            *count += 1;
        }
    }

    // Portable Collection JSON lives adjacent to canonical Markdown.
    let collections_src = root.join("collections");
    if collections_src.exists() {
        let mut paths = Vec::new();
        for entry in std::fs::read_dir(&collections_src)? {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
                paths.push(path);
            }
        }
        paths.sort();
        for source in paths {
            let relative = source.strip_prefix(root).expect("source under root");
            copy_file_new(&source, &dest.join(relative))?;
            files.push(relative_string(relative));
            collections += 1;
        }
    }

    // Asset bytes are copied only through the verified manifest, never by
    // walking untrusted filenames. This makes exports self-contained and
    // preserves the immutable content-addressed contract.
    let asset_manifest = assets::load_manifest(root)?;
    let mut attachments = 0;
    if !asset_manifest.assets.is_empty() {
        let source_manifest = root.join(".jin").join("assets").join("manifest.json");
        copy_file_new(&source_manifest, &dest.join(".jin/assets/manifest.json"))?;
        files.push(".jin/assets/manifest.json".to_string());
        for hash in asset_manifest.assets.keys() {
            let _ = assets::get_attachment(root, hash)?;
            let relative = format!(".jin/assets/sha256/{hash}");
            copy_file_new(&root.join(&relative), &dest.join(&relative))?;
            files.push(relative);
            attachments += 1;
        }
    }

    let audit = Config::load(root)?.sync_dir().join("audit.jsonl");
    let audit_included = audit.exists();
    if audit_included {
        copy_file_new(&audit, &dest.join(".jin/sync/audit.jsonl"))?;
        files.push(".jin/sync/audit.jsonl".to_string());
    }
    files.sort();
    directories.sort();
    directories.dedup();
    let manifest = collect_manifest(dest, &files, &directories)?;
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|err| JinError::Integrity(format!("serialize export manifest: {err}")))?;
    write_export_manifest_new(dest, &bytes)?;

    Ok(ExportSummary {
        notes,
        tasks,
        events,
        lists,
        tags,
        attachments,
        collections,
        audit_included,
        files,
    })
}

fn prospective_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut tail = Vec::new();
    let mut existing = absolute.as_path();
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            break;
        };
        tail.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            break;
        };
        existing = parent;
    }
    let mut resolved = existing
        .canonicalize()
        .unwrap_or_else(|_| existing.to_path_buf());
    for part in tail.iter().rev() {
        resolved.push(part);
    }
    resolved
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    let left = prospective_path(left);
    let right = prospective_path(right);
    left == right || left.starts_with(&right) || right.starts_with(&left)
}

fn destination_is_importable(dest: &Path, force: bool) -> Result<()> {
    if !dest.exists() {
        return Ok(());
    }
    let entries: Vec<PathBuf> = std::fs::read_dir(dest)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<_>>()?;
    if entries.is_empty() {
        return Ok(());
    }
    if !force {
        return Err(JinError::ExportDestNotEmpty {
            path: dest.display().to_string(),
        });
    }
    Config::load(dest).map_err(|_| {
        JinError::Integrity(format!(
            "refusing forced import into a non-Jin directory: {}",
            dest.display()
        ))
    })?;
    Ok(())
}

fn import_staging_dir(dest: &Path, label: &str) -> Result<PathBuf> {
    let parent = dest.parent().ok_or_else(|| {
        JinError::InvalidInput(format!(
            "import destination has no parent: {}",
            dest.display()
        ))
    })?;
    Ok(parent.join(format!(".jin-{label}-{}", ulid::Ulid::new())))
}

#[derive(Debug, Serialize, Deserialize)]
struct ImportRecovery {
    destination: String,
    backup: String,
    staging: String,
    backed_up: Vec<String>,
    promoted: Vec<String>,
}

fn recovery_path(dest: &Path) -> Result<PathBuf> {
    let parent = dest.parent().ok_or_else(|| {
        JinError::InvalidInput(format!(
            "import destination has no parent: {}",
            dest.display()
        ))
    })?;
    let destination_key = digest(prospective_path(dest).to_string_lossy().as_bytes());
    Ok(parent.join(format!(".jin-import-pending-{destination_key}.json")))
}

fn persist_recovery(path: &Path, recovery: &ImportRecovery) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(recovery)
        .map_err(|err| JinError::Integrity(format!("serialize import recovery: {err}")))?;
    fs::atomic_write(path, &bytes)
}

fn create_recovery(path: &Path, recovery: &ImportRecovery) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(recovery)
        .map_err(|err| JinError::Integrity(format!("serialize import recovery: {err}")))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| {
            JinError::Integrity(format!(
                "cannot begin import because another or interrupted import owns {}: {err}",
                path.display()
            ))
        })?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn rollback_import_swap(
    dest: &Path,
    backup: &Path,
    backed_up: &[String],
    promoted: &[String],
) -> std::io::Result<()> {
    for relative in promoted.iter().rev() {
        let applied = dest.join(relative);
        if applied.exists() {
            if applied.is_dir() {
                std::fs::remove_dir_all(&applied)?;
            } else {
                std::fs::remove_file(&applied)?;
            }
        }
    }
    for relative in backed_up.iter().rev() {
        let applied = dest.join(relative);
        let prior = backup.join(relative);
        if prior.exists() {
            if let Some(parent) = applied.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::rename(prior, applied)?;
        }
    }
    Ok(())
}

fn ensure_replaceable_import_directory(
    path: &Path,
    extension: &str,
    recursive: bool,
) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            return Err(JinError::Integrity(format!(
                "refusing forced import over hidden or unrelated content: {}",
                child.display()
            )));
        }
        let metadata = std::fs::symlink_metadata(&child)?;
        if metadata.file_type().is_symlink() {
            return Err(JinError::Integrity(format!(
                "refusing forced import over symlinked or unrelated content: {}",
                child.display()
            )));
        }
        if metadata.is_dir() && recursive {
            ensure_replaceable_import_directory(&child, extension, true)?;
            continue;
        }
        if !metadata.is_file()
            || child.extension().and_then(|value| value.to_str()) != Some(extension)
        {
            return Err(JinError::Integrity(format!(
                "refusing forced import over unrelated content: {}",
                child.display()
            )));
        }
    }
    Ok(())
}

fn ensure_replaceable_assets(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        let name = entry.file_name();
        let metadata = std::fs::symlink_metadata(&child)?;
        if name == "manifest.json" && metadata.is_file() && !metadata.file_type().is_symlink() {
            continue;
        }
        if name != "sha256" || !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(JinError::Integrity(format!(
                "refusing forced import over unrelated asset content: {}",
                child.display()
            )));
        }
        for payload in std::fs::read_dir(&child)? {
            let payload = payload?;
            let payload_path = payload.path();
            let hash = payload.file_name().to_string_lossy().into_owned();
            let payload_metadata = std::fs::symlink_metadata(&payload_path)?;
            if hash.len() != 64
                || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !payload_metadata.is_file()
                || payload_metadata.file_type().is_symlink()
                || digest(&std::fs::read(&payload_path)?) != hash
            {
                return Err(JinError::Integrity(format!(
                    "refusing forced import over unrelated asset payload: {}",
                    payload_path.display()
                )));
            }
        }
    }
    Ok(())
}

fn ensure_import_can_replace_owned_paths(dest: &Path, paths: &[&str]) -> Result<()> {
    // Extensions alone would accept unrelated `notes/diary.md`. Parse every
    // existing canonical record before any directory can be moved aside.
    crate::store::canonical_scan::scan_identities(dest)?;
    for relative in paths {
        let path = dest.join(relative);
        match *relative {
            "notes" => ensure_replaceable_import_directory(&path, "md", true)?,
            "tasks" | "events" | "lists" | "tags" => {
                ensure_replaceable_import_directory(&path, "md", false)?
            }
            "collections" => ensure_replaceable_import_directory(&path, "json", false)?,
            ".jin/assets" => ensure_replaceable_assets(&path)?,
            _ => unreachable!("import ownership path must be enumerated"),
        }
    }
    Ok(())
}

/// A pending marker means a prior process stopped between preserving old
/// content and verifying the new index. It is deliberately fail-closed: code
/// never infers filesystem operations from a marker written by an interrupted
/// process. The retained sibling backup is the recovery source.
fn block_interrupted_import(dest: &Path) -> Result<()> {
    let marker = recovery_path(dest)?;
    if marker.exists() {
        return Err(JinError::Integrity(format!(
            "a previous import needs recovery; inspect {} before retrying",
            marker.display()
        )));
    }
    Ok(())
}

struct ImportPromotion {
    recovery_path: PathBuf,
    recovery: ImportRecovery,
}

fn finalize_promotion(promotion: ImportPromotion) -> Result<()> {
    // The valid destination is authoritative after its rebuild. Remove the
    // marker first. A cleanup interruption can retain an extra backup but
    // cannot make a completed import look ambiguous.
    std::fs::remove_file(promotion.recovery_path)?;
    let _ = std::fs::remove_dir_all(&promotion.recovery.backup);
    let _ = std::fs::remove_dir_all(&promotion.recovery.staging);
    Ok(())
}

fn swap_imported_content(
    staging: &Path,
    dest: &Path,
    force: bool,
    manifest_version: u32,
) -> Result<ImportPromotion> {
    const BASE_OWNED_PATHS: [&str; 5] = ["notes", "tasks", "events", "collections", ".jin/assets"];
    let mut owned_paths = BASE_OWNED_PATHS.to_vec();
    // A v1 export predates lists and tags. Treating their absence as an
    // instruction to delete existing records would make a compatible restore
    // destructive.
    if manifest_version >= 2 {
        owned_paths.extend(["lists", "tags"]);
    }
    if force {
        ensure_import_can_replace_owned_paths(dest, &owned_paths)?;
    }
    std::fs::create_dir_all(dest)?;
    let backup = import_staging_dir(dest, "import-backup")?;
    std::fs::create_dir_all(&backup)?;
    let recovery_path = recovery_path(dest)?;
    let mut recovery = ImportRecovery {
        destination: dest.display().to_string(),
        backup: backup.display().to_string(),
        staging: staging.display().to_string(),
        backed_up: Vec::new(),
        promoted: Vec::new(),
    };
    create_recovery(&recovery_path, &recovery)?;
    let result = (|| {
        for relative in &owned_paths {
            let current = dest.join(relative);
            if current.exists() {
                if !force {
                    return Err(JinError::ExportDestNotEmpty {
                        path: dest.display().to_string(),
                    });
                }
                let prior = backup.join(relative);
                if let Some(parent) = prior.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&current, prior)?;
                recovery.backed_up.push((*relative).to_string());
                persist_recovery(&recovery_path, &recovery)?;
            }
        }
        for relative in &owned_paths {
            let current = dest.join(relative);
            let imported = staging.join(relative);
            if imported.exists() {
                if let Some(parent) = current.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(imported, &current)?;
                recovery.promoted.push((*relative).to_string());
                persist_recovery(&recovery_path, &recovery)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        if rollback_import_swap(dest, &backup, &recovery.backed_up, &recovery.promoted).is_err() {
            return Err(JinError::Integrity(format!(
                "import promotion failed and rollback needs recovery at {}",
                backup.display()
            )));
        }
        let _ = std::fs::remove_dir_all(&backup);
        let _ = std::fs::remove_file(&recovery_path);
        return Err(result.expect_err("failed import promotion must carry its error"));
    }
    Ok(ImportPromotion {
        recovery_path,
        recovery,
    })
}

/// Verify and import a portable export. Canonical content is copied only after
/// every manifest entry has passed hash verification; then the derived index is
/// rebuilt from that canonical restore.
pub fn import(source: &Path, dest: &Path, force: bool) -> Result<ImportSummary> {
    if paths_overlap(source, dest) {
        return Err(JinError::InvalidInput(format!(
            "import source and destination overlap: {} and {}",
            source.display(),
            dest.display()
        )));
    }
    block_interrupted_import(dest)?;
    let manifest = verify_export(source)?;
    let imported_files = manifest.files.len();
    destination_is_importable(dest, force)?;
    let staging = import_staging_dir(dest, "import-staging")?;
    let staged = (|| {
        crate::ops::init(&staging)?;
        let mut notes = 0;
        let mut tasks = 0;
        let mut events = 0;
        let mut lists = 0;
        let mut tags = 0;
        let mut attachments = 0;
        let mut collections = 0;
        for directory in &manifest.directories {
            std::fs::create_dir_all(staging.join(safe_export_directory(directory)?))?;
        }
        for entry in &manifest.files {
            let relative = safe_export_path(&entry.path)?;
            let bytes = read_regular_file(&source.join(&relative))?;
            if bytes.len() as u64 != entry.size || digest(&bytes) != entry.sha256 {
                return Err(JinError::Integrity(format!(
                    "export changed while importing: {}",
                    entry.path
                )));
            }
            fs::atomic_write(&staging.join(&relative), &bytes)?;
            if entry.path.starts_with("notes/") {
                notes += 1;
            } else if entry.path.starts_with("tasks/") {
                tasks += 1;
            } else if entry.path.starts_with("events/") {
                events += 1;
            } else if entry.path.starts_with("lists/") {
                lists += 1;
            } else if entry.path.starts_with("tags/") {
                tags += 1;
            } else if entry.path.starts_with(".jin/assets/sha256/") {
                attachments += 1;
            } else if entry.path.starts_with("collections/") {
                collections += 1;
            }
        }
        // Imports are a canonical replacement boundary. A checksum only proves
        // transport integrity, so validate each record identity before any
        // staged file can be promoted over an existing workspace.
        crate::store::canonical_scan::scan_identities(&staging)?;
        // Verify imported assets against their canonical manifest before rebuild.
        let manifest = assets::load_manifest(&staging)?;
        for hash in manifest.assets.keys() {
            let _ = assets::get_attachment(&staging, hash)?;
        }
        crate::ops::api::refresh(&staging)?;
        Ok((notes, tasks, events, lists, tags, attachments, collections))
    })();
    let (notes, tasks, events, lists, tags, attachments, collections) = match staged {
        Ok(counts) => counts,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(err);
        }
    };
    let promotion = match swap_imported_content(&staging, dest, force, manifest.format_version) {
        Ok(promotion) => promotion,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(err);
        }
    };
    let completed = (|| {
        crate::ops::init(dest)?;
        crate::ops::api::refresh(dest)?;
        // Audit data is device state. It is copied only into the destination's
        // resolved runtime directory, never promoted through the portable tree.
        let audit_in_manifest = manifest
            .files
            .iter()
            .any(|entry| entry.path == ".jin/sync/audit.jsonl");
        let staged_audit = staging.join(".jin/sync/audit.jsonl");
        if audit_in_manifest && staged_audit.exists() {
            let audit_dest = Config::load(dest)?.sync_dir().join("audit.jsonl");
            copy_file(&staged_audit, &audit_dest)?;
        }
        Ok(())
    })();
    if let Err(err) = completed {
        let rollback = rollback_import_swap(
            dest,
            Path::new(&promotion.recovery.backup),
            &promotion.recovery.backed_up,
            &promotion.recovery.promoted,
        );
        if rollback.is_ok() && crate::ops::api::refresh(dest).is_ok() {
            let _ = std::fs::remove_dir_all(&promotion.recovery.backup);
            let _ = std::fs::remove_file(&promotion.recovery_path);
        }
        return Err(err);
    }
    finalize_promotion(promotion)?;
    Ok(ImportSummary {
        imported_files,
        notes,
        tasks,
        events,
        lists,
        tags,
        attachments,
        collections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CollectionQuery;
    use crate::ops;
    use crate::ops::assets::import_attachment;
    use crate::ops::collections::create_collection;
    use crate::ops::lists::{create_list, CreateListParams};
    use crate::ops::notes::{create_note, CreateNoteParams};
    use crate::ops::tags::ensure_tag;
    use tempfile::TempDir;

    #[test]
    fn portable_export_import_verifies_assets_collections_and_tampering() {
        let root = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let restored = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        create_note(
            &root.path().join("notes"),
            CreateNoteParams {
                title: "Portable".to_string(),
                body: "body".to_string(),
                tags: vec![],
                folder: "Work".to_string(),
            },
        )
        .unwrap();
        create_collection(
            root.path(),
            "Everything".to_string(),
            CollectionQuery::default(),
        )
        .unwrap();
        create_list(
            root.path(),
            CreateListParams {
                name: "Plans".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
                workflow_kind: None,
            },
        )
        .unwrap();
        ensure_tag(root.path(), "important").unwrap();
        std::fs::create_dir_all(root.path().join("notes/Empty/Nested")).unwrap();
        let attachment_source = source.path().join("clip.webm");
        std::fs::write(&attachment_source, b"video bytes").unwrap();
        import_attachment(root.path(), &attachment_source).unwrap();

        let summary = export(root.path(), exported.path(), false).unwrap();
        assert!(summary
            .files
            .iter()
            .all(|file| file != EXPORT_MANIFEST_FILE));
        assert!(exported.path().join(EXPORT_MANIFEST_FILE).is_file());
        assert_eq!(
            verify_export(exported.path()).unwrap().format_version,
            EXPORT_MANIFEST_VERSION
        );
        let imported = import(exported.path(), restored.path(), false).unwrap();
        assert_eq!(imported.notes, 1);
        assert_eq!(imported.attachments, 1);
        assert_eq!(imported.collections, 1);
        assert_eq!(imported.lists, 2); // Jin's default Inbox plus Plans.
        assert_eq!(imported.tags, 1);
        assert!(restored.path().join("notes/Empty/Nested").is_dir());

        let tampered = exported.path().join("notes/Work");
        let note = std::fs::read_dir(tampered)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        std::fs::write(note, "tampered").unwrap();
        assert!(verify_export(exported.path()).is_err());
    }

    #[test]
    fn v1_force_import_keeps_existing_lists_and_tags() {
        let source = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        ops::init(source.path()).unwrap();
        create_note(
            &source.path().join("notes"),
            CreateNoteParams {
                title: "Portable note".to_string(),
                body: "body".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        export(source.path(), exported.path(), false).unwrap();

        let manifest_path = exported.path().join(EXPORT_MANIFEST_FILE);
        let mut v1: ExportManifest =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        v1.format_version = 1;
        v1.directories.clear();
        v1.files
            .retain(|file| !file.path.starts_with("lists/") && !file.path.starts_with("tags/"));
        fs::atomic_write(&manifest_path, &serde_json::to_vec_pretty(&v1).unwrap()).unwrap();

        ops::init(destination.path()).unwrap();
        create_list(
            destination.path(),
            CreateListParams {
                name: "Keep me".to_string(),
                color: "accent".to_string(),
                icon: "list".to_string(),
                parent_id: None,
                workflow_kind: None,
            },
        )
        .unwrap();
        ensure_tag(destination.path(), "keep-me").unwrap();

        import(exported.path(), destination.path(), true).unwrap();
        assert!(
            fs::list_list_paths(&destination.path().join("lists"))
                .unwrap()
                .len()
                >= 2
        );
        assert!(destination.path().join("tags/keep-me.md").is_file());
    }

    #[test]
    fn rejects_overlap_and_pending_import_before_mutation() {
        let root = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        assert!(export(root.path(), &root.path().join("child"), false).is_err());

        let source = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        ops::init(source.path()).unwrap();
        export(source.path(), &source.path().join("export"), false).unwrap_err();
        let exported = TempDir::new().unwrap();
        export(source.path(), exported.path(), false).unwrap();

        let marker = recovery_path(destination.path()).unwrap();
        fs::atomic_write(&marker, b"pending").unwrap();
        assert!(import(exported.path(), destination.path(), false).is_err());
        assert!(!destination.path().join("notes").exists());
    }

    #[test]
    fn force_export_refuses_unowned_destination_content() {
        let root = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        create_note(
            &root.path().join("notes"),
            CreateNoteParams {
                title: "Portable".to_string(),
                body: "body".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        export(root.path(), exported.path(), false).unwrap();
        let unowned = exported.path().join("notes/keep-me.txt");
        std::fs::write(&unowned, "owner content").unwrap();
        assert!(export(root.path(), exported.path(), true).is_err());
        assert_eq!(std::fs::read_to_string(unowned).unwrap(), "owner content");
    }

    #[test]
    fn force_export_accepts_a_verified_export_with_an_empty_notes_directory() {
        let root = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();

        export(root.path(), exported.path(), false).unwrap();
        assert!(exported.path().join("notes").is_dir());
        export(root.path(), exported.path(), true).unwrap();
        verify_export(exported.path()).unwrap();
    }

    fn create_export_test_note(root: &Path, body: &str) -> PathBuf {
        let note = create_note(
            &root.join("notes"),
            CreateNoteParams {
                title: "Original".to_string(),
                body: body.to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        fs::find_note_path(&root.join("notes"), note.id()).unwrap()
    }

    fn add_provider_conflict(original: &Path) -> (PathBuf, Vec<u8>) {
        let original_bytes = std::fs::read(original).unwrap();
        let stem = original.file_stem().unwrap().to_str().unwrap();
        let (id, _) = stem.split_once("--").unwrap();
        let conflict = original
            .parent()
            .unwrap()
            .join(format!("{id}--provider-conflict.md"));
        let mut conflict_bytes = original_bytes.clone();
        conflict_bytes.extend_from_slice(b"\nprovider conflict body\n");
        std::fs::write(&conflict, &conflict_bytes).unwrap();
        (conflict, conflict_bytes)
    }

    #[test]
    fn duplicate_identity_refuses_unrestorable_fresh_and_forced_exports() {
        let workspace = TempDir::new().unwrap();
        let good_backup = TempDir::new().unwrap();
        let fresh_backup_parent = TempDir::new().unwrap();
        let fresh_backup = fresh_backup_parent.path().join("fresh-backup");
        let clean_restore = TempDir::new().unwrap();
        let preserved_restore = TempDir::new().unwrap();
        ops::init(workspace.path()).unwrap();
        let original = create_export_test_note(workspace.path(), "original body");

        export(workspace.path(), good_backup.path(), false).unwrap();
        import(good_backup.path(), clean_restore.path(), false).unwrap();
        let clean_note = clean_restore
            .path()
            .join("notes")
            .join(original.file_name().unwrap());
        assert_eq!(
            std::fs::read(clean_note).unwrap(),
            std::fs::read(&original).unwrap()
        );
        let good_backup_before = tree_fingerprint(good_backup.path());

        let original_before = std::fs::read(&original).unwrap();
        let (conflict, conflict_bytes) = add_provider_conflict(&original);
        assert_ne!(original_before, conflict_bytes);

        for force in [false, true] {
            let destination = if force {
                good_backup.path()
            } else {
                fresh_backup.as_path()
            };
            let error = export(workspace.path(), destination, force).unwrap_err();
            assert!(matches!(error, JinError::SyncConflict(_)), "{error:?}");
            let message = error.to_string();
            assert!(message.contains("restorable"));
            assert!(message.contains(original.file_name().unwrap().to_str().unwrap()));
            assert!(message.contains(conflict.file_name().unwrap().to_str().unwrap()));
        }

        assert!(!fresh_backup.exists());
        assert_eq!(std::fs::read(&original).unwrap(), original_before);
        assert_eq!(std::fs::read(&conflict).unwrap(), conflict_bytes);
        assert_eq!(tree_fingerprint(good_backup.path()), good_backup_before);
        verify_export(good_backup.path()).unwrap();
        import(good_backup.path(), preserved_restore.path(), false).unwrap();
        let preserved_note = preserved_restore
            .path()
            .join("notes")
            .join(original.file_name().unwrap());
        assert_eq!(std::fs::read(preserved_note).unwrap(), original_before);
    }

    #[test]
    fn manifest_publication_rejects_a_copied_duplicate_identity() {
        let source = TempDir::new().unwrap();
        let candidate = TempDir::new().unwrap();
        ops::init(source.path()).unwrap();
        let original = create_export_test_note(source.path(), "original body");
        let copied = candidate
            .path()
            .join("notes")
            .join(original.file_name().unwrap());
        std::fs::create_dir_all(copied.parent().unwrap()).unwrap();
        std::fs::copy(&original, &copied).unwrap();
        let (conflict, _) = add_provider_conflict(&copied);

        let files = vec![
            relative_string(copied.strip_prefix(candidate.path()).unwrap()),
            relative_string(conflict.strip_prefix(candidate.path()).unwrap()),
        ];
        let manifest = collect_manifest(candidate.path(), &files, &[]).unwrap();
        let bytes = serde_json::to_vec_pretty(&manifest).unwrap();
        let error = write_export_manifest_new(candidate.path(), &bytes).unwrap_err();

        assert!(matches!(error, JinError::SyncConflict(_)));
        assert!(error.to_string().contains("notes/"));
        assert!(!candidate.path().join(EXPORT_MANIFEST_FILE).exists());
    }

    fn tree_fingerprint(root: &Path) -> Vec<(String, Option<Vec<u8>>)> {
        fn collect(root: &Path, current: &Path, entries: &mut Vec<(String, Option<Vec<u8>>)>) {
            let mut children = std::fs::read_dir(current)
                .unwrap()
                .map(|entry| entry.unwrap())
                .collect::<Vec<_>>();
            children.sort_by_key(|entry| entry.file_name());
            for entry in children {
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    entries.push((
                        format!("{}/", relative_string(path.strip_prefix(root).unwrap())),
                        None,
                    ));
                    collect(root, &path, entries);
                } else {
                    entries.push((
                        relative_string(path.strip_prefix(root).unwrap()),
                        Some(std::fs::read(path).unwrap()),
                    ));
                }
            }
        }

        let mut entries = Vec::new();
        collect(root, root, &mut entries);
        entries
    }

    #[test]
    fn forced_replacement_preserves_a_file_added_after_initial_verification() {
        let source = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let stage_parent = TempDir::new().unwrap();
        ops::init(source.path()).unwrap();
        create_note(
            &source.path().join("notes"),
            CreateNoteParams {
                title: "Original".to_string(),
                body: "first copy".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        export(source.path(), exported.path(), false).unwrap();
        let previous = verify_export(exported.path()).unwrap();

        let stage = stage_parent.path().join("replacement");
        export(source.path(), &stage, false).unwrap();
        let late_file = "notes/provider-copy.txt";
        let result = replace_verified_export_with(exported.path(), &stage, &previous, |backup| {
            std::fs::write(backup.join(late_file), "provider data")?;
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(exported.path().join(late_file)).unwrap(),
            "provider data"
        );
        assert!(
            stage.is_dir(),
            "the staged export remains available for recovery"
        );
    }

    #[test]
    fn forced_replacement_rejects_a_late_unrestorable_stage_and_restores_previous_backup() {
        let source = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let stage_parent = TempDir::new().unwrap();
        let restored = TempDir::new().unwrap();
        ops::init(source.path()).unwrap();
        let original = create_export_test_note(source.path(), "original body");
        export(source.path(), exported.path(), false).unwrap();
        let previous = verify_export(exported.path()).unwrap();
        let before = tree_fingerprint(exported.path());
        let original_before = std::fs::read(&original).unwrap();

        let stage = stage_parent.path().join("replacement");
        export(source.path(), &stage, false).unwrap();
        let stage_manifest = verify_export(&stage).unwrap();
        let stage_files = stage_manifest
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        let result = replace_verified_export_with(exported.path(), &stage, &previous, |_| {
            let staged_original = stage.join("notes").join(original.file_name().unwrap());
            let (conflict, _) = add_provider_conflict(&staged_original);
            let mut files = stage_files.clone();
            files.push(relative_string(conflict.strip_prefix(&stage).unwrap()));
            let refreshed = collect_manifest(&stage, &files, &stage_manifest.directories)?;
            fs::atomic_write(
                &stage.join(EXPORT_MANIFEST_FILE),
                &serde_json::to_vec_pretty(&refreshed).unwrap(),
            )?;
            Ok(())
        });

        assert!(
            matches!(result, Err(JinError::SyncConflict(_))),
            "{result:?}"
        );
        assert_eq!(tree_fingerprint(exported.path()), before);
        verify_export(exported.path()).unwrap();
        import(exported.path(), restored.path(), false).unwrap();
        assert_eq!(
            std::fs::read(
                restored
                    .path()
                    .join("notes")
                    .join(original.file_name().unwrap())
            )
            .unwrap(),
            original_before
        );
    }

    #[test]
    fn export_payload_copy_refuses_an_existing_file() {
        let directory = TempDir::new().unwrap();
        let source = directory.path().join("source.md");
        let destination = directory.path().join("destination.md");
        std::fs::write(&source, "exported content").unwrap();
        std::fs::write(&destination, "provider content").unwrap();

        assert!(copy_file_new(&source, &destination).is_err());
        assert_eq!(
            std::fs::read_to_string(destination).unwrap(),
            "provider content"
        );
    }

    #[test]
    fn forced_import_refuses_a_non_jin_destination_without_touching_it() {
        let root = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let documents = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        export(root.path(), exported.path(), false).unwrap();
        let note = documents.path().join("notes/life.md");
        std::fs::create_dir_all(note.parent().unwrap()).unwrap();
        std::fs::write(&note, "irreplaceable").unwrap();

        assert!(import(exported.path(), documents.path(), true).is_err());
        assert_eq!(std::fs::read_to_string(note).unwrap(), "irreplaceable");
    }

    #[test]
    fn forced_import_preserves_unrelated_files_in_a_jin_workspace() {
        let root = TempDir::new().unwrap();
        let exported = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        export(root.path(), exported.path(), false).unwrap();
        ops::init(destination.path()).unwrap();
        let receipt = destination.path().join("notes/receipt.jpg");
        let diary = destination.path().join("notes/diary.md");
        std::fs::write(&receipt, b"personal receipt").unwrap();
        std::fs::write(&diary, "personal diary").unwrap();

        assert!(import(exported.path(), destination.path(), true).is_err());
        assert_eq!(std::fs::read(&receipt).unwrap(), b"personal receipt");
        assert_eq!(std::fs::read_to_string(&diary).unwrap(), "personal diary");
    }
}
