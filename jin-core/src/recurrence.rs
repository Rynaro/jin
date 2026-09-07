//! Typed recurrence authoring over the canonical lossless `Vec<String>` field.

use chrono::{NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::model::event::TemporalValue;
use crate::{JinError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceFrequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecurrenceWeekday {
    Mo,
    Tu,
    We,
    Th,
    Fr,
    Sa,
    Su,
}

impl RecurrenceWeekday {
    fn rrule(self) -> &'static str {
        match self {
            Self::Mo => "MO",
            Self::Tu => "TU",
            Self::We => "WE",
            Self::Th => "TH",
            Self::Fr => "FR",
            Self::Sa => "SA",
            Self::Su => "SU",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonthlyRecurrence {
    DayOfMonth {
        day: u8,
    },
    NthWeekday {
        ordinal: i8,
        weekday: RecurrenceWeekday,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecurrenceEnd {
    #[default]
    Never,
    Until {
        date: NaiveDate,
    },
    Count {
        count: u16,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecurrenceDraft {
    pub frequency: RecurrenceFrequency,
    #[serde(default = "default_interval")]
    pub interval: u16,
    #[serde(default)]
    pub weekly_days: Vec<RecurrenceWeekday>,
    pub monthly: Option<MonthlyRecurrence>,
    #[serde(default)]
    pub end: RecurrenceEnd,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecurrencePreviewDto {
    pub recurrence: Vec<String>,
    pub occurrences: Vec<String>,
}

pub fn preview(
    draft: &RecurrenceDraft,
    start: &TemporalValue,
    tzid: Option<&str>,
    limit: u16,
) -> Result<RecurrencePreviewDto> {
    let recurrence = compile(draft, start, tzid)?;
    let occurrences = derive_local_occurrences(&recurrence, start, tzid, limit)?;
    Ok(RecurrencePreviewDto {
        recurrence,
        occurrences,
    })
}

fn default_interval() -> u16 {
    1
}

pub fn compile(
    draft: &RecurrenceDraft,
    start: &TemporalValue,
    tzid: Option<&str>,
) -> Result<Vec<String>> {
    validate(draft)?;
    let mut parts = vec![format!(
        "FREQ={}",
        match draft.frequency {
            RecurrenceFrequency::Daily => "DAILY",
            RecurrenceFrequency::Weekly => "WEEKLY",
            RecurrenceFrequency::Monthly => "MONTHLY",
            RecurrenceFrequency::Yearly => "YEARLY",
        }
    )];
    if draft.interval > 1 {
        parts.push(format!("INTERVAL={}", draft.interval));
    }
    if draft.frequency == RecurrenceFrequency::Weekly && !draft.weekly_days.is_empty() {
        parts.push(format!(
            "BYDAY={}",
            draft
                .weekly_days
                .iter()
                .map(|day| day.rrule())
                .collect::<Vec<_>>()
                .join(",")
        ));
    }
    if draft.frequency == RecurrenceFrequency::Monthly {
        if let Some(monthly) = &draft.monthly {
            match monthly {
                MonthlyRecurrence::DayOfMonth { day } => {
                    parts.push(format!("BYMONTHDAY={day}"));
                }
                MonthlyRecurrence::NthWeekday { ordinal, weekday } => {
                    parts.push(format!("BYDAY={ordinal}{}", weekday.rrule()));
                }
            }
        }
    }
    match draft.end {
        RecurrenceEnd::Never => {}
        RecurrenceEnd::Count { count } => parts.push(format!("COUNT={count}")),
        RecurrenceEnd::Until { date } => {
            let until = match start {
                TemporalValue::Date(_) => date.format("%Y%m%d").to_string(),
                TemporalValue::DateTime(_) if tzid.is_none() => date
                    .and_hms_opt(23, 59, 59)
                    .expect("valid end of day")
                    .format("%Y%m%dT%H%M%S")
                    .to_string(),
                TemporalValue::DateTime(_) => {
                    let local = date.and_hms_opt(23, 59, 59).expect("valid end of day");
                    local_to_utc(local, tzid)?
                        .format("%Y%m%dT%H%M%SZ")
                        .to_string()
                }
            };
            parts.push(format!("UNTIL={until}"));
        }
    }
    // Parse through rrule as a grammar/semantic validation gate before canonicalizing.
    let rule = format!("RRULE:{}", parts.join(";"));
    let set_text = format!("{}\n{rule}", render_dtstart(start, tzid)?);
    let _: rrule::RRuleSet = set_text
        .parse()
        .map_err(|error| JinError::InvalidInput(format!("invalid recurrence: {error}")))?;
    Ok(vec![rule])
}

pub fn derive_local_occurrences(
    recurrence: &[String],
    start: &TemporalValue,
    tzid: Option<&str>,
    limit: u16,
) -> Result<Vec<String>> {
    if recurrence.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let text = format!(
        "{}\n{}",
        render_dtstart(start, tzid)?,
        recurrence.join("\n")
    );
    let set: rrule::RRuleSet = text
        .parse()
        .map_err(|error| JinError::InvalidInput(format!("invalid recurrence: {error}")))?;
    let dates = set.all(limit.min(256)).dates.into_iter();
    Ok(match start {
        TemporalValue::Date(_) => dates
            .map(|date| date.format("%Y-%m-%d").to_string())
            .collect(),
        TemporalValue::DateTime(_) => dates.map(|date| date.to_rfc3339()).collect(),
    })
}

pub fn is_supported(recurrence: &[String]) -> bool {
    let rules = recurrence
        .iter()
        .filter_map(|line| line.strip_prefix("RRULE:"))
        .collect::<Vec<_>>();
    if rules.len() != 1 {
        return false;
    }
    rules[0].split(';').all(|part| {
        let key = part.split('=').next().unwrap_or_default();
        matches!(
            key,
            "FREQ" | "INTERVAL" | "BYDAY" | "BYMONTHDAY" | "COUNT" | "UNTIL"
        )
    }) && recurrence.iter().all(|line| {
        line.starts_with("RRULE:") || line.starts_with("EXDATE:") || line.starts_with("RDATE:")
    })
}

fn validate(draft: &RecurrenceDraft) -> Result<()> {
    if draft.interval == 0 {
        return Err(JinError::InvalidInput(
            "recurrence interval must be at least 1".to_string(),
        ));
    }
    if let Some(MonthlyRecurrence::DayOfMonth { day }) = draft.monthly {
        if !(1..=31).contains(&day) {
            return Err(JinError::InvalidInput(
                "monthly day must be between 1 and 31".to_string(),
            ));
        }
    }
    if let Some(MonthlyRecurrence::NthWeekday { ordinal, .. }) = draft.monthly {
        if ordinal == 0 || !(-1..=5).contains(&ordinal) {
            return Err(JinError::InvalidInput(
                "monthly weekday ordinal must be -1 or 1 through 5".to_string(),
            ));
        }
    }
    if let RecurrenceEnd::Count { count } = draft.end {
        if count == 0 {
            return Err(JinError::InvalidInput(
                "recurrence count must be at least 1".to_string(),
            ));
        }
    }
    Ok(())
}

fn render_dtstart(start: &TemporalValue, tzid: Option<&str>) -> Result<String> {
    match start {
        TemporalValue::Date(date) => Ok(format!("DTSTART:{}", date.format("%Y%m%d"))),
        TemporalValue::DateTime(date_time) => match tzid {
            Some(zone) => {
                let _: chrono_tz::Tz = zone.parse().map_err(|_| JinError::InvalidTimezone {
                    tzid: zone.to_string(),
                    reason: "unknown IANA timezone".to_string(),
                })?;
                Ok(format!(
                    "DTSTART;TZID={zone}:{}",
                    date_time.format("%Y%m%dT%H%M%S")
                ))
            }
            None => Ok(format!("DTSTART:{}", date_time.format("%Y%m%dT%H%M%S"))),
        },
    }
}

fn local_to_utc(value: NaiveDateTime, tzid: Option<&str>) -> Result<chrono::DateTime<Utc>> {
    let Some(zone) = tzid else {
        return Ok(Utc.from_utc_datetime(&value));
    };
    let zone: chrono_tz::Tz = zone.parse().map_err(|_| JinError::InvalidTimezone {
        tzid: zone.to_string(),
        reason: "unknown IANA timezone".to_string(),
    })?;
    zone.from_local_datetime(&value)
        .earliest()
        .map(|date| date.with_timezone(&Utc))
        .ok_or_else(|| JinError::InvalidInput("recurrence end falls in a timezone gap".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekly_compiles_and_expands_in_local_timezone() {
        let draft = RecurrenceDraft {
            frequency: RecurrenceFrequency::Weekly,
            interval: 2,
            weekly_days: vec![RecurrenceWeekday::Mo, RecurrenceWeekday::We],
            monthly: None,
            end: RecurrenceEnd::Count { count: 4 },
        };
        let start = TemporalValue::DateTime(
            NaiveDate::from_ymd_opt(2026, 9, 7)
                .unwrap()
                .and_hms_opt(9, 0, 0)
                .unwrap(),
        );
        let raw = compile(&draft, &start, Some("America/Sao_Paulo")).unwrap();
        assert_eq!(
            raw,
            vec!["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4"]
        );
        let dates = derive_local_occurrences(&raw, &start, Some("America/Sao_Paulo"), 3).unwrap();
        assert_eq!(dates.len(), 3);
        assert!(dates.iter().all(|date| date.ends_with("-03:00")));
    }

    #[test]
    fn unsupported_import_is_lossless_and_detected() {
        let raw = vec!["RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO,TU,WE,TH,FR".to_string()];
        assert!(!is_supported(&raw));
        assert_eq!(raw[0], "RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO,TU,WE,TH,FR");
    }

    #[test]
    fn until_matches_dtstart_value_type_and_locality() {
        let draft = RecurrenceDraft {
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            weekly_days: Vec::new(),
            monthly: None,
            end: RecurrenceEnd::Until {
                date: NaiveDate::from_ymd_opt(2026, 9, 30).unwrap(),
            },
        };
        let all_day = TemporalValue::Date(NaiveDate::from_ymd_opt(2026, 9, 1).unwrap());
        assert_eq!(
            compile(&draft, &all_day, None).unwrap(),
            vec!["RRULE:FREQ=DAILY;UNTIL=20260930"]
        );
        assert_eq!(
            derive_local_occurrences(&compile(&draft, &all_day, None).unwrap(), &all_day, None, 1)
                .unwrap(),
            vec!["2026-09-01"]
        );

        let floating = TemporalValue::DateTime(
            NaiveDate::from_ymd_opt(2026, 9, 1)
                .unwrap()
                .and_hms_opt(9, 0, 0)
                .unwrap(),
        );
        assert_eq!(
            compile(&draft, &floating, None).unwrap(),
            vec!["RRULE:FREQ=DAILY;UNTIL=20260930T235959"]
        );
        assert!(
            compile(&draft, &floating, Some("America/Sao_Paulo")).unwrap()[0].ends_with("T025959Z")
        );
    }
}
