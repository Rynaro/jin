//! S7 — Merged day agenda.
//!
//! `agenda_for_date` produces a timezone-correct, merged day view of all events
//! (both `source=jin` and `source=google`) for a target date.
//!
//! For every event it resolves the integration links:
//!   * originating task via the `derived_from` field (event was promoted from a task)
//!   * prep notes via `prep-for` backlinks (notes attached to the event)
//!
//! ## Timezone / DST policy
//!
//! Date filtering and sorting reuse the S5 `time::resolve_to_utc` module, which
//! handles `chrono-tz` `Ambiguous` / `None` cases explicitly (VG9).  No
//! `.unwrap()` on `LocalResult`.
//!
//! | Event type       | Date check                                               |
//! |---|---|
//! | All-day          | Compare `NaiveDate` directly                             |
//! | Floating         | Compare wall-time date (no tzid)                         |
//! | Timed + tzid     | Resolve wall-time → UTC → display_tz → compare date     |
//!
//! Sort order for timed events is by UTC timestamp (ascending); all-day events
//! are in a separate bucket sorted by date then title.

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};
use chrono_tz::Tz;
use std::collections::HashSet;
use std::path::Path;
use std::str::FromStr;

use crate::dto::agenda::{
    AgendaDto, AgendaEventDto, AgendaTaskDto, LinkedNoteRef, LinkedTaskRef, TodayFocusEventDto,
    TodayProjectionDto,
};
use crate::index::query::EventRow;
use crate::index::{self, query};
use crate::{Config, JinError, Result};

// ── Public entry point ────────────────────────────────────────────────────────

/// Build the merged day agenda for `date`, or "today" in the display timezone
/// when `date` is `None`.
///
/// Both `source=jin` and `source=google` events are included.  Events are
/// filtered by the target date in `config.display_tz`; timed events are sorted
/// by their UTC start time so cross-timezone ordering is correct.
pub fn agenda_for_date(root: &Path, date: Option<NaiveDate>) -> Result<AgendaDto> {
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    agenda_and_rows_from_connection(&cfg, &conn, date).map(|(agenda, _)| agenda)
}

/// Internal shared agenda builder. The Today projection uses this with its
/// task query on the same recovered SQLite connection. The returned matching
/// rows are also reused by focus so focus cannot reference a different event
/// set from the visible agenda.
fn agenda_and_rows_from_connection(
    cfg: &Config,
    conn: &rusqlite::Connection,
    date: Option<NaiveDate>,
) -> Result<(AgendaDto, Vec<EventRow>)> {
    let sync_conn = crate::sync::state::open_sync_db(&cfg.sync_dir()).ok();

    let display_tz_str = cfg.display_tz.clone();

    // Determine target date in the display timezone.
    let target_date = date.unwrap_or_else(|| match Tz::from_str(&display_tz_str) {
        Ok(tz) => Utc::now().with_timezone(&tz).date_naive(),
        Err(_) => Utc::now().date_naive(),
    });

    // Fetch all non-cancelled events from the index.
    let rows = query::list_events(conn, false).map_err(JinError::Index)?;

    // Filter to events that start on the target date in the display timezone.
    let matching: Vec<EventRow> = rows
        .into_iter()
        .filter(|e| event_falls_on_date(e, &target_date, &display_tz_str))
        .collect();

    let mut all_day: Vec<(String, AgendaEventDto)> = Vec::new();
    let mut timed: Vec<(i64, AgendaEventDto)> = Vec::new();

    for row in &matching {
        // Resolve index-derived backlinks for this event.
        let backlinks = query::get_backlinks(conn, &row.id).map_err(JinError::Index)?;

        // Originating task: event was promoted from a task (derived_from edge).
        let originating_task = if let Some(ref task_id) = row.derived_from {
            query::get_task(conn, task_id)
                .map_err(JinError::Index)?
                .map(|t| LinkedTaskRef {
                    id: t.id,
                    title: t.title,
                })
        } else {
            None
        };

        // Prep notes: notes that have a `prep-for` backlink pointing to this event.
        let mut prep_notes: Vec<LinkedNoteRef> = Vec::new();
        for bl in backlinks
            .iter()
            .filter(|b| b.edge_type == "prep-for" && b.source_kind == "note")
        {
            if let Ok(Some(note)) = query::get_note(conn, &bl.source_id) {
                prep_notes.push(LinkedNoteRef {
                    id: note.id,
                    title: note.title,
                });
            }
        }

        let display_start = compute_display_start(row, &display_tz_str);
        let sort_key = event_sort_key_utc(row, &display_tz_str);

        let sync_context = sync_conn.as_ref().and_then(|sync_conn| {
            let destination = crate::sync::state::latest_destination_for_jin_id(sync_conn, &row.id)
                .ok()
                .flatten()?;
            let state = crate::sync::state::list_route_outbox(sync_conn, &destination, "pending")
                .map(|items| {
                    if items.iter().any(|item| item.jin_id == row.id) {
                        "pending"
                    } else {
                        "synced"
                    }
                })
                .unwrap_or("unknown");
            crate::dto::google::event_context(
                &cfg.google_registry,
                &destination.account_id,
                &destination.calendar_id,
                state,
            )
        });

        let dto = AgendaEventDto {
            id: row.id.clone(),
            title: row.title.clone(),
            start: row.start.clone(),
            end: row.end_time.clone(),
            is_all_day: row.is_all_day,
            start_tzid: row.start_tzid.clone(),
            floating: row.floating,
            status: row.status.clone(),
            source: row.source.clone(),
            authority: row.authority.clone(),
            ical_uid: row.ical_uid.clone(),
            derived_from: row.derived_from.clone(),
            recurrence_unexpanded: row.recurrence_unexpanded,
            created: row.created.clone(),
            updated: row.updated.clone(),
            display_start,
            originating_task,
            prep_notes,
            sync_context,
        };

        if row.is_all_day {
            all_day.push((row.start.clone(), dto));
        } else {
            timed.push((sort_key, dto));
        }
    }

    // All-day: sort by date string then title (both stable/deterministic).
    all_day.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.title.cmp(&b.1.title)));
    // Timed: sort by UTC timestamp (ascending) for correct cross-timezone ordering.
    timed.sort_by_key(|(k, _)| *k);

    Ok((
        AgendaDto {
            date: target_date.to_string(),
            display_tz: display_tz_str,
            all_day_events: all_day.into_iter().map(|(_, d)| d).collect(),
            timed_events: timed.into_iter().map(|(_, d)| d).collect(),
        },
        matching,
    ))
}

/// Build the backend-authoritative projection consumed by the connected Today
/// desk. `AgendaDto` intentionally remains a separate stable legacy contract.
pub fn today_projection_for_date(
    root: &Path,
    date: Option<NaiveDate>,
) -> Result<TodayProjectionDto> {
    today_projection_for_date_at(root, date, Utc::now())
}

/// Deterministic seam for Today projection tests. All calendar-date decisions
/// use the configured display timezone; no host-local clock participates.
pub fn today_projection_for_date_at(
    root: &Path,
    date: Option<NaiveDate>,
    now_utc: DateTime<Utc>,
) -> Result<TodayProjectionDto> {
    let cfg = Config::load(root)?;
    let display_tz_str = cfg.display_tz.clone();
    let display_tz = Tz::from_str(&display_tz_str).ok();
    let current_date = display_tz
        .map(|tz| now_utc.with_timezone(&tz).date_naive())
        .unwrap_or_else(|| now_utc.date_naive());
    let selected_date = date.unwrap_or(current_date);

    // Keep event semantics exactly aligned with the existing agenda path.
    let mut conn = index::open(&cfg.index_path())?;
    // One read transaction makes agenda events, task lanes, relationships, and
    // focus a single coherent index snapshot.
    let tx = conn.transaction().map_err(JinError::Index)?;
    let (agenda, focus_rows) = agenda_and_rows_from_connection(&cfg, &tx, Some(selected_date))?;
    let is_current_date = selected_date == current_date;
    let represented: HashSet<&str> = agenda
        .all_day_events
        .iter()
        .chain(agenda.timed_events.iter())
        .filter_map(|event| event.originating_task.as_ref().map(|task| task.id.as_str()))
        .collect();

    let tasks = query::list_tasks(&tx, None, None, None, true).map_err(JinError::Index)?;
    let mut attention = Vec::new();
    let mut due = Vec::new();
    let mut flexible = Vec::new();

    for task in tasks {
        if !matches!(task.status.as_str(), "todo" | "doing") || task.deleted_at.is_some() {
            continue;
        }
        if represented.contains(task.id.as_str()) {
            continue;
        }
        let due_kind = parse_task_due(task.due.as_deref(), &display_tz_str);
        // Any supplied but unparsable due value fails closed rather than gaining
        // an arbitrary lane through its flexible marker.
        if task.due.is_some() && due_kind.is_none() {
            continue;
        }
        let dto = agenda_task_from_row(&task);
        if is_current_date && due_is_attention(due_kind.as_ref(), current_date, now_utc) {
            attention.push(dto);
        } else if due_is_on_date(due_kind.as_ref(), selected_date) {
            due.push(dto);
        } else if is_current_date && task.agenda_bucket.as_deref() == Some("flexible") {
            flexible.push(dto);
        }
    }

    sort_agenda_tasks(&mut attention);
    sort_agenda_tasks(&mut due);
    flexible.sort_by(|a, b| {
        a.position
            .cmp(&b.position)
            .then(a.title.cmp(&b.title))
            .then(a.id.cmp(&b.id))
    });

    let (active_events, next_event) = if is_current_date {
        project_focus(&focus_rows, now_utc, &display_tz_str)
    } else {
        (Vec::new(), None)
    };

    tx.commit().map_err(JinError::Index)?;
    Ok(TodayProjectionDto {
        agenda,
        current_date: current_date.to_string(),
        is_current_date,
        attention_tasks: attention,
        due_tasks: due,
        flexible_tasks: flexible,
        active_events,
        next_event,
        generated_at_utc: now_utc.to_rfc3339(),
    })
}

#[derive(Debug, Clone)]
enum TaskDue {
    Date(NaiveDate),
    Instant(DateTime<Utc>, NaiveDate),
}

fn parse_task_due(value: Option<&str>, display_tz: &str) -> Option<TaskDue> {
    let value = value?;
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Some(TaskDue::Date(date));
    }
    let instant = DateTime::parse_from_rfc3339(value)
        .ok()?
        .with_timezone(&Utc);
    let local_date = Tz::from_str(display_tz)
        .ok()
        .map(|tz| instant.with_timezone(&tz).date_naive())
        .unwrap_or_else(|| instant.date_naive());
    Some(TaskDue::Instant(instant, local_date))
}

fn due_is_attention(
    due: Option<&TaskDue>,
    current_date: NaiveDate,
    now_utc: DateTime<Utc>,
) -> bool {
    match due {
        Some(TaskDue::Date(date)) => *date < current_date,
        Some(TaskDue::Instant(instant, _)) => *instant < now_utc,
        None => false,
    }
}

fn due_is_on_date(due: Option<&TaskDue>, selected_date: NaiveDate) -> bool {
    match due {
        Some(TaskDue::Date(date)) => *date == selected_date,
        Some(TaskDue::Instant(_, local_date)) => *local_date == selected_date,
        None => false,
    }
}

fn agenda_task_from_row(row: &crate::index::query::TaskRow) -> AgendaTaskDto {
    AgendaTaskDto {
        id: row.id.clone(),
        title: row.title.clone(),
        status: row.status.clone(),
        priority: row.priority.clone(),
        due: row.due.clone(),
        list: row.list_name.clone(),
        position: row.position.clone(),
        parent: row.parent.clone(),
        agenda_bucket: row.agenda_bucket.clone(),
    }
}

fn sort_agenda_tasks(tasks: &mut [AgendaTaskDto]) {
    tasks.sort_by(|a, b| {
        a.due
            .cmp(&b.due)
            .then(a.position.cmp(&b.position))
            .then(a.title.cmp(&b.title))
            .then(a.id.cmp(&b.id))
    });
}

fn project_focus(
    rows: &[EventRow],
    now_utc: DateTime<Utc>,
    display_tz: &str,
) -> (Vec<TodayFocusEventDto>, Option<TodayFocusEventDto>) {
    let mut intervals: Vec<(&EventRow, DateTime<Utc>, DateTime<Utc>)> = rows
        .iter()
        .filter(|event| !event.is_all_day && event.status != "cancelled")
        .filter_map(|event| {
            let start = resolve_agenda_instant(
                &event.start,
                event.floating,
                event.start_tzid.as_deref(),
                display_tz,
            )?;
            let end = resolve_agenda_instant(
                &event.end_time,
                event.floating,
                event.end_tzid.as_deref().or(event.start_tzid.as_deref()),
                display_tz,
            )?;
            (end > start).then_some((event, start, end))
        })
        .collect();
    intervals.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.0.id.cmp(&b.0.id)));

    let active_events = intervals
        .iter()
        .filter(|(_, start, end)| *start <= now_utc && now_utc < *end)
        .map(|(event, start, end)| focus_event(event, *start, *end, *end - now_utc))
        .collect();
    let next_event = intervals
        .iter()
        .find(|(_, start, _)| *start > now_utc)
        .map(|(event, start, end)| focus_event(event, *start, *end, *start - now_utc));
    (active_events, next_event)
}

fn resolve_agenda_instant(
    value: &str,
    floating: bool,
    tzid: Option<&str>,
    display_tz: &str,
) -> Option<DateTime<Utc>> {
    let naive = parse_naive_dt(value)?;
    let timezone = if floating {
        display_tz
    } else {
        tzid.unwrap_or(display_tz)
    };
    crate::time::resolve_to_utc(naive, timezone)
        .ok()
        .map(|resolved| resolved.utc())
}

fn focus_event(
    event: &EventRow,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    remaining: Duration,
) -> TodayFocusEventDto {
    TodayFocusEventDto {
        event_id: event.id.clone(),
        start_utc: start.timestamp(),
        end_utc: end.timestamp(),
        minutes: remaining.num_seconds().max(0).saturating_add(59) / 60,
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// Half-open intersection with the requested display-timezone day.
fn event_falls_on_date(row: &EventRow, date: &NaiveDate, display_tz_str: &str) -> bool {
    if row.is_all_day {
        let start = NaiveDate::parse_from_str(&row.start, "%Y-%m-%d");
        let end = NaiveDate::parse_from_str(&row.end_time, "%Y-%m-%d");
        return matches!((start, end), (Ok(start), Ok(end)) if start <= *date && *date < end);
    }

    let start = match parse_naive_dt(&row.start) {
        Some(dt) => dt,
        None => return false,
    };
    let end = match parse_naive_dt(&row.end_time) {
        Some(dt) => dt,
        None => return false,
    };
    let day_start = date.and_hms_opt(0, 0, 0).expect("midnight is valid");
    let day_end = date.succ_opt().and_then(|d| d.and_hms_opt(0, 0, 0));
    let Some(day_end) = day_end else { return false };

    if row.floating {
        return start < day_end && end > day_start;
    }

    if let Some(ref tzid) = row.start_tzid {
        let end_tzid = row.end_tzid.as_deref().unwrap_or(tzid);
        if let (Ok(start_res), Ok(end_res), Ok(display_tz)) = (
            crate::time::resolve_to_utc(start, tzid),
            crate::time::resolve_to_utc(end, end_tzid),
            Tz::from_str(display_tz_str),
        ) {
            let display_start = start_res.utc().with_timezone(&display_tz).naive_local();
            let display_end = end_res.utc().with_timezone(&display_tz).naive_local();
            return display_start < day_end && display_end > day_start;
        }
    }

    start < day_end && end > day_start
}

/// Returns a UTC timestamp (seconds) for ordering timed events.
/// All-day events are in a separate bucket so this is only called for timed rows.
fn event_sort_key_utc(row: &EventRow, display_tz_str: &str) -> i64 {
    let naive = match parse_naive_dt(&row.start) {
        Some(dt) => dt,
        None => return 0,
    };

    if row.floating {
        // Floating: no UTC anchor — sort by wall-time (treated as UTC for relative ordering).
        return naive.and_utc().timestamp();
    }

    if let Some(ref tzid) = row.start_tzid {
        if let Ok(res) = crate::time::resolve_to_utc(naive, tzid) {
            return res.utc().timestamp();
        }
    }

    // Fallback: try to resolve using display_tz.
    if let Ok(res) = crate::time::resolve_to_utc(naive, display_tz_str) {
        return res.utc().timestamp();
    }

    naive.and_utc().timestamp()
}

/// Returns the start time in display_tz as `"HH:MM"`, or `"all-day"` for
/// all-day events, or a short fallback string on parse failure.
fn compute_display_start(row: &EventRow, display_tz_str: &str) -> String {
    if row.is_all_day {
        return "all-day".to_string();
    }

    let naive = match parse_naive_dt(&row.start) {
        Some(dt) => dt,
        None => {
            // Best-effort: return first 5 chars ("HH:MM") of whatever is stored.
            let end = row.start.len().min(5);
            return row.start[..end].to_string();
        }
    };

    if row.floating {
        // Floating: no timezone — show wall-time as-is.
        return naive.format("%H:%M").to_string();
    }

    if let Some(ref tzid) = row.start_tzid {
        if let Ok(res) = crate::time::resolve_to_utc(naive, tzid) {
            let utc = res.utc();
            match Tz::from_str(display_tz_str) {
                Ok(tz) => return utc.with_timezone(&tz).format("%H:%M").to_string(),
                Err(_) => return utc.format("%H:%M").to_string(), // show UTC on bad display_tz
            }
        }
    }

    naive.format("%H:%M").to_string()
}

/// Parse a stored start-time string into a `NaiveDateTime`.
/// Tries `YYYY-MM-DDTHH:MM:SS` then `YYYY-MM-DDTHH:MM`.
fn parse_naive_dt(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .ok()
}

#[cfg(test)]
mod today_projection_tests {
    use super::*;
    use crate::model::{AgendaBucket, DueDate, TaskStatus, TemporalValue, ValueType};
    use crate::ops::{api, events, init, tasks};
    use crate::store::fs;
    use tempfile::TempDir;

    fn event(id: &str, start: &str, end: &str) -> EventRow {
        EventRow {
            id: id.to_string(),
            title: id.to_string(),
            status: "confirmed".to_string(),
            start: start.to_string(),
            end_time: end.to_string(),
            is_all_day: false,
            start_tzid: Some("UTC".to_string()),
            end_tzid: Some("UTC".to_string()),
            floating: false,
            ical_uid: None,
            created: String::new(),
            updated: String::new(),
            source: "jin".to_string(),
            authority: "jin".to_string(),
            derived_from: None,
            recurrence_unexpanded: false,
            file_path: String::new(),
        }
    }

    fn root_with_display_tz(display_tz: &str) -> TempDir {
        let root = TempDir::new().unwrap();
        init(root.path()).unwrap();
        let mut config = Config::load(root.path()).unwrap();
        config.display_tz = display_tz.to_string();
        config.save().unwrap();
        root
    }

    fn task(root: &Path, title: &str, due: Option<DueDate>) -> crate::model::Task {
        tasks::create_task(
            &root.join("tasks"),
            tasks::CreateTaskParams {
                title: title.to_string(),
                due,
                ..Default::default()
            },
        )
        .unwrap()
    }

    fn timed_event(
        root: &Path,
        title: &str,
        start: &str,
        end: &str,
        floating: bool,
    ) -> crate::model::Event {
        let start = NaiveDateTime::parse_from_str(start, "%Y-%m-%dT%H:%M:%S").unwrap();
        let end = NaiveDateTime::parse_from_str(end, "%Y-%m-%dT%H:%M:%S").unwrap();
        events::create_event(
            &root.join("events"),
            events::CreateEventParams {
                title: title.to_string(),
                body: String::new(),
                start: TemporalValue::DateTime(start),
                end: TemporalValue::DateTime(end),
                start_value_type: ValueType::DateTime,
                end_value_type: ValueType::DateTime,
                is_all_day: false,
                start_tzid: (!floating).then_some("UTC".to_string()),
                end_tzid: (!floating).then_some("UTC".to_string()),
                floating,
                ical_uid: None,
                description: None,
                location: None,
                attendees: None,
                conference_data: None,
                reminders: None,
            },
        )
        .unwrap()
    }

    fn utc(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn today_due_uses_display_timezone_and_invalid_values_fail_closed() {
        let due = parse_task_due(Some("2026-06-27T01:00:00Z"), "America/New_York").unwrap();
        assert!(due_is_on_date(
            Some(&due),
            NaiveDate::from_ymd_opt(2026, 6, 26).unwrap()
        ));
        assert!(parse_task_due(Some("not-a-date"), "UTC").is_none());
        assert!(due_is_attention(
            Some(&TaskDue::Date(
                NaiveDate::from_ymd_opt(2026, 6, 26).unwrap()
            )),
            NaiveDate::from_ymd_opt(2026, 6, 27).unwrap(),
            DateTime::parse_from_rfc3339("2026-06-27T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        ));
    }

    #[test]
    fn focus_keeps_all_overlapping_events_and_selects_next() {
        let now = DateTime::parse_from_rfc3339("2026-06-27T10:15:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let rows = vec![
            event("later", "2026-06-27T12:00:00", "2026-06-27T13:00:00"),
            event("second", "2026-06-27T10:00:00", "2026-06-27T10:45:00"),
            event("first", "2026-06-27T09:00:00", "2026-06-27T10:30:00"),
        ];
        let (active, next) = project_focus(&rows, now, "UTC");
        assert_eq!(
            active
                .iter()
                .map(|item| item.event_id.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        assert_eq!(next.unwrap().event_id, "later");
        assert!(active.iter().all(|item| item.minutes >= 0));
    }

    #[test]
    fn focus_uses_distinct_end_timezone() {
        let mut row = event("cross-zone", "2026-06-27T09:00:00", "2026-06-27T09:30:00");
        row.start_tzid = Some("America/New_York".to_string());
        row.end_tzid = Some("America/Los_Angeles".to_string());
        let now = DateTime::parse_from_rfc3339("2026-06-27T14:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let (active, _) = project_focus(&[row], now, "UTC");
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].minutes, 150);
    }

    #[test]
    fn projection_enforces_task_eligibility_precedence_and_promoted_suppression() {
        let root = root_with_display_tz("UTC");
        let overdue = task(
            root.path(),
            "overdue",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 26).unwrap())),
        );
        let due = task(
            root.path(),
            "due",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())),
        );
        let mut due_and_flexible = task(
            root.path(),
            "due and flexible",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())),
        );
        due_and_flexible.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
        fs::write_task(&root.path().join("tasks"), &due_and_flexible).unwrap();
        let mut flexible = task(root.path(), "flexible", None);
        flexible.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
        fs::write_task(&root.path().join("tasks"), &flexible).unwrap();
        let mut done = task(
            root.path(),
            "done",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())),
        );
        done.frontmatter.status = TaskStatus::Done;
        fs::write_task(&root.path().join("tasks"), &done).unwrap();
        let promoted = task(
            root.path(),
            "promoted",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())),
        );
        let mut promoted_event = timed_event(
            root.path(),
            "task block",
            "2026-06-27T15:00:00",
            "2026-06-27T16:00:00",
            false,
        );
        promoted_event.frontmatter.derived_from = Some(promoted.id().to_string());
        fs::write_event(&root.path().join("events"), &promoted_event).unwrap();
        api::refresh(root.path()).unwrap();

        let projection =
            today_projection_for_date_at(root.path(), None, utc("2026-06-27T12:00:00Z")).unwrap();
        assert_eq!(
            projection
                .attention_tasks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![overdue.id()]
        );
        assert_eq!(
            projection
                .due_tasks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![due.id(), due_and_flexible.id()]
        );
        assert_eq!(
            projection
                .flexible_tasks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![flexible.id()]
        );
        let standalone = projection
            .attention_tasks
            .iter()
            .chain(&projection.due_tasks)
            .chain(&projection.flexible_tasks)
            .map(|item| item.id.as_str())
            .collect::<HashSet<_>>();
        assert!(!standalone.contains(promoted.id()));
        assert!(!standalone.contains(done.id()));
        assert_eq!(
            standalone.len(),
            4,
            "precedence keeps standalone lanes disjoint"
        );
    }

    #[test]
    fn projection_hides_current_only_lanes_and_focus_for_noncurrent_dates() {
        let root = root_with_display_tz("UTC");
        let due_tomorrow = task(
            root.path(),
            "tomorrow",
            Some(DueDate::Date(NaiveDate::from_ymd_opt(2026, 6, 28).unwrap())),
        );
        let mut flexible = task(root.path(), "flexible", None);
        flexible.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
        fs::write_task(&root.path().join("tasks"), &flexible).unwrap();
        timed_event(
            root.path(),
            "tomorrow event",
            "2026-06-28T15:00:00",
            "2026-06-28T16:00:00",
            false,
        );
        api::refresh(root.path()).unwrap();

        let projection = today_projection_for_date_at(
            root.path(),
            Some(NaiveDate::from_ymd_opt(2026, 6, 28).unwrap()),
            utc("2026-06-27T12:00:00Z"),
        )
        .unwrap();
        assert!(!projection.is_current_date);
        assert_eq!(
            projection
                .due_tasks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![due_tomorrow.id()]
        );
        assert!(projection.attention_tasks.is_empty());
        assert!(projection.flexible_tasks.is_empty());
        assert!(projection.active_events.is_empty());
        assert!(projection.next_event.is_none());
    }

    #[test]
    fn projection_focus_uses_dst_policy_and_excludes_exact_end_and_invalid_intervals() {
        let root = root_with_display_tz("America/New_York");
        let overlap = timed_event(
            root.path(),
            "fall overlap",
            "2026-11-01T01:00:00",
            "2026-11-01T02:00:00",
            true,
        );
        api::refresh(root.path()).unwrap();
        let projection =
            today_projection_for_date_at(root.path(), None, utc("2026-11-01T05:30:00Z")).unwrap();
        assert_eq!(projection.active_events.len(), 1);
        assert_eq!(projection.active_events[0].event_id, overlap.id());
        assert_eq!(
            projection.active_events[0].start_utc,
            utc("2026-11-01T05:00:00Z").timestamp()
        );
        assert_eq!(projection.active_events[0].minutes, 90);

        let invalid = event("invalid", "not-a-time", "2026-11-01T03:00:00");
        let ended = event("ended", "2026-11-01T00:00:00", "2026-11-01T01:00:00");
        let (active, next) = project_focus(&[invalid, ended], utc("2026-11-01T01:00:00Z"), "UTC");
        assert!(
            active.is_empty(),
            "half-open intervals exclude their exact end"
        );
        assert!(
            next.is_none(),
            "invalid and already-ended intervals cannot become next focus"
        );
    }
}
