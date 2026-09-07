//! Portable export/import with content-integrity verification.
//!
//! Canonical Markdown, Collections, and content-addressed attachments travel
//! together. SQLite, device-local preferences, and credentials never do.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::ops::assets;
use crate::store::fs;
use crate::{JinError, Result};

pub const EXPORT_MANIFEST_VERSION: u32 = 1;
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
}

/// Summary returned by a successful export.
#[derive(Debug, Clone)]
pub struct ExportSummary {
    pub notes: usize,
    pub tasks: usize,
    pub events: usize,
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
    pub attachments: usize,
    pub collections: usize,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn relative_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn copy_file(source: &Path, dest: &Path) -> Result<()> {
    let metadata = std::fs::symlink_metadata(source)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(JinError::Integrity(format!(
            "export refuses non-regular canonical file: {}",
            source.display()
        )));
    }
    let bytes = std::fs::read(source)?;
    fs::atomic_write(dest, &bytes)
}

fn collect_manifest(dest: &Path, files: &[String]) -> Result<ExportManifest> {
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

/// Verify an export without writing to a vault. This is the cross-version
/// verification boundary: newer format versions are refused rather than
/// partially imported by an older binary.
pub fn verify_export(source: &Path) -> Result<ExportManifest> {
    let path = source.join(EXPORT_MANIFEST_FILE);
    let manifest: ExportManifest = serde_json::from_slice(&std::fs::read(&path)?)
        .map_err(|err| JinError::Integrity(format!("parse export manifest: {err}")))?;
    if manifest.format_version > EXPORT_MANIFEST_VERSION {
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
    Ok(manifest)
}

/// Copy canonical, portable vault content to an empty export destination.
pub fn export(root: &Path, dest: &Path, force: bool) -> Result<ExportSummary> {
    if dest.exists() && !force && std::fs::read_dir(dest)?.next().is_some() {
        return Err(JinError::ExportDestNotEmpty {
            path: dest.display().to_string(),
        });
    }
    std::fs::create_dir_all(dest)?;

    let mut files = Vec::new();
    let mut notes = 0;
    let mut tasks = 0;
    let mut events = 0;
    let mut collections = 0;

    // Preserve all Notes folders (including empty folders) and recursive Markdown.
    let notes_src = root.join("notes");
    if notes_src.exists() {
        let notes_dst = dest.join("notes");
        for folder in fs::list_note_folders(&notes_src)? {
            std::fs::create_dir_all(notes_dst.join(folder))?;
        }
        for source in fs::list_note_paths(&notes_src)? {
            let relative = source
                .strip_prefix(root)
                .map_err(|_| JinError::Integrity("note escaped vault root".to_string()))?;
            copy_file(&source, &dest.join(relative))?;
            files.push(relative_string(relative));
            notes += 1;
        }
    }

    for (directory, count) in [("tasks", &mut tasks), ("events", &mut events)] {
        let source_dir = root.join(directory);
        if !source_dir.exists() {
            continue;
        }
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&source_dir)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("md"))
            .collect();
        paths.sort();
        for source in paths {
            let relative = source.strip_prefix(root).expect("source under root");
            copy_file(&source, &dest.join(relative))?;
            files.push(relative_string(relative));
            *count += 1;
        }
    }

    // Portable Collection JSON lives adjacent to canonical Markdown.
    let collections_src = root.join("collections");
    if collections_src.exists() {
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&collections_src)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension().and_then(|extension| extension.to_str()) == Some("json")
            })
            .collect();
        paths.sort();
        for source in paths {
            let relative = source.strip_prefix(root).expect("source under root");
            copy_file(&source, &dest.join(relative))?;
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
        copy_file(&source_manifest, &dest.join(".jin/assets/manifest.json"))?;
        files.push(".jin/assets/manifest.json".to_string());
        for hash in asset_manifest.assets.keys() {
            let _ = assets::get_attachment(root, hash)?;
            let relative = format!(".jin/assets/sha256/{hash}");
            copy_file(&root.join(&relative), &dest.join(&relative))?;
            files.push(relative);
            attachments += 1;
        }
    }

    let audit = root.join(".jin").join("sync").join("audit.jsonl");
    let audit_included = audit.exists();
    if audit_included {
        copy_file(&audit, &dest.join(".jin/sync/audit.jsonl"))?;
        files.push(".jin/sync/audit.jsonl".to_string());
    }
    files.sort();
    let manifest = collect_manifest(dest, &files)?;
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|err| JinError::Integrity(format!("serialize export manifest: {err}")))?;
    fs::atomic_write(&dest.join(EXPORT_MANIFEST_FILE), &bytes)?;

    Ok(ExportSummary {
        notes,
        tasks,
        events,
        attachments,
        collections,
        audit_included,
        files,
    })
}

fn destination_is_importable(dest: &Path, force: bool) -> Result<()> {
    if !dest.exists() {
        return Ok(());
    }
    let entries: Vec<PathBuf> = std::fs::read_dir(dest)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    if entries.is_empty() {
        return Ok(());
    }
    if !force {
        return Err(JinError::ExportDestNotEmpty {
            path: dest.display().to_string(),
        });
    }
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

fn rollback_import_swap(dest: &Path, backup: &Path, swapped: &[&str]) {
    for relative in swapped.iter().rev() {
        let applied = dest.join(relative);
        if applied.exists() {
            let _ = if applied.is_dir() {
                std::fs::remove_dir_all(&applied)
            } else {
                std::fs::remove_file(&applied)
            };
        }
        let prior = backup.join(relative);
        if prior.exists() {
            if let Some(parent) = applied.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::rename(prior, applied);
        }
    }
}

fn swap_imported_content(staging: &Path, dest: &Path, force: bool) -> Result<()> {
    const OWNED_PATHS: [&str; 6] = [
        "notes",
        "tasks",
        "events",
        "collections",
        ".jin/assets",
        ".jin/sync/audit.jsonl",
    ];
    std::fs::create_dir_all(dest)?;
    let backup = import_staging_dir(dest, "import-backup")?;
    std::fs::create_dir_all(&backup)?;
    let mut swapped = Vec::new();
    let result = (|| {
        for relative in OWNED_PATHS {
            swapped.push(relative);
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
            }
            let imported = staging.join(relative);
            if imported.exists() {
                if let Some(parent) = current.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(imported, &current)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        rollback_import_swap(dest, &backup, &swapped);
    }
    let _ = std::fs::remove_dir_all(&backup);
    result
}

/// Verify and import a portable export. Canonical content is copied only after
/// every manifest entry has passed hash verification; then the derived index is
/// rebuilt from that canonical restore.
pub fn import(source: &Path, dest: &Path, force: bool) -> Result<ImportSummary> {
    let manifest = verify_export(source)?;
    let imported_files = manifest.files.len();
    destination_is_importable(dest, force)?;
    let staging = import_staging_dir(dest, "import-staging")?;
    let staged = (|| {
        crate::ops::init(&staging)?;
        let mut notes = 0;
        let mut attachments = 0;
        let mut collections = 0;
        for entry in &manifest.files {
            let relative = safe_export_path(&entry.path)?;
            copy_file(&source.join(&relative), &staging.join(&relative))?;
            if entry.path.starts_with("notes/") {
                notes += 1;
            } else if entry.path.starts_with(".jin/assets/sha256/") {
                attachments += 1;
            } else if entry.path.starts_with("collections/") {
                collections += 1;
            }
        }
        // Verify imported assets against their canonical manifest before rebuild.
        let manifest = assets::load_manifest(&staging)?;
        for hash in manifest.assets.keys() {
            let _ = assets::get_attachment(&staging, hash)?;
        }
        crate::ops::api::refresh(&staging)?;
        Ok((notes, attachments, collections))
    })();
    let (notes, attachments, collections) = match staged {
        Ok(counts) => counts,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(err);
        }
    };
    let swapped = swap_imported_content(&staging, dest, force);
    let _ = std::fs::remove_dir_all(&staging);
    swapped?;
    crate::ops::init(dest)?;
    crate::ops::api::refresh(dest)?;
    Ok(ImportSummary {
        imported_files,
        notes,
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
    use crate::ops::notes::{create_note, CreateNoteParams};
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
}
