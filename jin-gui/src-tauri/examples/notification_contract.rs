use jin_core::notification_center::{
    ActionAttemptState, CalendarInvitationPayload, InvitationRecurrenceIdentity,
    InvitationRecurrenceScope, InvitationResponse, NativeDeliveryState, NotificationAction,
    NotificationCapabilities, NotificationCenterPage, NotificationCenterSummary,
    NotificationCommandError, NotificationFilter, NotificationItem, NotificationPayload,
    NotificationSourceError, NotificationSourceKind, NotificationStatus, ResolutionOrigin,
    TaskReminderPayload, NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
};
use serde_json::json;

fn main() {
    let invitation = NotificationItem {
        id: "notification-invitation-fixture".into(),
        source_key: "google/account/calendar/event/instance".into(),
        source_revision: "etag-invitation".into(),
        status: NotificationStatus::ActionPending,
        version: 3,
        read_at: None,
        visible_after: None,
        created_at: "2026-09-03T10:00:00Z".into(),
        updated_at: "2026-09-03T10:01:00Z".into(),
        requested_action: Some(NotificationAction::Maybe),
        action_state: Some(ActionAttemptState::Queued),
        action_error: None,
        native_state: NativeDeliveryState::Submitted,
        resolution_origin: Some(ResolutionOrigin::Jin),
        source_reason: None,
        payload: NotificationPayload::CalendarInvitation(Box::new(CalendarInvitationPayload {
            schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
            account_id: "account".into(),
            account_alias: "Work".into(),
            calendar_id: "calendar".into(),
            calendar_name: "Primary".into(),
            canonical_event_id: "canonical-event".into(),
            google_event_id: "google-event".into(),
            recurrence: InvitationRecurrenceIdentity::Instance {
                instance_google_event_id: "google-instance".into(),
                recurring_event_id: "google-series".into(),
                original_start: "2026-09-03T10:00:00Z".into(),
                original_start_tzid: Some("UTC".into()),
            },
            title: "Bridge invitation".into(),
            organizer_name: Some("Organizer".into()),
            organizer_email: Some("organizer@example.test".into()),
            start: "2026-09-03T10:00:00Z".into(),
            end: "2026-09-03T11:00:00Z".into(),
            all_day: false,
            timezone: Some("UTC".into()),
            location: Some("Meet".into()),
            self_email: "self@example.test".into(),
            provider_response_status: "needsAction".into(),
            etag: "etag-invitation".into(),
            provider_subject: "self@example.test".into(),
            auth_generation: 4,
            route_generation: 5,
            capabilities: NotificationCapabilities {
                can_respond: true,
                recurrence_scopes: vec![
                    InvitationRecurrenceScope::ThisOccurrence,
                    InvitationRecurrenceScope::EntireSeries,
                ],
                ..Default::default()
            },
        })),
    };
    let reminder = NotificationItem {
        id: "notification-task-fixture".into(),
        source_key: "task/task-1/2026-09-03T10:00:00Z".into(),
        source_revision: "task-revision-1".into(),
        status: NotificationStatus::Active,
        version: 2,
        read_at: Some("2026-09-03T10:02:00Z".into()),
        visible_after: Some("2026-09-04T09:00:00Z".into()),
        created_at: "2026-09-03T10:00:00Z".into(),
        updated_at: "2026-09-03T10:00:00Z".into(),
        requested_action: None,
        action_state: None,
        action_error: Some(jin_core::notification_center::NotificationActionError {
            code: "temporary".into(),
            message: "Retry later".into(),
            retryable: true,
        }),
        native_state: NativeDeliveryState::Failed,
        resolution_origin: None,
        source_reason: Some("source reason".into()),
        payload: NotificationPayload::TaskReminder(Box::new(TaskReminderPayload {
            schema_version: NOTIFICATION_PAYLOAD_SCHEMA_VERSION,
            occurrence_key: "2026-09-03T10:00:00Z".into(),
            task_id: "task-1".into(),
            title: "Bridge reminder".into(),
            scheduled_at: "2026-09-03T10:00:00Z".into(),
            list_name: Some("Inbox".into()),
            project_name: None,
            task_edit_token: Some("task-revision-1".into()),
            capabilities: NotificationCapabilities {
                can_complete_task: true,
                ..Default::default()
            },
        })),
    };
    let page = NotificationCenterPage {
        items: vec![invitation.clone(), reminder.clone()],
        next_cursor: Some("fixture-cursor".into()),
        snapshot_watermark: "2026-09-03T10:00:00Z".into(),
        partial_errors: vec![NotificationSourceError {
            source_kind: NotificationSourceKind::CalendarInvitation,
            source_key: "canonical/broken-event.md".into(),
            code: "canonical_event_invalid".into(),
            message: "Could not refresh this event".into(),
            updated_at: "2026-09-03T10:00:00Z".into(),
        }],
    };
    let summary = NotificationCenterSummary {
        visible_unread: 2,
        visible_total: 2,
        pending: 1,
        errors: 1,
        partial_error_count: 1,
    };
    let command_errors = vec![
        NotificationCommandError {
            code: "stale_item".into(),
            message: "Review the latest state".into(),
            retryable: true,
            item: Some(Box::new(invitation.clone())),
        },
        NotificationCommandError {
            code: "ineligible".into(),
            message: "Action unavailable".into(),
            retryable: false,
            item: None,
        },
    ];
    let fixture = json!({
        "items": [invitation, reminder],
        "page": page,
        "summary": summary,
        "command_errors": command_errors,
        "enums": {
            "source_kind": [NotificationSourceKind::CalendarInvitation, NotificationSourceKind::TaskReminder],
            "status": [NotificationStatus::Active, NotificationStatus::ActionPending, NotificationStatus::Acted, NotificationStatus::Superseded, NotificationStatus::Dismissed, NotificationStatus::Obsolete],
            "action": [NotificationAction::Allow, NotificationAction::Maybe, NotificationAction::Refuse, NotificationAction::CompleteTask],
            "invitation_response": [InvitationResponse::Allow, InvitationResponse::Maybe, InvitationResponse::Refuse],
            "recurrence_scope": [InvitationRecurrenceScope::ThisOccurrence, InvitationRecurrenceScope::EntireSeries],
            "action_state": [ActionAttemptState::Preparing, ActionAttemptState::Queued, ActionAttemptState::Sending, ActionAttemptState::Succeeded, ActionAttemptState::FailedRetryable, ActionAttemptState::FailedTerminal, ActionAttemptState::Superseded, ActionAttemptState::Obsolete],
            "native_state": [NativeDeliveryState::NotRequested, NativeDeliveryState::Pending, NativeDeliveryState::Submitted, NativeDeliveryState::Failed, NativeDeliveryState::Suppressed],
            "resolution_origin": [ResolutionOrigin::Jin, ResolutionOrigin::External],
            "filter": [NotificationFilter::All, NotificationFilter::Invitations, NotificationFilter::Reminders, NotificationFilter::Unread, NotificationFilter::Deferred, NotificationFilter::History]
        },
        "recurrence_identities": [
            InvitationRecurrenceIdentity::Single,
            InvitationRecurrenceIdentity::SeriesMaster { master_google_event_id: "series".into() },
            InvitationRecurrenceIdentity::Instance { instance_google_event_id: "instance".into(), recurring_event_id: "series".into(), original_start: "2026-09-03T10:00:00Z".into(), original_start_tzid: None }
        ]
    });
    println!(
        "{}",
        serde_json::to_string(&fixture).expect("serialize fixture")
    );
}
