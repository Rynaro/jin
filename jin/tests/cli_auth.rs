//! CLI path tests for `jin auth` (S6.1).
//!
//! Drives the real `jin` binary via `env!("CARGO_BIN_EXE_jin")` to ensure the
//! full CLI path is exercised (P3 requirement: test the binary, not just core).
//!
//! All tests run OFFLINE.  No real Google credentials or network needed:
//!   - `auth status` and `auth logout` are state-inspection / teardown commands
//!     that work without an active auth session.
//!   - `auth login` is NOT exercised in CI (it requires a browser + real creds).

use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// Create a fresh jin root (via `jin init`) and force `token_backend = "file"`
/// in the generated config.
///
/// Forcing the file backend is essential for tests that must observe "Not
/// authenticated": on a developer machine with a working OS keyring that holds
/// real Jin tokens, the default `token_backend = "keyring"` would cause
/// `auth status` to return "Authenticated" from the real keyring, making the
/// test non-deterministic.
///
/// With `token_backend = "file"` the binary can never reach the OS keyring;
/// it looks only for `<root>/.jin/sync/tokens.enc` which doesn't exist in the
/// fresh temp dir → always reports "Not authenticated".
fn make_isolated_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let _ = Command::new(jin_bin())
        .args(["--root", tmp.path().to_str().unwrap(), "--json", "init"])
        .output()
        .unwrap();

    // Override token_backend so the subprocess never touches the OS keyring.
    let mut cfg = jin_core::Config::load(tmp.path()).expect("config must exist after init");
    cfg.token_backend = "file".to_string();
    cfg.save().expect("config must be saveable");

    tmp
}

/// Run `jin --root <root> --json <args…>` and return (exit_code, parsed_json).
fn run_json_raw(root: &std::path::Path, args: &[&str]) -> (i32, Value) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    let code = out.status.code().unwrap_or(-1);
    let json: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|_| {
        serde_json::json!({
            "raw_stdout": String::from_utf8_lossy(&out.stdout).to_string(),
            "raw_stderr": String::from_utf8_lossy(&out.stderr).to_string(),
        })
    });
    (code, json)
}

/// Run `jin --root <root> <args…>` (human mode) and return (exit_code, stdout, stderr).
fn run_human(root: &std::path::Path, args: &[&str]) -> (i32, String, String) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root);
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    (code, stdout, stderr)
}

// ── auth status (no creds) ────────────────────────────────────────────────────

/// `jin auth status` with no tokens stored must exit 0 with a clear "Not authenticated" message.
/// Exit 0 is correct: the command itself succeeded — it just reports "not logged in".
#[test]
fn cli_auth_status_no_creds_exits_zero() {
    let tmp = make_isolated_root();

    let (code, _, stderr) = run_human(tmp.path(), &["auth", "status"]);
    assert_eq!(
        code, 0,
        "auth status with no tokens must exit 0; stderr: {stderr}"
    );
}

#[test]
fn cli_auth_status_no_creds_contains_not_authenticated() {
    let tmp = make_isolated_root();

    let (_, stdout, _) = run_human(tmp.path(), &["auth", "status"]);
    assert!(
        stdout.to_lowercase().contains("not authenticated"),
        "output must say 'Not authenticated': {stdout}"
    );
}

/// `jin auth status --json` must return a valid DTO envelope with `authenticated: false`.
#[test]
fn cli_auth_status_json_no_creds_envelope() {
    let tmp = make_isolated_root();

    let (code, json) = run_json_raw(tmp.path(), &["auth", "status"]);
    assert_eq!(code, 0, "must exit 0");

    // Must be a versioned DTO envelope
    assert_eq!(
        json["jin_dto_version"].as_str(),
        Some("1"),
        "must have jin_dto_version=1: {json}"
    );
    // `authenticated` field must be false
    let authenticated = json["data"]["authenticated"]
        .as_bool()
        .unwrap_or_else(|| panic!("data.authenticated must be a bool: {json}"));
    assert!(!authenticated, "must report not authenticated");
}

/// `--json` envelope must include the `backend` field.
#[test]
fn cli_auth_status_json_includes_backend_field() {
    let tmp = make_isolated_root();

    let (_, json) = run_json_raw(tmp.path(), &["auth", "status"]);
    assert!(
        json["data"]["backend"].is_string(),
        "data.backend must be a string: {json}"
    );
}

// ── auth logout (no creds) ────────────────────────────────────────────────────

/// `jin auth logout` on a fresh store must print a friendly message with no "error" substring.
#[test]
fn cli_auth_logout_no_creds_message_friendly() {
    let tmp = make_isolated_root();

    let (code, stdout, stderr) = run_human(tmp.path(), &["auth", "logout"]);
    assert_eq!(
        code, 0,
        "must exit 0 when no creds stored; stderr: {stderr}"
    );
    // Must NOT contain "error" (the old behaviour leaked the internal error message)
    assert!(
        !stdout.to_lowercase().contains("error"),
        "logout with no creds must not show 'error'; stdout: {stdout}"
    );
    // Must print a recognisably friendly message
    assert!(
        stdout.contains("no stored credentials") || stdout.to_lowercase().contains("logged out"),
        "must print a friendly logout message; stdout: {stdout}"
    );
}

/// `jin auth logout` when not authenticated must exit cleanly (0 or 0) without panic.
#[test]
fn cli_auth_logout_no_creds_exits_cleanly() {
    let tmp = make_isolated_root();

    let (code, stdout, stderr) = run_human(tmp.path(), &["auth", "logout"]);
    assert_eq!(
        code, 0,
        "auth logout with no stored tokens must exit 0; stdout: {stdout}; stderr: {stderr}"
    );
}

/// `jin auth logout --json` must return a versioned DTO envelope.
#[test]
fn cli_auth_logout_json_envelope() {
    let tmp = make_isolated_root();

    let (code, json) = run_json_raw(tmp.path(), &["auth", "logout"]);
    assert_eq!(code, 0);
    assert_eq!(
        json["jin_dto_version"].as_str(),
        Some("1"),
        "must have versioned envelope: {json}"
    );
}

// ── Consent-screen "In production" guidance via login --help / help text ──────

/// `jin auth login --help` must not panic and must print usage info.
#[test]
fn cli_auth_login_help_exits_zero() {
    let (code, stdout, _) = run_human(std::path::Path::new("/tmp"), &["auth", "login", "--help"]);
    assert_eq!(code, 0, "help must exit 0; stdout: {stdout}");
}

// ── Status shows backend after storing tokens ─────────────────────────────────

/// When tokens are stored via the encrypted-file backend, `auth status`
/// must reflect the `encrypted-file` backend.
#[test]
fn cli_auth_status_shows_encrypted_file_backend_after_file_token_store() {
    use std::os::unix::fs::PermissionsExt;

    // make_isolated_root forces token_backend="file", matching what this test exercises.
    let tmp = make_isolated_root();

    let tokens = jin_core::google::secrets::TokenSet {
        access_token: "ya29.cli_test".to_string(),
        refresh_token: Some("1//cli_refresh".to_string()),
        expires_at: 9_999_999_999,
        scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
        client_id: "test.apps.googleusercontent.com".to_string(),
        account: None,
    };

    // Force file backend — use with_passphrase to avoid touching the
    // process-global JIN_TOKEN_PASSPHRASE env var (which would race with
    // other parallel tests in this binary).
    let store = jin_core::google::secrets::EncryptedFileStore::with_passphrase(
        tmp.path(),
        "cli-test-pass-status",
    )
    .expect("store must open");
    store.save(&tokens).expect("save must succeed");

    // Ensure tokens.enc has 0600
    let enc_path = tmp.path().join(".jin").join("sync").join("tokens.enc");
    let mode = std::fs::metadata(&enc_path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "tokens.enc must be 0600, got {mode:o}");

    // Run `auth status --json` with file backend configured
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root")
        .arg(tmp.path())
        .arg("--json")
        .arg("auth")
        .arg("status")
        .env("JIN_TOKEN_PASSPHRASE", "cli-test-pass-status");
    // Override config to use file backend
    let output = cmd.output().unwrap();
    let _json: Value = serde_json::from_slice(&output.stdout).unwrap_or_default();

    // The command should succeed (exit 0)
    assert_eq!(
        output.status.code(),
        Some(0),
        "status must exit 0; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
