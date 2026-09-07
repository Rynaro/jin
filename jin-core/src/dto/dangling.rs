use serde::{Deserialize, Serialize};

/// DTO for a dangling edge (target missing or tombstoned).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanglingEdgeDto {
    pub source_id: String,
    pub source_kind: String,
    pub target_id: String,
    pub edge_type: String,
    pub reason: String,
}

impl DanglingEdgeDto {
    pub(crate) fn from_row(row: &crate::index::query::DanglingEdgeRow) -> Self {
        Self {
            source_id: row.source_id.clone(),
            source_kind: row.source_kind.clone(),
            target_id: row.target_id.clone(),
            edge_type: row.edge_type.clone(),
            reason: row.reason.clone(),
        }
    }
}
