//! link command — create a typed edge between any two objects.

use std::path::Path;

use jin_core::model::EdgeType;
use jin_core::ops::{api, link};

use crate::commands::attach::LinkResultDto;
use crate::error::JinErrorDto;
use crate::state::AppState;

pub fn link_fn(
    root: &Path,
    source_id: String,
    target_id: String,
    edge_type: String,
) -> Result<LinkResultDto, JinErrorDto> {
    let et = EdgeType::parse(&edge_type).ok_or_else(|| JinErrorDto {
        code: 2,
        kind: "usage".to_string(),
        message: format!(
            "unknown edge type '{}'; allowed: derived-from, prep-for, references",
            edge_type
        ),
        retriable: false,
        details: None,
    })?;

    let source_kind =
        jin_core::ops::api::infer_kind(root, &source_id).map_err(JinErrorDto::from)?;
    let target_kind =
        jin_core::ops::api::infer_kind(root, &target_id).map_err(JinErrorDto::from)?;

    link::create_link(root, &source_id, &source_kind, &target_id, &target_kind, et)
        .map_err(JinErrorDto::from)?;

    api::refresh(root).map_err(JinErrorDto::from)?;

    Ok(LinkResultDto {
        edge_type,
        source_id,
        target_id,
    })
}

#[tauri::command]
pub async fn link(
    state: tauri::State<'_, AppState>,
    source_id: String,
    target_id: String,
    edge_type: String,
) -> Result<LinkResultDto, JinErrorDto> {
    link_fn(&state.root, source_id, target_id, edge_type)
}
