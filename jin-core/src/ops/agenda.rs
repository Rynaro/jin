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

use chrono::{NaiveDate, NaiveDateTime, Utc};
use chrono_tz::Tz;
use std::path::Path;
use std::str::FromStr;

use crate::dto::agenda::{AgendaDto, AgendaEventDto, LinkedNoteRef, LinkedTaskRef};
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
    let sync_conn = crate::sync::state::open_sync_db(&cfg.sync_dir()).ok();

    let display_tz_str = cfg.display_tz.clone();

    // Determine target date in the display timezone.
    let target_date = date.unwrap_or_else(|| match Tz::from_str(&display_tz_str) {
        Ok(tz) => Utc::now().with_timezone(&tz).date_naive(),
        Err(_) => Utc::now().date_naive(),
    });

    // Fetch all non-cancelled events from the index.
    let rows = query::list_events(&conn, false).map_err(JinError::Index)?;

    // Filter to events that start on the target date in the display timezone.
    let matching: Vec<EventRow> = rows
        .into_iter()
        .filter(|e| event_falls_on_date(e, &target_date, &display_tz_str))
        .collect();

    let mut all_day: Vec<(String, AgendaEventDto)> = Vec::new();
    let mut timed: Vec<(i64, AgendaEventDto)> = Vec::new();

    for row in &matching {
        // Resolve index-derived backlinks for this event.
        let backlinks = query::get_backlinks(&conn, &row.id).map_err(JinError::Index)?;

        // Originating task: event was promoted from a task (derived_from edge).
        let originating_task = if let Some(ref task_id) = row.derived_from {
            query::get_task(&conn, task_id)
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
            if let Ok(Some(note)) = query::get_note(&conn, &bl.source_id) {
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

    Ok(AgendaDto {
        date: target_date.to_string(),
        display_tz: display_tz_str,
        all_day_events: all_day.into_iter().map(|(_, d)| d).collect(),
        timed_events: timed.into_iter().map(|(_, d)| d).collect(),
    })
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
