use chrono::{DateTime, Duration, Utc};
use jin_core::notification_center::{
    redact_provider_error, ActionAttemptIntent, CalendarInvitationPayload,
    CompleteNotificationTaskRequest, InvitationRecurrenceIdentity, InvitationResponse,
    NativeDeliveryState, NotificationAction, NotificationCapabilities, NotificationCenter,
    NotificationFilter, NotificationListRequest, NotificationPayload, NotificationSource,
    NotificationSourceKind, NotificationStatus, TaskReminderPayload,
    NOTIFICATION_CENTER_SCHEMA_VERSION, NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
};
use tempfile::TempDir;

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn center() -> (TempDir, NotificationCenter) {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join(".jin/notification-center.sqlite");
    let center = NotificationCenter::open(&path).unwrap();
    (tmp, center)
}

fn task_source(key: &str, revision: &str, title: &str) -> NotificationSource {
    NotificationSource {
        source_key: key.to_string(),
        source_revision: revision.to_string(),
        request_native_signal: true,
        new_response_cycle: false,
        payload: NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
            schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
            occurrence_key: key.to_string(),
            task_id: format!("task-{key}"),
            title: title.to_string(),
            scheduled_at: "2026-09-03T10:00:00Z".to_string(),
            list_name: None,
            project_name: None,
            task_edit_token: None,
            capabilities: NotificationCapabilities {
                can_complete_task: true,
                ..NotificationCapabilities::default()
            },
        })),
    }
}

fn invitation_source(revision: &str, response_status: &str) -> NotificationSource {
    NotificationSource {
        source_key: "google/account-a/calendar-a/event-a/master".to_string(),
        source_revision: revision.to_string(),
        request_native_signal: true,
        new_response_cycle: false,
        payload: NotificationPayload::CalendarInvitation(Box::new(CalendarInvitationPayload {
            schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
            account_id: "account-a".to_string(),
            account_alias: "Personal".to_string(),
            calendar_id: "calendar-a".to_string(),
            calendar_name: "Primary".to_string(),
            canonical_event_id: "event-a".to_string(),
            google_event_id: "google-event-a".to_string(),
            recurrence: InvitationRecurrenceIdentity::Single,
            title: "Planning".to_string(),
            organizer_name: Some("Organizer".to_string()),
            organizer_email: Some("organizer@example.test".to_string()),
            start: "2099-09-03T10:00:00Z".to_string(),
            end: "2099-09-03T11:00:00Z".to_string(),
            all_day: false,
            timezone: Some("UTC".to_string()),
            location: Some("Room 1".to_string()),
            self_email: "self@example.test".to_string(),
            provider_response_status: response_status.to_string(),
            etag: revision.to_string(),
            provider_subject: "subject-a".to_string(),
            auth_generation: 1,
            route_generation: 1,
            capabilities: NotificationCapabilities {
                can_respond: response_status == "needsAction",
                ..NotificationCapabilities::default()
            },
        })),
    }
}

mod notification_center {
    use super::*;

    #[test]
    fn native_claims_are_independent_of_item_lifecycle_status() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let pending = center
            .upsert_source(&task_source("pending-native", "r1", "Pending"), now)
            .unwrap()
            .unwrap();
        center
            .prepare_action_attempt(
                &ActionAttemptIntent {
                    operation_id: "pending-native-operation".to_string(),
                    item_id: pending.id.clone(),
                    expected_item_version: pending.version,
                    requested_action: NotificationAction::CompleteTask,
                    recurrence_scope: None,
                    source_revision: pending.source_revision,
                    provider: None,
                    account_id: None,
                    calendar_id: None,
                    canonical_event_id: None,
                    google_event_id: None,
                    recurrence_key: None,
                    self_email: None,
                    provider_subject: None,
                    auth_generation: None,
                    route_generation: None,
                    base_etag: None,
                },
                now,
            )
            .unwrap();
        let terminal = center
            .upsert_source(&task_source("terminal-native", "r1", "Terminal"), now)
            .unwrap()
            .unwrap();
        center
            .dismiss_item(&terminal.id, terminal.version, now)
            .unwrap();

        let claimed = center.claim_native_deliveries(now, 10).unwrap();
        let ids = claimed
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&pending.id.as_str()));
        assert!(ids.contains(&terminal.id.as_str()));
    }

    #[test]
    fn page_and_summary_expose_persisted_partial_source_errors() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        center
            .record_source_error(
                NotificationSourceKind::CalendarInvitation,
                "google/account/calendar/broken",
                "canonical_event_invalid",
                "could not parse source",
                now,
            )
            .unwrap();
        let page = center
            .list(&NotificationListRequest::default(), now)
            .unwrap();
        assert_eq!(page.partial_errors.len(), 1);
        assert_eq!(
            page.partial_errors[0].source_key,
            "google/account/calendar/broken"
        );
        assert_eq!(page.partial_errors[0].code, "canonical_event_invalid");
        assert_eq!(center.summary(now).unwrap().partial_error_count, 1);
    }

    #[test]
    fn schema_migration_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        jin_core::ops::init(root).unwrap();
        let config = jin_core::Config::load(root).unwrap();
        let canonical = root.join("events/sentinel.md");
        std::fs::write(&canonical, "canonical-event").unwrap();

        let first = NotificationCenter::open(&config.notification_center_path()).unwrap();
        assert_eq!(
            first.schema_version().unwrap(),
            NOTIFICATION_CENTER_SCHEMA_VERSION
        );
        drop(first);
        let second = NotificationCenter::open(&config.notification_center_path()).unwrap();
        assert_eq!(
            second.schema_version().unwrap(),
            NOTIFICATION_CENTER_SCHEMA_VERSION
        );
        assert_eq!(
            std::fs::read_to_string(canonical).unwrap(),
            "canonical-event"
        );
    }

    #[test]
    fn concurrent_open_and_close_are_serialized_for_one_database_path() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".jin/notification-center.sqlite");
        let worker_count = 16;
        let iterations_per_worker = 16;
        let start = std::sync::Arc::new(std::sync::Barrier::new(worker_count));
        let workers = (0..worker_count)
            .map(|_| {
                let path = path.clone();
                let start = std::sync::Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..iterations_per_worker {
                        let center = NotificationCenter::open(&path).unwrap();
                        assert_eq!(
                            center.schema_version().unwrap(),
                            NOTIFICATION_CENTER_SCHEMA_VERSION
                        );
                    }
                })
            })
            .collect::<Vec<_>>();

        for worker in workers {
            worker.join().unwrap();
        }
    }

    #[test]
    fn open_waits_for_an_existing_sqlite_writer() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".jin/notification-center.sqlite");
        drop(NotificationCenter::open(&path).unwrap());

        let blocker = rusqlite::Connection::open(&path).unwrap();
        blocker
            .execute_batch(
                "BEGIN IMMEDIATE;
                 UPDATE notification_center_meta SET value=value WHERE key='schema_version';",
            )
            .unwrap();
        let started = std::sync::Arc::new(std::sync::Barrier::new(2));
        let thread_started = std::sync::Arc::clone(&started);
        let thread_path = path.clone();
        let opener = std::thread::spawn(move || {
            thread_started.wait();
            NotificationCenter::open(&thread_path)
        });
        started.wait();
        std::thread::sleep(std::time::Duration::from_millis(100));
        blocker.execute_batch("COMMIT;").unwrap();

        let opened = opener.join().unwrap().unwrap();
        assert_eq!(
            opened.schema_version().unwrap(),
            NOTIFICATION_CENTER_SCHEMA_VERSION
        );
    }

    #[test]
    fn future_schema_version_is_rejected_and_preserved() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".jin/notification-center.sqlite");
        drop(NotificationCenter::open(&path).unwrap());
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "UPDATE notification_center_meta SET value='2' WHERE key='schema_version'",
            [],
        )
        .unwrap();
        drop(conn);

        let error = NotificationCenter::open(&path).err().unwrap();
        assert!(error.to_string().contains("newer than supported"));
        let conn = rusqlite::Connection::open(&path).unwrap();
        let version: String = conn
            .query_row(
                "SELECT value FROM notification_center_meta WHERE key='schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "2");
    }

    #[test]
    fn contracts_serialize_closed_invitation_shape() {
        assert_eq!(InvitationResponse::Allow.provider_status(), "accepted");
        assert_eq!(InvitationResponse::Maybe.provider_status(), "tentative");
        assert_eq!(InvitationResponse::Refuse.provider_status(), "declined");

        let payload =
            NotificationPayload::CalendarInvitation(Box::new(CalendarInvitationPayload {
                schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                account_id: "account-a".to_string(),
                account_alias: "Personal".to_string(),
                calendar_id: "primary".to_string(),
                calendar_name: "Calendar".to_string(),
                canonical_event_id: "event-1".to_string(),
                google_event_id: "google-1".to_string(),
                recurrence: InvitationRecurrenceIdentity::Single,
                title: "Planning".to_string(),
                organizer_name: Some("Organizer".to_string()),
                organizer_email: Some("organizer@example.com".to_string()),
                start: "2026-09-03T10:00:00Z".to_string(),
                end: "2026-09-03T11:00:00Z".to_string(),
                all_day: false,
                timezone: Some("UTC".to_string()),
                location: None,
                self_email: "self@example.com".to_string(),
                provider_response_status: "needsAction".to_string(),
                etag: "etag-1".to_string(),
                provider_subject: "subject-1".to_string(),
                auth_generation: 2,
                route_generation: 3,
                capabilities: NotificationCapabilities {
                    can_respond: true,
                    ..NotificationCapabilities::default()
                },
            }));
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["kind"], "calendar_invitation");
        assert_eq!(json["schema_version"], NOTIFICATION_PAYLOAD_SCHEMA_VERSION);
        assert!(json.get("attendees").is_none());
    }

    #[test]
    fn source_upsert_is_idempotent() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let source = task_source("occurrence-1", "generation-1", "Review notes");

        let first = center.upsert_source(&source, now).unwrap().unwrap();
        let second = center.upsert_source(&source, now).unwrap().unwrap();
        assert_eq!(first.id, second.id);
        let page = center
            .list(&NotificationListRequest::default(), now)
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].source_key, "occurrence-1");
    }

    #[test]
    fn same_revision_only_advances_last_seen_without_cas_change() {
        let (tmp, mut center) = center();
        let first_at = at("2026-09-03T10:00:00Z");
        let later = first_at + Duration::minutes(5);
        let source = task_source("same-revision", "generation-1", "Original title");
        let first = center.upsert_source(&source, first_at).unwrap().unwrap();
        let observed = center
            .upsert_source(
                &task_source("same-revision", "generation-1", "Ignored mutation"),
                later,
            )
            .unwrap()
            .unwrap();
        assert_eq!(observed.version, first.version);
        assert_eq!(observed.updated_at, first.updated_at);
        let NotificationPayload::TaskReminder(payload) = observed.payload else {
            panic!("expected task reminder");
        };
        assert_eq!(payload.title, "Original title");
        drop(center);
        let conn =
            rusqlite::Connection::open(tmp.path().join(".jin/notification-center.sqlite")).unwrap();
        let last_seen: String = conn
            .query_row(
                "SELECT last_seen_at FROM notification_items WHERE source_key='same-revision'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(last_seen, later.to_rfc3339());
    }

    #[test]
    fn same_revision_refreshes_action_capabilities_without_display_only_cas_churn() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let source = invitation_source("etag-1", "needsAction");
        let first = center.upsert_source(&source, now).unwrap().unwrap();

        let mut display_only = source.clone();
        let NotificationPayload::CalendarInvitation(payload) = &mut display_only.payload else {
            unreachable!();
        };
        payload.title = "Metadata-only rename".to_string();
        payload.location = Some("Room 2".to_string());
        let unchanged = center
            .upsert_source(&display_only, now + Duration::minutes(1))
            .unwrap()
            .unwrap();
        assert_eq!(unchanged.version, first.version);
        assert_eq!(unchanged.updated_at, first.updated_at);

        let mut disconnected = source.clone();
        let NotificationPayload::CalendarInvitation(payload) = &mut disconnected.payload else {
            unreachable!();
        };
        payload.capabilities.can_respond = false;
        payload.capabilities.disabled_reason = Some("Reconnect account".to_string());
        let disconnected_item = center
            .upsert_source(&disconnected, now + Duration::minutes(2))
            .unwrap()
            .unwrap();
        assert_eq!(disconnected_item.version, first.version + 1);

        let reconnected_item = center
            .upsert_source(&source, now + Duration::minutes(3))
            .unwrap()
            .unwrap();
        assert_eq!(reconnected_item.version, disconnected_item.version + 1);

        let mut reader_role = source.clone();
        let NotificationPayload::CalendarInvitation(payload) = &mut reader_role.payload else {
            unreachable!();
        };
        payload.capabilities.can_respond = false;
        payload.capabilities.disabled_reason = Some("Calendar is read-only".to_string());
        let reader_item = center
            .upsert_source(&reader_role, now + Duration::minutes(4))
            .unwrap()
            .unwrap();
        assert_eq!(reader_item.version, reconnected_item.version + 1);

        let mut regenerated = reader_role.clone();
        let NotificationPayload::CalendarInvitation(payload) = &mut regenerated.payload else {
            unreachable!();
        };
        payload.auth_generation += 1;
        let auth_item = center
            .upsert_source(&regenerated, now + Duration::minutes(5))
            .unwrap()
            .unwrap();
        assert_eq!(auth_item.version, reader_item.version + 1);

        let NotificationPayload::CalendarInvitation(payload) = &mut regenerated.payload else {
            unreachable!();
        };
        payload.route_generation += 1;
        let route_item = center
            .upsert_source(&regenerated, now + Duration::minutes(6))
            .unwrap()
            .unwrap();
        assert_eq!(route_item.version, auth_item.version + 1);
        let NotificationPayload::CalendarInvitation(payload) = route_item.payload else {
            panic!("expected invitation");
        };
        assert_eq!(payload.auth_generation, 2);
        assert_eq!(payload.route_generation, 2);
        assert!(!payload.capabilities.can_respond);
    }

    #[test]
    fn future_payload_version_is_rejected_without_downgrade() {
        let (tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let source = task_source("future-payload", "generation-1", "Future");
        center.upsert_source(&source, now).unwrap();
        drop(center);
        let path = tmp.path().join(".jin/notification-center.sqlite");
        let conn = rusqlite::Connection::open(&path).unwrap();
        let raw: String = conn
            .query_row(
                "SELECT kind_payload_json FROM notification_items WHERE source_key='future-payload'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        json["schema_version"] = serde_json::json!(2);
        let future = serde_json::to_string(&json).unwrap();
        conn.execute(
            "UPDATE notification_items SET kind_payload_json=?1 WHERE source_key='future-payload'",
            [&future],
        )
        .unwrap();
        drop(conn);

        let mut center = NotificationCenter::open(&path).unwrap();
        let error = center.upsert_source(&source, now).unwrap_err();
        assert!(error.to_string().contains("unsupported stored"));
        drop(center);
        let conn = rusqlite::Connection::open(path).unwrap();
        let preserved: String = conn
            .query_row(
                "SELECT kind_payload_json FROM notification_items WHERE source_key='future-payload'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&preserved).unwrap()["schema_version"],
            2
        );
    }

    #[test]
    fn future_payload_is_preserved_and_projected_disabled_without_breaking_the_page() {
        let (tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let future_source = task_source("future-page", "generation-1", "Future reminder");
        let future_item = center.upsert_source(&future_source, now).unwrap().unwrap();
        center
            .upsert_source(
                &task_source("current-page", "generation-1", "Current reminder"),
                now,
            )
            .unwrap();
        drop(center);

        let path = tmp.path().join(".jin/notification-center.sqlite");
        let conn = rusqlite::Connection::open(&path).unwrap();
        let raw: String = conn
            .query_row(
                "SELECT kind_payload_json FROM notification_items WHERE source_key='future-page'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        json["schema_version"] = serde_json::json!(9);
        json["future_only_field"] = serde_json::json!({"opaque": true});
        let future = serde_json::to_string(&json).unwrap();
        conn.execute(
            "UPDATE notification_items SET kind_payload_json=?1 WHERE source_key='future-page'",
            [&future],
        )
        .unwrap();
        drop(conn);

        let mut center = NotificationCenter::open(&path).unwrap();
        let page = center
            .list(&NotificationListRequest::default(), now)
            .unwrap();
        assert_eq!(page.items.len(), 2);
        let projected = page
            .items
            .iter()
            .find(|item| item.id == future_item.id)
            .unwrap();
        let NotificationPayload::TaskReminder(payload) = &projected.payload else {
            panic!("expected task projection");
        };
        assert_eq!(payload.schema_version, 9);
        assert!(!payload.capabilities.can_mark_read);
        assert!(!payload.capabilities.can_defer);
        assert!(!payload.capabilities.can_dismiss);
        assert!(payload.capabilities.disabled_reason.is_some());
        let error = center
            .set_read(&projected.id, true, projected.version, now)
            .unwrap_err();
        assert_eq!(error.code, "ineligible");

        drop(center);
        let conn = rusqlite::Connection::open(path).unwrap();
        let preserved: String = conn
            .query_row(
                "SELECT kind_payload_json FROM notification_items WHERE source_key='future-page'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, future);
    }

    #[test]
    fn revision_refresh_preserves_curation() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let first = center
            .upsert_source(&task_source("occurrence-2", "generation-1", "Old"), now)
            .unwrap()
            .unwrap();
        let read = center
            .set_read(&first.id, true, first.version, now)
            .unwrap();
        let deferred = center
            .defer_item(&read.id, now + Duration::hours(2), read.version, now)
            .unwrap();
        let dismissed = center
            .dismiss_item(&deferred.id, deferred.version, now)
            .unwrap();

        let refreshed = center
            .upsert_source(
                &task_source("occurrence-2", "generation-2", "New"),
                now + Duration::minutes(1),
            )
            .unwrap()
            .unwrap();
        assert_eq!(refreshed.status, NotificationStatus::Dismissed);
        assert_eq!(refreshed.read_at, dismissed.read_at);
        assert_eq!(refreshed.visible_after, dismissed.visible_after);
        let NotificationPayload::TaskReminder(payload) = refreshed.payload else {
            panic!("expected task reminder");
        };
        assert_eq!(payload.title, "New");
    }

    #[test]
    fn optimistic_version_rejects_stale_write() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-3", "generation-1", "Task"), now)
            .unwrap()
            .unwrap();
        center.set_read(&item.id, true, item.version, now).unwrap();
        let error = center
            .dismiss_item(&item.id, item.version, now)
            .unwrap_err();
        assert_eq!(error.code, "stale_item");
        assert!(error.item.is_some());
        assert_eq!(
            error.item.unwrap().status,
            NotificationStatus::Active,
            "stale writes must not mutate the item"
        );
    }

    #[test]
    fn missing_or_ineligible_source_obsoletes() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-4", "generation-1", "Task"), now)
            .unwrap()
            .unwrap();
        let obsolete = center
            .mark_source_obsolete(
                NotificationSourceKind::TaskReminder,
                "occurrence-4",
                "task_completed",
                now,
            )
            .unwrap()
            .unwrap();
        assert_eq!(obsolete.id, item.id);
        assert_eq!(obsolete.status, NotificationStatus::Obsolete);
        assert_eq!(obsolete.source_reason.as_deref(), Some("task_completed"));
    }

    #[test]
    fn terminal_retention_is_source_safe() {
        let (tmp, mut center) = center();
        let old = at("2026-07-01T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-5", "generation-1", "Task"), old)
            .unwrap()
            .unwrap();
        center.dismiss_item(&item.id, item.version, old).unwrap();
        let canonical = tmp.path().join("task.md");
        std::fs::write(&canonical, "canonical").unwrap();

        assert_eq!(center.prune(at("2026-09-03T10:00:00Z")).unwrap(), 1);
        assert!(center.get_item(&item.id).is_err());
        assert_eq!(std::fs::read_to_string(canonical).unwrap(), "canonical");
    }

    #[test]
    fn deferred_item_is_hidden() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-6", "generation-1", "Task"), now)
            .unwrap()
            .unwrap();
        center
            .defer_item(&item.id, now + Duration::hours(1), item.version, now)
            .unwrap();
        assert!(center
            .list(&NotificationListRequest::default(), now)
            .unwrap()
            .items
            .is_empty());
        assert_eq!(center.summary(now).unwrap().visible_unread, 0);
    }

    #[test]
    fn deferred_item_wakes_unread() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-7", "generation-1", "Task"), now)
            .unwrap()
            .unwrap();
        let read = center.set_read(&item.id, true, item.version, now).unwrap();
        center
            .defer_item(&read.id, now + Duration::hours(1), read.version, now)
            .unwrap();
        let page = center
            .list(
                &NotificationListRequest::default(),
                now + Duration::hours(1),
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert!(page.items[0].read_at.is_none());
        assert!(page.items[0].visible_after.is_none());
    }

    #[test]
    fn corrupt_database_recovery_is_source_safe() {
        let tmp = TempDir::new().unwrap();
        let center_path = tmp.path().join(".jin/notification-center.sqlite");
        std::fs::create_dir_all(center_path.parent().unwrap()).unwrap();
        std::fs::write(&center_path, b"not a sqlite database").unwrap();
        let canonical = tmp.path().join("event.md");
        std::fs::write(&canonical, "canonical").unwrap();

        assert!(NotificationCenter::open(&center_path).is_err());
        assert_eq!(std::fs::read_to_string(canonical).unwrap(), "canonical");
    }

    #[test]
    fn pagination_snapshot_is_stable() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        for key in ["page-a", "page-b"] {
            center
                .upsert_source(&task_source(key, "generation-1", key), now)
                .unwrap();
        }
        let request = NotificationListRequest {
            limit: Some(1),
            ..NotificationListRequest::default()
        };
        let first = center.list(&request, now + Duration::minutes(1)).unwrap();
        center
            .upsert_source(
                &task_source("page-c", "generation-1", "page-c"),
                now + Duration::minutes(2),
            )
            .unwrap();
        let second = center
            .list(
                &NotificationListRequest {
                    cursor: first.next_cursor.clone(),
                    ..request
                },
                now + Duration::minutes(3),
            )
            .unwrap();
        let ids = first
            .items
            .iter()
            .chain(second.items.iter())
            .map(|item| item.source_key.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), 2);
        assert!(!ids.contains("page-c"));
    }

    #[test]
    fn error_and_log_redaction() {
        let raw =
            r#"provider body {"access_token":"secret","attendees":[{"email":"a@example.com"}]}"#;
        let redacted = redact_provider_error(raw);
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("a@example.com"));
        assert!(!redacted.contains("attendees"));
    }

    #[test]
    fn nonterminal_attempt_blocks_prune() {
        let (_tmp, mut center) = center();
        let old = at("2026-07-01T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-8", "generation-1", "Task"), old)
            .unwrap()
            .unwrap();
        center
            .prepare_action_attempt(
                &ActionAttemptIntent {
                    operation_id: "complete-occurrence-8".to_string(),
                    item_id: item.id.clone(),
                    expected_item_version: item.version,
                    requested_action: NotificationAction::CompleteTask,
                    recurrence_scope: None,
                    source_revision: item.source_revision.clone(),
                    provider: None,
                    account_id: None,
                    calendar_id: None,
                    canonical_event_id: None,
                    google_event_id: None,
                    recurrence_key: None,
                    self_email: None,
                    provider_subject: None,
                    auth_generation: None,
                    route_generation: None,
                    base_etag: None,
                },
                old,
            )
            .unwrap();
        center
            .mark_source_obsolete(
                NotificationSourceKind::TaskReminder,
                "occurrence-8",
                "task_deleted",
                old,
            )
            .unwrap();

        assert_eq!(center.prune(at("2026-09-03T10:00:00Z")).unwrap(), 0);
        assert_eq!(
            center.get_item(&item.id).unwrap().status,
            NotificationStatus::Obsolete
        );
    }

    #[test]
    fn completed_attempt_is_audited_while_terminal_item_prunes_at_30_days() {
        let (_tmp, mut center) = center();
        let old = at("2026-07-01T10:00:00Z");
        let item = center
            .upsert_source(&task_source("completed-audit", "generation-1", "Task"), old)
            .unwrap()
            .unwrap();
        center
            .prepare_action_attempt(
                &ActionAttemptIntent {
                    operation_id: "complete-audit".to_string(),
                    item_id: item.id.clone(),
                    expected_item_version: item.version,
                    requested_action: NotificationAction::CompleteTask,
                    recurrence_scope: None,
                    source_revision: item.source_revision.clone(),
                    provider: None,
                    account_id: None,
                    calendar_id: None,
                    canonical_event_id: None,
                    google_event_id: None,
                    recurrence_key: Some("completed-audit".to_string()),
                    self_email: None,
                    provider_subject: None,
                    auth_generation: None,
                    route_generation: None,
                    base_etag: None,
                },
                old,
            )
            .unwrap();
        center
            .finish_attempt_succeeded("complete-audit", old)
            .unwrap();

        assert_eq!(center.prune(old + Duration::days(31)).unwrap(), 1);
        assert!(center.get_item(&item.id).is_err());
        assert!(center.action_attempt("complete-audit").unwrap().is_some());
        assert_eq!(center.prune(old + Duration::days(91)).unwrap(), 0);
        assert!(center.action_attempt("complete-audit").unwrap().is_none());
    }

    #[test]
    fn tombstone_prevents_historical_recreation() {
        let (_tmp, mut center) = center();
        let old = at("2026-07-01T10:00:00Z");
        let source = task_source("occurrence-9", "generation-1", "Task");
        let item = center.upsert_source(&source, old).unwrap().unwrap();
        center.dismiss_item(&item.id, item.version, old).unwrap();
        let now = at("2026-09-03T10:00:00Z");
        assert_eq!(center.prune(now).unwrap(), 1);
        assert!(center.upsert_source(&source, now).unwrap().is_none());
    }

    #[test]
    fn invitation_tombstone_ignores_newer_metadata_etag_until_a_new_response_cycle() {
        let (_tmp, mut center) = center();
        let old = at("2026-07-01T10:00:00Z");
        let initial = invitation_source("etag-1", "needsAction");
        let item = center.upsert_source(&initial, old).unwrap().unwrap();
        center.dismiss_item(&item.id, item.version, old).unwrap();
        let now = at("2026-09-03T10:00:00Z");
        assert_eq!(center.prune(now).unwrap(), 1);

        let mut metadata_only = invitation_source("etag-2", "needsAction");
        let NotificationPayload::CalendarInvitation(payload) = &mut metadata_only.payload else {
            unreachable!();
        };
        payload.title = "Organizer renamed this".to_string();
        payload.location = Some("Room 99".to_string());
        assert!(center.upsert_source(&metadata_only, now).unwrap().is_none());

        let answered = invitation_source("etag-3", "accepted");
        assert!(center.upsert_source(&answered, now).unwrap().is_none());
        let new_cycle = invitation_source("etag-4", "needsAction");
        let recreated = center.upsert_source(&new_cycle, now).unwrap().unwrap();
        assert_eq!(recreated.status, NotificationStatus::Active);
        assert_eq!(recreated.version, 1);
    }

    #[test]
    fn list_filters_are_closed() {
        let (_tmp, mut center) = center();
        let now = at("2026-09-03T10:00:00Z");
        let item = center
            .upsert_source(&task_source("occurrence-10", "generation-1", "Task"), now)
            .unwrap()
            .unwrap();
        assert_eq!(item.native_state, NativeDeliveryState::Pending);
        let page = center
            .list(
                &NotificationListRequest {
                    filter: NotificationFilter::Reminders,
                    ..NotificationListRequest::default()
                },
                now,
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
    }

    #[test]
    fn complete_task_orders_source_before_item() {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init(tmp.path()).unwrap();
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let task = jin_core::ops::tasks::create_task(
            &config.tasks_dir(),
            jin_core::ops::tasks::CreateTaskParams {
                title: "Finish review".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        let claim = jin_core::reminders::ReminderClaim {
            occurrence_key: "complete-task-occurrence".to_string(),
            task_id: task.id().to_string(),
            task_title: task.title().to_string(),
            fire_at: at("2026-09-03T10:00:00Z"),
            attempt: 1,
            claim_generation: 1,
        };
        let mut center = NotificationCenter::open(&config.notification_center_path()).unwrap();
        let item = center
            .upsert_task_reminder(tmp.path(), &claim, claim.fire_at)
            .unwrap();

        let acted = center
            .complete_notification_task(
                tmp.path(),
                &CompleteNotificationTaskRequest {
                    item_id: item.id.clone(),
                    expected_item_version: item.version,
                    operation_id: "complete-from-center".to_string(),
                },
                claim.fire_at,
            )
            .unwrap();
        assert_eq!(acted.status, NotificationStatus::Acted);
        assert_eq!(
            jin_core::ops::tasks::get_task(&config.tasks_dir(), task.id())
                .unwrap()
                .frontmatter
                .status,
            jin_core::model::task::TaskStatus::Done
        );
    }

    #[test]
    fn task_resolution_obsoletes_reminders() {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init(tmp.path()).unwrap();
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let task = jin_core::ops::tasks::create_task(
            &config.tasks_dir(),
            jin_core::ops::tasks::CreateTaskParams {
                title: "Resolve elsewhere".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        let claim = jin_core::reminders::ReminderClaim {
            occurrence_key: "external-task-resolution".to_string(),
            task_id: task.id().to_string(),
            task_title: task.title().to_string(),
            fire_at: at("2026-09-03T10:00:00Z"),
            attempt: 1,
            claim_generation: 1,
        };
        let mut center = NotificationCenter::open(&config.notification_center_path()).unwrap();
        let item = center
            .upsert_task_reminder(tmp.path(), &claim, claim.fire_at)
            .unwrap();
        jin_core::ops::tasks::transition_task(
            &config.tasks_dir(),
            task.id(),
            jin_core::model::task::TaskStatus::Done,
        )
        .unwrap();

        assert_eq!(
            jin_core::notification_center::reconcile_task_reminders(tmp.path(), claim.fire_at)
                .unwrap(),
            1
        );
        assert_eq!(
            center.get_item(&item.id).unwrap().status,
            NotificationStatus::Obsolete
        );
    }
}
