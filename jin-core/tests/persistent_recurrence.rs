//! Acceptance anchors for durable occurrences. Assertions describe persisted
//! user records and lifecycle effects rather than implementation internals.
use chrono::{Duration, NaiveDate, Utc};
use jin_core::model::task::{RecurrenceScope, Reminder, TaskCompletion};
use jin_core::{
    model::{
        DueDate, RecurrenceEnd, RecurrenceFrequency, RecurrenceMode, Task, TaskRecurrence,
        TaskStatus,
    },
    ops::{self, api, recurrence, tasks, workflows},
    store::fs,
    Config,
};
use tempfile::TempDir;
fn root() -> TempDir {
    let t = TempDir::new().unwrap();
    ops::init(t.path()).unwrap();
    t
}
fn today() -> NaiveDate {
    Utc::now().date_naive()
}
fn rule(d: NaiveDate, count: Option<u16>, mode: RecurrenceMode) -> TaskRecurrence {
    TaskRecurrence {
        editor_preset: None,
        series_id: String::new(),
        frequency: RecurrenceFrequency::Daily,
        interval: 1,
        weekdays: vec![],
        mode,
        end: count
            .map(|count| RecurrenceEnd::Count { count })
            .unwrap_or(RecurrenceEnd::Never),
        anchor_due: DueDate::Date(d),
        sequence: 1,
    }
}
fn create(t: &TempDir, count: Option<u16>, mode: RecurrenceMode) -> Task {
    let d = today();
    workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Water plants".into(),
            body: "Keep this content".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(rule(d, count, mode)),
            ..Default::default()
        },
        None,
    )
    .unwrap()
}
fn all(t: &TempDir) -> Vec<Task> {
    tasks::list_tasks(
        &Config::load(t.path()).unwrap().tasks_dir(),
        None,
        None,
        true,
    )
    .unwrap()
}
fn get(t: &TempDir, id: &str) -> Task {
    tasks::get_task(&Config::load(t.path()).unwrap().tasks_dir(), id).unwrap()
}
fn stop(t: &TempDir, id: &str) {
    workflows::edit_task(
        t.path(),
        id,
        tasks::EditTaskParams {
            clear_recurrence: true,
            ..Default::default()
        },
    )
    .unwrap();
}
fn sequence(t: &Task) -> u64 {
    t.frontmatter.recurrence_instance.as_ref().unwrap().sequence
}
#[test]
fn scheduled_repeat_saves_real_futures_and_keeps_done_original() {
    let t = root();
    let original = create(&t, None, RecurrenceMode::Scheduled);
    let initial = all(&t);
    assert!(
        initial.len() == 10,
        "daily planning must keep the configured default of ten upcoming entries"
    );
    let ids: std::collections::BTreeSet<_> = initial.iter().map(|t| t.id()).collect();
    assert_eq!(ids.len(), initial.len());
    assert!(initial
        .iter()
        .any(|t| t.frontmatter.due == Some(DueDate::Date(today() + Duration::days(9)))));
    let done = workflows::transition_task(t.path(), original.id(), TaskStatus::Done).unwrap();
    assert_eq!(done.id(), original.id());
    assert_eq!(done.frontmatter.status, TaskStatus::Done);
    assert_eq!(done.frontmatter.due, original.frontmatter.due);
    assert_eq!(done.body, original.body);
    api::refresh(t.path()).unwrap();
    let saved = get(&t, original.id());
    assert_eq!(saved.frontmatter.status, TaskStatus::Done);
    assert_eq!(all(&t).len(), initial.len() + 1);
    assert!(!recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap());
}
#[test]
fn yearly_far_future_has_next_durable_occurrence() {
    let t = root();
    let d = today() + Duration::days(180);
    let mut r = rule(d, None, RecurrenceMode::Scheduled);
    r.frequency = RecurrenceFrequency::Yearly;
    let original = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Annual".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(r),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let tasks = all(&t);
    assert_eq!(tasks.len(), 10);
    assert!(tasks.iter().any(
        |t| t.id() != original.id() && t.frontmatter.due.as_ref().unwrap() != &DueDate::Date(d)
    ));
    assert!(!recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap());
}
#[test]
fn completion_mode_waits_then_creates_one_distinct_successor_and_reopen_deduplicates() {
    let t = root();
    let original = create(&t, Some(3), RecurrenceMode::Completion);
    assert_eq!(all(&t).len(), 1);
    let completed = Utc::now();
    workflows::transition_task_at(t.path(), original.id(), TaskStatus::Done, completed).unwrap();
    let successor = all(&t)
        .into_iter()
        .find(|t| t.id() != original.id())
        .unwrap();
    assert_eq!(successor.frontmatter.status, TaskStatus::Todo);
    assert_eq!(
        successor.frontmatter.due,
        Some(DueDate::Date(completed.date_naive() + Duration::days(1)))
    );
    workflows::transition_task(t.path(), original.id(), TaskStatus::Todo).unwrap();
    workflows::transition_task_at(
        t.path(),
        original.id(),
        TaskStatus::Done,
        completed + Duration::days(5),
    )
    .unwrap();
    assert_eq!(all(&t).len(), 2);
    assert_eq!(
        get(&t, successor.id()).frontmatter.due,
        successor.frontmatter.due
    );
    workflows::delete_task(t.path(), successor.id()).unwrap();
    recurrence::maintain_task_recurrences(t.path(), completed + Duration::days(7)).unwrap();
    assert_eq!(all(&t).len(), 2);
}
#[test]
fn completion_count_one_never_creates_successor() {
    let t = root();
    let original = create(&t, Some(1), RecurrenceMode::Completion);
    workflows::transition_task(t.path(), original.id(), TaskStatus::Done).unwrap();
    assert_eq!(all(&t).len(), 1);
    assert_eq!(get(&t, original.id()).frontmatter.status, TaskStatus::Done);
}
#[test]
fn finite_slots_survive_deletion_and_count_is_not_replenished() {
    let t = root();
    let original = create(&t, Some(3), RecurrenceMode::Scheduled);
    assert_eq!(all(&t).len(), 3);
    let future = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    workflows::delete_task(t.path(), future.id()).unwrap();
    recurrence::maintain_task_recurrences(t.path(), Utc::now() + Duration::days(40)).unwrap();
    assert_eq!(all(&t).len(), 3);
    assert_eq!(get(&t, original.id()).frontmatter.status, TaskStatus::Todo);
    assert!(get(&t, future.id()).is_deleted());
}
#[test]
fn occurrence_due_edits_preserve_anchor_and_rule_without_implicit_clear() {
    let t = root();
    let original = create(&t, Some(3), RecurrenceMode::Scheduled);
    let future = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    let updated = workflows::edit_task(
        t.path(),
        future.id(),
        tasks::EditTaskParams {
            due: Some(None),
            title: Some("Exception".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(updated.frontmatter.due.is_none());
    assert!(updated.frontmatter.recurrence_exception);
    let owner = get(&t, original.id());
    assert!(owner.frontmatter.recurrence_series.unwrap().enabled);
    stop(&t, original.id());
    assert!(!get(&t, future.id()).is_deleted());
    assert_eq!(get(&t, future.id()).title(), "Exception");
}
#[test]
fn raw_markdown_parent_and_child_edits_survive_stop_and_owner_delete() {
    let t = root();
    let cfg = Config::load(t.path()).unwrap();
    let original = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Routine".into(),
            due: Some(DueDate::Date(today())),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let child = tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Checklist".into(),
            parent: Some(original.id().into()),
            due: Some(DueDate::Date(today())),
            reminders: Some(vec![Reminder {
                kind: "relative".into(),
                value: "-1h".into(),
            }]),
            ..Default::default()
        },
    )
    .unwrap();
    workflows::edit_task(
        t.path(),
        original.id(),
        tasks::EditTaskParams {
            recurrence: Some(rule(today(), Some(4), RecurrenceMode::Scheduled)),
            ..Default::default()
        },
    )
    .unwrap();
    let future = all(&t)
        .into_iter()
        .find(|t| t.parent().is_none() && sequence(t) == 2)
        .unwrap();
    let mut edited_child = all(&t)
        .into_iter()
        .find(|t| t.parent() == Some(future.id()))
        .unwrap();
    assert_ne!(edited_child.id(), child.id());
    assert!(edited_child.frontmatter.due.is_none());
    assert!(edited_child.frontmatter.reminders.is_empty());
    edited_child.body = "Hand-written content".into();
    fs::write_task(&cfg.tasks_dir(), &edited_child).unwrap();
    let untouched = all(&t)
        .into_iter()
        .find(|t| t.parent().is_none() && sequence(t) == 3)
        .unwrap();
    workflows::delete_task(t.path(), original.id()).unwrap();
    assert!(!get(&t, future.id()).is_deleted());
    assert_eq!(get(&t, edited_child.id()).body, "Hand-written content");
    assert!(get(&t, untouched.id()).is_deleted());
    assert!(
        !get(&t, original.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .enabled
    );
    recurrence::maintain_task_recurrences(t.path(), Utc::now() + Duration::days(200)).unwrap();
    assert!(!get(&t, future.id()).is_deleted());
}
#[test]
fn revision_retires_only_untouched_futures_and_rejects_old_revision_scope() {
    let t = root();
    let owner = create(&t, Some(5), RecurrenceMode::Scheduled);
    let selected = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    let edited = all(&t).into_iter().find(|t| sequence(t) == 4).unwrap();
    workflows::edit_task(
        t.path(),
        edited.id(),
        tasks::EditTaskParams {
            body: Some("My future plan".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let mut r = rule(today(), Some(2), RecurrenceMode::Scheduled);
    r.interval = 7;
    assert!(workflows::edit_task(
        t.path(),
        selected.id(),
        tasks::EditTaskParams {
            recurrence: Some(r.clone()),
            ..Default::default()
        }
    )
    .is_err());
    workflows::edit_task(
        t.path(),
        selected.id(),
        tasks::EditTaskParams {
            recurrence: Some(r.clone()),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        get(&t, selected.id())
            .frontmatter
            .recurrence_instance
            .unwrap()
            .revision,
        2
    );
    assert_eq!(get(&t, edited.id()).body, "My future plan");
    assert!(
        get(&t, edited.id())
            .frontmatter
            .recurrence_instance
            .unwrap()
            .detached
    );
    assert!(workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence: Some(r),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        }
    )
    .is_err());
    stop(&t, owner.id());
    assert!(
        !get(&t, owner.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .enabled
    );
    assert!(!get(&t, selected.id()).is_deleted());
    assert!(!get(&t, edited.id()).is_deleted());
}
#[test]
fn restarting_stopped_series_retains_old_authority_and_fresh_identity() {
    let t = root();
    let owner = create(&t, Some(2), RecurrenceMode::Scheduled);
    let old = owner
        .frontmatter
        .recurrence_instance
        .as_ref()
        .unwrap()
        .series_id
        .clone();
    stop(&t, owner.id());
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence: Some(rule(today(), Some(3), RecurrenceMode::Scheduled)),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    let saved = get(&t, owner.id());
    assert_ne!(
        saved.frontmatter.recurrence_instance.unwrap().series_id,
        old
    );
    assert!(saved.frontmatter.recurrence_series.unwrap().enabled);
    assert_eq!(saved.frontmatter.retired_recurrence_series.len(), 1);
}
#[test]
fn malformed_owner_and_duplicate_slot_stop_without_deleting_records() {
    let t = root();
    let owner = create(&t, Some(2), RecurrenceMode::Scheduled);
    let cfg = Config::load(t.path()).unwrap();
    let mut duplicate = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    duplicate.frontmatter.id = jin_core::id::new_ulid();
    fs::write_task(&cfg.tasks_dir(), &duplicate).unwrap();
    assert!(recurrence::maintain_task_recurrences(t.path(), Utc::now()).is_err());
    assert_eq!(all(&t).len(), 3);
    std::fs::remove_file(fs::find_task_path(&cfg.tasks_dir(), duplicate.id()).unwrap()).unwrap();
    std::fs::remove_file(fs::find_task_path(&cfg.tasks_dir(), owner.id()).unwrap()).unwrap();
    assert!(recurrence::maintain_task_recurrences(t.path(), Utc::now()).is_err());
    assert_eq!(all(&t).len(), 1);
}
#[test]
fn legacy_history_converts_remaining_count_once_without_historical_fabrication() {
    let t = root();
    let cfg = Config::load(t.path()).unwrap();
    let mut legacy = tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Legacy".into(),
            due: Some(DueDate::Date(today())),
            recurrence: Some(rule(today(), Some(3), RecurrenceMode::Completion)),
            ..Default::default()
        },
    )
    .unwrap();
    let sid = legacy
        .frontmatter
        .recurrence
        .as_ref()
        .unwrap()
        .series_id
        .clone();
    let h = TaskCompletion {
        series_id: sid,
        sequence: 1,
        completed_at: Utc::now().fixed_offset(),
        due: DueDate::Date(today() - Duration::days(1)),
    };
    legacy.frontmatter.completion_history = vec![h.clone(), h];
    fs::write_task(&cfg.tasks_dir(), &legacy).unwrap();
    recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap();
    assert_eq!(all(&t).len(), 1);
    let saved = get(&t, legacy.id());
    assert_eq!(saved.frontmatter.completion_history.len(), 2);
    assert!(matches!(
        saved.frontmatter.recurrence_series.unwrap().rule.end,
        RecurrenceEnd::Count { count: 2 }
    ));
    assert!(!recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap());
    workflows::transition_task(t.path(), legacy.id(), TaskStatus::Done).unwrap();
    assert_eq!(all(&t).len(), 2);
}
#[test]
fn long_inactivity_skips_unmaterialized_past_and_preserves_saved_overdue() {
    let t = root();
    let owner = create(&t, None, RecurrenceMode::Scheduled);
    let overdue = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    let far = Utc::now() + Duration::days(365 * 60);
    recurrence::maintain_task_recurrences(t.path(), far).unwrap();
    let entries = all(&t);
    assert!(entries.len() <= 184, "no decades of backfill");
    assert_eq!(
        get(&t, overdue.id()).frontmatter.due,
        overdue.frontmatter.due
    );
    assert_eq!(get(&t, owner.id()).frontmatter.due, owner.frontmatter.due);
    assert!(entries
        .iter()
        .any(|t| t.frontmatter.due == Some(DueDate::Date(far.date_naive() + Duration::days(9)))));
}
#[test]
fn dto_index_and_model_recurrence_metadata_match_after_reload() {
    let t = root();
    let owner = create(&t, Some(2), RecurrenceMode::Scheduled);
    api::refresh(t.path()).unwrap();
    let rows = api::list_tasks(t.path(), None, None, None, false).unwrap();
    for dto in rows {
        let model = jin_core::dto::TaskDto::from_model(&get(&t, &dto.id));
        let a = serde_json::to_value(dto).unwrap();
        let b = serde_json::to_value(model).unwrap();
        for field in [
            "recurrence_series",
            "recurrence_instance",
            "recurrence_exception",
        ] {
            assert_eq!(a[field], b[field], "DTO parity: {field}");
        }
    }
    let owner_dto = serde_json::to_value(api::get_task(t.path(), owner.id()).unwrap()).unwrap();
    assert!(owner_dto["recurrence_series"].get("template").is_none());
}
#[test]
fn touched_child_reopened_and_instance_detached_under_parent_survive_stop() {
    let t = root();
    let cfg = Config::load(t.path()).unwrap();
    let source = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Source".into(),
            due: Some(DueDate::Date(today())),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Step".into(),
            parent: Some(source.id().into()),
            ..Default::default()
        },
    )
    .unwrap();
    workflows::edit_task(
        t.path(),
        source.id(),
        tasks::EditTaskParams {
            recurrence: Some(rule(today(), Some(3), RecurrenceMode::Scheduled)),
            ..Default::default()
        },
    )
    .unwrap();
    let future = all(&t)
        .into_iter()
        .find(|t| t.parent().is_none() && sequence(t) == 2)
        .unwrap();
    let child = all(&t)
        .into_iter()
        .find(|t| t.parent() == Some(future.id()))
        .unwrap();
    workflows::transition_task(t.path(), child.id(), TaskStatus::Done).unwrap();
    workflows::transition_task(t.path(), child.id(), TaskStatus::Todo).unwrap();
    let other = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Other parent".into(),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    // A separate generated parent with no checklist can become a child exception.
    let plain = create(&t, Some(2), RecurrenceMode::Scheduled);
    let instance = all(&t)
        .into_iter()
        .find(|t| {
            t.frontmatter
                .recurrence_instance
                .as_ref()
                .is_some_and(|i| i.owner_task_id == plain.id() && i.sequence == 2)
        })
        .unwrap();
    let moved = workflows::edit_task(
        t.path(),
        instance.id(),
        tasks::EditTaskParams {
            parent: Some(Some(other.id().into())),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(moved.frontmatter.recurrence_instance.unwrap().detached);
    stop(&t, source.id());
    stop(&t, plain.id());
    assert!(!get(&t, future.id()).is_deleted());
    assert!(!get(&t, child.id()).is_deleted());
    assert!(!get(&t, instance.id()).is_deleted());
}
#[test]
fn generated_reminders_are_relative_or_reconciled_automatic_only() {
    let t = root();
    let due = Utc::now().fixed_offset() + Duration::hours(1);
    let mut r = rule(today(), Some(2), RecurrenceMode::Scheduled);
    r.anchor_due = DueDate::DateTime(due);
    let original = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Remind".into(),
            due: Some(DueDate::DateTime(due)),
            reminders: Some(vec![
                Reminder {
                    kind: "relative".into(),
                    value: "-1h".into(),
                },
                Reminder {
                    kind: "absolute".into(),
                    value: due.to_rfc3339(),
                },
                Reminder {
                    kind: "absolute".into(),
                    value: (due - Duration::hours(3)).to_rfc3339(),
                },
            ]),
            recurrence: Some(r),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let future = all(&t)
        .into_iter()
        .find(|t| t.id() != original.id())
        .unwrap();
    assert_eq!(future.frontmatter.reminders.len(), 2);
    assert!(future
        .frontmatter
        .reminders
        .iter()
        .any(|r| r.kind == "relative"));
    let expected = (due + Duration::days(1)).to_rfc3339();
    assert!(future
        .frontmatter
        .reminders
        .iter()
        .any(|r| r.value == expected));
    assert_eq!(get(&t, original.id()).frontmatter.reminders.len(), 3);
}
#[test]
fn board_drag_to_done_creates_completion_successor_in_initial_column() {
    use jin_core::model::list::{BoardColumnType, WorkflowKind};
    let t = root();
    let board = ops::lists::create_list(
        t.path(),
        ops::lists::CreateListParams {
            name: "Board".into(),
            color: "accent".into(),
            icon: "list".into(),
            parent_id: None,
            workflow_kind: Some(WorkflowKind::Board),
        },
    )
    .unwrap();
    let cfg = Config::load(t.path()).unwrap();
    let list = fs::read_list(&fs::find_list_path(&cfg.lists_dir(), &board.id).unwrap()).unwrap();
    let done = list
        .frontmatter
        .columns
        .iter()
        .find(|c| c.column_type == BoardColumnType::Done)
        .unwrap();
    let original = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Board repeat".into(),
            list: Some(board.id.clone()),
            due: Some(DueDate::Date(today())),
            recurrence: Some(rule(today(), Some(2), RecurrenceMode::Completion)),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let moved = workflows::move_task(
        t.path(),
        original.id(),
        workflows::MoveTaskParams {
            list_id: board.id,
            section_id: None,
            board_column_id: Some(done.id.clone()),
            position: "V".into(),
            confirm_doing_to_checklist: false,
        },
    )
    .unwrap();
    assert_eq!(moved.frontmatter.status, TaskStatus::Done);
    let future = all(&t)
        .into_iter()
        .find(|t| t.id() != original.id())
        .unwrap();
    assert_eq!(future.frontmatter.status, TaskStatus::Todo);
    assert_eq!(
        future.frontmatter.board_column_id,
        list.frontmatter.initial_column_id
    );
}
#[test]
fn legacy_completion_mutation_migrates_before_done_and_count_one_is_terminal() {
    for count in [2, 3] {
        let t = root();
        let cfg = Config::load(t.path()).unwrap();
        ops::lists::ensure_default_list_for_root(t.path()).unwrap();
        let mut legacy = tasks::create_task(
            &cfg.tasks_dir(),
            tasks::CreateTaskParams {
                title: "Legacy completing now".into(),
                due: Some(DueDate::Date(today())),
                recurrence: Some(rule(today(), Some(count), RecurrenceMode::Completion)),
                ..Default::default()
            },
        )
        .unwrap();
        legacy.frontmatter.completion_history.push(TaskCompletion {
            series_id: legacy
                .frontmatter
                .recurrence
                .as_ref()
                .unwrap()
                .series_id
                .clone(),
            sequence: 1,
            completed_at: Utc::now().fixed_offset(),
            due: DueDate::Date(today() - Duration::days(1)),
        });
        fs::write_task(&cfg.tasks_dir(), &legacy).unwrap();
        workflows::transition_task(t.path(), legacy.id(), TaskStatus::Done).unwrap();
        assert_eq!(all(&t).len(), if count == 2 { 1 } else { 2 });
        assert_eq!(get(&t, legacy.id()).frontmatter.completion_history.len(), 1);
    }
}
#[test]
fn old_completion_revision_cannot_create_a_parallel_successor() {
    let t = root();
    let owner = create(&t, Some(4), RecurrenceMode::Completion);
    workflows::transition_task(t.path(), owner.id(), TaskStatus::Done).unwrap();
    let selected = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    workflows::edit_task(
        t.path(),
        selected.id(),
        tasks::EditTaskParams {
            recurrence: Some(rule(today(), Some(3), RecurrenceMode::Completion)),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    workflows::transition_task(t.path(), owner.id(), TaskStatus::Todo).unwrap();
    workflows::transition_task(t.path(), owner.id(), TaskStatus::Done).unwrap();
    assert_eq!(all(&t).len(), 2);
    workflows::transition_task(t.path(), selected.id(), TaskStatus::Done).unwrap();
    assert_eq!(all(&t).len(), 3);
}
#[test]
fn until_is_inclusive_and_raw_parent_edits_are_protected() {
    let t = root();
    let mut r = rule(today(), None, RecurrenceMode::Scheduled);
    r.end = RecurrenceEnd::Until {
        date: today() + Duration::days(2),
    };
    let owner = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Until".into(),
            due: Some(DueDate::Date(today())),
            recurrence: Some(r),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(all(&t).len(), 3);
    let mut future = all(&t).into_iter().find(|t| sequence(t) == 2).unwrap();
    future.body = "Edited outside Jin".into();
    fs::write_task(&Config::load(t.path()).unwrap().tasks_dir(), &future).unwrap();
    stop(&t, owner.id());
    assert_eq!(get(&t, future.id()).body, "Edited outside Jin");
    assert!(!get(&t, future.id()).is_deleted());
}
#[test]
fn persisted_weekly_slots_count_root_outside_weekday_set_and_preserve_interval() {
    let t = root();
    let cfg = Config::load(t.path()).unwrap();
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 7).unwrap();
    let mut r = rule(anchor, Some(4), RecurrenceMode::Scheduled);
    r.frequency = RecurrenceFrequency::Weekly;
    r.interval = 2;
    r.weekdays = vec![4, 2, 4];
    tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Twice selected".into(),
            due: Some(DueDate::Date(anchor)),
            recurrence: Some(r),
            ..Default::default()
        },
    )
    .unwrap();
    recurrence::maintain_task_recurrences(t.path(), "2026-01-07T12:00:00Z".parse().unwrap())
        .unwrap();
    let mut entries = all(&t);
    entries.sort_by_key(sequence);
    let dates: Vec<_> = entries
        .iter()
        .map(|t| t.frontmatter.due.clone().unwrap())
        .collect();
    assert_eq!(
        dates,
        [(2026, 1, 7), (2026, 1, 8), (2026, 1, 20), (2026, 1, 22)]
            .map(|(y, m, d)| DueDate::Date(NaiveDate::from_ymd_opt(y, m, d).unwrap()))
    );
    assert_eq!(
        entries.iter().map(sequence).collect::<Vec<_>>(),
        vec![1, 2, 3, 4]
    );
}
#[test]
fn persisted_month_end_slots_keep_january_anchor_through_february() {
    let t = root();
    let cfg = Config::load(t.path()).unwrap();
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
    let mut r = rule(anchor, Some(3), RecurrenceMode::Scheduled);
    r.frequency = RecurrenceFrequency::Monthly;
    tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Month end".into(),
            due: Some(DueDate::Date(anchor)),
            recurrence: Some(r),
            ..Default::default()
        },
    )
    .unwrap();
    recurrence::maintain_task_recurrences(t.path(), "2026-01-31T12:00:00Z".parse().unwrap())
        .unwrap();
    let mut entries = all(&t);
    entries.sort_by_key(sequence);
    assert_eq!(
        entries
            .iter()
            .map(|t| t.frontmatter.due.clone().unwrap())
            .collect::<Vec<_>>(),
        [(2026, 1, 31), (2026, 2, 28), (2026, 3, 31)]
            .map(|(y, m, d)| DueDate::Date(NaiveDate::from_ymd_opt(y, m, d).unwrap()))
    );
}

#[test]
fn exhausted_finite_rules_persist_skipped_slots_across_clock_rollback() {
    for end in [
        RecurrenceEnd::Count { count: 3 },
        RecurrenceEnd::Until {
            date: NaiveDate::from_ymd_opt(2026, 1, 3).unwrap(),
        },
    ] {
        let t = root();
        let cfg = Config::load(t.path()).unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let mut repeat = rule(anchor, None, RecurrenceMode::Scheduled);
        repeat.end = end;
        let original = tasks::create_task(
            &cfg.tasks_dir(),
            tasks::CreateTaskParams {
                title: "Absent while this rule ended".into(),
                due: Some(DueDate::Date(anchor)),
                recurrence: Some(repeat),
                ..Default::default()
            },
        )
        .unwrap();
        // No historical occurrences should be fabricated at the first seek.
        recurrence::maintain_task_recurrences(t.path(), "2026-01-10T12:00:00Z".parse().unwrap())
            .unwrap();
        assert_eq!(all(&t).len(), 1);
        let saved = get(&t, original.id());
        let series = saved.frontmatter.recurrence_series.unwrap();
        assert_eq!(
            series.next_sequence, 4,
            "all three permitted slot positions are consumed"
        );
        assert_eq!(
            series.skipped_before,
            Some(NaiveDate::from_ymd_opt(2026, 1, 10).unwrap())
        );
        assert_eq!(saved.frontmatter.due, Some(DueDate::Date(anchor)));
        // A new process / earlier local date cannot unconsume skipped positions.
        assert!(!recurrence::maintain_task_recurrences(
            t.path(),
            "2026-01-02T12:00:00Z".parse().unwrap()
        )
        .unwrap());
        assert_eq!(all(&t).len(), 1);
        assert_eq!(
            get(&t, original.id())
                .frontmatter
                .recurrence_series
                .unwrap()
                .next_sequence,
            4
        );
    }
}

#[test]
fn configurable_upcoming_target_refills_without_replacing_existing_entries() {
    let t = root();
    let d = today();
    let owner = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Small agenda".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(rule(d, None, RecurrenceMode::Scheduled)),
            recurrence_upcoming_count: Some(3),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let initial = all(&t);
    assert_eq!(initial.len(), 3);
    let revision = owner
        .frontmatter
        .recurrence_series
        .as_ref()
        .unwrap()
        .revision;
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence_upcoming_count: Some(5),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(all(&t).len(), 5);
    assert_eq!(
        get(&t, owner.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .revision,
        revision
    );
    for task in initial {
        assert_eq!(get(&t, task.id()).frontmatter.due, task.frontmatter.due);
    }
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence_upcoming_count: Some(2),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        all(&t).len(),
        5,
        "reducing the target preserves saved planning"
    );
    workflows::transition_task(t.path(), owner.id(), TaskStatus::Done).unwrap();
    assert_eq!(all(&t).len(), 5);
    // The completed authority can still configure its current series.
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence_upcoming_count: Some(6),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        all(&t)
            .iter()
            .filter(|x| x.frontmatter.status == TaskStatus::Todo)
            .count(),
        6
    );
    assert!(!recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap());
}
#[test]
fn enabling_repeat_with_explicit_target_copies_existing_checklist() {
    let t = root();
    let d = today();
    let owner = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Parent".into(),
            due: Some(DueDate::Date(d)),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Checklist item".into(),
            parent: Some(owner.id().into()),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence: Some(rule(d, None, RecurrenceMode::Scheduled)),
            recurrence_upcoming_count: Some(3),
            ..Default::default()
        },
    )
    .unwrap();
    let tasks = all(&t);
    let parents: Vec<_> = tasks.iter().filter(|x| x.parent().is_none()).collect();
    assert_eq!(parents.len(), 3);
    for parent in parents {
        assert_eq!(
            tasks
                .iter()
                .filter(|x| x.parent() == Some(parent.id()) && x.title() == "Checklist item")
                .count(),
            1
        );
    }
}
#[test]
fn legacy_count_target_edit_preserves_history_and_remaining_slot_budget() {
    let t = root();
    let d = today();
    let cfg = Config::load(t.path()).unwrap();
    ops::lists::ensure_default_list_for_root(t.path()).unwrap();
    let mut legacy = tasks::create_task(
        &cfg.tasks_dir(),
        tasks::CreateTaskParams {
            title: "Legacy".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(rule(d, Some(5), RecurrenceMode::Scheduled)),
            ..Default::default()
        },
    )
    .unwrap();
    let series_id = legacy
        .frontmatter
        .recurrence
        .as_ref()
        .unwrap()
        .series_id
        .clone();
    for sequence in 1..=2 {
        legacy.frontmatter.completion_history.push(TaskCompletion {
            series_id: series_id.clone(),
            sequence,
            due: DueDate::Date(d - Duration::days(i64::from(sequence))),
            completed_at: Utc::now().fixed_offset(),
        });
    }
    fs::write_task(&cfg.tasks_dir(), &legacy).unwrap();
    workflows::edit_task(
        t.path(),
        legacy.id(),
        tasks::EditTaskParams {
            recurrence_upcoming_count: Some(10),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(all(&t).len(), 3);
    assert_eq!(get(&t, legacy.id()).frontmatter.completion_history.len(), 2);
}
#[test]
fn largest_upcoming_target_is_fulfilled_and_invalid_counts_are_atomic() {
    let t = root();
    let d = today();
    let owner = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Full planning".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(rule(d, None, RecurrenceMode::Scheduled)),
            recurrence_upcoming_count: Some(365),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(all(&t).len(), 365);
    for count in [0, 366] {
        assert!(workflows::edit_task(
            t.path(),
            owner.id(),
            tasks::EditTaskParams {
                recurrence_upcoming_count: Some(count),
                recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
                ..Default::default()
            }
        )
        .is_err());
    }
    assert_eq!(
        get(&t, owner.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .upcoming_count,
        365
    );
}
#[test]
fn extreme_cadences_stop_at_supported_dates_without_panicking() {
    for frequency in [RecurrenceFrequency::Yearly, RecurrenceFrequency::Monthly] {
        let t = root();
        let d = today();
        let mut r = rule(d, None, RecurrenceMode::Scheduled);
        r.frequency = frequency;
        r.interval = u16::MAX;
        let owner = workflows::create_task(
            t.path(),
            tasks::CreateTaskParams {
                title: "Large interval".into(),
                due: Some(DueDate::Date(d)),
                recurrence: Some(r),
                recurrence_upcoming_count: Some(365),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        assert!(!all(&t).is_empty());
        assert_eq!(get(&t, owner.id()).frontmatter.status, TaskStatus::Todo);
        assert!(!recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap());
    }
    let mut r = rule(NaiveDate::MAX, None, RecurrenceMode::Scheduled);
    for frequency in [
        RecurrenceFrequency::Daily,
        RecurrenceFrequency::Weekly,
        RecurrenceFrequency::Monthly,
        RecurrenceFrequency::Yearly,
    ] {
        r.frequency = frequency;
        assert_eq!(
            jin_core::model::next_recurrence_date(&r, NaiveDate::MAX, NaiveDate::MAX),
            None
        );
    }
}

#[test]
fn optimistic_series_guard_rejects_revisions_and_external_stop_without_writes() {
    let t = root();
    let owner = create(&t, None, RecurrenceMode::Scheduled);
    let authority = owner.frontmatter.recurrence_series.as_ref().unwrap();
    let guard = jin_core::model::task::RecurrenceRevision {
        series_id: authority.series_id.clone(),
        revision: authority.revision,
        enabled: true,
    };
    let mut monthly = authority.rule.clone();
    monthly.frequency = RecurrenceFrequency::Monthly;
    workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence: Some(monthly),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        },
    )
    .unwrap();
    let before: Vec<_> = all(&t)
        .iter()
        .map(|task| fs::render_task_bytes(task).unwrap())
        .collect();
    assert!(workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence_upcoming_count: Some(3),
            recurrence_expected: Some(guard),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        }
    )
    .is_err());
    assert_eq!(
        all(&t)
            .iter()
            .map(|task| fs::render_task_bytes(task).unwrap())
            .collect::<Vec<_>>(),
        before
    );
    let current = get(&t, owner.id()).frontmatter.recurrence_series.unwrap();
    let guard = jin_core::model::task::RecurrenceRevision {
        series_id: current.series_id,
        revision: current.revision,
        enabled: true,
    };
    stop(&t, owner.id());
    assert!(workflows::edit_task(
        t.path(),
        owner.id(),
        tasks::EditTaskParams {
            recurrence: Some(current.rule),
            recurrence_expected: Some(guard),
            recurrence_scope: Some(RecurrenceScope::ThisAndFollowing),
            ..Default::default()
        }
    )
    .is_err());
    assert!(
        !get(&t, owner.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .enabled
    );
}
#[test]
fn old_series_missing_target_defaults_to_ten_without_trimming_existing_entries() {
    let t = root();
    let d = today();
    let owner = workflows::create_task(
        t.path(),
        tasks::CreateTaskParams {
            title: "Existing planning".into(),
            due: Some(DueDate::Date(d)),
            recurrence: Some(rule(d, None, RecurrenceMode::Scheduled)),
            recurrence_upcoming_count: Some(30),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let cfg = Config::load(t.path()).unwrap();
    let path = fs::find_task_path(&cfg.tasks_dir(), owner.id()).unwrap();
    let bytes = std::fs::read_to_string(&path)
        .unwrap()
        .replace("  upcoming_count: 30\n", "");
    std::fs::write(&path, bytes).unwrap();
    recurrence::maintain_task_recurrences(t.path(), Utc::now()).unwrap();
    assert_eq!(
        get(&t, owner.id())
            .frontmatter
            .recurrence_series
            .unwrap()
            .upcoming_count,
        10
    );
    assert_eq!(all(&t).len(), 30);
}
