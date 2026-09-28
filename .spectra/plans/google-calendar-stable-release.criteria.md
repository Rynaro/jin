---
artifact: acceptance-criteria
version: 0.1.0
plan: google-calendar-stable-release
status: frozen-amended-awaiting-implementation-greenlight
---

# Google Calendar stable release — acceptance criteria

## Acceptance Criteria

### AC-GCSR-001 (ubiquitous)
GIVEN the stable release implementation is under verification
WHEN the retained Google multi-account and Notification Center suites run
THEN every previously passing Google route-isolation and RSVP test SHALL remain passing
VERIFY: test: retained Google multi-account and invitation RSVP regression suites

### AC-GCSR-002 (state-driven)
GIVEN a provider event crosses the Rust, Tauri, and TypeScript boundaries
WHEN its collaboration capability projection is decoded
THEN every boundary SHALL preserve the same capability values and stable reason codes
VERIFY: test: Rust serialization fixture equals TypeScript DTO shape fixture

### AC-GCSR-003 (state-driven)
GIVEN an invitee owns the writable primary calendar containing a received invitation
WHEN the invitee is neither organizer nor permitted by Google guest-edit fields
THEN core SHALL report schedule editing unavailable
VERIFY: test: event_capabilities::primary_owner_is_not_organizer_authority

### AC-GCSR-004 (state-driven)
GIVEN an event organizer is the authenticated account on a writable exact route
WHEN collaboration capabilities are projected
THEN core SHALL report schedule editing available
VERIFY: test: event_capabilities::organizer_can_edit_schedule

### AC-GCSR-005 (state-driven)
GIVEN a non-organizer self attendee has `guestsCanModify=true` on a writable exact route
WHEN collaboration capabilities are projected
THEN core SHALL report schedule editing available
VERIFY: test: event_capabilities::guest_modify_permission

### AC-GCSR-006 (state-driven)
GIVEN a self attendee has `guestsCanInviteOthers=true` on a writable exact route
WHEN collaboration capabilities are projected
THEN core SHALL report attendee append available without granting remove or role-change authority
VERIFY: test: event_capabilities::guest_invite_permission

### AC-GCSR-007 (state-driven)
GIVEN a calendar route is reader, disabled, unavailable, disconnected, or needs reauth
WHEN any outbound collaboration capability is projected
THEN core SHALL report that capability unavailable with a stable reason
VERIFY: test: event_capabilities::route_state_denies_mutation

### AC-GCSR-008 (event-driven)
GIVEN multiple Google accounts expose the same calendar and event identifiers
WHEN a collaboration action is queued
THEN its intent SHALL retain the exact provider, account, calendar, event, and recurrence identity
VERIFY: test: collaboration_routing::same_ids_across_accounts

### AC-GCSR-009 (event-driven)
GIVEN a writable Google destination and one valid guest
WHEN the user creates an invitation with the default update policy
THEN Calendar insert SHALL use `sendUpdates=all`
VERIFY: test: google_calendar::create_invitation_sends_updates_all

### AC-GCSR-010 (event-driven)
GIVEN a new Google event has no guests
WHEN the user creates it
THEN the event SHALL remain an ordinary Calendar event without invitation-only UI state
VERIFY: test: event_creation::guestless_event_contract

### AC-GCSR-011 (state-driven)
GIVEN a queued create, attendee edit, schedule edit, or cancellation
WHEN its provider request is retried
THEN the request SHALL reuse the guest-update policy captured at intent time
VERIFY: test: event_mutation::guest_policy_is_immutable

### AC-GCSR-012 (event-driven)
GIVEN guest emails differ only by case or surrounding whitespace
WHEN attendee drafts are validated
THEN core SHALL reject or coalesce them as one attendee identity
VERIFY: test: attendee_editor::deduplicates_email_identity

### AC-GCSR-013 (event-driven)
GIVEN a fresh exact-route resource has a complete attendee set and one existing attendee has provider response and comment state
WHEN a different attendee is added or removed
THEN core SHALL preserve the unchanged attendee's provider state
VERIFY: test: attendee_merge::preserves_unchanged_provider_fields

### AC-GCSR-014 (event-driven)
GIVEN an event contains organizer identity
WHEN its attendee list is edited
THEN core SHALL leave organizer identity unchanged
VERIFY: test: attendee_merge::organizer_is_not_rewritten

### AC-GCSR-015 (unwanted-behavior)
GIVEN an invitation draft contains more than 200 non-organizer attendees
WHEN the user attempts to submit it
THEN core SHALL reject the in-app invitation with the documented propagation-limit reason
VERIFY: test: attendee_editor::large_invite_boundary

### AC-GCSR-016 (unwanted-behavior)
GIVEN a local-only event draft contains guests or provider conferencing
WHEN the user submits it without selecting a Google destination
THEN Jin SHALL request an exact writable destination without creating partial provider intent
VERIFY: test: event_creation::collaboration_requires_destination

### AC-GCSR-017 (event-driven)
GIVEN an organizer removes a guest from an event
WHEN the attendee patch is serialized
THEN the provider payload SHALL contain the complete merged attendee list without that guest
VERIFY: test: google_mapping::attendee_removal_full_list

### AC-GCSR-018 (event-driven)
GIVEN an authorized schedule editor changes a meeting time
WHEN the mutation is queued
THEN the outbox SHALL retain the selected guest-update policy
VERIFY: test: event_mutation::reschedule_captures_guest_policy

### AC-GCSR-019 (event-driven)
GIVEN a current etag protects a Google-backed event
WHEN schedule or attendee editing reaches the provider
THEN the request SHALL carry that etag in `If-Match`
VERIFY: test: google_client::collaboration_patch_uses_if_match

### AC-GCSR-020 (unwanted-behavior)
GIVEN Google returns HTTP 412 for a collaboration edit
WHEN conflict handling runs
THEN Jin SHALL import the remote event and return a typed stale result without unconditional overwrite
VERIFY: test: collaboration_conflict::precondition_failure_refetches

### AC-GCSR-021 (event-driven)
GIVEN a recurring event supports occurrence and series mutations
WHEN the user chooses Edit, Meet, attendee change, RSVP, or cancellation
THEN Jin SHALL require an explicit supported recurrence scope before enqueue
VERIFY: test: recurrence::collaboration_scope_required

### AC-GCSR-022 (unwanted-behavior)
GIVEN a collaboration mutation requests `this_and_following`
WHEN core validates the request
THEN core SHALL reject it without canonical or outbox mutation
VERIFY: test: recurrence::following_scope_rejected

### AC-GCSR-023 (event-driven)
GIVEN an organizer cancels a provider meeting with guests
WHEN cancellation reaches Google
THEN the delete request SHALL use the captured guest-update policy
VERIFY: test: google_calendar::organizer_cancel_notification_policy

### AC-GCSR-024 (unwanted-behavior)
GIVEN an invitee selects Decline
WHEN the RSVP mutation runs
THEN Jin SHALL modify only the self-attendee response rather than delete the event
VERIFY: test: invitation_rsvp::decline_never_cancels_event

### AC-GCSR-025 (state-driven)
GIVEN a future received invitation has one unambiguous self attendee
WHEN Event detail renders
THEN it SHALL expose Accept, Maybe, and Decline through the core action reference
VERIFY: test: events_controller.test.ts event_detail_rsvp_actions

### AC-GCSR-026 (state-driven)
GIVEN a future received invitation is visible in Notification Center
WHEN its detail renders
THEN it SHALL expose Accept, Maybe, and Decline using Calendar-standard user-facing labels
VERIFY: test: notifications_controller.test.ts calendar_rsvp_labels

### AC-GCSR-027 (event-driven)
GIVEN Event detail and Notification Center reference the same invitation
WHEN either surface submits an RSVP
THEN exactly one notification action attempt SHALL own the operation ID
VERIFY: test: notification_center::cross_surface_single_attempt

### AC-GCSR-028 (state-driven)
GIVEN an RSVP is queued but not provider-confirmed
WHEN either surface renders the invitation
THEN it SHALL distinguish the requested response from the confirmed provider response
VERIFY: test: shared invitation fixture pending response rendering

### AC-GCSR-029 (event-driven)
GIVEN Google confirms an RSVP and exact-route sync imports it
WHEN the invitation item reconciles
THEN both surfaces SHALL render the confirmed response after one mutation refresh
VERIFY: test: invitation_reconcile::confirmation_updates_both_surfaces

### AC-GCSR-030 (event-driven)
GIVEN a future invitation already has accepted, tentative, or declined status
WHEN the user chooses a different response
THEN Jin SHALL queue the new response through the same durable RSVP path
VERIFY: test: invitation_rsvp::change_confirmed_response

### AC-GCSR-031 (event-driven)
GIVEN the user selects the already confirmed RSVP value
WHEN core validates the action
THEN Jin SHALL return a no-op without a new outbox row
VERIFY: test: invitation_rsvp::same_response_no_op

### AC-GCSR-032 (unwanted-behavior)
GIVEN an invitation action reference is stale
WHEN a response is submitted
THEN Jin SHALL return the latest item for review without sending the stale response
VERIFY: test: notification_center::stale_cross_surface_action

### AC-GCSR-033 (state-driven)
GIVEN a resolved invitation remains in Notification Center history before its end
WHEN response capability is still valid
THEN the history detail SHALL allow a response change
VERIFY: test: notifications_controller.test.ts history_response_change

### AC-GCSR-034 (state-driven)
GIVEN a destination calendar does not advertise `hangoutsMeet`
WHEN Event editor and detail render meeting capability
THEN Add Google Meet SHALL be unavailable with a provider-capability explanation
VERIFY: test: conference_capability::unsupported_calendar

### AC-GCSR-035 (event-driven)
GIVEN a route gains persisted Meet capability from discovery
WHEN capability activation is evaluated
THEN Jin SHALL require a completed full sync for that exact route
VERIFY: test: conference_capability::bootstrap_before_activation

### AC-GCSR-036 (event-driven)
GIVEN the user requests a new Meet conference
WHEN the semantic mutation is created
THEN Jin SHALL generate one fresh unpredictable conference request ID
VERIFY: test: event_mutation::meet_semantic_request_id

### AC-GCSR-037 (event-driven)
GIVEN a Meet provider request has a retryable transport failure
WHEN the same operation retries
THEN Jin SHALL reuse its original conference request ID
VERIFY: test: google_sync::meet_transport_retry_reuses_id

### AC-GCSR-038 (state-driven)
GIVEN Google reports conference creation pending
WHEN Event detail renders
THEN Jin SHALL show Pending without exposing a Join action
VERIFY: test: events_controller.test.ts meet_pending_state

### AC-GCSR-039 (event-driven)
GIVEN Google returns successful conference data
WHEN exact-route sync imports the event
THEN Event detail SHALL expose only safe provider entry points as Join actions
VERIFY: test: events_controller.test.ts meet_success_entry_points

### AC-GCSR-040 (event-driven)
GIVEN Google reports terminal conference creation failure
WHEN the user explicitly retries creation
THEN Jin SHALL create a new semantic operation with a new request ID
VERIFY: test: event_mutation::meet_failure_user_retry_new_id

### AC-GCSR-041 (event-driven)
GIVEN an event already has conference data
WHEN an unrelated supported field changes
THEN the round trip SHALL preserve the conference data losslessly
VERIFY: test: google_mapping::unrelated_patch_preserves_conference

### AC-GCSR-042 (ubiquitous)
GIVEN the Google Calendar stable release is assembled
WHEN account OAuth and persistence schemas are inspected
THEN the release SHALL contain no Gmail scope request or mail outbox integration
VERIFY: test: stable_release::gmail_transport_absent

### AC-GCSR-043 (ubiquitous)
GIVEN the Google Calendar stable release surfaces render
WHEN event and notification actions are inspected
THEN the release SHALL expose no time-suggestion action
VERIFY: test: stable_release::time_suggestion_ui_absent

### AC-GCSR-044 (optional-feature)
GIVEN physical-room support is enabled and the user knows a resource email
WHEN an authorized organizer adds that room
THEN Jin SHALL serialize it as an attendee with `resource=true`
VERIFY: test: google_mapping::known_room_resource_attendee

### AC-GCSR-045 (optional-feature)
GIVEN searchable physical-room inventory is enabled for a Workspace admin account
WHEN Jin requests room discovery
THEN it SHALL use only the read-only Admin Directory resource-calendar scope
VERIFY: test: room_directory::least_privileged_scope

### AC-GCSR-046 (state-driven)
GIVEN a consumer or non-admin account lacks room-directory authority
WHEN Event editor renders the optional room picker
THEN Jin SHALL explain directory unavailability without blocking known-email or Google Meet paths
VERIFY: test: room_picker::admin_capability_fallback

### AC-GCSR-047 (event-driven)
GIVEN Google updates a room resource response
WHEN exact-route sync imports the event
THEN the room row SHALL show provider-confirmed Pending, Accepted, or Declined state
VERIFY: test: room_resource::response_projection

### AC-GCSR-048 (unwanted-behavior)
GIVEN one account loses auth or route permission
WHEN another account has queued collaboration work
THEN Jin SHALL leave the other account's operations runnable and unchanged
VERIFY: test: collaboration_routing::account_failure_isolation

### AC-GCSR-049 (event-driven)
GIVEN one calendar route returns incremental-sync HTTP 410
WHEN recovery runs
THEN Jin SHALL reset and fully sync only that exact route
VERIFY: test: google_sync::collaboration_scoped_410

### AC-GCSR-050 (state-driven)
GIVEN guest, RSVP, and Meet controls render at 320, 390, 760, or 1440 CSS pixels
WHEN layout and accessibility scale are exercised
THEN the document SHALL remain free of horizontal overflow
VERIFY: Playwright geometry evidence at maintained visual anchors

### AC-GCSR-051 (event-driven)
GIVEN a collaboration dialog opens and closes by submit, Cancel, or Escape
WHEN keyboard focus is inspected
THEN focus SHALL remain trapped while open and return to the invoking control on close
VERIFY: test: Playwright keyboard and focus restoration flow

### AC-GCSR-052 (ubiquitous)
GIVEN collaboration state is selected, pending, failed, unavailable, or confirmed
WHEN light, dark, contrast, reduced transparency, reduced motion, and forced colors are reviewed
THEN every state SHALL remain identifiable without color alone
VERIFY: jin-gui visual QA evidence plus native owner checklist

### AC-GCSR-053 (state-driven)
GIVEN mandatory disposable-account Calendar create/edit/RSVP/Meet evidence or an activated room gate is absent or failed
WHEN stable release evidence is assembled
THEN the affected requested capability SHALL remain disabled and the release SHALL not be claimed stable
VERIFY: review: docs/google-smoke-test.md extension and release checklist result record

### AC-GCSR-054 (state-driven)
GIVEN a non-organizer attendee has only `guestsCanInviteOthers=true`
WHEN remove and attendee-role capabilities are projected
THEN core SHALL deny both capabilities with `organizer_authority_required`
VERIFY: test: event_capabilities::guest_inviter_cannot_remove_or_change_roles

### AC-GCSR-055 (state-driven)
GIVEN a received invitation is stored on the invitee's writable primary calendar
WHEN organizer-route authority is evaluated
THEN the primary route SHALL not qualify as the organizer's shared-calendar route
VERIFY: test: event_capabilities::primary_invitation_never_shared_organizer_route

### AC-GCSR-056 (state-driven)
GIVEN a Google event has `locked=true`
WHEN collaboration capabilities are projected
THEN core SHALL deny schedule, attendee, conference, and cancellation mutations
VERIFY: test: event_capabilities::locked_event_denies_collaboration_mutation

### AC-GCSR-057 (state-driven)
GIVEN an event contains a conference solution that is not an owned `hangoutsMeet` conference
WHEN conference capabilities are projected
THEN core SHALL keep the conference visible while denying remove or replace
VERIFY: test: conference_capability::foreign_solution_read_only

### AC-GCSR-058 (unwanted-behavior)
GIVEN the latest exact-route event has `attendeesOmitted=true` or unknown attendee completeness
WHEN a remove, role-change, or full-list attendee mutation is requested
THEN core SHALL refetch or reject the mutation without replacing the attendee list
VERIFY: test: attendee_merge::incomplete_set_never_replaced

### AC-GCSR-059 (event-driven)
GIVEN a new routed invitation is accepted locally
WHEN its journal and outbox intent commit
THEN Jin SHALL persist one Google-valid client event ID before provider I/O
VERIFY: test: event_mutation::invitation_insert_id_persisted

### AC-GCSR-060 (unwanted-behavior)
GIVEN an invitation insert has an ambiguous response or HTTP 409
WHEN recovery runs
THEN Jin SHALL reconcile the same exact-route event ID without a second guest-notification fan-out
VERIFY: test: google_sync::ambiguous_invitation_insert_reconciles_once

### AC-GCSR-061 (event-driven)
GIVEN Google returns an auth, insufficient-scope, quota, rate, non-organizer, role, or domain-policy error
WHEN endpoint-aware classification runs
THEN Jin SHALL map the provider reason to the frozen reauth, bounded-retry, or terminal-review category
VERIFY: test: google_errors::reason_taxonomy_table

### AC-GCSR-062 (event-driven)
GIVEN Google returns 410 for either a targeted event request or an event-list sync token
WHEN error handling runs
THEN Jin SHALL distinguish operation reconciliation from exact-route cursor reset by endpoint context
VERIFY: test: google_errors::target_410_differs_from_sync_token_410

### AC-GCSR-063 (event-driven)
GIVEN an existing root contains pre-release invitations and old collaboration persistence schemas
WHEN the versioned migration or on-demand materialization reruns after any interruption
THEN Jin SHALL converge on one item per exact invitation identity without creating an action attempt
VERIFY: test: collaboration_migration::upgrade_restart_idempotence

### AC-GCSR-064 (ubiquitous)
GIVEN Event detail and Notification Center expose RSVP interactions
WHEN frontend ownership is inspected
THEN both surfaces SHALL use the shared response-state/action component contract
VERIFY: test: frontend contract test for shared invitation controls
