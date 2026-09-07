//! Google OAuth 2.0 desktop-app flow with PKCE (RFC 7636) + loopback redirect.
//!
//! # Flow
//! 1. `generate_pkce()` — random code_verifier; code_challenge = BASE64URL(SHA256(verifier))
//! 2. `build_auth_url()` — construct consent-screen URL with PKCE params
//! 3. `run_loopback_server()` — bind 127.0.0.1:0, wait for `?code=…` redirect
//! 4. `exchange_code()` — POST verifier+code to Google token endpoint
//! 5. `refresh_access_token()` — POST refresh_token when access token expires
//!
//! The `HttpPost` trait is injected so tests can use a local mock server without
//! a real network connection.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

use super::config::GoogleCredentials;
use super::secrets::TokenSet;
use crate::google::account::GoogleAccountId;
use crate::JinError;

// ── Constants ────────────────────────────────────────────────────────────────

pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// Calendar events scope — narrowest sufficient for bidirectional event sync.
pub const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
pub const ACCOUNT_CALENDAR_SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

// ── HTTP abstraction (injectable for offline testing) ────────────────────────

/// Minimal synchronous HTTP POST abstraction.
/// The real implementation uses `reqwest` (blocking + rustls); tests inject a local
/// mock server or a stub that returns pre-canned JSON without a real network.
pub trait HttpPost: Send + Sync {
    /// POST URL-encoded form data to `url`; return the parsed JSON body.
    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value>;
}

/// Production implementation: `reqwest` blocking client with rustls TLS.
pub struct ReqwestPost;

impl HttpPost for ReqwestPost {
    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value> {
        let client = reqwest::blocking::Client::builder()
            .build()
            .map_err(|e| JinError::Auth(format!("HTTP client init: {e}")))?;

        let resp = client
            .post(url)
            .form(params)
            .send()
            .map_err(|e| JinError::Auth(format!("HTTP POST to {url}: {e}")))?;

        // Google's OAuth token endpoint always returns a JSON body even on 4xx errors.
        // Return the JSON unconditionally; callers use parse_token_response to detect
        // error fields (including `invalid_grant`) and map them to JinError::Auth.
        resp.json::<serde_json::Value>()
            .map_err(|e| JinError::Auth(format!("JSON parse from {url}: {e}")))
    }
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

/// A PKCE (RFC 7636) code_verifier + S256 code_challenge pair.
#[derive(Debug, Clone)]
pub struct PkcePair {
    /// High-entropy random string; sent during token exchange.
    pub verifier: String,
    /// BASE64URL(SHA-256(verifier)); sent in the authorization URL.
    pub challenge: String,
}

/// Generate a fresh PKCE pair using the S256 challenge method.
///
/// * code_verifier: 32 random bytes → base64url (no padding) → 43-char string.
/// * code_challenge: SHA-256(verifier_bytes as ASCII) → base64url (no padding).
pub fn generate_pkce() -> PkcePair {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);

    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);

    PkcePair {
        verifier,
        challenge,
    }
}

// ── OAuth state (CSRF defense-in-depth) ──────────────────────────────────────

/// Generate a random OAuth `state` parameter for CSRF protection.
///
/// Uses the same CSPRNG as PKCE: 32 random bytes → base64url (no padding).
pub fn generate_state() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Bind OAuth state to the immutable account being authorized.
pub fn generate_account_state(account_id: &GoogleAccountId) -> String {
    format!("{}.{}", account_id.as_str(), generate_state())
}

pub fn validate_account_state(
    account_id: &GoogleAccountId,
    expected: &str,
    returned: Option<&str>,
) -> crate::Result<()> {
    let prefix = format!("{}.", account_id.as_str());
    if !expected.starts_with(&prefix) || returned != Some(expected) {
        return Err(JinError::Auth(
            "OAuth callback state does not match the requested Google account".to_string(),
        ));
    }
    Ok(())
}

/// Parse the OAuth `state` parameter from the first line of an HTTP GET request.
///
/// Returns `None` if no `state` parameter is present or the value is empty.
pub fn parse_state_from_request(request_line: &str) -> Option<String> {
    let mut parts = request_line.split_whitespace();
    parts.next()?; // skip verb (GET)
    let path = parts.next()?;
    let query = path.split_once('?')?.1;
    for kv in query.split('&') {
        if let Some(val) = kv.strip_prefix("state=") {
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Validate the CSRF `state` parameter returned in the OAuth redirect.
///
/// Returns `JinError::Auth` if `returned` does not match `expected`
/// (possible cross-site request forgery attack).
pub fn validate_oauth_state(expected: &str, returned: Option<&str>) -> crate::Result<()> {
    if returned == Some(expected) {
        Ok(())
    } else {
        Err(JinError::Auth(
            "OAuth state mismatch — possible CSRF, aborting".to_string(),
        ))
    }
}

// ── Authorization URL ─────────────────────────────────────────────────────────

/// Build the Google consent-screen URL.  The user (or the test) navigates to this URL.
///
/// `state` is a CSRF-protection token generated by the caller via `generate_state()`.
pub fn build_auth_url(client_id: &str, redirect_uri: &str, pkce: &PkcePair, state: &str) -> String {
    build_auth_url_with_scopes(client_id, redirect_uri, pkce, state, CALENDAR_SCOPE)
}

pub fn build_account_auth_url(
    client_id: &str,
    redirect_uri: &str,
    pkce: &PkcePair,
    state: &str,
) -> String {
    build_auth_url_with_scopes(
        client_id,
        redirect_uri,
        pkce,
        state,
        ACCOUNT_CALENDAR_SCOPES,
    )
}

fn build_auth_url_with_scopes(
    client_id: &str,
    redirect_uri: &str,
    pkce: &PkcePair,
    state: &str,
    scopes: &str,
) -> String {
    let params: &[(&str, &str)] = &[
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", scopes),
        ("code_challenge", &pkce.challenge),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("state", state),
    ];

    let qs: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{GOOGLE_AUTH_URL}?{qs}")
}

/// Minimal percent-encoding for URL query parameters.
/// Encodes everything except unreserved chars (RFC 3986 §2.3).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{byte:02X}"));
            }
        }
    }
    out
}

// ── Loopback redirect server ──────────────────────────────────────────────────

/// Parse the OAuth `code` parameter from the first line of an HTTP GET request.
///
/// Handles both:
///   `GET /?code=abc123 HTTP/1.1`
///   `GET /?code=abc123&state=... HTTP/1.1`
///
/// Returns `None` if the request line is malformed or has no `code`.
pub fn parse_code_from_request(request_line: &str) -> Option<String> {
    // Extract the path+query part: "GET /path?query HTTP/1.1" → "/path?query"
    let mut parts = request_line.split_whitespace();
    parts.next()?; // skip verb (GET)
    let path = parts.next()?;

    // Find query string
    let query = path.split_once('?')?.1;

    // Find the `code` parameter
    for kv in query.split('&') {
        if let Some(val) = kv.strip_prefix("code=") {
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Bind a loopback TCP listener on an ephemeral port.
/// Returns `(port, listener)` so callers can embed the port in the redirect_uri
/// before waiting for the callback.
pub fn bind_loopback() -> crate::Result<(u16, std::net::TcpListener)> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| JinError::Auth(format!("bind loopback listener: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| JinError::Auth(format!("get loopback port: {e}")))?
        .port();
    Ok((port, listener))
}

/// Accept one HTTP connection on `listener`, extract `?code=…` and `?state=…`,
/// respond with a minimal HTML success page (so the user's browser shows a clear
/// message), then return `(code, state_opt)`.
///
/// Blocks until a browser connects (the user clicks "Allow" in the consent screen).
/// Ctrl-C or process termination aborts the wait.
///
/// The caller is responsible for validating `state_opt` against the expected state
/// using `validate_oauth_state`.
pub fn wait_for_code(listener: std::net::TcpListener) -> crate::Result<(String, Option<String>)> {
    use std::io::{BufRead, BufReader, Write};

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| JinError::Auth(format!("loopback accept: {e}")))?;

    let mut reader = BufReader::new(&stream);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|e| JinError::Auth(format!("read loopback request: {e}")))?;

    // Drain remaining headers (required before responding)
    let mut line = String::new();
    loop {
        line.clear();
        reader
            .read_line(&mut line)
            .map_err(|e| JinError::Auth(format!("read loopback headers: {e}")))?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
    }

    let code = parse_code_from_request(&first_line).ok_or_else(|| {
        JinError::Auth(format!(
            "OAuth redirect did not contain a code. Raw request line: {:?}",
            first_line.trim()
        ))
    })?;

    let state = parse_state_from_request(&first_line);

    // Send success response to the browser
    let body = "<html><body><h1>Jin — Authentication successful!</h1>\
                <p>You can close this tab and return to the terminal.</p>\
                </body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    Ok((code, state))
}

// ── Token exchange ────────────────────────────────────────────────────────────

/// Exchange an authorization code for an access + refresh token pair.
///
/// `token_url` is normally `GOOGLE_TOKEN_URL`; pass a local mock URL in tests.
pub fn exchange_code(
    creds: &GoogleCredentials,
    code: &str,
    pkce_verifier: &str,
    redirect_uri: &str,
    token_url: &str,
    http: &dyn HttpPost,
) -> crate::Result<TokenSet> {
    let params = [
        ("code", code),
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", pkce_verifier),
    ];

    let json = http.post_form(token_url, &params)?;
    parse_token_response(json, &creds.client_id)
}

/// Refresh the access token using the stored refresh token.
///
/// Returns `JinError::Auth` (exit 5) on `invalid_grant` (revoked / expired refresh token)
/// so the caller can surface a re-auth instruction.
pub fn refresh_access_token(
    creds: &GoogleCredentials,
    refresh_token: &str,
    token_url: &str,
    http: &dyn HttpPost,
) -> crate::Result<TokenSet> {
    let params = [
        ("refresh_token", refresh_token),
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("grant_type", "refresh_token"),
    ];

    let json = http.post_form(token_url, &params)?;

    // The refresh response may not include a new refresh_token; preserve the old one.
    let mut ts = parse_token_response(json, &creds.client_id)?;
    if ts.refresh_token.is_none() {
        ts.refresh_token = Some(refresh_token.to_string());
    }
    Ok(ts)
}

// ── Full auth flow (non-interactive core) ────────────────────────────────────

/// Run the complete PKCE + loopback authorization flow.
///
/// 1. Generates a PKCE pair.
/// 2. Binds the loopback listener (ephemeral port).
/// 3. Builds the authorization URL and **prints it** (and opens it on platforms
///    that support `xdg-open` / `open` — falls back to print-only).
/// 4. Waits for the browser redirect.
/// 5. Exchanges the code for tokens.
///
/// The caller (CLI) is responsible for printing the wizard guidance text
/// *before* calling this function.
pub fn run_auth_flow(creds: &GoogleCredentials) -> crate::Result<TokenSet> {
    let pkce = generate_pkce();
    let state = generate_state();
    let (port, listener) = bind_loopback()?;
    let redirect_uri = format!("http://127.0.0.1:{port}/");

    let auth_url = build_auth_url(&creds.client_id, &redirect_uri, &pkce, &state);

    println!("\nOpening the Google authorization URL in your browser...");
    println!("If it does not open automatically, copy-paste this URL:\n");
    println!("  {auth_url}\n");

    // Best-effort: try to open the browser; ignore errors.
    open_browser(&auth_url);

    println!("Waiting for authorization... (press Ctrl-C to cancel)\n");

    let (code, returned_state) = wait_for_code(listener)?;

    // CSRF defense: reject if the state parameter is missing or doesn't match.
    validate_oauth_state(&state, returned_state.as_deref())?;

    println!("Authorization received. Exchanging code for tokens...\n");

    exchange_code(
        creds,
        &code,
        &pkce.verifier,
        &redirect_uri,
        GOOGLE_TOKEN_URL,
        &ReqwestPost,
    )
}

/// Run OAuth for one immutable account slot and validate its stable Google
/// subject before callers replace credentials.
pub fn run_account_auth_flow(
    creds: &GoogleCredentials,
    account_id: &GoogleAccountId,
) -> crate::Result<(TokenSet, String, String)> {
    let pkce = generate_pkce();
    let state = generate_account_state(account_id);
    let (port, listener) = bind_loopback()?;
    let redirect_uri = format!("http://127.0.0.1:{port}/");
    let auth_url = build_account_auth_url(&creds.client_id, &redirect_uri, &pkce, &state);

    println!("\nOpening Google authorization for account {account_id}...");
    println!("If it does not open automatically, copy-paste this URL:\n\n  {auth_url}\n");
    open_browser(&auth_url);
    let (code, returned_state) = wait_for_code(listener)?;
    validate_account_state(account_id, &state, returned_state.as_deref())?;
    let mut tokens = exchange_code(
        creds,
        &code,
        &pkce.verifier,
        &redirect_uri,
        GOOGLE_TOKEN_URL,
        &ReqwestPost,
    )?;
    let (subject, email) = fetch_google_identity(&tokens.access_token)?;
    tokens.account = Some(email.clone());
    Ok((tokens, subject, email))
}

fn fetch_google_identity(access_token: &str) -> crate::Result<(String, String)> {
    let response = reqwest::blocking::Client::new()
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .map_err(|error| JinError::Offline(format!("Google userinfo request failed: {error}")))?;
    if !response.status().is_success() {
        return Err(JinError::Auth(format!(
            "Google userinfo rejected credentials with HTTP {}",
            response.status()
        )));
    }
    let body: serde_json::Value = response
        .json()
        .map_err(|error| JinError::Auth(format!("invalid Google userinfo response: {error}")))?;
    let subject = body
        .get("sub")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| JinError::Auth("Google userinfo response missing subject".to_string()))?;
    let email = body
        .get("email")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| JinError::Auth("Google userinfo response missing email".to_string()))?;
    Ok((subject.to_string(), email.to_string()))
}

/// Attempt to open `url` in the default browser.  Silently swallows errors.
fn open_browser(url: &str) {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/c", "start", url])
        .spawn();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Parse the Google token endpoint JSON response into a `TokenSet`.
/// Detects `invalid_grant` and other error codes and maps them to `JinError::Auth`.
fn parse_token_response(json: serde_json::Value, client_id: &str) -> crate::Result<TokenSet> {
    // Check for error field (HTTP 200 is returned even for some grant errors in some flows)
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let hint = if err == "invalid_grant" {
            " The refresh token has expired or been revoked. \
             Run 'jin auth login' to re-authenticate."
        } else {
            " Run 'jin auth login' to re-authenticate."
        };

        return Err(JinError::Auth(format!(
            "token endpoint error: {err} — {desc}{hint}"
        )));
    }

    let access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JinError::Auth("token response missing access_token".to_string()))?
        .to_string();

    let refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3600);

    let expires_at = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        now + expires_in
    };

    let scope = json
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or(CALENDAR_SCOPE)
        .to_string();

    Ok(TokenSet {
        access_token,
        refresh_token,
        expires_at,
        scope,
        client_id: client_id.to_string(),
        account: None,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Used in the loopback server round-trip test (test thread reads from TcpStream).
#[cfg(test)]
use std::io::Read;

#[cfg(test)]
mod tests {
    use super::*;

    // ── PKCE ─────────────────────────────────────────────────────────────────

    #[test]
    fn pkce_verifier_is_43_chars_base64url() {
        // 32 random bytes → base64url no-padding = ceil(32*4/3) = 43 chars
        let pair = generate_pkce();
        assert_eq!(
            pair.verifier.len(),
            43,
            "verifier must be 43 chars (32 bytes base64url-no-pad)"
        );
        // Only base64url characters allowed (RFC 7636 §4.1)
        assert!(
            pair.verifier
                .chars()
                .all(|c| c.is_alphanumeric() || c == '-' || c == '_'),
            "verifier must only contain base64url chars: {:?}",
            pair.verifier
        );
    }

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let pair = generate_pkce();
        // Recompute: BASE64URL(SHA256(verifier_bytes))
        let digest = Sha256::digest(pair.verifier.as_bytes());
        let expected = URL_SAFE_NO_PAD.encode(digest);
        assert_eq!(
            pair.challenge, expected,
            "challenge must be BASE64URL(SHA256(verifier))"
        );
    }

    #[test]
    fn pkce_pairs_are_unique() {
        let a = generate_pkce();
        let b = generate_pkce();
        assert_ne!(a.verifier, b.verifier, "each PKCE pair must be random");
        assert_ne!(a.challenge, b.challenge);
    }

    // ── Auth URL ──────────────────────────────────────────────────────────────

    #[test]
    fn auth_url_contains_required_params() {
        let pkce = generate_pkce();
        let url = build_auth_url(
            "test-client.apps.googleusercontent.com",
            "http://127.0.0.1:12345/",
            &pkce,
            "test-state-abc",
        );

        assert!(
            url.starts_with(GOOGLE_AUTH_URL),
            "URL must start with auth endpoint"
        );
        assert!(url.contains("response_type=code"), "must request code");
        assert!(url.contains("code_challenge_method=S256"), "must use S256");
        assert!(
            url.contains("access_type=offline"),
            "must request offline access (refresh token)"
        );
        assert!(
            url.contains("prompt=consent"),
            "must prompt consent (forces refresh token issuance)"
        );
        // Scope must include calendar.events
        assert!(
            url.contains("calendar.events"),
            "must request calendar.events scope"
        );
        // Challenge must be in the URL
        assert!(
            url.contains(&pkce.challenge),
            "challenge must be embedded in URL"
        );
        // State must be in the URL (CSRF protection)
        assert!(url.contains("state=test-state-abc"), "state must be in URL");
    }

    #[test]
    fn auth_url_does_not_contain_broad_calendar_scope() {
        let pkce = generate_pkce();
        let url = build_auth_url("id", "http://127.0.0.1:1/", &pkce, "s");
        // Must NOT request the broad "calendar" scope (only "calendar.events")
        // Check: scope param must not contain "/auth/calendar" without ".events"
        assert!(
            !url.contains("%2Fauth%2Fcalendar&") && !url.contains("/auth/calendar&"),
            "must NOT request broad calendar scope, only calendar.events"
        );
    }

    // ── Loopback request parsing ──────────────────────────────────────────────

    #[test]
    fn parse_code_from_simple_redirect() {
        let req = "GET /?code=4%2F0abc123XYZ HTTP/1.1";
        let code = parse_code_from_request(req);
        assert_eq!(code.as_deref(), Some("4%2F0abc123XYZ"));
    }

    #[test]
    fn parse_code_with_extra_params() {
        let req = "GET /?state=xyz&code=mycode&scope=calendar HTTP/1.1";
        let code = parse_code_from_request(req);
        assert_eq!(code.as_deref(), Some("mycode"));
    }

    #[test]
    fn parse_code_returns_none_for_error_redirect() {
        let req = "GET /?error=access_denied HTTP/1.1";
        assert_eq!(parse_code_from_request(req), None);
    }

    #[test]
    fn parse_code_returns_none_for_empty_request() {
        assert_eq!(parse_code_from_request(""), None);
        assert_eq!(parse_code_from_request("GET / HTTP/1.1"), None);
    }

    // ── Loopback server round-trip ────────────────────────────────────────────

    #[test]
    fn loopback_server_captures_code_and_state_from_simulated_browser() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::thread;

        let (port, listener) = bind_loopback().expect("bind loopback");
        let expected_state = "test-state-csrf-token";

        // Simulate a browser sending a redirect request (with state) in a background thread
        let handle = thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(20));
            let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
            let req = "GET /?code=test_auth_code_12345&state=test-state-csrf-token&scope=calendar HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
            stream.write_all(req.as_bytes()).unwrap();
            let mut buf = [0u8; 512];
            let _ = stream.read(&mut buf);
        });

        let (code, state_opt) = wait_for_code(listener).expect("should capture code + state");
        handle.join().unwrap();

        assert_eq!(code, "test_auth_code_12345");
        // State must be captured and match
        assert_eq!(state_opt.as_deref(), Some("test-state-csrf-token"));
        // validate_oauth_state must pass for matching state
        validate_oauth_state(expected_state, state_opt.as_deref())
            .expect("matching state must pass validation");
    }

    // ── OAuth state CSRF defense ──────────────────────────────────────────────

    #[test]
    fn build_auth_url_contains_state_param() {
        let pkce = generate_pkce();
        let state = generate_state();
        let url = build_auth_url("my-client", "http://127.0.0.1:9/", &pkce, &state);
        assert!(
            url.contains(&format!("state={state}")),
            "URL must include state= for CSRF protection"
        );
    }

    #[test]
    fn validate_oauth_state_mismatch_returns_csrf_error() {
        let err =
            validate_oauth_state("expected-state-abc", Some("different-state-xyz")).unwrap_err();
        assert!(
            matches!(err, crate::JinError::Auth(_)),
            "state mismatch must be JinError::Auth"
        );
        assert!(
            err.to_string().contains("CSRF"),
            "error message must mention CSRF: {err}"
        );
    }

    #[test]
    fn validate_oauth_state_missing_returns_csrf_error() {
        let err = validate_oauth_state("expected-state", None).unwrap_err();
        assert!(matches!(err, crate::JinError::Auth(_)));
        assert!(err.to_string().contains("CSRF"), "must mention CSRF: {err}");
    }

    #[test]
    fn validate_oauth_state_match_succeeds() {
        validate_oauth_state("my-state-token", Some("my-state-token"))
            .expect("matching state must succeed");
    }

    #[test]
    fn parse_state_from_redirect_request() {
        let code = parse_state_from_request("GET /?code=abc&state=csrf42 HTTP/1.1");
        assert_eq!(code.as_deref(), Some("csrf42"));
    }

    #[test]
    fn parse_state_returns_none_without_state_param() {
        assert!(parse_state_from_request("GET /?code=abc HTTP/1.1").is_none());
        assert!(parse_state_from_request("GET / HTTP/1.1").is_none());
    }

    // ── Token exchange with mock HTTP ─────────────────────────────────────────

    struct MockHttp {
        response: serde_json::Value,
    }

    impl HttpPost for MockHttp {
        fn post_form(
            &self,
            _url: &str,
            _params: &[(&str, &str)],
        ) -> crate::Result<serde_json::Value> {
            Ok(self.response.clone())
        }
    }

    fn fake_creds() -> GoogleCredentials {
        GoogleCredentials {
            client_id: "test-client-id.apps.googleusercontent.com".to_string(),
            client_secret: "test-secret".to_string(),
        }
    }

    fn token_response_json() -> serde_json::Value {
        serde_json::json!({
            "access_token": "ya29.testAccessToken",
            "refresh_token": "1//testRefreshToken",
            "expires_in": 3600,
            "scope": "https://www.googleapis.com/auth/calendar.events",
            "token_type": "Bearer"
        })
    }

    #[test]
    fn exchange_code_parses_token_response() {
        let http = MockHttp {
            response: token_response_json(),
        };
        let pkce = generate_pkce();
        let ts = exchange_code(
            &fake_creds(),
            "test-auth-code",
            &pkce.verifier,
            "http://127.0.0.1:12345/",
            "http://mock-token-endpoint/",
            &http,
        )
        .expect("exchange should succeed");

        assert_eq!(ts.access_token, "ya29.testAccessToken");
        assert_eq!(ts.refresh_token.as_deref(), Some("1//testRefreshToken"));
        assert!(ts.expires_at > 0, "expires_at must be a future timestamp");
        assert!(
            ts.scope.contains("calendar.events"),
            "scope must include calendar.events"
        );
        assert_eq!(ts.client_id, "test-client-id.apps.googleusercontent.com");
    }

    #[test]
    fn exchange_code_maps_invalid_grant_to_auth_error() {
        let http = MockHttp {
            response: serde_json::json!({
                "error": "invalid_grant",
                "error_description": "Token has been expired or revoked."
            }),
        };
        let pkce = generate_pkce();
        let err = exchange_code(
            &fake_creds(),
            "bad-code",
            &pkce.verifier,
            "http://127.0.0.1:12345/",
            "http://mock-token-endpoint/",
            &http,
        )
        .unwrap_err();

        assert!(
            matches!(err, crate::JinError::Auth(_)),
            "invalid_grant must become JinError::Auth"
        );
        let msg = err.to_string();
        assert!(
            msg.contains("jin auth login"),
            "error must mention 'jin auth login': {msg}"
        );
    }

    #[test]
    fn refresh_preserves_refresh_token_when_not_returned() {
        // Google's token endpoint may omit refresh_token on refresh responses
        let http = MockHttp {
            response: serde_json::json!({
                "access_token": "ya29.newAccessToken",
                "expires_in": 3600,
                "scope": "https://www.googleapis.com/auth/calendar.events",
                "token_type": "Bearer"
                // No refresh_token in refresh response
            }),
        };

        let ts = refresh_access_token(
            &fake_creds(),
            "existing-refresh-token",
            "http://mock-token-endpoint/",
            &http,
        )
        .expect("refresh should succeed");

        assert_eq!(ts.access_token, "ya29.newAccessToken");
        assert_eq!(
            ts.refresh_token.as_deref(),
            Some("existing-refresh-token"),
            "original refresh token must be preserved when not returned by server"
        );
    }

    #[test]
    fn refresh_invalid_grant_returns_auth_error_with_reauth_hint() {
        let http = MockHttp {
            response: serde_json::json!({
                "error": "invalid_grant",
                "error_description": "Token has been expired or revoked."
            }),
        };

        let err = refresh_access_token(
            &fake_creds(),
            "expired-refresh-token",
            "http://mock-token-endpoint/",
            &http,
        )
        .unwrap_err();

        assert!(matches!(err, crate::JinError::Auth(_)));
        let msg = err.to_string();
        // Must include the re-auth instruction
        assert!(
            msg.contains("jin auth login"),
            "must mention 'jin auth login': {msg}"
        );
    }
}
