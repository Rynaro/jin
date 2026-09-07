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
}

#[derive(Debug, Deserialize)]
pub struct RoutedEditEventInput {
    #[serde(flatten)]
    pub edit: EditEventInput,
    pub account_id: String,
    pub calendar_id: String,
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
}

#[derive(Debug, Deserialize)]
pub struct RoutedDeleteEventInput {
    pub event_id: String,
    pub account_id: String,
    pub calendar_id: String,
    pub recurrence_scope: Option<jin_core::ops::event_mutation::RecurrenceMutationScope>,
    pub operation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RecurrencePreviewInput {
    pub start: String,
    pub tzid: Option<String>,
    #[serde(default)]
    pub is_all_day: bool,
    pub recurrence: jin_core::recurrence::RecurrenceDraft,
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

pub fn edit_event_fn(
    root: &Path,
    input: EditEventInput,
) -> Result<EditEventResultDto, JinErrorDto> {
    jin_core::ops::recoverable_operations::validate_operation_id(&input.operation_id)
        .map_err(JinErrorDto::from)?;
    let patch = parse_input(EventInput {
        title: input.title,
        start: input.start,
        end: input.end,
        tzid: input.tzid,
        is_all_day: input.is_all_day,
        description: input.description,
        location: input.location,
        recurrence: None,
        attendees: input.attendees,
        attendees_omitted: input.attendees_omitted,
        conference_data: input.conference_data,
        clear_conference_data: input.clear_conference_data,
        reminders: input.reminders,
    })?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let result = service
        .edit_local_scoped(
            &input.event_id,
            &input.edit_token,
            patch,
            input.recurrence_scope,
            &input.operation_id,
        )
        .map_err(JinErrorDto::from)?;
    Ok(EditEventResultDto {
        event: EventDto::from_model(&result.event),
        no_op: result.no_op,
    })
}

pub fn create_routed_event_fn(
    root: &Path,
    input: RoutedEventInput,
) -> Result<EventDto, JinErrorDto> {
    let target = sync_target(input.account_id, input.calendar_id)?;
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
            Some(target),
            &input.operation_id,
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
    let patch = parse_input(EventInput {
        title: input.edit.title,
        start: input.edit.start,
        end: input.edit.end,
        tzid: input.edit.tzid,
        is_all_day: input.edit.is_all_day,
        description: input.edit.description,
        location: input.edit.location,
        recurrence: None,
        attendees: input.edit.attendees,
        attendees_omitted: input.edit.attendees_omitted,
        conference_data: input.edit.conference_data,
        clear_conference_data: input.edit.clear_conference_data,
        reminders: input.edit.reminders,
    })?;
    let service = jin_core::ops::event_mutation::EventMutationService::new(root)
        .map_err(JinErrorDto::from)?;
    let event = service
        .edit(
            &input.edit.event_id,
            &input.edit.edit_token,
            patch,
            target,
            input.recurrence_scope,
            &input.edit.operation_id,
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
        .delete(
            &input.event_id,
            target,
            input.recurrence_scope,
            &input.operation_id,
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
