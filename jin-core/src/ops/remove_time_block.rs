//! Recoverably cancel a Time block and optionally return its Task to flexible work.

use chrono::Local;
use std::path::Path;

use crate::model::{AgendaBucket, Event, EventStatus, Task};
use crate::ops::{events, recoverable_operations};
use crate::store::{frontmatter, fs};
use crate::{Config, JinError, Result};

#[derive(Debug, Clone)]
pub struct RemoveTimeBlockResult {
    pub event: Event,
    pub originating_task: Option<Task>,
}

pub fn remove_time_block(
    root: &Path,
    event_id: &str,
    return_to_flexible: bool,
) -> Result<RemoveTimeBlockResult> {
    let operation_id = format!("remove-{}", crate::id::new_ulid());
    remove_time_block_with_operation_id(root, event_id, return_to_flexible, &operation_id)
}

pub fn remove_time_block_with_operation_id(
    root: &Path,
    event_id: &str,
    return_to_flexible: bool,
    operation_id: &str,
) -> Result<RemoveTimeBlockResult> {
    remove_time_block_with_operation_id_inner(
        root,
        event_id,
        return_to_flexible,
        operation_id,
        None,
    )
}

fn remove_time_block_with_operation_id_inner(
    root: &Path,
    event_id: &str,
    return_to_flexible: bool,
    operation_id: &str,
    failpoint: Option<recoverable_operations::OperationFailpoint>,
) -> Result<RemoveTimeBlockResult> {
    let cfg = Config::load(root)?;
    let events_dir = cfg.events_dir();
    let tasks_dir = cfg.tasks_dir();
    let build = || {
        let event_path = fs::find_event_path(&events_dir, event_id)?;
        let event_before = std::fs::read(&event_path)?;
        let mut event = fs::read_event(&event_path)?;
        events::ensure_mutable(&event)?;
        let task_id = event.frontmatter.derived_from.clone().ok_or_else(|| {
            JinError::InvalidInput("only a Time block can use remove-Time-block".to_string())
        })?;

        let mut targets = Vec::new();
        if return_to_flexible {
            let (eligible, _) = events::return_eligibility_unrecovered(root, &event)?;
            if !eligible {
                return Err(JinError::OperationConflict {
                    operation_id: operation_id.to_string(),
                    reason: "return-to-flexible eligibility changed; refresh event detail"
                        .to_string(),
                });
            }
            let task_path = fs::find_task_path(&tasks_dir, &task_id)?;
            let task_before = std::fs::read(&task_path)?;
            let mut task = fs::read_task(&task_path)?;
            task.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
            task.frontmatter.updated = Local::now().fixed_offset();
            targets.push(recoverable_operations::TargetPlan {
                canonical_path: task_path,
                before: Some(task_before),
                post: Some(frontmatter::render(&task.frontmatter, &task.body)?.into_bytes()),
            });
        }

        event.frontmatter.status = EventStatus::Cancelled;
        event.frontmatter.updated = Local::now().fixed_offset();
        event.frontmatter.sequence += 1;
        targets.insert(
            0,
            recoverable_operations::TargetPlan {
                canonical_path: event_path,
                before: Some(event_before),
                post: Some(frontmatter::render(&event.frontmatter, &event.body)?.into_bytes()),
            },
        );
        Ok((event.id().to_string(), targets))
    };
    let outcome = match failpoint {
        Some(failpoint) => recoverable_operations::execute_event_operation_with_failpoint(
            root,
            operation_id,
            "remove_time_block",
            failpoint,
            build,
        ),
        None => recoverable_operations::execute_event_operation(
            root,
            operation_id,
            "remove_time_block",
            build,
        ),
    }?;

    let event = events::get_event(&events_dir, &outcome.result_event_id)?;
    let originating_task = event
        .frontmatter
        .derived_from
        .as_deref()
        .and_then(|id| crate::ops::tasks::get_task(&tasks_dir, id).ok());
    Ok(RemoveTimeBlockResult {
        event,
        originating_task,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Priority, TaskStatus};
    use crate::ops::promote::{promote_with_operation_id, PromoteParams};
    use crate::ops::tasks::{create_task, CreateTaskParams};
    use chrono::NaiveDateTime;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Task, Event) {
        let vault = TempDir::new().unwrap();
        crate::ops::init(vault.path()).unwrap();
        let task = create_task(
            &vault.path().join("tasks"),
            CreateTaskParams {
                title: "Sovereign task".to_string(),
                body: "body".to_string(),
                priority: Some(Priority::High),
                tags: Some(vec!["calm".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        let event = promote_with_operation_id(
            vault.path(),
            task.id(),
            PromoteParams {
                start_dt: NaiveDateTime::parse_from_str("2026-08-26T09:00:00", "%Y-%m-%dT%H:%M:%S")
                    .unwrap(),
                tzid: None,
            },
            "setup-promote",
        )
        .unwrap();
        (vault, task, event)
    }

    #[test]
    fn remove_only() {
        let (vault, before, event) = setup();
        let result =
            remove_time_block_with_operation_id(vault.path(), event.id(), false, "remove-only")
                .unwrap();
        assert!(result.event.is_deleted());
        let after = crate::ops::tasks::get_task(&vault.path().join("tasks"), before.id()).unwrap();
        assert!(after.frontmatter.agenda_bucket.is_none());
        assert_eq!(after.frontmatter.status, TaskStatus::Todo);
    }

    #[test]
    fn remove_and_return() {
        let (vault, task, event) = setup();
        let result =
            remove_time_block_with_operation_id(vault.path(), event.id(), true, "remove-return")
                .unwrap();
        assert!(result.event.is_deleted());
        assert_eq!(
            result.originating_task.unwrap().frontmatter.agenda_bucket,
            Some(AgendaBucket::Flexible)
        );
        assert_eq!(task.frontmatter.status, TaskStatus::Todo);
    }

    #[test]
    fn preserves_task_fields() {
        let (vault, before, event) = setup();
        remove_time_block_with_operation_id(vault.path(), event.id(), true, "preserve-fields")
            .unwrap();
        let after = crate::ops::tasks::get_task(&vault.path().join("tasks"), before.id()).unwrap();
        assert_eq!(after.id(), before.id());
        assert_eq!(after.body, before.body);
        assert_eq!(after.frontmatter.status, before.frontmatter.status);
        assert_eq!(after.frontmatter.priority, before.frontmatter.priority);
        assert_eq!(after.frontmatter.list, before.frontmatter.list);
        assert_eq!(after.frontmatter.section_id, before.frontmatter.section_id);
        assert_eq!(after.frontmatter.tags, before.frontmatter.tags);
        assert_eq!(after.frontmatter.position, before.frontmatter.position);
        assert_eq!(after.frontmatter.parent, before.frontmatter.parent);
    }

    #[test]
    fn retry_idempotent() {
        let (vault, _task, event) = setup();
        let first =
            remove_time_block_with_operation_id(vault.path(), event.id(), true, "remove-retry")
                .unwrap();
        let second =
            remove_time_block_with_operation_id(vault.path(), event.id(), true, "remove-retry")
                .unwrap();
        assert_eq!(first.event.id(), second.event.id());
        assert_eq!(
            first.event.frontmatter.sequence,
            second.event.frontmatter.sequence
        );
    }

    #[test]
    fn recovers_partial_canonical_boundary() {
        let (vault, task, event) = setup();
        let event_path = fs::find_event_path(&vault.path().join("events"), event.id()).unwrap();
        let task_path = fs::find_task_path(&vault.path().join("tasks"), task.id()).unwrap();
        let event_before = std::fs::read(&event_path).unwrap();
        let task_before = std::fs::read(&task_path).unwrap();
        let mut event_post = event.clone();
        event_post.frontmatter.status = EventStatus::Cancelled;
        event_post.frontmatter.sequence += 1;
        let event_post_bytes = frontmatter::render(&event_post.frontmatter, &event_post.body)
            .unwrap()
            .into_bytes();
        let mut task_post = task.clone();
        task_post.frontmatter.agenda_bucket = Some(AgendaBucket::Flexible);
        let task_post_bytes = frontmatter::render(&task_post.frontmatter, &task_post.body)
            .unwrap()
            .into_bytes();
        recoverable_operations::stage_test_operation(
            vault.path(),
            "remove-crash",
            event.id(),
            vec![
                recoverable_operations::TargetPlan {
                    canonical_path: event_path.clone(),
                    before: Some(event_before),
                    post: Some(event_post_bytes.clone()),
                },
                recoverable_operations::TargetPlan {
                    canonical_path: task_path.clone(),
                    before: Some(task_before),
                    post: Some(task_post_bytes),
                },
            ],
        )
        .unwrap();
        fs::atomic_write(&event_path, &event_post_bytes).unwrap();

        let report = recoverable_operations::recover_incomplete_operations(vault.path()).unwrap();
        assert_eq!(report.completed, 1);
        assert!(fs::read_event(&event_path).unwrap().is_deleted());
        assert_eq!(
            fs::read_task(&task_path).unwrap().frontmatter.agenda_bucket,
            Some(AgendaBucket::Flexible)
        );
    }

    #[test]
    fn revalidates_eligibility() {
        let (vault, task, event) = setup();
        let mut another = events::build_event(
            events::CreateEventParams {
                title: "Another".to_string(),
                body: String::new(),
                start: crate::model::TemporalValue::DateTime(
                    NaiveDateTime::parse_from_str("2026-08-27T09:00:00", "%Y-%m-%dT%H:%M:%S")
                        .unwrap(),
                ),
                end: crate::model::TemporalValue::DateTime(
                    NaiveDateTime::parse_from_str("2026-08-27T10:00:00", "%Y-%m-%dT%H:%M:%S")
                        .unwrap(),
                ),
                start_value_type: crate::model::ValueType::DateTime,
                end_value_type: crate::model::ValueType::DateTime,
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
        another.frontmatter.derived_from = Some(task.id().to_string());
        fs::write_event(&vault.path().join("events"), &another).unwrap();

        let error =
            remove_time_block_with_operation_id(vault.path(), event.id(), true, "stale-return")
                .unwrap_err();
        assert!(matches!(
            error,
            JinError::OperationConflict {
                ref operation_id,
                ..
            } if operation_id == "stale-return"
        ));
        assert!(!events::get_event(&vault.path().join("events"), event.id())
            .unwrap()
            .is_deleted());
    }

    #[test]
    fn recovers_each_crash_boundary() {
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
            let (vault, task, event) = setup();
            let cfg = Config::load(vault.path()).unwrap();
            let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
            crate::sync::state::set_dirty(&sync, event.id(), false).unwrap();
            drop(sync);

            let operation_id = format!("remove-side-effect-{index}");
            assert!(remove_time_block_with_operation_id_inner(
                vault.path(),
                event.id(),
                true,
                &operation_id,
                Some(failpoint),
            )
            .is_err());
            assert!(events::get_event(&cfg.events_dir(), event.id())
                .unwrap()
                .is_deleted());
            let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
            assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
            drop(sync);

            let recovered = crate::ops::api::get_event(vault.path(), event.id()).unwrap();
            assert_eq!(recovered.status, "cancelled");
            let task = crate::ops::tasks::get_task(&cfg.tasks_dir(), task.id()).unwrap();
            assert_eq!(task.frontmatter.agenda_bucket, Some(AgendaBucket::Flexible));
            let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
            let dirty = crate::sync::state::list_dirty(&sync).unwrap();
            assert_eq!(dirty.len(), 1);
            assert_eq!(dirty[0].jin_id, event.id());
        }
    }
}
