//! Offline integration tests for S6.3 — conflict resolution + audit log.
//!
//! All tests use `sync_with_http` + `MockHttpClient` (no real network).
//! Each test seeds a realistic pre-existing state, drives the full sync path,
//! and asserts:
//!   (a) The correct resolution was applied to the local file / sync-state.
//!   (b) An audit entry was written to `.jin/sync/audit.jsonl`.
//!
//! Scenarios:
//!   1. company_mirror_remote_changed     → PullDiverged / source=google → remote-wins
//!   2. promoted_diverged_google_newer    → PullDiverged / source=jin    → LWW Google wins
//!   3. promoted_diverged_jin_newer       → PullDiverged / source=jin    → LWW Jin wins
//!   4. remote_delete_of_promoted         → RemoteDeleteOfPromoted        → unpublish
//!   5. push_412_jin_wins                 → PushPreconditionFailed        → re-push
//!   6. audit_append_only                 → two conflicts → two lines, first line intact

use jin_core::google::client::{ulid_to_google_event_id, HttpResponse, MockHttpClient};
use jin_core::google::secrets::{save_tokens_with_passphrase, TokenSet};
use jin_core::model::event::{
    EventFrontmatter, EventSource, EventStatus, TemporalValue, ValueType,
};
use jin_core::model::Event;
use jin_core::ops::{init, sync};
use jin_core::sync::state::{open_sync_db, set_sync_token, upsert_entry, EventSyncEntry};
use tempfile::TempDir;

const S63_PASSPHRASE: &str = "s63-test-passphrase";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn save_tokens_for_test(root: &std::path::Path) {
    let cfg = jin_core::Config::load(root).unwrap();
    let t = make_token();
    // Use explicit passphrase — does NOT touch the process-global env var.
    save_tokens_with_passphrase(root, &cfg, &t, S63_PASSPHRASE).unwrap();
}

fn base_event_fm(id: &str, title: &str, source: EventSource) -> EventFrontmatter {
    let now = chrono::Utc::now().fixed_offset();
    let dt =
        chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    EventFrontmatter {
        id: id.to_string(),
        kind: "event".to_string(),
        title: title.to_string(),
        description: None,
        location: None,
        start: TemporalValue::DateTime(dt),
        end: TemporalValue::DateTime(dt),
        start_value_type: ValueType::DateTime,
        end_value_type: ValueType::DateTime,
        is_all_day: false,
        start_tzid: Some("UTC".to_string()),
        end_tzid: Some("UTC".to_string()),
        floating: false,
        recurrence: vec![],
        recurring_event_id: None,
        original_start: None,
        master_id: None,
        recurrence_unexpanded: false,
        ical_uid: None,
        sequence: 0,
        status: EventStatus::Confirmed,
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
        authority: source.clone(),
        source,
        calendar_id: "primary".to_string(),
        derived_from: None,
    }
}

fn google_event_item(id: &str, summary: &str, etag: &str, updated: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "iCalUID": format!("{id}@google.com"),
        "etag": etag,
        "status": "confirmed",
        "summary": summary,
        "description": null,
        "location": null,
        "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
        "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
        "sequence": 1,
        "created": "2026-06-01T00:00:00Z",
        "updated": updated
    })
}

fn read_audit_lines(root: &std::path::Path) -> Vec<serde_json::Value> {
    let path = root.join(".jin").join("sync").join("audit.jsonl");
    if !path.exists() {
        return vec![];
    }
    std::fs::read_to_string(&path)
        .unwrap()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn empty_incremental() -> HttpResponse {
    HttpResponse {
        status: 200,
        body: serde_json::json!({ "items": [], "nextSyncToken": "tok_incr" }),
        etag: None,
    }
}

// ── Test 1: Company mirror (source=google) both-sides-changed → remote-wins ───

/// A Google-authoritative mirror event has a LOCAL edit pending (dirty=true)
/// AND Google returns a new etag — both sides changed concurrently.
/// Policy: remote-wins — Google's version is written to the local file.
/// Audit: entry with resolution="remote-wins", winner="google".
///
/// A Google mirror is only a "conflict" when it is dirty (locally edited)
/// AND Google also changed it (`PullBothSidesChanged`).  A clean mirror
/// receiving a Google update is a normal incremental pull, not a conflict.
#[test]
fn s63_company_mirror_remote_changed_remote_wins() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let mirror_id = jin_core::id::new_ulid();
    let google_id = "company_event_001";
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a Google-source mirror event locally (with a local edit pending)
    let mut fm = base_event_fm(&mirror_id, "All Hands (local edit)", EventSource::Google);
    fm.ical_uid = Some(format!("{google_id}@google.com"));
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm,
            body: String::new(),
        },
    )
    .unwrap();

    // Seed sync-state: dirty=true (local edit pending) — triggers PullBothSidesChanged
    // when Google also returns a new etag.
    let sync_dir = cfg.sync_dir();
    let conn = open_sync_db(&sync_dir).unwrap();
    upsert_entry(
        &conn,
        &EventSyncEntry {
            jin_id: mirror_id.clone(),
            google_event_id: Some(google_id.to_string()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_v1\"".to_string()),
            google_updated: Some("2026-06-01T00:00:00Z".to_string()),
            dirty: true, // local change pending
            last_synced_at: None,
        },
    )
    .unwrap();
    set_sync_token(&conn, "primary", "tok_before").unwrap();
    drop(conn);

    // Incremental: Google returns event with a NEW etag (also changed remotely).
    // dirty=true + remote_etag != stored_etag → PullBothSidesChanged.
    let incr = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [google_event_item(google_id, "All Hands v2 (from Google)", "\"etag_v2\"", "2026-09-01T10:00:00Z")],
            "nextSyncToken": "tok_after"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![incr]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, S63_PASSPHRASE).unwrap();

    // (a) File updated with Google's version (remote-wins for Google mirrors)
    let file =
        jin_core::store::fs::read_event(&events_dir.join(format!("{mirror_id}.md"))).unwrap();
    assert_eq!(
        file.frontmatter.title, "All Hands v2 (from Google)",
        "remote-wins: Google's title must be applied"
    );
    assert_eq!(
        file.frontmatter.source,
        EventSource::Google,
        "remote-wins: source must remain google"
    );

    // Summary
    assert_eq!(summary.conflicts, 0, "no unresolved conflicts");
    assert_eq!(summary.resolved, 1, "1 conflict auto-resolved");
    assert_eq!(summary.status, "ok");

    // (b) Audit log
    let entries = read_audit_lines(&root);
    assert_eq!(entries.len(), 1, "audit: must have 1 entry");
    assert_eq!(entries[0]["winner"], "google");
    assert_eq!(entries[0]["resolution"], "remote-wins");
    assert_eq!(entries[0]["jin_id"], mirror_id.as_str());
    // Audit log path in summary
    assert!(
        summary.audit_log_path.is_some(),
        "summary must include audit_log_path"
    );
}

// ── Test 2: Promoted diverged, Google updated newer → Google applied ──────────

/// A Jin-origin promoted event diverges; Google's `updated` is newer (2029-01-01)
/// vs the local event created now (~2026-06-27).
/// Policy: LWW → Google wins → Google's content applied but source=jin + derived_from preserved.
#[test]
fn s63_promoted_diverged_google_newer_google_applied_sovereignty_preserved() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let jin_id = jin_core::id::new_ulid();
    let google_id = ulid_to_google_event_id(&jin_id).unwrap();
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a clean Jin-origin promoted event
    let mut fm = base_event_fm(&jin_id, "My Promoted Event v1", EventSource::Jin);
    fm.ical_uid = Some(format!("{google_id}@google.com"));
    fm.derived_from = Some("TASK_ABC".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm,
            body: "sovereign task body".to_string(),
        },
    )
    .unwrap();

    // Seed sync-state: clean (not dirty), stored etag v1
    let sync_dir = cfg.sync_dir();
    let conn = open_sync_db(&sync_dir).unwrap();
    upsert_entry(
        &conn,
        &EventSyncEntry {
            jin_id: jin_id.clone(),
            google_event_id: Some(google_id.clone()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_v1\"".to_string()),
            google_updated: Some("2026-06-01T00:00:00Z".to_string()),
            dirty: false,
            last_synced_at: Some("2026-06-01T00:01:00Z".to_string()),
        },
    )
    .unwrap();
    set_sync_token(&conn, "primary", "tok_before").unwrap();
    drop(conn);

    // Incremental: Google returns the event with a NEW etag and future updated
    // (2029-01-01 >> local ~2026-06-27 → Google must win)
    let incr = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id,
                "iCalUID": format!("{google_id}@google.com"),
                "etag": "\"etag_v2\"",
                "status": "confirmed",
                "summary": "My Promoted Event v2 (Google edit)",
                "description": "desc from google",
                "location": null,
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T15:00:00", "timeZone": "UTC" },
                "sequence": 1,
                "created": "2026-06-01T00:00:00Z",
                "updated": "2029-01-01T00:00:00Z"  // far future → Google strictly newer
            }],
            "nextSyncToken": "tok_after"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![incr]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, S63_PASSPHRASE).unwrap();

    // (a) File: Google's content applied, BUT source=jin and derived_from preserved
    let file = jin_core::store::fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
    assert_eq!(
        file.frontmatter.title, "My Promoted Event v2 (Google edit)",
        "LWW google: Google's title must be applied"
    );
    assert_eq!(
        file.frontmatter.source,
        EventSource::Jin,
        "LWW google: source=jin must be preserved"
    );
    assert_eq!(
        file.frontmatter.authority,
        EventSource::Jin,
        "LWW google: authority=jin must be preserved"
    );
    assert_eq!(
        file.frontmatter.derived_from.as_deref(),
        Some("TASK_ABC"),
        "LWW google: derived_from must be preserved"
    );
    assert_eq!(
        file.body, "sovereign task body",
        "LWW google: Jin body (task linkage) must be preserved"
    );

    // Summary
    assert_eq!(summary.conflicts, 0, "no unresolved conflicts");
    assert_eq!(summary.resolved, 1, "1 conflict auto-resolved");
    assert_eq!(summary.status, "ok");

    // (b) Audit log
    let entries = read_audit_lines(&root);
    assert_eq!(entries.len(), 1, "audit: 1 entry");
    assert_eq!(entries[0]["winner"], "google");
    assert_eq!(entries[0]["resolution"], "lww-google");
    assert_eq!(entries[0]["conflict_kind"], "PullDiverged");
}

// ── Test 3: Promoted diverged, Jin newer/tie → Jin kept, re-push enqueued ────

/// A Jin-origin promoted event diverges; the local event's `updated` is newer
/// than Google's `updated` (local is "now" ~2026-06-27; Google's is in the past).
/// Policy: LWW → Jin wins → keep local file unchanged, set dirty=true for re-push.
#[test]
fn s63_promoted_diverged_jin_newer_jin_kept_repush_enqueued() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let jin_id = jin_core::id::new_ulid();
    let google_id = ulid_to_google_event_id(&jin_id).unwrap();
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a clean Jin-origin event (local updated = now ~2026-06-27)
    let mut fm = base_event_fm(&jin_id, "My Event (Jin version)", EventSource::Jin);
    fm.ical_uid = Some(format!("{google_id}@google.com"));
    fm.derived_from = Some("TASK_DEF".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm,
            body: "jin body preserved".to_string(),
        },
    )
    .unwrap();

    // Seed sync-state: clean, stored etag v1
    let sync_dir = cfg.sync_dir();
    let conn = open_sync_db(&sync_dir).unwrap();
    upsert_entry(
        &conn,
        &EventSyncEntry {
            jin_id: jin_id.clone(),
            google_event_id: Some(google_id.clone()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_v1\"".to_string()),
            google_updated: Some("2026-06-01T00:00:00Z".to_string()),
            dirty: false,
            last_synced_at: Some("2026-06-01T00:01:00Z".to_string()),
        },
    )
    .unwrap();
    set_sync_token(&conn, "primary", "tok_before").unwrap();
    drop(conn);

    // Incremental: Google returns the event with NEW etag, but PAST updated
    // (2020-01-01 << local ~2026-06-27 → Jin wins)
    let incr = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id,
                "iCalUID": format!("{google_id}@google.com"),
                "etag": "\"etag_v2\"",
                "status": "confirmed",
                "summary": "Google's Stale Version",
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
                "sequence": 1,
                "created": "2026-06-01T00:00:00Z",
                "updated": "2020-01-01T00:00:00Z"  // old → Jin wins
            }],
            "nextSyncToken": "tok_after"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![incr]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, S63_PASSPHRASE).unwrap();

    // (a) File: Jin's version UNCHANGED
    let file = jin_core::store::fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
    assert_eq!(
        file.frontmatter.title, "My Event (Jin version)",
        "LWW jin: Jin's title must be unchanged"
    );
    assert_eq!(
        file.frontmatter.source,
        EventSource::Jin,
        "LWW jin: source=jin preserved"
    );
    assert_eq!(
        file.frontmatter.derived_from.as_deref(),
        Some("TASK_DEF"),
        "LWW jin: derived_from preserved"
    );
    assert_eq!(file.body, "jin body preserved", "LWW jin: body preserved");

    // Sync-state: dirty=true (re-push enqueued), etag updated to remote etag_v2
    let conn2 = open_sync_db(&sync_dir).unwrap();
    let entry = jin_core::sync::state::get_entry_by_jin_id(&conn2, &jin_id)
        .unwrap()
        .unwrap();
    assert!(entry.dirty, "LWW jin: dirty must be true for re-push");
    assert_eq!(
        entry.etag.as_deref(),
        Some("\"etag_v2\""),
        "LWW jin: stored etag must be updated to remote etag for correct next push"
    );
    drop(conn2);

    // Summary
    assert_eq!(summary.conflicts, 0, "no unresolved conflicts");
    assert_eq!(summary.resolved, 1, "1 conflict auto-resolved");
    assert_eq!(summary.status, "ok");

    // (b) Audit log
    let entries = read_audit_lines(&root);
    assert_eq!(entries.len(), 1, "audit: 1 entry");
    assert_eq!(entries[0]["winner"], "jin");
    assert_eq!(entries[0]["resolution"], "lww-jin");
    assert_eq!(entries[0]["conflict_kind"], "PullDiverged");
}

// ── Test 4: Remote-delete of promoted event → unpublish, Jin kept ─────────────

/// Google sends `status=cancelled` for a Jin-origin (promoted) event.
/// Policy: UNPUBLISH — sync mapping cleared; Jin file kept intact (Confirmed status).
#[test]
fn s63_remote_delete_of_promoted_unpublish_jin_file_intact() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let jin_id = jin_core::id::new_ulid();
    let google_id = ulid_to_google_event_id(&jin_id).unwrap();
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a clean Jin-origin promoted event
    let mut fm = base_event_fm(&jin_id, "Sovereign Meeting", EventSource::Jin);
    fm.ical_uid = Some(format!("{google_id}@google.com"));
    fm.derived_from = Some("TASK_GHI".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm,
            body: "meeting notes".to_string(),
        },
    )
    .unwrap();

    // Seed sync-state: clean, has google_event_id + etag
    let sync_dir = cfg.sync_dir();
    let conn = open_sync_db(&sync_dir).unwrap();
    upsert_entry(
        &conn,
        &EventSyncEntry {
            jin_id: jin_id.clone(),
            google_event_id: Some(google_id.clone()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_before_delete\"".to_string()),
            google_updated: Some("2026-06-01T00:00:00Z".to_string()),
            dirty: false,
            last_synced_at: Some("2026-06-01T00:01:00Z".to_string()),
        },
    )
    .unwrap();
    set_sync_token(&conn, "primary", "tok_before").unwrap();
    drop(conn);

    // Incremental: Google sends `status=cancelled` for the Jin-origin event
    let incr = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id,
                "iCalUID": format!("{google_id}@google.com"),
                "etag": "\"etag_deleted\"",
                "status": "cancelled",  // DELETED on Google
                "summary": "Sovereign Meeting",
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
                "sequence": 0,
                "created": "2026-06-01T00:00:00Z",
                "updated": "2026-09-15T00:00:00Z"
            }],
            "nextSyncToken": "tok_after_delete"
        }),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![incr]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, S63_PASSPHRASE).unwrap();

    // (a) Jin file MUST still exist and be UNCHANGED (status=Confirmed, not cancelled)
    let file_path = events_dir.join(format!("{jin_id}.md"));
    assert!(
        file_path.exists(),
        "unpublish: Jin event file must NOT be deleted"
    );
    let file = jin_core::store::fs::read_event(&file_path).unwrap();
    assert_eq!(
        file.frontmatter.status,
        EventStatus::Confirmed,
        "unpublish: Jin event status must remain Confirmed (never tombstoned)"
    );
    assert_eq!(
        file.frontmatter.title, "Sovereign Meeting",
        "unpublish: Jin event title must be unchanged"
    );
    assert_eq!(
        file.frontmatter.source,
        EventSource::Jin,
        "unpublish: source=jin must be preserved"
    );
    assert_eq!(
        file.frontmatter.derived_from.as_deref(),
        Some("TASK_GHI"),
        "unpublish: derived_from must be preserved"
    );
    assert_eq!(
        file.body, "meeting notes",
        "unpublish: body must be unchanged"
    );

    // (b) Sync-state entry for this event must be REMOVED (unpublished)
    let conn2 = open_sync_db(&sync_dir).unwrap();
    let entry = jin_core::sync::state::get_entry_by_jin_id(&conn2, &jin_id).unwrap();
    assert!(
        entry.is_none(),
        "unpublish: sync-state entry must be removed (event is no longer published to Google)"
    );
    drop(conn2);

    // Summary
    assert_eq!(summary.conflicts, 0, "no unresolved conflicts");
    assert_eq!(
        summary.resolved, 1,
        "1 conflict auto-resolved (RemoteDeleteOfPromoted)"
    );
    assert_eq!(summary.status, "ok");

    // (c) Audit log
    let entries = read_audit_lines(&root);
    assert_eq!(entries.len(), 1, "audit: 1 entry for unpublish");
    assert_eq!(entries[0]["winner"], "jin");
    assert_eq!(entries[0]["resolution"], "unpublish");
    assert_eq!(entries[0]["conflict_kind"], "RemoteDeleteOfPromoted");
    assert_eq!(entries[0]["jin_id"], jin_id.as_str());
    // applied field must mention the Jin object is preserved
    let applied = entries[0]["applied"].as_str().unwrap_or("");
    assert!(
        applied.contains("preserved") || applied.contains("intact"),
        "audit: applied must state Jin object is preserved: {applied}"
    );
}

// ── Test 5: Push 412 → fetch remote, Jin wins → immediate re-push ────────────

/// A push patch returns 412 (remote moved under us).
/// Resolution: fetch the current remote event, apply LWW.
/// Remote `updated` = 2020-01-01 (past) → Jin wins → immediate re-push.
#[test]
fn s63_push_412_jin_wins_re_push_attempted() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let jin_id = jin_core::id::new_ulid();
    let google_id = ulid_to_google_event_id(&jin_id).unwrap();
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    // Seed a dirty Jin-origin event (needs pushing)
    let mut fm = base_event_fm(&jin_id, "My Jin Event (updated locally)", EventSource::Jin);
    fm.ical_uid = Some(format!("{google_id}@google.com"));
    fm.derived_from = Some("TASK_JKL".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm,
            body: "task body for 412 test".to_string(),
        },
    )
    .unwrap();

    // Seed sync-state: dirty=true, has google_event_id + stored etag
    let sync_dir = cfg.sync_dir();
    let conn = open_sync_db(&sync_dir).unwrap();
    upsert_entry(
        &conn,
        &EventSyncEntry {
            jin_id: jin_id.clone(),
            google_event_id: Some(google_id.clone()),
            ical_uid: Some(format!("{google_id}@google.com")),
            etag: Some("\"etag_before_412\"".to_string()),
            google_updated: Some("2026-06-01T00:00:00Z".to_string()),
            dirty: true, // local change pending → will try to push
            last_synced_at: None,
        },
    )
    .unwrap();
    set_sync_token(&conn, "primary", "tok_before").unwrap();
    drop(conn);

    // Cassette:
    // 1. PULL: empty incremental
    // 2. PUSH: 412 (remote moved)
    // 3. RESOLUTION-FETCH: GET current remote event (updated 2020-01-01 → old → Jin wins)
    // 4. RESOLUTION-REPUSH: PATCH → 200 (re-push succeeds)
    let fetch_remote = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "id": google_id,
            "iCalUID": format!("{google_id}@google.com"),
            "etag": "\"etag_remote_current\"",
            "status": "confirmed",
            "summary": "Stale Google Version",
            "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
            "sequence": 0,
            "created": "2026-06-01T00:00:00Z",
            "updated": "2020-01-01T00:00:00Z"  // old → Jin wins
        }),
        etag: Some("\"etag_remote_current\"".to_string()),
    };
    let repush_success = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "id": google_id,
            "iCalUID": format!("{google_id}@google.com"),
            "etag": "\"etag_after_repush\"",
            "status": "confirmed",
            "summary": "My Jin Event (updated locally)",
            "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
            "sequence": 0,
            "created": "2026-06-01T00:00:00Z",
            "updated": "2026-09-01T12:00:00Z"
        }),
        etag: Some("\"etag_after_repush\"".to_string()),
    };

    let patch_412 = HttpResponse {
        status: 412,
        body: serde_json::json!({"error": {"code": 412, "message": "Precondition Failed"}}),
        etag: None,
    };

    let mock = MockHttpClient::new(vec![
        empty_incremental(),
        patch_412,
        fetch_remote,
        repush_success,
    ]);
    let summary = sync::sync_with_http_and_passphrase(&root, &cfg, &mock, S63_PASSPHRASE).unwrap();

    // (a) Event file unchanged (Jin won and was re-pushed)
    let file = jin_core::store::fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
    assert_eq!(
        file.frontmatter.title, "My Jin Event (updated locally)",
        "push-412 jin-wins: Jin title preserved"
    );
    assert_eq!(
        file.frontmatter.source,
        EventSource::Jin,
        "push-412 jin-wins: source=jin preserved"
    );
    assert_eq!(
        file.frontmatter.derived_from.as_deref(),
        Some("TASK_JKL"),
        "push-412 jin-wins: derived_from preserved"
    );

    // (b) Sync-state: dirty=false (push succeeded), etag updated
    let conn2 = open_sync_db(&sync_dir).unwrap();
    let entry = jin_core::sync::state::get_entry_by_jin_id(&conn2, &jin_id)
        .unwrap()
        .unwrap();
    assert!(
        !entry.dirty,
        "push-412 jin-wins: dirty must be false after successful re-push"
    );
    drop(conn2);

    // Summary
    assert_eq!(summary.conflicts, 0, "no unresolved conflicts");
    assert_eq!(summary.resolved, 1, "1 conflict auto-resolved");
    assert_eq!(summary.status, "ok");

    // (c) Audit log
    let entries = read_audit_lines(&root);
    assert_eq!(entries.len(), 1, "audit: 1 entry");
    assert_eq!(entries[0]["winner"], "jin");
    assert_eq!(entries[0]["resolution"], "lww-jin");
    assert_eq!(entries[0]["conflict_kind"], "PushPreconditionFailed");
}

// ── Test 6: Audit log is append-only (two conflicts → two distinct lines) ─────

/// Two separate sync runs each produce one conflict.
/// Assert: audit log has exactly two lines; the first line is unchanged
/// (append-only invariant).
#[test]
fn s63_audit_log_is_append_only_two_conflicts_two_lines() {
    let (_tmp, root) = make_root();
    save_tokens_for_test(&root);
    let cfg = jin_core::Config::load(&root).unwrap();

    let sync_dir = cfg.sync_dir();
    std::fs::create_dir_all(&sync_dir).unwrap();

    // ── First sync: remote-delete of promoted event ───────────────────────────
    let jin_id_1 = jin_core::id::new_ulid();
    let google_id_1 = ulid_to_google_event_id(&jin_id_1).unwrap();
    let events_dir = root.join("events");
    std::fs::create_dir_all(&events_dir).unwrap();

    let mut fm1 = base_event_fm(&jin_id_1, "Event A", EventSource::Jin);
    fm1.ical_uid = Some(format!("{google_id_1}@google.com"));
    fm1.derived_from = Some("TASK_1".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm1,
            body: "body a".to_string(),
        },
    )
    .unwrap();

    {
        let conn = open_sync_db(&sync_dir).unwrap();
        upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id_1.clone(),
                google_event_id: Some(google_id_1.clone()),
                ical_uid: Some(format!("{google_id_1}@google.com")),
                etag: Some("\"e1\"".to_string()),
                google_updated: None,
                dirty: false,
                last_synced_at: None,
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "tok1").unwrap();
    }

    let incr1 = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id_1,
                "iCalUID": format!("{google_id_1}@google.com"),
                "etag": "\"e1del\"",
                "status": "cancelled",
                "summary": "Event A",
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
                "sequence": 0,
                "created": "2026-06-01T00:00:00Z",
                "updated": "2026-09-01T00:00:00Z"
            }],
            "nextSyncToken": "tok1_done"
        }),
        etag: None,
    };
    let mock1 = MockHttpClient::new(vec![incr1]);
    sync::sync_with_http_and_passphrase(&root, &cfg, &mock1, S63_PASSPHRASE).unwrap();

    // Capture the first audit line content
    let audit_path = root.join(".jin").join("sync").join("audit.jsonl");
    let first_line = std::fs::read_to_string(&audit_path)
        .unwrap()
        .lines()
        .next()
        .unwrap()
        .to_string();

    // ── Second sync: another promoted event diverges ──────────────────────────
    let jin_id_2 = jin_core::id::new_ulid();
    let google_id_2 = ulid_to_google_event_id(&jin_id_2).unwrap();

    let mut fm2 = base_event_fm(&jin_id_2, "Event B", EventSource::Jin);
    fm2.ical_uid = Some(format!("{google_id_2}@google.com"));
    fm2.derived_from = Some("TASK_2".to_string());
    jin_core::store::fs::write_event(
        &events_dir,
        &Event {
            frontmatter: fm2,
            body: "body b".to_string(),
        },
    )
    .unwrap();

    {
        let conn = open_sync_db(&sync_dir).unwrap();
        // Need a new sync token to get incremental
        set_sync_token(&conn, "primary", "tok2").unwrap();
        upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id_2.clone(),
                google_event_id: Some(google_id_2.clone()),
                ical_uid: Some(format!("{google_id_2}@google.com")),
                etag: Some("\"e2_v1\"".to_string()),
                google_updated: Some("2026-06-01T00:00:00Z".to_string()),
                dirty: false,
                last_synced_at: Some("2026-06-01T00:01:00Z".to_string()),
            },
        )
        .unwrap();
    }

    let incr2 = HttpResponse {
        status: 200,
        body: serde_json::json!({
            "items": [{
                "id": google_id_2,
                "iCalUID": format!("{google_id_2}@google.com"),
                "etag": "\"e2_v2\"",
                "status": "confirmed",
                "summary": "Event B (Google edit)",
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
                "sequence": 1,
                "created": "2026-06-01T00:00:00Z",
                "updated": "2029-06-01T00:00:00Z"  // future → Google wins
            }],
            "nextSyncToken": "tok2_done"
        }),
        etag: None,
    };
    let mock2 = MockHttpClient::new(vec![incr2]);
    sync::sync_with_http_and_passphrase(&root, &cfg, &mock2, S63_PASSPHRASE).unwrap();

    // Assert: two lines, first line unchanged (append-only)
    let content = std::fs::read_to_string(&audit_path).unwrap();
    let all_lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(
        all_lines.len(),
        2,
        "audit append-only: must have exactly 2 lines"
    );
    assert_eq!(
        all_lines[0],
        first_line.as_str(),
        "audit append-only: first line must be UNCHANGED"
    );

    // Both lines must be valid JSON with distinct jin_ids
    let p1: serde_json::Value = serde_json::from_str(all_lines[0]).unwrap();
    let p2: serde_json::Value = serde_json::from_str(all_lines[1]).unwrap();
    assert_ne!(
        p1["jin_id"], p2["jin_id"],
        "audit: two distinct conflicts must have distinct jin_ids"
    );
}
