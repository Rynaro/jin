//! Timezone and DST helpers (S5).
//!
//! ## DST policy (VG9)
//!
//! `chrono-tz` `LocalResult` is handled explicitly — never `.unwrap()`:
//!
//! | `LocalResult` | Cause | Policy | What is emitted |
//! |---|---|---|---|
//! | `Single(dt)` | Unique instant | Use as-is | `TzResolution::Exact` |
//! | `Ambiguous(dt1, dt2)` | Fall-back overlap (clocks go back, one hour of wall-time repeats) | **Use the earlier chronological instant** (`dt1`, pre-transition / DST offset). This is the first physical occurrence of the wall-clock time. | `TzResolution::AmbiguousUsedEarlier` with a human-readable note |
//! | `None` | Spring-forward gap (clocks skip forward, one hour of wall-time never occurs) | **Shift the naive time forward by one hour** to land after the gap, then resolve again. If the shifted time is also ambiguous/None, return an error. | `TzResolution::NonexistentShiftedForward` with a human-readable note |
//!
//! Callers receive a typed `TzResolution` that carries both the UTC instant and an
//! optional textual note. Callers decide whether to surface the note as a warning,
//! log it, or discard it — jin-core itself never silently drops a DST irregularity.

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use std::str::FromStr;

/// The outcome of resolving a wall-time + tzid pair to a UTC instant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TzResolution {
    /// Unique, unambiguous mapping.
    Exact(DateTime<Utc>),

    /// The wall-time fell in a fall-back overlap (DST→standard).
    /// We used the **earlier** chronological instant (pre-transition / DST offset).
    AmbiguousUsedEarlier {
        utc: DateTime<Utc>,
        /// Human-readable note describing the resolution.
        note: String,
    },

    /// The wall-time fell in a spring-forward gap (standard→DST, clocks skip).
    /// We shifted the naive time forward by one hour to land after the gap.
    NonexistentShiftedForward {
        utc: DateTime<Utc>,
        /// Human-readable note describing the resolution.
        note: String,
    },
}

impl TzResolution {
    /// The resolved UTC instant.
    pub fn utc(&self) -> DateTime<Utc> {
        match self {
            TzResolution::Exact(dt) => *dt,
            TzResolution::AmbiguousUsedEarlier { utc, .. } => *utc,
            TzResolution::NonexistentShiftedForward { utc, .. } => *utc,
        }
    }

    /// A human-readable warning note when the resolution required a policy choice,
    /// or `None` when the mapping was exact.
    pub fn warning_note(&self) -> Option<&str> {
        match self {
            TzResolution::Exact(_) => None,
            TzResolution::AmbiguousUsedEarlier { note, .. } => Some(note),
            TzResolution::NonexistentShiftedForward { note, .. } => Some(note),
        }
    }

    /// Whether the resolution was exact (no policy was applied).
    pub fn is_exact(&self) -> bool {
        matches!(self, TzResolution::Exact(_))
    }
}

/// Resolve a local wall-time + IANA tzid to a UTC instant with explicit DST handling.
///
/// Returns `Err` only when `tzid` is invalid or the gap is non-standard (>1 hour).
/// DST ambiguity and nonexistence are handled by policy (see module doc) — they
/// produce an `Ok` result with a non-`Exact` variant that carries a note.
///
/// # Errors
/// - Invalid IANA tzid → `Err(String)` with a descriptive message.
/// - Spring-forward gap that is not 1 hour (non-standard) → `Err(String)`.
pub fn resolve_to_utc(naive: NaiveDateTime, tzid: &str) -> Result<TzResolution, String> {
    use chrono::LocalResult;

    let tz = Tz::from_str(tzid).map_err(|e| format!("invalid tzid '{}': {}", tzid, e))?;

    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Ok(TzResolution::Exact(dt.with_timezone(&Utc))),

        LocalResult::Ambiguous(dt1, _dt2) => {
            // Fall-back overlap policy: use the earlier chronological instant (dt1).
            // dt1 is always the pre-transition (DST) offset — the first physical
            // occurrence of the ambiguous wall-clock time.
            let utc = dt1.with_timezone(&Utc);
            Ok(TzResolution::AmbiguousUsedEarlier {
                utc,
                note: format!(
                    "wall-time {} in {} is ambiguous (fall-back/overlap); \
                     used the earlier instant (pre-transition / DST offset, UTC {})",
                    naive,
                    tzid,
                    utc.format("%Y-%m-%dT%H:%M:%SZ")
                ),
            })
        }

        LocalResult::None => {
            // Spring-forward gap policy: shift the naive time forward by 1 hour
            // (standard DST transition gap) and re-resolve.
            let shifted = naive + chrono::Duration::hours(1);
            match tz.from_local_datetime(&shifted) {
                LocalResult::Single(dt) => {
                    let utc = dt.with_timezone(&Utc);
                    Ok(TzResolution::NonexistentShiftedForward {
                        utc,
                        note: format!(
                            "wall-time {} in {} does not exist (spring-forward gap); \
                             shifted to {} (UTC {})",
                            naive,
                            tzid,
                            shifted,
                            utc.format("%Y-%m-%dT%H:%M:%SZ")
                        ),
                    })
                }
                LocalResult::Ambiguous(dt1, _) => {
                    // Shifted time is itself ambiguous — accept the earlier instant.
                    let utc = dt1.with_timezone(&Utc);
                    Ok(TzResolution::NonexistentShiftedForward {
                        utc,
                        note: format!(
                            "wall-time {} in {} does not exist (spring-forward gap); \
                             shifted to {} which is itself ambiguous; used earlier instant (UTC {})",
                            naive,
                            tzid,
                            shifted,
                            utc.format("%Y-%m-%dT%H:%M:%SZ")
                        ),
                    })
                }
                LocalResult::None => Err(format!(
                    "wall-time {} in {} is in a non-standard DST gap (>1 hour); \
                     cannot resolve automatically",
                    naive, tzid
                )),
            }
        }
    }
}

/// Validate an IANA timezone name, returning an error string if invalid.
pub fn validate_tzid(tzid: &str) -> Result<(), String> {
    Tz::from_str(tzid)
        .map(|_| ())
        .map_err(|e| format!("invalid tzid '{}': {}", tzid, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn naive(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    #[test]
    fn exact_resolution_is_exact() {
        // A non-DST-transition time should resolve without any policy.
        let result = resolve_to_utc(naive("2026-07-01T14:00:00"), "America/New_York").unwrap();
        assert!(result.is_exact(), "should be exact for a non-DST time");
        assert!(result.warning_note().is_none());
    }

    #[test]
    fn spring_forward_gap_is_shifted_forward() {
        // America/New_York springs forward on 2023-03-12 at 2:00 AM.
        // 02:30:00 is in the gap (doesn't exist).
        // Policy: shift +1h → 03:30:00 EDT (UTC-4) = 07:30:00 UTC.
        let result = resolve_to_utc(naive("2023-03-12T02:30:00"), "America/New_York").unwrap();
        assert!(
            matches!(result, TzResolution::NonexistentShiftedForward { .. }),
            "should be NonexistentShiftedForward, got {:?}",
            result
        );
        assert!(result.warning_note().is_some());
        // shifted → 03:30 EDT = UTC 07:30
        let expected_utc = chrono::DateTime::parse_from_rfc3339("2023-03-12T07:30:00+00:00")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            result.utc(),
            expected_utc,
            "VG9: gap should shift to UTC 07:30"
        );
    }

    #[test]
    fn fall_back_overlap_uses_earlier_instant() {
        // America/New_York falls back on 2023-11-05 at 2:00 AM.
        // 01:30:00 is ambiguous: first occurrence = EDT (UTC-4) = 05:30 UTC,
        //                        second occurrence = EST (UTC-5) = 06:30 UTC.
        // Policy: use earlier instant (05:30 UTC / EDT / pre-transition).
        let result = resolve_to_utc(naive("2023-11-05T01:30:00"), "America/New_York").unwrap();
        assert!(
            matches!(result, TzResolution::AmbiguousUsedEarlier { .. }),
            "should be AmbiguousUsedEarlier, got {:?}",
            result
        );
        assert!(result.warning_note().is_some());
        // first occurrence = EDT (UTC-4): 01:30 + 4h = 05:30 UTC
        let expected_utc = chrono::DateTime::parse_from_rfc3339("2023-11-05T05:30:00+00:00")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            result.utc(),
            expected_utc,
            "VG9: overlap should use UTC 05:30 (EDT/pre-transition)"
        );
    }

    #[test]
    fn invalid_tzid_returns_error() {
        let err = resolve_to_utc(naive("2026-01-01T00:00:00"), "Not/A_Timezone").unwrap_err();
        assert!(
            err.contains("invalid tzid"),
            "error should mention invalid tzid"
        );
    }

    #[test]
    fn validate_tzid_accepts_valid() {
        assert!(validate_tzid("America/New_York").is_ok());
        assert!(validate_tzid("America/Sao_Paulo").is_ok());
        assert!(validate_tzid("UTC").is_ok());
        assert!(validate_tzid("Europe/London").is_ok());
    }

    #[test]
    fn validate_tzid_rejects_invalid() {
        assert!(validate_tzid("Fake/Timezone").is_err());
        assert!(validate_tzid("").is_err());
    }

    #[test]
    fn all_day_date_has_no_utc_mapping() {
        // All-day events use NaiveDate, no tzid → no UTC resolution needed.
        // This test confirms NaiveDate parses fine (no time module involvement for all-day).
        let d = NaiveDate::parse_from_str("2026-07-01", "%Y-%m-%d");
        assert!(d.is_ok());
    }
}
