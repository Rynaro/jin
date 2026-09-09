//! Vault-managed, content-addressed attachment assets.
//!
//! Attachments are immutable byte copies under `.jin/assets/sha256/`, never
//! references to external paths. The manifest is canonical portable metadata;
//! all consumers must verify the content hash before exposing an asset.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::store::fs;
use crate::{JinError, Result};

pub const ASSET_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetEntry {
    pub sha256: String,
    pub mime: String,
    pub size: u64,
    #[serde(default)]
    pub original_names: Vec<String>,
}

/// JSON manifest stored alongside the content-addressed asset files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetManifest {
    pub version: u32,
    #[serde(default)]
    pub assets: BTreeMap<String, AssetEntry>,
}

impl Default for AssetManifest {
    fn default() -> Self {
        Self {
            version: ASSET_MANIFEST_VERSION,
            assets: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetRepairReport {
    /// Store files added to the manifest after successful hash verification.
    pub added: Vec<String>,
    /// Manifest entries whose immutable asset file is absent.
    pub missing: Vec<String>,
    /// Files whose name does not match their content SHA-256. These are left in
    /// place for manual forensics; Jin never guesses or executes them.
    pub invalid: Vec<String>,
}

pub fn assets_dir(root: &Path) -> PathBuf {
    root.join(".jin").join("assets").join("sha256")
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(".jin").join("assets").join("manifest.json")
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        && hash == hash.to_lowercase()
}

fn asset_path(root: &Path, hash: &str) -> Result<PathBuf> {
    if !valid_hash(hash) {
        return Err(JinError::InvalidInput(format!(
            "asset SHA-256 must be 64 lowercase hexadecimal characters: {hash:?}"
        )));
    }
    Ok(assets_dir(root).join(hash))
}

fn read_regular_asset(path: &Path) -> Result<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(JinError::Integrity(format!(
            "managed asset must be a regular non-symlink file: {}",
            path.display()
        )));
    }
    Ok(std::fs::read(path)?)
}

fn detect_mime(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Whether an attachment may be represented by the UI as media. The answer is
/// intentionally narrower than import support; unsupported files remain inert
/// downloadable attachments rather than becoming an active rendering surface.
pub fn is_safe_media_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "video/mp4" | "video/webm"
    )
}

/// Detect only the raster image signatures Jin is prepared to render. This is
/// intentionally a narrow byte check, separate from filename-based import
/// metadata: a `.png` suffix cannot turn arbitrary bytes into an image.
pub fn detect_safe_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 3 && bytes[..3] == [0xff, 0xd8, 0xff] {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub fn load_manifest(root: &Path) -> Result<AssetManifest> {
    let path = manifest_path(root);
    if !path.exists() {
        return Ok(AssetManifest::default());
    }
    let manifest: AssetManifest = serde_json::from_slice(&std::fs::read(path)?)
        .map_err(|err| JinError::Integrity(format!("parse asset manifest: {err}")))?;
    if manifest.version > ASSET_MANIFEST_VERSION {
        return Err(JinError::Integrity(format!(
            "asset manifest version {} is newer than supported {}",
            manifest.version, ASSET_MANIFEST_VERSION
        )));
    }
    for (hash, entry) in &manifest.assets {
        if hash != &entry.sha256 || !valid_hash(hash) {
            return Err(JinError::Integrity(format!(
                "asset manifest contains invalid hash key: {hash:?}"
            )));
        }
    }
    Ok(manifest)
}

fn save_manifest(root: &Path, manifest: &AssetManifest) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|err| JinError::Integrity(format!("serialize asset manifest: {err}")))?;
    fs::atomic_write(&manifest_path(root), &bytes)
}

/// Copy one regular local file into the vault. Symlinks are refused so a
/// seemingly local attachment cannot escape the owner's deliberate copy action.
pub fn import_attachment(root: &Path, source: &Path) -> Result<AssetEntry> {
    let metadata = std::fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(JinError::InvalidInput(format!(
            "attachment source must be a regular non-symlink file: {}",
            source.display()
        )));
    }
    let bytes = std::fs::read(source)?;
    let sha256 = digest(&bytes);
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();
    let mut manifest = load_manifest(root)?;
    let path = asset_path(root, &sha256)?;
    if path.exists() {
        if digest(&read_regular_asset(&path)?) != sha256 {
            return Err(JinError::Integrity(format!(
                "existing content-addressed asset has wrong bytes: {}",
                path.display()
            )));
        }
    } else {
        fs::atomic_write(&path, &bytes)?;
    }
    let entry = manifest
        .assets
        .entry(sha256.clone())
        .or_insert_with(|| AssetEntry {
            sha256: sha256.clone(),
            mime: detect_mime(&name).to_string(),
            size: bytes.len() as u64,
            original_names: vec![],
        });
    if !entry.original_names.contains(&name) {
        entry.original_names.push(name);
        entry.original_names.sort();
    }
    let result = entry.clone();
    save_manifest(root, &manifest)?;
    Ok(result)
}

/// Resolve a manifest entry only after confirming its immutable on-disk bytes.
pub fn get_attachment(root: &Path, hash: &str) -> Result<AssetEntry> {
    Ok(get_attachment_bytes(root, hash)?.0)
}

/// Read an attachment once and verify the exact bytes returned. Consumers that
/// render or export content must use this rather than validating one read and
/// exposing another one.
pub fn get_attachment_bytes(root: &Path, hash: &str) -> Result<(AssetEntry, Vec<u8>)> {
    let manifest = load_manifest(root)?;
    let entry = manifest
        .assets
        .get(hash)
        .cloned()
        .ok_or_else(|| JinError::NotFound(format!("attachment/{hash}")))?;
    let bytes = read_regular_asset(&asset_path(root, hash)?)?;
    if digest(&bytes) != hash || bytes.len() as u64 != entry.size {
        return Err(JinError::Integrity(format!(
            "attachment {hash} does not match its manifest"
        )));
    }
    Ok((entry, bytes))
}

/// Return the canonical inert Markdown reference for an attachment.
pub fn attachment_reference(hash: &str) -> Result<String> {
    if !valid_hash(hash) {
        return Err(JinError::InvalidInput(
            "invalid attachment hash".to_string(),
        ));
    }
    Ok(format!("jin-asset://sha256/{hash}"))
}

/// Repair only derivable manifest omissions. The operation is conservative:
/// malformed files and absent manifest entries are reported but never deleted.
pub fn repair_assets(root: &Path) -> Result<AssetRepairReport> {
    let mut manifest = load_manifest(root)?;
    let mut report = AssetRepairReport::default();
    for hash in manifest.assets.keys() {
        if !asset_path(root, hash)?.is_file() {
            report.missing.push(hash.clone());
        }
    }
    let dir = assets_dir(root);
    if dir.exists() {
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if !path.is_file() || path.is_symlink() {
                continue;
            }
            let Some(hash) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !valid_hash(hash) || digest(&std::fs::read(&path)?) != hash {
                report.invalid.push(path.to_string_lossy().to_string());
                continue;
            }
            if !manifest.assets.contains_key(hash) {
                let size = std::fs::metadata(&path)?.len();
                manifest.assets.insert(
                    hash.to_string(),
                    AssetEntry {
                        sha256: hash.to_string(),
                        mime: "application/octet-stream".to_string(),
                        size,
                        original_names: vec![],
                    },
                );
                report.added.push(hash.to_string());
            }
        }
    }
    report.added.sort();
    report.missing.sort();
    report.invalid.sort();
    if !report.added.is_empty() {
        save_manifest(root, &manifest)?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use tempfile::TempDir;

    #[test]
    fn detects_only_supported_raster_image_signatures() {
        assert_eq!(
            detect_safe_image_mime(b"\x89PNG\r\n\x1a\nrest"),
            Some("image/png")
        );
        assert_eq!(
            detect_safe_image_mime(b"\xff\xd8\xff\xe0"),
            Some("image/jpeg")
        );
        assert_eq!(detect_safe_image_mime(b"GIF89arest"), Some("image/gif"));
        assert_eq!(
            detect_safe_image_mime(b"RIFF\0\0\0\0WEBPrest"),
            Some("image/webp")
        );
        assert_eq!(detect_safe_image_mime(b"<html>not an image</html>"), None);
    }

    #[test]
    fn imports_deduplicates_and_repairs_content_addressed_assets() {
        let vault = TempDir::new().unwrap();
        let source_dir = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let source = source_dir.path().join("image.png");
        std::fs::write(&source, b"png-like-bytes").unwrap();
        let first = import_attachment(vault.path(), &source).unwrap();
        let second = import_attachment(vault.path(), &source).unwrap();
        assert_eq!(first.sha256, second.sha256);
        assert!(is_safe_media_mime(&first.mime));
        assert_eq!(
            attachment_reference(&first.sha256).unwrap(),
            format!("jin-asset://sha256/{}", first.sha256)
        );
        std::fs::remove_file(manifest_path(vault.path())).unwrap();
        let repair = repair_assets(vault.path()).unwrap();
        assert_eq!(repair.added, vec![first.sha256.clone()]);
        assert_eq!(
            get_attachment(vault.path(), &first.sha256).unwrap().size,
            first.size
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolver_refuses_symlink_even_when_target_bytes_match_manifest() {
        use std::os::unix::fs::symlink;

        let vault = TempDir::new().unwrap();
        let source_dir = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let source = source_dir.path().join("photo.png");
        std::fs::write(&source, b"immutable bytes").unwrap();
        let entry = import_attachment(vault.path(), &source).unwrap();
        let stored = asset_path(vault.path(), &entry.sha256).unwrap();
        std::fs::remove_file(&stored).unwrap();
        symlink(&source, &stored).unwrap();

        let error = get_attachment_bytes(vault.path(), &entry.sha256).unwrap_err();
        assert!(error.to_string().contains("regular non-symlink"));
    }

    #[test]
    fn resolver_rejects_changed_bytes_before_returning_them() {
        let vault = TempDir::new().unwrap();
        let source_dir = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let source = source_dir.path().join("photo.png");
        std::fs::write(&source, b"original bytes").unwrap();
        let entry = import_attachment(vault.path(), &source).unwrap();
        std::fs::write(
            asset_path(vault.path(), &entry.sha256).unwrap(),
            b"tampered bytes",
        )
        .unwrap();

        let error = get_attachment_bytes(vault.path(), &entry.sha256).unwrap_err();
        assert!(error.to_string().contains("does not match its manifest"));
    }
}
