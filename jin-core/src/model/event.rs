use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Google Calendar organizer identity retained on mirrored events.
///
/// `organizer` is read-only on normal insert/update requests (Google requires
/// `events.move` to change it), but keeping it in the canonical event makes the
/// local mirror and DTO faithful to the remote resource.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventOrganizer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(rename = "self", default, skip_serializing_if = "Option::is_none")]
    pub is_self: Option<bool>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One Google Calendar attendee. Read-only identity flags are retained on
/// pull, then filtered from normal write payloads by the Google mapper.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventAttendee {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizer: Option<bool>,
    #[serde(rename = "self", default, skip_serializing_if = "Option::is_none")]
    pub is_self: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_guests: Option<i64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventReminderOverride {
    pub method: String,
    pub minutes: i64,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Google event reminder policy. This is intentionally distinct from
/// `model::task::Reminder`: Calendar defaults/overrides are provider delivery
/// settings, not Jin's device-local task reminder schedule.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventReminderSettings {
    #[serde(default)]
    pub use_default: bool,
    /// `None` preserves Google's distinction between an omitted override list
    /// and an explicitly empty list (both differ from calendar defaults).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overrides: Option<Vec<EventReminderOverride>>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConferenceSolutionKey {
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConferenceSolution {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<ConferenceSolutionKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_uri: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConferenceEntryPoint {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_point_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passcode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConferenceCreateStatus {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_code: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConferenceCreateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conference_solution_key: Option<ConferenceSolutionKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ConferenceCreateStatus>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// A Jin-authored request for a new, unique conference. Unlike Google's
/// returned `createRequest` snapshot, this type cannot carry server status and
/// is the only create-request shape eligible for a write payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingConferenceCreateRequest {
    pub request_id: String,
    pub conference_solution_key: ConferenceSolutionKey,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventConferenceData {
    /// Server-returned create request snapshot; retained but never replayed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_request: Option<ConferenceCreateRequest>,
    /// Explicit fresh request authored by Jin; rendered as Google's
    /// `createRequest` and removed when the provider response is applied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_create_request: Option<PendingConferenceCreateRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entry_points: Vec<ConferenceEntryPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conference_solution: Option<ConferenceSolution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conference_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// value_type for temporal fields: date-time or date (all-day).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ValueType {
    #[default]
    DateTime,
    Date,
}

/// RFC-5545 event status.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    #[default]
    Confirmed,
    Tentative,
    /// Tombstone (soft-delete)
    Cancelled,
}

impl std::fmt::Display for EventStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventStatus::Confirmed => write!(f, "confirmed"),
            EventStatus::Tentative => write!(f, "tentative"),
            EventStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// The temporal start/end: either a NaiveDateTime (wall-time, with tzid stored separately)
/// or a NaiveDate (all-day).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TemporalValue {
    DateTime(NaiveDateTime),
    Date(NaiveDate),
}

/// Source: who authored the event.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventSource {
    #[default]
    Jin,
    Google,
}

impl std::fmt::Display for EventSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventSource::Jin => write!(f, "jin"),
            EventSource::Google => write!(f, "google"),
        }
    }
}

fn default_calendar_id() -> String {
    "primary".to_string()
}

fn default_sequence() -> i64 {
    0
}

/// Full RFC-5545 event frontmatter (ADR-0001 §3.4).
/// All fields present from day one; recurrence fields empty/null for single events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFrontmatter {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // always "event"
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,

    // --- temporal core (un-normalized: local wall-time + tzid) ---
    /// Wall-time (NaiveDateTime) or bare date (NaiveDate), stored without offset.
    pub start: TemporalValue,
    pub end: TemporalValue,
    #[serde(default)]
    pub start_value_type: ValueType,
    #[serde(default)]
    pub end_value_type: ValueType,
    #[serde(default)]
    pub is_all_day: bool,
    /// IANA tzid for start; null when all-day or floating.
    #[serde(default)]
    pub start_tzid: Option<String>,
    /// IANA tzid for end; null when all-day or floating.
    #[serde(default)]
    pub end_tzid: Option<String>,
    #[serde(default)]
    pub floating: bool,

    // --- recurrence (verbatim; empty for MVP single events) ---
    #[serde(default)]
    pub recurrence: Vec<String>,
    #[serde(default)]
    pub recurring_event_id: Option<String>,
    #[serde(default)]
    pub original_start: Option<TemporalValue>,
    #[serde(default)]
    pub master_id: Option<String>,
    #[serde(default)]
    pub recurrence_unexpanded: bool,

    // --- identity / lifecycle ---
    #[serde(default)]
    pub ical_uid: Option<String>,
    #[serde(default = "default_sequence")]
    pub sequence: i64,
    #[serde(default)]
    pub status: EventStatus,
    pub created: DateTime<FixedOffset>,
    pub updated: DateTime<FixedOffset>,
    #[serde(default)]
    pub transparency: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,

    // --- meeting metadata (Google Calendar event resource) ---
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizer: Option<EventOrganizer>,
    /// `None` means the provider field was absent; `Some(vec![])` is an
    /// explicit request to clear the attendee array on a patch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attendees: Option<Vec<EventAttendee>>,
    /// Provider truncation/limited-response marker. `None` preserves absence;
    /// `Some(true)` is emitted only alongside an explicit limited RSVP patch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attendees_omitted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conference_data: Option<EventConferenceData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hangout_link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminders: Option<EventReminderSettings>,

    // --- source / authority (DEC-09) ---
    #[serde(default)]
    pub source: EventSource,
    #[serde(default)]
    pub authority: EventSource,
    #[serde(default = "default_calendar_id")]
    pub calendar_id: String,

    // --- links (source-side) ---
    /// Set when promoted from a Task; stores the Task ULID.
    #[serde(default)]
    pub derived_from: Option<String>,
}

impl EventFrontmatter {
    pub fn is_deleted(&self) -> bool {
        self.status == EventStatus::Cancelled
    }
}

/// A parsed Event (frontmatter + optional body).
#[derive(Debug, Clone)]
pub struct Event {
    pub frontmatter: EventFrontmatter,
    pub body: String,
}

impl Event {
    pub fn id(&self) -> &str {
        &self.frontmatter.id
    }
    pub fn title(&self) -> &str {
        &self.frontmatter.title
    }
    pub fn is_deleted(&self) -> bool {
        self.frontmatter.is_deleted()
    }
}

/// Helper: parse a datetime string that might be NaiveDateTime or NaiveDate.
/// Used when reading temporal values from YAML.
pub fn parse_temporal(s: &str) -> Option<TemporalValue> {
    // Try NaiveDateTime first
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Some(TemporalValue::DateTime(dt));
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M") {
        return Some(TemporalValue::DateTime(dt));
    }
    // Try NaiveDate
    if let Ok(d) = s.parse::<NaiveDate>() {
        return Some(TemporalValue::Date(d));
    }
    None
}

/// Render a TemporalValue to its canonical string form.
pub fn render_temporal(tv: &TemporalValue) -> String {
    match tv {
        TemporalValue::DateTime(dt) => dt.format("%Y-%m-%dT%H:%M:%S").to_string(),
        TemporalValue::Date(d) => d.format("%Y-%m-%d").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_event_without_meeting_metadata_uses_backward_compatible_defaults() {
        let event: EventFrontmatter = serde_json::from_value(serde_json::json!({
            "id": "01JLEGACYEVENT",
            "type": "event",
            "title": "Legacy",
            "description": null,
            "location": null,
            "start": "2026-09-02",
            "end": "2026-09-03",
            "created": "2026-09-01T00:00:00Z",
            "updated": "2026-09-01T00:00:00Z"
        }))
        .unwrap();

        assert!(event.organizer.is_none());
        assert!(event.attendees.is_none());
        assert!(event.attendees_omitted.is_none());
        assert!(event.conference_data.is_none());
        assert!(event.hangout_link.is_none());
        assert!(event.reminders.is_none());
    }
}
