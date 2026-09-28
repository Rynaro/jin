//! List CRUD commands — Tauri bridge for the P3 List surface.
//!
//! Each exported `*_fn` is directly callable from integration tests (no runtime).
//! The async `#[tauri::command]` wrappers delegate to the `*_fn`.

use std::path::Path;

use serde::Deserialize;

use jin_core::dto::{ListDto, SectionDto};
use jin_core::model::list::{BoardColumnType, WorkflowKind};
use jin_core::ops::{api, lists, workflows};

use crate::error::JinErrorDto;
use crate::state::AppState;

// ── Input types ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateListInput {
    pub name: String,
    pub color: String,
    pub icon: String,
    pub parent_id: Option<String>,
    pub workflow_kind: Option<String>,
}

// ── Section inputs (P5) ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateSectionInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameSectionInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderSectionInput {
    pub position: String,
}

#[derive(Debug, Deserialize)]
pub struct EditListInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub view: Option<String>,
    pub sort_mode: Option<String>,
    /// `Some(Some(id))` = set parent, `Some(None)` = clear parent, `None` = no change.
    pub parent_id: Option<Option<String>>,
}

fn parse_workflow_kind(value: &str) -> Result<WorkflowKind, JinErrorDto> {
    match value {
        "checklist" => Ok(WorkflowKind::Checklist),
        "board" => Ok(WorkflowKind::Board),
        _ => Err(JinErrorDto::from(jin_core::JinError::InvalidInput(
            format!("unknown workflow kind: {value}"),
        ))),
    }
}

fn parse_column_type(value: &str) -> Result<BoardColumnType, JinErrorDto> {
    match value {
        "queue" => Ok(BoardColumnType::Queue),
        "none" => Ok(BoardColumnType::None),
        "in_progress" => Ok(BoardColumnType::InProgress),
        "done" => Ok(BoardColumnType::Done),
        _ => Err(JinErrorDto::from(jin_core::JinError::InvalidInput(
            format!("unknown board column type: {value}"),
        ))),
    }
}

fn current_list(root: &Path, id: &str) -> Result<ListDto, JinErrorDto> {
    list_lists_fn(root)?
        .into_iter()
        .find(|list| list.id == id)
        .ok_or_else(|| JinErrorDto::from(jin_core::JinError::NotFound(format!("list/{id}"))))
}

pub fn preview_workflow_setup_fn(
    root: &Path,
    id: &str,
    target: &str,
) -> Result<workflows::WorkflowSetupPreview, JinErrorDto> {
    workflows::preview_setup(root, id, parse_workflow_kind(target)?).map_err(JinErrorDto::from)
}

pub fn apply_workflow_setup_fn(
    root: &Path,
    id: &str,
    target: &str,
    snapshot: &str,
    operation_id: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::apply_setup(
        root,
        id,
        parse_workflow_kind(target)?,
        snapshot,
        operation_id,
    )
    .map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn create_board_column_fn(
    root: &Path,
    id: &str,
    name: &str,
    column_type: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::create_column(root, id, name, parse_column_type(column_type)?)
        .map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn set_initial_board_column_fn(
    root: &Path,
    id: &str,
    column_id: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::set_initial_column(root, id, column_id).map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn rename_board_column_fn(
    root: &Path,
    id: &str,
    column_id: &str,
    name: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::rename_column(root, id, column_id, name).map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn reorder_board_column_fn(
    root: &Path,
    id: &str,
    column_id: &str,
    position: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::reorder_column(root, id, column_id, position).map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn change_board_column_type_fn(
    root: &Path,
    id: &str,
    column_id: &str,
    column_type: &str,
) -> Result<ListDto, JinErrorDto> {
    workflows::change_column_type(root, id, column_id, parse_column_type(column_type)?)
        .map_err(JinErrorDto::from)?;
    current_list(root, id)
}

pub fn delete_board_column_fn(
    root: &Path,
    id: &str,
    column_id: &str,
    replacement_id: Option<&str>,
) -> Result<ListDto, JinErrorDto> {
    workflows::delete_column(root, id, column_id, replacement_id).map_err(JinErrorDto::from)?;
    current_list(root, id)
}

// ── Testable implementations ───────────────────────────────────────────────────

pub fn list_lists_fn(root: &Path) -> Result<Vec<ListDto>, JinErrorDto> {
    lists::list_lists(root).map_err(JinErrorDto::from)
}

pub fn create_list_fn(root: &Path, input: CreateListInput) -> Result<ListDto, JinErrorDto> {
    lists::create_list(
        root,
        lists::CreateListParams {
            name: input.name,
            color: input.color,
            icon: input.icon,
            parent_id: input.parent_id,
            workflow_kind: match input.workflow_kind.as_deref() {
                None | Some("checklist") => Some(jin_core::model::list::WorkflowKind::Checklist),
                Some("board") => Some(jin_core::model::list::WorkflowKind::Board),
                Some(other) => {
                    return Err(JinErrorDto::from(jin_core::JinError::InvalidInput(
                        format!("unknown workflow kind: {other}"),
                    )))
                }
            },
        },
    )
    .map_err(JinErrorDto::from)
}

pub fn edit_list_fn(root: &Path, id: String, input: EditListInput) -> Result<ListDto, JinErrorDto> {
    lists::edit_list(
        root,
        &id,
        lists::EditListParams {
            name: input.name,
            color: input.color,
            icon: input.icon,
            view: input.view,
            sort_mode: input.sort_mode,
            parent_id: input.parent_id,
        },
    )
    .map_err(JinErrorDto::from)
}

pub fn reorder_list_fn(root: &Path, id: String, position: String) -> Result<ListDto, JinErrorDto> {
    lists::reorder_list(root, &id, position).map_err(JinErrorDto::from)
}

pub fn delete_list_fn(root: &Path, id: String) -> Result<(), JinErrorDto> {
    lists::delete_list(root, &id).map_err(JinErrorDto::from)
}

pub fn delete_list_confirmed_fn(
    root: &Path,
    id: String,
    confirm_doing: bool,
) -> Result<(), JinErrorDto> {
    lists::delete_list_with_confirmation(root, &id, confirm_doing).map_err(JinErrorDto::from)
}

// ── Section fn wrappers (P5) ──────────────────────────────────────────────────

pub fn create_section_fn(
    root: &Path,
    list_id: String,
    input: CreateSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::create_section(root, &list_id, input.name).map_err(JinErrorDto::from)
}

pub fn rename_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
    input: RenameSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::rename_section(root, &list_id, &section_id, input.name).map_err(JinErrorDto::from)
}

pub fn reorder_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
    input: ReorderSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    lists::reorder_section(root, &list_id, &section_id, input.position).map_err(JinErrorDto::from)
}

pub fn delete_section_fn(
    root: &Path,
    list_id: String,
    section_id: String,
) -> Result<(), JinErrorDto> {
    lists::delete_section(root, &list_id, &section_id).map_err(JinErrorDto::from)
}

/// Ensure the default Inbox list is seeded (used at app init).
pub fn ensure_default_list_fn(root: &Path) -> Result<(), JinErrorDto> {
    lists::ensure_default_list_for_root(root).map_err(JinErrorDto::from)?;
    api::refresh(root).map_err(JinErrorDto::from)?;
    Ok(())
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

// ── Section Tauri commands (P5) ───────────────────────────────────────────────

#[tauri::command(rename_all = "snake_case")]
pub async fn create_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    input: CreateSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    create_section_fn(&state.root, list_id, input)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rename_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
    input: RenameSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    rename_section_fn(&state.root, list_id, section_id, input)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn reorder_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
    input: ReorderSectionInput,
) -> Result<SectionDto, JinErrorDto> {
    reorder_section_fn(&state.root, list_id, section_id, input)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn delete_section(
    state: tauri::State<'_, AppState>,
    list_id: String,
    section_id: String,
) -> Result<(), JinErrorDto> {
    delete_section_fn(&state.root, list_id, section_id)
}

#[tauri::command]
pub async fn list_lists(state: tauri::State<'_, AppState>) -> Result<Vec<ListDto>, JinErrorDto> {
    list_lists_fn(&state.root)
}

#[tauri::command]
pub async fn create_list(
    state: tauri::State<'_, AppState>,
    input: CreateListInput,
) -> Result<ListDto, JinErrorDto> {
    create_list_fn(&state.root, input)
}

#[tauri::command]
pub async fn edit_list(
    state: tauri::State<'_, AppState>,
    id: String,
    input: EditListInput,
) -> Result<ListDto, JinErrorDto> {
    edit_list_fn(&state.root, id, input)
}

#[tauri::command]
pub async fn reorder_list(
    state: tauri::State<'_, AppState>,
    id: String,
    position: String,
) -> Result<ListDto, JinErrorDto> {
    reorder_list_fn(&state.root, id, position)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn delete_list(
    state: tauri::State<'_, AppState>,
    id: String,
    confirm_doing: Option<bool>,
) -> Result<(), JinErrorDto> {
    delete_list_confirmed_fn(&state.root, id, confirm_doing.unwrap_or(false))
}

#[tauri::command]
pub async fn preview_workflow_setup(
    state: tauri::State<'_, AppState>,
    id: String,
    target: String,
) -> Result<workflows::WorkflowSetupPreview, JinErrorDto> {
    preview_workflow_setup_fn(&state.root, &id, &target)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn apply_workflow_setup(
    state: tauri::State<'_, AppState>,
    id: String,
    target: String,
    snapshot: String,
    operation_id: String,
) -> Result<ListDto, JinErrorDto> {
    apply_workflow_setup_fn(&state.root, &id, &target, &snapshot, &operation_id)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn create_board_column(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    column_type: String,
) -> Result<ListDto, JinErrorDto> {
    create_board_column_fn(&state.root, &id, &name, &column_type)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_initial_board_column(
    state: tauri::State<'_, AppState>,
    id: String,
    column_id: String,
) -> Result<ListDto, JinErrorDto> {
    set_initial_board_column_fn(&state.root, &id, &column_id)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rename_board_column(
    state: tauri::State<'_, AppState>,
    id: String,
    column_id: String,
    name: String,
) -> Result<ListDto, JinErrorDto> {
    rename_board_column_fn(&state.root, &id, &column_id, &name)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn reorder_board_column(
    state: tauri::State<'_, AppState>,
    id: String,
    column_id: String,
    position: String,
) -> Result<ListDto, JinErrorDto> {
    reorder_board_column_fn(&state.root, &id, &column_id, &position)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn change_board_column_type(
    state: tauri::State<'_, AppState>,
    id: String,
    column_id: String,
    column_type: String,
) -> Result<ListDto, JinErrorDto> {
    change_board_column_type_fn(&state.root, &id, &column_id, &column_type)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn delete_board_column(
    state: tauri::State<'_, AppState>,
    id: String,
    column_id: String,
    replacement_id: Option<String>,
) -> Result<ListDto, JinErrorDto> {
    delete_board_column_fn(&state.root, &id, &column_id, replacement_id.as_deref())
}

#[cfg(test)]
mod ipc_tests {
    use super::*;
    use jin_core::model::task::TaskStatus;
    use jin_core::ops::{api, tasks, workflows};
    use serde_json::{json, Value};

    #[test]
    fn workflow_and_column_payloads_cross_the_real_tauri_decoder() {
        let root = tempfile::tempdir().unwrap();
        jin_core::ops::init(root.path()).unwrap();

        // Mirror the reported populated legacy Inbox without touching a user
        // vault: six parent To Do tasks, four subtasks and three Done tasks.
        let make_task = |title: String, parent: Option<String>| {
            workflows::create_task(
                root.path(),
                tasks::CreateTaskParams {
                    title,
                    body: String::new(),
                    priority: None,
                    due: None,
                    list: Some("inbox".into()),
                    tags: None,
                    reminders: None,
                    parent,
                },
                None,
            )
            .unwrap()
        };
        let parents = (0..6)
            .map(|n| make_task(format!("To Do {n}"), None))
            .collect::<Vec<_>>();
        for (n, parent) in parents.iter().take(4).enumerate() {
            make_task(format!("Subtask {n}"), Some(parent.id().into()));
        }
        for n in 0..3 {
            let done = make_task(format!("Done {n}"), None);
            workflows::transition_task(root.path(), done.id(), TaskStatus::Done).unwrap();
        }
        let cfg = jin_core::Config::load(root.path()).unwrap();
        let inbox_path = jin_core::store::fs::find_list_path(&cfg.lists_dir(), "inbox").unwrap();
        let mut inbox = jin_core::store::fs::read_list(&inbox_path).unwrap();
        inbox.frontmatter.workflow_kind = None;
        jin_core::store::fs::write_list(&cfg.lists_dir(), &inbox).unwrap();
        api::refresh(root.path()).unwrap();

        let board = create_list_fn(
            root.path(),
            CreateListInput {
                name: "Quadro".into(),
                color: "accent".into(),
                icon: "list".into(),
                parent_id: None,
                workflow_kind: Some("board".into()),
            },
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::new(
                root.path().to_path_buf(),
                crate::root_resolver::LaunchState::Ready {
                    root: root.path().to_string_lossy().into_owned(),
                },
            ))
            .invoke_handler(tauri::generate_handler![
                preview_workflow_setup,
                apply_workflow_setup,
                create_board_column,
                set_initial_board_column,
                rename_board_column,
                reorder_board_column,
                change_board_column_type,
                delete_board_column,
                create_section,
                rename_section,
                reorder_section,
                delete_section,
                delete_list,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let call = |cmd: &str, body: Value| {
            tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .map(|body| body.deserialize::<Value>().unwrap())
        };

        let preview = call(
            "preview_workflow_setup",
            json!({"id":"inbox","target":"checklist"}),
        )
        .unwrap();
        assert_eq!(preview["todo"], 10);
        assert_eq!(preview["done"], 3);
        assert_eq!(preview["subtasks"], 4);
        let applied = call(
            "apply_workflow_setup",
            json!({
                "id":"inbox", "target":"checklist", "snapshot":preview["snapshot"],
                "operation_id":"ipc-inbox-checklist-setup",
            }),
        )
        .unwrap();
        assert_eq!(applied["workflow_kind"], "checklist");
        assert_eq!(
            api::list_tasks(root.path(), None, None, None, false)
                .unwrap()
                .len(),
            13
        );

        let id = &board.id;
        let created = call(
            "create_board_column",
            json!({"id":id,"name":"Backlog","column_type":"none"}),
        )
        .unwrap();
        let column_id = created["columns"]
            .as_array()
            .unwrap()
            .iter()
            .find(|column| column["name"] == "Backlog")
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            created["columns"]
                .as_array()
                .unwrap()
                .iter()
                .find(|column| column["id"] == column_id)
                .unwrap()["type"],
            "none"
        );
        let initial = call(
            "set_initial_board_column",
            json!({"id":id,"column_id":column_id}),
        )
        .unwrap();
        assert_eq!(initial["initial_column_id"], column_id);
        let renamed = call(
            "rename_board_column",
            json!({"id":id,"column_id":column_id,"name":"Ideas"}),
        )
        .unwrap();
        assert!(renamed["columns"]
            .as_array()
            .unwrap()
            .iter()
            .any(|column| column["name"] == "Ideas"));
        call(
            "reorder_board_column",
            json!({"id":id,"column_id":column_id,"position":"A"}),
        )
        .unwrap();
        let retyped = call(
            "change_board_column_type",
            json!({"id":id,"column_id":column_id,"column_type":"queue"}),
        )
        .unwrap();
        assert!(retyped["columns"]
            .as_array()
            .unwrap()
            .iter()
            .any(|column| column["id"] == column_id && column["type"] == "queue"));
        let original_queue = board.initial_column_id.as_deref().unwrap();
        let deleted = call(
            "delete_board_column",
            json!({"id":id,"column_id":column_id,"replacement_id":original_queue}),
        )
        .unwrap();
        assert_eq!(deleted["initial_column_id"], original_queue);
        assert!(!deleted["columns"]
            .as_array()
            .unwrap()
            .iter()
            .any(|column| column["id"] == column_id));

        let section = call(
            "create_section",
            json!({"list_id":id,"input":{"name":"Group"}}),
        )
        .unwrap();
        let section_id = section["id"].as_str().unwrap();
        assert_eq!(
            call(
                "rename_section",
                json!({"list_id":id,"section_id":section_id,"input":{"name":"Review"}})
            )
            .unwrap()["name"],
            "Review"
        );
        assert_eq!(
            call(
                "reorder_section",
                json!({"list_id":id,"section_id":section_id,"input":{"position":"A"}})
            )
            .unwrap()["position"],
            "A"
        );
        call(
            "delete_section",
            json!({"list_id":id,"section_id":section_id}),
        )
        .unwrap();

        // Optional confirmed-delete payload must arrive as true; with the
        // former camelCase decoder it silently became false and refused the
        // move even though the GUI had obtained confirmation.
        let to_delete = create_list_fn(
            root.path(),
            CreateListInput {
                name: "Delete me".into(),
                color: "accent".into(),
                icon: "list".into(),
                parent_id: None,
                workflow_kind: Some("board".into()),
            },
        )
        .unwrap();
        let doing_id = to_delete
            .columns
            .iter()
            .find(|column| column.column_type == jin_core::model::list::BoardColumnType::InProgress)
            .unwrap()
            .id
            .clone();
        let doing_task = workflows::create_task(
            root.path(),
            tasks::CreateTaskParams {
                title: "In progress".into(),
                body: String::new(),
                priority: None,
                due: None,
                list: Some(to_delete.id.clone()),
                tags: None,
                reminders: None,
                parent: None,
            },
            Some(&doing_id),
        )
        .unwrap();
        call(
            "delete_list",
            json!({"id":to_delete.id,"confirm_doing":true}),
        )
        .unwrap();
        let moved = api::get_task(root.path(), doing_task.id()).unwrap();
        assert_eq!(moved.list, "inbox");
        assert_eq!(moved.status, "todo");
        assert!(moved.board_column_id.is_none());
    }
}
