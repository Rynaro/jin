//! Google Calendar `events` resource ↔ Jin `EventFrontmatter` field mapping (DEC-S4).
//!
//! This module owns the lossless bidirectional translation required by VG5
//! ("RFC-5545 fidelity: recurring mirror verbatim; lossless field round-trip").
//!
//! # Field table (ADR-0004 DEC-S4)
//!
//! | Google field              | Jin field                | Layer      |
//! |---------------------------|--------------------------|------------|
//! | `id`                      | sync-state only          | sync-state |
//! | `iCalUID`                 | `ical_uid`               | file       |
//! | `etag`                    | sync-state only          | sync-state |
//! | `status`                  | `status`                 | file       |
//! | `summary`                 | `title`                  | file       |
//! | `description`             | `description`            | file       |
//! | `location`                | `location`               | file       |
//! | `start.dateTime+timeZone` | `start`+`start_tzid`     | file       |
//! | `start.date`              | `start`+`is_all_day`     | file       |
//! | `end.*`                   | `end`+`end_tzid`         | file       |
//! | `recurrence[]`            | `recurrence[]`           | file       |
//! | `recurringEventId`        | `recurring_event_id`     | file       |
//! | `originalStartTime`       | `original_start`         | file       |
//! | `sequence`                | `sequence`               | file       |
//! | `updated`                 | sync-state `google_updated`| sync-state|
//! | `created`                 | `created`                | file       |
//! | `transparency`            | `transparency`           | file       |
//! | `visibility`              | `visibility`             | file       |
//! | `organizer`               | `organizer`              | file       |
//! | `attendees[]`             | `attendees[]`            | file       |
//! | `attendeesOmitted`        | `attendees_omitted`      | file       |
//! | `conferenceData`          | `conference_data`        | file       |
//! | `hangoutLink`             | `hangout_link`           | file       |
//! | `reminders`               | `reminders`              | file       |

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime};

use crate::model::event::{
    EventAttendee, EventConferenceData, EventFrontmatter, EventOrganizer, EventReminderSettings,
    EventSource, EventStatus, TemporalValue, ValueType,
};
use crate::JinError;

// ── google_to_jin ─────────────────────────────────────────────────────────────

/// Convert a Google Calendar `events` resource JSON object to a
/// `EventFrontmatter`.
///
/// `jin_id` must be caller-supplied (either a new ULID for newly-seen events
/// or the existing Jin ULID for updates).
/// `calendar_id` is the calendar this event belongs to.
///
/// `source` and `authority` are set to `google` for mirrored events.
pub fn google_to_jin(
    resource: &serde_json::Value,
    jin_id: &str,
    calendar_id: &str,
) -> crate::Result<EventFrontmatter> {
    let title = resource
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let description = resource
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let location = resource
        .get("location")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let ical_uid = resource
        .get("iCalUID")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let status = parse_google_status(resource);

    let sequence = resource
        .get("sequence")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let transparency = resource
        .get("transparency")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let visibility = resource
        .get("visibility")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // ── Meeting metadata ─────────────────────────────────────────────────────
    let organizer = parse_optional_object::<EventOrganizer>(resource, "organizer")?;
    let attendees = resource
        .get("attendees")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .cloned()
                .map(|value| parse_object::<EventAttendee>(value, "attendees[]"))
                .collect::<crate::Result<Vec<_>>>()
        })
        .transpose()?;
    let attendees_omitted = resource
        .get("attendeesOmitted")
        .and_then(|value| value.as_bool());
    let conference_data = parse_optional_object::<EventConferenceData>(resource, "conferenceData")?;
    let hangout_link = resource
        .get("hangoutLink")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let reminders = parse_optional_object::<EventReminderSettings>(resource, "reminders")?;

    // ── Temporal core ──────────────────────────────────────────────────────────
    let (start, start_value_type, start_tzid, is_all_day) = parse_google_time(resource, "start")?;
    let (end, end_value_type, end_tzid, _) = parse_google_time(resource, "end")?;

    // ── Recurrence ────────────────────────────────────────────────────────────
    let recurrence: Vec<String> = resource
        .get("recurrence")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let recurring_event_id = resource
        .get("recurringEventId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let original_start = if let Some(ost) = resource.get("originalStartTime") {
        let (tv, _, _, _) = parse_google_time_obj(ost)?;
        Some(tv)
    } else {
        None
    };

    // Mark recurring masters or exceptions as unexpanded (read-only, not pushed)
    let recurrence_unexpanded = !recurrence.is_empty() || recurring_event_id.is_some();

    // ── Timestamps ────────────────────────────────────────────────────────────
    let created = parse_google_timestamp(resource, "created")?;
    let updated = parse_google_timestamp(resource, "updated")?;

    // m8: a Google timed event with no timeZone is floating (wall-time only).
    // All-day events are never floating (no time component to anchor).
    let floating = !is_all_day && start_tzid.is_none();

    Ok(EventFrontmatter {
        id: jin_id.to_string(),
        kind: "event".to_string(),
        title,
        description,
        location,
        start,
        end,
        start_value_type,
        end_value_type,
        is_all_day,
        start_tzid,
        end_tzid,
        floating,
        recurrence,
        recurring_event_id,
        original_start,
        master_id: None,
        recurrence_unexpanded,
        ical_uid,
        sequence,
        status,
        created,
        updated,
        transparency,
        visibility,
        organizer,
        attendees,
        attendees_omitted,
        conference_data,
        hangout_link,
        reminders,
        source: EventSource::Google,
        authority: EventSource::Google,
        calendar_id: calendar_id.to_string(),
        derived_from: None,
    })
}

// ── jin_to_google ─────────────────────────────────────────────────────────────

/// Convert a Jin `EventFrontmatter` to a Google Calendar `events` resource body.
///
/// Only fields that belong in the **canonical file** layer are mapped.
/// Sync-state fields (`id`, `etag`, `updated`) are handled by the sync loop.
///
/// Recurrence lines are sent as a complete array because Google replaces array
/// fields rather than merging them.
pub fn jin_to_google(event: &EventFrontmatter) -> serde_json::Value {
    let mut obj = serde_json::json!({});

    // summary (required)
    obj["summary"] = serde_json::Value::String(event.title.clone());

    if let Some(ref d) = event.description {
        obj["description"] = serde_json::Value::String(d.clone());
    }
    if let Some(ref l) = event.location {
        obj["location"] = serde_json::Value::String(l.clone());
    }
    if let Some(ref uid) = event.ical_uid {
        obj["iCalUID"] = serde_json::Value::String(uid.clone());
    }

    obj["status"] = serde_json::Value::String(render_jin_status(&event.status));
    obj["sequence"] = serde_json::json!(event.sequence);

    if let Some(ref t) = event.transparency {
        obj["transparency"] = serde_json::Value::String(t.clone());
    }
    if let Some(ref v) = event.visibility {
        obj["visibility"] = serde_json::Value::String(v.clone());
    }

    // `organizer` and `hangoutLink` are read-only for ordinary Events
    // insert/patch calls. Organizer changes use events.move. `attendeesOmitted`
    // is intentionally absent from this full projection: the routed sparse
    // patch adds it only for a validated limited self-RSVP update.
    // Attendee read-only identity flags are retained locally but not echoed.
    if let Some(ref attendees) = event.attendees {
        obj["attendees"] =
            serde_json::Value::Array(attendees.iter().map(render_writable_attendee).collect());
    }
    if let Some(ref conference_data) = event.conference_data {
        obj["conferenceData"] = render_writable_conference_data(conference_data);
    }
    if let Some(ref reminders) = event.reminders {
        obj["reminders"] =
            serde_json::to_value(reminders).expect("serializing EventReminderSettings cannot fail");
    }

    // ── Temporal ──────────────────────────────────────────────────────────────
    obj["start"] = render_google_time(&event.start, event.start_tzid.as_deref());
    obj["end"] = render_google_time(&event.end, event.end_tzid.as_deref());

    // ── Recurrence ────────────────────────────────────────────────────────────
    if !event.recurrence.is_empty() {
        obj["recurrence"] = serde_json::json!(event.recurrence);
    }
    if let Some(ref rid) = event.recurring_event_id {
        obj["recurringEventId"] = serde_json::Value::String(rid.clone());
    }
    if let Some(ref os) = event.original_start {
        obj["originalStartTime"] = render_google_time(os, event.start_tzid.as_deref());
    }

    obj
}

/// Serialize the only Google Event PATCH shape permitted for a Jin RSVP.
/// Google replaces attendee arrays, so the dedicated response operation must
/// never reuse the generic full-event mapper.
pub fn invitation_response_patch(self_email: &str, response_status: &str) -> serde_json::Value {
    serde_json::json!({
        "attendees": [{
            "email": self_email,
            "responseStatus": response_status
        }],
        "attendeesOmitted": true
    })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn parse_optional_object<T>(resource: &serde_json::Value, field: &str) -> crate::Result<Option<T>>
where
    T: serde::de::DeserializeOwned,
{
    resource
        .get(field)
        .filter(|value| !value.is_null())
        .cloned()
        .map(|value| parse_object(value, field))
        .transpose()
}

fn parse_object<T>(value: serde_json::Value, field: &str) -> crate::Result<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(value)
        .map_err(|error| JinError::YamlParse(format!("Google event '{field}' invalid: {error}")))
}

fn render_writable_attendee(attendee: &EventAttendee) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if let Some(ref value) = attendee.email {
        object.insert("email".to_string(), serde_json::json!(value));
    }
    if let Some(ref value) = attendee.display_name {
        object.insert("displayName".to_string(), serde_json::json!(value));
    }
    if let Some(value) = attendee.resource {
        object.insert("resource".to_string(), serde_json::json!(value));
    }
    if let Some(value) = attendee.optional {
        object.insert("optional".to_string(), serde_json::json!(value));
    }
    if let Some(ref value) = attendee.response_status {
        object.insert("responseStatus".to_string(), serde_json::json!(value));
    }
    if let Some(ref value) = attendee.comment {
        object.insert("comment".to_string(), serde_json::json!(value));
    }
    if let Some(value) = attendee.additional_guests {
        object.insert("additionalGuests".to_string(), serde_json::json!(value));
    }
    serde_json::Value::Object(object)
}

fn render_writable_conference_data(conference_data: &EventConferenceData) -> serde_json::Value {
    // A provider-returned createRequest contains a consumed requestId and
    // read-only status. Never replay it. Only Jin's separately typed pending
    // request can become a fresh Google createRequest. A pending request is an
    // alternative to established conference details, never an addition to them.
    if let Some(pending) = &conference_data.pending_create_request {
        return serde_json::json!({
            "createRequest": {
                "requestId": pending.request_id,
                "conferenceSolutionKey": render_conference_solution_key(
                    &pending.conference_solution_key
                )
            }
        });
    }

    // Keep the write surface closed over Google's documented conference-copy
    // fields. Unknown provider metadata stays lossless in canonical YAML but
    // is not speculatively echoed into mutation payloads.
    let mut object = serde_json::Map::new();
    if !conference_data.entry_points.is_empty() {
        object.insert(
            "entryPoints".to_string(),
            serde_json::Value::Array(
                conference_data
                    .entry_points
                    .iter()
                    .map(render_conference_entry_point)
                    .collect(),
            ),
        );
    }
    if let Some(value) = &conference_data.conference_solution {
        object.insert(
            "conferenceSolution".to_string(),
            render_conference_solution(value),
        );
    }
    if let Some(value) = &conference_data.conference_id {
        object.insert("conferenceId".to_string(), serde_json::json!(value));
    }
    if let Some(value) = &conference_data.signature {
        object.insert("signature".to_string(), serde_json::json!(value));
    }
    if let Some(value) = &conference_data.notes {
        object.insert("notes".to_string(), serde_json::json!(value));
    }
    serde_json::Value::Object(object)
}

fn render_conference_solution_key(
    key: &crate::model::event::ConferenceSolutionKey,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if let Some(value) = &key.kind {
        object.insert("type".to_string(), serde_json::json!(value));
    }
    serde_json::Value::Object(object)
}

fn render_conference_solution(
    solution: &crate::model::event::ConferenceSolution,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if let Some(value) = &solution.key {
        object.insert("key".to_string(), render_conference_solution_key(value));
    }
    if let Some(value) = &solution.name {
        object.insert("name".to_string(), serde_json::json!(value));
    }
    if let Some(value) = &solution.icon_uri {
        object.insert("iconUri".to_string(), serde_json::json!(value));
    }
    serde_json::Value::Object(object)
}

fn render_conference_entry_point(
    entry_point: &crate::model::event::ConferenceEntryPoint,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    for (key, value) in [
        ("entryPointType", entry_point.entry_point_type.as_ref()),
        ("uri", entry_point.uri.as_ref()),
        ("label", entry_point.label.as_ref()),
        ("pin", entry_point.pin.as_ref()),
        ("accessCode", entry_point.access_code.as_ref()),
        ("meetingCode", entry_point.meeting_code.as_ref()),
        ("passcode", entry_point.passcode.as_ref()),
        ("password", entry_point.password.as_ref()),
    ] {
        if let Some(value) = value {
            object.insert(key.to_string(), serde_json::json!(value));
        }
    }
    serde_json::Value::Object(object)
}

fn parse_google_status(resource: &serde_json::Value) -> EventStatus {
    match resource
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("confirmed")
    {
        "tentative" => EventStatus::Tentative,
        "cancelled" => EventStatus::Cancelled,
        _ => EventStatus::Confirmed,
    }
}

fn render_jin_status(status: &EventStatus) -> String {
    match status {
        EventStatus::Confirmed => "confirmed".to_string(),
        EventStatus::Tentative => "tentative".to_string(),
        EventStatus::Cancelled => "cancelled".to_string(),
    }
}

/// Parse a Google temporal object (`start` or `end`) from the resource.
/// Returns `(value, value_type, tzid, is_all_day)`.
fn parse_google_time(
    resource: &serde_json::Value,
    field: &str,
) -> crate::Result<(TemporalValue, ValueType, Option<String>, bool)> {
    let obj = resource
        .get(field)
        .ok_or_else(|| JinError::YamlParse(format!("Google event missing '{field}' time field")))?;
    parse_google_time_obj(obj)
}

fn parse_google_time_obj(
    obj: &serde_json::Value,
) -> crate::Result<(TemporalValue, ValueType, Option<String>, bool)> {
    if let Some(date_str) = obj.get("date").and_then(|v| v.as_str()) {
        // All-day event: `date` field, no time, no tz.
        let d = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|e| {
            JinError::YamlParse(format!("Google all-day date '{date_str}' invalid: {e}"))
        })?;
        return Ok((TemporalValue::Date(d), ValueType::Date, None, true));
    }

    if let Some(dt_str) = obj.get("dateTime").and_then(|v| v.as_str()) {
        // Timed event: `dateTime` + optional `timeZone`.
        let tzid = obj
            .get("timeZone")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Parse the dateTime. Google returns RFC 3339 with optional offset.
        // We store wall-clock (un-normalized) NaiveDateTime, discarding the offset.
        let naive_dt = parse_google_datetime(dt_str)?;
        return Ok((
            TemporalValue::DateTime(naive_dt),
            ValueType::DateTime,
            tzid,
            false,
        ));
    }

    Err(JinError::YamlParse(
        "Google time object has neither 'date' nor 'dateTime'".to_string(),
    ))
}

/// Parse a Google RFC 3339 dateTime string to a `NaiveDateTime` (wall-time, no offset).
fn parse_google_datetime(s: &str) -> crate::Result<NaiveDateTime> {
    // Try RFC 3339 with offset first (e.g. "2026-07-01T14:00:00-03:00")
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(dt.naive_local());
    }
    // Plain NaiveDateTime (e.g. "2026-07-01T14:00:00")
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Ok(dt);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M") {
        return Ok(dt);
    }
    // Try with milliseconds (e.g. "2026-07-01T14:00:00.000Z")
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
        return Ok(dt);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ") {
        return Ok(dt);
    }
    Err(JinError::YamlParse(format!(
        "cannot parse Google dateTime '{s}'"
    )))
}

/// Parse a Google timestamp field (RFC 3339) into a `DateTime<FixedOffset>`.
fn parse_google_timestamp(
    resource: &serde_json::Value,
    field: &str,
) -> crate::Result<DateTime<FixedOffset>> {
    let s = resource
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("2026-01-01T00:00:00Z");

    DateTime::parse_from_rfc3339(s)
        .map_err(|e| JinError::YamlParse(format!("Google timestamp '{s}' ({field}): {e}")))
}

/// Render a `TemporalValue` as a Google `start`/`end` JSON object.
fn render_google_time(tv: &TemporalValue, tzid: Option<&str>) -> serde_json::Value {
    match tv {
        TemporalValue::Date(d) => {
            serde_json::json!({ "date": d.format("%Y-%m-%d").to_string() })
        }
        TemporalValue::DateTime(dt) => {
            let dt_str = dt.format("%Y-%m-%dT%H:%M:%S").to_string();
            if let Some(tz) = tzid {
                serde_json::json!({ "dateTime": dt_str, "timeZone": tz })
            } else {
                // Floating time (no tzid) — Google accepts bare dateTime
                serde_json::json!({ "dateTime": dt_str })
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_google_event() -> serde_json::Value {
        serde_json::json!({
            "id": "abc123",
            "iCalUID": "abc123@google.com",
            "etag": "\"3372702442484000\"",
            "status": "confirmed",
            "summary": "Dentist appointment",
            "description": "Annual checkup",
            "location": "123 Main St",
            "start": {
                "dateTime": "2026-07-01T14:00:00",
                "timeZone": "America/Sao_Paulo"
            },
            "end": {
                "dateTime": "2026-07-01T14:30:00",
                "timeZone": "America/Sao_Paulo"
            },
            "recurrence": [],
            "sequence": 0,
            "created": "2026-06-01T10:00:00Z",
            "updated": "2026-06-26T09:00:00Z",
            "transparency": "opaque",
            "visibility": "private",
            "organizer": {
                "id": "organizer-profile",
                "email": "owner@example.com",
                "displayName": "Event Owner",
                "self": true,
                "futureOrganizerField": "retained"
            },
            "attendees": [{
                "id": "attendee-profile",
                "email": "guest@example.com",
                "displayName": "Guest",
                "organizer": false,
                "self": false,
                "optional": true,
                "responseStatus": "tentative",
                "comment": "May arrive late",
                "additionalGuests": 1,
                "futureAttendeeField": "retained"
            }],
            "attendeesOmitted": true,
            "conferenceData": {
                "createRequest": {
                    "requestId": "consumed-provider-request",
                    "conferenceSolutionKey": { "type": "hangoutsMeet" },
                    "status": { "statusCode": "success" }
                },
                "entryPoints": [{
                    "entryPointType": "video",
                    "uri": "https://meet.google.com/abc-defg-hij",
                    "label": "meet.google.com/abc-defg-hij",
                    "futureEntryPointField": "retained-locally"
                }],
                "conferenceSolution": {
                    "key": {
                        "type": "hangoutsMeet",
                        "futureSolutionKeyField": "retained-locally"
                    },
                    "name": "Google Meet",
                    "iconUri": "https://example.com/meet.png",
                    "futureSolutionField": "retained-locally"
                },
                "conferenceId": "abc-defg-hij",
                "signature": "signed-by-google",
                "notes": "Dial-in details",
                "futureConferenceField": { "retained": true }
            },
            "hangoutLink": "https://meet.google.com/abc-defg-hij",
            "reminders": {
                "useDefault": false,
                "overrides": [
                    { "method": "popup", "minutes": 10 },
                    { "method": "email", "minutes": 60 }
                ]
            }
        })
    }

    fn sample_google_all_day() -> serde_json::Value {
        serde_json::json!({
            "id": "allday123",
            "iCalUID": "allday123@google.com",
            "etag": "\"etag_allday\"",
            "status": "confirmed",
            "summary": "Company Holiday",
            "start": { "date": "2026-07-04" },
            "end":   { "date": "2026-07-05" },
            "sequence": 0,
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-01-01T00:00:00Z"
        })
    }

    fn sample_google_recurring() -> serde_json::Value {
        serde_json::json!({
            "id": "recurring123",
            "iCalUID": "recurring123@google.com",
            "etag": "\"etag_rec\"",
            "status": "confirmed",
            "summary": "Weekly Standup",
            "start": {
                "dateTime": "2026-07-01T09:00:00",
                "timeZone": "America/New_York"
            },
            "end": {
                "dateTime": "2026-07-01T09:30:00",
                "timeZone": "America/New_York"
            },
            "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
            "sequence": 0,
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-06-01T00:00:00Z"
        })
    }

    // ── VG5: lossless round-trip (Google → Jin → Google) ──────────────────────

    #[test]
    fn vg5_timed_event_round_trip_lossless() {
        let google = sample_google_event();
        let jin = google_to_jin(&google, "01JTEST0001", "primary").unwrap();

        assert_eq!(jin.title, "Dentist appointment");
        assert_eq!(jin.description.as_deref(), Some("Annual checkup"));
        assert_eq!(jin.location.as_deref(), Some("123 Main St"));
        assert_eq!(jin.ical_uid.as_deref(), Some("abc123@google.com"));
        assert_eq!(jin.start_tzid.as_deref(), Some("America/Sao_Paulo"));
        assert!(!jin.is_all_day);
        assert_eq!(jin.source, EventSource::Google);
        assert_eq!(jin.authority, EventSource::Google);
        assert_eq!(jin.transparency.as_deref(), Some("opaque"));
        assert_eq!(jin.visibility.as_deref(), Some("private"));
        assert_eq!(
            jin.organizer
                .as_ref()
                .and_then(|value| value.email.as_deref()),
            Some("owner@example.com")
        );
        assert_eq!(jin.attendees.as_ref().unwrap().len(), 1);
        assert_eq!(
            jin.attendees.as_ref().unwrap()[0]
                .response_status
                .as_deref(),
            Some("tentative")
        );
        assert_eq!(jin.attendees_omitted, Some(true));
        assert_eq!(
            jin.conference_data
                .as_ref()
                .and_then(|value| value.create_request.as_ref())
                .and_then(|value| value.status.as_ref())
                .and_then(|value| value.status_code.as_deref()),
            Some("success")
        );
        assert_eq!(
            jin.hangout_link.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
        assert_eq!(
            jin.reminders
                .as_ref()
                .and_then(|value| value.overrides.as_ref())
                .map(Vec::len),
            Some(2)
        );

        // Convert back to Google
        let google2 = jin_to_google(&jin);
        assert_eq!(google2["summary"], "Dentist appointment");
        assert_eq!(google2["description"], "Annual checkup");
        assert_eq!(google2["location"], "123 Main St");
        assert_eq!(google2["status"], "confirmed");
        assert_eq!(google2["start"]["timeZone"], "America/Sao_Paulo");
        assert_eq!(google2["transparency"], "opaque");
        assert_eq!(google2["visibility"], "private");
        // Organizer and response-only attendee identity flags are read-only on
        // ordinary insert/patch requests and must not be echoed.
        assert!(google2.get("organizer").is_none());
        assert!(google2.get("attendeesOmitted").is_none());
        assert!(google2.get("hangoutLink").is_none());
        assert!(google2["conferenceData"].get("createRequest").is_none());
        assert!(google2["attendees"][0].get("id").is_none());
        assert!(google2["attendees"][0].get("organizer").is_none());
        assert!(google2["attendees"][0].get("self").is_none());
        assert_eq!(google2["attendees"][0]["email"], "guest@example.com");
        assert_eq!(google2["attendees"][0]["responseStatus"], "tentative");
        assert!(google2["attendees"][0].get("futureAttendeeField").is_none());
        assert!(google2["conferenceData"]
            .get("futureConferenceField")
            .is_none());
        assert!(google2["conferenceData"]["entryPoints"][0]
            .get("futureEntryPointField")
            .is_none());
        assert!(google2["conferenceData"]["conferenceSolution"]
            .get("futureSolutionField")
            .is_none());
        assert!(google2["conferenceData"]["conferenceSolution"]["key"]
            .get("futureSolutionKeyField")
            .is_none());
        assert_eq!(google2["reminders"]["useDefault"], false);
        assert_eq!(google2["reminders"]["overrides"][1]["minutes"], 60);

        // The provider metadata is canonical-file data, not a transient sync
        // projection. YAML must retain both known and forward-compatible keys.
        let yaml = serde_yaml_ng::to_string(&jin).unwrap();
        let reparsed: EventFrontmatter = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(reparsed.organizer, jin.organizer);
        assert_eq!(reparsed.attendees, jin.attendees);
        assert_eq!(reparsed.conference_data, jin.conference_data);
        assert_eq!(reparsed.reminders, jin.reminders);

        let dto = crate::dto::EventDto::from_model(&crate::model::event::Event {
            frontmatter: jin,
            body: String::new(),
        });
        assert_eq!(dto.attendees.as_ref().unwrap().len(), 1);
        assert_eq!(
            dto.conference_data
                .as_ref()
                .and_then(|value| value.conference_id.as_deref()),
            Some("abc-defg-hij")
        );
        assert_eq!(dto.reminders.unwrap().overrides.unwrap().len(), 2);
    }

    #[test]
    fn reminder_defaults_and_explicit_no_reminders_remain_distinct() {
        let mut defaults = sample_google_event();
        defaults["reminders"] = serde_json::json!({ "useDefault": true });
        let defaults = google_to_jin(&defaults, "01JREMINDER01", "primary").unwrap();
        let default_settings = defaults.reminders.as_ref().unwrap();
        assert!(default_settings.use_default);
        assert!(default_settings.overrides.is_none());
        assert_eq!(
            jin_to_google(&defaults)["reminders"],
            serde_json::json!({
                "useDefault": true
            })
        );

        let mut none = sample_google_event();
        none["reminders"] = serde_json::json!({ "useDefault": false });
        let none = google_to_jin(&none, "01JREMINDER02", "primary").unwrap();
        let no_reminders = none.reminders.as_ref().unwrap();
        assert!(!no_reminders.use_default);
        assert!(no_reminders.overrides.is_none());
        assert_eq!(
            jin_to_google(&none)["reminders"],
            serde_json::json!({
                "useDefault": false
            })
        );
    }

    #[test]
    fn explicit_empty_attendee_list_is_emitted_to_clear_attendees() {
        let mut google = sample_google_event();
        google["attendees"] = serde_json::json!([]);
        let jin = google_to_jin(&google, "01JATTENDEE00", "primary").unwrap();
        assert_eq!(jin.attendees, Some(vec![]));
        assert_eq!(jin_to_google(&jin)["attendees"], serde_json::json!([]));
    }

    #[test]
    fn only_a_fresh_pending_conference_request_is_written() {
        let mut jin = google_to_jin(&sample_google_event(), "01JCONFERENCE01", "primary").unwrap();
        let conference = jin.conference_data.as_mut().unwrap();
        conference.entry_points.clear();
        conference.conference_solution = None;
        conference.conference_id = None;
        conference.signature = None;
        conference.pending_create_request = Some(
            serde_json::from_value(serde_json::json!({
                "requestId": "jin-fresh-request-01",
                "conferenceSolutionKey": {
                    "type": "hangoutsMeet",
                    "futureSolutionKeyField": "do-not-write"
                }
            }))
            .unwrap(),
        );

        let write = jin_to_google(&jin);
        assert_eq!(
            write["conferenceData"]["createRequest"],
            serde_json::json!({
                "requestId": "jin-fresh-request-01",
                "conferenceSolutionKey": { "type": "hangoutsMeet" }
            })
        );
        assert!(write["conferenceData"]["createRequest"]
            .get("status")
            .is_none());
        assert!(
            write["conferenceData"]["createRequest"]["conferenceSolutionKey"]
                .get("futureSolutionKeyField")
                .is_none()
        );
        assert!(write["conferenceData"]
            .get("pendingCreateRequest")
            .is_none());
    }

    #[test]
    fn vg5_all_day_event_round_trip() {
        let google = sample_google_all_day();
        let jin = google_to_jin(&google, "01JTEST0002", "primary").unwrap();

        assert!(jin.is_all_day);
        assert_eq!(jin.start_value_type, ValueType::Date);
        assert!(jin.start_tzid.is_none());
        assert_eq!(jin.title, "Company Holiday");

        let google2 = jin_to_google(&jin);
        // All-day events must use `date` not `dateTime`
        assert!(
            google2["start"].get("date").is_some(),
            "all-day event must have start.date"
        );
        assert!(
            google2["start"].get("dateTime").is_none(),
            "all-day event must NOT have start.dateTime"
        );
        assert_eq!(google2["start"]["date"], "2026-07-04");
    }

    /// VG5 deepened: all-day `end.date` is exclusive (Google convention).
    /// July 4 single-day event → end.date = July 5 (exclusive).
    /// Jin→Google round-trip must preserve the exclusive end.
    /// Google→Jin→Google parse-back must reproduce the same exclusive end.date.
    #[test]
    fn vg5_all_day_exclusive_end_round_trip() {
        // All-day July 4 event: start=July4, end=July5 (exclusive)
        let google = serde_json::json!({
            "id": "july4th",
            "iCalUID": "july4th@google.com",
            "etag": "\"etag_july4\"",
            "status": "confirmed",
            "summary": "Independence Day",
            "start": { "date": "2026-07-04" },
            "end":   { "date": "2026-07-05" },   // exclusive end
            "sequence": 0,
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-01-01T00:00:00Z"
        });

        let jin = google_to_jin(&google, "01JJULY4001", "primary").unwrap();

        // Verify all-day fields
        assert!(jin.is_all_day);
        assert_eq!(jin.start_value_type, ValueType::Date);
        assert_eq!(jin.end_value_type, ValueType::Date);
        assert!(!jin.floating, "all-day events are never floating");

        // Verify the EXCLUSIVE end date is preserved in Jin representation
        let TemporalValue::Date(end_date) = &jin.end else {
            panic!("expected Date end for all-day event");
        };
        assert_eq!(
            end_date.format("%Y-%m-%d").to_string(),
            "2026-07-05",
            "exclusive end date (July 5) must be preserved in Jin frontmatter"
        );

        // Jin→Google round-trip: end.date must be July 5 (exclusive)
        let google2 = jin_to_google(&jin);
        assert_eq!(
            google2["start"]["date"], "2026-07-04",
            "start.date must round-trip correctly"
        );
        assert_eq!(
            google2["end"]["date"], "2026-07-05",
            "exclusive end.date must round-trip correctly"
        );
        assert!(
            google2["start"].get("dateTime").is_none(),
            "all-day round-trip must not produce dateTime"
        );

        // Google→Jin→Google parse-back: parsing the re-serialized JSON must
        // reproduce the same exclusive end.date.
        let jin2 = google_to_jin(&google2, "01JJULY4002", "primary").unwrap();
        let google3 = jin_to_google(&jin2);
        assert_eq!(
            google3["end"]["date"], "2026-07-05",
            "exclusive end must survive a full Google→Jin→Google→Jin→Google cycle"
        );
    }

    #[test]
    fn vg5_recurring_event_stored_verbatim() {
        let google = sample_google_recurring();
        let jin = google_to_jin(&google, "01JTEST0003", "primary").unwrap();

        assert_eq!(jin.recurrence, vec!["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]);
        assert!(
            jin.recurrence_unexpanded,
            "recurring event must be flagged recurrence_unexpanded"
        );

        // Recurrence lines must round-trip verbatim
        let google2 = jin_to_google(&jin);
        let rec = google2["recurrence"].as_array().unwrap();
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0], "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
    }

    #[test]
    fn vg5_tentative_status_round_trip() {
        let mut google = sample_google_event();
        google["status"] = serde_json::Value::String("tentative".to_string());

        let jin = google_to_jin(&google, "01JTEST0004", "primary").unwrap();
        assert_eq!(jin.status, EventStatus::Tentative);

        let google2 = jin_to_google(&jin);
        assert_eq!(google2["status"], "tentative");
    }

    #[test]
    fn vg5_cancelled_status_maps_to_tombstone() {
        let mut google = sample_google_event();
        google["status"] = serde_json::Value::String("cancelled".to_string());

        let jin = google_to_jin(&google, "01JTEST0005", "primary").unwrap();
        assert_eq!(jin.status, EventStatus::Cancelled);
        assert!(jin.is_deleted());
    }

    #[test]
    fn google_to_jin_sets_source_and_authority_google() {
        let google = sample_google_event();
        let jin = google_to_jin(&google, "01JTEST0006", "work_calendar").unwrap();
        assert_eq!(jin.source, EventSource::Google);
        assert_eq!(jin.authority, EventSource::Google);
        assert_eq!(jin.calendar_id, "work_calendar");
    }

    // ── m8: floating timed event (dateTime, no timeZone) ─────────────────────

    #[test]
    fn m8_timed_event_without_timezone_flagged_floating() {
        let google = serde_json::json!({
            "id": "floating1",
            "iCalUID": "floating1@google.com",
            "etag": "\"etag_float\"",
            "status": "confirmed",
            "summary": "Floating Meeting",
            "start": { "dateTime": "2026-07-01T14:00:00" }, // no timeZone
            "end":   { "dateTime": "2026-07-01T15:00:00" }, // no timeZone
            "sequence": 0,
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-01-01T00:00:00Z"
        });

        let jin = google_to_jin(&google, "01JFLOAT001", "primary").unwrap();

        assert!(
            jin.floating,
            "timed event with no timeZone must be flagged floating=true"
        );
        assert!(
            jin.start_tzid.is_none(),
            "floating event must have no start_tzid"
        );
        assert!(!jin.is_all_day);

        // Round-trip: floating → Google body should have no timeZone field
        let google2 = jin_to_google(&jin);
        assert!(
            google2["start"].get("timeZone").is_none(),
            "floating event must not emit timeZone in output"
        );
        assert!(
            google2["start"]["dateTime"].is_string(),
            "floating event must have dateTime"
        );
    }

    #[test]
    fn jin_to_google_jin_origin_event() {
        // A Jin-origin promoted event → should produce valid Google body
        use chrono::NaiveDateTime;
        let dt = NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
        let now = chrono::Utc::now().fixed_offset();
        let fm = EventFrontmatter {
            id: "01JTEST_JIN".to_string(),
            kind: "event".to_string(),
            title: "My promoted event".to_string(),
            description: Some("A note body".to_string()),
            location: None,
            start: TemporalValue::DateTime(dt),
            end: TemporalValue::DateTime(dt),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/Sao_Paulo".to_string()),
            end_tzid: Some("America/Sao_Paulo".to_string()),
            floating: false,
            recurrence: vec![],
            recurring_event_id: None,
            original_start: None,
            master_id: None,
            recurrence_unexpanded: false,
            ical_uid: None,
            sequence: 0,
            status: EventStatus::Confirmed,
            created: now,
            updated: now,
            transparency: None,
            visibility: None,
            organizer: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            hangout_link: None,
            reminders: None,
            source: EventSource::Jin,
            authority: EventSource::Jin,
            calendar_id: "primary".to_string(),
            derived_from: Some("01JTASK001".to_string()),
        };

        let body = jin_to_google(&fm);
        assert_eq!(body["summary"], "My promoted event");
        assert_eq!(body["description"], "A note body");
        assert_eq!(body["start"]["timeZone"], "America/Sao_Paulo");
        assert_eq!(body["start"]["dateTime"], "2026-07-01T14:00:00");
    }

    #[test]
    fn local_context_never_serialized() {
        let dt = chrono::NaiveDateTime::parse_from_str("2026-07-01T14:00:00", "%Y-%m-%dT%H:%M:%S")
            .unwrap();
        let now = chrono::Utc::now().fixed_offset();
        let fm = EventFrontmatter {
            id: "01JLOCAL_CONTEXT".to_string(),
            kind: "event".to_string(),
            title: "Private context boundary".to_string(),
            description: Some("Provider-safe description".to_string()),
            location: Some("Room".to_string()),
            start: TemporalValue::DateTime(dt),
            end: TemporalValue::DateTime(dt + chrono::Duration::hours(1)),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: None,
            end_tzid: None,
            floating: true,
            recurrence: vec![],
            recurring_event_id: None,
            original_start: None,
            master_id: None,
            recurrence_unexpanded: false,
            ical_uid: None,
            sequence: 0,
            status: EventStatus::Confirmed,
            created: now,
            updated: now,
            transparency: None,
            visibility: None,
            organizer: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            hangout_link: None,
            reminders: None,
            source: EventSource::Jin,
            authority: EventSource::Jin,
            calendar_id: "primary".to_string(),
            // This is deliberately populated: it is a Jin-local relationship
            // and must not cross the explicit Google field allowlist.
            derived_from: Some("01JTASK_PRIVATE".to_string()),
        };

        let payload = jin_to_google(&fm);
        let keys = payload
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let allowed = [
            "description",
            "end",
            "iCalUID",
            "location",
            "originalStartTime",
            "recurrence",
            "recurringEventId",
            "sequence",
            "start",
            "status",
            "summary",
            "transparency",
            "visibility",
        ];
        assert!(keys.iter().all(|key| allowed.contains(&key.as_str())));
        let encoded = serde_json::to_string(&payload).unwrap();
        for private_key in [
            "agenda_bucket",
            "derived_from",
            "edges",
            "backlinks",
            "prep_notes",
            "related",
            "capabilities",
            "locale",
        ] {
            assert!(!encoded.contains(private_key), "leaked {private_key}");
        }
    }
}

#[test]
fn rsvp_exact_payload_golden() {
    let payload = invitation_response_patch("self@example.com", "accepted");
    assert_eq!(
        serde_json::to_string(&payload).unwrap(),
        r#"{"attendees":[{"email":"self@example.com","responseStatus":"accepted"}],"attendeesOmitted":true}"#
    );
    assert_eq!(payload.as_object().unwrap().len(), 2);
    assert_eq!(payload["attendees"].as_array().unwrap().len(), 1);
}
