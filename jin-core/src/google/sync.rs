//! Google Calendar sync loop (S6.2).
//!
//! Implements the ADR-0004 state machine:
//!   BOOTSTRAP  → no syncToken: paginated `events.list` → persist mirror → save nextSyncToken
//!   INCREMENTAL → have syncToken: `events.list(syncToken)` → apply deltas → save nextSyncToken
//!                 HTTP 410 GONE → wipe + full re-sync
//!   PUSH       → drain dirty outbox: `insert` (base32hex ULID id) or `patch` (If-Match etag)
//!
//! **No conflict RESOLUTION here (S6.3).**  Conflicts are DETECTED and returned
//! in `SyncResult.conflicts`; the caller (or S6.3) applies policy + audit.
//!
//! All tests are offline — inject a `MockHttpClient` (cassette-style).

use std::path::Path;

use chrono::Utc;

use crate::google::client::{
    google_event_id_to_ulid, ulid_to_google_event_id, CalendarClient, HttpClient,
};
use crate::google::mapping::{google_to_jin, jin_to_google};
use crate::google::secrets::TokenSet;
use crate::model::event::{EventSource, EventStatus};
use crate::ops::api;
use crate::store::fs;
use crate::sync::conflict::{resolve_all_conflicts, ConflictInfo, ConflictKind};
use crate::sync::state::{
    self, clear_sync_token, get_sync_token, open_sync_db, set_sync_token, EventSyncEntry,
};
use crate::{Config, JinError};

// ── Public result types ───────────────────────────────────────────────────────

/// Summary of a completed sync run.
#[derive(Debug, Default)]
pub struct SyncResult {
    /// Events pulled from Google (new + updated).
    pub pulled: u32,
    /// Events pushed to Google (inserted + patched).
    pub pushed: u32,
    /// Conflicts that were AUTO-RESOLVED by the S6.3 policy engine.
    pub resolved: u32,
    /// Conflicts remaining after S6.3 resolution (none expected in MVP).
    pub conflicts: Vec<ConflictInfo>,
    /// Non-fatal errors collected during the run.
    pub errors: Vec<String>,
}

// ConflictInfo and ConflictKind are defined in crate::sync::conflict (S6.3)
// and imported above. They are used directly throughout this module.

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run a complete sync cycle: PULL (bootstrap or incremental) + PUSH (outbox drain).
///
/// `tokens` is passed mutably so we can refresh the access token when expired.
/// On auth failure (invalid_grant / missing tokens) this returns `JinError::Auth`
/// (exit 5).  On network failure it returns `JinError::Offline` (exit 6).
pub fn run_sync<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    tokens: &mut TokenSet,
    http: &H,
) -> crate::Result<SyncResult> {
    // ── 1. Ensure access token is fresh ──────────────────────────────────────
    refresh_if_needed(root, cfg, tokens, http)?;

    let calendar_id = cfg.calendar_id.as_deref().unwrap_or("primary");

    let sync_dir = cfg.sync_dir();
    let mut conn = open_sync_db(&sync_dir)?;

    let mut result = SyncResult::default();

    // ── 2. PULL (bootstrap or incremental) ───────────────────────────────────
    let current_token = get_sync_token(&conn, calendar_id)?;
    let needs_bootstrap = current_token.is_none();

    if needs_bootstrap {
        // BOOTSTRAP: full paginated list
        run_bootstrap(root, cfg, &mut conn, &mut result, tokens, http, calendar_id)?;
    } else {
        // INCREMENTAL: list with syncToken
        let sync_token = current_token.unwrap();
        let full_sync_needed = run_incremental(
            root,
            cfg,
            &mut conn,
            &mut result,
            tokens,
            http,
            calendar_id,
            &sync_token,
        )?;

        if full_sync_needed {
            // C1 + 410-rekey: reconciling full re-sync that preserves mirror ULIDs.
            //
            // OLD approach (deleted upfront): bootstrap minted new ULIDs, breaking
            // every outgoing edge (note prep-for→event) on every ~7-day token expiry.
            //
            // NEW approach:
            // 1. Snapshot ical_uid→ULID from disk mirror files BEFORE clearing state.
            // 2. Wipe sync-state (clear_clean_entries) but leave files on disk.
            // 3. Re-seed DB stubs from the snapshot so phase-2 lookup reuses ULIDs.
            // 4. Run bootstrap — process_incoming_event finds each event's stub by
            //    ical_uid, writes to the SAME file path, upserts entry with fresh etag.
            // 5. After bootstrap, delete only mirrors whose stub was NOT refreshed
            //    (events absent from Google's full-sync → genuine deletes/ghosts).
            let mirror_snapshot = snapshot_google_mirror_ulids(root, calendar_id);
            clear_sync_token(&conn, calendar_id)?;
            state::clear_clean_entries(&conn)?;
            seed_mirror_stubs(&mut conn, &mirror_snapshot)?;
            run_bootstrap(root, cfg, &mut conn, &mut result, tokens, http, calendar_id)?;
            delete_stale_mirror_files(root, &conn, &mirror_snapshot)?;
        }
    }

    // ── 3. PUSH (outbox drain) ────────────────────────────────────────────────
    run_push(root, cfg, &mut conn, &mut result, tokens, http, calendar_id)?;

    // ── 4. RESOLVE conflicts (S6.3) ──────────────────────────────────────────
    // All detected conflicts (pull-diverged, both-sides-changed, push-412,
    // remote-delete-of-promoted) are now auto-resolved per the ADR-0004
    // source-of-truth matrix.  Each resolution is written to the audit log.
    if !result.conflicts.is_empty() {
        let conflicts = std::mem::take(&mut result.conflicts);
        let (resolved, unresolved) = resolve_all_conflicts(
            root,
            &mut conn,
            conflicts,
            &tokens.access_token,
            http,
            calendar_id,
        )?;
        result.resolved += resolved;
        result.conflicts = unresolved;
    }

    // Refresh the derived index after all file writes (pull + resolution)
    let _errs = api::refresh(root)?;

    Ok(result)
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

fn run_bootstrap<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    conn: &mut rusqlite::Connection,
    result: &mut SyncResult,
    tokens: &mut TokenSet,
    http: &H,
    calendar_id: &str,
) -> crate::Result<()> {
    // Bootstrap window: 1 year back from now
    let time_min = (Utc::now() - chrono::Duration::days(365))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut page_token: Option<String> = None;

    loop {
        let client = CalendarClient {
            http,
            calendar_id,
            access_token: &tokens.access_token,
        };
        let list = client.list_bootstrap(page_token.as_deref(), &time_min)?;

        if list.full_sync_required {
            // Shouldn't happen during bootstrap itself, but guard it.
            return Err(JinError::Offline(
                "Unexpected 410 during bootstrap".to_string(),
            ));
        }

        for item in &list.items {
            process_incoming_event(root, cfg, conn, result, item, calendar_id)?;
        }

        if let Some(next_sync_token) = list.next_sync_token {
            set_sync_token(conn, calendar_id, &next_sync_token)?;
            break;
        }

        match list.next_page_token {
            Some(pt) => page_token = Some(pt),
            None => break,
        }
    }

    Ok(())
}

// ── Incremental ───────────────────────────────────────────────────────────────

/// Returns `true` when HTTP 410 was returned → caller should wipe + re-bootstrap.
#[allow(clippy::too_many_arguments)]
fn run_incremental<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    conn: &mut rusqlite::Connection,
    result: &mut SyncResult,
    tokens: &mut TokenSet,
    http: &H,
    calendar_id: &str,
    sync_token: &str,
) -> crate::Result<bool> {
    let client = CalendarClient {
        http,
        calendar_id,
        access_token: &tokens.access_token,
    };
    let mut page_token = None;
    loop {
        let list = client.list_incremental_page(sync_token, page_token.as_deref())?;

        if list.full_sync_required {
            return Ok(true); // caller handles 410
        }

        for item in &list.items {
            process_incoming_event(root, cfg, conn, result, item, calendar_id)?;
        }

        page_token = list.next_page_token;
        if page_token.is_some() {
            continue;
        }
        if let Some(next_sync_token) = list.next_sync_token {
            set_sync_token(conn, calendar_id, &next_sync_token)?;
        }
        break;
    }

    Ok(false)
}

// ── 410 reconciling helpers ───────────────────────────────────────────────────

/// Build an ical_uid → ULID mapping from source=Google mirror files on disk.
///
/// Called BEFORE wiping sync-state on HTTP 410 so the reconciling bootstrap can
/// reuse existing file paths and ULIDs, preserving any outgoing edges
/// (e.g. note `prep-for`→event) across token expiry / full re-sync cycles.
fn snapshot_google_mirror_ulids(
    root: &Path,
    calendar_id: &str,
) -> std::collections::HashMap<String, String> {
    let events_dir = root.join("events");
    let mut map = std::collections::HashMap::new();
    let Ok(entries) = std::fs::read_dir(&events_dir) else {
        return map;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(event) = fs::read_event(&path) {
            if event.frontmatter.source == EventSource::Google
                && event.frontmatter.calendar_id == calendar_id
            {
                if let Some(uid) = event.frontmatter.ical_uid {
                    map.insert(uid, event.frontmatter.id);
                }
            }
        }
    }
    map
}

/// Re-seed the sync-state with minimal stub entries from the disk snapshot.
///
/// Each stub has `last_synced_at = NULL`.  After bootstrap, stubs that remain
/// NULL were not seen in Google's full-sync response → they are stale and should
/// be cleaned up by `delete_stale_mirror_files`.
fn seed_mirror_stubs(
    conn: &mut rusqlite::Connection,
    snapshot: &std::collections::HashMap<String, String>,
) -> crate::Result<()> {
    for (ical_uid, ulid) in snapshot {
        state::upsert_entry(
            conn,
            &EventSyncEntry {
                jin_id: ulid.clone(),
                google_event_id: None,
                ical_uid: Some(ical_uid.clone()),
                etag: None,
                google_updated: None,
                dirty: false,
                last_synced_at: None, // NULL = seeded stub (not yet refreshed by bootstrap)
            },
        )?;
    }
    Ok(())
}

/// Delete mirror files for events absent from the bootstrap full-sync result.
///
/// A stub with `last_synced_at = NULL` after bootstrap means Google did not return
/// that event in the full-sync window (genuine delete or outside the time window).
/// The mirror file is removed and the stale stub is deleted from sync-state.
fn delete_stale_mirror_files(
    root: &Path,
    conn: &rusqlite::Connection,
    snapshot: &std::collections::HashMap<String, String>,
) -> crate::Result<()> {
    let events_dir = root.join("events");
    for ulid in snapshot.values() {
        let entry = state::get_entry_by_jin_id(conn, ulid)?;
        let was_refreshed = entry
            .as_ref()
            .map(|e| e.last_synced_at.is_some())
            .unwrap_or(false);
        if !was_refreshed {
            // Not seen in bootstrap → stale mirror → remove file and stub
            let path = events_dir.join(format!("{ulid}.md"));
            let _ = std::fs::remove_file(&path);
            if entry.is_some() {
                let _ = state::delete_entry(conn, ulid);
            }
        }
    }
    Ok(())
}

// ── C1 helper: re-link jin-origin event after 410 sync-state wipe ────────────

/// Try to find an existing Jin-origin event whose base32hex(ULID) == `google_event_id`.
///
/// After a 410 wipe, the sync-state entries for clean Jin-origin events are
/// deleted.  Without re-linkage, bootstrap would mint a fresh ULID and create a
/// SECOND file for the same event.  This function decodes the deterministic ID
/// back to a ULID, checks the file exists and is `source=Jin`, and returns a
/// synthetic `EventSyncEntry` so the caller can re-use the existing file.
///
/// Returns `None` for any Google-native opaque event ID (wrong length,
/// non-base32hex chars, or no matching local file).
fn relink_jin_origin(root: &Path, google_event_id: &str) -> Option<EventSyncEntry> {
    let ulid_str = google_event_id_to_ulid(google_event_id)?;
    let event_path = root.join("events").join(format!("{ulid_str}.md"));
    if !event_path.exists() {
        return None;
    }
    let event = fs::read_event(&event_path).ok()?;
    if event.frontmatter.source != EventSource::Jin {
        return None;
    }
    Some(EventSyncEntry {
        jin_id: ulid_str,
        google_event_id: Some(google_event_id.to_string()),
        ical_uid: event.frontmatter.ical_uid,
        etag: None,
        google_updated: None,
        dirty: false,
        last_synced_at: None,
    })
}

// ── Process a single incoming Google event ────────────────────────────────────

fn process_incoming_event(
    root: &Path,
    _cfg: &Config,
    conn: &mut rusqlite::Connection,
    result: &mut SyncResult,
    item: &serde_json::Value,
    calendar_id: &str,
) -> crate::Result<()> {
    let google_event_id = item
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let remote_etag = item
        .get("etag")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let google_updated = item
        .get("updated")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let ical_uid = item
        .get("iCalUID")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let is_cancelled = item
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| s == "cancelled")
        .unwrap_or(false);

    // ── C1: Three-phase lookup for an existing sync entry ─────────────────────
    // Phase 1: by google_event_id (normal incremental path)
    let existing = state::get_entry_by_google_id(conn, &google_event_id)?;
    // Phase 2: by ical_uid (fallback after 410 wipe for Google-origin events)
    let existing = if existing.is_none() {
        if let Some(ref uid) = ical_uid {
            state::get_entry_by_ical_uid(conn, uid)?
        } else {
            None
        }
    } else {
        existing
    };
    // Phase 3: reverse base32hex decode (re-link Jin-origin events after 410 wipe)
    let existing = if existing.is_none() {
        relink_jin_origin(root, &google_event_id)
    } else {
        existing
    };

    // ── Conflict detection (both-sides-changed) ───────────────────────────────
    // If we have a local entry, it's dirty (local edits pending), AND the
    // incoming etag differs from what we last saw → both sides changed.
    if let Some(ref e) = existing {
        if e.dirty {
            let local_etag = e.etag.clone();
            if local_etag.as_deref() != remote_etag.as_deref() {
                result.conflicts.push(ConflictInfo {
                    jin_id: e.jin_id.clone(),
                    google_event_id: Some(google_event_id.clone()),
                    ical_uid: ical_uid.clone(),
                    kind: ConflictKind::PullBothSidesChanged,
                    local_etag,
                    remote_etag: remote_etag.clone(),
                    // S6.3: include full remote payload + updated timestamp.
                    remote_event: Some(item.clone()),
                    remote_google_updated: google_updated.clone(),
                });
                // Do NOT overwrite the local file — S6.3 resolves.
                return Ok(());
            }
        }
    }

    let events_dir = root.join("events");

    // Determine the Jin ULID for this event.
    let jin_id = match &existing {
        Some(e) => e.jin_id.clone(),
        None => crate::id::new_ulid(),
    };

    // ── C2 + B: Authority guard with divergence / delete detection ──────────
    // Never downgrade a source=Jin event to a Google mirror.
    //
    // Three sub-cases when a pull sees a source=Jin event:
    //   A. Echo-back (etags match, or no stored etag after 410-wipe):
    //      We just pushed this event; Google echoed it back.
    //      Update sync-state metadata; leave the file unchanged.
    //
    //   B. Genuine remote divergence (stored etag != remote etag AND stored etag is
    //      non-None):  Someone edited the event on Google after we pushed it.
    //      Record a PullDiverged conflict so S6.3 can resolve it.
    //      Do NOT update the stored etag — preserve the conflict signal.
    //
    //   C. Remote delete: Google sends `status=cancelled` for a source=Jin event.
    //      Record a RemoteDeleteOfPromoted conflict so S6.3 can unpublish it.
    let event_path = events_dir.join(format!("{jin_id}.md"));
    if event_path.exists() {
        if let Ok(local) = fs::read_event(&event_path) {
            if local.frontmatter.source == EventSource::Jin {
                if is_cancelled {
                    // Sub-case C: remote deleted a Jin-origin event → unpublish.
                    result.conflicts.push(ConflictInfo {
                        jin_id: jin_id.clone(),
                        google_event_id: Some(google_event_id.clone()),
                        ical_uid: ical_uid.clone(),
                        kind: ConflictKind::RemoteDeleteOfPromoted,
                        local_etag: existing.as_ref().and_then(|e| e.etag.clone()),
                        remote_etag: remote_etag.clone(),
                        remote_event: None, // event deleted; no payload
                        remote_google_updated: google_updated.clone(),
                    });
                } else {
                    let stored_etag = existing.as_ref().and_then(|e| e.etag.clone());
                    // Only signal divergence when we have a known stored etag.
                    // stored_etag == None means post-410 re-link or first sight →
                    // treat as echo-back.
                    let is_echo_or_unknown =
                        stored_etag.is_none() || remote_etag.as_deref() == stored_etag.as_deref();

                    if is_echo_or_unknown {
                        // Sub-case A: Echo-back — refresh sync-state, leave file untouched.
                        let entry = EventSyncEntry {
                            jin_id: jin_id.clone(),
                            google_event_id: Some(google_event_id.clone()),
                            ical_uid: ical_uid
                                .clone()
                                .or_else(|| existing.as_ref().and_then(|e| e.ical_uid.clone())),
                            etag: remote_etag.clone(),
                            google_updated: google_updated.clone(),
                            dirty: existing.as_ref().map(|e| e.dirty).unwrap_or(false),
                            last_synced_at: Some(Utc::now().to_rfc3339()),
                        };
                        state::upsert_entry(conn, &entry)?;
                    } else {
                        // Sub-case B: genuine remote divergence — record conflict.
                        // Preserve the stored etag so the signal persists until S6.3.
                        result.conflicts.push(ConflictInfo {
                            jin_id: jin_id.clone(),
                            google_event_id: Some(google_event_id.clone()),
                            ical_uid: ical_uid.clone(),
                            kind: ConflictKind::PullDiverged,
                            local_etag: stored_etag,
                            remote_etag: remote_etag.clone(),
                            // S6.3: include full remote payload + updated timestamp.
                            remote_event: Some(item.clone()),
                            remote_google_updated: google_updated.clone(),
                        });
                        // Do NOT upsert — stored etag must stay unchanged.
                    }
                }
                // Do not increment pulled — no file was written.
                return Ok(());
            }
        }
    }

    // ── Handle cancelled (Google-origin events only reach here) ──────────────
    if is_cancelled {
        // Soft-delete the mirror file if it exists.
        if event_path.exists() {
            if let Ok(mut event) = fs::read_event(&event_path) {
                event.frontmatter.status = EventStatus::Cancelled;
                let _ = fs::write_event(&events_dir, &event);
            }
        }
        if existing.is_some() {
            state::delete_entry(conn, &jin_id)?;
        }
        return Ok(());
    }

    // ── Map Google resource → Jin frontmatter and write mirror file ───────────
    let fm = google_to_jin(item, &jin_id, calendar_id)?;

    std::fs::create_dir_all(&events_dir)?;
    let event = crate::model::Event {
        frontmatter: fm,
        body: String::new(),
    };
    fs::write_event(&events_dir, &event)?;

    // Update sync map
    let entry = EventSyncEntry {
        jin_id: jin_id.clone(),
        google_event_id: Some(google_event_id.clone()),
        ical_uid,
        etag: remote_etag.clone(),
        google_updated,
        dirty: false,
        last_synced_at: Some(Utc::now().to_rfc3339()),
    };
    state::upsert_entry(conn, &entry)?;

    result.pulled += 1;
    Ok(())
}

// ── Push (outbox drain) ───────────────────────────────────────────────────────

fn run_push<H: HttpClient>(
    root: &Path,
    _cfg: &Config,
    conn: &mut rusqlite::Connection,
    result: &mut SyncResult,
    tokens: &mut TokenSet,
    http: &H,
    calendar_id: &str,
) -> crate::Result<()> {
    let dirty = state::list_dirty(conn)?;
    let events_dir = root.join("events");

    for entry in dirty {
        // Read the local event file
        let event_path = events_dir.join(format!("{}.md", entry.jin_id));
        if !event_path.exists() {
            // Event file gone — skip (may have been deleted locally without being soft-deleted)
            state::set_dirty(conn, &entry.jin_id, false)?;
            continue;
        }
        let event = match fs::read_event(&event_path) {
            Ok(e) => e,
            Err(e) => {
                result
                    .errors
                    .push(format!("read event {}: {e}", entry.jin_id));
                continue;
            }
        };

        // Only push Jin-origin events (never push Google mirrors)
        if event.frontmatter.source == EventSource::Google {
            state::set_dirty(conn, &entry.jin_id, false)?;
            continue;
        }
        // Never push recurring events (read-only mirrors)
        if event.frontmatter.recurrence_unexpanded {
            state::set_dirty(conn, &entry.jin_id, false)?;
            continue;
        }

        let client = CalendarClient {
            http,
            calendar_id,
            access_token: &tokens.access_token,
        };

        // ── M5: Delete branch — propagate local cancellation to Google ────────
        if event.frontmatter.status == EventStatus::Cancelled {
            if let Some(ref google_id) = entry.google_event_id {
                // m10: require etag for safe deletion (no `*` wildcard)
                let stored_etag = match &entry.etag {
                    Some(e) => e.clone(),
                    None => {
                        result.conflicts.push(ConflictInfo {
                            jin_id: entry.jin_id.clone(),
                            google_event_id: Some(google_id.clone()),
                            ical_uid: entry.ical_uid.clone(),
                            kind: ConflictKind::PushPreconditionFailed,
                            local_etag: None,
                            remote_etag: None,
                            remote_event: None,
                            remote_google_updated: None,
                        });
                        continue;
                    }
                };

                let resp = client.delete_event(google_id, &stored_etag)?;
                match resp.status {
                    200 | 204 => {
                        state::delete_entry(conn, &entry.jin_id)?;
                        result.pushed += 1;
                    }
                    412 => {
                        result.conflicts.push(ConflictInfo {
                            jin_id: entry.jin_id.clone(),
                            google_event_id: Some(google_id.clone()),
                            ical_uid: entry.ical_uid.clone(),
                            kind: ConflictKind::PushPreconditionFailed,
                            local_etag: entry.etag.clone(),
                            remote_etag: None,
                            remote_event: None,
                            remote_google_updated: None,
                        });
                    }
                    _ => {
                        result.errors.push(format!(
                            "delete event {} returned status {}",
                            entry.jin_id, resp.status
                        ));
                    }
                }
            } else {
                // Never reached Google — just clear dirty
                state::set_dirty(conn, &entry.jin_id, false)?;
            }
            continue;
        }

        let body = jin_to_google(&event.frontmatter);

        if let Some(ref google_id) = entry.google_event_id {
            // ── UPDATE: patch with If-Match etag ─────────────────────────────
            // m10: require a stored etag — `*` weakens optimistic concurrency.
            let stored_etag = match &entry.etag {
                Some(e) => e.clone(),
                None => {
                    result.conflicts.push(ConflictInfo {
                        jin_id: entry.jin_id.clone(),
                        google_event_id: Some(google_id.clone()),
                        ical_uid: entry.ical_uid.clone(),
                        kind: ConflictKind::PushPreconditionFailed,
                        local_etag: None,
                        remote_etag: None,
                        remote_event: None,
                        remote_google_updated: None,
                    });
                    continue;
                }
            };

            let resp = client.patch_event(google_id, &stored_etag, body)?;
            match resp.status {
                200 | 201 => {
                    let new_etag = resp
                        .body
                        .get("etag")
                        .and_then(|v| v.as_str())
                        .or(resp.etag.as_deref())
                        .map(|s| s.to_string());
                    let new_updated = resp
                        .body
                        .get("updated")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let updated_entry = EventSyncEntry {
                        jin_id: entry.jin_id.clone(),
                        google_event_id: Some(google_id.clone()),
                        ical_uid: entry.ical_uid.clone(),
                        etag: new_etag,
                        google_updated: new_updated,
                        dirty: false,
                        last_synced_at: Some(Utc::now().to_rfc3339()),
                    };
                    state::upsert_entry(conn, &updated_entry)?;
                    result.pushed += 1;
                }
                412 => {
                    // Precondition failed → conflict (S6.3 resolves)
                    // remote_event is None here — the resolver will fetch it.
                    result.conflicts.push(ConflictInfo {
                        jin_id: entry.jin_id.clone(),
                        google_event_id: Some(google_id.clone()),
                        ical_uid: entry.ical_uid.clone(),
                        kind: ConflictKind::PushPreconditionFailed,
                        local_etag: entry.etag.clone(),
                        remote_etag: resp
                            .body
                            .get("etag")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        remote_event: None,
                        remote_google_updated: None,
                    });
                    // Leave dirty=true for S6.3 to retry after resolution
                }
                _ => {
                    result.errors.push(format!(
                        "patch event {} returned status {}",
                        entry.jin_id, resp.status
                    ));
                }
            }
        } else {
            // ── INSERT: client-specified base32hex(ULID) id (VG7) ────────────
            let google_event_id = ulid_to_google_event_id(&entry.jin_id)?;
            let resp = client.insert_event(&google_event_id, body)?;

            match resp.status {
                200 | 201 => {
                    let new_etag = resp
                        .body
                        .get("etag")
                        .and_then(|v| v.as_str())
                        .or(resp.etag.as_deref())
                        .map(|s| s.to_string());
                    let new_updated = resp
                        .body
                        .get("updated")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let new_ical_uid = resp
                        .body
                        .get("iCalUID")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // m11: write iCalUID back to the event file so future 410
                    // re-syncs can re-link via ical_uid lookup.
                    if let Some(ref uid) = new_ical_uid {
                        let ep = events_dir.join(format!("{}.md", entry.jin_id));
                        if let Ok(mut evt) = fs::read_event(&ep) {
                            evt.frontmatter.ical_uid = Some(uid.clone());
                            let _ = fs::write_event(&events_dir, &evt);
                        }
                    }

                    let updated_entry = EventSyncEntry {
                        jin_id: entry.jin_id.clone(),
                        google_event_id: Some(google_event_id.clone()),
                        ical_uid: new_ical_uid,
                        etag: new_etag,
                        google_updated: new_updated,
                        dirty: false,
                        last_synced_at: Some(Utc::now().to_rfc3339()),
                    };
                    state::upsert_entry(conn, &updated_entry)?;
                    result.pushed += 1;
                }
                // 409 Conflict = already exists (VG7 idempotent crash-safe insert)
                409 => {
                    let updated_entry = EventSyncEntry {
                        jin_id: entry.jin_id.clone(),
                        google_event_id: Some(google_event_id.clone()),
                        ical_uid: entry.ical_uid.clone(),
                        etag: None, // etag unknown from 409; will be refreshed on next pull
                        google_updated: None,
                        dirty: false,
                        last_synced_at: Some(Utc::now().to_rfc3339()),
                    };
                    state::upsert_entry(conn, &updated_entry)?;
                    result.pushed += 1;
                }
                _ => {
                    result.errors.push(format!(
                        "insert event {} returned status {}",
                        entry.jin_id, resp.status
                    ));
                }
            }
        }
    }

    Ok(())
}

// ── M4: Adapter to use the injected HttpClient for token refresh ──────────────

/// Wraps an `HttpClient` as an `HttpPost` so `refresh_access_token` can use
/// the injected client (enabling offline tests with `MockHttpClient`).
struct AsHttpPost<'a, H: HttpClient>(&'a H);

impl<'a, H: HttpClient> crate::google::auth::HttpPost for AsHttpPost<'a, H> {
    fn post_form(&self, url: &str, params: &[(&str, &str)]) -> crate::Result<serde_json::Value> {
        self.0.post_form(url, params)
    }
}

// ── Token refresh helper ──────────────────────────────────────────────────────

/// If the access token is expired (or within 5-minute window), refresh it using
/// the stored refresh_token.  Updates `tokens` in place and persists to the
/// secret store.
///
/// M4 fix: uses the injected `http` client instead of hardcoded `ReqwestPost`,
/// making this function testable offline.
fn refresh_if_needed<H: HttpClient>(
    root: &Path,
    cfg: &Config,
    tokens: &mut TokenSet,
    http: &H,
) -> crate::Result<()> {
    if !tokens.is_expired() {
        return Ok(());
    }

    let refresh_token = tokens.refresh_token.as_deref().ok_or_else(|| {
        JinError::Auth(
            "No refresh token stored. Run 'jin auth login' to re-authenticate.".to_string(),
        )
    })?;

    let creds = crate::google::config::GoogleCredentials::load(cfg)?;

    // M4: Route through the injected client (not hardcoded ReqwestPost)
    let new_tokens = crate::google::auth::refresh_access_token(
        &creds,
        refresh_token,
        crate::google::auth::GOOGLE_TOKEN_URL,
        &AsHttpPost(http),
    )?;

    crate::google::secrets::save_tokens(root, cfg, &new_tokens)?;
    *tokens = new_tokens;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google::client::{HttpResponse, MockHttpClient};
    use crate::google::secrets::TokenSet;
    use crate::ops::init;
    use crate::test_support::{EnvGuard, PASSPHRASE_ENV_LOCK};
    use tempfile::TempDir;

    fn make_token() -> TokenSet {
        TokenSet {
            access_token: "ya29.testToken".to_string(),
            refresh_token: Some("refresh_token".to_string()),
            expires_at: i64::MAX, // never expires in tests
            scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
            client_id: "test.apps.googleusercontent.com".to_string(),
            account: None,
        }
    }

    fn make_root() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_path_buf();
        init(&root).unwrap();
        (tmp, root)
    }

    fn google_event(id: &str, summary: &str, etag: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "iCalUID": format!("{id}@google.com"),
            "etag": etag,
            "status": "confirmed",
            "summary": summary,
            "start": {
                "dateTime": "2026-07-01T14:00:00",
                "timeZone": "America/Sao_Paulo"
            },
            "end": {
                "dateTime": "2026-07-01T14:30:00",
                "timeZone": "America/Sao_Paulo"
            },
            "sequence": 0,
            "created": "2026-06-01T00:00:00Z",
            "updated": "2026-06-26T09:00:00Z"
        })
    }

    fn insert_success_response(google_id: &str) -> HttpResponse {
        HttpResponse {
            status: 200,
            body: serde_json::json!({
                "id": google_id,
                "iCalUID": format!("{google_id}@google.com"),
                "etag": "\"new_etag_after_insert\"",
                "status": "confirmed",
                "summary": "My Event",
                "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                "end":   { "dateTime": "2026-07-01T14:30:00", "timeZone": "UTC" },
                "updated": "2026-06-26T10:00:00Z",
                "created": "2026-06-26T10:00:00Z",
                "sequence": 0
            }),
            etag: Some("\"new_etag_after_insert\"".to_string()),
        }
    }

    // ── BOOTSTRAP full-sync with pagination ───────────────────────────────────

    #[test]
    fn bootstrap_with_pagination_persists_sync_token() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();

        // Page 1: has nextPageToken, no nextSyncToken
        let page1 = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [google_event("gid1", "Event One", "\"etag1\"")],
                "nextPageToken": "page_token_for_p2"
            }),
            etag: None,
        };
        // Page 2: has nextSyncToken, no nextPageToken
        let page2 = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [google_event("gid2", "Event Two", "\"etag2\"")],
                "nextSyncToken": "sync_tok_after_bootstrap"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![page1, page2]);
        let cfg = Config::load(&root).unwrap();

        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // Should have pulled 2 events
        assert_eq!(result.pulled, 2, "expected 2 pulled events");
        assert!(result.conflicts.is_empty());

        // Sync token must be persisted
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        let token = get_sync_token(&conn, "primary").unwrap();
        assert_eq!(
            token.as_deref(),
            Some("sync_tok_after_bootstrap"),
            "nextSyncToken must be persisted after bootstrap"
        );

        // Mirror event files must exist
        let events_dir = root.join("events");
        let event_files: Vec<_> = std::fs::read_dir(&events_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
            .collect();
        assert_eq!(event_files.len(), 2, "expected 2 mirror event files");
    }

    // ── INCREMENTAL applies deltas ─────────────────────────────────────────────

    #[test]
    fn incremental_applies_adds_and_cancellations() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        // Seed a sync token so we skip bootstrap
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        set_sync_token(&conn, "primary", "existing_sync_token").unwrap();
        drop(conn);

        // Incremental: one new event + one cancellation
        let incremental = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [
                    google_event("gid_new", "New Event", "\"etag_new\""),
                    {
                        "id": "gid_deleted",
                        "iCalUID": "gid_deleted@google.com",
                        "etag": "\"etag_del\"",
                        "status": "cancelled",
                        "summary": "Deleted Event",
                        "start": { "dateTime": "2026-07-01T10:00:00", "timeZone": "UTC" },
                        "end":   { "dateTime": "2026-07-01T11:00:00", "timeZone": "UTC" },
                        "sequence": 0,
                        "created": "2026-06-01T00:00:00Z",
                        "updated": "2026-06-26T09:00:00Z"
                    }
                ],
                "nextSyncToken": "sync_tok_after_incremental"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![incremental]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // 1 new event pulled (cancelled one doesn't count as a pull)
        assert_eq!(result.pulled, 1, "expected 1 new event pulled");
        assert!(
            result.errors.is_empty(),
            "no errors expected: {:?}",
            result.errors
        );

        // New sync token persisted
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let tok = get_sync_token(&conn2, "primary").unwrap();
        assert_eq!(tok.as_deref(), Some("sync_tok_after_incremental"));
    }

    // ── HTTP 410 → wipe + full re-sync ────────────────────────────────────────

    #[test]
    fn http_410_triggers_wipe_and_full_resync() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        // Seed a stale sync token
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        set_sync_token(&conn, "primary", "stale_token_about_to_expire").unwrap();
        drop(conn);

        let gone_response = HttpResponse {
            status: 410,
            body: serde_json::json!({"error": {"code": 410, "message": "Sync token is no longer valid, a full sync is required."}}),
            etag: None,
        };
        // Bootstrap response after 410
        let bootstrap_response = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [google_event("gid_fresh", "Fresh Event", "\"etag_fresh\"")],
                "nextSyncToken": "fresh_sync_token"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![gone_response, bootstrap_response]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.pulled, 1, "should have pulled 1 event after re-sync");

        // New token after re-sync
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let tok = get_sync_token(&conn2, "primary").unwrap();
        assert_eq!(tok.as_deref(), Some("fresh_sync_token"));
    }

    // ── PUSH: idempotent insert with base32hex ULID ───────────────────────────

    #[test]
    fn push_insert_is_idempotent_base32hex_ulid() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        // Create a Jin-origin event file
        let jin_id = crate::id::new_ulid();
        let google_id = ulid_to_google_event_id(&jin_id).unwrap();

        // Create the event file on disk
        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let now = chrono::Utc::now().fixed_offset();
        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let event = crate::model::Event {
            frontmatter: crate::model::event::EventFrontmatter {
                id: jin_id.clone(),
                kind: "event".to_string(),
                title: "My Jin Event".to_string(),
                description: None,
                location: None,
                start: crate::model::event::TemporalValue::DateTime(dt),
                end: crate::model::event::TemporalValue::DateTime(dt),
                start_value_type: crate::model::event::ValueType::DateTime,
                end_value_type: crate::model::event::ValueType::DateTime,
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
                status: crate::model::event::EventStatus::Confirmed,
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
                source: crate::model::event::EventSource::Jin,
                authority: crate::model::event::EventSource::Jin,
                calendar_id: "primary".to_string(),
                derived_from: None,
            },
            body: String::new(),
        };
        fs::write_event(&events_dir, &event).unwrap();

        // Enqueue the event as dirty (outbox)
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::enqueue_dirty(&conn, &jin_id).unwrap();
        // Seed a sync token so PULL is incremental + returns immediately
        set_sync_token(&conn, "primary", "existing_tok").unwrap();
        drop(conn);

        // PULL: empty incremental (no new events)
        let incremental_empty = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [],
                "nextSyncToken": "tok_after_incremental"
            }),
            etag: None,
        };
        // PUSH: insert succeeds
        let insert_resp = insert_success_response(&google_id);

        let mock = MockHttpClient::new(vec![incremental_empty, insert_resp]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.pushed, 1, "should have pushed 1 event");
        assert!(result.conflicts.is_empty());

        // Verify idempotency: a second run with a 409 response should succeed
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let entry = state::get_entry_by_jin_id(&conn2, &jin_id)
            .unwrap()
            .unwrap();
        assert!(
            !entry.dirty,
            "event must be marked not dirty after successful push"
        );
        assert_eq!(
            entry.google_event_id.as_deref(),
            Some(google_id.as_str()),
            "google_event_id must match base32hex(ULID)"
        );
    }

    // ── PUSH patch with If-Match and 412 conflict detection ──────────────────

    #[test]
    fn push_patch_412_detected_as_conflict() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let jin_id = crate::id::new_ulid();
        let google_id = "existing_google_event_id";

        // Create the event file
        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let now = chrono::Utc::now().fixed_offset();
        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let event = crate::model::Event {
            frontmatter: crate::model::event::EventFrontmatter {
                id: jin_id.clone(),
                kind: "event".to_string(),
                title: "Updated Event".to_string(),
                description: None,
                location: None,
                start: crate::model::event::TemporalValue::DateTime(dt),
                end: crate::model::event::TemporalValue::DateTime(dt),
                start_value_type: crate::model::event::ValueType::DateTime,
                end_value_type: crate::model::event::ValueType::DateTime,
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
                sequence: 1,
                status: crate::model::event::EventStatus::Confirmed,
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
                source: crate::model::event::EventSource::Jin,
                authority: crate::model::event::EventSource::Jin,
                calendar_id: "primary".to_string(),
                derived_from: None,
            },
            body: String::new(),
        };
        fs::write_event(&events_dir, &event).unwrap();

        // Set up sync state: event already pushed (has google_event_id + etag), now dirty again
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: Some(google_id.to_string()),
                ical_uid: Some(format!("{google_id}@google.com")),
                etag: Some("\"our_known_etag\"".to_string()),
                google_updated: Some("2026-06-20T00:00:00Z".to_string()),
                dirty: true, // local change pending
                last_synced_at: None,
            },
        )
        .unwrap();
        // Seed a sync token to skip bootstrap
        set_sync_token(&conn, "primary", "tok").unwrap();
        drop(conn);

        // PULL: empty
        let pull_empty = HttpResponse {
            status: 200,
            body: serde_json::json!({ "items": [], "nextSyncToken": "tok2" }),
            etag: None,
        };
        // PUSH: 412 precondition failed
        let patch_412 = HttpResponse {
            status: 412,
            body: serde_json::json!({
                "error": {
                    "code": 412,
                    "message": "Precondition Failed"
                }
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![pull_empty, patch_412]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.conflicts.len(), 1, "expected 1 conflict");
        let c = &result.conflicts[0];
        assert_eq!(c.kind, ConflictKind::PushPreconditionFailed);
        assert_eq!(c.jin_id, jin_id);

        // Event must remain dirty (for S6.3 to handle)
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let entry = state::get_entry_by_jin_id(&conn2, &jin_id)
            .unwrap()
            .unwrap();
        assert!(
            entry.dirty,
            "event must remain dirty after 412 (awaiting S6.3 resolution)"
        );
    }

    // ── Recurring event: mirrored read-only, never pushed ────────────────────

    #[test]
    fn recurring_event_mirrored_with_unexpanded_flag_never_pushed() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let recurring = serde_json::json!({
            "id": "recurring_master",
            "iCalUID": "recurring_master@google.com",
            "etag": "\"etag_rec\"",
            "status": "confirmed",
            "summary": "Weekly Team Sync",
            "start": {
                "dateTime": "2026-07-01T09:00:00",
                "timeZone": "America/New_York"
            },
            "end": {
                "dateTime": "2026-07-01T09:30:00",
                "timeZone": "America/New_York"
            },
            "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"],
            "sequence": 0,
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-06-26T09:00:00Z"
        });

        let bootstrap = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [recurring],
                "nextSyncToken": "tok_rec"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![bootstrap]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.pulled, 1);
        assert_eq!(result.pushed, 0, "recurring events must never be pushed");

        // Verify the file has recurrence_unexpanded=true
        let events_dir = root.join("events");
        let paths = fs::list_event_paths(&events_dir).unwrap();
        assert_eq!(paths.len(), 1);
        let event = fs::read_event(&paths[0]).unwrap();
        assert!(
            event.frontmatter.recurrence_unexpanded,
            "mirrored recurring event must be flagged recurrence_unexpanded"
        );
        assert_eq!(
            event.frontmatter.recurrence,
            vec!["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"]
        );
    }

    // ── Google-authored event flagged source/authority=google ─────────────────

    #[test]
    fn google_authored_event_written_with_correct_source_authority() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let bootstrap = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [google_event("company_event", "All Hands", "\"etag_ah\"")],
                "nextSyncToken": "tok_ah"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![bootstrap]);
        run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        let events_dir = root.join("events");
        let paths = fs::list_event_paths(&events_dir).unwrap();
        assert_eq!(paths.len(), 1);
        let event = fs::read_event(&paths[0]).unwrap();
        assert_eq!(
            event.frontmatter.source,
            crate::model::event::EventSource::Google
        );
        assert_eq!(
            event.frontmatter.authority,
            crate::model::event::EventSource::Google
        );
        assert_eq!(
            event.frontmatter.ical_uid.as_deref(),
            Some("company_event@google.com")
        );
    }

    // ── C1: 410 no duplicates + source=jin preserved ─────────────────────────

    /// Seed a Google-mirror event + a Jin-origin event with sync-state, trigger
    /// a 410 (stale sync token), and verify:
    /// (a) No duplicate files after re-bootstrap.
    /// (b) The source=jin event file is preserved with its original content.
    /// (c) An event that Google deleted during the gap produces no ghost file.
    #[test]
    fn c1_410_no_duplicate_files_and_source_jin_preserved() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();

        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();

        // ── (1) Seed a Google-mirror event ───────────────────────────────────
        let mirror_jin_id = crate::id::new_ulid();
        let mirror_google_id = "gid_mirror_event";
        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let now = chrono::Utc::now().fixed_offset();
        {
            let event = crate::model::Event {
                frontmatter: crate::model::event::EventFrontmatter {
                    id: mirror_jin_id.clone(),
                    kind: "event".to_string(),
                    title: "Google Mirror Event".to_string(),
                    description: None,
                    location: None,
                    start: crate::model::event::TemporalValue::DateTime(dt),
                    end: crate::model::event::TemporalValue::DateTime(dt),
                    start_value_type: crate::model::event::ValueType::DateTime,
                    end_value_type: crate::model::event::ValueType::DateTime,
                    is_all_day: false,
                    start_tzid: Some("UTC".to_string()),
                    end_tzid: Some("UTC".to_string()),
                    floating: false,
                    recurrence: vec![],
                    recurring_event_id: None,
                    original_start: None,
                    master_id: None,
                    recurrence_unexpanded: false,
                    ical_uid: Some(format!("{mirror_google_id}@google.com")),
                    sequence: 0,
                    status: crate::model::event::EventStatus::Confirmed,
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
                    source: crate::model::event::EventSource::Google,
                    authority: crate::model::event::EventSource::Google,
                    calendar_id: "primary".to_string(),
                    derived_from: None,
                },
                body: String::new(),
            };
            fs::write_event(&events_dir, &event).unwrap();
            state::upsert_entry(
                &conn,
                &EventSyncEntry {
                    jin_id: mirror_jin_id.clone(),
                    google_event_id: Some(mirror_google_id.to_string()),
                    ical_uid: Some(format!("{mirror_google_id}@google.com")),
                    etag: Some("\"etag_mirror\"".to_string()),
                    google_updated: Some("2026-06-01T00:00:00Z".to_string()),
                    dirty: false,
                    last_synced_at: None,
                },
            )
            .unwrap();
        }

        // ── (2) Seed a Jin-origin event (simulates a previously pushed event) ─
        let jin_event_id = crate::id::new_ulid();
        let jin_google_id = ulid_to_google_event_id(&jin_event_id).unwrap();
        let jin_derived = "TASK001".to_string();
        {
            let event = crate::model::Event {
                frontmatter: crate::model::event::EventFrontmatter {
                    id: jin_event_id.clone(),
                    kind: "event".to_string(),
                    title: "My Promoted Task".to_string(),
                    description: Some("task body preserved".to_string()),
                    location: None,
                    start: crate::model::event::TemporalValue::DateTime(dt),
                    end: crate::model::event::TemporalValue::DateTime(dt),
                    start_value_type: crate::model::event::ValueType::DateTime,
                    end_value_type: crate::model::event::ValueType::DateTime,
                    is_all_day: false,
                    start_tzid: Some("UTC".to_string()),
                    end_tzid: Some("UTC".to_string()),
                    floating: false,
                    recurrence: vec![],
                    recurring_event_id: None,
                    original_start: None,
                    master_id: None,
                    recurrence_unexpanded: false,
                    ical_uid: Some(format!("{jin_google_id}@google.com")),
                    sequence: 0,
                    status: crate::model::event::EventStatus::Confirmed,
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
                    source: crate::model::event::EventSource::Jin,
                    authority: crate::model::event::EventSource::Jin,
                    calendar_id: "primary".to_string(),
                    derived_from: Some(jin_derived.clone()),
                },
                body: "task body preserved".to_string(),
            };
            fs::write_event(&events_dir, &event).unwrap();
            state::upsert_entry(
                &conn,
                &EventSyncEntry {
                    jin_id: jin_event_id.clone(),
                    google_event_id: Some(jin_google_id.clone()),
                    ical_uid: Some(format!("{jin_google_id}@google.com")),
                    etag: Some("\"etag_jin_pushed\"".to_string()),
                    google_updated: Some("2026-06-10T00:00:00Z".to_string()),
                    dirty: false, // successfully pushed → clean in sync-state
                    last_synced_at: None,
                },
            )
            .unwrap();
        }

        // Seed a stale sync token to trigger incremental → 410
        set_sync_token(&conn, "primary", "stale_token").unwrap();
        drop(conn);

        // ── Responses: 410 → bootstrap (mirror re-appears, ghost deleted) ────
        let gone_resp = HttpResponse {
            status: 410,
            body: serde_json::json!({"error": {"code": 410}}),
            etag: None,
        };
        // Bootstrap returns: mirror event + a "ghost" that Google deleted
        let bootstrap_resp = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [
                    // The mirror event comes back (not deleted on Google)
                    google_event(mirror_google_id, "Google Mirror Event", "\"etag_mirror_v2\""),
                    // The jin-origin event echoes back (was pushed before the 410 gap)
                    {
                        "id": jin_google_id,
                        "iCalUID": format!("{jin_google_id}@google.com"),
                        "etag": "\"etag_jin_echo\"",
                        "status": "confirmed",
                        "summary": "My Promoted Task",
                        "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                        "end":   { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
                        "sequence": 0,
                        "created": "2026-06-01T00:00:00Z",
                        "updated": "2026-06-10T00:00:01Z"
                    },
                    // (c) A ghost event that Google deleted during the 410 gap
                    {
                        "id": "gid_ghost_deleted",
                        "iCalUID": "gid_ghost_deleted@google.com",
                        "etag": "\"etag_ghost\"",
                        "status": "cancelled",
                        "summary": "Ghost",
                        "start": { "dateTime": "2026-07-02T10:00:00", "timeZone": "UTC" },
                        "end":   { "dateTime": "2026-07-02T11:00:00", "timeZone": "UTC" },
                        "sequence": 0,
                        "created": "2026-06-01T00:00:00Z",
                        "updated": "2026-07-01T00:00:00Z"
                    }
                ],
                "nextSyncToken": "token_after_410_bootstrap"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![gone_resp, bootstrap_resp]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // ── (a) No duplicate files ────────────────────────────────────────────
        // Expected: 2 files (mirror re-pulled + jin-origin preserved), no ghost
        let event_paths = fs::list_event_paths(&events_dir).unwrap();
        // Filter out cancelled files if present
        let active_events: Vec<_> = event_paths
            .iter()
            .filter_map(|p| fs::read_event(p).ok())
            .filter(|e| e.frontmatter.status != crate::model::event::EventStatus::Cancelled)
            .collect();

        assert_eq!(
            active_events.len(),
            2,
            "(a) Expected exactly 2 active event files after 410 re-sync; found {}.\nFiles: {:?}",
            active_events.len(),
            event_paths
        );
        assert_eq!(
            result.pulled,
            1, // only the Google-mirror re-pull writes/updates a file; the C2 guard
            // returns early for the jin-origin echo-back without incrementing
            "pulled count"
        );

        // ── (a2) Mirror event kept its ORIGINAL ULID and file path ───────────
        let mirror_path = events_dir.join(format!("{mirror_jin_id}.md"));
        assert!(
            mirror_path.exists(),
            "(a2) Mirror event must still be at its original ULID path after 410 reconciling re-sync"
        );
        let resynced_mirror = fs::read_event(&mirror_path).unwrap();
        assert_eq!(
            resynced_mirror.frontmatter.source,
            crate::model::event::EventSource::Google,
            "(a2) Re-synced mirror must remain source=Google"
        );

        // ── (b) source=jin event preserved ───────────────────────────────────
        let jin_path = events_dir.join(format!("{jin_event_id}.md"));
        assert!(
            jin_path.exists(),
            "(b) Jin-origin event file must still exist at original path"
        );
        let preserved = fs::read_event(&jin_path).unwrap();
        assert_eq!(
            preserved.frontmatter.source,
            crate::model::event::EventSource::Jin,
            "(b) source must remain jin"
        );
        assert_eq!(
            preserved.frontmatter.derived_from.as_deref(),
            Some("TASK001"),
            "(b) derived_from must be preserved"
        );

        // ── (c) Ghost (Google-deleted during gap) produces no file ────────────
        let ghost_files: Vec<_> = event_paths
            .iter()
            .filter_map(|p| fs::read_event(p).ok())
            .filter(|e| {
                e.frontmatter
                    .ical_uid
                    .as_deref()
                    .map(|u| u.contains("ghost_deleted"))
                    .unwrap_or(false)
                    && e.frontmatter.status != crate::model::event::EventStatus::Cancelled
            })
            .collect();
        assert!(
            ghost_files.is_empty(),
            "(c) Ghost event must not produce an active file"
        );
    }

    // ── C2: pull echo-back does not overwrite Jin-authority event ─────────────

    /// Push a promoted event, then pull it back via an incremental feed,
    /// and verify source=jin, derived_from, and body survive unchanged.
    #[test]
    fn c2_pull_echo_back_preserves_jin_authority_and_derived_from() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let jin_id = crate::id::new_ulid();
        let google_id = ulid_to_google_event_id(&jin_id).unwrap();
        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();

        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let now = chrono::Utc::now().fixed_offset();

        // Create a jin-origin promoted event (source=jin, has derived_from, body)
        let event = crate::model::Event {
            frontmatter: crate::model::event::EventFrontmatter {
                id: jin_id.clone(),
                kind: "event".to_string(),
                title: "Promoted Meeting".to_string(),
                description: Some("task body preserved after push+pull".to_string()),
                location: None,
                start: crate::model::event::TemporalValue::DateTime(dt),
                end: crate::model::event::TemporalValue::DateTime(dt),
                start_value_type: crate::model::event::ValueType::DateTime,
                end_value_type: crate::model::event::ValueType::DateTime,
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
                status: crate::model::event::EventStatus::Confirmed,
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
                source: crate::model::event::EventSource::Jin,
                authority: crate::model::event::EventSource::Jin,
                calendar_id: "primary".to_string(),
                derived_from: Some("ORIGIN_TASK_ID".to_string()),
            },
            body: "task body preserved after push+pull".to_string(),
        };
        fs::write_event(&events_dir, &event).unwrap();

        // Sync-state: event was pushed, has google_event_id + etag
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: Some(google_id.clone()),
                ical_uid: Some(format!("{google_id}@google.com")),
                etag: Some("\"pushed_etag\"".to_string()),
                google_updated: Some("2026-06-10T00:00:00Z".to_string()),
                dirty: false,
                last_synced_at: None,
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "tok_before_pull").unwrap();
        drop(conn);

        // Incremental: Google echoes the event back (as if we just synced after push)
        let echo_back = serde_json::json!({
            "id": google_id,
            "iCalUID": format!("{google_id}@google.com"),
            "etag": "\"pushed_etag\"",
            "status": "confirmed",
            "summary": "Promoted Meeting",  // same title
            "start": { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-07-01T14:00:00", "timeZone": "UTC" },
            "sequence": 0,
            "created": "2026-06-01T00:00:00Z",
            "updated": "2026-06-10T00:00:01Z"
        });

        let incremental = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [echo_back],
                "nextSyncToken": "tok_after_pull"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![incremental]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // C2: authority guard must have fired — no file overwrite
        assert!(
            result.conflicts.is_empty(),
            "no conflicts expected for echo-back"
        );

        let preserved = fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
        assert_eq!(
            preserved.frontmatter.source,
            crate::model::event::EventSource::Jin,
            "C2: source must remain jin after pull echo-back"
        );
        assert_eq!(
            preserved.frontmatter.derived_from.as_deref(),
            Some("ORIGIN_TASK_ID"),
            "C2: derived_from must be preserved after pull echo-back"
        );
        assert_eq!(
            preserved.body, "task body preserved after push+pull",
            "C2: body must be preserved after pull echo-back"
        );
    }

    // ── M3: promote auto-enqueues dirty + VG7 idempotent insert ──────────────

    /// promote → event is automatically enqueued as dirty → run_sync fires the
    /// insert, records google_event_id and clears dirty.
    /// Second sync with 409 (crash-safe retry) → treated as idempotent success.
    #[test]
    fn m3_promote_enqueues_dirty_and_push_fires_vg7_idempotent() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        // Create a task to promote
        let task = crate::ops::tasks::create_task(
            &cfg.tasks_dir(),
            crate::ops::tasks::CreateTaskParams {
                title: "Deploy v2".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: None,
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        let start_dt =
            chrono::NaiveDateTime::parse_from_str("2026-07-15T10:00:00", "%Y-%m-%dT%H:%M:%S")
                .unwrap();

        // Promote: this should enqueue the event as dirty
        let event = crate::ops::promote::promote(
            &root,
            task.id(),
            crate::ops::promote::PromoteParams {
                start_dt,
                tzid: Some("America/Sao_Paulo".to_string()),
            },
        )
        .unwrap();

        let jin_id = event.id().to_string();
        let expected_google_id = ulid_to_google_event_id(&jin_id).unwrap();

        // Verify event is in dirty outbox
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        let dirty = state::list_dirty(&conn).unwrap();
        assert_eq!(
            dirty.len(),
            1,
            "promote must enqueue exactly one dirty event"
        );
        assert_eq!(dirty[0].jin_id, jin_id);

        // Seed sync token so PULL is incremental
        set_sync_token(&conn, "primary", "tok_pre_push").unwrap();
        drop(conn);

        // ── Sync 1: empty pull + successful insert ────────────────────────────
        let pull_empty = HttpResponse {
            status: 200,
            body: serde_json::json!({ "items": [], "nextSyncToken": "tok1" }),
            etag: None,
        };
        let insert_ok = insert_success_response(&expected_google_id);

        let mock = MockHttpClient::new(vec![pull_empty, insert_ok]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.pushed, 1, "M3: push must fire and count 1 pushed");
        assert!(result.conflicts.is_empty());

        let conn2 = open_sync_db(&sync_dir).unwrap();
        let entry = state::get_entry_by_jin_id(&conn2, &jin_id)
            .unwrap()
            .expect("sync-state entry must exist after push");
        assert!(!entry.dirty, "dirty must be cleared after successful push");
        assert_eq!(
            entry.google_event_id.as_deref(),
            Some(expected_google_id.as_str()),
            "google_event_id must be recorded"
        );

        // ── Sync 2: VG7 idempotent retry — simulate crash-recovery 409 ─────────
        // Force dirty=true to simulate a crash-recovery scenario where the
        // previous push succeeded on Google but the client didn't record it.
        state::set_dirty(&conn2, &jin_id, true).unwrap();
        // Reset google_event_id so it goes through the INSERT path again
        state::upsert_entry(
            &conn2,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: None, // no google_event_id → INSERT path
                ical_uid: entry.ical_uid.clone(),
                etag: None,
                google_updated: None,
                dirty: true,
                last_synced_at: None,
            },
        )
        .unwrap();
        drop(conn2);

        let pull_empty2 = HttpResponse {
            status: 200,
            body: serde_json::json!({ "items": [], "nextSyncToken": "tok2" }),
            etag: None,
        };
        let insert_409 = HttpResponse {
            status: 409,
            body: serde_json::json!({ "error": { "code": 409, "message": "The requested identifier already exists." } }),
            etag: None,
        };

        let mock2 = MockHttpClient::new(vec![pull_empty2, insert_409]);
        let result2 = run_sync(&root, &cfg, &mut tokens, &mock2).unwrap();

        // VG7: 409 must be treated as idempotent success
        assert_eq!(result2.pushed, 1, "VG7: 409 retry must count as 1 pushed");
        assert!(
            result2.conflicts.is_empty(),
            "VG7: 409 must not be a conflict"
        );

        let conn3 = open_sync_db(&sync_dir).unwrap();
        let entry3 = state::get_entry_by_jin_id(&conn3, &jin_id)
            .unwrap()
            .expect("entry must still exist");
        assert!(
            !entry3.dirty,
            "VG7: dirty must be false after 409 idempotent success"
        );
    }

    // ── M4: token refresh uses injected HTTP client (not hardcoded ReqwestPost) ─

    /// Expired token + injected mock → refresh succeeds, access_token updated.
    #[test]
    fn m4_expired_token_refresh_uses_injected_http() {
        let (_tmp, root) = make_root();

        // Set up google credentials in config
        {
            let mut cfg = Config::load(&root).unwrap();
            cfg.google.client_id = Some("test-client-id.apps.googleusercontent.com".to_string());
            cfg.google.client_secret = Some("test-secret-m4".to_string());
            cfg.token_backend = "file".to_string();
            cfg.save().unwrap();
        }
        let cfg = Config::load(&root).unwrap();

        // Hold the env-var lock for the duration of run_sync, which internally
        // calls save_tokens (token refresh) — that call reads JIN_TOKEN_PASSPHRASE.
        let _passphrase_guard = EnvGuard::set(
            "JIN_TOKEN_PASSPHRASE",
            "m4-test-passphrase",
            &PASSPHRASE_ENV_LOCK,
        );

        let mut tokens = crate::google::secrets::TokenSet {
            access_token: "old_expired_token".to_string(),
            refresh_token: Some("refresh_tok_for_m4".to_string()),
            expires_at: 0, // expired at epoch
            scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
            client_id: "test-client-id.apps.googleusercontent.com".to_string(),
            account: None,
        };

        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        set_sync_token(&conn, "primary", "existing_tok_m4").unwrap();
        drop(conn);

        // Mock: first call = token refresh (post_form), second = empty incremental pull
        let refresh_resp = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "access_token": "ya29.new_refreshed_token",
                "expires_in": 3600,
                "scope": "https://www.googleapis.com/auth/calendar.events",
                "token_type": "Bearer"
            }),
            etag: None,
        };
        let pull_empty = HttpResponse {
            status: 200,
            body: serde_json::json!({ "items": [], "nextSyncToken": "tok_after_m4" }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![refresh_resp, pull_empty]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock);
        // Guard dropped here — env var restored to prior value.
        drop(_passphrase_guard);

        let result = result.expect("M4: run_sync must succeed with injected refresh client");
        assert_eq!(
            tokens.access_token, "ya29.new_refreshed_token",
            "M4: access_token must be updated by refresh via injected HTTP client"
        );
        assert_eq!(result.pulled, 0);
    }

    /// Expired token + injected mock returning invalid_grant → JinError::Auth (exit 5).
    #[test]
    fn m4_invalid_grant_refresh_returns_auth_error() {
        let (_tmp, root) = make_root();

        {
            let mut cfg = Config::load(&root).unwrap();
            cfg.google.client_id = Some("test-client-id.apps.googleusercontent.com".to_string());
            cfg.google.client_secret = Some("test-secret-m4".to_string());
            cfg.save().unwrap();
        }
        let cfg = Config::load(&root).unwrap();

        let mut tokens = crate::google::secrets::TokenSet {
            access_token: "expired".to_string(),
            refresh_token: Some("revoked_refresh_tok".to_string()),
            expires_at: 0,
            scope: "https://www.googleapis.com/auth/calendar.events".to_string(),
            client_id: "test-client-id.apps.googleusercontent.com".to_string(),
            account: None,
        };

        // Mock: invalid_grant — save_tokens is never reached
        let invalid_grant = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "error": "invalid_grant",
                "error_description": "Token has been expired or revoked."
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![invalid_grant]);
        let err = run_sync(&root, &cfg, &mut tokens, &mock)
            .expect_err("M4: invalid_grant must return an error");

        assert!(
            matches!(err, JinError::Auth(_)),
            "M4: invalid_grant must be JinError::Auth, got: {err:?}"
        );
    }

    // ── M5: cancelled Jin-origin event issues Google DELETE ───────────────────

    #[test]
    fn m5_cancelled_jin_event_issues_google_delete() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let jin_id = crate::id::new_ulid();
        let google_id = "google_event_to_delete";

        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let now = chrono::Utc::now().fixed_offset();

        // Create a Jin-origin event that has been soft-deleted (status=Cancelled)
        let event = crate::model::Event {
            frontmatter: crate::model::event::EventFrontmatter {
                id: jin_id.clone(),
                kind: "event".to_string(),
                title: "Meeting to Cancel".to_string(),
                description: None,
                location: None,
                start: crate::model::event::TemporalValue::DateTime(dt),
                end: crate::model::event::TemporalValue::DateTime(dt),
                start_value_type: crate::model::event::ValueType::DateTime,
                end_value_type: crate::model::event::ValueType::DateTime,
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
                // Locally deleted
                status: crate::model::event::EventStatus::Cancelled,
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
                source: crate::model::event::EventSource::Jin,
                authority: crate::model::event::EventSource::Jin,
                calendar_id: "primary".to_string(),
                derived_from: None,
            },
            body: String::new(),
        };
        fs::write_event(&events_dir, &event).unwrap();

        // Sync-state: event was previously pushed, has etag
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: Some(google_id.to_string()),
                ical_uid: Some(format!("{google_id}@google.com")),
                etag: Some("\"etag_for_delete\"".to_string()),
                google_updated: Some("2026-06-25T00:00:00Z".to_string()),
                dirty: true, // cancelled → dirty (pending delete push)
                last_synced_at: None,
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "tok_pre_delete").unwrap();
        drop(conn);

        // Mock: empty pull + 204 delete success
        let pull_empty = HttpResponse {
            status: 200,
            body: serde_json::json!({ "items": [], "nextSyncToken": "tok_after_delete" }),
            etag: None,
        };
        let delete_ok = HttpResponse {
            status: 204,
            body: serde_json::Value::Object(Default::default()),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![pull_empty, delete_ok]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert_eq!(result.pushed, 1, "M5: delete must be counted as pushed");
        assert!(result.conflicts.is_empty());

        // Sync-state entry must be removed after successful delete
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let entry = state::get_entry_by_jin_id(&conn2, &jin_id).unwrap();
        assert!(
            entry.is_none(),
            "M5: sync-state entry must be deleted after Google delete"
        );
    }

    // ── Both-sides-changed conflict detection (pull) ─────────────────────────

    #[test]
    fn pull_both_sides_changed_detected_as_conflict() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let jin_id = crate::id::new_ulid();
        let google_id = "remote_event_id";
        let old_etag = "\"old_etag\"";
        let new_etag = "\"new_remote_etag\""; // Google changed this

        // Seed sync state: event exists, locally dirty with old etag
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: Some(google_id.to_string()),
                ical_uid: Some(format!("{google_id}@google.com")),
                etag: Some(old_etag.to_string()),
                google_updated: Some("2026-06-01T00:00:00Z".to_string()),
                dirty: true, // local edits pending
                last_synced_at: None,
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "tok").unwrap();
        drop(conn);

        // Incremental: incoming update for same event with NEW etag
        let mut updated_event = google_event(google_id, "Event Updated Remotely", new_etag);
        updated_event["updated"] = serde_json::json!("2026-06-27T12:00:00Z");

        let incremental = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [updated_event],
                "nextSyncToken": "tok2"
            }),
            etag: None,
        };

        // No push response needed (conflict prevents push from running for this event,
        // but there's also no dirty events after the conflict detection skips writing)
        let mock = MockHttpClient::new(vec![incremental]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // One conflict detected: both sides changed
        assert_eq!(
            result.conflicts.len(),
            1,
            "expected 1 both-sides-changed conflict"
        );
        let c = &result.conflicts[0];
        assert_eq!(c.kind, ConflictKind::PullBothSidesChanged);
        assert_eq!(c.local_etag.as_deref(), Some(old_etag));
        assert_eq!(c.remote_etag.as_deref(), Some(new_etag));
    }

    // ── Finding B: clean Jin-origin event edited on Google → auto-resolved ────

    /// A clean (non-dirty) source=Jin event has etag v1 stored.
    /// An incremental pull returns it with etag v2 (genuinely edited on Google).
    /// S6.3 LWW: Google's updated (2026-07-15) > local (~2026-06-27) → Google wins.
    ///
    /// Expected post-S6.3:
    ///   - conflicts.len() == 0  (auto-resolved, not an error)
    ///   - result.resolved == 1
    ///   - File has Google's title; source=Jin and derived_from preserved (sovereignty)
    ///   - Stored etag bumped to v2; dirty=false (clean after resolution)
    ///   - Second pull with same etag v2 → echo-back, no new conflict
    #[test]
    fn b_clean_jin_event_remote_divergence_detected_as_pull_diverged() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let jin_id = crate::id::new_ulid();
        let google_id = ulid_to_google_event_id(&jin_id).unwrap();
        let events_dir = root.join("events");
        std::fs::create_dir_all(&events_dir).unwrap();

        let dt = chrono::NaiveDateTime::parse_from_str("2026-08-01T10:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let end_dt =
            chrono::NaiveDateTime::parse_from_str("2026-08-01T11:00:00", "%Y-%m-%dT%H:%M:%S")
                .unwrap();
        // Keep the LWW premise deterministic: the remote update below is newer
        // regardless of the wall clock on the machine running this test.
        let now = chrono::DateTime::parse_from_rfc3339("2026-06-27T12:00:00Z").unwrap();

        // Create clean (non-dirty) Jin-origin event
        let event = crate::model::Event {
            frontmatter: crate::model::event::EventFrontmatter {
                id: jin_id.clone(),
                kind: "event".to_string(),
                title: "Team Lunch".to_string(),
                description: Some("Original description".to_string()),
                location: None,
                start: crate::model::event::TemporalValue::DateTime(dt),
                end: crate::model::event::TemporalValue::DateTime(end_dt),
                start_value_type: crate::model::event::ValueType::DateTime,
                end_value_type: crate::model::event::ValueType::DateTime,
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
                status: crate::model::event::EventStatus::Confirmed,
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
                source: crate::model::event::EventSource::Jin,
                authority: crate::model::event::EventSource::Jin,
                calendar_id: "primary".to_string(),
                derived_from: Some("ORIG_TASK".to_string()),
            },
            body: "original body".to_string(),
        };
        fs::write_event(&events_dir, &event).unwrap();

        // Sync-state: clean entry with known stored etag (event was pushed cleanly)
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: jin_id.clone(),
                google_event_id: Some(google_id.clone()),
                ical_uid: Some(format!("{google_id}@google.com")),
                etag: Some("\"etag_v1\"".to_string()), // stored etag from last push
                google_updated: Some("2026-07-01T00:00:00Z".to_string()),
                dirty: false, // CLEAN — not dirty
                last_synced_at: Some("2026-07-01T00:01:00Z".to_string()),
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "tok_before_diverge").unwrap();
        drop(conn);

        // Pull: Google returns the same event with a DIFFERENT etag (edited on Google)
        let diverged_etag = "\"etag_v2\"";
        let incremental = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [{
                    "id": google_id,
                    "iCalUID": format!("{google_id}@google.com"),
                    "etag": diverged_etag,
                    "status": "confirmed",
                    "summary": "Team Lunch — Updated on Google",  // title changed on Google
                    "start": { "dateTime": "2026-08-01T10:00:00", "timeZone": "UTC" },
                    "end":   { "dateTime": "2026-08-01T11:00:00", "timeZone": "UTC" },
                    "sequence": 1,
                    "created": "2026-07-01T00:00:00Z",
                    "updated": "2026-07-15T12:00:00Z"
                }],
                "nextSyncToken": "tok_after_diverge"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![incremental]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        // S6.3: conflict was AUTO-RESOLVED within run_sync (not surfaced to caller).
        assert_eq!(
            result.conflicts.len(),
            0,
            "B: conflict must be auto-resolved (conflicts.len() == 0)"
        );
        assert_eq!(result.resolved, 1, "B: resolved count must be 1");

        // S6.3 LWW: remote updated (2026-07-15) > local (~2026-06-27) → Google wins.
        // File must have Google's title.
        let file_after = fs::read_event(&events_dir.join(format!("{jin_id}.md"))).unwrap();
        assert_eq!(
            file_after.frontmatter.title, "Team Lunch — Updated on Google",
            "B: Google's title must be applied (Google wins LWW)"
        );
        // Sovereignty invariants: source=jin and derived_from MUST be preserved.
        assert_eq!(
            file_after.frontmatter.source,
            crate::model::event::EventSource::Jin,
            "B: source=jin must be preserved after resolution"
        );
        assert_eq!(
            file_after.frontmatter.derived_from.as_deref(),
            Some("ORIG_TASK"),
            "B: derived_from must be preserved after resolution"
        );
        assert_eq!(
            file_after.body, "original body",
            "B: Jin body must be preserved after resolution"
        );

        // Stored etag must be bumped to v2 (resolution completed; signal cleared).
        let conn2 = open_sync_db(&sync_dir).unwrap();
        let entry2 = state::get_entry_by_jin_id(&conn2, &jin_id)
            .unwrap()
            .expect("sync-state entry must still exist after resolution");
        assert_eq!(
            entry2.etag.as_deref(),
            Some(diverged_etag),
            "B: stored etag must be updated to v2 after resolution"
        );
        assert!(
            !entry2.dirty,
            "B: dirty must be false after Google-wins resolution"
        );
        drop(conn2);

        // Second pull with same remote etag v2 → echo-back (etag matches, no new conflict).
        let mut tokens2 = make_token();
        let conn3 = open_sync_db(&sync_dir).unwrap();
        set_sync_token(&conn3, "primary", "tok_after_diverge").unwrap();
        drop(conn3);

        let second_pull = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [{
                    "id": google_id,
                    "iCalUID": format!("{google_id}@google.com"),
                    "etag": diverged_etag,
                    "status": "confirmed",
                    "summary": "Team Lunch — Updated on Google",
                    "start": { "dateTime": "2026-08-01T10:00:00", "timeZone": "UTC" },
                    "end":   { "dateTime": "2026-08-01T11:00:00", "timeZone": "UTC" },
                    "sequence": 1,
                    "created": "2026-07-01T00:00:00Z",
                    "updated": "2026-07-15T12:00:00Z"
                }],
                "nextSyncToken": "tok_v3"
            }),
            etag: None,
        };
        let mock2 = MockHttpClient::new(vec![second_pull]);
        let result2 = run_sync(&root, &cfg, &mut tokens2, &mock2).unwrap();

        assert_eq!(
            result2.conflicts.len(),
            0,
            "B: second pull must be clean (etag v2 matches stored v2 → echo-back)"
        );
        assert_eq!(
            result2.resolved, 0,
            "B: second pull must have no new resolutions"
        );
    }

    // ── 410 re-key: mirrors keep ULID, prep-for edges survive ────────────────

    /// Seed a source=Google mirror WITH a note prep-for→it edge, then trigger a 410.
    /// After reconciling re-sync the mirror must:
    ///   (a) Keep its ORIGINAL ULID and file path.
    ///   (b) The note's prep-for edge must not be dangling (api::list_dangling == 0).
    /// Separately: a mirror absent from the full-sync result must be deleted.
    #[test]
    fn c1_410_mirror_rekey_preserves_ulid_and_edges() {
        let (_tmp, root) = make_root();
        let mut tokens = make_token();
        let cfg = Config::load(&root).unwrap();

        let events_dir = root.join("events");
        let notes_dir = root.join("notes");
        std::fs::create_dir_all(&events_dir).unwrap();
        std::fs::create_dir_all(&notes_dir).unwrap();

        let dt = chrono::NaiveDateTime::parse_from_str("2026-09-01T09:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let now = chrono::Utc::now().fixed_offset();

        // ── Seed mirror event A (survives bootstrap) ──────────────────────────
        let mirror_a_id = crate::id::new_ulid();
        let mirror_a_gid = "gid_alpha";
        let mirror_a_ical = format!("{mirror_a_gid}@google.com");
        {
            let e = crate::model::Event {
                frontmatter: crate::model::event::EventFrontmatter {
                    id: mirror_a_id.clone(),
                    kind: "event".to_string(),
                    title: "Alpha Meeting".to_string(),
                    description: None,
                    location: None,
                    start: crate::model::event::TemporalValue::DateTime(dt),
                    end: crate::model::event::TemporalValue::DateTime(dt),
                    start_value_type: crate::model::event::ValueType::DateTime,
                    end_value_type: crate::model::event::ValueType::DateTime,
                    is_all_day: false,
                    start_tzid: Some("UTC".to_string()),
                    end_tzid: Some("UTC".to_string()),
                    floating: false,
                    recurrence: vec![],
                    recurring_event_id: None,
                    original_start: None,
                    master_id: None,
                    recurrence_unexpanded: false,
                    ical_uid: Some(mirror_a_ical.clone()),
                    sequence: 0,
                    status: crate::model::event::EventStatus::Confirmed,
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
                    source: crate::model::event::EventSource::Google,
                    authority: crate::model::event::EventSource::Google,
                    calendar_id: "primary".to_string(),
                    derived_from: None,
                },
                body: String::new(),
            };
            fs::write_event(&events_dir, &e).unwrap();
        }

        // ── Seed mirror event B (absent from bootstrap → should be deleted) ──
        let mirror_b_id = crate::id::new_ulid();
        let mirror_b_gid = "gid_beta_gone";
        let mirror_b_ical = format!("{mirror_b_gid}@google.com");
        {
            let e = crate::model::Event {
                frontmatter: crate::model::event::EventFrontmatter {
                    id: mirror_b_id.clone(),
                    kind: "event".to_string(),
                    title: "Beta Meeting — deleted on Google".to_string(),
                    description: None,
                    location: None,
                    start: crate::model::event::TemporalValue::DateTime(dt),
                    end: crate::model::event::TemporalValue::DateTime(dt),
                    start_value_type: crate::model::event::ValueType::DateTime,
                    end_value_type: crate::model::event::ValueType::DateTime,
                    is_all_day: false,
                    start_tzid: Some("UTC".to_string()),
                    end_tzid: Some("UTC".to_string()),
                    floating: false,
                    recurrence: vec![],
                    recurring_event_id: None,
                    original_start: None,
                    master_id: None,
                    recurrence_unexpanded: false,
                    ical_uid: Some(mirror_b_ical.clone()),
                    sequence: 0,
                    status: crate::model::event::EventStatus::Confirmed,
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
                    source: crate::model::event::EventSource::Google,
                    authority: crate::model::event::EventSource::Google,
                    calendar_id: "primary".to_string(),
                    derived_from: None,
                },
                body: String::new(),
            };
            fs::write_event(&events_dir, &e).unwrap();
        }

        // ── Create a note with a prep-for edge to mirror A ────────────────────
        let note = crate::ops::notes::create_note(
            &notes_dir,
            crate::ops::notes::CreateNoteParams {
                title: "Prep for Alpha Meeting".to_string(),
                body: "agenda items".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let note_id = note.frontmatter.id.clone();

        // Write the prep-for edge into the note's frontmatter
        crate::ops::attach::attach_note(&root, &note_id, &mirror_a_id, None).unwrap();

        // Rebuild index so the edge is tracked
        crate::ops::api::refresh(&root).unwrap();
        let dangling_before = crate::ops::api::list_dangling(&root).unwrap();
        assert!(
            dangling_before.is_empty(),
            "setup: no dangling edges before 410"
        );

        // ── Seed sync-state ───────────────────────────────────────────────────
        let sync_dir = cfg.sync_dir();
        let conn = open_sync_db(&sync_dir).unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: mirror_a_id.clone(),
                google_event_id: Some(mirror_a_gid.to_string()),
                ical_uid: Some(mirror_a_ical.clone()),
                etag: Some("\"etag_a1\"".to_string()),
                google_updated: Some("2026-08-01T00:00:00Z".to_string()),
                dirty: false,
                last_synced_at: None,
            },
        )
        .unwrap();
        state::upsert_entry(
            &conn,
            &EventSyncEntry {
                jin_id: mirror_b_id.clone(),
                google_event_id: Some(mirror_b_gid.to_string()),
                ical_uid: Some(mirror_b_ical.clone()),
                etag: Some("\"etag_b1\"".to_string()),
                google_updated: Some("2026-08-01T00:00:00Z".to_string()),
                dirty: false,
                last_synced_at: None,
            },
        )
        .unwrap();
        set_sync_token(&conn, "primary", "stale_token_for_rekey").unwrap();
        drop(conn);

        // ── Responses: 410 → bootstrap (only mirror A present; B is gone) ─────
        let gone = HttpResponse {
            status: 410,
            body: serde_json::json!({"error": {"code": 410}}),
            etag: None,
        };
        // Bootstrap only returns mirror A (B was deleted on Google)
        let bootstrap = HttpResponse {
            status: 200,
            body: serde_json::json!({
                "items": [google_event(mirror_a_gid, "Alpha Meeting", "\"etag_a2\"")],
                "nextSyncToken": "tok_after_rekey"
            }),
            etag: None,
        };

        let mock = MockHttpClient::new(vec![gone, bootstrap]);
        let result = run_sync(&root, &cfg, &mut tokens, &mock).unwrap();

        assert!(result.conflicts.is_empty());

        // ── (a) Mirror A must still be at its ORIGINAL file path (ULID preserved) ─
        let path_a = events_dir.join(format!("{mirror_a_id}.md"));
        assert!(
            path_a.exists(),
            "(a) Mirror A must be at its original ULID path after 410 reconciling re-sync"
        );
        let mirror_a_after = fs::read_event(&path_a).unwrap();
        assert_eq!(
            mirror_a_after.frontmatter.ical_uid.as_deref(),
            Some(mirror_a_ical.as_str()),
            "(a) ical_uid must be preserved in the re-synced mirror"
        );

        // ── (b) prep-for edge is NOT dangling ──────────────────────────────────
        crate::ops::api::refresh(&root).unwrap();
        let dangling_after = crate::ops::api::list_dangling(&root).unwrap();
        let prep_for_dangling: Vec<_> = dangling_after
            .iter()
            .filter(|d| d.source_id == note_id)
            .collect();
        assert!(
            prep_for_dangling.is_empty(),
            "(b) prep-for edge must NOT be dangling after 410 re-sync; \
             mirror A ULID={mirror_a_id} should be preserved.\n\
             Dangling edges: {dangling_after:?}"
        );

        // ── (c) Mirror B must be deleted (absent from bootstrap result) ────────
        let path_b = events_dir.join(format!("{mirror_b_id}.md"));
        assert!(
            !path_b.exists(),
            "(c) Mirror B must be deleted as it was absent from the bootstrap full-sync"
        );
    }
}
