//! Stable multi-account Google Calendar presentation contracts.

use serde::{Deserialize, Serialize};

use crate::dto::EventSyncContextDto;
use crate::google::account::{GoogleAccount, GoogleAccountId, GoogleCalendar, GoogleRegistry};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleCalendarDto {
    pub account_id: String,
    pub calendar_id: String,
    pub name: String,
    pub primary: bool,
    pub access_role: String,
    pub writable: bool,
    pub enabled: bool,
    pub available: bool,
    pub route_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleAccountDto {
    pub id: String,
    pub alias: String,
    pub principal: Option<String>,
    pub state: String,
    pub auth_generation: u64,
    pub calendars: Vec<GoogleCalendarDto>,
}

impl GoogleCalendarDto {
    fn from_model(calendar: &GoogleCalendar) -> Self {
        Self {
            account_id: calendar.account_id.to_string(),
            calendar_id: calendar.calendar_id.clone(),
            name: calendar.name.clone(),
            primary: calendar.primary,
            access_role: serde_json::to_value(calendar.access_role)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "reader".to_string()),
            writable: calendar.access_role.can_write(),
            enabled: calendar.enabled,
            available: calendar.available,
            route_generation: calendar.route_generation,
        }
    }
}

impl GoogleAccountDto {
    fn from_model(account: &GoogleAccount, registry: &GoogleRegistry) -> Self {
        Self {
            id: account.id.to_string(),
            alias: account.alias.clone(),
            principal: account.principal.clone(),
            state: serde_json::to_value(account.state)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "pending".to_string()),
            auth_generation: account.auth_generation,
            calendars: registry
                .calendars
                .iter()
                .filter(|calendar| calendar.account_id == account.id)
                .map(GoogleCalendarDto::from_model)
                .collect(),
        }
    }

    pub fn list(registry: &GoogleRegistry) -> Vec<Self> {
        registry
            .accounts
            .iter()
            .map(|account| Self::from_model(account, registry))
            .collect()
    }
}

pub fn account_id(value: &str) -> crate::Result<GoogleAccountId> {
    GoogleAccountId::parse(value)
}

pub fn event_context(
    registry: &GoogleRegistry,
    account_id: &str,
    calendar_id: &str,
    state: impl Into<String>,
) -> Option<EventSyncContextDto> {
    let account = registry
        .accounts
        .iter()
        .find(|account| account.id.as_str() == account_id)?;
    let calendar = registry.calendars.iter().find(|calendar| {
        calendar.account_id.as_str() == account_id && calendar.calendar_id == calendar_id
    })?;
    Some(EventSyncContextDto {
        provider: crate::google::account::GOOGLE_PROVIDER.to_string(),
        account_id: account_id.to_string(),
        account_alias: account.alias.clone(),
        calendar_id: calendar_id.to_string(),
        calendar_name: calendar.name.clone(),
        access_role: serde_json::to_value(calendar.access_role)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| "reader".to_string()),
        writable: calendar.access_role.can_write() && calendar.enabled && calendar.available,
        state: state.into(),
    })
}
