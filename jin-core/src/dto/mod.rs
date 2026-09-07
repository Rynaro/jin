//! Versioned DTO contract — the stable public boundary.
//! Consumers (CLI --json, future GUI) see only these types, never raw SQLite rows.

use serde::{Deserialize, Serialize};

pub mod agenda;
pub mod dangling;
pub mod event;
pub mod folder;
pub mod google;
pub mod list;
pub mod note;
pub mod result;
pub mod tag;
pub mod task;

pub use agenda::{AgendaDto, AgendaEventDto, LinkedNoteRef, LinkedTaskRef};
pub use dangling::DanglingEdgeDto;
pub use event::{
    EditEventResultDto, EventDetailCapabilitiesDto, EventDetailDto, EventDisplayKind, EventDto,
    EventReadOnlyReason, EventSyncContextDto, OriginatingTaskRefDto, RemoveTimeBlockResultDto,
};
pub use folder::FolderDto;
pub use google::{GoogleAccountDto, GoogleCalendarDto};
pub use list::{ListDto, SectionDto};
pub use note::{CanonicalLinkDto, NoteDto, UnlinkedMentionDto};
pub use result::ResultDto;
pub use tag::TagDto;
pub use task::{ReminderDto, TaskDto};

/// Envelope with a dynamic data value (for --json output serialisation).
/// M7: jin_dto_version is String so round-trip serde_json works.
#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub jin_dto_version: String,
    pub kind: String,
    pub data: serde_json::Value,
    pub warnings: Vec<String>,
}

impl Envelope {
    pub fn ok(kind: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            jin_dto_version: "1".to_string(),
            kind: kind.into(),
            data,
            warnings: vec![],
        }
    }

    pub fn error(code: &str, message: &str) -> Self {
        Self {
            jin_dto_version: "1".to_string(),
            kind: "result".to_string(),
            data: serde_json::json!({
                "ok": false,
                "code": code,
                "message": message,
            }),
            warnings: vec![],
        }
    }

    pub fn with_warnings(mut self, warnings: Vec<String>) -> Self {
        self.warnings = warnings;
        self
    }
}
