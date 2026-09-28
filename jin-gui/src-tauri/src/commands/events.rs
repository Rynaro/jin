//! Event CRUD commands.

use std::path::Path;

use serde::Deserialize;

use jin_core::dto::{
    EditEventResultDto, EventDetailDto, EventDto, RemoveTimeBlockResultDto, TaskDto,
};
use jin_core::model::event::{
    EventAttendee, EventConferenceData, EventReminderSettings, TemporalValue, ValueType,
};
use jin_core::ops::{api, events};

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Input types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EventInput {
    pub title: String,
    /// ISO 8601 datetime ("YYYY-MM-DDTHH:MM:SS") for timed events, or
    /// "YYYY-MM-DD" for all-day events.
    pub start: String,
    /// ISO 8601 datetime or date (matching `start` format).
    pub end: String,
    /// IANA timezone id (e.g. "America/New_York"). `None` → floating.
    pub tzid: Option<String>,
    #[serde(default)]
    pub is_all_day: bool,
    pub description: Option<String>,
    pub location: Option<String>,
    pub recurrence: Option<jin_core::recurrence::RecurrenceDraft>,
    #[serde(default)]
    pub attendees: Option<Vec<EventAttendee>>,
    #[serde(default)]
    pub attendees_omitted: Option<bool>,
    #[serde(default)]
    pub conference_data: Option<EventConferenceData>,
    #[serde(default)]
    pub clear_conference_data: bool,
    #[serde(default)]
    pub reminders: Option<EventReminderSettings>,
}

#[derive(Debug, Deserialize)]
pub struct RemoveTimeBlockInput {
    pub event_id: String,
    #[serde(default)]
    pub return_to_flexible: bool,
    pub operation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct EditEventInput {
    pub event_id: String,
    pub edit_token: String,
    pub operation_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub tzid: Option<String>,
    #[serde(default)]
    pub is_all_day: bool,
    pub description: Option<String>,
    pub location: Option<String>,
    /// A typed replacement for the event's RRULE set. Omit to preserve it.
    #[serde(default)]
    pub recurrence: Option<jin_core::recurrence::RecurrenceDraft>,
    /// Explicitly remove recurrence when no replacement draft is supplied.
    #[serde(default)]
    pub clear_recurrence: bool,
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
    #[serde(default)]
    pub attendees: Option<Vec<EventAttendee>>,
    #[serde(default)]
    pub attendees_omitted: Option<bool>,
    #[serde(default)]
    pub conference_data: Option<EventConferenceData>,
    #[serde(default)]
    pub clear_conference_data: bool,
    #[serde(default)]
    pub reminders: Option<EventReminderSettings>,
}

#[derive(Debug, Deserialize)]
pub struct RoutedEventInput {
    #[serde(flatten)]
    pub event: EventInput,
    pub account_id: String,
    pub calendar_id: String,
    pub operation_id: String,
    #[serde(default)]
    pub guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy,
}

#[derive(Debug, Deserialize)]
pub struct RoutedEditEventInput {
    #[serde(flatten)]
    pub edit: EditEventInput,
    pub account_id: String,
    pub calendar_id: String,
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
    #[serde(default)]
    pub guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy,
}

#[derive(Debug, Deserialize)]
pub struct RoutedDeleteEventInput {
    pub event_id: String,
    pub account_id: String,
    pub calendar_id: String,
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
    pub operation_id: String,
    #[serde(default)]
    pub guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy,
}

#[derive(Debug, Deserialize)]
pub struct RecurrencePreviewInput {
    pub start: String,
    pub tzid: Option<String>,
    #[serde(default)]
    pub is_all_day: bool,
    pub recurrence: jin_core::recurrence::RecurrenceDraft,
}

// ── S2: sparse edit inputs ────────────────────────────────────────────────────

/// Sparse sibling of [`EditEventInput`]: carries only the fields the user
/// actually touched, with time travelling as one atomic bundle or not at all.
#[derive(Debug, Deserialize)]
pub struct EditEventDeltaInput {
    pub event_id: String,
    pub edit_token: String,
    pub operation_id: String,
    /// Absent fields preserve the canonical value. A partial temporal bundle
    /// is rejected while deserializing this field, before it reaches core.
    pub delta: jin_core::ops::event_mutation::EventEditDelta,
    #[serde(default)]
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
}

/// Named for its `RoutedEditEventInput` sibling (open question 3).
#[derive(Debug, Deserialize)]
pub struct RoutedEditEventDeltaInput {
    #[serde(flatten)]
    pub edit: EditEventDeltaInput,
    pub account_id: String,
    pub calendar_id: String,
    #[serde(default)]
    pub guest_update_policy: jin_core::ops::event_mutation::GuestUpdatePolicy,
}

fn sync_target(
    account_id: String,
    calendar_id: String,
) -> Result<jin_core::google::account::EventSyncTarget, JinErrorDto> {
    let account_id =
        jin_core::google::account::GoogleAccountId::parse(account_id).map_err(JinErrorDto::from)?;
    jin_core::google::account::EventSyncTarget::new(account_id, calendar_id)
        .map_err(JinErrorDto::from)
}

fn parse_input(input: EventInput) -> Result<events::EditEventPatch, JinErrorDto> {
    if input.title.trim().is_empty() {
        return Err(JinErrorDto::from(jin_core::JinError::Validation {
            field: "title".to_string(),
            reason: "required".to_string(),
        }));
    }
    if let Some(ref tzid) = input.tzid {
        jin_core::time::validate_tzid(tzid).map_err(|reason| {
            JinErrorDto::from(jin_core::JinError::Validation {
                field: "tzid".to_string(),
                reason,
            })
        })?;
    }
    let (start, end, start_value_type, end_value_type) = if input.is_all_day {
        (
            parse_date(&input.start)?,
            parse_date(&input.end)?,
            ValueType::Date,
            ValueType::Date,
        )
    } else {
        (
            parse_timed(&input.start)?,
            parse_timed(&input.end)?,
            ValueType::DateTime,
            ValueType::DateTime,
        )
    };
    let floating = !input.is_all_day && input.tzid.is_none();
    let tzid = if input.is_all_day { None } else { input.tzid };
    Ok(events::EditEventPatch {
        title: input.title.trim().to_string(),
        start,
        end,
        start_value_type,
        end_value_type,
        is_all_day: input.is_all_day,
        start_tzid: tzid.clone(),
        end_tzid: tzid,
        floating,
        description: input.description,
        location: input.location,
        recurrence: None,
        attendees: input.attendees,
        attendees_omitted: input.attendees_omitted,
        conference_data: input.conference_data,
        clear_conference_data: input.clear_conference_data,
        reminders: input.reminders,
    })
}

// ── Parse helpers ──────────────────────────────────────────────────────────────

fn parse_timed(s: &str) -> Result<TemporalValue, JinErrorDto> {
    use chrono::NaiveDateTime;
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .map(TemporalValue::DateTime)
        .map_err(|_| {
            JinErrorDto::from(jin_core::JinError::Validation {
                field: "time".to_string(),
                reason: format!("invalid datetime '{}'; expected YYYY-MM-DDTHH:MM:SS", s),
            })
        })
}

fn parse_date(s: &str) -> Result<TemporalValue, JinErrorDto> {
    use chrono::NaiveDate;
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map(TemporalValue::Date)
        .map_err(|_| {
            JinErrorDto::from(jin_core::JinError::Validation {
                field: "date".to_string(),
                reason: format!("invalid date '{}'; expected YYYY-MM-DD", s),
            })
        })
}

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_events_fn(root: &Path, include_deleted: bool) -> Result<Vec<EventDto>, JinErrorDto> {
    api::list_events(root, include_deleted).map_err(JinErrorDto::from)
}

pub fn get_event_fn(root: &Path, id: String) -> Result<EventDto, JinErrorDto> {
    api::get_event(root, &id).map_err(JinErrorDto::from)
}

pub fn get_event_detail_fn(root: &Path, id: String) -> Result<EventDetailDto, JinErrorDto> {
    api::get_event_detail(root, &id).map_err(JinErrorDto::from)
}

pub fn remove_time_block_fn(
    root: &Path,
    input: RemoveTimeBlockInput,
) -> Result<RemoveTimeBlockResultDto, JinErrorDto> {
    jin_core::ops::recoverable_operations::validate_operation_id(&input.operation_id)
        .map_err(JinErrorDto::from)?;
    let result = jin_core::ops::remove_time_block::remove_time_block_with_operation_id(
        root,
        &input.event_id,
        input.return_to_flexible,
        &input.operation_id,
    )
    .map_err(JinErrorDto::from)?;
    Ok(RemoveTimeBlockResultDto {
        event: EventDto::from_model(&result.event),
        originating_task: result.originating_task.as_ref().map(TaskDto::from_model),
    })
}

pub fn create_event_fn(root: &Path, input: EventInput) -> Result<EventDto, JinErrorDto> {
    let recurrence_draft = input.recurrence.clone();
    let patch = parse_input(input)?;
    let recurrence = recurrence_draft
        .as_ref()
        .map(|draft| {
            jin_core::recurrence::compile(draft, &patch.start, patch.start_tzid.as_deref())
        })
        .transpose()
        .map_err(JinErrorDto::from)?
        .unwrap_or_default();
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let operation_id = format!("create-event-{}", jin_core::id::new_ulid());
    let event = service
        .create_with_recurrence(
            events::CreateEventParams {
                title: patch.title,
                body: String::new(),
                start: patch.start,
                end: patch.end,
                start_value_type: patch.start_value_type,
                end_value_type: patch.end_value_type,
                is_all_day: patch.is_all_day,
                start_tzid: patch.start_tzid,
                end_tzid: patch.end_tzid,
                floating: patch.floating,
                ical_uid: None,
                description: patch.description,
                location: patch.location,
                attendees: patch.attendees,
                conference_data: patch.conference_data,
                reminders: patch.reminders,
            },
            recurrence,
            None,
            &operation_id,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

pub fn delete_event_fn(root: &Path, id: String) -> Result<EventDto, JinErrorDto> {
    delete_event_scoped_fn(root, id, None)
}

pub fn delete_event_scoped_fn(
    root: &Path,
    id: String,
    recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
) -> Result<EventDto, JinErrorDto> {
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .delete_local_scoped(&id, recurrence_scope)
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

/// Translate the legacy full-edit shape into a sparse delta.
///
/// `EditEventInput` is retained for callers not yet migrated to the sparse
/// command. It always carries a complete temporal bundle, so it is expressible
/// as a delta without the browser ever synthesizing a value it was not given.
///
/// The one place the legacy shape is lossy is its single `tzid`, which pre-S2
/// was cloned onto *both* endpoints. When that `tzid` is simply the event's
/// existing start zone the caller is expressing no zone change at all, so
/// cloning it would silently destroy a distinct baseline end zone — the
/// baseline end zone is kept instead. When the caller genuinely changes the
/// zone, both endpoints move, exactly as before.
fn delta_from_legacy_edit(
    root: &Path,
    input: &EditEventInput,
) -> Result<jin_core::ops::event_mutation::EventEditDelta, JinErrorDto> {
    use jin_core::ops::event_mutation::{EventEditDelta, EventTemporalDelta};

    if input.title.trim().is_empty() {
        return Err(JinErrorDto::from(jin_core::JinError::Validation {
            field: "title".to_string(),
            reason: "required".to_string(),
        }));
    }
    if let Some(ref tzid) = input.tzid {
        jin_core::time::validate_tzid(tzid).map_err(|reason| {
            JinErrorDto::from(jin_core::JinError::Validation {
                field: "tzid".to_string(),
                reason,
            })
        })?;
    }

    let (start_tzid, end_tzid) = if input.is_all_day {
        (None, None)
    } else {
        let requested = input.tzid.clone();
        let baseline = api::get_event(root, &input.event_id).ok();
        let end = match (&requested, &baseline) {
            (Some(tzid), Some(baseline))
                if baseline.start_tzid.as_deref() == Some(tzid.as_str())
                    && baseline.end_tzid.is_some()
                    && baseline.end_tzid != baseline.start_tzid =>
            {
                baseline.end_tzid.clone()
            }
            _ => requested.clone(),
        };
        (requested, end)
    };
    let floating = !input.is_all_day && start_tzid.is_none();

    let temporal = EventTemporalDelta::new(
        input.start.clone(),
        input.end.clone(),
        input.is_all_day,
        floating,
        start_tzid,
        end_tzid,
    )
    .map_err(|reason| {
        JinErrorDto::from(jin_core::JinError::Validation {
            field: "temporal".to_string(),
            reason,
        })
    })?;

    Ok(EventEditDelta {
        title: Some(input.title.trim().to_string()),
        // The legacy shape is a total replacement, so an omitted description or
        // location genuinely means "clear it" — `Some(None)`, not `None`.
        description: Some(input.description.clone()),
        location: Some(input.location.clone()),
        temporal: Some(temporal),
        recurrence: input.recurrence.clone(),
        clear_recurrence: input.clear_recurrence,
        attendees: input.attendees.clone(),
        attendees_omitted: input.attendees_omitted,
        conference_data: input.conference_data.clone(),
        clear_conference_data: input.clear_conference_data,
        reminders: input.reminders.clone(),
    })
}

pub fn edit_event_fn(
    root: &Path,
    input: EditEventInput,
) -> Result<EditEventResultDto, JinErrorDto> {
    jin_core::ops::recoverable_operations::validate_operation_id(&input.operation_id)
        .map_err(JinErrorDto::from)?;
    let delta = delta_from_legacy_edit(root, &input)?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let result = service
        .edit_sparse(
            &input.event_id,
            &input.edit_token,
            delta,
            input.recurrence_scope,
            &input.operation_id,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EditEventResultDto {
        event: EventDto::from_model(&result.event),
        no_op: result.no_op,
    })
}

pub fn edit_event_delta_fn(
    root: &Path,
    input: EditEventDeltaInput,
) -> Result<EditEventResultDto, JinErrorDto> {
    jin_core::ops::recoverable_operations::validate_operation_id(&input.operation_id)
        .map_err(JinErrorDto::from)?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let result = service
        .edit_sparse(
            &input.event_id,
            &input.edit_token,
            input.delta,
            input.recurrence_scope,
            &input.operation_id,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EditEventResultDto {
        event: EventDto::from_model(&result.event),
        no_op: result.no_op,
    })
}

pub fn edit_routed_event_delta_fn(
    root: &Path,
    input: RoutedEditEventDeltaInput,
) -> Result<EventDto, JinErrorDto> {
    jin_core::ops::recoverable_operations::validate_operation_id(&input.edit.operation_id)
        .map_err(JinErrorDto::from)?;
    let target = sync_target(input.account_id, input.calendar_id)?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .edit_sparse_with_guest_update_policy(
            &input.edit.event_id,
            &input.edit.edit_token,
            input.edit.delta,
            target,
            input.edit.recurrence_scope,
            &input.edit.operation_id,
            input.guest_update_policy,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

pub fn calendar_range_projection_fn(
    root: &Path,
    input: jin_core::dto::CalendarRangeProjectionInput,
) -> Result<jin_core::dto::CalendarRangeProjectionDto, JinErrorDto> {
    jin_core::ops::calendar_projection::calendar_range_projection(root, &input)
        .map_err(JinErrorDto::from)
}

pub fn event_temporal_preview_fn(
    input: jin_core::dto::EventTemporalPreviewInput,
) -> jin_core::dto::EventTemporalPreviewDto {
    jin_core::ops::calendar_projection::event_temporal_preview(&input)
}

pub fn create_routed_event_fn(
    root: &Path,
    input: RoutedEventInput,
) -> Result<EventDto, JinErrorDto> {
    let target = sync_target(input.account_id, input.calendar_id)?;
    let guest_update_policy = input.guest_update_policy;
    let recurrence_draft = input.event.recurrence.clone();
    let patch = parse_input(input.event)?;
    let recurrence = recurrence_draft
        .as_ref()
        .map(|draft| {
            jin_core::recurrence::compile(draft, &patch.start, patch.start_tzid.as_deref())
        })
        .transpose()
        .map_err(JinErrorDto::from)?
        .unwrap_or_default();
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .create_with_recurrence_and_policy(
            events::CreateEventParams {
                title: patch.title,
                body: String::new(),
                start: patch.start,
                end: patch.end,
                start_value_type: patch.start_value_type,
                end_value_type: patch.end_value_type,
                is_all_day: patch.is_all_day,
                start_tzid: patch.start_tzid,
                end_tzid: patch.end_tzid,
                floating: patch.floating,
                ical_uid: None,
                description: patch.description,
                location: patch.location,
                attendees: patch.attendees,
                conference_data: patch.conference_data,
                reminders: patch.reminders,
            },
            recurrence,
            Some(target),
            &input.operation_id,
            guest_update_policy,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

pub fn preview_recurrence_fn(
    input: RecurrencePreviewInput,
) -> Result<jin_core::recurrence::RecurrencePreviewDto, JinErrorDto> {
    let start = if input.is_all_day {
        parse_date(&input.start)?
    } else {
        parse_timed(&input.start)?
    };
    jin_core::recurrence::preview(&input.recurrence, &start, input.tzid.as_deref(), 3)
        .map_err(JinErrorDto::from)
}

pub fn edit_routed_event_fn(
    root: &Path,
    input: RoutedEditEventInput,
) -> Result<EventDto, JinErrorDto> {
    let target = sync_target(input.account_id, input.calendar_id)?;
    let delta = delta_from_legacy_edit(root, &input.edit)?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .edit_sparse_with_guest_update_policy(
            &input.edit.event_id,
            &input.edit.edit_token,
            delta,
            target,
            input.recurrence_scope,
            &input.edit.operation_id,
            input.guest_update_policy,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

pub fn delete_routed_event_fn(
    root: &Path,
    input: RoutedDeleteEventInput,
) -> Result<EventDto, JinErrorDto> {
    let target = sync_target(input.account_id, input.calendar_id)?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .delete_with_guest_update_policy(
            &input.event_id,
            target,
            input.recurrence_scope,
            &input.operation_id,
            input.guest_update_policy,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EventDto::from_model(&event))
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_events(
    state: tauri::State<'_, AppState>,
    include_deleted: Option<bool>,
) -> Result<Vec<EventDto>, JinErrorDto> {
    list_events_fn(&state.root, include_deleted.unwrap_or(false))
}

#[tauri::command]
pub async fn get_event(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<EventDto, JinErrorDto> {
    get_event_fn(&state.root, id)
}

#[tauri::command]
pub async fn get_event_detail(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<EventDetailDto, JinErrorDto> {
    get_event_detail_fn(&state.root, id)
}

#[tauri::command]
pub async fn remove_time_block(
    state: tauri::State<'_, AppState>,
    input: RemoveTimeBlockInput,
) -> Result<RemoveTimeBlockResultDto, JinErrorDto> {
    remove_time_block_fn(&state.root, input)
}

#[tauri::command]
pub async fn create_event(
    state: tauri::State<'_, AppState>,
    input: EventInput,
) -> Result<EventDto, JinErrorDto> {
    create_event_fn(&state.root, input)
}

#[tauri::command]
pub async fn delete_event(
    state: tauri::State<'_, AppState>,
    id: String,
    recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
) -> Result<EventDto, JinErrorDto> {
    delete_event_scoped_fn(&state.root, id, recurrence_scope)
}

#[tauri::command]
pub async fn edit_event(
    state: tauri::State<'_, AppState>,
    input: EditEventInput,
) -> Result<EditEventResultDto, JinErrorDto> {
    edit_event_fn(&state.root, input)
}

#[tauri::command]
pub async fn create_routed_event(
    state: tauri::State<'_, AppState>,
    input: RoutedEventInput,
) -> Result<EventDto, JinErrorDto> {
    create_routed_event_fn(&state.root, input)
}

#[tauri::command]
pub async fn preview_recurrence(
    input: RecurrencePreviewInput,
) -> Result<jin_core::recurrence::RecurrencePreviewDto, JinErrorDto> {
    preview_recurrence_fn(input)
}

#[tauri::command]
pub async fn edit_routed_event(
    state: tauri::State<'_, AppState>,
    input: RoutedEditEventInput,
) -> Result<EventDto, JinErrorDto> {
    edit_routed_event_fn(&state.root, input)
}

#[tauri::command]
pub async fn delete_routed_event(
    state: tauri::State<'_, AppState>,
    input: RoutedDeleteEventInput,
) -> Result<EventDto, JinErrorDto> {
    delete_routed_event_fn(&state.root, input)
}

#[tauri::command]
pub async fn edit_event_delta(
    state: tauri::State<'_, AppState>,
    input: EditEventDeltaInput,
) -> Result<EditEventResultDto, JinErrorDto> {
    edit_event_delta_fn(&state.root, input)
}

#[tauri::command]
pub async fn edit_routed_event_delta(
    state: tauri::State<'_, AppState>,
    input: RoutedEditEventDeltaInput,
) -> Result<EventDto, JinErrorDto> {
    edit_routed_event_delta_fn(&state.root, input)
}

#[tauri::command]
pub async fn calendar_range_projection(
    state: tauri::State<'_, AppState>,
    input: jin_core::dto::CalendarRangeProjectionInput,
) -> Result<jin_core::dto::CalendarRangeProjectionDto, JinErrorDto> {
    calendar_range_projection_fn(&state.root, input)
}

#[tauri::command]
pub async fn event_temporal_preview(
    input: jin_core::dto::EventTemporalPreviewInput,
) -> Result<jin_core::dto::EventTemporalPreviewDto, JinErrorDto> {
    Ok(event_temporal_preview_fn(input))
}
