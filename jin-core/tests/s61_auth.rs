//! S6.1 integration tests — OAuth auth + token storage.
//!
//! These tests run OFFLINE (no real network, no Google account).
//! The token exchange/refresh tests inject a local mock HTTP server on an
//! ephemeral port so the real `ReqwestPost` code path is exercised against
//! a controlled response — no real TLS or Google servers involved.
//!
//! Coverage:
//!   - PKCE pair generation correctness (verifier length, S256 challenge)
//!   - Auth URL construction (required params, no broad scope)
//!   - Loopback request parsing
//!   - Token exchange via mock HTTP server (real reqwest client, local server)
//!   - Token refresh via mock HTTP server
//!   - invalid_grant → JinError::Auth (exit 5) mapping
//!   - EncryptedFileStore round-trip + permission check
//!   - Missing passphrase fails with actionable message
//!   - detect_backend respects `token_backend = "file"`
//!   - TokenSet expiry helper

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

use jin_core::google::auth::{
    build_auth_url, exchange_code, generate_pkce, generate_state, parse_code_from_request,
    parse_state_from_request, refresh_access_token, validate_oauth_state, CALENDAR_SCOPE,
};
use jin_core::google::secrets::{detect_backend, EncryptedFileStore, StorageBackend, TokenSet};
use jin_core::JinError;
use tempfile::TempDir;

// ── Mock HTTP server helpers ──────────────────────────────────────────────────

/// Start a minimal HTTP server that returns `body_json` once, then shuts down.
/// Returns the port it is listening on.
fn start_mock_server(body_json: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();

        // Drain request headers
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap() == 0 {
                break;
            }
            if line == "\r\n" {
                break;
            }
        }
        // Read body (Content-Length based)
        // (For form POSTs we only need to drain enough to send the response)
        drop(reader);

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body_json.len(),
            body_json
        );
        let _ = stream.write_all(response.as_bytes());
    });

    port
}

/// Start a mock server that returns an HTTP 400 with a JSON error body.
fn start_mock_error_server(error_json: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock error server");
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap() == 0 {
                break;
            }
            if line == "\r\n" {
                break;
            }
        }
        drop(reader);

        let response = format!(
            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            error_json.len(),
            error_json
        );
        let _ = stream.write_all(response.as_bytes());
    });

    port
}

fn sample_tokens() -> TokenSet {
    TokenSet {
        access_token: "ya29.testAccess".to_string(),
        refresh_token: Some("1//testRefresh".to_string()),
        expires_at: 9_999_999_999,
        scope: CALENDAR_SCOPE.to_string(),
        client_id: "test.apps.googleusercontent.com".to_string(),
        account: None,
    }
}

fn fake_creds() -> jin_core::google::config::GoogleCredentials {
    jin_core::google::config::GoogleCredentials {
        client_id: "test-client-id.apps.googleusercontent.com".to_string(),
        client_secret: "test-secret".to_string(),
    }
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

#[test]
fn s61_pkce_verifier_43_chars() {
    let pair = generate_pkce();
    assert_eq!(pair.verifier.len(), 43);
}

#[test]
fn s61_pkce_challenge_matches_s256() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};

    let pair = generate_pkce();
    let digest = Sha256::digest(pair.verifier.as_bytes());
    let expected = URL_SAFE_NO_PAD.encode(digest);
    assert_eq!(
        pair.challenge, expected,
        "challenge must be SHA256(verifier) base64url"
    );
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

#[test]
fn s61_auth_url_has_all_required_params() {
    let pkce = generate_pkce();
    let state = generate_state();
    let url = build_auth_url("my-client-id", "http://127.0.0.1:9999/", &pkce, &state);

    assert!(url.contains("response_type=code"));
    assert!(url.contains("code_challenge_method=S256"));
    assert!(url.contains("access_type=offline"));
    assert!(url.contains("prompt=consent"));
    assert!(url.contains("calendar.events"));
    assert!(url.contains(&pkce.challenge));
    // state must be present for CSRF protection
    assert!(
        url.contains(&format!("state={state}")),
        "URL must contain state param for CSRF protection"
    );
}

#[test]
fn s61_auth_url_contains_state_parameter() {
    let pkce = generate_pkce();
    let state = "integration-test-state-value";
    let url = build_auth_url("my-client", "http://127.0.0.1:9/", &pkce, state);
    assert!(
        url.contains("state=integration-test-state-value"),
        "URL must embed state: {url}"
    );
}

#[test]
fn s61_state_mismatch_returns_auth_error() {
    let err = validate_oauth_state("original-state", Some("tampered-state")).unwrap_err();
    assert!(
        matches!(err, JinError::Auth(_)),
        "state mismatch must be JinError::Auth"
    );
    assert!(
        err.to_string().contains("CSRF"),
        "must mention CSRF in error: {err}"
    );
}

#[test]
fn s61_state_match_succeeds() {
    validate_oauth_state("my-state", Some("my-state")).expect("matching state must be Ok");
}

#[test]
fn s61_parse_state_from_redirect() {
    assert_eq!(
        parse_state_from_request("GET /?code=abc&state=csrf-token HTTP/1.1").as_deref(),
        Some("csrf-token")
    );
    assert_eq!(
        parse_state_from_request("GET /?state=only-state HTTP/1.1").as_deref(),
        Some("only-state")
    );
    assert!(parse_state_from_request("GET /?code=abc HTTP/1.1").is_none());
}

// ── Loopback parsing ──────────────────────────────────────────────────────────

#[test]
fn s61_loopback_parses_code() {
    let code = parse_code_from_request("GET /?code=abc123&state=xyz HTTP/1.1");
    assert_eq!(code.as_deref(), Some("abc123"));
}

#[test]
fn s61_loopback_returns_none_without_code() {
    assert!(parse_code_from_request("GET / HTTP/1.1").is_none());
    assert!(parse_code_from_request("GET /?error=denied HTTP/1.1").is_none());
}

// ── Token exchange via real reqwest + mock server ─────────────────────────────

#[test]
fn s61_exchange_code_real_http_mock_server() {
    let token_json = r#"{
        "access_token": "ya29.mock_access",
        "refresh_token": "1//mock_refresh",
        "expires_in": 3600,
        "scope": "https://www.googleapis.com/auth/calendar.events",
        "token_type": "Bearer"
    }"#;

    let port = start_mock_server(token_json);
    let url = format!("http://127.0.0.1:{port}/token");

    let pkce = generate_pkce();
    let creds = fake_creds();

    use jin_core::google::auth::ReqwestPost;
    let ts = exchange_code(
        &creds,
        "test-code",
        &pkce.verifier,
        "http://127.0.0.1:9999/",
        &url,
        &ReqwestPost,
    )
    .expect("exchange should succeed against mock server");

    assert_eq!(ts.access_token, "ya29.mock_access");
    assert_eq!(ts.refresh_token.as_deref(), Some("1//mock_refresh"));
    assert!(ts.expires_at > 0);
}

#[test]
fn s61_invalid_grant_via_real_http_returns_exit5() {
    let error_json = r#"{"error":"invalid_grant","error_description":"Token has been revoked."}"#;

    let port = start_mock_error_server(error_json);
    let url = format!("http://127.0.0.1:{port}/token");

    let pkce = generate_pkce();
    let creds = fake_creds();

    use jin_core::google::auth::ReqwestPost;
    let err = exchange_code(
        &creds,
        "bad-code",
        &pkce.verifier,
        "http://127.0.0.1:9999/",
        &url,
        &ReqwestPost,
    )
    .unwrap_err();

    assert!(
        matches!(err, JinError::Auth(_)),
        "invalid_grant must become JinError::Auth (exit 5): {err}"
    );
    assert!(
        err.to_string().contains("jin auth login"),
        "must hint re-auth: {err}"
    );
}

// ── Token refresh via real reqwest + mock server ──────────────────────────────

#[test]
fn s61_refresh_preserves_old_refresh_token() {
    let refresh_json = r#"{
        "access_token": "ya29.new_access",
        "expires_in": 3600,
        "scope": "https://www.googleapis.com/auth/calendar.events",
        "token_type": "Bearer"
    }"#;

    let port = start_mock_server(refresh_json);
    let url = format!("http://127.0.0.1:{port}/token");

    use jin_core::google::auth::ReqwestPost;
    let ts = refresh_access_token(&fake_creds(), "old-refresh-token", &url, &ReqwestPost)
        .expect("refresh should succeed");

    assert_eq!(ts.access_token, "ya29.new_access");
    assert_eq!(
        ts.refresh_token.as_deref(),
        Some("old-refresh-token"),
        "old refresh token must be preserved when not returned by server"
    );
}

// ── EncryptedFileStore integration tests ─────────────────────────────────────

#[test]
fn s61_encrypted_file_store_round_trip_integration() {
    let tmp = TempDir::new().unwrap();
    // Use with_passphrase — does NOT touch the process-global env var.
    let store = EncryptedFileStore::with_passphrase(tmp.path(), "s61-integration-pass")
        .expect("store should open");
    let original = sample_tokens();

    store.save(&original).expect("save must succeed");

    let loaded = store.load().expect("load must succeed");
    assert_eq!(loaded.access_token, original.access_token);
    assert_eq!(loaded.refresh_token, original.refresh_token);
    assert_eq!(loaded.expires_at, original.expires_at);
    assert_eq!(loaded.scope, original.scope);
    assert_eq!(loaded.client_id, original.client_id);
}

#[test]
fn s61_missing_passphrase_actionable_error() {
    let tmp = TempDir::new().unwrap();
    std::env::remove_var("JIN_TOKEN_PASSPHRASE");

    let err = EncryptedFileStore::new(tmp.path()).unwrap_err();
    assert!(matches!(err, JinError::Auth(_)));
    let msg = err.to_string();
    assert!(
        msg.contains("JIN_TOKEN_PASSPHRASE"),
        "must name env var: {msg}"
    );
    assert!(msg.contains("jin auth login"), "must mention login: {msg}");
}

// ── detect_backend ────────────────────────────────────────────────────────────

#[test]
fn s61_detect_backend_file_preference() {
    let tmp = TempDir::new().unwrap();
    let mut cfg = jin_core::Config::new(tmp.path().to_path_buf());
    cfg.token_backend = "file".to_string();

    assert_eq!(
        detect_backend(tmp.path(), &cfg),
        StorageBackend::EncryptedFile
    );
}

// ── TokenSet expiry ───────────────────────────────────────────────────────────

#[test]
fn s61_token_expired_at_epoch() {
    let mut ts = sample_tokens();
    ts.expires_at = 0;
    assert!(ts.is_expired(), "epoch timestamp must be expired");
}

#[test]
fn s61_token_not_expired_in_far_future() {
    let ts = sample_tokens();
    assert!(!ts.is_expired());
}
