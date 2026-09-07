//! Portable, declarative Notes Collections.
//!
//! Collections live in `<vault>/collections/*.json`. They are canonical vault
//! content, unlike pins and recents which intentionally remain device-local.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use crate::id::new_ulid;
use crate::model::{
    parse_canonical_links, CollectionDocument, CollectionQuery, Note, QueryFilter, SortDirection,
    SortField, COLLECTION_SCHEMA_VERSION, QUERY_SCHEMA_VERSION,
};
use crate::store::fs;
use crate::{JinError, Result};

fn collections_dir(root: &Path) -> PathBuf {
    root.join("collections")
}

fn path_for(root: &Path, id: &str) -> Result<PathBuf> {
    if ulid::Ulid::from_string(id).is_err() {
        return Err(JinError::InvalidInput(format!(
            "collection id is not a ULID: {id}"
        )));
    }
    Ok(collections_dir(root).join(format!("{id}.json")))
}

fn validate_document(document: &CollectionDocument) -> Result<()> {
    if document.schema_version > COLLECTION_SCHEMA_VERSION {
        return Err(JinError::Integrity(format!(
            "collection {} uses unsupported schema version {}",
            document.id, document.schema_version
        )));
    }
    if document.query.version > QUERY_SCHEMA_VERSION {
        return Err(JinError::Integrity(format!(
            "collection {} uses unsupported query version {}",
            document.id, document.query.version
        )));
    }
    if document.name.trim().is_empty() {
        return Err(JinError::InvalidInput(
            "collection name must not be empty".to_string(),
        ));
    }
    let _ = path_for(Path::new("."), &document.id)?;
    Ok(())
}

/// Create a portable collection with the current format versions.
pub fn create_collection(
    root: &Path,
    name: String,
    query: CollectionQuery,
) -> Result<CollectionDocument> {
    let document = CollectionDocument {
        schema_version: COLLECTION_SCHEMA_VERSION,
        id: new_ulid(),
        name,
        query,
        view: serde_json::json!({ "version": 1, "layout": "list" }),
        extra: Default::default(),
    };
    save_collection(root, &document)?;
    Ok(document)
}

/// Save an entire collection document. Since the document owns its flattened
/// `extra` fields, known future fields survive an older Jin rewrite.
pub fn save_collection(root: &Path, document: &CollectionDocument) -> Result<()> {
    validate_document(document)?;
    let path = path_for(root, &document.id)?;
    let json = serde_json::to_vec_pretty(document)
        .map_err(|err| JinError::Integrity(format!("serialize collection: {err}")))?;
    fs::atomic_write(&path, &json)
}

pub fn get_collection(root: &Path, id: &str) -> Result<CollectionDocument> {
    let path = path_for(root, id)?;
    let json = std::fs::read(&path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            JinError::NotFound(format!("collection/{id}"))
        } else {
            JinError::Io(err)
        }
    })?;
    let document: CollectionDocument = serde_json::from_slice(&json)
        .map_err(|err| JinError::Integrity(format!("parse collection {id}: {err}")))?;
    validate_document(&document)?;
    Ok(document)
}

/// Rename a collection while retaining all known and unknown document fields.
pub fn rename_collection(root: &Path, id: &str, name: String) -> Result<CollectionDocument> {
    let mut document = get_collection(root, id)?;
    document.name = name;
    save_collection(root, &document)?;
    Ok(document)
}

/// Replace only the declarative query of an existing collection.
///
/// The original document is loaded and then re-saved so flattened future fields
/// and presentation metadata survive UI edits.
pub fn update_collection_query(
    root: &Path,
    id: &str,
    query: CollectionQuery,
) -> Result<CollectionDocument> {
    let mut document = get_collection(root, id)?;
    document.query = query;
    save_collection(root, &document)?;
    Ok(document)
}

/// Delete a collection document. Notes are canonical content and are untouched.
pub fn delete_collection(root: &Path, id: &str) -> Result<()> {
    let path = path_for(root, id)?;
    std::fs::remove_file(&path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            JinError::NotFound(format!("collection/{id}"))
        } else {
            JinError::Io(err)
        }
    })
}

pub fn list_collections(root: &Path) -> Result<Vec<CollectionDocument>> {
    let dir = collections_dir(root);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut documents = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let json = std::fs::read(&path)?;
        let document: CollectionDocument = serde_json::from_slice(&json).map_err(|err| {
            JinError::Integrity(format!("parse collection {}: {err}", path.display()))
        })?;
        validate_document(&document)?;
        documents.push(document);
    }
    documents.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    Ok(documents)
}

/// Evaluate a collection from canonical Notes. This is deliberately in-memory
/// declarative evaluation—not SQL—and therefore behaves identically after an
/// index rebuild or on an exported vault.
pub fn evaluate_collection(root: &Path, id: &str) -> Result<Vec<Note>> {
    let document = get_collection(root, id)?;
    let mut notes = crate::ops::notes::list_notes(&root.join("notes"), false)?;
    notes.retain(|note| matches_filter(note, &document.query.filter));
    sort_notes(&mut notes, &document.query);
    if let Some(limit) = document.query.limit {
        notes.truncate(limit);
    }
    Ok(notes)
}

fn matches_filter(note: &Note, filter: &QueryFilter) -> bool {
    match filter {
        QueryFilter::All { clauses } => clauses.iter().all(|clause| matches_filter(note, clause)),
        QueryFilter::Any { clauses } => clauses.iter().any(|clause| matches_filter(note, clause)),
        QueryFilter::Not { clause } => !matches_filter(note, clause),
        QueryFilter::Status { value } => note.frontmatter.status.to_string() == *value,
        QueryFilter::Tag { value } => note.frontmatter.tags.iter().any(|tag| tag == value),
        QueryFilter::PropertyEquals { key, value } => {
            note.frontmatter.properties.get(key) == Some(value)
        }
        QueryFilter::HasLink { target_id } => {
            parse_canonical_links(&note.body)
                .iter()
                .any(|link| &link.target_id == target_id)
                || note
                    .frontmatter
                    .links
                    .iter()
                    .any(|link| &link.target == target_id)
        }
        QueryFilter::BodyContains { value } => note.body.contains(value),
    }
}

fn sort_notes(notes: &mut [Note], query: &CollectionQuery) {
    notes.sort_by(|a, b| {
        for sort in &query.sort {
            let result = match sort.field {
                SortField::Created => a.frontmatter.created.cmp(&b.frontmatter.created),
                SortField::Updated => a.frontmatter.updated.cmp(&b.frontmatter.updated),
                SortField::Title => a.frontmatter.title.cmp(&b.frontmatter.title),
                SortField::Id => a.frontmatter.id.cmp(&b.frontmatter.id),
            };
            let result = match sort.direction {
                SortDirection::Asc => result,
                SortDirection::Desc => result.reverse(),
            };
            if result != Ordering::Equal {
                return result;
            }
        }
        a.id().cmp(b.id())
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use crate::ops::notes::{create_note, CreateNoteParams};
    use tempfile::TempDir;

    #[test]
    fn portable_collection_preserves_unknown_fields_and_uses_declarative_filters() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let note = create_note(
            &vault.path().join("notes"),
            CreateNoteParams {
                title: "Roadmap".to_string(),
                body: "secure body".to_string(),
                tags: vec!["work".to_string()],
                folder: String::new(),
            },
        )
        .unwrap();
        let collection = create_collection(
            vault.path(),
            "Work".to_string(),
            CollectionQuery {
                version: QUERY_SCHEMA_VERSION,
                filter: QueryFilter::Tag {
                    value: "work".to_string(),
                },
                ..Default::default()
            },
        )
        .unwrap();
        let path = path_for(vault.path(), &collection.id).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["future_field"] = serde_json::json!({"kept": true});
        fs::atomic_write(&path, serde_json::to_vec(&value).unwrap().as_slice()).unwrap();
        let loaded = get_collection(vault.path(), &collection.id).unwrap();
        save_collection(vault.path(), &loaded).unwrap();
        assert_eq!(
            evaluate_collection(vault.path(), &collection.id).unwrap()[0].id(),
            note.id()
        );
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("future_field"));
    }

    #[test]
    fn collection_mutations_preserve_unknown_fields_and_never_delete_notes() {
        let vault = TempDir::new().unwrap();
        ops::init(vault.path()).unwrap();
        let note = create_note(
            &vault.path().join("notes"),
            CreateNoteParams {
                title: "Keep me".to_string(),
                body: "body".to_string(),
                tags: vec![],
                folder: String::new(),
            },
        )
        .unwrap();
        let collection = create_collection(
            vault.path(),
            "Before".to_string(),
            CollectionQuery::default(),
        )
        .unwrap();
        let path = path_for(vault.path(), &collection.id).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["future_field"] = serde_json::json!({"kept": true});
        fs::atomic_write(&path, serde_json::to_vec(&value).unwrap().as_slice()).unwrap();

        rename_collection(vault.path(), &collection.id, "After".to_string()).unwrap();
        update_collection_query(
            vault.path(),
            &collection.id,
            CollectionQuery {
                filter: QueryFilter::BodyContains {
                    value: "body".to_string(),
                },
                ..Default::default()
            },
        )
        .unwrap();
        let updated = get_collection(vault.path(), &collection.id).unwrap();
        assert_eq!(updated.name, "After");
        assert_eq!(
            updated.extra["future_field"]["kept"],
            serde_json::json!(true)
        );

        delete_collection(vault.path(), &collection.id).unwrap();
        assert!(get_collection(vault.path(), &collection.id).is_err());
        assert!(crate::store::fs::find_note_path(&vault.path().join("notes"), note.id()).is_ok());
    }
}
