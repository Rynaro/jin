//! S7 — Merged day-agenda DTO.
//!
//! `AgendaDto` is the versioned DTO for `jin today`.  It carries all events for
//! a given day from both sources (`source=jin` and `source=google`), the
//! display-timezone-correct start time for each event, and the integration
//! links that make the day view the connected hero view:
//!
//! * `originating_task` — the task a promoted event came from (`derived-from` edge)
//! * `prep_notes`       — notes attached with `prep-for` backlinks
//!
//! The two-bucket layout (`all_day_events` / `timed_events`) is stable and
//! version-tagged — consumers may append fields but must not remove or rename
//! these buckets.

use serde::{Deserialize, Serialize};

/// A note referenced from an agenda event (e.g., a prep note).
///
/// Carries both the id and title so the user can run `jin note show <id>`
/// without further lookups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedNoteRef {
    pub id: String,
    pub title: String,
}

/// The task an event was promoted from.
///
/// Carries both the id and title so the user can run `jin task show <id>`
/// without further lookups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedTaskRef {
    pub id: String,
    pub title: String,
}

/// A single event in the merged day agenda.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgendaEventDto {
    pub id: String,
    pub title: String,
    /// Wall-time as stored on disk (local to the event's `start_tzid`).
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub start_tzid: Option<String>,
    pub floating: bool,
    pub status: String,
    /// `"jin"` | `"google"` — who authored the event.
    pub source: String,
    pub authority: String,
    pub ical_uid: Option<String>,
    /// Raw ULID of the task this event was promoted from (the `derived-from` link field).
    pub derived_from: Option<String>,
    /// `true` → mirrored recurring event; not expanded in MVP.
    pub recurrence_unexpanded: bool,
    pub created: String,
    pub updated: String,
    /// Start time converted to the display timezone (`"HH:MM"`) or `"all-day"`.
    /// Used for human display and for consistent ordering across source timezones.
    pub display_start: String,
    /// Resolved originating task (populated when `derived_from` is set and the task
    /// exists in the index).
    pub originating_task: Option<LinkedTaskRef>,
    /// Notes attached to this event via `prep-for` backlinks.
    pub prep_notes: Vec<LinkedNoteRef>,
    /// Exact provider destination and presentation labels when synchronized.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_context: Option<crate::dto::EventSyncContextDto>,
}

/// The merged day agenda — one view for all events, both sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgendaDto {
    /// Target date (`YYYY-MM-DD`) in the display timezone.
    pub date: String,
    /// IANA timezone name used for display and date filtering.
    pub display_tz: String,
    /// All-day (date-bounded, no time) events, sorted by date then title.
    pub all_day_events: Vec<AgendaEventDto>,
    /// Timed and floating events, sorted by UTC start time (ascending).
    pub timed_events: Vec<AgendaEventDto>,
}

/// The compact task projection used by the connected Today desk.
///
/// This deliberately carries no scheduling fields: a task due value is not a
/// promised start time or duration. Timed work remains represented by events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgendaTaskDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due: Option<String>,
    pub list: String,
    pub position: String,
    pub parent: Option<String>,
    pub agenda_bucket: Option<String>,
}

/// A timed agenda event resolved by core for the current-focus presentation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodayFocusEventDto {
    pub event_id: String,
    pub start_utc: i64,
    pub end_utc: i64,
    /// Minutes left for active work, or minutes until start for upcoming work.
    pub minutes: i64,
}

/// Backend-authoritative daily projection for the Today route.
///
/// `AgendaDto` remains the stable legacy agenda contract. This wrapper adds
/// current-day work and focus without changing existing consumers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodayProjectionDto {
    pub agenda: AgendaDto,
    pub current_date: String,
    pub is_current_date: bool,
    pub attention_tasks: Vec<AgendaTaskDto>,
    pub due_tasks: Vec<AgendaTaskDto>,
    pub flexible_tasks: Vec<AgendaTaskDto>,
    pub active_events: Vec<TodayFocusEventDto>,
    pub next_event: Option<TodayFocusEventDto>,
    pub generated_at_utc: String,
}
