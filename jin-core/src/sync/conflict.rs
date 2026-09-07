//! S6.3 — Conflict types + resolution engine (ADR-0004 source-of-truth matrix).
//!
//! `ConflictInfo` and `ConflictKind` are defined here (not in `google::sync`) so
//! that the resolution engine can use them without creating a circular dependency:
//!
//!   `google::sync` imports `ConflictInfo`/`ConflictKind` from here.
//!   This module imports from `google::mapping` and `google::client` — NOT from
//!   `google::sync` — so there is no cycle.
//!
//! # Resolution matrix (ADR-0004)
//!
//! | Conflict kind                       | Event authority  | Policy              |
//! |-------------------------------------|-----------------|---------------------|
//! | PullDiverged / PullBothSidesChanged | source=google   | remote-wins         |
//! | PullDiverged / PullBothSidesChanged | source=jin      | LWW (tie → Jin)     |
//! | RemoteDeleteOfPromoted              | source=jin      | unpublish (keep Jin)|
//! | PushPreconditionFailed              | source=jin      | fetch → LWW         |

use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::google::client::{CalendarClient, HttpClient, CALENDAR_API_BASE};
use crate::google::mapping::{google_to_jin, jin_to_google};
use crate::model::event::EventSource;
use crate::model::Event;
use crate::store::fs;
use crate::sync::audit::{append_audit_entry, AuditEntry, AuditSide};
use crate::sync::state::{self, EventSyncEntry};

// ── Public types ──────────────────────────────────────────────────────────────

/// The nature of the detected conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictKind {
    /// `events.patch` returned HTTP 412 (precondition failed — remote changed
    /// since our stored etag).
    PushPreconditionFailed,
    /// Local event is dirty AND incoming Google pull has a different etag →
    /// both sides changed concurrently.
    PullBothSidesChanged,
    /// A clean (non-dirty) source=Jin event has a different etag on Google.
    /// Someone edited it on Google after Jin last pushed it.
    PullDiverged,
    /// The Google replica of a Jin-origin (promoted) event was deleted remotely
    /// (`status=cancelled` arrived for a source=Jin event).
    /// Resolution: UNPUBLISH — sever the sync mapping, keep the Jin file intact.
    RemoteDeleteOfPromoted,
}

impl ConflictKind {
    /// Stable string form used in audit entries.
    pub fn as_str(&self) -> &'static str {
        match self {
            ConflictKind::PushPreconditionFailed => "PushPreconditionFailed",
            ConflictKind::PullBothSidesChanged => "PullBothSidesChanged",
            ConflictKind::PullDiverged => "PullDiverged",
            ConflictKind::RemoteDeleteOfPromoted => "RemoteDeleteOfPromoted",
        }
    }
}

/// A detected conflict — created by `google::sync` (pull/push phases) and
/// consumed by `resolve_all_conflicts` (S6.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    /// Jin ULID of the affected event.
    pub jin_id: String,
    /// Google event ID, if known.
    pub google_event_id: Option<String>,
    /// iCalUID, if known.
    pub ical_uid: Option<String>,
    /// What kind of conflict this is.
    pub kind: ConflictKind,
    /// The etag Jin last saw from Google (stored in sync-state at conflict time).
    pub local_etag: Option<String>,
    /// The etag returned by the most recent Google response.
    pub remote_etag: Option<String>,
    /// Full Google event JSON resource (present for pull conflicts; `None` for
    /// `PushPreconditionFailed` and `RemoteDeleteOfPromoted` — fetched or N/A).
    pub remote_event: Option<serde_json::Value>,
    /// Google's `updated` timestamp string (RFC 3339) for LWW comparison.
    pub remote_google_updated: Option<String>,
}

// ── Resolution entry point ────────────────────────────────────────────────────

/// Resolve every conflict in `conflicts`.
///
/// For each conflict:
///   1. Apply the per-authority policy (remote-wins / LWW / unpublish).
///   2. Write an audit entry to `<sync_dir>/audit.jsonl`.
///   3. Increment the resolved counter.
///
/// Returns `(resolved_count, unresolved_conflicts)`.
/// `unresolved_conflicts` is empty in MVP (all cases are auto-resolvable).
/// A non-empty list means something genuinely unexpected happened (e.g. the
/// remote event disappeared after being referenced — not expected, not fatal).
pub fn resolve_all_conflicts<H: HttpClient>(
    root: &Path,
    conn: &mut Connection,
    conflicts: Vec<ConflictInfo>,
    access_token: &str,
    http: &H,
    calendar_id: &str,
) -> crate::Result<(u32, Vec<ConflictInfo>)> {
    let sync_dir = root.join(".jin").join("sync");
    let events_dir = root.join("events");
    let mut resolved_count = 0u32;
    let mut still_unresolved: Vec<ConflictInfo> = Vec::new();

    for conflict in conflicts {
        match resolve_one(
            root,
            conn,
            access_token,
            http,
            calendar_id,
            &events_dir,
            &conflict,
        ) {
            Ok(Some(audit_entry)) => {
                append_audit_entry(&sync_dir, &audit_entry)?;
                resolved_count += 1;
            }
            Ok(None) => {
                // Could not resolve (missing data, file gone, etc.) — leave for manual
                still_unresolved.push(conflict);
            }
            Err(e) => {
                // Non-fatal error during resolution — log and leave unresolved.
                // We do NOT propagate: one bad conflict must not abort the whole sync.
                eprintln!(
                    "jin: warn: conflict resolution error for {}: {e}",
                    conflict.jin_id
                );
                still_unresolved.push(conflict);
            }
        }
    }

    Ok((resolved_count, still_unresolved))
}

// ── Per-conflict dispatcher ───────────────────────────────────────────────────

fn resolve_one<H: HttpClient>(
    root: &Path,
    conn: &mut Connection,
    access_token: &str,
    http: &H,
    calendar_id: &str,
    events_dir: &Path,
    conflict: &ConflictInfo,
) -> crate::Result<Option<AuditEntry>> {
    let event_path = events_dir.join(format!("{}.md", conflict.jin_id));

    match conflict.kind {
        ConflictKind::RemoteDeleteOfPromoted => resolve_remote_delete(conn, conflict, &event_path),

        ConflictKind::PullDiverged | ConflictKind::PullBothSidesChanged => {
            if !event_path.exists() {
                return Ok(None);
            }
            let local_event = fs::read_event(&event_path)?;
            if local_event.frontmatter.source == EventSource::Google {
                // Company mirror → remote-wins
                resolve_mirror_remote_wins(conn, conflict, &local_event, events_dir, calendar_id)
            } else {
                // Promoted Jin event → LWW
                resolve_promoted_lww(conn, calendar_id, conflict, &local_event, events_dir)
            }
        }

        ConflictKind::PushPreconditionFailed => resolve_push_412(
            root,
            conn,
            access_token,
            http,
            calendar_id,
            conflict,
            events_dir,
        ),
    }
}

// ── Case 1: Remote-delete of promoted (source=Jin) event ─────────────────────

fn resolve_remote_delete(
    conn: &mut Connection,
    conflict: &ConflictInfo,
    event_path: &Path,
) -> crate::Result<Option<AuditEntry>> {
    // Build audit snapshot from the local file before touching anything.
    let (local_title, local_etag_snapshot, local_updated) = if event_path.exists() {
        match fs::read_event(event_path) {
            Ok(ev) => (
                Some(ev.frontmatter.title.clone()),
                conflict.local_etag.clone(),
                Some(ev.frontmatter.updated.to_rfc3339()),
            ),
            Err(_) => (None, conflict.local_etag.clone(), None),
        }
    } else {
        (None, conflict.local_etag.clone(), None)
    };

    // UNPUBLISH: remove the sync-state entry.
    // The Jin file is NOT touched — the sovereign object is preserved intact.
    state::delete_entry(conn, &conflict.jin_id)?;

    Ok(Some(AuditEntry {
        timestamp: Utc::now().to_rfc3339(),
        conflict_kind: "RemoteDeleteOfPromoted".to_string(),
        jin_id: conflict.jin_id.clone(),
        google_event_id: conflict.google_event_id.clone(),
        ical_uid: conflict.ical_uid.clone(),
        local_side: AuditSide {
            title: local_title,
            etag: local_etag_snapshot,
            updated: local_updated,
        },
        remote_side: AuditSide {
            title: None, // event was deleted; no remote payload
            etag: conflict.remote_etag.clone(),
            updated: conflict.remote_google_updated.clone(),
        },
        resolution: "unpublish".to_string(),
        winner: "jin".to_string(),
        applied: "Google replica deleted; sync mapping cleared (google_event_id/etag removed); \
             Jin object preserved intact (status=Confirmed, file untouched)"
            .to_string(),
    }))
}

// ── Case 2: Company mirror (source=Google) → remote-wins ─────────────────────

fn resolve_mirror_remote_wins(
    conn: &mut Connection,
    conflict: &ConflictInfo,
    local_event: &Event,
    events_dir: &Path,
    calendar_id: &str,
) -> crate::Result<Option<AuditEntry>> {
    let remote = match &conflict.remote_event {
        Some(e) => e,
        None => return Ok(None), // no remote data; cannot resolve
    };

    let local_side = AuditSide {
        title: Some(local_event.frontmatter.title.clone()),
        etag: conflict.local_etag.clone(),
        updated: Some(local_event.frontmatter.updated.to_rfc3339()),
    };
    let remote_side = AuditSide {
        title: remote
            .get("summary")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        etag: conflict.remote_etag.clone(),
        updated: conflict.remote_google_updated.clone(),
    };

    // Apply the remote (Google) version; authority stays Google.
    let new_fm = google_to_jin(remote, &conflict.jin_id, calendar_id)?;
    let new_event = Event {
        frontmatter: new_fm,
        body: String::new(),
    };
    fs::write_event(events_dir, &new_event)?;

    // Update sync-state with the fresh remote etag; clear dirty.
    state::upsert_entry(
        conn,
        &EventSyncEntry {
            jin_id: conflict.jin_id.clone(),
            google_event_id: conflict.google_event_id.clone(),
            ical_uid: conflict.ical_uid.clone(),
            etag: conflict.remote_etag.clone(),
            google_updated: conflict.remote_google_updated.clone(),
            dirty: false,
            last_synced_at: Some(Utc::now().to_rfc3339()),
        },
    )?;

    Ok(Some(AuditEntry {
        timestamp: Utc::now().to_rfc3339(),
        conflict_kind: conflict.kind.as_str().to_string(),
        jin_id: conflict.jin_id.clone(),
        google_event_id: conflict.google_event_id.clone(),
        ical_uid: conflict.ical_uid.clone(),
        local_side,
        remote_side,
        resolution: "remote-wins".to_string(),
        winner: "google".to_string(),
        applied: "Google version written to local mirror; \
                  local delta discarded (Google is authoritative for this event)"
            .to_string(),
    }))
}

// ── Case 3: Promoted Jin event → LWW by updated timestamp ────────────────────

fn resolve_promoted_lww(
    conn: &mut Connection,
    calendar_id: &str,
    conflict: &ConflictInfo,
    local_event: &Event,
    events_dir: &Path,
) -> crate::Result<Option<AuditEntry>> {
    let remote = match &conflict.remote_event {
        Some(e) => e,
        None => return Ok(None),
    };

    let local_updated: DateTime<chrono::FixedOffset> = local_event.frontmatter.updated;
    let remote_updated_str = conflict.remote_google_updated.as_deref().unwrap_or("");

    // Google wins only when its timestamp is STRICTLY newer; tie → Jin wins.
    let google_wins = DateTime::parse_from_rfc3339(remote_updated_str)
        .map(|remote_dt| remote_dt > local_updated)
        .unwrap_or(false); // unparseable remote timestamp → tie → Jin wins

    let local_side = AuditSide {
        title: Some(local_event.frontmatter.title.clone()),
        etag: conflict.local_etag.clone(),
        updated: Some(local_updated.to_rfc3339()),
    };
    let remote_side = AuditSide {
        title: remote
            .get("summary")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        etag: conflict.remote_etag.clone(),
        updated: conflict.remote_google_updated.clone(),
    };

    if google_wins {
        // Apply Google's content but PRESERVE source=Jin, authority=Jin,
        // derived_from, and the Jin file body (task linkage).
        let mut new_fm = google_to_jin(remote, &conflict.jin_id, calendar_id)?;
        new_fm.source = EventSource::Jin;
        new_fm.authority = EventSource::Jin;
        new_fm.derived_from = local_event.frontmatter.derived_from.clone();

        let new_event = Event {
            frontmatter: new_fm,
            body: local_event.body.clone(), // sovereign body preserved
        };
        fs::write_event(events_dir, &new_event)?;

        // Update sync-state with the new remote etag; clear dirty.
        state::upsert_entry(
            conn,
            &EventSyncEntry {
                jin_id: conflict.jin_id.clone(),
                google_event_id: conflict.google_event_id.clone(),
                ical_uid: conflict.ical_uid.clone(),
                etag: conflict.remote_etag.clone(),
                google_updated: conflict.remote_google_updated.clone(),
                dirty: false,
                last_synced_at: Some(Utc::now().to_rfc3339()),
            },
        )?;

        Ok(Some(AuditEntry {
            timestamp: Utc::now().to_rfc3339(),
            conflict_kind: conflict.kind.as_str().to_string(),
            jin_id: conflict.jin_id.clone(),
            google_event_id: conflict.google_event_id.clone(),
            ical_uid: conflict.ical_uid.clone(),
            local_side,
            remote_side,
            resolution: "lww-google".to_string(),
            winner: "google".to_string(),
            applied: "Google changes applied to local file; \
                      source=jin and derived_from preserved; \
                      Jin body retained; sync-state etag updated"
                .to_string(),
        }))
    } else {
        // Jin wins (newer or tie).
        // Update the stored etag to the current remote etag so the next push
        // uses the correct If-Match value; set dirty=true to enqueue a re-push.
        state::upsert_entry(
            conn,
            &EventSyncEntry {
                jin_id: conflict.jin_id.clone(),
                google_event_id: conflict.google_event_id.clone(),
                ical_uid: conflict.ical_uid.clone(),
                etag: conflict.remote_etag.clone(), // must be current remote etag
                google_updated: conflict.remote_google_updated.clone(),
                dirty: true, // re-enqueue push
                last_synced_at: None,
            },
        )?;

        Ok(Some(AuditEntry {
            timestamp: Utc::now().to_rfc3339(),
            conflict_kind: conflict.kind.as_str().to_string(),
            jin_id: conflict.jin_id.clone(),
            google_event_id: conflict.google_event_id.clone(),
            ical_uid: conflict.ical_uid.clone(),
            local_side,
            remote_side,
            resolution: "lww-jin".to_string(),
            winner: "jin".to_string(),
            applied: "Jin version kept; remote etag recorded; \
                      event re-enqueued for push on next sync"
                .to_string(),
        }))
    }
}

// ── Case 4: Push 412 → fetch current remote + per-authority LWW ──────────────

fn resolve_push_412<H: HttpClient>(
    _root: &Path,
    conn: &mut Connection,
    access_token: &str,
    http: &H,
    calendar_id: &str,
    conflict: &ConflictInfo,
    events_dir: &Path,
) -> crate::Result<Option<AuditEntry>> {
    let google_event_id = match &conflict.google_event_id {
        Some(id) => id.clone(),
        None => return Ok(None), // no google_event_id: cannot fetch; leave unresolved
    };

    // Build an ad-hoc CalendarClient and fetch the current remote event.
    let encoded_cal = url_encode(calendar_id);
    let encoded_id = url_encode(&google_event_id);
    let url = format!("{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}");
    let fetch_resp = http.get(&url, access_token)?;

    if fetch_resp.status != 200 {
        // Could not fetch (e.g., 404 — event also deleted on remote):
        // treat as RemoteDeleteOfPromoted.
        if fetch_resp.status == 404 {
            let event_path = events_dir.join(format!("{}.md", conflict.jin_id));
            let synthetic = ConflictInfo {
                kind: ConflictKind::RemoteDeleteOfPromoted,
                remote_event: None,
                remote_etag: None,
                remote_google_updated: None,
                ..conflict.clone()
            };
            return resolve_remote_delete(conn, &synthetic, &event_path);
        }
        return Ok(None);
    }

    let remote = fetch_resp.body;
    let remote_updated_str = remote
        .get("updated")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let remote_etag = remote
        .get("etag")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| fetch_resp.etag.clone());

    // Read local event
    let event_path = events_dir.join(format!("{}.md", conflict.jin_id));
    if !event_path.exists() {
        return Ok(None);
    }
    let local_event = fs::read_event(&event_path)?;

    // Synthesise an equivalent pull conflict with the fetched remote data.
    let synthetic = ConflictInfo {
        kind: ConflictKind::PullDiverged,
        remote_event: Some(remote.clone()),
        remote_etag,
        remote_google_updated: remote_updated_str,
        ..conflict.clone()
    };

    if local_event.frontmatter.source == EventSource::Google {
        // Shouldn't happen (we never push mirrors) but guard anyway.
        resolve_mirror_remote_wins(conn, &synthetic, &local_event, events_dir, calendar_id)
    } else {
        // Jin-origin: LWW.  If Jin wins we'll re-push with the refreshed etag.
        let audit = resolve_promoted_lww(conn, calendar_id, &synthetic, &local_event, events_dir)?;

        // If Jin won: try an immediate re-push with the updated etag.
        // (dirty=true was set by resolve_promoted_lww; attempt push now so the
        // caller doesn't need a whole extra sync cycle.)
        if let Some(ref entry) = audit {
            if entry.winner == "jin" {
                // Read back the (unchanged) local event and re-push.
                if let Ok(current_local) = fs::read_event(&event_path) {
                    // Retrieve the new etag we just stored.
                    if let Ok(Some(sync_entry)) = state::get_entry_by_jin_id(conn, &conflict.jin_id)
                    {
                        if let Some(ref current_etag) = sync_entry.etag {
                            let push_body = jin_to_google(&current_local.frontmatter);
                            let push_url = format!(
                                "{CALENDAR_API_BASE}/calendars/{encoded_cal}/events/{encoded_id}"
                            );
                            let push_resp = http.patch_json(
                                &push_url,
                                access_token,
                                Some(current_etag.as_str()),
                                &push_body,
                            )?;
                            if push_resp.status == 200 || push_resp.status == 201 {
                                let new_etag = push_resp
                                    .body
                                    .get("etag")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                                    .or(push_resp.etag.clone());
                                let new_updated = push_resp
                                    .body
                                    .get("updated")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                state::upsert_entry(
                                    conn,
                                    &EventSyncEntry {
                                        jin_id: conflict.jin_id.clone(),
                                        google_event_id: conflict.google_event_id.clone(),
                                        ical_uid: conflict.ical_uid.clone(),
                                        etag: new_etag,
                                        google_updated: new_updated,
                                        dirty: false,
                                        last_synced_at: Some(Utc::now().to_rfc3339()),
                                    },
                                )?;
                            }
                            // If re-push fails: dirty stays true; next sync will retry.
                        }
                    }
                }
            }
        }

        // Stamp the original conflict kind in the audit entry so the log
        // faithfully records that this was a 412 push failure, not a pull diverge.
        let audit = audit.map(|mut e| {
            e.conflict_kind = "PushPreconditionFailed".to_string();
            e
        });

        Ok(audit)
    }
}

// ── Internal helper ───────────────────────────────────────────────────────────

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

// ── CalendarClient thin helper used by resolve_push_412 ───────────────────────

/// Re-export `CalendarClient` builder so the resolution engine can call
/// `get_event` without importing the full `google::client` module tree.
/// (Defined here to avoid a compile-time circular dependency on `google::sync`.)
#[allow(dead_code)]
fn _build_client<'a, H: HttpClient>(
    http: &'a H,
    calendar_id: &'a str,
    access_token: &'a str,
) -> CalendarClient<'a, H> {
    CalendarClient {
        http,
        calendar_id,
        access_token,
    }
}
