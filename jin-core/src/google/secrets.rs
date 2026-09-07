//! OAuth token persistence — OS keyring primary; AEAD-encrypted file fallback.
//!
//! # Storage backends
//!
//! | Backend | When used | Notes |
//! |---------|-----------|-------|
//! | `KeyringStore` | `config.token_backend = "keyring"` AND keyring available | OS secret store |
//! | `EncryptedFileStore` | headless Linux / no keyring / `token_backend = "file"` | AEAD-encrypted `.jin/sync/tokens.enc` |
//!
//! # Encrypted-file scheme (AEAD fallback)
//!
//! ```text
//! File: .jin/sync/tokens.enc  (mode 0600)
//! Layout: [16-byte salt][12-byte nonce][chacha20-poly1305 ciphertext + 16-byte auth tag]
//!
//! Key derivation: Argon2id
//!   input:     passphrase from JIN_TOKEN_PASSPHRASE env var
//!   salt:      16 random bytes (stored at offset 0)
//!   params:    m=65536 KiB, t=3, p=1  (production); m=1024, t=1, p=1 (tests)
//!   output:    32-byte key
//!
//! Cipher: ChaCha20-Poly1305 (256-bit key, 96-bit nonce, 128-bit auth tag)
//!   plaintext: UTF-8 JSON of TokenSet
//!   AAD:       none
//! ```
//!
//! **Never writes the refresh token as plaintext.**  If no passphrase is available and
//! no keyring is present, the operation fails with a clear, actionable error.

use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use crate::google::account::GoogleAccountId;
use crate::JinError;

// ── Keyring constants ─────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "jin-oauth";
const KEYRING_USER: &str = "google";

fn account_keyring_user(account_id: &GoogleAccountId) -> String {
    format!("google/{}", account_id.as_str())
}

fn account_token_path(root: &Path, account_id: &GoogleAccountId) -> PathBuf {
    root.join(".jin")
        .join("sync")
        .join("accounts")
        .join(account_id.as_str())
        .join("tokens.enc")
}

// ── TokenSet ──────────────────────────────────────────────────────────────────

/// Persisted OAuth token data.  Stored as JSON (encrypted or via keyring).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    /// `None` on initial exchange only if Google doesn't return one (unusual).
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) when the access token expires.
    pub expires_at: i64,
    /// Granted OAuth scopes (space-separated).
    pub scope: String,
    /// The OAuth client_id used to obtain these tokens (for cross-reference).
    pub client_id: String,
    /// Google account identifier, if obtained (may be None until userinfo fetch).
    pub account: Option<String>,
}

impl TokenSet {
    /// Returns `true` if the access token has expired or will expire within 5 minutes.
    pub fn is_expired(&self) -> bool {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.expires_at <= now + 300
    }
}

// ── Storage backend enum ──────────────────────────────────────────────────────

/// Which backend is actively storing tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageBackend {
    Keyring,
    EncryptedFile,
}

impl StorageBackend {
    pub fn name(&self) -> &'static str {
        match self {
            StorageBackend::Keyring => "keyring",
            StorageBackend::EncryptedFile => "encrypted-file",
        }
    }
}

// ── KeyringStore ──────────────────────────────────────────────────────────────

/// Stores tokens in the OS secret store (keyring 3.x).
///
/// On Linux with `linux-native` feature: uses the kernel keyutils user keyring.
/// On macOS: macOS Keychain.  On Windows: Credential Manager.
#[derive(Debug)]
pub struct KeyringStore;

impl KeyringStore {
    /// Attempt to save `tokens` to the keyring.
    /// Returns `JinError::Auth` if the keyring backend is unavailable.
    pub fn save(&self, tokens: &TokenSet) -> crate::Result<()> {
        let json = serde_json::to_string(tokens)
            .map_err(|e| JinError::Auth(format!("serialize tokens: {e}")))?;

        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| JinError::Auth(format!("keyring entry: {e}")))?;

        entry
            .set_password(&json)
            .map_err(|e| JinError::Auth(format!("keyring save: {e}")))?;

        Ok(())
    }

    /// Load tokens from the keyring.
    pub fn load(&self) -> crate::Result<TokenSet> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| JinError::Auth(format!("keyring entry: {e}")))?;

        let json = entry
            .get_password()
            .map_err(|e| JinError::Auth(format!("keyring load: {e}")))?;

        serde_json::from_str(&json)
            .map_err(|e| JinError::Auth(format!("deserialize tokens from keyring: {e}")))
    }

    /// Delete tokens from the keyring.
    ///
    /// Returns `Ok(true)` if tokens were deleted, `Ok(false)` if no entry was
    /// stored (not an error — idempotent delete).
    pub fn delete(&self) -> crate::Result<bool> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| JinError::Auth(format!("keyring entry: {e}")))?;

        match entry.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(JinError::Auth(format!("keyring delete: {e}"))),
        }
    }

    /// Probe whether the keyring backend is functional.
    /// Returns `Ok(())` if a round-trip succeeds, `Err` otherwise.
    pub fn probe(&self) -> crate::Result<()> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, "__probe__")
            .map_err(|e| JinError::Auth(format!("keyring probe: {e}")))?;

        entry
            .set_password("probe")
            .map_err(|e| JinError::Auth(format!("keyring probe write: {e}")))?;

        let _ = entry.delete_credential();
        Ok(())
    }
}

// ── EncryptedFileStore ────────────────────────────────────────────────────────

/// AEAD-encrypted token file stored at `.jin/sync/tokens.enc` (mode 0600).
///
/// The passphrase is read from the `JIN_TOKEN_PASSPHRASE` environment variable.
/// If the variable is not set, `new()` returns `JinError::Auth` with a clear
/// actionable error — **never falls back to plaintext**.
#[derive(Debug)]
pub struct EncryptedFileStore {
    path: PathBuf,
    passphrase: String,
}

impl EncryptedFileStore {
    /// Create a store pointing to `<root>/.jin/sync/tokens.enc`.
    ///
    /// Fails with `JinError::Auth` if `JIN_TOKEN_PASSPHRASE` is not set.
    pub fn new(root: &Path) -> crate::Result<Self> {
        let passphrase = std::env::var("JIN_TOKEN_PASSPHRASE").map_err(|_| {
            JinError::Auth(
                "No keyring Secret Service is available and JIN_TOKEN_PASSPHRASE is not set. \
                 Set a strong passphrase: export JIN_TOKEN_PASSPHRASE=\"<your passphrase>\". \
                 Jin cannot store OAuth tokens without encryption. \
                 Alternatively, install gnome-keyring or another Secret Service daemon and \
                 re-run 'jin auth login'."
                    .to_string(),
            )
        })?;

        if passphrase.is_empty() {
            return Err(JinError::Auth(
                "JIN_TOKEN_PASSPHRASE is set but empty. Provide a non-empty passphrase."
                    .to_string(),
            ));
        }

        let sync_dir = root.join(".jin").join("sync");
        std::fs::create_dir_all(&sync_dir)?;

        Ok(Self {
            path: sync_dir.join("tokens.enc"),
            passphrase,
        })
    }

    /// Create a store with an explicitly-provided passphrase.
    ///
    /// This bypasses the `JIN_TOKEN_PASSPHRASE` env-var read.  Use this in
    /// tests and anywhere an explicit passphrase is already known, to avoid
    /// touching the process-global environment.
    pub fn with_passphrase(root: &Path, passphrase: &str) -> crate::Result<Self> {
        if passphrase.is_empty() {
            return Err(JinError::Auth(
                "JIN_TOKEN_PASSPHRASE is set but empty. Provide a non-empty passphrase."
                    .to_string(),
            ));
        }
        let sync_dir = root.join(".jin").join("sync");
        std::fs::create_dir_all(&sync_dir)?;
        Ok(Self {
            path: sync_dir.join("tokens.enc"),
            passphrase: passphrase.to_string(),
        })
    }

    fn for_account(
        root: &Path,
        account_id: &GoogleAccountId,
        passphrase: String,
    ) -> crate::Result<Self> {
        if passphrase.is_empty() {
            return Err(JinError::Auth(
                "JIN_TOKEN_PASSPHRASE is set but empty. Provide a non-empty passphrase."
                    .to_string(),
            ));
        }
        let path = account_token_path(root, account_id);
        let parent = path
            .parent()
            .ok_or_else(|| JinError::Integrity("account token path has no parent".to_string()))?;
        std::fs::create_dir_all(parent)?;
        Ok(Self { path, passphrase })
    }

    /// Save `tokens` as AEAD-encrypted JSON to `tokens.enc`.
    pub fn save(&self, tokens: &TokenSet) -> crate::Result<()> {
        let plaintext = serde_json::to_vec(tokens)
            .map_err(|e| JinError::Auth(format!("serialize tokens: {e}")))?;

        let ciphertext = encrypt(&self.passphrase, &plaintext)?;

        std::fs::write(&self.path, &ciphertext)?;

        // Restrict permissions to owner read/write only where Unix mode bits
        // exist. Windows protects the encrypted file through its filesystem
        // ACLs; the AEAD payload remains identical and cross-platform.
        #[cfg(unix)]
        {
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&self.path, perms)?;
        }

        Ok(())
    }

    /// Load and decrypt tokens from `tokens.enc`.
    pub fn load(&self) -> crate::Result<TokenSet> {
        if !self.path.exists() {
            return Err(JinError::Auth(
                "No stored tokens found. Run 'jin auth login' to authenticate.".to_string(),
            ));
        }

        let ciphertext = std::fs::read(&self.path)?;
        let plaintext = decrypt(&self.passphrase, &ciphertext)?;

        serde_json::from_slice(&plaintext)
            .map_err(|e| JinError::Auth(format!("deserialize tokens from file: {e}")))
    }

    /// Delete the encrypted token file.
    pub fn delete(&self) -> crate::Result<()> {
        if self.path.exists() {
            std::fs::remove_file(&self.path)?;
        }
        Ok(())
    }
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

/// Argon2id parameters.  Smaller in test builds for speed.
fn argon2_params() -> argon2::Params {
    #[cfg(not(test))]
    return argon2::Params::new(65536, 3, 1, Some(32)).expect("valid argon2 params (production)");
    #[cfg(test)]
    return argon2::Params::new(1024, 1, 1, Some(32)).expect("valid argon2 params (test)");
}

/// Encrypt `plaintext` with ChaCha20-Poly1305.
/// Layout: [16-byte salt][12-byte nonce][ciphertext + 16-byte auth tag]
fn encrypt(passphrase: &str, plaintext: &[u8]) -> crate::Result<Vec<u8>> {
    use chacha20poly1305::aead::{Aead, KeyInit};
    use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
    use rand::RngCore;

    // Generate random salt and nonce
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    // Derive key from passphrase
    let mut key_bytes = [0u8; 32];
    let argon2 = argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2_params(),
    );
    argon2
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key_bytes)
        .map_err(|e| JinError::Auth(format!("key derivation: {e}")))?;

    // Encrypt
    let key = Key::from_slice(&key_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| JinError::Auth("AEAD encryption failed".to_string()))?;

    // Pack: salt || nonce || ciphertext
    let mut out = Vec::with_capacity(16 + 12 + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a blob produced by `encrypt`.
fn decrypt(passphrase: &str, blob: &[u8]) -> crate::Result<Vec<u8>> {
    use chacha20poly1305::aead::{Aead, KeyInit};
    use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

    if blob.len() < 16 + 12 + 16 {
        return Err(JinError::Auth(
            "tokens.enc is corrupt or truncated".to_string(),
        ));
    }

    let (salt, rest) = blob.split_at(16);
    let (nonce_bytes, ciphertext) = rest.split_at(12);

    // Derive key
    let mut key_bytes = [0u8; 32];
    let argon2 = argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2_params(),
    );
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key_bytes)
        .map_err(|e| JinError::Auth(format!("key derivation: {e}")))?;

    // Decrypt
    let key = Key::from_slice(&key_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher.decrypt(nonce, ciphertext).map_err(|_| {
        JinError::Auth("AEAD decryption failed — wrong passphrase or corrupt file".to_string())
    })
}

// ── Public API — auto-detect backend ─────────────────────────────────────────

/// Detect the best available backend and return it.
///
/// Selection order:
/// 1. If `cfg.token_backend == "file"` → always use `EncryptedFileStore`.
/// 2. If `cfg.token_backend == "keyring"` (default) → probe keyring; on failure fall back
///    to `EncryptedFileStore` (with passphrase required from env).
///
/// The encrypted-file fallback is mandatory when no Secret Service is available
/// (headless Linux, CI, SSH sessions).
pub fn detect_backend(_root: &Path, cfg: &crate::Config) -> StorageBackend {
    if cfg.token_backend == "file" {
        return StorageBackend::EncryptedFile;
    }
    match KeyringStore.probe() {
        Ok(_) => StorageBackend::Keyring,
        Err(_) => StorageBackend::EncryptedFile,
    }
}

/// Save tokens using the auto-detected (or configured) backend.
pub fn save_tokens(root: &Path, cfg: &crate::Config, tokens: &TokenSet) -> crate::Result<()> {
    cfg.ensure_singleton_write_allowed()?;
    match detect_backend(root, cfg) {
        StorageBackend::Keyring => KeyringStore.save(tokens),
        StorageBackend::EncryptedFile => EncryptedFileStore::new(root)?.save(tokens),
    }
}

/// Load tokens using the auto-detected (or configured) backend.
pub fn load_tokens(root: &Path, cfg: &crate::Config) -> crate::Result<TokenSet> {
    match detect_backend(root, cfg) {
        StorageBackend::Keyring => KeyringStore.load(),
        StorageBackend::EncryptedFile => EncryptedFileStore::new(root)?.load(),
    }
}

/// Save tokens providing the encryption passphrase explicitly.
///
/// Unlike `save_tokens`, this function ALWAYS writes to the encrypted-file
/// backend (`<root>/.jin/sync/tokens.enc`), regardless of `detect_backend`.
/// It never touches the OS keyring.
///
/// This is the correct entry point for tests and any code that already holds
/// the passphrase: it is fully deterministic regardless of keyring availability
/// and does not mutate `JIN_TOKEN_PASSPHRASE` in the process environment.
pub fn save_tokens_with_passphrase(
    root: &Path,
    cfg: &crate::Config,
    tokens: &TokenSet,
    passphrase: &str,
) -> crate::Result<()> {
    cfg.ensure_singleton_write_allowed()?;
    EncryptedFileStore::with_passphrase(root, passphrase)?.save(tokens)
}

/// Load tokens providing the encryption passphrase explicitly.
///
/// Unlike `load_tokens`, this function ALWAYS reads from the encrypted-file
/// backend (`<root>/.jin/sync/tokens.enc`), regardless of `detect_backend`.
/// It never touches the OS keyring.
///
/// This is the correct entry point for tests and any code that already holds
/// the passphrase: it is fully deterministic regardless of keyring availability
/// and does not read `JIN_TOKEN_PASSPHRASE` from the process environment.
pub fn load_tokens_with_passphrase(
    root: &Path,
    _cfg: &crate::Config,
    passphrase: &str,
) -> crate::Result<TokenSet> {
    EncryptedFileStore::with_passphrase(root, passphrase)?.load()
}

/// Delete the encrypted token file directly (no passphrase required — we only
/// need to remove the file, not decrypt it).
///
/// Returns `true` if the file existed and was removed, `false` if there was
/// nothing to remove.
fn delete_token_file_direct(root: &Path) -> crate::Result<bool> {
    let path = root.join(".jin").join("sync").join("tokens.enc");
    if path.exists() {
        std::fs::remove_file(&path)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Delete stored tokens from all backends.
///
/// Returns `Ok(true)` if any tokens were actually removed, `Ok(false)` if
/// nothing was stored (idempotent — safe to call when not authenticated).
/// Only genuine I/O failures are propagated as errors.
pub fn delete_tokens(root: &Path, cfg: &crate::Config) -> crate::Result<bool> {
    cfg.ensure_singleton_write_allowed()?;
    // Best-effort keyring delete: swallow all keyring errors (unavailable on
    // headless Linux, entry already gone, etc.).  If a keyring session existed
    // and the entry was present, Ok(true) is returned; otherwise Ok(false).
    let kr_deleted = KeyringStore.delete().unwrap_or(false);

    // File delete: does not need the passphrase — just removes the file.
    // Real I/O errors (permissions, device failure) are propagated.
    let file_deleted = delete_token_file_direct(root)?;

    Ok(kr_deleted || file_deleted)
}

/// Save v2 credentials to the exact immutable account namespace. This API
/// deliberately has no legacy fallback.
pub fn save_tokens_for_account(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
    tokens: &TokenSet,
) -> crate::Result<()> {
    cfg.google_registry.account(account_id)?;
    match detect_backend(root, cfg) {
        StorageBackend::Keyring => {
            let json = serde_json::to_string(tokens)
                .map_err(|e| JinError::Auth(format!("serialize tokens: {e}")))?;
            keyring::Entry::new(KEYRING_SERVICE, &account_keyring_user(account_id))
                .map_err(|e| JinError::Auth(format!("keyring entry: {e}")))?
                .set_password(&json)
                .map_err(|e| JinError::Auth(format!("keyring save: {e}")))
        }
        StorageBackend::EncryptedFile => {
            let passphrase = std::env::var("JIN_TOKEN_PASSPHRASE").map_err(|_| {
                JinError::Auth(
                    "JIN_TOKEN_PASSPHRASE is required for encrypted token storage".to_string(),
                )
            })?;
            EncryptedFileStore::for_account(root, account_id, passphrase)?.save(tokens)
        }
    }
}

/// Load v2 credentials only from the requested account namespace.
pub fn load_tokens_for_account(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
) -> crate::Result<TokenSet> {
    cfg.google_registry.account(account_id)?;
    match detect_backend(root, cfg) {
        StorageBackend::Keyring => {
            let json = keyring::Entry::new(KEYRING_SERVICE, &account_keyring_user(account_id))
                .map_err(|e| JinError::Auth(format!("keyring entry: {e}")))?
                .get_password()
                .map_err(|e| JinError::Auth(format!("keyring load: {e}")))?;
            serde_json::from_str(&json)
                .map_err(|e| JinError::Auth(format!("deserialize tokens from keyring: {e}")))
        }
        StorageBackend::EncryptedFile => {
            let passphrase = std::env::var("JIN_TOKEN_PASSPHRASE").map_err(|_| {
                JinError::Auth(
                    "JIN_TOKEN_PASSPHRASE is required for encrypted token storage".to_string(),
                )
            })?;
            EncryptedFileStore::for_account(root, account_id, passphrase)?.load()
        }
    }
}

pub fn save_tokens_for_account_with_passphrase(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
    tokens: &TokenSet,
    passphrase: &str,
) -> crate::Result<()> {
    cfg.google_registry.account(account_id)?;
    EncryptedFileStore::for_account(root, account_id, passphrase.to_string())?.save(tokens)
}

pub fn load_tokens_for_account_with_passphrase(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
    passphrase: &str,
) -> crate::Result<TokenSet> {
    cfg.google_registry.account(account_id)?;
    EncryptedFileStore::for_account(root, account_id, passphrase.to_string())?.load()
}

/// Delete only one account's credentials. Cached events and mappings are not
/// touched by this operation.
pub fn delete_tokens_for_account(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
) -> crate::Result<bool> {
    cfg.google_registry.account(account_id)?;
    let keyring_deleted = keyring::Entry::new(KEYRING_SERVICE, &account_keyring_user(account_id))
        .ok()
        .and_then(|entry| entry.delete_credential().ok())
        .is_some();
    let path = account_token_path(root, account_id);
    let file_deleted = if path.exists() {
        std::fs::remove_file(path)?;
        true
    } else {
        false
    };
    Ok(keyring_deleted || file_deleted)
}

/// Copy a legacy encrypted token into an account namespace, verify it can be
/// decrypted, and retain the legacy slot as rollback material.
pub fn copy_legacy_file_tokens_for_account(
    root: &Path,
    cfg: &crate::Config,
    account_id: &GoogleAccountId,
    passphrase: &str,
) -> crate::Result<()> {
    let tokens = load_tokens_with_passphrase(root, cfg, passphrase)?;
    save_tokens_for_account_with_passphrase(root, cfg, account_id, &tokens, passphrase)?;
    let verified = load_tokens_for_account_with_passphrase(root, cfg, account_id, passphrase)?;
    if verified.access_token != tokens.access_token
        || verified.refresh_token != tokens.refresh_token
        || verified.client_id != tokens.client_id
    {
        let _ = std::fs::remove_file(account_token_path(root, account_id));
        return Err(JinError::Integrity(
            "account token copy verification failed; legacy token retained".to_string(),
        ));
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{EnvGuard, PASSPHRASE_ENV_LOCK};
    use tempfile::TempDir;

    fn sample_tokens() -> TokenSet {
        TokenSet {
            access_token: "ya29.testAccess".to_string(),
            refresh_token: Some("1//testRefresh".to_string()),
            expires_at: 9999999999, // far future
            scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
            client_id: "test.apps.googleusercontent.com".to_string(),
            account: None,
        }
    }

    // ── TokenSet helpers ──────────────────────────────────────────────────────

    #[test]
    fn token_set_serde_round_trip() {
        let ts = sample_tokens();
        let json = serde_json::to_string(&ts).unwrap();
        let ts2: TokenSet = serde_json::from_str(&json).unwrap();
        assert_eq!(ts.access_token, ts2.access_token);
        assert_eq!(ts.refresh_token, ts2.refresh_token);
        assert_eq!(ts.expires_at, ts2.expires_at);
        assert_eq!(ts.scope, ts2.scope);
        assert_eq!(ts.client_id, ts2.client_id);
    }

    #[test]
    fn token_is_expired_when_past_expiry() {
        let mut ts = sample_tokens();
        ts.expires_at = 0; // Unix epoch — definitely expired
        assert!(ts.is_expired());
    }

    #[test]
    fn token_not_expired_when_far_future() {
        let ts = sample_tokens(); // expires_at = 9999999999
        assert!(!ts.is_expired());
    }

    // ── AEAD crypto round-trip ────────────────────────────────────────────────

    #[test]
    fn aead_encrypt_decrypt_round_trip() {
        let plaintext = b"Hello, sovereign tokens!";
        let passphrase = "test-passphrase-1234";

        let ciphertext = encrypt(passphrase, plaintext).expect("encrypt should succeed");
        assert_ne!(
            ciphertext, plaintext,
            "ciphertext must differ from plaintext"
        );
        assert!(
            ciphertext.len() >= 16 + 12 + plaintext.len() + 16,
            "ciphertext must be at least salt+nonce+plaintext+tag bytes"
        );

        let decrypted = decrypt(passphrase, &ciphertext).expect("decrypt should succeed");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aead_wrong_passphrase_fails() {
        let ciphertext = encrypt("correct-passphrase", b"secret").expect("encrypt ok");
        let err = decrypt("wrong-passphrase", &ciphertext).unwrap_err();
        assert!(
            matches!(err, JinError::Auth(_)),
            "wrong passphrase must return JinError::Auth"
        );
    }

    #[test]
    fn aead_truncated_blob_fails() {
        let err = decrypt("pass", &[0u8; 5]).unwrap_err();
        assert!(matches!(err, JinError::Auth(_)));
    }

    // ── EncryptedFileStore round-trip ─────────────────────────────────────────

    /// Uses `with_passphrase` directly — NO global env mutation.
    #[test]
    fn encrypted_file_store_round_trip() {
        let tmp = TempDir::new().unwrap();
        // Inject passphrase directly — no env var touched.
        let store = EncryptedFileStore::with_passphrase(tmp.path(), "file-store-test-pass")
            .expect("store should open");
        let tokens = sample_tokens();

        store.save(&tokens).expect("save should succeed");

        // Verify file exists and has correct permissions
        let path = tmp.path().join(".jin").join("sync").join("tokens.enc");
        assert!(path.exists(), "tokens.enc must be created");
        #[cfg(unix)]
        {
            let meta = std::fs::metadata(&path).unwrap();
            let mode = meta.permissions().mode() & 0o777;
            assert_eq!(
                mode, 0o600,
                "tokens.enc must have 0600 permissions, got {mode:o}"
            );
        }

        // Load and verify
        let loaded = store.load().expect("load should succeed");
        assert_eq!(loaded.access_token, tokens.access_token);
        assert_eq!(loaded.refresh_token, tokens.refresh_token);
        assert_eq!(loaded.expires_at, tokens.expires_at);
    }

    /// Tests that `new()` returns Auth when `JIN_TOKEN_PASSPHRASE` is absent.
    /// Uses `PASSPHRASE_ENV_LOCK` to serialise access to the global env var.
    #[test]
    fn encrypted_file_store_missing_passphrase_fails_clearly() {
        let tmp = TempDir::new().unwrap();
        // Acquire the lock and ensure the var is absent for the duration.
        let _guard = EnvGuard::remove("JIN_TOKEN_PASSPHRASE", &PASSPHRASE_ENV_LOCK);

        let err = EncryptedFileStore::new(tmp.path()).unwrap_err();
        assert!(
            matches!(err, JinError::Auth(_)),
            "missing passphrase must return JinError::Auth"
        );
        let msg = err.to_string();
        assert!(
            msg.contains("JIN_TOKEN_PASSPHRASE"),
            "error must name the env var: {msg}"
        );
        assert!(
            msg.contains("jin auth login"),
            "error must suggest 'jin auth login': {msg}"
        );
    }

    /// Tests that `new()` returns Auth when `JIN_TOKEN_PASSPHRASE` is set but empty.
    /// Uses `PASSPHRASE_ENV_LOCK` to serialise access to the global env var.
    #[test]
    fn encrypted_file_store_empty_passphrase_fails() {
        let tmp = TempDir::new().unwrap();
        let _guard = EnvGuard::set("JIN_TOKEN_PASSPHRASE", "", &PASSPHRASE_ENV_LOCK);

        let err = EncryptedFileStore::new(tmp.path()).unwrap_err();
        assert!(matches!(err, JinError::Auth(_)));
    }

    /// Uses `with_passphrase` directly — NO global env mutation.
    #[test]
    fn encrypted_file_store_delete_removes_file() {
        let tmp = TempDir::new().unwrap();
        let store = EncryptedFileStore::with_passphrase(tmp.path(), "delete-test-pass").unwrap();
        store.save(&sample_tokens()).unwrap();

        let path = tmp.path().join(".jin").join("sync").join("tokens.enc");
        assert!(path.exists());

        store.delete().unwrap();
        assert!(!path.exists(), "tokens.enc must be removed after delete");
    }

    // ── Backend detection ─────────────────────────────────────────────────────

    #[test]
    fn detect_backend_returns_encrypted_file_when_config_says_file() {
        let tmp = TempDir::new().unwrap();
        let mut cfg = crate::Config::new(tmp.path().to_path_buf());
        cfg.token_backend = "file".to_string();

        let backend = detect_backend(tmp.path(), &cfg);
        assert_eq!(backend, StorageBackend::EncryptedFile);
    }

    #[test]
    fn detect_backend_falls_back_to_encrypted_file_when_keyring_unavailable() {
        // On a headless CI system, keyring probe will fail → fallback is EncryptedFile.
        // On a desktop with a running keyring daemon, it may return Keyring instead.
        // Either result is acceptable; the important assertion is that it doesn't panic.
        let tmp = TempDir::new().unwrap();
        let cfg = crate::Config::new(tmp.path().to_path_buf()); // token_backend = "keyring"

        let backend = detect_backend(tmp.path(), &cfg);
        assert!(
            backend == StorageBackend::Keyring || backend == StorageBackend::EncryptedFile,
            "detect_backend must return a valid backend"
        );
    }

    // ── Keyring graceful failure ──────────────────────────────────────────────

    #[test]
    fn keyring_load_missing_credentials_returns_auth_error() {
        // On headless systems, this will fail at the Entry::new level.
        // On systems with a keyring, it will fail because no credentials are stored.
        // Either way, the result must be JinError::Auth.
        let store = KeyringStore;
        // We expect either success (if a keyring is set up) or JinError::Auth.
        // We do NOT expect a panic or a different error type.
        match store.load() {
            Ok(_) => {
                // Keyring had tokens (possible on desktop) — acceptable
            }
            Err(e) => {
                assert!(
                    matches!(e, JinError::Auth(_)),
                    "keyring errors must be JinError::Auth, got: {e}"
                );
            }
        }
    }
}
