use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::index::query::{BacklinkRow, NoteRow};
use crate::model::note::{find_unlinked_mentions, parse_canonical_links, Note, PropertyValue};

/// DTO projection of a Note — never a raw DB row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created: String,
    pub updated: String,
    pub deleted_at: Option<String>,
    pub tags: Vec<String>,
    pub links: Vec<LinkDto>,
    pub backlinks: Vec<BacklinkDto>,
    /// Full markdown body of the note.
    /// `Some` on `get_note` (read fresh from disk, D3).
    /// `None` on `list_notes` (body never stored in the index, D1).
    pub body_markdown: Option<String>,
    /// Short plain-text excerpt (≤200 chars, whitespace-collapsed).
    /// `Some` on `list_notes` (populated at rebuild time, D1/D2).
    /// `None` on `from_model` (create/edit path — no index row).
    pub excerpt: Option<String>,
    /// Wave 2A: relative folder path (/ separated); "" = root "Notes" folder.
    /// `Some` on `from_row` (populated from index).
    /// `None` on `from_model` (create/edit path; caller may set via `with_folder`).
    pub folder_path: Option<String>,
    /// Strict portable frontmatter properties. Present on detail/create/edit
    /// responses; list rows omit the canonical payload.
    pub properties: Option<BTreeMap<String, PropertyValue>>,
    /// Monotonic canonical revision used for optimistic edits/restores.
    pub revision: Option<u64>,
    /// Canonical body-level links (`[[ULID|label]]`), never path-derived.
    pub canonical_links: Vec<CanonicalLinkDto>,
    /// Non-mutating suggestions for whole-title mentions not yet linked.
    pub unlinked_mentions: Vec<UnlinkedMentionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkDto {
    pub edge_type: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklinkDto {
    pub source_id: String,
    pub source_kind: String,
    pub edge_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalLinkDto {
    pub target_id: String,
    pub label: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnlinkedMentionDto {
    pub target_id: String,
    pub label: String,
    pub start: usize,
    pub end: usize,
}

impl NoteDto {
    /// Project from a Note model (no backlinks, no index row).
    /// Used by create/edit/delete command responses.
    /// `folder_path` is `None` here — callers may set it via `with_folder`.
    pub fn from_model(note: &Note) -> Self {
        let tags: Vec<String> = note.frontmatter.tags.clone();
        let links = note
            .frontmatter
            .links
            .iter()
            .map(|l| LinkDto {
                edge_type: l.edge_type.to_string(),
                target: l.target.clone(),
            })
            .collect();
        Self {
            id: note.frontmatter.id.clone(),
            title: note.frontmatter.title.clone(),
            status: note.frontmatter.status.to_string(),
            created: note.frontmatter.created.to_rfc3339(),
            updated: note.frontmatter.updated.to_rfc3339(),
            deleted_at: note.frontmatter.deleted_at.map(|d| d.to_rfc3339()),
            tags,
            links,
            backlinks: vec![],
            body_markdown: Some(note.body.clone()),
            excerpt: None,
            folder_path: None,
            properties: Some(note.frontmatter.properties.clone()),
            revision: Some(note.frontmatter.revision),
            canonical_links: parse_canonical_links(&note.body)
                .into_iter()
                .map(|link| CanonicalLinkDto {
                    target_id: link.target_id,
                    label: link.label,
                    start: link.start,
                    end: link.end,
                })
                .collect(),
            unlinked_mentions: vec![],
        }
    }

    /// Project from an index NoteRow (no backlinks). Internal — use ops::api.
    pub(crate) fn from_row(row: &NoteRow) -> Self {
        let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
        Self {
            id: row.id.clone(),
            title: row.title.clone(),
            status: row.status.clone(),
            created: row.created.clone(),
            updated: row.updated.clone(),
            deleted_at: row.deleted_at.clone(),
            tags,
            links: vec![],
            backlinks: vec![],
            body_markdown: None,
            excerpt: Some(row.excerpt.clone()),
            folder_path: Some(row.folder_path.clone()),
            properties: None,
            revision: None,
            canonical_links: vec![],
            unlinked_mentions: vec![],
        }
    }

    /// Attach the full body read from disk (used by api::get_note, D3).
    pub(crate) fn with_body(mut self, body: String) -> Self {
        self.body_markdown = Some(body);
        self
    }

    /// Attach a folder path (used by create/move command responses, D-UI-NEWNOTE).
    pub fn with_folder(mut self, folder: String) -> Self {
        self.folder_path = Some(folder);
        self
    }

    pub(crate) fn with_backlinks(mut self, bls: &[BacklinkRow]) -> Self {
        self.backlinks = bls
            .iter()
            .map(|b| BacklinkDto {
                source_id: b.source_id.clone(),
                source_kind: b.source_kind.clone(),
                edge_type: b.edge_type.clone(),
                label: b.backlink_label.clone(),
            })
            .collect();
        self
    }

    /// Attach canonical properties, links, revision, and deterministic mention
    /// suggestions from the disk-read note used by `api::get_note`.
    pub(crate) fn with_note_details(
        mut self,
        note: &Note,
        candidates: impl IntoIterator<Item = (String, String)>,
    ) -> Self {
        self.properties = Some(note.frontmatter.properties.clone());
        self.revision = Some(note.frontmatter.revision);
        self.canonical_links = parse_canonical_links(&note.body)
            .into_iter()
            .map(|link| CanonicalLinkDto {
                target_id: link.target_id,
                label: link.label,
                start: link.start,
                end: link.end,
            })
            .collect();
        self.unlinked_mentions = find_unlinked_mentions(&note.body, note.id(), candidates)
            .into_iter()
            .map(|mention| UnlinkedMentionDto {
                target_id: mention.target_id,
                label: mention.label,
                start: mention.start,
                end: mention.end,
            })
            .collect();
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::query::NoteRow;

    fn make_row(excerpt: &str) -> NoteRow {
        NoteRow {
            id: "n1".to_string(),
            title: "Test".to_string(),
            status: "active".to_string(),
            created: "2026-01-01T00:00:00Z".to_string(),
            updated: "2026-01-01T00:00:00Z".to_string(),
            deleted_at: None,
            tags: "[]".to_string(),
            file_path: "/tmp/test.md".to_string(),
            excerpt: excerpt.to_string(),
            folder_path: String::new(),
        }
    }

    /// VG1.2 — from_model sets body_markdown = Some(body).
    #[test]
    fn from_model_sets_body_markdown() {
        use crate::model::note::{Note, NoteFrontmatter, NoteStatus};
        use chrono::DateTime;

        let fm = NoteFrontmatter {
            id: "n1".to_string(),
            kind: "note".to_string(),
            title: "Title".to_string(),
            created: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            updated: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            status: NoteStatus::Active,
            deleted_at: None,
            tags: vec![],
            links: vec![],
            properties: Default::default(),
            revision: 1,
            extra: Default::default(),
        };
        let note = Note {
            frontmatter: fm,
            body: "line1\nline2".to_string(),
        };
        let dto = NoteDto::from_model(&note);
        assert_eq!(dto.body_markdown, Some("line1\nline2".to_string()));
        assert_eq!(dto.excerpt, None);
    }

    /// VG1.2 (AC1.3) — from_row sets body_markdown = None.
    #[test]
    fn from_row_body_markdown_is_none() {
        let dto = NoteDto::from_row(&make_row("short excerpt"));
        assert_eq!(dto.body_markdown, None);
    }

    /// S2 — from_row sets excerpt = Some(row.excerpt).
    #[test]
    fn from_row_excerpt_is_some() {
        let dto = NoteDto::from_row(&make_row("hello world"));
        assert_eq!(dto.excerpt, Some("hello world".to_string()));
    }

    /// with_body attaches the body to an existing DTO.
    #[test]
    fn with_body_sets_body_markdown() {
        let dto = NoteDto::from_row(&make_row("")).with_body("my body".to_string());
        assert_eq!(dto.body_markdown, Some("my body".to_string()));
    }

    // ── VG-DTO: folder_path projection tests ──────────────────────────────────

    /// VG-DTO: from_row → folder_path is Some(row.folder_path).
    #[test]
    fn vg_dto_from_row_folder_path_is_some() {
        let mut row = make_row("x");
        row.folder_path = "Work".to_string();
        let dto = NoteDto::from_row(&row);
        assert_eq!(dto.folder_path, Some("Work".to_string()));
    }

    /// VG-DTO: from_row with root folder → folder_path is Some("").
    #[test]
    fn vg_dto_from_row_root_folder_path_is_some_empty() {
        let row = make_row("x");
        let dto = NoteDto::from_row(&row);
        assert_eq!(dto.folder_path, Some("".to_string()));
    }

    /// VG-DTO: from_model → folder_path is None.
    #[test]
    fn vg_dto_from_model_folder_path_is_none() {
        use crate::model::note::{Note, NoteFrontmatter, NoteStatus};
        use chrono::DateTime;

        let fm = NoteFrontmatter {
            id: "n1".to_string(),
            kind: "note".to_string(),
            title: "Title".to_string(),
            created: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            updated: DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap(),
            status: NoteStatus::Active,
            deleted_at: None,
            tags: vec![],
            links: vec![],
            properties: Default::default(),
            revision: 1,
            extra: Default::default(),
        };
        let note = Note {
            frontmatter: fm,
            body: String::new(),
        };
        let dto = NoteDto::from_model(&note);
        assert_eq!(dto.folder_path, None);
    }

    /// VG-DTO: with_folder → folder_path is Some(folder).
    #[test]
    fn vg_dto_with_folder_sets_folder_path() {
        let row = make_row("x");
        let dto = NoteDto::from_row(&row).with_folder("Archive".to_string());
        assert_eq!(dto.folder_path, Some("Archive".to_string()));
    }
}
