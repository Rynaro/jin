//! S2 — Display-timezone range projection and candidate temporal preview.
//!
//! This module is the one place that answers "what time is this, in the
//! timezone the user reads the calendar in". Views and editors consume these
//! projections instead of re-deriving geometry from raw index rows, so a
//! Month cell, a Week column, and the editor cannot disagree about an event.
//!
//! ## Independent endpoint zones
//!
//! An event may carry a different IANA zone on each endpoint (a flight that
//! departs in `America/Sao_Paulo` and lands in `Europe/Lisbon`). Every
//! resolution here treats `start_tzid` and `end_tzid` separately and never
//! collapses one onto the other.
//!
//! ## DST
//!
//! All wall-time → instant resolution delegates to [`crate::time`] so the VG9
//! policy (fall-back → earlier instant, 1-hour gap → shift forward) stays in
//! exactly one place. This module only *classifies* the outcome.

use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use chrono_tz::Tz;
use std::path::Path;
use std::str::FromStr;

use crate::dto::event::{
    CalendarRangeEntryDto, CalendarRangeProjectionDto, CalendarRangeProjectionInput,
    CalendarSlotState, EventTemporalPreviewDto, EventTemporalPreviewInput, TemporalDisabledReason,
    TemporalFieldErrorDto, TemporalPreviewStatus, TemporalResolutionKind,
};
use crate::index::{self, query};
use crate::time::TzResolution;
use crate::{Config, JinError, Result};

// ── Wall-time resolution ──────────────────────────────────────────────────────

/// The classified outcome of resolving one wall-time against one zone.
enum ResolveOutcome {
    Resolved {
        utc: chrono::DateTime<Utc>,
        kind: TemporalResolutionKind,
        note: Option<String>,
    },
    InvalidTimezone(String),
    Unresolvable(String),
}

/// Resolve `naive` in `tzid`, distinguishing an invalid zone from a
/// non-standard DST gap.
///
/// `crate::time::resolve_to_utc` returns an untyped `Result<_, String>` for
/// both causes and has other call sites workspace-wide, so rather than widen
/// its signature we pre-validate the zone with the existing
/// `crate::time::validate_tzid`. After a zone has validated, the only
/// remaining error `resolve_to_utc` can produce is the non-standard-gap case —
/// so the attribution below is exhaustive by construction, not by guesswork.
fn resolve_wall(naive: NaiveDateTime, tzid: &str) -> ResolveOutcome {
    if let Err(message) = crate::time::validate_tzid(tzid) {
        return ResolveOutcome::InvalidTimezone(message);
    }
    match crate::time::resolve_to_utc(naive, tzid) {
        Ok(TzResolution::Exact(utc)) => ResolveOutcome::Resolved {
            utc,
            kind: TemporalResolutionKind::Exact,
            note: None,
        },
        Ok(TzResolution::AmbiguousUsedEarlier { utc, note }) => ResolveOutcome::Resolved {
            utc,
            kind: TemporalResolutionKind::AmbiguousEarlier,
            note: Some(note),
        },
        Ok(TzResolution::NonexistentShiftedForward { utc, note }) => ResolveOutcome::Resolved {
            utc,
            kind: TemporalResolutionKind::NonexistentShiftedForward,
            note: Some(note),
        },
        Err(message) => ResolveOutcome::Unresolvable(message),
    }
}

// ── Parsing / formatting helpers ──────────────────────────────────────────────

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn parse_wall(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M"))
        .ok()
}

fn render_date(value: NaiveDate) -> String {
    value.format("%Y-%m-%d").to_string()
}

fn render_wall(value: NaiveDateTime) -> String {
    value.format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn render_utc(value: chrono::DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// The wall-clock reading of `utc` in `tz`.
fn wall_in_zone(utc: chrono::DateTime<Utc>, tz: Tz) -> NaiveDateTime {
    utc.with_timezone(&tz).naive_local()
}

/// Inclusive dates strictly after `start` through `end`, clamped to the
/// requested window so a projection never reports a date it was not asked for.
fn continuation_dates(
    start: NaiveDate,
    end: NaiveDate,
    window_from: NaiveDate,
    window_to: NaiveDate,
) -> Vec<String> {
    let mut dates = Vec::new();
    let mut cursor = start + Duration::days(1);
    while cursor <= end {
        if cursor >= window_from && cursor <= window_to {
            dates.push(render_date(cursor));
        }
        cursor += Duration::days(1);
    }
    dates
}

// ── Range projection ──────────────────────────────────────────────────────────

/// Project every event overlapping the inclusive `from..=to` window into the
/// configured display timezone.
///
/// Read-only: it opens the index for reading and never writes, mutates, or
/// enqueues anything.
pub fn calendar_range_projection(
    root: &Path,
    input: &CalendarRangeProjectionInput,
) -> Result<CalendarRangeProjectionDto> {
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    projection_from_connection(&cfg, &conn, input)
}

fn projection_from_connection(
    cfg: &Config,
    conn: &rusqlite::Connection,
    input: &CalendarRangeProjectionInput,
) -> Result<CalendarRangeProjectionDto> {
    let window_from = parse_date(&input.from).ok_or_else(|| JinError::Validation {
        field: "from".to_string(),
        reason: format!("invalid date '{}'; expected YYYY-MM-DD", input.from),
    })?;
    let window_to = parse_date(&input.to).ok_or_else(|| JinError::Validation {
        field: "to".to_string(),
        reason: format!("invalid date '{}'; expected YYYY-MM-DD", input.to),
    })?;
    if window_to < window_from {
        return Err(JinError::Validation {
            field: "to".to_string(),
            reason: "must not be before 'from'".to_string(),
        });
    }

    let display_tz_str = cfg.display_tz.clone();
    let display_tz = Tz::from_str(&display_tz_str).unwrap_or(chrono_tz::UTC);

    let rows = query::list_events(conn, false).map_err(JinError::Index)?;
    let mut entries: Vec<CalendarRangeEntryDto> = Vec::new();
    for row in &rows {
        if let Some(entry) = project_row(row, display_tz, window_from, window_to) {
            entries.push(entry);
        }
    }
    // Deterministic order: first display date, then start wall value, then id.
    entries.sort_by(|a, b| {
        a.start_date
            .cmp(&b.start_date)
            .then_with(|| a.start_display.cmp(&b.start_display))
            .then_with(|| a.event_id.cmp(&b.event_id))
    });

    Ok(CalendarRangeProjectionDto {
        from: render_date(window_from),
        to: render_date(window_to),
        display_tz: display_tz_str,
        entries,
    })
}

/// Project one row, or `None` when it does not overlap the window.
fn project_row(
    row: &query::EventRow,
    display_tz: Tz,
    window_from: NaiveDate,
    window_to: NaiveDate,
) -> Option<CalendarRangeEntryDto> {
    let base = |slot_state: CalendarSlotState| CalendarRangeEntryDto {
        event_id: row.id.clone(),
        title: row.title.clone(),
        slot_state,
        start_date: String::new(),
        end_date: String::new(),
        start_display: String::new(),
        end_display: String::new(),
        start_utc: None,
        end_utc: None,
        continuation_dates: Vec::new(),
        elapsed_minutes: 0,
        start_tzid: row.start_tzid.clone(),
        end_tzid: row.end_tzid.clone(),
        is_all_day: row.is_all_day,
        floating: row.floating,
        start_resolution: None,
        end_resolution: None,
        temporal_editable: true,
        temporal_disabled_reason: None,
    };

    if row.is_all_day {
        // Canonical all-day end is exclusive; the last occupied display date is
        // the day before it.
        let start = parse_date(&row.start)?;
        let end_exclusive = parse_date(&row.end_time)?;
        let end_inclusive = end_exclusive - Duration::days(1);
        let end_inclusive = if end_inclusive < start {
            start
        } else {
            end_inclusive
        };
        if start > window_to || end_inclusive < window_from {
            return None;
        }
        let mut entry = base(CalendarSlotState::AllDay);
        entry.start_date = render_date(start);
        entry.end_date = render_date(end_inclusive);
        entry.start_display = render_date(start);
        entry.end_display = render_date(end_inclusive);
        entry.continuation_dates = continuation_dates(start, end_inclusive, window_from, window_to);
        entry.elapsed_minutes = (end_exclusive - start).num_minutes().max(0);
        return Some(entry);
    }

    let start_wall = parse_wall(&row.start)?;
    let end_wall = parse_wall(&row.end_time)?;

    if row.floating {
        // Floating wall-time is never converted — it reads the same in every
        // timezone, which is precisely its contract.
        let start_date = start_wall.date();
        let end_date = end_wall.date();
        if start_date > window_to || end_date < window_from {
            return None;
        }
        let mut entry = base(CalendarSlotState::Floating);
        entry.start_date = render_date(start_date);
        entry.end_date = render_date(end_date);
        entry.start_display = render_wall(start_wall);
        entry.end_display = render_wall(end_wall);
        entry.continuation_dates = continuation_dates(start_date, end_date, window_from, window_to);
        entry.elapsed_minutes = (end_wall - start_wall).num_minutes();
        return Some(entry);
    }

    // Anchored: each endpoint resolves through its own zone.
    let start_zone = row.start_tzid.clone()?;
    let end_zone = row.end_tzid.clone().unwrap_or_else(|| start_zone.clone());
    let start_outcome = resolve_wall(start_wall, &start_zone);
    let end_outcome = resolve_wall(end_wall, &end_zone);

    let mut entry = base(CalendarSlotState::Anchored);

    let (start_utc, start_kind) = match start_outcome {
        ResolveOutcome::Resolved { utc, kind, .. } => (utc, kind),
        ResolveOutcome::InvalidTimezone(_) | ResolveOutcome::Unresolvable(_) => {
            // The event still belongs on the calendar and its non-temporal
            // fields stay editable; only its time is untrustworthy. Fall back
            // to the stored wall reading so the entry is still placeable.
            let start_date = start_wall.date();
            let end_date = end_wall.date();
            if start_date > window_to || end_date < window_from {
                return None;
            }
            entry.start_date = render_date(start_date);
            entry.end_date = render_date(end_date);
            entry.start_display = render_wall(start_wall);
            entry.end_display = render_wall(end_wall);
            entry.continuation_dates =
                continuation_dates(start_date, end_date, window_from, window_to);
            entry.elapsed_minutes = (end_wall - start_wall).num_minutes();
            entry.temporal_editable = false;
            entry.temporal_disabled_reason = Some(match start_outcome {
                ResolveOutcome::InvalidTimezone(_) => TemporalDisabledReason::InvalidTimezone,
                _ => TemporalDisabledReason::UnresolvableLocalTime,
            });
            return Some(entry);
        }
    };

    let (end_utc, end_kind, end_failure) = match end_outcome {
        ResolveOutcome::Resolved { utc, kind, .. } => (utc, kind, None),
        ResolveOutcome::InvalidTimezone(_) => (
            start_utc,
            TemporalResolutionKind::Exact,
            Some(TemporalDisabledReason::InvalidTimezone),
        ),
        ResolveOutcome::Unresolvable(_) => (
            start_utc,
            TemporalResolutionKind::Exact,
            Some(TemporalDisabledReason::UnresolvableLocalTime),
        ),
    };

    let start_local = wall_in_zone(start_utc, display_tz);
    let end_local = wall_in_zone(end_utc, display_tz);
    let start_date = start_local.date();
    let end_date = end_local.date();
    if start_date > window_to || end_date < window_from {
        return None;
    }

    entry.start_date = render_date(start_date);
    entry.end_date = render_date(end_date);
    entry.start_display = render_wall(start_local);
    entry.end_display = render_wall(end_local);
    entry.start_utc = Some(render_utc(start_utc));
    entry.end_utc = Some(render_utc(end_utc));
    entry.continuation_dates = continuation_dates(start_date, end_date, window_from, window_to);
    entry.elapsed_minutes = (end_utc - start_utc).num_minutes();
    entry.start_resolution = Some(start_kind);
    entry.end_resolution = Some(end_kind);

    // An ambiguous stored wall-time maps to two real instants; we cannot prove
    // which one the author meant, so editing time would silently move the
    // event. Every other field stays editable.
    if let Some(reason) = end_failure {
        entry.temporal_editable = false;
        entry.temporal_disabled_reason = Some(reason);
    } else if start_kind == TemporalResolutionKind::AmbiguousEarlier
        || end_kind == TemporalResolutionKind::AmbiguousEarlier
    {
        entry.temporal_editable = false;
        entry.temporal_disabled_reason = Some(TemporalDisabledReason::AmbiguousWallTime);
    } else if start_kind == TemporalResolutionKind::NonexistentShiftedForward
        || end_kind == TemporalResolutionKind::NonexistentShiftedForward
    {
        entry.temporal_editable = false;
        entry.temporal_disabled_reason = Some(TemporalDisabledReason::UnresolvableLocalTime);
    }

    Some(entry)
}

// ── Temporal preview ──────────────────────────────────────────────────────────

fn field_error(
    field: &str,
    code: TemporalPreviewStatus,
    message: impl Into<String>,
) -> TemporalFieldErrorDto {
    TemporalFieldErrorDto {
        field: field.to_string(),
        code,
        message: message.into(),
    }
}

fn rejected(
    input: &EventTemporalPreviewInput,
    status: TemporalPreviewStatus,
    errors: Vec<TemporalFieldErrorDto>,
) -> EventTemporalPreviewDto {
    EventTemporalPreviewDto {
        status,
        schedulable: false,
        errors,
        start_resolution: None,
        end_resolution: None,
        start_utc: None,
        end_utc: None,
        start_display: input.start.clone(),
        end_display: input.end.clone(),
        start_tzid: input.start_tzid.clone(),
        end_tzid: input.end_tzid.clone(),
        is_all_day: input.is_all_day,
        floating: input.floating,
        elapsed_minutes: None,
        start_note: None,
        end_note: None,
    }
}

/// Resolve a candidate temporal bundle without touching the vault.
///
/// Pure and deterministic: the same input always yields the same DTO, which is
/// what lets the Rust and TypeScript fixtures assert against one another.
///
/// A non-`Ok` status never carries resolved instants, so a caller cannot
/// accidentally schedule a draft core refused to place.
pub fn event_temporal_preview(input: &EventTemporalPreviewInput) -> EventTemporalPreviewDto {
    if input.is_all_day {
        let (Some(start), Some(end)) = (parse_date(&input.start), parse_date(&input.end)) else {
            return rejected(
                input,
                TemporalPreviewStatus::InvalidValue,
                vec![field_error(
                    "start",
                    TemporalPreviewStatus::InvalidValue,
                    "all-day values must be YYYY-MM-DD",
                )],
            );
        };
        if end <= start {
            return rejected(
                input,
                TemporalPreviewStatus::NonPositiveDuration,
                vec![field_error(
                    "duration",
                    TemporalPreviewStatus::NonPositiveDuration,
                    "the canonical exclusive end must be after the start date",
                )],
            );
        }
        return EventTemporalPreviewDto {
            status: TemporalPreviewStatus::Ok,
            schedulable: true,
            errors: Vec::new(),
            start_resolution: Some(TemporalResolutionKind::Exact),
            end_resolution: Some(TemporalResolutionKind::Exact),
            start_utc: None,
            end_utc: None,
            start_display: render_date(start),
            end_display: render_date(end),
            start_tzid: None,
            end_tzid: None,
            is_all_day: true,
            floating: false,
            elapsed_minutes: Some((end - start).num_minutes()),
            start_note: None,
            end_note: None,
        };
    }

    let (Some(start_wall), Some(end_wall)) = (parse_wall(&input.start), parse_wall(&input.end))
    else {
        return rejected(
            input,
            TemporalPreviewStatus::InvalidValue,
            vec![field_error(
                "start",
                TemporalPreviewStatus::InvalidValue,
                "timed values must be YYYY-MM-DDTHH:MM:SS",
            )],
        );
    };

    if input.floating {
        let elapsed = (end_wall - start_wall).num_minutes();
        if elapsed <= 0 {
            return rejected(
                input,
                TemporalPreviewStatus::NonPositiveDuration,
                vec![field_error(
                    "duration",
                    TemporalPreviewStatus::NonPositiveDuration,
                    "the end must be after the start",
                )],
            );
        }
        return EventTemporalPreviewDto {
            status: TemporalPreviewStatus::Ok,
            schedulable: true,
            errors: Vec::new(),
            start_resolution: Some(TemporalResolutionKind::Exact),
            end_resolution: Some(TemporalResolutionKind::Exact),
            start_utc: None,
            end_utc: None,
            start_display: render_wall(start_wall),
            end_display: render_wall(end_wall),
            start_tzid: None,
            end_tzid: None,
            is_all_day: false,
            floating: true,
            elapsed_minutes: Some(elapsed),
            start_note: None,
            end_note: None,
        };
    }

    let Some(start_zone) = input.start_tzid.clone() else {
        return rejected(
            input,
            TemporalPreviewStatus::InvalidTimezone,
            vec![field_error(
                "start_tzid",
                TemporalPreviewStatus::InvalidTimezone,
                "an anchored event requires a start timezone",
            )],
        );
    };
    // A distinct end zone is honoured; its absence means "same as start", and
    // is never used to overwrite a zone the caller actually supplied.
    let end_zone = input.end_tzid.clone().unwrap_or_else(|| start_zone.clone());

    let start_outcome = resolve_wall(start_wall, &start_zone);
    let end_outcome = resolve_wall(end_wall, &end_zone);

    let mut errors = Vec::new();
    for (field, outcome) in [("start", &start_outcome), ("end", &end_outcome)] {
        match outcome {
            ResolveOutcome::InvalidTimezone(message) => errors.push(field_error(
                if field == "start" {
                    "start_tzid"
                } else {
                    "end_tzid"
                },
                TemporalPreviewStatus::InvalidTimezone,
                message.clone(),
            )),
            ResolveOutcome::Unresolvable(message) => errors.push(field_error(
                field,
                TemporalPreviewStatus::UnresolvableLocalTime,
                message.clone(),
            )),
            ResolveOutcome::Resolved { .. } => {}
        }
    }
    if !errors.is_empty() {
        // Timezone validity is the more fundamental failure, so it names the
        // overall status when both appear.
        let status = if errors
            .iter()
            .any(|error| error.code == TemporalPreviewStatus::InvalidTimezone)
        {
            TemporalPreviewStatus::InvalidTimezone
        } else {
            TemporalPreviewStatus::UnresolvableLocalTime
        };
        return rejected(input, status, errors);
    }

    let (
        ResolveOutcome::Resolved {
            utc: start_utc,
            kind: start_kind,
            note: start_note,
        },
        ResolveOutcome::Resolved {
            utc: end_utc,
            kind: end_kind,
            note: end_note,
        },
    ) = (start_outcome, end_outcome)
    else {
        unreachable!("non-resolved outcomes returned above");
    };

    let elapsed = (end_utc - start_utc).num_minutes();
    if elapsed <= 0 {
        return rejected(
            input,
            TemporalPreviewStatus::NonPositiveDuration,
            vec![field_error(
                "duration",
                TemporalPreviewStatus::NonPositiveDuration,
                "the end must resolve to an instant after the start",
            )],
        );
    }

    // Echo back the entered wall values, except where DST policy moved them:
    // a shifted-forward start must show the adjusted local time it became.
    let start_display = if start_kind == TemporalResolutionKind::NonexistentShiftedForward {
        Tz::from_str(&start_zone)
            .map(|tz| render_wall(wall_in_zone(start_utc, tz)))
            .unwrap_or_else(|_| render_wall(start_wall))
    } else {
        render_wall(start_wall)
    };
    let end_display = if end_kind == TemporalResolutionKind::NonexistentShiftedForward {
        Tz::from_str(&end_zone)
            .map(|tz| render_wall(wall_in_zone(end_utc, tz)))
            .unwrap_or_else(|_| render_wall(end_wall))
    } else {
        render_wall(end_wall)
    };

    EventTemporalPreviewDto {
        status: TemporalPreviewStatus::Ok,
        schedulable: true,
        errors: Vec::new(),
        start_resolution: Some(start_kind),
        end_resolution: Some(end_kind),
        start_utc: Some(render_utc(start_utc)),
        end_utc: Some(render_utc(end_utc)),
        start_display,
        end_display,
        start_tzid: Some(start_zone),
        end_tzid: input.end_tzid.clone().or(Some(end_zone)),
        is_all_day: false,
        floating: false,
        elapsed_minutes: Some(elapsed),
        start_note,
        end_note,
    }
}

/// Convenience used by tests and the Tauri boundary: the display-timezone
/// reading of an instant, as a wall string.
pub fn instant_in_display_zone(utc_rfc3339: &str, tzid: &str) -> Option<String> {
    let parsed = chrono::DateTime::parse_from_rfc3339(utc_rfc3339).ok()?;
    let tz = Tz::from_str(tzid).ok()?;
    Some(render_wall(wall_in_zone(parsed.with_timezone(&Utc), tz)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall(value: &str) -> NaiveDateTime {
        parse_wall(value).unwrap()
    }

    fn anchored(start: &str, end: &str, start_tz: &str, end_tz: &str) -> EventTemporalPreviewInput {
        EventTemporalPreviewInput {
            start: start.to_string(),
            end: end.to_string(),
            is_all_day: false,
            floating: false,
            start_tzid: Some(start_tz.to_string()),
            end_tzid: Some(end_tz.to_string()),
        }
    }

    #[test]
    fn resolution_kind_fixtures_report_ambiguous_and_shifted() {
        // America/New_York falls back 2023-11-05 02:00; 01:30 repeats.
        let ambiguous = event_temporal_preview(&anchored(
            "2023-11-05T01:30:00",
            "2023-11-05T03:30:00",
            "America/New_York",
            "America/New_York",
        ));
        assert_eq!(ambiguous.status, TemporalPreviewStatus::Ok);
        assert_eq!(
            ambiguous.start_resolution,
            Some(TemporalResolutionKind::AmbiguousEarlier)
        );
        assert!(
            ambiguous.start_note.is_some(),
            "an ambiguous resolution must carry a human-readable note"
        );
        // Earlier instant is the EDT (UTC-4) reading: 01:30 → 05:30Z.
        assert_eq!(ambiguous.start_utc.as_deref(), Some("2023-11-05T05:30:00Z"));

        // America/New_York springs forward 2023-03-12 02:00; 02:30 does not exist.
        let gap = event_temporal_preview(&anchored(
            "2023-03-12T02:30:00",
            "2023-03-12T05:30:00",
            "America/New_York",
            "America/New_York",
        ));
        assert_eq!(gap.status, TemporalPreviewStatus::Ok);
        assert_eq!(
            gap.start_resolution,
            Some(TemporalResolutionKind::NonexistentShiftedForward)
        );
        assert!(gap.start_note.is_some());
        // The adjusted local time is surfaced, not the impossible 02:30.
        assert_eq!(gap.start_display, "2023-03-12T03:30:00");
        assert_eq!(gap.start_utc.as_deref(), Some("2023-03-12T07:30:00Z"));
    }

    #[test]
    fn invalid_timezone_is_field_associated_and_not_schedulable() {
        let preview = event_temporal_preview(&anchored(
            "2026-07-01T09:00:00",
            "2026-07-01T10:00:00",
            "Not/A_Timezone",
            "Not/A_Timezone",
        ));
        assert_eq!(preview.status, TemporalPreviewStatus::InvalidTimezone);
        assert!(!preview.schedulable);
        assert!(preview.start_utc.is_none());
        assert!(preview
            .errors
            .iter()
            .any(|error| error.field == "start_tzid"));
    }

    #[test]
    fn non_positive_duration_is_rejected() {
        let preview = event_temporal_preview(&anchored(
            "2026-07-01T10:00:00",
            "2026-07-01T10:00:00",
            "UTC",
            "UTC",
        ));
        assert_eq!(preview.status, TemporalPreviewStatus::NonPositiveDuration);
        assert!(!preview.schedulable);
        assert!(preview.errors.iter().any(|error| error.field == "duration"));
    }

    #[test]
    fn cross_zone_endpoints_resolve_independently() {
        // Departs Sao Paulo 22:00 (UTC-3 → 01:00Z), lands Lisbon 06:00
        // (UTC+1 in July → 05:00Z). Elapsed is 4 hours, not 8.
        let preview = event_temporal_preview(&anchored(
            "2026-07-01T22:00:00",
            "2026-07-02T06:00:00",
            "America/Sao_Paulo",
            "Europe/Lisbon",
        ));
        assert_eq!(preview.status, TemporalPreviewStatus::Ok);
        assert_eq!(preview.start_utc.as_deref(), Some("2026-07-02T01:00:00Z"));
        assert_eq!(preview.end_utc.as_deref(), Some("2026-07-02T05:00:00Z"));
        assert_eq!(preview.elapsed_minutes, Some(240));
        assert_eq!(preview.start_tzid.as_deref(), Some("America/Sao_Paulo"));
        assert_eq!(
            preview.end_tzid.as_deref(),
            Some("Europe/Lisbon"),
            "a distinct end zone must never be collapsed onto the start zone"
        );
    }

    #[test]
    fn changing_the_zone_preserves_entered_wall_values() {
        let first = event_temporal_preview(&anchored(
            "2026-07-01T09:00:00",
            "2026-07-01T10:00:00",
            "America/New_York",
            "America/New_York",
        ));
        let second = event_temporal_preview(&anchored(
            "2026-07-01T09:00:00",
            "2026-07-01T10:00:00",
            "Europe/Lisbon",
            "Europe/Lisbon",
        ));
        assert_eq!(first.start_display, "2026-07-01T09:00:00");
        assert_eq!(
            second.start_display, "2026-07-01T09:00:00",
            "the entered local clock must not move when only the zone changes"
        );
        assert_ne!(
            first.start_utc, second.start_utc,
            "the resolved instant must move even though the wall value did not"
        );
    }

    #[test]
    fn all_day_uses_exclusive_canonical_end() {
        let preview = event_temporal_preview(&EventTemporalPreviewInput {
            start: "2026-07-01".to_string(),
            end: "2026-07-03".to_string(),
            is_all_day: true,
            floating: false,
            start_tzid: None,
            end_tzid: None,
        });
        assert_eq!(preview.status, TemporalPreviewStatus::Ok);
        assert_eq!(preview.elapsed_minutes, Some(2 * 24 * 60));
        let collapsed = event_temporal_preview(&EventTemporalPreviewInput {
            start: "2026-07-01".to_string(),
            end: "2026-07-01".to_string(),
            is_all_day: true,
            floating: false,
            start_tzid: None,
            end_tzid: None,
        });
        assert_eq!(collapsed.status, TemporalPreviewStatus::NonPositiveDuration);
    }

    #[test]
    fn continuation_dates_are_clamped_to_the_requested_window() {
        let dates = continuation_dates(
            NaiveDate::from_ymd_opt(2026, 6, 29).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 4).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 3).unwrap(),
        );
        assert_eq!(dates, vec!["2026-07-01", "2026-07-02", "2026-07-03"]);
    }

    #[test]
    fn resolve_wall_separates_invalid_zone_from_gap() {
        assert!(matches!(
            resolve_wall(wall("2026-07-01T09:00:00"), "Not/A_Timezone"),
            ResolveOutcome::InvalidTimezone(_)
        ));
        assert!(matches!(
            resolve_wall(wall("2026-07-01T09:00:00"), "UTC"),
            ResolveOutcome::Resolved { .. }
        ));
    }
}
