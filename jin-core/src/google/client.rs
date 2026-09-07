//! Google Calendar REST client (S6.2).
//!
//! Extends the existing `HttpPost` auth-only abstraction with a new `HttpClient`
//! trait covering GET, POST-JSON, PATCH-JSON, and DELETE — all carrying a Bearer
//! token and optional ETag headers.  ALL tests inject a `MockHttpClient` so no
//! real network is ever required.
//!
//! # Calendar API endpoints used
//! - `GET  /calendars/{cal}/events`                  — list (bootstrap + incremental)
//! - `POST /calendars/{cal}/events`                  — insert (Jin-origin push)
//! - `PATCH /calendars/{cal}/events/{id}`            — update (If-Match etag)
//! - `DELETE /calendars/{cal}/events/{id}`           — delete (If-Match etag)

use crate::google::account::{DiscoveredCalendar, GoogleAccessRole};
use crate::JinError;

pub const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

/// Discover every calendar visible to the authenticated account.
pub fn list_calendars<H: HttpClient>(
    http: &H,
    bearer: &str,
) -> crate::Result<Vec<DiscoveredCalendar>> {
    let mut page_token: Option<String> = None;
    let mut calendars = Vec::new();
    loop {
        let mut url =
            format!("{CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=freeBusyReader");
        if let Some(token) = &page_token {
            url.push_str("&pageToken=");
            url.push_str(&url_encode(token));
        }
        let response = http.get(&url, bearer)?;
        if response.status == 401 {
            return Err(JinError::Auth(
                "Google CalendarList authorization was rejected (HTTP 401). Reconnect this account and try again."
                    .to_string(),
            ));
        }
        if response.status == 403 {
            return Err(JinError::Auth(
                "Google CalendarList access was denied (HTTP 403). Confirm the Google Calendar API is enabled and grant Jin the requested Calendar permission."
                    .to_string(),
            ));
        }
        if !(200..300).contains(&response.status) {
            return Err(JinError::Offline(format!(
                "Google CalendarList request failed with HTTP {}",
                response.status
            )));
        }
        for item in response
            .body
            .get("items")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let calendar_id = item
                .get("id")
                .and_then(|value| value.as_str())
                .ok_or_else(|| JinError::Integrity("CalendarList item missing id".to_string()))?;
            let role = item
                .get("accessRole")
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    JinError::Integrity("CalendarList item missing accessRole".to_string())
                })?;
            calendars.push(DiscoveredCalendar {
                calendar_id: calendar_id.to_string(),
                name: item
                    .get("summaryOverride")
                    .or_else(|| item.get("summary"))
                    .and_then(|value| value.as_str())
                    .unwrap_or(calendar_id)
                    .to_string(),
                primary: item
                    .get("primary")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                access_role: GoogleAccessRole::from_provider(role)?,
            });
        }
        page_token = response
            .body
            .get("nextPageToken")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }
    Ok(calendars)
}

// ── HTTP response ─────────────────────────────────────────────────────────────

/// A normalised HTTP response from the Calendar API.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// HTTP status code (200, 204, 400, 404, 410, 412, …).
    pub status: u16,
    /// Parsed JSON body (empty object if the response had no body, e.g. 204).
    pub body: serde_json::Value,
    /// `ETag` response header value, if present.
    pub etag: Option<String>,
}

// ── HttpClient trait ──────────────────────────────────────────────────────────

/// Injectable, synchronous HTTP abstraction for Calendar API calls.
///
/// The real implementation uses `reqwest` blocking + rustls.
/// Tests inject `MockHttpClient` (cassette-style, no network).
pub trait HttpClient: Send + Sync {
    /// Authenticated GET — returns the parsed JSON response.
    fn get(&self, url: &str, bearer: &str) -> crate::Result<HttpResponse>;

    /// Authenticated POST with a JSON body — used for `events.insert`.
    fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: &serde_json::Value,
    ) -> crate::Result<HttpResponse>;

    /// Authenticated PATCH with a JSON body.
    /// `if_match_etag`: if `Some`, sends `If-Match: <etag>` (optimistic concurrency).
    fn patch_json(
        &self,
        url: &str,
        bearer: &str,
        if_match_etag: Option<&str>,
        body: &serde_json::Value,
    ) -> crate::Result<HttpResponse>;

    /// Authenticated DELETE.
    /// `if_match_etag`: if `Some`, sends `If-Match: <etag>`.
    fn delete(
        &self,
        url: &str,
        bearer: &str,
        if_match_etag: Option<&str>,
    ) -> crate::Result<HttpResponse>;

    /// POST URL-encoded form data (used for OAuth token refresh via the token endpoint).
    /// Returns the parsed JSON body.
    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value>;
}

// ── Production implementation ─────────────────────────────────────────────────

/// Production `HttpClient` backed by `reqwest` blocking + rustls.
pub struct ReqwestClient;

impl HttpClient for ReqwestClient {
    fn get(&self, url: &str, bearer: &str) -> crate::Result<HttpResponse> {
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(url)
            .header("Authorization", format!("Bearer {bearer}"))
            .send()
            .map_err(|e| map_reqwest_err(e, url))?;

        let status = resp.status().as_u16();
        let etag = resp
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp
            .json::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        Ok(HttpResponse { status, body, etag })
    }

    fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: &serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        let client = reqwest::blocking::Client::new();
        let resp = client
            .post(url)
            .header("Authorization", format!("Bearer {bearer}"))
            .json(body)
            .send()
            .map_err(|e| map_reqwest_err(e, url))?;

        let status = resp.status().as_u16();
        let etag = resp
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp
            .json::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        Ok(HttpResponse { status, body, etag })
    }

    fn patch_json(
        &self,
        url: &str,
        bearer: &str,
        if_match_etag: Option<&str>,
        body: &serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        let client = reqwest::blocking::Client::new();
        let mut req = client
            .patch(url)
            .header("Authorization", format!("Bearer {bearer}"))
            .json(body);
        if let Some(etag) = if_match_etag {
            req = req.header("If-Match", etag);
        }
        let resp = req.send().map_err(|e| map_reqwest_err(e, url))?;

        let status = resp.status().as_u16();
        let etag = resp
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp
            .json::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        Ok(HttpResponse { status, body, etag })
    }

    fn delete(
        &self,
        url: &str,
        bearer: &str,
        if_match_etag: Option<&str>,
    ) -> crate::Result<HttpResponse> {
        let client = reqwest::blocking::Client::new();
        let mut req = client
            .delete(url)
            .header("Authorization", format!("Bearer {bearer}"));
        if let Some(etag) = if_match_etag {
            req = req.header("If-Match", etag);
        }
        let resp = req.send().map_err(|e| map_reqwest_err(e, url))?;

        let status = resp.status().as_u16();
        let body = resp
            .json::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        Ok(HttpResponse {
            status,
            body,
            etag: None,
        })
    }

    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value> {
        let client = reqwest::blocking::Client::new();
        let resp = client
            .post(url)
            .form(params)
            .send()
            .map_err(|e| map_reqwest_err(e, url))?;
        resp.json::<serde_json::Value>()
            .map_err(|e| JinError::Offline(format!("JSON parse from {url}: {e}")))
    }
}

fn map_reqwest_err(e: reqwest::Error, url: &str) -> JinError {
    JinError::Offline(format!("HTTP request to {url}: {e}"))
}

// ── Mock HTTP client (offline tests) ─────────────────────────────────────────

/// Cassette-style mock.  Tests push pre-canned `HttpResponse`s into the queue;
/// each API call consumes the next response in FIFO order.
///
/// All four HTTP methods consume from the same queue — tests must enqueue
/// responses in the exact call order expected.
pub struct MockHttpClient {
    cassette: std::sync::Mutex<std::collections::VecDeque<HttpResponse>>,
    requested_urls: std::sync::Mutex<Vec<String>>,
    requested_patches: std::sync::Mutex<Vec<RecordedPatch>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecordedPatch {
    pub url: String,
    pub if_match_etag: Option<String>,
    pub body: serde_json::Value,
}

impl MockHttpClient {
    /// Construct a mock with the given cassette (responses consumed in order).
    pub fn new(responses: Vec<HttpResponse>) -> Self {
        Self {
            cassette: std::sync::Mutex::new(responses.into()),
            requested_urls: std::sync::Mutex::new(Vec::new()),
            requested_patches: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn requested_urls(&self) -> Vec<String> {
        self.requested_urls.lock().unwrap().clone()
    }

    pub fn requested_patches(&self) -> Vec<RecordedPatch> {
        self.requested_patches.lock().unwrap().clone()
    }

    fn record_url(&self, url: &str) {
        self.requested_urls.lock().unwrap().push(url.to_string());
    }

    fn next_response(&self) -> crate::Result<HttpResponse> {
        self.cassette
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| JinError::Integrity("MockHttpClient cassette exhausted".to_string()))
    }
}

impl HttpClient for MockHttpClient {
    fn get(&self, url: &str, _bearer: &str) -> crate::Result<HttpResponse> {
        self.record_url(url);
        self.next_response()
    }

    fn post_json(
        &self,
        url: &str,
        _bearer: &str,
        _body: &serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        self.record_url(url);
        self.next_response()
    }

    fn patch_json(
        &self,
        url: &str,
        _bearer: &str,
        if_match_etag: Option<&str>,
        body: &serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        self.record_url(url);
        self.requested_patches.lock().unwrap().push(RecordedPatch {
            url: url.to_string(),
            if_match_etag: if_match_etag.map(str::to_string),
            body: body.clone(),
        });
        self.next_response()
    }

    fn delete(
        &self,
        url: &str,
        _bearer: &str,
        _if_match_etag: Option<&str>,
    ) -> crate::Result<HttpResponse> {
        self.record_url(url);
        self.next_response()
    }

    fn post_form(&self, _url: &str, _params: &[(&str, &str)]) -> crate::Result<serde_json::Value> {
        let resp = self.next_response()?;
        Ok(resp.body)
    }
}

// ── Calendar REST client ──────────────────────────────────────────────────────

/// A thin wrapper around `HttpClient` that speaks Google Calendar v3 REST.
///
/// Stateless: caller holds tokens and injects them per call.
pub struct CalendarClient<'a, H: HttpClient> {
    pub http: &'a H,
    pub calendar_id: &'a str,
    pub access_token: &'a str,
}

/// Result of a `events.list` call.
#[derive(Debug)]
pub struct ListResponse {
    pub status: u16,
    /// The event resources returned by this page.
    pub items: Vec<serde_json::Value>,
    /// If present, fetch the next page with this token.
    pub next_page_token: Option<String>,
    /// If present on the final page, persist as the next incremental sync token.
    pub next_sync_token: Option<String>,
    /// `true` when the API returned HTTP 410 → caller must wipe + full re-sync.
    pub full_sync_required: bool,
}

impl<'a, H: HttpClient> CalendarClient<'a, H> {
    /// BOOTSTRAP: list all events (non-incremental, no syncToken).
    ///
    /// `page_token`: for pages after the first pass `Some(token)` from the
    /// previous `ListResponse.next_page_token`.
    /// `time_min`: RFC 3339 datetime string limiting how far back to fetch.
    pub fn list_bootstrap(
        &self,
        page_token: Option<&str>,
        time_min: &str,
    ) -> crate::Result<ListResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let mut url = format!(
            "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events\
             ?singleEvents=false&showDeleted=false&timeMin={tm}",
            tm = url_encode(time_min)
        );
        if let Some(pt) = page_token {
            url.push_str(&format!("&pageToken={}", url_encode(pt)));
        }

        let resp = self.http.get(&url, self.access_token)?;
        Ok(parse_list_response(resp))
    }

    /// INCREMENTAL: list changes since `sync_token`.
    ///
    /// Returns `full_sync_required = true` on HTTP 410 GONE.
    pub fn list_incremental(&self, sync_token: &str) -> crate::Result<ListResponse> {
        self.list_incremental_page(sync_token, None)
    }

    /// Fetch one page from the tokenized recurring-resource stream.
    pub fn list_incremental_page(
        &self,
        sync_token: &str,
        page_token: Option<&str>,
    ) -> crate::Result<ListResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let mut url = format!(
            "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events\
             ?singleEvents=false&syncToken={st}",
            st = url_encode(sync_token)
        );
        if let Some(pt) = page_token {
            url.push_str(&format!("&pageToken={}", url_encode(pt)));
        }

        let resp = self.http.get(&url, self.access_token)?;
        Ok(parse_list_response(resp))
    }

    /// Fetch one page of expanded recurring occurrences within a bounded window.
    pub fn list_occurrences(
        &self,
        page_token: Option<&str>,
        time_min: &str,
        time_max: &str,
    ) -> crate::Result<ListResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let mut url = format!(
            "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events\
             ?singleEvents=true&showDeleted=false&timeMin={min}&timeMax={max}",
            min = url_encode(time_min),
            max = url_encode(time_max),
        );
        if let Some(pt) = page_token {
            url.push_str(&format!("&pageToken={}", url_encode(pt)));
        }
        let resp = self.http.get(&url, self.access_token)?;
        Ok(parse_list_response(resp))
    }

    /// Insert a new event with a caller-specified ID (base32hex ULID).
    ///
    /// `event_id` must be base32hex (charset `a-v0-9`), 5–1024 chars.
    /// Using a deterministic client-specified ID makes inserts idempotent
    /// (a retry after a crash won't create a duplicate — VG7).
    pub fn insert_event(
        &self,
        event_id: &str,
        body: serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        // Inject the client-specified id into the request body
        let mut body = body;
        body["id"] = serde_json::Value::String(event_id.to_string());

        // Version 1 is required or Google ignores conferenceData in writes.
        let url =
            format!("{CALENDAR_API_BASE}/calendars/{encoded_cal}/events?conferenceDataVersion=1");
        self.http.post_json(&url, self.access_token, &body)
    }

    /// Patch an existing event (partial update) with `If-Match: <etag>` (VG7).
    ///
    /// Returns the response; the caller checks for 412 (etag mismatch = conflict).
    pub fn patch_event(
        &self,
        event_id: &str,
        etag: &str,
        body: serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let encoded_id = url_encode(event_id);
        // Version 1 is required both for conference createRequest and for
        // preserving existing conference details during a modification.
        let url = format!(
            "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}?conferenceDataVersion=1"
        );
        self.http
            .patch_json(&url, self.access_token, Some(etag), &body)
    }

    /// Patch only the authenticated attendee response. `sendUpdates=none` is
    /// an MVP release assumption guarded by deterministic cassettes and a
    /// disposable-account provider conformance smoke.
    pub fn respond_to_event(
        &self,
        event_id: &str,
        etag: &str,
        body: serde_json::Value,
    ) -> crate::Result<HttpResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let encoded_id = url_encode(event_id);
        let url = format!(
            "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}?sendUpdates=none"
        );
        self.http
            .patch_json(&url, self.access_token, Some(etag), &body)
    }

    /// Delete an event with `If-Match: <etag>`.
    pub fn delete_event(&self, event_id: &str, etag: &str) -> crate::Result<HttpResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let encoded_id = url_encode(event_id);
        let url = format!("{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}");
        self.http.delete(&url, self.access_token, Some(etag))
    }

    /// Fetch a single event resource by Google event ID.
    ///
    /// Used by the S6.3 conflict resolver for `PushPreconditionFailed` (412):
    /// after a 412 the current remote state is unknown, so we fetch it before
    /// applying the LWW policy.
    pub fn get_event(&self, event_id: &str) -> crate::Result<HttpResponse> {
        let encoded_cal = url_encode(self.calendar_id);
        let encoded_id = url_encode(event_id);
        let url = format!("{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}");
        self.http.get(&url, self.access_token)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_list_response(resp: HttpResponse) -> ListResponse {
    if resp.status == 410 {
        return ListResponse {
            status: resp.status,
            items: vec![],
            next_page_token: None,
            next_sync_token: None,
            full_sync_required: true,
        };
    }

    let items = resp
        .body
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let next_page_token = resp
        .body
        .get("nextPageToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let next_sync_token = resp
        .body
        .get("nextSyncToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    ListResponse {
        status: resp.status,
        items,
        next_page_token,
        next_sync_token,
        full_sync_required: false,
    }
}

/// Minimal percent-encoding for URL path/query components.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
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

// ── base32hex ULID encoding (VG7 idempotency) ─────────────────────────────────

/// Convert a ULID string to a Google Calendar-compatible base32hex event ID.
///
/// Google Calendar event IDs must use charset `[a-v0-9]` (base32hex) and be
/// 5–1024 characters long.  A ULID's 128 bits, re-encoded in base32hex, yields
/// exactly 26 characters — always within the 5–1024 range.
///
/// **Idempotency (VG7):** because the mapping is deterministic (ULID → fixed
/// base32hex string), retrying an `events.insert` after a crash will send the
/// same client-specified ID, causing Google to return the existing event rather
/// than creating a duplicate.
pub fn ulid_to_google_event_id(ulid_str: &str) -> crate::Result<String> {
    let ulid = ulid::Ulid::from_string(ulid_str)
        .map_err(|e| JinError::Integrity(format!("invalid ULID '{ulid_str}': {e}")))?;
    let bytes = ulid.to_bytes();
    Ok(encode_base32hex(&bytes))
}

/// Attempt to decode a Google Calendar event ID as a base32hex-encoded ULID.
///
/// Returns `Some(ulid_string)` if `gid` is exactly 26 chars of valid lowercase
/// base32hex alphabet (`0-9a-v`) and the decoded bytes form a valid ULID.
/// Returns `None` for any other string (Google-native opaque IDs, wrong length, etc.).
///
/// Used during HTTP 410 re-sync to re-link jin-origin events whose sync-state was
/// wiped, avoiding duplicate files.  False positives (a Google-native ID that
/// happens to decode to a valid ULID) would still require the matching file to exist
/// AND have `source=Jin`, making accidental re-linkage astronomically unlikely.
pub fn google_event_id_to_ulid(gid: &str) -> Option<String> {
    if gid.len() != 26 {
        return None;
    }
    let bytes = decode_base32hex(gid)?;
    if bytes.len() != 16 {
        return None;
    }
    let arr: [u8; 16] = bytes.try_into().ok()?;
    let ulid = ulid::Ulid::from_bytes(arr);
    Some(ulid.to_string())
}

/// Decode a lowercase base32hex string (RFC 4648 §7) to bytes.
/// Returns `None` if any character is not in `0-9a-v`.
fn decode_base32hex(s: &str) -> Option<Vec<u8>> {
    const ALPHA: &[u8] = b"0123456789abcdefghijklmnopqrstuv";
    let mut buf: u32 = 0;
    let mut bits: u8 = 0;
    let mut out = Vec::with_capacity((s.len() * 5) / 8);

    for c in s.chars() {
        let pos = ALPHA.iter().position(|&a| a == c as u8)? as u32;
        buf = (buf << 5) | pos;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    // Any remaining bits are right-padding artefacts from encoding; discard.
    Some(out)
}

/// Encode a byte slice as base32hex (RFC 4648 §7, lowercase, no padding).
/// Alphabet: `0123456789abcdefghijklmnopqrstuv`
fn encode_base32hex(bytes: &[u8]) -> String {
    const ALPHA: &[u8] = b"0123456789abcdefghijklmnopqrstuv";
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buf: u16 = 0;
    let mut bits: u8 = 0;

    for &b in bytes {
        buf = (buf << 8) | u16::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHA[((buf >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHA[((buf << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── base32hex ─────────────────────────────────────────────────────────────

    #[test]
    fn base32hex_charset_is_a_v_0_9() {
        // Any ULID → all output chars must be in [0-9a-v]
        let id = crate::id::new_ulid();
        let encoded = ulid_to_google_event_id(&id).unwrap();
        for c in encoded.chars() {
            assert!(
                c.is_ascii_digit() || ('a'..='v').contains(&c),
                "char '{c}' is outside base32hex charset [0-9a-v]"
            );
        }
    }

    #[test]
    fn base32hex_length_is_26() {
        // 128 bits of ULID → 26 base32hex chars (⌈128/5⌉ = 26)
        let id = crate::id::new_ulid();
        let encoded = ulid_to_google_event_id(&id).unwrap();
        assert_eq!(
            encoded.len(),
            26,
            "base32hex(ULID) must be exactly 26 chars"
        );
    }

    #[test]
    fn base32hex_is_deterministic() {
        let id = crate::id::new_ulid();
        let a = ulid_to_google_event_id(&id).unwrap();
        let b = ulid_to_google_event_id(&id).unwrap();
        assert_eq!(a, b, "encoding must be deterministic (idempotency)");
    }

    #[test]
    fn different_ulids_produce_different_ids() {
        let id1 = crate::id::new_ulid();
        // Small delay is unnecessary — ULIDs include entropy so collision is impossible.
        let id2 = crate::id::new_ulid();
        if id1 != id2 {
            let e1 = ulid_to_google_event_id(&id1).unwrap();
            let e2 = ulid_to_google_event_id(&id2).unwrap();
            assert_ne!(e1, e2, "different ULIDs must produce different Google IDs");
        }
    }

    #[test]
    fn base32hex_property_charset_and_length_many_ulids() {
        for _ in 0..20 {
            let id = crate::id::new_ulid();
            let encoded = ulid_to_google_event_id(&id).unwrap();
            assert_eq!(encoded.len(), 26);
            assert!(encoded
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='v').contains(&c)));
        }
    }

    // ── mock HTTP client ──────────────────────────────────────────────────────

    #[test]
    fn mock_client_returns_responses_in_order() {
        let mock = MockHttpClient::new(vec![
            HttpResponse {
                status: 200,
                body: serde_json::json!({"items": []}),
                etag: None,
            },
            HttpResponse {
                status: 410,
                body: serde_json::json!({"error": {"code": 410}}),
                etag: None,
            },
        ]);

        let r1 = mock.get("http://example.com", "tok").unwrap();
        assert_eq!(r1.status, 200);

        let r2 = mock.get("http://example.com", "tok").unwrap();
        assert_eq!(r2.status, 410);
    }

    #[test]
    fn mock_client_exhausted_returns_error() {
        let mock = MockHttpClient::new(vec![]);
        let err = mock.get("http://example.com", "tok").unwrap_err();
        assert!(
            matches!(err, crate::JinError::Integrity(_)),
            "exhausted cassette must be JinError::Integrity"
        );
    }

    #[test]
    fn calendar_list_401_requires_reauthentication() {
        let mock = MockHttpClient::new(vec![HttpResponse {
            status: 401,
            body: serde_json::json!({"error": {"message": "Invalid Credentials"}}),
            etag: None,
        }]);

        let error = list_calendars(&mock, "expired").unwrap_err();
        assert!(matches!(error, JinError::Auth(_)));
        assert!(error.to_string().contains("Reconnect this account"));
    }

    #[test]
    fn calendar_list_403_reports_actionable_configuration_error() {
        let mock = MockHttpClient::new(vec![HttpResponse {
            status: 403,
            body: serde_json::json!({"error": {"message": "Calendar API disabled"}}),
            etag: None,
        }]);

        let error = list_calendars(&mock, "valid-but-underprivileged").unwrap_err();
        assert!(matches!(error, JinError::Auth(_)));
        assert!(error.to_string().contains("Calendar API is enabled"));
        assert!(error.to_string().contains("Calendar permission"));
    }

    // ── CalendarClient URL building ────────────────────────────────────────────

    #[test]
    fn calendar_client_list_bootstrap_returns_items() {
        let resp = serde_json::json!({
            "kind": "calendar#events",
            "items": [{"id": "evt1", "summary": "Test"}],
            "nextSyncToken": "token123"
        });
        let mock = MockHttpClient::new(vec![HttpResponse {
            status: 200,
            body: resp,
            etag: None,
        }]);

        let client = CalendarClient {
            http: &mock,
            calendar_id: "primary",
            access_token: "fake_token",
        };

        let list = client.list_bootstrap(None, "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(list.items.len(), 1);
        assert!(!list.full_sync_required);
        assert_eq!(list.next_sync_token.as_deref(), Some("token123"));
    }

    #[test]
    fn calendar_client_410_sets_full_sync_required() {
        let mock = MockHttpClient::new(vec![HttpResponse {
            status: 410,
            body: serde_json::json!({"error": {"message": "Sync token is no longer valid"}}),
            etag: None,
        }]);

        let client = CalendarClient {
            http: &mock,
            calendar_id: "primary",
            access_token: "fake_token",
        };

        let list = client.list_incremental("stale_sync_token").unwrap();
        assert!(
            list.full_sync_required,
            "HTTP 410 must set full_sync_required"
        );
        assert!(list.items.is_empty());
    }

    #[test]
    fn event_writes_enable_conference_data_version_one() {
        let mock = MockHttpClient::new(vec![
            HttpResponse {
                status: 200,
                body: serde_json::json!({}),
                etag: None,
            },
            HttpResponse {
                status: 200,
                body: serde_json::json!({}),
                etag: None,
            },
        ]);
        let client = CalendarClient {
            http: &mock,
            calendar_id: "team@example.com",
            access_token: "fake_token",
        };

        client
            .insert_event("abcde", serde_json::json!({"summary": "Planning"}))
            .unwrap();
        client
            .patch_event(
                "event/one",
                "etag",
                serde_json::json!({"summary": "Updated"}),
            )
            .unwrap();

        assert_eq!(
            mock.requested_urls(),
            vec![
                format!(
                    "{CALENDAR_API_BASE}/calendars/team%40example.com/events?conferenceDataVersion=1"
                ),
                format!(
                    "{CALENDAR_API_BASE}/calendars/team%40example.com/events/event%2Fone?conferenceDataVersion=1"
                ),
            ]
        );
    }

    #[test]
    fn rsvp_send_updates_none() {
        let mock = MockHttpClient::new(vec![HttpResponse {
            status: 200,
            body: serde_json::json!({}),
            etag: None,
        }]);
        let client = CalendarClient {
            http: &mock,
            calendar_id: "team@example.com",
            access_token: "fake_token",
        };
        let body =
            crate::google::mapping::invitation_response_patch("self@example.com", "tentative");
        client
            .respond_to_event("event/one", "etag-1", body.clone())
            .unwrap();
        let patches = mock.requested_patches();
        assert_eq!(patches.len(), 1);
        assert!(patches[0].url.ends_with("event%2Fone?sendUpdates=none"));
        assert_eq!(patches[0].if_match_etag.as_deref(), Some("etag-1"));
        assert_eq!(patches[0].body, body);
    }
}
