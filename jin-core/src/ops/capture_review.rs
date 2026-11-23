//! Canonical quick-capture review projection and state transitions.

use chrono::{DateTime, Local, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;

use crate::index::{self, query};
use crate::model::{CaptureReview, CaptureReviewState};
use crate::ops::recoverable_operations::{self, TargetPlan};
use crate::store::{frontmatter, fs};
use crate::{Config, JinError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureReviewItemDto {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub created: String,
    pub return_on: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetCaptureReviewInput {
    pub kind: String,
    pub id: String,
    pub state: CaptureReviewState,
    pub return_on: Option<NaiveDate>,
}

/// Split quick-capture text at its first non-empty line. Keeping this core
/// routine shared by CLI and Tauri prevents their title/body boundaries from
/// drifting apart.
pub fn split_capture_text(text: &str) -> Result<(String, String)> {
    let mut offset = 0;
    for segment in text.split_inclusive('\n') {
        let line = segment.trim_end_matches(['\r', '\n']);
        if !line.trim().is_empty() {
            let title = line.trim().to_string();
            if title.chars().count() > 500 {
                return Err(JinError::Validation {
                    field: "text".into(),
                    reason: "capture title must be 1–500 characters".into(),
                });
            }
            return Ok((title, text[offset + segment.len()..].to_string()));
        }
        offset += segment.len();
    }
    Err(JinError::Validation {
        field: "text".into(),
        reason: "capture text is required".into(),
    })
}

/// Build the only valid initial review marker for a quick capture.
/// A supplied attention date means the capture is immediately deferred.
pub fn initial_capture_review(
    review: bool,
    return_on: Option<NaiveDate>,
    display_tz: &str,
) -> Result<Option<CaptureReview>> {
    if !review && return_on.is_some() {
        return Err(JinError::Validation {
            field: "return_on".into(),
            reason: "requires review".into(),
        });
    }
    validate_check_back_date(return_on, today_in_display_timezone(display_tz, Utc::now()))?;
    Ok(review.then(|| CaptureReview {
        state: if return_on.is_some() {
            CaptureReviewState::Deferred
        } else {
            CaptureReviewState::Pending
        },
        return_on,
        processed_at: None,
    }))
}

fn item(row: query::CaptureReviewRow) -> CaptureReviewItemDto {
    CaptureReviewItemDto {
        kind: row.kind,
        id: row.id,
        title: row.title,
        created: row.created,
        return_on: row.return_on,
        state: row.state,
    }
}

/// Lists items needing a review decision. Existing Inbox tasks are included to
/// preserve capture continuity for owners upgrading from earlier Jin versions.
pub fn list(root: &Path) -> Result<Vec<CaptureReviewItemDto>> {
    let cfg = Config::load(root)?;
    let today = today_in_display_timezone(&cfg.display_tz, Utc::now());
    let conn = index::open(&cfg.index_path())?;
    let rows = query::list_capture_review(&conn, &today.to_string()).map_err(JinError::Index)?;
    Ok(rows.into_iter().map(item).collect())
}

fn today_in_display_timezone(display_tz: &str, now: DateTime<Utc>) -> NaiveDate {
    let display_tz = Tz::from_str(display_tz).unwrap_or(chrono_tz::UTC);
    now.with_timezone(&display_tz).date_naive()
}

fn validate_check_back_date(return_on: Option<NaiveDate>, today: NaiveDate) -> Result<()> {
    if return_on.is_some_and(|date| date < today) {
        return Err(JinError::Validation {
            field: "return_on".into(),
            reason: "must be today or later".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod timezone_tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn review_date_uses_configured_display_timezone() {
        let now = Utc.with_ymd_and_hms(2026, 11, 24, 1, 30, 0).unwrap();
        assert_eq!(
            today_in_display_timezone("America/Sao_Paulo", now),
            NaiveDate::from_ymd_opt(2026, 11, 23).unwrap()
        );
        assert_eq!(
            today_in_display_timezone("Pacific/Auckland", now),
            NaiveDate::from_ymd_opt(2026, 11, 24).unwrap()
        );
    }

    #[test]
    fn initial_review_with_return_date_is_deferred() {
        let date = Utc::now().date_naive().succ_opt().unwrap();
        let review = initial_capture_review(true, Some(date), "UTC")
            .unwrap()
            .unwrap();
        assert_eq!(review.state, CaptureReviewState::Deferred);
        assert_eq!(review.return_on, Some(date));
        assert!(initial_capture_review(false, Some(date), "UTC").is_err());
    }

    #[test]
    fn check_back_dates_allow_today_and_reject_past_dates_in_the_display_timezone() {
        let now = Utc.with_ymd_and_hms(2026, 11, 24, 1, 30, 0).unwrap();
        let today = today_in_display_timezone("America/Sao_Paulo", now);
        assert!(validate_check_back_date(Some(today), today).is_ok());
        assert!(matches!(
            validate_check_back_date(Some(today.pred_opt().unwrap()), today),
            Err(JinError::Validation { field, .. }) if field == "return_on"
        ));
    }
}

pub fn set(root: &Path, input: SetCaptureReviewInput) -> Result<()> {
    match (&input.state, input.return_on) {
        (CaptureReviewState::Deferred, None) => {
            return Err(JinError::Validation {
                field: "return_on".into(),
                reason: "is required when deferring a capture".into(),
            })
        }
        (CaptureReviewState::Pending | CaptureReviewState::Processed, Some(_)) => {
            return Err(JinError::Validation {
                field: "return_on".into(),
                reason: "is only available while a capture is deferred".into(),
            })
        }
        _ => {}
    }
    let cfg = Config::load(root)?;
    let today = today_in_display_timezone(&cfg.display_tz, Utc::now());
    let operation_id = format!(
        "capture-review-{}-{}-{:?}-{}",
        input.kind,
        input.id,
        input.state,
        input
            .return_on
            .map(|date| date.to_string())
            .unwrap_or_default()
    )
    .to_ascii_lowercase();
    match input.kind.as_str() {
        "note" => {
            recoverable_operations::execute_task_operation_allow_noop(
                root,
                &operation_id,
                "capture_review_set",
                || {
                    let path = fs::find_note_path(&cfg.notes_dir(), &input.id)?;
                    let before = std::fs::read(&path)?;
                    let mut note = fs::read_note(&path)?;
                    if note.is_deleted() {
                        return Err(JinError::NotFound(format!("note/{} is deleted", input.id)));
                    }
                    if note
                        .frontmatter
                        .capture_review
                        .as_ref()
                        .is_some_and(|current| {
                            current.state == input.state && current.return_on == input.return_on
                        })
                    {
                        return Ok((note.id().to_string(), vec![]));
                    }
                    if matches!(input.state, CaptureReviewState::Deferred) {
                        validate_check_back_date(input.return_on, today)?;
                    }
                    let processed_at = matches!(input.state, CaptureReviewState::Processed)
                        .then(|| Local::now().fixed_offset());
                    note.frontmatter.capture_review = Some(CaptureReview {
                        state: input.state.clone(),
                        return_on: input.return_on,
                        processed_at,
                    });
                    note.frontmatter.updated = Local::now().fixed_offset();
                    note.frontmatter.revision = note.frontmatter.revision.saturating_add(1);
                    Ok((
                        note.id().to_string(),
                        vec![TargetPlan {
                            canonical_path: path,
                            before: Some(before),
                            post: Some(
                                frontmatter::render(&note.frontmatter, &note.body)?.into_bytes(),
                            ),
                        }],
                    ))
                },
            )?;
        }
        "task" => {
            recoverable_operations::execute_task_operation_allow_noop(
                root,
                &operation_id,
                "capture_review_set",
                || {
                    let path = fs::find_task_path(&cfg.tasks_dir(), &input.id)?;
                    let before = std::fs::read(&path)?;
                    let mut task = fs::read_task(&path)?;
                    if task.is_deleted() {
                        return Err(JinError::NotFound(format!("task/{} is deleted", input.id)));
                    }
                    if task
                        .frontmatter
                        .capture_review
                        .as_ref()
                        .is_some_and(|current| {
                            current.state == input.state && current.return_on == input.return_on
                        })
                    {
                        return Ok((task.id().to_string(), vec![]));
                    }
                    if matches!(input.state, CaptureReviewState::Deferred) {
                        validate_check_back_date(input.return_on, today)?;
                    }
                    let processed_at = matches!(input.state, CaptureReviewState::Processed)
                        .then(|| Local::now().fixed_offset());
                    task.frontmatter.capture_review = Some(CaptureReview {
                        state: input.state.clone(),
                        return_on: input.return_on,
                        processed_at,
                    });
                    task.frontmatter.updated = Local::now().fixed_offset();
                    Ok((
                        task.id().to_string(),
                        vec![TargetPlan {
                            canonical_path: path,
                            before: Some(before),
                            post: Some(fs::render_task_bytes(&task)?),
                        }],
                    ))
                },
            )?;
        }
        _ => {
            return Err(JinError::InvalidInput(
                "capture review kind must be note or task".into(),
            ))
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defer_requires_a_return_date_before_any_store_write() {
        let root = tempfile::TempDir::new().unwrap();
        assert!(matches!(
            set(
                root.path(),
                SetCaptureReviewInput {
                    kind: "note".into(),
                    id: "01J00000000000000000000000".into(),
                    state: CaptureReviewState::Deferred,
                    return_on: None,
                },
            ),
            Err(JinError::Validation { field, .. }) if field == "return_on"
        ));
    }

    #[test]
    fn processed_cannot_carry_a_return_date() {
        let root = tempfile::TempDir::new().unwrap();
        assert!(matches!(
            set(
                root.path(),
                SetCaptureReviewInput {
                    kind: "task".into(),
                    id: "01J00000000000000000000000".into(),
                    state: CaptureReviewState::Processed,
                    return_on: Some("2026-11-23".parse().unwrap()),
                },
            ),
            Err(JinError::Validation { field, .. }) if field == "return_on"
        ));
    }
}
