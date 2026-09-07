//! link and attach operations — additive source-side edge writes.
//!
//! Invariant (ADR-0001 + VG6): only the **source** file is mutated;
//! the target file is never touched.

use chrono::Local;
use std::path::Path;

use crate::model::edge::{EdgeType, LinkEntry};
use crate::store::{frontmatter, fs};
use crate::{JinError, Result};

/// Write a typed edge into the source object's frontmatter.
/// `source_id` and `target_id` are ULIDs; `source_kind` / `target_kind` are "note"/"task"/"event".
/// Returns an error if the edge type is not valid for the given source/target kinds.
pub fn create_link(
    root: &Path,
    source_id: &str,
    source_kind: &str,
    target_id: &str,
    target_kind: &str,
    edge_type: EdgeType,
) -> Result<()> {
    // Validate vocabulary
    if !edge_type.validate_signature(source_kind, target_kind) {
        return Err(JinError::InvalidEdgeType {
            edge_type: edge_type.to_string(),
            reason: format!(
                "{} → {} is not a valid signature for edge type '{}'",
                source_kind, target_kind, edge_type
            ),
        });
    }

    // Verify target exists (it must be readable, not necessarily non-deleted —
    // a link to a tombstoned target is a "dangling edge" detected at rebuild time,
    // not a write-time error). We just check the file exists.
    let notes_dir = root.join("notes");
    let tasks_dir = root.join("tasks");
    let events_dir = root.join("events");

    let target_exists = match target_kind {
        "note" => fs::find_note_path(&notes_dir, target_id).is_ok(),
        "task" => fs::find_task_path(&tasks_dir, target_id).is_ok(),
        "event" => fs::find_event_path(&events_dir, target_id).is_ok(),
        _ => false,
    };
    if !target_exists {
        return Err(JinError::NotFound(format!("{}/{}", target_kind, target_id)));
    }

    let entry = LinkEntry {
        edge_type,
        target: target_id.to_string(),
    };

    // Write entry into source frontmatter
    let now = Local::now().fixed_offset();

    match source_kind {
        "note" => {
            let path = fs::find_note_path(&notes_dir, source_id)?;
            let mut note = fs::read_note(&path)?;
            // Deduplicate: don't add the same edge twice
            let already_exists = note
                .frontmatter
                .links
                .iter()
                .any(|l| l.edge_type == entry.edge_type && l.target == entry.target);
            if !already_exists {
                note.frontmatter.links.push(entry);
                note.frontmatter.updated = now;
                let content = frontmatter::render(&note.frontmatter, &note.body)?;
                std::fs::write(&path, content)?;
            }
        }
        "event" => {
            // For event→task derived-from, stored in derived_from field
            let path = fs::find_event_path(&events_dir, source_id)?;
            let mut event = fs::read_event(&path)?;
            event.frontmatter.derived_from = Some(target_id.to_string());
            event.frontmatter.updated = now;
            let content = frontmatter::render(&event.frontmatter, &event.body)?;
            std::fs::write(&path, content)?;
        }
        _ => {
            return Err(JinError::InvalidEdgeType {
                edge_type: entry.edge_type.to_string(),
                reason: format!("source kind '{}' cannot hold edges", source_kind),
            });
        }
    }

    Ok(())
}
