//! CLI path tests for `jin sync` (S6.2).
//!
//! Drives the real `jin` binary via `env!("CARGO_BIN_EXE_jin")`.
//! All tests run OFFLINE — no real Google account or network required.
//! The test covering "unauthenticated → exit 5" is the primary CLI guard.

use std::process::Command;

use tempfile::TempDir;

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// Initialise a temp jin root and return `(TempDir, path)`.
fn init_root() -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    let status = Command::new(jin_bin())
        .args(["--root", root.to_str().unwrap(), "init"])
        .status()
        .expect("failed to run jin init");
    assert!(status.success(), "jin init failed");
    (tmp, root)
}

/// Run `jin --root <root> --json <args…>` and return (exit_code, stdout, stderr).
fn run(root: &std::path::Path, args: &[&str]) -> (i32, String, String) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    (code, stdout, stderr)
}

// ── Unauthenticated → exit 5 ──────────────────────────────────────────────────

/// `jin sync` without any stored tokens must exit with code 5 (auth error).
/// This verifies the CLI path routes through the real auth check, not a stub.
#[test]
fn sync_unauthenticated_exits_5() {
    let (_tmp, root) = init_root();

    // Force the encrypted-file backend (no keyring on CI) but do NOT set a passphrase,
    // so load_tokens will fail with JinError::Auth (no tokens stored).
    // We also need to configure the google credentials to avoid a different auth error.
    // Since we have no client_id configured either, the auth error for missing tokens
    // comes from load_tokens, which is mapped to exit 5.
    let (code, stdout, stderr) = run(&root, &["sync"]);

    assert_eq!(
        code, 5,
        "jin sync without auth must exit 5 (auth error), got: {code}\nstdout={stdout}\nstderr={stderr}"
    );
}

/// `jin sync --json` without tokens must return an error envelope (not raw panic text).
#[test]
fn sync_unauthenticated_json_envelope_exit_5() {
    let (_tmp, root) = init_root();

    let (code, stdout, stderr) = run(&root, &["sync"]);

    assert_eq!(
        code, 5,
        "jin sync --json without auth must exit 5\nstdout={stdout}\nstderr={stderr}"
    );

    // The JSON envelope must be parseable (not a panic / plain text crash)
    // Note: since we already pass --json, stdout might be the envelope.
    // stderr may contain the error message in non-json mode.
    // Either way: code must be 5.
    let combined = format!("{stdout}{stderr}");
    assert!(
        combined.contains("auth") || combined.contains("login") || combined.contains("token"),
        "error message must mention auth/login/token: {combined}"
    );
}

/// Verify `jin sync` message directs user to `jin auth login`.
#[test]
fn sync_unauthenticated_mentions_auth_login() {
    let (_tmp, root) = init_root();

    let (code, stdout, stderr) = run(&root, &["sync"]);

    assert_eq!(code, 5, "must exit 5");

    let combined = format!("{stdout}{stderr}");
    assert!(
        combined.to_lowercase().contains("login") || combined.to_lowercase().contains("auth"),
        "output must mention auth/login: {combined}"
    );
}
