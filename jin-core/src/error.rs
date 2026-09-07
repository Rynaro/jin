use thiserror::Error;

#[derive(Debug, Error)]
pub enum JinError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("already exists: {0}")]
    AlreadyExists(String),

    #[error("invalid edge type '{edge_type}': {reason}")]
    InvalidEdgeType { edge_type: String, reason: String },

    #[error("invalid state transition from '{from}' to '{to}'")]
    InvalidStateTransition { from: String, to: String },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("yaml parse error: {0}")]
    YamlParse(String),

    #[error("index error: {0}")]
    Index(#[from] rusqlite::Error),

    #[error("not initialized: {path} is not a jin root (missing .jin/config.toml)")]
    NotInitialized { path: String },

    #[error("already initialized at {path}")]
    AlreadyInitialized { path: String },

    #[error("integrity error: {0}")]
    Integrity(String),

    #[error("dangling edge: source {source_id} -> target {target_id} (target not found)")]
    DanglingEdge {
        source_id: String,
        target_id: String,
    },

    #[error("invalid timezone '{tzid}': {reason}")]
    InvalidTimezone { tzid: String, reason: String },

    /// Auth/OAuth failure — re-authentication required (exit 5).
    /// Covers: missing credentials, token exchange failures, invalid_grant / revoked refresh token.
    #[error("auth error (re-auth required): {0}")]
    Auth(String),

    /// Network / offline error (exit 6).
    #[error("network error: {0}")]
    Offline(String),

    /// Sync conflict detected; resolution is S6.3 (exit 4).
    #[error("sync conflict: {0}")]
    SyncConflict(String),

    /// A note write or restore was rejected because the caller's optimistic
    /// revision is stale. The structured fields let interactive clients preserve
    /// their local draft and present an explicit recovery choice.
    #[error(
        "note {note_id} changed from revision {expected_revision} to {current_revision}; \
         refresh before editing"
    )]
    StaleNote {
        note_id: String,
        expected_revision: u64,
        current_revision: u64,
    },

    /// An Event edit was based on canonical bytes that are no longer current.
    /// Tokens are intentionally opaque and are not included in the error.
    #[error("event {event_id} changed after editing began; review the latest details")]
    StaleEvent { event_id: String },

    /// A durable compound-operation id was reused for an incompatible action,
    /// or the action's eligibility changed after its detail projection.
    #[error("operation {operation_id} conflict: {reason}")]
    OperationConflict {
        operation_id: String,
        reason: String,
    },

    /// A durable compound operation cannot converge without explicit repair.
    #[error("operation {operation_id} blocked: {reason}")]
    OperationBlocked {
        operation_id: String,
        reason: String,
    },

    /// Structured input validation metadata for interactive clients.
    #[error("invalid {field}: {reason}")]
    Validation { field: String, reason: String },

    /// Export destination is non-empty (safe default refuses overwrite).
    /// Pass `--force` to overwrite.
    #[error(
        "export destination '{path}' is not empty. \
         Use --force to overwrite an existing export."
    )]
    ExportDestNotEmpty { path: String },

    /// Invalid input (validation failure): folder path traversal, bad args, etc.
    /// Maps to exit code 2 (usage) at the bridge layer.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// A provider-backed mutation has more than one eligible destination and
    /// the caller did not provide an exact immutable route.
    #[error("ambiguous_destination: choose one of {count} writable destinations")]
    AmbiguousDestination { count: usize },
}

pub type Result<T> = std::result::Result<T, JinError>;
