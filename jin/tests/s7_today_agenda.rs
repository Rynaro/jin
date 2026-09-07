//! S7 — `jin today` merged agenda: shipped-path integration tests.
//!
//! All tests drive the real `jin` binary via `env!("CARGO_BIN_EXE_jin")` so
//! the full CLI path is exercised (not just `api::agenda_for_date`).
//!
//! ## Isolation discipline
//! * Each test uses a fresh `TempDir` root — no shared state.
//! * `token_backend = "file"` is forced in every root so the subprocess never
//!   touches the OS keyring (prevents races with a developer's real session).
//! * Google-source events are seeded by writing directly to the `events/`
//!   directory using `jin_core` model types and `store::fs::write_event`, then
//!   calling `jin_core::ops::api::refresh` to rebuild the index.  This avoids
//!   starting a real sync while still exercising the full merged view.
//! * No `std::env::set_var / remove_var` calls — no new global env mutation.
//!
//! ## Coverage
//! 1. `s7_both_sources_appear_time_sorted`            — jin + google, merged, sorted
//! 2. `s7_promoted_event_shows_originating_task`      — derived_from → task reachable
//! 3. `s7_prep_note_surfaced_on_event`                — prep-for backlink → note reachable
//! 4. `s7_all_day_event_in_correct_bucket`            — all-day bucket / display_start
//! 5. `s7_recurring_unexpanded_event_flagged`         — recurrence_unexpanded flag + label
//! 6. `s7_empty_day_exits_0_with_clean_message`       — exit 0, "nothing scheduled"
//! 7. `s7_tz_correct_ordering_across_timezones`       — cross-tz sort + display_start
//! 8. `s7_human_mode_renders_task_and_note_links`     — human rendering: task+prep labels

use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

// ─── helpers ──────────────────────────────────────────────────────────────────

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// Initialise a fresh jin root with `token_backend = "file"` so the subprocess
/// never touches the OS keyring.
fn make_isolated_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let out = Command::new(jin_bin())
        .args(["--root", root.to_str().unwrap(), "--json", "init"])
        .output()
        .expect("failed to spawn jin init");
    assert!(out.status.success(), "jin init failed");

    // Force file backend to avoid keyring races.
    let mut cfg = jin_core::Config::load(root).expect("config must exist after init");
    cfg.token_backend = "file".to_string();
    cfg.save().expect("config must be saveable");

    tmp
}

/// Run `jin --root <root> --json <args…>` and return the parsed JSON envelope.
/// Panics with stderr on non-zero exit.
fn run_json(root: &Path, args: &[&str]) -> Value {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    if !out.status.success() {
        panic!(
            "jin exited {}\nargs: {:?}\nstderr: {}",
            out.status,
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "invalid JSON from jin: {}\nraw: {}",
            e,
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

/// Run `jin --root <root> <args…>` in human mode.
/// Returns `(exit_code, stdout, stderr)`.
fn run_human(root: &Path, args: &[&str]) -> (i32, String, String) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root);
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    )
}

/// Extract `.data` from the versioned envelope.
fn data(v: &Value) -> &Value {
    v.get("data").expect("envelope must have 'data' field")
}

/// Seed a Google-source event by writing directly to the `events/` directory,
/// then rebuilding the index.  This is the only way to create a `source=google`
/// event without running a full sync cycle.
///
/// Returns the event's ULID.
fn seed_google_event(
    root: &Path,
    title: &str,
    date: &str,      // YYYY-MM-DD
    wall_time: &str, // HH:MM:SS
    tzid: &str,
) -> String {
    use chrono::NaiveDateTime;
    use jin_core::id::new_ulid;
    use jin_core::model::event::{
        Event, EventFrontmatter, EventSource, EventStatus, TemporalValue, ValueType,
    };
    use jin_core::store::fs::write_event;

    let id = new_ulid();
    let now = chrono::Local::now().fixed_offset();
    let start_str = format!("{}T{}", date, wall_time);
    let start_dt =
        NaiveDateTime::parse_from_str(&start_str, "%Y-%m-%dT%H:%M:%S").expect("valid datetime");
    // End = start + 1 hour (parse directly to avoid Duration import variance).
    let end_str = if wall_time.starts_with("23") {
        // Wrap into next day to keep things simple in tests that use late times.
        format!("{}T{}", date, "23:59:59")
    } else {
        let h: u32 = wall_time[..2].parse().unwrap_or(0);
        format!(
            "{}T{:02}:{}:{}",
            date,
            h + 1,
            &wall_time[3..5],
            &wall_time[6..8]
        )
    };
    let end_dt = NaiveDateTime::parse_from_str(&end_str, "%Y-%m-%dT%H:%M:%S").unwrap_or(start_dt);

    let fm = EventFrontmatter {
        id: id.clone(),
        kind: "event".to_string(),
        title: title.to_string(),
        description: None,
        location: None,
        start: TemporalValue::DateTime(start_dt),
        end: TemporalValue::DateTime(end_dt),
        start_value_type: ValueType::DateTime,
        end_value_type: ValueType::DateTime,
        is_all_day: false,
        start_tzid: Some(tzid.to_string()),
        end_tzid: Some(tzid.to_string()),
        floating: false,
        recurrence: vec![],
        recurring_event_id: None,
        original_start: None,
        master_id: None,
        recurrence_unexpanded: false,
        ical_uid: Some(format!("{}@google.com", id.to_lowercase())),
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
        source: EventSource::Google,
        authority: EventSource::Google,
        calendar_id: "primary".to_string(),
        derived_from: None,
    };
    let event = Event {
        frontmatter: fm,
        body: String::new(),
    };
    write_event(&root.join("events"), &event).expect("write google event");
    jin_core::ops::api::refresh(root).expect("refresh after seeding google event");
    id
}

// ─── tests ────────────────────────────────────────────────────────────────────

/// AC-1: Both source=jin and source=google events appear in a single merged
/// view, sorted by start time.
#[test]
fn s7_both_sources_appear_time_sorted() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // Google event at 09:00 UTC on 2026-07-01.
    seed_google_event(root, "Stand-up", "2026-07-01", "09:00:00", "UTC");

    // Jin event at 10:00 UTC on 2026-07-01 (via CLI).
    run_json(
        root,
        &[
            "event",
            "add",
            "Doctor appointment",
            "--start",
            "2026-07-01T10:00:00",
            "--end",
            "2026-07-01T10:30:00",
            "--tz",
            "UTC",
        ],
    );

    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);

    assert_eq!(d["date"].as_str().unwrap(), "2026-07-01");

    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");
    assert_eq!(
        timed.len(),
        2,
        "both source=jin and source=google must appear"
    );

    // Time-sorted: Stand-up (09:00) before Doctor (10:00).
    assert_eq!(
        timed[0]["title"].as_str().unwrap(),
        "Stand-up",
        "google event at 09:00 must come first"
    );
    assert_eq!(timed[0]["source"].as_str().unwrap(), "google");
    assert_eq!(
        timed[1]["title"].as_str().unwrap(),
        "Doctor appointment",
        "jin event at 10:00 must come second"
    );
    assert_eq!(timed[1]["source"].as_str().unwrap(), "jin");
}

/// AC-3 (promoted event): `originating_task` is resolved and reachable.
#[test]
fn s7_promoted_event_shows_originating_task() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // Create a task, then promote it to an event on 2026-07-01.
    let task_env = run_json(root, &["task", "add", "Book dentist checkup"]);
    let task_id = data(&task_env)["id"].as_str().unwrap().to_string();
    let task_title = data(&task_env)["title"].as_str().unwrap().to_string();

    run_json(
        root,
        &[
            "promote",
            &task_id,
            "--when",
            "2026-07-01T14:00:00",
            "--tz",
            "UTC",
        ],
    );

    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);
    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");

    assert_eq!(timed.len(), 1);
    let ev = &timed[0];

    assert!(
        !ev["originating_task"].is_null(),
        "originating_task must be present for a promoted event"
    );
    assert_eq!(
        ev["originating_task"]["id"].as_str().unwrap(),
        task_id,
        "originating_task id must match the source task"
    );
    assert_eq!(
        ev["originating_task"]["title"].as_str().unwrap(),
        task_title,
        "originating_task title must match the source task"
    );
    // derived_from (raw) must also be set.
    assert_eq!(ev["derived_from"].as_str().unwrap(), task_id);
}

/// AC-2 (prep-for note): `prep_notes` is populated and reachable.
#[test]
fn s7_prep_note_surfaced_on_event() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // Create an event, a note, then attach the note to the event.
    let event_env = run_json(
        root,
        &[
            "event",
            "add",
            "Doctor appointment",
            "--start",
            "2026-07-01T14:00:00",
            "--end",
            "2026-07-01T14:30:00",
            "--tz",
            "UTC",
        ],
    );
    let event_id = data(&event_env)["id"].as_str().unwrap().to_string();

    let note_env = run_json(root, &["note", "add", "Pre-appointment checklist"]);
    let note_id = data(&note_env)["id"].as_str().unwrap().to_string();

    // attach defaults to prep-for for an event target.
    run_json(root, &["attach", &note_id, &event_id]);

    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);
    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");

    assert_eq!(timed.len(), 1);
    let ev = &timed[0];

    let prep_notes = ev["prep_notes"]
        .as_array()
        .expect("prep_notes must be an array");
    assert!(
        !prep_notes.is_empty(),
        "prep_notes must be non-empty after attaching a note"
    );
    assert_eq!(
        prep_notes[0]["id"].as_str().unwrap(),
        note_id,
        "prep_note id must match the attached note"
    );
    assert_eq!(
        prep_notes[0]["title"].as_str().unwrap(),
        "Pre-appointment checklist"
    );
}

/// AC (all-day): All-day event appears in `all_day_events`, not `timed_events`.
#[test]
fn s7_all_day_event_in_correct_bucket() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    run_json(
        root,
        &[
            "event",
            "add",
            "Conference Day",
            "--start",
            "2026-07-01",
            "--end",
            "2026-07-02",
            "--all-day",
        ],
    );

    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);

    let all_day = d["all_day_events"]
        .as_array()
        .expect("all_day_events must be an array");
    assert_eq!(
        all_day.len(),
        1,
        "all-day event must appear in all_day_events"
    );
    assert_eq!(all_day[0]["title"].as_str().unwrap(), "Conference Day");
    assert!(
        all_day[0]["is_all_day"].as_bool().unwrap(),
        "is_all_day must be true"
    );
    assert_eq!(
        all_day[0]["display_start"].as_str().unwrap(),
        "all-day",
        "display_start for all-day events must be 'all-day'"
    );

    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");
    assert!(
        timed.is_empty(),
        "all-day event must not appear in timed_events"
    );
}

/// AC-4 (recurring unexpanded): Flagged with `recurrence_unexpanded = true`
/// and labelled "recurring" in human output.
#[test]
fn s7_recurring_unexpanded_event_flagged() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // Write a recurring Google event directly (recurrence_unexpanded=true).
    {
        use chrono::NaiveDateTime;
        use jin_core::id::new_ulid;
        use jin_core::model::event::{
            Event, EventFrontmatter, EventSource, EventStatus, TemporalValue, ValueType,
        };
        use jin_core::store::fs::write_event;

        let id = new_ulid();
        let now = chrono::Local::now().fixed_offset();
        let start =
            NaiveDateTime::parse_from_str("2026-07-01T10:00:00", "%Y-%m-%dT%H:%M:%S").unwrap();
        let end =
            NaiveDateTime::parse_from_str("2026-07-01T10:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();

        let fm = EventFrontmatter {
            id: id.clone(),
            kind: "event".to_string(),
            title: "Weekly Stand-up".to_string(),
            description: None,
            location: None,
            start: TemporalValue::DateTime(start),
            end: TemporalValue::DateTime(end),
            start_value_type: ValueType::DateTime,
            end_value_type: ValueType::DateTime,
            is_all_day: false,
            start_tzid: Some("UTC".to_string()),
            end_tzid: Some("UTC".to_string()),
            floating: false,
            recurrence: vec!["RRULE:FREQ=WEEKLY;BYDAY=WE".to_string()],
            recurring_event_id: None,
            original_start: None,
            master_id: None,
            recurrence_unexpanded: true,
            ical_uid: Some(format!("{}@google.com", id.to_lowercase())),
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
            source: EventSource::Google,
            authority: EventSource::Google,
            calendar_id: "primary".to_string(),
            derived_from: None,
        };
        let event = Event {
            frontmatter: fm,
            body: String::new(),
        };
        write_event(&root.join("events"), &event).unwrap();
        jin_core::ops::api::refresh(root).unwrap();
    }

    // JSON mode: flag must be set.
    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);
    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");
    assert_eq!(timed.len(), 1, "recurring event must appear");
    assert!(
        timed[0]["recurrence_unexpanded"].as_bool().unwrap_or(false),
        "recurrence_unexpanded must be true"
    );

    // Human mode: must label the event as recurring.
    let (code, stdout, _) = run_human(root, &["today", "--date", "2026-07-01"]);
    assert_eq!(code, 0, "exit code must be 0");
    assert!(
        stdout.contains("recurring"),
        "human output must label the event as 'recurring'; got:\n{}",
        stdout
    );
}

/// AC (empty day): `jin today` on a date with no events exits 0 and prints
/// "nothing scheduled".
#[test]
fn s7_empty_day_exits_0_with_clean_message() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // JSON mode: both buckets empty.
    let env = run_json(root, &["today", "--date", "2099-01-01"]);
    let d = data(&env);
    assert!(
        d["all_day_events"].as_array().unwrap().is_empty(),
        "all_day_events must be empty for an empty day"
    );
    assert!(
        d["timed_events"].as_array().unwrap().is_empty(),
        "timed_events must be empty for an empty day"
    );

    // Human mode: clean message + exit 0.
    let (code, stdout, _) = run_human(root, &["today", "--date", "2099-01-01"]);
    assert_eq!(code, 0, "exit code must be 0 for an empty day");
    assert!(
        stdout.contains("nothing scheduled"),
        "must print 'nothing scheduled' for an empty day; got:\n{}",
        stdout
    );
}

/// AC (timezone-correct ordering): Events from different source timezones are
/// converted to the display timezone for date filtering and sort ordering.
///
/// Setup (display_tz = UTC):
/// - Event A: 2026-07-01T02:00:00 UTC, display_start = 02:00
/// - Event B: 2026-07-01T14:00:00 America/New_York (UTC-4 summer = 18:00 UTC),
///   display_start = 18:00
///
/// Both fall on 2026-07-01 in UTC; Event A must sort before Event B.
#[test]
fn s7_tz_correct_ordering_across_timezones() {
    let tmp = make_isolated_root();
    let root = tmp.path();
    // display_tz is "UTC" by default (from Config::new).

    // Event A: 02:00 UTC.
    seed_google_event(root, "Early UTC event", "2026-07-01", "02:00:00", "UTC");

    // Event B: 14:00 America/New_York (EDT, UTC-4) = 18:00 UTC.
    seed_google_event(
        root,
        "Afternoon NY event",
        "2026-07-01",
        "14:00:00",
        "America/New_York",
    );

    let env = run_json(root, &["today", "--date", "2026-07-01"]);
    let d = data(&env);
    let timed = d["timed_events"]
        .as_array()
        .expect("timed_events must be an array");

    assert_eq!(
        timed.len(),
        2,
        "both events must fall on 2026-07-01 in UTC display_tz"
    );
    // Sorted by UTC: 02:00 before 18:00.
    assert_eq!(
        timed[0]["title"].as_str().unwrap(),
        "Early UTC event",
        "02:00 UTC must sort before 18:00 UTC"
    );
    assert_eq!(
        timed[0]["display_start"].as_str().unwrap(),
        "02:00",
        "display_start must be 02:00 in UTC display_tz"
    );
    assert_eq!(
        timed[1]["title"].as_str().unwrap(),
        "Afternoon NY event",
        "18:00 UTC must sort after 02:00 UTC"
    );
    assert_eq!(
        timed[1]["display_start"].as_str().unwrap(),
        "18:00",
        "display_start for 14:00 NY must be 18:00 in UTC display_tz"
    );
}

/// Human mode renders task and note links for a promoted event with a prep note.
/// This validates the full hero-view integration: event → task → note all reachable.
#[test]
fn s7_human_mode_renders_task_and_note_links() {
    let tmp = make_isolated_root();
    let root = tmp.path();

    // Create task + promote.
    let task_env = run_json(root, &["task", "add", "Sprint planning session"]);
    let task_id = data(&task_env)["id"].as_str().unwrap().to_string();
    run_json(
        root,
        &[
            "promote",
            &task_id,
            "--when",
            "2026-07-01T09:00:00",
            "--tz",
            "UTC",
        ],
    );

    // Get the promoted event's id via `event list`.
    let events_env = run_json(root, &["event", "list"]);
    let events = data(&events_env)
        .as_array()
        .expect("event list must return array");
    assert_eq!(events.len(), 1, "should have exactly one event");
    let event_id = events[0]["id"].as_str().unwrap().to_string();

    // Create note + attach (prep-for).
    let note_env = run_json(root, &["note", "add", "Sprint prep notes"]);
    let note_id = data(&note_env)["id"].as_str().unwrap().to_string();
    run_json(root, &["attach", &note_id, &event_id]);

    let (code, stdout, _) = run_human(root, &["today", "--date", "2026-07-01"]);
    assert_eq!(code, 0);

    assert!(
        stdout.contains("Sprint planning session"),
        "must show event title; got:\n{}",
        stdout
    );
    assert!(
        stdout.contains("task:"),
        "must show originating task label; got:\n{}",
        stdout
    );
    assert!(
        stdout.contains(&task_id),
        "must show task id so user can run `jin task show <id>`; got:\n{}",
        stdout
    );
    assert!(
        stdout.contains("prep:"),
        "must show prep note label; got:\n{}",
        stdout
    );
    assert!(
        stdout.contains(&note_id),
        "must show note id so user can run `jin note show <id>`; got:\n{}",
        stdout
    );
}
