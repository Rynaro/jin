use chrono::Local;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::dto::{
    EventDetailCapabilitiesDto, EventDisplayKind, EventReadOnlyReason, OriginatingTaskRefDto,
};
use crate::id::new_ulid;
use crate::model::event::{EventAttendee, EventConferenceData, EventReminderSettings};
use crate::model::{
    Event, EventFrontmatter, EventSource, EventStatus, TaskStatus, TemporalValue, ValueType,
};
use crate::ops::recoverable_operations::{execute_event_operation_allow_noop, TargetPlan};
use crate::store::fs;
use crate::{JinError, Result};

pub struct CreateEventParams {
    pub title: String,
    pub body: String,
    pub start: TemporalValue,
    pub end: TemporalValue,
    pub start_value_type: ValueType,
    pub end_value_type: ValueType,
    pub is_all_day: bool,
    pub start_tzid: Option<String>,
    pub end_tzid: Option<String>,
    pub floating: bool,
    pub ical_uid: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub attendees: Option<Vec<EventAttendee>>,
    pub conference_data: Option<EventConferenceData>,
    pub reminders: Option<EventReminderSettings>,
}

/// Mutable fields for a Jin-owned, non-recurring event. Identity, source,
/// linkage, body and recurrence metadata are deliberately not expressible.
#[derive(Debug, Clone, Serialize)]
pub struct EditEventPatch {
    pub title: String,
    pub start: TemporalValue,
    pub end: TemporalValue,
    pub start_value_type: ValueType,
    pub end_value_type: ValueType,
    pub is_all_day: bool,
    pub start_tzid: Option<String>,
    pub end_tzid: Option<String>,
    pub floating: bool,
    pub description: Option<String>,
    pub location: Option<String>,
    /// `None` leaves attendees unchanged; `Some([])` explicitly clears them.
    pub attendees: Option<Vec<EventAttendee>>,
    /// Limited attendee-response mode. This is only emitted with an attendee
    /// patch and is validated against the canonical truncation marker.
    pub attendees_omitted: Option<bool>,
    pub conference_data: Option<EventConferenceData>,
    #[serde(default)]
    pub clear_conference_data: bool,
    pub reminders: Option<EventReminderSettings>,
}

#[derive(Debug, Clone)]
pub struct EditEventOutcome {
    pub event: Event,
    pub no_op: bool,
}

fn token_for_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(crate) fn edit_token_for_bytes(bytes: &[u8]) -> String {
    token_for_bytes(bytes)
}

pub fn event_edit_token(root: &Path, id: &str) -> Result<String> {
    crate::ops::api::recover_before_read(root)?;
    let cfg = crate::Config::load(root)?;
    let path = fs::find_event_path(&cfg.events_dir(), id)?;
    Ok(token_for_bytes(&std::fs::read(path)?))
}

fn apply_patch(event: &mut Event, patch: EditEventPatch) {
    event.frontmatter.title = patch.title;
    event.frontmatter.start = patch.start;
    event.frontmatter.end = patch.end;
    event.frontmatter.start_value_type = patch.start_value_type;
    event.frontmatter.end_value_type = patch.end_value_type;
    event.frontmatter.is_all_day = patch.is_all_day;
    event.frontmatter.start_tzid = patch.start_tzid;
    event.frontmatter.end_tzid = patch.end_tzid;
    event.frontmatter.floating = patch.floating;
    event.frontmatter.description = patch.description;
    event.frontmatter.location = patch.location;
    if let Some(attendees) = patch.attendees {
        event.frontmatter.attendees = Some(attendees);
    }
    if let Some(attendees_omitted) = patch.attendees_omitted {
        event.frontmatter.attendees_omitted = Some(attendees_omitted);
    }
    if patch.clear_conference_data {
        event.frontmatter.conference_data = None;
    } else if let Some(conference_data) = patch.conference_data {
        event.frontmatter.conference_data = Some(conference_data);
    }
    if let Some(reminders) = patch.reminders {
        event.frontmatter.reminders = Some(reminders);
    }
}

fn editable_fields_equal(left: &Event, right: &Event) -> bool {
    let a = &left.frontmatter;
    let b = &right.frontmatter;
    a.title == b.title
        && crate::model::event::render_temporal(&a.start)
            == crate::model::event::render_temporal(&b.start)
        && crate::model::event::render_temporal(&a.end)
            == crate::model::event::render_temporal(&b.end)
        && a.start_value_type == b.start_value_type
        && a.end_value_type == b.end_value_type
        && a.is_all_day == b.is_all_day
        && a.start_tzid == b.start_tzid
        && a.end_tzid == b.end_tzid
        && a.floating == b.floating
        && a.description == b.description
        && a.location == b.location
        && a.attendees == b.attendees
        && a.attendees_omitted == b.attendees_omitted
        && a.conference_data == b.conference_data
        && a.reminders == b.reminders
}

fn edit_operation_kind(id: &str, edit_token: &str, patch: &EditEventPatch) -> Result<String> {
    let material = serde_json::to_vec(&(id, edit_token, patch))
        .map_err(|error| JinError::Integrity(format!("serialize Event edit identity: {error}")))?;
    Ok(format!("edit_event:{:x}", Sha256::digest(material)))
}

/// Conflict-safe, idempotent edit. Recovery, policy authorization, canonical
/// reload, and token comparison all happen while the operation lock is held.
pub fn edit_event_with_operation_id(
    root: &Path,
    id: &str,
    edit_token: &str,
    operation_id: &str,
    patch: EditEventPatch,
) -> Result<EditEventOutcome> {
    validate_interval(&patch.start, &patch.end)?;
    validate_meeting_patch(&patch)?;
    let cfg = crate::Config::load(root)?;
    let events_dir = cfg.events_dir();
    let event_id = id.to_string();
    let expected_token = edit_token.to_string();
    let operation_kind = edit_operation_kind(id, edit_token, &patch)?;
    let outcome = execute_event_operation_allow_noop(root, operation_id, &operation_kind, || {
        let path = fs::find_event_path(&events_dir, &event_id)?;
        let before = std::fs::read(&path)?;
        let current = fs::read_event(&path)?;
        ensure_mutable(&current)?;
        if token_for_bytes(&before) != expected_token {
            return Err(JinError::StaleEvent {
                event_id: event_id.clone(),
            });
        }
        let mut edited = current.clone();
        apply_patch(&mut edited, patch);
        if editable_fields_equal(&current, &edited) {
            return Ok((event_id.clone(), vec![]));
        }
        edited.frontmatter.updated = Local::now().fixed_offset();
        edited.frontmatter.sequence += 1;
        let post = fs::render_event_bytes(&edited)?;
        Ok((
            event_id.clone(),
            vec![TargetPlan {
                canonical_path: path,
                before: Some(before),
                post: Some(post),
            }],
        ))
    })?;
    let event = match outcome.result_event_bytes.as_deref() {
        Some(bytes) => fs::parse_event_bytes(bytes)?,
        None => get_event(&events_dir, &outcome.result_event_id)?,
    };
    Ok(EditEventOutcome {
        event,
        no_op: !outcome.had_targets,
    })
}

fn validate_interval(start: &TemporalValue, end: &TemporalValue) -> Result<()> {
    let valid = match (start, end) {
        (TemporalValue::Date(a), TemporalValue::Date(b)) => b > a,
        (TemporalValue::DateTime(a), TemporalValue::DateTime(b)) => b > a,
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(JinError::Validation {
            field: "end".to_string(),
            reason: "must be after start and use the same value type".to_string(),
        })
    }
}

pub(crate) fn validate_meeting_patch(patch: &EditEventPatch) -> Result<()> {
    if patch.attendees_omitted == Some(false) {
        return Err(JinError::Validation {
            field: "attendees_omitted".to_string(),
            reason: "limited attendee mode may only be enabled with true; omit the field for ordinary attendee edits".to_string(),
        });
    }
    if patch.attendees_omitted.is_some() && patch.attendees.is_none() {
        return Err(JinError::Validation {
            field: "attendees_omitted".to_string(),
            reason: "limited attendee mode requires an attendee response patch".to_string(),
        });
    }
    if patch.clear_conference_data && patch.conference_data.is_some() {
        return Err(JinError::Validation {
            field: "conference_data".to_string(),
            reason: "cannot set and clear conference data in the same edit".to_string(),
        });
    }
    validate_conference_data(patch.conference_data.as_ref())?;
    validate_reminders(patch.reminders.as_ref())
}

fn validate_conference_data(conference_data: Option<&EventConferenceData>) -> Result<()> {
    let Some(conference_data) = conference_data else {
        return Ok(());
    };
    let Some(pending) = conference_data.pending_create_request.as_ref() else {
        return Ok(());
    };
    if conference_data
        .create_request
        .as_ref()
        .and_then(|value| value.request_id.as_deref())
        == Some(pending.request_id.as_str())
    {
        return Err(JinError::Validation {
            field: "conference_data.pending_create_request.request_id".to_string(),
            reason: "fresh conference request_id must differ from the retained provider request_id"
                .to_string(),
        });
    }
    if pending.request_id.trim().is_empty()
        || pending
            .conference_solution_key
            .kind
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(JinError::Validation {
            field: "conference_data.pending_create_request".to_string(),
            reason: "request_id and conference solution type are required".to_string(),
        });
    }
    if !conference_data.entry_points.is_empty()
        || conference_data.conference_solution.is_some()
        || conference_data.conference_id.is_some()
        || conference_data.signature.is_some()
        || conference_data.notes.is_some()
    {
        return Err(JinError::Validation {
            field: "conference_data.pending_create_request".to_string(),
            reason:
                "a fresh conference request cannot be combined with established conference fields"
                    .to_string(),
        });
    }
    Ok(())
}

fn validate_reminders(reminders: Option<&EventReminderSettings>) -> Result<()> {
    let Some(overrides) = reminders.and_then(|value| value.overrides.as_ref()) else {
        return Ok(());
    };
    if overrides.len() > 5
        || overrides
            .iter()
            .any(|value| !(0..=40_320).contains(&value.minutes))
    {
        return Err(JinError::Validation {
            field: "reminders.overrides".to_string(),
            reason: "at most 5 overrides are allowed and minutes must be between 0 and 40320"
                .to_string(),
        });
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventMutationPolicy {
    pub display_kind: EventDisplayKind,
    pub read_only_reason: Option<EventReadOnlyReason>,
}

impl EventMutationPolicy {
    pub fn is_mutable(&self) -> bool {
        self.read_only_reason.is_none()
    }
}

/// One pure source of truth for Event display kind and M1 mutation policy.
pub fn mutation_policy(event: &Event) -> EventMutationPolicy {
    let fm = &event.frontmatter;
    let display_kind = if fm.derived_from.is_some() {
        EventDisplayKind::TimeBlock
    } else {
        EventDisplayKind::Event
    };
    let recurring = !fm.recurrence.is_empty()
        || fm.recurring_event_id.is_some()
        || fm.original_start.is_some()
        || fm.master_id.is_some()
        || fm.recurrence_unexpanded;
    let read_only_reason = if fm.is_deleted() {
        Some(EventReadOnlyReason::Cancelled)
    } else if recurring {
        Some(EventReadOnlyReason::RecurringMilestone1)
    } else if fm.source != EventSource::Jin || fm.authority != EventSource::Jin {
        Some(EventReadOnlyReason::ExternalAuthorityOrSource)
    } else {
        None
    };
    EventMutationPolicy {
        display_kind,
        read_only_reason,
    }
}

pub(crate) fn ensure_mutable(event: &Event) -> Result<()> {
    match mutation_policy(event).read_only_reason {
        None => Ok(()),
        Some(EventReadOnlyReason::Cancelled) => Err(JinError::InvalidStateTransition {
            from: "cancelled".to_string(),
            to: "changed".to_string(),
        }),
        Some(EventReadOnlyReason::RecurringMilestone1) => Err(JinError::InvalidInput(
            "recurring events are read-only in this calendar".to_string(),
        )),
        Some(EventReadOnlyReason::UnsupportedRecurrence) => Err(JinError::InvalidInput(
            "this imported recurrence pattern is preserved but cannot be edited".to_string(),
        )),
        Some(EventReadOnlyReason::ExternalAuthorityOrSource) => Err(JinError::InvalidInput(
            "only Jin-authored events can be changed here".to_string(),
        )),
    }
}

fn active_task(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Todo | TaskStatus::Doing)
}

pub(crate) fn return_eligibility_unrecovered(
    root: &Path,
    event: &Event,
) -> Result<(bool, Option<OriginatingTaskRefDto>)> {
    let Some(task_id) = event.frontmatter.derived_from.as_deref() else {
        return Ok((false, None));
    };
    let cfg = crate::Config::load(root)?;
    let task = match crate::ops::tasks::get_task(&cfg.tasks_dir(), task_id) {
        Ok(task) => task,
        Err(JinError::NotFound(_)) => return Ok((false, None)),
        Err(err) => return Err(err),
    };
    let task_ref = OriginatingTaskRefDto {
        id: task.id().to_string(),
        title: task.title().to_string(),
        status: task.frontmatter.status.to_string(),
    };
    if !mutation_policy(event).is_mutable() || !active_task(&task.frontmatter.status) {
        return Ok((false, Some(task_ref)));
    }
    let another_active = list_events(&cfg.events_dir(), true)?
        .into_iter()
        .any(|candidate| {
            candidate.id() != event.id()
                && !candidate.is_deleted()
                && candidate.frontmatter.derived_from.as_deref() == Some(task_id)
        });
    Ok((!another_active, Some(task_ref)))
}

pub fn event_detail_capabilities(
    root: &Path,
    event_id: &str,
) -> Result<EventDetailCapabilitiesDto> {
    crate::ops::api::recover_before_read(root)?;
    let cfg = crate::Config::load(root)?;
    let event = get_event(&cfg.events_dir(), event_id)?;
    event_detail_capabilities_unrecovered(root, &event)
}

pub(crate) fn event_detail_capabilities_unrecovered(
    root: &Path,
    event: &Event,
) -> Result<EventDetailCapabilitiesDto> {
    let cfg = crate::Config::load(root)?;
    let mut policy = mutation_policy(event);
    let recurring = !event.frontmatter.recurrence.is_empty()
        || event.frontmatter.recurring_event_id.is_some()
        || event.frontmatter.original_start.is_some()
        || event.frontmatter.master_id.is_some();
    let recurrence_pattern_supported =
        if let Some(master_id) = event.frontmatter.master_id.as_deref() {
            get_event(&cfg.events_dir(), master_id)
                .map(|master| crate::recurrence::is_supported(&master.frontmatter.recurrence))
                .unwrap_or(false)
        } else if recurring {
            crate::recurrence::is_supported(&event.frontmatter.recurrence)
        } else {
            true
        };
    let mut writable_route = false;
    if event.frontmatter.source == EventSource::Google && cfg.google_v2_active() {
        let sync_path = cfg.sync_dir().join("sync-state.sqlite");
        if sync_path.exists() {
            let conn = crate::sync::state::open_sync_db(&cfg.sync_dir())?;
            let entries = crate::sync::state::list_scoped_entries_by_jin_id(&conn, event.id())?;
            writable_route = entries.iter().any(|entry| {
                cfg.google_registry.calendars.iter().any(|calendar| {
                    calendar.account_id.as_str() == entry.destination.account_id
                        && calendar.calendar_id == entry.destination.calendar_id
                        && calendar.enabled
                        && calendar.available
                        && calendar.access_role.can_write()
                })
            });
        }
    }
    if recurring && !recurrence_pattern_supported {
        policy.read_only_reason = Some(EventReadOnlyReason::UnsupportedRecurrence);
    } else if !event.frontmatter.is_deleted() && writable_route {
        policy.read_only_reason = None;
    }
    let mutable = policy.is_mutable();
    let (can_return_task_to_flexible, originating_task) =
        return_eligibility_unrecovered(root, event)?;
    Ok(EventDetailCapabilitiesDto {
        display_kind: policy.display_kind,
        can_edit: mutable,
        can_delete: mutable,
        read_only_reason: policy.read_only_reason,
        recurrence_pattern_supported,
        recurrence_scopes: if mutable && recurring && recurrence_pattern_supported {
            vec!["this_occurrence".to_string(), "entire_series".to_string()]
        } else {
            Vec::new()
        },
        can_return_task_to_flexible,
        originating_task,
    })
}

/// Create a new Event, write to disk.
pub fn create_event(events_dir: &Path, params: CreateEventParams) -> Result<Event> {
    let event = build_event(params, None)?;
    fs::write_event(events_dir, &event)?;
    Ok(event)
}

pub(crate) fn build_event(params: CreateEventParams, fixed_id: Option<String>) -> Result<Event> {
    validate_interval(&params.start, &params.end)?;
    validate_conference_data(params.conference_data.as_ref())?;
    validate_reminders(params.reminders.as_ref())?;
    let now = Local::now().fixed_offset();
    let id = fixed_id.unwrap_or_else(new_ulid);
    // Generate ical_uid if not provided
    let ical_uid = params
        .ical_uid
        .unwrap_or_else(|| format!("{}@jin", id.to_lowercase()));

    let fm = EventFrontmatter {
        id,
        kind: "event".to_string(),
        title: params.title,
        description: params.description,
        location: params.location,
        start: params.start,
        end: params.end,
        start_value_type: params.start_value_type,
        end_value_type: params.end_value_type,
        is_all_day: params.is_all_day,
        start_tzid: params.start_tzid,
        end_tzid: params.end_tzid,
        floating: params.floating,
        recurrence: vec![],
        recurring_event_id: None,
        original_start: None,
        master_id: None,
        recurrence_unexpanded: false,
        ical_uid: Some(ical_uid),
        sequence: 0,
        status: EventStatus::Confirmed,
        created: now,
        updated: now,
        transparency: None,
        visibility: None,
        organizer: None,
        attendees: params.attendees,
        attendees_omitted: None,
        conference_data: params.conference_data,
        hangout_link: None,
        reminders: params.reminders,
        source: EventSource::Jin,
        authority: EventSource::Jin,
        calendar_id: "primary".to_string(),
        derived_from: None,
    };
    let event = Event {
        frontmatter: fm,
        body: params.body,
    };
    Ok(event)
}

/// Read an Event by id.
pub fn get_event(events_dir: &Path, id: &str) -> Result<Event> {
    let path = fs::find_event_path(events_dir, id)?;
    fs::read_event(&path)
}

/// List events. include_deleted controls whether cancelled events appear.
pub fn list_events(events_dir: &Path, include_deleted: bool) -> Result<Vec<Event>> {
    let paths = fs::list_event_paths(events_dir)?;
    let mut events = Vec::new();
    for path in &paths {
        let event = fs::read_event(path)?;
        if include_deleted || !event.is_deleted() {
            events.push(event);
        }
    }
    events.sort_by(|a, b| a.id().cmp(b.id()));
    Ok(events)
}

/// Soft-delete an event (status → cancelled).
pub fn delete_event(events_dir: &Path, id: &str) -> Result<Event> {
    let path = fs::find_event_path(events_dir, id)?;
    let mut event = fs::read_event(&path)?;
    ensure_mutable(&event)?;
    let now = Local::now().fixed_offset();
    event.frontmatter.status = EventStatus::Cancelled;
    event.frontmatter.updated = now;
    event.frontmatter.sequence += 1;
    fs::write_event(events_dir, &event)?;
    Ok(event)
}

/// Atomically edit the allowed fields of an existing event in place.
pub fn edit_event(events_dir: &Path, id: &str, patch: EditEventPatch) -> Result<Event> {
    validate_interval(&patch.start, &patch.end)?;
    validate_meeting_patch(&patch)?;
    let path = fs::find_event_path(events_dir, id)?;
    let mut event = fs::read_event(&path)?;
    ensure_mutable(&event)?;

    apply_patch(&mut event, patch);
    event.frontmatter.updated = Local::now().fixed_offset();
    event.frontmatter.sequence += 1;
    fs::write_event(events_dir, &event)?;
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveDateTime};
    use tempfile::TempDir;

    fn timed_patch(title: &str) -> EditEventPatch {
        EditEventPatch {
            title: title.to_string(),
            start: TemporalValue::DateTime(
                NaiveDateTime::parse_from_str("2026-08-24T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap(),
            ),
            end: TemporalValue::DateTime(
                NaiveDateTime::parse_from_str("2026-08-24T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap(),
            ),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: None,
            end_tzid: None,
            floating: true,
            description: Some("changed".to_string()),
            location: Some("Studio".to_string()),
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
        }
    }

    fn create_params() -> CreateEventParams {
        CreateEventParams {
            title: "Original".to_string(),
            body: "body stays".to_string(),
            start: TemporalValue::Date(NaiveDate::from_ymd_opt(2026, 8, 24).unwrap()),
            end: TemporalValue::Date(NaiveDate::from_ymd_opt(2026, 8, 25).unwrap()),
            start_value_type: ValueType::Date,
            end_value_type: ValueType::Date,
            is_all_day: true,
            start_tzid: None,
            end_tzid: None,
            floating: false,
            ical_uid: Some("stable@jin".to_string()),
            description: None,
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        }
    }

    fn create(events_dir: &Path) -> Event {
        create_event(events_dir, create_params()).unwrap()
    }

    fn duplicate_conference_request() -> EventConferenceData {
        serde_json::from_value(serde_json::json!({
            "createRequest": {
                "requestId": "provider-consumed-request",
                "conferenceSolutionKey": { "type": "hangoutsMeet" },
                "status": { "statusCode": "success" }
            },
            "pendingCreateRequest": {
                "requestId": "provider-consumed-request",
                "conferenceSolutionKey": { "type": "hangoutsMeet" }
            }
        }))
        .unwrap()
    }

    #[test]
    fn public_create_and_edit_reject_reused_provider_conference_request_ids() {
        let create_dir = TempDir::new().unwrap();
        let mut params = create_params();
        params.conference_data = Some(duplicate_conference_request());
        assert!(create_event(create_dir.path(), params).is_err());

        let edit_dir = TempDir::new().unwrap();
        let event = create(edit_dir.path());
        let mut patch = timed_patch("No stale request replay");
        patch.conference_data = Some(duplicate_conference_request());
        assert!(edit_event(edit_dir.path(), event.id(), patch).is_err());
    }

    #[test]
    fn edit_is_in_place_and_preserves_identity_and_body() {
        let tmp = TempDir::new().unwrap();
        let before = create(tmp.path());
        let after = edit_event(tmp.path(), before.id(), timed_patch("Changed")).unwrap();
        assert_eq!(after.id(), before.id());
        assert_eq!(after.frontmatter.ical_uid, before.frontmatter.ical_uid);
        assert_eq!(after.frontmatter.created, before.frontmatter.created);
        assert_eq!(after.frontmatter.source, before.frontmatter.source);
        assert_eq!(after.frontmatter.authority, before.frontmatter.authority);
        assert_eq!(after.body, "body stays");
        assert_eq!(after.frontmatter.sequence, before.frontmatter.sequence + 1);
        assert_eq!(after.title(), "Changed");
    }

    #[test]
    fn delete_preserves_identity_and_linkage_metadata() {
        let tmp = TempDir::new().unwrap();
        let mut before = create(tmp.path());
        before.frontmatter.derived_from = Some("task-01".to_string());
        fs::write_event(tmp.path(), &before).unwrap();

        let after = delete_event(tmp.path(), before.id()).unwrap();

        assert_eq!(after.id(), before.id());
        assert_eq!(after.frontmatter.ical_uid, before.frontmatter.ical_uid);
        assert_eq!(after.frontmatter.created, before.frontmatter.created);
        assert_eq!(after.frontmatter.source, before.frontmatter.source);
        assert_eq!(after.frontmatter.authority, before.frontmatter.authority);
        assert_eq!(
            after.frontmatter.calendar_id,
            before.frontmatter.calendar_id
        );
        assert_eq!(
            after.frontmatter.derived_from,
            before.frontmatter.derived_from
        );
        assert_eq!(after.frontmatter.recurrence, before.frontmatter.recurrence);
        assert_eq!(
            after.frontmatter.recurring_event_id,
            before.frontmatter.recurring_event_id
        );
        assert_eq!(
            format!("{:?}", after.frontmatter.original_start),
            format!("{:?}", before.frontmatter.original_start)
        );
        assert_eq!(after.frontmatter.master_id, before.frontmatter.master_id);
        assert_eq!(
            after.frontmatter.recurrence_unexpanded,
            before.frontmatter.recurrence_unexpanded
        );
        assert_eq!(after.body, before.body);
        assert_eq!(after.frontmatter.status, EventStatus::Cancelled);
        assert_eq!(after.frontmatter.sequence, before.frontmatter.sequence + 1);
    }

    fn make_read_only(event: &mut Event, condition: &str) {
        match condition {
            "cancelled" => event.frontmatter.status = EventStatus::Cancelled,
            "external source" => event.frontmatter.source = EventSource::Google,
            "external authority" => event.frontmatter.authority = EventSource::Google,
            "recurrence" => event.frontmatter.recurrence = vec!["RRULE:FREQ=DAILY".to_string()],
            "recurring_event_id" => {
                event.frontmatter.recurring_event_id = Some("master-01".to_string())
            }
            "original_start" => {
                event.frontmatter.original_start = Some(TemporalValue::DateTime(
                    NaiveDateTime::parse_from_str("2026-08-24T09:00:00", "%Y-%m-%dT%H:%M:%S")
                        .unwrap(),
                ))
            }
            "master_id" => event.frontmatter.master_id = Some("master-01".to_string()),
            "recurrence_unexpanded" => event.frontmatter.recurrence_unexpanded = true,
            _ => panic!("unknown read-only condition: {condition}"),
        }
    }

    #[test]
    fn edit_and_delete_reject_every_read_only_event_shape() {
        for condition in [
            "cancelled",
            "external source",
            "external authority",
            "recurrence",
            "recurring_event_id",
            "original_start",
            "master_id",
            "recurrence_unexpanded",
        ] {
            for operation in ["edit", "delete"] {
                let tmp = TempDir::new().unwrap();
                let mut event = create(tmp.path());
                make_read_only(&mut event, condition);
                fs::write_event(tmp.path(), &event).unwrap();

                let result = match operation {
                    "edit" => edit_event(tmp.path(), event.id(), timed_patch("No")),
                    "delete" => delete_event(tmp.path(), event.id()),
                    _ => unreachable!(),
                };
                assert!(
                    result.is_err(),
                    "{operation} unexpectedly accepted {condition} event"
                );

                let unchanged = get_event(tmp.path(), event.id()).unwrap();
                assert_eq!(
                    serde_yaml_ng::to_string(&unchanged.frontmatter).unwrap(),
                    serde_yaml_ng::to_string(&event.frontmatter).unwrap()
                );
                assert_eq!(unchanged.body, event.body);
            }
        }
    }

    #[test]
    fn edit_rejects_invalid_intervals() {
        let tmp = TempDir::new().unwrap();
        let event = create(tmp.path());
        let mut invalid = timed_patch("No");
        invalid.end = invalid.start.clone();
        assert!(edit_event(tmp.path(), event.id(), invalid).is_err());
    }

    fn setup_edit_root() -> (TempDir, Event) {
        let vault = TempDir::new().unwrap();
        crate::ops::init(vault.path()).unwrap();
        let event = create(&vault.path().join("events"));
        crate::ops::api::refresh(vault.path()).unwrap();
        (vault, event)
    }

    fn same_patch(event: &Event) -> EditEventPatch {
        EditEventPatch {
            title: event.frontmatter.title.clone(),
            start: event.frontmatter.start.clone(),
            end: event.frontmatter.end.clone(),
            start_value_type: event.frontmatter.start_value_type.clone(),
            end_value_type: event.frontmatter.end_value_type.clone(),
            is_all_day: event.frontmatter.is_all_day,
            start_tzid: event.frontmatter.start_tzid.clone(),
            end_tzid: event.frontmatter.end_tzid.clone(),
            floating: event.frontmatter.floating,
            description: event.frontmatter.description.clone(),
            location: event.frontmatter.location.clone(),
            attendees: event.frontmatter.attendees.clone(),
            attendees_omitted: None,
            conference_data: event.frontmatter.conference_data.clone(),
            clear_conference_data: false,
            reminders: event.frontmatter.reminders.clone(),
        }
    }

    #[test]
    fn event_edit_preserves_immutable_fields_and_enqueues_once() {
        let (vault, before) = setup_edit_root();
        let token = event_edit_token(vault.path(), before.id()).unwrap();
        assert!(token.starts_with("sha256:"));

        let first = edit_event_with_operation_id(
            vault.path(),
            before.id(),
            &token,
            "edit-preserve",
            timed_patch("Changed"),
        )
        .unwrap();
        assert!(!first.no_op);
        let after = &first.event;
        assert_eq!(after.id(), before.id());
        assert_eq!(after.frontmatter.ical_uid, before.frontmatter.ical_uid);
        assert_eq!(after.frontmatter.created, before.frontmatter.created);
        assert_eq!(after.frontmatter.source, before.frontmatter.source);
        assert_eq!(after.frontmatter.authority, before.frontmatter.authority);
        assert_eq!(
            after.frontmatter.calendar_id,
            before.frontmatter.calendar_id
        );
        assert_eq!(
            after.frontmatter.derived_from,
            before.frontmatter.derived_from
        );
        assert_eq!(after.frontmatter.recurrence, before.frontmatter.recurrence);
        assert_eq!(
            after.frontmatter.recurring_event_id,
            before.frontmatter.recurring_event_id
        );
        assert_eq!(
            format!("{:?}", after.frontmatter.original_start),
            format!("{:?}", before.frontmatter.original_start)
        );
        assert_eq!(after.frontmatter.master_id, before.frontmatter.master_id);
        assert_eq!(after.body, before.body);
        assert_eq!(after.frontmatter.sequence, before.frontmatter.sequence + 1);

        let cfg = crate::Config::load(vault.path()).unwrap();
        let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
        assert_eq!(crate::sync::state::list_dirty(&sync).unwrap().len(), 1);

        let second_token = event_edit_token(vault.path(), before.id()).unwrap();
        let later = edit_event_with_operation_id(
            vault.path(),
            before.id(),
            &second_token,
            "edit-later",
            timed_patch("Later"),
        )
        .unwrap();
        assert_eq!(later.event.title(), "Later");

        let retry = edit_event_with_operation_id(
            vault.path(),
            before.id(),
            &token,
            "edit-preserve",
            timed_patch("Changed"),
        )
        .unwrap();
        assert!(!retry.no_op);
        assert_eq!(retry.event.frontmatter.sequence, after.frontmatter.sequence);
        assert_eq!(retry.event.title(), "Changed");
        assert_eq!(crate::sync::state::list_dirty(&sync).unwrap().len(), 1);
        assert!(matches!(
            edit_event_with_operation_id(
                vault.path(),
                before.id(),
                &token,
                "edit-preserve",
                timed_patch("Different request"),
            ),
            Err(JinError::OperationConflict { .. })
        ));
    }

    #[test]
    fn event_edit_no_op_has_no_canonical_or_derived_side_effects() {
        let (vault, before) = setup_edit_root();
        let cfg = crate::Config::load(vault.path()).unwrap();
        let path = fs::find_event_path(&cfg.events_dir(), before.id()).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let token = event_edit_token(vault.path(), before.id()).unwrap();

        let result = edit_event_with_operation_id(
            vault.path(),
            before.id(),
            &token,
            "edit-no-op",
            same_patch(&before),
        )
        .unwrap();
        assert!(result.no_op);
        assert_eq!(std::fs::read(path).unwrap(), bytes);
        assert!(!vault.path().join(".jin/operations/edit-no-op").exists());
        let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
        assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
    }

    #[test]
    fn event_edit_stale_token_conflict_has_no_command_side_effects() {
        let (vault, before) = setup_edit_root();
        let cfg = crate::Config::load(vault.path()).unwrap();
        let token = event_edit_token(vault.path(), before.id()).unwrap();
        let mut externally_changed = before.clone();
        externally_changed.frontmatter.title = "Changed elsewhere".to_string();
        fs::write_event(&cfg.events_dir(), &externally_changed).unwrap();
        let path = fs::find_event_path(&cfg.events_dir(), before.id()).unwrap();
        let bytes = std::fs::read(&path).unwrap();

        let error = edit_event_with_operation_id(
            vault.path(),
            before.id(),
            &token,
            "edit-stale",
            timed_patch("My draft"),
        )
        .unwrap_err();
        assert!(matches!(error, JinError::StaleEvent { ref event_id } if event_id == before.id()));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
        assert!(!vault.path().join(".jin/operations/edit-stale").exists());
        let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
        assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
    }

    #[test]
    fn event_edit_rejects_every_recurring_or_external_shape_before_staging() {
        for condition in [
            "cancelled",
            "external source",
            "external authority",
            "recurrence",
            "recurring_event_id",
            "original_start",
            "master_id",
            "recurrence_unexpanded",
        ] {
            let (vault, mut event) = setup_edit_root();
            let cfg = crate::Config::load(vault.path()).unwrap();
            make_read_only(&mut event, condition);
            fs::write_event(&cfg.events_dir(), &event).unwrap();
            let token = event_edit_token(vault.path(), event.id()).unwrap();
            let operation_id = format!("reject-{}", condition.replace(' ', "-"));
            assert!(
                edit_event_with_operation_id(
                    vault.path(),
                    event.id(),
                    &token,
                    &operation_id,
                    timed_patch("No"),
                )
                .is_err(),
                "accepted {condition}"
            );
            assert!(!vault
                .path()
                .join(".jin/operations")
                .join(operation_id)
                .exists());
        }
    }

    #[test]
    fn event_edit_time_block_never_mutates_originating_task_or_linkage() {
        use crate::ops::tasks::{create_task, CreateTaskParams};
        let vault = TempDir::new().unwrap();
        crate::ops::init(vault.path()).unwrap();
        let cfg = crate::Config::load(vault.path()).unwrap();
        let task = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Origin".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        let task_path = fs::find_task_path(&cfg.tasks_dir(), task.id()).unwrap();
        let task_before = std::fs::read(&task_path).unwrap();
        let mut event = create(&cfg.events_dir());
        event.frontmatter.derived_from = Some(task.id().to_string());
        fs::write_event(&cfg.events_dir(), &event).unwrap();
        crate::ops::api::refresh(vault.path()).unwrap();
        let token = event_edit_token(vault.path(), event.id()).unwrap();

        let result = edit_event_with_operation_id(
            vault.path(),
            event.id(),
            &token,
            "edit-time-block",
            timed_patch("Moved block"),
        )
        .unwrap();
        assert_eq!(
            result.event.frontmatter.derived_from.as_deref(),
            Some(task.id())
        );
        assert_eq!(std::fs::read(task_path).unwrap(), task_before);
    }

    #[test]
    fn event_edit_divergent_hash_blocks_without_index_or_sync_effects() {
        let (vault, before_event) = setup_edit_root();
        let cfg = crate::Config::load(vault.path()).unwrap();
        let path = fs::find_event_path(&cfg.events_dir(), before_event.id()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let mut intended = before_event.clone();
        intended.frontmatter.title = "Intended edit".to_string();
        intended.frontmatter.sequence += 1;
        let post = fs::render_event_bytes(&intended).unwrap();
        crate::ops::recoverable_operations::stage_test_event_operation(
            vault.path(),
            "edit-divergent",
            before_event.id(),
            vec![TargetPlan {
                canonical_path: path.clone(),
                before: Some(before),
                post: Some(post),
            }],
        )
        .unwrap();
        let mut divergent = before_event.clone();
        divergent.frontmatter.title = "Divergent edit".to_string();
        fs::write_event(&cfg.events_dir(), &divergent).unwrap();

        let report =
            crate::ops::recoverable_operations::recover_incomplete_operations(vault.path())
                .unwrap();
        assert_eq!(report.blocked, 1);
        assert_eq!(
            get_event(&cfg.events_dir(), before_event.id())
                .unwrap()
                .title(),
            "Divergent edit"
        );
        assert_eq!(
            crate::ops::api::get_event(vault.path(), before_event.id())
                .unwrap_err()
                .to_string(),
            "operation edit-divergent blocked: canonical recovery is blocked by divergent content"
        );
        let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
        assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
    }

    mod event_detail_capabilities {
        use super::*;
        use crate::ops::tasks::{create_task, transition_task, CreateTaskParams};

        fn setup_time_block() -> (TempDir, crate::model::Task, Event) {
            let vault = TempDir::new().unwrap();
            crate::ops::init(vault.path()).unwrap();
            let task = create_task(
                &vault.path().join("tasks"),
                CreateTaskParams {
                    title: "Origin".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();
            let mut event = create(&vault.path().join("events"));
            event.frontmatter.derived_from = Some(task.id().to_string());
            fs::write_event(&vault.path().join("events"), &event).unwrap();
            (vault, task, event)
        }

        #[test]
        fn plain_event() {
            let tmp = TempDir::new().unwrap();
            let event = create(tmp.path());
            assert_eq!(
                mutation_policy(&event).display_kind,
                EventDisplayKind::Event
            );
        }

        #[test]
        fn time_block() {
            let tmp = TempDir::new().unwrap();
            let mut event = create(tmp.path());
            event.frontmatter.derived_from = Some("missing-task".to_string());
            assert_eq!(
                mutation_policy(&event).display_kind,
                EventDisplayKind::TimeBlock
            );
        }

        #[test]
        fn recurring_view_only() {
            let tmp = TempDir::new().unwrap();
            let mut event = create(tmp.path());
            event.frontmatter.recurrence = vec!["RRULE:FREQ=DAILY".to_string()];
            assert!(!mutation_policy(&event).is_mutable());
        }

        #[test]
        fn google_view_only() {
            let tmp = TempDir::new().unwrap();
            let mut event = create(tmp.path());
            event.frontmatter.authority = EventSource::Google;
            assert!(!mutation_policy(&event).is_mutable());
        }

        #[test]
        fn reason_matrix() {
            let tmp = TempDir::new().unwrap();
            let mut event = create(tmp.path());
            event.frontmatter.status = EventStatus::Cancelled;
            event.frontmatter.recurrence_unexpanded = true;
            event.frontmatter.authority = EventSource::Google;
            assert_eq!(
                mutation_policy(&event).read_only_reason,
                Some(EventReadOnlyReason::Cancelled)
            );
            event.frontmatter.status = EventStatus::Confirmed;
            assert_eq!(
                mutation_policy(&event).read_only_reason,
                Some(EventReadOnlyReason::RecurringMilestone1)
            );
            event.frontmatter.recurrence_unexpanded = false;
            assert_eq!(
                mutation_policy(&event).read_only_reason,
                Some(EventReadOnlyReason::ExternalAuthorityOrSource)
            );
        }

        #[test]
        fn last_block_active_task() {
            let (vault, _task, event) = setup_time_block();
            let detail = event_detail_capabilities(vault.path(), event.id()).unwrap();
            assert!(detail.can_return_task_to_flexible);
            assert!(detail.originating_task.is_some());
        }

        #[test]
        fn another_active_block() {
            let (vault, task, event) = setup_time_block();
            let mut another = create(&vault.path().join("events"));
            another.frontmatter.derived_from = Some(task.id().to_string());
            fs::write_event(&vault.path().join("events"), &another).unwrap();
            assert!(
                !event_detail_capabilities(vault.path(), event.id())
                    .unwrap()
                    .can_return_task_to_flexible
            );
        }

        #[test]
        fn originating_task_unavailable() {
            let (vault, task, event) = setup_time_block();
            transition_task(&vault.path().join("tasks"), task.id(), TaskStatus::Done).unwrap();
            assert!(
                !event_detail_capabilities(vault.path(), event.id())
                    .unwrap()
                    .can_return_task_to_flexible
            );

            let mut missing = create(&vault.path().join("events"));
            missing.frontmatter.derived_from = Some("missing".to_string());
            fs::write_event(&vault.path().join("events"), &missing).unwrap();
            assert!(
                !event_detail_capabilities(vault.path(), missing.id())
                    .unwrap()
                    .can_return_task_to_flexible
            );
        }
    }
}
