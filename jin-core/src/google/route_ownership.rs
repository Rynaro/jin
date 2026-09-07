//! Durable canonical route ownership without changing the public EventFrontmatter shape.
//!
//! Each routed event has a sibling `<event-id>.route.json` in `events/`. The
//! markdown schema remains source-compatible while route validation survives a
//! destroyed/rebuilt SQLite cache.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::google::account::{EventSyncTarget, GoogleAccountId, GOOGLE_PROVIDER};
use crate::JinError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalRouteOwnership {
    pub schema_version: u32,
    pub provider: String,
    pub account_id: GoogleAccountId,
    pub calendar_id: String,
}

fn path(events_dir: &Path, event_id: &str) -> PathBuf {
    events_dir.join(format!("{event_id}.route.json"))
}

pub fn write(events_dir: &Path, event_id: &str, target: &EventSyncTarget) -> crate::Result<()> {
    std::fs::create_dir_all(events_dir)?;
    let destination = path(events_dir, event_id);
    let tmp = destination.with_extension("route.json.tmp");
    let ownership = CanonicalRouteOwnership {
        schema_version: 1,
        provider: GOOGLE_PROVIDER.to_string(),
        account_id: target.account_id.clone(),
        calendar_id: target.calendar_id.clone(),
    };
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(&ownership)
            .map_err(|error| JinError::Integrity(format!("serialize event route: {error}")))?,
    )?;
    std::fs::rename(tmp, destination)?;
    Ok(())
}

pub fn read(events_dir: &Path, event_id: &str) -> crate::Result<Option<CanonicalRouteOwnership>> {
    let route_path = path(events_dir, event_id);
    if !route_path.exists() {
        return Ok(None);
    }
    serde_json::from_slice(&std::fs::read(route_path)?)
        .map(Some)
        .map_err(|error| JinError::Integrity(format!("parse event route: {error}")))
}

pub fn validate(events_dir: &Path, event_id: &str, target: &EventSyncTarget) -> crate::Result<()> {
    let ownership = read(events_dir, event_id)?.ok_or_else(|| {
        JinError::Integrity("synchronized event is missing canonical route ownership".to_string())
    })?;
    if ownership.provider != GOOGLE_PROVIDER
        || ownership.account_id != target.account_id
        || ownership.calendar_id != target.calendar_id
    {
        return Err(JinError::InvalidInput(
            "event belongs to a different provider account/calendar route".to_string(),
        ));
    }
    Ok(())
}

pub fn clear(events_dir: &Path, event_id: &str) -> crate::Result<()> {
    let route_path = path(events_dir, event_id);
    if route_path.exists() {
        std::fs::remove_file(route_path)?;
    }
    Ok(())
}
