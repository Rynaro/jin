//! Data model for a first-class Tag (§1.3).
//!
//! On-disk: `<root>/tags/<slug>.md` with `type: tag` YAML frontmatter.
//! Tag membership is stored in `TaskFrontmatter.tags`; the tag file stores metadata (color).

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

/// YAML frontmatter for a Tag file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagFrontmatter {
    pub slug: String,
    #[serde(rename = "type")]
    pub kind: String, // always "tag"
    pub name: String,
    /// Jin swatch token name, e.g. "accent" | "sky".
    pub color: String,
    pub created: DateTime<FixedOffset>,
}

/// A parsed Tag (frontmatter + optional body).
#[derive(Debug, Clone)]
pub struct Tag {
    pub frontmatter: TagFrontmatter,
    pub body: String,
}

impl Tag {
    pub fn slug(&self) -> &str {
        &self.frontmatter.slug
    }
}
