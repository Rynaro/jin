//! Portable Notes Collection documents and their non-executable query grammar.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::note::PropertyValue;

pub const COLLECTION_SCHEMA_VERSION: u32 = 1;
pub const QUERY_SCHEMA_VERSION: u32 = 1;

/// Versioned declarative query persisted inside a Collection JSON document.
/// There is deliberately no SQL, JavaScript, template, or expression field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionQuery {
    pub version: u32,
    #[serde(default)]
    pub filter: QueryFilter,
    #[serde(default)]
    pub sort: Vec<QuerySort>,
    #[serde(default)]
    pub limit: Option<usize>,
}

impl Default for CollectionQuery {
    fn default() -> Self {
        Self {
            version: QUERY_SCHEMA_VERSION,
            filter: QueryFilter::All { clauses: vec![] },
            sort: vec![QuerySort {
                field: SortField::Updated,
                direction: SortDirection::Desc,
            }],
            limit: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum QueryFilter {
    All { clauses: Vec<QueryFilter> },
    Any { clauses: Vec<QueryFilter> },
    Not { clause: Box<QueryFilter> },
    Status { value: String },
    Tag { value: String },
    PropertyEquals { key: String, value: PropertyValue },
    HasLink { target_id: String },
    BodyContains { value: String },
}

impl Default for QueryFilter {
    fn default() -> Self {
        Self::All { clauses: vec![] }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuerySort {
    pub field: SortField,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Created,
    Updated,
    Title,
    Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// A portable versioned collection view. Unknown top-level fields are retained
/// when documents are loaded and saved by a newer/older Jin installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionDocument {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub query: CollectionQuery,
    /// Presentation data is JSON data only; it is never executable.
    #[serde(default = "default_view")]
    pub view: serde_json::Value,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn default_view() -> serde_json::Value {
    serde_json::json!({ "version": 1, "layout": "list" })
}
