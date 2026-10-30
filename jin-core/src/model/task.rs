use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate};
use serde::{Deserialize, Serialize};

use super::edge::LinkEntry;

/// A reminder stored inline in a Task file's frontmatter.
///
/// `kind` is either `"relative"` (e.g. `"-1h"`, `"-30m"`, `"-1d"`) or
/// `"absolute"` (an RFC-3339 timestamp). The desktop scheduler resolves and
/// fires these values while the Tauri GUI is running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reminder {
    pub kind: String,
    pub value: String,
}

/// Task state machine: todo → doing → done; todo|doing → cancelled; done|cancelled → todo (reopen).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Todo,
    Doing,
    Done,
    Cancelled,
    /// Soft-delete tombstone
    Deleted,
}

/// Explicit agenda-placement intent. This is orthogonal to Task lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgendaBucket {
    Flexible,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TaskStatus::Todo => "todo",
            TaskStatus::Doing => "doing",
            TaskStatus::Done => "done",
            TaskStatus::Cancelled => "cancelled",
            TaskStatus::Deleted => "deleted",
        };
        write!(f, "{}", s)
    }
}

impl TaskStatus {
    /// Returns true if this is the tombstone state.
    pub fn is_deleted(&self) -> bool {
        *self == TaskStatus::Deleted
    }

    /// Validate a transition; returns Ok(()) if legal.
    pub fn can_transition_to(&self, next: &TaskStatus) -> bool {
        matches!(
            (self, next),
            (TaskStatus::Todo, TaskStatus::Doing)
                | (TaskStatus::Todo, TaskStatus::Done)
                | (TaskStatus::Todo, TaskStatus::Cancelled)
                | (TaskStatus::Doing, TaskStatus::Done)
                | (TaskStatus::Doing, TaskStatus::Cancelled)
                | (TaskStatus::Doing, TaskStatus::Todo) // reopen-style
                | (TaskStatus::Done, TaskStatus::Todo)
                | (TaskStatus::Cancelled, TaskStatus::Todo)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    #[default]
    None,
    Low,
    Medium,
    High,
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Priority::None => "none",
            Priority::Low => "low",
            Priority::Medium => "medium",
            Priority::High => "high",
        };
        write!(f, "{}", s)
    }
}

/// Due date: either a bare date or a datetime with offset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DueDate {
    Date(NaiveDate),
    DateTime(DateTime<FixedOffset>),
}

/// The repeat cadence for a task routine.  This intentionally stays smaller
/// than event RRULE support: task routines are user-owned Markdown records,
/// not provider calendar events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecurrenceFrequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecurrenceMode {
    Scheduled,
    Completion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RecurrenceEnd {
    Never,
    Until { date: NaiveDate },
    Count { count: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskRecurrence {
    /// Optional editor choice, preserving Weekly versus the equivalent Weekdays preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_preset: Option<String>,
    pub series_id: String,
    pub frequency: RecurrenceFrequency,
    pub interval: u16,
    #[serde(default)]
    pub weekdays: Vec<u32>, // ISO weekday, Monday = 1
    #[serde(default = "default_recurrence_mode")]
    pub mode: RecurrenceMode,
    #[serde(default = "default_recurrence_end")]
    pub end: RecurrenceEnd,
    pub anchor_due: DueDate,
    #[serde(default = "default_sequence")]
    pub sequence: u16,
}

fn default_recurrence_mode() -> RecurrenceMode {
    RecurrenceMode::Scheduled
}
fn default_recurrence_end() -> RecurrenceEnd {
    RecurrenceEnd::Never
}
fn default_sequence() -> u16 {
    1
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskCompletion {
    pub series_id: String,
    pub sequence: u16,
    pub completed_at: DateTime<FixedOffset>,
    pub due: DueDate,
}

impl TaskRecurrence {
    pub fn validate(&self) -> Result<(), String> {
        if self.interval == 0 {
            return Err("repeat interval must be at least one".into());
        }
        if self.sequence == 0 {
            return Err("repeat sequence must be at least one".into());
        }
        if matches!(self.end, RecurrenceEnd::Count { count: 0 }) {
            return Err("repeat count must be at least one".into());
        }
        if !self.weekdays.iter().all(|day| (1..=7).contains(day)) {
            return Err("repeat weekdays must be ISO values from 1 through 7".into());
        }
        if !self.weekdays.is_empty() && !matches!(self.frequency, RecurrenceFrequency::Weekly) {
            return Err("repeat weekdays are supported only for weekly rules".into());
        }
        if let Some(preset) = self.editor_preset.as_deref() {
            let compatible = match preset {
                "daily" => self.frequency == RecurrenceFrequency::Daily,
                "weekly" => self.frequency == RecurrenceFrequency::Weekly,
                "monthly" => self.frequency == RecurrenceFrequency::Monthly,
                "yearly" => self.frequency == RecurrenceFrequency::Yearly,
                "weekdays" => {
                    self.frequency == RecurrenceFrequency::Weekly
                        && self.interval == 1
                        && self.weekdays == [1, 2, 3, 4, 5]
                }
                _ => false,
            };
            if !compatible {
                return Err("repeat preset must match its cadence".into());
            }
        }
        Ok(())
    }
}

pub fn default_recurrence_upcoming_count() -> u16 {
    10
}
pub fn validate_recurrence_upcoming_count(count: u16) -> Result<(), String> {
    if !(1..=365).contains(&count) {
        return Err("keep upcoming entries must be from 1 through 365".into());
    }
    Ok(())
}

fn last_day(year: i32, month: u32) -> Option<u32> {
    // Search within the requested month, including Chrono's final supported month.
    (28..=31)
        .rev()
        .find(|day| NaiveDate::from_ymd_opt(year, month, *day).is_some())
}

fn add_months(anchor: NaiveDate, months: i32) -> Option<NaiveDate> {
    let total = anchor
        .year()
        .checked_mul(12)?
        .checked_add(anchor.month0() as i32)?
        .checked_add(months)?;
    let year = total.div_euclid(12);
    let month = total.rem_euclid(12) as u32 + 1;
    NaiveDate::from_ymd_opt(year, month, anchor.day().min(last_day(year, month)?))
}

/// Compute a routine's next date-only occurrence. Scheduled routines use the
/// immutable anchor and skip every candidate at or before `after`; completion
/// routines use `current` as their fresh anchor.
pub fn next_recurrence_date(
    rule: &TaskRecurrence,
    current: NaiveDate,
    after: NaiveDate,
) -> Option<NaiveDate> {
    if rule.validate().is_err() {
        return None;
    }
    let threshold = current.max(after);
    let anchor = match rule.anchor_due {
        DueDate::Date(date) => date,
        DueDate::DateTime(dt) => dt.date_naive(),
    };
    let base = if matches!(rule.mode, RecurrenceMode::Completion) {
        current
    } else {
        anchor
    };
    let candidate = match rule.frequency {
        RecurrenceFrequency::Daily => {
            let delta = (threshold - base).num_days().max(0) / rule.interval as i64 + 1;
            base.checked_add_signed(Duration::days(delta * rule.interval as i64))?
        }
        RecurrenceFrequency::Weekly => {
            let mut days = rule.weekdays.clone();
            if days.is_empty() {
                days.push(base.weekday().number_from_monday());
            }
            days.sort_unstable();
            days.dedup();
            let anchor_week = base
                .checked_sub_signed(Duration::days(base.weekday().num_days_from_monday() as i64))?;
            let elapsed_weeks = (threshold - anchor_week).num_days().div_euclid(7).max(0);
            let interval = i64::from(rule.interval);
            let active_week = elapsed_weeks.div_euclid(interval) * interval;
            [active_week, active_week + interval]
                .into_iter()
                .flat_map(|week| {
                    days.iter().filter_map(move |day| {
                        anchor_week
                            .checked_add_signed(Duration::days(week * 7 + i64::from(*day) - 1))
                    })
                })
                .find(|candidate| *candidate > threshold)?
        }
        RecurrenceFrequency::Monthly => {
            let months = (threshold.year() - base.year()) * 12 + threshold.month0() as i32
                - base.month0() as i32;
            let mut n = (months.max(0) / rule.interval as i32) * rule.interval as i32;
            let cadence_anchor = if matches!(rule.mode, RecurrenceMode::Completion) {
                base
            } else {
                anchor
            };
            let mut d = add_months(cadence_anchor, n)?;
            while d <= threshold {
                n += rule.interval as i32;
                d = add_months(cadence_anchor, n)?;
            }
            d
        }
        RecurrenceFrequency::Yearly => {
            let mut year = base.year()
                + ((threshold.year() - base.year()).max(0) / rule.interval as i32)
                    * rule.interval as i32;
            let cadence_anchor = if matches!(rule.mode, RecurrenceMode::Completion) {
                base
            } else {
                anchor
            };
            let mut d = NaiveDate::from_ymd_opt(
                year,
                cadence_anchor.month(),
                cadence_anchor
                    .day()
                    .min(last_day(year, cadence_anchor.month())?),
            )?;
            while d <= threshold {
                year += rule.interval as i32;
                d = NaiveDate::from_ymd_opt(
                    year,
                    cadence_anchor.month(),
                    cadence_anchor
                        .day()
                        .min(last_day(year, cadence_anchor.month())?),
                )?;
            }
            d
        }
    };
    if let RecurrenceEnd::Until { date } = rule.end {
        if candidate > date {
            return None;
        }
    }
    Some(candidate)
}

fn default_list() -> String {
    "inbox".to_string()
}

/// A durable logical occurrence, independent of its task's stable ULID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecurrenceInstance {
    pub owner_task_id: String,
    pub series_id: String,
    pub revision: u32,
    pub sequence: u64,
    pub originally_scheduled_due: DueDate,
    #[serde(default)]
    pub completion_predecessor_id: Option<String>,
    #[serde(default)]
    pub detached: bool,
}

/// Canonical immutable content used when materializing another occurrence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceTemplate {
    pub frontmatter: Box<TaskFrontmatter>,
    pub body: String,
    #[serde(default)]
    pub children: Vec<RecurrenceTemplate>,
}

/// Only the owner contains this authority. Occurrences never infer an owner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceSeries {
    #[serde(default = "default_recurrence_upcoming_count")]
    pub upcoming_count: u16,
    pub schema_version: u8,
    pub series_id: String,
    pub enabled: bool,
    pub revision: u32,
    pub rule: TaskRecurrence,
    pub template: RecurrenceTemplate,
    pub next_sequence: u64,
    pub cursor: DueDate,
    /// Unmaterialized dates strictly before this monotonic boundary are consumed.
    /// Separate from the last materialized slot so an exhausted end rule still
    /// records a seek without inventing an occurrence or an off-schedule due.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_before: Option<NaiveDate>,
    pub outstanding_task_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceScope {
    ThisOccurrence,
    ThisAndFollowing,
}

/// Optional optimistic guard for series edits made from a hydrated editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceRevision {
    pub series_id: String,
    pub revision: u32,
    pub enabled: bool,
}

/// YAML frontmatter for a Task file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFrontmatter {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // always "task"
    pub title: String,
    pub created: DateTime<FixedOffset>,
    pub updated: DateTime<FixedOffset>,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub due: Option<DueDate>,
    #[serde(default = "default_list")]
    pub list: String,
    #[serde(default)]
    pub completed_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub links: Vec<LinkEntry>,
    /// Which section within the task's list this task belongs to (nullable = "No Section").
    #[serde(default)]
    pub section_id: Option<String>,
    /// Board placement is independent of organizational `section_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board_column_id: Option<String>,
    /// Tag slugs attached to this task (membership stored here; color in tags/<slug>.md).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Fractional position key (base-62, lexicographic order) for manual sort within
    /// (list_id, section_id). Empty string = unranked; rebuild assigns a rank if missing.
    #[serde(default)]
    pub position: String,
    /// Canonical reminder definitions. Device-local delivery state is separate.
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    /// S6 — id of the parent task, if this task is a subtask. `None` = a
    /// top-level task. Depth is capped at one: a task that has a `parent` may
    /// not itself be a parent (enforced in `ops::tasks`, not here — this is
    /// the model layer, which stays a plain data carrier).
    /// `#[serde(default)]` so every task file written before this wave (no
    /// `parent` key in its frontmatter) still parses without error
    /// (AC-S6-01 / AC-X-07 — the same migration-safety guarantee already
    /// covered by `serde_default_p2_fields_on_legacy_task_file` below).
    #[serde(default)]
    pub parent: Option<String>,
    /// Optional agenda placement. Missing legacy values mean no explicit bucket.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agenda_bucket: Option<AgendaBucket>,
    /// Recurrence remains canonical Markdown so routines survive index rebuilds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<TaskRecurrence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub completion_history: Vec<TaskCompletion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_series: Option<RecurrenceSeries>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub retired_recurrence_series: Vec<RecurrenceSeries>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_instance: Option<RecurrenceInstance>,
    #[serde(default)]
    pub recurrence_exception: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_baseline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence_retired_reason: Option<String>,
}

/// A parsed Task (frontmatter + optional body).
#[derive(Debug, Clone)]
pub struct Task {
    pub frontmatter: TaskFrontmatter,
    pub body: String,
}

impl Task {
    pub fn id(&self) -> &str {
        &self.frontmatter.id
    }
    pub fn title(&self) -> &str {
        &self.frontmatter.title
    }
    pub fn is_deleted(&self) -> bool {
        self.frontmatter.status.is_deleted()
    }
    /// S6 — the parent task id, if this task is a subtask.
    pub fn parent(&self) -> Option<&str> {
        self.frontmatter.parent.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::frontmatter;

    /// VG-P2 serde-default: a task file missing ALL new P2 fields parses
    /// without error and applies the correct defaults, proving no migration is needed.
    #[test]
    fn serde_default_p2_fields_on_legacy_task_file() {
        let yaml = r#"id: "LEGACY01"
type: task
title: Legacy task
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml)
            .expect("legacy task YAML (no P2 fields) must parse without error");

        assert!(fm.section_id.is_none(), "section_id must default to None");
        assert!(fm.tags.is_empty(), "tags must default to empty Vec");
        assert_eq!(fm.position, "", "position must default to empty string");
        assert!(
            fm.reminders.is_empty(),
            "reminders must default to empty Vec"
        );
    }

    /// AC-S6-01 / AC-X-07 — a task file written before this wave (no `parent`
    /// key in its frontmatter at all) SHALL parse without error, with `parent`
    /// taking its `#[serde(default)]` value (`None`). Binds the moment S6
    /// adds `parent` to the model (no core change landed before S6), and
    /// again at wave exit against a legacy fixture.
    #[test]
    fn serde_default_legacy_task_file_parses_without_parent() {
        let yaml = r#"id: "LEGACY02"
type: task
title: Legacy task, no parent key
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml)
            .expect("legacy task YAML (no `parent` key) must parse without error");

        assert!(
            fm.parent.is_none(),
            "parent must default to None when the key is absent from frontmatter"
        );
    }

    #[test]
    fn serde_default_legacy_task_agenda_bucket() {
        let yaml = r#"id: "LEGACY03"
type: task
title: Legacy task, no agenda bucket
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
status: todo
priority: none
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml).unwrap();
        assert!(fm.agenda_bucket.is_none());
    }

    #[test]
    fn recurring_task_legacy_serde() {
        let yaml = r#"id: "LEGACY04"
type: task
title: Legacy task
created: "2026-01-01T00:00:00+00:00"
updated: "2026-01-01T00:00:00+00:00"
list: inbox
"#;
        let fm: TaskFrontmatter = frontmatter::parse_fm(yaml).unwrap();
        assert!(fm.recurrence.is_none());
        assert!(fm.completion_history.is_empty());
    }

    fn daily(anchor: NaiveDate) -> TaskRecurrence {
        TaskRecurrence {
            editor_preset: None,
            series_id: "series".into(),
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: vec![],
            mode: RecurrenceMode::Scheduled,
            end: RecurrenceEnd::Never,
            anchor_due: DueDate::Date(anchor),
            sequence: 1,
        }
    }

    #[test]
    fn scheduled_repeat_skips_overdue_slots() {
        let rule = daily(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
        assert_eq!(
            next_recurrence_date(
                &rule,
                NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
                NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()
            ),
            Some(NaiveDate::from_ymd_opt(2026, 1, 6).unwrap())
        );
    }

    #[test]
    fn scheduled_repeat_preserves_calendar_anchor() {
        let mut rule = daily(NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
        rule.frequency = RecurrenceFrequency::Monthly;
        assert_eq!(
            next_recurrence_date(
                &rule,
                NaiveDate::from_ymd_opt(2026, 2, 28).unwrap(),
                NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
            ),
            Some(NaiveDate::from_ymd_opt(2026, 3, 31).unwrap())
        );
    }

    /// VG-P2 serde round-trip: a task file WITH all new P2 fields set correctly
    /// deserializes them, proving the new field layout is correct.
    #[test]
    fn serde_p2_fields_round_trip() {
        let yaml = r#"id: "NEW01"
type: task
title: New task
created: "2026-06-30T10:00:00+00:00"
updated: "2026-06-30T10:00:00+00:00"
status: todo
priority: medium
list: inbox
section_id: "section-abc"
tags:
  - work
  - urgent
position: "V"
reminders:
  - kind: relative
    value: "-1h"
  - kind: absolute
    value: "2026-07-01T09:00:00+00:00"
"#;
        let fm: TaskFrontmatter =
            frontmatter::parse_fm(yaml).expect("task YAML with all P2 fields must parse");

        assert_eq!(fm.section_id, Some("section-abc".to_string()));
        assert_eq!(fm.tags, vec!["work", "urgent"]);
        assert_eq!(fm.position, "V");
        assert_eq!(fm.reminders.len(), 2);
        assert_eq!(fm.reminders[0].kind, "relative");
        assert_eq!(fm.reminders[0].value, "-1h");
        assert_eq!(fm.reminders[1].kind, "absolute");
    }
}
