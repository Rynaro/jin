//! Portable, owner-visible follow-up metadata for quick captures.

use chrono::{DateTime, FixedOffset, NaiveDate};
use serde::{Deserialize, Serialize};

/// A capture stays in review until its owner deliberately keeps or clears it.
/// The date is an attention date only. It is deliberately independent from a
/// task deadline, reminder, and calendar block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureReview {
    #[serde(default = "pending")]
    pub state: CaptureReviewState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_on: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_at: Option<DateTime<FixedOffset>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureReviewState {
    Pending,
    Deferred,
    Processed,
}

fn pending() -> CaptureReviewState {
    CaptureReviewState::Pending
}

impl Default for CaptureReview {
    fn default() -> Self {
        Self {
            state: CaptureReviewState::Pending,
            return_on: None,
            processed_at: None,
        }
    }
}

impl CaptureReview {
    pub fn is_open(&self) -> bool {
        !matches!(self.state, CaptureReviewState::Processed)
    }
}
