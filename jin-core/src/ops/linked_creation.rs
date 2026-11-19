//! Durable creation of local work from an existing note or calendar event.

use std::collections::BTreeMap;
use std::path::Path;

use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::edge::{EdgeType, LinkEntry};
use crate::model::list::WorkflowKind;
use crate::model::{Note, NoteFrontmatter, NoteStatus, Task, TaskStatus};
use crate::store::{frontmatter, fs};
use crate::{Config, JinError, Result};

use super::recoverable_operations::{self, TargetPlan};
use super::{events, lists, notes, recovery, tasks, workflows};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFromNoteInput {
    pub operation_id: String,
    pub note_id: String,
    pub expected_revision: u64,
    pub title: String,
    pub excerpt: String,
    pub list: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPrepNoteInput {
    pub operation_id: String,
    /// Persisted event identity, including a detached exception when selected.
    pub event_id: String,
    pub title: String,
    pub body: String,
}

fn operation_kind(kind: &str, input: &impl Serialize) -> Result<String> {
    let bytes = serde_json::to_vec(input)
        .map_err(|err| JinError::InvalidInput(format!("invalid linked creation input: {err}")))?;
    // The journal rejects reuse of the same id with a different request.
    Ok(format!("{kind}:{:x}", Sha256::digest(bytes)))
}

fn validate_text(title: &str, body: &str) -> Result<()> {
    if title.trim().is_empty() || title.chars().count() > 500 {
        return Err(JinError::InvalidInput(
            "Enter a title of 1–500 characters.".into(),
        ));
    }
    if body.len() > 1_000_000 {
        return Err(JinError::InvalidInput(
            "The selected text is too large.".into(),
        ));
    }
    Ok(())
}

pub fn create_task_from_note(root: &Path, input: TaskFromNoteInput) -> Result<(Task, Note)> {
    create_task_from_note_inner(root, input, None)
}

fn create_task_from_note_inner(
    root: &Path,
    input: TaskFromNoteInput,
    failpoint: Option<recoverable_operations::OperationFailpoint>,
) -> Result<(Task, Note)> {
    validate_text(&input.title, &input.excerpt)?;
    if input.excerpt.trim().is_empty() {
        return Err(JinError::InvalidInput(
            "Select some note text to create a task.".into(),
        ));
    }
    let cfg = Config::load(root)?;
    lists::ensure_default_list_for_root(root)?;
    let kind = operation_kind("task_from_note", &input)?;
    let build = || {
        let note_path = fs::find_note_path(&cfg.notes_dir(), &input.note_id)?;
        let before = std::fs::read(&note_path)?;
        let mut note = fs::read_note(&note_path)?;
        if note.is_deleted() {
            return Err(JinError::NotFound(format!(
                "note/{} is deleted",
                input.note_id
            )));
        }
        if note.frontmatter.revision != input.expected_revision {
            return Err(JinError::StaleNote {
                note_id: input.note_id.clone(),
                expected_revision: input.expected_revision,
                current_revision: note.frontmatter.revision,
            });
        }
        let list_id = input.list.clone().unwrap_or_else(|| "inbox".into());
        let list_path = fs::find_list_path(&cfg.lists_dir(), &list_id)?;
        let list = fs::read_list(&list_path)?;
        let column = if list.frontmatter.workflow_kind == Some(WorkflowKind::Board) {
            workflows::validate_board(&list)?;
            Some(workflows::initial_column(&list)?.id.clone())
        } else {
            None
        };
        let task = tasks::prepare_new_task(
            &cfg.tasks_dir(),
            tasks::CreateTaskParams {
                title: input.title.trim().to_string(),
                body: input.excerpt.clone(),
                list: Some(list_id),
                ..Default::default()
            },
            column,
            TaskStatus::Todo,
        )?;
        recovery::snapshot_before_write(root, &note, &before)?;
        note.frontmatter.links.push(LinkEntry {
            edge_type: EdgeType::References,
            target: task.id().to_string(),
        });
        note.frontmatter.revision = note.frontmatter.revision.saturating_add(1);
        note.frontmatter.updated = Local::now().fixed_offset();
        Ok((
            task.id().to_string(),
            vec![
                TargetPlan {
                    canonical_path: cfg.tasks_dir().join(fs::task_filename(task.id())),
                    before: None,
                    post: Some(fs::render_task_bytes(&task)?),
                },
                TargetPlan {
                    canonical_path: note_path,
                    before: Some(before),
                    post: Some(frontmatter::render(&note.frontmatter, &note.body)?.into_bytes()),
                },
            ],
        ))
    };
    let outcome = recoverable_operations::execute_task_operation_with_failpoint(
        root,
        &input.operation_id,
        &kind,
        failpoint,
        build,
    )?;
    Ok((
        tasks::get_task(&cfg.tasks_dir(), &outcome.result_event_id)?,
        notes::get_note(&cfg.notes_dir(), &input.note_id)?,
    ))
}

pub fn create_event_prep_note(root: &Path, input: EventPrepNoteInput) -> Result<Note> {
    validate_text(&input.title, &input.body)?;
    let cfg = Config::load(root)?;
    let kind = operation_kind("event_prep_note", &input)?;
    let outcome =
        recoverable_operations::execute_task_operation(root, &input.operation_id, &kind, || {
            let event = events::get_event(&cfg.events_dir(), &input.event_id)?;
            if event.is_deleted() {
                return Err(JinError::NotFound(format!(
                    "event/{} is deleted",
                    input.event_id
                )));
            }
            let now = Local::now().fixed_offset();
            let note = Note {
                frontmatter: NoteFrontmatter {
                    id: crate::id::new_ulid(),
                    kind: "note".into(),
                    title: input.title.trim().to_string(),
                    created: now,
                    updated: now,
                    status: NoteStatus::Active,
                    deleted_at: None,
                    tags: vec![],
                    links: vec![LinkEntry {
                        edge_type: EdgeType::PrepFor,
                        target: event.id().to_string(),
                    }],
                    properties: BTreeMap::new(),
                    revision: 1,
                    extra: BTreeMap::new(),
                },
                body: input.body.clone(),
            };
            Ok((
                note.id().to_string(),
                vec![TargetPlan {
                    canonical_path: cfg
                        .notes_dir()
                        .join(fs::note_filename(note.id(), note.title())),
                    before: None,
                    post: Some(frontmatter::render(&note.frontmatter, &note.body)?.into_bytes()),
                }],
            ))
        })?;
    notes::get_note(&cfg.notes_dir(), &outcome.result_event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::api;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Note) {
        let root = TempDir::new().unwrap();
        crate::ops::init(root.path()).unwrap();
        let note = notes::create_note(
            &root.path().join("notes"),
            notes::CreateNoteParams {
                title: "Meeting decisions".into(),
                body: "Keep the original prose.\n\nPrepare the proposal.".into(),
                tags: vec![],
                folder: "".into(),
            },
        )
        .unwrap();
        api::refresh(root.path()).unwrap();
        (root, note)
    }

    fn task_input(note: &Note) -> TaskFromNoteInput {
        TaskFromNoteInput {
            operation_id: "selected-text-task".into(),
            note_id: note.id().into(),
            expected_revision: note.frontmatter.revision,
            title: "Prepare the proposal".into(),
            excerpt: "Prepare the proposal.".into(),
            list: None,
        }
    }

    #[test]
    fn task_from_selection_retains_prose_and_resolves_both_directions_after_rebuild() {
        let (root, note) = setup();
        let input = task_input(&note);
        let (task, updated) = create_task_from_note(root.path(), input.clone()).unwrap();
        assert_eq!(updated.body, note.body);
        assert_eq!(updated.frontmatter.revision, 2);
        assert_eq!(task.body, input.excerpt);
        assert_eq!(task.frontmatter.list, "inbox");
        assert_eq!(
            recovery::list_revisions(root.path(), note.id())
                .unwrap()
                .len(),
            1
        );
        api::refresh(root.path()).unwrap();
        let note_dto = api::get_note(root.path(), note.id()).unwrap();
        assert_eq!(note_dto.outgoing_links[0].target_id, task.id());
        assert_eq!(note_dto.outgoing_links[0].target_kind, "task");
        assert_eq!(note_dto.outgoing_links[0].label, task.title());
        let task_dto = api::get_task(root.path(), task.id()).unwrap();
        assert_eq!(task_dto.backlinks[0].label, "referenced-by");
        assert_eq!(
            task_dto.backlinks[0].source_title.as_deref(),
            Some(note.title())
        );
        assert!(task_dto
            .backlinks
            .iter()
            .any(|link| link.source_id == note.id()));
        let (same, replayed_note) = create_task_from_note(root.path(), input).unwrap();
        assert_eq!(same.id(), task.id());
        assert_eq!(replayed_note.frontmatter.revision, 2);
        assert_eq!(
            tasks::list_tasks(&root.path().join("tasks"), None, None, false)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn changed_payload_cannot_reuse_successful_operation() {
        let (root, note) = setup();
        let input = task_input(&note);
        create_task_from_note(root.path(), input.clone()).unwrap();
        let mut changed = input;
        changed.title = "A different task".into();
        assert!(matches!(
            create_task_from_note(root.path(), changed),
            Err(JinError::OperationConflict { .. })
        ));
    }

    #[test]
    fn stale_or_deleted_note_creates_no_task() {
        let (root, note) = setup();
        let mut stale = task_input(&note);
        stale.expected_revision = 0;
        assert!(matches!(
            create_task_from_note(root.path(), stale),
            Err(JinError::StaleNote { .. })
        ));
        notes::delete_note(&root.path().join("notes"), note.id()).unwrap();
        assert!(matches!(
            create_task_from_note(root.path(), task_input(&note)),
            Err(JinError::NotFound(_))
        ));
        assert!(
            tasks::list_tasks(&root.path().join("tasks"), None, None, false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn interrupted_multi_file_creation_rolls_forward_once_on_retry() {
        let (root, note) = setup();
        let input = task_input(&note);
        assert!(create_task_from_note_inner(
            root.path(),
            input.clone(),
            Some(recoverable_operations::OperationFailpoint::FinalRenameBeforeConvergenceRecord)
        )
        .is_err());
        let (task, updated) = create_task_from_note(root.path(), input.clone()).unwrap();
        assert_eq!(updated.frontmatter.links.len(), 1);
        assert_eq!(updated.frontmatter.links[0].target, task.id());
        assert_eq!(
            create_task_from_note(root.path(), input).unwrap().0.id(),
            task.id()
        );
    }

    fn seed_event(root: &Path) -> crate::model::Event {
        events::create_event(
            &root.join("events"),
            events::CreateEventParams {
                title: "Review".into(),
                body: "".into(),
                start: crate::model::event::TemporalValue::Date("2026-11-19".parse().unwrap()),
                end: crate::model::event::TemporalValue::Date("2026-11-20".parse().unwrap()),
                start_value_type: crate::model::event::ValueType::Date,
                end_value_type: crate::model::event::ValueType::Date,
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
        .unwrap()
    }

    #[test]
    fn prep_note_is_local_linked_and_retry_safe_without_changing_event() {
        let (root, _) = setup();
        let event = seed_event(root.path());
        let path = fs::find_event_path(&root.path().join("events"), event.id()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let input = EventPrepNoteInput {
            operation_id: "meeting-prep-note".into(),
            event_id: event.id().into(),
            title: "Review notes".into(),
            body: "## Agenda\n\n## Notes\n\n## Actions\n".into(),
        };
        let note = create_event_prep_note(root.path(), input.clone()).unwrap();
        assert_eq!(
            create_event_prep_note(root.path(), input.clone())
                .unwrap()
                .id(),
            note.id()
        );
        assert_eq!(std::fs::read(path).unwrap(), before);
        assert_eq!(
            api::get_note(root.path(), note.id())
                .unwrap()
                .outgoing_links[0]
                .target_kind,
            "event"
        );
        assert!(api::get_event(root.path(), event.id())
            .unwrap()
            .backlinks
            .iter()
            .any(|link| link.source_id == note.id() && link.edge_type == "prep-for"));
        let mut changed = input;
        changed.body = "different request".into();
        assert!(matches!(
            create_event_prep_note(root.path(), changed),
            Err(JinError::OperationConflict { .. })
        ));
    }

    #[test]
    fn missing_event_creates_no_note() {
        let (root, _) = setup();
        let input = EventPrepNoteInput {
            operation_id: "missing-event".into(),
            event_id: crate::id::new_ulid(),
            title: "Notes".into(),
            body: "".into(),
        };
        assert!(matches!(
            create_event_prep_note(root.path(), input),
            Err(JinError::NotFound(_))
        ));
        assert_eq!(
            notes::list_notes(&root.path().join("notes"), false)
                .unwrap()
                .len(),
            1
        );
    }
}
