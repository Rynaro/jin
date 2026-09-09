//! Secure attachment bridge.
//!
//! The bridge returns verified manifest metadata only—not arbitrary filesystem
//! paths—so frontend rendering cannot turn Markdown into local-file access.

use std::path::Path;

use jin_core::ops::assets::{self, AssetEntry, AssetRepairReport};

use crate::error::JinErrorDto;
use crate::state::AppState;

/// Bytes exposed to the webview only after the immutable asset store has
/// validated the manifest entry, byte length and SHA-256. The UI turns these
/// bytes into an app-owned Blob URL; it never receives a filesystem path.
#[derive(Debug, serde::Serialize)]
pub struct ResolvedImageAsset {
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub fn import_attachment_fn(root: &Path, source: String) -> Result<AssetEntry, JinErrorDto> {
    assets::import_attachment(root, Path::new(&source)).map_err(JinErrorDto::from)
}

pub fn list_attachments_fn(root: &Path) -> Result<Vec<AssetEntry>, JinErrorDto> {
    let manifest = assets::load_manifest(root).map_err(JinErrorDto::from)?;
    let mut entries = Vec::new();
    for hash in manifest.assets.keys() {
        entries.push(assets::get_attachment(root, hash).map_err(JinErrorDto::from)?);
    }
    Ok(entries)
}

pub fn repair_attachments_fn(root: &Path) -> Result<AssetRepairReport, JinErrorDto> {
    assets::repair_assets(root).map_err(JinErrorDto::from)
}

pub fn resolve_image_attachment_fn(
    root: &Path,
    hash: String,
) -> Result<ResolvedImageAsset, JinErrorDto> {
    let (entry, bytes) = assets::get_attachment_bytes(root, &hash).map_err(JinErrorDto::from)?;
    let detected = assets::detect_safe_image_mime(&bytes);
    if detected != Some(entry.mime.as_str()) {
        return Err(JinErrorDto::from(jin_core::JinError::InvalidInput(
            "attachment bytes do not match a supported image MIME".to_string(),
        )));
    }
    Ok(ResolvedImageAsset {
        mime: entry.mime,
        bytes,
    })
}

#[tauri::command]
pub async fn import_attachment(
    state: tauri::State<'_, AppState>,
    source: String,
) -> Result<AssetEntry, JinErrorDto> {
    import_attachment_fn(&state.root, source)
}

#[tauri::command]
pub async fn list_attachments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AssetEntry>, JinErrorDto> {
    list_attachments_fn(&state.root)
}

#[tauri::command]
pub async fn repair_attachments(
    state: tauri::State<'_, AppState>,
) -> Result<AssetRepairReport, JinErrorDto> {
    repair_attachments_fn(&state.root)
}

#[tauri::command]
pub async fn resolve_image_attachment(
    state: tauri::State<'_, AppState>,
    hash: String,
) -> Result<ResolvedImageAsset, JinErrorDto> {
    resolve_image_attachment_fn(&state.root, hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG_PREFIX: &[u8] = b"\x89PNG\r\n\x1a\nfixture-bytes";

    #[test]
    fn image_resolver_returns_the_exact_verified_bytes() {
        let vault = TempDir::new().unwrap();
        jin_core::ops::init(vault.path()).unwrap();
        let source = vault.path().join("photo.png");
        std::fs::write(&source, PNG_PREFIX).unwrap();
        let entry =
            import_attachment_fn(vault.path(), source.to_string_lossy().to_string()).unwrap();

        let resolved = resolve_image_attachment_fn(vault.path(), entry.sha256).unwrap();
        assert_eq!(resolved.mime, "image/png");
        assert_eq!(resolved.bytes, PNG_PREFIX);
    }

    #[test]
    fn image_resolver_rejects_manifest_mime_that_disagrees_with_bytes() {
        let vault = TempDir::new().unwrap();
        jin_core::ops::init(vault.path()).unwrap();
        let source = vault.path().join("mislabelled.jpg");
        std::fs::write(&source, PNG_PREFIX).unwrap();
        let entry =
            import_attachment_fn(vault.path(), source.to_string_lossy().to_string()).unwrap();

        let error = resolve_image_attachment_fn(vault.path(), entry.sha256).unwrap_err();
        assert!(error.message.contains("supported image MIME"));
    }

    #[test]
    fn image_resolver_rejects_extension_only_image_claims() {
        let vault = TempDir::new().unwrap();
        jin_core::ops::init(vault.path()).unwrap();
        let source = vault.path().join("not-an-image.png");
        std::fs::write(&source, b"<html>not an image</html>").unwrap();
        let entry =
            import_attachment_fn(vault.path(), source.to_string_lossy().to_string()).unwrap();

        assert!(resolve_image_attachment_fn(vault.path(), entry.sha256).is_err());
    }
}
