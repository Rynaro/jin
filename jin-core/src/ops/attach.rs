//! Attach a Note to a target object with an optional edge-type hint (VG6).
//!
//! Default edge selection:
//!   note → event  : prep-for
//!   note → task   : references
//!   note → note   : references

use std::path::Path;

use crate::model::EdgeType;
use crate::ops::{api, link};
use crate::{JinError, Result};

/// Attach `note_id` to `target_id`.
/// `edge_type` is optional; if omitted the default is chosen by target kind.
/// Returns the edge type used.
pub fn attach_note(
    root: &Path,
    note_id: &str,
    target_id: &str,
    edge_type: Option<EdgeType>,
) -> Result<EdgeType> {
    // Verify source is a note
    let notes_dir = root.join("notes");
    crate::store::fs::find_note_path(&notes_dir, note_id)
        .map_err(|_| JinError::NotFound(format!("note/{}", note_id)))?;

    // Resolve target kind
    let target_kind = api::infer_kind(root, target_id)?;

    // Choose edge type
    let et = if let Some(e) = edge_type {
        e
    } else {
        match target_kind.as_str() {
            "event" => EdgeType::PrepFor,
            _ => EdgeType::References,
        }
    };

    // Validate signature
    if !et.validate_signature("note", &target_kind) {
        return Err(JinError::InvalidEdgeType {
            edge_type: et.to_string(),
            reason: format!("cannot attach note to {} via {} edge", target_kind, et),
        });
    }

    link::create_link(root, note_id, "note", target_id, &target_kind, et.clone())?;
    Ok(et)
}
