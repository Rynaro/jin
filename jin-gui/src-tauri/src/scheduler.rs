//! GUI-only reminder polling and native notification delivery.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Utc};
use jin_core::reminders::ReminderEngine;
use tauri::{AppHandle, Runtime};
use tokio::sync::Notify;

use crate::notifications::{NativeNotificationTransport, NotificationTransport};

const POLL_INTERVAL: StdDuration = StdDuration::from_secs(30);

/// Start the scheduler on Tauri's async runtime. It reconciles immediately,
/// every 30 seconds, and whenever a task mutation wakes it.
pub fn spawn<R: Runtime>(app: AppHandle<R>, root: PathBuf, wake: Arc<Notify>) {
    tauri::async_runtime::spawn(async move {
        run_blocking_once(app.clone(), root.clone()).await;
        loop {
            tokio::select! {
                _ = tokio::time::sleep(POLL_INTERVAL) => {},
                _ = wake.notified() => {},
            }
            run_blocking_once(app.clone(), root.clone()).await;
        }
    });
}

async fn run_blocking_once<R: Runtime>(app: AppHandle<R>, root: PathBuf) {
    let result = tokio::task::spawn_blocking(move || {
        let sink = NativeNotificationTransport::new(app);
        process_once_at(&root, &sink, Utc::now())
    })
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("Jin reminder scheduler: {error}"),
        Err(error) => eprintln!("Jin reminder scheduler worker failed: {error}"),
    }
}

/// One testable reconciliation/delivery pass. Delivery failures are persisted
/// for bounded retry and never escape as application-fatal errors.
pub(crate) fn process_once_at(
    root: &Path,
    sink: &dyn NotificationTransport,
    now: DateTime<Utc>,
) -> jin_core::Result<()> {
    let cfg = jin_core::Config::load(root)?;
    let mut center =
        jin_core::notification_center::NotificationCenter::open(&cfg.notification_center_path())?;
    center.recover_invitation_sagas(root, now)?;
    drop(center);
    jin_core::notification_center::reconcile_calendar_invitations(root, now)?;
    let mut engine = ReminderEngine::open(root)?;
    jin_core::notification_center::reconcile_task_reminders(root, now)?;
    let claims = engine.reconcile_and_claim(&cfg.tasks_dir(), now)?;
    for claim in claims {
        let mut center = jin_core::notification_center::NotificationCenter::open(
            &cfg.notification_center_path(),
        )?;
        match center.upsert_task_reminder(root, &claim, now) {
            Ok(item) => item,
            Err(error) => {
                engine.mark_delivery_failed(
                    &claim.occurrence_key,
                    claim.claim_generation,
                    now,
                    &error.to_string(),
                )?;
                eprintln!(
                    "Jin reminder center insertion failed for task {} (attempt {}): {}",
                    claim.task_id, claim.attempt, error
                );
                continue;
            }
        };
        // Durable center insertion is the reminder's delivery truth. Native
        // notification submission is an independent best-effort signal.
        engine.mark_delivered(&claim.occurrence_key, claim.claim_generation, now)?;
        drop(center);
    }
    let mut center =
        jin_core::notification_center::NotificationCenter::open(&cfg.notification_center_path())?;
    drain_native_deliveries(&mut center, sink, now)?;
    Ok(())
}

fn drain_native_deliveries(
    center: &mut jin_core::notification_center::NotificationCenter,
    sink: &dyn NotificationTransport,
    now: DateTime<Utc>,
) -> jin_core::Result<()> {
    for item in center.claim_native_deliveries(now, 100)? {
        let body = match &item.payload {
            jin_core::notification_center::NotificationPayload::CalendarInvitation(payload) => {
                format!("Calendar invitation: {}", payload.title)
            }
            jin_core::notification_center::NotificationPayload::TaskReminder(payload) => {
                payload.title.clone()
            }
        };
        match sink.submit("Jin", &body) {
            Ok(()) => {
                center.mark_native_submitted(&item.id, now)?;
            }
            Err(error) => {
                let lowercase = error.to_ascii_lowercase();
                let permission_denied = lowercase.contains("permission")
                    || lowercase.contains("denied")
                    || lowercase.contains("unavailable");
                center.mark_native_failed(&item.id, &error, permission_denied, now)?;
                eprintln!(
                    "Jin native notification submission failed for item {}",
                    item.id
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::{Duration, TimeZone};
    use jin_core::model::task::Reminder;
    use jin_core::ops::tasks::{self, CreateTaskParams, EditTaskParams};
    use jin_core::reminders::OccurrenceState;
    use tempfile::TempDir;

    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        delivered: Mutex<Vec<String>>,
        attempts: Mutex<u32>,
        failure: Option<&'static str>,
    }

    impl NotificationTransport for RecordingSink {
        fn submit(&self, _title: &str, body: &str) -> std::result::Result<(), String> {
            *self.attempts.lock().unwrap() += 1;
            if let Some(error) = self.failure {
                return Err(error.to_string());
            }
            self.delivered.lock().unwrap().push(body.to_string());
            Ok(())
        }
    }

    fn setup() -> (TempDir, DateTime<Utc>) {
        let tmp = TempDir::new().unwrap();
        jin_core::ops::init::init(tmp.path()).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 9, 2, 12, 0, 0).unwrap();
        // Establish the first-launch baseline before adding a due occurrence.
        process_once_at(
            tmp.path(),
            &RecordingSink::default(),
            now - Duration::minutes(1),
        )
        .unwrap();
        (tmp, now)
    }

    fn create_due_now(root: &Path, now: DateTime<Utc>) {
        let cfg = jin_core::Config::load(root).unwrap();
        tasks::create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Native reminder".to_string(),
                reminders: Some(vec![Reminder {
                    kind: "absolute".to_string(),
                    value: now.to_rfc3339(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn successful_sink_receives_task_title_once() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let sink = RecordingSink::default();
        process_once_at(tmp.path(), &sink, now).unwrap();
        process_once_at(tmp.path(), &sink, now).unwrap();
        assert_eq!(
            sink.delivered.lock().unwrap().as_slice(),
            ["Native reminder"]
        );
    }

    #[test]
    fn native_failure_preserves_center_item() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let denied = RecordingSink {
            delivered: Mutex::new(vec![]),
            attempts: Mutex::new(0),
            failure: Some("permission denied"),
        };
        process_once_at(tmp.path(), &denied, now).unwrap();
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut center = jin_core::notification_center::NotificationCenter::open(
            &config.notification_center_path(),
        )
        .unwrap();
        let page = center
            .list(
                &jin_core::notification_center::NotificationListRequest::default(),
                now,
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            page.items[0].native_state,
            jin_core::notification_center::NativeDeliveryState::Suppressed
        );
        assert_eq!(
            page.items[0].status,
            jin_core::notification_center::NotificationStatus::Active
        );
    }

    #[test]
    fn center_insert_precedes_reminder_delivered() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let center_path = config.notification_center_path();
        if center_path.exists() {
            std::fs::remove_file(&center_path).unwrap();
        }
        std::fs::create_dir(&center_path).unwrap();

        assert!(process_once_at(tmp.path(), &RecordingSink::default(), now).is_err());
        let mut engine = ReminderEngine::open(tmp.path()).unwrap();
        let claims = engine
            .reconcile_and_claim(&config.tasks_dir(), now + Duration::minutes(2))
            .unwrap();
        assert_eq!(
            claims.len(),
            1,
            "failed center insertion must remain claimable"
        );
        assert_eq!(
            engine.occurrence_state(&claims[0].occurrence_key).unwrap(),
            Some(OccurrenceState::Claimed)
        );
    }

    #[test]
    fn reminder_crash_reentry_is_idempotent() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut engine = ReminderEngine::open(tmp.path()).unwrap();
        let first_claim = engine
            .reconcile_and_claim(&config.tasks_dir(), now)
            .unwrap()
            .pop()
            .unwrap();
        let mut center = jin_core::notification_center::NotificationCenter::open(
            &config.notification_center_path(),
        )
        .unwrap();
        let first_item = center
            .upsert_task_reminder(tmp.path(), &first_claim, now)
            .unwrap();
        // Simulate a crash before reminder acknowledgement; the expired lease
        // is reclaimed with a new generation and the center upsert converges.
        let second_claim = engine
            .reconcile_and_claim(&config.tasks_dir(), now + Duration::minutes(2))
            .unwrap()
            .pop()
            .unwrap();
        let second_item = center
            .upsert_task_reminder(tmp.path(), &second_claim, now + Duration::minutes(2))
            .unwrap();
        assert_eq!(first_item.id, second_item.id);
        assert!(engine
            .mark_delivered(
                &second_claim.occurrence_key,
                second_claim.claim_generation,
                now + Duration::minutes(2),
            )
            .unwrap());
        assert_eq!(
            center
                .list(
                    &jin_core::notification_center::NotificationListRequest::default(),
                    now + Duration::minutes(2),
                )
                .unwrap()
                .items
                .len(),
            1
        );
    }

    #[test]
    fn delivery_truth_is_center_durability() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let denied = RecordingSink {
            delivered: Mutex::new(vec![]),
            attempts: Mutex::new(0),
            failure: Some("permission denied"),
        };
        process_once_at(tmp.path(), &denied, now).unwrap();
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut engine = ReminderEngine::open(tmp.path()).unwrap();
        assert!(engine
            .reconcile_and_claim(&config.tasks_dir(), now + Duration::hours(1))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn editing_reminders_would_be_seen_on_mutation_wake_pass() {
        let (tmp, now) = setup();
        let cfg = jin_core::Config::load(tmp.path()).unwrap();
        let task = tasks::create_task(
            &cfg.tasks_dir(),
            CreateTaskParams {
                title: "Edited reminder".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        tasks::edit_task(
            &cfg.tasks_dir(),
            task.id(),
            EditTaskParams {
                reminders: Some(vec![Reminder {
                    kind: "absolute".to_string(),
                    value: now.to_rfc3339(),
                }]),
                ..Default::default()
            },
        )
        .unwrap();
        let sink = RecordingSink::default();
        process_once_at(tmp.path(), &sink, now).unwrap();
        assert_eq!(sink.delivered.lock().unwrap().len(), 1);
    }

    #[test]
    fn invitation_native_pending_is_drained() {
        let (tmp, now) = setup();
        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut center = jin_core::notification_center::NotificationCenter::open(
            &config.notification_center_path(),
        )
        .unwrap();
        let item = center
            .upsert_source(
                &jin_core::notification_center::NotificationSource {
                    source_key: "google/account/calendar/event/master".to_string(),
                    source_revision: "etag-1".to_string(),
                    request_native_signal: true,
                    new_response_cycle: false,
                    payload: jin_core::notification_center::NotificationPayload::CalendarInvitation(
                        Box::new(jin_core::notification_center::CalendarInvitationPayload {
                            schema_version:
                                jin_core::notification_center::NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
                            account_id: "account".to_string(),
                            account_alias: "Personal".to_string(),
                            calendar_id: "calendar".to_string(),
                            calendar_name: "Calendar".to_string(),
                            canonical_event_id: "event".to_string(),
                            google_event_id: "google-event".to_string(),
                            recurrence:
                                jin_core::notification_center::InvitationRecurrenceIdentity::Single,
                            title: "Review invitation".to_string(),
                            organizer_name: Some("Organizer".to_string()),
                            organizer_email: None,
                            start: "2099-09-03T10:00:00Z".to_string(),
                            end: "2099-09-03T11:00:00Z".to_string(),
                            all_day: false,
                            timezone: Some("UTC".to_string()),
                            location: None,
                            self_email: "self@example.com".to_string(),
                            provider_response_status: "needsAction".to_string(),
                            etag: "etag-1".to_string(),
                            provider_subject: "subject".to_string(),
                            auth_generation: 1,
                            route_generation: 1,
                            capabilities: jin_core::notification_center::NotificationCapabilities {
                                can_respond: true,
                                ..Default::default()
                            },
                        }),
                    ),
                },
                now,
            )
            .unwrap()
            .unwrap();
        let sink = RecordingSink::default();
        drain_native_deliveries(&mut center, &sink, now).unwrap();
        assert_eq!(
            sink.delivered.lock().unwrap().as_slice(),
            ["Calendar invitation: Review invitation"]
        );
        assert_eq!(
            center.get_item(&item.id).unwrap().native_state,
            jin_core::notification_center::NativeDeliveryState::Submitted
        );
    }

    #[test]
    fn transient_native_failure_retries_with_backoff_and_stops_at_ceiling() {
        let (tmp, now) = setup();
        create_due_now(tmp.path(), now);
        let failing = RecordingSink {
            delivered: Mutex::new(vec![]),
            attempts: Mutex::new(0),
            failure: Some("temporary transport failure"),
        };
        process_once_at(tmp.path(), &failing, now).unwrap();
        assert_eq!(*failing.attempts.lock().unwrap(), 1);
        process_once_at(tmp.path(), &failing, now + Duration::minutes(4)).unwrap();
        assert_eq!(*failing.attempts.lock().unwrap(), 1);
        process_once_at(tmp.path(), &failing, now + Duration::minutes(5)).unwrap();
        assert_eq!(*failing.attempts.lock().unwrap(), 2);
        process_once_at(tmp.path(), &failing, now + Duration::minutes(15)).unwrap();
        assert_eq!(*failing.attempts.lock().unwrap(), 3);

        let config = jin_core::Config::load(tmp.path()).unwrap();
        let mut center = jin_core::notification_center::NotificationCenter::open(
            &config.notification_center_path(),
        )
        .unwrap();
        let item = center
            .list(
                &jin_core::notification_center::NotificationListRequest::default(),
                now + Duration::minutes(15),
            )
            .unwrap()
            .items
            .pop()
            .unwrap();
        assert_eq!(
            item.native_state,
            jin_core::notification_center::NativeDeliveryState::Suppressed
        );
        let recovered = RecordingSink::default();
        process_once_at(tmp.path(), &recovered, now + Duration::minutes(20)).unwrap();
        assert!(recovered.delivered.lock().unwrap().is_empty());
    }
}
