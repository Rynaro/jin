use serde::{Deserialize, Serialize};

/// The three allowed edge types (MVP vocabulary — ADR-0001).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeType {
    /// Event → Task (created by `promote`)
    DerivedFrom,
    /// Note → Event (created by `attach` to event)
    PrepFor,
    /// Note → {Task|Event|Note} (created by `attach` to task/note)
    References,
}

impl EdgeType {
    /// Validate that source_type → target_type is a legal signature.
    pub fn validate_signature(&self, source_kind: &str, target_kind: &str) -> bool {
        match self {
            EdgeType::DerivedFrom => source_kind == "event" && target_kind == "task",
            EdgeType::PrepFor => source_kind == "note" && target_kind == "event",
            EdgeType::References => {
                source_kind == "note"
                    && (target_kind == "task" || target_kind == "event" || target_kind == "note")
            }
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            EdgeType::DerivedFrom => "derived-from",
            EdgeType::PrepFor => "prep-for",
            EdgeType::References => "references",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "derived-from" => Some(EdgeType::DerivedFrom),
            "prep-for" => Some(EdgeType::PrepFor),
            "references" => Some(EdgeType::References),
            _ => None,
        }
    }
}

impl std::fmt::Display for EdgeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A link entry stored source-side in frontmatter `links[]`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkEntry {
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
    pub target: String, // ULID of the target object
}
