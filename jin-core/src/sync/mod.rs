//! Sync-state store for Google Calendar synchronisation (S6.2 + S6.3).
//!
//! Layout: `.jin/sync/`
//!   `sync-state.sqlite`  — per-calendar sync_token; per-event mapping (NOT the index)
//!   `outbox.jsonl`       — human-readable log of queued local mutations (supplemental)
//!   `audit.jsonl`        — append-only conflict-resolution audit log (VG8, export-included)
//!
//! This module is OPERATIONAL, not canonical.  The index (`index.sqlite`) is
//! NEVER touched here.  The canonical event files are written by the Google sync
//! loop (via `store/fs.rs`) and then the index is refreshed via `ops::api::refresh`.

pub mod audit;
pub mod conflict;
pub mod state;
