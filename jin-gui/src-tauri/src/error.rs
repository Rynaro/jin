//! JinErrorDto — the error shape returned by all #[tauri::command] wrappers.
//!
//! Every JinError from jin-core maps to a `JinErrorDto` carrying the exit-code
//! equivalent (§4.1 of the GUI spec) so the frontend can render the correct error
//! state without parsing error strings.
//!
//! Exit-code taxonomy (mirrors jin/src/exit_code.rs):
//!   0 = ok (never in the error path)
//!   1 = other
//!   2 = usage (bad args / invalid edge / state-transition / timezone / already-exists)
//!   3 = not_found
//!   4 = sync_conflict
//!   5 = auth (re-auth required)
//!   6 = offline (retriable — local writes still succeed, sync queued)
//!   7 = integrity (index / not_initialized / dangling / general integrity)

use serde::{Deserialize, Serialize};

/// Machine-readable conflict information returned for stale note writes.
///
/// This is intentionally limited to revision metadata; it never exposes vault
/// paths or another writer's note body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JinErrorDetails {
    StaleNote {
        note_id: String,
        expected_revision: u64,
        current_revision: u64,
    },
    StaleEvent {
        event_id: String,
    },
    Validation {
        field: String,
        reason: String,
    },
    OperationConflict {
        operation_id: String,
        reason: String,
    },
    OperationBlocked {
        operation_id: String,
        reason: String,
    },
}

/// Error DTO returned by the Tauri command bridge.
///
/// Matches §4.1 of the GUI spec.  The Tauri IPC layer serialises this as the
/// `Err` variant of each command's `Result<T, JinErrorDto>`.
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("jin error [{kind}] code={code}: {message}")]
pub struct JinErrorDto {
    /// CLI exit-code equivalent: 1|2|3|4|5|6|7.
    pub code: u8,
    /// Symbolic kind: "not_found" | "sync_conflict" | "auth" | "offline" |
    ///                "integrity" | "usage" | "other"
    pub kind: String,
    /// Human-readable message (already localised by core where applicable).
    pub message: String,
    /// `true` only for `offline` (code 6): local writes succeed, retry sync later.
    pub retriable: bool,
    /// Optional machine-readable details for errors that need a recovery UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<JinErrorDetails>,
}

impl From<jin_core::JinError> for JinErrorDto {
    fn from(err: jin_core::JinError) -> Self {
        let (code, kind, retriable) = map_jin_error(&err);
        let details = match &err {
            jin_core::JinError::StaleNote {
                note_id,
                expected_revision,
                current_revision,
            } => Some(JinErrorDetails::StaleNote {
                note_id: note_id.clone(),
                expected_revision: *expected_revision,
                current_revision: *current_revision,
            }),
            jin_core::JinError::StaleEvent { event_id } => Some(JinErrorDetails::StaleEvent {
                event_id: event_id.clone(),
            }),
            jin_core::JinError::Validation { field, reason } => Some(JinErrorDetails::Validation {
                field: field.clone(),
                reason: reason.clone(),
            }),
            jin_core::JinError::OperationConflict {
                operation_id,
                reason,
            } => Some(JinErrorDetails::OperationConflict {
                operation_id: operation_id.clone(),
                reason: reason.clone(),
            }),
            jin_core::JinError::OperationBlocked {
                operation_id,
                reason,
            } => Some(JinErrorDetails::OperationBlocked {
                operation_id: operation_id.clone(),
                reason: reason.clone(),
            }),
            _ => None,
        };
        JinErrorDto {
            code,
            kind: kind.to_string(),
            message: err.to_string(),
            retriable,
            details,
        }
    }
}

/// Map a JinError to the (code, kind, retriable) triple.
/// Extracted so the mapping logic can be unit-tested independently.
pub fn map_jin_error(err: &jin_core::JinError) -> (u8, &'static str, bool) {
    use jin_core::JinError;
    match err {
        JinError::NotFound(_) => (3, "not_found", false),
        JinError::SyncConflict(_)
        | JinError::StaleNote { .. }
        | JinError::StaleEvent { .. }
        | JinError::OperationConflict { .. } => (4, "sync_conflict", false),
        JinError::Auth(_) => (5, "auth", false),
        JinError::Offline(_) => (6, "offline", true),
        // Integrity bucket: index errors, not-initialized, dangling edges, integrity
        JinError::Index(_)
        | JinError::NotInitialized { .. }
        | JinError::Integrity(_)
        | JinError::OperationBlocked { .. }
        | JinError::DanglingEdge { .. } => (7, "integrity", false),
        // Usage bucket: validation failures, bad args, already-exists
        JinError::InvalidEdgeType { .. }
        | JinError::InvalidStateTransition { .. }
        | JinError::InvalidTimezone { .. }
        | JinError::AlreadyInitialized { .. }
        | JinError::AlreadyExists(_)
        | JinError::ExportDestNotEmpty { .. }
        | JinError::InvalidInput(_)
        | JinError::Validation { .. } => (2, "usage", false),
        JinError::AmbiguousDestination { .. } => (2, "ambiguous_destination", false),
        // Everything else: Io, YamlParse, ...
        _ => (1, "other", false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jin_core::JinError;

    #[test]
    fn not_found_maps_to_code_3() {
        let err = JinError::NotFound("note/abc".to_string());
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 3);
        assert_eq!(dto.kind, "not_found");
        assert!(!dto.retriable);
    }

    #[test]
    fn auth_maps_to_code_5() {
        let err = JinError::Auth("re-auth required".to_string());
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 5);
        assert_eq!(dto.kind, "auth");
        assert!(!dto.retriable);
    }

    #[test]
    fn offline_maps_to_code_6_and_is_retriable() {
        let err = JinError::Offline("network timeout".to_string());
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 6);
        assert_eq!(dto.kind, "offline");
        assert!(dto.retriable, "offline must be retriable");
    }

    #[test]
    fn sync_conflict_maps_to_code_4() {
        let err = JinError::SyncConflict("conflict".to_string());
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 4);
        assert_eq!(dto.kind, "sync_conflict");
    }

    #[test]
    fn operation_details_are_derived_from_variants_not_display_wording() {
        let conflict = JinErrorDto::from(JinError::OperationConflict {
            operation_id: "conflict-id".to_string(),
            reason: "the policy snapshot no longer applies".to_string(),
        });
        assert_eq!(conflict.kind, "sync_conflict");
        assert!(matches!(
            conflict.details,
            Some(JinErrorDetails::OperationConflict {
                ref operation_id,
                ref reason,
            }) if operation_id == "conflict-id" && reason == "the policy snapshot no longer applies"
        ));

        let blocked = JinErrorDto::from(JinError::OperationBlocked {
            operation_id: "persisted-id".to_string(),
            reason: "manual repair is necessary".to_string(),
        });
        assert_eq!(blocked.kind, "integrity");
        assert!(matches!(
            blocked.details,
            Some(JinErrorDetails::OperationBlocked {
                ref operation_id,
                ref reason,
            }) if operation_id == "persisted-id" && reason == "manual repair is necessary"
        ));

        let validation = JinErrorDto::from(JinError::Validation {
            field: "operation_id".to_string(),
            reason: "supply an idempotency key".to_string(),
        });
        assert_eq!(validation.kind, "usage");
        assert!(matches!(
            validation.details,
            Some(JinErrorDetails::Validation {
                ref field,
                ref reason,
            }) if field == "operation_id" && reason == "supply an idempotency key"
        ));
    }

    #[test]
    fn not_initialized_maps_to_code_7() {
        let err = JinError::NotInitialized {
            path: "/tmp/notajin".to_string(),
        };
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 7);
        assert_eq!(dto.kind, "integrity");
    }

    #[test]
    fn invalid_edge_type_maps_to_code_2() {
        let err = JinError::InvalidEdgeType {
            edge_type: "bad-edge".to_string(),
            reason: "not in vocabulary".to_string(),
        };
        let dto = JinErrorDto::from(err);
        assert_eq!(dto.code, 2);
        assert_eq!(dto.kind, "usage");
    }
}
