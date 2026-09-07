//! Recoverably promote a Task into a linked Time block.

use chrono::{Duration, Local, NaiveDateTime};
use std::path::Path;

use crate::google::account::EventSyncTarget;
use crate::model::event::{Event, TemporalValue, ValueType};
use crate::model::AgendaBucket;
use crate::ops::{events, recoverable_operations};
use crate::store::{frontmatter, fs};
use crate::{Config, JinError, Result};

pub struct PromoteParams {
    pub start_dt: NaiveDateTime,
    pub tzid: Option<String>,
}

pub fn promote(root: &Path, task_id: &str, params: PromoteParams) -> Result<Event> {
    let operation_id = format!("promote-{}", crate::id::new_ulid());
    promote_with_operation_id(root, task_id, params, &operation_id)
}

pub fn promote_with_operation_id(
    root: &Path,
    task_id: &str,
    params: PromoteParams,
    operation_id: &str,
) -> Result<Event> {
    promote_with_destination_and_operation_id(root, task_id, params, None, false, operation_id)
}

pub fn promote_with_destination_and_operation_id(
    root: &Path,
    task_id: &str,
    params: PromoteParams,
    explicit_target: Option<EventSyncTarget>,
    local_only: bool,
    operation_id: &str,
) -> Result<Event> {
    let cfg = Config::load(root)?;
    let writable = cfg.google_registry.writable_destinations();
    let target = match explicit_target {
        Some(target) => {
            if !writable.contains(&target) {
                return Err(JinError::InvalidInput(
                    "selected promotion destination is not writable".to_string(),
                ));
            }
            Some(target)
        }
        None if local_only => None,
        None if writable.len() > 1 => {
            return Err(JinError::AmbiguousDestination {
                count: writable.len(),
            });
        }
        None => writable.into_iter().next(),
    };
    let event = promote_with_operation_id_inner(root, task_id, params, operation_id, None)?;
    if let Some(target) = target {
        return crate::ops::event_mutation::EventMutationService::new(root)?.publish_existing(
            event.id(),
            target,
            &format!("{operation_id}-publish"),
        );
    }
    Ok(event)
}

fn promote_with_operation_id_inner(
    root: &Path,
    task_id: &str,
    params: PromoteParams,
    operation_id: &str,
    failpoint: Option<recoverable_operations::OperationFailpoint>,
) -> Result<Event> {
    let cfg = Config::load(root)?;
    if let Some(ref tzid) = params.tzid {
        crate::time::validate_tzid(tzid).map_err(|reason| JinError::InvalidTimezone {
            tzid: tzid.clone(),
            reason,
        })?;
    }
    let proposed_event_id = crate::id::new_ulid();
    let tasks_dir = cfg.tasks_dir();
    let events_dir = cfg.events_dir();
    let start_dt = params.start_dt;
    let tzid = params.tzid;

    let build = || {
        let task_path = fs::find_task_path(&tasks_dir, task_id)?;
        let task_before = std::fs::read(&task_path)?;
        let mut task = fs::read_task(&task_path)?;
        if task.is_deleted() {
            return Err(JinError::InvalidStateTransition {
                from: "deleted".to_string(),
                to: "event".to_string(),
            });
        }

        let existing = events::list_events(&events_dir, false)?
            .into_iter()
            .find(|event| event.frontmatter.derived_from.as_deref() == Some(task_id));
        let event = if let Some(existing) = existing {
            existing
        } else {
            let mut event = events::build_event(
                events::CreateEventParams {
                    title: task.title().to_string(),
                    body: String::new(),
                    start: TemporalValue::DateTime(start_dt),
                    end: TemporalValue::DateTime(start_dt + Duration::hours(1)),
                    start_value_type: ValueType::DateTime,
                    end_value_type: ValueType::DateTime,
                    is_all_day: false,
                    start_tzid: tzid.clone(),
                    end_tzid: tzid.clone(),
                    floating: tzid.is_none(),
                    ical_uid: None,
                    description: None,
                    location: None,
                    attendees: None,
                    conference_data: None,
                    reminders: None,
                },
                Some(proposed_event_id.clone()),
            )?;
            event.frontmatter.derived_from = Some(task_id.to_string());
            event
        };

        let mut targets = Vec::new();
        let event_path = events_dir.join(fs::event_filename(event.id()));
        if !event_path.exists() {
            targets.push(recoverable_operations::TargetPlan {
                canonical_path: event_path,
                before: None,
                post: Some(frontmatter::render(&event.frontmatter, &event.body)?.into_bytes()),
            });
        }
        if task.frontmatter.agenda_bucket == Some(AgendaBucket::Flexible) {
            task.frontmatter.agenda_bucket = None;
            task.frontmatter.updated = Local::now().fixed_offset();
            targets.push(recoverable_operations::TargetPlan {
                canonical_path: task_path,
                before: Some(task_before),
                post: Some(frontmatter::render(&task.frontmatter, &task.body)?.into_bytes()),
            });
        }
        Ok((event.id().to_string(), targets))
    };
    let outcome = match failpoint {
        Some(failpoint) => recoverable_operations::execute_event_operation_with_failpoint(
            root,
            operation_id,
            "create_time_block",
            failpoint,
            build,
        ),
        None => recoverable_operations::execute_event_operation(
            root,
            operation_id,
            "create_time_block",
            build,
        ),
    }?;

    events::get_event(&events_dir, &outcome.result_event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Task;
    use crate::ops::tasks::{create_task, CreateTaskParams};
    use tempfile::TempDir;

    fn setup_task() -> (TempDir, Task) {
        let vault = TempDir::new().unwrap();
        crate::ops::init(vault.path()).unwrap();
        let mut task = create_task(
            &vault.path().join("tasks"),
            CreateTaskParams {
                title: "Plan quietly".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        task.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
        fs::write_task(&vault.path().join("tasks"), &task).unwrap();
        (vault, task)
    }

    fn params() -> PromoteParams {
        PromoteParams {
            start_dt: NaiveDateTime::parse_from_str("2026-08-26T09:00:00", "%Y-%m-%dT%H:%M:%S")
                .unwrap(),
            tzid: None,
        }
    }

    #[test]
    fn successful_block_clears_flexible() {
        let (vault, task) = setup_task();
        let event =
            promote_with_operation_id(vault.path(), task.id(), params(), "create-one").unwrap();
        assert_eq!(event.frontmatter.derived_from.as_deref(), Some(task.id()));
        let task = crate::ops::tasks::get_task(&vault.path().join("tasks"), task.id()).unwrap();
        assert!(task.frontmatter.agenda_bucket.is_none());
    }

    #[test]
    fn recovers_partial_canonical_boundary() {
        let (vault, task) = setup_task();
        let tasks_dir = vault.path().join("tasks");
        let events_dir = vault.path().join("events");
        let task_path = fs::find_task_path(&tasks_dir, task.id()).unwrap();
        let task_before = std::fs::read(&task_path).unwrap();
        let mut task_post = task.clone();
        task_post.frontmatter.agenda_bucket = None;
        let task_post_bytes = frontmatter::render(&task_post.frontmatter, &task_post.body)
            .unwrap()
            .into_bytes();
        let start = params().start_dt;
        let mut event = events::build_event(
            events::CreateEventParams {
                title: task.title().to_string(),
                body: String::new(),
                start: TemporalValue::DateTime(start),
                end: TemporalValue::DateTime(start + Duration::hours(1)),
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
            None,
        )
        .unwrap();
        event.frontmatter.derived_from = Some(task.id().to_string());
        let event_path = events_dir.join(fs::event_filename(event.id()));
        let event_post = frontmatter::render(&event.frontmatter, &event.body)
            .unwrap()
            .into_bytes();
        recoverable_operations::stage_test_operation(
            vault.path(),
            "create-crash",
            event.id(),
            vec![
                recoverable_operations::TargetPlan {
                    canonical_path: event_path.clone(),
                    before: None,
                    post: Some(event_post.clone()),
                },
                recoverable_operations::TargetPlan {
                    canonical_path: task_path.clone(),
                    before: Some(task_before),
                    post: Some(task_post_bytes),
                },
            ],
        )
        .unwrap();
        fs::atomic_write(&event_path, &event_post).unwrap();

        let report = recoverable_operations::recover_incomplete_operations(vault.path()).unwrap();
        assert_eq!(report.completed, 1);
        assert!(event_path.exists());
        assert!(fs::read_task(&task_path)
            .unwrap()
            .frontmatter
            .agenda_bucket
            .is_none());
    }

    #[test]
    fn recovers_each_create_boundary() {
        use recoverable_operations::OperationFailpoint::{
            ConvergenceBeforeIndex, FinalRenameBeforeConvergenceRecord, IndexBeforeSync,
        };

        for (index, failpoint) in [
            FinalRenameBeforeConvergenceRecord,
            ConvergenceBeforeIndex,
            IndexBeforeSync,
        ]
        .into_iter()
        .enumerate()
        {
            let (vault, task) = setup_task();
            let operation_id = format!("create-side-effect-{index}");
            assert!(promote_with_operation_id_inner(
                vault.path(),
                task.id(),
                params(),
                &operation_id,
                Some(failpoint),
            )
            .is_err());

            let event = events::list_events(&vault.path().join("events"), false)
                .unwrap()
                .into_iter()
                .next()
                .expect("canonical Event converged before every injected crash");
            let cfg = Config::load(vault.path()).unwrap();
            let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
            assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
            drop(sync);

            let recovered = crate::ops::api::get_event(vault.path(), event.id()).unwrap();
            assert_eq!(recovered.id, event.id());
            let task = crate::ops::tasks::get_task(&cfg.tasks_dir(), task.id()).unwrap();
            assert!(task.frontmatter.agenda_bucket.is_none());
            let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
            let dirty = crate::sync::state::list_dirty(&sync).unwrap();
            assert_eq!(dirty.len(), 1);
            assert_eq!(dirty[0].jin_id, event.id());
            assert_eq!(
                recoverable_operations::recover_incomplete_operations(vault.path())
                    .unwrap()
                    .completed,
                0
            );
        }
    }
}
