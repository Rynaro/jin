//! S2 — Core range projection, temporal preview, and sparse EventEditDelta.
//!
//! Gate coverage: AC-CALX-024, 035–039, 051, 054–056 as sliced into this
//! change's AC-S2-03 … AC-S2-14.

use chrono::{NaiveDate, NaiveDateTime};
use tempfile::TempDir;

use jin_core::dto::event::{
    CalendarRangeProjectionInput, CalendarSlotState, EventTemporalPreviewInput,
    TemporalDisabledReason, TemporalPreviewStatus, TemporalResolutionKind,
};
use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::calendar_projection::{calendar_range_projection, event_temporal_preview};
use jin_core::ops::event_mutation::{EventEditDelta, EventMutationService, EventTemporalDelta};
use jin_core::ops::events::{self, CreateEventParams};

// ── Fixtures ──────────────────────────────────────────────────────────────────

fn vault(display_tz: &str) -> TempDir {
    let root = TempDir::new().unwrap();
    jin_core::ops::init(root.path()).unwrap();
    let mut config = jin_core::Config::load(root.path()).unwrap();
    config.display_tz = display_tz.to_string();
    config.save().unwrap();
    root
}

fn wall(value: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
}

fn timed_params(
    title: &str,
    start: &str,
    end: &str,
    start_tzid: &str,
    end_tzid: &str,
) -> CreateEventParams {
    CreateEventParams {
        title: title.to_string(),
        body: String::new(),
        start: TemporalValue::DateTime(wall(start)),
        end: TemporalValue::DateTime(wall(end)),
        start_value_type: ValueType::DateTime,
        end_value_type: ValueType::DateTime,
        is_all_day: false,
        start_tzid: Some(start_tzid.to_string()),
        end_tzid: Some(end_tzid.to_string()),
        floating: false,
        ical_uid: None,
        description: None,
        location: None,
        attendees: None,
        conference_data: None,
        reminders: None,
    }
}

/// Write an event straight to the vault and refresh the index so the read-only
/// projection can see it.
fn seed(root: &std::path::Path, params: CreateEventParams) -> String {
    let cfg = jin_core::Config::load(root).unwrap();
    let event = events::create_event(&cfg.events_dir(), params).unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    event.frontmatter.id.clone()
}

fn window(from: &str, to: &str) -> CalendarRangeProjectionInput {
    CalendarRangeProjectionInput {
        from: from.to_string(),
        to: to.to_string(),
    }
}

// ── AC-S2-03: cross-zone display geometry (AC-CALX-051) ───────────────────────

#[test]
fn cross_zone_display_geometry() {
    // Departs Sao Paulo 22:00 on Jul 1 (UTC-3 → 01:00Z Jul 2), lands Lisbon
    // 06:00 on Jul 2 (UTC+1 in July → 05:00Z). Read in New York (UTC-4), the
    // flight spans two display dates even though it is only four hours long.
    let root = vault("America/New_York");
    let id = seed(
        root.path(),
        timed_params(
            "Overnight flight",
            "2026-07-01T22:00:00",
            "2026-07-02T06:00:00",
            "America/Sao_Paulo",
            "Europe/Lisbon",
        ),
    );

    let projection =
        calendar_range_projection(root.path(), &window("2026-07-01", "2026-07-03")).unwrap();
    assert_eq!(projection.display_tz, "America/New_York");
    let entry = projection
        .entries
        .iter()
        .find(|entry| entry.event_id == id)
        .expect("the flight must appear in a window that covers it");

    assert_eq!(entry.slot_state, CalendarSlotState::Anchored);
    // Each endpoint resolved through its *own* zone.
    assert_eq!(entry.start_utc.as_deref(), Some("2026-07-02T01:00:00Z"));
    assert_eq!(entry.end_utc.as_deref(), Some("2026-07-02T05:00:00Z"));
    // Both endpoints then projected into the single display timezone.
    assert_eq!(entry.start_display, "2026-07-01T21:00:00");
    assert_eq!(entry.end_display, "2026-07-02T01:00:00");
    assert_eq!(entry.start_date, "2026-07-01");
    assert_eq!(entry.end_date, "2026-07-02");
    assert_eq!(entry.continuation_dates, vec!["2026-07-02"]);
    assert_eq!(entry.elapsed_minutes, 240);
    // The stored zones survive the projection distinctly.
    assert_eq!(entry.start_tzid.as_deref(), Some("America/Sao_Paulo"));
    assert_eq!(entry.end_tzid.as_deref(), Some("Europe/Lisbon"));
    assert!(entry.temporal_editable);
    assert_eq!(entry.temporal_disabled_reason, None);
}

#[test]
fn projection_is_bounded_to_the_requested_dates() {
    let root = vault("UTC");
    seed(
        root.path(),
        timed_params(
            "Far future",
            "2027-01-05T09:00:00",
            "2027-01-05T10:00:00",
            "UTC",
            "UTC",
        ),
    );
    let inside = seed(
        root.path(),
        timed_params(
            "In window",
            "2026-07-02T09:00:00",
            "2026-07-02T10:00:00",
            "UTC",
            "UTC",
        ),
    );

    let projection =
        calendar_range_projection(root.path(), &window("2026-07-01", "2026-07-03")).unwrap();
    let ids: Vec<&str> = projection
        .entries
        .iter()
        .map(|entry| entry.event_id.as_str())
        .collect();
    assert_eq!(ids, vec![inside.as_str()]);
}

#[test]
fn all_day_projection_uses_inclusive_display_dates() {
    // Canonical all-day end is exclusive (Jul 4), so the last occupied display
    // date is Jul 3.
    let root = vault("UTC");
    let id = seed(
        root.path(),
        CreateEventParams {
            title: "Conference".to_string(),
            body: String::new(),
            start: TemporalValue::Date(date("2026-07-01")),
            end: TemporalValue::Date(date("2026-07-04")),
            start_value_type: ValueType::Date,
            end_value_type: ValueType::Date,
            is_all_day: true,
            start_tzid: None,
            end_tzid: None,
            floating: false,
            ical_uid: None,
            description: None,
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        },
    );
    let projection =
        calendar_range_projection(root.path(), &window("2026-07-01", "2026-07-05")).unwrap();
    let entry = projection
        .entries
        .iter()
        .find(|entry| entry.event_id == id)
        .unwrap();
    assert_eq!(entry.slot_state, CalendarSlotState::AllDay);
    assert_eq!(entry.start_date, "2026-07-01");
    assert_eq!(entry.end_date, "2026-07-03");
    assert_eq!(
        entry.continuation_dates,
        vec!["2026-07-02", "2026-07-03"],
        "an all-day span continues onto every inclusive date after the first"
    );
    assert!(entry.start_utc.is_none(), "all-day has no instant identity");
}

// ── AC-S2-04: ambiguous existing event stays safely editable (AC-CALX-055) ────

#[test]
fn ambiguous_existing_event_safe_editing() {
    // America/New_York falls back 2023-11-05 at 02:00; 01:30 happens twice, so
    // the instant the author meant cannot be proven to round-trip.
    let root = vault("America/New_York");
    let id = seed(
        root.path(),
        timed_params(
            "Ambiguous standup",
            "2023-11-05T01:30:00",
            "2023-11-05T03:30:00",
            "America/New_York",
            "America/New_York",
        ),
    );

    let projection =
        calendar_range_projection(root.path(), &window("2023-11-04", "2023-11-06")).unwrap();
    let entry = projection
        .entries
        .iter()
        .find(|entry| entry.event_id == id)
        .unwrap();

    assert!(
        !entry.temporal_editable,
        "an unprovable wall-time identity must disable temporal editing"
    );
    assert_eq!(
        entry.temporal_disabled_reason,
        Some(TemporalDisabledReason::AmbiguousWallTime)
    );
    assert_eq!(
        entry.start_resolution,
        Some(TemporalResolutionKind::AmbiguousEarlier)
    );
    // The entry is still projected and still carries its identity, so every
    // non-temporal edit remains available on it.
    assert!(entry.start_utc.is_some());
    assert_eq!(entry.title, "Ambiguous standup");

    // And the sparse path proves "other edits remain available": a title-only
    // delta on this very event still succeeds.
    let token = events::event_edit_token(root.path(), &id).unwrap();
    let service = EventMutationService::new(root.path()).unwrap();
    let outcome = service
        .edit_sparse(
            &id,
            &token,
            EventEditDelta {
                title: Some("Renamed while time is locked".to_string()),
                ..Default::default()
            },
            None,
            "s2-ambiguous-title-edit",
        )
        .expect("non-temporal edits must stay available on an ambiguous event");
    assert_eq!(
        outcome.event.frontmatter.title,
        "Renamed while time is locked"
    );
}

// ── AC-S2-05: non-standard gap is typed and never schedulable (AC-CALX-056) ───

#[test]
fn nonstandard_gap_error() {
    // Samoa skipped all of 2011-12-30 when it jumped the date line, so no hour
    // of that day exists and the +1h policy cannot rescue it.
    let preview = event_temporal_preview(&EventTemporalPreviewInput {
        start: "2011-12-30T12:00:00".to_string(),
        end: "2011-12-30T13:00:00".to_string(),
        is_all_day: false,
        floating: false,
        start_tzid: Some("Pacific/Apia".to_string()),
        end_tzid: Some("Pacific/Apia".to_string()),
    });

    assert_eq!(preview.status, TemporalPreviewStatus::UnresolvableLocalTime);
    assert!(
        !preview.schedulable,
        "core must not hand back a draft it cannot place on a timeline"
    );
    assert!(preview.start_utc.is_none());
    assert!(preview.end_utc.is_none());
    assert!(preview.elapsed_minutes.is_none());
    assert!(preview.errors.iter().any(|error| error.field == "start"
        && error.code == TemporalPreviewStatus::UnresolvableLocalTime));
}

#[test]
fn calendar_projection_gap_error() {
    let root = vault("UTC");
    let id = seed(
        root.path(),
        timed_params(
            "Vanished day",
            "2011-12-30T12:00:00",
            "2011-12-30T13:00:00",
            "Pacific/Apia",
            "Pacific/Apia",
        ),
    );
    let projection =
        calendar_range_projection(root.path(), &window("2011-12-29", "2011-12-31")).unwrap();
    let entry = projection
        .entries
        .iter()
        .find(|entry| entry.event_id == id)
        .expect("an unresolvable event still belongs on the calendar");
    assert!(!entry.temporal_editable);
    assert_eq!(
        entry.temporal_disabled_reason,
        Some(TemporalDisabledReason::UnresolvableLocalTime)
    );
}

// ── AC-S2-07: resolution kinds (AC-CALX-036, AC-CALX-037) ─────────────────────

#[test]
fn resolution_kind_fixtures() {
    let ambiguous = event_temporal_preview(&EventTemporalPreviewInput {
        start: "2023-11-05T01:30:00".to_string(),
        end: "2023-11-05T03:30:00".to_string(),
        is_all_day: false,
        floating: false,
        start_tzid: Some("America/New_York".to_string()),
        end_tzid: Some("America/New_York".to_string()),
    });
    assert_eq!(
        ambiguous.start_resolution,
        Some(TemporalResolutionKind::AmbiguousEarlier)
    );
    assert_eq!(ambiguous.start_utc.as_deref(), Some("2023-11-05T05:30:00Z"));
    assert!(ambiguous.start_note.is_some());

    let gap = event_temporal_preview(&EventTemporalPreviewInput {
        start: "2023-03-12T02:30:00".to_string(),
        end: "2023-03-12T05:30:00".to_string(),
        is_all_day: false,
        floating: false,
        start_tzid: Some("America/New_York".to_string()),
        end_tzid: Some("America/New_York".to_string()),
    });
    assert_eq!(
        gap.start_resolution,
        Some(TemporalResolutionKind::NonexistentShiftedForward)
    );
    assert_eq!(
        gap.start_display, "2023-03-12T03:30:00",
        "an ordinary one-hour gap reports the adjusted local time"
    );
    assert!(gap.start_note.is_some());
}

// ── AC-S2-12: partial temporal bundles are rejected ───────────────────────────

#[test]
fn partial_temporal_bundle_rejected() {
    // A complete anchored bundle is accepted.
    assert!(EventTemporalDelta::new(
        "2026-07-01T09:00:00",
        "2026-07-01T10:00:00",
        false,
        false,
        Some("UTC".to_string()),
        Some("UTC".to_string()),
    )
    .is_ok());

    // An anchored bundle missing one zone is not a bundle.
    assert!(EventTemporalDelta::new(
        "2026-07-01T09:00:00",
        "2026-07-01T10:00:00",
        false,
        false,
        Some("UTC".to_string()),
        None,
    )
    .is_err());

    // A zone on an all-day bundle is a contradiction, not a harmless extra.
    assert!(EventTemporalDelta::new(
        "2026-07-01",
        "2026-07-02",
        true,
        false,
        Some("UTC".to_string()),
        None,
    )
    .is_err());

    // Deserialization refuses the same partial shapes.
    let start_only = serde_json::from_value::<EventEditDelta>(serde_json::json!({
        "temporal": { "start": "2026-07-01T09:00:00" }
    }));
    assert!(
        start_only.is_err(),
        "a start with no end must never deserialize into a bundle"
    );

    let missing_end_zone = serde_json::from_value::<EventEditDelta>(serde_json::json!({
        "temporal": {
            "start": "2026-07-01T09:00:00",
            "end": "2026-07-01T10:00:00",
            "is_all_day": false,
            "floating": false,
            "start_tzid": "UTC"
        }
    }));
    assert!(missing_end_zone.is_err());

    let complete = serde_json::from_value::<EventEditDelta>(serde_json::json!({
        "temporal": {
            "start": "2026-07-01T09:00:00",
            "end": "2026-07-01T10:00:00",
            "is_all_day": false,
            "floating": false,
            "start_tzid": "UTC",
            "end_tzid": "UTC"
        }
    }));
    assert!(complete.is_ok());

    // Absent entirely is the other legal shape: a non-temporal edit.
    let absent = serde_json::from_value::<EventEditDelta>(serde_json::json!({
        "title": "Just a rename"
    }))
    .unwrap();
    assert!(!absent.touches_time());
}

// ── AC-S2-13: a stale token fails before any merge or write ───────────────────

#[test]
fn stale_sparse_edit_no_write() {
    let root = vault("UTC");
    let id = seed(
        root.path(),
        timed_params(
            "Original",
            "2026-07-01T09:00:00",
            "2026-07-01T10:00:00",
            "UTC",
            "UTC",
        ),
    );
    let stale_token = events::event_edit_token(root.path(), &id).unwrap();

    // Something else changes the event underneath the client.
    let cfg = jin_core::Config::load(root.path()).unwrap();
    let mut changed = events::get_event(&cfg.events_dir(), &id).unwrap();
    changed.frontmatter.title = "Changed elsewhere".to_string();
    jin_core::store::fs::write_event(&cfg.events_dir(), &changed).unwrap();

    let service = EventMutationService::new(root.path()).unwrap();
    let result = service.edit_sparse(
        &id,
        &stale_token,
        EventEditDelta {
            title: Some("My draft".to_string()),
            ..Default::default()
        },
        None,
        "s2-stale-sparse-edit",
    );

    assert!(
        matches!(result, Err(jin_core::JinError::StaleEvent { .. })),
        "a stale token must fail as a stale event, got {:?}",
        result.map(|outcome| outcome.event.frontmatter.title.clone())
    );

    // Nothing was written: the external change still stands untouched.
    let after = events::get_event(&cfg.events_dir(), &id).unwrap();
    assert_eq!(
        after.frontmatter.title, "Changed elsewhere",
        "a rejected sparse edit must not have written anything"
    );
}

// ── AC-S2-14: a title-only edit preserves both endpoints and both zones ───────

#[test]
fn cross_zone_title_only_edit() {
    let root = vault("UTC");
    let id = seed(
        root.path(),
        timed_params(
            "Flight",
            "2026-07-01T22:00:00",
            "2026-07-02T06:00:00",
            "America/Sao_Paulo",
            "Europe/Lisbon",
        ),
    );
    let token = events::event_edit_token(root.path(), &id).unwrap();

    let service = EventMutationService::new(root.path()).unwrap();
    let outcome = service
        .edit_sparse(
            &id,
            &token,
            EventEditDelta {
                title: Some("Flight (renamed)".to_string()),
                ..Default::default()
            },
            None,
            "s2-cross-zone-title-only",
        )
        .unwrap();

    let fm = &outcome.event.frontmatter;
    assert_eq!(fm.title, "Flight (renamed)");
    assert_eq!(
        jin_core::model::event::render_temporal(&fm.start),
        "2026-07-01T22:00:00"
    );
    assert_eq!(
        jin_core::model::event::render_temporal(&fm.end),
        "2026-07-02T06:00:00"
    );
    assert_eq!(
        fm.start_tzid.as_deref(),
        Some("America/Sao_Paulo"),
        "an omitted temporal bundle must not touch the start zone"
    );
    assert_eq!(
        fm.end_tzid.as_deref(),
        Some("Europe/Lisbon"),
        "an omitted temporal bundle must never clone the start zone over a distinct end zone"
    );
    assert!(!fm.is_all_day);
    assert!(!fm.floating);
}

#[test]
fn sparse_temporal_bundle_moves_both_endpoints_together() {
    let root = vault("UTC");
    let id = seed(
        root.path(),
        timed_params(
            "Sync",
            "2026-07-01T09:00:00",
            "2026-07-01T10:00:00",
            "UTC",
            "UTC",
        ),
    );
    let token = events::event_edit_token(root.path(), &id).unwrap();
    let service = EventMutationService::new(root.path()).unwrap();

    let outcome = service
        .edit_sparse(
            &id,
            &token,
            EventEditDelta {
                temporal: Some(
                    EventTemporalDelta::new(
                        "2026-07-01T14:00:00",
                        "2026-07-01T15:30:00",
                        false,
                        false,
                        Some("America/New_York".to_string()),
                        Some("America/New_York".to_string()),
                    )
                    .unwrap(),
                ),
                ..Default::default()
            },
            None,
            "s2-sparse-temporal-move",
        )
        .unwrap();

    let fm = &outcome.event.frontmatter;
    assert_eq!(
        jin_core::model::event::render_temporal(&fm.start),
        "2026-07-01T14:00:00"
    );
    assert_eq!(
        jin_core::model::event::render_temporal(&fm.end),
        "2026-07-01T15:30:00"
    );
    assert_eq!(fm.start_tzid.as_deref(), Some("America/New_York"));
    assert_eq!(fm.end_tzid.as_deref(), Some("America/New_York"));
    assert_eq!(
        fm.title, "Sync",
        "an omitted title must be preserved from the canonical baseline"
    );
}

#[test]
fn sparse_edit_preserves_untouched_description_and_clears_on_explicit_null() {
    let root = vault("UTC");
    let mut params = timed_params(
        "Notes",
        "2026-07-01T09:00:00",
        "2026-07-01T10:00:00",
        "UTC",
        "UTC",
    );
    params.description = Some("keep me".to_string());
    let id = seed(root.path(), params);
    let service = EventMutationService::new(root.path()).unwrap();

    // Omitted → preserved.
    let token = events::event_edit_token(root.path(), &id).unwrap();
    let outcome = service
        .edit_sparse(
            &id,
            &token,
            EventEditDelta {
                title: Some("Notes v2".to_string()),
                ..Default::default()
            },
            None,
            "s2-description-preserved",
        )
        .unwrap();
    assert_eq!(
        outcome.event.frontmatter.description.as_deref(),
        Some("keep me")
    );

    // Explicit null → cleared.
    let token = events::event_edit_token(root.path(), &id).unwrap();
    let delta: EventEditDelta =
        serde_json::from_value(serde_json::json!({ "description": null })).unwrap();
    let outcome = service
        .edit_sparse(&id, &token, delta, None, "s2-description-cleared")
        .unwrap();
    assert_eq!(outcome.event.frontmatter.description, None);
}
