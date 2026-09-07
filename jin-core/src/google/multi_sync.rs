//! Destination-isolated inbound synchronization for account registries.

use chrono::{Duration, Utc};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::google::account::EventSyncTarget;
use crate::google::client::{CalendarClient, HttpClient};
use crate::google::mapping::google_to_jin;
use crate::google::secrets::TokenSet;
use crate::store::fs;
use crate::sync::state::{
    self, OutboxOperationKind, ScopedEventSyncEntry, SyncDestination, MASTER_RECURRENCE_KEY,
};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DestinationSyncResult {
    pub account_id: String,
    pub calendar_id: String,
    pub pulled: u32,
    pub pushed: u32,
    pub errors: Vec<String>,
}

fn recurrence_key(item: &serde_json::Value) -> String {
    let original = item.get("originalStartTime");
    original
        .and_then(|value| value.get("dateTime").or_else(|| value.get("date")))
        .and_then(|value| value.as_str())
        .map(|value| {
            let normalized = chrono::DateTime::parse_from_rfc3339(value)
                .map(|date_time| date_time.to_rfc3339())
                .unwrap_or_else(|_| value.to_string());
            match original
                .and_then(|value| value.get("dateTime"))
                .and_then(|_| original.and_then(|value| value.get("timeZone")))
                .and_then(|value| value.as_str())
            {
                Some(tzid) => format!("{normalized}@{tzid}"),
                None => normalized,
            }
        })
        .unwrap_or_else(|| MASTER_RECURRENCE_KEY.to_string())
}

pub fn pull_destination<H: HttpClient>(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    auth_generation: u64,
    route_generation: u64,
    tokens: &TokenSet,
    http: &H,
) -> crate::Result<DestinationSyncResult> {
    let destination = SyncDestination::google(
        target.account_id.as_str().to_string(),
        target.calendar_id.clone(),
    );
    state::ensure_destination(conn, &destination, 0, 0)?;
    let mut result = DestinationSyncResult {
        account_id: target.account_id.to_string(),
        calendar_id: target.calendar_id.clone(),
        ..Default::default()
    };
    let client = CalendarClient {
        http,
        calendar_id: &target.calendar_id,
        access_token: &tokens.access_token,
    };

    let mut token = state::get_scoped_sync_token(conn, &destination)?;
    let mut bootstrap = token.is_none();
    let mut page_token: Option<String> = None;
    loop {
        let response = {
            let _request_guard = crate::ops::sync::acquire_provider_request_guard(
                root,
                target,
                auth_generation,
                route_generation,
                false,
            )?;
            if bootstrap {
                client.list_bootstrap(
                    page_token.as_deref(),
                    &(Utc::now() - Duration::days(365)).to_rfc3339(),
                )?
            } else {
                client.list_incremental_page(
                    token.as_deref().unwrap_or_default(),
                    page_token.as_deref(),
                )?
            }
        };
        if matches!(response.status, 401 | 403) {
            return Err(crate::JinError::Auth(
                "Google credentials or calendar authorization were revoked".to_string(),
            ));
        }
        if response.full_sync_required {
            state::set_scoped_sync_token(conn, &destination, None)?;
            state::clear_scoped_clean_entries(conn, &destination)?;
            bootstrap = true;
            token = None;
            page_token = None;
            continue;
        }
        let items = response.items;
        // Plan stable canonical identities for the whole page before writing
        // any event. Occurrences may precede their recurring master in Google's
        // response, so master identity cannot depend on item order.
        let mut planned_ids = HashMap::<String, String>::new();
        for item in &items {
            let Some(remote_id) = item.get("id").and_then(|value| value.as_str()) else {
                continue;
            };
            let key = recurrence_key(item);
            let jin_id = state::get_scoped_entry_by_remote_id(conn, &destination, remote_id, &key)?
                .map(|entry| entry.jin_id)
                .unwrap_or_else(crate::id::new_ulid);
            planned_ids.insert(remote_id.to_string(), jin_id);
        }
        for item in &items {
            if item.get("status").and_then(|value| value.as_str()) == Some("cancelled") {
                continue;
            }
            let Some(master_remote_id) = item
                .get("recurringEventId")
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            if planned_ids.contains_key(master_remote_id) {
                continue;
            }
            let master_jin_id = state::get_scoped_entry_by_remote_id(
                conn,
                &destination,
                master_remote_id,
                MASTER_RECURRENCE_KEY,
            )?
            .map(|entry| entry.jin_id)
            .unwrap_or_else(crate::id::new_ulid);
            planned_ids.insert(master_remote_id.to_string(), master_jin_id.clone());
            // Persist the occurrence→master reservation so a later page or
            // incremental response assigns the real master the same Jin id.
            state::upsert_scoped_entry(
                conn,
                &ScopedEventSyncEntry {
                    destination: destination.clone(),
                    jin_id: master_jin_id,
                    recurrence_key: MASTER_RECURRENCE_KEY.to_string(),
                    google_event_id: Some(master_remote_id.to_string()),
                    ical_uid: item
                        .get("iCalUID")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    etag: None,
                    google_updated: None,
                    last_synced_at: None,
                },
            )?;
        }
        for item in items {
            let Some(remote_id) = item.get("id").and_then(|value| value.as_str()) else {
                result.errors.push("Google event missing id".to_string());
                continue;
            };
            let key = recurrence_key(&item);
            let existing =
                state::get_scoped_entry_by_remote_id(conn, &destination, remote_id, &key)?;
            let jin_id = planned_ids
                .get(remote_id)
                .cloned()
                .unwrap_or_else(crate::id::new_ulid);
            if item.get("status").and_then(|value| value.as_str()) == Some("cancelled") {
                if let Some(existing) = existing {
                    let path = root.join("events").join(format!("{}.md", existing.jin_id));
                    if path.exists() {
                        let mut event = fs::read_event(&path)?;
                        if event.frontmatter.source == crate::model::event::EventSource::Jin {
                            state::delete_scoped_entry(conn, &destination, &existing.jin_id, &key)?;
                            if key == MASTER_RECURRENCE_KEY {
                                crate::google::route_ownership::clear(
                                    &root.join("events"),
                                    &existing.jin_id,
                                )?;
                            }
                            crate::sync::audit::append_scoped_audit_entry(
                                &root.join(".jin").join("sync"),
                                &crate::sync::audit::ScopedAuditEntry {
                                    timestamp: Utc::now().to_rfc3339(),
                                    operation_id: format!(
                                        "remote-delete:{}:{}",
                                        existing.jin_id, key
                                    ),
                                    operation: "remote_cancel".to_string(),
                                    provider: destination.provider.clone(),
                                    account_id: destination.account_id.clone(),
                                    calendar_id: destination.calendar_id.clone(),
                                    jin_id: existing.jin_id.clone(),
                                    recurrence_key: key.clone(),
                                    google_event_id: existing.google_event_id.clone(),
                                    base_etag: existing.etag.clone(),
                                    remote_etag: item
                                        .get("etag")
                                        .and_then(|v| v.as_str())
                                        .map(str::to_string),
                                    attempted_delta: serde_json::json!({}),
                                    attempted_post_hash: "none".to_string(),
                                    remote_snapshot: item.clone(),
                                    remote_snapshot_hash: format!(
                                        "sha256:{:x}",
                                        Sha256::digest(
                                            serde_json::to_vec(&item).unwrap_or_default()
                                        )
                                    ),
                                    resolution: "unpublish".to_string(),
                                    winner: "jin".to_string(),
                                },
                            )?;
                        } else {
                            event.frontmatter.status = crate::model::event::EventStatus::Cancelled;
                            event.frontmatter.updated = Utc::now().fixed_offset();
                            fs::write_event(&root.join("events"), &event)?;
                        }
                    }
                }
                continue;
            }
            let mut frontmatter = google_to_jin(&item, &jin_id, &target.calendar_id)?;
            if let Some(master_remote_id) = item
                .get("recurringEventId")
                .and_then(|value| value.as_str())
            {
                frontmatter.master_id = planned_ids.get(master_remote_id).cloned();
            }
            let current_path = root.join("events").join(fs::event_filename(&jin_id));
            if current_path.exists() {
                let current = fs::read_event(&current_path)?;
                if current.frontmatter.source == crate::model::event::EventSource::Jin {
                    frontmatter.source = current.frontmatter.source;
                    frontmatter.authority = current.frontmatter.authority;
                    frontmatter.derived_from = current.frontmatter.derived_from;
                }
            }
            fs::write_event(
                &root.join("events"),
                &crate::model::event::Event {
                    frontmatter,
                    body: String::new(),
                },
            )?;
            crate::google::route_ownership::write(&root.join("events"), &jin_id, target)?;
            state::upsert_scoped_entry(
                conn,
                &ScopedEventSyncEntry {
                    destination: destination.clone(),
                    jin_id,
                    recurrence_key: key,
                    google_event_id: Some(remote_id.to_string()),
                    ical_uid: item
                        .get("iCalUID")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    etag: item
                        .get("etag")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    google_updated: item
                        .get("updated")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    last_synced_at: Some(Utc::now().to_rfc3339()),
                },
            )?;
            result.pulled += 1;
        }
        page_token = response.next_page_token;
        if page_token.is_some() {
            continue;
        }
        if let Some(next) = response.next_sync_token {
            state::set_scoped_sync_token(conn, &destination, Some(&next))?;
        }
        break;
    }

    if destination_has_google_recurring_master(root, conn, &destination)? {
        pull_occurrence_snapshot(
            root,
            conn,
            target,
            auth_generation,
            route_generation,
            &destination,
            &client,
            &mut result,
        )?;
    }
    Ok(result)
}

fn destination_has_google_recurring_master(
    root: &Path,
    conn: &Connection,
    destination: &SyncDestination,
) -> crate::Result<bool> {
    for entry in state::list_scoped_entries_for_destination(conn, destination)? {
        if entry.recurrence_key != MASTER_RECURRENCE_KEY {
            continue;
        }
        let path = root.join("events").join(fs::event_filename(&entry.jin_id));
        if !path.exists() {
            continue;
        }
        let event = fs::read_event(&path)?;
        if event.frontmatter.source == crate::model::event::EventSource::Google
            && !event.frontmatter.recurrence.is_empty()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn pull_occurrence_snapshot<H: HttpClient>(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    auth_generation: u64,
    route_generation: u64,
    destination: &SyncDestination,
    client: &CalendarClient<'_, H>,
    result: &mut DestinationSyncResult,
) -> crate::Result<()> {
    let now = Utc::now();
    let time_min = (now - Duration::days(365)).to_rfc3339();
    let time_max = (now + Duration::days(730)).to_rfc3339();
    let mut page_token = None;
    let mut seen = HashSet::<(String, String)>::new();

    loop {
        let response = {
            let _request_guard = crate::ops::sync::acquire_provider_request_guard(
                root,
                target,
                auth_generation,
                route_generation,
                false,
            )?;
            client.list_occurrences(page_token.as_deref(), &time_min, &time_max)?
        };
        if matches!(response.status, 401 | 403) {
            return Err(crate::JinError::Auth(
                "Google credentials or calendar authorization were revoked".to_string(),
            ));
        }
        if !(200..300).contains(&response.status) {
            return Err(crate::JinError::Offline(format!(
                "Google occurrence snapshot failed with HTTP {}",
                response.status
            )));
        }
        for item in response.items {
            ingest_occurrence(root, conn, target, destination, item, &mut seen, result)?;
        }
        page_token = response.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    reconcile_occurrence_snapshot(root, conn, destination, &seen)
}

fn ingest_occurrence(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    destination: &SyncDestination,
    item: serde_json::Value,
    seen: &mut HashSet<(String, String)>,
    result: &mut DestinationSyncResult,
) -> crate::Result<()> {
    let Some(remote_id) = item.get("id").and_then(|value| value.as_str()) else {
        result
            .errors
            .push("Google occurrence missing id".to_string());
        return Ok(());
    };
    let Some(master_remote_id) = item
        .get("recurringEventId")
        .and_then(|value| value.as_str())
    else {
        return Ok(());
    };
    let key = recurrence_key(&item);
    if key == MASTER_RECURRENCE_KEY {
        result.errors.push(format!(
            "Google occurrence {remote_id} missing originalStartTime"
        ));
        return Ok(());
    }
    if item.get("status").and_then(|value| value.as_str()) == Some("cancelled") {
        return Ok(());
    }
    let Some(master) = state::get_scoped_entry_by_remote_id(
        conn,
        destination,
        master_remote_id,
        MASTER_RECURRENCE_KEY,
    )?
    else {
        result.errors.push(format!(
            "Google occurrence {remote_id} references an unknown recurring master"
        ));
        return Ok(());
    };
    let existing = state::get_scoped_entry_by_remote_id(conn, destination, remote_id, &key)?;
    let jin_id = existing
        .as_ref()
        .map(|entry| entry.jin_id.clone())
        .unwrap_or_else(crate::id::new_ulid);
    let path = root.join("events").join(fs::event_filename(&jin_id));
    let incoming_etag = item
        .get("etag")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    seen.insert((remote_id.to_string(), key.clone()));

    if incoming_etag.is_some()
        && existing.as_ref().and_then(|entry| entry.etag.as_ref()) == incoming_etag.as_ref()
        && path.exists()
    {
        let current = fs::read_event(&path)?;
        if current.frontmatter.master_id.as_deref() == Some(master.jin_id.as_str()) {
            return Ok(());
        }
    }

    let mut frontmatter = google_to_jin(&item, &jin_id, &target.calendar_id)?;
    frontmatter.master_id = Some(master.jin_id);
    if path.exists() {
        let current = fs::read_event(&path)?;
        if current.frontmatter.source == crate::model::event::EventSource::Jin {
            frontmatter.source = current.frontmatter.source;
            frontmatter.authority = current.frontmatter.authority;
            frontmatter.derived_from = current.frontmatter.derived_from;
        }
    }
    fs::write_event(
        &root.join("events"),
        &crate::model::event::Event {
            frontmatter,
            body: String::new(),
        },
    )?;
    crate::google::route_ownership::write(&root.join("events"), &jin_id, target)?;
    state::upsert_scoped_entry(
        conn,
        &ScopedEventSyncEntry {
            destination: destination.clone(),
            jin_id,
            recurrence_key: key,
            google_event_id: Some(remote_id.to_string()),
            ical_uid: item
                .get("iCalUID")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            etag: incoming_etag,
            google_updated: item
                .get("updated")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            last_synced_at: Some(Utc::now().to_rfc3339()),
        },
    )?;
    result.pulled += 1;
    Ok(())
}

fn reconcile_occurrence_snapshot(
    root: &Path,
    conn: &Connection,
    destination: &SyncDestination,
    seen: &HashSet<(String, String)>,
) -> crate::Result<()> {
    for entry in state::list_scoped_entries_for_destination(conn, destination)? {
        if entry.recurrence_key == MASTER_RECURRENCE_KEY {
            continue;
        }
        let Some(remote_id) = entry.google_event_id.as_deref() else {
            continue;
        };
        if seen.contains(&(remote_id.to_string(), entry.recurrence_key.clone()))
            || state::has_active_outbox_for_event(
                conn,
                destination,
                &entry.jin_id,
                &entry.recurrence_key,
            )?
        {
            continue;
        }
        let path = root.join("events").join(fs::event_filename(&entry.jin_id));
        if !path.exists() {
            continue;
        }
        let event = fs::read_event(&path)?;
        if event.frontmatter.source != crate::model::event::EventSource::Google
            || (event.frontmatter.recurring_event_id.is_none()
                && event.frontmatter.master_id.is_none())
        {
            continue;
        }
        std::fs::remove_file(&path)?;
        crate::google::route_ownership::clear(&root.join("events"), &entry.jin_id)?;
        state::delete_scoped_entry(conn, destination, &entry.jin_id, &entry.recurrence_key)?;
    }
    Ok(())
}

pub fn drain_destination<H: HttpClient>(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    auth_generation: u64,
    route_generation: u64,
    tokens: &TokenSet,
    http: &H,
) -> crate::Result<u32> {
    let destination = SyncDestination::google(
        target.account_id.as_str().to_string(),
        target.calendar_id.clone(),
    );
    let client = CalendarClient {
        http,
        calendar_id: &target.calendar_id,
        access_token: &tokens.access_token,
    };
    let mut pushed = 0;
    for operation in state::list_route_outbox_for_drain(conn, &destination)? {
        if operation.auth_generation != auth_generation
            || operation.route_generation != route_generation
        {
            state::pause_outbox_operation(
                conn,
                &destination,
                &operation.operation_id,
                "provider_permission_changed",
            )?;
            if operation.operation == OutboxOperationKind::RespondInvitation {
                let config = crate::Config::load(root)?;
                let mut center = crate::notification_center::NotificationCenter::open(
                    &config.notification_center_path(),
                )?;
                center.disable_invitation_response(
                    &operation.operation_id,
                    "credential_or_route_generation_changed",
                    Utc::now(),
                )?;
            }
            continue;
        }
        let path = root
            .join("events")
            .join(fs::event_filename(&operation.jin_id));
        if !path.exists() {
            if operation.operation == OutboxOperationKind::RespondInvitation {
                state::obsolete_outbox_operation(
                    conn,
                    &destination,
                    &operation.operation_id,
                    "canonical_missing",
                )?;
                let config = crate::Config::load(root)?;
                let mut center = crate::notification_center::NotificationCenter::open(
                    &config.notification_center_path(),
                )?;
                center.finish_attempt_obsolete(
                    &operation.operation_id,
                    "The invitation no longer exists.",
                    Utc::now(),
                )?;
            } else {
                state::pause_outbox_operation(
                    conn,
                    &destination,
                    &operation.operation_id,
                    "canonical_missing",
                )?;
            }
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let current_revision = format!("sha256:{:x}", Sha256::digest(&bytes));
        let event = fs::parse_event_bytes(&bytes)?;
        if operation.operation == OutboxOperationKind::RespondInvitation {
            pushed += drain_invitation_response(
                root,
                conn,
                target,
                auth_generation,
                route_generation,
                &client,
                &destination,
                &operation,
                &event,
            )?;
            continue;
        }
        if current_revision != operation.canonical_revision {
            state::pause_outbox_operation(
                conn,
                &destination,
                &operation.operation_id,
                "canonical_superseded",
            )?;
            continue;
        }
        if event.frontmatter.status == crate::model::event::EventStatus::Cancelled
            && operation.operation != OutboxOperationKind::Delete
        {
            state::pause_outbox_operation(
                conn,
                &destination,
                &operation.operation_id,
                "local_tombstone",
            )?;
            continue;
        }
        let response = {
            let _request_guard = crate::ops::sync::acquire_provider_request_guard(
                root,
                target,
                operation.auth_generation,
                operation.route_generation,
                true,
            )?;
            match operation.operation {
                OutboxOperationKind::Insert => client.insert_event(
                    &crate::google::client::ulid_to_google_event_id(&operation.jin_id)?,
                    operation
                        .payload
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({})),
                )?,
                OutboxOperationKind::Patch => client.patch_event(
                    operation.google_event_id.as_deref().ok_or_else(|| {
                        crate::JinError::Integrity("patch outbox row missing event id".to_string())
                    })?,
                    operation.base_etag.as_deref().ok_or_else(|| {
                        crate::JinError::Integrity("patch outbox row missing base etag".to_string())
                    })?,
                    operation
                        .payload
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({})),
                )?,
                OutboxOperationKind::Delete => client.delete_event(
                    operation.google_event_id.as_deref().ok_or_else(|| {
                        crate::JinError::Integrity("delete outbox row missing event id".to_string())
                    })?,
                    operation.base_etag.as_deref().unwrap_or("*"),
                )?,
                OutboxOperationKind::RespondInvitation => unreachable!(),
            }
        };
        if matches!(response.status, 401 | 403) {
            return Err(crate::JinError::Auth(
                "Google credentials or calendar authorization were revoked".to_string(),
            ));
        }
        if response.status == 412 {
            let remote_id = operation.google_event_id.as_deref().ok_or_else(|| {
                crate::JinError::Integrity("412 outbox row missing event id".to_string())
            })?;
            let remote_response = {
                let _request_guard = crate::ops::sync::acquire_provider_request_guard(
                    root,
                    target,
                    operation.auth_generation,
                    operation.route_generation,
                    true,
                )?;
                client.get_event(remote_id)?
            };
            if matches!(remote_response.status, 401 | 403) {
                return Err(crate::JinError::Auth(
                    "Google credentials or calendar authorization were revoked".to_string(),
                ));
            }
            if remote_response.status != 200 {
                state::pause_outbox_operation(
                    conn,
                    &destination,
                    &operation.operation_id,
                    "conflict_unresolved",
                )?;
                continue;
            }
            let remote = remote_response.body;
            let remote_bytes = serde_json::to_vec(&remote).map_err(|error| {
                crate::JinError::Integrity(format!("serialize remote snapshot: {error}"))
            })?;
            let remote_etag = remote
                .get("etag")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or(remote_response.etag);
            let mut frontmatter = google_to_jin(&remote, &operation.jin_id, &target.calendar_id)?;
            // Remote-wins resolves the conflicting fields, not the canonical
            // ownership policy. A Jin-origin item remains a Jin item and a
            // later remote delete therefore unpublishes rather than erasing it.
            if event.frontmatter.source == crate::model::event::EventSource::Jin {
                frontmatter.source = event.frontmatter.source.clone();
                frontmatter.authority = event.frontmatter.authority.clone();
                frontmatter.derived_from = event.frontmatter.derived_from.clone();
            }
            fs::write_event(
                &root.join("events"),
                &crate::model::event::Event {
                    frontmatter,
                    body: event.body,
                },
            )?;
            crate::sync::audit::append_scoped_audit_entry(
                &root.join(".jin").join("sync"),
                &crate::sync::audit::ScopedAuditEntry {
                    timestamp: Utc::now().to_rfc3339(),
                    operation_id: operation.operation_id.clone(),
                    operation: format!("{:?}", operation.operation).to_lowercase(),
                    provider: destination.provider.clone(),
                    account_id: destination.account_id.clone(),
                    calendar_id: destination.calendar_id.clone(),
                    jin_id: operation.jin_id.clone(),
                    recurrence_key: operation.recurrence_key.clone(),
                    google_event_id: operation.google_event_id.clone(),
                    base_etag: operation.base_etag.clone(),
                    remote_etag,
                    attempted_delta: crate::sync::audit::redacted_delta(
                        &operation
                            .payload
                            .clone()
                            .unwrap_or_else(|| serde_json::json!({})),
                    ),
                    attempted_post_hash: operation.canonical_revision.clone(),
                    remote_snapshot: remote,
                    remote_snapshot_hash: format!("sha256:{:x}", Sha256::digest(&remote_bytes)),
                    resolution: "remote-wins".to_string(),
                    winner: "google".to_string(),
                },
            )?;
            state::complete_outbox_operation(conn, &destination, &operation.operation_id)?;
            continue;
        }
        let successful = (200..300).contains(&response.status)
            || (operation.operation == OutboxOperationKind::Insert && response.status == 409);
        if !successful {
            state::pause_outbox_operation(
                conn,
                &destination,
                &operation.operation_id,
                &format!("provider_http_{}", response.status),
            )?;
            continue;
        }
        if operation.operation != OutboxOperationKind::Delete {
            state::upsert_scoped_entry(
                conn,
                &ScopedEventSyncEntry {
                    destination: destination.clone(),
                    jin_id: operation.jin_id.clone(),
                    recurrence_key: operation.recurrence_key.clone(),
                    google_event_id: response
                        .body
                        .get("id")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                        .or(operation.google_event_id.clone())
                        .or_else(|| {
                            crate::google::client::ulid_to_google_event_id(&operation.jin_id).ok()
                        }),
                    ical_uid: event.frontmatter.ical_uid.clone(),
                    etag: response
                        .body
                        .get("etag")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                        .or(response.etag),
                    google_updated: response
                        .body
                        .get("updated")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    last_synced_at: Some(Utc::now().to_rfc3339()),
                },
            )?;
        }
        state::complete_outbox_operation(conn, &destination, &operation.operation_id)?;
        pushed += 1;
    }
    Ok(pushed)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvitationResponseOutboxIntent {
    schema_version: u32,
    self_email: String,
    response_status: String,
    provider_subject: String,
}

#[allow(clippy::too_many_arguments)]
fn drain_invitation_response<H: HttpClient>(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    auth_generation: u64,
    route_generation: u64,
    client: &CalendarClient<'_, H>,
    destination: &SyncDestination,
    operation: &crate::sync::state::OutboxOperation,
    event: &crate::model::event::Event,
) -> crate::Result<u32> {
    let recovering_sending = operation.state == "sending";
    let intent: InvitationResponseOutboxIntent =
        serde_json::from_value(operation.payload.clone().ok_or_else(|| {
            crate::JinError::Integrity("RSVP outbox row missing intent".to_string())
        })?)
        .map_err(|error| {
            crate::JinError::Integrity(format!("invalid RSVP outbox intent: {error}"))
        })?;
    if intent.schema_version != 1
        || !matches!(
            intent.response_status.as_str(),
            "accepted" | "tentative" | "declined"
        )
        || intent.self_email.trim().is_empty()
        || operation.base_etag.as_deref().is_none_or(str::is_empty)
        || operation
            .google_event_id
            .as_deref()
            .is_none_or(str::is_empty)
    {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invalid_rsvp_intent",
        )?;
        return Ok(0);
    }
    let config = crate::Config::load(root)?;
    let account = config.google_registry.account(&target.account_id)?;
    let current_subject = account.provider_subject.as_deref();
    if operation.auth_generation != auth_generation
        || operation.route_generation != route_generation
        || current_subject != Some(intent.provider_subject.as_str())
    {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "credential_or_route_generation_changed",
        )?;
        let mut center = crate::notification_center::NotificationCenter::open(
            &config.notification_center_path(),
        )?;
        center.disable_invitation_response(
            &operation.operation_id,
            "credential_generation_changed",
            Utc::now(),
        )?;
        return Ok(0);
    }
    let _request_guard = crate::ops::sync::acquire_provider_request_guard(
        root,
        target,
        operation.auth_generation,
        operation.route_generation,
        true,
    )?;
    let claimed = if recovering_sending {
        state::get_route_outbox_operation(conn, destination, &operation.operation_id)?
    } else {
        state::claim_invitation_outbox(conn, destination, &operation.operation_id)?
    };
    let Some(mut claimed) = claimed else {
        return Ok(0);
    };
    if claimed.state != "sending" {
        return Ok(0);
    }
    let operation = &mut claimed;
    crate::google::route_ownership::validate(&config.events_dir(), event.id(), target)?;
    let self_responses = event
        .frontmatter
        .attendees
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|attendee| attendee.is_self == Some(true))
        .collect::<Vec<_>>();
    let canonical_self = match self_responses.as_slice() {
        [attendee] if attendee.email.as_deref() == Some(intent.self_email.as_str()) => *attendee,
        _ => {
            state::pause_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "self_attendee_changed",
            )?;
            let mut center = crate::notification_center::NotificationCenter::open(
                &config.notification_center_path(),
            )?;
            center.disable_invitation_response(
                &operation.operation_id,
                "self_attendee_changed",
                Utc::now(),
            )?;
            return Ok(0);
        }
    };
    let mut center =
        crate::notification_center::NotificationCenter::open(&config.notification_center_path())?;
    if event.frontmatter.status == crate::model::event::EventStatus::Cancelled {
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_cancelled",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation was cancelled.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if canonical_event_has_ended(event, Utc::now()) {
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_ended",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation has ended.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if recovering_sending {
        let remote_id = operation.google_event_id.as_deref().ok_or_else(|| {
            crate::JinError::Integrity("RSVP outbox row missing event id".to_string())
        })?;
        let remote = client.get_event(remote_id)?;
        if matches!(remote.status, 401 | 403) {
            state::pause_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "reauth_required",
            )?;
            center.disable_invitation_response(
                &operation.operation_id,
                "reauth_required",
                Utc::now(),
            )?;
            return Ok(0);
        }
        if matches!(remote.status, 404 | 410) {
            state::obsolete_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "invitation_missing",
            )?;
            center.finish_attempt_obsolete(
                &operation.operation_id,
                "The invitation no longer exists.",
                Utc::now(),
            )?;
            return Ok(0);
        }
        if remote.status != 200 {
            state::pause_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "sending_recovery_failed",
            )?;
            center.finish_attempt_failed(
                &operation.operation_id,
                "provider_failed",
                "The interrupted invitation response could not be verified.",
                true,
                Utc::now(),
            )?;
            return Ok(0);
        }
        if remote.body.get("status").and_then(|value| value.as_str()) == Some("cancelled")
            || google_event_has_ended(&remote.body, Utc::now())
        {
            import_invitation_provider_state(
                root,
                conn,
                target,
                destination,
                operation,
                event,
                &remote,
            )?;
            state::obsolete_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "invitation_obsolete",
            )?;
            center.finish_attempt_obsolete(
                &operation.operation_id,
                "The invitation is no longer actionable.",
                Utc::now(),
            )?;
            return Ok(0);
        }
        match remote_self_response(&remote.body, &intent.self_email).as_deref() {
            Some(status) if status == intent.response_status => {
                import_invitation_provider_state(
                    root,
                    conn,
                    target,
                    destination,
                    operation,
                    event,
                    &remote,
                )?;
                state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
                center.finish_attempt_succeeded(&operation.operation_id, Utc::now())?;
                return Ok(1);
            }
            Some(status) if status != "needsAction" => {
                let observed = status.to_string();
                import_invitation_provider_state(
                    root,
                    conn,
                    target,
                    destination,
                    operation,
                    event,
                    &remote,
                )?;
                state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
                center.finish_attempt_superseded(&operation.operation_id, &observed, Utc::now())?;
                return Ok(0);
            }
            Some("needsAction") => {
                operation.base_etag = remote
                    .body
                    .get("etag")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                    .or(remote.etag);
            }
            _ => {
                state::pause_outbox_operation(
                    conn,
                    destination,
                    &operation.operation_id,
                    "self_attendee_changed",
                )?;
                center.disable_invitation_response(
                    &operation.operation_id,
                    "self_attendee_changed",
                    Utc::now(),
                )?;
                return Ok(0);
            }
        }
    }
    match canonical_self.response_status.as_deref() {
        Some(status) if status == intent.response_status => {
            state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
            center.finish_attempt_succeeded(&operation.operation_id, Utc::now())?;
            return Ok(1);
        }
        Some(status) if status != "needsAction" => {
            state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
            center.finish_attempt_superseded(&operation.operation_id, status, Utc::now())?;
            return Ok(0);
        }
        _ => {}
    }
    center.mark_attempt_sending(&operation.operation_id, Utc::now())?;
    let remote_id = operation.google_event_id.as_deref().ok_or_else(|| {
        crate::JinError::Integrity("RSVP outbox row missing event id".to_string())
    })?;
    let body = crate::google::mapping::invitation_response_patch(
        &intent.self_email,
        &intent.response_status,
    );
    let response_result = client.respond_to_event(
        remote_id,
        operation.base_etag.as_deref().ok_or_else(|| {
            crate::JinError::Integrity("RSVP outbox row missing base etag".to_string())
        })?,
        body.clone(),
    );
    let response = match response_result {
        Ok(response) => response,
        Err(error @ crate::JinError::Offline(_)) => {
            state::requeue_sending_outbox(conn, destination, &operation.operation_id)?;
            center.mark_attempt_queued(&operation.operation_id, Utc::now())?;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    if response.status == 412 {
        return handle_invitation_412(
            root,
            conn,
            target,
            client,
            destination,
            operation,
            event,
            &intent,
            body,
            &mut center,
        );
    }
    if matches!(response.status, 401 | 403) {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "reauth_required",
        )?;
        center.disable_invitation_response(
            &operation.operation_id,
            "reauth_required",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if !(200..300).contains(&response.status) {
        let retryable = response.status == 429 || response.status >= 500;
        let reason = format!("provider_http_{}", response.status);
        state::pause_outbox_operation(conn, destination, &operation.operation_id, &reason)?;
        center.finish_attempt_failed(
            &operation.operation_id,
            &reason,
            "Google did not accept the invitation response.",
            retryable,
            Utc::now(),
        )?;
        return Ok(0);
    }
    let confirmed = confirmed_event_response(client, remote_id, response)?;
    let observed = remote_self_response(&confirmed.body, &intent.self_email);
    if observed.as_deref() != Some(intent.response_status.as_str()) {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "provider_confirmation_mismatch",
        )?;
        center.finish_attempt_failed(
            &operation.operation_id,
            "provider_failed",
            "Google did not confirm the selected invitation response.",
            true,
            Utc::now(),
        )?;
        return Ok(0);
    }
    import_invitation_provider_state(
        root,
        conn,
        target,
        destination,
        operation,
        event,
        &confirmed,
    )?;
    state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
    center.finish_attempt_succeeded(&operation.operation_id, Utc::now())?;
    Ok(1)
}

#[allow(clippy::too_many_arguments)]
fn handle_invitation_412<H: HttpClient>(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    client: &CalendarClient<'_, H>,
    destination: &SyncDestination,
    operation: &crate::sync::state::OutboxOperation,
    canonical: &crate::model::event::Event,
    intent: &InvitationResponseOutboxIntent,
    body: serde_json::Value,
    center: &mut crate::notification_center::NotificationCenter,
) -> crate::Result<u32> {
    let remote_id = operation.google_event_id.as_deref().ok_or_else(|| {
        crate::JinError::Integrity("412 RSVP outbox row missing event id".to_string())
    })?;
    let remote = client.get_event(remote_id)?;
    if matches!(remote.status, 401 | 403) {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "reauth_required",
        )?;
        center.disable_invitation_response(
            &operation.operation_id,
            "reauth_required",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if matches!(remote.status, 404 | 410) {
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_missing",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation no longer exists.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if remote.status != 200 {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "conflict_unresolved",
        )?;
        center.finish_attempt_failed(
            &operation.operation_id,
            "provider_failed",
            "The invitation changed and could not be refreshed.",
            true,
            Utc::now(),
        )?;
        return Ok(0);
    }
    if remote.body.get("status").and_then(|value| value.as_str()) == Some("cancelled")
        || google_event_has_ended(&remote.body, Utc::now())
    {
        import_invitation_provider_state(
            root,
            conn,
            target,
            destination,
            operation,
            canonical,
            &remote,
        )?;
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_obsolete",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation is no longer actionable.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    match remote_self_response(&remote.body, &intent.self_email).as_deref() {
        Some(status) if status == intent.response_status => {
            import_invitation_provider_state(
                root,
                conn,
                target,
                destination,
                operation,
                canonical,
                &remote,
            )?;
            state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
            center.finish_attempt_succeeded(&operation.operation_id, Utc::now())?;
            return Ok(1);
        }
        Some(status) if status != "needsAction" => {
            let observed = status.to_string();
            import_invitation_provider_state(
                root,
                conn,
                target,
                destination,
                operation,
                canonical,
                &remote,
            )?;
            state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
            center.finish_attempt_superseded(&operation.operation_id, &observed, Utc::now())?;
            return Ok(0);
        }
        Some("needsAction") => {}
        _ => {
            state::pause_outbox_operation(
                conn,
                destination,
                &operation.operation_id,
                "self_attendee_changed",
            )?;
            center.disable_invitation_response(
                &operation.operation_id,
                "self_attendee_changed",
                Utc::now(),
            )?;
            return Ok(0);
        }
    }
    let refreshed_etag = remote
        .body
        .get("etag")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(remote.etag.clone())
        .ok_or_else(|| {
            crate::JinError::Integrity("refetched RSVP event missing etag".to_string())
        })?;
    if state::outbox_attempt_count(conn, destination, &operation.operation_id)? >= 1 {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "rsvp_second_412",
        )?;
        center.finish_attempt_failed(
            &operation.operation_id,
            "provider_failed",
            "The invitation changed again. Review it before retrying.",
            true,
            Utc::now(),
        )?;
        return Ok(0);
    }
    state::prepare_outbox_retry(conn, destination, &operation.operation_id, &refreshed_etag)?;
    let retry_result = client.respond_to_event(remote_id, &refreshed_etag, body);
    let retry = match retry_result {
        Ok(response) => response,
        Err(error @ crate::JinError::Offline(_)) => {
            state::requeue_sending_outbox(conn, destination, &operation.operation_id)?;
            center.mark_attempt_queued(&operation.operation_id, Utc::now())?;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    if retry.status == 412 {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "rsvp_second_412",
        )?;
        center.finish_attempt_failed(
            &operation.operation_id,
            "provider_failed",
            "The invitation changed again. Review it before retrying.",
            true,
            Utc::now(),
        )?;
        return Ok(0);
    }
    if matches!(retry.status, 401 | 403) {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "reauth_required",
        )?;
        center.disable_invitation_response(
            &operation.operation_id,
            "reauth_required",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if matches!(retry.status, 404 | 410) {
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_missing",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation no longer exists.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if !(200..300).contains(&retry.status) {
        let reason = format!("provider_http_{}", retry.status);
        state::pause_outbox_operation(conn, destination, &operation.operation_id, &reason)?;
        center.finish_attempt_failed(
            &operation.operation_id,
            &reason,
            "Google did not accept the invitation response.",
            retry.status == 429 || retry.status >= 500,
            Utc::now(),
        )?;
        return Ok(0);
    }
    if retry.body.get("status").and_then(|value| value.as_str()) == Some("cancelled")
        || (retry.body.get("end").is_some() && google_event_has_ended(&retry.body, Utc::now()))
    {
        import_invitation_provider_state(
            root,
            conn,
            target,
            destination,
            operation,
            canonical,
            &retry,
        )?;
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_obsolete",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation is no longer actionable.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    let confirmed = confirmed_event_response(client, remote_id, retry)?;
    if matches!(confirmed.status, 401 | 403) {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "reauth_required",
        )?;
        center.disable_invitation_response(
            &operation.operation_id,
            "reauth_required",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if matches!(confirmed.status, 404 | 410) {
        state::obsolete_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_missing",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation no longer exists.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if !(200..300).contains(&confirmed.status) {
        let reason = format!("provider_http_{}", confirmed.status);
        state::pause_outbox_operation(conn, destination, &operation.operation_id, &reason)?;
        center.finish_attempt_failed(
            &operation.operation_id,
            &reason,
            "Google did not confirm the invitation response.",
            confirmed.status == 429 || confirmed.status >= 500,
            Utc::now(),
        )?;
        return Ok(0);
    }
    if confirmed
        .body
        .get("status")
        .and_then(|value| value.as_str())
        == Some("cancelled")
        || google_event_has_ended(&confirmed.body, Utc::now())
    {
        import_invitation_provider_state(
            root,
            conn,
            target,
            destination,
            operation,
            canonical,
            &confirmed,
        )?;
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "invitation_obsolete",
        )?;
        center.finish_attempt_obsolete(
            &operation.operation_id,
            "The invitation is no longer actionable.",
            Utc::now(),
        )?;
        return Ok(0);
    }
    if remote_self_response(&confirmed.body, &intent.self_email).as_deref()
        != Some(intent.response_status.as_str())
    {
        state::pause_outbox_operation(
            conn,
            destination,
            &operation.operation_id,
            "provider_confirmation_mismatch",
        )?;
        center.finish_attempt_failed(
            &operation.operation_id,
            "provider_failed",
            "Google did not confirm the selected invitation response.",
            true,
            Utc::now(),
        )?;
        return Ok(0);
    }
    import_invitation_provider_state(
        root,
        conn,
        target,
        destination,
        operation,
        canonical,
        &confirmed,
    )?;
    state::complete_outbox_operation(conn, destination, &operation.operation_id)?;
    center.finish_attempt_succeeded(&operation.operation_id, Utc::now())?;
    Ok(1)
}

fn confirmed_event_response<H: HttpClient>(
    client: &CalendarClient<'_, H>,
    event_id: &str,
    response: crate::google::client::HttpResponse,
) -> crate::Result<crate::google::client::HttpResponse> {
    if response
        .body
        .get("id")
        .and_then(|value| value.as_str())
        .is_some()
    {
        return Ok(response);
    }
    client.get_event(event_id)
}

fn remote_self_response(resource: &serde_json::Value, self_email: &str) -> Option<String> {
    let matches = resource
        .get("attendees")
        .and_then(|value| value.as_array())?
        .iter()
        .filter(|attendee| {
            attendee.get("self").and_then(|value| value.as_bool()) == Some(true)
                && attendee.get("email").and_then(|value| value.as_str()) == Some(self_email)
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [attendee] => attendee
            .get("responseStatus")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        _ => None,
    }
}

fn google_event_has_ended(resource: &serde_json::Value, now: chrono::DateTime<Utc>) -> bool {
    let Some(end) = resource.get("end") else {
        return true;
    };
    if let Some(value) = end.get("dateTime").and_then(|value| value.as_str()) {
        return chrono::DateTime::parse_from_rfc3339(value)
            .map(|value| value.with_timezone(&Utc) <= now)
            .unwrap_or(true);
    }
    if let Some(value) = end.get("date").and_then(|value| value.as_str()) {
        return chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map(|date| date <= now.date_naive())
            .unwrap_or(true);
    }
    true
}

fn canonical_event_has_ended(
    event: &crate::model::event::Event,
    now: chrono::DateTime<Utc>,
) -> bool {
    match &event.frontmatter.end {
        crate::model::event::TemporalValue::Date(date) => *date <= now.date_naive(),
        crate::model::event::TemporalValue::DateTime(value) => {
            let tzid = event
                .frontmatter
                .end_tzid
                .as_deref()
                .or(event.frontmatter.start_tzid.as_deref())
                .unwrap_or("UTC");
            crate::time::resolve_to_utc(*value, tzid)
                .map(|resolved| resolved.utc() <= now)
                .unwrap_or(true)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn import_invitation_provider_state(
    root: &Path,
    conn: &Connection,
    target: &EventSyncTarget,
    destination: &SyncDestination,
    operation: &crate::sync::state::OutboxOperation,
    canonical: &crate::model::event::Event,
    response: &crate::google::client::HttpResponse,
) -> crate::Result<()> {
    let mut frontmatter = google_to_jin(&response.body, &operation.jin_id, &target.calendar_id)?;
    frontmatter.master_id = canonical.frontmatter.master_id.clone();
    let event = crate::model::event::Event {
        frontmatter,
        body: canonical.body.clone(),
    };
    fs::write_event(&root.join("events"), &event)?;
    state::upsert_scoped_entry(
        conn,
        &ScopedEventSyncEntry {
            destination: destination.clone(),
            jin_id: operation.jin_id.clone(),
            recurrence_key: operation.recurrence_key.clone(),
            google_event_id: operation.google_event_id.clone(),
            ical_uid: event.frontmatter.ical_uid.clone(),
            etag: response
                .body
                .get("etag")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or(response.etag.clone()),
            google_updated: response
                .body
                .get("updated")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            last_synced_at: Some(Utc::now().to_rfc3339()),
        },
    )?;
    Ok(())
}
