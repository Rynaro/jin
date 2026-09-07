//! Append-only conflict audit log (VG8).
//!
//! Every conflict resolution is appended as a single JSON line to
//! `.jin/sync/audit.jsonl`.  The file is never rewritten, only extended.
//!
//! The audit log is EXPORT-INCLUDED (sovereignty), human-readable, and feeds S8.
//! Wall-clock timestamps are fine here — this is an operational/audit artifact,
//! not a deterministic index column (does not feed VG1).

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ── Entry types ───────────────────────────────────────────────────────────────

/// Snapshot of one side (local or remote) at conflict time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSide {
    /// Event title.
    pub title: Option<String>,
    /// Last-known ETag for this side.
    pub etag: Option<String>,
    /// `updated` timestamp (RFC 3339) for this side.
    pub updated: Option<String>,
}

/// A single conflict-resolution record.
///
/// One line is written per resolved conflict, never updated, never deleted.
/// VG8: every conflict + loser snapshot is recorded here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Wall-clock timestamp of the resolution (RFC 3339).
    pub timestamp: String,
    /// Conflict kind: "PullDiverged" | "PullBothSidesChanged" |
    ///                "RemoteDeleteOfPromoted" | "PushPreconditionFailed".
    pub conflict_kind: String,
    /// Jin ULID of the affected event.
    pub jin_id: String,
    /// Google event ID at the time of the conflict, if known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_event_id: Option<String>,
    /// iCalUID, if known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ical_uid: Option<String>,
    /// Local (Jin) side snapshot.
    pub local_side: AuditSide,
    /// Remote (Google) side snapshot.
    pub remote_side: AuditSide,
    /// Resolution policy applied (e.g. "remote-wins", "lww-google", "lww-jin", "unpublish").
    pub resolution: String,
    /// Which side won: "google" | "jin".
    pub winner: String,
    /// Human-readable description of what was applied / kept / unpublished / overwritten.
    pub applied: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedAuditEntry {
    pub timestamp: String,
    pub operation_id: String,
    pub operation: String,
    pub provider: String,
    pub account_id: String,
    pub calendar_id: String,
    pub jin_id: String,
    pub recurrence_key: String,
    pub google_event_id: Option<String>,
    pub base_etag: Option<String>,
    pub remote_etag: Option<String>,
    pub attempted_delta: serde_json::Value,
    pub attempted_post_hash: String,
    pub remote_snapshot: serde_json::Value,
    pub remote_snapshot_hash: String,
    pub resolution: String,
    pub winner: String,
}

pub fn redacted_delta(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "access_token"
                            | "refresh_token"
                            | "client_secret"
                            | "alias"
                            | "local_context"
                    )
                })
                .map(|(key, value)| (key.clone(), redacted_delta(value)))
                .collect(),
        ),
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(redacted_delta).collect())
        }
        other => other.clone(),
    }
}

// ── Writer ────────────────────────────────────────────────────────────────────

/// Append a single audit entry as one JSON line to `<sync_dir>/audit.jsonl`.
///
/// Creates the file (and parent directory) if they do not yet exist.
/// This function is the ONLY writer; callers MUST NOT rewrite the file.
pub fn append_audit_entry(sync_dir: &Path, entry: &AuditEntry) -> crate::Result<()> {
    std::fs::create_dir_all(sync_dir)?;
    let path = sync_dir.join("audit.jsonl");
    let line = serde_json::to_string(entry)
        .map_err(|e| crate::JinError::Integrity(format!("audit serialize error: {e}")))?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

pub fn append_scoped_audit_entry(sync_dir: &Path, entry: &ScopedAuditEntry) -> crate::Result<()> {
    std::fs::create_dir_all(sync_dir)?;
    let path = sync_dir.join("audit.jsonl");
    let line = serde_json::to_string(entry)
        .map_err(|e| crate::JinError::Integrity(format!("audit serialize error: {e}")))?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(jin_id: &str) -> AuditEntry {
        AuditEntry {
            timestamp: "2026-06-27T10:00:00Z".to_string(),
            conflict_kind: "PullDiverged".to_string(),
            jin_id: jin_id.to_string(),
            google_event_id: Some("google123".to_string()),
            ical_uid: Some("uid@google.com".to_string()),
            local_side: AuditSide {
                title: Some("My Event".to_string()),
                etag: Some("\"v1\"".to_string()),
                updated: Some("2026-06-26T09:00:00Z".to_string()),
            },
            remote_side: AuditSide {
                title: Some("My Event (Google edit)".to_string()),
                etag: Some("\"v2\"".to_string()),
                updated: Some("2026-09-01T12:00:00Z".to_string()),
            },
            resolution: "lww-google".to_string(),
            winner: "google".to_string(),
            applied: "Google changes applied; source=jin preserved".to_string(),
        }
    }

    #[test]
    fn append_creates_file_and_writes_valid_json() {
        let tmp = TempDir::new().unwrap();
        let sync_dir = tmp.path().to_path_buf();

        let entry = make_entry("01JTEST01");
        append_audit_entry(&sync_dir, &entry).unwrap();

        let path = sync_dir.join("audit.jsonl");
        assert!(path.exists(), "audit.jsonl must be created");

        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 1, "must have exactly one line");

        // Must parse back as valid JSON
        let parsed: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(parsed["jin_id"], "01JTEST01");
        assert_eq!(parsed["conflict_kind"], "PullDiverged");
        assert_eq!(parsed["winner"], "google");
    }

    #[test]
    fn append_only_two_entries_both_lines_preserved() {
        let tmp = TempDir::new().unwrap();
        let sync_dir = tmp.path().to_path_buf();

        // Write first entry
        append_audit_entry(&sync_dir, &make_entry("01JTEST01")).unwrap();
        let content_after_first = std::fs::read_to_string(sync_dir.join("audit.jsonl")).unwrap();
        let first_line = content_after_first.lines().next().unwrap().to_string();

        // Write second entry
        append_audit_entry(&sync_dir, &make_entry("01JTEST02")).unwrap();

        let content = std::fs::read_to_string(sync_dir.join("audit.jsonl")).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "must have two lines");
        assert_eq!(
            lines[0], first_line,
            "first line must be unchanged (append-only)"
        );

        // Both lines must be valid JSON with distinct jin_ids
        let p1: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        let p2: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(p1["jin_id"], "01JTEST01");
        assert_eq!(p2["jin_id"], "01JTEST02");
    }

    #[test]
    fn entry_is_human_readable_jsonl() {
        let tmp = TempDir::new().unwrap();
        let sync_dir = tmp.path().to_path_buf();
        append_audit_entry(&sync_dir, &make_entry("01JTEST03")).unwrap();

        let content = std::fs::read_to_string(sync_dir.join("audit.jsonl")).unwrap();
        // Must be non-empty plain text (no binary)
        assert!(!content.is_empty());
        // Must contain readable field names
        assert!(
            content.contains("conflict_kind"),
            "must have conflict_kind field"
        );
        assert!(content.contains("winner"), "must have winner field");
        assert!(content.contains("applied"), "must have applied field");
    }
}
