---
artifact: acceptance-criteria
version: 1.0.0
change_id: google-calendar-invites-notification-center
---

# Acceptance Criteria

### AC-NC-001 (event-driven)
GIVEN a fresh or previously migrated Jin root
WHEN the Notification Center ledger opens
THEN additive schema migration SHALL complete idempotently without modifying canonical task or event files
VERIFY: test: notification_center::schema_migration_is_idempotent

### AC-NC-002 (unwanted-behavior)
GIVEN Notification Center is first enabled on an existing root
WHEN bootstrap reconciliation runs
THEN the center SHALL exclude ended invitations and already delivered historical reminder occurrences
VERIFY: test: notification_center::bootstrap_suppresses_historical_flood

### AC-NC-003 (event-driven)
GIVEN the same source key and source revision is reconciled repeatedly
WHEN the producer upserts the source
THEN exactly one notification item SHALL exist
VERIFY: test: notification_center::source_upsert_is_idempotent

### AC-NC-004 (event-driven)
GIVEN an existing source receives a newer source revision while continuously actionable
WHEN reconciliation refreshes its snapshot
THEN the item SHALL retain its read defer and dismiss state
VERIFY: test: notification_center::revision_refresh_preserves_curation

### AC-NC-005 (unwanted-behavior)
GIVEN a client submits an outdated expected item version
WHEN a center mutation is requested
THEN the backend SHALL return `stale_item` with the current item without applying the mutation
VERIFY: test: notification_center::optimistic_version_rejects_stale_write

### AC-NC-006 (event-driven)
GIVEN an invitation source is cancelled missing ended or no longer eligible
WHEN reconciliation observes the source
THEN its current item SHALL become `obsolete`
VERIFY: test: notification_center::missing_or_ineligible_source_obsoletes

### AC-NC-007 (event-driven)
GIVEN a terminal item is older than 30 days
WHEN retention maintenance runs
THEN the item SHALL be pruned without mutating its canonical source
VERIFY: test: notification_center::terminal_retention_is_source_safe

### AC-NC-008 (event-driven)
GIVEN an actionable item is deferred to a future instant
WHEN normal list and summary queries run before that instant
THEN the item SHALL be excluded from visible results and unread badge count
VERIFY: test: notification_center::deferred_item_is_hidden

### AC-NC-009 (event-driven)
GIVEN a deferred item's visible time has arrived
WHEN reconciliation or listing evaluates it
THEN the item SHALL become visible and unread
VERIFY: test: notification_center::deferred_item_wakes_unread

### AC-NC-010 (event-driven)
GIVEN a due task reminder occurrence is claimed
WHEN scheduler delivery runs
THEN its Notification Center item SHALL commit before the occurrence is marked delivered
VERIFY: test: scheduler::center_insert_precedes_reminder_delivered

### AC-NC-011 (unwanted-behavior)
GIVEN native notification permission is denied or submission fails
WHEN a task reminder is delivered to the center
THEN the durable task reminder item SHALL remain actionable
VERIFY: test: scheduler::native_failure_preserves_center_item

### AC-NC-012 (event-driven)
GIVEN a crash occurs after center insertion but before reminder delivery acknowledgement
WHEN the scheduler restarts
THEN reconciliation SHALL converge without a duplicate center item
VERIFY: test: scheduler::reminder_crash_reentry_is_idempotent

### AC-NC-013 (event-driven)
GIVEN a task-reminder item refers to a currently open task
WHEN the user chooses Mark done
THEN the item SHALL become acted only after the canonical task completion succeeds
VERIFY: test: notification_center::complete_task_orders_source_before_item

### AC-NC-014 (event-driven)
GIVEN a task is completed or deleted outside Notification Center
WHEN task-source reconciliation runs
THEN its remaining reminder items SHALL become obsolete
VERIFY: test: notification_center::task_resolution_obsoletes_reminders

### AC-NC-015 (state-driven)
GIVEN native submission has not succeeded
WHEN scheduler delivery truth is evaluated
THEN reminder occurrence delivery truth SHALL depend on durable center insertion rather than native delivery
VERIFY: test: scheduler::delivery_truth_is_center_durability

### AC-NC-016 (event-driven)
GIVEN a canonical Google event has a non-self organizer and exactly one `self=true` attendee with `needsAction`
WHEN invitation reconciliation runs before the event ends
THEN the center SHALL contain one actionable invitation item
VERIFY: test: invitation_reconcile::eligible_event_creates_item

### AC-NC-017 (unwanted-behavior)
GIVEN the connected account is the event organizer
WHEN invitation reconciliation or RSVP validation runs
THEN Jin SHALL reject invitation action as `organizer_owned`
VERIFY: test: invitation_reconcile::organizer_owned_is_rejected

### AC-NC-018 (unwanted-behavior)
GIVEN no attendee has `self=true`
WHEN invitation reconciliation or RSVP validation runs
THEN Jin SHALL reject invitation action as `self_attendee_missing`
VERIFY: test: invitation_reconcile::missing_self_is_rejected

### AC-NC-019 (unwanted-behavior)
GIVEN more than one attendee has `self=true`
WHEN invitation reconciliation or RSVP validation runs
THEN Jin SHALL reject invitation action as `self_attendee_ambiguous`
VERIFY: test: invitation_reconcile::ambiguous_self_is_rejected

### AC-NC-020 (ubiquitous)
GIVEN canonical Google invitation sources are available
WHEN invitation eligibility is evaluated
THEN invitation eligibility SHALL be derived from canonical events by backend code rather than the attendee-omitting indexed event DTO
VERIFY: test: invitation_reconcile::canonical_projection_owns_eligibility

### AC-NC-021 (state-driven)
GIVEN two accounts contain equal calendar IDs and Google event IDs
WHEN invitation reconciliation or response routing runs
THEN their invitation items and response operations SHALL remain independently addressable
VERIFY: test: invitation_reconcile::multi_account_identity_isolated

### AC-NC-022 (event-driven)
GIVEN generated recurring instances inherit one pending master invitation
WHEN invitation reconciliation runs
THEN Jin SHALL emit one master item rather than one item per generated instance
VERIFY: test: invitation_reconcile::recurring_master_deduplicates_instances

### AC-NC-023 (event-driven)
GIVEN a detached recurrence exception has its own Google identity or response state
WHEN invitation reconciliation runs
THEN Jin SHALL preserve it as an independently actionable source
VERIFY: test: invitation_reconcile::detached_exception_is_independent

### AC-NC-024 (event-driven)
GIVEN an invitation is answered outside Jin
WHEN account sync reconciles the new self response
THEN its item SHALL resolve as acted with external origin
VERIFY: test: invitation_reconcile::external_answer_resolves_item

### AC-NC-025 (event-driven)
GIVEN Allow Maybe or Refuse is accepted by the RSVP service
WHEN provider intent is constructed
THEN Jin SHALL map the choice respectively to `accepted` `tentative` or `declined`
VERIFY: test: event_mutation::invitation_response_mapping_is_closed

### AC-NC-026 (event-driven)
GIVEN an eligible RSVP intent
WHEN its Google PATCH body is serialized
THEN the body SHALL contain only one self attendee email and responseStatus plus `attendeesOmitted=true`
VERIFY: test: google::mapping::rsvp_exact_payload_golden

### AC-NC-027 (ubiquitous)
GIVEN an MVP RSVP provider request is constructed
WHEN its update-notification query is serialized
THEN every MVP RSVP provider request SHALL set `sendUpdates=none`
VERIFY: test: google::client::rsvp_send_updates_none

### AC-NC-028 (event-driven)
GIVEN canonical `attendees_omitted` is true false or absent
WHEN the dedicated RSVP operation commits
THEN canonical `attendees_omitted` SHALL remain byte-for-byte unchanged
VERIFY: test: event_mutation::rsvp_preserves_canonical_attendees_omitted

### AC-NC-029 (unwanted-behavior)
GIVEN an RSVP is permitted on an otherwise non-editable external event
WHEN capabilities are projected
THEN generic edit delete organizer and attendee-edit capabilities SHALL remain disabled
VERIFY: test: event_capabilities::rsvp_does_not_unlock_general_edit

### AC-NC-030 (event-driven)
GIVEN an eligible invitation has an exact account calendar event and recurrence route
WHEN RSVP is queued
THEN its outbox operation SHALL retain that exact route without alias or default fallback
VERIFY: test: event_mutation::rsvp_routes_exact_destination

### AC-NC-031 (event-driven)
GIVEN one operation ID is replayed with byte-identical RSVP intent
WHEN the service handles the replay
THEN it SHALL return the recorded outcome without a second canonical mutation or outbox row
VERIFY: test: event_mutation::rsvp_operation_is_idempotent

### AC-NC-032 (unwanted-behavior)
GIVEN one operation ID is reused with different RSVP intent
WHEN the service handles the request
THEN it SHALL return `idempotency_conflict` without mutation
VERIFY: test: event_mutation::rsvp_idempotency_conflict

### AC-NC-033 (event-driven)
GIVEN a valid RSVP is accepted into the recoverable mutation boundary
WHEN center intent and outbox durability complete
THEN the center item SHALL show `action_pending` with the requested choice
VERIFY: test: notification_center::rsvp_pending_after_durable_acceptance

### AC-NC-034 (state-driven)
GIVEN the device is offline but authenticated and route-valid
WHEN an accepted RSVP is projected or recovered
THEN an accepted RSVP SHALL remain durably queued and visible as Pending sync
VERIFY: test: google::multi_sync::offline_rsvp_remains_queued

### AC-NC-035 (unwanted-behavior)
GIVEN the account is disconnected reauthentication-required or route-invalid
WHEN RSVP is requested
THEN Jin SHALL leave the item active without changing canonical response status
VERIFY: test: event_mutation::unavailable_route_fails_before_mutation

### AC-NC-036 (event-driven)
GIVEN Google returns HTTP 412 for an RSVP PATCH
WHEN conflict handling runs
THEN Jin SHALL fetch the exact remote event before considering one retry
VERIFY: test: google::multi_sync::rsvp_412_fetches_before_retry

### AC-NC-037 (event-driven)
GIVEN the 412 refetch already contains the requested self response
WHEN conflict handling compares intent
THEN Jin SHALL complete the operation without another PATCH
VERIFY: test: google::multi_sync::rsvp_412_already_applied_is_success

### AC-NC-038 (event-driven)
GIVEN the 412 refetch remains eligible with a new etag
WHEN conflict handling retries
THEN Jin SHALL issue exactly one narrow PATCH using the refreshed `If-Match`
VERIFY: test: google::multi_sync::rsvp_412_retries_once_with_new_etag

### AC-NC-039 (unwanted-behavior)
GIVEN the controlled RSVP retry returns another 412 or eligibility changes
WHEN conflict handling terminates
THEN Jin SHALL apply the normative active superseded or obsolete outcome without overwriting remote state
VERIFY: test: google::multi_sync::rsvp_second_412_preserves_choice

### AC-NC-040 (unwanted-behavior)
GIVEN any RSVP precondition fails
WHEN provider dispatch is evaluated
THEN Jin SHALL never issue an unconditional PATCH
VERIFY: test: google::multi_sync::rsvp_never_drops_if_match

### AC-NC-041 (event-driven)
GIVEN a recurring invitation instance
WHEN This occurrence is selected
THEN Jin SHALL target the exact instance while preserving original-start identity
VERIFY: test: event_mutation::rsvp_this_occurrence_exact_identity

### AC-NC-042 (event-driven)
GIVEN a recurring invitation with a resolvable master
WHEN Entire series is selected
THEN Jin SHALL target the master while preserving recurrence and timezone semantics
VERIFY: test: event_mutation::rsvp_entire_series_targets_master

### AC-NC-043 (unwanted-behavior)
GIVEN a caller requests This and following
WHEN RSVP scope validation runs
THEN Jin SHALL reject the request before canonical or outbox mutation
VERIFY: test: event_mutation::rsvp_this_and_following_rejected

### AC-NC-044 (event-driven)
GIVEN Notification Center has visible unread items
WHEN the application shell renders
THEN the Notifications sidebar bell SHALL expose the backend unread count in text-accessible form
VERIFY: test: notifications_controller.test.ts sidebar_badge_accessible_count

### AC-NC-045 (state-driven)
GIVEN desktop viewport width
WHEN the Notifications route renders
THEN Notification Center SHALL render a keyboard-operable list and detail workspace
VERIFY: test: notifications_controller.test.ts desktop_list_detail

### AC-NC-046 (state-driven)
GIVEN mobile viewport width
WHEN the Notifications route renders and detail navigation occurs
THEN Notification Center SHALL render one column with Back restoring list focus and scroll
VERIFY: test: notifications_controller.test.ts mobile_back_restores_context

### AC-NC-047 (event-driven)
GIVEN an invitation item is rendered
WHEN its action controls are available
THEN the UI SHALL show organizer account time location View event and text buttons Allow Maybe Refuse
VERIFY: test: notifications_render.test.ts invitation_content_and_actions

### AC-NC-048 (state-driven)
GIVEN an invitation response is submitting or queued
WHEN the selected invitation action group renders
THEN its competing actions SHALL be disabled with `aria-busy` and a polite live-region update
VERIFY: test: notifications_controller.test.ts rsvp_busy_and_live_region

### AC-NC-049 (event-driven)
GIVEN a task reminder item is rendered
WHEN its controls are available
THEN the UI SHALL offer Open task Mark done read or unread defer and dismiss without implying provider response
VERIFY: test: notifications_render.test.ts task_controls

### AC-NC-050 (ubiquitous)
GIVEN notification DTO fixtures cross the core bridge and frontend boundary
WHEN serialization parity is checked
THEN Rust Tauri and TypeScript notification DTO fixtures SHALL serialize the same tagged union fields and closed enum values
VERIFY: test: dto_shapes.test.ts notification_center_rust_fixture_parity

### AC-NC-051 (event-driven)
GIVEN a crash occurs after center intent commits but before RSVP outbox insertion
WHEN startup saga reconciliation runs
THEN Jin SHALL resume the same operation ID or return the item active with a validation error
VERIFY: test: invitation_saga::recover_after_center_prepare

### AC-NC-052 (event-driven)
GIVEN a crash occurs after RSVP outbox insertion but before the center queued mirror
WHEN startup saga reconciliation joins by operation ID
THEN the attempt SHALL converge to queued without a duplicate outbox row
VERIFY: test: invitation_saga::recover_after_outbox_commit

### AC-NC-053 (event-driven)
GIVEN provider and canonical success commit before the center item becomes acted
WHEN startup saga reconciliation joins the successful operation
THEN the item SHALL become acted without another provider PATCH
VERIFY: test: invitation_saga::recover_after_provider_success

### AC-NC-054 (state-driven)
GIVEN an RSVP operation is preparing queued sending or retryable
WHEN canonical state and notification DTOs are projected
THEN canonical attendee responseStatus SHALL remain provider-confirmed while DTOs show a pending overlay
VERIFY: test: invitation_saga::pending_overlay_does_not_mutate_canonical

### AC-NC-055 (unwanted-behavior)
GIVEN auth generation route generation or provider subject differs from the queued RSVP snapshot
WHEN the provider worker validates authority
THEN it SHALL quarantine the operation before network access and disable item RSVP controls
VERIFY: test: invitation_saga::credential_or_route_rotation_blocks_send

### AC-NC-056 (event-driven)
GIVEN a 412 refetch contains a self response different from the pending requested response
WHEN saga outcome reconciliation runs
THEN the item and attempt SHALL become superseded with both choices preserved
VERIFY: test: invitation_saga::conflicting_external_response_supersedes

### AC-NC-057 (event-driven)
GIVEN a pending invitation is cancelled deleted or ended
WHEN source or saga reconciliation runs
THEN the item and attempt SHALL become obsolete without retry
VERIFY: test: invitation_saga::cancelled_deleted_or_ended_obsoletes

### AC-NC-058 (unwanted-behavior)
GIVEN one account event or canonical file fails during invitation scanning
WHEN reconciliation continues
THEN healthy sources SHALL still commit while the failed source records a bounded error
VERIFY: test: invitation_reconcile::partial_scan_failure_isolated

### AC-NC-059 (unwanted-behavior)
GIVEN Notification Center SQLite is corrupt or a migration cannot commit
WHEN the ledger opens
THEN Jin SHALL fail safely or rebuild current actionable projections without rewriting canonical sources
VERIFY: test: notification_center::corrupt_database_recovery_is_source_safe

### AC-NC-060 (event-driven)
GIVEN items are inserted while a multi-page list traversal is active
WHEN the next cursor page is requested
THEN snapshot-watermark pagination SHALL return no duplicate or skipped preexisting item
VERIFY: test: notification_center::pagination_snapshot_is_stable

### AC-NC-061 (ubiquitous)
GIVEN notification provider failures are recorded or reported
WHEN errors logs or telemetry are serialized
THEN notification provider errors logs and telemetry SHALL exclude tokens raw provider bodies and full attendee lists
VERIFY: test: notification_center::error_and_log_redaction

### AC-NC-062 (state-driven)
GIVEN a keyboard-only user is on Notification Center
WHEN the user navigates and activates the interface
THEN filters list rows details action groups and recurrence dialog SHALL be operable in visual focus order
VERIFY: test: notifications_accessibility.test.ts keyboard_order_and_dialog_trap

### AC-NC-063 (event-driven)
GIVEN an action completes fails or returns stale state
WHEN the UI rerenders the selected item
THEN focus SHALL return to a valid control and a polite live region SHALL announce the outcome once
VERIFY: test: notifications_accessibility.test.ts focus_and_single_announcement

### AC-NC-064 (ubiquitous)
GIVEN Notification Center renders any interactive or status state
WHEN visual and accessible cues are inspected
THEN unread pending failed superseded disabled and selected states SHALL have text or shape cues independent of color
VERIFY: test: notifications_accessibility.test.ts state_cues_do_not_require_color

### AC-NC-065 (event-driven)
GIVEN terminal item retention expires while an action attempt is nonterminal
WHEN pruning runs
THEN foreign-key retention SHALL prevent deletion of the item or orphaning of the attempt
VERIFY: test: notification_center::nonterminal_attempt_blocks_prune

### AC-NC-066 (event-driven)
GIVEN an eligible terminal item and attempts are pruned
WHEN a historical scan later sees the same source revision
THEN a source tombstone SHALL prevent recreation until expiry or an explicit new response cycle
VERIFY: test: notification_center::tombstone_prevents_historical_recreation

### AC-NC-067 (event-driven)
GIVEN an attendee-copy RSVP PATCH uses `sendUpdates=none`
WHEN Google accepts the response update
THEN release evidence SHALL confirm organizer-copy response propagation without requesting broad guest update mail
VERIFY: integration: disposable Google attendee-organizer conformance smoke with recorded result
