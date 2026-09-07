//! Offline integration tests for the `sync_with_http` seam (S6.2 SHOULD).
//!
//! These tests call `jin_core::ops::sync::sync_with_http` directly with a
//! `MockHttpClient` (cassette-style), covering the sync code path end-to-end
//! without spawning a subprocess or touching real Google APIs.
//!
//! Scenarios covered:
//!   • bootstrap → summary.pulled > 0, status = "ok"
//!   • conflict (pull-diverged) → summary.conflicts > 0, status = "conflict"
//!     (verifies the m7 premise: conflicts > 0 would cause cmd_sync to exit 4)

use jin_core::google::client::{HttpResponse, MockHttpClient};
use jin_core::google::secrets::{save_tokens_with_passphrase, TokenSet};
use jin_core::ops::{init, sync};
use tempfile::TempDir;

const SEAM_PASSPHRASE: &str = "seam-test-passphrase";

fn make_root() -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    init(&root).unwrap();
    (tmp, root)
}

fn make_token() -> TokenSet {
    TokenSet {
        access_token: "ya29.testToken".to_string(),
        refresh_token: Some("refresh_token".to_string()),
        expires_at: i64::MAX,
        scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
        client_id: "test.apps.googleusercontent.com".to_string(),
        account: None,
    }
}

fn google_event_item(id: &str, summary: &str, etag: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "iCalUID": format!("{id}@google.com"),
        "etag": etag,
        "status": "confirmed",
        "summary": summary,
        "start": { "dateTime": "2026-09-01T10:00:00", "timeZone": "UTC" },
        "end":   { "dateTime": "2026-09-01T11:00:00", "timeZone": "UTC" },
        "sequence": 0,
        "created": "2026-01-01T00:00:00Z",
        "updated": "2026-08-01T00:00:00Z"
    })
}

// ── Bootstrap → summary.pulled, status = ok ───────────────────────────────────

/// A cold bootstrap (no sync token) returns pulled > 0 and status = "ok".
/// This exercises the full sync_with_http → run_sync → run_bootstrap path.
#[test]
fn seam_bootstrap_returns_pulled_and_ok_status() {
    let (_tmp, root) = make_root();
    let cfg = jin_core::Config::load(&root).unwrap();

    // Set up tokens without touching the global env (prevents races with parallel tests).
    {
        let mut t = make_token();
        t.refresh_token = Some("refresh".to_string());
        save_tokens_with_passphrase(&root, &cfg, &t, SEAM_PASSPHRASE).unwrap();
    }

    let bootstrap = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [
                google_event_item("event_one", "Stand-up", "\"etag_1\""),
                google_event_item("event_two", "All Hands", "\"etag_2\"")
            ],
            "nextSyncToken": "tok_bootstrap_done"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![bootstrap]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, SEAM_PASSPHRASE).unwrap();

    assert_eq!(summary.pulled, 2, "bootstrap must pull both events");
    assert_eq!(summary.pushed, 0);
    assert_eq!(summary.conflicts, 0);
    assert_eq!(summary.status, "ok", "status must be ok when no conflicts");
}

// ── Conflict → S6.3 auto-resolution: Google newer wins, sovereignty preserved ──

/// An incremental pull that returns a diverged Jin-origin event is AUTO-RESOLVED
/// by the S6.3 policy engine (PullDiverged + source=jin → LWW).
///
/// Google's `updated` is one day newer than the local event created "now" →
/// Google wins → its changes are applied to the file, but:
///   - source=jin is preserved (sovereignty)
///   - derived_from is preserved
///   - summary.conflicts == 0 (auto-resolved, not an error)
///   - summary.resolved == 1
///   - status == "ok"
///   - audit log written
#[test]
fn seam_conflict_auto_resolved_google_wins_sovereignty_preserved() {
    let (_tmp, root) = make_root();
    let cfg = jin_core::Config::load(&root).unwrap();

    let tokens = make_token();
    {
        save_tokens_with_passphrase(&root, &cfg, &tokens, SEAM_PASSPHRASE).unwrap();
    }

    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a clean Jin-origin event with known etag.
    // Keep Google's update deterministically newer than the local event.
    let jin_id = jin_core::id::new_ulid();
    let google_id = jin_core::google::client::ulid_to_google_event_id(&jin_id).unwrap();
    let now = chrono::Utc::now().fixed_offset();
    let google_updated = (now + chrono::Duration::days(1)).to_rfc3339();
    let dt =
        chrono::NaiveDateTime::parse_from_str("2026-09-15T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = jin_core::model::Event {
        frontmatter: jin_core::model::event::EventFrontmatter {
            id: jin_id.clone(),
            kind: "event".to_string(),
            title: "Sovereign Event".to_string(),
            description: None,
            location: None,
            start: jin_core::model::event::TemporalValue::DateTime(dt),
            end: jin_core::model::event::TemporalValue::DateTime(dt),
            start_value_type: jin_core::model::event::ValueType::DateTime,
            end_value_type: jin_core::model::event::ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("UTC".to_string()),
            end_tzid: Some("UTC".to_string()),
            floating: false,
            recurrence: vec![],
            recurring_event_id: None,
            original_start: None,
            master_id: None,
            recurrence_unexpanded: false,
            ical_uid: Some(format!("{google_id}@google.com")),
            sequence: 0,
            status: jin_core::model::event::EventStatus::Confirmed,
            created: now,
            updated: now,
            transparency: None,
            visibility: None,
            organizer: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            hangout_link: None,
            reminders: None,
            source: jin_core::model::event::EventSource::Jin,
            authority: jin_core::model::event::EventSource::Jin,
            calendar_id: "primary".to_string(),
            derived_from: Some("TASK_XYZ".to_string()),
        },
        body: "task body".to_string(),
    };
    jin_core::store::fs::write_event(&events_dir, &event).unwrap();

    // Seed sync-state with etag v1.
    let sync_dir = cfg.sync_dir();
    let conn = jin_core::sync::state::open_sync_db(&sync_dir).unwrap();
    jin_core::sync::state::upsert_entry(
        &conn,
        &jin_core::sync::state::EventSyncEntry {
            jin_id: jin_id.clone(),
            google_event_id: Some(google_id.clone()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_v1\"".to_string()),
            google_updated: Some("2026-08-01T00:00:00Z".to_string()),
            dirty: false,
            last_synced_at: Some("2026-08-01T00:01:00Z".to_string()),
        },
    )
    .unwrap();
    jin_core::sync::state::set_sync_token(&conn, "primary", "tok_pre_conflict").unwrap();
    drop(conn);

    // Incremental pull: same event, DIFFERENT etag and newer `updated` on Google.
    let incremental = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id,
                "iCalUID": format!("{google_id}@google.com"),
                "etag": "\"etag_v2\"",  // diverged
                "status": "confirmed",
                "summary": "Sovereign Event — Modified by Google",
                "start": { "dateTime": "2026-09-15T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-09-15T15:00:00", "timeZone": "UTC" },
                "sequence": 1,
                "created": "2026-08-01T00:00:00Z",
                "updated": google_updated
            }],
            "nextSyncToken": "tok_after_conflict"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![incremental]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, SEAM_PASSPHRASE).unwrap();

    // S6.3: conflict auto-resolved → NOT an error.
    assert_eq!(
        summary.conflicts, 0,
        "seam S6.3: conflict must be auto-resolved (conflicts == 0)"
    );
    assert_eq!(summary.resolved, 1, "seam S6.3: resolved count must be 1");
    assert_eq!(
        summary.status, "ok",
        "seam S6.3: status must be 'ok' after auto-resolution"
    );
    assert_eq!(
        summary.pulled, 0,
        "seam: diverged jin-origin event must not be counted as pulled"
    );

    // Google's version was applied because its update is newer than local.
    let file_after =
        jin_core::store::fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
    assert_eq!(
        file_after.frontmatter.title, "Sovereign Event — Modified by Google",
        "seam S6.3: Google's title must be applied (Google wins LWW)"
    );

    // Sovereignty invariants: source=jin and derived_from MUST be preserved.
    assert_eq!(
        file_after.frontmatter.source,
        jin_core::model::event::EventSource::Jin,
        "seam S6.3: source=jin must be preserved after Google-wins resolution"
    );
    assert_eq!(
        file_after.frontmatter.derived_from.as_deref(),
        Some("TASK_XYZ"),
        "seam S6.3: derived_from must be preserved after Google-wins resolution"
    );

    // Audit log must have been created with 1 entry.
    let audit_path = root.join(".jin").join("sync").join("audit.jsonl");
    assert!(audit_path.exists(), "seam S6.3: audit log must exist");
    let content = std::fs::read_to_string(&audit_path).unwrap();
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(
        lines.len(),
        1,
        "seam S6.3: audit log must have exactly 1 entry"
    );
    let entry: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(entry["winner"], "google", "audit: winner must be 'google'");
    assert_eq!(
        entry["resolution"], "lww-google",
        "audit: resolution must be 'lww-google'"
    );
    assert_eq!(entry["jin_id"], jin_id.as_str(), "audit: jin_id must match");
}
