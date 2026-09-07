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
