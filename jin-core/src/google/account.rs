//! Stable Google account and calendar registry.
//!
//! Provider subjects, account ids, and calendar ids are identity. Aliases and
//! display names are presentation only and must never be used as storage keys.

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::JinError;

pub const GOOGLE_PROVIDER: &str = "google";
pub const GOOGLE_ISSUER: &str = "https://accounts.google.com";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GoogleAccountId(String);

impl GoogleAccountId {
    pub fn new() -> Self {
        Self(crate::id::new_ulid())
    }

    pub fn parse(value: impl Into<String>) -> crate::Result<Self> {
        let value = value.into();
        if value.trim().is_empty() || value.contains('/') || value.contains('\\') {
            return Err(JinError::Integrity("invalid Google account id".to_string()));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for GoogleAccountId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for GoogleAccountId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoogleAccountState {
    #[default]
    Pending,
    Connected,
    NeedsReauth,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GoogleAccessRole {
    Owner,
    Writer,
    Reader,
    FreeBusyReader,
}

impl GoogleAccessRole {
    pub fn can_write(self) -> bool {
        matches!(self, Self::Owner | Self::Writer)
    }

    pub fn from_provider(value: &str) -> crate::Result<Self> {
        match value {
            "owner" => Ok(Self::Owner),
            "writer" => Ok(Self::Writer),
            "reader" => Ok(Self::Reader),
            "freeBusyReader" => Ok(Self::FreeBusyReader),
            other => Err(JinError::Integrity(format!(
                "unsupported Google Calendar accessRole: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventSyncTarget {
    pub account_id: GoogleAccountId,
    pub calendar_id: String,
}

impl EventSyncTarget {
    pub fn new(account_id: GoogleAccountId, calendar_id: impl Into<String>) -> crate::Result<Self> {
        let calendar_id = calendar_id.into();
        if calendar_id.trim().is_empty() {
            return Err(JinError::Integrity(
                "calendar id cannot be empty".to_string(),
            ));
        }
        Ok(Self {
            account_id,
            calendar_id,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleAccount {
    pub id: GoogleAccountId,
    #[serde(default)]
    pub provider_issuer: Option<String>,
    #[serde(default)]
    pub provider_subject: Option<String>,
    pub alias: String,
    #[serde(default)]
    pub principal: Option<String>,
    #[serde(default)]
    pub state: GoogleAccountState,
    #[serde(default)]
    pub auth_generation: u64,
    pub created_at: DateTime<FixedOffset>,
    pub updated_at: DateTime<FixedOffset>,
}

impl GoogleAccount {
    pub fn pending(alias: impl Into<String>) -> crate::Result<Self> {
        let alias = normalize_alias(alias.into())?;
        let now = Utc::now().fixed_offset();
        Ok(Self {
            id: GoogleAccountId::new(),
            provider_issuer: None,
            provider_subject: None,
            alias,
            principal: None,
            state: GoogleAccountState::Pending,
            auth_generation: 0,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn bind_subject(
        &mut self,
        issuer: impl Into<String>,
        subject: impl Into<String>,
        principal: Option<String>,
    ) -> crate::Result<()> {
        let issuer = issuer.into();
        let subject = subject.into();
        if issuer.trim().is_empty() || subject.trim().is_empty() {
            return Err(JinError::Auth(
                "Google issuer and subject must be validated before activation".to_string(),
            ));
        }
        if let (Some(bound_issuer), Some(bound_subject)) =
            (&self.provider_issuer, &self.provider_subject)
        {
            if bound_issuer != &issuer || bound_subject != &subject {
                return Err(JinError::Auth(
                    "Google reauthentication returned a different account; credentials were not replaced"
                        .to_string(),
                ));
            }
        }
        self.provider_issuer = Some(issuer);
        self.provider_subject = Some(subject);
        self.principal = principal;
        self.state = GoogleAccountState::Connected;
        self.auth_generation = self.auth_generation.saturating_add(1);
        self.updated_at = Utc::now().fixed_offset();
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleCalendar {
    pub account_id: GoogleAccountId,
    pub calendar_id: String,
    pub name: String,
    #[serde(default)]
    pub primary: bool,
    pub access_role: GoogleAccessRole,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub available: bool,
    #[serde(default)]
    pub route_generation: u64,
    pub discovered_at: DateTime<FixedOffset>,
    pub refreshed_at: DateTime<FixedOffset>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GoogleRegistry {
    #[serde(default)]
    pub accounts: Vec<GoogleAccount>,
    #[serde(default)]
    pub calendars: Vec<GoogleCalendar>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredCalendar {
    pub calendar_id: String,
    pub name: String,
    pub primary: bool,
    pub access_role: GoogleAccessRole,
}

impl GoogleRegistry {
    pub fn validate(&self) -> crate::Result<()> {
        for (index, account) in self.accounts.iter().enumerate() {
            if self.accounts[..index]
                .iter()
                .any(|other| other.id == account.id)
            {
                return Err(JinError::Integrity(format!(
                    "duplicate Google account id {}",
                    account.id
                )));
            }
            if self.accounts[..index]
                .iter()
                .any(|other| other.alias.eq_ignore_ascii_case(&account.alias))
            {
                return Err(JinError::Integrity(format!(
                    "duplicate Google account alias {}",
                    account.alias
                )));
            }
            if let (Some(issuer), Some(subject)) =
                (&account.provider_issuer, &account.provider_subject)
            {
                if self.accounts[..index].iter().any(|other| {
                    other.provider_issuer.as_ref() == Some(issuer)
                        && other.provider_subject.as_ref() == Some(subject)
                }) {
                    return Err(JinError::Integrity(
                        "Google issuer/subject is already bound to another Jin account".to_string(),
                    ));
                }
            }
        }
        for calendar in &self.calendars {
            if !self.accounts.iter().any(|a| a.id == calendar.account_id) {
                return Err(JinError::Integrity(format!(
                    "calendar {} references unknown account {}",
                    calendar.calendar_id, calendar.account_id
                )));
            }
        }
        Ok(())
    }

    pub fn add_pending_account(
        &mut self,
        alias: impl Into<String>,
    ) -> crate::Result<GoogleAccountId> {
        let account = GoogleAccount::pending(alias)?;
        if self
            .accounts
            .iter()
            .any(|existing| existing.alias.eq_ignore_ascii_case(&account.alias))
        {
            return Err(JinError::Integrity(format!(
                "Google account alias '{}' is already in use",
                account.alias
            )));
        }
        let id = account.id.clone();
        self.accounts.push(account);
        Ok(id)
    }

    pub fn account(&self, id: &GoogleAccountId) -> crate::Result<&GoogleAccount> {
        self.accounts
            .iter()
            .find(|account| &account.id == id)
            .ok_or_else(|| JinError::Auth(format!("unknown Google account {id}")))
    }

    pub fn account_mut(&mut self, id: &GoogleAccountId) -> crate::Result<&mut GoogleAccount> {
        self.accounts
            .iter_mut()
            .find(|account| &account.id == id)
            .ok_or_else(|| JinError::Auth(format!("unknown Google account {id}")))
    }

    pub fn rename(&mut self, id: &GoogleAccountId, alias: impl Into<String>) -> crate::Result<()> {
        let alias = normalize_alias(alias.into())?;
        if self
            .accounts
            .iter()
            .any(|other| &other.id != id && other.alias.eq_ignore_ascii_case(&alias))
        {
            return Err(JinError::Integrity(format!(
                "Google account alias '{alias}' is already in use"
            )));
        }
        let account = self.account_mut(id)?;
        account.alias = alias;
        account.updated_at = Utc::now().fixed_offset();
        Ok(())
    }

    pub fn reconcile_calendars(
        &mut self,
        account_id: &GoogleAccountId,
        discovered: Vec<DiscoveredCalendar>,
    ) -> crate::Result<()> {
        self.account(account_id)?;
        let now = Utc::now().fixed_offset();
        let discovered_ids: std::collections::HashSet<String> = discovered
            .iter()
            .map(|calendar| calendar.calendar_id.clone())
            .collect();
        for existing in self.calendars.iter_mut().filter(|calendar| {
            &calendar.account_id == account_id && !discovered_ids.contains(&calendar.calendar_id)
        }) {
            if existing.available {
                existing.available = false;
                existing.route_generation = existing.route_generation.saturating_add(1);
            }
        }
        for item in discovered {
            if item.calendar_id.trim().is_empty() {
                return Err(JinError::Integrity(
                    "Google CalendarList entry has an empty id".to_string(),
                ));
            }
            if let Some(existing) = self.calendars.iter_mut().find(|calendar| {
                &calendar.account_id == account_id && calendar.calendar_id == item.calendar_id
            }) {
                let lost_write = existing.access_role.can_write() && !item.access_role.can_write();
                existing.name = item.name;
                existing.primary = item.primary;
                existing.access_role = item.access_role;
                existing.available = true;
                existing.refreshed_at = now;
                if lost_write {
                    existing.route_generation = existing.route_generation.saturating_add(1);
                }
            } else {
                self.calendars.push(GoogleCalendar {
                    account_id: account_id.clone(),
                    calendar_id: item.calendar_id,
                    name: item.name,
                    primary: item.primary,
                    access_role: item.access_role,
                    enabled: true,
                    available: true,
                    route_generation: 0,
                    discovered_at: now,
                    refreshed_at: now,
                });
            }
        }
        Ok(())
    }

    pub fn writable_destinations(&self) -> Vec<EventSyncTarget> {
        self.calendars
            .iter()
            .filter(|calendar| {
                calendar.enabled
                    && calendar.available
                    && calendar.access_role.can_write()
                    && self.accounts.iter().any(|account| {
                        account.id == calendar.account_id
                            && account.state == GoogleAccountState::Connected
                    })
            })
            .map(|calendar| EventSyncTarget {
                account_id: calendar.account_id.clone(),
                calendar_id: calendar.calendar_id.clone(),
            })
            .collect()
    }
}

fn normalize_alias(alias: String) -> crate::Result<String> {
    let alias = alias.trim().to_string();
    if alias.is_empty() {
        return Err(JinError::Integrity(
            "Google account alias cannot be empty".to_string(),
        ));
    }
    Ok(alias)
}
