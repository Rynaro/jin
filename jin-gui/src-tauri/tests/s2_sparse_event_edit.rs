//! S2 — Tauri boundary for sparse edits, range projection, and temporal preview.
//!
//! Gate coverage: AC-S2-06 (boundary fidelity), AC-S2-12 (partial bundle
//! rejected at the Tauri input), AC-S2-13 (stale token writes nothing),
//! AC-S2-14 (cross-zone title-only edit), AC-S2-16 (legacy adapter parity).

use chrono::NaiveDateTime;
use tempfile::TempDir;

use jin_core::dto::{CalendarRangeProjectionInput, EventTemporalPreviewInput};
use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::events::{self, CreateEventParams};
use jin_gui::commands::events::{
    calendar_range_projection_fn, edit_event_delta_fn, edit_event_fn, event_temporal_preview_fn,
    get_event_detail_fn, EditEventDeltaInput, EditEventInput,
};

fn wall(value: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").unwrap()
}

fn vault(display_tz: &str) -> TempDir {
    let root = TempDir::new().unwrap();
    jin_core::ops::init(root.path()).unwrap();
    let mut config = jin_core::Config::load(root.path()).unwrap();
    config.display_tz = display_tz.to_string();
    config.save().unwrap();
    root
}

/// Seed an event whose endpoints genuinely live in different zones — a shape
/// the legacy single-`tzid` create path cannot express.
fn seed_cross_zone(root: &std::path::Path) -> String {
    let cfg = jin_core::Config::load(root).unwrap();
    let event = events::create_event(
        &cfg.events_dir(),
        CreateEventParams {
            title: "Flight".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(wall("2026-07-01T22:00:00")),
            end: TemporalValue::DateTime(wall("2026-07-02T06:00:00")),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/Sao_Paulo".to_string()),
            end_tzid: Some("Europe/Lisbon".to_string()),
            floating: false,
            ical_uid: None,
            description: None,
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        },
    )
    .unwrap();
    jin_core::ops::api::refresh(root).unwrap();
    event.frontmatter.id.clone()
}

// ── AC-S2-14: sparse title-only edit across the Tauri boundary ────────────────

#[test]
fn cross_zone_title_only_edit_through_the_sparse_command() {
    let root = vault("UTC");
    let id = seed_cross_zone(root.path());
    let detail = get_event_detail_fn(root.path(), id.clone()).unwrap();

    // Exactly what a migrated client sends for a rename: no temporal keys.
    let input: EditEventDeltaInput = serde_json::from_value(serde_json::json!({
        "event_id": id,
        "edit_token": detail.edit_token,
        "operation_id": "s2-tauri-sparse-title",
        "delta": { "title": "Flight (renamed)" }
    }))
    .unwrap();

    let result = edit_event_delta_fn(root.path(), input).unwrap();
    assert_eq!(result.event.title, "Flight (renamed)");
    assert_eq!(result.event.start, "2026-07-01T22:00:00");
    assert_eq!(result.event.end, "2026-07-02T06:00:00");
    assert_eq!(
        result.event.start_tzid.as_deref(),
        Some("America/Sao_Paulo")
    );
    assert_eq!(
        result.event.end_tzid.as_deref(),
        Some("Europe/Lisbon"),
        "a sparse rename must never collapse a distinct end zone"
    );
}

// ── AC-S2-16: the retained legacy adapter keeps a distinct end zone ───────────

#[test]
fn legacy_adapter_preserves_a_distinct_end_zone() {
    let root = vault("UTC");
    let id = seed_cross_zone(root.path());
    let detail = get_event_detail_fn(root.path(), id.clone()).unwrap();

    // An unmigrated caller sends the full shape with the single legacy `tzid`,
    // which equals the event's start zone — it is not asking to change zones.
    let result = edit_event_fn(
        root.path(),
        EditEventInput {
            event_id: id.clone(),
            edit_token: detail.edit_token,
            operation_id: "s2-legacy-adapter-cross-zone".to_string(),
            title: "Flight via legacy".to_string(),
            start: "2026-07-01T22:00:00".to_string(),
            end: "2026-07-02T06:00:00".to_string(),
            tzid: Some("America/Sao_Paulo".to_string()),
            is_all_day: false,
            description: None,
            location: None,
            recurrence: None,
            clear_recurrence: false,
            recurrence_scope: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
        },
    )
    .unwrap();

    assert_eq!(result.event.title, "Flight via legacy");
    assert_eq!(
        result.event.end_tzid.as_deref(),
        Some("Europe/Lisbon"),
        "the migration adapter must not clone the start zone over a distinct end zone"
    );
}

#[test]
fn legacy_adapter_still_moves_both_zones_when_the_caller_changes_the_zone() {
    let root = vault("UTC");
    let id = seed_cross_zone(root.path());
    let detail = get_event_detail_fn(root.path(), id.clone()).unwrap();

    // Here the caller genuinely changes the zone, so pre-S2 behavior stands:
    // the supplied zone applies to both endpoints.
    let result = edit_event_fn(
        root.path(),
        EditEventInput {
            event_id: id.clone(),
            edit_token: detail.edit_token,
            operation_id: "s2-legacy-adapter-zone-change".to_string(),
            title: "Flight rezoned".to_string(),
            start: "2026-07-01T22:00:00".to_string(),
            end: "2026-07-02T06:00:00".to_string(),
            tzid: Some("America/New_York".to_string()),
            is_all_day: false,
            description: None,
            location: None,
            recurrence: None,
            clear_recurrence: false,
            recurrence_scope: None,
            attendees: None,
            attendees_omitted: None,
            conference_data: None,
            clear_conference_data: false,
            reminders: None,
        },
    )
    .unwrap();

    assert_eq!(result.event.start_tzid.as_deref(), Some("America/New_York"));
    assert_eq!(result.event.end_tzid.as_deref(), Some("America/New_York"));
}

// ── AC-S2-12: partial bundles are refused at the Tauri input boundary ─────────

#[test]
fn partial_temporal_bundle_rejected_at_the_tauri_input() {
    let start_only = serde_json::from_value::<EditEventDeltaInput>(serde_json::json!({
        "event_id": "evt",
        "edit_token": "sha256:whatever",
        "operation_id": "op",
        "delta": { "temporal": { "start": "2026-07-01T09:00:00" } }
    }));
    assert!(
        start_only.is_err(),
        "a start with no end must not deserialize at the Tauri boundary"
    );

    let complete = serde_json::from_value::<EditEventDeltaInput>(serde_json::json!({
        "event_id": "evt",
        "edit_token": "sha256:whatever",
        "operation_id": "op",
        "delta": {
            "temporal": {
                "start": "2026-07-01T09:00:00",
                "end": "2026-07-01T10:00:00",
                "is_all_day": false,
                "floating": false,
                "start_tzid": "UTC",
                "end_tzid": "UTC"
            }
        }
    }));
    assert!(complete.is_ok());
}

// ── AC-S2-13: a stale token writes nothing ────────────────────────────────────

#[test]
fn stale_sparse_edit_writes_nothing() {
    let root = vault("UTC");
    let id = seed_cross_zone(root.path());
    let detail = get_event_detail_fn(root.path(), id.clone()).unwrap();

    let cfg = jin_core::Config::load(root.path()).unwrap();
    let mut changed = events::get_event(&cfg.events_dir(), &id).unwrap();
    changed.frontmatter.title = "Changed elsewhere".to_string();
    jin_core::store::fs::write_event(&cfg.events_dir(), &changed).unwrap();

    let input: EditEventDeltaInput = serde_json::from_value(serde_json::json!({
        "event_id": id,
        "edit_token": detail.edit_token,
        "operation_id": "s2-tauri-stale-sparse",
        "delta": { "title": "My draft" }
    }))
    .unwrap();

    assert!(
        edit_event_delta_fn(root.path(), input).is_err(),
        "a stale token must be refused"
    );
    let after = events::get_event(&cfg.events_dir(), &id).unwrap();
    assert_eq!(after.frontmatter.title, "Changed elsewhere");
}

// ── AC-S2-06: boundary fidelity for projection and preview ────────────────────

#[test]
fn range_projection_crosses_the_boundary_without_loss() {
    let root = vault("America/New_York");
    let id = seed_cross_zone(root.path());

    let projection = calendar_range_projection_fn(
        root.path(),
        CalendarRangeProjectionInput {
            from: "2026-07-01".to_string(),
            to: "2026-07-03".to_string(),
        },
    )
    .unwrap();

    let entry = projection
        .entries
        .iter()
        .find(|entry| entry.event_id == id)
        .unwrap();
    assert_eq!(entry.start_display, "2026-07-01T21:00:00");
    assert_eq!(entry.end_display, "2026-07-02T01:00:00");
    assert_eq!(entry.elapsed_minutes, 240);
    assert_eq!(entry.continuation_dates, vec!["2026-07-02"]);

    // The serialized form is what TypeScript actually receives; assert on it so
    // a field rename cannot silently break the mirrored TS fixture.
    let json = serde_json::to_value(&projection).unwrap();
    let serialized = json["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["event_id"] == id.as_str())
        .unwrap();
    assert_eq!(serialized["slot_state"], "anchored");
    assert_eq!(serialized["start_utc"], "2026-07-02T01:00:00Z");
    assert_eq!(serialized["end_utc"], "2026-07-02T05:00:00Z");
    assert_eq!(serialized["temporal_editable"], true);
    assert_eq!(serialized["start_tzid"], "America/Sao_Paulo");
    assert_eq!(serialized["end_tzid"], "Europe/Lisbon");
}

/// The exact fixture the TypeScript suite mirrors (AC-S2-06). Any drift here
/// or there fails one of the two sides.
#[test]
fn temporal_preview_serialization_fixture() {
    let preview = event_temporal_preview_fn(EventTemporalPreviewInput {
        start: "2026-07-01T22:00:00".to_string(),
        end: "2026-07-02T06:00:00".to_string(),
        is_all_day: false,
        floating: false,
        start_tzid: Some("America/Sao_Paulo".to_string()),
        end_tzid: Some("Europe/Lisbon".to_string()),
    });

    let json = serde_json::to_value(&preview).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["schedulable"], true);
    assert_eq!(json["start_resolution"], "exact");
    assert_eq!(json["end_resolution"], "exact");
    assert_eq!(json["start_utc"], "2026-07-02T01:00:00Z");
    assert_eq!(json["end_utc"], "2026-07-02T05:00:00Z");
    assert_eq!(json["start_display"], "2026-07-01T22:00:00");
    assert_eq!(json["end_display"], "2026-07-02T06:00:00");
    assert_eq!(json["elapsed_minutes"], 240);
    assert_eq!(json["start_tzid"], "America/Sao_Paulo");
    assert_eq!(json["end_tzid"], "Europe/Lisbon");
    assert_eq!(json["errors"].as_array().unwrap().len(), 0);

    let gap = event_temporal_preview_fn(EventTemporalPreviewInput {
        start: "2011-12-30T12:00:00".to_string(),
        end: "2011-12-30T13:00:00".to_string(),
        is_all_day: false,
        floating: false,
        start_tzid: Some("Pacific/Apia".to_string()),
        end_tzid: Some("Pacific/Apia".to_string()),
    });
    let gap_json = serde_json::to_value(&gap).unwrap();
    assert_eq!(gap_json["status"], "unresolvable_local_time");
    assert_eq!(gap_json["schedulable"], false);
    assert!(gap_json["start_utc"].is_null());
    assert_eq!(gap_json["errors"][0]["code"], "unresolvable_local_time");
}
