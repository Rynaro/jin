use serde::{Deserialize, Serialize};

/// Generic result DTO for operations that don't return a specific object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultDto {
    pub ok: bool,
    pub message: String,
    pub id: Option<String>,
}

impl ResultDto {
    pub fn success(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: message.into(),
            id: None,
        }
    }

    pub fn success_with_id(message: impl Into<String>, id: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: message.into(),
            id: Some(id.into()),
        }
    }

    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: message.into(),
            id: None,
        }
    }
}
