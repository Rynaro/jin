//! Canonical List/Board placement rules shared by UI, CLI and background callers.
//! Legacy files with no workflow kind retain their existing lifecycle.

use std::path::Path;

use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::id::new_ulid;
use crate::model::list::{BoardColumn, BoardColumnType, List, WorkflowKind};
use crate::model::{Task, TaskStatus};
use crate::store::fs;
use crate::{Config, JinError, Result};

use super::recoverable_operations::{self, TargetPlan};
use super::tasks::{self, CreateTaskParams, EditTaskParams};

fn owning_list(cfg: &Config, list_id: &str) -> Result<List> {
    let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    fs::read_list(&path)
}

fn status_for_destination(kind: BoardColumnType, current: &TaskStatus) -> TaskStatus {
    match kind {
        BoardColumnType::Queue => TaskStatus::Todo,
        BoardColumnType::InProgress => TaskStatus::Doing,
        BoardColumnType::Done => TaskStatus::Done,
        BoardColumnType::None => {
            if *current == TaskStatus::Done {
                TaskStatus::Todo
            } else {
                current.clone()
            }
        }
    }
}

fn compatible(kind: BoardColumnType, status: &TaskStatus) -> bool {
    matches!(
        (kind, status),
        (
            BoardColumnType::Queue | BoardColumnType::None,
            TaskStatus::Todo
        ) | (
            BoardColumnType::InProgress | BoardColumnType::None,
            TaskStatus::Doing
        ) | (BoardColumnType::Done, TaskStatus::Done)
    )
}

fn matching_column(list: &List, kind: BoardColumnType) -> Option<&BoardColumn> {
    list.frontmatter
        .columns
        .iter()
        .filter(|column| column.column_type == kind)
        .min_by(|a, b| a.position.cmp(&b.position).then_with(|| a.id.cmp(&b.id)))
}

fn initial_column(list: &List) -> Result<&BoardColumn> {
    let selected = if let Some(id) = list.frontmatter.initial_column_id.as_deref() {
        list.frontmatter.columns.iter().find(|column| column.id == id)
            .ok_or_else(|| JinError::InvalidInput(format!("board/{} has an invalid initial column; choose a Queue or No status change column", list.id())))?
    } else {
        matching_column(list, BoardColumnType::Queue)
            .or_else(|| matching_column(list, BoardColumnType::None))
            .ok_or_else(|| {
                JinError::InvalidInput(format!(
                    "board/{} needs an initial Queue or No status change column",
                    list.id()
                ))
            })?
    };
    if !matches!(
        selected.column_type,
        BoardColumnType::Queue | BoardColumnType::None
    ) {
        return Err(JinError::InvalidInput(
            "initial column must be Queue or No status change".into(),
        ));
    }
    Ok(selected)
}

pub fn validate_board(list: &List) -> Result<()> {
    if list.frontmatter.workflow_kind != Some(WorkflowKind::Board) {
        return Ok(());
    }
    if matching_column(list, BoardColumnType::Done).is_none() {
        return Err(JinError::InvalidInput(format!(
            "board/{} needs a Done column",
            list.id()
        )));
    }
    initial_column(list)?;
    let mut ids = std::collections::HashSet::new();
    for column in &list.frontmatter.columns {
        if column.name.trim().is_empty() || !ids.insert(column.id.as_str()) {
            return Err(JinError::InvalidInput(
                "board columns need unique ids and nonempty names".into(),
            ));
        }
    }
    Ok(())
}

fn column_for_status<'a>(
    list: &'a List,
    task: &Task,
    status: &TaskStatus,
) -> Result<Option<&'a BoardColumn>> {
    if list.frontmatter.workflow_kind != Some(WorkflowKind::Board) {
        return Ok(None);
    }
    validate_board(list)?;
    if matches!(status, TaskStatus::Cancelled | TaskStatus::Deleted) {
        return Ok(None);
    }
    if let Some(current) = task.frontmatter.board_column_id.as_deref().and_then(|id| {
        list.frontmatter
            .columns
            .iter()
            .find(|column| column.id == id && compatible(column.column_type, status))
    }) {
        return Ok(Some(current));
    }
    let destination = match status {
        TaskStatus::Todo => Some(initial_column(list)?),
        TaskStatus::Doing => matching_column(list, BoardColumnType::InProgress)
            .or_else(|| matching_column(list, BoardColumnType::None)),
        TaskStatus::Done => matching_column(list, BoardColumnType::Done),
        TaskStatus::Cancelled | TaskStatus::Deleted => None,
    };
    destination.map(Some).ok_or_else(|| JinError::InvalidInput(
        "this Board has no In Progress or No status change column for ongoing work; choose a column or confirm an unchecked reset".into()
    ))
}

fn canonical_column<'a>(list: &'a List, column_id: &str) -> Result<&'a BoardColumn> {
    if list.frontmatter.workflow_kind != Some(WorkflowKind::Board) {
        return Err(JinError::InvalidInput(
            "the destination is not a Board".into(),
        ));
    }
    validate_board(list)?;
    list.frontmatter
        .columns
        .iter()
        .find(|column| column.id == column_id)
        .ok_or_else(|| {
            JinError::InvalidInput(format!("column/{column_id} is not in board/{}", list.id()))
        })
}

fn apply_status(task: &mut Task, status: TaskStatus, column_id: Option<String>) {
    let now = Local::now().fixed_offset();
    task.frontmatter.completed_at = if status == TaskStatus::Done {
        task.frontmatter.completed_at.or(Some(now))
    } else {
        None
    };
    if matches!(
        status,
        TaskStatus::Done | TaskStatus::Cancelled | TaskStatus::Deleted
    ) {
        task.frontmatter.agenda_bucket = None;
    }
    task.frontmatter.status = status;
    task.frontmatter.board_column_id = column_id;
    task.frontmatter.updated = now;
}

fn target_for_task(cfg: &Config, task: &Task) -> Result<TargetPlan> {
    let path = fs::find_task_path(&cfg.tasks_dir(), task.id())?;
    Ok(TargetPlan {
        before: Some(std::fs::read(&path)?),
        post: Some(fs::render_task_bytes(task)?),
        canonical_path: path,
    })
}

/// Create with a validated owning workflow. A new Board task starts in Queue
/// unless a concrete column is requested; checklist tasks never gain a column.
pub fn create_task(
    root: &Path,
    mut params: CreateTaskParams,
    column_id: Option<&str>,
) -> Result<Task> {
    super::lists::ensure_default_list_for_root(root)?;
    let cfg = Config::load(root)?;
    let id = new_ulid();
    recoverable_operations::execute_task_operation(
        root,
        &new_ulid(),
        "task_workflow_create",
        || {
            let list_id = params.list.clone().unwrap_or_else(|| "inbox".to_string());
            if let Some(parent_id) = params.parent.as_deref() {
                let parent = tasks::get_task(&cfg.tasks_dir(), parent_id)?;
                if parent.frontmatter.list != list_id {
                    return Err(JinError::InvalidInput(
                        "a subtask must stay in its parent's list or board".into(),
                    ));
                }
            }
            let list = owning_list(&cfg, &list_id)?;
            let mut initial_status = TaskStatus::Todo;
            let column = match list.frontmatter.workflow_kind {
                Some(WorkflowKind::Checklist) => {
                    if column_id.is_some() {
                        return Err(JinError::InvalidInput("a List has no board columns".into()));
                    }
                    None
                }
                Some(WorkflowKind::Board) => {
                    let column = if let Some(id) = column_id {
                        canonical_column(&list, id)?
                    } else {
                        validate_board(&list)?;
                        initial_column(&list)?
                    };
                    initial_status = status_for_destination(column.column_type, &TaskStatus::Todo);
                    Some(column.id.clone())
                }
                None => {
                    if column_id.is_some() {
                        return Err(JinError::InvalidInput(
                            "set up this existing list before using columns".into(),
                        ));
                    }
                    None
                }
            };
            params.list = Some(list_id);
            let mut task =
                tasks::prepare_new_task(&cfg.tasks_dir(), params, column, initial_status)?;
            task.frontmatter.id = id.clone();
            let path = cfg.tasks_dir().join(fs::task_filename(&id));
            Ok((
                id.clone(),
                vec![TargetPlan {
                    canonical_path: path,
                    before: None,
                    post: Some(fs::render_task_bytes(&task)?),
                }],
            ))
        },
    )?;
    tasks::get_task(&cfg.tasks_dir(), &id)
}

/// Status changes converge with Board placement and parent completion effects
/// under one recoverable operation. `done` and `doing` are distinct only on Boards.
pub fn transition_task(root: &Path, id: &str, next: TaskStatus) -> Result<Task> {
    let cfg = Config::load(root)?;
    let tasks_dir = cfg.tasks_dir();
    recoverable_operations::execute_task_operation(
        root,
        &new_ulid(),
        "task_workflow_status",
        || {
            let path = fs::find_task_path(&tasks_dir, id)?;
            let mut task = fs::read_task(&path)?;
            let list = owning_list(&cfg, &task.frontmatter.list)?;
            if task.is_deleted() || next == TaskStatus::Deleted {
                return Err(JinError::InvalidInput(
                    "deleted tasks cannot change workflow status".into(),
                ));
            }
            if list.frontmatter.workflow_kind == Some(WorkflowKind::Checklist)
                && !matches!(next, TaskStatus::Todo | TaskStatus::Done)
            {
                return Err(JinError::InvalidInput(
                    "Lists support only unchecked and completed tasks".into(),
                ));
            }
            if list.frontmatter.workflow_kind == Some(WorkflowKind::Board)
                && next == TaskStatus::Cancelled
            {
                return Err(JinError::InvalidInput(
                    "Boards use columns; Cancelled is reserved for existing work".into(),
                ));
            }
            if task.frontmatter.status == next {
                return Err(JinError::InvalidStateTransition {
                    from: next.to_string(),
                    to: next.to_string(),
                });
            }
            let allowed = task.frontmatter.status.can_transition_to(&next)
                || (list.frontmatter.workflow_kind == Some(WorkflowKind::Board)
                    && task.frontmatter.status == TaskStatus::Done
                    && next == TaskStatus::Doing);
            if !allowed {
                return Err(JinError::InvalidStateTransition {
                    from: task.frontmatter.status.to_string(),
                    to: next.to_string(),
                });
            }
            let mut plans = Vec::new();
            if matches!(next, TaskStatus::Done | TaskStatus::Cancelled) {
                for child_path in fs::list_task_paths(&tasks_dir)? {
                    let mut child = fs::read_task(&child_path)?;
                    if child.frontmatter.parent.as_deref() != Some(id)
                        || !matches!(
                            child.frontmatter.status,
                            TaskStatus::Todo | TaskStatus::Doing
                        )
                    {
                        continue;
                    }
                    let child_list = owning_list(&cfg, &child.frontmatter.list)?;
                    let child_column = column_for_status(&child_list, &child, &next)?
                        .map(|column| column.id.clone());
                    let before = std::fs::read(&child_path)?;
                    apply_status(&mut child, next.clone(), child_column);
                    plans.push(TargetPlan {
                        canonical_path: child_path,
                        before: Some(before),
                        post: Some(fs::render_task_bytes(&child)?),
                    });
                }
            }
            let column = column_for_status(&list, &task, &next)?.map(|column| column.id.clone());
            apply_status(&mut task, next.clone(), column);
            plans.push(target_for_task(&cfg, &task)?);
            Ok((id.to_string(), plans))
        },
    )?;
    tasks::get_task(&tasks_dir, id)
}

/// Metadata edits retain the owning workflow. A requested list change first
/// passes through the canonical move operation; callers cannot bypass typed
/// placement by writing `list` through the older generic edit path.
pub fn edit_task(root: &Path, id: &str, mut params: EditTaskParams) -> Result<Task> {
    let cfg = Config::load(root)?;
    recoverable_operations::execute_task_operation(
        root,
        &new_ulid(),
        "task_workflow_edit",
        || {
            let current = tasks::get_task(&cfg.tasks_dir(), id)?;
            let target_list = params
                .list
                .as_deref()
                .unwrap_or(&current.frontmatter.list)
                .to_string();
            let target = owning_list(&cfg, &target_list)?;
            if let Some(Some(parent_id)) = params.parent.as_ref() {
                tasks::validate_parent_assignment(&cfg.tasks_dir(), id, parent_id)?;
                let parent = tasks::get_task(&cfg.tasks_dir(), parent_id)?;
                if parent.frontmatter.list != target_list {
                    return Err(JinError::InvalidInput(
                        "a subtask must stay in its parent's list or board".into(),
                    ));
                }
            }
            if current.frontmatter.parent.is_some() && target_list != current.frontmatter.list {
                return Err(JinError::InvalidInput(
                    "move the parent to change a subtask's list or board".into(),
                ));
            }
            if let Some(section_id) = params.section_id.as_deref() {
                if !target
                    .frontmatter
                    .sections
                    .iter()
                    .any(|section| section.id == section_id)
                {
                    return Err(JinError::InvalidInput(format!(
                        "section/{section_id} is not in list/{target_list}"
                    )));
                }
            }
            let moving_container = target_list != current.frontmatter.list;
            if moving_container && params.section_id.is_none() {
                params.clear_section = true;
            }
            let (_, mut updates) = tasks::prepare_edit_task(&cfg.tasks_dir(), id, params)?;
            if updates.is_empty() {
                updates.push(current);
            }
            let mut plans = Vec::new();
            for mut update in updates {
                if moving_container {
                    if target.frontmatter.workflow_kind == Some(WorkflowKind::Checklist)
                        && update.frontmatter.status == TaskStatus::Doing
                    {
                        return Err(JinError::InvalidInput(
                            "In Progress work would become unchecked; use a confirmed Move action"
                                .into(),
                        ));
                    }
                    if target.frontmatter.workflow_kind == Some(WorkflowKind::Board) {
                        let status = update.frontmatter.status.clone();
                        let column = column_for_status(&target, &update, &status)?
                            .map(|column| column.id.clone());
                        apply_status(&mut update, status, column);
                    } else {
                        update.frontmatter.board_column_id = None;
                    }
                }
                plans.push(target_for_task(&cfg, &update)?);
            }
            Ok((id.to_string(), plans))
        },
    )?;
    tasks::get_task(&cfg.tasks_dir(), id)
}

/// One operation changes placement, lifecycle, and rank. Cross-container moves
/// of a Doing task into a checklist require an explicit owner acknowledgement.
pub struct MoveTaskParams {
    pub list_id: String,
    pub section_id: Option<String>,
    pub board_column_id: Option<String>,
    pub position: String,
    pub confirm_doing_to_checklist: bool,
}

pub fn move_task(root: &Path, id: &str, params: MoveTaskParams) -> Result<Task> {
    if params.position.is_empty() {
        return Err(JinError::InvalidInput("task position is required".into()));
    }
    let cfg = Config::load(root)?;
    let tasks_dir = cfg.tasks_dir();
    recoverable_operations::execute_task_operation(
        root,
        &new_ulid(),
        "task_workflow_move",
        || {
            let path = fs::find_task_path(&tasks_dir, id)?;
            let mut task = fs::read_task(&path)?;
            if task.is_deleted() {
                return Err(JinError::NotFound(format!("task/{id} is deleted")));
            }
            let old_status = task.frontmatter.status.clone();
            if task.frontmatter.parent.is_some() && task.frontmatter.list != params.list_id {
                return Err(JinError::InvalidInput(
                    "move the parent to change a subtask's list or board".into(),
                ));
            }
            let destination = owning_list(&cfg, &params.list_id)?;
            let same_container = task.frontmatter.list == params.list_id;
            if let Some(section_id) = params.section_id.as_deref() {
                if !destination
                    .frontmatter
                    .sections
                    .iter()
                    .any(|section| section.id == section_id)
                {
                    return Err(JinError::InvalidInput(format!(
                        "section/{section_id} is not in the destination"
                    )));
                }
            }
            let target_column = match params.board_column_id.as_deref() {
                Some(column_id) => Some(canonical_column(&destination, column_id)?),
                None => None,
            };
            if destination.frontmatter.workflow_kind != Some(WorkflowKind::Board)
                && target_column.is_some()
            {
                return Err(JinError::InvalidInput("a List has no board columns".into()));
            }
            if old_status == TaskStatus::Cancelled && target_column.is_some() {
                return Err(JinError::InvalidInput(
                    "restore Cancelled work before moving it into a column".into(),
                ));
            }
            let mut status = task.frontmatter.status.clone();
            if let Some(column) = target_column {
                status = status_for_destination(column.column_type, &status);
            }
            if destination.frontmatter.workflow_kind == Some(WorkflowKind::Checklist)
                && status == TaskStatus::Doing
            {
                if !params.confirm_doing_to_checklist {
                    return Err(JinError::InvalidInput("moving In Progress work to a List resets it to unchecked; confirm the move".into()));
                }
                status = TaskStatus::Todo;
            }
            if destination.frontmatter.workflow_kind == Some(WorkflowKind::Board)
                && status == TaskStatus::Doing
                && target_column.is_none()
                && matching_column(&destination, BoardColumnType::InProgress).is_none()
                && matching_column(&destination, BoardColumnType::None).is_none()
            {
                if !params.confirm_doing_to_checklist {
                    return Err(JinError::InvalidInput("this Board has no stage for In Progress work; confirm moving it as unchecked".into()));
                }
                status = TaskStatus::Todo;
            }
            let column = if let Some(explicit) = target_column {
                Some(explicit.id.clone())
            } else {
                column_for_status(&destination, &task, &status)?.map(|column| column.id.clone())
            };
            let mut plans = Vec::new();
            let entering_done = old_status != TaskStatus::Done && status == TaskStatus::Done;
            let placement_changed =
                !same_container || params.section_id != task.frontmatter.section_id;
            for child_path in fs::list_task_paths(&tasks_dir)? {
                let mut child = fs::read_task(&child_path)?;
                if child.frontmatter.parent.as_deref() != Some(id)
                    || child.is_deleted()
                    || (!placement_changed && !entering_done)
                {
                    continue;
                }
                let before = std::fs::read(&child_path)?;
                let mut child_status = child.frontmatter.status.clone();
                if destination.frontmatter.workflow_kind == Some(WorkflowKind::Checklist)
                    && child_status == TaskStatus::Doing
                {
                    if !params.confirm_doing_to_checklist {
                        return Err(JinError::InvalidInput(
                            "an In Progress subtask would become unchecked; confirm the move"
                                .into(),
                        ));
                    }
                    child_status = TaskStatus::Todo;
                }
                if entering_done && matches!(child_status, TaskStatus::Todo | TaskStatus::Doing) {
                    child_status = TaskStatus::Done;
                }
                if destination.frontmatter.workflow_kind == Some(WorkflowKind::Board)
                    && child_status == TaskStatus::Doing
                    && matching_column(&destination, BoardColumnType::InProgress).is_none()
                    && matching_column(&destination, BoardColumnType::None).is_none()
                {
                    if !params.confirm_doing_to_checklist {
                        return Err(JinError::InvalidInput(
                            "an In Progress subtask would become unchecked; confirm the move"
                                .into(),
                        ));
                    }
                    child_status = TaskStatus::Todo;
                }
                let child_column = column_for_status(&destination, &child, &child_status)?
                    .map(|column| column.id.clone());
                apply_status(&mut child, child_status, child_column);
                if placement_changed {
                    child.frontmatter.list = params.list_id.clone();
                    child.frontmatter.section_id = params.section_id.clone();
                }
                plans.push(TargetPlan {
                    canonical_path: child_path,
                    before: Some(before),
                    post: Some(fs::render_task_bytes(&child)?),
                });
            }
            apply_status(&mut task, status, column);
            task.frontmatter.list = params.list_id.clone();
            task.frontmatter.section_id = params.section_id.clone();
            task.frontmatter.position = params.position.clone();
            plans.push(target_for_task(&cfg, &task)?);
            Ok((id.to_string(), plans))
        },
    )?;
    tasks::get_task(&tasks_dir, id)
}

/// Snapshot shown in the setup dialog. `snapshot` covers the full canonical
/// list file and every task file currently belonging to the container, so a
/// new task or external edit invalidates Apply before any post-image is staged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSetupPreview {
    pub list_id: String,
    pub target: WorkflowKind,
    pub snapshot: String,
    pub todo: usize,
    pub doing: usize,
    pub done: usize,
    pub cancelled: usize,
    pub subtasks: usize,
}

fn setup_snapshot(
    cfg: &Config,
    list_id: &str,
    target: WorkflowKind,
) -> Result<WorkflowSetupPreview> {
    let list_path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    let list = fs::read_list(&list_path)?;
    if list.frontmatter.workflow_kind.is_some() {
        return Err(JinError::InvalidInput(
            "this list already has a workflow".into(),
        ));
    }
    if list_id == "inbox" && target == WorkflowKind::Board {
        return Err(JinError::InvalidInput("Inbox cannot become a Board".into()));
    }
    let mut hasher = Sha256::new();
    hasher.update(target.as_str().as_bytes());
    hasher.update(std::fs::read(list_path)?);
    let mut result = WorkflowSetupPreview {
        list_id: list_id.to_string(),
        target,
        snapshot: String::new(),
        todo: 0,
        doing: 0,
        done: 0,
        cancelled: 0,
        subtasks: 0,
    };
    for path in fs::list_task_paths(&cfg.tasks_dir())? {
        let task = fs::read_task(&path)?;
        if task.frontmatter.list != list_id {
            continue;
        }
        hasher.update(task.id().as_bytes());
        hasher.update(std::fs::read(&path)?);
        if task.is_deleted() {
            continue;
        }
        match task.frontmatter.status {
            TaskStatus::Todo => result.todo += 1,
            TaskStatus::Doing => result.doing += 1,
            TaskStatus::Done => result.done += 1,
            TaskStatus::Cancelled => result.cancelled += 1,
            TaskStatus::Deleted => (),
        }
        if task.frontmatter.parent.is_some() {
            result.subtasks += 1;
        }
    }
    result.snapshot = format!("{:x}", hasher.finalize());
    Ok(result)
}

pub fn preview_setup(
    root: &Path,
    list_id: &str,
    target: WorkflowKind,
) -> Result<WorkflowSetupPreview> {
    let cfg = Config::load(root)?;
    setup_snapshot(&cfg, list_id, target)
}

/// Apply only the previewed snapshot. The journal stages complete images and
/// replays the derived-index rebuild after canonical convergence.
pub fn apply_setup(
    root: &Path,
    list_id: &str,
    target: WorkflowKind,
    expected_snapshot: &str,
    operation_id: &str,
) -> Result<List> {
    let cfg = Config::load(root)?;
    recoverable_operations::execute_task_operation(root, operation_id, "setup_workflow", || {
        let fresh = setup_snapshot(&cfg, list_id, target)?;
        if fresh.snapshot != expected_snapshot {
            return Err(JinError::InvalidInput(
                "the list changed since preview; refresh setup before applying".into(),
            ));
        }
        let list_path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
        let list_before = std::fs::read(&list_path)?;
        let mut list = fs::read_list(&list_path)?;
        list.frontmatter.workflow_kind = Some(target);
        list.frontmatter.columns = if target == WorkflowKind::Board {
            super::lists::default_board_columns()
        } else {
            vec![]
        };
        list.frontmatter.initial_column_id = list
            .frontmatter
            .columns
            .first()
            .map(|column| column.id.clone());
        list.frontmatter.updated = Local::now().fixed_offset();
        let mut plans = Vec::new();
        for path in fs::list_task_paths(&cfg.tasks_dir())? {
            let mut task = fs::read_task(&path)?;
            if task.frontmatter.list != list_id || task.is_deleted() {
                continue;
            }
            let before = std::fs::read(&path)?;
            let old_status = task.frontmatter.status.clone();
            let old_column = task.frontmatter.board_column_id.clone();
            match target {
                WorkflowKind::Checklist => {
                    task.frontmatter.board_column_id = None;
                    if task.frontmatter.status == TaskStatus::Doing {
                        task.frontmatter.status = TaskStatus::Todo;
                    }
                }
                WorkflowKind::Board => {
                    let column = column_for_status(&list, &task, &task.frontmatter.status)?
                        .map(|column| column.id.clone());
                    task.frontmatter.board_column_id = column;
                }
            }
            if task.frontmatter.status != old_status
                || task.frontmatter.board_column_id != old_column
            {
                plans.push(TargetPlan {
                    canonical_path: path,
                    before: Some(before),
                    post: Some(fs::render_task_bytes(&task)?),
                });
            }
        }
        plans.push(TargetPlan {
            canonical_path: list_path,
            before: Some(list_before),
            post: Some(fs::render_list_bytes(&list)?),
        });
        Ok((list_id.to_string(), plans))
    })?;
    let list_path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
    fs::read_list(&list_path)
}

fn edit_board_columns<F>(root: &Path, list_id: &str, kind: &str, edit: F) -> Result<List>
where
    F: FnOnce(&mut List) -> Result<()>,
{
    let cfg = Config::load(root)?;
    recoverable_operations::execute_task_operation(root, &new_ulid(), kind, || {
        let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
        let before = std::fs::read(&path)?;
        let mut list = fs::read_list(&path)?;
        if list.frontmatter.workflow_kind != Some(WorkflowKind::Board) {
            return Err(JinError::InvalidInput(
                "columns belong to Boards only".into(),
            ));
        }
        if list.frontmatter.initial_column_id.is_none() {
            if let Ok(initial) = initial_column(&list) {
                list.frontmatter.initial_column_id = Some(initial.id.clone());
            }
        }
        edit(&mut list)?;
        if list.frontmatter.initial_column_id.is_none() {
            list.frontmatter.initial_column_id = Some(initial_column(&list)?.id.clone());
        }
        validate_board(&list)?;
        list.frontmatter.updated = Local::now().fixed_offset();
        Ok((
            list_id.to_string(),
            vec![TargetPlan {
                canonical_path: path,
                before: Some(before),
                post: Some(fs::render_list_bytes(&list)?),
            }],
        ))
    })?;
    fs::read_list(&fs::find_list_path(&cfg.lists_dir(), list_id)?)
}

pub fn set_initial_column(root: &Path, list_id: &str, column_id: &str) -> Result<List> {
    edit_board_columns(root, list_id, "set_board_initial_column", |list| {
        let selected = list
            .frontmatter
            .columns
            .iter()
            .find(|column| column.id == column_id)
            .ok_or_else(|| JinError::NotFound(format!("column/{column_id}")))?;
        if !matches!(
            selected.column_type,
            BoardColumnType::Queue | BoardColumnType::None
        ) {
            return Err(JinError::InvalidInput(
                "new tasks must start in Queue or No status change".into(),
            ));
        }
        list.frontmatter.initial_column_id = Some(column_id.to_string());
        Ok(())
    })
}

pub fn create_column(
    root: &Path,
    list_id: &str,
    name: &str,
    column_type: BoardColumnType,
) -> Result<List> {
    let name = name.trim();
    if name.is_empty() {
        return Err(JinError::InvalidInput("column name is required".into()));
    }
    edit_board_columns(root, list_id, "create_board_column", |list| {
        let last = list
            .frontmatter
            .columns
            .iter()
            .map(|column| column.position.as_str())
            .max();
        list.frontmatter.columns.push(BoardColumn {
            id: new_ulid(),
            name: name.to_string(),
            position: crate::order::between(last, None),
            column_type,
        });
        Ok(())
    })
}

pub fn rename_column(root: &Path, list_id: &str, column_id: &str, name: &str) -> Result<List> {
    let name = name.trim();
    if name.is_empty() {
        return Err(JinError::InvalidInput("column name is required".into()));
    }
    edit_board_columns(root, list_id, "rename_board_column", |list| {
        let column = list
            .frontmatter
            .columns
            .iter_mut()
            .find(|column| column.id == column_id)
            .ok_or_else(|| JinError::NotFound(format!("column/{column_id}")))?;
        column.name = name.to_string();
        Ok(())
    })
}

pub fn reorder_column(root: &Path, list_id: &str, column_id: &str, position: &str) -> Result<List> {
    if position.is_empty() {
        return Err(JinError::InvalidInput("column position is required".into()));
    }
    edit_board_columns(root, list_id, "reorder_board_column", |list| {
        let column = list
            .frontmatter
            .columns
            .iter_mut()
            .find(|column| column.id == column_id)
            .ok_or_else(|| JinError::NotFound(format!("column/{column_id}")))?;
        column.position = position.to_string();
        Ok(())
    })
}

pub fn change_column_type(
    root: &Path,
    list_id: &str,
    column_id: &str,
    next: BoardColumnType,
) -> Result<List> {
    let cfg = Config::load(root)?;
    edit_board_columns(root, list_id, "change_board_column_type", |list| {
        if !list
            .frontmatter
            .columns
            .iter()
            .any(|column| column.id == column_id)
        {
            return Err(JinError::NotFound(format!("column/{column_id}")));
        }
        let occupied = fs::list_task_paths(&cfg.tasks_dir())?
            .iter()
            .filter_map(|path| fs::read_task(path).ok())
            .any(|task| {
                !task.is_deleted()
                    && task.frontmatter.list == list_id
                    && task.frontmatter.board_column_id.as_deref() == Some(column_id)
            });
        if occupied {
            return Err(JinError::InvalidInput(
                "move tasks out before changing this column's type".into(),
            ));
        }
        let column = list
            .frontmatter
            .columns
            .iter_mut()
            .find(|column| column.id == column_id)
            .unwrap();
        column.column_type = next;
        Ok(())
    })
}

/// Removing an occupied column requires a concrete status-compatible
/// replacement. The same explicit choice replaces an initial column.
/// The list and every affected task converge under one journal entry.
pub fn delete_column(
    root: &Path,
    list_id: &str,
    column_id: &str,
    replacement_id: Option<&str>,
) -> Result<List> {
    let cfg = Config::load(root)?;
    recoverable_operations::execute_task_operation(
        root,
        &new_ulid(),
        "delete_board_column",
        || {
            let path = fs::find_list_path(&cfg.lists_dir(), list_id)?;
            let before = std::fs::read(&path)?;
            let mut list = fs::read_list(&path)?;
            let removed = canonical_column(&list, column_id)?.clone();
            let old_initial_id = initial_column(&list)?.id.clone();
            let replacement = replacement_id
                .map(|id| canonical_column(&list, id))
                .transpose()?
                .cloned();
            if replacement
                .as_ref()
                .is_some_and(|column| column.id == removed.id)
            {
                return Err(JinError::InvalidInput(
                    "replacement must be another column".into(),
                ));
            }
            if old_initial_id == removed.id {
                let Some(selected) = replacement.as_ref() else {
                    return Err(JinError::InvalidInput(
                        "choose a new initial column before deleting this one".into(),
                    ));
                };
                if !matches!(
                    selected.column_type,
                    BoardColumnType::Queue | BoardColumnType::None
                ) {
                    return Err(JinError::InvalidInput(
                        "new tasks must start in Queue or No status change".into(),
                    ));
                }
            }
            let mut plans = Vec::new();
            for task_path in fs::list_task_paths(&cfg.tasks_dir())? {
                let mut task = fs::read_task(&task_path)?;
                if task.is_deleted()
                    || task.frontmatter.list != list_id
                    || task.frontmatter.board_column_id.as_deref() != Some(column_id)
                {
                    continue;
                }
                let Some(replacement) = replacement.as_ref() else {
                    return Err(JinError::InvalidInput(
                        "choose a destination for tasks in this column".into(),
                    ));
                };
                if !compatible(replacement.column_type, &task.frontmatter.status) {
                    return Err(JinError::InvalidInput("the replacement cannot hold every task in this column; move incompatible tasks first".into()));
                }
                let task_before = std::fs::read(&task_path)?;
                task.frontmatter.board_column_id = Some(replacement.id.clone());
                plans.push(TargetPlan {
                    canonical_path: task_path,
                    before: Some(task_before),
                    post: Some(fs::render_task_bytes(&task)?),
                });
            }
            list.frontmatter
                .columns
                .retain(|column| column.id != column_id);
            if old_initial_id == removed.id {
                list.frontmatter.initial_column_id =
                    replacement.as_ref().map(|column| column.id.clone());
            } else if list.frontmatter.initial_column_id.is_none() {
                list.frontmatter.initial_column_id = Some(old_initial_id);
            }
            validate_board(&list)?;
            list.frontmatter.updated = Local::now().fixed_offset();
            plans.push(TargetPlan {
                canonical_path: path,
                before: Some(before),
                post: Some(fs::render_list_bytes(&list)?),
            });
            Ok((list_id.to_string(), plans))
        },
    )?;
    fs::read_list(&fs::find_list_path(&cfg.lists_dir(), list_id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{self, api, lists};
    use tempfile::TempDir;

    fn vault() -> TempDir {
        let tmp = TempDir::new().unwrap();
        ops::init(tmp.path()).unwrap();
        tmp
    }

    fn list(root: &Path, name: &str, kind: WorkflowKind) -> crate::dto::ListDto {
        lists::create_list(
            root,
            lists::CreateListParams {
                name: name.into(),
                color: "accent".into(),
                icon: "list".into(),
                parent_id: None,
                workflow_kind: Some(kind),
            },
        )
        .unwrap()
    }

    fn task(
        root: &Path,
        list_id: &str,
        title: &str,
        column: Option<&str>,
        parent: Option<&str>,
    ) -> Task {
        create_task(
            root,
            CreateTaskParams {
                title: title.into(),
                body: "body stays".into(),
                priority: None,
                due: None,
                list: Some(list_id.into()),
                tags: None,
                reminders: None,
                parent: parent.map(str::to_string),
            },
            column,
        )
        .unwrap()
    }

    #[test]
    fn board_columns_drive_status_and_same_type_move_keeps_completion_time() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        assert_eq!(board.columns.len(), 3);
        let done = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::Done)
            .unwrap();
        let created = task(root, &board.id, "Ship", Some(&done.id), None);
        assert_eq!(created.frontmatter.status, TaskStatus::Done);
        let completed_at = created.frontmatter.completed_at;
        let updated = create_column(root, &board.id, "Shipped", BoardColumnType::Done).unwrap();
        let second = updated
            .frontmatter
            .columns
            .iter()
            .find(|column| column.name == "Shipped")
            .unwrap();
        let moved = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: board.id,
                section_id: None,
                board_column_id: Some(second.id.clone()),
                position: "V".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        assert_eq!(moved.frontmatter.status, TaskStatus::Done);
        assert_eq!(moved.frontmatter.completed_at, completed_at);
        assert_eq!(
            moved.frontmatter.board_column_id.as_deref(),
            Some(second.id.as_str())
        );
    }

    #[test]
    fn board_doing_to_checklist_requires_confirmation_and_clears_column() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let checklist = list(root, "Home", WorkflowKind::Checklist);
        let doing = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap();
        let created = task(root, &board.id, "Review", Some(&doing.id), None);
        assert!(move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: checklist.id.clone(),
                section_id: None,
                board_column_id: None,
                position: "V".into(),
                confirm_doing_to_checklist: false,
            }
        )
        .is_err());
        let untouched = api::get_task(root, created.id()).unwrap();
        assert_eq!(untouched.list, board.id);
        assert_eq!(untouched.status, "doing");
        assert_eq!(
            untouched.board_column_id.as_deref(),
            Some(doing.id.as_str())
        );
        let moved = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: checklist.id.clone(),
                section_id: None,
                board_column_id: None,
                position: "V".into(),
                confirm_doing_to_checklist: true,
            },
        )
        .unwrap();
        assert_eq!(moved.frontmatter.list, checklist.id);
        assert_eq!(moved.frontmatter.status, TaskStatus::Todo);
        assert!(moved.frontmatter.board_column_id.is_none());
        assert!(moved.frontmatter.completed_at.is_none());
    }

    #[test]
    fn neutral_columns_preserve_distinct_open_stages_and_reopen_done_work() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let backlog = create_column(root, &board.id, "Backlog", BoardColumnType::None).unwrap();
        let backlog_id = backlog
            .frontmatter
            .columns
            .iter()
            .find(|column| column.name == "Backlog")
            .unwrap()
            .id
            .clone();
        let review = create_column(root, &board.id, "Review", BoardColumnType::None).unwrap();
        let review_id = review
            .frontmatter
            .columns
            .iter()
            .find(|column| column.name == "Review")
            .unwrap()
            .id
            .clone();
        let doing_id = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap()
            .id
            .clone();
        let done_id = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::Done)
            .unwrap()
            .id
            .clone();
        let created = task(root, &board.id, "Sketch", Some(&backlog_id), None);
        assert_eq!(created.frontmatter.status, TaskStatus::Todo);
        let review_todo = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(review_id.clone()),
                position: "V".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        assert_eq!(review_todo.frontmatter.status, TaskStatus::Todo);
        assert_eq!(
            review_todo.frontmatter.board_column_id.as_deref(),
            Some(review_id.as_str())
        );
        let doing = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(doing_id),
                position: "W".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        assert_eq!(doing.frontmatter.status, TaskStatus::Doing);
        let review_doing = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(review_id.clone()),
                position: "X".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        assert_eq!(review_doing.frontmatter.status, TaskStatus::Doing);
        assert_eq!(
            review_doing.frontmatter.board_column_id.as_deref(),
            Some(review_id.as_str())
        );
        let completed = transition_task(root, created.id(), TaskStatus::Done).unwrap();
        assert_eq!(
            completed.frontmatter.board_column_id.as_deref(),
            Some(done_id.as_str())
        );
        assert!(completed.frontmatter.completed_at.is_some());
        let reopened = move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(review_id.clone()),
                position: "Y".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        assert_eq!(reopened.frontmatter.status, TaskStatus::Todo);
        assert!(reopened.frontmatter.completed_at.is_none());
        assert_eq!(
            reopened.frontmatter.board_column_id.as_deref(),
            Some(review_id.as_str())
        );
        // A same-status metadata write and rebuild cannot collapse Review into Backlog.
        let updated = edit_task(
            root,
            created.id(),
            EditTaskParams {
                title: Some("Reviewed".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            updated.frontmatter.board_column_id.as_deref(),
            Some(review_id.as_str())
        );
        let cfg = Config::load(root).unwrap();
        let mut conn = crate::index::open(&cfg.index_path()).unwrap();
        crate::index::rebuild::rebuild(&mut conn, root).unwrap();
        let row = api::get_task(root, created.id()).unwrap();
        assert_eq!(row.board_column_id.as_deref(), Some(review_id.as_str()));
    }

    #[test]
    fn initial_column_is_explicit_and_in_progress_column_is_optional() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let queue_id = board.initial_column_id.clone().unwrap();
        let backlog = create_column(root, &board.id, "Backlog", BoardColumnType::None).unwrap();
        let backlog_id = backlog
            .frontmatter
            .columns
            .iter()
            .find(|column| column.name == "Backlog")
            .unwrap()
            .id
            .clone();
        set_initial_column(root, &board.id, &backlog_id).unwrap();
        let in_progress_id = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap()
            .id
            .clone();
        delete_column(root, &board.id, &in_progress_id, None).unwrap();
        let new_task = task(root, &board.id, "New", None, None);
        assert_eq!(new_task.frontmatter.status, TaskStatus::Todo);
        assert_eq!(
            new_task.frontmatter.board_column_id.as_deref(),
            Some(backlog_id.as_str())
        );
        assert!(delete_column(root, &board.id, &backlog_id, None).is_err());
        let moved_initial = delete_column(root, &board.id, &backlog_id, Some(&queue_id)).unwrap();
        assert_eq!(
            moved_initial.frontmatter.initial_column_id.as_deref(),
            Some(queue_id.as_str())
        );
        assert_eq!(
            api::get_task(root, new_task.id())
                .unwrap()
                .board_column_id
                .as_deref(),
            Some(queue_id.as_str())
        );
        let done_id = board
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::Done)
            .unwrap()
            .id
            .clone();
        assert!(delete_column(root, &board.id, &done_id, None).is_err());
    }

    #[test]
    fn confirmed_move_into_board_without_doing_stage_resets_parent_and_child_atomically() {
        let tmp = vault();
        let root = tmp.path();
        let source = list(root, "Source", WorkflowKind::Board);
        let target = list(root, "Target", WorkflowKind::Board);
        let source_doing = source
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap();
        let target_doing = target
            .columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap();
        delete_column(root, &target.id, &target_doing.id, None).unwrap();
        for parent_doing in [true, false] {
            let parent = task(
                root,
                &source.id,
                "Parent",
                if parent_doing {
                    Some(&source_doing.id)
                } else {
                    None
                },
                None,
            );
            let child = task(
                root,
                &source.id,
                "Child",
                Some(&source_doing.id),
                Some(parent.id()),
            );
            let move_params = |confirm| MoveTaskParams {
                list_id: target.id.clone(),
                section_id: None,
                board_column_id: None,
                position: "V".into(),
                confirm_doing_to_checklist: confirm,
            };
            assert!(move_task(root, parent.id(), move_params(false)).is_err());
            assert_eq!(api::get_task(root, parent.id()).unwrap().list, source.id);
            assert_eq!(api::get_task(root, child.id()).unwrap().list, source.id);
            move_task(root, parent.id(), move_params(true)).unwrap();
            let moved_parent = api::get_task(root, parent.id()).unwrap();
            let moved_child = api::get_task(root, child.id()).unwrap();
            assert_eq!(moved_parent.status, "todo");
            assert_eq!(moved_child.status, "todo");
            assert_eq!(moved_parent.list, target.id);
            assert_eq!(moved_child.list, target.id);
            assert_eq!(moved_child.board_column_id, target.initial_column_id);
        }
    }

    #[test]
    fn old_board_initial_fallback_is_read_only_and_explicit_invalid_id_rejects() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let cfg = Config::load(root).unwrap();
        let path = fs::find_list_path(&cfg.lists_dir(), &board.id).unwrap();
        let mut canonical = fs::read_list(&path).unwrap();
        canonical.frontmatter.initial_column_id = None;
        fs::write_list(&cfg.lists_dir(), &canonical).unwrap();
        let before = std::fs::read(&path).unwrap();
        let created = task(root, &board.id, "Legacy default", None, None);
        assert_eq!(
            created.frontmatter.board_column_id.as_deref(),
            Some(board.columns.first().unwrap().id.as_str())
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        canonical.frontmatter.initial_column_id = Some("missing-column".into());
        fs::write_list(&cfg.lists_dir(), &canonical).unwrap();
        assert!(create_task(
            root,
            CreateTaskParams {
                title: "Should fail".into(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(board.id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
            None
        )
        .is_err());
        set_initial_column(root, &board.id, &board.columns.first().unwrap().id).unwrap();
    }

    #[test]
    fn cancelled_board_work_requires_explicit_restore() {
        let tmp = vault();
        let root = tmp.path();
        let legacy = list(root, "Old", WorkflowKind::Checklist);
        let cfg = Config::load(root).unwrap();
        let path = fs::find_list_path(&cfg.lists_dir(), &legacy.id).unwrap();
        let mut source = fs::read_list(&path).unwrap();
        source.frontmatter.workflow_kind = None;
        fs::write_list(&cfg.lists_dir(), &source).unwrap();
        let created = task(root, &legacy.id, "Cancelled", None, None);
        tasks::transition_task(&cfg.tasks_dir(), created.id(), TaskStatus::Cancelled).unwrap();
        let preview = preview_setup(root, &legacy.id, WorkflowKind::Board).unwrap();
        apply_setup(
            root,
            &legacy.id,
            WorkflowKind::Board,
            &preview.snapshot,
            &new_ulid(),
        )
        .unwrap();
        let columns = fs::read_list(&path).unwrap().frontmatter.columns;
        let doing = columns
            .iter()
            .find(|column| column.column_type == BoardColumnType::InProgress)
            .unwrap();
        assert!(transition_task(root, created.id(), TaskStatus::Done).is_err());
        assert!(move_task(
            root,
            created.id(),
            MoveTaskParams {
                list_id: legacy.id.clone(),
                section_id: None,
                board_column_id: Some(doing.id.clone()),
                position: "V".into(),
                confirm_doing_to_checklist: false,
            }
        )
        .is_err());
        let restored = transition_task(root, created.id(), TaskStatus::Todo).unwrap();
        assert_eq!(restored.frontmatter.status, TaskStatus::Todo);
        assert!(restored.frontmatter.board_column_id.is_some());
    }

    #[test]
    fn setup_refuses_stale_preview_and_preserves_task_metadata() {
        let tmp = vault();
        let root = tmp.path();
        let legacy = list(root, "Old", WorkflowKind::Checklist);
        let cfg = Config::load(root).unwrap();
        let path = fs::find_list_path(&cfg.lists_dir(), &legacy.id).unwrap();
        let mut source = fs::read_list(&path).unwrap();
        source.frontmatter.workflow_kind = None;
        fs::write_list(&cfg.lists_dir(), &source).unwrap();
        let created = task(root, &legacy.id, "Work", None, None);
        let doing =
            tasks::transition_task(&cfg.tasks_dir(), created.id(), TaskStatus::Doing).unwrap();
        let preview = preview_setup(root, &legacy.id, WorkflowKind::Checklist).unwrap();
        assert_eq!(preview.doing, 1);
        let mut changed = tasks::get_task(&cfg.tasks_dir(), created.id()).unwrap();
        changed.body.push_str(" externally");
        fs::write_task(&cfg.tasks_dir(), &changed).unwrap();
        assert!(apply_setup(
            root,
            &legacy.id,
            WorkflowKind::Checklist,
            &preview.snapshot,
            &new_ulid()
        )
        .is_err());
        let fresh = preview_setup(root, &legacy.id, WorkflowKind::Checklist).unwrap();
        apply_setup(
            root,
            &legacy.id,
            WorkflowKind::Checklist,
            &fresh.snapshot,
            &new_ulid(),
        )
        .unwrap();
        let converted = tasks::get_task(&cfg.tasks_dir(), created.id()).unwrap();
        assert_eq!(converted.frontmatter.status, TaskStatus::Todo);
        assert_eq!(converted.frontmatter.updated, doing.frontmatter.updated);
        assert_eq!(converted.body, "body stays externally");
        assert!(converted.frontmatter.board_column_id.is_none());
    }

    #[test]
    fn board_move_and_rebuild_keep_canonical_column_and_status_projection() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let doing = board
            .columns
            .iter()
            .find(|c| c.column_type == BoardColumnType::InProgress)
            .unwrap();
        let created = task(root, &board.id, "Draft", Some(&doing.id), None);
        assert_eq!(created.frontmatter.status, TaskStatus::Doing);
        assert_eq!(
            created.frontmatter.board_column_id.as_deref(),
            Some(doing.id.as_str())
        );
        let model = crate::dto::TaskDto::from_model(&created);
        let indexed = api::list_tasks(root, Some(&board.id), None, None, false).unwrap();
        let row = indexed.iter().find(|t| t.id == created.id()).unwrap();
        assert_eq!(model.board_column_id, row.board_column_id);
        assert_eq!(model.status, row.status);
        let cfg = Config::load(root).unwrap();
        let mut conn = crate::index::open(&cfg.index_path()).unwrap();
        crate::index::rebuild::rebuild(&mut conn, root).unwrap();
        let rebuilt = api::list_tasks(root, Some(&board.id), None, None, false).unwrap();
        let after = rebuilt.iter().find(|t| t.id == created.id()).unwrap();
        assert_eq!(after.board_column_id, model.board_column_id);
        assert_eq!(after.status, model.status);
        let round_trip = api::list_lists(root)
            .unwrap()
            .into_iter()
            .find(|l| l.id == board.id)
            .unwrap();
        assert_eq!(round_trip.workflow_kind, Some(WorkflowKind::Board));
        assert_eq!(round_trip.columns.len(), board.columns.len());
    }

    #[test]
    fn occupied_column_delete_requires_same_type_replacement_and_moves_tasks() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let queue = board
            .columns
            .iter()
            .find(|c| c.column_type == BoardColumnType::Queue)
            .unwrap();
        let created = task(root, &board.id, "Sketch", Some(&queue.id), None);
        let extra = create_column(root, &board.id, "Ready", BoardColumnType::Queue).unwrap();
        let ready = extra
            .frontmatter
            .columns
            .iter()
            .find(|c| c.name == "Ready")
            .unwrap();
        assert!(delete_column(root, &board.id, &queue.id, None).is_err());
        assert!(delete_column(
            root,
            &board.id,
            &queue.id,
            Some(
                &board
                    .columns
                    .iter()
                    .find(|c| c.column_type == BoardColumnType::Done)
                    .unwrap()
                    .id,
            )
        )
        .is_err());
        delete_column(root, &board.id, &queue.id, Some(&ready.id)).unwrap();
        let moved = api::get_task(root, created.id()).unwrap();
        assert_eq!(moved.status, "todo");
        assert_eq!(moved.board_column_id.as_deref(), Some(ready.id.as_str()));
        assert!(delete_column(root, &board.id, &ready.id, None).is_err());
    }

    #[test]
    fn same_board_done_reorder_does_not_recomplete_reopened_child_or_clear_its_group() {
        let tmp = vault();
        let root = tmp.path();
        let board = list(root, "Project", WorkflowKind::Board);
        let group = lists::create_section(root, &board.id, "Release".into()).unwrap();
        let queue = board
            .columns
            .iter()
            .find(|c| c.column_type == BoardColumnType::Queue)
            .unwrap();
        let done = board
            .columns
            .iter()
            .find(|c| c.column_type == BoardColumnType::Done)
            .unwrap();
        let parent = task(root, &board.id, "Parent", Some(&queue.id), None);
        let child = task(root, &board.id, "Child", Some(&queue.id), Some(parent.id()));
        let cfg = Config::load(root).unwrap();
        let mut child_file = tasks::get_task(&cfg.tasks_dir(), child.id()).unwrap();
        child_file.frontmatter.section_id = Some(group.id.clone());
        fs::write_task(&cfg.tasks_dir(), &child_file).unwrap();
        move_task(
            root,
            parent.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(done.id.clone()),
                position: "V".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        let completed_child = tasks::get_task(&cfg.tasks_dir(), child.id()).unwrap();
        assert_eq!(completed_child.frontmatter.status, TaskStatus::Done);
        assert_eq!(
            completed_child.frontmatter.section_id.as_deref(),
            Some(group.id.as_str())
        );
        transition_task(root, child.id(), TaskStatus::Todo).unwrap();
        let updated = create_column(root, &board.id, "Shipped", BoardColumnType::Done).unwrap();
        let shipped = updated
            .frontmatter
            .columns
            .iter()
            .find(|c| c.name == "Shipped")
            .unwrap();
        move_task(
            root,
            parent.id(),
            MoveTaskParams {
                list_id: board.id.clone(),
                section_id: None,
                board_column_id: Some(shipped.id.clone()),
                position: "W".into(),
                confirm_doing_to_checklist: false,
            },
        )
        .unwrap();
        let reopened_child = tasks::get_task(&cfg.tasks_dir(), child.id()).unwrap();
        assert_eq!(reopened_child.frontmatter.status, TaskStatus::Todo);
        assert_eq!(
            reopened_child.frontmatter.section_id.as_deref(),
            Some(group.id.as_str())
        );
    }
}
