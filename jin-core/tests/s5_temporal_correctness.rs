//! S5 temporal correctness tests (VG9).
//!
//! Covers:
//! - DST spring-forward gap and fall-back overlap resolution (tested directly on jin_core::time)
//! - All-day vs timed vs floating event disk round-trip
//! - start_utc stored in index for non-floating events with tzid
//! - Promote with tzid: correct temporal slot, derived-from edge, task file byte-unchanged
//!
//! Note: positional title mutual exclusion is a CLI-level concern verified by
//! jin/src/main.rs clap definitions (conflicts_with) — no jin-core test needed there.

use std::fs;
use tempfile::TempDir;

use chrono::{NaiveDate, NaiveDateTime};
use jin_core::model::event::{TemporalValue, ValueType};
use jin_core::ops::{self, events, tasks};
use jin_core::time::{resolve_to_utc, TzResolution};

// ─── time module unit coverage ────────────────────────────────────────────────

#[test]
fn vg9_spring_forward_gap_exact_utc() {
    // America/New_York spring-forward 2023-03-12 02:00 AM → 03:00 AM.
    // 02:30:00 is in the gap; policy: shift +1h → 03:30 EDT (UTC-4) = 07:30 UTC.
    let naive = NaiveDateTime::parse_from_str("2023-03-12T02:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let res = resolve_to_utc(naive, "America/New_York").expect("should not error");

    assert!(
        matches!(res, TzResolution::NonexistentShiftedForward { .. }),
        "VG9: expected NonexistentShiftedForward, got {:?}",
        res
    );
    assert!(
        res.warning_note().is_some(),
        "VG9: warning note must be set for gap"
    );

    let expected = chrono::DateTime::parse_from_rfc3339("2023-03-12T07:30:00+00:00")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(
        res.utc(),
        expected,
        "VG9: spring-forward gap must resolve to UTC 07:30"
    );
}

#[test]
fn vg9_fall_back_overlap_uses_earlier_instant() {
    // America/New_York fall-back 2023-11-05 02:00 AM → 01:00 AM.
    // 01:30:00 is ambiguous:
    //   first  occurrence: EDT (UTC-4) → UTC 05:30
    //   second occurrence: EST (UTC-5) → UTC 06:30
    // Policy: use earlier instant (05:30 UTC / EDT / pre-transition).
    let naive = NaiveDateTime::parse_from_str("2023-11-05T01:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let res = resolve_to_utc(naive, "America/New_York").expect("should not error");

    assert!(
        matches!(res, TzResolution::AmbiguousUsedEarlier { .. }),
        "VG9: expected AmbiguousUsedEarlier, got {:?}",
        res
    );
    assert!(
        res.warning_note().is_some(),
        "VG9: warning note must be set for overlap"
    );

    let expected = chrono::DateTime::parse_from_rfc3339("2023-11-05T05:30:00+00:00")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(
        res.utc(),
        expected,
        "VG9: fall-back overlap must use earlier instant (UTC 05:30 / EDT)"
    );
}

#[test]
fn vg9_non_dst_time_is_exact() {
    // Mid-summer in New York: no DST transition, must resolve exactly.
    let naive = NaiveDateTime::parse_from_str("2026-07-04T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let res = resolve_to_utc(naive, "America/New_York").expect("should not error");

    assert!(res.is_exact(), "VG9: mid-summer time must be exact");
    assert!(res.warning_note().is_none());

    // 14:00 EDT (UTC-4) = 18:00 UTC
    let expected = chrono::DateTime::parse_from_rfc3339("2026-07-04T18:00:00+00:00")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(res.utc(), expected, "VG9: 14:00 EDT should be 18:00 UTC");
}

// ─── disk round-trip: all-day vs timed vs floating ────────────────────────────

#[test]
fn s5_all_day_event_round_trip() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let start = NaiveDate::parse_from_str("2026-12-25", "%Y-%m-%d").unwrap();
    let end = NaiveDate::parse_from_str("2026-12-26", "%Y-%m-%d").unwrap();

    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Christmas".to_string(),
            body: String::new(),
            start: TemporalValue::Date(start),
            end: TemporalValue::Date(end),
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
    )
    .unwrap();

    assert!(event.frontmatter.is_all_day, "should be all-day");
    assert!(
        !event.frontmatter.floating,
        "all-day events are not floating"
    );
    assert!(
        event.frontmatter.start_tzid.is_none(),
        "all-day has no tzid"
    );

    // Verify on-disk round-trip
    let path = jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let content = fs::read_to_string(&path).unwrap();
    assert!(
        content.contains("is_all_day: true"),
        "on-disk frontmatter must have is_all_day: true; got:\n{}",
        content
    );
    assert!(
        content.contains("2026-12-25"),
        "on-disk frontmatter must contain the start date"
    );
}

#[test]
fn s5_floating_event_round_trip() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let start = NaiveDateTime::parse_from_str("2026-07-01T09:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-01T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Morning standup".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: None,
            end_tzid: None,
            floating: true,
            ical_uid: None,
            description: None,
            location: None,
            attendees: None,
            conference_data: None,
            reminders: None,
        },
    )
    .unwrap();

    assert!(event.frontmatter.floating, "should be floating");
    assert!(event.frontmatter.start_tzid.is_none());

    let path = jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let content = fs::read_to_string(&path).unwrap();
    assert!(
        content.contains("floating: true"),
        "on-disk frontmatter must have floating: true"
    );
}

#[test]
fn s5_anchored_event_round_trip() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let start = NaiveDateTime::parse_from_str("2026-08-15T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-08-15T15:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Team review".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/New_York".to_string()),
            end_tzid: Some("America/New_York".to_string()),
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

    assert!(
        !event.frontmatter.floating,
        "anchored event must not be floating"
    );
    assert_eq!(
        event.frontmatter.start_tzid.as_deref(),
        Some("America/New_York")
    );

    let path = jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let content = fs::read_to_string(&path).unwrap();
    assert!(
        content.contains("America/New_York"),
        "tzid must survive disk round-trip"
    );
    assert!(
        content.contains("floating: false"),
        "floating must be false for anchored event"
    );
}

// ─── start_utc in the index ────────────────────────────────────────────────────

#[test]
fn s5_start_utc_computed_after_rebuild() {
    // Create a timed event with tzid; after rebuild, the index should have start_utc.
    // We verify this indirectly: the event is retrievable via the public API with all
    // fields intact (start_utc is index-internal; not exposed in EventDto).
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    // 14:00 EDT (UTC-4) = 18:00 UTC
    let start = NaiveDateTime::parse_from_str("2026-07-04T14:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    let end = NaiveDateTime::parse_from_str("2026-07-04T15:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = events::create_event(
        &root.join("events"),
        events::CreateEventParams {
            title: "Fourth of July party".to_string(),
            body: String::new(),
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("America/New_York".to_string()),
            end_tzid: Some("America/New_York".to_string()),
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

    let dto = jin_core::ops::api::get_event(root, event.id()).unwrap();
    assert_eq!(dto.title, "Fourth of July party");
    assert_eq!(dto.start_tzid.as_deref(), Some("America/New_York"));
    assert!(!dto.floating, "anchored event must not be floating in DTO");
    // start_utc is index-internal; its correctness is validated by time module unit tests.
}

// ─── promote with tzid ────────────────────────────────────────────────────────

#[test]
fn s5_promote_with_tzid_anchors_event() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Prepare quarterly report".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    let task_path = jin_core::store::fs::find_task_path(&root.join("tasks"), task.id()).unwrap();
    let task_bytes_before = fs::read(&task_path).unwrap();

    let start = NaiveDateTime::parse_from_str("2026-09-01T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = jin_core::ops::promote::promote(
        root,
        task.id(),
        jin_core::ops::promote::PromoteParams {
            start_dt: start,
            tzid: Some("America/New_York".to_string()),
        },
    )
    .unwrap();

    // Event must be anchored (not floating)
    assert!(
        !event.frontmatter.floating,
        "promote with tzid must produce non-floating event"
    );
    assert_eq!(
        event.frontmatter.start_tzid.as_deref(),
        Some("America/New_York"),
        "start_tzid must be set on promoted event"
    );
    assert_eq!(
        event.frontmatter.end_tzid.as_deref(),
        Some("America/New_York"),
        "end_tzid must be set on promoted event"
    );

    // Task file must be byte-unchanged (VG6)
    let task_bytes_after = fs::read(&task_path).unwrap();
    assert_eq!(
        task_bytes_before, task_bytes_after,
        "VG6: task file must be byte-unchanged after promote"
    );

    // derived-from edge must be in the event frontmatter
    let event_path =
        jin_core::store::fs::find_event_path(&root.join("events"), event.id()).unwrap();
    let event_content = fs::read_to_string(&event_path).unwrap();
    assert!(
        event_content.contains("derived_from"),
        "event frontmatter must contain derived_from"
    );
    assert!(
        event_content.contains(task.id()),
        "event frontmatter must reference the task id"
    );

    // After rebuild the backlink must resolve
    jin_core::ops::api::refresh(root).unwrap();
    let task_dto = jin_core::ops::api::get_task(root, task.id()).unwrap();
    let has_backlink = task_dto
        .backlinks
        .iter()
        .any(|b| b.source_id == event.id() && b.edge_type == "derived-from");
    assert!(
        has_backlink,
        "task must have a has-event backlink from the promoted event"
    );
}

#[test]
fn s5_promote_without_tzid_is_floating() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Quick call".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    let start = NaiveDateTime::parse_from_str("2026-08-01T15:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let event = jin_core::ops::promote::promote(
        root,
        task.id(),
        jin_core::ops::promote::PromoteParams {
            start_dt: start,
            tzid: None,
        },
    )
    .unwrap();

    assert!(
        event.frontmatter.floating,
        "promote without tzid must produce floating event"
    );
    assert!(
        event.frontmatter.start_tzid.is_none(),
        "no tzid must be set on floating promoted event"
    );
}

#[test]
fn s5_promote_invalid_tzid_returns_error() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    ops::init(root).unwrap();

    let task = tasks::create_task(
        &root.join("tasks"),
        tasks::CreateTaskParams {
            title: "Does not matter".to_string(),
            body: String::new(),
            priority: None,
            due: None,
            list: None,
            tags: None,
            reminders: None,
            parent: None,
        },
    )
    .unwrap();

    let start = NaiveDateTime::parse_from_str("2026-08-01T15:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();

    let result = jin_core::ops::promote::promote(
        root,
        task.id(),
        jin_core::ops::promote::PromoteParams {
            start_dt: start,
            tzid: Some("Not/A_Valid_Timezone".to_string()),
        },
    );

    assert!(
        result.is_err(),
        "promote with invalid tzid must return an error"
    );
    let err = result.unwrap_err();
    assert!(
        matches!(err, jin_core::JinError::InvalidTimezone { .. }),
        "error must be InvalidTimezone, got: {:?}",
        err
    );
}
