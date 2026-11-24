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
use std::sync::atomic::{AtomicU8, Ordering};

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
const LOOPBACK_AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);
const LOOPBACK_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(20);
const MAX_LOOPBACK_HEADERS: usize = 16 * 1024;

/// One native-owned Google browser authorization attempt.
///
/// `cancel` may win only while the browser result is still non-durable. Once
/// `claim_completion` succeeds, the caller owns an atomic commit boundary.
pub struct GoogleAuthAttempt {
    state: AtomicU8,
}

impl GoogleAuthAttempt {
    pub fn new() -> Self {
        Self {
            state: AtomicU8::new(0),
        }
    }

    pub fn cancel(&self) -> bool {
        self.state
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn ensure_active(&self) -> crate::Result<()> {
        if self.state.load(Ordering::Acquire) == 1 {
            Err(cancelled_error())
        } else {
            Ok(())
        }
    }

    pub fn claim_completion(&self) -> crate::Result<()> {
        match self
            .state
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
        {
            Ok(_) => Ok(()),
            Err(1) => Err(cancelled_error()),
            Err(_) => Err(JinError::Integrity(
                "Google sign-in attempt entered an invalid completion state".to_string(),
            )),
        }
    }
}

impl Default for GoogleAuthAttempt {
    fn default() -> Self {
        Self::new()
    }
}

fn cancelled_error() -> JinError {
    JinError::Auth(
        "Google sign-in was cancelled. You can connect an account again whenever you are ready."
            .to_string(),
    )
}

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
    parse_oauth_query_value(request_line, "state")
}

/// Parse one OAuth query parameter from the loopback HTTP request line.
///
/// `Url::query_pairs` applies application/x-www-form-urlencoded decoding once,
/// so authorization codes such as `4%2Fexample%2Bvalue` reach the token endpoint
/// as the opaque value Google issued.
fn parse_oauth_query_value(request_line: &str, name: &str) -> Option<String> {
    let target = request_line.split_whitespace().nth(1)?;
    let url = reqwest::Url::parse("http://127.0.0.1")
        .ok()?
        .join(target)
        .ok()?;
    url.query_pairs()
        .find_map(|(key, value)| (key == name && !value.is_empty()).then(|| value.into_owned()))
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
    parse_oauth_query_value(request_line, "code")
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
/// Waits until a browser connects (the user clicks "Allow" in the consent screen).
/// The production flow bounds the wait so a closed consent tab cannot leave Jin
/// waiting forever.
///
/// The caller is responsible for validating `state_opt` against the expected state
/// using `validate_oauth_state`.
pub fn wait_for_code(listener: std::net::TcpListener) -> crate::Result<(String, Option<String>)> {
    wait_for_code_with_timeout(listener, LOOPBACK_AUTH_TIMEOUT)
}

fn wait_for_code_with_timeout(
    listener: std::net::TcpListener,
    timeout: std::time::Duration,
) -> crate::Result<(String, Option<String>)> {
    wait_for_code_with_timeout_and_cancel(listener, timeout, &GoogleAuthAttempt::new())
}

fn wait_for_code_with_timeout_and_cancel(
    listener: std::net::TcpListener,
    timeout: std::time::Duration,
    attempt: &GoogleAuthAttempt,
) -> crate::Result<(String, Option<String>)> {
    use std::io::Read;
    use std::time::Instant;

    let deadline = Instant::now() + timeout;
    listener
        .set_nonblocking(true)
        .map_err(|e| JinError::Auth(format!("configure loopback listener: {e}")))?;
    let (mut stream, _) = loop {
        attempt.ensure_active()?;
        match listener.accept() {
            Ok(connection) => break connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(JinError::Auth(
                        "Google authorization timed out. Return to Jin and try Connect Google Calendar again."
                            .to_string(),
                    ));
                }
                std::thread::sleep(LOOPBACK_POLL_INTERVAL);
            }
            Err(error) => return Err(JinError::Auth(format!("loopback accept: {error}"))),
        }
    };
    let mut headers = Vec::new();
    let mut chunk = [0_u8; 1024];
    while !headers_complete(&headers) {
        attempt.ensure_active()?;
        if headers.len() >= MAX_LOOPBACK_HEADERS {
            write_loopback_response(
                &mut stream,
                "431 Request Header Fields Too Large",
                "Jin could not read the authorization response. Return to Jin and try again.",
            );
            return Err(JinError::Auth(
                "Google authorization response headers were too large".to_string(),
            ));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(loopback_timeout());
        }
        stream
            .set_read_timeout(Some(remaining.min(LOOPBACK_POLL_INTERVAL)))
            .map_err(|e| JinError::Auth(format!("configure loopback read timeout: {e}")))?;
        let read = match stream.read(&mut chunk) {
            Ok(read) => read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                continue
            }
            Err(error) => return Err(loopback_read_error(error)),
        };
        if read == 0 {
            return Err(JinError::Auth(
                "Google authorization response ended before it was complete. Return to Jin and try again."
                    .to_string(),
            ));
        }
        headers.extend_from_slice(&chunk[..read]);
    }
    let first_line = std::str::from_utf8(&headers)
        .ok()
        .and_then(|headers| headers.lines().next())
        .ok_or_else(|| {
            JinError::Auth("Google authorization response was not valid HTTP".to_string())
        })?;

    let code = parse_code_from_request(first_line).ok_or_else(|| {
        let detail = oauth_redirect_error(first_line);
        write_loopback_response(
            &mut stream,
            "400 Bad Request",
            "Google authorization was not completed. Return to Jin to try again.",
        );
        JinError::Auth(format!(
            "Google authorization was not completed: {detail}. Return to Jin and try again."
        ))
    })?;

    let state = parse_state_from_request(first_line);

    // State validation and token exchange still run after this callback, so do
    // not claim that sign-in has completed in the browser yet.
    let body = "<html><body><h1>Jin received your authorization response.</h1>\
                <p>You can close this tab and return to Jin to finish connecting.</p>\
                </body></html>";
    write_loopback_response(&mut stream, "200 OK", body);

    Ok((code, state))
}

fn headers_complete(headers: &[u8]) -> bool {
    headers.windows(4).any(|window| window == b"\r\n\r\n")
        || headers.windows(2).any(|window| window == b"\n\n")
}

fn write_loopback_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{body}",
        body.len(),
    );
    let _ = stream.write_all(response.as_bytes());
}

fn loopback_timeout() -> JinError {
    JinError::Auth(
        "Google authorization timed out before the browser completed its response. Return to Jin and try again."
            .to_string(),
    )
}

fn loopback_read_error(error: std::io::Error) -> JinError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        loopback_timeout()
    } else {
        JinError::Auth(format!("read loopback request: {error}"))
    }
}

fn oauth_redirect_error(request_line: &str) -> &'static str {
    match parse_oauth_query_value(request_line, "error").as_deref() {
        Some("access_denied") => "Google sign-in was cancelled",
        Some(_) => "Google returned an authorization error",
        None => "missing authorization code",
    }
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

    // The URL above remains a manual fallback when the platform browser cannot
    // be launched from this process.
    if let Err(error) = open_browser(&auth_url) {
        eprintln!("Could not open the browser automatically: {error}");
    }

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
    run_account_auth_flow_cancellable(creds, account_id, &GoogleAuthAttempt::new())
}

/// Run account authorization while checking a native cancellation flag between
/// loopback polls and before every durable OAuth result is returned.
pub fn run_account_auth_flow_cancellable(
    creds: &GoogleCredentials,
    account_id: &GoogleAccountId,
    attempt: &GoogleAuthAttempt,
) -> crate::Result<(TokenSet, String, String)> {
    let pkce = generate_pkce();
    let state = generate_account_state(account_id);
    let (port, listener) = bind_loopback()?;
    let redirect_uri = format!("http://127.0.0.1:{port}/");
    let auth_url = build_account_auth_url(&creds.client_id, &redirect_uri, &pkce, &state);

    println!("\nOpening Google authorization for account {account_id} in your default browser...");
    open_browser(&auth_url).map_err(|error| {
        JinError::Auth(format!(
            "Could not open the default browser for Google authorization: {error}. \
             Check the system browser configuration, then try Connect Google Calendar again."
        ))
    })?;
    let (code, returned_state) =
        wait_for_code_with_timeout_and_cancel(listener, LOOPBACK_AUTH_TIMEOUT, attempt)?;
    validate_account_state(account_id, &state, returned_state.as_deref())?;
    attempt.ensure_active()?;
    let mut tokens = exchange_code(
        creds,
        &code,
        &pkce.verifier,
        &redirect_uri,
        GOOGLE_TOKEN_URL,
        &ReqwestPost,
    )?;
    let (subject, email) = fetch_google_identity(&tokens.access_token)?;
    attempt.ensure_active()?;
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

/// Attempt to open `url` in the default browser.
///
/// Callers that provide a printed URL can retain a manual fallback. Interactive
/// desktop callers surface the launch failure instead of waiting for a callback
/// that cannot arrive.
fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn()?;
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn()?;
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()?;
    Ok(())
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
        assert_eq!(code.as_deref(), Some("4/0abc123XYZ"));
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

    #[test]
    fn loopback_server_times_out_without_a_browser_callback() {
        let (_, listener) = bind_loopback().expect("bind loopback");
        let error = wait_for_code_with_timeout(listener, std::time::Duration::from_millis(25))
            .expect_err("a missing callback must time out");
        assert!(matches!(error, crate::JinError::Auth(_)));
        assert!(error.to_string().contains("timed out"), "{error}");
    }

    #[test]
    fn cancelled_loopback_wait_returns_before_a_callback_can_be_accepted() {
        let attempt = GoogleAuthAttempt::new();
        assert!(attempt.cancel());
        let error = attempt
            .ensure_active()
            .expect_err("a cancelled browser attempt must stop waiting");

        assert!(error.to_string().contains("cancelled"));
    }

    #[test]
    fn cancellation_interrupts_a_partially_sent_loopback_response() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::sync::Arc;
        use std::thread;

        let (port, listener) = bind_loopback().expect("bind loopback");
        let attempt = Arc::new(GoogleAuthAttempt::new());
        let browser_attempt = Arc::clone(&attempt);
        let handle = thread::spawn(move || {
            let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
            stream
                .write_all(b"GET /?code=partial&state=state HTTP/1.1\r\n")
                .unwrap();
            thread::sleep(std::time::Duration::from_millis(30));
            assert!(browser_attempt.cancel());
        });

        let error = wait_for_code_with_timeout_and_cancel(
            listener,
            std::time::Duration::from_secs(1),
            &attempt,
        )
        .expect_err("cancelling a partial response must stop the wait");
        handle.join().unwrap();
        assert!(error.to_string().contains("cancelled"));
    }

    #[test]
    fn loopback_server_reports_google_denial_without_raw_request_data() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::thread;

        let (port, listener) = bind_loopback().expect("bind loopback");
        let handle = thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(10));
            let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
            stream
                .write_all(b"GET /?error=access_denied HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                .unwrap();
        });

        let error = wait_for_code_with_timeout(listener, std::time::Duration::from_secs(1))
            .expect_err("a denied consent callback must fail");
        handle.join().unwrap();
        assert!(
            error.to_string().contains("sign-in was cancelled"),
            "{error}"
        );
        assert!(!error.to_string().contains("access_denied"), "{error}");
        assert!(!error.to_string().contains("GET /"), "{error}");
    }

    #[test]
    fn loopback_server_times_out_for_gradually_arriving_incomplete_headers() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::thread;

        let (port, listener) = bind_loopback().expect("bind loopback");
        let handle = thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(10));
            let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
            for byte in b"GET /?code=partial&state=state HTTP/1.1\r\n" {
                if stream.write_all(&[*byte]).is_err() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        });

        let error = wait_for_code_with_timeout(listener, std::time::Duration::from_millis(40))
            .expect_err("trickled headers must not extend the authorization deadline");
        handle.join().unwrap();
        assert!(error.to_string().contains("timed out"), "{error}");
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

    struct CapturingHttp {
        response: serde_json::Value,
        code: std::sync::Mutex<Option<String>>,
    }

    impl HttpPost for CapturingHttp {
        fn post_form(
            &self,
            _url: &str,
            params: &[(&str, &str)],
        ) -> crate::Result<serde_json::Value> {
            let code = params
                .iter()
                .find_map(|(name, value)| (*name == "code").then_some((*value).to_string()));
            *self.code.lock().expect("capture lock") = code;
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
    fn decoded_callback_code_is_passed_unchanged_to_token_exchange() {
        let request = "GET /?code=4%2Fexample%2Bvalue&state=state%2Dvalue HTTP/1.1";
        let code = parse_code_from_request(request).expect("decoded authorization code");
        let state = parse_state_from_request(request).expect("decoded callback state");
        assert_eq!(code, "4/example+value");
        assert_eq!(state, "state-value");

        let http = CapturingHttp {
            response: token_response_json(),
            code: std::sync::Mutex::new(None),
        };
        let pkce = generate_pkce();
        exchange_code(
            &fake_creds(),
            &code,
            &pkce.verifier,
            "http://127.0.0.1:12345/",
            "http://mock-token-endpoint/",
            &http,
        )
        .expect("decoded callback code should exchange");

        assert_eq!(
            http.code.lock().expect("capture lock").as_deref(),
            Some("4/example+value")
        );
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
