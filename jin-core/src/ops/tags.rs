//! Tag operations — auto-create, list, recolor (§1.3 / EPIC P4).
//!
//! Source of truth:
//!   - Tag membership:  `TaskFrontmatter.tags` (vec of slugs)
//!   - Tag metadata:    `<root>/tags/<slug>.md`
//!
//! The index `tags` + `task_tags` tables are derived and rebuilt on demand.

use chrono::Local;
use std::path::Path;

use crate::dto::tag::TagDto;
use crate::index::{self, query};
use crate::model::tag::{Tag, TagFrontmatter};
use crate::store::fs;
use crate::{Config, JinError, Result};

use super::lists::{normalize_color, JIN_PALETTE};

// ── Slug helpers ──────────────────────────────────────────────────────────────

/// Slugify a user-supplied tag input: lowercase, alphanumeric + hyphens only,
/// strip leading/trailing hyphens, collapse runs of hyphens.
pub fn slugify_tag(input: &str) -> String {
    let s: String = input
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                out.push(c);
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untagged".to_string()
    } else {
        out
    }
}

/// Deterministic default color for a tag: stable hash of slug → Jin palette index.
pub fn default_tag_color(slug: &str) -> &'static str {
    let hash: usize = slug
        .bytes()
        .fold(0usize, |acc, b| acc.wrapping_add(b as usize));
    let idx = hash % JIN_PALETTE.len();
    JIN_PALETTE[idx]
}

// ── Public ops ────────────────────────────────────────────────────────────────

/// Idempotently ensure `tags/<slug>.md` exists. Creates it with a deterministic
/// default color if absent. Returns the `Tag`.
pub fn ensure_tag(root: &Path, slug: &str) -> Result<Tag> {
    let cfg = Config::load(root)?;
    let tags_dir = cfg.tags_dir();
    let path = tags_dir.join(fs::tag_filename(slug));

    if path.exists() {
        return fs::read_tag(&path);
    }

    let now = Local::now().fixed_offset();
    let color = default_tag_color(slug);
    let fm = TagFrontmatter {
        slug: slug.to_string(),
        kind: "tag".to_string(),
        name: slug.to_string(), // name = slug by default; user can rename via set_tag_color
        color: color.to_string(),
        created: now,
    };
    let tag = Tag {
        frontmatter: fm,
        body: String::new(),
    };
    fs::write_tag(&tags_dir, &tag)?;
    Ok(tag)
}

/// List all tags from the index with their task_count.
pub fn list_tags(root: &Path) -> Result<Vec<TagDto>> {
    let cfg = Config::load(root)?;
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_tags(&conn).map_err(JinError::Index)?;

    let mut dtos = Vec::with_capacity(rows.len());
    for row in &rows {
        let task_count = query::count_non_deleted_tasks_for_tag(&conn, &row.slug)
            .map_err(JinError::Index)? as u32;
        dtos.push(TagDto {
            slug: row.slug.clone(),
            name: row.name.clone(),
            color: row.color.clone(),
            task_count,
        });
    }
    Ok(dtos)
}

/// Update the color of a tag. Writes the file and refreshes the index.
pub fn set_tag_color(root: &Path, slug: &str, color: String) -> Result<TagDto> {
    let cfg = Config::load(root)?;
    let tags_dir = cfg.tags_dir();
    let path = tags_dir.join(fs::tag_filename(slug));

    if !path.exists() {
        return Err(JinError::NotFound(format!("tag/{}", slug)));
    }

    let color = normalize_color(&color)?;
    let mut tag = fs::read_tag(&path)?;
    tag.frontmatter.color = color.clone();
    fs::write_tag(&tags_dir, &tag)?;
    crate::ops::api::refresh(root)?;

    // Recount from index.
    let cfg2 = Config::load(root)?;
    let conn = index::open(&cfg2.index_path())?;
    let task_count =
        query::count_non_deleted_tasks_for_tag(&conn, slug).map_err(JinError::Index)? as u32;

    Ok(TagDto {
        slug: slug.to_string(),
        name: tag.frontmatter.name.clone(),
        color,
        task_count,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops;
    use crate::ops::tasks::{create_task, edit_task, CreateTaskParams, EditTaskParams};
    use crate::store::fs as store_fs;
    use tempfile::TempDir;

    fn init_store() -> TempDir {
        let tmp = TempDir::new().unwrap();
        ops::init(tmp.path()).unwrap();
        tmp
    }

    /// VG-P4: slugify_tag works correctly.
    #[test]
    fn vg_p4_slugify_tag_basic() {
        assert_eq!(slugify_tag("Email"), "email");
        assert_eq!(slugify_tag("work email"), "work-email");
        assert_eq!(slugify_tag("  hello  "), "hello");
        assert_eq!(slugify_tag("#email"), "email");
        assert_eq!(slugify_tag("!!!"), "untagged");
    }

    /// VG-P4: default_tag_color is deterministic and in palette.
    #[test]
    fn vg_p4_default_tag_color_deterministic() {
        let c1 = default_tag_color("email");
        let c2 = default_tag_color("email");
        assert_eq!(c1, c2, "same slug must produce same color");
        assert!(JIN_PALETTE.contains(&c1), "color must be in palette");
    }

    /// VG-P4: ensure_tag creates the tag file on first call; idempotent on second.
    #[test]
    fn vg_p4_ensure_tag_creates_and_is_idempotent() {
        let tmp = init_store();
        let root = tmp.path();

        ensure_tag(root, "email").unwrap();

        let cfg = Config::load(root).unwrap();
        let tag_path = cfg.tags_dir().join("email.md");
        assert!(tag_path.exists(), "email.md must exist");

        let tag = store_fs::read_tag(&tag_path).unwrap();
        assert_eq!(tag.frontmatter.slug, "email");

        // Second call must be idempotent.
        let before = std::fs::read(&tag_path).unwrap();
        ensure_tag(root, "email").unwrap();
        let after = std::fs::read(&tag_path).unwrap();
        assert_eq!(before, after, "second ensure_tag must not change the file");
    }

    /// VG-P4: add-tag asserts the slug in task frontmatter AND a tags/<slug>.md exists
    /// AND a task_tags join row is present after rebuild.
    #[test]
    fn vg_p4_add_tag_persists_slug_in_frontmatter_and_creates_tag_file_and_join_row() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();

        // Create a task.
        let task = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Tagged task".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: None,
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        // Ensure tag and attach via edit_task.
        ensure_tag(root, "email").unwrap();
        edit_task(
            &cfg.tasks_dir(),
            task.frontmatter.id.as_str(),
            EditTaskParams {
                title: None,
                priority: None,
                due: None,
                list: None,
                body: None,
                tags: Some(vec!["email".to_string()]),
                section_id: None,
                clear_section: false,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        // Assert slug in task frontmatter.
        let task_path = cfg.tasks_dir().join(format!("{}.md", task.frontmatter.id));
        let updated = store_fs::read_task(&task_path).unwrap();
        assert!(
            updated.frontmatter.tags.contains(&"email".to_string()),
            "task frontmatter must contain 'email' slug"
        );

        // Assert tags/email.md exists.
        assert!(
            cfg.tags_dir().join("email.md").exists(),
            "tags/email.md must exist"
        );

        // Rebuild and assert task_tags join row.
        crate::ops::api::refresh(root).unwrap();
        let cfg2 = Config::load(root).unwrap();
        let conn = crate::index::open(&cfg2.index_path()).unwrap();
        let count = crate::index::query::count_task_tags(&conn, "email").unwrap();
        assert_eq!(
            count, 1,
            "task_tags must have 1 row for 'email' after rebuild"
        );
    }

    /// VG-P4: tag filter returns ONLY tasks carrying the tag.
    #[test]
    fn vg_p4_tag_filter_returns_only_tagged_tasks() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();

        // Create two tasks; tag only the first one.
        let task1 = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Tagged".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: None,
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        let _task2 = create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Untagged".to_string(),
                body: String::new(),
                priority: None,
                due: None,
                list: None,
                tags: None,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();

        ensure_tag(root, "email").unwrap();
        edit_task(
            &cfg.tasks_dir(),
            task1.frontmatter.id.as_str(),
            EditTaskParams {
                title: None,
                priority: None,
                due: None,
                list: None,
                body: None,
                tags: Some(vec!["email".to_string()]),
                section_id: None,
                clear_section: false,
                reminders: None,
                parent: None,
            },
        )
        .unwrap();
        crate::ops::api::refresh(root).unwrap();

        let result =
            crate::ops::api::list_tasks_with_tag(root, None, None, None, Some("email"), false)
                .unwrap();
        assert_eq!(result.len(), 1, "tag filter must return only 1 task");
        assert_eq!(result[0].id, task1.frontmatter.id);
    }

    /// VG-P4: set_tag_color persists and reload reflects it.
    #[test]
    fn vg_p4_set_tag_color_persists_and_reflects() {
        let tmp = init_store();
        let root = tmp.path();
        let cfg = Config::load(root).unwrap();

        ensure_tag(root, "urgent").unwrap();
        crate::ops::api::refresh(root).unwrap();

        let dto = set_tag_color(root, "urgent", "danger".to_string()).unwrap();
        assert_eq!(dto.color, "danger");

        // Reload from disk.
        let tag_path = cfg.tags_dir().join("urgent.md");
        let on_disk = store_fs::read_tag(&tag_path).unwrap();
        assert_eq!(on_disk.frontmatter.color, "danger");
    }

    #[test]
    fn set_tag_color_normalizes_custom_hex_and_rejects_invalid_writes() {
        let tmp = init_store();
        let root = tmp.path();
        ensure_tag(root, "chroma").unwrap();
        crate::ops::api::refresh(root).unwrap();
        assert_eq!(
            set_tag_color(root, "chroma", "#a3f".to_string())
                .unwrap()
                .color,
            "#AA33FF"
        );
        assert!(set_tag_color(root, "chroma", "not-a-color".to_string()).is_err());
        let cfg = Config::load(root).unwrap();
        assert_eq!(
            store_fs::read_tag(&cfg.tags_dir().join("chroma.md"))
                .unwrap()
                .frontmatter
                .color,
            "#AA33FF"
        );
    }
}
