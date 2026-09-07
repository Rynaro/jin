//! Exit code taxonomy (S3).

/// Exit codes for the jin CLI.
#[allow(dead_code)]
#[derive(Copy, Clone)]
pub enum ExitCode {
    /// 0 — success
    Ok = 0,
    /// 1 — other/unexpected error
    Other = 1,
    /// 2 — usage error (bad args, invalid edge type, etc.)
    Usage = 2,
    /// 3 — not found
    NotFound = 3,
    /// 4 — sync conflict surfaced
    SyncConflict = 4,
    /// 5 — auth/OAuth error (re-auth needed)
    Auth = 5,
    /// 6 — offline/no network
    Offline = 6,
    /// 7 — integrity/index error
    Integrity = 7,
}

impl ExitCode {
    pub fn from_jin_error(err: &jin_core::JinError) -> Self {
        match err {
            jin_core::JinError::NotFound(_) => ExitCode::NotFound,
            jin_core::JinError::NotInitialized { .. } => ExitCode::Integrity,
            jin_core::JinError::AlreadyInitialized { .. } => ExitCode::Usage,
            jin_core::JinError::InvalidEdgeType { .. } => ExitCode::Usage,
            jin_core::JinError::InvalidStateTransition { .. } => ExitCode::Usage,
            jin_core::JinError::InvalidTimezone { .. } => ExitCode::Usage,
            jin_core::JinError::Index(_) => ExitCode::Integrity,
            jin_core::JinError::Integrity(_) => ExitCode::Integrity,
            jin_core::JinError::OperationBlocked { .. } => ExitCode::Integrity,
            jin_core::JinError::DanglingEdge { .. } => ExitCode::Integrity,
            // S6.1: OAuth / auth errors → exit 5 (re-auth needed)
            jin_core::JinError::Auth(_) => ExitCode::Auth,
            // S6.2: network errors → exit 6
            jin_core::JinError::Offline(_) => ExitCode::Offline,
            // S6.2: sync conflicts detected → exit 4
            jin_core::JinError::SyncConflict(_)
            | jin_core::JinError::StaleNote { .. }
            | jin_core::JinError::OperationConflict { .. } => ExitCode::SyncConflict,
            jin_core::JinError::Validation { .. } => ExitCode::Usage,
            jin_core::JinError::AmbiguousDestination { .. } => ExitCode::Usage,
            // S8: non-empty dest without --force → usage error (exit 2)
            jin_core::JinError::ExportDestNotEmpty { .. } => ExitCode::Usage,
            _ => ExitCode::Other,
        }
    }
}
