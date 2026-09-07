//! Thin Tauri bridge for Jin's durable Notification Center.

use std::path::Path;

use chrono::{DateTime, Utc};
use jin_core::notification_center::{
    CompleteNotificationTaskRequest, NotificationCenter, NotificationCenterPage,
    NotificationCenterSummary, NotificationCommandError, NotificationItem, NotificationListRequest,
    RespondInvitationRequest, RetryInvitationRequest,
};
use serde::Deserialize;

use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
pub struct SetNotificationReadInput {
    pub item_id: String,
    pub read: bool,
    pub expected_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeferNotificationItemInput {
    pub item_id: String,
    pub visible_after: String,
    pub expected_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DismissNotificationItemInput {
    pub item_id: String,
    pub expected_version: u64,
}

fn open(root: &Path) -> Result<NotificationCenter, NotificationCommandError> {
    let config = jin_core::Config::load(root).map_err(NotificationCommandError::from_jin)?;
    NotificationCenter::open(&config.notification_center_path())
        .map_err(NotificationCommandError::from_jin)
}

pub fn list_notification_items_fn(
    root: &Path,
    input: NotificationListRequest,
    now: DateTime<Utc>,
) -> Result<NotificationCenterPage, NotificationCommandError> {
    open(root)?.list(&input, now)
}

pub fn get_notification_item_fn(
    root: &Path,
    item_id: String,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?
        .get_item(&item_id)
        .map_err(NotificationCommandError::from_jin)
}

pub fn notification_center_summary_fn(
    root: &Path,
    now: DateTime<Utc>,
) -> Result<NotificationCenterSummary, NotificationCommandError> {
    open(root)?
        .summary(now)
        .map_err(NotificationCommandError::from_jin)
}

pub fn set_notification_read_fn(
    root: &Path,
    input: SetNotificationReadInput,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?.set_read(&input.item_id, input.read, input.expected_version, now)
}

pub fn defer_notification_item_fn(
    root: &Path,
    input: DeferNotificationItemInput,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    let visible_after = DateTime::parse_from_rfc3339(&input.visible_after)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| {
            NotificationCommandError::from_jin(jin_core::JinError::InvalidInput(
                "ineligible: defer time must be an RFC 3339 instant".to_string(),
            ))
        })?;
    open(root)?.defer_item(&input.item_id, visible_after, input.expected_version, now)
}

pub fn dismiss_notification_item_fn(
    root: &Path,
    input: DismissNotificationItemInput,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?.dismiss_item(&input.item_id, input.expected_version, now)
}

pub fn respond_calendar_invitation_fn(
    root: &Path,
    input: RespondInvitationRequest,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?.respond_to_invitation(root, &input, now)
}

pub fn retry_calendar_invitation_fn(
    root: &Path,
    input: RetryInvitationRequest,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?.retry_invitation(root, &input, now)
}

pub fn complete_notification_task_fn(
    root: &Path,
    input: CompleteNotificationTaskRequest,
    now: DateTime<Utc>,
) -> Result<NotificationItem, NotificationCommandError> {
    open(root)?.complete_notification_task(root, &input, now)
}

#[tauri::command]
pub async fn list_notification_items(
    state: tauri::State<'_, AppState>,
    input: NotificationListRequest,
) -> Result<NotificationCenterPage, NotificationCommandError> {
    list_notification_items_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn get_notification_item(
    state: tauri::State<'_, AppState>,
    item_id: String,
) -> Result<NotificationItem, NotificationCommandError> {
    get_notification_item_fn(&state.root, item_id)
}

#[tauri::command]
pub async fn notification_center_summary(
    state: tauri::State<'_, AppState>,
) -> Result<NotificationCenterSummary, NotificationCommandError> {
    notification_center_summary_fn(&state.root, Utc::now())
}

#[tauri::command]
pub async fn set_notification_read(
    state: tauri::State<'_, AppState>,
    input: SetNotificationReadInput,
) -> Result<NotificationItem, NotificationCommandError> {
    set_notification_read_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn defer_notification_item(
    state: tauri::State<'_, AppState>,
    input: DeferNotificationItemInput,
) -> Result<NotificationItem, NotificationCommandError> {
    defer_notification_item_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn dismiss_notification_item(
    state: tauri::State<'_, AppState>,
    input: DismissNotificationItemInput,
) -> Result<NotificationItem, NotificationCommandError> {
    dismiss_notification_item_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn respond_calendar_invitation(
    state: tauri::State<'_, AppState>,
    input: RespondInvitationRequest,
) -> Result<NotificationItem, NotificationCommandError> {
    respond_calendar_invitation_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn retry_calendar_invitation(
    state: tauri::State<'_, AppState>,
    input: RetryInvitationRequest,
) -> Result<NotificationItem, NotificationCommandError> {
    retry_calendar_invitation_fn(&state.root, input, Utc::now())
}

#[tauri::command]
pub async fn complete_notification_task(
    state: tauri::State<'_, AppState>,
    input: CompleteNotificationTaskRequest,
) -> Result<NotificationItem, NotificationCommandError> {
    let result = complete_notification_task_fn(&state.root, input, Utc::now());
    if result.is_ok() {
        state.wake_reminders();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use jin_core::google::account::{
        DiscoveredCalendar, EventSyncTarget, GoogleAccessRole, GOOGLE_ISSUER,
    };
    use jin_core::google::mapping::google_to_jin;
    use jin_core::notification_center::{
        CalendarInvitationPayload, InvitationRecurrenceIdentity, InvitationRecurrenceScope,
        InvitationResponse, NotificationCapabilities, NotificationFilter, NotificationItem,
        NotificationPayload, NotificationSource, NotificationStatus, TaskReminderPayload,
        NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
    };
    use jin_core::sync::state::{
        self, ScopedEventSyncEntry, SyncDestination, MASTER_RECURRENCE_KEY,
    };
    use tempfile::TempDir;

    fn setup() -> (TempDir, DateTime<Utc>, NotificationItem) {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init(tmp.path()).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-09-03T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut center = NotificationCenter::open(&config.notification_center_path()).unwrap();
        let item = center
            .upsert_source(
                &NotificationSource {
                    source_key: "bridge-occurrence".to_string(),
                    source_revision: "revision-1".to_string(),
                    request_native_signal: true,
                    new_response_cycle: false,
                    payload: NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
                        schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                        occurrence_key: "bridge-occurrence".to_string(),
                        task_id: "task-1".to_string(),
                        title: "Bridge reminder".to_string(),
                        scheduled_at: now.to_rfc3339(),
                        list_name: Some("Inbox".to_string()),
                        project_name: None,
                        task_edit_token: None,
                        capabilities: NotificationCapabilities {
                            can_complete_task: true,
                            ..NotificationCapabilities::default()
                        },
                    })),
                },
                now,
            )
            .unwrap()
            .unwrap();
        (tmp, now, item)
    }

    #[test]
    fn bridge_registration_guard() {
        let source = include_str!("../lib.rs");
        for command in [
            "list_notification_items",
            "get_notification_item",
            "notification_center_summary",
            "set_notification_read",
            "defer_notification_item",
            "dismiss_notification_item",
            "respond_calendar_invitation",
            "retry_calendar_invitation",
            "complete_notification_task",
        ] {
            assert!(
                source.contains(command),
                "missing registered command {command}"
            );
        }
    }

    #[test]
    fn entire_series_command_snapshots_the_canonical_master_route() {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init(tmp.path()).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-09-03T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut config = jin_core::Config::load(tmp.path()).unwrap();
        config.token_backend = "file".to_string();
        let account_id = config.google_registry.add_pending_account("Work").unwrap();
        config
            .google_registry
            .account_mut(&account_id)
            .unwrap()
            .bind_subject(
                GOOGLE_ISSUER,
                "subject-work",
                Some("self@example.com".to_string()),
            )
            .unwrap();
        config
            .google_registry
            .reconcile_calendars(
                &account_id,
                vec![DiscoveredCalendar {
                    calendar_id: "primary".to_string(),
                    name: "Primary".to_string(),
                    primary: true,
                    access_role: GoogleAccessRole::Writer,
                }],
            )
            .unwrap();
        config.google_sync_schema_version = Some(jin_core::config::GOOGLE_SYNC_SCHEMA_VERSION);
        config.write_google_v2_guard().unwrap();
        config.save().unwrap();
        let target = EventSyncTarget::new(account_id, "primary").unwrap();
        let resource = serde_json::json!({
            "id": "google-instance", "iCalUID": "series@example.com", "etag": "etag-instance",
            "status": "confirmed", "summary": "Recurring review",
            "start": {"dateTime": "2099-09-03T10:00:00Z", "timeZone": "UTC"},
            "end": {"dateTime": "2099-09-03T11:00:00Z", "timeZone": "UTC"},
            "created": "2026-09-01T10:00:00Z", "updated": "2026-09-02T10:00:00Z",
            "recurringEventId": "google-master",
            "originalStartTime": {"dateTime": "2099-09-03T10:00:00Z", "timeZone": "UTC"},
            "organizer": {"email": "organizer@example.com", "self": false},
            "attendees": [{"email": "self@example.com", "self": true, "responseStatus": "needsAction"}]
        });
        let mut occurrence = jin_core::model::event::Event {
            frontmatter: google_to_jin(&resource, "jin-instance", &target.calendar_id).unwrap(),
            body: String::new(),
        };
        occurrence.frontmatter.master_id = Some("jin-master".to_string());
        let mut master = occurrence.clone();
        master.frontmatter.id = "jin-master".to_string();
        master.frontmatter.recurring_event_id = None;
        master.frontmatter.master_id = None;
        master.frontmatter.original_start = None;
        master.frontmatter.recurrence = vec!["RRULE:FREQ=WEEKLY".to_string()];
        jin_core::store::fs::write_event(&config.events_dir(), &occurrence).unwrap();
        jin_core::store::fs::write_event(&config.events_dir(), &master).unwrap();
        jin_core::google::route_ownership::write(&config.events_dir(), "jin-instance", &target)
            .unwrap();
        jin_core::google::route_ownership::write(&config.events_dir(), "jin-master", &target)
            .unwrap();
        let destination = SyncDestination::google(
            target.account_id.as_str().to_string(),
            target.calendar_id.clone(),
        );
        let sync = state::open_sync_db(&config.sync_dir()).unwrap();
        let account = config.google_registry.account(&target.account_id).unwrap();
        let calendar = config
            .google_registry
            .calendars
            .iter()
            .find(|calendar| {
                calendar.account_id == target.account_id
                    && calendar.calendar_id == target.calendar_id
            })
            .unwrap();
        state::ensure_destination(
            &sync,
            &destination,
            account.auth_generation,
            calendar.route_generation,
        )
        .unwrap();
        let recurrence_key = "2099-09-03T10:00:00@UTC";
        for (jin_id, google_id, recurrence, etag) in [
            (
                "jin-instance",
                "google-instance",
                recurrence_key,
                "etag-instance",
            ),
            (
                "jin-master",
                "google-master",
                MASTER_RECURRENCE_KEY,
                "etag-master",
            ),
        ] {
            state::upsert_scoped_entry(
                &sync,
                &ScopedEventSyncEntry {
                    destination: destination.clone(),
                    jin_id: jin_id.to_string(),
                    recurrence_key: recurrence.to_string(),
                    google_event_id: Some(google_id.to_string()),
                    ical_uid: Some("series@example.com".to_string()),
                    etag: Some(etag.to_string()),
                    google_updated: Some("2026-09-02T10:00:00Z".to_string()),
                    last_synced_at: Some(now.to_rfc3339()),
                },
            )
            .unwrap();
        }
        let mut center = NotificationCenter::open(&config.notification_center_path()).unwrap();
        let item = center
            .upsert_source(
                &NotificationSource {
                    source_key: "google/work/primary/google-instance/2099-09-03T10:00:00@UTC"
                        .to_string(),
                    source_revision: "etag-instance".to_string(),
                    request_native_signal: false,
                    new_response_cycle: false,
                    payload: NotificationPayload::CalendarInvitation(Box::new(
                        CalendarInvitationPayload {
                            schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                            account_id: target.account_id.to_string(),
                            account_alias: "Work".to_string(),
                            calendar_id: target.calendar_id.clone(),
                            calendar_name: "Primary".to_string(),
                            canonical_event_id: "jin-instance".to_string(),
                            google_event_id: "google-instance".to_string(),
                            recurrence: InvitationRecurrenceIdentity::Instance {
                                instance_google_event_id: "google-instance".to_string(),
                                recurring_event_id: "google-master".to_string(),
                                original_start: "2099-09-03T10:00:00".to_string(),
                                original_start_tzid: Some("UTC".to_string()),
                            },
                            title: "Recurring review".to_string(),
                            organizer_name: None,
                            organizer_email: Some("organizer@example.com".to_string()),
                            start: "2099-09-03T10:00:00".to_string(),
                            end: "2099-09-03T11:00:00".to_string(),
                            all_day: false,
                            timezone: Some("UTC".to_string()),
                            location: None,
                            self_email: "self@example.com".to_string(),
                            provider_response_status: "needsAction".to_string(),
                            etag: "etag-instance".to_string(),
                            provider_subject: "subject-work".to_string(),
                            auth_generation: account.auth_generation,
                            route_generation: calendar.route_generation,
                            capabilities: NotificationCapabilities {
                                can_respond: true,
                                recurrence_scopes: vec![
                                    InvitationRecurrenceScope::ThisOccurrence,
                                    InvitationRecurrenceScope::EntireSeries,
                                ],
                                ..Default::default()
                            },
                        },
                    )),
                },
                now,
            )
            .unwrap()
            .unwrap();
        drop(center);

        let queued = respond_calendar_invitation_fn(
            tmp.path(),
            RespondInvitationRequest {
                item_id: item.id.clone(),
                expected_item_version: item.version,
                operation_id: "tauri-entire-series".to_string(),
                response: InvitationResponse::Refuse,
                recurrence_scope: Some(InvitationRecurrenceScope::EntireSeries),
            },
            now,
        )
        .unwrap();
        assert_eq!(queued.status, NotificationStatus::ActionPending);
        let center = NotificationCenter::open(&config.notification_center_path()).unwrap();
        let attempt = center
            .action_attempt("tauri-entire-series")
            .unwrap()
            .unwrap();
        assert_eq!(attempt.canonical_event_id.as_deref(), Some("jin-master"));
        assert_eq!(attempt.google_event_id.as_deref(), Some("google-master"));
        assert_eq!(
            attempt.recurrence_key.as_deref(),
            Some(MASTER_RECURRENCE_KEY)
        );
        assert_eq!(attempt.base_etag.as_deref(), Some("etag-master"));
        let operation = state::get_outbox_operation(&sync, "tauri-entire-series")
            .unwrap()
            .unwrap();
        assert_eq!(operation.jin_id, "jin-master");
        assert_eq!(operation.google_event_id.as_deref(), Some("google-master"));
        assert_eq!(operation.base_etag.as_deref(), Some("etag-master"));
    }

    #[test]
    fn bridge_list_and_tagged_union_shape() {
        let (tmp, now, _) = setup();
        let page = list_notification_items_fn(
            tmp.path(),
            NotificationListRequest {
                filter: NotificationFilter::Reminders,
                include_deferred: false,
                include_terminal: false,
                cursor: None,
                limit: Some(50),
            },
            now,
        )
        .unwrap();
        let json = serde_json::to_value(&page.items[0]).unwrap();
        assert_eq!(json["kind"], "task_reminder");
        assert_eq!(json["status"], "active");
        assert_eq!(json["occurrence_key"], "bridge-occurrence");
        assert!(json.get("capabilities").is_some());
    }

    #[test]
    fn stale_version_returns_refreshed_item() {
        let (tmp, now, item) = setup();
        set_notification_read_fn(
            tmp.path(),
            SetNotificationReadInput {
                item_id: item.id.clone(),
                read: true,
                expected_version: item.version,
            },
            now,
        )
        .unwrap();
        let error = dismiss_notification_item_fn(
            tmp.path(),
            DismissNotificationItemInput {
                item_id: item.id,
                expected_version: item.version,
            },
            now,
        )
        .unwrap_err();
        assert_eq!(error.code, "stale_item");
        assert_eq!(error.item.unwrap().status, NotificationStatus::Active);
    }
}
