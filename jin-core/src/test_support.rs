//! Shared test utilities for `jin-core` unit tests.
//!
//! This module is compiled **only during `cargo test`** (`#[cfg(test)]`).
//! It provides:
//!   - `PASSPHRASE_ENV_LOCK` — serialises all tests that touch `JIN_TOKEN_PASSPHRASE`
//!   - `CREDENTIALS_ENV_LOCK` — serialises tests that touch `JIN_GOOGLE_CLIENT_ID`
//!     and `JIN_GOOGLE_CLIENT_SECRET`
//!   - `EnvGuard` — RAII helper: acquires the lock, saves the current env value,
//!     sets or removes it, and restores the original on `Drop` (panic-safe).
//!
//! # Usage
//!
//! ```ignore
//! use crate::test_support::{EnvGuard, PASSPHRASE_ENV_LOCK};
//!
//! #[test]
//! fn some_test() {
//!     let _guard = EnvGuard::remove("JIN_TOKEN_PASSPHRASE", &PASSPHRASE_ENV_LOCK);
//!     // env var is now absent; restored on drop
//! }
//! ```

/// Mutex that serialises all tests that read, set, or remove `JIN_TOKEN_PASSPHRASE`
/// in the current test binary.
///
/// Every test that mutates (or relies on the absence of) `JIN_TOKEN_PASSPHRASE`
/// MUST hold this lock for its entire lifetime.  Tests that use
/// `EncryptedFileStore::with_passphrase` directly do NOT need this lock.
pub(crate) static PASSPHRASE_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Mutex that serialises all tests that read, set, or remove
/// `JIN_GOOGLE_CLIENT_ID` / `JIN_GOOGLE_CLIENT_SECRET`.
pub(crate) static CREDENTIALS_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// RAII guard: acquires a named mutex, saves the current env var value, then
/// sets or removes it.  Restores the original value (or removes it if it was
/// absent) on `Drop` — even if the test panics.
pub(crate) struct EnvGuard {
    key: &'static str,
    prior: Option<String>,
    // Field is only for its Drop impl (releases the lock when the guard is dropped).
    _lock: std::sync::MutexGuard<'static, ()>,
}

impl EnvGuard {
    /// Acquire `lock`, then remove `key` from the environment.
    pub(crate) fn remove(key: &'static str, lock: &'static std::sync::Mutex<()>) -> Self {
        let _lock = lock.lock().unwrap_or_else(|e| e.into_inner());
        let prior = std::env::var(key).ok();
        std::env::remove_var(key);
        Self { key, prior, _lock }
    }

    /// Acquire `lock`, then set `key` to `value` in the environment.
    pub(crate) fn set(key: &'static str, value: &str, lock: &'static std::sync::Mutex<()>) -> Self {
        let _lock = lock.lock().unwrap_or_else(|e| e.into_inner());
        let prior = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, prior, _lock }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.prior {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}
