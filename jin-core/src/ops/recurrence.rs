//! Durable recurrence planning. All images are built under the operation lock;
//! SQLite is only refreshed after the canonical owner and occurrences commit.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use sha2::{Digest, Sha256};

use super::recoverable_operations::{self, TargetPlan};
use crate::id::new_ulid;
use crate::model::task::{
    RecurrenceInstance, RecurrenceScope, RecurrenceSeries, RecurrenceTemplate,
};
use crate::model::{
    next_recurrence_date, DueDate, RecurrenceEnd, RecurrenceFrequency, RecurrenceMode, Task,
    TaskRecurrence, TaskStatus,
};
use crate::store::fs;
use crate::{Config, JinError, Result};

type Records = BTreeMap<String, Task>;

fn invalid(message: &str) -> JinError {
    JinError::InvalidInput(message.into())
}
fn date(due: &DueDate) -> NaiveDate {
    match due {
        DueDate::Date(d) => *d,
        DueDate::DateTime(d) => d.date_naive(),
    }
}
fn dated(anchor: &DueDate, day: NaiveDate) -> DueDate {
    match anchor {
        DueDate::Date(_) => DueDate::Date(day),
        DueDate::DateTime(dt) => {
            DueDate::DateTime(*dt + Duration::days((day - dt.date_naive()).num_days()))
        }
    }
}
fn load(cfg: &Config) -> Result<Records> {
    fs::list_task_paths(&cfg.tasks_dir())?
        .into_iter()
        .map(|p| fs::read_task(&p).map(|t| (t.id().to_owned(), t)))
        .collect()
}
fn children(records: &Records, id: &str) -> Vec<Task> {
    records
        .values()
        .filter(|t| t.parent() == Some(id) && !t.is_deleted())
        .cloned()
        .collect()
}
fn clean_template(task: &Task) -> RecurrenceTemplate {
    let mut fm = task.frontmatter.clone();
    fm.recurrence = None;
    fm.recurrence_series = None;
    fm.retired_recurrence_series.clear();
    fm.recurrence_instance = None;
    fm.recurrence_exception = false;
    fm.recurrence_baseline = None;
    fm.recurrence_retired_reason = None;
    fm.completion_history.clear();
    RecurrenceTemplate {
        frontmatter: Box::new(fm),
        body: task.body.clone(),
        children: vec![],
    }
}
fn snapshot(records: &Records, task: &Task) -> RecurrenceTemplate {
    let mut template = clean_template(task);
    template.children = children(records, task.id())
        .iter()
        .map(clean_template)
        .collect();
    template
}
fn normalized(task: &Task) -> Result<Vec<u8>> {
    let mut t = task.clone();
    // Scheduler state and volatile write times do not change occurrence content.
    t.frontmatter.updated = t.frontmatter.created;
    t.frontmatter.recurrence_series = None;
    t.frontmatter.retired_recurrence_series.clear();
    t.frontmatter.recurrence_baseline = None;
    serde_json::to_vec(&(t.frontmatter, t.body)).map_err(|e| JinError::Integrity(e.to_string()))
}
fn fingerprint(records: &Records, task: &Task) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update(normalized(task)?);
    for child in children(records, task.id()) {
        hash.update(normalized(&child)?);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn untouched(records: &Records, task: &Task) -> Result<bool> {
    Ok(task.frontmatter.status == TaskStatus::Todo
        && !task.frontmatter.recurrence_exception
        && task.frontmatter.recurrence_baseline.as_deref()
            == Some(fingerprint(records, task)?.as_str()))
}
fn instance(
    owner: &str,
    series: &RecurrenceSeries,
    sequence: u64,
    due: DueDate,
    predecessor: Option<String>,
) -> RecurrenceInstance {
    RecurrenceInstance {
        owner_task_id: owner.into(),
        series_id: series.series_id.clone(),
        revision: series.revision,
        sequence,
        originally_scheduled_due: due,
        completion_predecessor_id: predecessor,
        detached: false,
    }
}
fn create_series(
    records: &Records,
    task: &Task,
    mut rule: TaskRecurrence,
    enabled: bool,
) -> Result<RecurrenceSeries> {
    let due = task
        .frontmatter
        .due
        .clone()
        .ok_or_else(|| invalid("a repeating task needs a due date"))?;
    rule.validate().map_err(JinError::InvalidInput)?;
    rule.anchor_due = due.clone();
    rule.sequence = 1;
    Ok(RecurrenceSeries {
        upcoming_count: crate::model::task::default_recurrence_upcoming_count(),
        schema_version: 2,
        series_id: rule.series_id.clone(),
        enabled,
        revision: 1,
        rule,
        template: snapshot(records, task),
        next_sequence: 2,
        cursor: due,
        skipped_before: None,
        outstanding_task_id: task.id().into(),
    })
}
/// Initialize a newly-created record after its final identity is assigned.
pub(crate) fn initialize_created(task: &mut Task, count: Option<u16>) -> Result<()> {
    let Some(count) = count else {
        return Ok(());
    };
    crate::model::task::validate_recurrence_upcoming_count(count)
        .map_err(JinError::InvalidInput)?;
    let rule = task
        .frontmatter
        .recurrence
        .clone()
        .ok_or_else(|| invalid("upcoming entries require a Repeat rule"))?;
    let records = Records::from([(task.id().to_owned(), task.clone())]);
    let mut series = create_series(&records, task, rule, true)?;
    series.upcoming_count = count;
    task.frontmatter.recurrence_instance =
        Some(instance(task.id(), &series, 1, series.cursor.clone(), None));
    task.frontmatter.recurrence_series = Some(series);
    Ok(())
}
fn initialize(records: &mut Records) -> Result<()> {
    let legacy: Vec<_> = records
        .values()
        .filter(|t| {
            t.frontmatter.recurrence.is_some()
                && t.frontmatter.recurrence_instance.is_none()
                && t.frontmatter.recurrence_series.is_none()
        })
        .cloned()
        .collect();
    for mut task in legacy {
        let mut rule = task.frontmatter.recurrence.clone().expect("filtered");
        let mut enabled = !matches!(
            task.frontmatter.status,
            TaskStatus::Done | TaskStatus::Deleted | TaskStatus::Cancelled
        );
        if let RecurrenceEnd::Count { count } = rule.end {
            let completed: BTreeSet<_> = task
                .frontmatter
                .completion_history
                .iter()
                .filter(|h| h.series_id == rule.series_id)
                .map(|h| h.sequence)
                .collect();
            let remaining = count.saturating_sub(completed.len().min(u16::MAX as usize) as u16);
            enabled &= remaining > 0;
            rule.end = RecurrenceEnd::Count {
                count: remaining.max(1),
            };
        }
        let series = create_series(records, &task, rule, enabled)?;
        task.frontmatter.recurrence_instance =
            Some(instance(task.id(), &series, 1, series.cursor.clone(), None));
        task.frontmatter.recurrence = Some(series.rule.clone());
        task.frontmatter.recurrence_series = Some(series);
        records.insert(task.id().into(), task);
    }
    Ok(())
}
fn validate(records: &Records) -> Result<()> {
    let mut authorities = BTreeSet::new();
    let mut slots = BTreeSet::new();
    for t in records.values() {
        if let Some(series) = &t.frontmatter.recurrence_series {
            crate::model::task::validate_recurrence_upcoming_count(series.upcoming_count)
                .map_err(JinError::InvalidInput)?;
        }
        if let Some(s) = &t.frontmatter.recurrence_series {
            if s.schema_version != 2 || !authorities.insert(s.series_id.clone()) {
                return Err(invalid(
                    "missing, malformed or duplicate recurrence authority",
                ));
            }
            s.rule.validate().map_err(JinError::InvalidInput)?;
        }
        if let Some(i) = &t.frontmatter.recurrence_instance {
            if !slots.insert((i.series_id.clone(), i.revision, i.sequence)) {
                return Err(invalid(
                    "duplicate canonical recurrence slot; generation stopped",
                ));
            }
            let owner = records
                .get(&i.owner_task_id)
                .ok_or_else(|| invalid("missing canonical recurrence owner; generation stopped"))?;
            let known = owner
                .frontmatter
                .recurrence_series
                .iter()
                .chain(owner.frontmatter.retired_recurrence_series.iter())
                .any(|s| s.series_id == i.series_id);
            if !known {
                return Err(invalid(
                    "missing canonical recurrence authority; generation stopped",
                ));
            }
        }
    }
    Ok(())
}
/// Ordinal of a scheduled candidate, calculated without traversing old slots.
fn ordinal(rule: &TaskRecurrence, candidate: NaiveDate) -> u64 {
    let anchor = date(&rule.anchor_due);
    let interval = i64::from(rule.interval);
    match rule.frequency {
        RecurrenceFrequency::Daily => {
            1 + ((candidate - anchor).num_days() / interval).max(0) as u64
        }
        RecurrenceFrequency::Monthly => {
            1 + (((candidate.year() - anchor.year()) * 12 + candidate.month0() as i32
                - anchor.month0() as i32)
                / i32::from(rule.interval))
            .max(0) as u64
        }
        RecurrenceFrequency::Yearly => {
            1 + ((candidate.year() - anchor.year()) / i32::from(rule.interval)).max(0) as u64
        }
        RecurrenceFrequency::Weekly => {
            let mut days = rule.weekdays.clone();
            if days.is_empty() {
                days.push(anchor.weekday().number_from_monday());
            }
            days.sort_unstable();
            days.dedup();
            let monday = anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);
            let weeks = (candidate - monday).num_days().div_euclid(7);
            let block = weeks.div_euclid(interval);
            let first = days
                .iter()
                .filter(|d| **d > anchor.weekday().number_from_monday())
                .count() as u64;
            if block == 0 {
                1 + days
                    .iter()
                    .filter(|d| {
                        **d > anchor.weekday().number_from_monday()
                            && **d <= candidate.weekday().number_from_monday()
                    })
                    .count() as u64
            } else {
                1 + first
                    + (block - 1) as u64 * days.len() as u64
                    + days
                        .iter()
                        .filter(|d| **d <= candidate.weekday().number_from_monday())
                        .count() as u64
            }
        }
    }
}
fn allowed(series: &RecurrenceSeries, sequence: u64, day: NaiveDate) -> bool {
    match series.rule.end {
        RecurrenceEnd::Count { count } => sequence <= u64::from(count),
        RecurrenceEnd::Until { date } => day <= date,
        RecurrenceEnd::Never => true,
    }
}
// A complete occurrence carries its slot, optional predecessor, and operation clock.
#[allow(clippy::too_many_arguments)]
fn clone_occurrence(
    cfg: &Config,
    records: &mut Records,
    owner: &str,
    series: &RecurrenceSeries,
    sequence: u64,
    due: DueDate,
    predecessor: Option<String>,
    now: DateTime<Utc>,
) -> Result<String> {
    let template = &series.template;
    let mut fm = (*template.frontmatter).clone();
    fm.id = new_ulid();
    fm.created = now.fixed_offset();
    fm.updated = fm.created;
    fm.status = TaskStatus::Todo;
    fm.completed_at = None;
    fm.deleted_at = None;
    fm.parent = None;
    fm.position = String::new();
    fm.agenda_bucket = None;
    fm.due = Some(due.clone());
    fm.recurrence = Some(series.rule.clone());
    if let Some(r) = fm.recurrence.as_mut() {
        r.sequence = sequence.min(u64::from(u16::MAX)) as u16;
    }
    fm.recurrence_instance = Some(instance(owner, series, sequence, due.clone(), predecessor));
    let old_due = template.frontmatter.due.clone();
    fm.reminders.retain(|r| {
        r.kind == "relative"
            || (r.kind == "absolute"
                && old_due
                    .as_ref()
                    .is_some_and(|d| matches!(d,DueDate::DateTime(dt) if r.value==dt.to_rfc3339())))
    });
    super::tasks::reconcile_auto_due_reminder(&mut fm.reminders, &old_due, &Some(due));
    let list = fs::read_list(&fs::find_list_path(&cfg.lists_dir(), &fm.list)?)?;
    fm.board_column_id =
        if list.frontmatter.workflow_kind == Some(crate::model::list::WorkflowKind::Board) {
            Some(super::workflows::initial_column(&list)?.id.clone())
        } else {
            None
        };
    let id = fm.id.clone();
    let task = Task {
        frontmatter: fm,
        body: template.body.clone(),
    };
    records.insert(id.clone(), task);
    for child in &template.children {
        let mut fm = (*child.frontmatter).clone();
        fm.id = new_ulid();
        fm.parent = Some(id.clone());
        fm.created = now.fixed_offset();
        fm.updated = fm.created;
        fm.status = TaskStatus::Todo;
        fm.completed_at = None;
        fm.deleted_at = None;
        fm.due = None;
        fm.reminders.clear();
        fm.agenda_bucket = None;
        fm.board_column_id = None;
        fm.position = String::new();
        records.insert(
            fm.id.clone(),
            Task {
                frontmatter: fm,
                body: child.body.clone(),
            },
        );
    }
    let baseline = fingerprint(records, &records[&id])?;
    records
        .get_mut(&id)
        .expect("inserted")
        .frontmatter
        .recurrence_baseline = Some(baseline);
    Ok(id)
}
fn generate(cfg: &Config, records: &mut Records, now: DateTime<Utc>) -> Result<()> {
    let today = now
        .with_timezone(
            &cfg.display_tz
                .parse::<chrono_tz::Tz>()
                .unwrap_or(chrono_tz::UTC),
        )
        .date_naive();
    let owners: Vec<_> = records
        .values()
        .filter(|t| {
            t.frontmatter
                .recurrence_series
                .as_ref()
                .is_some_and(|s| s.enabled)
        })
        .map(|t| t.id().to_owned())
        .collect();
    for owner_id in owners {
        let mut owner = records[&owner_id].clone();
        let mut series = owner
            .frontmatter
            .recurrence_series
            .clone()
            .expect("filtered");
        let today = match &series.rule.anchor_due {
            DueDate::DateTime(dt) => now.with_timezone(dt.offset()).date_naive(),
            DueDate::Date(_) => today,
        };
        if owner.is_deleted() {
            series.enabled = false;
        } else if series.rule.mode == RecurrenceMode::Scheduled {
            let anchor = date(&series.rule.anchor_due);
            let planning_start = series.skipped_before.unwrap_or(today).max(today);
            series.skipped_before = Some(planning_start);
            let skipped_through = planning_start.pred_opt().unwrap_or(planning_start);
            let mut after = date(&series.cursor).max(skipped_through);
            // Save skipped ordinal consumption even if count/until prevents any
            // new file. Seeking ignores the end only for this cursor calculation;
            // materialization below always enforces the canonical end rule.
            let mut seek_rule = series.rule.clone();
            seek_rule.end = RecurrenceEnd::Never;
            let ordinal_boundary = match series.rule.end {
                RecurrenceEnd::Until { date } => after.min(date),
                _ => after,
            };
            if let Some(next) = next_recurrence_date(&seek_rule, anchor, ordinal_boundary) {
                let next_sequence = ordinal(&series.rule, next);
                let next_sequence = match series.rule.end {
                    RecurrenceEnd::Count { count } => next_sequence.min(u64::from(count) + 1),
                    _ => next_sequence,
                };
                series.next_sequence = series.next_sequence.max(next_sequence);
            }
            let mut upcoming = records
                .values()
                .filter(|t| {
                    matches!(t.frontmatter.status, TaskStatus::Todo | TaskStatus::Doing)
                        && t.frontmatter
                            .due
                            .as_ref()
                            .is_some_and(|due| date(due) >= today)
                        && t.frontmatter.recurrence_instance.as_ref().is_some_and(|i| {
                            i.series_id == series.series_id
                                && i.revision == series.revision
                                && !i.detached
                        })
                })
                .count();
            while let Some(day) = next_recurrence_date(&series.rule, anchor, after) {
                let sequence = ordinal(&series.rule, day);
                if !allowed(&series, sequence, day) {
                    break;
                }
                if upcoming >= usize::from(series.upcoming_count) {
                    break;
                }
                let exists = records.values().any(|t| {
                    t.frontmatter.recurrence_instance.as_ref().is_some_and(|i| {
                        i.series_id == series.series_id
                            && i.revision == series.revision
                            && i.sequence == sequence
                    })
                });
                let due = dated(&series.rule.anchor_due, day);
                if !exists {
                    clone_occurrence(
                        cfg,
                        records,
                        &owner_id,
                        &series,
                        sequence,
                        due.clone(),
                        None,
                        now,
                    )?;
                    upcoming += 1;
                }
                series.cursor = due;
                series.next_sequence = sequence + 1;
                after = day;
            }
        }
        owner.frontmatter.recurrence_series = Some(series);
        records.insert(owner_id, owner);
    }
    Ok(())
}
/// Scope operations run within the same transaction as the selected edit.
pub(crate) struct RuleEdit {
    pub selected: String,
    pub rule: Option<TaskRecurrence>,
    pub upcoming_count: Option<u16>,
    pub expected: Option<crate::model::task::RecurrenceRevision>,
    pub stop: bool,
    pub scope: Option<RecurrenceScope>,
}
fn retire(records: &mut Records, id: &str, reason: &str, now: DateTime<Utc>) -> Result<()> {
    let task = records[id].clone();
    if untouched(records, &task)? {
        let ids: Vec<_> = children(records, id)
            .iter()
            .map(|t| t.id().to_owned())
            .chain(std::iter::once(id.to_owned()))
            .collect();
        for key in ids {
            let t = records.get_mut(&key).expect("known");
            t.frontmatter.status = TaskStatus::Deleted;
            t.frontmatter.deleted_at = Some(now.fixed_offset());
            t.frontmatter.recurrence_retired_reason = Some(reason.into());
        }
    } else if let Some(t) = records.get_mut(id) {
        t.frontmatter.recurrence_exception = true;
        if let Some(i) = t.frontmatter.recurrence_instance.as_mut() {
            i.detached = true;
        }
    }
    Ok(())
}
fn scoped(records: &mut Records, edit: RuleEdit, now: DateTime<Utc>) -> Result<()> {
    let selected = records
        .get(&edit.selected)
        .ok_or_else(|| invalid("missing selected occurrence"))?
        .clone();
    let Some(i) = selected.frontmatter.recurrence_instance.clone() else {
        return Ok(());
    };
    let mut owner = records
        .get(&i.owner_task_id)
        .ok_or_else(|| invalid("missing recurrence owner"))?
        .clone();
    let mut series = owner
        .frontmatter
        .recurrence_series
        .clone()
        .ok_or_else(|| invalid("missing recurrence authority"))?;
    if let Some(expected) = &edit.expected {
        if expected.series_id != series.series_id
            || expected.revision != series.revision
            || expected.enabled != series.enabled
        {
            return Err(invalid(
                "Repeat changed elsewhere; reload repeat settings before applying changes",
            ));
        }
    }
    if let Some(count) = edit.upcoming_count {
        crate::model::task::validate_recurrence_upcoming_count(count)
            .map_err(JinError::InvalidInput)?;
    }
    if edit.rule.is_none() && !edit.stop {
        let owner_target = selected.id() == owner.id();
        if !series.enabled {
            return Err(invalid("enable Repeat before changing upcoming entries"));
        }
        if edit.scope != Some(RecurrenceScope::ThisAndFollowing) {
            return Err(invalid(
                "changing upcoming entries requires This and following scope",
            ));
        }
        if !owner_target
            && (i.series_id != series.series_id
                || i.revision != series.revision
                || i.detached
                || !matches!(
                    selected.frontmatter.status,
                    TaskStatus::Todo | TaskStatus::Doing
                ))
        {
            return Err(invalid(
                "select an active occurrence from the current recurrence revision",
            ));
        }
        series.upcoming_count = edit
            .upcoming_count
            .ok_or_else(|| invalid("missing upcoming entry count"))?;
        owner.frontmatter.recurrence_series = Some(series);
        records.insert(owner.id().into(), owner);
        return Ok(());
    }
    if !series.enabled {
        if edit.stop {
            return Ok(());
        }
        if !matches!(
            selected.frontmatter.status,
            TaskStatus::Todo | TaskStatus::Doing
        ) {
            return Err(invalid("select an active occurrence to enable Repeat"));
        }
        let mut rule = edit.rule.ok_or_else(|| invalid("missing Repeat rule"))?;
        rule.series_id = new_ulid();
        let mut replacement = create_series(records, &selected, rule, true)?;
        replacement.upcoming_count = edit.upcoming_count.unwrap_or(series.upcoming_count);
        let t = records.get_mut(selected.id()).expect("known");
        t.frontmatter.recurrence_instance = Some(instance(
            owner.id(),
            &replacement,
            1,
            replacement.cursor.clone(),
            None,
        ));
        t.frontmatter.recurrence = Some(replacement.rule.clone());
        t.frontmatter.recurrence_exception = false;
        t.frontmatter.recurrence_baseline = None;
        if owner.id() == selected.id() {
            owner = records[selected.id()].clone();
        }
        owner.frontmatter.retired_recurrence_series.push(series);
        owner.frontmatter.recurrence_series = Some(replacement);
        records.insert(owner.id().into(), owner);
        return Ok(());
    }
    let owner_stop = edit.stop && selected.id() == owner.id();
    if !owner_stop
        && (i.series_id != series.series_id || i.revision != series.revision || i.detached)
    {
        return Err(invalid(
            "select an occurrence from the current recurrence revision",
        ));
    }
    if !edit.stop {
        if edit.scope != Some(RecurrenceScope::ThisAndFollowing) {
            return Err(invalid("changing Repeat requires This and following scope"));
        }
        if !matches!(
            selected.frontmatter.status,
            TaskStatus::Todo | TaskStatus::Doing
        ) {
            return Err(invalid("select an active occurrence to change Repeat"));
        }
    }
    let future: Vec<_> = records
        .values()
        .filter(|t| {
            t.id() != selected.id()
                && t.frontmatter.recurrence_instance.as_ref().is_some_and(|x| {
                    x.series_id == series.series_id
                        && x.revision == series.revision
                        && (owner_stop
                            || if edit.stop {
                                x.sequence > i.sequence
                            } else {
                                x.sequence >= i.sequence
                            })
                })
                && !matches!(t.frontmatter.status, TaskStatus::Done | TaskStatus::Deleted)
        })
        .map(|t| t.id().to_owned())
        .collect();
    for id in future {
        retire(
            records,
            &id,
            if edit.stop {
                "series_stopped"
            } else {
                "series_rule_changed"
            },
            now,
        )?;
    }
    if edit.stop {
        series.enabled = false;
    } else {
        let mut rule = edit.rule.ok_or_else(|| invalid("missing Repeat rule"))?;
        rule.series_id = series.series_id.clone();
        let mut replacement = create_series(records, &selected, rule, true)?;
        replacement.revision = series.revision + 1;
        replacement.upcoming_count = edit.upcoming_count.unwrap_or(series.upcoming_count);
        let t = records.get_mut(selected.id()).expect("known");
        t.frontmatter.recurrence_instance = Some(instance(
            owner.id(),
            &replacement,
            1,
            replacement.cursor.clone(),
            None,
        ));
        t.frontmatter.recurrence = Some(replacement.rule.clone());
        t.frontmatter.recurrence_exception = false;
        t.frontmatter.recurrence_baseline = None;
        series = replacement;
    }
    // Preserve the selected owner edits when it is the authority itself.
    if owner.id() == selected.id() {
        owner = records[selected.id()].clone();
    }
    owner.frontmatter.recurrence_series = Some(series);
    records.insert(owner.id().to_owned(), owner);
    Ok(())
}
/// Expand an operation's staged task images into a complete atomic plan.
pub(crate) fn plan(
    cfg: &Config,
    plans: Vec<TargetPlan>,
    now: DateTime<Utc>,
    edit: Option<RuleEdit>,
    completion: Option<&str>,
) -> Result<Vec<TargetPlan>> {
    let before = load(cfg)?;
    let mut records = before.clone();
    initialize(&mut records)?;
    for p in &plans {
        if let Some(bytes) = &p.post {
            let text =
                std::str::from_utf8(bytes).map_err(|e| JinError::Integrity(e.to_string()))?;
            let (yaml, body) = crate::store::frontmatter::split(text)?;
            let mut t = Task {
                frontmatter: crate::store::frontmatter::parse_fm(&yaml)?,
                body,
            };
            if t.frontmatter.recurrence_instance.is_none() {
                if let Some(migrated) = records.get(t.id()) {
                    if migrated.frontmatter.recurrence_series.is_some()
                        && t.frontmatter.recurrence.as_ref().map(|r| &r.series_id)
                            == migrated
                                .frontmatter
                                .recurrence
                                .as_ref()
                                .map(|r| &r.series_id)
                    {
                        t.frontmatter.recurrence_series =
                            migrated.frontmatter.recurrence_series.clone();
                        t.frontmatter.recurrence_instance =
                            migrated.frontmatter.recurrence_instance.clone();
                    }
                }
            }
            if t.frontmatter.parent.is_some() {
                if let Some(i) = t.frontmatter.recurrence_instance.as_mut() {
                    i.detached = true;
                    t.frontmatter.recurrence_exception = true;
                }
            }
            if let Some(parent_id) = t.frontmatter.parent.clone() {
                if let Some(parent) = records.get_mut(&parent_id) {
                    if parent.frontmatter.recurrence_instance.is_some() {
                        parent.frontmatter.recurrence_exception = true;
                        t.frontmatter.recurrence_exception = true;
                    }
                }
            }
            records.insert(t.id().into(), t);
        }
    }
    initialize(&mut records)?;
    validate(&records)?;
    if let Some(edit) = edit {
        scoped(&mut records, edit, now)?;
    }
    // Deleting an owner disables its authority and retires only managed futures.
    let deleted: Vec<_> = records
        .values()
        .filter(|t| {
            t.is_deleted()
                && t.frontmatter
                    .recurrence_series
                    .as_ref()
                    .is_some_and(|s| s.enabled)
        })
        .map(|t| t.id().to_owned())
        .collect();
    for id in deleted {
        scoped(
            &mut records,
            RuleEdit {
                selected: id,
                rule: None,
                upcoming_count: None,
                expected: None,
                stop: true,
                scope: None,
            },
            now,
        )?;
    }
    if let Some(id) = completion {
        let selected = records[id].clone();
        if let Some(i) = &selected.frontmatter.recurrence_instance {
            let owner_id = i.owner_task_id.clone();
            let mut owner = records[&owner_id].clone();
            let mut series = owner
                .frontmatter
                .recurrence_series
                .clone()
                .expect("validated");
            if series.enabled
                && series.rule.mode == RecurrenceMode::Completion
                && i.series_id == series.series_id
                && i.revision == series.revision
                && !i.detached
                && series.outstanding_task_id == id
            {
                let clock = match &selected.frontmatter.due {
                    Some(DueDate::DateTime(d)) => DueDate::DateTime(now.with_timezone(d.offset())),
                    _ => DueDate::Date(
                        now.with_timezone(
                            &cfg.display_tz
                                .parse::<chrono_tz::Tz>()
                                .unwrap_or(chrono_tz::UTC),
                        )
                        .date_naive(),
                    ),
                };
                let mut rule = series.rule.clone();
                rule.anchor_due = clock.clone();
                if let Some(day) = next_recurrence_date(&rule, date(&clock), date(&clock)) {
                    let sequence = series.next_sequence;
                    if allowed(&series, sequence, day) {
                        let existing = records
                            .values()
                            .find(|t| {
                                t.frontmatter.recurrence_instance.as_ref().is_some_and(|x| {
                                    x.series_id == series.series_id
                                        && x.completion_predecessor_id.as_deref() == Some(id)
                                })
                            })
                            .map(|t| t.id().to_owned());
                        let successor = if let Some(id) = existing {
                            id
                        } else {
                            clone_occurrence(
                                cfg,
                                &mut records,
                                &owner_id,
                                &series,
                                sequence,
                                dated(&clock, day),
                                Some(id.into()),
                                now,
                            )?
                        };
                        series.outstanding_task_id = successor;
                        series.next_sequence = sequence + 1;
                    }
                }
                if owner.id() == selected.id() {
                    owner = records[id].clone();
                }
                owner.frontmatter.recurrence_series = Some(series);
                records.insert(owner_id, owner);
            }
        }
    }
    generate(cfg, &mut records, now)?;
    validate(&records)?;
    let mut output = Vec::new();
    for (id, t) in records {
        let post = fs::render_task_bytes(&t)?;
        let original = before.get(&id).map(fs::render_task_bytes).transpose()?;
        if original.as_ref() == Some(&post) {
            continue;
        }
        let path = if before.contains_key(&id) {
            fs::find_task_path(&cfg.tasks_dir(), &id)?
        } else {
            cfg.tasks_dir().join(fs::task_filename(&id))
        };
        let bytes = if before.contains_key(&id) {
            Some(std::fs::read(&path)?)
        } else {
            None
        };
        output.push(TargetPlan {
            canonical_path: path,
            before: bytes,
            post: Some(post),
        });
    }
    Ok(output)
}

/// Run headless maintenance, returning whether canonical records changed.
pub fn maintain_task_recurrences(root: &Path, now: DateTime<Utc>) -> Result<bool> {
    let cfg = Config::load(root)?;
    if load(&cfg)?
        .values()
        .any(|t| t.frontmatter.recurrence.is_some() || t.frontmatter.recurrence_series.is_some())
    {
        super::lists::ensure_default_list_for_root(root)?;
    }
    let outcome = recoverable_operations::execute_task_operation_allow_noop(
        root,
        &new_ulid(),
        "task_recurrence_maintenance",
        || Ok((String::new(), plan(&cfg, vec![], now, None, None)?)),
    )?;
    Ok(outcome.had_targets)
}

/// Read-only before-image used to report actual effects of a public mutation.
pub struct TaskMutationSnapshot {
    records: Records,
}
pub fn mutation_snapshot(root: &Path) -> Result<TaskMutationSnapshot> {
    super::api::recover_before_read(root)?;
    Ok(TaskMutationSnapshot {
        records: load(&Config::load(root)?)?,
    })
}
pub fn mutation_dto(
    root: &Path,
    task: &Task,
    before: &TaskMutationSnapshot,
) -> Result<crate::dto::TaskDto> {
    let records = load(&Config::load(root)?)?;
    let mut dto = crate::dto::TaskDto::from_model(records.get(task.id()).unwrap_or(task));
    if let Some(i) = &dto.recurrence_instance {
        let mut effect = crate::dto::task::RecurrenceEffectDto::default();
        for (id, t) in &records {
            let Some(instance) = &t.frontmatter.recurrence_instance else {
                continue;
            };
            if instance.series_id != i.series_id {
                continue;
            }
            if !before.records.contains_key(id) {
                effect.created_ids.push(id.clone());
            }
            if t.is_deleted() && before.records.get(id).is_some_and(|t| !t.is_deleted()) {
                effect.retired_count += 1;
            }
            if instance.detached
                && before.records.get(id).is_some_and(|t| {
                    t.frontmatter
                        .recurrence_instance
                        .as_ref()
                        .is_some_and(|i| !i.detached)
                })
            {
                effect.preserved_exception_count += 1;
            }
        }
        let next = records
            .values()
            .filter(|t| {
                !matches!(
                    t.frontmatter.status,
                    TaskStatus::Deleted | TaskStatus::Cancelled
                ) && t.frontmatter.recurrence_instance.as_ref().is_some_and(|x| {
                    x.series_id == i.series_id
                        && x.revision == i.revision
                        && x.sequence > i.sequence
                        && !x.detached
                })
            })
            .min_by_key(|t| {
                t.frontmatter
                    .recurrence_instance
                    .as_ref()
                    .map(|x| x.sequence)
            });
        if let Some(next) = next {
            effect.next_occurrence_id = Some(next.id().into());
            effect.next_due = next.frontmatter.due.as_ref().map(|d| match d {
                DueDate::Date(d) => d.to_string(),
                DueDate::DateTime(d) => d.to_rfc3339(),
            });
        }
        dto.recurrence_effect = Some(effect);
    }
    Ok(dto)
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use crate::ops::{self, tasks::CreateTaskParams};
    #[test]
    fn recurrence_journal_recovers_before_after_write_and_before_refresh_without_duplicates() {
        for written in [0, 1, usize::MAX] {
            let root = tempfile::TempDir::new().unwrap();
            ops::init(root.path()).unwrap();
            super::super::lists::ensure_default_list_for_root(root.path()).unwrap();
            let cfg = Config::load(root.path()).unwrap();
            let today = Utc::now().date_naive();
            let task = super::super::tasks::prepare_new_task(
                &cfg.tasks_dir(),
                CreateTaskParams {
                    title: "Recover me".into(),
                    due: Some(DueDate::Date(today)),
                    recurrence: Some(TaskRecurrence {
                        editor_preset: None,
                        series_id: String::new(),
                        frequency: RecurrenceFrequency::Daily,
                        interval: 1,
                        weekdays: vec![],
                        mode: RecurrenceMode::Scheduled,
                        end: RecurrenceEnd::Count { count: 3 },
                        anchor_due: DueDate::Date(today),
                        sequence: 1,
                    }),
                    ..Default::default()
                },
                None,
                TaskStatus::Todo,
            )
            .unwrap();
            let plans = plan(
                &cfg,
                vec![TargetPlan {
                    canonical_path: cfg.tasks_dir().join(fs::task_filename(task.id())),
                    before: None,
                    post: Some(fs::render_task_bytes(&task).unwrap()),
                }],
                Utc::now(),
                None,
                None,
            )
            .unwrap();
            let images: Vec<_> = plans
                .iter()
                .map(|p| (p.canonical_path.clone(), p.post.clone().unwrap()))
                .collect();
            recoverable_operations::stage_test_operation(
                root.path(),
                "recurrence-crash",
                "",
                plans,
            )
            .unwrap();
            for (path, bytes) in images.iter().take(written) {
                std::fs::write(path, bytes).unwrap();
            }
            recoverable_operations::recover_incomplete_operations(root.path()).unwrap();
            let records = load(&cfg).unwrap();
            assert_eq!(records.len(), 3);
            validate(&records).unwrap();
            assert!(!maintain_task_recurrences(root.path(), Utc::now()).unwrap());
            assert_eq!(load(&cfg).unwrap().len(), 3);
        }
    }
    #[test]
    fn static_index_rebuild_never_generates_or_changes_canonical_tasks() {
        let root = tempfile::TempDir::new().unwrap();
        ops::init(root.path()).unwrap();
        let cfg = Config::load(root.path()).unwrap();
        let today = Utc::now().date_naive();
        super::super::tasks::create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Static legacy".into(),
                due: Some(DueDate::Date(today)),
                recurrence: Some(TaskRecurrence {
                    editor_preset: None,
                    series_id: String::new(),
                    frequency: RecurrenceFrequency::Daily,
                    interval: 1,
                    weekdays: vec![],
                    mode: RecurrenceMode::Scheduled,
                    end: RecurrenceEnd::Never,
                    anchor_due: DueDate::Date(today),
                    sequence: 1,
                }),
                ..Default::default()
            },
        )
        .unwrap();
        let paths = fs::list_task_paths(&cfg.tasks_dir()).unwrap();
        let bytes: Vec<_> = paths.iter().map(|p| std::fs::read(p).unwrap()).collect();
        let mut connection = crate::index::open(&cfg.index_path()).unwrap();
        crate::index::rebuild::rebuild(&mut connection, root.path()).unwrap();
        assert_eq!(fs::list_task_paths(&cfg.tasks_dir()).unwrap(), paths);
        for (path, expected) in paths.iter().zip(bytes) {
            assert_eq!(std::fs::read(path).unwrap(), expected);
        }
    }
    #[test]
    fn arithmetic_seek_decades_old_daily_and_sparse_weekly_is_bounded() {
        let anchor = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
        let now = NaiveDate::from_ymd_opt(2090, 1, 1).unwrap();
        let mut r = TaskRecurrence {
            editor_preset: None,
            series_id: "seek".into(),
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekdays: vec![],
            mode: RecurrenceMode::Scheduled,
            end: RecurrenceEnd::Never,
            anchor_due: DueDate::Date(anchor),
            sequence: 1,
        };
        let next = next_recurrence_date(&r, anchor, now).unwrap();
        assert_eq!(ordinal(&r, next), (next - anchor).num_days() as u64 + 1);
        r.frequency = RecurrenceFrequency::Weekly;
        r.interval = u16::MAX;
        r.weekdays = vec![1, 3, 5];
        let next = next_recurrence_date(&r, anchor, now).unwrap();
        assert!(next > now);
        assert!(ordinal(&r, next) > 1);
    }
}
