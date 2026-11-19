//! Thin bridge for durable note, task and calendar workflows.

use std::path::Path;

use jin_core::dto::{NoteDto, TaskDto};
use jin_core::ops::{api, linked_creation};
use serde::Serialize;

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct TaskFromNoteResult {
    pub task: TaskDto,
    pub note: NoteDto,
}

pub fn create_task_from_note_fn(
    root: &Path,
    input: linked_creation::TaskFromNoteInput,
) -> Result<TaskFromNoteResult, JinErrorDto> {
    let (task, note) =
        linked_creation::create_task_from_note(root, input).map_err(JinErrorDto::from)?;
    Ok(TaskFromNoteResult {
        task: api::get_task(root, task.id()).map_err(JinErrorDto::from)?,
        note: api::get_note(root, note.id()).map_err(JinErrorDto::from)?,
    })
}

pub fn create_event_prep_note_fn(
    root: &Path,
    input: linked_creation::EventPrepNoteInput,
) -> Result<NoteDto, JinErrorDto> {
    let note = linked_creation::create_event_prep_note(root, input).map_err(JinErrorDto::from)?;
    api::get_note(root, note.id()).map_err(JinErrorDto::from)
}

#[tauri::command]
pub async fn create_task_from_note(
    state: tauri::State<'_, AppState>,
    input: linked_creation::TaskFromNoteInput,
) -> Result<TaskFromNoteResult, JinErrorDto> {
    create_task_from_note_fn(&state.root, input)
}

#[tauri::command]
pub async fn create_event_prep_note(
    state: tauri::State<'_, AppState>,
    input: linked_creation::EventPrepNoteInput,
) -> Result<NoteDto, JinErrorDto> {
    create_event_prep_note_fn(&state.root, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use jin_core::ops::notes;
    use tempfile::TempDir;

    #[test]
    fn bridge_returns_hydrated_relation_and_new_revision_on_replay() {
        let root = TempDir::new().unwrap();
        jin_core::ops::init(root.path()).unwrap();
        let note = notes::create_note(
            &root.path().join("notes"),
            notes::CreateNoteParams {
                title: "Notes".into(),
                body: "Follow up".into(),
                tags: vec![],
                folder: "".into(),
            },
        )
        .unwrap();
        let input = linked_creation::TaskFromNoteInput {
            operation_id: "bridge-linked-task".into(),
            note_id: note.id().into(),
            expected_revision: 1,
            title: "Follow up".into(),
            excerpt: "Follow up".into(),
            list: None,
        };
        let result = create_task_from_note_fn(root.path(), input.clone()).unwrap();
        let replay = create_task_from_note_fn(root.path(), input).unwrap();
        assert_eq!(result.task.id, replay.task.id);
        assert_eq!(result.note.revision, Some(2));
        assert_eq!(result.note.outgoing_links[0].target_kind, "task");
        assert_eq!(result.task.backlinks[0].source_id, note.id());
        let wire = serde_json::to_value(result).unwrap();
        assert_eq!(
            wire["note"]["outgoing_links"][0]["target_id"],
            wire["task"]["id"]
        );
    }

    #[test]
    fn bridge_returns_structured_stale_error_without_creating_task() {
        let root = TempDir::new().unwrap();
        jin_core::ops::init(root.path()).unwrap();
        let note = notes::create_note(
            &root.path().join("notes"),
            notes::CreateNoteParams {
                title: "Notes".into(),
                body: "Follow up".into(),
                tags: vec![],
                folder: "".into(),
            },
        )
        .unwrap();
        let error = create_task_from_note_fn(
            root.path(),
            linked_creation::TaskFromNoteInput {
                operation_id: "stale-bridge-task".into(),
                note_id: note.id().into(),
                expected_revision: 0,
                title: "Follow up".into(),
                excerpt: "Follow up".into(),
                list: None,
            },
        )
        .unwrap_err();
        assert!(error.message.contains("revision"));
        assert!(api::list_tasks(root.path(), None, None, None, false)
            .unwrap()
            .is_empty());
    }
}
