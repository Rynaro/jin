use serde::{Deserialize, Serialize};

use crate::dto::TaskDto;
use crate::index::query::{BacklinkRow, EventRow};
use crate::model::event::{
    render_temporal, Event, EventAttendee, EventConferenceData, EventOrganizer,
    EventReminderSettings,
};

/// DTO projection of an Event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDto {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub start_tzid: Option<String>,
    pub end_tzid: Option<String>,
    pub floating: bool,
    pub status: String,
    pub source: String,
    pub authority: String,
    pub ical_uid: Option<String>,
    pub derived_from: Option<String>,
    pub recurrence: Vec<String>,
    pub recurring_event_id: Option<String>,
    pub original_start: Option<String>,
    pub master_id: Option<String>,
    pub recurrence_unexpanded: bool,
    pub sequence: i64,
    pub organizer: Option<EventOrganizer>,
    pub attendees: Option<Vec<EventAttendee>>,
    pub attendees_omitted: Option<bool>,
    pub conference_data: Option<EventConferenceData>,
    pub hangout_link: Option<String>,
    pub reminders: Option<EventReminderSettings>,
    pub created: String,
    pub updated: String,
    pub backlinks: Vec<EventBacklinkDto>,
    /// Stable provider route identity. Present for externally synchronized events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_context: Option<EventSyncContextDto>,
}

/// Presentation metadata for an event's exact synchronization destination.
/// Stable ids remain separate from renameable account/calendar labels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventSyncContextDto {
    pub provider: String,
    pub account_id: String,
    pub account_alias: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub access_role: String,
    pub writable: bool,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventBacklinkDto {
    pub source_id: String,
    pub source_kind: String,
    pub edge_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EventDisplayKind {
    Event,
    TimeBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventReadOnlyReason {
    Cancelled,
    RecurringMilestone1,
    UnsupportedRecurrence,
    ExternalAuthorityOrSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OriginatingTaskRefDto {
    pub id: String,
    pub title: String,
    pub status: String,
}

/// Opaque reference to the one durable RSVP attempt owned by Notification
/// Center.  It intentionally contains no provider credentials or route data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InvitationActionRefDto {
    pub notification_item_id: String,
    pub expected_item_version: u64,
}

/// The Event-detail projection of the existing invitation ledger.  The event
/// surface renders this state and dispatches the same bridge command as
/// Notification Center; it never creates a parallel RSVP outbox.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventInvitationCapabilitiesDto {
    pub action_ref: InvitationActionRefDto,
    pub provider_response: String,
    pub requested_response: Option<String>,
    pub state: String,
    pub can_respond: bool,
    pub recurrence_scopes: Vec<String>,
    pub disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct EventCollaborationCapabilitiesDto {
    pub invitation: Option<EventInvitationCapabilitiesDto>,
    pub can_edit_schedule: bool,
    pub can_append_attendees: bool,
    pub can_remove_attendees: bool,
    pub can_change_attendee_roles: bool,
    pub can_cancel_meeting: bool,
    pub can_add_conference: bool,
    pub can_remove_conference: bool,
    pub allowed_conference_solution_types: Vec<String>,
    pub disabled_reasons: std::collections::BTreeMap<String, String>,
}

/// Detail-only capabilities. List rows deliberately do not carry join-derived policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventDetailCapabilitiesDto {
    pub display_kind: EventDisplayKind,
    pub can_edit: bool,
    pub can_delete: bool,
    pub read_only_reason: Option<EventReadOnlyReason>,
    pub recurrence_pattern_supported: bool,
    pub recurrence_scopes: Vec<String>,
    pub can_return_task_to_flexible: bool,
    pub originating_task: Option<OriginatingTaskRefDto>,
    #[serde(default)]
    pub collaboration: EventCollaborationCapabilitiesDto,
}

/// Detail-only response. Event list rows remain the lean `EventDto` projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDetailDto {
    pub event: EventDto,
    pub capabilities: EventDetailCapabilitiesDto,
    /// Opaque optimistic-concurrency token derived from canonical Event bytes.
    pub edit_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditEventResultDto {
    pub event: EventDto,
    pub no_op: bool,
}

// ── S2: display-timezone range projection + temporal preview ──────────────────
//
// These are the single core-owned truth for "what time is this, in the
// timezone the user reads the calendar in". Every view and editor projects
// through them rather than re-deriving geometry from raw `list_events` rows.

/// How one local wall-time resolved against its IANA zone.
///
/// Mirrors `crate::time::TzResolution` across the DTO boundary without leaking
/// `chrono` types. The DST policy itself lives in `crate::time` (VG9) — this is
/// only its serializable projection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemporalResolutionKind {
    /// Unique, unambiguous mapping.
    Exact,
    /// Fall-back overlap; the earlier (pre-transition) instant was used.
    AmbiguousEarlier,
    /// Spring-forward gap; the wall-time was shifted forward by one hour.
    NonexistentShiftedForward,
}

/// Why an already-stored event's temporal fields cannot be safely edited.
///
/// Open question 2 resolved as a typed enum rather than `String`: the set is
/// closed, small, and each variant is asserted on by name in the S2 gate.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemporalDisabledReason {
    /// The stored wall-time is ambiguous (fall-back overlap), so the original
    /// instant the author intended cannot be proven to round-trip.
    AmbiguousWallTime,
    /// The stored wall-time is in a non-standard DST gap core cannot resolve.
    UnresolvableLocalTime,
    /// The stored IANA zone is not recognised.
    InvalidTimezone,
}

/// Which temporal family an entry belongs to; drives how a view lays it out.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarSlotState {
    /// Date-valued, exclusive canonical end.
    AllDay,
    /// Wall-time with no zone; never converted.
    Floating,
    /// Wall-time anchored to one or two IANA zones.
    Anchored,
}

/// Read-only request for one bounded, inclusive date window.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalendarRangeProjectionInput {
    /// Inclusive first display date, `YYYY-MM-DD`.
    pub from: String,
    /// Inclusive last display date, `YYYY-MM-DD`.
    pub to: String,
}

/// One event projected into the display timezone.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalendarRangeEntryDto {
    pub event_id: String,
    pub title: String,
    pub slot_state: CalendarSlotState,
    /// First display date the entry occupies, `YYYY-MM-DD`.
    pub start_date: String,
    /// Last display date the entry occupies (inclusive), `YYYY-MM-DD`.
    pub end_date: String,
    /// Display-timezone wall values. All-day entries carry `YYYY-MM-DD`;
    /// timed entries carry `YYYY-MM-DDTHH:MM:SS`.
    pub start_display: String,
    pub end_display: String,
    /// Resolved instants, `None` for all-day and floating entries.
    pub start_utc: Option<String>,
    pub end_utc: Option<String>,
    /// Every display date after `start_date` this entry continues onto.
    pub continuation_dates: Vec<String>,
    /// Wall-clock span in minutes; always positive for a valid stored event.
    pub elapsed_minutes: i64,
    /// The event's own zones, preserved independently — never collapsed.
    pub start_tzid: Option<String>,
    pub end_tzid: Option<String>,
    pub is_all_day: bool,
    pub floating: bool,
    pub start_resolution: Option<TemporalResolutionKind>,
    pub end_resolution: Option<TemporalResolutionKind>,
    /// `false` when the stored temporal identity cannot be proven to
    /// round-trip. Non-temporal edits stay available regardless.
    pub temporal_editable: bool,
    pub temporal_disabled_reason: Option<TemporalDisabledReason>,
}

/// Deterministic, bounded projection of one date window.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalendarRangeProjectionDto {
    pub from: String,
    pub to: String,
    pub display_tz: String,
    pub entries: Vec<CalendarRangeEntryDto>,
}

/// Candidate temporal values a composer wants resolved before saving.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventTemporalPreviewInput {
    /// `YYYY-MM-DD` when `is_all_day`, else `YYYY-MM-DDTHH:MM[:SS]`.
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub is_all_day: bool,
    #[serde(default)]
    pub floating: bool,
    #[serde(default)]
    pub start_tzid: Option<String>,
    #[serde(default)]
    pub end_tzid: Option<String>,
}

/// Outcome class of a temporal preview.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemporalPreviewStatus {
    Ok,
    /// A non-standard DST gap core policy could not resolve.
    UnresolvableLocalTime,
    InvalidTimezone,
    InvalidValue,
    NonPositiveDuration,
}

/// A validation failure bound to the draft field that caused it, so a later
/// Composer can attach it to the right control and block Save.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TemporalFieldErrorDto {
    /// `start` | `end` | `start_tzid` | `end_tzid` | `duration`.
    pub field: String,
    pub code: TemporalPreviewStatus,
    pub message: String,
}

/// The resolved, serializable truth for one candidate temporal bundle.
///
/// A non-`Ok` status never carries resolved instants and always reports
/// `schedulable = false` — core refuses to hand back a draft it cannot place
/// on a timeline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventTemporalPreviewDto {
    pub status: TemporalPreviewStatus,
    pub schedulable: bool,
    pub errors: Vec<TemporalFieldErrorDto>,
    pub start_resolution: Option<TemporalResolutionKind>,
    pub end_resolution: Option<TemporalResolutionKind>,
    pub start_utc: Option<String>,
    pub end_utc: Option<String>,
    /// The entered wall values, echoed back unchanged except where DST policy
    /// shifted them (`NonexistentShiftedForward`).
    pub start_display: String,
    pub end_display: String,
    pub start_tzid: Option<String>,
    pub end_tzid: Option<String>,
    pub is_all_day: bool,
    pub floating: bool,
    pub elapsed_minutes: Option<i64>,
    pub start_note: Option<String>,
    pub end_note: Option<String>,
}

/// Compound remove-Time-block response projected entirely into stable DTOs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveTimeBlockResultDto {
    pub event: EventDto,
    pub originating_task: Option<TaskDto>,
}

impl EventDto {
    pub fn from_model(event: &Event) -> Self {
        let fm = &event.frontmatter;
        Self {
            id: fm.id.clone(),
            title: fm.title.clone(),
            description: fm.description.clone(),
            location: fm.location.clone(),
            start: render_temporal(&fm.start),
            end: render_temporal(&fm.end),
            is_all_day: fm.is_all_day,
            start_tzid: fm.start_tzid.clone(),
            end_tzid: fm.end_tzid.clone(),
            floating: fm.floating,
            status: fm.status.to_string(),
            source: fm.source.to_string(),
            authority: fm.authority.to_string(),
            ical_uid: fm.ical_uid.clone(),
            derived_from: fm.derived_from.clone(),
            recurrence: fm.recurrence.clone(),
            recurring_event_id: fm.recurring_event_id.clone(),
            original_start: fm.original_start.as_ref().map(render_temporal),
            master_id: fm.master_id.clone(),
            recurrence_unexpanded: fm.recurrence_unexpanded,
            sequence: fm.sequence,
            organizer: fm.organizer.clone(),
            attendees: fm.attendees.clone(),
            attendees_omitted: fm.attendees_omitted,
            conference_data: fm.conference_data.clone(),
            hangout_link: fm.hangout_link.clone(),
            reminders: fm.reminders.clone(),
            created: fm.created.to_rfc3339(),
            updated: fm.updated.to_rfc3339(),
            backlinks: vec![],
            sync_context: None,
        }
    }

    /// Project from an EventRow — all M3 fields faithfully populated.
    pub(crate) fn from_row(row: &EventRow) -> Self {
        Self {
            id: row.id.clone(),
            title: row.title.clone(),
            description: None, // not stored in index row (body-side)
            location: None,    // not stored in index row (body-side)
            start: row.start.clone(),
            end: row.end_time.clone(),
            is_all_day: row.is_all_day,
            start_tzid: row.start_tzid.clone(),
            end_tzid: row.end_tzid.clone(),
            floating: row.floating,
            status: row.status.clone(),
            source: row.source.clone(),
            authority: row.authority.clone(),
            ical_uid: row.ical_uid.clone(),
            derived_from: row.derived_from.clone(),
            recurrence: vec![],
            recurring_event_id: None,
            original_start: None,
            master_id: None,
            recurrence_unexpanded: row.recurrence_unexpanded,
            sequence: 0,
            organizer: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            hangout_link: None,
            reminders: None,
            created: row.created.clone(),
            updated: row.updated.clone(),
            backlinks: vec![],
            sync_context: None,
        }
    }

    pub(crate) fn with_backlinks(mut self, bls: &[BacklinkRow]) -> Self {
        self.backlinks = bls
            .iter()
            .map(|b| EventBacklinkDto {
                source_id: b.source_id.clone(),
                source_kind: b.source_kind.clone(),
                edge_type: b.edge_type.clone(),
                label: b.backlink_label.clone(),
            })
            .collect();
        self
    }

    pub fn with_sync_context(mut self, context: EventSyncContextDto) -> Self {
        self.sync_context = Some(context);
        self
    }
}
