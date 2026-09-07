use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, NaiveDate};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::edge::LinkEntry;
use crate::{JinError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteStatus {
    #[default]
    Active,
    Deleted,
}

impl std::fmt::Display for NoteStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NoteStatus::Active => write!(f, "active"),
            NoteStatus::Deleted => write!(f, "deleted"),
        }
    }
}

/// A portable, intentionally small value vocabulary for note properties.
///
/// Values are represented directly in YAML rather than with a language-specific
/// tagged union. A `YYYY-MM-DD` scalar is the canonical date form. This keeps
/// frontmatter useful in ordinary Markdown tools while refusing maps, nulls,
/// arbitrary nested values, and executable expressions.
#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    String(String),
    Number(f64),
    Bool(bool),
    Date(String),
    StringList(Vec<String>),
}

impl PropertyValue {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::String(_) => "string",
            Self::Number(_) => "number",
            Self::Bool(_) => "bool",
            Self::Date(_) => "date",
            Self::StringList(_) => "string-list",
        }
    }

    fn is_date(value: &str) -> bool {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
    }
}

impl Serialize for PropertyValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::String(value) | Self::Date(value) => serializer.serialize_str(value),
            Self::Number(value) => serializer.serialize_f64(*value),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::StringList(values) => values.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for PropertyValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let value = serde_yaml_ng::Value::deserialize(deserializer)?;
        match value {
            serde_yaml_ng::Value::String(value) => {
                if Self::is_date(&value) {
                    Ok(Self::Date(value))
                } else {
                    Ok(Self::String(value))
                }
            }
            serde_yaml_ng::Value::Number(value) => value
                .as_f64()
                .filter(|value| value.is_finite())
                .map(Self::Number)
                .ok_or_else(|| serde::de::Error::custom("property number must be finite")),
            serde_yaml_ng::Value::Bool(value) => Ok(Self::Bool(value)),
            serde_yaml_ng::Value::Sequence(values) => values
                .into_iter()
                .map(|value| match value {
                    serde_yaml_ng::Value::String(value) => Ok(value),
                    _ => Err(serde::de::Error::custom(
                        "property lists may contain strings only",
                    )),
                })
                .collect::<std::result::Result<Vec<_>, _>>()
                .map(Self::StringList),
            _ => Err(serde::de::Error::custom(
                "property values must be string, number, bool, date, or string-list",
            )),
        }
    }
}

/// Validate a portable property key before it reaches canonical frontmatter.
///
/// `jin.*` is reserved for Jin's own metadata and ordinary property names stay
/// deliberately conservative so collections remain portable across runtimes.
pub fn validate_property_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 128 {
        return Err(JinError::InvalidInput(
            "property key must be 1–128 characters".to_string(),
        ));
    }
    if key.starts_with("jin.") {
        return Err(JinError::InvalidInput(
            "property keys beginning with 'jin.' are reserved".to_string(),
        ));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(JinError::InvalidInput(format!(
            "property key contains unsupported characters: {key:?}"
        )));
    }
    Ok(())
}

/// YAML frontmatter for a Note file.
///
/// The flattened map deliberately round-trips unfamiliar frontmatter rather
/// than dropping it when Jin edits a note. `properties` is the strict portable
/// typed surface; unknown keys remain untouched compatibility data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteFrontmatter {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // always "note"
    pub title: String,
    pub created: DateTime<FixedOffset>,
    pub updated: DateTime<FixedOffset>,
    #[serde(default)]
    pub status: NoteStatus,
    #[serde(default)]
    pub deleted_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<LinkEntry>,
    /// Strict, portable user properties. `jin.*` keys are refused by mutation
    /// APIs; the `jin.revision` metadata field below is Jin-owned.
    #[serde(default)]
    pub properties: BTreeMap<String, PropertyValue>,
    /// Monotonically increasing optimistic-concurrency revision.
    #[serde(rename = "jin.revision", default = "default_revision")]
    pub revision: u64,
    /// Unknown frontmatter is compatibility data and must survive rewrites.
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

impl NoteFrontmatter {
    pub fn is_deleted(&self) -> bool {
        self.status == NoteStatus::Deleted
    }

    /// Validate property keys even when the Markdown was written by another
    /// editor, rather than only when it was mutated through Jin.
    pub fn validate_properties(&self) -> Result<()> {
        for key in self.properties.keys() {
            validate_property_key(key)?;
        }
        Ok(())
    }
}

fn default_revision() -> u64 {
    1
}

/// A parsed Note (frontmatter + body).
#[derive(Debug, Clone)]
pub struct Note {
    pub frontmatter: NoteFrontmatter,
    pub body: String,
}

impl Note {
    pub fn id(&self) -> &str {
        &self.frontmatter.id
    }
    pub fn title(&self) -> &str {
        &self.frontmatter.title
    }
    pub fn is_deleted(&self) -> bool {
        self.frontmatter.is_deleted()
    }
}

/// A canonical, body-level Note link. Identity is always the ULID; the label is
/// presentation text and may freely change without invalidating the target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalLink {
    pub target_id: String,
    pub label: String,
    /// Byte position of the opening `[[`, retained for diagnostics and mention
    /// scanning only; it is never persisted as an identity.
    pub start: usize,
    pub end: usize,
}

/// Render the one canonical portable representation for an internal link.
pub fn format_canonical_link(target_id: &str, label: &str) -> Result<String> {
    if ulid::Ulid::from_string(target_id).is_err() {
        return Err(JinError::InvalidInput(format!(
            "canonical note link target is not a ULID: {target_id}"
        )));
    }
    let label = label.trim();
    if label.is_empty() || label.contains("[[") || label.contains("]]") {
        return Err(JinError::InvalidInput(
            "canonical link label must be non-empty and may not contain link delimiters"
                .to_string(),
        ));
    }
    Ok(format!("[[{target_id}|{label}]]"))
}

/// Parse canonical links without treating paths or labels as identity.
///
/// Invalid wiki-like text is ordinary Markdown text, not a partial link. This
/// makes a typo safe and avoids silently indexing a path/name as an object id.
pub fn parse_canonical_links(body: &str) -> Vec<CanonicalLink> {
    let mut links = Vec::new();
    let mut scan_from = 0;
    while let Some(relative_start) = body[scan_from..].find("[[") {
        let start = scan_from + relative_start;
        let payload_start = start + 2;
        let Some(relative_end) = body[payload_start..].find("]]") else {
            break;
        };
        let end = payload_start + relative_end + 2;
        let payload = &body[payload_start..payload_start + relative_end];
        if let Some((target_id, label)) = payload.split_once('|') {
            let target_id = target_id.trim();
            let label = label.trim();
            if ulid::Ulid::from_string(target_id).is_ok()
                && !label.is_empty()
                && !label.contains("[[")
                && !label.contains("]]")
            {
                links.push(CanonicalLink {
                    target_id: target_id.to_string(),
                    label: label.to_string(),
                    start,
                    end,
                });
            }
        }
        scan_from = end;
    }
    links
}

/// A title mention which is not already part of a canonical link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnlinkedMention {
    pub target_id: String,
    pub label: String,
    pub start: usize,
    pub end: usize,
}

/// Find deterministic whole-title mentions outside canonical links.
///
/// This is intentionally a suggestion API: it never writes links, and it uses
/// stable target IDs in its result so a UI can offer the canonical conversion.
pub fn find_unlinked_mentions(
    body: &str,
    source_id: &str,
    candidates: impl IntoIterator<Item = (String, String)>,
) -> Vec<UnlinkedMention> {
    let protected: Vec<(usize, usize)> = parse_canonical_links(body)
        .into_iter()
        .map(|link| (link.start, link.end))
        .collect();
    let mut candidates: Vec<(String, String)> = candidates
        .into_iter()
        .filter(|(id, title)| id != source_id && !title.trim().is_empty())
        .collect();
    // Longer titles first prevents "Project" from hiding "Project Plan"; ID
    // resolves ties deterministically.
    candidates.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));

    let mut mentions = Vec::new();
    for (target_id, title) in candidates {
        let mut scan_from = 0;
        while let Some(relative_start) = body[scan_from..].find(&title) {
            let start = scan_from + relative_start;
            let end = start + title.len();
            let protected_hit = protected.iter().any(|(a, b)| start < *b && end > *a);
            let before_is_word = body[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
            let after_is_word = body[end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
            if !protected_hit && !before_is_word && !after_is_word {
                mentions.push(UnlinkedMention {
                    target_id: target_id.clone(),
                    label: title.clone(),
                    start,
                    end,
                });
            }
            scan_from = end;
        }
    }
    mentions.sort_by(|a, b| {
        a.start
            .cmp(&b.start)
            .then_with(|| a.target_id.cmp(&b.target_id))
    });
    mentions
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const B: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

    #[test]
    fn portable_properties_reject_nested_values_and_classify_dates() {
        let parsed: std::result::Result<PropertyValue, _> =
            serde_yaml_ng::from_str("{ nested: no }");
        assert!(parsed.is_err());
        let date: PropertyValue = serde_yaml_ng::from_str("2026-08-20").unwrap();
        assert_eq!(date, PropertyValue::Date("2026-08-20".to_string()));
        let list: PropertyValue = serde_yaml_ng::from_str("[one, two]").unwrap();
        assert_eq!(list.kind(), "string-list");
        let json: PropertyValue = serde_json::from_str("true").unwrap();
        assert_eq!(json, PropertyValue::Bool(true));
    }

    #[test]
    fn property_keys_reserve_jin_namespace() {
        assert!(validate_property_key("jin.custom").is_err());
        assert!(validate_property_key("project.phase").is_ok());
    }

    #[test]
    fn canonical_links_require_ulid_identity_and_mentions_skip_links() {
        assert_eq!(
            format_canonical_link(A, "Roadmap").unwrap(),
            format!("[[{A}|Roadmap]]")
        );
        assert!(format_canonical_link("a/path.md", "Roadmap").is_err());
        let body = format!("[[{A}|Roadmap]] then Roadmap and Roadmapping");
        let links = parse_canonical_links(&body);
        assert_eq!(links.len(), 1);
        let mentions = find_unlinked_mentions(&body, B, [(A.to_string(), "Roadmap".to_string())]);
        assert_eq!(mentions.len(), 1);
        assert_eq!(&body[mentions[0].start..mentions[0].end], "Roadmap");
    }
}
