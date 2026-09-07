//! attach_note command.

use std::path::Path;

use serde::Serialize;

use jin_core::model::EdgeType;
use jin_core::ops::{api, attach};

use crate::error::JinErrorDto;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct LinkResultDto {
    pub edge_type: String,
    pub source_id: String,
    pub target_id: String,
}

pub fn attach_note_fn(
    root: &Path,
    note_id: String,
    target_id: String,
    kind: Option<String>,
) -> Result<LinkResultDto, JinErrorDto> {
    let edge_type = kind
        .as_deref()
        .map(|k| {
            EdgeType::parse(k).ok_or_else(|| JinErrorDto {
                code: 2,
                kind: "usage".to_string(),
                message: format!(
                    "unknown edge kind '{}'; expected: derived-from, prep-for, references",
                    k
                ),
                retriable: false,
                details: None,
            })
        })
        .transpose()?;

    let et =
        attach::attach_note(root, &note_id, &target_id, edge_type).map_err(JinErrorDto::from)?;

    api::refresh(root).map_err(JinErrorDto::from)?;

    Ok(LinkResultDto {
        edge_type: et.to_string(),
        source_id: note_id,
        target_id,
    })
}

#[tauri::command]
pub async fn attach_note(
    state: tauri::State<'_, AppState>,
    note_id: String,
    target_id: String,
    kind: Option<String>,
) -> Result<LinkResultDto, JinErrorDto> {
    attach_note_fn(&state.root, note_id, target_id, kind)
}
